#!/usr/bin/env node
// LAN -> Mac -> Tailscale -> Jellyfin. No external dependencies.
import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, validateConfig } from './proxy_config.mjs';

const HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade'];
const ASSETS = {
  '/viera': ['index.html', 'text/html; charset=utf-8'],
  '/viera/': ['index.html', 'text/html; charset=utf-8'],
  '/viera/api.js': ['api.js', 'application/javascript; charset=utf-8'],
  '/viera/client.js': ['client.js', 'application/javascript; charset=utf-8'],
  '/viera/style.css': ['style.css', 'text/css; charset=utf-8'],
};
// Documented Panasonic HTML5 entry, including relative resource resolution.
// Root aliases also support launchers which request init.json next to the origin.
const SDK_ASSETS = {
  '/sdkhtml': ['index.html', 'text/html; charset=utf-8'],
  '/sdkhtml/': ['index.html', 'text/html; charset=utf-8'],
  '/sdkhtml/main.html': ['index.html', 'text/html; charset=utf-8'],
  '/sdkhtml/init.json': ['init.json', 'application/json; charset=utf-8'],
  '/sdkhtml/api.js': ['api.js', 'application/javascript; charset=utf-8'],
  '/sdkhtml/client.js': ['client.js', 'application/javascript; charset=utf-8'],
  '/sdkhtml/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/main.html': ['index.html', 'text/html; charset=utf-8'],
  '/init.json': ['init.json', 'application/json; charset=utf-8'],
  '/api.js': ['api.js', 'application/javascript; charset=utf-8'],
  '/client.js': ['client.js', 'application/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

function headersWithoutHop(headers) {
  const copy = { ...headers };
  for (const name of [...HOP, ...(headers.connection || '').toLowerCase().split(',').map(s => s.trim())]) {
    delete copy[name];
  }
  return copy;
}

function probePage(nonce) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>VIERA Jellyfin Test</title>
<style>body{background:#182433;color:#fff;font:28px sans-serif;margin:40px}a{color:#8edbff}</style>
</head><body><h1>Jellyfin-Verbindung</h1><p id="status">JavaScript-Test wird gestartet...</p>
<p id="details"></p><p><a href="/tv">Test wiederholen</a></p>
<p><a href="/viera">Eigenen Viera-Jellyfin-Client oeffnen</a></p>
<p><a href="/web/">Jellyfin-Weboberflaeche oeffnen</a> (Kompatibilitaet noch ungeprueft)</p>
<script type="text/javascript">
(function () {
  var nonce = ${JSON.stringify(nonce)};
  var sent = false;
  function report(ok, detail, version) {
    if (sent) { return; } sent = true;
    document.getElementById('status').innerHTML = ok ? 'Jellyfin-API vom Fernseher erreichbar!' : 'API-Test fehlgeschlagen';
    document.getElementById('details').appendChild(document.createTextNode(detail));
    window.vieraJellyfinReport = new Image();
    window.vieraJellyfinReport.src = '/tv/report?proof=' + nonce.split('').reverse().join('') +
      '&ok=' + (ok ? '1' : '0') + '&version=' + encodeURIComponent(version || '');
  }
  try {
    var xhr = new XMLHttpRequest();
    var timer = setTimeout(function () { xhr.abort(); report(false, 'Zeitlimit nach 15 Sekunden', ''); }, 15000);
    xhr.open('GET', '/System/Info/Public', true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      clearTimeout(timer);
      try {
        var info = JSON.parse(xhr.responseText);
        var ok = xhr.status === 200 && info.ProductName === 'Jellyfin Server' && typeof info.Version === 'string';
        report(ok, ok ? 'XHR und JSON funktionieren. Serverversion: ' + info.Version : 'HTTP ' + xhr.status, info.Version);
      } catch (e) { report(false, 'Keine gueltige JSON-Antwort, HTTP ' + xhr.status, ''); }
    };
    xhr.send(null);
  } catch (e) { report(false, 'XHR/JSON nicht verfuegbar', ''); }
}());
</script></body></html>`;
}

export function createProxy({ upstream, allowed, tv, testAccount = null, record = () => {} }) {
  const target = new URL(upstream);
  if (target.protocol !== 'http:' || target.pathname !== '/' || target.search || target.username || target.password) {
    throw new Error('Upstream must be an HTTP origin without credentials');
  }
  const tokens = new Map();
  const clientSessions = new Map();
  const sockets = new Set();
  const permitted = req => allowed.includes(req.socket.remoteAddress);
  const requestOptions = req => {
    const headers = headersWithoutHop(req.headers);
    headers.host = target.host;
    headers['x-forwarded-for'] = req.socket.remoteAddress;
    headers['x-forwarded-proto'] = 'http';
    headers['x-forwarded-host'] = req.headers.host;
    return { hostname: target.hostname, port: target.port || 80, method: req.method,
      path: req.url, headers };
  };
  const server = http.createServer((req, res) => {
    if (!permitted(req)) { res.writeHead(403).end('TV/local Mac only'); return; }
    // Reject absolute-form and network-path requests; never use client input as upstream host.
    if (!req.url.startsWith('/') || req.url.startsWith('//')) { res.writeHead(400).end(); return; }
    const url = new URL(req.url, 'http://proxy.invalid');
    const testLogin = url.pathname === '/viera/test-login';
    if (testLogin && req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
    if (testLogin && !testAccount) {
      req.resume();
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ error: 'Automatic test login is not configured' }));
      return;
    }
    const sdkAsset = Object.hasOwn(SDK_ASSETS, url.pathname);
    if (Object.hasOwn(ASSETS, url.pathname) || sdkAsset) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      const [filename, type] = sdkAsset ? SDK_ASSETS[url.pathname] : ASSETS[url.pathname];
      const directory = filename === 'init.json' ? '../platform/panasonic/' : '../web/viera/';
      let body = readFileSync(new URL(directory + filename, import.meta.url));
      if (sdkAsset && filename === 'index.html') {
        let html = body.toString('utf8');
        for (const resource of ['style.css', 'api.js', 'client.js']) html = html.replace('/viera/' + resource, './' + resource);
        body = Buffer.from(html);
      }
      if (sdkAsset) record({ type: 'sdk_asset', asset: url.pathname, method: req.method,
        source: req.socket.remoteAddress, from_tv: req.socket.remoteAddress === tv,
        sha256: createHash('sha256').update(body).digest('hex') });
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    if (url.pathname === '/viera/session') {
      if (req.method !== 'GET') { res.writeHead(405).end(); return; }
      const key = randomBytes(16).toString('hex');
      if (clientSessions.size > 128) clientSessions.clear();
      clientSessions.set(key, { source: req.socket.remoteAddress, expires: Date.now() + 7200000, seen: new Set() });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ key }));
      return;
    }
    if (url.pathname === '/viera/event') {
      const session = clientSessions.get(url.searchParams.get('key'));
      const event = url.searchParams.get('event');
      if (req.method !== 'GET' || !session || session.source !== req.socket.remoteAddress || session.expires < Date.now() ||
          !['client_ready', 'login_ok', 'library_ok', 'remote_key', 'play_started', 'play_error'].includes(event)) {
        res.writeHead(400).end(); return;
      }
      const details = {};
      for (const format of ['hls', 'mp4']) {
        const value = url.searchParams.get(format);
        if (['no', 'maybe', 'probably', 'unknown'].includes(value)) details[format + '_support'] = value;
      }
      const mode = url.searchParams.get('mode');
      if (['hls', 'mp4'].includes(mode)) details.mode = mode;
      const mbps = Number(url.searchParams.get('mbps'));
      if ([1, 2, 4, 6, 8, 12].includes(mbps)) details.target_mbps = mbps;
      const audio = Number(url.searchParams.get('audio'));
      if (url.searchParams.has('audio') && Number.isInteger(audio) && audio >= -1 && audio <= 999) details.audio_stream_index = audio;
      const mediaError = Number(url.searchParams.get('mediaError'));
      if ([1, 2, 3, 4].includes(mediaError)) details.media_error = mediaError;
      const attempt = Number(url.searchParams.get('attempt'));
      if (url.searchParams.has('attempt') && Number.isInteger(attempt) && attempt >= 0 && attempt < 100000) details.attempt = attempt;
      const eventKey = event.startsWith('play_') && details.attempt !== undefined ? event + ':' + details.attempt : event;
      if (!session.seen.has(eventKey)) {
        session.seen.add(eventKey);
        record({ type: 'client_milestone', event, source: req.socket.remoteAddress, from_tv: req.socket.remoteAddress === tv, ...details });
      }
      res.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    if (!testLogin && (url.pathname.startsWith('/viera/') || url.pathname.startsWith('/sdkhtml/'))) { res.writeHead(404).end(); return; }
    if (url.pathname === '/tv' || url.pathname === '/tv/') {
      if (req.method !== 'GET') { res.writeHead(405).end(); return; }
      const nonce = randomBytes(16).toString('hex');
      if (tokens.size > 128) tokens.clear();
      tokens.set(nonce.split('').reverse().join(''), { source: req.socket.remoteAddress, expires: Date.now()+300000 });
      const page = Buffer.from(probePage(nonce));
      record({ type: 'probe_page', source: req.socket.remoteAddress });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': page.length });
      res.end(page);
      return;
    }
    if (url.pathname === '/tv/report') {
      const proof = url.searchParams.get('proof');
      const token = tokens.get(proof);
      if (req.method !== 'GET' || !token || token.source !== req.socket.remoteAddress || token.expires < Date.now()) {
        res.writeHead(400).end(); return;
      }
      tokens.delete(proof);
      const version = url.searchParams.get('version') || '';
      record({ type: 'browser_api_result', source: req.socket.remoteAddress,
        from_tv: req.socket.remoteAddress === tv, success: url.searchParams.get('ok') === '1',
        version: /^[0-9A-Za-z.+-]{1,40}$/.test(version) ? version : null });
      res.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    const options = requestOptions(req);
    let loginBody;
    if (testLogin) {
      loginBody = JSON.stringify({ Username: testAccount.Username, Pw: testAccount.Pw });
      options.path = '/Users/AuthenticateByName';
      options.headers['content-type'] = 'application/json';
      options.headers['content-length'] = Buffer.byteLength(loginBody);
    }
    const remote = http.request(options, response => {
      const headers = headersWithoutHop(response.headers);
      if (testLogin) headers['cache-control'] = 'no-store';
      // Keep redirects back through this proxy without trusting external redirect hosts.
      if (headers.location?.startsWith(target.origin + '/')) headers.location = headers.location.slice(target.origin.length);
      if (url.pathname === '/System/Info/Public') {
        record({ type: 'public_info', source: req.socket.remoteAddress, status: response.statusCode });
      }
      res.writeHead(response.statusCode, headers);
      response.on('error', () => res.destroy());
      response.pipe(res); // streaming/backpressure; preserves Range and Content-Range
    });
    remote.setTimeout(60000, () => remote.destroy(new Error('Upstream idle timeout')));
    remote.on('error', () => {
      record({ type: 'upstream_error', source: req.socket.remoteAddress });
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' }).end('Jellyfin upstream unavailable');
      else res.destroy();
    });
    req.on('aborted', () => remote.destroy());
    res.on('close', () => { if (!res.writableFinished) remote.destroy(); });
    if (testLogin) { req.resume(); remote.end(loginBody); }
    else req.pipe(remote);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket, head) => {
    if (!permitted(req) || !req.url.startsWith('/') || req.url.startsWith('//') || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    const options = requestOptions(req);
    options.headers.connection = 'Upgrade';
    options.headers.upgrade = 'websocket';
    const remote = http.request(options);
    remote.setTimeout(15000, () => remote.destroy());
    remote.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      remote.setTimeout(0);
      const headers = headersWithoutHop(response.headers);
      headers.connection = 'Upgrade'; headers.upgrade = 'websocket';
      socket.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.entries(headers).map(([k,v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
      if (head.length) upstreamSocket.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      upstreamSocket.on('error', () => socket.destroy());
      socket.on('error', () => upstreamSocket.destroy());
      socket.on('close', () => upstreamSocket.destroy());
      upstreamSocket.on('close', () => socket.destroy());
      socket.pipe(upstreamSocket).pipe(socket);
    });
    remote.on('response', response => { response.resume(); socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); });
    remote.on('error', () => socket.destroy());
    socket.on('close', () => remote.destroy());
    remote.end();
  });
  server.stop = () => { for (const socket of sockets) socket.destroy(); server.close(); };
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const usage = 'Usage: node tools/jellyfin_proxy.mjs [--config config/local.json] [--output work/new-run]\nLegacy: node tools/jellyfin_proxy.mjs <LAN IPv4 override> <new work/output-directory>';
  if (args.includes('--help')) { console.log(usage); process.exit(0); }
  let configPath = process.env.VIERA_CONFIG || 'config/local.json', directory, bindOverride;
  if (args.length && !args[0].startsWith('--')) {
    if (args.length !== 2) throw new Error(usage);
    [bindOverride, directory] = args;
  } else {
    for (let i = 0; i < args.length; i += 2) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(usage);
      if (args[i] === '--config') configPath = args[i + 1];
      else if (args[i] === '--output') directory = args[i + 1];
      else throw new Error(usage);
    }
  }
  const settings = loadConfig(configPath);
  if (bindOverride) settings.bind = bindOverride;
  validateConfig(settings);
  const { bind, port, tv, upstream, testAccount } = settings;
  directory ||= `work/proxy-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  mkdirSync(resolve('work'), { recursive: true });
  const output = resolve(directory);
  const rel = relative(resolve('work'), output);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Output must be below work/');
  mkdirSync(output, { mode: 0o700 });
  // Persist routing metadata only. Account credentials stay in ignored local configuration.
  const config = { bind, port, upstream, tv, pid: process.pid, autoLoginConfigured: testAccount !== null };
  const record = event => appendFileSync(resolve(output, 'events.jsonl'), JSON.stringify({ time_utc: new Date().toISOString(), ...event })+'\n', { mode: 0o600 });
  const server = createProxy({ ...config, testAccount, allowed: [bind, tv], record });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(config.port, bind, () => {
    writeFileSync(resolve(output, 'config.json'), JSON.stringify(config,null,2)+'\n', { mode: 0o600 });
    record({ type: 'started' });
    console.log(`Panasonic HTML5 entry: http://${bind}:${config.port}/sdkhtml/main.html\nOwn client: http://${bind}:${config.port}/viera\nTV test: http://${bind}:${config.port}/tv\nJellyfin: http://${bind}:${config.port}/web/`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { record({ type: 'stopped' }); server.stop(); });
}

import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import { createProxy } from './jellyfin_proxy.mjs';

function request(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, ...options }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

test('proxy: bodies/auth, ranges, redirects, probe nonce and WebSocket streaming', { timeout: 10000 }, async () => {
  const events = [];
  const upstream = http.createServer((req, res) => {
    if (req.url === '/range') {
      assert.equal(req.headers.range, 'bytes=2-5');
      res.writeHead(206, { 'Content-Range': 'bytes 2-5/10', 'Content-Length': 4, 'Accept-Ranges': 'bytes' }).end('2345');
    } else if (req.url === '/redirect') {
      res.writeHead(302, { Location: `http://127.0.0.1:${upstream.address().port}/web/` }).end();
    } else if (req.url === '/System/Info/Public') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ProductName: 'Jellyfin Server', Version: 'test' }));
    } else {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => res.end(JSON.stringify({ body, auth: req.headers.authorization,
        method: req.method, path: req.url, host: req.headers.host, removed: req.headers['x-remove'] })));
    }
  });
  upstream.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    if (head.length) socket.write(head);
    socket.pipe(socket);
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const proxy = createProxy({ upstream: `http://127.0.0.1:${upstream.address().port}`, allowed: ['127.0.0.1'],
    tv: '192.0.2.20', testAccount: { Username: 'fixture-user', Pw: 'fixture-only-password' }, record: e => events.push(e) });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  const port = proxy.address().port;
  try {
    const echoed = JSON.parse((await request(port, '/echo?value=1', { method: 'POST', body: 'example',
      headers: { Authorization: 'Test dummy', Connection: 'x-remove', 'X-Remove': 'drop' } })).body);
    assert.deepEqual(echoed, { body: 'example', auth: 'Test dummy', method: 'POST', path: '/echo?value=1', host: `127.0.0.1:${upstream.address().port}` });
    const ranged = await request(port, '/range', { headers: { Range: 'bytes=2-5' } });
    assert.equal(ranged.status, 206); assert.equal(ranged.body, '2345');
    assert.equal(ranged.headers['content-range'], 'bytes 2-5/10');
    assert.equal((await request(port, '/redirect')).headers.location, '/web/');
    assert.equal((await request(port, '//other-host/')).status, 400);
    assert.equal((await request(port, '/viera/test-login')).status, 405);
    const autoLogin = await request(port, '/viera/test-login', { method: 'POST', body: '{"Username":"ignored","Pw":"ignored"}',
      headers: { 'Content-Type': 'application/json', Authorization: 'MediaBrowser Client="test-client"' } });
    const autoEcho = JSON.parse(autoLogin.body);
    assert.equal(autoEcho.path, '/Users/AuthenticateByName');
    assert.deepEqual(JSON.parse(autoEcho.body), { Username: 'fixture-user', Pw: 'fixture-only-password' });
    assert.equal(autoEcho.auth, 'MediaBrowser Client="test-client"');
    assert.equal(autoLogin.headers['cache-control'], 'no-store');
    const client = await request(port, '/viera');
    assert.equal(client.status, 200);
    assert.match(client.body, /Viera Jellyfin/);
    assert.equal((await request(port, '/viera/api.js')).status, 200);
    assert.equal((await request(port, '/viera/private.txt')).status, 404);
    const sdk = await request(port, '/sdkhtml/main.html');
    assert.equal(sdk.status, 200);
    assert.match(sdk.body, /src="\.\/client.js"/);
    assert.match(sdk.body, /href="\.\/style.css"/);
    assert.doesNotMatch(sdk.body, /src="\/viera\//);
    const init = await request(port, '/sdkhtml/init.json');
    assert.equal(init.status, 200);
    assert.equal(JSON.parse(init.body).mode, 'key');
    assert.equal(JSON.parse(init.body).keyboard.use, true);
    assert.equal((await request(port, '/init.json')).body, init.body);
    assert.equal((await request(port, '/sdkhtml/client.js')).body, (await request(port, '/viera/client.js')).body);
    assert.equal((await request(port, '/client.js')).body, (await request(port, '/viera/client.js')).body);
    assert.equal((await request(port, '/sdkhtml/private.txt')).status, 404);
    assert.equal((await request(port, '/sdkhtml/main.html', { method: 'POST', body: 'must not reach upstream' })).status, 405);
    const head = await request(port, '/sdkhtml/main.html', { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(head.body, '');
    assert.equal(Number(head.headers['content-length']), Buffer.byteLength(sdk.body));
    assert.ok(events.some(e => e.type === 'sdk_asset' && e.asset === '/sdkhtml/init.json' && e.from_tv === false));
    const key = JSON.parse((await request(port, '/viera/session')).body).key;
    assert.equal((await request(port, `/viera/event?key=${key}&event=client_ready`)).status, 204);
    await request(port, `/viera/event?key=${key}&event=client_ready`);
    assert.equal(events.filter(e => e.type === 'client_milestone').length, 1);
    assert.equal(events.find(e => e.type === 'client_milestone').from_tv, false);
    assert.equal((await request(port, `/viera/event?key=${key}&event=arbitrary-secret`)).status, 400);
    assert.equal((await request(port, '/viera/event?key=wrong&event=client_ready')).status, 400);
    await request(port, `/viera/event?key=${key}&event=play_error&attempt=1&mode=hls&mbps=4&audio=2&mediaError=4&hls=no&mp4=probably&title=do-not-log`);
    await request(port, `/viera/event?key=${key}&event=play_error&attempt=2&mode=mp4&mbps=6&audio=0&mediaError=3`);
    const errors = events.filter(e => e.event === 'play_error');
    assert.equal(errors.length, 2);
    assert.equal(errors[0].target_mbps, 4); assert.equal(errors[0].audio_stream_index, 2);
    assert.equal(errors[0].hls_support, 'no'); assert.equal(errors[0].media_error, 4);
    assert.equal(errors[0].title, undefined); assert.equal(errors[1].audio_stream_index, 0);
    const html = (await request(port, '/tv')).body;
    const nonce = JSON.parse(html.match(/var nonce = ("[a-f0-9]+")/)[1]);
    assert.equal((await request(port, '/tv/report?proof=wrong')).status, 400);
    await request(port, '/System/Info/Public');
    const reportPath = `/tv/report?proof=${nonce.split('').reverse().join('')}&ok=1&version=test`;
    assert.equal((await request(port, reportPath)).status, 204);
    assert.equal((await request(port, reportPath)).status, 400); // one use only
    assert.equal(events.find(e => e.type === 'browser_api_result').from_tv, false);
    const socket = net.connect(port, '127.0.0.1');
    await once(socket, 'connect');
    try {
      socket.write('GET /socket HTTP/1.1\r\nHost: local\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
      const [handshake] = await once(socket, 'data');
      assert.match(handshake.toString(), /^HTTP\/1.1 101/);
      socket.write('opaque websocket frame');
      const [echo] = await once(socket, 'data');
      assert.equal(echo.toString(), 'opaque websocket frame');
    } finally { socket.destroy(); }
  } finally { proxy.stop(); upstream.close(); }
});

test('proxy rejects unapproved source IP', { timeout: 3000 }, async () => {
  const proxy = createProxy({ upstream: 'http://127.0.0.1:1', allowed: [], tv: '192.0.2.20' });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  try { assert.equal((await request(proxy.address().port, '/System/Info/Public')).status, 403); }
  finally { proxy.stop(); }
});

test('unavailable upstream produces 502', { timeout: 3000 }, async () => {
  const unused = net.createServer(); unused.listen(0, '127.0.0.1'); await once(unused, 'listening');
  const port = unused.address().port; unused.close(); await once(unused, 'close');
  const proxy = createProxy({ upstream: `http://127.0.0.1:${port}`, allowed: ['127.0.0.1'], tv: '192.0.2.20' });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  try { assert.equal((await request(proxy.address().port, '/System/Info/Public')).status, 502); }
  finally { proxy.stop(); }
});

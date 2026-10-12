#!/usr/bin/env node
// Read credentials as JSON from stdin; never write credentials/tokens/media IDs.
// Exercises the actual ES5 adapter through the running proxy, then logs out.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { proxyOrigin } from './proxy_config.mjs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';

const output = resolve(process.argv[2] || '');
const rel = relative(resolve('work'), output);
if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Provide a new work/output directory');
mkdirSync(output, { mode: 0o700 });
const origin = process.env.VIERA_ORIGIN || proxyOrigin();
const dom = new JSDOM('', { url: origin + '/viera', runScripts: 'outside-only' });
const report = { time_utc: new Date().toISOString(), source: 'Mac live API/byte-range check, not TV decoding', checks: [] };
const credentials = JSON.parse(readFileSync(0, 'utf8'));
const response = await fetch(origin + '/viera/api.js');
if (!response.ok) throw new Error('Adapter unavailable');
const source = await response.text();
report.adapter_sha256 = createHash('sha256').update(source).digest('hex');
dom.window.eval(source);
const api = new dom.window.VieraApi(dom.window.XMLHttpRequest, dom.window);
function call(method, ...args) {
  return new Promise((resolve, reject) => api[method](...args, (error, result) => error ? reject(new Error(error.message)) : resolve(result)));
}
function range(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(origin + url, { headers: { Range: 'bytes=0-1023' } }, res => {
      const chunks = []; let bytes = 0;
      res.on('data', b => {
        bytes += b.length;
        if (bytes > 65536) { res.destroy(); reject(new Error('Range was not honored')); return; }
        chunks.push(b);
      });
      res.on('end', () => resolve({ status: res.statusCode, bytes,
        content_type: res.headers['content-type'], content_range: res.headers['content-range'],
        sha256: createHash('sha256').update(Buffer.concat(chunks)).digest('hex') }));
      res.on('error', reject);
    });
    req.setTimeout(15000, () => req.destroy(new Error('Stream timeout')));
    req.on('error', reject);
  });
}
try {
  await call('login', credentials.username, credentials.password);
  credentials.username = ''; credentials.password = '';
  report.checks.push({ step: 'login', success: true });
  const views = await call('views');
  report.checks.push({ step: 'views', count: views.Items.length });
  const library = views.Items.find(item => item.CollectionType === 'movies');
  if (!library) throw new Error('No movie library for test');
  const listing = await call('items', library.Id, 0);
  report.checks.push({ step: 'movie_list', count: listing.Items.length, total: listing.TotalRecordCount });
  const second = await call('items', library.Id, 18);
  report.checks.push({ step: 'second_page', count: second.Items.length, different_first_item: second.Items[0]?.Id !== listing.Items[0]?.Id });
  const movie = listing.Items.find(item => item.Type === 'Movie');
  if (!movie) throw new Error('No movie on first page');
  const details = await call('item', movie.Id);
  const playback = await call('playbackInfo', movie.Id);
  report.checks.push({ step: 'details_and_playback_info', source_count: details.MediaSources.length,
    has_play_session: typeof playback.PlaySessionId === 'string' });
  const media = details.MediaSources.find(item => item.Container === 'mp4');
  if (!media) throw new Error('No MP4 source in sample');
  report.checks.push({ step: 'sample_format', container: media.Container,
    codecs: media.MediaStreams.filter(s => s.Type === 'Video' || s.Type === 'Audio').map(s => ({ type: s.Type, codec: s.Codec })) });
  const stream = await range(api.videoUrl(movie.Id, media.Id));
  report.checks.push({ step: 'stream_byte_range', ...stream });
  if (stream.status !== 206 || stream.bytes !== 1024) throw new Error('Unexpected stream range response');
  report.success = true;
} catch (error) {
  report.success = false; report.error = error.message;
  process.exitCode = 1;
} finally {
  // Await the actual logout XHR before closing the DOM; no session reports or play actions.
  const oldSend = dom.window.XMLHttpRequest.prototype.send;
  let logoutResolve;
  const finished = new Promise(resolve => { logoutResolve = resolve; });
  dom.window.XMLHttpRequest.prototype.send = function (body) {
    this.addEventListener('loadend', () => {
      report.checks.push({ step: 'diagnostic_logout', status: this.status }); logoutResolve();
    });
    return oldSend.call(this, body);
  };
  api.logout();
  let timer;
  await Promise.race([finished, new Promise(resolve => { timer = setTimeout(resolve, 22000); })]);
  clearTimeout(timer);
  dom.window.close();
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2)+'\n', { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}

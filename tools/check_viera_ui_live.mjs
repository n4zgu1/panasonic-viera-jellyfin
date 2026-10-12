#!/usr/bin/env node
// End-to-end UI/API check against the user-specified Jellyfin through the Mac proxy.
// Uses the owner's configured proxy test login; no credentials on stdin.
// No passwords/tokens/titles/IDs are written to reports.
import { mkdirSync, writeFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { proxyOrigin } from './proxy_config.mjs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
const origin = process.env.VIERA_ORIGIN || proxyOrigin();
const output = resolve(process.argv[2] || '');
const rel = relative(resolve('work'), output);
if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Provide a new work/output directory');
mkdirSync(output, { mode: 0o700 });
const report = { time_utc: new Date().toISOString(), source: 'Mac DOM with automatic test login and real proxy/API; video decoder mocked', checks: [] };
let dom, logoutStatus = null, cleanupStatus = null, failures = 0;
const consoleEvents = new VirtualConsole();
consoleEvents.on('jsdomError', () => { failures += 1; });
function waitFor(predicate, window, label) {
  return new Promise((resolve, reject) => {
    let timer;
    const observer = new window.MutationObserver(check);
    function check() {
      if (predicate()) { clearTimeout(timer); observer.disconnect(); resolve(); }
    }
    observer.observe(window.document, { subtree: true, attributes: true, childList: true, characterData: true });
    timer = setTimeout(() => { observer.disconnect(); reject(new Error('UI timeout: ' + label)); }, 25000);
    check();
  });
}
function range(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { Range: 'bytes=0-1023' } }, response => {
      let size = 0; const chunks = [];
      response.on('data', data => {
        size += data.length;
        if (size > 65536) { response.destroy(); reject(new Error('Range ignored')); return; }
        chunks.push(data);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, bytes: size,
        content_type: response.headers['content-type'], sha256: createHash('sha256').update(Buffer.concat(chunks)).digest('hex') }));
    });
    req.setTimeout(15000, () => req.destroy(new Error('Stream timeout'))); req.on('error', reject);
  });
}
try {
  dom = await JSDOM.fromURL(origin + '/viera', {
    runScripts: 'dangerously', resources: 'usable', virtualConsole: consoleEvents,
    beforeParse(window) {
      window.scrollTo = function () {};
      window.HTMLMediaElement.prototype.play = function () { this.playRequested = true; };
      window.HTMLMediaElement.prototype.pause = function () {};
      window.HTMLMediaElement.prototype.load = function () {};
      const open = window.XMLHttpRequest.prototype.open;
      window.XMLHttpRequest.prototype.open = function (method, path, async) {
        if (path === '/Sessions/Logout') this.addEventListener('loadend', () => { logoutStatus = this.status; });
        if (method === 'DELETE' && path.indexOf('/Videos/ActiveEncodings?') === 0) this.addEventListener('loadend', () => { cleanupStatus = this.status; });
        return open.call(this, method, path, async);
      };
    },
  });
  const w = dom.window, el = id => w.document.getElementById(id);
  await waitFor(() => el('items')?.querySelectorAll('button').length > 0, w, 'automatic login and authenticated views');
  report.checks.push({ step: 'automatic_login', success: true, typed_credentials: false,
    password_field_empty: el('password').value === '' });
  report.checks.push({ step: 'authenticated_views', count: el('items').querySelectorAll('button').length });
  el('items').querySelector('button').click();
  await waitFor(() => el('items').querySelectorAll('button').length === 18, w, 'movie library');
  report.checks.push({ step: 'movie_library', count: el('items').querySelectorAll('button').length });
  // Search within the selected library, using its first movie title in memory only.
  const query = el('items').querySelector('button').textContent.replace(/\s*\(\d{4}\).*$/, '').replace(/ \[gesehen\]/, '');
  el('search').value = query;
  el('search-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await waitFor(() => el('items').querySelectorAll('button').length > 0, w, 'search result');
  report.checks.push({ step: 'search', success: true, result_count: el('items').querySelectorAll('button').length });
  el('items').querySelector('button').click();
  await waitFor(() => el('details').className === '' && el('sources').querySelectorAll('button').length > 0, w, 'movie details');
  report.checks.push({ step: 'movie_details', playable_sources: el('sources').querySelectorAll('[data-action="play"]').length });
  // Last button is play-from-start, so no resume state is altered. Mock play emits no playing event.
  el('sources').querySelector('[data-action="play"]').click();
  await waitFor(() => el('player').className === '' && el('video').playRequested, w, 'playback preparation');
  const data = await range(el('video').src);
  report.checks.push({ step: 'prepared_hls_master', ...data });
  if (data.status !== 200 || !String(data.content_type).includes('mpegurl')) throw new Error('Unexpected HLS master result');
  el('stop').click();
  const cleanupDeadline = Date.now() + 22000;
  while (cleanupStatus === null && Date.now() < cleanupDeadline) await new Promise(resolve => setTimeout(resolve, 50));
  report.checks.push({ step: 'own_encoding_cleanup', status: cleanupStatus });
  if (cleanupStatus !== 204) throw new Error('Encoding cleanup not acknowledged');
  el('detail-back').click(); el('logout').click();
  report.checks.push({ step: 'logout_ui', login_visible: el('login').className === '', media_source_removed: !el('video').hasAttribute('src') });
  report.success = true;
} catch (error) {
  report.success = false; report.error = error.message; process.exitCode = 1;
} finally {
  if (dom) {
    if (dom.window.document.getElementById('player')?.className === '') {
      dom.window.document.getElementById('stop').click();
      const deadline=Date.now()+22000;
      while(cleanupStatus===null && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
      report.checks.push({ step:'failure_cleanup',status:cleanupStatus });
    }
    if (logoutStatus === null) dom.window.document.getElementById('logout')?.click();
    // Wait on the diagnostic logout only, not on any TV activity/background process.
    const until = Date.now() + 22000;
    while (logoutStatus === null && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
    report.checks.push({ step: 'diagnostic_logout', status: logoutStatus });
    report.browser_script_errors = failures;
    if (logoutStatus !== 204 || failures) { report.success = false; process.exitCode = 1; }
    dom.window.close();
  }
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2)+'\n', { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}

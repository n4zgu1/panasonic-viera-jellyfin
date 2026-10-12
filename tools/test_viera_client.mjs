import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as acorn from 'acorn';
const asset = name => readFileSync(new URL('../web/viera/' + name, import.meta.url), 'utf8');

function fixture({ automaticLogin = false } = {}) {
  const dom = new JSDOM(asset('index.html'), { url: 'http://127.0.0.1:8765/viera', runScripts: 'outside-only' });
  const { window: w } = dom;
  const requests = [];
  class FakeXHR {
    constructor() { this.headers = {}; this.readyState = 0; }
    open(method, path) { this.method = method; this.path = path; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send(body) { this.body = body; requests.push(this); }
    abort() { this.aborted = true; }
    respond(status, value) {
      this.status = status; this.readyState = 4; this.responseText = value === null ? '' : JSON.stringify(value);
      if (this.onreadystatechange) this.onreadystatechange();
    }
  }
  w.XMLHttpRequest = FakeXHR;
  w.scrollTo = (x, y) => { w.lastScroll = [x, y]; };
  w.HTMLMediaElement.prototype.play = function () { this.playCalled = true; };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.load = function () { this.currentTime = 0; };
  w.eval(asset('api.js')); w.eval(asset('client.js'));
  const el = id => w.document.getElementById(id);
  const find = path => requests.filter(r => r.path === path).at(-1);
  // Existing manual-login tests exercise the explicit fallback after one failed auto attempt.
  if (!automaticLogin) find('/viera/test-login').respond(401, {});
  function submit() { el('login-form').dispatchEvent(new w.Event('submit', { cancelable: true })); }
  function login() {
    el('username').value = 'test-user'; el('password').value = 'dummy-not-real'; submit();
    find('/Users/AuthenticateByName').respond(200, { AccessToken: 'dummy-token', User: { Id: 'user-1' } });
  }
  function prepared(session = 'play-session', mode = 'hls') {
    const pending = find('/Items/movie/PlaybackInfo');
    const data = JSON.parse(pending.body);
    pending.respond(200, { PlaySessionId: session, MediaSources: [{ Id: 'source', SupportsTranscoding: true,
      TranscodingUrl: mode === 'hls' ? '/videos/movie/master.m3u8?api_key=dummy-token' :
        '/Videos/movie/stream.mp4?StartTimeTicks=' + data.StartTimeTicks }] });
  }
  return { dom, w, requests, el, find, submit, login, prepared };
}

test('both browser scripts parse as ES5', () => {
  for (const name of ['api.js', 'client.js']) acorn.parse(asset(name), { ecmaVersion: 5 });
});

test('automatic test login needs no typed credentials and does not restart after logout', () => {
  const f = fixture({ automaticLogin: true });
  try {
    const login = f.find('/viera/test-login');
    assert.equal(login.method, 'POST'); assert.equal(login.body, null);
    assert.equal(f.el('username').value, ''); assert.equal(f.el('password').value, '');
    login.respond(200, { AccessToken: 'auto-token', User: { Id: 'auto-user' } });
    const views = f.find('/Users/auto-user/Views');
    assert.match(views.headers.Authorization, /Token="auto-token"/);
    views.respond(200, { Items: [{ Id: 'library', Name: 'Test library', IsFolder: true }] });
    assert.equal(f.el('browser').className, '');
    assert.equal(f.el('items').firstChild.textContent, 'Test library  >');
    f.el('logout').click();
    assert.equal(f.el('login').className, '');
    assert.equal(f.requests.filter(r => r.path === '/viera/test-login').length, 1);
  } finally { f.dom.window.close(); }
});

test('failed automatic login is bounded and can be retried with one button', () => {
  const f = fixture({ automaticLogin: true });
  try {
    f.find('/viera/test-login').respond(502, {});
    assert.equal(f.el('test-login').disabled, false);
    assert.equal(f.el('login-button').disabled, false);
    assert.match(f.el('status').textContent, /HTTP 502/);
    assert.equal(f.requests.filter(r => r.path === '/viera/test-login').length, 1);
    f.el('test-login').click();
    assert.equal(f.requests.filter(r => r.path === '/viera/test-login').length, 2);
  } finally { f.dom.window.close(); }
});

test('login, library traversal, literal item text, negotiated playback and logout', () => {
  const f = fixture();
  try {
    f.find('/viera/session').respond(200, { key: 'local-test-key' });
    f.login();
    const auth = f.find('/Users/AuthenticateByName');
    assert.deepEqual(JSON.parse(auth.body), { Username: 'test-user', Pw: 'dummy-not-real' });
    assert.equal(auth.headers['X-Emby-Token'], undefined);
    assert.doesNotMatch(auth.headers.Authorization, /Token=/);
    assert.equal(f.el('password').value, '');
    const views = f.find('/Users/user-1/Views');
    assert.match(views.headers.Authorization, /Token="dummy-token"/);
    assert.equal(views.headers['X-Emby-Token'], undefined);
    views.respond(200, { Items: [{ Id: 'library', Name: 'Movies <img src=x>', IsFolder: true }] });
    assert.equal(f.el('items').querySelectorAll('img').length, 0);
    assert.match(f.el('items').textContent, /<img src=x>/);
    assert.equal(f.w.document.activeElement, f.el('items').querySelector('button'));
    f.el('items').querySelector('button').click();
    const items = f.requests.at(-1);
    assert.match(items.path, /ParentId=library.*StartIndex=0/);
    items.respond(200, { Items: [{ Id: 'movie', Name: 'Example', Type: 'Movie' }], TotalRecordCount: 1 });
    f.el('items').querySelector('button').click();
    f.find('/Users/user-1/Items/movie').respond(200, { Id: 'movie', Name: 'Example', MediaType: 'Video',
      Overview: '<script>untrusted()</script>', MediaSources: [{ Id: 'source', Container: 'mp4',
        MediaStreams: [{ Type: 'Video', Codec: 'h264' }, { Type: 'Audio', Codec: 'aac' }] }] });
    assert.equal(f.el('overview').querySelectorAll('script').length, 0);
    f.el('sources').querySelector('[data-action="play"]').click();
    f.prepared();
    assert.equal(f.el('player').className, '');
    assert.match(f.el('video').src, /\/videos\/movie\/master.m3u8\?ApiKey=dummy-token$/);
    assert.deepEqual(f.w.lastScroll, [0, 0]);
    assert.equal(f.el('video').playCalled, true);
    f.el('video').dispatchEvent(new f.w.Event('playing'));
    const playing = f.find('/Sessions/Playing');
    assert.equal(JSON.parse(playing.body).PlaySessionId, 'play-session');
    assert.equal(JSON.parse(playing.body).PlayMethod, 'Transcode');
    playing.respond(204, null);
    f.el('stop').click();
    assert.ok(f.find('/Sessions/Playing/Stopped'));
    assert.ok(f.requests.some(r => r.method === 'DELETE' && r.path.includes('PlaySessionId=play-session')));
    assert.equal(f.el('video').hasAttribute('src'), false);
    f.el('detail-back').click();
    f.el('logout').click();
    assert.ok(f.find('/Sessions/Logout'));
    assert.equal(f.el('login').className, '');
    assert.equal(f.w.localStorage.length, 0);
    assert.equal(f.w.sessionStorage.length, 0);
    assert.equal(f.w.document.cookie, '');
    // A late library response must not undo logout.
    items.respond(200, { Items: [{ Id: 'late', Name: 'Late' }] });
    assert.equal(f.el('login').className, '');
    assert.equal(f.el('items').textContent, '');
  } finally { f.dom.window.close(); }
});

test('failed login stays retryable and clears password; arrows move focus', () => {
  const f = fixture();
  try {
    f.el('username').value = 'user'; f.el('password').value = 'bad'; f.submit();
    f.find('/Users/AuthenticateByName').respond(401, { Message: 'Do not reflect server details' });
    assert.match(f.el('status').textContent, /Anmeldung abgelehnt/);
    assert.equal(f.el('login-button').disabled, false);
    assert.equal(f.el('password').value, '');
    assert.equal(f.el('login').className, '');
    f.el('password').dispatchEvent(new f.w.KeyboardEvent('keydown', { keyCode: 40, bubbles: true, cancelable: true }));
    assert.equal(f.w.document.activeElement.id, 'login-button');
    // Left/right/backspace in a text field are reserved for text editing.
    f.el('password').focus();
    const event = new f.w.KeyboardEvent('keydown', { keyCode: 8, bubbles: true, cancelable: true });
    f.el('password').dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  } finally { f.dom.window.close(); }
});

test('old page responses cannot overwrite a later home navigation', () => {
  const f = fixture();
  try {
    f.login(); f.find('/Users/user-1/Views').respond(200, { Items: [{ Id: 'library', Name: 'Library', IsFolder: true }] });
    f.el('items').firstChild.click(); const old = f.requests.at(-1);
    f.el('home').click(); const current = f.requests.at(-1);
    current.respond(200, { Items: [{ Id: 'new', Name: 'Current library', IsFolder: true }] });
    old.respond(200, { Items: [{ Id: 'stale', Name: 'Stale movie' }] });
    assert.match(f.el('items').textContent, /Current library/);
    assert.doesNotMatch(f.el('items').textContent, /Stale/);
  } finally { f.dom.window.close(); }
});

test('search is encoded, recursive and preserves header-token authentication', () => {
  const f = fixture();
  try {
    f.login(); f.find('/Users/user-1/Views').respond(200, { Items: [] });
    f.el('search').value = 'Film & Serie';
    f.el('search-form').dispatchEvent(new f.w.Event('submit', { cancelable: true }));
    const search = f.requests.at(-1);
    assert.match(search.path, /Recursive=true&SearchTerm=Film%20%26%20Serie/);
    assert.doesNotMatch(search.path, /ParentId=/);
    assert.match(search.headers.Authorization, /Token="dummy-token"/);
    search.respond(200, { Items: [{ Id: 'result', Name: 'Search result', Type: 'Movie' }], TotalRecordCount: 1 });
    assert.match(f.el('items').textContent, /Search result/);
  } finally { f.dom.window.close(); }
});

test('expired authenticated session returns to login, not an empty library', () => {
  const f = fixture();
  try {
    f.login(); f.find('/Users/user-1/Views').respond(401, {});
    assert.equal(f.el('login').className, '');
    assert.equal(f.el('browser').className, 'hidden');
    assert.match(f.el('status').textContent, /Sitzung abgelaufen/);
    assert.equal(f.el('password').value, '');
  } finally { f.dom.window.close(); }
});

test('resume waits for metadata and only real playing events cause session reports', () => {
  const f = fixture();
  try {
    f.login(); f.find('/Users/user-1/Views').respond(200, { Items: [{ Id: 'movie', Name: 'Movie', Type: 'Movie' }] });
    f.el('items').firstChild.click();
    f.find('/Users/user-1/Items/movie').respond(200, { Id: 'movie', Name: 'Movie', MediaType: 'Video',
      UserData: { PlaybackPositionTicks: 650000000 }, MediaSources: [{ Id: 'source', Container: 'mp4', MediaStreams: [] }] });
    assert.match(f.el('sources').querySelector('[data-action="resume"]').textContent, /Fortsetzen bei 1:05/);
    f.el('sources').querySelector('[data-action="resume"]').click();
    assert.equal(JSON.parse(f.find('/Items/movie/PlaybackInfo').body).StartTimeTicks, 0);
    f.prepared('resume-session');
    assert.equal(f.find('/Sessions/Playing'), undefined);
    f.el('video').dispatchEvent(new f.w.Event('loadedmetadata'));
    assert.equal(f.el('video').currentTime, 65);
    f.el('video').dispatchEvent(new f.w.Event('playing'));
    assert.equal(JSON.parse(f.find('/Sessions/Playing').body).PositionTicks, 650000000);
    f.el('video').currentTime = 80;
    f.el('stop').click();
    assert.equal(JSON.parse(f.find('/Sessions/Playing/Stopped').body).PositionTicks, 800000000);
  } finally { f.dom.window.close(); }
});

function openMovie(f, source, userData = {}) {
  f.login(); f.find('/Users/user-1/Views').respond(200, { Items: [{ Id: 'movie', Name: 'Movie', Type: 'Movie' }] });
  f.el('items').firstChild.click();
  f.find('/Users/user-1/Items/movie').respond(200, { Id: 'movie', Name: 'Movie', MediaType: 'Video',
    UserData: userData, MediaSources: [source] });
}

test('remote-friendly audio and Mbps choices drive real stream indices and transcoding limits', () => {
  const f = fixture();
  try {
    openMovie(f, { Id: 'source', Container: 'mkv', Bitrate: 71433151, DefaultAudioStreamIndex: 0, MediaStreams: [
      { Type: 'Video', Index: 3, Codec: 'hevc', Width: 3840, Height: 2160 },
      { Type: 'Audio', Index: 0, Language: 'eng', Codec: 'truehd', Channels: 8 },
      { Type: 'Audio', Index: 7, Language: 'deu', Codec: 'ac3', Channels: 6 }
    ] });
    assert.match(f.el('sources').textContent, /71\.4 Mbit\/s/);
    const audio = f.el('sources').querySelector('[data-option="audio"]');
    assert.match(audio.textContent, /Deutsch/);
    audio.click(); assert.match(audio.textContent, /Englisch/);
    f.el('sources').querySelector('[data-option="bitrate"]').click();
    assert.match(f.el('sources').querySelector('[data-option="bitrate"]').textContent, /6 Mbit\/s/);
    f.el('sources').querySelector('[data-option="mode"]').click();
    f.el('sources').querySelector('[data-action="play"]').click();
    const req = f.find('/Items/movie/PlaybackInfo');
    assert.equal(req.method, 'POST');
    const p = JSON.parse(req.body);
    assert.equal(p.AudioStreamIndex, 0); // must not accidentally fall back on track zero
    assert.equal(p.MaxStreamingBitrate, 6000000);
    assert.equal(p.MaxAudioChannels, 2); assert.equal(p.SubtitleStreamIndex, -1);
    assert.equal(p.EnableDirectPlay, false); assert.equal(p.AllowVideoStreamCopy, false);
    assert.equal(p.AllowAudioStreamCopy, false);
    assert.equal(p.DeviceProfile.TranscodingProfiles[0].Protocol, 'http');
    assert.equal(p.DeviceProfile.TranscodingProfiles[0].Container, 'mp4');
    assert.equal(p.DeviceProfile.TranscodingProfiles[0].VideoCodec, 'h264');
    assert.ok(p.DeviceProfile.CodecProfiles[0].Conditions.some(c => c.Property === 'VideoBitDepth' && c.Value === '8'));
    f.prepared('selected-session', 'mp4');
    assert.match(f.el('playback-quality').textContent, /Englisch.*6 Mbit\/s.*MP4/);
    assert.doesNotMatch(f.el('video').src, /Static=true/);
  } finally { f.dom.window.close(); }
});

test('unsupported transcode response leaves settings visible and does not play raw HEVC', () => {
  const f = fixture();
  try {
    openMovie(f, { Id: 'source', Container: 'mkv', MediaStreams: [] });
    f.el('sources').querySelector('[data-action="play"]').click();
    f.find('/Items/movie/PlaybackInfo').respond(200, { PlaySessionId: 'none', MediaSources: [{ Id: 'source', SupportsTranscoding: false }] });
    assert.match(f.el('status').textContent, /keinen passenden H.264\/AAC/);
    assert.equal(f.el('details').className, '');
    assert.equal(f.el('video').playCalled, undefined);
  } finally { f.dom.window.close(); }
});

test('MP4 resume and server-side seeking report absolute movie position exactly once', () => {
  const f = fixture();
  try {
    openMovie(f, { Id: 'source', Container: 'mkv', RunTimeTicks: 100000000000, MediaStreams: [] }, { PlaybackPositionTicks: 650000000 });
    f.el('sources').querySelector('[data-option="mode"]').click();
    f.el('sources').querySelector('[data-action="resume"]').click();
    assert.equal(JSON.parse(f.find('/Items/movie/PlaybackInfo').body).StartTimeTicks, 650000000);
    f.prepared('mp4-resume', 'mp4');
    f.el('video').dispatchEvent(new f.w.Event('loadedmetadata'));
    assert.equal(f.el('video').currentTime, 0); // no double offset via client seeking
    f.el('video').currentTime = 10;
    f.el('video').dispatchEvent(new f.w.Event('playing'));
    assert.equal(JSON.parse(f.find('/Sessions/Playing').body).PositionTicks, 750000000);
    f.el('forward').click();
    assert.equal(JSON.parse(f.find('/Items/movie/PlaybackInfo').body).StartTimeTicks, 1050000000);
    assert.ok(f.requests.some(r => r.method === 'DELETE' && r.path.includes('PlaySessionId=mp4-resume')));
  } finally { f.dom.window.close(); }
});

test('media failure stops only its encoding job and does not loop or double-stop it', () => {
  const f = fixture();
  try {
    openMovie(f, { Id: 'source', Container: 'mkv', MediaStreams: [] });
    f.el('sources').querySelector('[data-action="play"]').click(); f.prepared('failed-session');
    Object.defineProperty(f.el('video'), 'error', { value: { code: 4 }, configurable: true });
    f.el('video').dispatchEvent(new f.w.Event('error'));
    assert.match(f.el('status').textContent, /MediaError 4 bei HLS/);
    assert.equal(f.find('/Sessions/Playing'), undefined);
    f.el('stop').click();
    assert.equal(f.requests.filter(r => r.method === 'DELETE' && r.path.includes('PlaySessionId=failed-session')).length, 1);
  } finally { f.dom.window.close(); }
});

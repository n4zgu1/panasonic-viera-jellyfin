#!/usr/bin/env node
// Controlled real-server test: negotiate Matrix Reloaded, read one short HLS
// segment, inspect it locally, and stop only our own encoding sessions.
// Never writes tokens, media IDs, full URLs or raw manifests to reports.
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { JSDOM } from 'jsdom';
import { proxyOrigin } from './proxy_config.mjs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const out = resolve(process.argv[2] || '');
const rel = relative(resolve('work'), out);
if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Use a new work/output directory');
mkdirSync(out, { mode: 0o700 });
const origin = process.env.VIERA_ORIGIN || proxyOrigin();
const dom = new JSDOM('', { url: origin + '/viera', runScripts: 'outside-only' });
const code = readFileSync(new URL('../web/viera/api.js', import.meta.url), 'utf8');
dom.window.eval(code);
const api = new dom.window.VieraApi(dom.window.XMLHttpRequest, dom.window);
const sessions = new Set();
const mp4Only = process.argv[3] === '--mp4-prefix';
const report = { time_utc: new Date().toISOString(), source: 'Mac real-server negotiation and media sample; no TV decoder',
  target: 'User-specified Matrix Reloaded', adapter_sha256: createHash('sha256').update(code).digest('hex'), checks: [], cleanup: [] };
const call = (method, ...args) => new Promise((resolve, reject) => api[method](...args,
  (error, result) => error ? reject(new Error(error.message)) : resolve(result)));

function readUrl(value, limit = 2097152) {
  const url = new URL(value, origin);
  if (url.origin !== origin) throw new Error('Unexpected external stream address');
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { Connection: 'close' } }, res => {
      const chunks = []; let size = 0;
      res.on('data', b => { size += b.length; if (size > limit) { res.destroy(); reject(new Error('Response exceeds sample limit')); } else chunks.push(b); });
      res.on('error', () => reject(new Error('Media response interrupted')));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks) }));
    });
    req.setTimeout(90000, () => req.destroy(new Error('Media request timeout')));
    req.on('error', () => reject(new Error('Media transport error or timeout')));
  });
}
function firstUri(body, base) {
  const line = body.toString().split(/\r?\n/).map(s => s.trim()).find(s => s && s[0] !== '#');
  if (!line) throw new Error('Playlist contains no media URI');
  const result = new URL(line, new URL(base, origin));
  if (result.origin !== origin) throw new Error('Playlist references a different origin');
  return result.href;
}
function readMp4Prefix(value) {
  const url = new URL(value, origin);
  if (url.origin !== origin) throw new Error('Unexpected external stream address');
  return new Promise((resolve, reject) => {
    let finished = false;
    const req = http.get(url, { headers: { Connection: 'close' } }, res => {
      const chunks = []; let size = 0;
      function complete() {
        if (finished) return;
        finished = true;
        resolve({ status:res.statusCode,type:res.headers['content-type'],body:Buffer.concat(chunks) });
        res.destroy(); req.destroy();
      }
      res.on('data',b=>{ const part=b.subarray(0,262144-size); chunks.push(part); size+=part.length; if(size>=262144)complete(); });
      res.on('end',complete);
      res.on('error',()=>{if(!finished)reject(new Error('MP4 prefix interrupted'));});
    });
    req.setTimeout(90000,()=>req.destroy());
    req.on('error',()=>{if(!finished)reject(new Error('MP4 transport error'));});
  });
}
function negotiated(url) {
  const query = new URL(url, origin).searchParams;
  const allowed = ['VideoCodec','AudioCodec','AudioStreamIndex','VideoBitrate','AudioBitrate','MaxWidth','MaxHeight',
    'AudioSampleRate','TranscodingMaxAudioChannels','SegmentContainer','StartTimeTicks','h264-profile','h264-level',
    'h264-videobitdepth','h264-rangetype','allowVideoStreamCopy','allowAudioStreamCopy'];
  return Object.fromEntries(allowed.filter(k => query.has(k)).map(k => [k,query.get(k)]));
}

try {
  await call('loginTest');
  const list = await new Promise((resolve,reject) => api.items('',0,(e,d) => e ? reject(new Error(e.message)) : resolve(d),'Matrix Reloaded'));
  if (list.Items.length !== 1) throw new Error('Expected one matching movie');
  const item = await call('item', list.Items[0].Id);
  const source = item.MediaSources[0];
  const streams = source.MediaStreams;
  const german = streams.find(s => s.Type === 'Audio' && ['de','deu','ger'].includes(s.Language));
  const english = streams.find(s => s.Type === 'Audio' && ['en','eng'].includes(s.Language));
  if (!german || !english) throw new Error('Expected German and English test tracks');
  report.source_media = { container: source.Container, bitrate: source.Bitrate,
    video: streams.filter(s => s.Type === 'Video').map(s => ({ codec:s.Codec,profile:s.Profile,width:s.Width,height:s.Height,bit_depth:s.BitDepth,range:s.VideoRangeType })),
    audio: streams.filter(s => s.Type === 'Audio').map(s => ({ index:s.Index,language:s.Language,codec:s.Codec,channels:s.Channels })) };
  const cases = [
    { mode:'hls',mbps:4,audioStreamIndex:german.Index,startTicks:0,language:'de' },
    { mode:'hls',mbps:2,audioStreamIndex:english.Index,startTicks:0,language:'en' },
    { mode:'mp4',mbps:4,audioStreamIndex:german.Index,startTicks:650000000,language:'de' }
  ];
  let selected;
  for (const settings of cases.filter(s => !mp4Only || s.mode === 'mp4')) {
    const playback = await call('preparePlayback',item.Id,{...settings,sourceId:source.Id});
    sessions.add(playback.playSessionId);
    const params = negotiated(playback.url);
    const row = { step:'negotiation',mode:settings.mode,target_mbps:settings.mbps,language:settings.language,
      requested_audio_index:settings.audioStreamIndex,params };
    report.checks.push(row);
    if (Number(params.AudioStreamIndex) !== settings.audioStreamIndex || params.VideoCodec !== 'h264' || params.AudioCodec !== 'aac') {
      throw new Error('Server did not honor selected codecs/audio stream');
    }
    if (Number(params.VideoBitrate)+Number(params.AudioBitrate) > settings.mbps*1000000) throw new Error('Negotiated bitrate exceeds limit');
    if (settings.mode === 'mp4' && Number(params.StartTimeTicks) !== settings.startTicks) throw new Error('MP4 resume offset missing');
    if (!selected) selected = playback;
  }
  // Test cleanup permission before starting any encoder, scoped to our own session.
  await call('stopEncoding',selected.playSessionId);
  report.checks.push({ step:'scoped_cleanup_available',success:true });
  let file;
  if (mp4Only) {
    const prefix=await readMp4Prefix(selected.url);
    report.checks.push({ step:'mp4_prefix',status:prefix.status,bytes:prefix.body.length,content_type:prefix.type,
      has_ftyp:prefix.body.subarray(4,8).toString()==='ftyp' });
    if(prefix.status!==200 || prefix.body.subarray(4,8).toString()!=='ftyp')throw new Error('MP4 output unavailable');
    file=resolve(out,'sample-prefix.mp4');writeFileSync(file,prefix.body,{mode:0o600});
  } else {
  const master = await readUrl(selected.url);
  report.checks.push({ step:'hls_master',status:master.status,content_type:master.type,
    is_m3u8:master.body.toString().startsWith('#EXTM3U') });
  if (master.status !== 200 || !master.body.toString().startsWith('#EXTM3U')) throw new Error('HLS master unavailable');
  const mediaUrl = firstUri(master.body, selected.url);
  const media = await readUrl(mediaUrl);
  const mediaText = media.body.toString();
  report.checks.push({ step:'hls_media_playlist',status:media.status,
    version:mediaText.match(/#EXT-X-VERSION:(\d+)/)?.[1] || null });
  if (media.status !== 200 || !mediaText.startsWith('#EXTM3U')) throw new Error('HLS media playlist unavailable');
  const segment = await readUrl(firstUri(media.body,mediaUrl),16*1024*1024);
  report.checks.push({ step:'hls_segment',status:segment.status,bytes:segment.body.length,content_type:segment.type,
    sha256:createHash('sha256').update(segment.body).digest('hex') });
  if (segment.status !== 200 || segment.body.length < 188) throw new Error('Transcoded segment unavailable');
  file = resolve(out,'sample.ts'); writeFileSync(file,segment.body,{mode:0o600});
  }
  const inspected = spawnSync('ffprobe',['-v','error','-show_entries',
    'stream=codec_name,codec_type,profile,width,height,pix_fmt,channels,sample_rate,color_transfer,color_primaries:stream_tags=language',
    '-of','json',file],{encoding:'utf8',timeout:20000});
  if (inspected.status !== 0) throw new Error('ffprobe could not inspect the sample');
  report.sample_is_truncated_prefix = mp4Only;
  report.ffprobe_warning_lines = inspected.stderr.trim() ? inspected.stderr.trim().split('\n').length : 0;
  const probe = JSON.parse(inspected.stdout);
  report.output_streams = probe.streams;
  const video = probe.streams.find(s=>s.codec_type==='video'), audio=probe.streams.find(s=>s.codec_type==='audio');
  if (!video || video.codec_name!=='h264' || video.width>1280 || video.height>720 || !audio || audio.codec_name!=='aac' || audio.channels!==2) {
    throw new Error('Encoded media does not match requested TV format');
  }
  report.success = true;
} catch (error) {
  report.success=false; report.error=error.message; process.exitCode=1;
} finally {
  for (const id of sessions) {
    try { await call('stopEncoding',id); report.cleanup.push({ scoped_session_stopped:true }); }
    catch (error) { report.cleanup.push({ scoped_session_stopped:false,error:error.message }); report.success=false; process.exitCode=1; }
  }
  let done;
  const logout = new Promise(resolve=>{done=resolve;});
  const send = dom.window.XMLHttpRequest.prototype.send;
  dom.window.XMLHttpRequest.prototype.send = function(body) {
    this.addEventListener('loadend',()=>{report.logout_status=this.status;done();}); return send.call(this,body);
  };
  api.logout();
  let timer; await Promise.race([logout,new Promise(resolve=>{timer=setTimeout(resolve,22000);})]); clearTimeout(timer);
  dom.window.close();
  if (report.logout_status !== 204) { report.success=false; process.exitCode=1; }
  writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(report,null,2));
}

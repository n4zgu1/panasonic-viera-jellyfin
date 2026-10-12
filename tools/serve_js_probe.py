#!/usr/bin/env python3
"""Serve an ES5-only transient JS probe to the single TV, for at most 30 min.

No TV control requests. No firmware/static directory serving. The callback
proves execution only when correlated with the TV source and visible display.
"""
import argparse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import secrets
import socket
import time
from urllib.parse import urlsplit, parse_qs

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--tv',choices=['192.168.178.63'],required=True)
    ap.add_argument('--port',type=int,default=8765)
    ap.add_argument('--output',type=Path,required=True)
    a = ap.parse_args()
    out = a.output.resolve()
    assert out.is_relative_to(Path('work').resolve())
    out.mkdir(parents=True,exist_ok=False,mode=0o700)
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as s:
        s.connect((a.tv,55000))  # Route selection only; no UDP payload sent.
        local = s.getsockname()[0]
    nonce = secrets.token_hex(16)
    html = ('''<!doctype html><html><head><meta charset="utf-8"><title>VIERA JS Probe</title>
<style>body{background:#182433;color:white;font:32px sans-serif;margin:50px}</style></head>
<body><h1>VIERA-Test</h1><p id="result">HTML geladen. JavaScript noch nicht bestaetigt.</p>
<p>Keine Installation. Zum Beenden den Browser schliessen.</p>
<script type="text/javascript">
(function () {
  var n = NONCE;
  var proof = n.split("").reverse().join("");
  document.getElementById("result").innerHTML = "JavaScript auf dem Fernseher ausgefuehrt!";
  window.vieraProbeImage = new Image();
  window.vieraProbeImage.src = "/executed?proof=" + encodeURIComponent(proof);
}());
</script></body></html>''').replace('NONCE',json.dumps(nonce)).encode()
    (out/'index.html').write_bytes(html)
    url = f'http://{local}:{a.port}/'
    config = dict(url=url,tv=a.tv,nonce=nonce,started_utc=datetime.now(timezone.utc).isoformat(),
                  duration_seconds=1800)
    (out/'config.json').write_text(json.dumps(config,indent=2)+'\n')
    done = False
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):
            pass
        def do_GET(self):
            nonlocal done
            if self.client_address[0] != a.tv:
                self.send_error(403)
                return
            parsed = urlsplit(self.path)
            valid = parsed.path == '/executed' and parse_qs(parsed.query).get('proof') == [nonce[::-1]]
            event = dict(time_utc=datetime.now(timezone.utc).isoformat(),source=self.client_address[0],
                         path=parsed.path,user_agent=self.headers.get('User-Agent',''),valid_js_callback=valid)
            with (out/'events.jsonl').open('a') as f:
                f.write(json.dumps(event)+'\n')
            if parsed.path == '/':
                body, status, mime = html,200,'text/html; charset=utf-8'
            elif valid:
                body,status,mime = b'',204,'text/plain'
                done = True
            else:
                body,status,mime = b'Not found',404,'text/plain'
            self.send_response(status)
            self.send_header('Content-Type',mime)
            self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    with HTTPServer((local,a.port),Handler) as server:
        server.timeout = 1
        print(url,flush=True)
        deadline = time.monotonic()+1800
        while not done and time.monotonic()<deadline:
            server.handle_request()
    result = dict(valid_tv_js_callback=done,ended_utc=datetime.now(timezone.utc).isoformat())
    (out/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result),flush=True)

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Archive public developer documentation as data; no external code execution.

No device identifiers, credentials or firmware are sent to these sources.
"""
import argparse
from datetime import datetime, timezone
from html.parser import HTMLParser
import hashlib
import json
from pathlib import Path
import socket
import urllib.error
import urllib.request

SOURCES = {
    'developer-experience': 'https://mattpilz.com/project-postmortem-panasonic-viera-connect/',
    'html5-guide-mirror': 'https://pdfcoffee.com/panasonic-iptv-apps-developers-html5-4-pdf-free.html',
    'submission-guide': 'https://beacon.support.brightcove.com/creating-your-apps/panasonic/submitting-to-panasonic.html',
    'panasonic-announcement': 'https://news.panasonic.com/global/press/data/en110706-3/en110706-3.pdf',
    'portal-dns': 'https://dns.google/resolve?name=developer.vieraconnect.com&type=A',
    'developer-portal': 'https://developer.vieraconnect.com/',
}

class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.parts = []
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style'):
            self.skip += 1
        if tag in ('p','br','div','li','h1','h2','h3','tr') and not self.skip:
            self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script','style'):
            self.skip = max(0,self.skip-1)
    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data.replace('\xa0',' '))

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('output',type=Path)
    a = ap.parse_args()
    out = a.output.resolve()
    assert out.is_relative_to(Path('work').resolve())
    out.mkdir(parents=True,exist_ok=False)
    rows = []
    for name,url in SOURCES.items():
        row = dict(name=name,url=url,time_utc=datetime.now(timezone.utc).isoformat())
        try:
            request = urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (documentation research)'})
            with urllib.request.urlopen(request,timeout=25) as response:
                raw = response.read(8*1024*1024+1)
                assert len(raw) <= 8*1024*1024
                content_type = response.headers.get_content_type()
                suffix = '.pdf' if content_type == 'application/pdf' else '.html' if 'html' in content_type else '.json'
                filename = name + suffix
                (out/filename).write_bytes(raw)
                row.update(status=response.status,final_url=response.url,bytes=len(raw),file=filename,
                           sha256=hashlib.sha256(raw).hexdigest())
                if suffix == '.html':
                    parser = Text(); parser.feed(raw.decode('utf-8','replace'))
                    text = '\n'.join(line.strip() for line in ''.join(parser.parts).splitlines() if line.strip())+'\n'
                    (out/(name+'.txt')).write_text(text)
                    row['text_sha256'] = hashlib.sha256(text.encode()).hexdigest()
        except (OSError,urllib.error.URLError) as error:
            row.update(error=type(error).__name__,detail=str(error))
        rows.append(row)
    try:
        addresses = sorted({x[4][0] for x in socket.getaddrinfo('developer.vieraconnect.com',443,type=socket.SOCK_STREAM)})
        dns = dict(addresses=addresses)
    except OSError as error:
        dns = dict(error=type(error).__name__,detail=str(error))
    report = dict(sources=rows,local_portal_dns=dns)
    (out/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__ == '__main__':
    main()

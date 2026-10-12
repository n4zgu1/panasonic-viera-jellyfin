#!/usr/bin/env python3
"""Archive selected public AJAX-CE/HTML5 documentation; no credentials or TV data.

Internet Archive responses are historical documents, not live service guarantees.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.request
from capture_installation_sources import Text

SOURCES = {
    'official-ajax-models-2016': 'https://web.archive.org/web/20161105093751id_/http://developer.vieraconnect.com:80/intro/development-guide/device-guidelines-old/ajax-ce',
    'official-html-models-2016': 'https://web.archive.org/web/20161105094226id_/http://developer.vieraconnect.com:80/intro/development-guide/device-guidelines-old/html5',
    'official-portal-2024': 'https://web.archive.org/web/20240302131507id_/https://developer.vieraconnect.com/',
    'official-setup-2011': 'https://web.archive.org/web/20111019134020id_/http://developer.vieraconnect.com:80/intro/development-guide/development-environment-setup',
    'official-support-archive': 'https://web.archive.org/web/20240301000000id_/https://developer.vieraconnect.com/developers/support',
    'official-v3-intro-2024': 'https://web.archive.org/web/20240417193927id_/https://developer.vieraconnect.com/html5-v3.0',
    'license-transfer': 'https://drive.google.com/uc?export=download&id=1w1r1CEx8NM1llo7s9yY9rQ-FFSeFx2p9',
    'ajax-experience-part1': 'https://mattpilz.com/project-postmortem-panasonic-viera-connect/',
    'ajax-experience-part2': 'https://mattpilz.com/project-postmortem-panasonic-viera-connect-part-2/',
    'stackoverflow-sdk-comparison': 'https://api.stackexchange.com/2.3/questions/15381214/answers?site=stackoverflow&filter=withbody',
}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    args = parser.parse_args()
    out = args.output.resolve()
    assert out.is_relative_to(Path('work').resolve())
    out.mkdir(parents=True,exist_ok=False)
    rows = []
    for name,url in SOURCES.items():
        row = dict(name=name,url=url,captured_utc=datetime.now(timezone.utc).isoformat())
        try:
            request = urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
            with urllib.request.urlopen(request,timeout=40) as response:
                raw = response.read(8*1024*1024+1)
                assert len(raw) <= 8*1024*1024
                content_type = response.headers.get_content_type()
                suffix = '.pdf' if raw.startswith(b'%PDF') else '.html' if 'html' in content_type else '.json'
                filename = name+suffix
                (out/filename).write_bytes(raw)
                row.update(status=response.status,final_url=response.url,file=filename,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
                if suffix == '.html':
                    parser = Text(); parser.feed(raw.decode('utf-8','replace'))
                    text = '\n'.join(line.strip() for line in ''.join(parser.parts).splitlines() if line.strip())+'\n'
                    (out/(name+'.txt')).write_text(text)
                    row['text_sha256'] = hashlib.sha256(text.encode()).hexdigest()
        except (OSError,urllib.error.URLError) as error:
            row.update(error=type(error).__name__,detail=str(error))
        rows.append(row)
    (out/'manifest.json').write_text(json.dumps(rows,indent=2)+'\n')
    print(json.dumps(rows,indent=2))

if __name__ == '__main__':
    main()

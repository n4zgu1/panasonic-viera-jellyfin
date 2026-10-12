#!/usr/bin/env python3
"""Capture static source evidence for the built-in bookmark-to-home-tile path.

Reads extracted firmware only; never invokes its UI or storage methods.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path('work/filesystems/fma5/local')
SOURCES = {
    'application/home/startup_settings.js': [(324,362),(1688,1703),(1759,1808),(1809,1840)],
    'application/home/lang/lang_de.js': [(35,48)],
    'application/home/util.js': [(1,8)],
    'application/0387878700140052/Info.plist': [(1,15),(67,72)],
    'application/0387878700140052/gadget/gadget.js': [(101,127),(176,208)],
    'application/0077777700140002/gadget/configure.js': [(33,41)],
    'application/0077777700140002/gadget/lang/pkg_lang_platinum_de-DE.js': [(110,119),(140,153)],
    'emanual/de/01_010_030.html': [(80,83)],
}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    args = parser.parse_args()
    out = args.output.resolve()
    assert out.is_relative_to(Path('work').resolve())
    out.mkdir(parents=True,exist_ok=False)
    rows = []
    for name,ranges in SOURCES.items():
        p = ROOT/name; data = p.read_bytes(); lines = data.decode('utf-8').splitlines()
        rows.append(dict(path=str(p),sha256=hashlib.sha256(data).hexdigest(),
            excerpts=[dict(first=first,last=last,text='\n'.join(str(i)+': '+lines[i-1] for i in range(first,last+1))) for first,last in ranges]))
    (out/'evidence.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({row['path']:row['sha256'] for row in rows},indent=2))

if __name__ == '__main__':
    main()

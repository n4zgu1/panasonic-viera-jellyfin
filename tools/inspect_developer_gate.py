#!/usr/bin/env python3
"""Look for the observed developer UI and its registration in extracted files.

Read-only. Reports matching terms/offsets, never candidate password values.
No firmware execution and no device/network requests.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

TERMS = ['Enter Password', 'remember password', '0077777777777778',
         'IPTV Apps DEVELOPERS (HTML5)', 'get_built_in_developer_tool_passwd']

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    args = parser.parse_args()
    out = args.output.resolve()
    assert out.is_relative_to(Path('work').resolve())
    out.mkdir(parents=True,exist_ok=False,mode=0o700)
    report = dict(files_examined=0,terms=TERMS,matches=[])
    files = (p for partition in ('fma4','fma5','fma6','fma7')
             for p in (Path('work/filesystems')/partition).rglob('*'))
    for p in sorted(files):
        if not p.is_file():
            continue
        raw = p.read_bytes()
        report['files_examined'] += 1
        digest = None
        for term in TERMS:
            for encoding in ('utf-8','utf-16-le','utf-16-be'):
                offsets = [hex(m.start()) for m in re.finditer(re.escape(term.encode(encoding)),raw,re.I)]
                if offsets:
                    digest = digest or hashlib.sha256(raw).hexdigest()
                    report['matches'].append(dict(path=str(p),sha256=digest,term=term,encoding=encoding,offsets=offsets))
    report['terms_without_matches'] = [t for t in TERMS if not any(m['term']==t for m in report['matches'])]
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__ == '__main__':
    main()

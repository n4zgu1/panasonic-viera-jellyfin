#!/usr/bin/env python3
"""Static-only inspection of installation-related firmware; no target execution.

Writes offsets, ELF section layout and selected printable strings to a new work directory.
Strings and pointer values are evidence of references, never proof of reachable code.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

TARGETS = [
    'fma5/local/bin/app_upd', 'fma5/local/bin/ajaxceplay',
    'fma4/user/local/bin/surfer', 'fma4/user/local/bin/dlnad',
]
PATTERN = re.compile(r'app.?up|appinfo|app.?install|install.?app|sdk|develop|register|regist|'
                     r'boot_url|restrict|signature|verify|RSA_|EVP_|Info\.plist|'
                     r'apps_nv|application|Usage|usage|init\.json|sdkhtml|main\.html|'
                     r'bookmark|home.?screen|web.?app|web.?browser|resource.?id', re.I)

def elf_sections(data):
    if data[:4] != b'\x7fELF':
        return None
    assert data[4:6] == b'\x01\x02'
    values = struct.unpack_from('>HHIIIIIHHHHHH', data, 16)
    _, machine, _, entry, phoff, shoff, flags, _, phsize, phnum, shsize, shnum, shnames = values
    assert shsize == 40 and shoff + shsize * shnum <= len(data)
    sections = [struct.unpack_from('>10I', data, shoff + i*shsize) for i in range(shnum)]
    names = sections[shnames]
    names = data[names[4]:names[4]+names[5]]
    result = []
    for s in sections:
        name = names[s[0]:].split(b'\0')[0].decode('ascii')
        result.append(dict(name=name, type=s[1], flags=hex(s[2]), address=hex(s[3]), offset=hex(s[4]), size=s[5]))
    return dict(machine=hex(machine),entry=hex(entry),flags=hex(flags),sections=result)

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('output',type=Path)
    a = ap.parse_args()
    out = a.output.resolve()
    assert out.is_relative_to(Path('work').resolve())
    out.mkdir(parents=True,exist_ok=False,mode=0o700)
    report = []
    for relative in TARGETS:
        p = Path('work/filesystems')/relative
        data = p.read_bytes()
        matches = []
        strings = []
        for match in re.finditer(rb'[\x20-\x7e\t\r\n]{5,}',data):
            text = match.group().decode('ascii')
            row = dict(offset=hex(match.start()),text=text)
            strings.append(row)
            if PATTERN.search(text):
                matches.append(row)
        layout = elf_sections(data)
        item = dict(path=str(p),sha256=hashlib.sha256(data).hexdigest(),elf=layout,matches=matches)
        report.append(item)
        (out/(p.name+'.json')).write_text(json.dumps(item,indent=2)+'\n')
        if p.name == 'app_upd':
            (out/'app_upd.strings.txt').write_text('\n'.join(r['offset']+' '+r['text'].replace('\n','\\n') for r in strings)+'\n')
        print(p.name, 'matches',len(matches),'sha256',item['sha256'])
    # Global exact-name cross-check, including glisp and binary data (not only .js files).
    terms = [b'sdkhtml',b'sdkapp',b'localserver.vieraconnect.com',b'init.json',
             b'Panasonic IPTV Apps DEVELOPERS',b'app_loader.js',b'sd_testmode']
    global_matches = []
    for p in sorted(Path('work/filesystems').rglob('*')):
        if not p.is_file():
            continue
        data = p.read_bytes()
        for term in terms:
            offsets = [hex(m.start()) for m in re.finditer(re.escape(term),data)]
            if offsets:
                global_matches.append(dict(path=str(p),term=term.decode(),offsets=offsets,
                                           sha256=hashlib.sha256(data).hexdigest()))
    (out/'exact-references.json').write_text(json.dumps(global_matches,indent=2)+'\n')
    (out/'manifest.json').write_text(json.dumps({str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(out.glob('*')) if p.is_file()},indent=2)+'\n')

if __name__ == '__main__':
    main()

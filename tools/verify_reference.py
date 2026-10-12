#!/usr/bin/env python3
"""Recheck all reference file hashes, counts and the raw ELF identity offline."""
import hashlib
import json
from pathlib import Path
import re
import struct

text = Path('references/Panasonic_TX42ASW504_Pruefprotokoll.txt').read_text()
rows = []
for name,size,digest in re.findall(r'((?:filesystems|partitions)/[^\n]+)\nBytes: (\d+)\nSHA-256: ([0-9a-f]+)',text):
    p = Path('work')/name if name.startswith('filesystems/') else Path('work/extracted-v2')/name
    b = p.read_bytes()
    rows.append(dict(path=str(p),bytes=len(b),sha256=hashlib.sha256(b).hexdigest(),
                     match=len(b)==int(size) and hashlib.sha256(b).hexdigest()==digest))
Path('results/reference-check.json').write_text(json.dumps(rows,indent=2)+'\n')
assert all(r['match'] for r in rows)
counts = {}
for name,expected in [('fma4',80),('fma5',7255),('fma6',22),('fma7',16)]:
    manifest = json.loads(Path(f'work/filesystems/{name}.manifest.json').read_text())
    files = manifest['files']
    counts[name] = {t:sum(f['type']==t for f in files) for t in ('file','symlink','directory')}
    assert counts[name]['file'] == expected
    for f in files:
        if f['type'] == 'file':
            b = (Path('work/filesystems')/name/f['path']).read_bytes()
            assert hashlib.sha256(b).hexdigest() == f['sha256']
init = Path('work/filesystems/fma4/sbin/init').read_bytes()
assert init[:4] == b'\x7fELF'
kernel = Path('work/extracted-v2/partitions/fma3.bin').read_bytes()
kernel_text = kernel[0x4699ac:].split(b'\0')[0].decode('ascii')
report = dict(reference_hashes_matched=len(rows),counts=counts,
    elf=dict(elf_class=init[4],data_encoding=init[5],osabi=init[7],machine=hex(struct.unpack_from('>H',init,18)[0])),
    kernel_string_offset='0x4699ac',kernel_string=kernel_text)
Path('results/offline-check.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))

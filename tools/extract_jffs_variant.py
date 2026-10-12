#!/usr/bin/env python3
"""Extract this image's BE 0x911a JFFS variant; no mounting/code execution.

Supports uncompressed nodes only. Variant CRC semantics are not validated;
independent reference file hashes must be compared. Symlinks are not created.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import struct

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('image',type=Path)
    ap.add_argument('output',type=Path)
    a = ap.parse_args()
    data = a.image.read_bytes()
    assert hashlib.sha256(data).hexdigest() == 'c69381d73aa94afc780a5fecfe855187a3e21d063771fccc17d2f6f3beeae456'
    out = a.output.resolve()
    assert out.is_relative_to(Path('work').resolve())
    out.mkdir(parents=True,exist_ok=False)
    entries = {}
    nodes = defaultdict(list)
    pos = 0
    while pos+12 <= len(data):
        if data[pos:pos+4] == b'\xff'*4:
            pos += 4
            continue
        magic, typ, size = struct.unpack_from('>HHI',data,pos)
        assert magic == 0x911a and size >= 12 and pos+size <= len(data)
        b = data[pos:pos+size]
        if typ == 0xe001:
            parent, version, ino = struct.unpack_from('>III',b,12)
            length, dtype = b[28:30]
            assert size == 40+length
            name = b[40:].decode('utf-8')
            assert name not in ('','.','..') and '/' not in name and '\\' not in name and '\0' not in name
            key = parent,name
            if key not in entries or entries[key][0] < version:
                entries[key] = version,ino,dtype
        elif typ == 0xe002:
            ino, version, mode = struct.unpack_from('>III',b,12)
            isize = struct.unpack_from('>I',b,28)[0]
            offset, csize, dsize = struct.unpack_from('>III',b,44)
            assert b[56] == 0 and csize == dsize and size == 68+csize
            nodes[ino].append((version, mode, isize, offset, b[68:]))
        else:
            raise ValueError(hex(typ))
        pos += (size+3)&~3
    assert all(b == 255 for b in data[pos:])
    records = []
    def visit(parent, rel, ancestors):
        assert parent not in ancestors
        for (p,name),(version,ino,dtype) in sorted(entries.items()):
            if p != parent or not ino:
                continue
            path = rel/name
            parts = sorted(nodes[ino])
            assert parts
            mode, size = parts[-1][1:3]
            record = dict(path=str(path),inode=ino,mode=oct(mode))
            if mode & 0xf000 == 0x4000:
                (out/path).mkdir()
                record['type'] = 'directory'
                visit(ino,path,ancestors|{parent})
            else:
                assert mode & 0xf000 == 0x8000 and size <= len(data)
                buf = bytearray(size)
                covered = bytearray(size)
                for _,_,_,offset,body in parts:
                    n = min(len(body),max(0,size-offset))
                    if n:
                        buf[offset:offset+n] = body[:n]
                        covered[offset:offset+n] = b'\1'*n
                assert all(covered)
                (out/path).write_bytes(buf)
                record.update(type='file',bytes=size,sha256=hashlib.sha256(buf).hexdigest())
            records.append(record)
    visit(1,Path('.'),set())
    out.with_suffix('.manifest.json').write_text(json.dumps(dict(image_sha256=hashlib.sha256(data).hexdigest(),
        crc_validated=False,files=records),indent=2)+'\n')
    print(json.dumps({t:sum(r['type']==t for r in records) for t in {r['type'] for r in records}},indent=2))

if __name__ == '__main__':
    main()

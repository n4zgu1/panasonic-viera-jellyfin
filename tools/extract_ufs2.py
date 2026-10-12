#!/usr/bin/env python3
"""Read UFS2 images in userspace; record symlinks, never create devices/links.

Format reference: FreeBSD releng/9.2 sys/ufs/ffs/fs.h and sys/ufs/ufs/dinode.h.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('image', type=Path)
    ap.add_argument('output', type=Path)
    a = ap.parse_args()
    data = a.image.read_bytes()
    locations = [s for s in (65536,8192,0,262144)
                 if data[s+1372:s+1376] in (bytes.fromhex('19540119'),bytes.fromhex('19015419'))]
    assert locations, 'No UFS2 superblock at standard search locations'
    sb = data[locations[0]:locations[0]+1376]
    endian = '>' if sb[1372:1376] == bytes.fromhex('19540119') else '<'
    def u(fmt, b, off=0):
        return struct.unpack_from(endian+fmt, b, off)
    assert u('I', sb, 1372)[0] == 0x19540119
    iblk = u('I', sb, 16)[0]
    bsize, fsize = u('II', sb, 48)
    ipg, fpg = u('II', sb, 184)
    assert 4096 <= bsize <= 65536 and 512 <= fsize <= bsize
    out = a.output.resolve()
    assert out.is_relative_to(Path('work').resolve())
    out.mkdir(parents=True, exist_ok=False)
    records = []
    def read(off, size):
        assert 0 <= off <= len(data) and 0 <= size <= len(data)-off
        return data[off:off+size]
    def inode(ino):
        return read(((ino // ipg)*fpg + iblk)*fsize + (ino % ipg)*256, 256)
    def block(ptr, level, count):
        if not count:
            return b''
        if ptr == 0:
            return bytes(count)
        if level == 0:
            return read(ptr*fsize, count)
        pointers = u('Q'*(bsize//8), read(ptr*fsize,bsize))
        buf = bytearray()
        cap = bsize * (bsize//8)**(level-1)
        for p in pointers:
            n = min(count-len(buf), cap)
            if n <= 0:
                break
            buf.extend(block(p, level-1, n))
        assert len(buf) == count
        return bytes(buf)
    def contents(node):
        size = u('Q', node, 16)[0]
        assert size <= len(data)
        if u('H',node)[0] & 0xf000 == 0xa000 and size < 120:
            return node[112:112+size]
        buf = bytearray()
        pointers = u('15Q',node,112)
        for i,p in enumerate(pointers):
            level = max(0,i-11)
            n = min(size-len(buf), bsize*(bsize//8)**level)
            buf.extend(block(p,level,n))
            if len(buf) == size:
                return bytes(buf)
        raise ValueError('Incomplete inode')
    def visit(ino, rel, ancestors):
        node = inode(ino)
        mode = u('H',node)[0]
        kind = mode & 0xf000
        record = dict(path=rel, inode=ino, mode=oct(mode))
        if kind == 0x4000:
            assert ino not in ancestors
            (out / rel).mkdir(exist_ok=True)
            buf = contents(node)
            pos = 0
            while pos < len(buf):
                child, length, typ, nlen = u('IHBB',buf,pos)
                assert length >= 8 and length % 4 == 0 and pos+length <= len(buf)
                assert nlen <= length-8
                name = buf[pos+8:pos+8+nlen].decode('utf-8')
                if child and name not in ('.','..'):
                    assert name and '/' not in name and '\\' not in name and '\0' not in name
                    visit(child, str(Path(rel)/name), ancestors | {ino})
                pos += length
            record['type'] = 'directory'
        elif kind in (0x8000,0xa000):
            buf = contents(node)
            record.update(bytes=len(buf),sha256=hashlib.sha256(buf).hexdigest())
            if kind == 0xa000:
                record.update(type='symlink',target=buf.decode('utf-8'))
            else:
                record['type'] = 'file'
                with (out/rel).open('xb') as f:
                    f.write(buf)
        else:
            record['type'] = 'special-not-created'
        records.append(record)
    visit(2,'.',set())
    report = dict(image_sha256=hashlib.sha256(data).hexdigest(), endian=endian, superblock_offset=locations[0],
                  block_size=bsize, fragment_size=fsize, files=records)
    out.with_suffix('.manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(dict(image=str(a.image), counts={t:sum(r['type']==t for r in records)
        for t in sorted({r['type'] for r in records})}),indent=2))

if __name__ == '__main__':
    main()

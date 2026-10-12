#!/usr/bin/env python3
"""Read-only extractor for the single validated TX-42ASW504 image.

SPDX-License-Identifier: GPL-3.0-only
Container layout/algorithm adapted from theubusu/sddl_dec,
commit 2154bb70fa096e2fc08b708753d0b3aebcc09792, src/include.rs/main.rs/peaks.rs.
Python adaptation and additional validation: 2026-10-12.
Requires cryptography. Never executes or mounts extracted firmware.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import zlib
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.padding import PKCS7

EXPECTED = 'e914311a30f5582a54d280ee324ba3ab11ed124b160919dd2496cb93b02bb72e'

def decipher(data):
    out = bytearray()
    state = 904
    for i, b in enumerate(data):
        out.append(b ^ ((state >> 8) & 255))
        state = (state + b + 38400 + 163) & 0xffffffff
        if (i + 1) % 256 == 0:
            state = 904
    return bytes(out)

def decrypt(data):
    d = Cipher(algorithms.AES(bytes.fromhex('26e096d3ef8a8fbbaa5e516f7726c22c')),
               modes.CBC(bytes.fromhex('3e4ae23a69db8154cd8838c4b90c7666'))).decryptor()
    u = PKCS7(128).unpadder()
    return u.update(d.update(data) + d.finalize()) + u.finalize()

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('source', type=Path)
    ap.add_argument('output', type=Path, help='New directory below work/')
    args = ap.parse_args()
    data = args.source.read_bytes()
    if len(data) != 111482640 or hashlib.sha256(data).hexdigest() != EXPECTED:
        raise SystemExit('STOP: unexpected source size/hash')
    out = args.output.resolve()
    if not out.is_relative_to(Path('work').resolve()):
        raise SystemExit('Output must be below work/')
    out.mkdir(parents=True, exist_ok=False)
    hdr = decipher(data[:32])
    assert hdr[:4] == bytes.fromhex('11223344')
    pos = 32
    records = []
    while pos < len(data) - 128:
        start = pos
        h = decrypt(data[pos:pos+32])
        name = h[:12].split(b'\0')[0].decode('ascii')
        size = int(h[12:24].rstrip(b'\0'))
        assert 0 < size <= len(data) - 128 - pos - 32
        pos += 32
        content = decrypt(data[pos:pos+size])
        pos += size
        records.append(dict(name=name, offset=start, encrypted_size=size))
        if name == 'SDIT.FDI' or name.endswith('.TXT'):
            assert '/' not in name and '\\' not in name
            (out / name).write_bytes(content)
            continue
        assert re.fullmatch(r'(PEAKS|BOOT|STM)\.F[0-9A-Fa-f]+', name), name
        flags = content[34]
        csize = struct.unpack_from('>I', content, 36)[0]
        payload = content[48:48+csize]
        assert len(payload) == csize
        if flags & 2:
            payload = decipher(payload)
        if flags & 1:
            payload = zlib.decompress(payload)
        magic, dest, source, length, tail = struct.unpack_from('>BIIIB', payload)
        if dest >> 28 == 0xd:
            dest &= 0xfffffff
        if source >> 28 == 0xc:
            source &= 0xfffffff
        assert source != 0x10e, 'Unexpected subfile'
        body = payload[14:14+length]
        assert len(body) == length and dest + length < 512 * 1024 * 1024
        target = out / (name.split('.')[0] + '.bin')
        with target.open('r+b' if target.exists() else 'xb') as f:
            f.seek(dest)
            f.write(body)
    assert pos == len(data) - 128
    peaks = (out / 'PEAKS.bin').read_bytes()
    assert peaks.startswith(b'D50 ')
    bootargs = peaks[16:528].split(b'\0')[0].decode('ascii')
    (out / 'bootargs.txt').write_text(bootargs)
    parts = re.findall(r'^\s*(fma\d+)=(\d+)([kM])(?::([^\s]+))?', bootargs, re.M)
    root = re.search(r'root=/dev/(fma\d+)', bootargs)[1]
    start = [p[0] for p in parts].index(root) - 1
    offset = 0
    pd = out / 'partitions'
    pd.mkdir()
    for name, number, unit, flag in parts[start:]:
        if offset == len(peaks):
            break
        size = int(number) * (1024 if unit == 'k' else 1048576)
        p = peaks[offset:offset+size]
        assert len(p) == size
        offset += size
        if flag == 'c':
            endian = '<' if p[:2] == b'\0\0' else '>'
            total, first = struct.unpack_from(endian+'II', p)
            assert 8 <= first <= len(p) and first % 4 == 0
            locs = struct.unpack_from(endian+'I' * ((first-4)//4), p, 4)
            assert list(locs) == sorted(locs) and locs[0] == first
            blocks = [zlib.decompress(p[a:b]) for a,b in zip(locs, (*locs[1:],len(p)))]
            p = b''.join(blocks)
            assert len(p) == total, (name, len(p), total)
        (pd / (name+'.bin')).write_bytes(p)
    assert offset == len(peaks)
    manifest = []
    for p in sorted(out.rglob('*')):
        if p.is_file():
            raw = p.read_bytes()
            manifest.append(dict(path=str(p.relative_to(out)), bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest()))
    report = dict(source_sha256=EXPECTED, records=records, files=manifest)
    (out / 'manifest.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(manifest, indent=2))

if __name__ == '__main__':
    main()

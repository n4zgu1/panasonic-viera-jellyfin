#!/usr/bin/env python3
"""Build a reproducible Panasonic HTML5 source bundle; does not install anything.

Entry layout and init.json: historical Panasonic IPTV HTML5 v2.0 guide.
Artwork sizes: Brightcove Panasonic submission guide, archived under work/.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import zipfile
import zlib

ROOT = Path(__file__).resolve().parent.parent

def chunk(kind, body):
    return struct.pack('>I',len(body)) + kind + body + struct.pack('>I',zlib.crc32(kind+body)&0xffffffff)

def artwork(width,height,circular=False):
    """Original play symbol; RGBA PNG, no external fonts or copied logos."""
    rows = bytearray()
    size = min(width,height)
    for y in range(height):
        rows.append(0)
        for x in range(width):
            nx, ny = (x-width/2)/size, (y-height/2)/size
            outside = circular and nx*nx+ny*ny > 0.245
            triangle = -0.19 <= nx <= 0.27 and abs(ny) <= (0.27-nx)*0.7
            if outside:
                rgba = (0,0,0,0)
            elif triangle:
                rgba = (125,225,250,255)
            else:
                rgba = (16,27+int(15*y/height),42+int(22*x/width),255)
            rows.extend(rgba)
    header = struct.pack('>IIBBBBB',width,height,8,6,0,0,0)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',header)+chunk(b'IDAT',zlib.compress(bytes(rows),9))+chunk(b'IEND',b'')

def build(output):
    out = output.resolve()
    if not out.is_relative_to((ROOT/'work').resolve()):
        raise ValueError('Output must be a new directory below work/')
    out.mkdir(parents=True,exist_ok=False)
    app = out/'sdkhtml'; app.mkdir()
    source = ROOT/'web/viera'
    html = (source/'index.html').read_text()
    for name in ('style.css','api.js','client.js'):
        assert html.count('/viera/'+name) == 1
        html = html.replace('/viera/'+name,'./'+name)
        (app/name).write_bytes((source/name).read_bytes())
    (app/'main.html').write_text(html)
    config = json.loads((ROOT/'platform/panasonic/init.json').read_text())
    assert config['mode'] == 'key' and config['keyboard']['use'] is True
    (app/'init.json').write_text(json.dumps(config,indent=2)+'\n')
    icons = out/'artwork'; icons.mkdir()
    for width,height,shape in ((160,112,False),(256,60,False),(360,252,False),(336,336,True)):
        (icons/f'icon-{width}x{height}.png').write_bytes(artwork(width,height,shape))
    (out/'README.md').write_bytes((ROOT/'platform/panasonic/README.md').read_bytes())
    release = dict(format='local-panasonic-html5-preparation-v1',name='Viera Jellyfin',version='0.4.0',
        entry='sdkhtml/main.html',browser_config='sdkhtml/init.json',
        installed_on_tv=False,validated_panasonic_install_package=False,
        requires='Authorized developer launcher or approved market URL registration')
    (out/'release.json').write_text(json.dumps(release,indent=2)+'\n')
    files = sorted(p for p in out.rglob('*') if p.is_file())
    manifest = {str(p.relative_to(out)):dict(bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in files}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    archive = out/'viera-jellyfin-html5-source.zip'
    with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in sorted(files+[out/'manifest.json']):
            info = zipfile.ZipInfo(str(p.relative_to(out)),date_time=(2026,10,12,0,0,0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info,p.read_bytes())
    result = dict(output=str(out.relative_to(ROOT)),files=len(manifest),archive_sha256=hashlib.sha256(archive.read_bytes()).hexdigest())
    print(json.dumps(result,indent=2))
    return result

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--output',type=Path,required=True)
    build(ap.parse_args().output)

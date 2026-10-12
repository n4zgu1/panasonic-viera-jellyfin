#!/usr/bin/env python3
"""Offline build checks; these do not prove installation on a television."""
import hashlib
import json
from pathlib import Path
import re
import struct
import tempfile
import unittest
import zipfile
import zlib
from build_panasonic_app import ROOT, build

class BundleTests(unittest.TestCase):
    def test_reproducible_complete_relative_bundle(self):
        with tempfile.TemporaryDirectory(prefix='panasonic-bundle-test-',dir=ROOT/'work') as temp:
            a,b = Path(temp)/'a',Path(temp)/'b'
            first,second = build(a),build(b)
            self.assertEqual(first['archive_sha256'],second['archive_sha256'])
            self.assertEqual((a/'sdkhtml/client.js').read_bytes(),(ROOT/'web/viera/client.js').read_bytes())
            self.assertEqual((a/'sdkhtml/api.js').read_bytes(),(ROOT/'web/viera/api.js').read_bytes())
            html = (a/'sdkhtml/main.html').read_text()
            resources = re.findall(r'(?:src|href)="([^"]+)"',html)
            self.assertEqual(set(resources),{'./style.css','./api.js','./client.js'})
            for resource in resources:
                self.assertTrue((a/'sdkhtml'/resource).is_file())
            self.assertEqual(json.loads((a/'sdkhtml/init.json').read_text())['mode'],'key')
            manifest = json.loads((a/'manifest.json').read_text())
            with zipfile.ZipFile(a/'viera-jellyfin-html5-source.zip') as z:
                self.assertEqual(set(z.namelist()),set(manifest)|{'manifest.json'})
                for name,entry in manifest.items():
                    self.assertNotIn('..',Path(name).parts)
                    self.assertFalse(Path(name).is_absolute())
                    self.assertEqual(hashlib.sha256(z.read(name)).hexdigest(),entry['sha256'])
            for p in (a/'artwork').glob('*.png'):
                raw = p.read_bytes(); self.assertEqual(raw[:8],b'\x89PNG\r\n\x1a\n')
                width,height = struct.unpack_from('>II',raw,16)
                self.assertEqual(p.stem,f'icon-{width}x{height}')
                pos = 8; image_data = bytearray()
                while pos < len(raw):
                    size = struct.unpack_from('>I',raw,pos)[0]
                    kind,data = raw[pos+4:pos+8],raw[pos+8:pos+8+size]
                    self.assertEqual(zlib.crc32(kind+data)&0xffffffff,struct.unpack_from('>I',raw,pos+8+size)[0])
                    if kind == b'IDAT': image_data.extend(data)
                    pos += size+12
                self.assertEqual(len(zlib.decompress(image_data)),height*(1+width*4))

    def test_existing_directory_is_not_overwritten(self):
        with tempfile.TemporaryDirectory(prefix='panasonic-existing-test-',dir=ROOT/'work') as temp:
            marker = Path(temp)/'user-file'; marker.write_text('preserve')
            with self.assertRaises(FileExistsError): build(Path(temp))
            self.assertEqual(marker.read_text(),'preserve')

if __name__ == '__main__':
    unittest.main()

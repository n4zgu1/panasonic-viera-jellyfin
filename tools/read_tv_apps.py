#!/usr/bin/env python3
"""One read-only X_GetAppList SOAP request; no launch, pairing or retry.

Request semantics corroborated by panasonic-viera RemoteControl.get_apps
and firmware dlnad string at 0xda1cd. Not advertised in this TV's SCPD.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import http.client
import json
from pathlib import Path
import xml.etree.ElementTree as ET

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--ip',choices=['192.168.178.63'],required=True)
    ap.add_argument('--output',type=Path,required=True)
    a = ap.parse_args()
    out = a.output.resolve()
    assert out.is_relative_to(Path('work').resolve())
    out.mkdir(parents=True,exist_ok=False,mode=0o700)
    urn = 'urn:panasonic-com:service:p00NetworkControl:1'
    body = ('<?xml version="1.0" encoding="utf-8"?>'
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
        's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>'
        f'<u:X_GetAppList xmlns:u="{urn}"></u:X_GetAppList>'
        '</s:Body></s:Envelope>').encode()
    (out/'request.xml').write_bytes(body)
    report = dict(time_utc=datetime.now(timezone.utc).isoformat(),ip=a.ip,port=55000,
                  method='POST',path='/nrc/control_0',action='X_GetAppList')
    conn = http.client.HTTPConnection(a.ip,55000,timeout=5)
    try:
        conn.request('POST',report['path'],body,{'Content-Type':'text/xml; charset=utf-8',
            'SOAPAction':f'"{urn}#X_GetAppList"','Connection':'close'})
        res = conn.getresponse()
        raw = res.read(1024*1024+1)
        assert len(raw) <= 1024*1024
        (out/'response.xml').write_bytes(raw)
        (out/'response.xml').chmod(0o600)
        report.update(status=res.status,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
        root = ET.fromstring(raw)
        # Only report selected fields; raw response remains local.
        report['fields'] = {e.tag.rsplit('}',1)[-1]: e.text for e in root.iter()
            if e.tag.rsplit('}',1)[-1] in ('X_AppList','errorCode','errorDescription')}
    except (OSError,http.client.HTTPException,ET.ParseError) as e:
        report.update(error=type(e).__name__,message=str(e))
    finally:
        conn.close()
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__ == '__main__':
    main()

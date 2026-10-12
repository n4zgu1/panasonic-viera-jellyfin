#!/usr/bin/env python3
"""Low-rate read-only inventory of the explicitly supplied TV; no redirects/proxy.

Five TCP connects, one GET on the known NRC description if port 55000 is open.
Raw description remains locally under work/ with restrictive file permissions.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import http.client
import json
from pathlib import Path
import socket
import time
import xml.etree.ElementTree as ET

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--ip',choices=['192.168.178.63'],required=True)
    ap.add_argument('--output',type=Path,required=True)
    ap.add_argument('--service-description',action='store_true',help='Only GET the advertised /nrc/sdd_0.xml')
    a = ap.parse_args()
    out = a.output.resolve()
    assert out.is_relative_to(Path('work').resolve())
    out.mkdir(parents=True,exist_ok=False,mode=0o700)
    report = dict(time_utc=datetime.now(timezone.utc).isoformat(),ip=a.ip,ports=[],requests=[])
    for port in (() if a.service_description else (80,443,55000,55001,8080)):
        row = dict(port=port,time_utc=datetime.now(timezone.utc).isoformat())
        try:
            with socket.create_connection((a.ip,port),timeout=3):
                row['result'] = 'open'
        except OSError as e:
            row.update(result='connect_failed',error=type(e).__name__,errno=e.errno,message=str(e))
        report['ports'].append(row)
        time.sleep(1)
    if a.service_description or any(p['port']==55000 and p['result']=='open' for p in report['ports']):
        conn = http.client.HTTPConnection(a.ip,55000,timeout=5)
        row = dict(method='GET',path='/nrc/sdd_0.xml' if a.service_description else '/nrc/ddd.xml',port=55000)
        try:
            conn.request('GET',row['path'],headers={'Connection':'close'})
            response = conn.getresponse()
            body = response.read(1024*1024+1)
            assert len(body) <= 1024*1024
            row.update(status=response.status,bytes=len(body),sha256=hashlib.sha256(body).hexdigest())
            filename = 'nrc-sdd.xml' if a.service_description else 'nrc-ddd.xml'
            with (out/filename).open('xb') as f:
                f.write(body)
            (out/filename).chmod(0o600)
            if response.status == 200:
                root = ET.fromstring(body)
                if a.service_description:
                    sn = {'s':'urn:schemas-upnp-org:service-1-0'}
                    row['actions'] = [{
                        'name':action.findtext('s:name',namespaces=sn),
                        'arguments':[{key:arg.findtext('s:'+key,namespaces=sn)
                            for key in ('name','direction','relatedStateVariable')}
                            for arg in action.findall('s:argumentList/s:argument',sn)]
                    } for action in root.findall('s:actionList/s:action',sn)]
                ns = {'d':'urn:schemas-upnp-org:device-1-0'}
                row['device'] = {key:root.findtext('.//d:'+key,namespaces=ns)
                                 for key in ('manufacturer','modelName','modelNumber','deviceType')}
                row['services'] = [{key:s.findtext('d:'+key,namespaces=ns)
                    for key in ('serviceType','SCPDURL','controlURL','eventSubURL')}
                    for s in root.findall('.//d:service',ns)]
        except (OSError, http.client.HTTPException, ET.ParseError) as e:
            row.update(error=type(e).__name__,message=str(e))
        finally:
            conn.close()
        report['requests'].append(row)
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Read exact public resource URLs named in the verified firmware configuration.

Uses only public CA certificates for server validation (no client certificates,
device identifiers, credentials, retries or redirects). Never executes responses.
Stops at HTTP/auth/TLS errors; does not bypass hostname/certificate verification.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import http.client
import json
from pathlib import Path
import ssl

CA = Path('work/filesystems/fma5/local/ajaxce/cert/app_upd_cacert.pem')
EXPECTED_CA = '299f0d91305b9516675c65bfc0b786fd16b5b999fbf0b0f0c4fb8e1256cc4e54'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    a = parser.parse_args()
    out = a.output.resolve()
    assert out.is_relative_to(Path('work').resolve())
    out.mkdir(parents=True,exist_ok=False,mode=0o700)
    assert hashlib.sha256(CA.read_bytes()).hexdigest() == EXPECTED_CA
    # Trust only the public roots from the hash-verified firmware for this
    # historical vendor endpoint. No generic system roots or client key loaded.
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.load_verify_locations(cafile=str(CA))
    # Python 3.14 enables strict RFC checks which reject this fixed, historical
    # vendor root's noncritical BasicConstraints. Use legacy validation rules,
    # while retaining required trust-chain, validity and hostname verification.
    context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    # The historical chain uses a digest rejected by OpenSSL's modern security
    # level. Permit legacy signatures only in this disposable read-only context;
    # retain TLS >= 1.2, pinned root input, chain/validity and hostname checks.
    # Treat downloaded material as untrusted data, not executable instructions.
    context.set_ciphers('DEFAULT:@SECLEVEL=0')
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname
    report = dict(time_utc=datetime.now(timezone.utc).isoformat(),public_ca_sha256=EXPECTED_CA,
                  certificate_required=True,hostname_checked=True,legacy_ca_validation=True,
                  openssl_security_level=context.security_level,minimum_tls='1.2',requests=[])
    for path,name in [('/data/config/resource-mhc-eu.js','resource'),('/data/home-screen.js','home-screen')]:
        row = dict(url='https://mhc-eu.myhomescreen.tv'+path,method='GET',authenticated=False)
        conn = http.client.HTTPSConnection('mhc-eu.myhomescreen.tv',443,context=context,timeout=15)
        try:
            conn.connect()
            row['peer_certificate_sha256'] = hashlib.sha256(conn.sock.getpeercert(binary_form=True)).hexdigest()
            row['tls_version'] = conn.sock.version()
            conn.request('GET',path,headers={'Connection':'close'})
            response = conn.getresponse()
            body = response.read(2*1024*1024+1)
            assert len(body) <= 2*1024*1024
            row.update(status=response.status,bytes=len(body),sha256=hashlib.sha256(body).hexdigest(),
                       content_type=response.getheader('Content-Type'))
            (out/(name+'.response')).write_bytes(body)
            if response.status != 200:
                report['requests'].append(row)
                break
        except (OSError,http.client.HTTPException) as error:
            row.update(error=type(error).__name__,detail=str(error))
            report['requests'].append(row)
            break
        finally:
            conn.close()
        report['requests'].append(row)
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Prüft die bereitgestellte Panasonic-SDDL-Signatur, ohne Firmware auszuführen.

Abhängigkeit: cryptography
Aufruf: python Panasonic_TX42ASW504_Signaturpruefung.py /pfad/zu/SDDL.SEC

Der öffentliche Schlüssel wurde aus der untersuchten Firmware extrahiert.
Das Ergebnis besagt NICHT, dass jeder Update-/Bootpfad des TV korrekt prüft.
Es werden keine Eingabedateien verändert und keine Netzwerkzugriffe ausgeführt.
"""
from __future__ import annotations
import argparse
import hashlib
import sys
from pathlib import Path
try:
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding, rsa
except ImportError:
    raise SystemExit("Abhängigkeit fehlt: python -m pip install cryptography")

# Ausschließlich öffentlicher RSA-Schlüssel, kein privater Signierschlüssel.
N = int("d93ec51a14b466cf6614ba44f95e5954fe1c24769fd63eb34b19bed523ad0235ea39c7900b94047f1e69a5a64543931ce74aab127f5dd9301a974213be3bb057081273d1ff1df15fb1f016e50b56200901a1798db62b0847885d6d0dffe26e894dbbabe27620ea05ae32718c389e286ad21954e75079f7486662c2aa3313a63b", 16)
E = 17
EXPECTED_SHA256 = "e914311a30f5582a54d280ee324ba3ab11ed124b160919dd2496cb93b02bb72e"

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("firmware", type=Path)
    args = parser.parse_args()
    try:
        data = args.firmware.read_bytes()
    except OSError as exc:
        print(f"Lesefehler: {exc}", file=sys.stderr)
        return 2
    if len(data) <= 128:
        print("Datei zu klein für dieses Signaturformat.", file=sys.stderr)
        return 2
    digest = hashlib.sha256(data).hexdigest()
    print(f"Dateigröße: {len(data)} Bytes")
    print(f"SHA-256: {digest}")
    print(f"Identisch zur untersuchten Datei: {digest == EXPECTED_SHA256}")
    public_key = rsa.RSAPublicNumbers(E, N).public_key()
    content, signature = data[:-128], data[-128:]
    try:
        public_key.verify(signature, content, padding.PKCS1v15(), hashes.SHA1())
    except InvalidSignature:
        print("Signatur UNGÜLTIG für diesen öffentlichen Schlüssel.")
        return 1
    print("Originalsignatur: GÜLTIG gemäß dem extrahierten Schlüssel.")
    modified = bytearray(content)
    modified[min(0x100, len(modified)-1)] ^= 1
    try:
        public_key.verify(signature, bytes(modified), padding.PKCS1v15(), hashes.SHA1())
    except InvalidSignature:
        print("Negativtest: Einzelbyte-Änderung mit alter Signatur erwartungsgemäß ABGELEHNT.")
        print("Nur lokale Rechnung; keine Aussage über die vollständige TV-Prüfimplementierung.")
        return 0
    print("Unerwartet: Negativtest wurde nicht abgelehnt.", file=sys.stderr)
    return 3

if __name__ == "__main__":
    raise SystemExit(main())

# Herkunft und Lizenzen

## SDDL-Containerextraktion

`tools/extract_firmware.py` ist eine auf das dokumentierte Firmwareabbild
begrenzte Python-Adaption von Containerdefinitionen und Algorithmen aus
[theubusu/sddl_dec](https://github.com/theubusu/sddl_dec), Stand
`2154bb70fa096e2fc08b708753d0b3aebcc09792`, insbesondere `src/include.rs`,
`src/main.rs` und `src/peaks.rs`.

Die Adaption wurde am 12.10.2026 erstellt und ergänzt eigene Eingabehash-,
Pfad-, Größen- und Reproduktionsprüfungen. Sie führt keine Firmware aus.
Für diese Datei gilt GNU GPL Version 3; der vollständige Lizenztext ist unter
`licenses/sddl_dec-GPL-3.0.txt` enthalten. Die Herkunfts-/Lizenzkennzeichnung im
Quelltext ist zu erhalten.

## Dateiformate und Recherche

UFS2-Strukturen wurden anhand der öffentlichen FreeBSD-Formatdefinitionen
(`sys/ufs/ffs/fs.h`, `sys/ufs/ufs/dinode.h`, Branch `releng/9.2`) implementiert.
Die Referenz-URLs und Grenzen sind in den Werkzeugen und den Untersuchungsunterlagen
angegeben. Hersteller-Firmware, entpackte Programme, Zertifikate und vollständige
heruntergeladene Herstellerdokumentation sind nicht Bestandteil des Repositorys.

## Testabhängigkeiten

Acorn und jsdom werden als npm-Entwicklungsabhängigkeiten bezogen. Deren jeweilige
Lizenztexte sind Bestandteil der installierten Pakete; Quellcode und Versionen
werden über `package-lock.json` eindeutig referenziert. `node_modules/` wird nicht
versioniert.

Diese Hinweise erklären die genannten Drittbestandteile. Es wird damit keine
zusätzliche pauschale Lizenz für die übrigen eigenständigen Projektteile vergeben.

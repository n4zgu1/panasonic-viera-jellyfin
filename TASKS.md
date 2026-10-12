# Forschungs- und Instruktionsplan

**Projekt:** Firmwareanalyse / eigene Programme auf Panasonic TX-42ASW504 mit Viera Connect  
**Untersuchungsstand:** 12.10.2026  
**Langfristiges Ziel:** reproduzierbar eigenen Code auf dem Gerät ausführen; auf dieser Grundlage eine minimale Jellyfin-Oberfläche oder Videowiedergabe bereitstellen.

## 0. Zieldefinition und Nachweisstufen

Nicht „Jailbreak“ behaupten, bevor die Kriterien erfüllt sind:

| Stufe | Erforderlicher Nachweis |
|---|---|
| 0: Bestandsaufnahme | Offline-Firmware erfolgreich analysiert, noch keine Ausführung eigenen Codes |
| 1: JavaScript-Sideloading | Eigener harmloser JavaScript-Code **auf dem Gerät** gestartet; Test optisch oder über eigenen lokalen Webserver nachgewiesen |
| 2: Native Userland-Ausführung | Eigenes für die Plattform kompiliertes Programm **auf dem Gerät** gestartet; keine Administratorrechte vorausgesetzt |
| 3: Root/Kernel-Zugriff | Privilegierte Ausführung auf dem Gerät nachgewiesen, ohne Schäden und mit vollständigem Reproduktionsprotokoll |
| 4: Jellyfin-MVP | Lokaler Jellyfin-Server erreichbar, Bibliothek angezeigt, mindestens ein unterstütztes Video startet; Fernbedienung funktioniert |

Ein funktionierender JavaScript-Client kann Zielstufe 4 erreichen, **ohne** Root-/Kernelzugriff.

## 1. Eingabedateien und Verzeichnisstruktur

Im Projektordner:

```text
.
├── AGENTS.md
├── TASKS.md
├── README.md
├── inputs/
│   └── SDDL.SEC                 # Benutzer kopiert hierhin; nicht im Starterpaket
├── references/
│   ├── Panasonic_TX42ASW504_Firmwareanalyse.md
│   ├── Panasonic_TX42ASW504_Pruefprotokoll.txt
│   └── Panasonic_TX42ASW504_Signaturpruefung.py
├── tools/                       # reproduzierbare lokale Analyseskripte
├── work/                        # temporäre Entpackdaten; keine Originaländerung
└── results/                     # Berichte, Tabellen und Nachweise
```

Startprüfung im Projektstamm:

```bash
stat -c '%s Bytes' inputs/SDDL.SEC
sha256sum inputs/SDDL.SEC
python3 references/Panasonic_TX42ASW504_Signaturpruefung.py inputs/SDDL.SEC
```

Erwartete Länge: `111482640`. Erwarteter SHA-256:

```text
e914311a30f5582a54d280ee324ba3ab11ed124b160919dd2496cb93b02bb72e
```

Das Python-Prüfskript benötigt die Bibliothek `cryptography`. Es prüft die Originalsignatur und einen **rein lokalen** Negativtest. Wenn Größe oder SHA nicht passen: anhalten, Befund protokollieren und **nicht** auf Basis fremder oder abweichender Images weiterarbeiten, bis die Abweichung erklärt ist. Der Rechner des Benutzers ist möglicherweise nicht Linux; Befehle entsprechend plattformneutral oder mit Alternativen implementieren.

## 2. Arbeitsphase A – Extraktion reproduzierbar machen [höchste Priorität]

**Auftrag:** Vorliegende Extraktion unabhängig bestätigen und ein reproduzierbares, quelloffenes, rein lesendes Tooling herstellen.

1. `references/` lesen; Hashes und Offsets B01–B07 als Ausgangsbelege übernehmen.
2. Das Open-Source-Projekt `https://github.com/theubusu/sddl_dec` sichten: unterstütztes SEC-Format, Extraktionsbefehle, Limitierungen, vertrauenswürdiger Repository-Stand. CLI-Optionen anhand lokaler `--help`-Ausgabe prüfen; keine blind kopierten Aufrufe.
3. In einer isolierten Umgebung SDDL entpacken und `PEAKS.bin`, `BOOT.bin`, `STM.bin`, `fma3`–`fma7` und die enthaltenen Dateisysteme unter `work/` ablegen. Falls das Werkzeug nur Module statt Dateisystemdateien liefert, UFS2 und JFFS2 **lesend** extrahieren.
4. Bereits bekannte Hashes/Größen aus dem Prüfprotokoll gegenprüfen. Datei-Zahlen nur zählen, wenn wirklich Dateien extrahiert wurden; Symlinks gesondert ausweisen. Jede Abweichung erklären.
5. Ein reproduzierbares Skript unter `tools/extract_firmware.*` ablegen (wahlweise Python/Shell/Rust), das vorhandene Eingabe prüft, keine Originaldatei überschreibt und eine Datei-/Hashliste erzeugt.
6. Architektur des Kernel- und ELF-Formats mit mehreren Methoden bestimmen: `file`, `readelf -h`, ELF-Machine-ID, Kernel-Strings, ggf. Toolchain-/Systembibliotheksidentifikation. `0x1040` **nicht ohne Nachweis** pauschal als MIPS, ARM oder PowerPC deklarieren.

**Ergebnis:** `results/EXTRAKTION.md` mit Befehlen, Versionsständen, Original- und Partitions-Hashes, Architekturbelegen.

## 3. Arbeitsphase B – Startkette und Signaturprüfungen

**Auftrag:** Vollständige, durch Fundstellen gestützte Graphik vom Bootvorgang bis zum App-Start erstellen.

Zu untersuchen:
- `/etc/initrc`, `/usr/target/startrc`, `/etc/fstab`, `tvsh`, `pied`, `fifosh`, `automountd`.
- `customer_download`, `sig_key`, `crypto_key`, SIG-Prüfpfade; keine Änderung an Originalfirmware.
- `app_upd`, `/usr/local/ajaxce/cert/appinfo.pub.der`, App-Paketmetadaten, Verifikationsfunktionen, Startparameter, Speicherorte.
- Referenzen auf `app_loader.js`, `/data`, `/work`, `/auto/apps_nv` sowie Logik zum Nachladen eines App-Startskripts.

Erzeuge einen kontrollflussorientierten Bericht: *Wer startet was? Woher stammt die Startadresse? Woher stammen Apps? Was wird signiert oder geprüft? Welche Pfade sind aus dem Update allein nicht rekonstruierbar?*

**Wichtig:** Das Updatepaket enthält nicht `fma16`, `fma18`, `fma20`. Lücken aus fehlenden Daten nicht mit Vermutungen ausfüllen. Dateihashes und die Signaturprüfung des bereitgestellten Skripts erneut ausführen, aber ihre Reichweite nicht überdehnen.

**Ergebnis:** `results/STARTKETTE.md` mit Ablaufdiagramm, Prüfpunkt-Tabelle und offenen Kanten.

## 4. Arbeitsphase C – JavaScript/App-Loader und Entwicklerplattform [erste Codeausführungschance]

**Fragestellung:** Lässt sich ohne Root ein eigener `boot_url`-Wert oder ein eigener HTML-/JavaScript-Einstieg über eine für Benutzer erreichbare Oberfläche übergeben?

1. `ajaxceplay` statisch untersuchen: Kommandozeilenparameter, `boot_url`, Behandlung von `file://` und `http://`, „restricted mode“, dynamische Bibliotheken und Startaufrufe. **Nicht** nur Strings zitieren; für relevante Funktionen disassemblierte Kontrollflüsse und Aufrufer prüfen.
2. Alle App-Registrierungsmechanismen erfassen: Manifeste, Katalogeinträge, App-Metadaten, Zertifikate, `app_upd`, Fehlerbehandlung, lokale Cache-/Datenverzeichnisse.
3. Historische offizielle VIERA-Connect-Entwicklerdokumentation recherchieren und besonders nach dem lokalen `sdkapp/main.js`-Entwicklermodus suchen. **Keine** Annahme, dass dieser Dienst heute noch existiert oder auf diesem Modell vorhanden ist.
4. Separat nachsehen, ob vorhandene Browser-/DLNA-/Netzwerkoberflächen eine **explizite und legitime** URL-Eingabe erlauben, ohne Systemdateien zu verändern.
5. Dokumentieren, welche JavaScript-Funktionen vorhanden sind (älteres WebKit 537; kein Anspruch auf moderne Web-APIs). JavaScript-Ausführung nicht mit nativer Programmausführung verwechseln.
6. Erst wenn eine **belegte erreichbare** Methode vorliegt, einen harmlosen, flüchtigen „Hello World“-Test vorbereiten: sichtbarer Text oder einmaliger GET an einen selbst betriebenen lokalen Endpunkt. Keine Zugangsdaten verwenden, keine Persistenz schaffen.

**Ergebnis:** `results/APP_LOADER.md`: möglicher Eingabepunkt → Verarbeitung → Prüfungen → Ausführung; Bewertung und kleiner, schadloser PoC als Text/Dateien, keine automatische Installation.

## 5. Arbeitsphase D – `sd_testmode` und Datenträgermontage

Referenzen:

```text
/usr/local/javascript/wing/epop/epop.js
var sd_testmode = 0;
eval_js_file("file:///mnt/sdcard/epop_data.js");
eval_js_file("file:///mnt/sdcard/epop_config_data.js");
```

1. Alle Definitionen und Aufrufer von `sd_testmode`, `epop.init`, `eval_js_file`, `epop_data.js`, `epop_config_data.js` suchen.
2. Prüfen, ob externe Konfiguration, Werkseinstellung, NVRAM, Entwickleranwendung oder Startparameter diesen Schalter zur Laufzeit verändern können. Nicht allein aufgrund des Dateinamens vermuten.
3. In `automountd`, fstab und Mountskripten nachvollziehen, ob `/mnt/sdcard` USB, SD oder einen internen Datenträger bezeichnet, ob Pfad und Dateien am Modell erreichbar sind und ob Dateien tatsächlich eingelesen werden können.
4. Eine **nur lesende** Geräteprüfung planen, die die Mountzuordnung nachweist, ohne Flash oder Startkonfiguration zu schreiben.
5. Explizites Urteil: (a) Block nicht erreichbar, (b) offen/ungeklärt, (c) erreichbar mit reproduzierbarem, harmlosen Test.

**Ergebnis:** `results/SD_TESTMODE.md` mit mindestens einem Gegenargument zu jeder Behauptung.

## 6. Arbeitsphase E – `wlsup` und der Kernelmodulpfad [nur statisch]

Bekannte Fundstelle im Programm `wlsup`:

```text
/mnt/sdcard/ath6kl_14.ko
load /mnt/sdcard/ath6kl_14.ko
```

1. Disassemblieren, die Referenzen eindeutig ihren Funktionen und Aufrufbedingungen zuordnen.
2. Prüfen, ob Aufruf mit Gerätevariante, WLAN-Chipsatz, Build-Flag, Hardwareerkennung oder Werkstest verknüpft ist.
3. Klären, wer das `load` ausführt und ob Kernel bzw. Treiber weitere ABI-/Signatur-/Integritätsprüfungen verlangen.
4. Separat und nur theoretisch bewerten, ob die Pfadkontrolle überhaupt vom Benutzer erreichbar sein könnte.
5. **Keine** fremden oder selbst erzeugten `.ko`-Dateien auf den Fernseher kopieren oder laden; keine Tests mit Kernelabsturzrisiko ohne ausdrückliche Genehmigung.

**Ergebnis:** `results/KERNELMODUL.md` mit priorisiertem, aber nicht ausgeführtem Testkonzept.

## 7. Arbeitsphase F – Passive/lesende Untersuchung des EIGENEN Fernsehers [erst nach Offline-Phase]

Benötigt: aktuelle IP-Adresse des Fernsehers, gleiche lokale Netzumgebung. Niemals andere Hosts scannen. Zunächst aus Router-Daten oder TV-Netzwerkeinstellungen die IP bestimmen. **Keine Portangabe als garantiert behandeln.**

Beispiele für rein lesende Bestandsaufnahme (IP-Platzhalter vor Ausführung ersetzen):

```bash
TV_IP='192.168.1.100'  # BEISPIEL, durch echte IP ersetzen
nmap -sT -Pn -p 80,443,55000,55001,8080 "$TV_IP"
curl --connect-timeout 3 --max-time 5 -i "http://$TV_IP:55000/nrc/ddd.xml"
```

Vorsichtig und mit niedriger Rate abfragen, nicht automatisch massenhaft Requests generieren. UPnP/SSDP hat typischerweise UDP-Port 1900 (getrennt von TCP-Scan behandeln). Keine unauthentifizierten Steuerbefehle, die Gerätezustand verändern. Auch das Abrufen einer XML-Gerätebeschreibung beweist noch keinen Kommando- oder App-Zugang.

Falls Netzdienste gefunden werden: SOAP/HTTP-Aktionen, Authentifizierung und App-/Entwicklermöglichkeiten **durch passive Beobachtung und rein lesende Requests** beurteilen. Daten und Zeitpunkte dokumentieren; private Gerätekennungen in Reports anonymisieren.

**Ergebnis:** `results/NETZWERK.md` mit Port-/Endpoint-Tabelle, tatsächlichen Antwortbelegen, Sicherheitsbewertung.

## 8. Arbeitsphase G – Entscheidung: risikoärmster Proof of Concept

Das erste reale Ziel ist **Stufe 1**, nicht Root:

- Eine statische HTML-/JavaScript-Testanwendung, die Text auf dem Bildschirm anzeigt oder einen einzelnen lokalen Testaufruf sendet.
- Start durch einen legitim erreichbaren Browser-, App- oder Entwicklereinstieg; nur flüchtig und reversibel.
- Erfolg ausdrücklich nur bei Nachweis der Ausführung auf dem realen TV.
- Falls nur DLNA funktioniert: das als praktikable Jellyfin-Wiedergabe ohne eigene App dokumentieren, nicht als Sideloading deklarieren.

Dauerhafte Änderungen, Firmware-Flash, Service-Menü-Konfigurationsänderungen oder Treibermodule **erst nach ausdrücklicher Benutzerfreigabe**. Risiken und Rückweg vor jedem invasiven Versuch schriftlich angeben.

**Ergebnis:** `results/POC_PLAN.md` mit Voraussetzungen, Reproduktionsschritten, Erwartungswerten, Testprotokoll und begründetem Abbruchkriterium.

## 9. Arbeitsphase H – Jellyfin-Machbarkeit [erst nach belegtem JS-Einstieg oder als Alternativpfad]

Technischer Minimalumfang:

1. Jellyfin-Server lokal erreichen, anfangs mit Testkonto ohne Administrationsrechte.
2. Serverinfos/Medienliste über unterstützte HTTP-/JSON-Funktionen abrufen; CORS und alte TLS-Unterstützung berücksichtigen.
3. Wegen älterer JavaScript-Laufzeit moderne Syntax vermeiden, ggf. auf ES5 transpiliert bereitstellen. Kein `fetch` oder Media Source Extensions voraussetzen.
4. Die vom Gerät tatsächlich decodierbaren Formate und Übertragungswege ermitteln, insbesondere H.264/AAC/MP4 und gegebenenfalls DLNA oder HLS; Unterstützung nicht aus dem Modelljahr erraten.
5. Fernbedienungstasten und Vollbilddarstellung testen, erst dann eine kleine Oberfläche bauen.
6. Auf dem Fernseher keine Jellyfin-Administrator-Zugangsdaten speichern; lokale Testzugänge verwenden.

**Ergebnis:** `results/JELLYFIN_MVP.md` mit Funktions-/Codec-Matrix und Entscheidung „direkter JS-Client möglich / nur DLNA / weitere Voraussetzungen“.

## 10. Reihenfolge, Risiken und Abbruchregeln

| Weg | Erkenntniswert | Geräte-Risiko ohne Veränderung | Priorität |
|---|---|---|---|
| `ajaxceplay` / offizieller Entwicklermodus / App-Katalog | Hoch | Niedrig | P1 |
| `app_upd` / App-Signaturen / Startadresse | Hoch | Niedrig | P1 |
| `sd_testmode` + Mountpfade | Hoch | Niedrig, solange nur statisch | P1 |
| Verfügbare Netzwerkschnittstellen (nur lesen) | Mittel | Niedrig | P2 |
| `wlsup` / `.ko` statisch analysieren | Mittel | Niedrig, solange nur statisch | P3 |
| Kernelmodul tatsächlich laden | Ungewiss | Hoch | Ohne Freigabe verboten |
| Firmware neu signieren/flashen | Ungewiss | Sehr hoch | Ohne Freigabe verboten |
| UART/JTAG am offenen Gerät | Potenziell hoch | Physisches Risiko | Nur nach separater Freigabe und Modellprüfung |

**Abbruch und Rücksprache** bei: Hash-Abweichung der Quelle, Gefahr eines Bricks, fehlendem Rücksicherungsweg, nicht eindeutig eigener Zielhardware, erforderlichem Eingriff in Flash/NVRAM, Schlüsseln aus privater Infrastruktur oder Änderungen am WLAN-/Netzwerkbetrieb des Haushalts.

## 11. Berichtsformat

Jede neue Erkenntnis erhält dieses Format:

```markdown
### FUND-ID: <eindeutige Kennung>
- Status: BESTÄTIGT / INDIZ / HYPOTHESE / WIDERLEGT / NICHT GEPRÜFT
- Relevanz: JS-Sideloading / native Ausführung / Boot / App-Loader / Jellyfin
- Datei und Pfad:
- Offset/Zeilen/Funktion:
- Quell-Datei-SHA-256:
- Reproduktionsbefehl:
- Beobachtung:
- Alternative Erklärung / Gegenprobe:
- Sicherheitsrisiko:
- Nächster kleinstmöglicher Test:
```

Am Ende jeder Arbeitsetappe: drei Sätze unter `results/STATUS.md`: **Was wurde nachgewiesen? Was bleibt unklar? Was ist als Nächstes konkret zu testen?**

## 12. Akzeptanzkriterien für den Gesamtauftrag

Die Analyse ist erst dann erfolgreich abgeschlossen, wenn **entweder**

- mindestens ein harmloser eigener JS- oder Userland-Codepfad auf dem **echten TV** reproduzierbar funktioniert, inklusive Voraussetzungen und Einschränkungen,

**oder**

- die relevanten App- und Testladewege ausreichend analysiert sind, um die fehlende Berechtigung beziehungsweise den fehlenden Einstieg konkret nachzuweisen; weitere Eingriffe werden mit Risiken und Erfolgsaussichten begründet priorisiert.

Kein Root- oder Sideloading-Erfolg darf allein aus entpackten Dateien, offenen Netzwerkports, Versionen, verdächtigen Zeichenketten oder älteren Berichten extrapoliert werden.

## Quellen

- Originale Einzelbefunde und Hashwerte: `references/Panasonic_TX42ASW504_Pruefprotokoll.txt`.
- Ausführliche Voruntersuchung: `references/Panasonic_TX42ASW504_Firmwareanalyse.md`.
- Signaturprüfung: `references/Panasonic_TX42ASW504_Signaturpruefung.py`.
- Panasonic-Firmwarebeschreibung: https://av.jpn.support.panasonic.com/support/global/cs/tv/download/fw/eu_2014/down_eu_uk_cis_01.html
- SDDL-Entpackprojekt: https://github.com/theubusu/sddl_dec
- OpenCode Projektanweisungen (`AGENTS.md`): https://dev.opencode.ai/docs/rules/

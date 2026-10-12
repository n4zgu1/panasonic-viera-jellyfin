# Firmwareanalyse: Panasonic TX-42ASW504

**Untersuchungsdatum:** 11. Oktober 2026  
**Untersuchte Datei:** die vom Benutzer bereitgestellte `SDDL.SEC`  
**Fragestellung:** Lassen sich eigene Programme, insbesondere ein Jellyfin-Abspielprogramm, nachladen?

## Ergebnis

**Ein direkt nutzbarer Sideloading-Weg ist nicht nachgewiesen.** Die Datei enthält allerdings einen konkreten, standardmäßig abgeschalteten JavaScript-Ladezweig für Dateien von einer Speicherkarte. Außerdem gibt es in einem WLAN-Hilfsprogramm einen Verweis auf ein externes Kernelmodul. Das sind deutlich konkretere Ansatzpunkte als die bloße Annahme, ein altes Fernsehgerät müsse Sicherheitslücken besitzen. Sie sind dennoch kein funktionierender Jailbreak.

Die Firmware ließ sich entschlüsseln und zerlegen. Ihre Update-Datei ist zusätzlich digital signiert. Das erfolgreiche Entschlüsseln berechtigt daher nicht zu dem Schluss, dass eine veränderte Datei installiert werden kann.

Eine vorhandene Android-APK lässt sich nicht einfach übernehmen: In diesem Paket wurde eine FreeBSD-basierte, gerätespezifische Laufzeitumgebung vorgefunden, nicht Android.

## 1. Identifikation und Methode

| Merkmal | Befund |
|---|---|
| Eingabedatei | `SDDL.SEC` |
| Größe | 111,482,640 Bytes |
| SHA-256 | `e914311a30f5582a54d280ee324ba3ab11ed124b160919dd2496cb93b02bb72e` |
| Versionsdatei | `/usr/target/version.txt`: `3.073` |
| Rekonstruierte Bestandteile | `PEAKS.bin`, `BOOT.bin`, `STM.bin` |
| Extrahierte Dateisysteme | Drei UFS2-Dateisysteme und eine JFFS2-Variante |
| Reguläre extrahierte Dateien | 7,373 |
| Ausführung auf dem Fernseher | Nicht erfolgt |

Die offizielle Panasonic-Seite führt den TX-42ASW504 unter den unterstützten Geräten für Version 3.073 vom 21. April 2020 auf. Die ZIP-Datei auf dieser Seite ist größer als die hier untersuchte, entpackte SEC-Datei; die beiden Dateigrößen dürfen nicht gleichgesetzt werden. [1]

Die Entschlüsselung und Containerzerlegung erfolgten mit einer lokalen Python-Umsetzung der im Projekt `sddl_dec` dokumentierten Struktur. Es wurde nicht das fertige Rust-Programm ausgeführt. Anschließend wurden die Partitionen getrennt, komprimierte Bereiche dekomprimiert und die Dateisysteme lesend extrahiert. Das Projekt beschreibt den hier tatsächlich vorgefundenen PEAKS-/UFS-Aufbau auch für bestimmte spätere, einfachere Panasonic-Modelle. [2, 3]

Die Dateien wurden auf relevante Start-, Geräte-, Entwickler- und Installationsmerkmale durchsucht. Wichtige Konfigurationen und Skripte wurden gezielt gelesen; native Programme wurden anhand ihrer Dateiköpfe und eingebetteten Zeichenketten geprüft. Das ist keine vollständige manuelle Prüfung sämtlicher Dateien oder vollständige Disassemblierung des Systems.

## 2. B01: Tatsächliches Betriebssystem

Im Kernel steht bei Dateioffset `0x4699ac`:

```text
FreeBSD 9.2-STABLE #0 4bea042: Wed Apr  1 14:52:28 JST 2020
```

Der ELF-Kopf von `/sbin/init` weist 32-Bit-Programme in Big-Endian-Anordnung und die FreeBSD-ABI aus. Die Maschinenkennung lautet `0x1040`. Kernelpfade enthalten die Zielbezeichnung `ipp`. Eine konkrete CPU- oder Chipbezeichnung wurde daraus nicht abgeleitet, weil sie in dieser Untersuchung nicht unabhängig abgesichert wurde.

**Bedeutung:** Selbst nach einem erfolgreichen Systemzugriff müsste eigener nativer Code zur CPU, ABI und Bibliotheksumgebung passen. Ein gewöhnliches ARM-/x86-Linux-Programm oder eine Android-APK wird nicht durch das bloße Kopieren kompatibel. Für eine Jellyfin-Anwendung kämen eine angepasste JavaScript-Anwendung oder eine passende native Portierung in Betracht; deren Video-, Audio- und Bedienfunktionen wären zusätzlich zu prüfen.

## 3. B02: Firmware-Signatur rechnerisch bestätigt

In `/usr/local/customer_dl/sig_key` liegt ein öffentlicher RSA-Schlüssel. Mit diesem Schlüssel ließ sich die Signatur der hochgeladenen SEC-Datei erfolgreich prüfen:

| Prüfung | Ergebnis |
|---|---|
| RSA-Modulus | 1.024 Bit |
| Öffentlicher Exponent | 17 |
| Signaturverfahren | RSASSA-PKCS1-v1_5 mit SHA-1 |
| Signatur | Letzte 128 Bytes der Datei |
| Signierter Inhalt | Alle vorangehenden 111,482,512 Bytes |
| Original | Gültig gemäß dem extrahierten Schlüssel |
| Eine veränderte Datenstelle, gleiche Signatur | Vom lokalen Prüfprogramm abgelehnt |

Die Prüfung erfolgte sowohl über den mathematischen RSA-Prüfblock als auch mit der Python-Bibliothek `cryptography`. Im Negativtest wurde ausschließlich eine Kopie der signierten Daten im Arbeitsspeicher verändert. Die hochgeladene Datei blieb unverändert.

Das Update-Programm `/usr/local/bin/customer_download` enthält die zugehörigen Pfade `sig_key`, `crypto_key` und `SIG.tmp` sowie die Meldung „Please wait, verifying download.“ Das stützt die Zuordnung zum Update-Prüfverfahren.

**Bedeutung:** Entschlüsseln und danach erneut verschlüsseln ersetzt keine gültige Signatur. Der Entschlüsselungsschlüssel ist nicht der zum Signieren erforderliche private RSA-Schlüssel. Eine veränderte Firmware ist deshalb nicht automatisch ein installierbares Update.

**Grenze des Befunds:** Es wurde nicht auf dem Fernseher getestet, ob jeder Update- und Wiederherstellungspfad die Prüfung tatsächlich korrekt erzwingt. Auch die vollständige Startkette wurde nicht untersucht. Die Rechnung beweist die gültige Signatur unter dem extrahierten Schlüssel, nicht die Fehlerfreiheit aller Prüfroutinen oder die Unmöglichkeit einer Umgehung. Der Schlüssel wurde nicht zusätzlich mit einem unabhängig vertrauenswürdigen Schlüssel des laufenden Geräts verglichen.

## 4. B03: Abgeschalteter Ladezweig für JavaScript von Speicherkarte

Die Datei `/usr/local/javascript/wing/epop/epop.js` enthält tatsächlich folgende Stellen:

```javascript
// Originalzeile 3:
var sd_testmode = 0;

// Originalzeilen 102–105, gekürzt:
this.init = function (config) {
    if (sd_testmode) {
        eval_js_file ("file:///mnt/sdcard/epop_data.js");
        eval_js_file ("file:///mnt/sdcard/epop_config_data.js");
        // ...
```

Bei aktivem Testmodus würde der vorliegende Skriptzweig JavaScript-Dateien von einem externen Pfad auswerten. Die ausgelieferte Einstellung ist jedoch `0`, also abgeschaltet. In diesem Skript wurden keine weiteren Zuweisungen gefunden, die den Schalter einschalten. Der normale Zweig lädt stattdessen interne Daten aus `/usr/local/javascript/wing/epop/`.

**Bewertung:** Ein externer JavaScript-Ladezweig ist im Quelltext belegt. Nicht belegt ist eine vom Benutzer erreichbare Aktivierung. Einfach die genannten Dateien auf einen Datenträger zu kopieren, ist daher keine nachgewiesene Anleitung. Ebenso ungeprüft bleibt, welcher tatsächlich verfügbare Datenträger am konkreten Fernseher als `/mnt/sdcard` erscheint; der Pfad darf nicht ohne Prüfung mit jedem USB-Anschluss gleichgesetzt werden.

## 5. B04: Verweis auf einen externen WLAN-Treiber

Im nativen Hilfsprogramm `wlsup` wurden diese Zeichenketten gefunden:

```text
0x33cf  /mnt/sdcard/ath6kl_14.ko
0x3450  load /mnt/sdcard/ath6kl_14.ko
```

Die Datei liegt im extrahierten Grundsystem unter `/user/local/bin/wlsup` und wird über eine Verknüpfung unter `/usr/local/bin/wlsup` bereitgestellt. Der Kontext enthält weitere WLAN-Steuerungsmerkmale wie `ath6kl` und `net.wlan_init`.

**Bewertung:** Das ist ein konkreter Hinweis auf einen externen Kernelmodul-Ladeweg. Ein nachgewiesener Programmaufruf auf dem laufenden Gerät ist es nicht. Es wurde nicht geklärt, welche Programmverzweigung den Pfad benutzt, ob sie im Serienbetrieb erreichbar ist, welche Rechte nötig wären oder ob weitere Modulprüfungen stattfinden. Es wurde kein fremdes Kernelmodul erstellt, geladen oder auf dem Fernseher getestet.

Eine manipulierte Treiberdatei ist aus diesen Zeichenketten allein weder als akzeptiert noch als sicher ableitbar. Ein solcher Versuch könnte zum Absturz führen.

## 6. B05: JavaScript-Laufzeit und echter Entwicklerbildschirm

Das Paket enthält `/usr/local/bin/ajaxceplay`. Seine eingebettete Bedienhilfe nennt eine `boot_url`; bei URLs ohne passenden Ressourceneintrag wird ein eingeschränkter Ausführungsmodus beschrieben. Die Umgebung kann also grundsätzlich JavaScript-Anwendungen über Startadressen aufrufen. Damit ist aber noch keine Möglichkeit nachgewiesen, wie der Benutzer eine beliebige Adresse als Anwendung starten oder installieren könnte.

Zusätzlich wurde aus der JFFS2-Partition das Skript `update_device_data.js` extrahiert. Es enthält einen Bildschirm mit der Überschrift „For developers only“ und Funktionen für:

- Abfrage der Seriennummer;
- Änderung von Gerätedaten;
- Wiederherstellung von Gerätedaten.

Die entsprechenden Methoden heißen `get_serial_number`, `update_device_data` und `restore_device_data`. Das Skript enthält auch eine versteckte Tastenfolgenprüfung. **Diese Funktionen sind kein belegter App-Installierer.** Ihre Existenz darf nicht mit einem freigeschalteten Entwicklerkonto oder mit beliebiger Codeausführung gleichgesetzt werden.

Das Programm `app_upd` verweist außerdem auf eine Datei `appinfo.pub.der` mit einem öffentlichen RSA-Schlüssel. Das ist ein Hinweis auf zusätzliche Prüfmechanismen bei Anwendungsinformationen. Eine vollständige Prüfung der App-Paketverifikation wurde nicht durchgeführt.

## 7. B06: Kommandointerpreter vorhanden, aber kein belegter Fernzugang

`/etc/initrc` wählt `/usr/target/startrc` als Startziel. Eine alternative Zeile für `/usr/bin/sash` ist auskommentiert. `startrc` startet unter anderem `automountd`, `fifosh` und `pied` und übergibt schließlich an `tvsh`.

Ein Kommandointerpreter ist also vorhanden. Daraus folgt nicht, dass der Benutzer ihn über Netzwerk oder USB erreichen kann. In den untersuchten Startkonfigurationen wurde kein aktivierter SSH-/Telnet-Fernzugang nachgewiesen. `fifosh` verweist auf eine lokale Kommunikationsdatei unter `/tmp`; das ist kein belegter, über das Netzwerk offener Kommandozugang.

`/etc/fstab` hängt `/usr` ausdrücklich schreibgeschützt ein. Es nennt jedoch auch beschreibbare Bereiche wie `/work` und `/auto/apps_nv`. Für dauerhaft nachgeladene Programme wären sowohl ein beschreibbarer Ablageort als auch ein erreichbarer Startmechanismus erforderlich. Der zweite Teil ist hier nicht nachgewiesen.

## 8. B07: Wichtige Grenze – Update-Paket statt vollständiger Gerätekopie

| Partition | Inhalt | Reguläre extrahierte Dateien |
|---|---|---:|
| fma3 | Kernel | Kein Dateisystem |
| fma4 | Grundsystem, UFS2 | 80 |
| fma5 | `/usr`, UFS2 | 7255 |
| fma6 | `/lsidata`, UFS2 | 22 |
| fma7 | AJAX-Konfiguration, JFFS2-Variante | 16 |

Die Startparameter beschreiben weitere Partitionen, die in diesem PEAKS-Update nicht enthalten sind. Dazu zählen insbesondere `/data`, `/work` und die beschreibbare Anwendungsablage. Vorhandene Anwendungskonfigurationen verweisen auf `/data/startup/ssl/app_loader.js`; diese Datei war nicht Bestandteil des untersuchten Updates.

Das ist eine sachlich wichtige Grenze: Nicht alle später gestarteten Anwendungs- und Installationsbestandteile konnten untersucht werden. Aus dem fehlenden Nachweis eines Startwegs in diesem Paket folgt nicht, dass auf dem vollständigen Gerät kein solcher Weg existieren kann.

## 9. Schlussfolgerung für Sideloading und Jellyfin

| Frage | Ergebnis dieser Untersuchung |
|---|---|
| Firmware entschlüsselbar? | Ja, praktisch durchgeführt. |
| Dateisysteme einsehbar? | Ja, vier enthaltene Dateisysteme extrahiert. |
| Beliebige Android-APK direkt passend? | Nein, nicht zur vorgefundenen FreeBSD-Laufzeit. |
| JavaScript von externem Datenträger im Code vorgesehen? | Ja, in einem abgeschalteten Testzweig. |
| Aktivierung dieses Testzweigs nachgewiesen? | Nein. |
| Externer nativer Ladeweg vorhanden? | Ein Treiberpfad ist belegt, dessen Erreichbarkeit nicht. |
| Entwicklerbildschirm vorhanden? | Ja; die geprüften Funktionen betreffen Gerätedaten. |
| Modifizierte Firmware einfach wieder installierbar? | Nicht nachgewiesen; gültige Signatur ist eine konkrete Hürde. |
| Root-Zugang oder funktionierender Jailbreak nachgewiesen? | Nein. |
| Jellyfin auf dem Gerät installiert oder getestet? | Nein. |

**Die entscheidende offene Frage lautet nicht mehr, ob das System überhaupt eigenen Code ausführen könnte, sondern ob einer der vorgefundenen Ladewege ohne bereits vorhandenen Systemzugriff erreichbar ist. Dafür liefert die statische Analyse konkrete Fundstellen, aber noch keinen Funktionsnachweis.**

## Quellen und Prüfdaten

Die Befunde B01 bis B07 beruhen auf der hochgeladenen Firmware. Datei-Hashes, genaue Fundstellen und die Signaturprüfung sind in `Panasonic_TX42ASW504_Pruefprotokoll.txt` dokumentiert. Das separat bereitgestellte Prüfskript reproduziert die Signaturprüfung und den Negativtest, ohne Firmware-Code auszuführen oder die Eingabedatei zu verändern.

[1] Panasonic: Firmware 3.073, unterstützte Modelle und Veröffentlichung.  
https://av.jpn.support.panasonic.com/support/global/cs/tv/download/fw/eu_2014/down_eu_uk_cis_01.html

[2] theubusu: sddl_dec, Formatbeschreibung und PEAKS-/UFS-Aufbau.  
https://github.com/theubusu/sddl_dec

[3] theubusu: Quelltext der Container- und Entschlüsselungsdefinitionen.  
https://raw.githubusercontent.com/theubusu/sddl_dec/main/src/include.rs

[4] FreeBSD: UFS-Inode- und Dateisystemdefinitionen, für die strukturelle Extraktion herangezogen.  
https://raw.githubusercontent.com/freebsd/freebsd-src/main/sys/ufs/ufs/dinode.h  
https://raw.githubusercontent.com/freebsd/freebsd-src/main/sys/ufs/ffs/fs.h

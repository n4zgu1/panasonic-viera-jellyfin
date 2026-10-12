# Forschungsstand

## Bestätigt

- Untersuchtes ursprüngliches Gerät: Panasonic **TX-42ASW504**, Viera Connect, Firmware **3.073**.
- Eigener ES5-Code läuft im regulären TV-Browser; XHR/JSON zu Jellyfin funktionieren über den lokalen Proxy.
- Eine normale Home-Lesezeichen-Kachel startet den eigenen Client.
- HLS-Filmstart mit H.264 Main / 720p / 8 Bit und AAC-Stereo wurde auf dem echten Gerät vom Benutzer bestätigt und mit einem `playing`-Rückruf korreliert.
- Audiospur- und Zielbitratenauswahl werden mit Jellyfin über `PlaybackInfo`/`DeviceProfile` ausgehandelt.
- Die Firmwareextraktion ergab 7373 reguläre Dateien. Größen und Referenzhashes wurden lokal verglichen; Originalsignatur und eine negative Signaturprobe rechnerisch geprüft.

## Grenzen

Eine Home-Verknüpfung ist keine native Paketinstallation. Root-Zugriff, Firmware-Signaturumgehung oder ein freigeschalteter SDK-Login sind nicht nachgewiesen. Erfolgreiche Wiedergabe auf dem Testgerät ist keine pauschale Zusicherung für alle Viera-Modelle; ein später identifizierter TX-47AS750W wurde noch nicht entsprechend validiert.

Die Firmware zeigt FreeBSD und eine noch nicht vollständig unabhängig zugeordnete ELF-Maschinenkennung. Vorhandene Pfade und Schlüsselreferenzen sind keine Ausführungs- oder Umgehungsbeweise. Die im Update fehlenden Gerätedatenpartitionen begrenzen die statische Analyse.

## Entwicklerwege und Dokumentation

Panasonic führt ASW504 historisch sowohl für AJAX-CE als auch für HTML5 auf:

- [Offizielle AJAX-CE-Modellliste, archiviert 2016](https://web.archive.org/web/20161105093751id_/http://developer.vieraconnect.com:80/intro/development-guide/device-guidelines-old/ajax-ce)
- [Offizielle HTML5-Modellliste, archiviert 2016](https://web.archive.org/web/20161105094226id_/http://developer.vieraconnect.com:80/intro/development-guide/device-guidelines-old/html5)
- [Offizielles Entwicklerportal, archiviert 2024](https://web.archive.org/web/20240302131507id_/https://developer.vieraconnect.com/)
- [Offizieller historischer Umgebungsaufbau](https://web.archive.org/web/20111019134020id_/http://developer.vieraconnect.com:80/intro/development-guide/development-environment-setup)
- [Panasonic-Pressemitteilung zur Entwicklerplattform](https://news.panasonic.com/global/press/data/en110706-3/en110706-3.pdf)
- [Entwicklerbericht zu AJAX-CE](https://mattpilz.com/project-postmortem-panasonic-viera-connect-part-2/)

AJAX-CE verwendet proprietäre Stage-/Grafik-APIs und historisch `sdkapp/main.js`; HTML5 verwendet `sdkhtml/main.html` und `init.json`. Beide installierten Entwickler-Apps zeigten im Test eine Anmeldung. Ein verifiziertes Standardpasswort oder ein passwortfreier SDK-Start wurde nicht gefunden. Der praktisch genutzte Weg ist daher die reguläre Browser-Kachel.

Das unter `platform/panasonic` vorbereitete Quelllayout ist kein nachgewiesenes TV-Installationspaket. Archive dokumentieren historische Aussagen, nicht die heutige Verfügbarkeit von Herstellerdiensten.

## Lokale Nachweise

Detailberichte, private Gerätebeschreibungen, HTTP-Protokolle und kurze Medienproben bleiben in den ignorierten Verzeichnissen `results/` und `work/`. Die Werkzeuge erzeugen reproduzierbare Zeitstempel-/Hashberichte. Im Repository sind nur der eigene Code, Tests, textuelle Ausgangsreferenzen und diese zusammengefassten Ergebnisse enthalten.

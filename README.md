# Panasonic Viera Jellyfin

Ein schlanker **ES5-Jellyfin-Client für ältere Panasonic-Viera-Connect-Fernseher** und ein lokaler Node.js-Reverse-Proxy. Der Proxy verbindet den TV mit einem Jellyfin-Server im LAN oder über die Tailscale-Verbindung des Host-Rechners.

**Praktisch bestätigt:** Start über eine eigene Home-Lesezeichen-Kachel und HLS-Filmwiedergabe auf einem **TX-42ASW504**, Firmware 3.073. Ein TX-47AS750W wurde zusätzlich im Netzwerk identifiziert; dessen Wiedergabe ist noch nicht nachgewiesen. Es handelt sich um einen Browser-Client, nicht um einen Jailbreak oder eine native Paketinstallation.

## Funktionen

- Anmeldung und optional automatische Anmeldung mit lokal hinterlegtem Testkonto
- Bibliotheken, Filme, Suche und Fernbedienungsnavigation
- Auswahl der Audiospur und **1 / 2 / 4 / 6 / 8 / 12 Mbit/s** Zielbitrate
- konservatives Jellyfin-Transcoding: H.264 Main, bis 720p, 8 Bit, AAC-Stereo
- HLS/MPEG-TS oder HTTP-MP4, Fortsetzen, Play/Pause und +/-30 Sekunden
- Sitzungsbezogenes Beenden der gestarteten Transcodes
- Keine modernen Browser-Abhängigkeiten wie `fetch`, JavaScript-Module oder MSE im TV-Client

## Voraussetzungen

- Node.js **22 oder neuer** auf dem Rechner, der den Proxy betreibt
- TV und Proxy-Rechner im selben erreichbaren LAN
- Jellyfin-Server mit für das verwendete Konto erlaubtem Video-/Audio-Transcoding
- Python 3.10+ nur für die optionalen Build-/Analysewerkzeuge
- `ffprobe` nur für die optionalen Live-Medienprüfungen

Der normale Clientbetrieb benötigt keine Firmwaredatei und keine Python-Pakete.

## Start

```sh
npm ci
cp -n config/example.json config/local.json
```

`config/local.json` mit den eigenen Adressen bearbeiten:

```json
{
  "bind": "192.168.1.10",
  "port": 8765,
  "tv": "192.168.1.20",
  "upstream": "http://192.168.1.30:8096",
  "testAccount": null
}
```

`bind` ist die LAN-IP des Proxy-Rechners; `tv` die ausdrücklich ausgewählte TV-IP. `upstream` ist die HTTP-Origin des eigenen Jellyfin-Servers, ohne Unterpfad. Bei Tailscale kann dort die Tailscale-Adresse des Servers stehen. Der Proxy bindet nur an `bind` und akzeptiert Anfragen von diesem Rechner und dem konfigurierten TV.

```sh
npm start
```

Der Server zeigt die URLs an und legt ein neues Laufverzeichnis unter `work/` an. Auf dem TV öffnen:

```text
http://<LAN-IP-des-Proxy-Rechners>:8765/viera
```

Weitere CLI-Optionen:

```sh
node tools/jellyfin_proxy.mjs --help
node tools/jellyfin_proxy.mjs --config config/local.json --output work/my-new-run
```

Der Proxy-Rechner muss während der Nutzung laufen und den Jellyfin-Server erreichen können. Beenden mit `Ctrl+C` im Serverterminal.

### Automatische Anmeldung

In der **nicht versionierten** Datei `config/local.json` optional `testAccount` setzen:

```json
"testAccount": {
  "Username": "<DEIN_TESTBENUTZER>",
  "Pw": "<DEIN_TESTPASSWORT>"
}
```

Der TV erhält nur die reguläre Jellyfin-Sitzung; die festen Zugangsdaten liegen im lokalen Proxy. Ohne konfiguriertes Testkonto ist die automatische Anmeldung deaktiviert (HTTP 503 am lokalen Auto-Login-Endpunkt); das normale Anmeldeformular kann verwendet werden. Nach explizitem Abmelden erfolgt keine sofortige automatische Neuanmeldung.

## Eigene Home-Kachel

1. `/viera` im normalen TV-Browser öffnen und als Lesezeichen speichern.
2. HOME → Einstellungen/Startbildschirm bearbeiten → **Lesezeichen hinzufügen**.
3. Das gespeicherte Lesezeichen „Viera Jellyfin“ auswählen.

Dieser Weg wurde auf dem TX-42ASW504 praktisch bestätigt. Die Bezeichnungen/Verfügbarkeit können modellabhängig sein. Die Kachel lässt sich über die normalen TV-Menüs wieder entfernen.

## Wiedergabe

In den Filmdetails mit **OK** die Tonspur, Zielbitrate und das Format wechseln. Ein sinnvoller Anfang ist **Deutsch / 4 Mbit/s / HLS**. Die Originalbitrate wird separat angezeigt; die Zielbitrate ist keine gemessene Netzwerkgeschwindigkeit.

HLS mit H.264/720p/AAC ist am genannten Testgerät praktisch bestätigt. HTTP-MP4, einzelne Fernbedienungsfunktionen und langfristige Stabilität sind nicht pauschal für jedes Viera-Modell verifiziert. Bei Änderungen die Seite vollständig neu laden, damit keine alte Clientinstanz weiterläuft.

## Tests

```sh
npm test
npm run test:bundle
```

Diese Tests verwenden lokale Mock-Dienste und eigene Beispieldaten. Sie benötigen weder echte TV-/Jellyfin-Zugänge noch Firmware. GitHub Actions führt dieselben Tests aus.

Optionale Live-Prüfungen verwenden die lokale Konfiguration (oder `VIERA_ORIGIN`) und benötigen den laufenden Proxy:

```sh
node tools/check_viera_ui_live.mjs work/ui-check-new
node tools/check_matrix_transcode.mjs work/transcode-check-new
```

Der zweite Test ist die gezielte Diagnose des während der Entwicklung gemeldeten Films. Er liest kurze Medienproben, beendet nur seine eigenen Encoding-Sitzungen und ersetzt keinen Wiedergabetest auf dem TV.

## Projektstruktur

| Pfad | Inhalt |
|---|---|
| `web/viera/` | eigener HTML-/CSS-/ES5-Client |
| `tools/jellyfin_proxy.mjs` | lokaler Proxy |
| `tools/proxy_config.mjs` | Konfigurationsvalidierung |
| `config/example.json` | veröffentlichbare Beispielkonfiguration |
| `platform/panasonic/` | Vorbereitung des dokumentierten HTML5-Quelllayouts |
| `tools/` | Tests, optionale Offline-Analyse und gezielte Diagnosen |
| `references/` | ursprüngliche textuelle Firmwarebefunde und Signaturprüfskript |
| `docs/RESEARCH.md` | zusammengefasster Forschungsstand und Internetquellen |
| `TASKS.md`, `AGENTS.md` | ursprünglicher Untersuchungsplan und Grenzen |

`inputs/`, `work/`, lokale Konfiguration und detaillierte `results/` sind Arbeitsbereiche und werden von Git ausgeschlossen. Das Repository enthält keine Firmware, entpackten Geräteprogramme, Netzwerkmitschnitte, Geräte-Zertifikate oder echten Anmeldedaten.

## Optionale Firmwareanalyse

Die Analysewerkzeuge beziehen sich auf die genau in `references/` dokumentierte TX-42ASW504-Firmware. Eigene Originaldateien gehören ausschließlich lokal nach `inputs/` bzw. `work/`. Der Firmwarevergleich und die Extraktion sind vom Clientbetrieb unabhängig. Details: `TASKS.md`.

Lizenz-/Herkunftshinweise zu übernommenen Bestandteilen: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

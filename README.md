<img src="build/icon.png" width="64" height="64" alt="">

# Flusstext

Lokale Transkription und Diktat für Windows: eine Electron-App mit deutscher Oberfläche, die ausschließlich Open-Source-Modelle offline nutzt.

- **Diktat überall (wie Wispr Flow):** `Strg` + `Win` halten, sprechen, loslassen, und der Text wird ins aktive Textfeld eingefügt. Kurz antippen startet freihändiges Diktat. `Esc` bricht ab, `Alt` + `Umschalt` + `Z` fügt das letzte Diktat erneut ein. Die Zwischenablage wird danach wiederhergestellt. Eine schmale Pille unten am Bildschirm startet das Diktat auch per Klick.
- **Dateien transkribieren:** Audio und Video lassen sich per Drag & Drop hinzufügen und werden über eine Warteschlange verarbeitet. Das Ergebnis enthält satzweise Zeitstempel und Sprechererkennung (Diarisierung).
- **Live-Aufnahme:** fortlaufende Mitschrift mit Pegelanzeige, Lesezeichen und Notizen. Sprecher werden nach dem Stopp zugeordnet.
- **Transkript-Ansicht:** Wellenform in Sprecherfarben, Wort-für-Wort-Hervorhebung beim Abspielen, Redeanteile, Notizen und Lesezeichen. Sätze per Doppelklick bearbeiten, Absätze anderen Sprechern zuordnen, Sprecher umbenennen oder zusammenführen. Export nach Word, TXT, Markdown, SRT, VTT und JSON.
- **Volltextsuche** über alle Transkripte (`Strg` + `K`), Diktat-Verlauf und Wörterbuch für Namen und Fachbegriffe.
- **Modell-Manager:** Download mit Fortschritt; die whisper.cpp-GPU-Laufzeit wird automatisch mitinstalliert.

## Modelle

Alle Modelle sind frei nutzbar (nicht-kommerziell und überwiegend auch kommerziell).

| Modell | Engine | Größe | Deutsch | Lizenz |
|---|---|---|---|---|
| **Parakeet TDT 0.6B v3** (Standard) | sherpa-onnx, CPU | 487 MB | sehr gut, 25 Sprachen | CC-BY-4.0 |
| FastConformer Deutsch | sherpa-onnx, CPU | 108 MB | gut, extrem schnell | CC-BY-4.0 |
| Canary 180M Flash | sherpa-onnx, CPU | 154 MB | sehr gut (de/en/es/fr) | CC-BY-4.0 |
| Cohere Transcribe (2B) | sherpa-onnx, CPU | 1,7 GB | sehr gut, langsam | Apache-2.0 |
| **Whisper Large v3 Turbo Deutsch** (primeline) | whisper.cpp, GPU | 574 MB | exzellent | Apache-2.0 |
| Whisper Large v3 Turbo / Large v3 / Medium / Small / Base | whisper.cpp | 60 MB – 1,1 GB | gut bis exzellent | MIT |
| Segmentierung: Pyannote 3.0 (Standard), Reverb v1/v2 | sherpa-onnx | 7 / 11 / 254 MB | Sprechererkennung | MIT / Rev Non-Production (nur privat) |
| Stimmprofile: 3D-Speaker ERes2Net (Standard), WeSpeaker ResNet34/152/221/293, TitaNet Large/Small, SpeakerNet | sherpa-onnx | 23–114 MB | Sprechererkennung | Apache-2.0 / CC-BY-4.0 |
| Silero VAD | sherpa-onnx | 1 MB | Sprachaktivität | MIT |

Die Modelle liegen unter `%LOCALAPPDATA%\Flusstext\models`, Transkripte und Aufnahmen unter `%APPDATA%\Flusstext`.

## Entwicklung

Voraussetzung ist Node.js **22.12 oder neuer**. Der Electron-Installer und electron-builder laufen nicht mehr mit Node 20.

```bash
npm install
npm run dev        # App mit Hot-Reload starten
npm run typecheck
npm run dist       # Windows-Installer nach dist/ bauen
```

## Architektur

```
src/main/      Electron-Hauptprozess: Fenster (Mica, eigene Titelleiste), IPC, Modell-Downloads,
               Warteschlange, globaler Hotkey (uiohook-napi), Einfügen über die Zwischenablage, whisper.cpp-Server
src/engine/    utilityProcess mit sherpa-onnx: VAD, Diarisierung, Erkennung, Satzsegmentierung, Live-Modus
src/preload/   typisierte API für den Renderer (window.api)
src/renderer/  React + Tailwind v4: Hauptfenster (index.html) und Diktat-Pille (overlay.html)
src/shared/    Typen, Modellkatalog, Tastennamen
```

- **Audio:** ffmpeg (ffmpeg-static) dekodiert Dateien zu 16 kHz Mono. Mikrofonaufnahmen laufen über ein AudioWorklet.
- **Lange Aufnahmen:** Silero VAD teilt sie in Abschnitte von höchstens 24 s. Bei Bedarf werden die Abschnitte über Wort-Zeitstempel den Sprechern aus der Diarisierung zugeordnet.
- **Sprechererkennung:** Die Clustering-Schwellwerte sind pro Stimmprofil-Modell kalibriert (`EMBEDDING_THRESHOLDS` in `src/shared/catalog.ts`). Kalibriert wurde auf deutschen 2- und 3-Personen-Gesprächen sowie den sherpa-onnx-Testaufnahmen mit 2 und 4 Sprechern. Sprecher mit weniger als 2 s Redezeit werden dem Nachbarn zugeordnet.
- **Whisper:** läuft als dauerhaft geladener `whisper-server.exe` (CUDA 12) auf localhost. Das hält die Diktat-Latenz auf der GPU bei unter einer Sekunde.

# Nemotron 3.5 Transcribe Lite für Windows

Dieser Export übernimmt den Ansatz von [FluidInference Transcribe Lite](https://github.com/FluidInference/FluidAudio/blob/main/Documentation/ASR/NemotronTranscribeLite.md): NVIDIAs Sprachencoder und CTC-Zeitstempelkopf ohne das große Sprachmodell. „Lite“ ist eine Community-Bezeichnung, keine eigenständige NVIDIA-Veröffentlichung.

Die ursprünglichen Modellgewichte stammen aus `nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B`, Revision `9d8cd6b79bfdd427b6558a5fdbf76fcaf8c75341`. Der Export lädt über begrenzte HTTP-Range-Anfragen ausschließlich die benötigten Sprachgewichte (ca. 1,46 GB). Er lehnt Serverantworten ab, die stattdessen das vollständige Modell liefern würden.

## Export

Python 3.11 mit einer separaten virtuellen Umgebung verwenden:

```powershell
python -m venv .venv-export
.venv-export/Scripts/python -m pip install -r scripts/nemotron-lite/requirements.txt
.venv-export/Scripts/python scripts/nemotron-lite/export.py --output out/nemotron-export
```

Die beiden INT8-Modelle sind eigenständige ONNX-Dateien ohne externe Tensor-Dateien. Zusammen mit `config.json`, `vocab.json`, `mel-window.bin`, `mel-filterbank.bin`, `LICENSE-OpenMDW.txt`, `LICENSE-NeMo.txt` und `NOTICE-NVIDIA.txt` bilden sie das veröffentlichte Modellverzeichnis. FP32-Modelle und deren externe Tensor-Dateien sind nur für die Exportprüfung bestimmt und werden nicht ausgeliefert.

Die Architektur entspricht NeMo Speech, Commit `16b0ff2584c6355c53cbd6c28f0f431a76b24956`. RoPE, LayerNorm, GELU, Feature-Stacking, die zweifache CTC-Hochskalierung und die Residualverbindung bleiben erhalten. Vollständige Softmax-Ausgaben werden durch Argmax über die identischen Logits ersetzt. Dynamische INT8-Quantisierung betrifft die linearen Projektionen. Das Modell wird nicht nachtrainiert.

## Laufzeit und Datenschutz

Flusstext verwendet den WebAssembly-Build von `onnxruntime-web` 1.22.0 im separaten `nemotron-worker`-Prozess. Damit gibt es keine native Windows-ONNX-DLL und keinen nativen Windows-Telemetrieprovider. Der Worker lädt sowohl das WASM-Programm als auch die Modelle direkt aus lokalen Dateien als Bytes. Der Emscripten-Loader wird auf die mitgelieferte lokale MJS-Datei festgelegt; es gibt keinen CDN-Fallback. Es wird ausschließlich der lokale WASM-CPU-Provider verwendet. Netzwerk-APIs werden vor dem Laden der Laufzeit im Worker gesperrt. Es gibt keinen Model-Hub-Client, keinen Cloud-Provider, keine Lizenzanmeldung und keine HTTP-Anfrage im Inferenzpfad.

Audio wird als 16-kHz-Mono-PCM über lokale Prozess-Pipes übergeben. Der Worker berechnet den NeMo-Mel-Frontend mit den Originaltabellen und normalisiert jeden vom bestehenden VAD erzeugten Abschnitt separat. Damit ist dies nicht identisch mit der Apple-Demo, die eine ganze Aufnahme normalisiert und überlappende Langzeitfenster verwendet. Wortanfänge stammen aus dem CTC-Raster von 40 ms. Die Sprecherzuordnung verwendet Flusstexts ausgewählte Diarisierungsmodelle.

## Prüfung

```powershell
npm run build
npm run test:nemotron
$env:NEMOTRON_TEST_MODEL = 'C:/models/nemotron-lite'
$env:NEMOTRON_TEST_AUDIO = 'C:/fixtures/english-16k-mono-pcm16.wav'
$env:NEMOTRON_TEST_EXPECT = 'fellow americans'
npm run test:nemotron
```

Der optionale echte Modelltest lädt das Modell, transkribiert mehrfach, prüft deterministische Ergebnisse und begrenzte Zeitstempel und behandelt leere Aufnahmen. Ein Test-Preloader blockiert JavaScript-HTTP-, DNS- und Socket-Zugriffe. Die verwendete WASM-Laufzeit hat keinen nativen Windows-Telemetriepfad.

Kurze Funktionstests sind kein Qualitätsbenchmark für Deutsch oder andere Sprachen. Das Modell bleibt experimentell und wird nicht als Standard empfohlen.

## Lizenzen

NVIDIAs Modellmaterialien unterliegen OpenMDW-1.1; die Original-Lizenz und Drittanbieterhinweise werden mitgeliefert. Die NeMo-Architektur steht unter Apache-2.0 (Copyright 2025–2026 NVIDIA CORPORATION & AFFILIATES). Die Exportartefakte enthalten eine Kopie der Apache-Lizenz und nennen die Quellen. ONNX Runtime steht unter MIT.

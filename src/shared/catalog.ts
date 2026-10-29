// Katalog aller herunterladbaren Open-Source-Modelle (alle URLs geprüft, Stand Oktober 2026).
import type { ModelDef } from './types'

const SHERPA_ASR = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'
const SHERPA_SEG = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models'
const SHERPA_EMB = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models'
const GGML = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
const WHISPER_CPP = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454'
const NEMOTRON_LITE = 'https://github.com/ExaCLe/flusstext/releases/download/nemotron-lite-onnx-v1'

/**
 * Clustering-Schwellwerte je Stimmprofil-Modell. Kalibriert auf deutschen 2- und 3-Personen-Gesprächen
 * sowie den sherpa-onnx-Testaufnahmen (2 und 4 Sprecher). Größer = weniger Sprecher.
 */
const EMBEDDING_THRESHOLDS: Record<string, number> = {
  'emb-eres2net-voxceleb': 0.85,
  'emb-wespeaker-resnet34': 0.4,
  'emb-wespeaker-resnet152': 0.3,
  'emb-wespeaker-resnet221': 0.2,
  'emb-wespeaker-resnet293': 0.3,
  'emb-titanet-large': 0.85,
  'emb-titanet-small': 0.85,
  'emb-speakernet': 0.8
}
const RECOMMENDED_EMBEDDING = 'emb-eres2net-voxceleb'

export const CATALOG: ModelDef[] = [
  {
    id: 'nemotron-3.5-transcribe-lite',
    name: 'Nemotron 3.5 Transcribe Lite',
    family: 'nemotron-lite',
    kind: 'asr',
    engine: 'onnx',
    description: 'Kompakte Variante ohne das große Sprachmodell. Läuft vollständig lokal auf der CPU, mit Wort-Zeitstempeln und der gewählten Sprechererkennung. Englisch geprüft; Deutsch und weitere Sprachen experimentell.',
    sizeMB: 700,
    speed: 2,
    accuracy: 0,
    languages: 'Englisch; weitere Sprachen experimentell',
    license: 'OpenMDW-1.1',
    source: 'https://huggingface.co/FluidInference/nemotron-3.5-transcribe-lite-coreml',
    experimental: true,
    files: ([
      ['encoder.int8.onnx', 637430704, '7efabc1252087f9799998c2f254f8c88ee27acc90536cb3d0232589ad3ce30cd'],
      ['ctc.int8.onnx', 62068283, '7a8aac59e9d325cd89127a0eb11159ce041954b01a47fae29538b0b4f3bf12d4'],
      ['mel-filterbank.bin', 131584, 'eb5cf9eb93b8038062ebc849b14ec85098abe1c915bc22262be8ad336bcf563a'],
      ['mel-window.bin', 1600, '6a66c2c694505b41b8987c4885a618e1a32612b43a4935a208a3c9c956b22d02'],
      ['vocab.json', 223876, '58990a54bbc4b786bda94fa20aa491b1d8f0f58b14f1343d42d510117b3c0d0c'],
      ['config.json', 340, 'ff3e9753f510e16e29e0db67be68d7e5cb1c4ba967d9101e1f4b7cadfdfa26e8'],
      ['LICENSE-OpenMDW.txt', 2694, '18c3a96fd1ee779263aa9210e3d962d5899511890254f3f3efd70ece81d89866'],
      ['LICENSE-NeMo.txt', 11357, 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4'],
      ['NOTICE-NVIDIA.txt', 2305, 'd61d7ca8e896ccc5de6573ce75cc91335fe7460718b8cd84a8f1312fd5b1b72c']
    ] as const).map(([name, size, sha256]) => ({ name, size, sha256, url: `${NEMOTRON_LITE}/${name}` })),
    requires: ['vad-silero']
  },
  // ------------------------------------------------------------ Spracherkennung (sherpa-onnx, CPU)
  {
    id: 'parakeet-tdt-0.6b-v3',
    name: 'Parakeet TDT v3',
    family: 'parakeet',
    kind: 'asr',
    engine: 'sherpa',
    sherpaType: 'nemo_transducer',
    description:
      'NVIDIAs mehrsprachiges Spitzenmodell: sehr genau, schnell auf jeder CPU, mit Satzzeichen und Wort-Zeitstempeln. Erkennt die Sprache automatisch.',
    sizeMB: 487,
    speed: 4,
    accuracy: 5,
    languages: '25 europäische Sprachen',
    license: 'CC-BY-4.0',
    source: 'https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3',
    recommended: true,
    dictation: true,
    files: [],
    archive: { url: `${SHERPA_ASR}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`, size: 487170055, stripRoot: true },
    requires: ['vad-silero']
  },
  {
    id: 'nemo-fastconformer-de',
    name: 'FastConformer Deutsch',
    family: 'nemo',
    kind: 'asr',
    engine: 'sherpa',
    sherpaType: 'nemo_transducer',
    description: 'Reines Deutsch-Modell von NVIDIA. Winzig und extrem schnell – ideal fürs Diktat auf schwächeren Rechnern.',
    sizeMB: 108,
    speed: 5,
    accuracy: 3,
    languages: 'Deutsch',
    license: 'CC-BY-4.0',
    source: 'https://huggingface.co/nvidia/stt_de_fastconformer_hybrid_large_pc',
    recommended: true,
    dictation: true,
    files: [],
    archive: { url: `${SHERPA_ASR}/sherpa-onnx-nemo-transducer-stt_de_fastconformer_hybrid_large_pc-int8.tar.bz2`, size: 108124747, stripRoot: true },
    requires: ['vad-silero']
  },
  {
    id: 'canary-180m-flash',
    name: 'Canary 180M Flash',
    family: 'canary',
    kind: 'asr',
    engine: 'sherpa',
    sherpaType: 'canary',
    description: 'Kompaktes Encoder-Decoder-Modell von NVIDIA mit sehr guter deutscher Genauigkeit bei geringer Größe.',
    sizeMB: 154,
    speed: 4,
    accuracy: 4,
    languages: 'Deutsch, Englisch, Spanisch, Französisch',
    license: 'CC-BY-4.0',
    source: 'https://huggingface.co/nvidia/canary-180m-flash',
    multilingual: true,
    files: [],
    archive: { url: `${SHERPA_ASR}/sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8.tar.bz2`, size: 153692328, stripRoot: true },
    requires: ['vad-silero']
  },
  {
    id: 'cohere-transcribe',
    name: 'Cohere Transcribe',
    family: 'cohere',
    kind: 'asr',
    engine: 'sherpa',
    sherpaType: 'cohere',
    description: 'Großes 2-Milliarden-Parameter-Modell mit sehr hoher Genauigkeit. Langsam auf der CPU und viel Arbeitsspeicher nötig – eher für Dateien als fürs Diktat.',
    sizeMB: 1700,
    speed: 1,
    accuracy: 5,
    languages: '14 Sprachen',
    license: 'Apache-2.0',
    source: 'https://huggingface.co/CohereLabs/cohere-transcribe-03-2026',
    multilingual: true,
    files: [],
    archive: { url: `${SHERPA_ASR}/sherpa-onnx-cohere-transcribe-14-lang-int8-2026-04-01.tar.bz2`, size: 1699791751, stripRoot: true },
    requires: ['vad-silero']
  },

  // ------------------------------------------------------------ Whisper (whisper.cpp, GPU oder CPU)
  {
    id: 'whisper-turbo-german',
    name: 'Whisper Large v3 Turbo Deutsch',
    family: 'whisper',
    kind: 'asr',
    engine: 'whispercpp',
    description: 'Auf Deutsch feinabgestimmtes Whisper Turbo (primeline). Beste deutsche Genauigkeit – mit NVIDIA-GPU blitzschnell.',
    sizeMB: 574,
    speed: 3,
    accuracy: 5,
    languages: 'Deutsch (optimiert)',
    license: 'Apache-2.0',
    source: 'https://huggingface.co/primeline/whisper-large-v3-turbo-german',
    recommended: true,
    gpu: true,
    files: [{ name: 'model.bin', url: 'https://huggingface.co/cstr/whisper-large-v3-turbo-german-ggml/resolve/main/ggml-model-q5_0.bin', size: 574041195 }],
    requires: ['vad-silero']
  },
  {
    id: 'whisper-large-v3-turbo',
    name: 'Whisper Large v3 Turbo',
    family: 'whisper',
    kind: 'asr',
    engine: 'whispercpp',
    description: 'OpenAIs schnelles Whisper-Modell für fast 100 Sprachen mit automatischer Spracherkennung.',
    sizeMB: 574,
    speed: 3,
    accuracy: 4,
    languages: '99 Sprachen',
    license: 'MIT',
    source: 'https://huggingface.co/openai/whisper-large-v3-turbo',
    gpu: true,
    multilingual: true,
    files: [{ name: 'model.bin', url: `${GGML}/ggml-large-v3-turbo-q5_0.bin`, size: 574041195 }],
    requires: ['vad-silero']
  },
  {
    id: 'whisper-large-v3',
    name: 'Whisper Large v3',
    family: 'whisper',
    kind: 'asr',
    engine: 'whispercpp',
    description: 'Das größte Whisper-Modell. Höchste Genauigkeit bei schwierigen Aufnahmen, benötigt aber eine GPU für vernünftige Geschwindigkeit.',
    sizeMB: 1081,
    speed: 2,
    accuracy: 5,
    languages: '99 Sprachen',
    license: 'MIT',
    source: 'https://huggingface.co/openai/whisper-large-v3',
    gpu: true,
    multilingual: true,
    files: [{ name: 'model.bin', url: `${GGML}/ggml-large-v3-q5_0.bin`, size: 1081140203 }],
    requires: ['vad-silero']
  },
  {
    id: 'whisper-medium',
    name: 'Whisper Medium',
    family: 'whisper',
    kind: 'asr',
    engine: 'whispercpp',
    description: 'Solider Mittelweg aus Größe und Genauigkeit.',
    sizeMB: 539,
    speed: 3,
    accuracy: 3,
    languages: '99 Sprachen',
    license: 'MIT',
    source: 'https://huggingface.co/openai/whisper-medium',
    multilingual: true,
    files: [{ name: 'model.bin', url: `${GGML}/ggml-medium-q5_0.bin`, size: 539212467 }],
    requires: ['vad-silero']
  },
  {
    id: 'whisper-small',
    name: 'Whisper Small',
    family: 'whisper',
    kind: 'asr',
    engine: 'whispercpp',
    description: 'Klein und flott, auch auf der CPU brauchbar. Für Deutsch merklich ungenauer als die großen Modelle.',
    sizeMB: 190,
    speed: 4,
    accuracy: 2,
    languages: '99 Sprachen',
    license: 'MIT',
    source: 'https://huggingface.co/openai/whisper-small',
    multilingual: true,
    files: [{ name: 'model.bin', url: `${GGML}/ggml-small-q5_1.bin`, size: 190085487 }],
    requires: ['vad-silero']
  },
  {
    id: 'whisper-base',
    name: 'Whisper Base',
    family: 'whisper',
    kind: 'asr',
    engine: 'whispercpp',
    description: 'Sehr kleines Whisper-Modell zum Ausprobieren. Für ernsthafte deutsche Transkription zu ungenau.',
    sizeMB: 60,
    speed: 5,
    accuracy: 1,
    languages: '99 Sprachen',
    license: 'MIT',
    source: 'https://huggingface.co/openai/whisper-base',
    multilingual: true,
    files: [{ name: 'model.bin', url: `${GGML}/ggml-base-q5_1.bin`, size: 59707625 }],
    requires: ['vad-silero']
  },

  // ------------------------------------------------------------ Sprechererkennung: Segmentierung (wer spricht wann)
  {
    id: 'seg-pyannote-3',
    name: 'Pyannote Segmentation 3.0',
    family: 'pyannote',
    kind: 'segmentation',
    engine: 'sherpa',
    description: 'Der bewährte Standard: erkennt, wann jemand spricht – auch überlappende Sprache. Klein, schnell und frei lizenziert.',
    sizeMB: 7,
    speed: 5,
    accuracy: 4,
    languages: 'sprachunabhängig',
    license: 'MIT',
    source: 'https://huggingface.co/pyannote/segmentation-3.0',
    recommended: true,
    files: [],
    archive: { url: `${SHERPA_SEG}/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`, size: 6958444, stripRoot: true },
    keepFiles: ['model.onnx', 'LICENSE']
  },
  {
    id: 'seg-reverb-v1',
    name: 'Reverb Diarization v1',
    family: 'reverb',
    kind: 'segmentation',
    engine: 'sherpa',
    description: 'Von Rev auf 26.000 Stunden echter Gespräche nachtrainiertes pyannote-Modell. In unseren Tests die genaueste Variante – bei gleicher Geschwindigkeit.',
    sizeMB: 11,
    speed: 5,
    accuracy: 5,
    languages: 'sprachunabhängig',
    license: 'Rev Non-Production',
    nonCommercial: true,
    source: 'https://huggingface.co/Revai/reverb-diarization-v1',
    files: [],
    archive: { url: `${SHERPA_SEG}/sherpa-onnx-reverb-diarization-v1.tar.bz2`, size: 10918585, stripRoot: true },
    keepFiles: ['model.onnx', 'LICENSE']
  },
  {
    id: 'seg-reverb-v2',
    name: 'Reverb Diarization v2',
    family: 'reverb',
    kind: 'segmentation',
    engine: 'sherpa',
    description: 'Rev-Modell mit WavLM-Merkmalen. Etwa 5× langsamer als v1 und in unseren Tests nicht genauer – eher zum Ausprobieren.',
    sizeMB: 254,
    speed: 1,
    accuracy: 3,
    languages: 'sprachunabhängig',
    license: 'Rev Non-Production',
    nonCommercial: true,
    source: 'https://huggingface.co/Revai/reverb-diarization-v2',
    files: [],
    archive: { url: `${SHERPA_SEG}/sherpa-onnx-reverb-diarization-v2.tar.bz2`, size: 254075989, stripRoot: true },
    keepFiles: ['model.int8.onnx', 'LICENSE'],
    mainFile: 'model.int8.onnx'
  },

  // ------------------------------------------------------------ Sprechererkennung: Stimmprofile (wer ist wer)
  ...(
    [
      ['emb-eres2net-voxceleb', '3D-Speaker ERes2Net', '3dspeaker', '3dspeaker_speech_eres2net_sv_en_voxceleb_16k', 26485263, 'Apache-2.0', 'https://github.com/modelscope/3D-Speaker', 4, 5, 'Kompakt und in unseren Tests am zuverlässigsten: richtige Sprecherzahl in allen Testgesprächen.'],
      ['emb-wespeaker-resnet34', 'WeSpeaker ResNet34', 'wespeaker', 'wespeaker_en_voxceleb_resnet34_LM', 26530550, 'CC-BY-4.0', 'https://github.com/wenet-e2e/wespeaker', 4, 3, 'Der Klassiker, der auch in pyannote 3.1 steckt. Schnell, neigt aber dazu, ähnliche Stimmen zusammenzulegen.'],
      ['emb-wespeaker-resnet152', 'WeSpeaker ResNet152', 'wespeaker', 'wespeaker_en_voxceleb_resnet152_LM', 79158470, 'CC-BY-4.0', 'https://github.com/wenet-e2e/wespeaker', 2, 2, 'Tieferes ResNet. In unseren Tests weniger stabil als die kleineren Modelle.'],
      ['emb-wespeaker-resnet221', 'WeSpeaker ResNet221', 'wespeaker', 'wespeaker_en_voxceleb_resnet221_LM', 95037599, 'CC-BY-4.0', 'https://github.com/wenet-e2e/wespeaker', 2, 3, 'Sehr tiefes ResNet, langsam.'],
      ['emb-wespeaker-resnet293', 'WeSpeaker ResNet293', 'wespeaker', 'wespeaker_en_voxceleb_resnet293_LM', 114336527, 'CC-BY-4.0', 'https://github.com/wenet-e2e/wespeaker', 1, 4, 'Das größte WeSpeaker-Modell – bestes der WeSpeaker-Familie, aber am langsamsten.'],
      ['emb-titanet-large', 'NVIDIA TitaNet Large', 'titanet', 'nemo_en_titanet_large', 101405493, 'CC-BY-4.0', 'https://huggingface.co/nvidia/speakerverification_en_titanet_large', 4, 3, 'Großes NeMo-Modell. Trifft die Sprecherzahl gut, verwechselt aber sehr ähnliche Stimmen.'],
      ['emb-titanet-small', 'NVIDIA TitaNet Small', 'titanet', 'nemo_en_titanet_small', 40257283, 'CC-BY-4.0', 'https://catalog.ngc.nvidia.com/orgs/nvidia/teams/nemo/models/titanet_small', 5, 3, 'Kleine, schnelle Variante von TitaNet mit ähnlicher Genauigkeit.'],
      ['emb-speakernet', 'NVIDIA SpeakerNet', 'titanet', 'nemo_en_speakerverification_speakernet', 23411863, 'CC-BY-4.0', 'https://catalog.ngc.nvidia.com/orgs/nvidia/teams/nemo/models/speakerverification_speakernet', 5, 2, 'Älteres, sehr kleines und schnelles NeMo-Modell.']
    ] as const
  ).map(
    ([id, name, family, file, size, license, source, speed, accuracy, description]): ModelDef => ({
      id,
      name,
      family,
      kind: 'embedding',
      engine: 'sherpa',
      description,
      sizeMB: Math.round(size / 1e6),
      speed,
      accuracy,
      languages: 'sprachunabhängig',
      license,
      source,
      threshold: EMBEDDING_THRESHOLDS[id],
      recommended: id === RECOMMENDED_EMBEDDING,
      files: [{ name: 'model.onnx', url: `${SHERPA_EMB}/${encodeURIComponent(file)}.onnx`, size }]
    })
  ),

  // ------------------------------------------------------------ Komponenten
  {
    id: 'vad-silero',
    name: 'Silero VAD',
    family: 'silero',
    kind: 'vad',
    engine: 'sherpa',
    description: 'Erkennt Sprachpausen und teilt lange Aufnahmen sinnvoll auf. Wird automatisch installiert.',
    sizeMB: 1,
    speed: 5,
    accuracy: 4,
    languages: 'sprachunabhängig',
    license: 'MIT',
    source: 'https://github.com/snakers4/silero-vad',
    files: [{ name: 'silero_vad.onnx', url: `${SHERPA_ASR}/silero_vad.onnx`, size: 643854 }]
  },
  {
    id: 'whispercpp-cuda',
    name: 'whisper.cpp GPU-Laufzeit (CUDA 12)',
    family: 'whispercpp',
    kind: 'runtime',
    engine: 'whispercpp',
    description: 'Führt Whisper-Modelle auf NVIDIA-Grafikkarten aus – typischerweise 10–30× schneller als die CPU. Enthält die CUDA-Bibliotheken.',
    sizeMB: 685,
    speed: 5,
    accuracy: 5,
    languages: '–',
    license: 'MIT',
    source: 'https://github.com/ggml-org/whisper.cpp',
    gpu: true,
    files: [],
    archive: { url: `${WHISPER_CPP}/whisper-bin-win-cuda-12.4.0-x64.zip`, size: 684913404, stripRoot: true }
  },
  {
    id: 'whispercpp-cpu',
    name: 'whisper.cpp CPU-Laufzeit',
    family: 'whispercpp',
    kind: 'runtime',
    engine: 'whispercpp',
    description: 'Führt Whisper-Modelle auf dem Prozessor aus (für Rechner ohne NVIDIA-GPU).',
    sizeMB: 9,
    speed: 2,
    accuracy: 5,
    languages: '–',
    license: 'MIT',
    source: 'https://github.com/ggml-org/whisper.cpp',
    files: [],
    archive: { url: `${WHISPER_CPP}/whisper-bin-x64.zip`, size: 8928640, stripRoot: true }
  }
]

// Gemeinsame Typen für Main-, Engine- und Renderer-Prozess.

export type Theme = 'system' | 'light' | 'dark'
export type DictationMode = 'hybrid' | 'hold' | 'toggle'

export interface Replacement {
  from: string
  to: string
}

export interface Settings {
  onboardingDone: boolean
  theme: Theme
  /** ISO-639-1 Code oder 'auto' (nur Whisper) */
  language: string
  transcriptionModel: string | null
  dictationModel: string | null
  threads: number
  useGpu: boolean
  micDeviceId: string
  launchAtLogin: boolean
  diarization: {
    enabled: boolean
    /** 0 = automatisch erkennen */
    numSpeakers: number
    /** Verschiebung gegenüber dem modellspezifischen Clustering-Schwellwert (größer = weniger Sprecher) */
    thresholdOffset: number
    segmentationModel: string
    embeddingModel: string
  }
  dictation: {
    enabled: boolean
    hotkey: number[]
    pasteLastHotkey: number[]
    mode: DictationMode
    autoPaste: boolean
    restoreClipboard: boolean
    sounds: boolean
    trailingSpace: boolean
    /** Schmale Pille unten am Bildschirm auch im Ruhezustand zeigen */
    idlePill: boolean
  }
  replacements: Replacement[]
}

export type ModelKind = 'asr' | 'segmentation' | 'embedding' | 'vad' | 'runtime'
export type EngineKind = 'sherpa' | 'whispercpp'

export interface ModelFile {
  /** Dateiname im Modellordner */
  name: string
  url: string
  /** Größe in Bytes (für Fortschrittsanzeige, optional) */
  size?: number
}

export interface ModelDef {
  id: string
  name: string
  family: string
  kind: ModelKind
  engine: EngineKind
  description: string
  /** Download-Größe in MB */
  sizeMB: number
  /** 1–5 */
  speed: number
  /** 1–5, bezogen auf Deutsch */
  accuracy: number
  languages: string
  license: string
  source: string
  recommended?: boolean
  /** Für Diktat besonders geeignet (schnell) */
  dictation?: boolean
  gpu?: boolean
  /** Unterstützt automatische Spracherkennung / freie Sprachwahl */
  multilingual?: boolean
  files: ModelFile[]
  /** Alternativ: Archiv (.tar.bz2 / .zip), das entpackt wird */
  archive?: { url: string; size?: number; stripRoot?: boolean }
  /** Datei im Modellordner, die geladen wird (Standard: model.onnx) */
  mainFile?: string
  /** Nach dem Entpacken nur diese Dateien behalten */
  keepFiles?: string[]
  /** Lizenz erlaubt nur private/nicht-produktive Nutzung */
  nonCommercial?: boolean
  /** Kalibrierter Clustering-Schwellwert (nur Stimmprofil-Modelle) */
  threshold?: number
  /** sherpa-onnx Modelltyp */
  sherpaType?: 'nemo_transducer' | 'transducer' | 'whisper' | 'canary' | 'cohere'
  /** Für Laufzeiten / zusätzliche Abhängigkeiten */
  requires?: string[]
}

export interface DownloadProgress {
  id: string
  received: number
  total: number
  /** Bytes/s */
  speed: number
  state: 'downloading' | 'extracting' | 'done' | 'error' | 'cancelled'
  error?: string
}

export interface ModelStatus extends ModelDef {
  installed: boolean
  download?: DownloadProgress
}

export interface Segment {
  id: string
  start: number
  end: number
  text: string
  speaker?: number
  /** Startzeit jedes Wortes (für die Wort-Hervorhebung beim Abspielen) */
  words?: number[]
}

export interface Speaker {
  id: number
  name: string
}

export type TranscriptSource = 'file' | 'recording'

export interface TranscriptMeta {
  id: string
  title: string
  createdAt: number
  source: TranscriptSource
  duration: number
  language: string
  modelId: string
  status: 'processing' | 'done' | 'error'
  error?: string
  speakerCount: number
  preview: string
  words: number
}

export interface Bookmark {
  time: number
  label: string
}

export interface Transcript extends TranscriptMeta {
  audioPath?: string
  originalPath?: string
  segments: Segment[]
  speakers: Speaker[]
  /** Eigene Notizen (z. B. während der Aufnahme geschrieben) */
  notes?: string
  bookmarks?: Bookmark[]
  /** Normierte Pegelspitzen 0–1 für die Wellenform */
  peaks?: number[]
}

export interface SearchHit {
  id: string
  snippet: string
}

export interface LiveStopOptions {
  diarization: boolean
  numSpeakers?: number
  title?: string
  notes?: string
  bookmarks?: Bookmark[]
}

export interface DictationEntry {
  id: string
  createdAt: number
  text: string
  duration: number
  words: number
  modelId: string
  processingMs: number
}

export type JobStage = 'queued' | 'loading' | 'decoding' | 'diarizing' | 'transcribing' | 'done' | 'error' | 'cancelled'

export interface Job {
  id: string
  transcriptId: string
  fileName: string
  stage: JobStage
  progress: number
  error?: string
  createdAt: number
}

export interface TranscribeOptions {
  modelId?: string
  language?: string
  diarization?: boolean
  numSpeakers?: number
}

export interface LiveEvent {
  sessionId: string
  type: 'segment' | 'partial' | 'status' | 'error'
  segment?: Segment
  text?: string
  status?: string
  error?: string
}

export type OverlayState =
  | { kind: 'hidden' }
  | { kind: 'idle'; hint: string }
  | { kind: 'arming' }
  | { kind: 'listening'; handsFree: boolean; startedAt: number }
  | { kind: 'processing'; loadingModel?: boolean }
  | { kind: 'done'; text: string; pasted: boolean }
  | { kind: 'error'; message: string }

export type ExportFormat = 'txt' | 'md' | 'srt' | 'vtt' | 'json' | 'docx'

export interface ExportOptions {
  speakers: boolean
  timestamps: boolean
}

export interface SystemInfo {
  version: string
  modelsDir: string
  dataDir: string
  freeDiskBytes: number
  cpuThreads: number
  gpuName?: string
}

export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'Englisch' },
  { code: 'fr', label: 'Französisch' },
  { code: 'es', label: 'Spanisch' },
  { code: 'it', label: 'Italienisch' },
  { code: 'nl', label: 'Niederländisch' },
  { code: 'pl', label: 'Polnisch' },
  { code: 'pt', label: 'Portugiesisch' },
  { code: 'auto', label: 'Automatisch erkennen' }
]

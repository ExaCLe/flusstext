import type {
  Settings, SystemInfo, ModelStatus, Transcript, TranscriptMeta, Job, TranscribeOptions,
  ExportFormat, ExportOptions, DictationEntry, LiveEvent, LiveStopOptions, SearchHit
} from '../../../src/shared/types'
export type { Settings, SystemInfo, Transcript, TranscriptMeta, Job, TranscribeOptions, ExportFormat, ExportOptions, DictationEntry, LiveEvent, LiveStopOptions, SearchHit }
export interface NativeModel extends ModelStatus {
  available: boolean
  unavailableReason?: string
  recommendation?: string
  resourceNote?: string
}
export interface RecordingState {
  phase: 'idle' | 'recording' | 'paused' | 'processing'
  elapsed: number
  level: number
  sessionId?: string
  text?: string
}
/** Wiedergabe nach den Ereignissen des nativen Players (keine geschätzte Uhr). */
export interface PlaybackState {
  transcriptId: string | null
  time: number
  duration: number
  playing: boolean
  rate: number
}
export interface DictationState {
  phase: 'idle' | 'listening' | 'processing'
  elapsed: number
  level: number
  /** Letztes Ergebnis (nach „processing“) */
  text?: string
  pasted?: boolean
  copied?: boolean
  error?: string
}
export type AppEvent =
  | { type: 'files'; paths: string[] }
  | { type: 'settings'; value: Settings }
  | { type: 'models'; value: NativeModel[] }
  | { type: 'transcripts'; value: TranscriptMeta[] }
  | { type: 'jobs'; value: Job[] }
  | { type: 'recording'; value: RecordingState }
  | { type: 'dictation'; value: DictationEntry[] }
  | { type: 'playback'; value: PlaybackState }
  | { type: 'dictationState'; value: DictationState }
  | { type: 'key'; keycode: number; down: boolean }
  | { type: 'error'; message: string }
export interface FlusstextApi {
  platform: 'ios' | 'android' | 'macos'
  subscribe(listener: (event: AppEvent) => void): () => void
  settings: { get(): Promise<Settings>; set(patch: unknown): Promise<Settings> }
  system: { info(): Promise<SystemInfo>; openPath(path: string): Promise<void>; openExternal(url: string): Promise<void>; requestMicrophone(): Promise<boolean>; requestDictationAccess(): Promise<boolean> }
  models: { list(): Promise<NativeModel[]>; download(id: string): Promise<void>; cancel(id: string): Promise<void>; remove(id: string): Promise<void> }
  transcripts: {
    list(): Promise<TranscriptMeta[]>; get(id: string): Promise<Transcript | null>
    update(id: string, patch: Partial<Transcript>): Promise<Transcript | null>
    remove(id: string): Promise<void>; search(query: string): Promise<SearchHit[]>
    export(id: string, format: ExportFormat, opts: ExportOptions): Promise<void>
    copy(id: string, opts: ExportOptions): Promise<void>
    play(id: string, at?: number, rate?: number): Promise<void>; pause(): Promise<void>
    setRate(rate: number): Promise<void>; playback(): PlaybackState
  }
  jobs: { pick(): Promise<string[]>; add(files: string[], opts: TranscribeOptions): Promise<Job[]>; list(): Promise<Job[]>; cancel(id: string): Promise<void> }
  recording: { state(): RecordingState; start(opts: TranscribeOptions): Promise<void>; pause(): Promise<void>; resume(): Promise<void>; stop(opts: LiveStopOptions): Promise<string>; cancel(): Promise<void> }
  dictation: { history(): Promise<DictationEntry[]>; remove(id: string): Promise<void>; clear(): Promise<void>; copy(text: string): Promise<void>; start(): Promise<void>; stop(): Promise<void>; cancel(): Promise<void>
    state(): DictationState; pasteLast(): Promise<void>; captureKeys(enabled: boolean): Promise<void>
  }
}

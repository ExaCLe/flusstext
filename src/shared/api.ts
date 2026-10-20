import type {
  DictationEntry,
  ExportFormat,
  ExportOptions,
  Job,
  LiveEvent,
  LiveStopOptions,
  ModelStatus,
  OverlayState,
  SearchHit,
  Settings,
  SystemInfo,
  TranscribeOptions,
  Transcript,
  TranscriptMeta
} from './types'

type Unsubscribe = () => void

/** Über `window.api` im Renderer verfügbare Schnittstelle (siehe preload). */
export interface Api {
  platform: string
  settings: {
    get(): Promise<Settings>
    set(patch: unknown): Promise<Settings>
    onChange(cb: (s: Settings) => void): Unsubscribe
  }
  system: {
    info(): Promise<SystemInfo>
    openPath(path: string): Promise<void>
    showInFolder(path: string): Promise<void>
    openExternal(url: string): Promise<void>
    pathForFile(file: File): string
    onNavigate(cb: (route: string) => void): Unsubscribe
  }
  models: {
    list(): Promise<ModelStatus[]>
    download(id: string): Promise<void>
    cancel(id: string): Promise<void>
    remove(id: string): Promise<void>
    onChange(cb: (models: ModelStatus[]) => void): Unsubscribe
  }
  transcripts: {
    list(): Promise<TranscriptMeta[]>
    get(id: string): Promise<Transcript | null>
    update(id: string, patch: Partial<Transcript>): Promise<Transcript | null>
    remove(id: string): Promise<void>
    exportTo(id: string, format: ExportFormat, opts: ExportOptions): Promise<string | null>
    copyText(id: string, opts: ExportOptions): Promise<void>
    /** Volltextsuche über alle Transkripte */
    search(query: string): Promise<SearchHit[]>
    /** Wellenform berechnen (wird im Transkript gespeichert) */
    peaks(id: string): Promise<number[] | null>
    onChange(cb: (t: Transcript | null) => void): Unsubscribe
  }
  jobs: {
    pickFiles(): Promise<string[]>
    add(paths: string[], opts: TranscribeOptions): Promise<Job[]>
    list(): Promise<Job[]>
    cancel(id: string): Promise<void>
    onChange(cb: (jobs: Job[]) => void): Unsubscribe
  }
  live: {
    start(opts: TranscribeOptions): Promise<string>
    chunk(sessionId: string, samples: Float32Array): void
    stop(sessionId: string, opts: LiveStopOptions): Promise<string>
    cancel(sessionId: string): Promise<void>
    onEvent(cb: (e: LiveEvent) => void): Unsubscribe
  }
  dictation: {
    history(): Promise<DictationEntry[]>
    remove(id: string): Promise<void>
    clear(): Promise<void>
    copy(text: string): Promise<void>
    onHistory(cb: () => void): Unsubscribe
    /** Globale Tastenaufnahme für die Hotkey-Einstellung */
    captureKeys(on: boolean): Promise<void>
    onKey(cb: (e: { type: 'down' | 'up'; keycode: number }) => void): Unsubscribe
    onState(cb: (s: OverlayState) => void): Unsubscribe
  }
  overlay: {
    onCommand(cb: (cmd: { type: 'start' | 'stop' | 'cancel'; deviceId?: string; sounds?: boolean }) => void): Unsubscribe
    onState(cb: (s: OverlayState) => void): Unsubscribe
    audio(samples: Float32Array): void
    micReady(): void
    micError(message: string): void
    cancel(): void
    stop(): void
    /** Diktat per Klick auf die Pille starten (freihändig) */
    start(): void
    /** Aktuellen Zustand anfordern (nach dem Laden) */
    hello(): void
    setInteractive(on: boolean): void
  }
}

declare global {
  interface Window {
    api: Api
  }
}

// Gemeinsame Schnittstelle der Spracherkennung: speech.ts (iOS/Android) und speech.macos.ts (Host-Engine).
import type { ModelDef, Settings } from '../../../src/shared/types'
import type { EngineSegment } from './domain/segments'

export type { EngineSegment }

export interface AsrSpec {
  modelId: string
  def: ModelDef
  /** Absoluter Modellordner */
  modelDir: string
  /** ISO-639-1 oder 'auto' */
  language: string
  threads: number
  useGpu: boolean
}

export interface DiarizationSpec {
  segmentation: string
  embedding: string
  numSpeakers: number
  threshold: number
}

export type SpeechStage = 'decoding' | 'diarizing' | 'loading' | 'transcribing'

export class CancelToken {
  cancelled = false
  private handlers: (() => void)[] = []

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    for (const h of this.handlers.splice(0)) {
      try {
        h()
      } catch {
        // Abbruch ist best effort
      }
    }
  }

  /** Rückruf beim Abbruch; liefert eine Abmeldefunktion. */
  onCancel(fn: () => void): () => void {
    if (this.cancelled) {
      fn()
      return () => undefined
    }
    this.handlers.push(fn)
    return () => {
      this.handlers = this.handlers.filter((h) => h !== fn)
    }
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new CancelledError()
  }
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'CancelledError'
  }
}

export const isCancelled = (e: unknown): boolean => e instanceof CancelledError || (e instanceof Error && e.message === 'cancelled')

export interface TranscribeRequest {
  /** Lokaler Pfad einer Datei im App-Speicher */
  path: string
  asr: AsrSpec
  diarization?: DiarizationSpec
  settings: Settings
  token: CancelToken
  onProgress?(stage: SpeechStage, progress: number): void
  /** Zwischenergebnisse (nur, wenn die Engine abschnittsweise arbeitet) */
  onSegments?(segments: EngineSegment[]): void
}

export interface SpeechResult {
  segments: EngineSegment[]
  /** Sekunden */
  duration: number
  /** Normierte Pegelspitzen 0–1 */
  peaks: number[]
  /** Anzahl erkannter Sprecher, falls diarisiert */
  speakers?: number
}

export interface SpeechEngine {
  /** 'device': Erkennung in der App (Telefon), 'host': native Engine des Macs */
  readonly kind: 'device' | 'host'
  transcribe(req: TranscribeRequest): Promise<SpeechResult>
  /** Modell vorab laden (Diktat); darf ohne Wirkung bleiben. */
  preload(asr: AsrSpec): Promise<void>
  /**
   * Sprecher für bereits erkannte Segmente einer vollständigen Aufnahme bestimmen.
   * Die Host-Engine erkennt dafür die ganze Datei mit Diarisierung neu.
   */
  assignSpeakers(path: string, segments: EngineSegment[], asr: AsrSpec, spec: DiarizationSpec, settings: Settings, token: CancelToken): Promise<EngineSegment[]>
  release(): Promise<void>
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Antwort der Host-Engine (`engineCall('transcribe')`) prüfen. */
export function parseHostTranscription(raw: unknown): SpeechResult {
  const r = raw as { segments?: unknown; duration?: unknown; peaks?: unknown; speakers?: unknown } | null
  if (!r || typeof r !== 'object' || !Array.isArray(r.segments)) throw new Error('Die Transkriptions-Engine lieferte ein ungültiges Ergebnis.')
  const segments: EngineSegment[] = []
  for (const s of r.segments as Record<string, unknown>[]) {
    if (!s || !finite(s.start) || !finite(s.end) || typeof s.text !== 'string') continue
    const text = s.text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    segments.push({
      start: s.start,
      end: Math.max(s.start, s.end),
      text,
      ...(Number.isInteger(s.speaker) ? { speaker: s.speaker as number } : {}),
      ...(Array.isArray(s.words) && s.words.every(finite) ? { words: s.words as number[] } : {})
    })
  }
  const peaks = Array.isArray(r.peaks) ? (r.peaks as unknown[]).filter(finite).map((v) => Math.max(0, Math.min(1, v))) : []
  const speakers = finite(r.speakers) ? r.speakers : undefined
  return { segments, duration: finite(r.duration) ? Math.max(0, r.duration) : 0, peaks, ...(speakers !== undefined ? { speakers } : {}) }
}

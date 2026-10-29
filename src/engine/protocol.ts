// Nachrichtenformat zwischen Main-Prozess und Engine (utilityProcess).

/** Wie ein Audioabschnitt in Text umgewandelt wird. */
export type AsrBackend =
  | { type: 'sherpa'; key: string; config: Record<string, unknown>; family: string }
  | { type: 'whisper-server'; url: string; language: string; family: string }
  | { type: 'nemotron-lite'; modelDir: string; threads: number; family: string }

export interface DiarizationSpec {
  segmentation: string
  embedding: string
  numSpeakers: number
  threshold: number
}

export interface EngineSegment {
  start: number
  end: number
  text: string
  speaker?: number
  /** Startzeit jedes Wortes */
  words?: number[]
}

export interface TranscribeFileParams {
  jobId: string
  path: string
  ffmpeg: string
  asr: AsrBackend
  vadModel: string
  threads: number
  diarization?: DiarizationSpec
}

export interface TranscribeSamplesParams {
  asr: AsrBackend
  samples: Float32Array
  vadModel: string
  threads: number
}

export interface LiveStartParams {
  sessionId: string
  asr: AsrBackend
  vadModel: string
  threads: number
}

export interface LiveStopParams {
  sessionId: string
  wavPath: string
  diarization?: DiarizationSpec
}

export type EngineEvent =
  | { event: 'job-progress'; jobId: string; stage: string; progress: number }
  | { event: 'job-segment'; jobId: string; segments: EngineSegment[] }
  | { event: 'live-segment'; sessionId: string; segment: EngineSegment }
  | { event: 'live-partial'; sessionId: string; text: string }
  | { event: 'log'; message: string }

export interface EngineRequest {
  id: number
  method: string
  params: unknown
}

export type EngineResponse = { id: number; result?: unknown; error?: string }

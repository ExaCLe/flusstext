// Live-Aufnahme: Audio-Chunks vom Renderer an die Engine weiterreichen.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { EngineSegment } from '../engine/protocol'
import type { LiveEvent, LiveStopOptions, TranscribeOptions, Transcript } from '@shared/types'
import { applyReplacements, diarizationSpec, resolveAsr } from './asr'
import { engine } from './engine'
import { toSegments, speakersFor } from './jobs'
import { modelPath } from './models'
import { paths } from './paths'
import { settings } from './settings'
import { transcripts } from './store'
import { sendToMain } from './windows'

const sessions = new Map<string, { modelId: string; language: string; startedAt: number; count: number }>()

function send(e: LiveEvent): void {
  sendToMain('live:event', e)
}

engine.on('live-segment', (e: { sessionId: string; segment: EngineSegment }) => {
  const s = sessions.get(e.sessionId)
  if (!s) return
  const [segment] = toSegments([e.segment], s.count++)
  send({ sessionId: e.sessionId, type: 'segment', segment })
})

engine.on('live-partial', (e: { sessionId: string; text: string }) => {
  send({ sessionId: e.sessionId, type: 'partial', text: applyReplacements(e.text, settings.get().replacements) })
})

export async function liveStart(opts: TranscribeOptions): Promise<string> {
  const s = settings.get()
  const modelId = opts.modelId ?? s.transcriptionModel
  if (!modelId) throw new Error('Kein Transkriptionsmodell ausgewählt.')
  const language = opts.language ?? s.language
  const asr = await resolveAsr(modelId, language)
  const sessionId = randomUUID()
  sessions.set(sessionId, { modelId, language, startedAt: Date.now(), count: 0 })
  await engine.call('liveStart', { sessionId, asr, vadModel: modelPath('vad-silero', 'silero_vad.onnx'), threads: s.threads })
  return sessionId
}

export function liveChunk(sessionId: string, samples: Float32Array): void {
  if (sessions.has(sessionId)) engine.notify('liveChunk', { sessionId, samples })
}

export async function liveStop(sessionId: string, opts: LiveStopOptions): Promise<string> {
  const s = sessions.get(sessionId)
  if (!s) throw new Error('Keine laufende Aufnahme')
  const id = randomUUID()
  const wavPath = join(paths.recordings, `${id}.wav`)
  try {
    const res = await engine.call<{ segments: EngineSegment[]; duration: number; peaks: number[] }>('liveStop', {
      sessionId,
      wavPath,
      diarization: opts.diarization ? diarizationSpec(opts.numSpeakers) : undefined
    })
    const segments = toSegments(res.segments)
    const date = new Date(s.startedAt)
    const t: Transcript = {
      id,
      title: opts.title?.trim() || defaultLiveTitle(date),
      createdAt: s.startedAt,
      source: 'recording',
      duration: res.duration,
      language: s.language,
      modelId: s.modelId,
      status: 'done',
      speakerCount: 0,
      preview: '',
      words: 0,
      audioPath: wavPath,
      segments,
      speakers: speakersFor(segments),
      peaks: res.peaks,
      ...(opts.notes?.trim() ? { notes: opts.notes } : {}),
      ...(opts.bookmarks?.length ? { bookmarks: opts.bookmarks } : {})
    }
    transcripts.save(t)
    return id
  } finally {
    sessions.delete(sessionId)
  }
}

export function defaultLiveTitle(date: Date): string {
  return `Aufnahme vom ${date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}, ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
}

export async function liveCancel(sessionId: string): Promise<void> {
  sessions.delete(sessionId)
  await engine.call('liveCancel', { sessionId })
}

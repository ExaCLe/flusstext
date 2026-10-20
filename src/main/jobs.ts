// Warteschlange für Datei-Transkriptionen (nacheinander, damit CPU/GPU nicht überlastet wird).
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { basename, extname } from 'node:path'
import type { EngineSegment } from '../engine/protocol'
import type { Job, Segment, TranscribeOptions, Transcript } from '@shared/types'
import { applyReplacements, diarizationSpec, ffmpegPath, resolveAsr } from './asr'
import { engine } from './engine'
import { modelPath } from './models'
import { settings } from './settings'
import { transcripts } from './store'

export function toSegments(segs: EngineSegment[], offset = 0): Segment[] {
  const s = settings.get()
  return segs.map((x, i) => ({
    id: `${Math.round(x.start * 1000)}-${offset + i}`,
    start: x.start,
    end: x.end,
    speaker: x.speaker,
    text: applyReplacements(x.text, s.replacements),
    ...(x.words?.length ? { words: x.words } : {})
  }))
}

export function speakersFor(segs: Segment[]): Transcript['speakers'] {
  const ids = [...new Set(segs.map((s) => s.speaker).filter((x): x is number => x !== undefined))].sort((a, b) => a - b)
  return ids.map((id) => ({ id, name: `Sprecher ${id + 1}` }))
}

class JobQueue extends EventEmitter {
  private jobs: Job[] = []
  private running = false

  constructor() {
    super()
    engine.on('job-progress', (e: { jobId: string; stage: string; progress: number }) => {
      const j = this.jobs.find((x) => x.id === e.jobId)
      if (!j || j.stage === 'cancelled') return
      j.stage = e.stage as Job['stage']
      j.progress = e.progress
      this.changed()
    })
    engine.on('job-segment', (e: { jobId: string; segments: EngineSegment[] }) => {
      const j = this.jobs.find((x) => x.id === e.jobId)
      if (!j) return
      const t = transcripts.get(j.transcriptId)
      if (!t) return
      const segs = [...t.segments, ...toSegments(e.segments, t.segments.length)]
      transcripts.save({ ...t, segments: segs, speakers: speakersFor(segs) })
    })
  }

  list(): Job[] {
    return this.jobs
  }

  private changed(): void {
    this.emit('change', this.jobs)
  }

  add(files: string[], opts: TranscribeOptions): Job[] {
    const s = settings.get()
    const added: Job[] = []
    for (const file of files) {
      const id = randomUUID()
      const t: Transcript = {
        id,
        title: basename(file, extname(file)),
        createdAt: Date.now(),
        source: 'file',
        duration: 0,
        language: opts.language ?? s.language,
        modelId: opts.modelId ?? s.transcriptionModel ?? '',
        status: 'processing',
        speakerCount: 0,
        preview: '',
        words: 0,
        audioPath: file,
        originalPath: file,
        segments: [],
        speakers: []
      }
      transcripts.save(t)
      const job: Job = { id: randomUUID(), transcriptId: id, fileName: basename(file), stage: 'queued', progress: 0, createdAt: Date.now() }
      ;(job as Job & { opts: TranscribeOptions }).opts = opts
      this.jobs.push(job)
      added.push(job)
    }
    this.changed()
    void this.run()
    return added
  }

  cancel(id: string): void {
    const j = this.jobs.find((x) => x.id === id)
    if (!j) return
    if (j.stage === 'queued') {
      j.stage = 'cancelled'
      transcripts.delete(j.transcriptId)
    } else {
      j.stage = 'cancelled'
      void engine.call('cancel', { jobId: id })
    }
    this.changed()
  }

  private async run(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      let job: (Job & { opts?: TranscribeOptions }) | undefined
      while ((job = this.jobs.find((j) => j.stage === 'queued'))) await this.process(job)
    } finally {
      this.running = false
      // Erledigte Aufträge nach kurzer Zeit aus der Liste entfernen
      setTimeout(() => {
        this.jobs = this.jobs.filter((j) => !['done', 'error', 'cancelled'].includes(j.stage))
        this.changed()
      }, 4000)
    }
  }

  private async process(job: Job & { opts?: TranscribeOptions }): Promise<void> {
    const s = settings.get()
    const t = transcripts.get(job.transcriptId)
    if (!t) return
    job.stage = 'loading'
    this.changed()
    try {
      const modelId = job.opts?.modelId ?? s.transcriptionModel
      if (!modelId) throw new Error('Kein Transkriptionsmodell ausgewählt.')
      const asr = await resolveAsr(modelId, job.opts?.language ?? s.language)
      const wantDiar = job.opts?.diarization ?? s.diarization.enabled
      const diarization = wantDiar ? diarizationSpec(job.opts?.numSpeakers) : undefined
      const res = await engine.call<{ segments: EngineSegment[]; duration: number; peaks: number[] }>('transcribeFile', {
        jobId: job.id,
        path: t.originalPath,
        ffmpeg: ffmpegPath(),
        asr,
        vadModel: modelPath('vad-silero', 'silero_vad.onnx'),
        threads: s.threads,
        diarization
      })
      const segments = toSegments(res.segments)
      // Aktuellen Stand lesen, damit zwischendurch geänderte Titel/Notizen erhalten bleiben
      const cur = transcripts.get(t.id) ?? t
      transcripts.save({ ...cur, segments, speakers: speakersFor(segments), duration: res.duration, peaks: res.peaks, modelId, status: 'done' })
      job.stage = 'done'
      job.progress = 1
    } catch (e) {
      const msg = (e as Error).message
      if (msg === 'cancelled' || (job.stage as string) === 'cancelled') {
        job.stage = 'cancelled'
        transcripts.delete(t.id)
      } else {
        job.stage = 'error'
        job.error = msg
        const cur = transcripts.get(t.id) ?? t
        transcripts.save({ ...cur, status: 'error', error: msg })
      }
    }
    this.changed()
  }
}

export const jobs = new JobQueue()

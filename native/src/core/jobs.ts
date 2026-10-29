// Warteschlange für Datei-Transkriptionen: streng nacheinander, Abbruch jederzeit,
// und kein Ergebnis wird übernommen, nachdem ein Auftrag abgebrochen oder sein Transkript gelöscht wurde.
import type { Job, TranscribeOptions, Transcript } from '../../../src/shared/types'
import { diarizationSpec, resolveAsr } from './asr'
import type { Bus } from './bus'
import { speakersFor, toSegments } from './domain/segments'
import { displayName, uuid } from './domain/text'
import { join, removePath, RNFS, type AppPaths } from './fs'
import type { ModelManager } from './models'
import type { SettingsStore } from './settings'
import { CancelToken, isCancelled, type SpeechEngine } from './speech-types'
import type { TranscriptStore } from './store'

interface QueuedJob extends Job {
  opts: TranscribeOptions
  source: string
  ext: string
  token: CancelToken
}

const MAX_FILES = 100
const FINISHED: Job['stage'][] = ['done', 'error', 'cancelled']

export class JobQueue {
  private jobs: QueuedJob[] = []
  private running = false
  private emitTimer: ReturnType<typeof setTimeout> | null = null
  private pruneTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private paths: AppPaths,
    private bus: Bus,
    private transcripts: TranscriptStore,
    private settings: SettingsStore,
    private models: ModelManager,
    private speech: SpeechEngine
  ) {}

  list(): Job[] {
    return this.jobs.map(({ id, transcriptId, fileName, stage, progress, error, createdAt }) => ({
      id,
      transcriptId,
      fileName,
      stage,
      progress,
      createdAt,
      ...(error ? { error } : {})
    }))
  }

  /** Läuft gerade ein Auftrag? (für Ressourcenentscheidungen anderer Funktionen) */
  get busy(): boolean {
    return this.jobs.some((j) => !FINISHED.includes(j.stage))
  }

  private changed(immediate = false): void {
    const fire = (): void => {
      this.emitTimer = null
      this.bus.emit({ type: 'jobs', value: this.list() })
    }
    if (immediate) {
      if (this.emitTimer) clearTimeout(this.emitTimer)
      fire()
    } else if (!this.emitTimer) this.emitTimer = setTimeout(fire, 150)
  }

  async add(files: string[], opts: TranscribeOptions): Promise<Job[]> {
    if (!Array.isArray(files) || !files.every((f) => typeof f === 'string' && f.length > 0)) throw new Error('Ungültige Dateiauswahl.')
    if (files.length > MAX_FILES) throw new Error(`Höchstens ${MAX_FILES} Dateien auf einmal.`)
    const s = this.settings.get()
    const modelId = opts?.modelId ?? s.transcriptionModel
    // Früh scheitern, statt eine Warteschlange mit unbrauchbaren Aufträgen zu füllen
    resolveAsr(this.models, s, modelId, opts?.language)
    const added: QueuedJob[] = []
    for (const file of files) {
      const id = uuid()
      const { base, ext } = displayName(file)
      const t: Transcript = {
        id,
        title: base,
        createdAt: Date.now(),
        source: 'file',
        duration: 0,
        language: opts?.language ?? s.language,
        modelId: modelId ?? '',
        status: 'processing',
        speakerCount: 0,
        preview: '',
        words: 0,
        originalPath: file,
        segments: [],
        speakers: []
      }
      await this.transcripts.save(t)
      const fileName = ext ? `${base}.${ext}` : base
      const job: QueuedJob = { id: uuid(), transcriptId: id, fileName, stage: 'queued', progress: 0, createdAt: Date.now(), opts: { ...opts }, source: file, ext, token: new CancelToken() }
      this.jobs.push(job)
      added.push(job)
    }
    this.changed(true)
    void this.run()
    const ids = new Set(added.map((j) => j.id))
    return this.list().filter((j) => ids.has(j.id))
  }

  async cancel(id: string): Promise<void> {
    const j = this.jobs.find((x) => x.id === id)
    if (!j || FINISHED.includes(j.stage)) return
    const wasQueued = j.stage === 'queued'
    j.token.cancel()
    j.stage = 'cancelled'
    this.changed(true)
    // Laufende Aufträge räumen in process() selbst auf
    if (wasQueued) await this.transcripts.remove(j.transcriptId)
  }

  /** Auftrag zu einem gelöschten Transkript abbrechen. */
  cancelForTranscript(transcriptId: string): void {
    for (const j of this.jobs) if (j.transcriptId === transcriptId && !FINISHED.includes(j.stage)) void this.cancel(j.id)
  }

  private async run(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      let job: QueuedJob | undefined
      while ((job = this.jobs.find((j) => j.stage === 'queued'))) await this.process(job)
    } finally {
      this.running = false
      if (this.pruneTimer) clearTimeout(this.pruneTimer)
      this.pruneTimer = setTimeout(() => {
        this.jobs = this.jobs.filter((j) => !FINISHED.includes(j.stage))
        this.changed(true)
      }, 4000)
    }
  }

  private async importFile(job: QueuedJob): Promise<string> {
    const dest = join(this.paths.imports, `${job.transcriptId}.${job.ext || 'audio'}`)
    await removePath(dest)
    // Auswahl unverändert weitergeben: RNFS löst file://- und bookmark://-URLs (iOS-Sicherheitsbereich)
    // sowie content://-URIs selbst auf; ein entfernter Präfix würde den Zugriff verlieren
    await RNFS.copyFile(job.source, dest)
    return dest
  }

  private async process(job: QueuedJob): Promise<void> {
    const { token } = job
    const tid = job.transcriptId
    let imported: string | null = null
    let lastStage = ''
    let lastAt = 0
    job.stage = 'loading'
    job.progress = 0
    this.changed(true)
    try {
      imported = await this.importFile(job)
      token.throwIfCancelled()
      const withAudio = await this.transcripts.patch(tid, (t) => ({ ...t, audioPath: imported! }))
      if (!withAudio) throw new Error('cancelled')
      const s = this.settings.get()
      const modelId = job.opts.modelId ?? s.transcriptionModel
      const asr = resolveAsr(this.models, s, modelId, job.opts.language)
      const wantDiar = job.opts.diarization ?? s.diarization.enabled
      const diarization = wantDiar ? diarizationSpec(this.models, s, job.opts.numSpeakers) : undefined
      let partial = Promise.resolve()
      const res = await this.speech.transcribe({
        path: imported,
        asr,
        diarization,
        settings: s,
        token,
        onProgress: (stage, progress) => {
          if (token.cancelled) return
          const now = Date.now()
          if (stage === lastStage && now - lastAt < 150 && progress < 1) return
          lastStage = stage
          lastAt = now
          job.stage = stage
          job.progress = Math.max(0, Math.min(1, progress))
          this.changed()
        },
        onSegments: (segs) => {
          // Zwischenstand anzeigen; das Endergebnis ersetzt ihn vollständig
          partial = partial.then(async () => {
            if (token.cancelled) return
            await this.transcripts.patch(tid, (t) => {
              const segments = [...t.segments, ...toSegments(segs, s.replacements, t.segments.length)]
              return { ...t, segments, speakers: speakersFor(segments, t.speakers) }
            })
          })
        }
      })
      await partial.catch(() => undefined)
      token.throwIfCancelled()
      const segments = toSegments(res.segments, s.replacements)
      const saved = await this.transcripts.patch(tid, (t) =>
        token.cancelled
          ? null
          : { ...t, segments, speakers: speakersFor(segments, t.speakers), duration: res.duration, peaks: res.peaks, modelId: asr.modelId, status: 'done', error: undefined }
      )
      if (!saved) throw new Error('cancelled')
      job.stage = 'done'
      job.progress = 1
    } catch (e) {
      if (token.cancelled || isCancelled(e)) {
        job.stage = 'cancelled'
        await this.transcripts.remove(tid)
        if (imported) await removePath(imported)
      } else {
        const msg = e instanceof Error ? e.message : String(e)
        job.stage = 'error'
        job.error = msg
        await this.transcripts.patch(tid, (t) => ({ ...t, status: 'error', error: msg })).catch(() => null)
      }
    }
    this.changed(true)
  }
}

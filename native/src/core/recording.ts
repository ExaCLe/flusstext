// Live-Aufnahme: der Host nimmt in eine WAV-Datei auf; regelmäßig wird der neue Teil
// (host.audioSnapshot) erkannt und als Live-Text gezeigt. Beim Stoppen wird der Rest erkannt und gespeichert.
import type { LiveStopOptions, TranscribeOptions, Transcript } from '../../../src/shared/types'
import { diarizationSpec, resolveAsr } from './asr'
import type { Bus } from './bus'
import type { RecordingState } from './contracts'
import { isPhone, type Platform } from './domain/catalog'
import { SR } from './domain/chunking'
import { PeakCollector, shiftSegments, speakersFor, toSegments, type EngineSegment } from './domain/segments'
import { applyReplacements, defaultLiveTitle, uuid } from './domain/text'
import { pcm16ToFloat } from './domain/wav'
import { join, readRange, removePath, toPath, wavInfo, writeWavSlice, type AppPaths } from './fs'
import type { NativeHost } from './host'
import type { Microphone } from './microphone'
import type { ModelManager } from './models'
import type { SettingsStore } from './settings'
import { CancelToken, CancelledError, isCancelled, type AsrSpec, type SpeechEngine } from './speech-types'
import type { TranscriptStore } from './store'

/** Zeitabstand der Live-Erkennung: Telefone seltener, um Akku und Wärme zu schonen. */
const PHONE_INTERVAL_MS = 8000
const DESKTOP_INTERVAL_MS = 4000
/** Ende des Ausschnitts, das noch nicht festgeschrieben wird (Wort könnte abgeschnitten sein). */
const TAIL_SEC = 1.5
/** Ohne festschreibbare Sprache wird höchstens so viel Audio offen gehalten. */
const MAX_OPEN_SEC = 20

interface Session {
  id: string
  path: string
  startedAt: number
  opts: TranscribeOptions
  token: CancelToken
  /** Bis hierhin (Sekunden der Aufnahme) sind Segmente festgeschrieben */
  committed: number
  segments: EngineSegment[]
  pending: string
  timer: ReturnType<typeof setInterval> | null
  tick: Promise<void> | null
  interruption?: string
  recovery?: Promise<void>
}

const IDLE: RecordingState = { phase: 'idle', elapsed: 0, level: 0 }

export class Recorder {
  private value: RecordingState = IDLE
  private session: Session | null = null
  private lastLiveError = 0

  constructor(
    private paths: AppPaths,
    private bus: Bus,
    private host: NativeHost,
    private mic: Microphone,
    private transcripts: TranscriptStore,
    private settings: SettingsStore,
    private models: ModelManager,
    private speech: SpeechEngine,
    private platform: Platform
  ) {}

  state(): RecordingState {
    return this.value
  }

  private set(patch: Partial<RecordingState>): void {
    this.value = { ...this.value, ...patch }
    this.bus.emit({ type: 'recording', value: this.value })
  }

  private liveText(s: Session): string {
    const replacements = this.settings.get().replacements
    return [...toSegments(s.segments, replacements).map((x) => x.text), applyReplacements(s.pending, replacements)].filter(Boolean).join(' ')
  }

  private liveAsr(s: Session): AsrSpec | null {
    const st = this.settings.get()
    try {
      return resolveAsr(this.models, st, s.opts.modelId ?? st.transcriptionModel, s.opts.language)
    } catch {
      // Ohne installiertes Modell (z. B. Mikrofontest im Onboarding) nur aufnehmen
      return null
    }
  }

  async start(opts: TranscribeOptions): Promise<void> {
    if (this.value.phase !== 'idle' || this.session) throw new Error('Es läuft bereits eine Aufnahme.')
    const id = uuid()
    const session: Session = {
      id,
      path: join(this.paths.recordings, `${id}.wav`),
      startedAt: Date.now(),
      opts: { ...opts },
      token: new CancelToken(),
      committed: 0,
      segments: [],
      pending: '',
      timer: null,
      tick: null
    }
    this.session = session
    try {
    await this.mic.start('recording', session.path, this.settings.get().micDeviceId, {
      onAudio: (elapsed, level) => {
        if (this.session !== session || this.value.phase !== 'recording') return
        this.set({ elapsed, level: Math.max(0, Math.min(1, level)) })
      },
      onError: (message) => {
        if (this.session !== session) return
        session.interruption = message
        if (this.value.phase === 'recording' || this.value.phase === 'paused') void this.recover(session, message)
      }
    }, session.token)
    } catch (e) {
      if (this.session === session) this.session = null
      await removePath(session.path)
      if (session.token.cancelled || isCancelled(e)) return
      throw e
    }
    if (this.session !== session || session.token.cancelled) return
    this.set({ phase: 'recording', elapsed: 0, level: 0, sessionId: id, text: '' })
    if (session.interruption) { await this.recover(session, session.interruption); return }
    const asr = this.liveAsr(session)
    if (asr) {
      void this.speech.preload(asr).catch(() => undefined)
      session.timer = setInterval(() => this.schedule(session), isPhone(this.platform) ? PHONE_INTERVAL_MS : DESKTOP_INTERVAL_MS)
    }
  }

  /** System interruptions preserve the WAV and create a recoverable transcript. Only explicit discard deletes it. */
  private recover(s: Session, message: string): Promise<void> {
    if (s.recovery) return s.recovery
    s.recovery = this.preserveInterrupted(s, message)
    return s.recovery
  }

  private async preserveInterrupted(s: Session, message: string): Promise<void> {
    if (this.session !== s) return
    s.token.cancel()
    if (s.timer) clearInterval(s.timer)
    s.timer = null
    let path = s.path, duration = this.value.elapsed
    this.set({ phase: 'processing', level: 0 })
    try {
      await s.tick
      if (this.session !== s) return
      try {
        const stopped = await this.host.audioStop()
        path = toPath(stopped.path || path)
        duration = stopped.duration || duration
      } catch {
        // AVAudioRecorder may already have stopped. Its existing file is still recovery data.
      }
      if (this.session !== s) return
      try { duration = (await wavInfo(path)).dataBytes / 2 / SR } catch { /* keep the recorded elapsed time */ }
      const st = this.settings.get()
      const segments = toSegments(s.segments, st.replacements)
      if (this.session !== s) return
      await this.transcripts.save({
        id: s.id, title: defaultLiveTitle(new Date(s.startedAt)), createdAt: s.startedAt,
        source: 'recording', duration, language: s.opts.language ?? st.language,
        modelId: s.opts.modelId ?? st.transcriptionModel ?? '',
        status: 'error', error: `Aufnahme unterbrochen: ${message}. Die Audiodatei wurde zur Wiederherstellung gespeichert.`,
        speakerCount: 0, preview: '', words: 0, audioPath: path, segments, speakers: speakersFor(segments)
      })
      if (this.session !== s) { await this.transcripts.remove(s.id); return }
      this.bus.error(`Aufnahme unterbrochen: ${message}. Die Aufnahme ist unter Transkripte gespeichert.`)
    } catch (e) {
      this.bus.error(e, 'Die Audiodatei bleibt gespeichert, aber ihr Transkript konnte nicht angelegt werden.')
    } finally {
      this.mic.release('recording', s.token)
      if (this.session === s) { this.session = null; this.set(IDLE) }
    }
  }

  private schedule(s: Session): void {
    if (this.session !== s || s.tick || this.value.phase !== 'recording') return
    s.tick = this.liveTick(s).finally(() => {
      s.tick = null
    })
  }

  /** Neuen Teil seit dem letzten festgeschriebenen Punkt erkennen. */
  private async liveTick(s: Session): Promise<void> {
    const asr = this.liveAsr(s)
    if (!asr) return
    let snapshot: string | null = null
    try {
      const snap = await this.host.audioSnapshot(s.committed)
      snapshot = toPath(snap.path)
      if (this.session !== s || s.token.cancelled) return
      const info = await wavInfo(snapshot)
      const sliceSec = info.dataBytes / 2 / SR
      if (sliceSec < 1) return
      const res = await this.speech.transcribe({ path: snapshot, asr, settings: this.settings.get(), token: s.token })
      if (this.session !== s || s.token.cancelled) return
      const segs = shiftSegments(res.segments, s.committed)
      const limit = s.committed + sliceSec - TAIL_SEC
      const done = segs.filter((x) => x.end <= limit)
      const open = segs.filter((x) => x.end > limit)
      if (done.length) {
        s.segments.push(...done)
        s.committed = done[done.length - 1].end
      } else if (!segs.length) {
        // Stille: Ausschnitt bis auf den Rand verwerfen
        s.committed = Math.max(s.committed, limit)
      } else if (sliceSec > MAX_OPEN_SEC) {
        s.segments.push(...segs)
        s.committed = segs[segs.length - 1].end
      }
      s.pending = (s.committed >= limit ? [] : open).map((x) => x.text).join(' ')
      this.set({ text: this.liveText(s) })
    } catch (e) {
      if (isCancelled(e) || this.session !== s) return
      // Live-Text ist eine Vorschau; Fehler nicht im Sekundentakt melden
      if (Date.now() - this.lastLiveError > 30_000) {
        this.lastLiveError = Date.now()
        this.bus.error(e, 'Live-Erkennung fehlgeschlagen')
      }
    } finally {
      if (snapshot && snapshot !== toPath(s.path)) await removePath(snapshot)
    }
  }

  async pause(): Promise<void> {
    if (this.value.phase !== 'recording' || !this.session) return
    await this.host.audioPause()
    this.set({ phase: 'paused', level: 0 })
  }

  async resume(): Promise<void> {
    if (this.value.phase !== 'paused' || !this.session) return
    await this.host.audioResume()
    this.set({ phase: 'recording' })
  }

  async stop(opts: LiveStopOptions): Promise<string> {
    const s = this.session
    if (!s || (this.value.phase !== 'recording' && this.value.phase !== 'paused')) throw new Error('Keine laufende Aufnahme')
    const st = this.settings.get()
    // Vor dem Stoppen prüfen, damit die Aufnahme bei fehlendem Modell nicht verloren geht
    const asr = resolveAsr(this.models, st, s.opts.modelId ?? st.transcriptionModel, s.opts.language)
    const before = this.value.phase
    if (s.timer) clearInterval(s.timer)
    s.timer = null
    this.set({ phase: 'processing', level: 0 })
    let stopped: { path: string; duration: number }
    try {
      await s.tick
      s.token.throwIfCancelled()
      if (this.session !== s) throw new CancelledError()
      stopped = await this.host.audioStop()
    } catch (e) {
      // Host konnte nicht stoppen: Zustand zurück, damit erneut versucht werden kann
      if (this.session === s && !s.token.cancelled) this.set({ phase: before })
      throw e
    }
    this.mic.release('recording', s.token)
    const path = toPath(stopped.path || s.path)
    let rest: string | null = null
    try {
      const info = await wavInfo(path)
      const duration = info.dataBytes / 2 / SR
      let segments = s.segments
      // Rest seit dem letzten festgeschriebenen Punkt erkennen
      if (duration - s.committed > 0.3) {
        rest = join(this.paths.tmp, `rest-${s.id}.wav`)
        await writeWavSlice(path, info, s.committed, duration, rest)
        const res = await this.speech.transcribe({ path: rest, asr, settings: st, token: s.token })
        s.token.throwIfCancelled()
        segments = [...segments, ...shiftSegments(res.segments, s.committed)]
      }
      if (opts.diarization && segments.length) {
        const spec = diarizationSpec(this.models, st, opts.numSpeakers)
        if (spec) segments = await this.speech.assignSpeakers(path, segments, asr, spec, st, s.token)
      }
      const peaks = await this.peaks(path, info.dataOffset, info.dataBytes)
      const final = toSegments(segments, st.replacements)
      s.token.throwIfCancelled()
      if (this.session !== s) throw new CancelledError()
      const t: Transcript = {
        id: s.id,
        title: opts.title?.trim() || defaultLiveTitle(new Date(s.startedAt)),
        createdAt: s.startedAt,
        source: 'recording',
        duration,
        language: asr.language,
        modelId: asr.modelId,
        status: 'done',
        speakerCount: 0,
        preview: '',
        words: 0,
        audioPath: path,
        segments: final,
        speakers: speakersFor(final),
        peaks,
        ...(opts.notes?.trim() ? { notes: opts.notes } : {}),
        ...(opts.bookmarks?.length ? { bookmarks: opts.bookmarks.filter((b) => b && Number.isFinite(b.time) && typeof b.label === 'string') } : {})
      }
      await this.transcripts.save(t)
      if (this.session !== s || s.token.cancelled) {
        await this.transcripts.remove(s.id)
        throw new CancelledError()
      }
      return t.id
    } catch (e) {
      if (s.token.cancelled || this.session !== s) throw new CancelledError()
      if (isCancelled(e)) throw e
      // Audio bleibt erhalten: Transkript mit Fehler speichern, statt die Aufnahme zu verlieren
      const message = e instanceof Error ? e.message : String(e)
      await this.transcripts
        .save({
          id: s.id,
          title: opts.title?.trim() || defaultLiveTitle(new Date(s.startedAt)),
          createdAt: s.startedAt,
          source: 'recording',
          duration: 0,
          language: asr.language,
          modelId: asr.modelId,
          status: 'error',
          error: message,
          speakerCount: 0,
          preview: '',
          words: 0,
          audioPath: path,
          segments: toSegments(s.segments, st.replacements),
          speakers: [],
          ...(opts.notes?.trim() ? { notes: opts.notes } : {}),
          ...(opts.bookmarks?.length ? { bookmarks: opts.bookmarks } : {})
        })
        .catch(() => undefined)
      if (this.session !== s) await this.transcripts.remove(s.id)
      throw e
    } finally {
      if (rest) await removePath(rest)
      if (this.session === s) { this.session = null; this.set(IDLE) }
    }
  }

  private async peaks(path: string, offset: number, bytes: number): Promise<number[]> {
    const peaks = new PeakCollector(bytes / 2)
    const block = 1 << 20
    for (let at = 0; at < bytes; at += block) peaks.add(pcm16ToFloat(await readRange(path, Math.min(block, bytes - at), offset + at)))
    return peaks.result()
  }

  async cancel(): Promise<void> {
    const s = this.session
    if (!s) return
    s.token.cancel()
    if (s.timer) clearInterval(s.timer)
    this.session = null
    this.set(IDLE)
    try {
      await this.host.audioCancel()
    } finally {
      this.mic.release('recording', s.token)
      await removePath(s.path)
    }
  }
}

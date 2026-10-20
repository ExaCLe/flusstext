// Transkriptions-Engine. Läuft als Electron utilityProcess, damit native
// Abstürze oder lange Berechnungen nie das UI blockieren.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import type {
  AsrBackend,
  DiarizationSpec,
  EngineEvent,
  EngineRequest,
  EngineResponse,
  EngineSegment,
  LiveStartParams,
  LiveStopParams,
  TranscribeFileParams,
  TranscribeSamplesParams
} from './protocol'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sherpa = require('sherpa-onnx-node')

const SR = 16000
const MAX_CHUNK_SEC = 24
const LIVE_MERGE_GAP = 1.2
const MIN_SPEAKER_SEC = 2
const LIVE_MIN_SEC = 4

const port = (process as unknown as { parentPort: Electron.ParentPort }).parentPort

function emit(e: EngineEvent): void {
  port.postMessage(e)
}

function log(message: string): void {
  emit({ event: 'log', message })
}

// ---------------------------------------------------------------- Recognizer

interface Recognizer {
  createStream(): { acceptWaveform(o: { samples: Float32Array; sampleRate: number }): void }
  decodeAsync(stream: unknown): Promise<SherpaResult>
}

interface SherpaResult {
  text: string
  tokens?: string[]
  timestamps?: number[]
  durations?: number[]
  lang?: string
}

const recognizers = new Map<string, Promise<Recognizer>>()

function getRecognizer(asr: Extract<AsrBackend, { type: 'sherpa' }>): Promise<Recognizer> {
  let r = recognizers.get(asr.key)
  if (!r) {
    // Höchstens zwei Modelle gleichzeitig im Speicher halten (Transkription + Diktat).
    while (recognizers.size >= 2) {
      const first = recognizers.keys().next().value as string
      recognizers.delete(first)
    }
    const t0 = Date.now()
    r = sherpa.OfflineRecognizer.createAsync(asr.config) as Promise<Recognizer>
    r.then(
      () => log(`Modell ${asr.key} geladen in ${Date.now() - t0} ms`),
      () => recognizers.delete(asr.key)
    )
    recognizers.set(asr.key, r)
  }
  return r
}

interface Token {
  text: string
  start: number
  end: number
}

/** Einen kurzen Abschnitt (≤ 30 s) erkennen und als Token-Liste mit absoluten Zeiten liefern. */
async function recognize(asr: AsrBackend, samples: Float32Array, offset: number): Promise<Token[]> {
  const dur = samples.length / SR
  if (asr.type === 'sherpa') {
    const rec = await getRecognizer(asr)
    const stream = rec.createStream()
    stream.acceptWaveform({ samples, sampleRate: SR })
    const res = await rec.decodeAsync(stream)
    const text = cleanText(res.text, asr.family)
    if (!text) return []
    const toks = res.tokens ?? []
    const times = res.timestamps ?? []
    if (toks.length && toks.length === times.length && asr.family !== 'whisper') {
      const out: Token[] = []
      for (let i = 0; i < toks.length; i++) {
        const start = offset + times[i]
        const end = offset + (res.durations?.[i] ? times[i] + res.durations[i] : (times[i + 1] ?? dur))
        out.push({ text: toks[i], start, end: Math.max(end, start + 0.02) })
      }
      // Tokens enthalten Leerzeichen am Wortanfang; Text normalisieren
      if (out.length && !out[0].text.startsWith(' ')) out[0].text = ' ' + out[0].text
      return out
    }
    return [{ text: ' ' + text, start: offset, end: offset + dur }]
  }

  // whisper.cpp-Server (GPU)
  const form = new FormData()
  form.append('file', new Blob([encodeWav(samples)], { type: 'audio/wav' }), 'audio.wav')
  form.append('response_format', 'verbose_json')
  form.append('temperature', '0.0')
  form.append('language', asr.language === 'auto' ? 'auto' : asr.language)
  const resp = await fetch(`${asr.url}/inference`, { method: 'POST', body: form })
  if (!resp.ok) throw new Error(`whisper.cpp: HTTP ${resp.status}`)
  const json = (await resp.json()) as {
    text?: string
    segments?: { start: number; end: number; text: string; words?: { word: string; start: number; end: number }[] }[]
  }
  if (!cleanText(json.text ?? '', 'whisper')) return []
  const segs = json.segments ?? [{ start: 0, end: dur, text: json.text ?? '' }]
  const words = segs.flatMap((s) => s.words ?? []).filter((w) => !/^\s*\[_?[A-Z_]+_?\]\s*$/.test(w.word))
  if (words.length) {
    // Wort-Zeitstempel: Teilwörter ohne führendes Leerzeichen gehören zum vorherigen Wort
    const toks = words.map((w) => ({ text: w.word, start: offset + Math.min(w.start, dur), end: offset + Math.min(Math.max(w.end, w.start), dur) }))
    if (!toks[0].text.startsWith(' ')) toks[0].text = ' ' + toks[0].text
    return toks
  }
  return segs
    .map((s) => ({ text: ' ' + cleanText(s.text, 'whisper'), start: offset + s.start, end: offset + Math.min(s.end, dur) }))
    .filter((t) => t.text.trim())
}

// Typische Whisper-Halluzinationen bei Stille (v. a. im Deutschen)
const HALLUCINATIONS = [
  /^untertitel(ung)? (im auftrag|von|der|des).*$/i,
  /^untertitel(ung)?:? .*$/i,
  /^copyright .*(wdr|zdf|ard|swr|br|ndr).*$/i,
  /^(vielen dank|danke)( für ihre aufmerksamkeit| fürs zuschauen| fürs zuhören)?[.!]?$/i,
  /^(\*|\[|\().*(musik|music|applaus|stille|silence)(\*|\]|\))$/i,
  /^\.+$/
]

function cleanText(text: string, family: string): string {
  let t = (text ?? '').replace(/\s+/g, ' ').trim()
  if (family === 'whisper') {
    if (HALLUCINATIONS.some((r) => r.test(t))) return ''
    t = t.replace(/\[(BLANK_AUDIO|Musik|Music)\]/gi, '').trim()
  }
  return t
}

// ---------------------------------------------------------------- Segmentierung

function speakerAt(turns: EngineSegment[] | undefined, t: number): number | undefined {
  if (!turns || !turns.length) return undefined
  let best: EngineSegment | undefined
  let bestDist = Infinity
  for (const turn of turns) {
    if (t >= turn.start && t <= turn.end) return turn.speaker
    const d = t < turn.start ? turn.start - t : t - turn.end
    if (d < bestDist) {
      bestDist = d
      best = turn
    }
  }
  return best?.speaker
}

/** Tokens zu satzweisen Segmenten zusammenfassen, bei Sprecherwechsel trennen. */
function buildSegments(tokens: Token[], turns?: EngineSegment[]): EngineSegment[] {
  const out: EngineSegment[] = []
  let cur: EngineSegment | null = null
  let prevText = ''
  const t2 = (x: number): number => Math.round(x * 100) / 100
  for (const tok of tokens) {
    const wordStart = tok.text.startsWith(' ')
    const spk = speakerAt(turns, (tok.start + tok.end) / 2)
    const sentenceEnded = /[.!?…]["»“)]?$/.test(prevText.trim())
    const tooLong = cur && tok.end - cur.start > 30
    const gap = cur && tok.start - cur.end > 1.5
    const newSpeaker = cur && turns && spk !== cur.speaker
    if (!cur || (wordStart && (sentenceEnded || newSpeaker || tooLong || gap))) {
      if (cur) out.push(cur)
      cur = { start: tok.start, end: tok.end, text: tok.text.trimStart(), speaker: spk, words: [t2(tok.start)] }
    } else {
      cur.text += tok.text
      cur.end = Math.max(cur.end, tok.end)
      if (wordStart && tok.text.trim()) cur.words!.push(t2(tok.start))
    }
    prevText = tok.text
  }
  if (cur) out.push(cur)
  return out.map((s) => ({ ...s, text: s.text.replace(/\s+/g, ' ').trim() })).filter((s) => s.text)
}

// ---------------------------------------------------------------- VAD

interface Chunk {
  start: number
  samples: Float32Array
}

function createVad(model: string, threads: number, maxSpeech = MAX_CHUNK_SEC): {
  acceptWaveform(s: Float32Array): void
  isEmpty(): boolean
  isDetected(): boolean
  front(ext: boolean): { start: number; samples: Float32Array }
  pop(): void
  flush(): void
} {
  return new sherpa.Vad(
    {
      sileroVad: {
        model,
        threshold: 0.45,
        minSilenceDuration: 0.35,
        minSpeechDuration: 0.2,
        maxSpeechDuration: maxSpeech,
        windowSize: 512
      },
      sampleRate: SR,
      numThreads: Math.min(2, threads),
      debug: 0
    },
    60
  )
}

/** Audio anhand der Sprachaktivität in Abschnitte ≤ MAX_CHUNK_SEC teilen und benachbarte zusammenfassen. */
function vadSplit(samples: Float32Array, vadModel: string, threads: number): Chunk[] {
  const vad = createVad(vadModel, threads)
  const raw: Chunk[] = []
  const pad = Math.round(0.25 * SR)
  const drain = (): void => {
    while (!vad.isEmpty()) {
      const seg = vad.front(false)
      raw.push({ start: seg.start, samples: seg.samples })
      vad.pop()
    }
  }
  // Kleine Fenster: bei großen Blöcken erkennt der VAD Pausen nicht zuverlässig
  const step = 512
  for (let i = 0; i < samples.length; i += step) {
    vad.acceptWaveform(samples.subarray(i, Math.min(samples.length, i + step)))
    drain()
  }
  vad.flush()
  drain()

  // Benachbarte Sprachabschnitte zusammenfassen (mehr Kontext = bessere Erkennung)
  const merged: { start: number; end: number }[] = []
  for (const c of raw) {
    const s = Math.max(0, c.start - pad)
    const e = Math.min(samples.length, c.start + c.samples.length + pad)
    const last = merged[merged.length - 1]
    if (last && s - last.end < SR * 1.2 && e - last.start < MAX_CHUNK_SEC * SR) last.end = Math.max(last.end, e)
    else merged.push({ start: s, end: e })
  }
  return merged.map((m) => ({ start: m.start, samples: samples.subarray(m.start, m.end) }))
}

// ---------------------------------------------------------------- Diarisierung

/**
 * Automatisches Clustering erzeugt gern „Phantom-Sprecher“ aus einzelnen kurzen Abschnitten.
 * Sprecher mit insgesamt weniger als `minSec` Redezeit werden dem zeitlich nächsten echten Sprecher zugeordnet.
 */
function absorbTinySpeakers(segs: EngineSegment[], minSec: number): EngineSegment[] {
  const total = new Map<number, number>()
  for (const s of segs) total.set(s.speaker!, (total.get(s.speaker!) ?? 0) + s.end - s.start)
  const keep = new Set([...total].filter(([, d]) => d >= minSec).map(([k]) => k))
  if (keep.size === 0 || keep.size === total.size) return segs
  const big = segs.filter((s) => keep.has(s.speaker!))
  return segs.map((s) => {
    if (keep.has(s.speaker!)) return s
    const mid = (s.start + s.end) / 2
    let best = big[0]
    let bestDist = Infinity
    for (const b of big) {
      const d = mid < b.start ? b.start - mid : mid > b.end ? mid - b.end : 0
      if (d < bestDist) {
        bestDist = d
        best = b
      }
    }
    return { ...s, speaker: best.speaker }
  })
}

function diarize(samples: Float32Array, spec: DiarizationSpec, threads: number): EngineSegment[] {
  const sd = new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: spec.segmentation }, numThreads: threads, debug: 0 },
    embedding: { model: spec.embedding, numThreads: threads, debug: 0 },
    clustering: spec.numSpeakers > 0 ? { numClusters: spec.numSpeakers } : { numClusters: -1, threshold: spec.threshold },
    minDurationOn: 0.3,
    minDurationOff: 0.5
  })
  let segs = (sd.process(samples) as EngineSegment[]).sort((a, b) => a.start - b.start)
  if (spec.numSpeakers <= 0) segs = absorbTinySpeakers(segs, MIN_SPEAKER_SEC)
  // Sprecher nach erstem Auftreten neu nummerieren (0, 1, 2 …)
  const map = new Map<number, number>()
  return segs
    .map((s) => {
      if (!map.has(s.speaker!)) map.set(s.speaker!, map.size)
      return { ...s, speaker: map.get(s.speaker!) }
    })
}

// ---------------------------------------------------------------- Audio

function decodeFile(ffmpeg: string, path: string, onProgress: (p: number) => void, isCancelled: () => boolean): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-i', path, '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1'], {
      windowsHide: true
    })
    const chunks: Buffer[] = []
    let total = 0
    let duration = 0
    let errTail = ''
    proc.stdout.on('data', (b: Buffer) => {
      chunks.push(b)
      total += b.length
      if (duration > 0) onProgress(Math.min(1, total / 4 / SR / duration))
      if (isCancelled()) proc.kill()
    })
    proc.stderr.on('data', (b: Buffer) => {
      const s = b.toString()
      errTail = (errTail + s).slice(-2000)
      const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(s)
      if (m) duration = +m[1] * 3600 + +m[2] * 60 + +m[3]
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (isCancelled()) return reject(new Error('cancelled'))
      if (code !== 0 && total === 0) {
        const line = errTail.trim().split('\n').pop() ?? ''
        return reject(new Error(`Datei konnte nicht gelesen werden. ${line}`))
      }
      const buf = Buffer.concat(chunks, total - (total % 4))
      const out = new Float32Array(buf.length / 4)
      new Uint8Array(out.buffer).set(buf)
      resolve(out)
    })
  })
}

function encodeWav(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples.length * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE(v < 0 ? v * 0x8000 : v * 0x7fff, 44 + i * 2)
  }
  return new Uint8Array(buf)
}

const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r))

// ---------------------------------------------------------------- Aufträge

const cancelled = new Set<string>()

async function transcribeChunks(
  chunks: Chunk[],
  asr: AsrBackend,
  turns: EngineSegment[] | undefined,
  onChunk: (segs: EngineSegment[], i: number) => void,
  isCancelled: () => boolean = () => false
): Promise<EngineSegment[]> {
  const all: EngineSegment[] = []
  for (let i = 0; i < chunks.length; i++) {
    if (isCancelled()) throw new Error('cancelled')
    const c = chunks[i]
    const tokens = await recognize(asr, c.samples, c.start / SR)
    const segs = buildSegments(tokens, turns)
    all.push(...segs)
    onChunk(segs, i)
  }
  return all
}

async function transcribeFile(p: TranscribeFileParams): Promise<{ segments: EngineSegment[]; duration: number; peaks: number[] }> {
  const isCancelled = (): boolean => cancelled.has(p.jobId)
  let last = { stage: '', pct: -1, at: 0 }
  const progress = (stage: string, progress: number): void => {
    const pct = Math.floor(progress * 100)
    const now = Date.now()
    if (stage === last.stage && (pct === last.pct || now - last.at < 150) && progress < 1) return
    last = { stage, pct, at: now }
    emit({ event: 'job-progress', jobId: p.jobId, stage, progress })
  }

  // Modell parallel zum Dekodieren laden
  const loading = p.asr.type === 'sherpa' ? getRecognizer(p.asr) : Promise.resolve()
  progress('decoding', 0)
  const samples = await decodeFile(p.ffmpeg, p.path, (x) => progress('decoding', x), isCancelled)
  const duration = samples.length / SR
  if (duration < 0.1) throw new Error('Die Datei enthält keine Audiospur.')

  let turns: EngineSegment[] | undefined
  if (p.diarization) {
    progress('diarizing', 0)
    await yieldLoop()
    turns = diarize(samples, p.diarization, p.threads)
    if (isCancelled()) throw new Error('cancelled')
  }

  progress('loading', 0)
  await loading
  const chunks = vadSplit(samples, p.vadModel, p.threads)
  const totalSamples = chunks.reduce((n, c) => n + c.samples.length, 0) || 1
  let done = 0
  progress('transcribing', 0)
  const segments = await transcribeChunks(
    chunks,
    p.asr,
    turns,
    (segs, i) => {
      done += chunks[i].samples.length
      if (segs.length) emit({ event: 'job-segment', jobId: p.jobId, segments: segs })
      progress('transcribing', done / totalSamples)
    },
    isCancelled
  )
  return { segments, duration, peaks: computePeaks(samples) }
}

/** Pegelspitzen für die Wellenform: n Werte, normiert auf 0–1. */
function computePeaks(samples: Float32Array, n = 1200): number[] {
  const out = new Array<number>(n).fill(0)
  if (!samples.length) return out
  const step = samples.length / n
  for (let i = 0; i < n; i++) {
    let max = 0
    const end = Math.min(samples.length, Math.floor((i + 1) * step))
    for (let j = Math.floor(i * step); j < end; j++) {
      const v = Math.abs(samples[j])
      if (v > max) max = v
    }
    out[i] = max
  }
  const top = Math.max(...out) || 1
  return out.map((v) => Math.round((v / top) * 1000) / 1000)
}

async function transcribeSamples(p: TranscribeSamplesParams): Promise<{ text: string; segments: EngineSegment[] }> {
  const samples = p.samples
  const dur = samples.length / SR
  let chunks: Chunk[]
  if (dur <= MAX_CHUNK_SEC) {
    chunks = [{ start: 0, samples }]
  } else {
    chunks = vadSplit(samples, p.vadModel, p.threads)
  }
  const segments = await transcribeChunks(chunks, p.asr, undefined, () => {})
  return { text: segments.map((s) => s.text).join(' ').trim(), segments }
}

// ---------------------------------------------------------------- Live-Aufnahme

interface LiveSession {
  params: LiveStartParams
  vad: ReturnType<typeof createVad>
  buffers: Float32Array[]
  length: number
  queue: Promise<void>
  segments: EngineSegment[]
  speechStart: number | null
  partialBusy: boolean
  lastPartial: number
  pending: { start: number; end: number } | null
}

const sessions = new Map<string, LiveSession>()

function liveStart(p: LiveStartParams): void {
  if (p.asr.type === 'sherpa') void getRecognizer(p.asr)
  sessions.set(p.sessionId, {
    params: p,
    vad: createVad(p.vadModel, p.threads, 15),
    buffers: [],
    length: 0,
    queue: Promise.resolve(),
    segments: [],
    speechStart: null,
    partialBusy: false,
    lastPartial: 0,
    pending: null
  })
}

function concat(buffers: Float32Array[], length: number): Float32Array {
  const out = new Float32Array(length)
  let o = 0
  for (const b of buffers) {
    out.set(b, o)
    o += b.length
  }
  return out
}

function slice(s: LiveSession, from: number, to: number): Float32Array {
  const out = new Float32Array(Math.max(0, to - from))
  let pos = 0
  for (const b of s.buffers) {
    const bs = pos
    const be = pos + b.length
    pos = be
    if (be <= from || bs >= to) continue
    const a = Math.max(from, bs) - bs
    const z = Math.min(to, be) - bs
    out.set(b.subarray(a, z), Math.max(from, bs) - from)
  }
  return out
}

/** Gesammelten Abschnitt erkennen und als Live-Segmente ausgeben. */
function liveFlush(s: LiveSession): void {
  const p = s.pending
  if (!p) return
  s.pending = null
  const start = Math.max(0, p.start - Math.round(0.2 * SR))
  const samples = slice(s, start, Math.min(s.length, p.end + Math.round(0.15 * SR)))
  s.queue = s.queue.then(async () => {
    try {
      const tokens = await recognize(s.params.asr, samples, start / SR)
      for (const segment of buildSegments(tokens)) {
        s.segments.push(segment)
        emit({ event: 'live-segment', sessionId: s.params.sessionId, segment })
      }
      emit({ event: 'live-partial', sessionId: s.params.sessionId, text: '' })
    } catch (e) {
      log(`Live-Fehler: ${(e as Error).message}`)
    }
  })
}

/**
 * Kurze, dicht aufeinanderfolgende VAD-Abschnitte zusammenfassen. Sehr kurze Äußerungen
 * („Ja, gerne“) ohne Kontext werden sonst leicht der falschen Sprache zugeordnet.
 */
function liveDrain(s: LiveSession): void {
  while (!s.vad.isEmpty()) {
    const seg = s.vad.front(false)
    s.vad.pop()
    const segEnd = seg.start + seg.samples.length
    const p = s.pending
    if (p && seg.start - p.end < LIVE_MERGE_GAP * SR && segEnd - p.start < 20 * SR) p.end = segEnd
    else {
      liveFlush(s)
      s.pending = { start: seg.start, end: segEnd }
    }
    s.speechStart = null
  }
  const p = s.pending
  // Abschnitt abschließen, wenn er lang genug ist oder die Pause danach lang genug war
  if (p && !s.vad.isDetected() && (p.end - p.start >= LIVE_MIN_SEC * SR || s.length - p.end > LIVE_MERGE_GAP * SR)) liveFlush(s)
}

function liveChunk(p: { sessionId: string; samples: Float32Array }): void {
  const s = sessions.get(p.sessionId)
  if (!s) return
  s.buffers.push(p.samples)
  s.length += p.samples.length
  s.vad.acceptWaveform(p.samples)
  if (s.vad.isDetected()) {
    if (s.speechStart === null) s.speechStart = Math.max(0, s.length - Math.round(0.6 * SR))
    // Zwischenergebnis für die laufende Äußerung
    const now = Date.now()
    if (!s.partialBusy && now - s.lastPartial > 900 && s.length - s.speechStart > 0.8 * SR) {
      s.partialBusy = true
      s.lastPartial = now
      // Zwischenergebnis umfasst auch noch nicht abgeschlossene, gesammelte Abschnitte
      const from = s.pending ? Math.max(0, s.pending.start - Math.round(0.2 * SR)) : s.speechStart
      const samples = slice(s, from, s.length)
      recognize(s.params.asr, samples, 0)
        .then((tokens) => {
          const text = tokens.map((t) => t.text).join('').trim()
          if (text && s.speechStart !== null) emit({ event: 'live-partial', sessionId: s.params.sessionId, text })
        })
        .catch(() => {})
        .finally(() => (s.partialBusy = false))
    }
  }
  liveDrain(s)
}

async function liveStop(p: LiveStopParams): Promise<{ segments: EngineSegment[]; duration: number; peaks: number[] }> {
  const s = sessions.get(p.sessionId)
  if (!s) throw new Error('Unbekannte Aufnahme')
  s.vad.flush()
  liveDrain(s)
  liveFlush(s)
  await s.queue
  sessions.delete(p.sessionId)
  const samples = concat(s.buffers, s.length)
  writeFileSync(p.wavPath, encodeWav(samples))
  let segments = s.segments
  if (p.diarization && samples.length > SR * 2) {
    const turns = diarize(samples, p.diarization, s.params.threads)
    segments = segments.map((seg) => ({ ...seg, speaker: dominantSpeaker(turns, seg) }))
  }
  return { segments, duration: samples.length / SR, peaks: computePeaks(samples) }
}

function liveCancel(p: { sessionId: string }): void {
  sessions.delete(p.sessionId)
}

function dominantSpeaker(turns: EngineSegment[], seg: EngineSegment): number | undefined {
  const overlap = new Map<number, number>()
  for (const t of turns) {
    const o = Math.min(t.end, seg.end) - Math.max(t.start, seg.start)
    if (o > 0) overlap.set(t.speaker!, (overlap.get(t.speaker!) ?? 0) + o)
  }
  if (!overlap.size) return speakerAt(turns, (seg.start + seg.end) / 2)
  return [...overlap.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

// ---------------------------------------------------------------- RPC

const handlers: Record<string, (params: never) => unknown> = {
  ping: () => 'pong',
  preload: async (p: { asr: AsrBackend }) => {
    if (p.asr.type === 'sherpa') await getRecognizer(p.asr)
    return true
  },
  unload: (p: { key?: string }) => {
    if (p.key) recognizers.delete(p.key)
    else recognizers.clear()
    return true
  },
  transcribeFile: (p: TranscribeFileParams) => transcribeFile(p).finally(() => cancelled.delete(p.jobId)),
  transcribeSamples: (p: TranscribeSamplesParams) => transcribeSamples(p),
  cancel: (p: { jobId: string }) => {
    cancelled.add(p.jobId)
    return true
  },
  liveStart: (p: LiveStartParams) => liveStart(p),
  liveChunk: (p: { sessionId: string; samples: Float32Array }) => liveChunk(p),
  liveStop: (p: LiveStopParams) => liveStop(p),
  peaks: async (p: { ffmpeg: string; path: string }) => computePeaks(await decodeFile(p.ffmpeg, p.path, () => {}, () => false)),
  liveCancel: (p: { sessionId: string }) => liveCancel(p)
}

port.on('message', async (e: { data: EngineRequest }) => {
  const { id, method, params } = e.data
  const reply = (r: Omit<EngineResponse, 'id'>): void => {
    if (id >= 0) port.postMessage({ id, ...r })
  }
  try {
    const h = handlers[method]
    if (!h) throw new Error(`Unbekannte Methode ${method}`)
    reply({ result: await h(params as never) })
  } catch (err) {
    reply({ error: (err as Error).message ?? String(err) })
  }
})

log('Engine bereit')

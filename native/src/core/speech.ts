// Spracherkennung auf iOS und Android: sherpa-onnx (NeMo/Canary/Cohere), whisper.rn und Nemotron über ONNX Runtime.
// Alles läuft lokal; Modelle werden ausschließlich aus dem App-Speicher geladen.
import { createSTT, type STTModelType, type SttEngine } from 'react-native-sherpa-onnx/stt'
import { convertAudioToWav16k } from 'react-native-sherpa-onnx/audio'
// Das Paket exportiert nur Unterpfade; „index“ ist der Haupteinstieg
import { initWhisper, type WhisperContext } from 'whisper.rn/index'
import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { decodeCtc, logMel } from '../../../src/engine/nemotron-frontend'
import { FrameEnergy, planChunks, SR } from './domain/chunking'
import { buildSegments, dominantSpeaker, normalizeTurns, PeakCollector, sherpaTokens, whisperTokens, type SpeakerTurn, type Token } from './domain/segments'
import { uuid } from './domain/text'
import { isSpeechWav, pcm16ToFloat } from './domain/wav'
import { join, readRange, removePath, RNFS, readBinaryFile, serialized, toPath, wavInfo, writeWav, type AppPaths } from './fs'
import type { NativeHost } from './host'
import { CancelledError, type AsrSpec, type CancelToken, type DiarizationSpec, type EngineSegment, type SpeechEngine, type SpeechResult, type TranscribeRequest } from './speech-types'

/** Abschnittslänge: Whisper/NeMo bis 24 s, Nemotron bis 30 s (Modellgrenze 32 s). */
const MAX_CHUNK_SEC = 24
const NEMOTRON_CHUNK_SEC = 30
/** Analyse-Blockgröße beim Lesen der WAV-Datei (1 MiB ≈ 33 s Audio). */
const READ_BLOCK = 1 << 20
/** Diarisierung auf Telefonen mit höchstens 4 Threads. */
const MAX_DIAR_THREADS = 4

interface Recognizer {
  key: string
  recognize(pcm: ArrayBuffer, offset: number, token: CancelToken): Promise<Token[]>
  release(): Promise<void>
}

function sherpaModelType(def: AsrSpec['def']): STTModelType {
  switch (def.sherpaType) {
    case 'nemo_transducer':
      return 'nemo_transducer'
    case 'transducer':
      return 'transducer'
    case 'canary':
      return 'canary'
    case 'cohere':
      return 'cohere_transcribe'
    case 'whisper':
      return 'whisper'
    default:
      throw new Error(`Nicht unterstützter Modelltyp: ${def.sherpaType ?? 'unbekannt'}`)
  }
}

function recognizerKey(asr: AsrSpec): string {
  const lang = asr.def.sherpaType === 'canary' || asr.def.sherpaType === 'cohere' || asr.def.engine === 'whispercpp' ? asr.language : ''
  return `${asr.modelId}:${asr.threads}:${asr.useGpu}:${lang}`
}

async function loadSherpa(asr: AsrSpec, tmp: string): Promise<Recognizer> {
  const lang = asr.language === 'auto' ? 'de' : asr.language
  const canaryLang = ['de', 'en', 'es', 'fr'].includes(lang) ? lang : 'de'
  const stt: SttEngine = await createSTT({
    modelPath: { type: 'file', path: asr.modelDir },
    modelType: sherpaModelType(asr.def),
    preferInt8: true,
    numThreads: asr.threads,
    provider: 'cpu',
    modelOptions: {
      canary: { srcLang: canaryLang, tgtLang: canaryLang, usePnc: true },
      cohereTranscribe: { language: lang, usePunct: true, useItn: true }
    }
  })
  return {
    key: recognizerKey(asr),
    async recognize(pcm, offset, token) {
      token.throwIfCancelled()
      const file = join(tmp, `chunk-${uuid()}.wav`)
      try {
        await writeWav(file, pcm)
        const res = await stt.transcribeFile(file)
        return sherpaTokens(res, asr.def.family, offset, pcm.byteLength / 2 / SR)
      } finally {
        await removePath(file)
      }
    },
    release: () => stt.destroy()
  }
}

async function loadWhisper(asr: AsrSpec): Promise<Recognizer> {
  const ctx: WhisperContext = await initWhisper({ filePath: join(asr.modelDir, asr.def.mainFile ?? 'model.bin'), useGpu: asr.useGpu, useCoreMLIos: false })
  return {
    key: recognizerKey(asr),
    async recognize(pcm, offset, token) {
      token.throwIfCancelled()
      // whisper.rn erwartet rohes 16-Bit-PCM mit 16 kHz
      const task = ctx.transcribeData(pcm, { language: asr.language === 'auto' ? 'auto' : asr.language, maxThreads: asr.threads, temperature: 0, tokenTimestamps: true, maxLen: 1 })
      const off = token.onCancel(() => void task.stop().catch(() => undefined))
      try {
        const res = await task.promise
        if (res.isAborted || token.cancelled) throw new CancelledError()
        return whisperTokens(res.segments, offset, pcm.byteLength / 2 / SR, true)
      } finally {
        off()
      }
    },
    release: () => ctx.release()
  }
}

function floatsFrom(bytes: ArrayBuffer, length: number): Float32Array {
  if (bytes.byteLength !== length * 4) throw new Error('Ungültige Nemotron-Modelldatei.')
  const view = new DataView(bytes)
  return Float32Array.from({ length }, (_, i) => view.getFloat32(i * 4, true))
}

async function loadNemotron(asr: AsrSpec): Promise<Recognizer> {
  const p = (f: string): string => join(asr.modelDir, f)
  const config = JSON.parse(await RNFS.readFile(p('config.json'), 'utf8'))
  if (config.variant !== 'speech-encoder-ctc-only' || config.blankId !== 23862 || config.sampleRate !== 16000) throw new Error('Nicht unterstütztes Nemotron-Modellformat.')
  const vocabulary = JSON.parse(await RNFS.readFile(p('vocab.json'), 'utf8')) as unknown
  if (!Array.isArray(vocabulary) || vocabulary.length !== config.blankId || !vocabulary.every((v) => typeof v === 'string')) throw new Error('Ungültiges Nemotron-Vokabular.')
  const window = floatsFrom(await readBinaryFile(p('mel-window.bin')), 400)
  const filterbank = floatsFrom(await readBinaryFile(p('mel-filterbank.bin')), 128 * 257)
  const options: InferenceSession.SessionOptions = {
    executionProviders: ['cpu'],
    intraOpNumThreads: asr.threads,
    interOpNumThreads: 1,
    executionMode: 'sequential',
    graphOptimizationLevel: 'all'
  }
  const encoder = await InferenceSession.create(p('encoder.int8.onnx'), options)
  let head: InferenceSession
  try {
    head = await InferenceSession.create(p('ctc.int8.onnx'), options)
  } catch (e) {
    await encoder.release()
    throw e
  }
  return {
    key: recognizerKey(asr),
    async recognize(pcm, offset, token) {
      token.throwIfCancelled()
      const samples = pcm16ToFloat(pcm)
      if (samples.length > 32 * SR) throw new Error('Ungültige Audioabschnitt-Länge.')
      const { mel, frames, valid } = logMel(samples, window, filterbank)
      if (!valid) return []
      const length = new Tensor('int64', BigInt64Array.of(BigInt(Math.ceil(valid / 8))), [1])
      const result = await encoder.run({ mel: new Tensor('float32', mel, [1, 128, frames]), enc_len: length })
      token.throwIfCancelled()
      const decoded = await head.run({ states: result.states, enc_len: length })
      const pieces = decodeCtc(decoded.token_ids.data as Int32Array, vocabulary as string[], samples.length / SR)
      return pieces.map((t) => ({ text: t.text, start: t.start + offset, end: t.end + offset }))
    },
    async release() {
      await encoder.release()
      await head.release()
    }
  }
}

class DeviceSpeech implements SpeechEngine {
  readonly kind = 'device' as const
  /** Auf Telefonen ist immer nur ein Modell geladen. */
  private current: Recognizer | null = null

  constructor(private paths: AppPaths, private host: NativeHost) {}

  /** Nur innerhalb von serialized('speech') aufrufen. */
  private async ensure(asr: AsrSpec): Promise<Recognizer> {
    const key = recognizerKey(asr)
    if (this.current?.key === key) return this.current
    if (this.current) {
      const old = this.current
      this.current = null
      await old.release().catch(() => undefined)
    }
    const files = await RNFS.exists(asr.modelDir)
    if (!files) throw new Error(`${asr.def.name} ist nicht installiert.`)
    if (asr.def.engine === 'onnx') this.current = await loadNemotron(asr)
    else if (asr.def.engine === 'whispercpp') this.current = await loadWhisper(asr)
    else this.current = await loadSherpa(asr, this.paths.tmp)
    return this.current
  }

  preload(asr: AsrSpec): Promise<void> {
    return serialized('speech', async () => {
      await this.ensure(asr)
    })
  }

  release(): Promise<void> {
    return serialized('speech', async () => {
      const old = this.current
      this.current = null
      await old?.release().catch(() => undefined)
    })
  }

  private recognize(asr: AsrSpec, pcm: ArrayBuffer, offset: number, token: CancelToken): Promise<Token[]> {
    // Jeder Abschnitt holt den Erkenner neu: ein Diktat dazwischen darf das Modell wechseln
    return serialized('speech', async () => {
      token.throwIfCancelled()
      return (await this.ensure(asr)).recognize(pcm, offset, token)
    })
  }

  /** Beliebige Audiodatei in 16-kHz-Mono-WAV bringen (native Dekodierung von sherpa-onnx). */
  private async prepare(path: string): Promise<{ path: string; temp: boolean }> {
    const local = toPath(path)
    try {
      if (isSpeechWav(await wavInfo(local))) return { path: local, temp: false }
    } catch {
      // keine passende WAV-Datei: umwandeln
    }
    const out = join(this.paths.tmp, `decoded-${uuid()}.wav`)
    try {
      await convertAudioToWav16k(local, out)
    } catch (e) {
      await removePath(out)
      const detail = e instanceof Error ? e.message : String(e)
      throw new Error(`Datei konnte nicht gelesen werden. ${detail}`.trim())
    }
    return { path: out, temp: true }
  }

  private async diarize(path: string, spec: DiarizationSpec, threads: number): Promise<SpeakerTurn[]> {
    const raw = await this.host.engineCall('diarize', {
      path,
      segmentation: spec.segmentation,
      embedding: spec.embedding,
      threads: Math.max(1, Math.min(MAX_DIAR_THREADS, threads)),
      numSpeakers: spec.numSpeakers,
      threshold: spec.threshold
    })
    return normalizeTurns(raw, spec.numSpeakers)
  }

  async transcribe(req: TranscribeRequest): Promise<SpeechResult> {
    const { token, asr } = req
    const progress = req.onProgress ?? (() => undefined)
    progress('decoding', 0)
    const wav = await this.prepare(req.path)
    try {
      token.throwIfCancelled()
      const info = await wavInfo(wav.path)
      const total = info.dataBytes / 2
      const duration = total / SR
      if (duration < 0.1) throw new Error('Die Datei enthält keine Audiospur.')

      // Ein Durchlauf in Blöcken: Energie für die Abschnittsplanung und Pegel für die Wellenform
      const energy = new FrameEnergy()
      const peaks = new PeakCollector(total)
      for (let at = 0; at < info.dataBytes; at += READ_BLOCK) {
        token.throwIfCancelled()
        const block = pcm16ToFloat(await readRange(wav.path, Math.min(READ_BLOCK, info.dataBytes - at), info.dataOffset + at))
        energy.add(block)
        peaks.add(block)
        progress('decoding', Math.min(1, (at + READ_BLOCK) / info.dataBytes))
      }

      let turns: SpeakerTurn[] | undefined
      if (req.diarization && duration > 2) {
        progress('diarizing', 0)
        turns = await this.diarize(wav.path, req.diarization, asr.threads)
        token.throwIfCancelled()
        progress('diarizing', 1)
      }

      progress('loading', 0)
      await this.preload(asr)
      token.throwIfCancelled()
      const chunks = planChunks(energy.result(), total, { maxSec: asr.def.engine === 'onnx' ? NEMOTRON_CHUNK_SEC : MAX_CHUNK_SEC })
      const totalChunkSamples = chunks.reduce((n, c) => n + c.end - c.start, 0) || 1
      let done = 0
      const segments: EngineSegment[] = []
      progress('transcribing', 0)
      for (const c of chunks) {
        token.throwIfCancelled()
        const pcm = await readRange(wav.path, (c.end - c.start) * 2, info.dataOffset + c.start * 2)
        const segs = buildSegments(await this.recognize(asr, pcm, c.start / SR, token), turns)
        token.throwIfCancelled()
        segments.push(...segs)
        if (segs.length) req.onSegments?.(segs)
        done += c.end - c.start
        progress('transcribing', done / totalChunkSamples)
      }
      const speakers = turns ? new Set(turns.map((t) => t.speaker)).size : undefined
      return { segments, duration, peaks: peaks.result(), ...(speakers !== undefined ? { speakers } : {}) }
    } finally {
      if (wav.temp) await removePath(wav.path)
    }
  }

  async assignSpeakers(path: string, segments: EngineSegment[], asr: AsrSpec, spec: DiarizationSpec, _settings: unknown, token: CancelToken): Promise<EngineSegment[]> {
    const info = await wavInfo(toPath(path))
    if (info.dataBytes / 2 / SR <= 2 || !segments.length) return segments
    const turns = await this.diarize(toPath(path), spec, asr.threads)
    token.throwIfCancelled()
    if (!turns.length) return segments
    return segments.map((seg) => ({ ...seg, speaker: dominantSpeaker(turns, seg) }))
  }
}

export function createSpeechEngine(paths: AppPaths, host: NativeHost): SpeechEngine {
  return new DeviceSpeech(paths, host)
}

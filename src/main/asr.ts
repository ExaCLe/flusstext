// Übersetzt ein Katalogmodell in eine konkrete Erkennungs-Konfiguration
// (sherpa-onnx im Engine-Prozess oder ein whisper.cpp-Server auf der GPU).
import { app } from 'electron'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import type { AsrBackend, DiarizationSpec } from '../engine/protocol'
import { diarizationThreshold, pickDiarization } from '@shared/diarization'
import type { Replacement, Settings } from '@shared/types'
import { isInstalled, modelDef, modelPath } from './models'
import { unpacked } from './paths'
import { settings } from './settings'

export function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return unpacked(require('ffmpeg-static') as string)
}

function sherpaConfig(id: string, language: string, threads: number): AsrBackend {
  const def = modelDef(id)!
  const p = (f: string): string => modelPath(id, f)
  const lang = language === 'auto' ? 'de' : language
  const modelConfig: Record<string, unknown> = { tokens: p('tokens.txt'), numThreads: threads, provider: 'cpu', debug: 0 }
  let key = `${id}:${threads}`
  switch (def.sherpaType) {
    case 'nemo_transducer':
      modelConfig.transducer = { encoder: p('encoder.int8.onnx'), decoder: p('decoder.int8.onnx'), joiner: p('joiner.int8.onnx') }
      modelConfig.modelType = 'nemo_transducer'
      break
    case 'canary': {
      const src = ['de', 'en', 'es', 'fr'].includes(lang) ? lang : 'de'
      modelConfig.canary = { encoder: p('encoder.int8.onnx'), decoder: p('decoder.int8.onnx'), srcLang: src, tgtLang: src, usePnc: 1 }
      key += `:${src}`
      break
    }
    case 'cohere':
      modelConfig.cohereTranscribe = { encoder: p('encoder.int8.onnx'), decoder: p('decoder.int8.onnx'), language: lang, usePunct: 1, useItn: 1 }
      key += `:${lang}`
      break
    default:
      throw new Error(`Nicht unterstützter Modelltyp: ${def.sherpaType}`)
  }
  return { type: 'sherpa', key, family: def.family, config: { featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig } }
}

// ------------------------------------------------------------ whisper.cpp-Server

interface ServerState {
  proc: ChildProcess
  key: string
  url: string
  ready: Promise<void>
}

let server: ServerState | null = null

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
}

export function whisperRuntime(useGpu: boolean): { id: string; gpu: boolean } | null {
  if (process.platform === 'darwin') {
    return existsSync(macWhisperPath()) ? { id: 'whispercpp-metal', gpu: useGpu } : null
  }
  if (useGpu && isInstalled('whispercpp-cuda')) return { id: 'whispercpp-cuda', gpu: true }
  if (isInstalled('whispercpp-cpu')) return { id: 'whispercpp-cpu', gpu: false }
  if (isInstalled('whispercpp-cuda')) return { id: 'whispercpp-cuda', gpu: false }
  return null
}

function macWhisperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'whisper', 'whisper-server')
    : join(app.getAppPath(), 'build', 'whisper-mac', 'whisper-server')
}

async function ensureWhisperServer(id: string, s: Settings): Promise<string> {
  const rt = whisperRuntime(s.useGpu)
  if (!rt) throw new Error('Für Whisper-Modelle wird die whisper.cpp-Laufzeit benötigt (Modelle › Komponenten).')
  const exe = process.platform === 'darwin' ? macWhisperPath() : modelPath(rt.id, 'whisper-server.exe')
  if (!existsSync(exe)) throw new Error('whisper-server.exe fehlt – bitte die Laufzeit neu installieren.')
  const key = `${id}:${rt.id}:${rt.gpu}:${s.threads}`
  if (server && server.key === key && server.proc.exitCode === null) {
    await server.ready
    return server.url
  }
  shutdownAsr()
  const port = await freePort()
  const args = ['-m', modelPath(id, 'model.bin'), '--host', '127.0.0.1', '--port', String(port), '-t', String(Math.max(4, s.threads)), '-l', 'de']
  if (!rt.gpu) args.push('-ng')
  const proc = spawn(exe, args, { cwd: process.platform === 'darwin' ? app.getPath('temp') : modelPath(rt.id), windowsHide: true })
  const url = `http://127.0.0.1:${port}`
  let log = ''
  const ready = new Promise<void>((resolve, reject) => {
    const onData = (b: Buffer): void => {
      log = (log + b.toString()).slice(-4000)
      if (/listening at/i.test(log)) resolve()
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.on('error', reject)
    proc.on('exit', (code) => reject(new Error(`whisper.cpp wurde beendet (Code ${code}). ${log.trim().split('\n').slice(-2).join(' ')}`)))
    // stdout ist bei Pipes gepuffert -> Bereitschaft per HTTP abfragen
    const started = Date.now()
    const poll = (): void => {
      if (proc.exitCode !== null) return
      fetch(url)
        .then((r) => (r.ok ? resolve() : Promise.reject(new Error(String(r.status)))))
        .catch(() => {
          if (Date.now() - started > 120000) reject(new Error('whisper.cpp startet nicht (Zeitüberschreitung).'))
          else setTimeout(poll, 300)
        })
    }
    setTimeout(poll, 300)
  })
  server = { proc, key, url, ready }
  try {
    await ready
  } catch (e) {
    shutdownAsr()
    throw e
  }
  console.log(`[whisper.cpp] ${id} bereit auf ${url} (${rt.gpu ? 'GPU' : 'CPU'})`)
  return url
}

export function shutdownAsr(): void {
  if (server) {
    server.proc.kill()
    server = null
  }
}

export async function resolveAsr(modelId: string, language: string): Promise<AsrBackend> {
  const def = modelDef(modelId)
  if (!def || def.kind !== 'asr') throw new Error('Unbekanntes Modell')
  if (!isInstalled(modelId)) throw new Error(`${def.name} ist nicht installiert.`)
  const s = settings.get()
  if (def.engine === 'onnx') return { type: 'nemotron-lite', modelDir: modelPath(modelId), threads: s.threads, family: def.family }
  if (def.engine === 'whispercpp') {
    const url = await ensureWhisperServer(modelId, s)
    return { type: 'whisper-server', url, language: language === 'auto' ? 'auto' : language, family: 'whisper' }
  }
  return sherpaConfig(modelId, language, s.threads)
}

export function diarizationSpec(numSpeakers?: number): DiarizationSpec | undefined {
  const s = settings.get()
  const { seg, emb } = pickDiarization(isInstalled, s)
  if (!seg || !emb) return undefined
  return {
    segmentation: modelPath(seg.id, seg.mainFile ?? 'model.onnx'),
    embedding: modelPath(emb.id, emb.mainFile ?? 'model.onnx'),
    numSpeakers: numSpeakers ?? s.diarization.numSpeakers,
    threshold: diarizationThreshold(emb, s)
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Wörterbuch-Ersetzungen (Groß-/Kleinschreibung egal, nur ganze Wörter). */
export function applyReplacements(text: string, list: Replacement[]): string {
  let out = text
  for (const r of list) {
    if (!r.from.trim()) continue
    const to = r.to.replace(/\\n/g, '\n')
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(r.from.trim())}(?=$|[^\\p{L}\\p{N}])[.,]?`, 'giu')
    out = out.replace(re, (_m, pre: string) => (to === '\n' ? '\n' : pre + to))
  }
  return out.replace(/ *\n */g, '\n')
}

export function onSettingsChanged(s: Settings, prev: Settings): void {
  // whisper.cpp-Server bei geänderter Hardware-Konfiguration neu starten (beim nächsten Gebrauch)
  if (s.useGpu !== prev.useGpu || s.threads !== prev.threads) shutdownAsr()
  const dictModel = (x: Settings): string | null => x.dictationModel ?? x.transcriptionModel
  if (dictModel(s) !== dictModel(prev) || s.language !== prev.language || s.dictation.enabled !== prev.dictation.enabled) {
    void import('./dictation').then((d) => d.warmup())
  }
  if (
    dictModel(s) !== dictModel(prev) ||
    s.dictation.enabled !== prev.dictation.enabled ||
    s.dictation.idlePill !== prev.dictation.idlePill ||
    s.dictation.mode !== prev.dictation.mode ||
    s.dictation.hotkey.join() !== prev.dictation.hotkey.join()
  ) {
    void import('./dictation').then((d) => d.refreshIdle())
  }
}

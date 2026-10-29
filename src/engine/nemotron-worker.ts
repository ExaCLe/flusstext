// Run the local WASM build in a separate Node process. This build has no Windows
// telemetry provider, native ONNX DLLs, model-hub client, or remote execution provider.
process.env.ORT_DISABLE_TELEMETRY = '1'
import { readFileSync } from 'node:fs'
import { join, isAbsolute, dirname, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'
import { logMel, decodeCtc } from './nemotron-frontend'
import { disableNetwork } from './offline'
import type { InferenceSession as OrtSession, Tensor as OrtTensor } from 'onnxruntime-web'

// Use the Node export (not the browser /wasm export) so local files never use fetch.
disableNetwork()
const ort: typeof import('onnxruntime-web') = require('onnxruntime-web')
ort.env.logLevel = 'error'
const runtimeDir = dirname(require.resolve('onnxruntime-web')).replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
ort.env.wasm.wasmBinary = readFileSync(join(runtimeDir, 'ort-wasm-simd-threaded.wasm'))
ort.env.wasm.wasmPaths = { mjs: pathToFileURL(join(runtimeDir, 'ort-wasm-simd-threaded.mjs')).href }
ort.env.wasm.proxy = false
ort.env.wasm.numThreads = Math.max(1, Math.min(8, Number(process.env.FLUSSTEXT_ONNX_THREADS) || 4))

interface Loaded {
  key: string
  encoder: OrtSession
  head: OrtSession
  window: Float32Array
  filterbank: Float32Array
  vocabulary: string[]
}
let loaded: Loaded | undefined

function floats(path: string, length: number): Float32Array {
  const data = readFileSync(path)
  if (data.length !== length * 4) throw new Error('Ungültige Nemotron-Modelldatei.')
  return Float32Array.from({ length }, (_, i) => data.readFloatLE(i * 4))
}

async function load(modelDir: string, threads: number): Promise<Loaded> {
  if (!isAbsolute(modelDir)) throw new Error('Ein lokaler Modellordner wird benötigt.')
  const key = `${modelDir}:${threads}`
  if (loaded?.key === key) return loaded
  if (loaded) {
    await loaded.encoder.release()
    await loaded.head.release()
    loaded = undefined
  }
  const config = JSON.parse(readFileSync(join(modelDir, 'config.json'), 'utf8'))
  if (config.variant !== 'speech-encoder-ctc-only' || config.blankId !== 23862 || config.sampleRate !== 16000) throw new Error('Nicht unterstütztes Nemotron-Modellformat.')
  const vocabulary = JSON.parse(readFileSync(join(modelDir, 'vocab.json'), 'utf8')) as unknown
  if (!Array.isArray(vocabulary) || vocabulary.length !== config.blankId || !vocabulary.every((v) => typeof v === 'string')) throw new Error('Ungültiges Nemotron-Vokabular.')
  const options: OrtSession.SessionOptions = {
    executionProviders: ['wasm'],
    interOpNumThreads: 1, executionMode: 'sequential', graphOptimizationLevel: 'all'
  }
  const window = floats(join(modelDir, 'mel-window.bin'), 400)
  const filterbank = floats(join(modelDir, 'mel-filterbank.bin'), 128 * 257)
  const encoder = await ort.InferenceSession.create(readFileSync(join(modelDir, 'encoder.int8.onnx')), options)
  try {
    const head = await ort.InferenceSession.create(readFileSync(join(modelDir, 'ctc.int8.onnx')), options)
    loaded = { key, encoder, head, window, filterbank, vocabulary }
    return loaded
  } catch (error) {
    await encoder.release()
    throw error
  }
}

async function handle(request: { method: string; modelDir: string; threads: number; samples?: string }): Promise<unknown> {
  if (!Number.isInteger(request.threads) || request.threads < 1) throw new Error('Ungültige Thread-Anzahl.')
  const model = await load(request.modelDir, request.threads)
  if (request.method === 'load') return true
  if (request.method !== 'transcribe' || typeof request.samples !== 'string') throw new Error('Ungültige Anfrage.')
  const bytes = Buffer.from(request.samples, 'base64')
  if (bytes.length % 4 || bytes.length > 32 * 16000 * 4) throw new Error('Ungültige Audioabschnitt-Länge.')
  const samples = Float32Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4))
  const { mel, frames, valid } = logMel(samples, model.window, model.filterbank)
  if (!valid) return []
  const length = new ort.Tensor('int64', BigInt64Array.of(BigInt(Math.ceil(valid / 8))), [1])
  let states: OrtTensor | undefined
  try {
    const result = await model.encoder.run({ mel: new ort.Tensor('float32', mel, [1, 128, frames]), enc_len: length })
    states = result.states
    const decoded = await model.head.run({ states, enc_len: length })
    const ids = decoded.token_ids
    try { return decodeCtc(ids.data as Int32Array, model.vocabulary, samples.length / 16000) }
    finally { ids.dispose() }
  } finally {
    length.dispose()
    states?.dispose()
  }
}

const lines = createInterface({ input: process.stdin })
let pending = Promise.resolve()
lines.on('line', (line) => {
  pending = pending.then(async () => {
    let id: unknown
    try {
      const request = JSON.parse(line)
      id = request.id
      const result = await handle(request)
      process.stdout.write(JSON.stringify({ id, result }) + '\n')
    } catch (error) {
      process.stdout.write(JSON.stringify({ id, error: error instanceof Error ? error.message : String(error) }) + '\n')
    }
  })
})
// When the owning engine exits, its stdin pipe closes; do not leave a model process behind.
lines.on('close', () => process.exit(0))

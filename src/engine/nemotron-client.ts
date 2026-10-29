import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { AsrBackend } from './protocol'
import type { TimedPiece } from './nemotron-frontend'

type Backend = Extract<AsrBackend, { type: 'nemotron-lite' }>
let worker: ChildProcessWithoutNullStreams | undefined
let workerThreads = 0
let nextId = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

function ensure(threads: number): ChildProcessWithoutNullStreams {
  if (worker && workerThreads === threads) return worker
  if (worker) stopNemotron('Die Nemotron-Hardwareeinstellungen wurden geändert.')
  const child = spawn(process.execPath, [join(__dirname, 'nemotron-worker.js')], {
    windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ORT_DISABLE_TELEMETRY: '1', FLUSSTEXT_ONNX_THREADS: String(threads) }, stdio: 'pipe'
  })
  worker = child
  workerThreads = threads
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const reply = JSON.parse(line)
      const task = pending.get(reply.id)
      if (!task) return
      clearTimeout(task.timer)
      pending.delete(reply.id)
      if (reply.error) task.reject(new Error(`Nemotron Lite: ${reply.error}`))
      else task.resolve(reply.result)
    } catch { stopNemotron('Ungültige Antwort der Nemotron-Laufzeit.') }
  })
  child.stderr.on('data', (data) => console.error(`[nemotron] ${String(data).trim()}`))
  child.stdin.on('error', (error) => { if (worker === child) stopNemotron(error.message) })
  child.on('error', (error) => { if (worker === child) stopNemotron(error.message) })
  child.on('exit', () => { if (worker === child) stopNemotron('Die Nemotron-Laufzeit wurde beendet.') })
  return child
}

function call(asr: Backend, method: 'load' | 'transcribe', samples?: Float32Array): Promise<unknown> {
  const child = ensure(asr.threads)
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => stopNemotron('Die Nemotron-Laufzeit antwortet nicht (Zeitüberschreitung).'), 180_000)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(JSON.stringify({
      id, method, modelDir: asr.modelDir, threads: asr.threads,
      samples: samples ? Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64') : undefined
    }) + '\n', (error) => { if (error && worker === child) stopNemotron(error.message) })
  })
}

export async function preloadNemotron(asr: Backend): Promise<void> { await call(asr, 'load') }

export async function recognizeNemotron(asr: Backend, samples: Float32Array, offset: number): Promise<TimedPiece[]> {
  const tokens = await call(asr, 'transcribe', samples) as TimedPiece[]
  return tokens.map((t) => ({ text: t.text, start: t.start + offset, end: t.end + offset }))
}

export function stopNemotron(message = 'Nemotron wurde entladen.'): void {
  const child = worker
  worker = undefined
  child?.kill()
  for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error(message)) }
  pending.clear()
}

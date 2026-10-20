import { utilityProcess, type UtilityProcess } from 'electron'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import type { EngineEvent, EngineResponse } from '../engine/protocol'

/** Client für den Engine-Prozess mit automatischem Neustart nach Abstürzen. */
class EngineClient extends EventEmitter {
  private proc: UtilityProcess | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  private ensure(): UtilityProcess {
    if (this.proc) return this.proc
    const proc = utilityProcess.fork(join(__dirname, 'engine.js'), [], {
      serviceName: 'Flusstext Engine',
      stdio: 'pipe'
    })
    proc.stdout?.on('data', (b) => process.stdout.write(`[engine] ${b}`))
    proc.stderr?.on('data', (b) => process.stderr.write(`[engine] ${b}`))
    proc.on('message', (msg: EngineResponse | EngineEvent) => {
      if ('event' in msg) {
        if (msg.event === 'log') console.log(`[engine] ${msg.message}`)
        this.emit(msg.event, msg)
        return
      }
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error))
      else p.resolve(msg.result)
    })
    proc.on('exit', (code) => {
      console.warn(`[engine] beendet (Code ${code})`)
      this.proc = null
      for (const p of this.pending.values()) p.reject(new Error('Die Transkriptions-Engine wurde unerwartet beendet.'))
      this.pending.clear()
      this.emit('restart')
    })
    this.proc = proc
    return proc
  }

  call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    const proc = this.ensure()
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      proc.postMessage({ id, method, params })
    })
  }

  /** Ohne Antwort (z. B. Audio-Chunks während der Live-Aufnahme). */
  notify(method: string, params: unknown): void {
    this.ensure().postMessage({ id: -1, method, params })
  }

  kill(): void {
    this.proc?.kill()
  }
}

export const engine = new EngineClient()

// Das Mikrofon des Hosts gehört immer genau einer Funktion (Aufnahme oder Diktat).
import type { HostEvent, NativeHost } from './host'
import { CancelledError, type CancelToken } from './speech-types'

export type MicOwner = 'recording' | 'dictation'

export interface MicHandlers {
  onAudio(elapsed: number, level: number): void
  onError(message: string): void
}

export class Microphone {
  private lease: { owner: MicOwner; handlers: MicHandlers | null; startingAudio: boolean; token?: CancelToken } | null = null

  constructor(private host: NativeHost) {}

  get busy(): MicOwner | null {
    return this.lease?.owner ?? null
  }

  /** Zugriff anfragen und Aufnahme in `path` starten. */
  async start(owner: MicOwner, path: string, deviceId: string, handlers: MicHandlers, token?: CancelToken): Promise<void> {
    if (this.lease) throw new Error(this.lease.owner === 'recording' ? 'Es läuft bereits eine Aufnahme.' : 'Es läuft gerade ein Diktat.')
    const lease = { owner, handlers: null as MicHandlers | null, startingAudio: false, token }
    this.lease = lease
    try {
      if (!(await this.host.requestMicrophone())) throw new Error('Kein Zugriff aufs Mikrofon. Bitte den Mikrofonzugriff für Flusstext in den Systemeinstellungen erlauben.')
      token?.throwIfCancelled()
      if (this.lease !== lease) throw new CancelledError()
      lease.handlers = handlers
      lease.startingAudio = true
      await this.host.audioStart(path, deviceId || 'default')
      token?.throwIfCancelled()
      if (this.lease !== lease) throw new CancelledError()
      lease.startingAudio = false
    } catch (e) {
      // Keep the lease until an in-flight audioStart is cleaned up. It must not stop a newer session.
      if (lease.startingAudio && this.lease === lease) await this.host.audioCancel().catch(() => undefined)
      if (this.lease === lease) this.lease = null
      throw e
    }
  }

  /** Nur der aktuelle Besitzer gibt das Mikrofon frei. */
  release(owner: MicOwner, token?: CancelToken): void {
    if (this.lease?.owner !== owner || this.lease.startingAudio) return
    if (token && this.lease.token !== token) return
    this.lease = null
  }

  handle(event: HostEvent): void {
    const handlers = this.lease?.handlers
    if (!handlers) return
    if (event.type === 'audio') handlers.onAudio(event.elapsed, event.level)
    else if (event.type === 'audioError') handlers.onError(event.message || 'Mikrofon nicht verfügbar')
  }
}

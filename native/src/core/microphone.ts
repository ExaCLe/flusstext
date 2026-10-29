// Das Mikrofon des Hosts gehört immer genau einer Funktion (Aufnahme oder Diktat).
import type { HostEvent, NativeHost } from './host'

export type MicOwner = 'recording' | 'dictation'

export interface MicHandlers {
  onAudio(elapsed: number, level: number): void
  onError(message: string): void
}

export class Microphone {
  private owner: MicOwner | null = null
  private handlers: MicHandlers | null = null

  constructor(private host: NativeHost) {}

  get busy(): MicOwner | null {
    return this.owner
  }

  /** Zugriff anfragen und Aufnahme in `path` starten. */
  async start(owner: MicOwner, path: string, deviceId: string, handlers: MicHandlers): Promise<void> {
    if (this.owner) throw new Error(this.owner === 'recording' ? 'Es läuft bereits eine Aufnahme.' : 'Es läuft gerade ein Diktat.')
    this.owner = owner
    try {
      if (!(await this.host.requestMicrophone())) throw new Error('Kein Zugriff aufs Mikrofon. Bitte den Mikrofonzugriff für Flusstext in den Systemeinstellungen erlauben.')
      this.handlers = handlers
      await this.host.audioStart(path, deviceId || 'default')
    } catch (e) {
      this.owner = null
      this.handlers = null
      throw e
    }
  }

  /** Nur der aktuelle Besitzer gibt das Mikrofon frei. */
  release(owner: MicOwner): void {
    if (this.owner !== owner) return
    this.owner = null
    this.handlers = null
  }

  handle(event: HostEvent): void {
    if (!this.handlers) return
    if (event.type === 'audio') this.handlers.onAudio(event.elapsed, event.level)
    else if (event.type === 'audioError') this.handlers.onError(event.message || 'Mikrofon nicht verfügbar')
  }
}

// Wiedergabe über den nativen Player. Position und Zustand stammen aus den Host-Ereignissen.
import type { Bus } from './bus'
import type { PlaybackState } from './contracts'
import { RNFS, toPath } from './fs'
import type { HostEvent, NativeHost } from './host'
import type { TranscriptStore } from './store'

export const MIN_RATE = 0.5
export const MAX_RATE = 3

export function clampRate(rate: number | undefined, fallback: number): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return fallback
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(rate * 100) / 100))
}

export class Playback {
  private value: PlaybackState = { transcriptId: null, time: 0, duration: 0, playing: false, rate: 1 }
  private path: string | null = null

  constructor(private bus: Bus, private host: NativeHost, private transcripts: TranscriptStore) {}

  state(): PlaybackState {
    return this.value
  }

  private set(patch: Partial<PlaybackState>): void {
    this.value = { ...this.value, ...patch }
    this.bus.emit({ type: 'playback', value: this.value })
  }

  async play(id: string, at = 0, rate?: number): Promise<void> {
    const t = await this.transcripts.get(id)
    if (!t) throw new Error('Transkript nicht gefunden.')
    const path = t.audioPath ? toPath(t.audioPath) : null
    if (!path || !(await RNFS.exists(path))) throw new Error('Die Audiodatei ist nicht mehr vorhanden.')
    const r = clampRate(rate, this.value.rate)
    const start = Math.max(0, Number.isFinite(at) ? at : 0)
    await this.host.play(path, start, r)
    this.path = path
    // Befehl bestätigt; Zeit und Laufzustand folgen aus den Ereignissen des Players
    this.set({ transcriptId: id, time: start, duration: t.duration || this.value.duration, playing: true, rate: r })
  }

  async pause(): Promise<void> {
    if (!this.path) return
    await this.host.pausePlayback()
    this.set({ playing: false })
  }

  async setRate(rate: number): Promise<void> {
    const r = clampRate(rate, this.value.rate)
    if (this.value.playing && this.path) await this.host.play(this.path, this.value.time, r)
    this.set({ rate: r })
  }

  /** Abspielen beenden, wenn das zugehörige Transkript gelöscht wird. */
  async forget(id: string): Promise<void> {
    if (this.value.transcriptId !== id) return
    if (this.value.playing) await this.host.pausePlayback().catch(() => undefined)
    this.path = null
    this.set({ transcriptId: null, time: 0, duration: 0, playing: false })
  }

  handle(event: HostEvent): void {
    if (event.type !== 'playback' || !this.path || toPath(event.path) !== this.path) return
    this.set({
      time: Number.isFinite(event.time) ? Math.max(0, event.time) : this.value.time,
      duration: Number.isFinite(event.duration) && event.duration > 0 ? event.duration : this.value.duration,
      playing: !!event.playing
    })
  }
}

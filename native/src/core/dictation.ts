// Diktat: kurze Aufnahme → Text mit Wörterbuch-Ersetzungen → Verlauf und Zwischenablage.
// Mac: globale Tastenkürzel (host.setHotkeys) und Einfügen ins aktive Programm (host.pasteText).
// Telefone: Steuerung in der App; der Text landet im Verlauf und auf Wunsch in der Zwischenablage.
import type { Settings } from '../../../src/shared/types'
import { resolveAsr } from './asr'
import type { Bus } from './bus'
import { errorMessage } from './bus'
import type { DictationState } from './contracts'
import { isPhone, type Platform } from './domain/catalog'
import { SR } from './domain/chunking'
import { applyReplacements, countWords, uuid } from './domain/text'
import { join, removePath, toPath, wavInfo, type AppPaths } from './fs'
import type { NativeHost } from './host'
import type { Microphone } from './microphone'
import type { ModelManager } from './models'
import type { SettingsStore } from './settings'
import { CancelToken, isCancelled, type SpeechEngine } from './speech-types'
import type { DictationStore } from './store'

const MIN_SEC = 0.25
/** Diktate sind kurz; lange Aufnahmen gehören in „Aufnahme“. */
const MAX_SEC_PHONE = 5 * 60
const MAX_SEC_DESKTOP = 10 * 60

interface Session {
  id: string
  path: string
  token: CancelToken
  limit: ReturnType<typeof setTimeout> | null
}

const IDLE: DictationState = { phase: 'idle', elapsed: 0, level: 0 }

export class Dictation {
  private value: DictationState = IDLE
  private session: Session | null = null

  constructor(
    private paths: AppPaths,
    private bus: Bus,
    private host: NativeHost,
    private mic: Microphone,
    private history: DictationStore,
    private settings: SettingsStore,
    private models: ModelManager,
    private speech: SpeechEngine,
    private platform: Platform
  ) {}

  state(): DictationState {
    return this.value
  }

  private set(next: DictationState): void {
    this.value = next
    this.bus.emit({ type: 'dictationState', value: next })
    if (this.platform === 'macos') void this.host.updateDictationState?.(next).catch(() => undefined)
  }

  private asr(s: Settings) {
    return resolveAsr(this.models, s, s.dictationModel ?? s.transcriptionModel)
  }

  async start(): Promise<void> {
    if (this.session || this.value.phase !== 'idle') return
    const s = this.settings.get()
    const asr = this.asr(s)
    const session: Session = { id: uuid(), path: '', token: new CancelToken(), limit: null }
    session.path = join(this.paths.tmp, `dictation-${session.id}.wav`)
    this.session = session
    try {
      await this.mic.start('dictation', session.path, s.micDeviceId, {
        onAudio: (elapsed, level) => {
          if (this.session === session && this.value.phase === 'listening') this.set({ phase: 'listening', elapsed, level: Math.max(0, Math.min(1, level)) })
        },
        onError: (message) => {
          if (this.session !== session) return
          void this.cancel().finally(() => this.set({ ...IDLE, error: message }))
        }
      }, session.token)
    } catch (e) {
      if (this.session === session) this.session = null
      await removePath(session.path)
      if (session.token.cancelled || isCancelled(e)) return
      throw e
    }
    if (this.session !== session || session.token.cancelled) return
    this.set({ phase: 'listening', elapsed: 0, level: 0 })
    // Modell schon während des Sprechens laden
    void this.speech.preload(asr).catch(() => undefined)
    const max = isPhone(this.platform) ? MAX_SEC_PHONE : MAX_SEC_DESKTOP
    session.limit = setTimeout(() => {
      if (this.session === session) void this.stop().catch((e) => this.bus.error(e, 'Diktat fehlgeschlagen'))
    }, max * 1000)
  }

  /** Aufnahme beenden und erkennen. Wirft verständliche Fehler (z. B. „Keine Sprache erkannt“). */
  async stop(): Promise<void> {
    const session = this.session
    if (!session) return
    if (this.value.phase === 'idle') return this.cancel()
    if (this.value.phase !== 'listening') return
    if (session.limit) clearTimeout(session.limit)
    this.set({ phase: 'processing', elapsed: this.value.elapsed, level: 0 })
    const t0 = Date.now()
    let path = session.path
    let recording = true
    try {
      const stopped = await this.host.audioStop()
      recording = false
      this.mic.release('dictation', session.token)
      path = toPath(stopped.path || session.path)
      const s = this.settings.get()
      const asr = this.asr(s)
      const duration = (await wavInfo(path)).dataBytes / 2 / SR
      if (duration < MIN_SEC) throw new Error('Nichts gehört – Mikrofon prüfen?')
      const res = await this.speech.transcribe({ path, asr, settings: s, token: session.token })
      session.token.throwIfCancelled()
      let text = applyReplacements(res.segments.map((x) => x.text).join(' '), s.replacements).trim()
      if (!text) throw new Error('Keine Sprache erkannt')
      if (s.dictation.trailingSpace && !/\s$/.test(text)) text += ' '
      const { pasted, copied } = await this.deliver(text, s)
      await this.history.add({
        id: uuid(),
        createdAt: Date.now(),
        text: text.trim(),
        duration,
        words: countWords(text),
        modelId: asr.modelId,
        processingMs: Date.now() - t0
      })
      if (this.session === session) this.set({ ...IDLE, text: text.trim(), pasted, copied })
    } catch (e) {
      if (isCancelled(e) || session.token.cancelled) return
      if (this.session === session) this.set({ ...IDLE, error: errorMessage(e, 'Diktat fehlgeschlagen') })
      throw e
    } finally {
      // Konnte der Host nicht stoppen, die Aufnahme verwerfen statt das Mikrofon offen zu lassen
      if (recording && this.session === session) await this.host.audioCancel().catch(() => undefined)
      this.mic.release('dictation', session.token)
      if (this.session === session) this.session = null
      await removePath(path)
      if (path !== session.path) await removePath(session.path)
    }
  }

  private async deliver(text: string, s: Settings): Promise<{ pasted: boolean; copied: boolean }> {
    if (!isPhone(this.platform) && s.dictation.autoPaste) {
      const pasted = await this.host.pasteText(text, s.dictation.restoreClipboard).catch((e) => {
        this.bus.error(e, 'Text konnte nicht eingefügt werden')
        return false
      })
      if (pasted) return { pasted: true, copied: false }
    }
    if (s.dictation.autoPaste || !isPhone(this.platform)) {
      await this.host.copyText(text)
      return { pasted: false, copied: true }
    }
    return { pasted: false, copied: false }
  }

  async cancel(): Promise<void> {
    const session = this.session
    if (!session) return
    session.token.cancel()
    if (session.limit) clearTimeout(session.limit)
    this.session = null
    this.set(IDLE)
    try {
      if (this.mic.busy === 'dictation') await this.host.audioCancel()
    } finally {
      this.mic.release('dictation', session.token)
      await removePath(session.path)
    }
  }

  async pasteLast(): Promise<void> {
    const last = this.history.list()[0]
    if (!last) return
    const s = this.settings.get()
    const text = last.text + (s.dictation.trailingSpace ? ' ' : '')
    if (!isPhone(this.platform) && (await this.host.pasteText(text, s.dictation.restoreClipboard))) return
    await this.host.copyText(text)
  }

  /** Globale Tastenkürzel nur auf dem Mac; Telefone steuern das Diktat in der App. */
  async applyHotkeys(s: Settings): Promise<void> {
    if (isPhone(this.platform)) return
    await this.host.setHotkeys({
      enabled: s.dictation.enabled,
      hotkey: s.dictation.hotkey,
      pasteLastHotkey: s.dictation.pasteLastHotkey,
      mode: s.dictation.mode,
      idlePill: s.dictation.idlePill, sounds: s.dictation.sounds,
      ready: !!(s.dictationModel ?? s.transcriptionModel) && this.models.isInstalled((s.dictationModel ?? s.transcriptionModel)!)
    })
  }

  onHotkey(action: 'start' | 'stop' | 'cancel' | 'pasteLast'): void {
    if (!this.settings.get().dictation.enabled) return
    const run = async (): Promise<void> => {
      if (action === 'start') {
        // Umschaltmodus: erneuter Druck beendet das Diktat
        if (this.value.phase === 'listening') await this.stop()
        else await this.start()
      } else if (action === 'stop') await this.stop()
      else if (action === 'cancel') await this.cancel()
      else await this.pasteLast()
    }
    run().catch((e) => this.bus.error(e, 'Diktat fehlgeschlagen'))
  }
}

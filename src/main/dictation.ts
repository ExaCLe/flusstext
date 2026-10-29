// Globales Diktat im Stil von Wispr Flow: Hotkey halten (oder antippen für freihändig),
// sprechen, loslassen – der Text wird ins fokussierte Textfeld eingefügt.
import { app, clipboard, ClipboardItem, ipcMain, Notification, systemPreferences } from 'electron'
import { randomUUID } from 'node:crypto'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import { keyLabel, normalizeKey, sortKeys } from '@shared/keys'
import type { OverlayState } from '@shared/types'
import { resolveAsr, applyReplacements } from './asr'
import { engine } from './engine'
import { isInstalled, modelPath } from './models'
import { settings } from './settings'
import { countWords, dictations } from './store'
import { getOverlayWindow, hideOverlay, sendToAll, sendToMain, showOverlay } from './windows'

const TAP_MS = 280
const SR = 16000

type Phase = 'idle' | 'arming' | 'listening' | 'processing'

let phase: Phase = 'idle'
let handsFree = false
let pressedAt = 0
let startedAt = 0
let capturing = false
let hookStarted = false
const pressed = new Set<number>()
let audioWaiter: ((samples: Float32Array | null) => void) | null = null
let hideTimer: NodeJS.Timeout | null = null
let current: OverlayState = { kind: 'hidden' }

function setState(s: OverlayState): void {
  current = s
  sendToAll('overlay:state', s)
}

function idleEnabled(): boolean {
  const s = settings.get()
  const model = s.dictationModel ?? s.transcriptionModel
  return s.dictation.enabled && s.dictation.idlePill && !!model && isInstalled(model)
}

function idleHint(): string {
  const s = settings.get()
  const keys = sortKeys(s.dictation.hotkey).map((k) => keyLabel(k, process.platform)).join(' + ')
  return s.dictation.mode === 'toggle' ? `Klicken oder ${keys} drücken` : `Klicken oder ${keys} halten`
}

/** Nach einem Diktat: zur Ruhe-Pille schrumpfen oder ganz ausblenden. */
function rest(): void {
  if (idleEnabled()) {
    setState({ kind: 'idle', hint: idleHint() })
  } else {
    setState({ kind: 'hidden' })
    hideTimer = setTimeout(hideOverlay, 260)
  }
}

/** Ruhe-Pille passend zu den Einstellungen ein- oder ausblenden. */
export function refreshIdle(): void {
  // Nicht in eine laufende Rückmeldung („Eingefügt“, Fehler) hineinfunken
  if (phase !== 'idle' || (current.kind !== 'idle' && current.kind !== 'hidden')) return
  if (hideTimer) clearTimeout(hideTimer)
  if (idleEnabled()) {
    showOverlay('keep')
    setState({ kind: 'idle', hint: idleHint() })
  } else if (current.kind === 'idle') rest()
}

function command(type: 'start' | 'stop' | 'cancel'): void {
  const s = settings.get()
  getOverlayWindow()?.webContents.send('overlay:command', { type, deviceId: s.micDeviceId, sounds: s.dictation.sounds })
}

function matches(keys: number[]): boolean {
  if (!keys.length || pressed.size !== keys.length) return false
  return keys.every((k) => pressed.has(normalizeKey(k)))
}

function start(): void {
  if (hideTimer) clearTimeout(hideTimer)
  phase = 'arming'
  handsFree = settings.get().dictation.mode === 'toggle'
  startedAt = Date.now()
  showOverlay()
  setState({ kind: 'arming' })
  command('start')
  // Modell schon während der Aufnahme laden
  void warmup()
}

function stop(): void {
  if (phase !== 'listening' && phase !== 'arming') return
  phase = 'processing'
  setState({ kind: 'processing' })
  const audio = new Promise<Float32Array | null>((resolve) => {
    audioWaiter = resolve
    setTimeout(() => resolve(null), 4000)
  })
  command('stop')
  void audio.then(finish)
}

function cancel(): void {
  if (phase === 'idle') return
  phase = 'idle'
  audioWaiter = null
  command('cancel')
  rest()
}

function flash(s: OverlayState, ms: number): void {
  setState(s)
  hideTimer = setTimeout(rest, ms)
}

async function finish(samples: Float32Array | null): Promise<void> {
  audioWaiter = null
  if (phase !== 'processing') return
  const s = settings.get()
  try {
    if (!samples || samples.length < SR * 0.25) {
      phase = 'idle'
      flash({ kind: 'error', message: 'Nichts gehört – Mikrofon prüfen?' }, 1600)
      return
    }
    const modelId = s.dictationModel ?? s.transcriptionModel
    if (!modelId) throw new Error('Kein Modell ausgewählt')
    const t0 = Date.now()
    const asr = await resolveAsr(modelId, s.language)
    const res = await engine.call<{ text: string }>('transcribeSamples', {
      asr,
      samples,
      vadModel: modelPath('vad-silero', 'silero_vad.onnx'),
      threads: s.threads
    })
    let text = applyReplacements(res.text, s.replacements).trim()
    phase = 'idle'
    if (!text) {
      flash({ kind: 'error', message: 'Keine Sprache erkannt' }, 1400)
      return
    }
    if (s.dictation.trailingSpace && !/\s$/.test(text)) text += ' '
    const pasted = s.dictation.autoPaste ? await paste(text, s.dictation.restoreClipboard) : (await clipboard.writeText(text), false)
    dictations.add({
      id: randomUUID(),
      createdAt: Date.now(),
      text: text.trim(),
      duration: samples.length / SR,
      words: countWords(text),
      modelId,
      processingMs: Date.now() - t0
    })
    sendToMain('dictation:history')
    flash({ kind: 'done', text: text.trim(), pasted }, 1400)
  } catch (e) {
    phase = 'idle'
    const message = (e as Error).message
    flash({ kind: 'error', message: message.length > 60 ? 'Transkription fehlgeschlagen' : message }, 2600)
    if (Notification.isSupported()) new Notification({ title: 'Diktat fehlgeschlagen', body: message }).show()
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Aktuellen Zwischenablage-Inhalt (alle Formate) sichern. */
async function snapshotClipboard(): Promise<ClipboardItem[] | null> {
  try {
    const items = await clipboard.read()
    return await Promise.all(
      items.map(async (item) => {
        const data: Record<string, Blob> = {}
        for (const type of item.types) {
          try {
            const v = await item.getType(type)
            if (v instanceof Blob) data[type] = v
          } catch {
            // Format nicht lesbar – überspringen
          }
        }
        return new ClipboardItem(data)
      })
    )
  } catch {
    return null
  }
}

/** Text über die Zwischenablage + Strg+V einfügen und die Zwischenablage danach wiederherstellen. */
async function paste(text: string, restore: boolean): Promise<boolean> {
  // Warten, bis der Nutzer alle Tasten losgelassen hat (sonst wird z. B. Win+Strg+V gesendet)
  for (let i = 0; i < 40 && pressed.size > 0; i++) await sleep(25)
  const saved = restore ? await snapshotClipboard() : null
  await clipboard.writeText(text)
  await sleep(30)
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) return false
  uIOhook.keyTap(UiohookKey.V, [process.platform === 'darwin' ? UiohookKey.Meta : UiohookKey.Ctrl])
  if (saved) {
    setTimeout(async () => {
      if ((await clipboard.readText()) !== text) return // Nutzer hat inzwischen etwas anderes kopiert
      if (saved.length && saved.some((i) => i.types.length)) await clipboard.write(saved).catch(() => clipboard.clear())
      else clipboard.clear()
    }, 700)
  }
  return true
}

async function pasteLast(): Promise<void> {
  const last = dictations.list()[0]
  if (last) await paste(last.text + (settings.get().dictation.trailingSpace ? ' ' : ''), settings.get().dictation.restoreClipboard)
}

let warming: Promise<void> | null = null
export function warmup(): Promise<void> {
  const s = settings.get()
  const modelId = s.dictationModel ?? s.transcriptionModel
  if (!modelId || !s.dictation.enabled) return Promise.resolve()
  if (!warming) {
    warming = resolveAsr(modelId, s.language)
      .then((asr) => engine.call('preload', { asr }))
      .then(() => undefined)
      .catch((e) => console.warn('Diktat-Modell konnte nicht geladen werden:', e))
      .finally(() => (warming = null))
  }
  return warming
}

function onKeyDown(code: number): void {
  const k = normalizeKey(code)
  if (pressed.has(k)) return // Tastenwiederholung
  pressed.add(k)
  if (capturing) {
    sendToMain('dictation:key', { type: 'down', keycode: k })
    return
  }
  const s = settings.get()
  if (!s.dictation.enabled) return

  if ((phase === 'listening' || phase === 'arming') && k === UiohookKey.Escape) return cancel()

  if (matches(s.dictation.hotkey)) {
    if (phase === 'idle') {
      pressedAt = Date.now()
      // Verhindert, dass beim Loslassen der Win-Taste das Startmenü aufgeht
      if (process.platform === 'win32' && s.dictation.hotkey.includes(UiohookKey.Meta)) uIOhook.keyTap(UiohookKey.F24)
      start()
    } else if (handsFree && (phase === 'listening' || phase === 'arming')) {
      stop()
    }
    return
  }
  if (phase === 'idle' && matches(s.dictation.pasteLastHotkey)) void pasteLast()
}

function onKeyUp(code: number): void {
  const k = normalizeKey(code)
  const wasPressed = pressed.delete(k)
  if (capturing) {
    if (wasPressed) sendToMain('dictation:key', { type: 'up', keycode: k })
    return
  }
  const s = settings.get()
  if (handsFree || (phase !== 'listening' && phase !== 'arming')) return
  if (!s.dictation.hotkey.map(normalizeKey).includes(k)) return
  if (s.dictation.mode === 'hybrid' && Date.now() - pressedAt < TAP_MS) {
    // Kurz angetippt -> freihändiger Modus bis zum nächsten Druck
    handsFree = true
    setState({ kind: 'listening', handsFree: true, startedAt })
    return
  }
  stop()
}

function startKeyboardHook(): void {
  if (hookStarted) return
  // libuiohook may terminate the process if macOS denies its event tap.
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) return
  try {
    uIOhook.start()
    hookStarted = true
  } catch (e) {
    console.error('Globaler Tastatur-Hook konnte nicht gestartet werden', e)
  }
}

export function initDictation(): void {
  uIOhook.on('keydown', (e) => onKeyDown(e.keycode))
  uIOhook.on('keyup', (e) => onKeyUp(e.keycode))
  startKeyboardHook()
  app.on('browser-window-focus', startKeyboardHook)

  ipcMain.on('overlay:micReady', () => {
    if (phase !== 'arming') return
    phase = 'listening'
    setState({ kind: 'listening', handsFree, startedAt })
  })
  ipcMain.on('overlay:micError', (_e, message: string) => {
    phase = 'idle'
    flash({ kind: 'error', message: message || 'Mikrofon nicht verfügbar' }, 2400)
  })
  ipcMain.on('overlay:audio', (_e, samples: Float32Array) => audioWaiter?.(samples))
  ipcMain.on('overlay:cancel', () => cancel())
  ipcMain.on('overlay:stop', () => stop())
  ipcMain.on('overlay:start', () => {
    if (phase !== 'idle' || !settings.get().dictation.enabled) return
    start()
    handsFree = true
  })
  ipcMain.on('overlay:hello', (e) => e.sender.send('overlay:state', current))
  ipcMain.on('overlay:interactive', (_e, on: boolean) => {
    getOverlayWindow()?.setIgnoreMouseEvents(!on, { forward: true })
  })
  ipcMain.handle('dictation:capture', (_e, on: boolean) => {
    capturing = on
    pressed.clear()
  })
}

/** Beim Start: Ruhe-Pille auf dem Hauptbildschirm zeigen. */
export function showIdlePill(): void {
  if (phase !== 'idle' || !idleEnabled()) return
  showOverlay('primary')
  setState({ kind: 'idle', hint: idleHint() })
}

export function stopDictation(): void {
  if (hookStarted) uIOhook.stop()
}

export function dictationActive(): boolean {
  return phase !== 'idle'
}

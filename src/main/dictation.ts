// Globales Diktat im Stil von Wispr Flow: Hotkey halten (oder antippen für freihändig),
// sprechen, loslassen – der Text wird ins fokussierte Textfeld eingefügt.
import { clipboard, ClipboardItem, ipcMain, Notification, powerMonitor, type Rectangle } from 'electron'
import { randomUUID } from 'node:crypto'
import { keyLabel, normalizeKey, sortKeys } from '@shared/keys'
import type { OverlayState } from '@shared/types'
import { resolveAsr, applyReplacements } from './asr'
import { engine } from './engine'
import { isInstalled, modelPath } from './models'
import { PressedKeys } from './pressed-keys'
import { settings } from './settings'
import { countWords, dictations } from './store'
import { createWindowsKeyboard, type KeyEvent } from './windows-keyboard'
import { getOverlayWindow, hideOverlay, sendToAll, sendToMain, setOverlayHitArea, showOverlay } from './windows'

const TAP_MS = 280
const SR = 16000
const ESCAPE = 1
const WIN = 3675

type Phase = 'idle' | 'arming' | 'listening' | 'processing'

let phase: Phase = 'idle'
let handsFree = false
let heldHotkey: { keys: number[]; time: number } | null = null
let startedAt = 0
let capturing = false
let suspended = false
let locked = false
let keyboard: ReturnType<typeof createWindowsKeyboard> | undefined
let keyWatchdog: NodeJS.Timeout | undefined
const pressed = new PressedKeys()
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
  const keys = sortKeys(s.dictation.hotkey).map(keyLabel).join(' + ')
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

function start(hotkey?: { keys: number[]; time: number }): void {
  if (hideTimer) clearTimeout(hideTimer)
  phase = 'arming'
  heldHotkey = settings.get().dictation.mode === 'toggle' ? null : hotkey ?? null
  handsFree = heldHotkey === null
  startedAt = Date.now()
  showOverlay()
  setState({ kind: 'arming' })
  command('start')
  // Modell schon während der Aufnahme laden
  void warmup()
}

function stop(): void {
  if (phase !== 'listening' && phase !== 'arming') return
  heldHotkey = null
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
  heldHotkey = null
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
  const keysHeld = (): boolean => pressed.size > 0 || !!keyboard?.modifiersDown()
  for (let i = 0; i < 40 && keysHeld(); i++) await sleep(25)
  const saved = restore ? await snapshotClipboard() : null
  await clipboard.writeText(text)
  await sleep(30)
  // Bei neuen Tastendrücken oder blockiertem SendInput bleibt der Text zum manuellen Einfügen kopiert.
  if (keysHeld() || !keyboard?.paste()) return false
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

function onKey(event: KeyEvent): void {
  const k = pressed.update(event)
  if (k === null) return
  if (capturing) {
    sendToMain('dictation:key', { type: event.down ? 'down' : 'up', keycode: k })
    return
  }
  const s = settings.get()
  if (!s.dictation.enabled || !keyboard) return
  const recording = phase === 'listening' || phase === 'arming'

  if (!event.down) {
    if (!heldHotkey?.keys.includes(k) || !recording) return
    if (s.dictation.mode === 'hybrid' && ((event.time - heldHotkey.time) >>> 0) < TAP_MS) {
      heldHotkey = null
      handsFree = true
      if (phase === 'listening') setState({ kind: 'listening', handsFree, startedAt })
    } else stop()
    return
  }

  if (recording && k === ESCAPE) return cancel()
  const keys = s.dictation.hotkey
  if ((phase === 'idle' || (recording && handsFree)) && pressed.matches(keys, event, keyboard.isDown)) {
    if (keys.some((key) => normalizeKey(key) === WIN)) keyboard.dismissStartMenuOnRelease()
    if (recording) stop()
    else start({ keys: keys.map(normalizeKey), time: event.time })
  } else if (phase === 'idle' && pressed.matches(s.dictation.pasteLastHotkey, event, keyboard.isDown)) {
    void pasteLast().catch((e) => console.warn('Diktat konnte nicht eingefügt werden:', e))
  }
}

function resetKeys(): void {
  pressed.clear()
  if (heldHotkey) cancel()
  if (capturing) sendToMain('dictation:key', { type: 'reset' })
}

function refreshKeyboard(): void {
  if (process.platform !== 'win32') return
  const enabled = !suspended && !locked && (capturing || settings.get().dictation.enabled)
  try {
    const win = getOverlayWindow()
    if (enabled && !keyboard && win) keyboard = createWindowsKeyboard(win, onKey, resetKeys)
    keyboard?.listen(enabled)
  } catch (e) {
    console.error('Diktat-Tastatur konnte nicht eingerichtet werden:', e)
  }
}

export function initDictation(): void {
  refreshKeyboard()
  settings.on('change', (s, prev) => {
    const d = s.dictation
    const old = prev.dictation
    if (d.enabled !== old.enabled || d.mode !== old.mode || d.hotkey.join() !== old.hotkey.join() ||
      d.pasteLastHotkey.join() !== old.pasteLastHotkey.join()) {
      resetKeys()
      refreshKeyboard()
    }
  })
  powerMonitor.on('suspend', () => {
    suspended = true
    resetKeys()
    refreshKeyboard()
  })
  powerMonitor.on('resume', () => {
    suspended = false
    refreshKeyboard()
  })
  powerMonitor.on('lock-screen', () => {
    locked = true
    resetKeys()
    refreshKeyboard()
  })
  powerMonitor.on('unlock-screen', () => {
    locked = false
    refreshKeyboard()
  })
  keyWatchdog = setInterval(() => {
    if (!keyboard || pressed.size === 0) return
    const lost = pressed.prune(keyboard.isDown)
    if (heldHotkey && lost.some((code) => heldHotkey?.keys.includes(code))) cancel()
    if (capturing && lost.length) resetKeys()
  }, 150)

  ipcMain.on('overlay:micReady', () => {
    if (phase !== 'arming') return
    phase = 'listening'
    setState({ kind: 'listening', handsFree, startedAt })
  })
  ipcMain.on('overlay:micError', (_e, message: string) => {
    phase = 'idle'
    heldHotkey = null
    flash({ kind: 'error', message: message || 'Mikrofon nicht verfügbar' }, 2400)
  })
  ipcMain.on('overlay:audio', (_e, samples: Float32Array) => audioWaiter?.(samples))
  ipcMain.on('overlay:cancel', () => cancel())
  ipcMain.on('overlay:stop', () => stop())
  ipcMain.on('overlay:start', () => {
    if (phase !== 'idle' || !settings.get().dictation.enabled) return
    start()
  })
  ipcMain.on('overlay:hello', (e) => e.sender.send('overlay:state', current))
  ipcMain.on('overlay:hitArea', (e, area: Rectangle | null) => {
    if (e.sender === getOverlayWindow()?.webContents) setOverlayHitArea(area)
  })
  ipcMain.handle('dictation:capture', (_e, on: boolean) => {
    if (capturing === on) return
    resetKeys()
    capturing = on
    refreshKeyboard()
  })
}

/** Beim Start: Ruhe-Pille auf dem Hauptbildschirm zeigen. */
export function showIdlePill(): void {
  if (phase !== 'idle' || !idleEnabled()) return
  showOverlay('primary')
  setState({ kind: 'idle', hint: idleHint() })
}

export function stopDictation(): void {
  if (keyWatchdog) clearInterval(keyWatchdog)
  pressed.clear()
  try {
    keyboard?.listen(false)
  } catch (e) {
    console.warn('Diktat-Tastatur konnte nicht abgemeldet werden:', e)
  }
}

export function dictationActive(): boolean {
  return phase !== 'idle'
}

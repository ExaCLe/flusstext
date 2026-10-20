import { BrowserWindow, nativeTheme, screen, shell } from 'electron'
import { join } from 'node:path'
import { settings } from './settings'

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null

export const OVERLAY_SIZE = { width: 360, height: 120 }
/** Höhe der Kopfzeile im Renderer (Fensterknöpfe sitzen darin) */
const TITLEBAR_HEIGHT = 52

function load(win: BrowserWindow, page: 'index' | 'overlay'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}/${page}.html`)
  else void win.loadFile(join(__dirname, `../renderer/${page}.html`))
}

function titleBarColors(): { color: string; symbolColor: string; height: number } {
  const dark = nativeTheme.shouldUseDarkColors
  return { color: '#00000000', symbolColor: dark ? '#c9cbcf' : '#3d4046', height: TITLEBAR_HEIGHT }
}

export function applyTheme(): void {
  const t = settings.get().theme
  nativeTheme.themeSource = t
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitleBarOverlay(titleBarColors())
}

nativeTheme.on('updated', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitleBarOverlay(titleBarColors())
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : null
}

export function createMainWindow(): BrowserWindow {
  const existing = getMainWindow()
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return existing
  }
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 620,
    show: false,
    title: 'Flusstext',
    icon: join(__dirname, '../../build/icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1b1e' : '#f3f3f1',
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarColors(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Datei-Drops sollen nicht die Seite ersetzen
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? 'file:')) e.preventDefault()
  })
  load(win, 'index')
  mainWindow = win
  return win
}

export function createOverlayWindow(): BrowserWindow {
  const existing = getOverlayWindow()
  if (existing) return existing
  const win = new BrowserWindow({
    ...OVERLAY_SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  load(win, 'overlay')
  overlayWindow = win
  return win
}

/** Overlay unten mittig anzeigen – ohne Fokus zu stehlen. Standard: Bildschirm mit dem Mauszeiger. */
export function showOverlay(where: 'cursor' | 'primary' | 'keep' = 'cursor'): void {
  const win = createOverlayWindow()
  if (where === 'keep' && win.isVisible()) return
  const display = where === 'primary' ? screen.getPrimaryDisplay() : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  win.setBounds({
    x: Math.round(x + (width - OVERLAY_SIZE.width) / 2),
    y: Math.round(y + height - OVERLAY_SIZE.height - 8),
    ...OVERLAY_SIZE
  })
  win.showInactive()
  win.setAlwaysOnTop(true, 'screen-saver')
}

export function hideOverlay(): void {
  getOverlayWindow()?.hide()
}

export function sendToMain(channel: string, payload?: unknown): void {
  getMainWindow()?.webContents.send(channel, payload)
}

export function sendToAll(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

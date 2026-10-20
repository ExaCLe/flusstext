import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, statfsSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import type { ExportFormat, ExportOptions, LiveStopOptions, TranscribeOptions, Transcript } from '@shared/types'
import { paths } from './paths'
import { settings } from './settings'
import { applyTheme, createMainWindow, createOverlayWindow, sendToMain } from './windows'
import { handleMediaProtocol, registerMediaScheme } from './protocol'
import { models } from './models'
import { transcripts, dictations } from './store'
import { jobs } from './jobs'
import { liveCancel, liveChunk, liveStart, liveStop } from './live'
import { initDictation, refreshIdle, showIdlePill, stopDictation, warmup } from './dictation'
import { exportTranscript } from './export'
import { engine } from './engine'
import { ffmpegPath, onSettingsChanged, shutdownAsr } from './asr'

app.setAppUserModelId('de.flusstext.app')
registerMediaScheme()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => createMainWindow())
}

let tray: Tray | null = null
let quitting = false
let gpuName: string | undefined

function detectGpu(): void {
  execFile('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { windowsHide: true }, (err, out) => {
    if (!err && out.trim()) {
      gpuName = out.trim().split('\n')[0]
      models.hasNvidia = true
    }
  })
}

function iconPath(): string {
  return join(__dirname, '../../build/icon.png')
}

function createTray(): void {
  const img = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 })
  tray = new Tray(img)
  tray.setToolTip('Flusstext')
  const nav = (route: string) => () => {
    createMainWindow()
    sendToMain('app:navigate', route)
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Flusstext öffnen', click: () => createMainWindow() },
      { type: 'separator' },
      { label: 'Datei transkribieren …', click: nav('library') },
      { label: 'Aufnahme', click: nav('record') },
      { label: 'Einstellungen', click: nav('settings') },
      { type: 'separator' },
      {
        label: 'Beenden',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => createMainWindow())
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:set', (_e, patch) => settings.set(patch))

  ipcMain.handle('system:info', () => {
    let free = 0
    try {
      const st = statfsSync(paths.models)
      free = st.bavail * st.bsize
    } catch {
      // ignorieren
    }
    return { version: app.getVersion(), modelsDir: paths.models, dataDir: paths.data, freeDiskBytes: free, cpuThreads: cpus().length, gpuName }
  })
  ipcMain.handle('system:openPath', (_e, p: string) => shell.openPath(p))
  ipcMain.handle('system:showInFolder', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('system:openExternal', (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })

  ipcMain.handle('models:list', () => models.list())
  ipcMain.handle('models:download', (_e, id: string) => void models.download(id))
  ipcMain.handle('models:cancel', (_e, id: string) => models.cancel(id))
  ipcMain.handle('models:remove', (_e, id: string) => models.remove(id))

  ipcMain.handle('transcripts:list', () => transcripts.list())
  ipcMain.handle('transcripts:get', (_e, id: string) => transcripts.get(id))
  ipcMain.handle('transcripts:update', (_e, id: string, patch: Partial<Transcript>) => {
    const allowed: Partial<Transcript> = {}
    if (patch.title !== undefined) allowed.title = patch.title
    if (patch.speakers !== undefined) allowed.speakers = patch.speakers
    if (patch.segments !== undefined) allowed.segments = patch.segments
    if (patch.notes !== undefined) allowed.notes = patch.notes
    if (patch.bookmarks !== undefined) allowed.bookmarks = patch.bookmarks
    return transcripts.update(id, allowed)
  })
  ipcMain.handle('transcripts:search', (_e, query: string) => transcripts.search(query))
  ipcMain.handle('transcripts:peaks', async (_e, id: string) => {
    const t = transcripts.get(id)
    const src = t?.audioPath ?? t?.originalPath
    if (!t || !src || !existsSync(src)) return null
    if (t.peaks?.length) return t.peaks
    const peaks = await engine.call<number[]>('peaks', { ffmpeg: ffmpegPath(), path: src })
    // Ohne Änderungs-Event speichern – die Ansicht hat die Werte schon
    transcripts.update(id, { peaks }, true)
    return peaks
  })
  ipcMain.handle('transcripts:remove', (_e, id: string) => transcripts.delete(id))
  ipcMain.handle('transcripts:export', async (e, id: string, format: ExportFormat, opts: ExportOptions) => {
    const t = transcripts.get(id)
    if (!t) return null
    const win = BrowserWindow.fromWebContents(e.sender)!
    const safe = t.title.replace(/[<>:"/\\|?*]+/g, '_').slice(0, 120)
    const res = await dialog.showSaveDialog(win, {
      defaultPath: join(app.getPath('documents'), `${safe}.${format}`),
      filters: [{ name: format.toUpperCase(), extensions: [format] }]
    })
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, await exportTranscript(t, format, opts))
    return res.filePath
  })
  ipcMain.handle('transcripts:copy', async (_e, id: string, opts: ExportOptions) => {
    const t = transcripts.get(id)
    if (t) await clipboard.writeText((await exportTranscript(t, 'txt', opts)) as string)
  })

  ipcMain.handle('jobs:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio & Video', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma', 'webm', 'mp4', 'm4v', 'mov', 'mkv', 'avi', 'wmv', 'mpeg', 'mpg', 'amr', 'aiff'] },
        { name: 'Alle Dateien', extensions: ['*'] }
      ]
    })
    return res.canceled ? [] : res.filePaths
  })
  ipcMain.handle('jobs:add', (_e, files: string[], opts: TranscribeOptions) => jobs.add(files, opts))
  ipcMain.handle('jobs:list', () => jobs.list())
  ipcMain.handle('jobs:cancel', (_e, id: string) => jobs.cancel(id))

  ipcMain.handle('live:start', (_e, opts: TranscribeOptions) => liveStart(opts))
  ipcMain.on('live:chunk', (_e, sessionId: string, samples: Float32Array) => liveChunk(sessionId, samples))
  ipcMain.handle('live:stop', (_e, sessionId: string, opts: LiveStopOptions) => liveStop(sessionId, opts))
  ipcMain.handle('live:cancel', (_e, sessionId: string) => liveCancel(sessionId))

  ipcMain.handle('dictation:history', () => dictations.list())
  ipcMain.handle('dictation:remove', (_e, id: string) => dictations.delete(id))
  ipcMain.handle('dictation:clear', () => dictations.clear())
  ipcMain.handle('dictation:copy', (_e, text: string) => clipboard.writeText(text))

  // Änderungen an alle Fenster weiterleiten
  settings.on('change', (s, prev) => {
    sendToMain('settings:changed', s)
    if (s.theme !== prev.theme) applyTheme()
    if (s.launchAtLogin !== prev.launchAtLogin) app.setLoginItemSettings({ openAtLogin: s.launchAtLogin, args: ['--hidden'] })
    onSettingsChanged(s, prev)
  })
  models.on('change', (list) => {
    sendToMain('models:changed', list)
    // z. B. erstes Modell installiert -> Ruhe-Pille kann erscheinen
    refreshIdle()
  })
  transcripts.on('change', (t) => sendToMain('transcripts:changed', t))
  jobs.on('change', (list) => sendToMain('jobs:changed', list))
  dictations.on('change', () => sendToMain('dictation:history'))
}

app.whenReady().then(() => {
  handleMediaProtocol()
  models.cleanup()
  registerIpc()
  applyTheme()
  detectGpu()
  const hidden = process.argv.includes('--hidden')
  const win = createMainWindow()
  if (hidden) win.once('ready-to-show', () => win.hide())
  win.on('close', (e) => {
    // Schließen minimiert in den Infobereich, damit das Diktat weiter funktioniert
    if (!quitting && settings.get().dictation.enabled) {
      e.preventDefault()
      win.hide()
    }
  })
  createOverlayWindow()
  createTray()
  initDictation()
  // Diktatmodell vorab laden, damit die erste Eingabe schnell ist
  setTimeout(() => void warmup(), 1500)
  setTimeout(showIdlePill, 1200)
  // VAD ist klein und wird immer gebraucht
  void models.download('vad-silero')
})

app.on('before-quit', () => {
  quitting = true
  stopDictation()
  engine.kill()
  shutdownAsr()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

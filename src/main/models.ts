import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { CATALOG } from '@shared/catalog'
import type { DownloadProgress, ModelDef, ModelStatus } from '@shared/types'
import { paths } from './paths'
import { settings } from './settings'
import { downloadError, fetchTo } from './download'

const MARKER = '.complete'

function platformCatalog(): ModelDef[] {
  // macOS ships its own Metal/CPU runtime; Windows archives cannot run here.
  return CATALOG.filter((m) => process.platform !== 'darwin' || m.kind !== 'runtime')
}

export function modelDef(id: string): ModelDef | undefined {
  return platformCatalog().find((m) => m.id === id)
}

export function modelPath(id: string, file?: string): string {
  const dir = join(paths.models, id)
  return file ? join(dir, file) : dir
}

export function isInstalled(id: string): boolean {
  return existsSync(modelPath(id, MARKER))
}

class ModelManager extends EventEmitter {
  private downloads = new Map<string, DownloadProgress & { abort: AbortController }>()
  private emitTimer: NodeJS.Timeout | null = null
  hasNvidia = false

  list(): ModelStatus[] {
    return platformCatalog().map((m) => {
      const d = this.downloads.get(m.id)
      return {
        ...m,
        installed: isInstalled(m.id),
        download: d ? { id: d.id, received: d.received, total: d.total, speed: d.speed, state: d.state, error: d.error } : undefined
      }
    })
  }

  private changed(immediate = false): void {
    if (immediate) {
      if (this.emitTimer) clearTimeout(this.emitTimer)
      this.emitTimer = null
      this.emit('change', this.list())
      return
    }
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.emit('change', this.list())
    }, 150)
  }

  async download(id: string): Promise<void> {
    const def = modelDef(id)
    if (!def || isInstalled(id) || this.downloads.get(id)?.state === 'downloading') return
    // Abhängigkeiten (z. B. VAD) mitladen
    for (const dep of def.requires ?? []) if (!isInstalled(dep)) void this.download(dep)
    // Whisper-Modelle brauchen eine whisper.cpp-Laufzeit: GPU-Variante, falls eine NVIDIA-Karte vorhanden ist
    if (process.platform !== 'darwin' && def.engine === 'whispercpp' && def.kind === 'asr' && !isInstalled('whispercpp-cuda') && !isInstalled('whispercpp-cpu')) {
      const rt = this.hasNvidia && settings.get().useGpu ? 'whispercpp-cuda' : 'whispercpp-cpu'
      if (!this.downloads.has(rt)) void this.download(rt)
    }

    const abort = new AbortController()
    const total = def.archive?.size ?? (def.files.reduce((n, f) => n + (f.size ?? 0), 0) || def.sizeMB * 1e6)
    const state = { id, received: 0, total, speed: 0, state: 'downloading' as DownloadProgress['state'], abort, error: undefined as string | undefined }
    this.downloads.set(id, state)
    this.changed(true)

    const dir = modelPath(id)
    mkdirSync(dir, { recursive: true })
    let lastBytes = 0
    let lastTime = Date.now()
    const tick = (n: number): void => {
      state.received += n
      const now = Date.now()
      if (now - lastTime > 500) {
        const inst = ((state.received - lastBytes) * 1000) / (now - lastTime)
        state.speed = state.speed ? state.speed * 0.6 + inst * 0.4 : inst
        lastBytes = state.received
        lastTime = now
      }
      this.changed()
    }

    try {
      if (def.archive) {
        const archive = join(paths.tmp, `${id}${def.archive.url.endsWith('.zip') ? '.zip' : '.tar.bz2'}`)
        await fetchTo(def.archive.url, archive, abort.signal, tick, (len) => (state.total = len))
        state.state = 'extracting'
        this.changed(true)
        await extract(archive, dir, def.archive.stripRoot)
        rmSync(archive, { force: true })
        if (def.keepFiles) {
          for (const e of readdirSync(dir)) if (!def.keepFiles.includes(e)) rmSync(join(dir, e), { recursive: true, force: true })
        }
      } else {
        for (const f of def.files) {
          const target = join(dir, f.name)
          if (existsSync(target) && f.size && statSync(target).size === f.size) {
            if (!f.sha256 || await matchesHash(target, f.sha256)) {
              tick(f.size)
              continue
            }
            rmSync(target, { force: true })
          }
          await fetchTo(f.url, target, abort.signal, tick)
          if (f.sha256 && !await matchesHash(target, f.sha256)) {
            rmSync(target, { force: true })
            throw new Error('Die Prüfsumme der Modelldatei stimmt nicht. Bitte erneut herunterladen.')
          }
        }
      }
      abort.signal.throwIfAborted()
      writeFileSync(join(dir, MARKER), new Date().toISOString())
      this.downloads.delete(id)
      this.autoSelect(def)
      this.changed(true)
    } catch (e) {
      const cancelled = abort.signal.aborted
      state.state = cancelled ? 'cancelled' : 'error'
      state.error = cancelled ? undefined : downloadError(e)
      this.changed(true)
      if (cancelled) {
        this.downloads.delete(id)
        rmSync(dir, { recursive: true, force: true })
        this.changed(true)
      }
    }
  }

  /** Erstes installiertes Modell automatisch als Standard setzen. */
  private autoSelect(def: ModelDef): void {
    const s = settings.get()
    if (def.kind === 'asr') {
      if (!s.transcriptionModel || !isInstalled(s.transcriptionModel)) settings.set({ transcriptionModel: def.id })
      if (s.dictationModel && !isInstalled(s.dictationModel)) settings.set({ dictationModel: null })
    }
    if (def.kind === 'embedding' && !isInstalled(s.diarization.embeddingModel)) settings.set({ diarization: { embeddingModel: def.id } })
    if (def.kind === 'segmentation' && !isInstalled(s.diarization.segmentationModel)) settings.set({ diarization: { segmentationModel: def.id } })
  }

  cancel(id: string): void {
    this.downloads.get(id)?.abort.abort()
  }

  remove(id: string): void {
    this.cancel(id)
    rmSync(modelPath(id), { recursive: true, force: true })
    this.downloads.delete(id)
    const s = settings.get()
    if (s.transcriptionModel === id) {
      const other = CATALOG.find((m) => m.kind === 'asr' && isInstalled(m.id))
      settings.set({ transcriptionModel: other?.id ?? null })
    }
    if (s.dictationModel === id) settings.set({ dictationModel: null })
    this.changed(true)
  }

  /** Halb fertige Downloads aus früheren Sitzungen entfernen. */
  cleanup(): void {
    for (const d of readdirSync(paths.models)) {
      if (!existsSync(join(paths.models, d, MARKER))) rmSync(join(paths.models, d), { recursive: true, force: true })
    }
    // Einstellungen auf installierte Modelle abgleichen (z. B. nach Zurücksetzen der Einstellungen)
    const s = settings.get()
    if (!s.transcriptionModel || !isInstalled(s.transcriptionModel)) {
      const asr = CATALOG.filter((m) => m.kind === 'asr' && isInstalled(m.id))
      const pick = asr.find((m) => m.recommended && m.engine === 'sherpa') ?? asr[0]
      if (pick) settings.set({ transcriptionModel: pick.id })
    }
    if (s.dictationModel && !isInstalled(s.dictationModel)) settings.set({ dictationModel: null })
  }
}

/** Entpackt .tar.bz2 und .zip mit dem in Windows enthaltenen bsdtar. */
async function extract(archive: string, dir: string, stripRoot?: boolean): Promise<void> {
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  await new Promise<void>((resolve, reject) => {
    const p = spawn(tar, ['-x', '-f', archive, '-C', dir], { windowsHide: true })
    let err = ''
    p.stderr.on('data', (b) => (err += b))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Entpacken fehlgeschlagen: ${err.trim().slice(0, 120)}`))))
  })
  if (stripRoot) hoistSingleFolder(dir)
  // Beispiel-Audiodateien aus den Modellarchiven werden nicht gebraucht
  rmSync(join(dir, 'test_wavs'), { recursive: true, force: true })
}

/** Enthält der Ordner nur einen einzigen Unterordner, dessen Inhalt eine Ebene nach oben holen. */
export function hoistSingleFolder(dir: string): void {
  const entries = readdirSync(dir).filter((e) => e !== MARKER)
  if (entries.length !== 1) return
  const inner = join(dir, entries[0])
  if (!statSync(inner).isDirectory()) return
  for (const e of readdirSync(inner)) renameSync(join(inner, e), join(dir, e))
  rmSync(inner, { recursive: true, force: true })
}

export const models = new ModelManager()

async function matchesHash(file: string, expected: string): Promise<boolean> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex') === expected
}

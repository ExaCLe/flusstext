// Modellverwaltung: Herunterladen (Datei für Datei auf den Datenträger), prüfen, im Staging entpacken
// und erst zum Schluss per Umbenennen installieren. Halbe Installationen werden beim Start entfernt.
import type { DownloadProgress, ModelDef } from '../../../src/shared/types'
import { errorMessage, type Bus } from './bus'
import type { NativeModel } from './contracts'
import { catalogFor, downloadTotal, requiredDiskBytes, requiredFiles, selectionAfterInstall, selectionRepair, toNativeModel, type DeviceInfo, type Platform } from './domain/catalog'
import { uuid } from './domain/text'
import { looksLikeHtml } from './domain/wav'
import { extractArchive } from './extract'
import { freeBytes, join, readRange, removePath, RNFS, writeAtomic, type AppPaths } from './fs'
import type { NativeHost } from './host'
import type { SettingsStore } from './settings'

const MARKER = '.complete'
const USER_AGENT = 'Flusstext/0.1.3 (React Native)'

interface ActiveDownload extends DownloadProgress {
  abort: AbortController
  rnfsJob?: number
}

class CancelledDownload extends Error {
  constructor() {
    super('cancelled')
  }
}

function header(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return ''
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name)
  return key ? String(headers[key]) : ''
}

function gb(bytes: number): string {
  return `${(bytes / 1e9).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`
}

/** Verständliche Meldung für Netzwerk- und Speicherfehler. */
export function downloadError(e: unknown): string {
  const detail = errorMessage(e, 'Download fehlgeschlagen')
  if (/ENOSPC|No space left|disk full|not enough space/i.test(detail)) return 'Nicht genug Speicherplatz'
  if (/certificate|SSL|TLS|trust/i.test(detail)) return 'Die sichere Verbindung konnte nicht geprüft werden (TLS-Zertifikat).'
  if (/timed? ?out|timeout|SocketTimeout/i.test(detail)) return 'Keine Daten empfangen (Zeitüberschreitung). Bitte Verbindung prüfen und erneut versuchen.'
  if (/offline|network|UnknownHost|resolve host|NSURLErrorDomain|ECONN|ENOTFOUND|connection/i.test(detail)) {
    return 'Keine Verbindung. Bitte Internetverbindung prüfen und erneut versuchen.'
  }
  return detail
}

export class ModelManager {
  private installed = new Set<string>()
  private downloads = new Map<string, ActiveDownload>()
  private emitTimer: ReturnType<typeof setTimeout> | null = null
  private removedListeners = new Set<(id: string) => Promise<void> | void>()

  constructor(
    private paths: AppPaths,
    private bus: Bus,
    private settings: SettingsStore,
    private host: NativeHost,
    private platform: Platform,
    private device: DeviceInfo
  ) {}

  dir(id: string): string {
    return join(this.paths.models, id)
  }

  file(id: string, name: string): string {
    return join(this.dir(id), name)
  }

  def(id: string): ModelDef | undefined {
    return catalogFor().find((m) => m.id === id)
  }

  isInstalled = (id: string): boolean => this.installed.has(id)

  onRemoved(fn: (id: string) => Promise<void> | void): () => void {
    this.removedListeners.add(fn)
    return () => {
      this.removedListeners.delete(fn)
    }
  }

  /** Installierte Modelle erfassen, unvollständige Ordner und Staging-Reste entfernen. */
  async init(): Promise<void> {
    for (const entry of await RNFS.readDir(this.paths.models)) {
      if (entry.name === '.staging') continue
      const def = this.def(entry.name)
      let ok = !!def && entry.isDirectory() && (await RNFS.exists(join(entry.path, MARKER)))
      if (ok && def) {
        for (const f of requiredFiles(def)) {
          if (!(await RNFS.exists(join(entry.path, f)))) ok = false
        }
      }
      if (ok) this.installed.add(entry.name)
      // Nur eigene Katalogordner entfernen, nie fremde Inhalte
      else if (def) await removePath(entry.path)
    }
    for (const entry of await RNFS.readDir(this.paths.staging)) await removePath(entry.path)
    for (const entry of await RNFS.readDir(this.paths.tmp)) {
      if (/\.(part|tar\.bz2)$/.test(entry.name)) await removePath(entry.path)
    }
    const patch = selectionRepair(this.settings.get(), this.isInstalled, this.platform)
    if (patch) await this.settings.set(patch)
  }

  list(): NativeModel[] {
    return catalogFor().map((def) => {
      const d = this.downloads.get(def.id)
      const download = d ? { id: d.id, received: d.received, total: d.total, speed: d.speed, state: d.state, error: d.error } : undefined
      return toNativeModel(def, this.platform, this.device, this.installed.has(def.id), download)
    })
  }

  private changed(immediate = false): void {
    const fire = (): void => {
      this.emitTimer = null
      this.bus.emit({ type: 'models', value: this.list() })
    }
    if (immediate) {
      if (this.emitTimer) clearTimeout(this.emitTimer)
      fire()
    } else if (!this.emitTimer) this.emitTimer = setTimeout(fire, 200)
  }

  async download(id: string): Promise<void> {
    const def = this.def(id)
    if (!def) throw new Error('Dieses Modell ist auf diesem Gerät nicht verfügbar.')
    const active = this.downloads.get(id)
    if (this.installed.has(id) || active?.state === 'downloading' || active?.state === 'extracting') return
    for (const dep of def.requires ?? []) {
      if (!this.installed.has(dep) && this.def(dep)) void this.download(dep).catch(() => undefined)
    }
    const free = await freeBytes()
    const need = requiredDiskBytes(def)
    if (free > 0 && free < need) throw new Error(`Nicht genug Speicherplatz: ${gb(need)} nötig, ${gb(free)} frei.`)

    const job: ActiveDownload = { id, received: 0, total: downloadTotal(def), speed: 0, state: 'downloading', abort: new AbortController() }
    this.downloads.set(id, job)
    this.changed(true)
    const stage = join(this.paths.staging, `${id}-${uuid()}`)
    let archive: string | null = null
    try {
      await RNFS.mkdir(stage)
      if (def.archive) {
        archive = join(this.paths.tmp, `${id}-${uuid()}.tar.bz2`)
        await this.fetch(job, def.archive.url, archive, { size: def.archive.size })
        job.state = 'extracting'
        job.received = job.total
        this.changed(true)
        await extractArchive(archive, stage, { stripRoot: def.archive.stripRoot, signal: job.abort.signal, host: this.host, onProgress: () => this.changed() })
        await removePath(archive)
        archive = null
        await removePath(join(stage, 'test_wavs'))
        if (def.keepFiles) {
          for (const e of await RNFS.readDir(stage)) if (!def.keepFiles.includes(e.name)) await removePath(e.path)
        }
      } else {
        for (const f of def.files) await this.fetch(job, f.url, join(stage, f.name), { size: f.size, sha256: f.sha256 })
      }
      if (job.abort.signal.aborted) throw new CancelledDownload()
      const missing = []
      for (const f of requiredFiles(def)) if (!(await RNFS.exists(join(stage, f)))) missing.push(f)
      if (missing.length) throw new Error(`Das Modellarchiv ist unvollständig (${missing.join(', ')} fehlt).`)
      await writeAtomic(join(stage, MARKER), JSON.stringify({ id, installedAt: new Date().toISOString(), files: requiredFiles(def) }))
      // Abschluss: alte Reste weg, Staging-Ordner umbenennen (gleicher Datenträger)
      await removePath(this.dir(id))
      await RNFS.moveFile(stage, this.dir(id))
      this.installed.add(id)
      this.downloads.delete(id)
      this.changed(true)
      const patch = selectionAfterInstall(def, this.settings.get(), this.isInstalled)
      if (patch) await this.settings.set(patch)
    } catch (e) {
      const cancelled = job.abort.signal.aborted || e instanceof CancelledDownload
      await removePath(stage)
      if (archive) await removePath(archive)
      if (cancelled) {
        this.downloads.delete(id)
      } else {
        job.state = 'error'
        job.error = downloadError(e)
      }
      this.changed(true)
      if (!cancelled) throw new Error(job.error)
    }
  }

  /** Eine Datei streamend auf den Datenträger laden und Größe, Inhaltstyp und Prüfsumme prüfen. */
  private async fetch(job: ActiveDownload, url: string, target: string, expect: { size?: number; sha256?: string }): Promise<void> {
    if (job.abort.signal.aborted) throw new CancelledDownload()
    const part = `${target}.part`
    const base = job.received
    let rejected: string | null = null
    let lastBytes = 0
    let lastTime = Date.now()
    const { jobId, promise } = RNFS.downloadFile({
      fromUrl: url,
      toFile: part,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/octet-stream' },
      background: false,
      cacheable: false,
      connectionTimeout: 30_000,
      readTimeout: 60_000,
      progressInterval: 250,
      begin: (r) => {
        const type = header(r.headers, 'content-type')
        if (r.statusCode >= 400) rejected = `Download fehlgeschlagen (HTTP ${r.statusCode})`
        else if (/text\/html|application\/xhtml\+xml/i.test(type)) rejected = 'Der Server liefert eine Webseite statt der Modelldatei.'
        else if (expect.size && r.contentLength > 0 && !header(r.headers, 'content-encoding') && r.contentLength !== expect.size) {
          rejected = 'Die Modelldatei hat eine unerwartete Größe. Bitte später erneut versuchen.'
        }
        if (rejected) RNFS.stopDownload(r.jobId)
        else if (!expect.size && r.contentLength > 0 && job.total < base + r.contentLength) job.total = base + r.contentLength
      },
      progress: (r) => {
        job.received = base + r.bytesWritten
        const now = Date.now()
        if (now - lastTime > 500) {
          const inst = ((r.bytesWritten - lastBytes) * 1000) / (now - lastTime)
          job.speed = job.speed ? job.speed * 0.6 + inst * 0.4 : inst
          lastBytes = r.bytesWritten
          lastTime = now
        }
        this.changed()
      }
    })
    job.rnfsJob = jobId
    const onAbort = (): void => RNFS.stopDownload(jobId)
    job.abort.signal.addEventListener('abort', onAbort)
    try {
      let res: Awaited<typeof promise>
      try {
        res = await promise
      } catch (e) {
        if (job.abort.signal.aborted) throw new CancelledDownload()
        if (rejected) throw new Error(rejected)
        throw e
      }
      if (job.abort.signal.aborted) throw new CancelledDownload()
      if (rejected) throw new Error(rejected)
      if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`Download fehlgeschlagen (HTTP ${res.statusCode})`)
      const size = Number((await RNFS.stat(part)).size)
      if (!size || (expect.size && size !== expect.size)) throw new Error('Die Modelldatei ist unvollständig. Bitte erneut herunterladen.')
      const prefix = new Uint8Array(await readRange(part, Math.min(512, size), 0))
      if (looksLikeHtml(String.fromCharCode(...prefix))) throw new Error('Der Server liefert eine Webseite statt der Modelldatei.')
      if (expect.sha256) {
        const hash = (await RNFS.hash(part, 'sha256')).toLowerCase()
        if (hash !== expect.sha256.toLowerCase()) throw new Error('Die Prüfsumme der Modelldatei stimmt nicht. Bitte erneut herunterladen.')
      }
      if (job.abort.signal.aborted) throw new CancelledDownload()
      await removePath(target)
      await RNFS.moveFile(part, target)
      job.received = base + size
      this.changed()
    } finally {
      job.abort.signal.removeEventListener('abort', onAbort)
      job.rnfsJob = undefined
      await removePath(part)
    }
  }

  async cancel(id: string): Promise<void> {
    const job = this.downloads.get(id)
    if (!job) return
    if (job.state === 'error') {
      // Fehlermeldung schließen
      this.downloads.delete(id)
      this.changed(true)
      return
    }
    job.abort.abort()
    if (job.rnfsJob !== undefined) RNFS.stopDownload(job.rnfsJob)
  }

  async remove(id: string): Promise<void> {
    await this.cancel(id)
    // Geladene Modelle zuerst freigeben, dann die Dateien löschen
    for (const fn of [...this.removedListeners]) await Promise.resolve(fn(id)).catch(() => undefined)
    this.installed.delete(id)
    this.downloads.delete(id)
    await removePath(this.dir(id))
    this.changed(true)
    const patch = selectionRepair(this.settings.get(), this.isInstalled, this.platform)
    if (patch) await this.settings.set(patch)
  }
}

// Dateizugriff über react-native-fs (iOS, Android, macOS) und gemeinsame Pfade der App.
import { Buffer as BufferImpl } from 'buffer'
import * as RNFS from '@dr.pogodin/react-native-fs'
import type { HostInfo } from './host'
import { concatBuffers, parseWavHeader, wavHeader, type WavInfo } from './domain/wav'

// nemotron-frontend.ts nutzt Buffer, das Hermes nicht mitbringt (Typ in globals.d.ts)
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = BufferImpl

export { RNFS }

export interface AppPaths {
  data: string
  settings: string
  transcripts: string
  recordings: string
  imports: string
  dictations: string
  models: string
  staging: string
  tmp: string
  exports: string
}

export function join(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .join('/')
}

/** file://-URLs in Pfade umwandeln; content:// bleibt unverändert. */
export function toPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri
  try {
    return decodeURIComponent(uri.slice(7))
  } catch {
    return uri.slice(7)
  }
}

export function pathsFor(info: HostInfo): AppPaths {
  const data = toPath(info.dataDir)
  const models = toPath(info.modelsDir)
  const tmp = join(toPath(info.tempDir), 'flusstext')
  return {
    data,
    settings: join(data, 'settings.json'),
    transcripts: join(data, 'transcripts'),
    recordings: join(data, 'recordings'),
    imports: join(data, 'imports'),
    dictations: join(data, 'dictations.json'),
    models,
    // Gleicher Datenträger wie die Modelle, damit der Abschluss ein Umbenennen ist
    staging: join(models, '.staging'),
    tmp,
    exports: join(tmp, 'exports')
  }
}

export async function ensureDirs(p: AppPaths): Promise<void> {
  for (const dir of [p.data, p.transcripts, p.recordings, p.imports, p.models, p.staging, p.tmp, p.exports]) {
    if (!(await RNFS.exists(dir))) await RNFS.mkdir(dir)
  }
}

export async function removePath(path: string): Promise<void> {
  try {
    if (await RNFS.exists(path)) await RNFS.unlink(path)
  } catch {
    // schon entfernt oder gesperrt – beim nächsten Start erneut aufräumen
  }
}

export function isInside(path: string, dir: string): boolean {
  const p = toPath(path)
  return p === dir || p.startsWith(dir.replace(/\/+$/, '') + '/')
}

const locks = new Map<string, Promise<unknown>>()

/** Schreibzugriffe auf dieselbe Datei nacheinander ausführen. */
export function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  const settled = next.catch(() => undefined)
  locks.set(key, settled)
  void settled.then(() => {
    if (locks.get(key) === settled) locks.delete(key)
  })
  return next
}

/**
 * Datei ersetzen, ohne dass ein Absturz einen halben Inhalt hinterlässt: erst `.tmp` schreiben,
 * dann umbenennen. iOS verweigert das Überschreiben beim Umbenennen, daher wird das Ziel vorher entfernt;
 * `readJson` stellt eine liegengebliebene `.tmp` wieder her.
 */
export function writeAtomic(path: string, data: string, encoding: 'utf8' | 'base64' = 'utf8'): Promise<void> {
  return serialized(path, async () => {
    const tmp = `${path}.tmp`
    await RNFS.writeFile(tmp, data, encoding)
    if (await RNFS.exists(path)) await RNFS.unlink(path)
    await RNFS.moveFile(tmp, path)
  })
}

export async function readJson<T>(path: string): Promise<T | null> {
  for (const file of [path, `${path}.tmp`]) {
    try {
      if (!(await RNFS.exists(file))) continue
      const value = JSON.parse(await RNFS.readFile(file, 'utf8')) as T
      if (file !== path) await RNFS.moveFile(file, path).catch(() => undefined)
      return value
    } catch {
      // defekte Datei: nächste Variante versuchen
    }
  }
  return null
}

export async function readRange(path: string, length: number, position: number): Promise<ArrayBuffer> {
  if (length <= 0) return new ArrayBuffer(0)
  const data = BufferImpl.from(await RNFS.read(path, length, position, 'base64'), 'base64')
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

export async function readBinaryFile(path: string): Promise<ArrayBuffer> {
  const bytes = BufferImpl.from(await RNFS.readFile(path, 'base64'), 'base64')
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export async function wavInfo(path: string): Promise<WavInfo> {
  const st = await RNFS.stat(path)
  const size = Number(st.size)
  return parseWavHeader(await readRange(path, Math.min(size, 8192), 0), size)
}

/** Ausschnitt [fromSec, toSec) einer 16-kHz-Mono-WAV als eigene WAV-Datei schreiben (blockweise). */
export async function writeWavSlice(src: string, info: WavInfo, fromSec: number, toSec: number, dest: string): Promise<number> {
  const bytesPerSec = info.sampleRate * info.channels * 2
  const align = info.channels * 2
  const from = Math.max(0, Math.floor((fromSec * bytesPerSec) / align) * align)
  const to = Math.min(info.dataBytes, Math.floor((toSec * bytesPerSec) / align) * align)
  const length = Math.max(0, to - from)
  await RNFS.writeFile(dest, BufferImpl.from(wavHeader(length, info.sampleRate, info.channels)).toString('base64'), 'base64')
  const block = 1 << 20
  for (let at = 0; at < length; at += block) {
    await RNFS.appendFile(dest, BufferImpl.from(await readRange(src, Math.min(block, length - at), info.dataOffset + from + at)).toString('base64'), 'base64')
  }
  return length / bytesPerSec
}

/** PCM-Bytes in eine WAV-Datei schreiben. */
export async function writeWav(dest: string, pcm: ArrayBuffer): Promise<void> {
  await RNFS.writeFile(dest, BufferImpl.from(concatBuffers(wavHeader(pcm.byteLength), pcm)).toString('base64'), 'base64')
}

export async function freeBytes(): Promise<number> {
  try {
    const fs = await RNFS.getFSInfo()
    return Number(fs.freeSpaceEx || fs.freeSpace) || 0
  } catch {
    return 0
  }
}

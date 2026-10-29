// Modellarchive (.tar.bz2) auf iOS/Android mit der nativen Entpackfunktion von sherpa-onnx entpacken.
import { extractArchive as nativeExtract } from 'react-native-sherpa-onnx/extraction'
import { join, RNFS } from './fs'
import type { NativeHost } from './host'

export interface ExtractOptions {
  stripRoot?: boolean
  signal: AbortSignal
  onProgress(fraction: number): void
  host: NativeHost
}

/** Enthält der Ordner nur einen Unterordner, dessen Inhalt eine Ebene nach oben holen. */
export async function hoistSingleFolder(dir: string): Promise<void> {
  const entries = await RNFS.readDir(dir)
  if (entries.length !== 1 || !entries[0].isDirectory()) return
  const inner = entries[0].path
  for (const e of await RNFS.readDir(inner)) await RNFS.moveFile(e.path, join(dir, e.name))
  await RNFS.unlink(inner)
}

export async function extractArchive(archive: string, dir: string, opts: ExtractOptions): Promise<void> {
  if (!archive.endsWith('.tar.bz2')) throw new Error('Dieses Archivformat wird auf diesem Gerät nicht unterstützt.')
  await nativeExtract({ modelId: dir, archivePath: archive, format: 'tar.bz2' }, dir, {
    force: true,
    operationId: archive,
    signal: opts.signal,
    onProgress: (e) => opts.onProgress(Math.max(0, Math.min(1, e.percent / 100)))
  })
  if (opts.signal.aborted) throw new Error('cancelled')
  if (opts.stripRoot) await hoistSingleFolder(dir)
}

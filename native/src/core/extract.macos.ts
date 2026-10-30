// Modellarchive auf dem Mac über die native Host-Engine entpacken (sherpa-onnx RN gibt es dort nicht).
import type { NativeHost } from './host'

export interface ExtractOptions {
  stripRoot?: boolean
  signal: AbortSignal
  onProgress(fraction: number): void
  host: NativeHost
}

export async function extractArchive(archive: string, dir: string, opts: ExtractOptions): Promise<void> {
  if (opts.signal.aborted) throw new Error('cancelled')
  opts.onProgress(0)
  await opts.host.engineCall('extract', { archive, dir, stripRoot: !!opts.stripRoot })
  // Kein Abbruch während des Entpackens möglich; ein verworfenes Ergebnis wird danach gelöscht
  if (opts.signal.aborted) throw new Error('cancelled')
  opts.onProgress(1)
}

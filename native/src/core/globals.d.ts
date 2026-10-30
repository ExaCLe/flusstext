// Globales Buffer (Polyfill aus dem Paket „buffer“, gesetzt in fs.ts).
import type { Buffer as BufferType } from 'buffer'

declare global {
  // eslint-disable-next-line no-var
  var Buffer: typeof BufferType
}

export {}

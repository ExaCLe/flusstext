// WAV-Kopf lesen/schreiben und PCM umwandeln – ohne Dateizugriff, damit es testbar bleibt.

export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  /** Byte-Offset der PCM-Daten */
  dataOffset: number
  /** Länge der PCM-Daten in Bytes (auf die Dateigröße begrenzt) */
  dataBytes: number
}

function ascii(view: DataView, at: number): string {
  return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))
}

/**
 * RIFF/WAVE-Kopf auswerten. `head` muss den Anfang der Datei bis einschließlich des
 * `data`-Chunk-Kopfs enthalten; `fileSize` begrenzt eine unvollständig geschriebene Länge.
 */
export function parseWavHeader(head: ArrayBuffer, fileSize: number): WavInfo {
  const view = new DataView(head)
  if (head.byteLength < 12 || ascii(view, 0) !== 'RIFF' || ascii(view, 8) !== 'WAVE') throw new Error('Keine gültige WAV-Datei.')
  let at = 12
  let fmt: Omit<WavInfo, 'dataOffset' | 'dataBytes'> | null = null
  while (at + 8 <= head.byteLength) {
    const id = ascii(view, at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ') {
      if (body + 16 > head.byteLength) break
      const format = view.getUint16(body, true)
      const channels = view.getUint16(body + 2, true)
      const sampleRate = view.getUint32(body + 4, true)
      const bitsPerSample = view.getUint16(body + 14, true)
      const extensiblePcm = format === 0xfffe && size >= 40 && body + 26 <= head.byteLength && view.getUint16(body + 24, true) === 1
      if ((format !== 1 && !extensiblePcm) || bitsPerSample !== 16) throw new Error('Nur 16-Bit-PCM-WAV wird direkt gelesen.')
      fmt = { sampleRate, channels, bitsPerSample }
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV-Datei ohne Formatangabe.')
      // Laufende Aufnahmen tragen teils 0 oder 0xFFFFFFFF als Länge ein
      const available = Math.max(0, fileSize - body)
      const declared = size === 0 || size === 0xffffffff ? available : size
      const dataBytes = Math.min(declared, available)
      return { ...fmt, dataOffset: body, dataBytes: dataBytes - (dataBytes % (fmt.channels * 2)) }
    }
    at = body + size + (size % 2)
  }
  throw new Error('WAV-Kopf unvollständig.')
}

export function isSpeechWav(info: WavInfo): boolean {
  return info.sampleRate === 16000 && info.channels === 1 && info.bitsPerSample === 16
}

export function wavHeader(dataBytes: number, sampleRate = 16000, channels = 1): ArrayBuffer {
  const buf = new ArrayBuffer(44)
  const v = new DataView(buf)
  const put = (at: number, s: string): void => {
    for (let i = 0; i < 4; i++) v.setUint8(at + i, s.charCodeAt(i))
  }
  put(0, 'RIFF')
  v.setUint32(4, 36 + dataBytes, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, channels, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * channels * 2, true)
  v.setUint16(32, channels * 2, true)
  v.setUint16(34, 16, true)
  put(36, 'data')
  v.setUint32(40, dataBytes, true)
  return buf
}

export function pcm16ToFloat(bytes: ArrayBuffer): Float32Array {
  const n = Math.floor(bytes.byteLength / 2)
  const view = new DataView(bytes, 0, n * 2)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768
  return out
}

export function concatBuffers(a: ArrayBuffer, b: ArrayBuffer): ArrayBuffer {
  const out = new Uint8Array(a.byteLength + b.byteLength)
  out.set(new Uint8Array(a), 0)
  out.set(new Uint8Array(b), a.byteLength)
  return out.buffer
}

/** Erkennt HTML-Fehlerseiten (Proxy, Login) statt Modelldaten. */
export function looksLikeHtml(prefix: string): boolean {
  return /^\s*(?:<!doctype\s+html|<html(?:\s|>)|<head(?:\s|>)|<body(?:\s|>))/i.test(prefix)
}

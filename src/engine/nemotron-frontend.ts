/** Speech-only Nemotron frontend and CTC decoding. No model hub or network APIs. */
export interface TimedPiece { text: string; start: number; end: number }

export function logMel(samples: Float32Array, window: Float32Array, filterbank: Float32Array): { mel: Float32Array; frames: number; valid: number } {
  if (window.length !== 400 || filterbank.length !== 128 * 257) throw new Error('Ungültige Nemotron-Mel-Tabellen.')
  const valid = Math.floor(samples.length / 160)
  if (valid < 2) return { mel: new Float32Array(0), frames: 0, valid: 0 }
  const frames = Math.ceil((valid + 1) / 8) * 8
  const mel = new Float32Array(128 * frames)
  const real = new Float64Array(512)
  const imag = new Float64Array(512)
  const power = new Float32Array(257)
  const emphasized = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) throw new Error('Ungültige Audiodaten.')
    emphasized[i] = i ? samples[i] - Math.fround(0.97 * samples[i - 1]) : samples[i]
  }
  for (let frame = 0; frame < valid; frame++) {
    real.fill(0)
    imag.fill(0)
    for (let j = 0; j < 400; j++) {
      const index = frame * 160 + j - 200
      if (index >= 0 && index < emphasized.length) real[j + 56] = Math.fround(emphasized[index] * window[j])
    }
    // In-place radix-2 FFT, with the same centered 512/160 STFT as the checkpoint.
    for (let i = 1, j = 0; i < 512; i++) {
      let bit = 256
      for (; j & bit; bit >>= 1) j ^= bit
      j ^= bit
      if (i < j) [real[i], real[j]] = [real[j], real[i]]
    }
    for (let size = 2; size <= 512; size *= 2) {
      const half = size / 2
      for (let start = 0; start < 512; start += size) {
        for (let j = 0; j < half; j++) {
          const angle = (-2 * Math.PI * j) / size
          const a = start + j, b = a + half
          const r = Math.cos(angle) * real[b] - Math.sin(angle) * imag[b]
          const im = Math.sin(angle) * real[b] + Math.cos(angle) * imag[b]
          real[b] = real[a] - r
          imag[b] = imag[a] - im
          real[a] += r
          imag[a] += im
        }
      }
    }
    for (let i = 0; i <= 256; i++) power[i] = real[i] * real[i] + imag[i] * imag[i]
    for (let bin = 0; bin < 128; bin++) {
      let sum = 0
      for (let i = 0; i <= 256; i++) sum += filterbank[bin * 257 + i] * power[i]
      mel[bin * frames + frame] = Math.log(Math.fround(sum) + 2 ** -24)
    }
  }
  // Normalize over valid audio only, with the checkpoint's unbiased standard deviation.
  for (let bin = 0; bin < 128; bin++) {
    const offset = bin * frames
    let mean = 0, variance = 0
    for (let t = 0; t < valid; t++) mean += mel[offset + t]
    mean /= valid
    for (let t = 0; t < valid; t++) variance += (mel[offset + t] - mean) ** 2
    const std = Math.sqrt(variance / (valid - 1)) + 1e-5
    for (let t = 0; t < valid; t++) mel[offset + t] = (mel[offset + t] - mean) / std
  }
  return { mel, frames, valid }
}

export function decodeCtc(ids: Int32Array, vocabulary: string[], duration: number): TimedPiece[] {
  const tokens: TimedPiece[] = []
  const blank = vocabulary.length
  let previous = -1
  let bytes: number[] = []
  let byteStart = 0, byteEnd = 0
  const flushBytes = (): void => {
    if (bytes.length) tokens.push({ text: Buffer.from(bytes).toString('utf8'), start: byteStart, end: byteEnd })
    bytes = []
  }
  for (let frame = 0; frame < ids.length && frame * 0.04 < duration; frame++) {
    const id = ids[frame]
    if (id === previous) continue
    previous = id
    if (id === blank) continue
    if (id < 0 || id >= blank) throw new Error('Ungültige Nemotron-Token-ID.')
    const text = vocabulary[id]
    const start = frame * 0.04, end = Math.min(duration, start + 0.04)
    const byte = /^<0x([\dA-Fa-f]{2})>$/.exec(text)
    if (byte) {
      if (!bytes.length) byteStart = start
      bytes.push(parseInt(byte[1], 16))
      byteEnd = end
      continue
    }
    flushBytes()
    if (/^<.*>$/.test(text)) continue
    tokens.push({ text: text.replaceAll('▁', ' '), start, end })
  }
  flushBytes()
  if (tokens.length && !tokens[0].text.startsWith(' ')) tokens[0].text = ' ' + tokens[0].text
  return tokens
}

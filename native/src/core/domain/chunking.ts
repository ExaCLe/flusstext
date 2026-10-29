// Aufteilung langer Aufnahmen in erkennbare Abschnitte anhand der Signalenergie.
// Ersetzt den Silero-VAD des Desktops, weil das VAD-Modul der React-Native-Bindung nur ein Platzhalter ist.

export const SR = 16000
export const FRAME = 480 // 30 ms

export interface ChunkPlan {
  /** Sample-Index (inklusive) */
  start: number
  /** Sample-Index (exklusive) */
  end: number
}

export interface ChunkOptions {
  maxSec?: number
  padSec?: number
  mergeGapSec?: number
  minSpeechSec?: number
  fillGapSec?: number
}

/** RMS je 30-ms-Fenster; angefangene Fenster werden über Blockgrenzen hinweg fortgeführt. */
export class FrameEnergy {
  private values: number[] = []
  private sum = 0
  private count = 0

  add(samples: ArrayLike<number>): void {
    for (let i = 0; i < samples.length; i++) {
      this.sum += samples[i] * samples[i]
      if (++this.count === FRAME) {
        this.values.push(Math.sqrt(this.sum / FRAME))
        this.sum = 0
        this.count = 0
      }
    }
  }

  result(): Float32Array {
    const out = this.values.slice()
    if (this.count > FRAME / 4) out.push(Math.sqrt(this.sum / this.count))
    return Float32Array.from(out)
  }
}

function percentile(values: Float32Array, p: number): number {
  if (!values.length) return 0
  const sorted = Float32Array.from(values).sort()
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

/**
 * Sprachabschnitte (≤ maxSec) aus Fensterenergien planen. Liefert eine leere Liste,
 * wenn nirgends ein Signal über dem Grundrauschen liegt (verhindert Halluzinationen bei Stille).
 */
export function planChunks(energy: Float32Array, totalSamples: number, opts: ChunkOptions = {}): ChunkPlan[] {
  const maxSec = opts.maxSec ?? 24
  const frameSec = FRAME / SR
  const toFrames = (sec: number): number => Math.max(1, Math.round(sec / frameSec))
  const n = energy.length
  if (!n || totalSamples <= 0) return []
  const floor = percentile(energy, 0.1)
  const high = percentile(energy, 0.95)
  if (high < 0.002) return []
  const thr = Math.max(0.002, Math.min(floor * 2.5, high * 0.5))

  const speech = new Uint8Array(n)
  for (let i = 0; i < n; i++) speech[i] = energy[i] > thr ? 1 : 0
  // Kurze Pausen innerhalb von Sprache schließen, sehr kurze Ausreißer entfernen
  const fill = toFrames(opts.fillGapSec ?? 0.35)
  const minRun = toFrames(opts.minSpeechSec ?? 0.2)
  let runs: { s: number; e: number }[] = []
  for (let i = 0; i < n; ) {
    if (!speech[i]) {
      i++
      continue
    }
    let j = i
    while (j < n && speech[j]) j++
    const last = runs[runs.length - 1]
    if (last && i - last.e <= fill) last.e = j
    else runs.push({ s: i, e: j })
    i = j
  }
  runs = runs.filter((r) => r.e - r.s >= minRun)
  if (!runs.length) return []

  const pad = toFrames(opts.padSec ?? 0.25)
  const gap = toFrames(opts.mergeGapSec ?? 1.2)
  const maxFrames = toFrames(maxSec)
  const merged: { s: number; e: number }[] = []
  for (const r of runs) {
    const s = Math.max(0, r.s - pad)
    const e = Math.min(n, r.e + pad)
    const last = merged[merged.length - 1]
    if (last && s - last.e < gap && e - last.s <= maxFrames) last.e = Math.max(last.e, e)
    else if (last && s <= last.e) last.e = Math.max(last.e, e)
    else merged.push({ s, e })
  }

  // Zu lange Abschnitte an der leisesten Stelle im letzten Drittel des Fensters teilen
  const out: { s: number; e: number }[] = []
  for (const m of merged) {
    let s = m.s
    while (m.e - s > maxFrames) {
      const from = s + Math.floor(maxFrames * 0.6)
      const to = s + maxFrames
      let cut = to
      let low = Infinity
      for (let i = from; i < to; i++) {
        if (energy[i] < low) {
          low = energy[i]
          cut = i
        }
      }
      out.push({ s, e: cut })
      s = cut
    }
    out.push({ s, e: m.e })
  }
  return out
    .map((c) => ({ start: c.s * FRAME, end: Math.min(totalSamples, c.e * FRAME) }))
    .filter((c) => c.end - c.start >= SR * 0.1)
}

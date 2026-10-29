// Token → Segment, Sprecherzuordnung und Pegelspitzen (aus src/engine/index.ts übernommen).
import type { Replacement, Segment, Transcript } from '../../../../src/shared/types'
import { applyReplacements } from './text'

export interface Token {
  text: string
  start: number
  end: number
}

export interface EngineSegment {
  start: number
  end: number
  text: string
  speaker?: number
  words?: number[]
}

export interface SpeakerTurn {
  start: number
  end: number
  speaker: number
}

export const MIN_SPEAKER_SEC = 2

// Typische Whisper-Halluzinationen bei Stille (v. a. im Deutschen)
const HALLUCINATIONS = [
  /^untertitel(ung)? (im auftrag|von|der|des).*$/i,
  /^untertitel(ung)?:? .*$/i,
  /^copyright .*(wdr|zdf|ard|swr|br|ndr).*$/i,
  /^(vielen dank|danke)( für ihre aufmerksamkeit| fürs zuschauen| fürs zuhören)?[.!]?$/i,
  /^(\*|\[|\().*(musik|music|applaus|stille|silence)(\*|\]|\))$/i,
  /^\.+$/
]

export function cleanText(text: string, family: string): string {
  let t = (text ?? '').replace(/\s+/g, ' ').trim()
  if (family === 'whisper') {
    if (HALLUCINATIONS.some((r) => r.test(t))) return ''
    t = t.replace(/\[(BLANK_AUDIO|Musik|Music)\]/gi, '').trim()
  }
  return t
}

/** Ergebnis eines sherpa-onnx-Erkenners in Tokens mit absoluten Zeiten umwandeln. */
export function sherpaTokens(
  res: { text: string; tokens?: string[]; timestamps?: number[]; durations?: number[] },
  family: string,
  offset: number,
  dur: number
): Token[] {
  const text = cleanText(res.text, family)
  if (!text) return []
  const toks = res.tokens ?? []
  const times = res.timestamps ?? []
  if (toks.length && toks.length === times.length && family !== 'whisper') {
    const out: Token[] = []
    for (let i = 0; i < toks.length; i++) {
      const start = offset + times[i]
      const end = offset + (res.durations?.[i] ? times[i] + res.durations[i] : (times[i + 1] ?? dur))
      out.push({ text: toks[i], start, end: Math.max(end, start + 0.02) })
    }
    if (out.length && !out[0].text.startsWith(' ')) out[0].text = ' ' + out[0].text
    return out
  }
  return [{ text: ' ' + text, start: offset, end: offset + dur }]
}

/** whisper.cpp-Segmente (t0/t1 in 10-ms-Einheiten) in Tokens umwandeln. */
export function whisperTokens(segments: { text: string; t0: number; t1: number }[], offset: number, dur: number, tokenLevel = false): Token[] {
  if (tokenLevel && !cleanText(segments.map(s => s.text).join(''), 'whisper')) return []
  return segments
    .map((s) => ({
      // Native token segments preserve word-leading spaces and subword continuations.
      text: tokenLevel ? s.text.replace(/\[(BLANK_AUDIO|Musik|Music)\]/gi, '').replace(/\s+/g, ' ') : ' ' + cleanText(s.text, 'whisper'),
      start: offset + Math.min(dur, Math.max(0, s.t0 / 100)),
      end: offset + Math.min(dur, Math.max(s.t0, s.t1) / 100)
    }))
    .filter((t) => t.text.trim())
}

export function speakerAt(turns: SpeakerTurn[] | undefined, t: number): number | undefined {
  if (!turns || !turns.length) return undefined
  let best: SpeakerTurn | undefined
  let bestDist = Infinity
  for (const turn of turns) {
    if (t >= turn.start && t <= turn.end) return turn.speaker
    const d = t < turn.start ? turn.start - t : t - turn.end
    if (d < bestDist) {
      bestDist = d
      best = turn
    }
  }
  return best?.speaker
}

/** Tokens zu satzweisen Segmenten zusammenfassen, bei Sprecherwechsel trennen. */
export function buildSegments(tokens: Token[], turns?: SpeakerTurn[]): EngineSegment[] {
  const out: EngineSegment[] = []
  let cur: EngineSegment | null = null
  let prevText = ''
  const t2 = (x: number): number => Math.round(x * 100) / 100
  for (const tok of tokens) {
    const wordStart = tok.text.startsWith(' ')
    const spk = speakerAt(turns, (tok.start + tok.end) / 2)
    const sentenceEnded = /[.!?…]["»“)]?$/.test(prevText.trim())
    const tooLong = cur && tok.end - cur.start > 30
    const gap = cur && tok.start - cur.end > 1.5
    const newSpeaker = cur && turns && spk !== cur.speaker
    if (!cur || (wordStart && (sentenceEnded || newSpeaker || tooLong || gap))) {
      if (cur) out.push(cur)
      cur = { start: tok.start, end: tok.end, text: tok.text.trimStart(), speaker: spk, words: [t2(tok.start)] }
    } else {
      cur.text += tok.text
      cur.end = Math.max(cur.end, tok.end)
      if (wordStart && tok.text.trim()) cur.words!.push(t2(tok.start))
    }
    prevText = tok.text
  }
  if (cur) out.push(cur)
  return out.map((s) => ({ ...s, text: s.text.replace(/\s+/g, ' ').trim() })).filter((s) => s.text)
}

/**
 * Automatisches Clustering erzeugt gern „Phantom-Sprecher“ aus einzelnen kurzen Abschnitten.
 * Sprecher mit insgesamt weniger als `minSec` Redezeit werden dem zeitlich nächsten echten Sprecher zugeordnet.
 */
export function absorbTinySpeakers(segs: SpeakerTurn[], minSec: number): SpeakerTurn[] {
  const total = new Map<number, number>()
  for (const s of segs) total.set(s.speaker, (total.get(s.speaker) ?? 0) + s.end - s.start)
  const keep = new Set([...total].filter(([, d]) => d >= minSec).map(([k]) => k))
  if (keep.size === 0 || keep.size === total.size) return segs
  const big = segs.filter((s) => keep.has(s.speaker))
  return segs.map((s) => {
    if (keep.has(s.speaker)) return s
    const mid = (s.start + s.end) / 2
    let best = big[0]
    let bestDist = Infinity
    for (const b of big) {
      const d = mid < b.start ? b.start - mid : mid > b.end ? mid - b.end : 0
      if (d < bestDist) {
        bestDist = d
        best = b
      }
    }
    return { ...s, speaker: best.speaker }
  })
}

/** Rohe Sprecherabschnitte der nativen Diarisierung prüfen, aufräumen und nach Auftreten nummerieren. */
export function normalizeTurns(raw: unknown, numSpeakers: number): SpeakerTurn[] {
  if (!Array.isArray(raw)) throw new Error('Die Sprechererkennung lieferte ein ungültiges Ergebnis.')
  let segs: SpeakerTurn[] = raw
    .filter(
      (x): x is SpeakerTurn =>
        !!x && Number.isFinite((x as SpeakerTurn).start) && Number.isFinite((x as SpeakerTurn).end) && Number.isInteger((x as SpeakerTurn).speaker)
    )
    .map((x) => ({ start: x.start, end: Math.max(x.start, x.end), speaker: x.speaker }))
    .sort((a, b) => a.start - b.start)
  if (numSpeakers <= 0) segs = absorbTinySpeakers(segs, MIN_SPEAKER_SEC)
  const map = new Map<number, number>()
  return segs.map((s) => {
    if (!map.has(s.speaker)) map.set(s.speaker, map.size)
    return { ...s, speaker: map.get(s.speaker)! }
  })
}

export function dominantSpeaker(turns: SpeakerTurn[], seg: { start: number; end: number }): number | undefined {
  const overlap = new Map<number, number>()
  for (const t of turns) {
    const o = Math.min(t.end, seg.end) - Math.max(t.start, seg.start)
    if (o > 0) overlap.set(t.speaker, (overlap.get(t.speaker) ?? 0) + o)
  }
  if (!overlap.size) return speakerAt(turns, (seg.start + seg.end) / 2)
  return [...overlap.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

export function shiftSegments(segs: EngineSegment[], offset: number): EngineSegment[] {
  if (!offset) return segs
  const r = (x: number): number => Math.round(x * 100) / 100
  return segs.map((s) => ({ ...s, start: s.start + offset, end: s.end + offset, ...(s.words ? { words: s.words.map((w) => r(w + offset)) } : {}) }))
}

export function toSegments(segs: EngineSegment[], replacements: Replacement[], offset = 0): Segment[] {
  return segs.map((x, i) => ({
    id: `${Math.round(x.start * 1000)}-${offset + i}`,
    start: x.start,
    end: x.end,
    ...(x.speaker !== undefined ? { speaker: x.speaker } : {}),
    text: applyReplacements(x.text, replacements),
    ...(x.words?.length ? { words: x.words } : {})
  }))
}

export function speakersFor(segs: Segment[], previous: Transcript['speakers'] = []): Transcript['speakers'] {
  const ids = [...new Set(segs.map((s) => s.speaker).filter((x): x is number => x !== undefined))].sort((a, b) => a - b)
  return ids.map((id) => previous.find((p) => p.id === id) ?? { id, name: `Sprecher ${id + 1}` })
}

/** Pegelspitzen schrittweise sammeln (für lange Dateien ohne alle Samples im Speicher). */
export class PeakCollector {
  private out: Float32Array
  private step: number
  private pos = 0

  constructor(totalSamples: number, private n = 1200) {
    this.out = new Float32Array(n)
    this.step = Math.max(1, totalSamples / n)
  }

  add(samples: ArrayLike<number>): void {
    for (let i = 0; i < samples.length; i++) {
      const bucket = Math.min(this.n - 1, Math.floor((this.pos + i) / this.step))
      const v = Math.abs(samples[i])
      if (v > this.out[bucket]) this.out[bucket] = v
    }
    this.pos += samples.length
  }

  result(): number[] {
    let top = 0
    for (const v of this.out) if (v > top) top = v
    top = top || 1
    return Array.from(this.out, (v) => Math.round((v / top) * 1000) / 1000)
  }
}

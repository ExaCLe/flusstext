// Text- und Transkript-Helfer ohne native Abhängigkeiten (entspricht src/main/store.ts und asr.ts).
import type { Replacement, SearchHit, Transcript, TranscriptMeta } from '../../../../src/shared/types'

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

export function toMeta(t: Transcript): TranscriptMeta {
  const text = t.segments.map((s) => s.text).join(' ')
  return {
    id: t.id,
    title: t.title,
    createdAt: t.createdAt,
    source: t.source,
    duration: t.duration,
    language: t.language,
    modelId: t.modelId,
    status: t.status,
    error: t.error,
    speakerCount: new Set(t.segments.map((s) => s.speaker).filter((s) => s !== undefined)).size,
    preview: text.slice(0, 220),
    words: countWords(text)
  }
}

/** Text für die Volltextsuche: Titel, Sprecher, Notizen und alle Segmente. */
export function searchText(t: Transcript): string {
  return [t.title, ...t.speakers.map((s) => s.name), t.notes ?? '', ...t.segments.map((s) => s.text)].join('\n')
}

export function searchHits(query: string, metas: TranscriptMeta[], texts: Map<string, string>): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  for (const meta of metas) {
    const text = texts.get(meta.id) ?? ''
    const i = text.toLowerCase().indexOf(q)
    if (i < 0) continue
    const from = Math.max(0, i - 60)
    const snippet = (from > 0 ? '…' : '') + text.slice(from, i + q.length + 120).replace(/\s+/g, ' ').trim()
    hits.push({ id: meta.id, snippet })
  }
  return hits
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Wörterbuch-Ersetzungen (Groß-/Kleinschreibung egal, nur ganze Wörter). */
export function applyReplacements(text: string, list: Replacement[]): string {
  let out = text
  for (const r of list) {
    if (!r.from.trim()) continue
    const to = r.to.replace(/\\n/g, '\n')
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(r.from.trim())}(?=$|[^\\p{L}\\p{N}])[.,]?`, 'giu')
    out = out.replace(re, (_m, pre: string) => (to === '\n' ? '\n' : pre + to))
  }
  return out.replace(/ *\n */g, '\n')
}

export function defaultLiveTitle(date: Date): string {
  return `Aufnahme vom ${date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}, ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
}

/** Dateiname aus Pfad oder content://-URI (ohne Endung), lesbar und ohne Pfadtrenner. */
export function displayName(uri: string): { base: string; ext: string } {
  let tail = uri.split('?')[0].replace(/\/+$/, '')
  try {
    tail = decodeURIComponent(tail)
  } catch {
    // ungültige Kodierung: Rohtext verwenden
  }
  tail = tail.split(/[/:\\]/).pop() || 'Audio'
  const dot = tail.lastIndexOf('.')
  const ext = dot > 0 ? tail.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) : ''
  const base = (dot > 0 ? tail.slice(0, dot) : tail).trim() || 'Audio'
  return { base, ext }
}

/** Für Dateinamen von Exporten: keine Pfadtrenner oder Steuerzeichen. */
export function safeFileName(name: string, fallback = 'Transkript'): string {
  const clean = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f/\\:*?"<>|]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^\.+$/.test(w))
    .join(' ')
    .slice(0, 80)
  return clean.replace(/^\.+/, '').trim() || fallback
}

let counter = 0
/** Eindeutige ID (RFC-4122-Format, Zufall aus Math.random – nur lokale Schlüssel, kein Geheimnis). */
export function uuid(): string {
  counter = (counter + 1) % 0xffff
  const hex = (n: number): string => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0')
  const time = Date.now().toString(16).padStart(12, '0').slice(-12)
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${counter.toString(16).padStart(3, '0').slice(-3)}-${hex(12)}`
}

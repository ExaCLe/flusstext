import { EventEmitter } from 'node:events'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { DictationEntry, SearchHit, Transcript, TranscriptMeta } from '@shared/types'
import { paths } from './paths'

function atomicWrite(file: string, data: string): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

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
function searchText(t: Transcript): string {
  return [t.title, ...t.speakers.map((s) => s.name), t.notes ?? '', ...t.segments.map((s) => s.text)].join('\n')
}

class TranscriptStore extends EventEmitter {
  private metas = new Map<string, TranscriptMeta>()
  private texts = new Map<string, string>()

  constructor() {
    super()
    for (const f of readdirSync(paths.transcripts)) {
      if (!f.endsWith('.json')) continue
      try {
        const t: Transcript = JSON.parse(readFileSync(join(paths.transcripts, f), 'utf8'))
        // Abgebrochene Verarbeitung aus einer früheren Sitzung
        if (t.status === 'processing') {
          t.status = 'error'
          t.error = 'Verarbeitung wurde unterbrochen.'
          this.write(t)
        }
        this.metas.set(t.id, toMeta(t))
        this.texts.set(t.id, searchText(t))
      } catch {
        // defekte Datei ignorieren
      }
    }
  }

  private file(id: string): string {
    return join(paths.transcripts, `${id}.json`)
  }

  private write(t: Transcript): void {
    atomicWrite(this.file(t.id), JSON.stringify(t))
  }

  list(): TranscriptMeta[] {
    return [...this.metas.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  get(id: string): Transcript | null {
    const f = this.file(id)
    if (!existsSync(f)) return null
    return JSON.parse(readFileSync(f, 'utf8'))
  }

  search(query: string): SearchHit[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const hits: SearchHit[] = []
    for (const meta of this.list()) {
      const text = this.texts.get(meta.id) ?? ''
      const i = text.toLowerCase().indexOf(q)
      if (i < 0) continue
      const from = Math.max(0, i - 60)
      const snippet = (from > 0 ? '…' : '') + text.slice(from, i + q.length + 120).replace(/\s+/g, ' ').trim()
      hits.push({ id: meta.id, snippet })
    }
    return hits
  }

  save(t: Transcript): void {
    this.write(t)
    this.metas.set(t.id, toMeta(t))
    this.texts.set(t.id, searchText(t))
    this.emit('change', t)
  }

  update(id: string, patch: Partial<Transcript>, silent = false): Transcript | null {
    const t = this.get(id)
    if (!t) return null
    const next = { ...t, ...patch, id }
    if (silent) this.write(next)
    else this.save(next)
    return next
  }

  delete(id: string): void {
    const t = this.get(id)
    rmSync(this.file(id), { force: true })
    if (t?.audioPath && t.audioPath.startsWith(paths.recordings)) rmSync(t.audioPath, { force: true })
    this.metas.delete(id)
    this.texts.delete(id)
    this.emit('change', null)
  }
}

class DictationStore extends EventEmitter {
  private entries: DictationEntry[] = []

  constructor() {
    super()
    try {
      this.entries = JSON.parse(readFileSync(paths.dictations, 'utf8'))
    } catch {
      this.entries = []
    }
  }

  list(): DictationEntry[] {
    return this.entries
  }

  add(e: DictationEntry): void {
    this.entries.unshift(e)
    if (this.entries.length > 5000) this.entries.length = 5000
    this.persist()
  }

  delete(id: string): void {
    this.entries = this.entries.filter((e) => e.id !== id)
    this.persist()
  }

  clear(): void {
    this.entries = []
    this.persist()
  }

  private persist(): void {
    atomicWrite(paths.dictations, JSON.stringify(this.entries))
    this.emit('change')
  }
}

export const transcripts = new TranscriptStore()
export const dictations = new DictationStore()

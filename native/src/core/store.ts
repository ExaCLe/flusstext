// Transkripte (eine JSON-Datei je Transkript) und Diktatverlauf im App-Datenordner.
import type { DictationEntry, SearchHit, Transcript, TranscriptMeta } from '../../../src/shared/types'
import type { Bus } from './bus'
import { searchHits, searchText, toMeta } from './domain/text'
import { isInside, join, readJson, removePath, RNFS, serialized, writeAtomic, type AppPaths } from './fs'

const ID = /^[A-Za-z0-9-]{1,64}$/

/** Felder, die nur die App selbst setzt (z. B. Audiopfad, der beim Löschen mit entfernt wird). */
const PROTECTED: (keyof Transcript)[] = ['id', 'audioPath', 'originalPath', 'createdAt', 'source']

export class TranscriptStore {
  private metas = new Map<string, TranscriptMeta>()
  private texts = new Map<string, string>()

  constructor(private paths: AppPaths, private bus: Bus) {}

  private file(id: string): string {
    if (!ID.test(id)) throw new Error('Ungültige Transkript-ID.')
    return join(this.paths.transcripts, `${id}.json`)
  }

  async init(): Promise<void> {
    const names = new Set((await RNFS.readdir(this.paths.transcripts)).map((n) => n.replace(/\.tmp$/, '')))
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -5)
      if (!ID.test(id)) continue
      const t = await readJson<Transcript>(this.file(id))
      if (!t || t.id !== id || !Array.isArray(t.segments)) continue
      if (t.status === 'processing') {
        // Abgebrochene Verarbeitung aus einer früheren Sitzung
        t.status = 'error'
        t.error = 'Verarbeitung wurde unterbrochen.'
        await writeAtomic(this.file(id), JSON.stringify(t))
      }
      this.index(t)
    }
  }

  private index(t: Transcript): void {
    this.metas.set(t.id, toMeta(t))
    this.texts.set(t.id, searchText(t))
  }

  private changed(): void {
    this.bus.emit({ type: 'transcripts', value: this.list() })
  }

  list(): TranscriptMeta[] {
    return [...this.metas.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  has(id: string): boolean {
    return this.metas.has(id)
  }

  async get(id: string): Promise<Transcript | null> {
    if (!ID.test(id) || !this.metas.has(id)) return null
    const value = await readJson<Transcript>(this.file(id))
    return value ? { ...value, ...toMeta(value) } : null
  }

  search(query: string): SearchHit[] {
    return searchHits(query, this.list(), this.texts)
  }

  async save(t: Transcript): Promise<void> {
    t = { ...t, ...toMeta(t) }
    await serialized(`transcript:${t.id}`, () => writeAtomic(this.file(t.id), JSON.stringify(t)))
    this.index(t)
    this.changed()
  }

  /**
   * Aktuellen Stand lesen, ändern und schreiben – nacheinander je Transkript, damit gleichzeitige
   * Änderungen (Nutzer bearbeitet, Auftrag schreibt Segmente) sich nicht überschreiben.
   * Liefert null, wenn das Transkript inzwischen gelöscht wurde.
   */
  async patch(id: string, fn: (t: Transcript) => Transcript | null): Promise<Transcript | null> {
    const next = await serialized(`transcript:${id}`, async () => {
      if (!this.metas.has(id)) return null
      const cur = await readJson<Transcript>(this.file(id))
      if (!cur) return null
      const value = fn(cur)
      if (!value) return null
      const t = { ...value, ...toMeta(value), id }
      await writeAtomic(this.file(id), JSON.stringify(t))
      return t
    })
    if (next && this.metas.has(id)) {
      this.index(next)
      this.changed()
    }
    return next
  }

  /** Änderungen aus der Oberfläche; geschützte Felder bleiben unverändert. */
  async update(id: string, patch: Partial<Transcript>): Promise<Transcript | null> {
    if (!patch || typeof patch !== 'object') throw new Error('Ungültige Änderung.')
    const clean: Partial<Transcript> = { ...patch }
    for (const k of PROTECTED) delete clean[k]
    if (clean.segments !== undefined && !Array.isArray(clean.segments)) throw new Error('Ungültige Segmente.')
    if (clean.speakers !== undefined && !Array.isArray(clean.speakers)) throw new Error('Ungültige Sprecher.')
    return this.patch(id, (t) => ({ ...t, ...clean }))
  }

  async remove(id: string): Promise<void> {
    if (!ID.test(id)) return
    const t = await this.get(id)
    this.metas.delete(id)
    this.texts.delete(id)
    await serialized(`transcript:${id}`, async () => {
      await removePath(this.file(id))
      await removePath(`${this.file(id)}.tmp`)
    })
    // Nur Audio im eigenen Speicher löschen (Aufnahmen und importierte Kopien)
    const audio = t?.audioPath
    if (audio && (isInside(audio, this.paths.recordings) || isInside(audio, this.paths.imports))) await removePath(audio)
    this.changed()
  }
}

export class DictationStore {
  private entries: DictationEntry[] = []

  constructor(private paths: AppPaths, private bus: Bus) {}

  async init(): Promise<void> {
    const stored = await readJson<DictationEntry[]>(this.paths.dictations)
    this.entries = Array.isArray(stored) ? stored.filter((e) => e && typeof e.id === 'string' && typeof e.text === 'string') : []
  }

  list(): DictationEntry[] {
    return this.entries
  }

  async add(e: DictationEntry): Promise<void> {
    this.entries = [e, ...this.entries].slice(0, 5000)
    await this.persist()
  }

  async remove(id: string): Promise<void> {
    this.entries = this.entries.filter((e) => e.id !== id)
    await this.persist()
  }

  async clear(): Promise<void> {
    this.entries = []
    await this.persist()
  }

  private async persist(): Promise<void> {
    await writeAtomic(this.paths.dictations, JSON.stringify(this.entries))
    this.bus.emit({ type: 'dictation', value: this.entries })
  }
}

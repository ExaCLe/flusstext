// App-Zustand: Daten aus der nativen API, Navigation, Toasts und die laufende Aufnahme.
import { useEffect, useReducer, useRef } from 'react'
import type { AppEvent, DictationEntry, FlusstextApi, Job, NativeModel, PlaybackState, DictationState, RecordingState, Settings, TranscriptMeta } from '../core/contracts'
import type { Bookmark } from '../../../src/shared/types'

export type Route =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'transcript'; id: string }
  | { name: 'record' }
  | { name: 'history' }
  | { name: 'vocabulary' }
  | { name: 'dictation' }
  | { name: 'models' }
  | { name: 'settings' }

export type RouteName = Route['name']

export interface Toast {
  id: number
  text: string
  detail?: string
  tone: 'default' | 'success' | 'error'
}

export interface LiveDraft {
  title: string
  notes: string
  bookmarks: Bookmark[]
  levels: number[]
  startedAt: number
  /** Start/Stopp läuft gerade */
  pending: 'starting' | 'finishing' | null
}

export interface State {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  settings: Settings | null
  models: NativeModel[]
  transcripts: TranscriptMeta[]
  jobs: Job[]
  dictations: DictationEntry[]
  recording: RecordingState
  playback: PlaybackState
  dictationState: DictationState
  live: LiveDraft
  stack: Route[]
  /** Richtung des letzten Seitenwechsels, für die Übergangsanimation */
  nav: 'push' | 'pop' | 'replace'
  search: string
  toasts: Toast[]
}

const IDLE: RecordingState = { phase: 'idle', elapsed: 0, level: 0 }
const EMPTY_LIVE: LiveDraft = { title: '', notes: '', bookmarks: [], levels: [], startedAt: 0, pending: null }

let state: State = {
  status: 'loading',
  loadError: null,
  settings: null,
  models: [],
  transcripts: [],
  jobs: [],
  dictations: [],
  recording: IDLE,
  playback: {transcriptId:null,time:0,duration:0,playing:false,rate:1},
  dictationState: {phase:'idle',elapsed:0,level:0},
  live: EMPTY_LIVE,
  stack: [{ name: 'home' }],
  nav: 'replace',
  search: '',
  toasts: []
}
const listeners = new Set<() => void>()
let api: FlusstextApi | null = null

export function getState(): State {
  return state
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...next }
  for (const l of listeners) l()
}

export function getApi(): FlusstextApi {
  if (!api) throw new Error('Flusstext-API ist nicht verbunden')
  return api
}

/** Auswahl aus dem Zustand; rendert nur neu, wenn sich der Wert ändert. */
export function useApp<T>(select: (s: State) => T): T {
  const [, force] = useReducer((x: number) => x + 1, 0)
  const selectRef = useRef(select)
  selectRef.current = select
  const value = select(state)
  const valueRef = useRef(value)
  valueRef.current = value
  useEffect(() => {
    const check = (): void => {
      if (!Object.is(selectRef.current(state), valueRef.current)) force()
    }
    listeners.add(check)
    check()
    return () => {
      listeners.delete(check)
    }
  }, [])
  return value
}

export const useSettings = (): Settings => useApp((s) => s.settings!)

// ------------------------------------------------------------ Fehler & Toasts

let toastId = 0

export function toast(text: string, tone: Toast['tone'] = 'default', detail?: string): void {
  const id = ++toastId
  setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone, detail }] }))
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 5200 : 3200)
}

/** Kurze, verständliche Zusatzinfo aus einer Fehlermeldung der nativen Schicht. */
export function errorDetail(e: unknown): string | undefined {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  const clean = msg.replace(/^Error:\s*/i, '').trim()
  if (!clean || clean.length > 140) return undefined
  return clean
}

/** Führt eine API-Aktion aus und zeigt bei Fehlern eine deutsche Meldung. */
export async function attempt<T>(fallback: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    toast(fallback, 'error', errorDetail(e))
    return undefined
  }
}

// ------------------------------------------------------------ Navigation

export function currentRoute(s: State = state): Route {
  return s.stack[s.stack.length - 1]
}

/** Hauptbereich wechseln (Seitenleiste): Verlauf beginnt neu. */
export function navigate(route: Route): void {
  const cur = currentRoute()
  if (cur.name === route.name && (cur as { id?: string }).id === (route as { id?: string }).id) return
  if (route.name === 'transcript') {
    const base = cur.name === 'transcript' ? state.stack.slice(0, -1) : state.stack
    setState({ stack: [...base, route], nav: 'push', search: '' })
    return
  }
  setState({ stack: [route], nav: 'replace', search: '' })
}

/** Zurück; false, wenn es nichts mehr zurückzugehen gibt. */
export function goBack(): boolean {
  if (state.stack.length > 1) {
    setState((s) => ({ stack: s.stack.slice(0, -1), nav: 'pop', search: '' }))
    return true
  }
  if (currentRoute().name !== 'home') {
    setState({ stack: [{ name: 'home' }], nav: 'pop', search: '' })
    return true
  }
  return false
}

export function setSearch(search: string): void {
  setState({ search })
}

// ------------------------------------------------------------ Einstellungen

type Obj = Record<string, unknown>

function merge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch as T
  const out: Obj = { ...(base as Obj) }
  for (const [k, v] of Object.entries(patch as Obj)) {
    const cur = out[k]
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' ? merge(cur, v) : v
  }
  return out as T
}

/** Sofort lokal übernehmen, dann mit der Antwort der API abgleichen. */
export async function setSettings(patch: unknown): Promise<boolean> {
  const before = state.settings
  if (before) setState({ settings: merge(before, patch) })
  try {
    const saved = await getApi().settings.set(patch)
    setState({ settings: saved })
    return true
  } catch (e) {
    if (before) setState({ settings: before })
    toast('Einstellung konnte nicht gespeichert werden', 'error', errorDetail(e))
    return false
  }
}

// ------------------------------------------------------------ Laden & Ereignisse

function onEvent(e: AppEvent): void {
  switch (e.type) {
    case 'files':
      void transcribeFiles(e.paths)
      break
    case 'playback':
      setState({playback:e.value})
      break
    case 'dictationState':
      setState({dictationState:e.value})
      break
    case 'settings':
      setState({ settings: e.value })
      break
    case 'models':
      setState({ models: e.value })
      break
    case 'transcripts':
      setState({ transcripts: e.value })
      break
    case 'jobs':
      setState({ jobs: e.value })
      break
    case 'dictation':
      setState({ dictations: e.value })
      break
    case 'recording': {
      const r = e.value
      setState((s) => ({
        recording: r,
        live:
          r.phase === 'recording'
            ? { ...s.live, levels: [...s.live.levels.slice(-119), r.level], startedAt: s.live.startedAt || Date.now() }
            : r.phase === 'paused'
              ? { ...s.live, levels: [...s.live.levels.slice(-119), 0] }
              : s.live
      }))
      break
    }
    case 'error':
      toast(e.message, 'error')
      break
  }
}

export function connect(next: FlusstextApi): () => void {
  api = next
  const off = next.subscribe(onEvent)
  void load()
  return () => {
    off()
    if (api === next) api = null
  }
}

export async function load(): Promise<void> {
  const a = getApi()
  const refreshing = state.status === 'ready'
  if (!refreshing) setState({ status: 'loading', loadError: null })
  try {
    const [settings, models, transcripts, jobs, dictations] = await Promise.all([
      a.settings.get(),
      a.models.list(),
      a.transcripts.list(),
      a.jobs.list(),
      a.dictation.history()
    ])
    setState({ settings, models, transcripts, jobs, dictations, recording: a.recording.state(), playback: a.transcripts.playback(), dictationState: a.dictation.state(), status: 'ready' })
  } catch (e) {
    if (refreshing) toast('Daten konnten nicht aktualisiert werden', 'error', errorDetail(e))
    else setState({ status: 'error', loadError: errorDetail(e) ?? null })
  }
}

// ------------------------------------------------------------ Aufnahme

export function setLive(patch: Partial<LiveDraft> | ((l: LiveDraft) => Partial<LiveDraft>)): void {
  setState((s) => ({ live: { ...s.live, ...(typeof patch === 'function' ? patch(s.live) : patch) } }))
}

export function transcriptionModel(s: State = state): NativeModel | undefined {
  return s.models.find((m) => m.id === s.settings?.transcriptionModel)
}

export async function startRecording(): Promise<void> {
  const s = state
  if (s.recording.phase !== 'idle' || s.live.pending) return
  if (!transcriptionModel()?.installed) {
    toast('Bitte zuerst ein Transkriptionsmodell herunterladen', 'error')
    navigate({ name: 'models' })
    return
  }
  setLive({ ...EMPTY_LIVE, pending: 'starting' })
  try {
    const allowed = await getApi().system.requestMicrophone()
    if (!allowed) {
      setLive({ pending: null })
      toast('Kein Zugriff aufs Mikrofon', 'error', 'Bitte den Mikrofonzugriff für Flusstext in den Systemeinstellungen erlauben.')
      return
    }
    await getApi().recording.start({})
    setState((x) => ({ recording: getApi().recording.state(), live: { ...x.live, pending: null, startedAt: Date.now() } }))
  } catch (e) {
    setLive({ pending: null })
    toast('Aufnahme konnte nicht gestartet werden', 'error', errorDetail(e))
  }
}

export async function togglePause(): Promise<void> {
  const paused = state.recording.phase === 'paused'
  await attempt(paused ? 'Aufnahme konnte nicht fortgesetzt werden' : 'Aufnahme konnte nicht pausiert werden', async () => {
    if (paused) await getApi().recording.resume()
    else await getApi().recording.pause()
    setState({ recording: getApi().recording.state() })
  })
}

export function addBookmark(): void {
  setLive((l) => ({ bookmarks: [...l.bookmarks, { time: state.recording.elapsed, label: `Lesezeichen ${l.bookmarks.length + 1}` }] }))
}

export async function stopRecording(diarization: boolean, numSpeakers: number): Promise<string | null> {
  const { live } = state
  setLive({ pending: 'finishing' })
  try {
    const id = await getApi().recording.stop({ diarization, numSpeakers, title: live.title.trim() || undefined, notes: live.notes, bookmarks: live.bookmarks })
    setState({ live: EMPTY_LIVE, recording: getApi().recording.state() })
    return id
  } catch (e) {
    setLive({ pending: null })
    toast('Aufnahme konnte nicht gespeichert werden', 'error', errorDetail(e))
    return null
  }
}

export async function discardRecording(): Promise<void> {
  try {
    await getApi().recording.cancel()
    setState({ live: EMPTY_LIVE, recording: getApi().recording.state() })
  } catch (e) {
    toast('Aufnahme konnte nicht verworfen werden', 'error', errorDetail(e))
  }
}

// ------------------------------------------------------------ Dateien

export async function pickAndTranscribe(): Promise<void> {
  const a = getApi()
  if (!transcriptionModel()?.installed) {
    toast('Bitte zuerst ein Transkriptionsmodell herunterladen', 'error')
    navigate({ name: 'models' })
    return
  }
  const files = await attempt('Dateiauswahl konnte nicht geöffnet werden', () => a.jobs.pick())
  if (!files?.length) return
  await transcribeFiles(files)
}

async function transcribeFiles(files: string[]): Promise<void> {
  if (!transcriptionModel()?.installed) {
    toast('Bitte zuerst ein Transkriptionsmodell herunterladen', 'error')
    navigate({ name: 'models' })
    return
  }
  const jobs = await attempt('Transkription konnte nicht gestartet werden', () => getApi().jobs.add(files, {}))
  if (!jobs) return
  navigate({ name: 'library' })
  toast(files.length === 1 ? 'Transkription gestartet' : `${files.length} Dateien in der Warteschlange`, 'success')
}

// ------------------------------------------------------------ Modelle

export const ACTIVE_JOB = (j: Job): boolean => !['done', 'error', 'cancelled'].includes(j.stage)

export function isDownloading(m: NativeModel): boolean {
  return !!m.download && (m.download.state === 'downloading' || m.download.state === 'extracting')
}

/** Wie src/shared/diarization.ts, aber auf Basis der Modellliste des Geräts. */
export function pickDiarization(models: NativeModel[], s: Settings): { seg?: NativeModel; emb?: NativeModel } {
  const pick = (kind: 'segmentation' | 'embedding', wanted: string): NativeModel | undefined => {
    const list = models.filter((m) => m.kind === kind && m.installed)
    return list.find((m) => m.id === wanted) ?? list[0]
  }
  return { seg: pick('segmentation', s.diarization.segmentationModel), emb: pick('embedding', s.diarization.embeddingModel) }
}

export function useDiarizationReady(): boolean {
  return useApp((s) => {
    if (!s.settings) return false
    const { seg, emb } = pickDiarization(s.models, s.settings)
    return !!seg && !!emb
  })
}

export async function downloadModel(m: NativeModel): Promise<void> {
  if (!m.available) {
    toast('Dieses Modell ist auf diesem Gerät nicht verfügbar', 'error', m.unavailableReason)
    return
  }
  await attempt(`${m.name} konnte nicht heruntergeladen werden`, () => getApi().models.download(m.id))
}

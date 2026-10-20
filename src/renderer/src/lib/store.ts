import { create } from 'zustand'
import type { DictationEntry, Job, ModelStatus, Settings, TranscriptMeta } from '@shared/types'

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

interface Toast {
  id: number
  text: string
  tone?: 'default' | 'success' | 'error'
}

interface State {
  ready: boolean
  route: Route
  settings: Settings | null
  models: ModelStatus[]
  transcripts: TranscriptMeta[]
  jobs: Job[]
  dictations: DictationEntry[]
  toasts: Toast[]
  recording: boolean
  /** Suchfeld in der Kopfzeile – gilt für die jeweils offene Seite */
  search: string
  setSearch(q: string): void
  navigate(r: Route): void
  setSettings(patch: unknown): Promise<void>
  toast(text: string, tone?: Toast['tone']): void
  setRecording(on: boolean): void
}

let toastId = 0

function sameRoute(a: Route, b: Route): boolean {
  return a.name === b.name && (a as { id?: string }).id === (b as { id?: string }).id
}

export const useApp = create<State>((set) => ({
  ready: false,
  route: { name: 'home' },
  settings: null,
  models: [],
  transcripts: [],
  jobs: [],
  dictations: [],
  toasts: [],
  recording: false,
  search: '',
  setSearch: (search) => set({ search }),
  navigate: (route) => set((s) => (sameRoute(s.route, route) ? {} : { route, search: '' })),
  setSettings: async (patch) => {
    const s = await window.api.settings.set(patch)
    set({ settings: s })
  },
  toast: (text, tone = 'default') => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200)
  },
  setRecording: (recording) => set({ recording })
}))

export async function initStore(): Promise<void> {
  const api = window.api
  const [settings, models, transcripts, jobs, dictations] = await Promise.all([
    api.settings.get(),
    api.models.list(),
    api.transcripts.list(),
    api.jobs.list(),
    api.dictation.history()
  ])
  useApp.setState({ settings, models, transcripts, jobs, dictations, ready: true })
  api.settings.onChange((s) => useApp.setState({ settings: s }))
  api.models.onChange((m) => useApp.setState({ models: m }))
  api.transcripts.onChange(async () => useApp.setState({ transcripts: await api.transcripts.list() }))
  api.jobs.onChange((j) => useApp.setState({ jobs: j }))
  api.dictation.onHistory(async () => useApp.setState({ dictations: await api.dictation.history() }))
  api.system.onNavigate((r) => useApp.getState().navigate({ name: r } as Route))
}

export const useSettings = (): Settings => useApp((s) => s.settings!)

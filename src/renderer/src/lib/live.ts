// Live-Aufnahme als Singleton, damit sie beim Seitenwechsel weiterläuft.
import { create } from 'zustand'
import type { Bookmark, Segment } from '@shared/types'
import { startRecorder, type Recorder } from './recorder'
import { useApp } from './store'

type Phase = 'idle' | 'starting' | 'recording' | 'finishing'

interface LiveState {
  phase: Phase
  sessionId: string | null
  startedAt: number
  segments: Segment[]
  partial: string
  levels: number[]
  paused: boolean
  elapsed: number
  error: string | null
  title: string
  notes: string
  bookmarks: Bookmark[]
}

export const useLive = create<LiveState>(() => ({
  phase: 'idle',
  sessionId: null,
  startedAt: 0,
  segments: [],
  partial: '',
  levels: [],
  paused: false,
  elapsed: 0,
  error: null,
  title: '',
  notes: '',
  bookmarks: []
}))

let recorder: Recorder | null = null
let unsub: (() => void) | null = null

export async function startLive(): Promise<void> {
  if (useLive.getState().phase !== 'idle') return
  const settings = useApp.getState().settings!
  useLive.setState({ phase: 'starting', segments: [], partial: '', levels: [], error: null, paused: false, elapsed: 0, title: '', notes: '', bookmarks: [] })
  try {
    const sessionId = await window.api.live.start({})
    unsub = window.api.live.onEvent((e) => {
      if (e.sessionId !== sessionId) return
      if (e.type === 'segment' && e.segment) useLive.setState((s) => ({ segments: [...s.segments, e.segment!], partial: '' }))
      else if (e.type === 'partial') useLive.setState({ partial: e.text ?? '' })
    })
    recorder = await startRecorder({
      deviceId: settings.micDeviceId,
      keep: false,
      onChunk: (c) => {
        if (useLive.getState().paused) return
        window.api.live.chunk(sessionId, c)
        useLive.setState((s) => ({ elapsed: s.elapsed + c.length / 16000 }))
      },
      onLevel: (l) => useLive.setState((s) => ({ levels: [...s.levels.slice(-119), s.paused ? 0 : l] }))
    })
    useLive.setState({ phase: 'recording', sessionId, startedAt: Date.now() })
    useApp.getState().setRecording(true)
  } catch (e) {
    unsub?.()
    useLive.setState({ phase: 'idle', error: (e as Error).message.includes('Permission') ? 'Kein Zugriff aufs Mikrofon' : (e as Error).message })
  }
}

export function togglePause(): void {
  useLive.setState((s) => ({ paused: !s.paused }))
}

/** Lesezeichen an der aktuellen Stelle der Aufnahme setzen. */
export function addBookmark(): void {
  useLive.setState((s) => ({ bookmarks: [...s.bookmarks, { time: s.elapsed, label: `Lesezeichen ${s.bookmarks.length + 1}` }] }))
}

export async function stopLive(diarization: boolean, numSpeakers: number): Promise<string | null> {
  const { sessionId, phase, title, notes, bookmarks } = useLive.getState()
  if (!sessionId || phase !== 'recording') return null
  recorder?.close()
  recorder = null
  useLive.setState({ phase: 'finishing' })
  try {
    const id = await window.api.live.stop(sessionId, { diarization, numSpeakers, title, notes, bookmarks })
    useLive.setState({ segments: [], title: '', notes: '', bookmarks: [] })
    return id
  } catch (e) {
    useApp.getState().toast((e as Error).message, 'error')
    return null
  } finally {
    unsub?.()
    unsub = null
    useLive.setState({ phase: 'idle', sessionId: null, partial: '' })
    useApp.getState().setRecording(false)
  }
}

export async function discardLive(): Promise<void> {
  const { sessionId } = useLive.getState()
  recorder?.close()
  recorder = null
  unsub?.()
  unsub = null
  if (sessionId) await window.api.live.cancel(sessionId)
  useLive.setState({ phase: 'idle', sessionId: null, segments: [], partial: '', bookmarks: [], notes: '', title: '' })
  useApp.getState().setRecording(false)
}

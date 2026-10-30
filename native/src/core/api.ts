// Einstiegspunkt der nativen App-Dienste: createApi() liefert die FlusstextApi für die Oberfläche.
import { AppState, Platform as RNPlatform } from 'react-native'
import type { ExportFormat, ExportOptions, SystemInfo, Transcript, TranscribeOptions } from '../../../src/shared/types'
import { Bus } from './bus'
import type { DictationState, FlusstextApi, RecordingState } from './contracts'
import { Dictation } from './dictation'
import type { Platform } from './domain/catalog'
import { EXPORT_MIME, exportTranscript } from './domain/export'
import { safeFileName } from './domain/text'
import { ensureDirs, join, pathsFor, removePath, RNFS, type AppPaths } from './fs'
import { host as nativeHost, listenHost, type HostInfo, type NativeHost } from './host'
import { JobQueue } from './jobs'
import { Microphone } from './microphone'
import { ModelManager } from './models'
import { Playback } from './playback'
import { Recorder } from './recording'
import { SettingsStore } from './settings'
import { createSpeechEngine } from './speech'
import type { SpeechEngine } from './speech-types'
import { DictationStore, TranscriptStore } from './store'

interface Services {
  host: NativeHost
  info: HostInfo
  paths: AppPaths
  settings: SettingsStore
  models: ModelManager
  transcripts: TranscriptStore
  dictations: DictationStore
  speech: SpeechEngine
  jobs: JobQueue
  recorder: Recorder
  dictation: Dictation
  playback: Playback
}

function currentPlatform(): Platform {
  const os = RNPlatform.OS as string
  if (os === 'ios' || os === 'android' || os === 'macos') return os
  throw new Error(`Plattform ${os} wird nicht unterstützt.`)
}

async function boot(platform: Platform, bus: Bus): Promise<Services> {
  const host = nativeHost
  if (!host) throw new Error('Der native Flusstext-Dienst ist nicht installiert. Bitte die App neu bauen.')
  const info = await host.info()
  const paths = pathsFor(info)
  await ensureDirs(paths)
  // Exporte vom letzten Teilen aufräumen
  for (const e of await RNFS.readDir(paths.exports)) await removePath(e.path)
  const settings = await SettingsStore.load(paths, bus, platform, info.cpuThreads)
  const models = new ModelManager(paths, bus, settings, host, platform, { memoryBytes: info.memoryBytes, cpuThreads: info.cpuThreads })
  await models.init()
  const transcripts = new TranscriptStore(paths, bus)
  await transcripts.init()
  const dictations = new DictationStore(paths, bus)
  await dictations.init()
  const speech = createSpeechEngine(paths, host)
  const mic = new Microphone(host)
  const jobs = new JobQueue(paths, bus, transcripts, settings, models, speech)
  const recorder = new Recorder(paths, bus, host, mic, transcripts, settings, models, speech, platform)
  const dictation = new Dictation(paths, bus, host, mic, dictations, settings, models, speech, platform)
  const playback = new Playback(bus, host, transcripts)

  models.onRemoved(() => speech.release())
  settings.onChange((next, prev) => {
    const d = next.dictation
    const p = prev.dictation
    if (JSON.stringify(d) !== JSON.stringify(p) || next.transcriptionModel !== prev.transcriptionModel || next.dictationModel !== prev.dictationModel) {
      dictation.applyHotkeys(next).catch((e) => bus.error(e, 'Tastenkürzel konnten nicht gesetzt werden'))
    }
  })
  listenHost((event) => {
    try {
      if (event.type === 'files') bus.emit(event)
      else if (event.type === 'fileError') bus.error(event.message)
      else if (event.type === 'key') bus.emit(event)
      else if (event.type === 'audio' || event.type === 'audioError') mic.handle(event)
      else if (event.type === 'playback') playback.handle(event)
      else if (event.type === 'hotkey') dictation.onHotkey(event.action)
    } catch (e) {
      bus.error(e)
    }
  })
  if (platform === 'macos') AppState.addEventListener('change', state => { if (state === 'active') void dictation.applyHotkeys(settings.get()).catch(() => undefined) })
  // A first launch without Accessibility is expected; the Dictation screen offers an explicit grant action.
  dictation.applyHotkeys(settings.get()).catch(() => undefined)
  return { host, info, paths, settings, models, transcripts, dictations, speech, jobs, recorder, dictation, playback }
}

const IDLE_RECORDING: RecordingState = { phase: 'idle', elapsed: 0, level: 0 }
const IDLE_DICTATION: DictationState = { phase: 'idle', elapsed: 0, level: 0 }

export function createApi(): FlusstextApi {
  const platform = currentPlatform()
  const bus = new Bus()
  let services: Services | null = null
  let booting: Promise<Services> | null = null
  /** Start bei Bedarf; schlägt er fehl, versucht der nächste Aufruf es erneut. */
  const ready = (): Promise<Services> => {
    if (services) return Promise.resolve(services)
    if (!booting) {
      booting = boot(platform, bus).then(
        (s) => (services = s),
        (e) => {
          booting = null
          throw e
        }
      )
    }
    return booting
  }
  const use = <T>(fn: (s: Services) => Promise<T> | T): Promise<T> => ready().then(fn)
  void ready().catch(() => undefined)

  return {
    platform,
    subscribe: (listener) => bus.subscribe(listener),
    settings: {
      get: () => use((s) => s.settings.get()),
      set: (patch) => use(async (s) => {
        if (platform === 'macos' && patch && typeof patch === 'object' && 'launchAtLogin' in patch && (patch as {launchAtLogin:unknown}).launchAtLogin !== s.settings.get().launchAtLogin) await s.host.setLaunchAtLogin?.(!!(patch as {launchAtLogin:boolean}).launchAtLogin)
        return s.settings.set(patch)
      })
    },
    system: {
      requestDictationAccess: () => use(async s => {
        const allowed = await s.host.requestHotkeyAccess?.() ?? false
        if (allowed) await s.dictation.applyHotkeys(s.settings.get())
        return allowed
      }),
      info: () =>
        use(async (s): Promise<SystemInfo> => {
          const info = await s.host.info()
          return {
            version: info.version,
            modelsDir: s.paths.models,
            dataDir: s.paths.data,
            freeDiskBytes: info.freeDiskBytes,
            cpuThreads: info.cpuThreads,
            ...(info.gpuName ? { gpuName: info.gpuName } : {})
          }
        }),
      openPath: (path) => use((s) => s.host.openPath(path)),
      openExternal: (url) =>
        use((s) => {
          if (!/^https:\/\//i.test(url)) throw new Error('Nur https-Links können geöffnet werden.')
          return s.host.openExternal(url)
        }),
      requestMicrophone: () => use((s) => s.host.requestMicrophone())
    },
    models: {
      list: () => use((s) => s.models.list()),
      download: (id) => use((s) => s.models.download(id)),
      cancel: (id) => use((s) => s.models.cancel(id)),
      remove: (id) => use((s) => s.models.remove(id))
    },
    transcripts: {
      list: () => use((s) => s.transcripts.list()),
      get: (id) => use((s) => s.transcripts.get(id)),
      update: (id, patch: Partial<Transcript>) => use((s) => s.transcripts.update(id, patch)),
      remove: (id) =>
        use(async (s) => {
          s.jobs.cancelForTranscript(id)
          await s.playback.forget(id)
          await s.transcripts.remove(id)
        }),
      search: (query) => use((s) => s.transcripts.search(query)),
      export: (id, format: ExportFormat, opts: ExportOptions) =>
        use(async (s) => {
          if (!(format in EXPORT_MIME)) throw new Error('Unbekanntes Exportformat.')
          const t = await s.transcripts.get(id)
          if (!t) throw new Error('Transkript nicht gefunden.')
          const payload = await exportTranscript(t, format, opts)
          const name = `${safeFileName(t.title)}.${format}`
          const file = join(s.paths.exports, name)
          await removePath(file)
          await RNFS.writeFile(file, payload.data, payload.encoding)
          await s.host.shareFile(file, name)
        }),
      copy: (id, opts: ExportOptions) =>
        use(async (s) => {
          const t = await s.transcripts.get(id)
          if (!t) throw new Error('Transkript nicht gefunden.')
          const payload = await exportTranscript(t, 'txt', opts)
          await s.host.copyText(payload.data)
        }),
      play: (id, at, rate) => use((s) => s.playback.play(id, at, rate)),
      pause: () => use((s) => s.playback.pause()),
      setRate: (rate) => use((s) => s.playback.setRate(rate)),
      playback: () => services?.playback.state() ?? { transcriptId: null, time: 0, duration: 0, playing: false, rate: 1 }
    },
    jobs: {
      pick: () => use((s) => s.host.pickFiles()),
      add: (files, opts: TranscribeOptions) => use((s) => s.jobs.add(files, opts ?? {})),
      list: () => use((s) => s.jobs.list()),
      cancel: (id) => use((s) => s.jobs.cancel(id))
    },
    recording: {
      state: () => services?.recorder.state() ?? IDLE_RECORDING,
      start: (opts) => use((s) => s.recorder.start(opts ?? {})),
      pause: () => use((s) => s.recorder.pause()),
      resume: () => use((s) => s.recorder.resume()),
      stop: (opts) => use((s) => s.recorder.stop(opts)),
      cancel: () => use((s) => s.recorder.cancel())
    },
    dictation: {
      captureKeys: (enabled) => use(async s => { await s.host.captureKeys?.(enabled) }),
      history: () => use((s) => s.dictations.list()),
      remove: (id) => use((s) => s.dictations.remove(id)),
      clear: () => use((s) => s.dictations.clear()),
      copy: (text) => use((s) => s.host.copyText(String(text ?? ''))),
      start: () => use((s) => s.dictation.start()),
      stop: () => use((s) => s.dictation.stop()),
      cancel: () => use((s) => s.dictation.cancel()),
      state: () => services?.dictation.state() ?? IDLE_DICTATION,
      pasteLast: () => use((s) => s.dictation.pasteLast())
    }
  }
}

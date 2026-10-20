import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { Api } from '@shared/api'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

const api: Api = {
  platform: process.platform,
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
    onChange: (cb) => on('settings:changed', cb)
  },
  system: {
    info: () => invoke('system:info'),
    openPath: (p) => invoke('system:openPath', p),
    showInFolder: (p) => invoke('system:showInFolder', p),
    openExternal: (url) => invoke('system:openExternal', url),
    pathForFile: (file) => webUtils.getPathForFile(file),
    onNavigate: (cb) => on('app:navigate', cb)
  },
  models: {
    list: () => invoke('models:list'),
    download: (id) => invoke('models:download', id),
    cancel: (id) => invoke('models:cancel', id),
    remove: (id) => invoke('models:remove', id),
    onChange: (cb) => on('models:changed', cb)
  },
  transcripts: {
    list: () => invoke('transcripts:list'),
    get: (id) => invoke('transcripts:get', id),
    update: (id, patch) => invoke('transcripts:update', id, patch),
    remove: (id) => invoke('transcripts:remove', id),
    exportTo: (id, format, opts) => invoke('transcripts:export', id, format, opts),
    copyText: (id, opts) => invoke('transcripts:copy', id, opts),
    search: (query) => invoke('transcripts:search', query),
    peaks: (id) => invoke('transcripts:peaks', id),
    onChange: (cb) => on('transcripts:changed', cb)
  },
  jobs: {
    pickFiles: () => invoke('jobs:pick'),
    add: (paths, opts) => invoke('jobs:add', paths, opts),
    list: () => invoke('jobs:list'),
    cancel: (id) => invoke('jobs:cancel', id),
    onChange: (cb) => on('jobs:changed', cb)
  },
  live: {
    start: (opts) => invoke('live:start', opts),
    chunk: (sessionId, samples) => ipcRenderer.send('live:chunk', sessionId, samples),
    stop: (sessionId, opts) => invoke('live:stop', sessionId, opts),
    cancel: (sessionId) => invoke('live:cancel', sessionId),
    onEvent: (cb) => on('live:event', cb)
  },
  dictation: {
    history: () => invoke('dictation:history'),
    remove: (id) => invoke('dictation:remove', id),
    clear: () => invoke('dictation:clear'),
    copy: (text) => invoke('dictation:copy', text),
    onHistory: (cb) => on('dictation:history', cb),
    captureKeys: (on) => invoke('dictation:capture', on),
    onKey: (cb) => on('dictation:key', cb),
    onState: (cb) => on('overlay:state', cb)
  },
  overlay: {
    onCommand: (cb) => on('overlay:command', cb),
    onState: (cb) => on('overlay:state', cb),
    audio: (samples) => ipcRenderer.send('overlay:audio', samples),
    micReady: () => ipcRenderer.send('overlay:micReady'),
    micError: (message) => ipcRenderer.send('overlay:micError', message),
    cancel: () => ipcRenderer.send('overlay:cancel'),
    stop: () => ipcRenderer.send('overlay:stop'),
    start: () => ipcRenderer.send('overlay:start'),
    hello: () => ipcRenderer.send('overlay:hello'),
    setInteractive: (on) => ipcRenderer.send('overlay:interactive', on)
  }
}

contextBridge.exposeInMainWorld('api', api)

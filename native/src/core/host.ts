import { NativeEventEmitter, NativeModules } from 'react-native'
export interface HostInfo { version: string; dataDir: string; modelsDir: string; tempDir: string; freeDiskBytes: number; cpuThreads: number; memoryBytes: number; gpuName?: string }
export type HostEvent =
  | { type: 'files'; paths: string[] }
  | { type: 'fileError'; message: string }
  | { type: 'audio'; elapsed: number; level: number }
  | { type: 'audioError'; message: string }
  | { type: 'playback'; path: string; time: number; duration: number; playing: boolean }
  | { type: 'key'; keycode: number; down: boolean }
  | { type: 'hotkey'; action: 'start' | 'stop' | 'cancel' | 'pasteLast' }
export interface NativeHost {
  info(): Promise<HostInfo>
  requestMicrophone(): Promise<boolean>
  pickFiles(): Promise<string[]>
  shareFile(path: string, name: string): Promise<boolean>
  copyText(text: string): Promise<void>
  pasteText(text: string, restore: boolean): Promise<boolean>
  openPath(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  audioStart(path: string, deviceId: string): Promise<void>
  audioPause(): Promise<void>
  audioResume(): Promise<void>
  audioStop(): Promise<{ path: string; duration: number }>
  audioSnapshot(sinceSeconds: number): Promise<{ path: string; duration: number }>
  audioCancel(): Promise<void>
  play(path: string, at: number, rate: number): Promise<void>
  pausePlayback(): Promise<void>
  setHotkeys(config: unknown): Promise<void>
  captureKeys?(enabled: boolean): Promise<void>
  updateDictationState?(state: unknown): Promise<void>
  requestHotkeyAccess?(): Promise<boolean>
  setLaunchAtLogin?(enabled: boolean): Promise<void>
  engineCall(method: string, params: unknown): Promise<unknown>
  addListener(name: string): void
  removeListeners(count: number): void
}
export const host = NativeModules.FlusstextHost as NativeHost
export function listenHost(listener: (event: HostEvent) => void): () => void {
  if (!host) throw new Error('Der native Flusstext-Dienst ist nicht installiert. Bitte die App neu bauen.')
  const subscription = new NativeEventEmitter(host).addListener('FlusstextHostEvent', listener)
  return () => subscription.remove()
}

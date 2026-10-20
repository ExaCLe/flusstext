import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import type { Settings } from '@shared/types'
import { paths } from './paths'

const defaults: Settings = {
  onboardingDone: false,
  theme: 'light',
  language: 'de',
  transcriptionModel: null,
  dictationModel: null,
  threads: Math.max(2, Math.min(8, Math.floor(cpus().length / 2))),
  useGpu: true,
  micDeviceId: 'default',
  launchAtLogin: false,
  diarization: {
    enabled: true,
    numSpeakers: 0,
    thresholdOffset: 0,
    segmentationModel: 'seg-pyannote-3',
    embeddingModel: 'emb-eres2net-voxceleb'
  },
  dictation: {
    enabled: true,
    hotkey: [29, 3675], // Strg + Win
    pasteLastHotkey: [56, 42, 44], // Alt + Umschalt + Z
    mode: 'hybrid',
    autoPaste: true,
    restoreClipboard: true,
    sounds: true,
    trailingSpace: true,
    idlePill: true
  },
  replacements: []
}

class SettingsStore extends EventEmitter {
  private value: Settings

  constructor() {
    super()
    let stored: Partial<Settings> = {}
    try {
      stored = JSON.parse(readFileSync(paths.settings, 'utf8'))
    } catch {
      // erste Ausführung
    }
    this.value = merge(defaults, stored)
  }

  get(): Settings {
    return this.value
  }

  set(patch: DeepPartial<Settings>): Settings {
    const prev = this.value
    this.value = merge(this.value, patch)
    writeFileSync(paths.settings, JSON.stringify(this.value, null, 2))
    this.emit('change', this.value, prev)
    return this.value
  }
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] }

function merge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return (patch ?? base) as T
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch)) {
    const b = out[k]
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v) ? merge(b, v) : v
  }
  return out as T
}

export const settings = new SettingsStore()

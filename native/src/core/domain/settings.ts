// Standardwerte, Zusammenführen und Prüfen der Einstellungen (entspricht src/main/settings.ts).
import type { Settings } from '../../../../src/shared/types'
import { isPhone, type Platform } from './catalog'

export function defaultSettings(platform: Platform, cpuThreads: number): Settings {
  const cpus = Math.max(1, Math.floor(cpuThreads || 1))
  const phone = isPhone(platform)
  return {
    onboardingDone: false,
    theme: 'light',
    language: 'de',
    transcriptionModel: null,
    dictationModel: null,
    // Telefone: höchstens 4 Threads, damit Gerät und Akku nicht überlastet werden
    threads: phone ? Math.max(1, Math.min(4, Math.floor(cpus / 2))) : Math.max(2, Math.min(8, Math.floor(cpus / 2))),
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
      hotkey: [29, 3675], // Strg + Cmd/Win
      pasteLastHotkey: [56, 42, 44], // Alt + Umschalt + Z
      mode: 'hybrid',
      // Telefone können nicht in andere Apps einfügen: dort heißt es „in die Zwischenablage kopieren“
      autoPaste: !phone,
      restoreClipboard: true,
      sounds: true,
      trailingSpace: true,
      idlePill: !phone
    },
    replacements: []
  }
}

export function merge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return (patch ?? base) as T
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    const b = out[k]
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v) ? merge(b, v) : v
  }
  return out as T
}

const keys = (v: unknown, fallback: number[]): number[] =>
  Array.isArray(v) && v.length <= 6 && v.every((k) => Number.isInteger(k) && k >= 0) ? (v as number[]) : fallback

/** Gespeicherte oder übergebene Werte auf gültige Typen und Bereiche bringen. */
export function sanitizeSettings(value: Settings, defaults: Settings, cpuThreads: number): Settings {
  const s = merge(defaults, value)
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
  const str = (v: unknown, d: string): string => (typeof v === 'string' && v.length < 200 ? v : d)
  const id = (v: unknown): string | null => (typeof v === 'string' && v.length < 200 ? v : null)
  const num = (v: unknown, d: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
  const theme = s.theme === 'dark' || s.theme === 'system' || s.theme === 'light' ? s.theme : defaults.theme
  const mode = s.dictation.mode === 'hold' || s.dictation.mode === 'toggle' || s.dictation.mode === 'hybrid' ? s.dictation.mode : defaults.dictation.mode
  return {
    onboardingDone: bool(s.onboardingDone, false),
    theme,
    language: str(s.language, defaults.language),
    transcriptionModel: id(s.transcriptionModel),
    dictationModel: id(s.dictationModel),
    threads: Math.round(num(s.threads, defaults.threads, 1, Math.max(1, cpuThreads || 1))),
    useGpu: bool(s.useGpu, defaults.useGpu),
    micDeviceId: str(s.micDeviceId, 'default'),
    launchAtLogin: bool(s.launchAtLogin, false),
    diarization: {
      enabled: bool(s.diarization.enabled, defaults.diarization.enabled),
      numSpeakers: Math.round(num(s.diarization.numSpeakers, 0, 0, 20)),
      thresholdOffset: num(s.diarization.thresholdOffset, 0, -0.5, 0.5),
      segmentationModel: str(s.diarization.segmentationModel, defaults.diarization.segmentationModel),
      embeddingModel: str(s.diarization.embeddingModel, defaults.diarization.embeddingModel)
    },
    dictation: {
      enabled: bool(s.dictation.enabled, defaults.dictation.enabled),
      hotkey: keys(s.dictation.hotkey, defaults.dictation.hotkey),
      pasteLastHotkey: keys(s.dictation.pasteLastHotkey, defaults.dictation.pasteLastHotkey),
      mode,
      autoPaste: bool(s.dictation.autoPaste, defaults.dictation.autoPaste),
      restoreClipboard: bool(s.dictation.restoreClipboard, defaults.dictation.restoreClipboard),
      sounds: bool(s.dictation.sounds, defaults.dictation.sounds),
      trailingSpace: bool(s.dictation.trailingSpace, defaults.dictation.trailingSpace),
      idlePill: bool(s.dictation.idlePill, defaults.dictation.idlePill)
    },
    replacements: Array.isArray(s.replacements)
      ? s.replacements
          .filter((r) => r && typeof r.from === 'string' && typeof r.to === 'string')
          .slice(0, 2000)
          .map((r) => ({ from: r.from.slice(0, 200), to: r.to.slice(0, 500) }))
      : []
  }
}

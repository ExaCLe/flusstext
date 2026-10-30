// Dauerhafte Einstellungen (JSON im App-Datenordner).
import type { Settings } from '../../../src/shared/types'
import type { Bus } from './bus'
import type { Platform } from './domain/catalog'
import { defaultSettings, merge, sanitizeSettings } from './domain/settings'
import { readJson, serialized, writeAtomic, type AppPaths } from './fs'

type ChangeListener = (next: Settings, prev: Settings) => void

export class SettingsStore {
  private value: Settings
  private defaults: Settings
  private listeners = new Set<ChangeListener>()

  private constructor(private paths: AppPaths, private bus: Bus, private cpuThreads: number, platform: Platform, stored: unknown) {
    this.defaults = defaultSettings(platform, cpuThreads)
    this.value = sanitizeSettings(merge(this.defaults, stored ?? {}), this.defaults, cpuThreads)
  }

  static async load(paths: AppPaths, bus: Bus, platform: Platform, cpuThreads: number): Promise<SettingsStore> {
    return new SettingsStore(paths, bus, cpuThreads, platform, await readJson<unknown>(paths.settings))
  }

  get(): Settings {
    return this.value
  }

  onChange(fn: ChangeListener): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /** Änderungen nacheinander anwenden, damit gleichzeitige Aufrufe sich nicht überschreiben. */
  set(patch: unknown): Promise<Settings> {
    return serialized('settings:set', () => this.apply(patch))
  }

  private async apply(patch: unknown): Promise<Settings> {
    if (patch !== undefined && (typeof patch !== 'object' || patch === null || Array.isArray(patch))) throw new Error('Ungültige Einstellungen.')
    const prev = this.value
    const next = sanitizeSettings(merge(prev, patch ?? {}), this.defaults, this.cpuThreads)
    await writeAtomic(this.paths.settings, JSON.stringify(next, null, 2))
    this.value = next
    this.bus.emit({ type: 'settings', value: next })
    for (const l of [...this.listeners]) {
      try {
        l(next, prev)
      } catch (e) {
        this.bus.error(e)
      }
    }
    return next
  }
}

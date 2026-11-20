import { normalizeKey } from '../shared/keys'
import type { KeyEvent } from './windows-keyboard'

export class PressedKeys {
  private physical = new Map<string, KeyEvent>()
  private missing = new Set<string>()

  private codes(): Set<number> {
    return new Set(Array.from(this.physical.values(), (key) => normalizeKey(key.code)))
  }

  get size(): number {
    return this.physical.size
  }

  update(event: KeyEvent): number | null {
    const previous = this.physical.get(event.id)
    if (event.down ? previous : !previous) return null
    const code = normalizeKey((previous ?? event).code)
    if (event.down) {
      const alreadyDown = this.codes().has(code)
      this.physical.set(event.id, event)
      return alreadyDown ? null : code
    }
    this.physical.delete(event.id)
    this.missing.delete(event.id)
    return this.codes().has(code) ? null : code
  }

  matches(keys: number[], trigger: KeyEvent, isDown: (virtualKey: number) => boolean): boolean {
    const expected = new Set(keys.map(normalizeKey))
    const down = this.codes()
    if (expected.size === 0 || down.size !== expected.size) return false
    // The current raw press is genuine. Check the other keys against live Windows state
    // so a missed release cannot complete a shortcut on a later, unrelated press.
    const live = new Set(Array.from(this.physical.values())
      .filter((key) => key.id === trigger.id || isDown(key.virtualKey))
      .map((key) => normalizeKey(key.code)))
    return [...expected].every((key) => live.has(key))
  }

  prune(isDown: (virtualKey: number) => boolean): number[] {
    const before = this.codes()
    for (const [id, key] of this.physical) {
      // Give a queued key-up message time to arrive before treating it as lost.
      if (isDown(key.virtualKey)) this.missing.delete(id)
      else if (this.missing.has(id)) {
        this.physical.delete(id)
        this.missing.delete(id)
      } else this.missing.add(id)
    }
    const after = this.codes()
    return [...before].filter((key) => !after.has(key))
  }

  clear(): void {
    this.physical.clear()
    this.missing.clear()
  }
}

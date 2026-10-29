// Ereignisse an die Oberfläche verteilen.
import type { AppEvent } from './contracts'

type Listener = (event: AppEvent) => void

export class Bus {
  private listeners = new Set<Listener>()

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  emit(event: AppEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(event)
      } catch {
        // ein fehlerhafter Zuhörer darf die anderen nicht blockieren
      }
    }
  }

  error(e: unknown, fallback = 'Unbekannter Fehler'): void {
    this.emit({ type: 'error', message: errorMessage(e, fallback) })
  }
}

export function errorMessage(e: unknown, fallback = 'Unbekannter Fehler'): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  const clean = msg.replace(/^Error:\s*/i, '').trim()
  if (!clean) return fallback
  return clean.length > 300 ? clean.slice(0, 300) + '…' : clean
}

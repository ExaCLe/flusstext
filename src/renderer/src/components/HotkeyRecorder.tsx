import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MODIFIER_KEYS, keyLabel, sortKeys } from '@shared/keys'
import { Button, Hotkey, Kbd, cn } from './ui'

const ESC = 1

/** Nimmt eine globale Tastenkombination auf (inkl. Win-Taste), gespeichert beim Loslassen. */
export function HotkeyRecorder({ value, onChange, allowSingle = true }: { value: number[]; onChange: (keys: number[]) => void; allowSingle?: boolean }): ReactNode {
  const [recording, setRecording] = useState(false)
  const [combo, setCombo] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const down = useRef(new Set<number>())
  const max = useRef<number[]>([])

  useEffect(() => {
    if (!recording) return
    down.current.clear()
    max.current = []
    void window.api.dictation.captureKeys(true)
    const off = window.api.dictation.onKey((e) => {
      if (e.type === 'down') {
        if (e.keycode === ESC && down.current.size === 0) {
          setRecording(false)
          return
        }
        down.current.add(e.keycode)
        if (down.current.size >= max.current.length) max.current = [...down.current]
        setCombo([...down.current])
      } else {
        down.current.delete(e.keycode)
        if (down.current.size === 0 && max.current.length) {
          const keys = sortKeys(max.current)
          const onlyLetters = keys.length === 1 && !MODIFIER_KEYS.has(keys[0]) && !/^F\d+$/.test(keyLabel(keys[0]))
          if (keys.length > 3) setError('Höchstens drei Tasten')
          else if (!allowSingle && keys.length === 1) setError('Bitte eine Kombination wählen')
          else if (onlyLetters) setError('Einzelne Buchstaben würden beim Tippen auslösen')
          else {
            setError(null)
            onChange(keys)
          }
          setRecording(false)
        }
      }
    })
    return () => {
      off()
      void window.api.dictation.captureKeys(false)
    }
  }, [recording, onChange, allowSingle])

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'flex h-8 min-w-36 items-center justify-center rounded-lg border px-2 transition-colors',
            recording ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
          )}
        >
          {recording ? (
            combo.length ? (
              <span className="inline-flex gap-1">
                {sortKeys(combo).map((k) => (
                  <Kbd key={k}>{keyLabel(k, window.api.platform)}</Kbd>
                ))}
              </span>
            ) : (
              <span className="animate-pulse text-[12.5px] text-accent-text">Tasten drücken …</span>
            )
          ) : (
            <Hotkey keys={value} />
          )}
        </div>
        <Button
          size="sm"
          variant={recording ? 'ghost' : 'secondary'}
          onClick={() => {
            setCombo([])
            setError(null)
            setRecording(!recording)
          }}
        >
          {recording ? 'Abbrechen' : 'Ändern'}
        </Button>
      </div>
      {error && <span className="text-[11.5px] text-danger">{error}</span>}
    </div>
  )
}

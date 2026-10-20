// Schwebende Diktat-Pille (eigenes, transparentes Fenster ohne Fokus).
// Eine Form, die je nach Zustand wächst und schrumpft: Ruhe → Zuhören → Transkribieren → Eingefügt.
import { createRoot } from 'react-dom/client'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ClipboardCheck, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { OverlayState } from '@shared/types'
import './styles.css'
import { startRecorder, type Recorder } from './lib/recorder'
import { sounds } from './lib/sounds'

const BARS = 18
const ACCENT = '#8b9bff'

function useTimer(startedAt: number | null): string {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!startedAt) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [startedAt])
  if (!startedAt) return '0:00'
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Wave({ levels }: { levels: number[] }): ReactNode {
  return (
    <div className="flex h-7 items-center gap-[3px]" aria-hidden>
      {levels.map((l, i) => (
        <span
          key={i}
          className="w-[3px] rounded-[2px] bg-[#f4f4f5] transition-[height] duration-[90ms] ease-linear"
          style={{ height: `${Math.max(4, Math.min(28, 4 + l * 24))}px` }}
        />
      ))}
    </div>
  )
}

function RoundButton({
  label,
  onClick,
  className,
  style,
  children
}: {
  label: string
  onClick: () => void
  className: string
  style?: React.CSSProperties
  children: ReactNode
}): ReactNode {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      style={style}
      className={`flex size-10 shrink-0 items-center justify-center rounded-full transition-[transform,filter,background] duration-150 hover:scale-105 active:scale-95 ${className}`}
    >
      {children}
    </button>
  )
}

/** Ungefähre Textbreite (Geist 14 px, medium) – für die Größenanimation der Pille. */
const textWidth = (s: string): number => s.length * 7.4

function Pill(): ReactNode {
  const [state, setState] = useState<OverlayState>({ kind: 'hidden' })
  const [levels, setLevels] = useState<number[]>(Array(BARS).fill(0))
  const [hover, setHover] = useState(false)
  const rec = useRef<Recorder | null>(null)
  const soundsOn = useRef(true)
  const smoothed = useRef(0)
  const phase = useRef(0)

  useEffect(() => {
    const offState = window.api.overlay.onState((s) => {
      setState(s)
      if (s.kind === 'error' && soundsOn.current) sounds.error()
    })
    const offCmd = window.api.overlay.onCommand(async (cmd) => {
      if (cmd.type === 'start') {
        soundsOn.current = cmd.sounds !== false
        rec.current?.close()
        setLevels(Array(BARS).fill(0))
        try {
          rec.current = await startRecorder({
            deviceId: cmd.deviceId,
            onLevel: (l) => {
              // Glätten und als Welle über die Balken verteilen (Mitte höher)
              smoothed.current = smoothed.current * 0.5 + l * 0.5
              phase.current += 0.55
              const base = smoothed.current
              setLevels(
                Array.from({ length: BARS }, (_, i) => {
                  const center = 1 - Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2)
                  const wobble = 0.55 + 0.45 * Math.abs(Math.sin(phase.current + i * 1.3))
                  return base * (0.3 + 0.7 * center) * wobble
                })
              )
            }
          })
          if (soundsOn.current) sounds.start()
          window.api.overlay.micReady()
        } catch (e) {
          window.api.overlay.micError((e as Error).name === 'NotAllowedError' ? 'Kein Mikrofonzugriff' : 'Mikrofon nicht verfügbar')
        }
      } else if (cmd.type === 'stop') {
        const samples = rec.current?.stop() ?? new Float32Array(0)
        rec.current = null
        if (soundsOn.current) sounds.stop()
        window.api.overlay.audio(samples)
      } else {
        rec.current?.close()
        rec.current = null
      }
    })
    window.api.overlay.hello()
    return () => {
      offState()
      offCmd()
    }
  }, [])

  const timer = useTimer(state.kind === 'listening' ? state.startedAt : null)
  const visible = state.kind !== 'hidden'
  const idle = state.kind === 'idle'

  let width = 268
  let height = 52
  let content: ReactNode = null
  switch (state.kind) {
    case 'idle':
      width = hover ? 84 : 64
      height = 14
      content = (
        <div className="flex items-center gap-[3px]">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-[3px] rounded-full bg-[#8b8f97]" />
          ))}
        </div>
      )
      break
    case 'arming':
    case 'listening':
      content = (
        <div className="flex w-full items-center gap-3 px-1.5">
          <RoundButton label="Abbrechen (Esc)" onClick={() => window.api.overlay.cancel()} className="bg-[#222327] text-[#c9cbcf] hover:bg-[#2a2c31]">
            <X className="size-3.5" strokeWidth={2.4} />
          </RoundButton>
          <Wave levels={state.kind === 'arming' ? Array(BARS).fill(0) : levels} />
          <span className="min-w-[34px] font-mono text-[12px] text-[#a1a4ab] tabular">{timer}</span>
          <RoundButton label="Fertig – einfügen" onClick={() => window.api.overlay.stop()} className="hover:brightness-110" style={{ background: ACCENT }}>
            <span className="size-3 rounded-[3px] bg-[#0c0c0d]" />
          </RoundButton>
        </div>
      )
      break
    case 'processing': {
      const label = state.loadingModel ? 'Modell wird geladen' : 'Transkribiere'
      width = 20 + 26 + 12 + textWidth(label) + 20
      content = (
        <div role="status" className="flex items-center gap-3">
          <span className="flex gap-1" aria-hidden>
            {[0, 0.15, 0.3].map((d) => (
              <span key={d} className="dot-bounce size-1.5 rounded-full" style={{ background: ACCENT, animationDelay: `${d}s` }} />
            ))}
          </span>
          <span className="text-[14px] font-medium text-[#ecedee]">{label}</span>
        </div>
      )
      break
    }
    case 'done': {
      const words = state.text.split(/\s+/).filter(Boolean).length
      const label = state.pasted ? 'Eingefügt' : 'Kopiert'
      const count = words === 1 ? '1 Wort' : `${words} Wörter`
      width = 8 + 36 + 10 + textWidth(label) + 10 + count.length * 6.8 + 22
      content = (
        <div role="status" className="flex w-full items-center gap-2.5 pr-5 pl-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#1e3b2c] text-[#5be49b]">
            {state.pasted ? <Check className="size-4" strokeWidth={2.6} /> : <ClipboardCheck className="size-4" />}
          </span>
          <span className="text-[14px] font-medium text-[#ecedee]">{label}</span>
          <span className="text-[13px] text-[#a1a4ab]">{count}</span>
        </div>
      )
      break
    }
    case 'error':
      width = Math.min(340, 8 + 36 + 10 + state.message.length * 7 + 22)
      content = (
        <div role="alert" className="flex w-full items-center gap-2.5 pr-5 pl-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#3b1d1b] text-[15px] font-bold text-[#f97066]">!</span>
          <span className="truncate text-[13.5px] font-medium text-[#ecedee]">{state.message}</span>
        </div>
      )
      break
  }

  return (
    <div className="flex h-screen flex-col items-center justify-end pb-3">
      <AnimatePresence>
        {idle && hover && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 2 }}
            transition={{ duration: 0.15 }}
            className="mb-2 rounded-lg bg-[#0c0c0d] px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-[#ecedee] shadow-[0_0_0_1px_#33353b,0_8px_20px_-8px_rgba(0,0,0,0.7)]"
          >
            {state.hint}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Größere Trefferfläche um die schmale Ruhe-Pille */}
      <div
        className="flex h-[56px] items-end justify-center"
        style={{ minWidth: idle ? 120 : undefined }}
        onMouseEnter={() => {
          setHover(true)
          window.api.overlay.setInteractive(true)
        }}
        onMouseLeave={() => {
          setHover(false)
          window.api.overlay.setInteractive(false)
        }}
        onClick={() => idle && window.api.overlay.start()}
      >
        <AnimatePresence>
          {visible && (
            <motion.div
              key="pill"
              initial={{ opacity: 0, scale: 0.6, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0, width, height }}
              exit={{ opacity: 0, scale: 0.8, y: 4, transition: { duration: 0.18 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.8 }}
              className={`flex items-center justify-center overflow-hidden rounded-full ${
                idle
                  ? `cursor-pointer ${hover ? 'bg-[#2a2c31]' : 'bg-[#222327]'} shadow-[0_0_0_1px_#3a3c42,0_8px_20px_-6px_rgba(0,0,0,0.6)]`
                  : 'bg-[#0c0c0d] shadow-[0_0_0_1px_#33353b,0_18px_40px_-12px_rgba(0,0,0,0.8)]'
              }`}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={state.kind === 'arming' ? 'listening' : state.kind}
                  initial={{ opacity: 0, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, filter: 'blur(4px)' }}
                  transition={{ duration: 0.14 }}
                  className="flex w-full items-center justify-center whitespace-nowrap"
                >
                  {content}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Pill />)

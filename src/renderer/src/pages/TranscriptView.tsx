import { AnimatePresence, motion } from 'motion/react'
import { ArrowDownToLine, Check, ChevronDown, CircleAlert, Copy, FolderOpen, Pause, Play, Plus, Trash2, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LANGUAGES, type Bookmark, type ExportFormat, type Segment, type Speaker, type Transcript } from '@shared/types'
import { Avatar, Badge, Button, Card, IconButton, Modal, Progress, Select, Spinner, Switch, cn, speakerColor } from '../components/ui'
import { clock, dateLine, longDuration, stamp } from '../lib/format'
import { highlight } from '../lib/highlight'
import { useApp } from '../lib/store'

// ------------------------------------------------------------ Hilfsfunktionen

interface Block {
  key: string
  speaker?: number
  start: number
  end: number
  segments: Segment[]
}

function toBlocks(segments: Segment[]): Block[] {
  const out: Block[] = []
  for (const s of segments) {
    const last = out[out.length - 1]
    if (last && last.speaker === s.speaker && s.start - last.end < 8) {
      last.segments.push(s)
      last.end = s.end
    } else out.push({ key: s.id, speaker: s.speaker, start: s.start, end: s.end, segments: [s] })
  }
  return out
}

function speakerName(speakers: Speaker[], id?: number): string {
  if (id === undefined) return ''
  return speakers.find((s) => s.id === id)?.name ?? `Sprecher ${id + 1}`
}

/** Startzeit jedes Wortes – aus der Erkennung oder gleichmäßig nach Zeichen verteilt. */
function wordTimes(s: Segment, words: string[]): number[] {
  if (s.words && s.words.length === words.length) return s.words
  const total = words.reduce((n, w) => n + w.length + 1, 0) || 1
  let acc = 0
  return words.map((w) => {
    const t = s.start + (acc / total) * (s.end - s.start)
    acc += w.length + 1
    return t
  })
}

function useClickOutside(open: boolean, close: () => void): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open, close])
  return ref
}

function speakerStats(t: Transcript): { id: number; sec: number; share: number }[] {
  const m = new Map<number, number>()
  for (const s of t.segments) if (s.speaker !== undefined) m.set(s.speaker, (m.get(s.speaker) ?? 0) + (s.end - s.start))
  const total = [...m.values()].reduce((a, b) => a + b, 0) || 1
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([id, sec]) => ({ id, sec, share: sec / total }))
}

// ------------------------------------------------------------ Export

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'docx', label: 'Word (.docx)', hint: 'Formatiert mit Sprechern' },
  { id: 'txt', label: 'Text (.txt)', hint: 'Reiner Text' },
  { id: 'md', label: 'Markdown (.md)', hint: 'Für Notizen-Apps' },
  { id: 'srt', label: 'Untertitel (.srt)', hint: 'Für Videoplayer' },
  { id: 'vtt', label: 'WebVTT (.vtt)', hint: 'Untertitel fürs Web' },
  { id: 'json', label: 'JSON', hint: 'Mit allen Zeitstempeln' }
]

function ExportMenu({ t }: { t: Transcript }): ReactNode {
  const [open, setOpen] = useState(false)
  const [speakers, setSpeakers] = useState(true)
  const [timestamps, setTimestamps] = useState(true)
  const toast = useApp((s) => s.toast)
  const ref = useClickOutside(open, useCallback(() => setOpen(false), []))
  const run = async (f: ExportFormat): Promise<void> => {
    setOpen(false)
    const path = await window.api.transcripts.exportTo(t.id, f, { speakers, timestamps })
    if (path) toast('Exportiert', 'success')
  }
  return (
    <div className="relative" ref={ref}>
      <Button size="lg" icon={<ArrowDownToLine />} onClick={() => setOpen(!open)}>
        Exportieren <ChevronDown className="-mr-1 size-3.5 text-muted" />
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 z-50 mt-1.5 w-64 origin-top-right rounded-xl border border-line bg-panel p-1 shadow-[0_16px_40px_-12px_rgba(20,21,23,0.3)]"
          >
            {FORMATS.map((f) => (
              <button key={f.id} onClick={() => run(f.id)} className="flex w-full flex-col rounded-lg px-3 py-1.5 text-left hover:bg-surface-2">
                <span className="text-[13px] font-medium">{f.label}</span>
                <span className="text-[11.5px] text-muted">{f.hint}</span>
              </button>
            ))}
            <div className="my-1 h-px bg-line" />
            <label className="flex items-center justify-between px-3 py-1.5 text-[12.5px]">
              Sprecher einfügen <Switch checked={speakers} onChange={setSpeakers} />
            </label>
            <label className="flex items-center justify-between px-3 py-1.5 text-[12.5px]">
              Zeitstempel einfügen <Switch checked={timestamps} onChange={setTimestamps} />
            </label>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ------------------------------------------------------------ Player

function Waveform({ t, peaks, time, dur, onSeek }: { t: Transcript; peaks: number[] | null; time: number; dur: number; onSeek: (sec: number) => void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(120)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setCount(Math.max(40, Math.floor(el.clientWidth / 5))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const bars = useMemo(() => {
    const hasSpeakers = t.segments.some((s) => s.speaker !== undefined)
    let seg = 0
    return Array.from({ length: count }, (_, i) => {
      let v = 0
      if (peaks?.length) {
        const a = Math.floor((i / count) * peaks.length)
        const b = Math.max(a + 1, Math.floor(((i + 1) / count) * peaks.length))
        for (let j = a; j < b; j++) v = Math.max(v, peaks[j])
      }
      const mid = ((i + 0.5) / count) * dur
      while (seg < t.segments.length - 1 && t.segments[seg].end < mid) seg++
      const s = t.segments[seg]
      const inSpeech = s && mid >= s.start - 0.3 && mid <= s.end + 0.3
      const color = !inSpeech ? 'var(--line-strong)' : hasSpeakers ? speakerColor(s.speaker) : 'var(--fg)'
      return { h: peaks ? Math.max(4, Math.round(4 + Math.pow(v, 0.75) * 34)) : 4, color, at: mid }
    })
  }, [peaks, count, t.segments, dur])

  const seekFromEvent = (e: React.PointerEvent): void => {
    const r = ref.current!.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur)))
  }

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        seekFromEvent(e)
      }}
      onPointerMove={(e) => e.buttons === 1 && seekFromEvent(e)}
      className="relative flex h-10 cursor-pointer items-center gap-[2px] overflow-hidden"
    >
      {bars.map((b, i) => (
        <span
          key={i}
          className="min-w-[2px] flex-1 rounded-[2px] transition-[height] duration-300"
          style={{ height: b.h, background: b.color, opacity: b.at <= time ? 1 : 0.28 }}
        />
      ))}
    </div>
  )
}

function SpeakerStrip({ t, dur, bookmarks }: { t: Transcript; dur: number; bookmarks: Bookmark[] }): ReactNode {
  return (
    <div className="relative h-1.5 overflow-hidden rounded-[3px] bg-surface-2">
      {t.segments.map((s) => (
        <span
          key={s.id}
          className="absolute inset-y-0"
          style={{
            left: `${(s.start / dur) * 100}%`,
            width: `${Math.max(0.2, ((s.end - s.start) / dur) * 100)}%`,
            background: s.speaker === undefined ? 'var(--line-strong)' : speakerColor(s.speaker)
          }}
        />
      ))}
      {bookmarks.map((b, i) => (
        <span key={i} title={b.label} className="absolute inset-y-0 w-[3px] -translate-x-1/2 bg-fg" style={{ left: `${(b.time / dur) * 100}%` }} />
      ))}
    </div>
  )
}

const RATES = [1, 1.25, 1.5, 2, 0.75]

function Player({
  audio,
  t,
  peaks,
  playing,
  time
}: {
  audio: HTMLAudioElement | null
  t: Transcript
  peaks: number[] | null
  playing: boolean
  time: number
}): ReactNode {
  const [rate, setRate] = useState(1)
  const dur = t.duration || audio?.duration || 1
  return (
    <div className="flex items-center gap-4 rounded-[14px] border border-line bg-panel px-4 py-3.5 shadow-[var(--card-shadow)]">
      <button
        onClick={() => (audio ? (audio.paused ? void audio.play() : audio.pause()) : undefined)}
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-ink-fg transition-transform hover:scale-[1.04] active:scale-95"
        aria-label={playing ? 'Pause' : 'Abspielen'}
      >
        {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
      </button>
      <span className="w-[52px] shrink-0 font-mono text-[12px] tabular">{stamp(time, dur >= 3600)}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Waveform t={t} peaks={peaks} time={time} dur={dur} onSeek={(sec) => audio && (audio.currentTime = sec)} />
        <SpeakerStrip t={t} dur={dur} bookmarks={t.bookmarks ?? []} />
      </div>
      <span className="w-[52px] shrink-0 text-right font-mono text-[12px] text-muted tabular">{stamp(dur, dur >= 3600)}</span>
      <button
        onClick={() => {
          const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]
          setRate(next)
          if (audio) audio.playbackRate = next
        }}
        className="h-8 w-14 shrink-0 rounded-lg border border-line bg-bg font-mono text-[12px] tabular transition-colors hover:border-line-strong"
        title="Wiedergabegeschwindigkeit"
      >
        {String(rate).replace('.', ',')}×
      </button>
    </div>
  )
}

// ------------------------------------------------------------ Transkript-Blöcke

function SpeakerMenu({
  speakers,
  current,
  onPick,
  onClose
}: {
  speakers: Speaker[]
  current?: number
  onPick: (id: number | 'new') => void
  onClose: () => void
}): ReactNode {
  const ref = useClickOutside(true, onClose)
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.12 }}
      className="absolute top-7 left-0 z-30 w-56 origin-top-left rounded-xl border border-line bg-panel p-1 shadow-[0_16px_40px_-12px_rgba(20,21,23,0.3)]"
    >
      <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">Absatz zuordnen</div>
      {speakers.map((s) => (
        <button key={s.id} onClick={() => onPick(s.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2">
          <Avatar name={s.name} speaker={s.id} size={20} />
          <span className="flex-1 truncate">{s.name}</span>
          {s.id === current && <Check className="size-3.5" />}
        </button>
      ))}
      <button onClick={() => onPick('new')} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-fg-2 hover:bg-surface-2">
        <span className="flex size-5 items-center justify-center rounded-full border border-dashed border-line-strong">
          <Plus className="size-3" />
        </span>
        Neuer Sprecher
      </button>
    </motion.div>
  )
}

interface BlockProps {
  block: Block
  speakers: Speaker[]
  /** Wiedergabeposition, falls dieser Block gerade läuft – sonst -1 */
  time: number
  playing: boolean
  query: string
  longStamps: boolean
  editingId: string | null
  onSeek: (sec: number) => void
  onEdit: (id: string | null) => void
  onSaveText: (id: string, text: string) => void
  onAssign: (block: Block, speaker: number | 'new') => void
}

const TranscriptBlock = memo(function TranscriptBlock({
  block,
  speakers,
  time,
  playing,
  query,
  longStamps,
  editingId,
  onSeek,
  onEdit,
  onSaveText,
  onAssign
}: BlockProps): ReactNode {
  const [menu, setMenu] = useState(false)
  const active = time >= 0
  const name = speakerName(speakers, block.speaker)
  const color = speakerColor(block.speaker)

  const renderSegment = (s: Segment): ReactNode => {
    if (editingId === s.id || query || !active) return highlight(s.text, query)
    if (time >= s.end) return s.text
    if (time < s.start) return <span className="text-muted">{s.text}</span>
    // Laufender Satz: Wort für Wort hervorheben
    const words = s.text.split(/\s+/).filter(Boolean)
    const times = wordTimes(s, words)
    let cur = 0
    for (let i = 0; i < times.length; i++) if (times[i] <= time) cur = i
    return words.map((w, i) => (
      <span key={i}>
        <span
          data-t={times[i]}
          className={cn(
            'rounded-[4px] transition-colors duration-150',
            i === cur ? '-mx-[3px] bg-accent px-[3px] text-accent-fg' : i > cur && 'text-muted'
          )}
        >
          {w}
        </span>
        {i < words.length - 1 ? ' ' : ''}
      </span>
    ))
  }

  return (
    <div
      id={`block-${block.key}`}
      className={cn(
        'flex gap-3.5 rounded-xl px-3 py-3.5 transition-[background,box-shadow] duration-300',
        active && 'bg-panel shadow-[var(--lift-shadow)]'
      )}
    >
      {block.speaker !== undefined ? <Avatar name={name} speaker={block.speaker} size={32} /> : <span className="w-0" />}
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="relative flex items-baseline gap-2.5">
          {block.speaker !== undefined && (
            <button onClick={() => setMenu(!menu)} className="font-semibold hover:underline" style={{ color }} title="Sprecher ändern">
              {name}
            </button>
          )}
          <button onClick={() => onSeek(block.start)} className="font-mono text-[12px] text-muted tabular hover:text-fg">
            {stamp(block.start, longStamps)}
          </button>
          {active && playing && (
            <span className="inline-flex items-center gap-[5px] text-[12px] font-medium text-accent-text">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-accent" />
              Wiedergabe
            </span>
          )}
          {menu && (
            <SpeakerMenu
              speakers={speakers}
              current={block.speaker}
              onClose={() => setMenu(false)}
              onPick={(id) => {
                setMenu(false)
                onAssign(block, id)
              }}
            />
          )}
        </div>
        <p className="selectable m-0 text-[15px] leading-[1.6]">
          {block.segments.map((s) => (
            <span
              key={s.id}
              id={`seg-${s.id}`}
              onClick={(e) => {
                if (e.detail !== 1 || window.getSelection()?.toString() || editingId === s.id) return
                const at = (e.target as HTMLElement).dataset.t
                onSeek(at ? Number(at) : s.start)
              }}
              onDoubleClick={(e) => {
                onEdit(s.id)
                const el = e.currentTarget
                requestAnimationFrame(() => {
                  el.contentEditable = 'plaintext-only'
                  el.focus()
                })
              }}
              onBlur={(e) => {
                const el = e.currentTarget
                el.contentEditable = 'false'
                const text = el.innerText.trim()
                onEdit(null)
                if (text && text !== s.text) onSaveText(s.id, text)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  e.currentTarget.innerText = s.text
                  e.currentTarget.blur()
                }
              }}
              className="cursor-text rounded-[4px] outline-none hover:bg-surface-2/70 focus:bg-accent-soft"
            >
              {renderSegment(s)}{' '}
            </span>
          ))}
        </p>
      </div>
    </div>
  )
})

// ------------------------------------------------------------ Seitenleiste

function RailCard({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <Card className="flex flex-col gap-3 p-[18px]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </Card>
  )
}

function NotesCard({ t, onSave }: { t: Transcript; onSave: (notes: string) => void }): ReactNode {
  const [value, setValue] = useState(t.notes ?? '')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => setValue(t.notes ?? ''), [t.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const change = (v: string): void => {
    setValue(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onSave(v), 600)
  }
  return (
    <RailCard title="Notizen" aside={<span className="text-[12px] text-muted">Wird gespeichert</span>}>
      <textarea
        value={value}
        onChange={(e) => change(e.target.value)}
        onBlur={() => {
          clearTimeout(timer.current)
          if (value !== (t.notes ?? '')) onSave(value)
        }}
        placeholder="Eigene Notizen, Aufgaben, Zusammenfassung …"
        className="selectable min-h-[92px] resize-y rounded-[10px] border border-line bg-bg p-3 text-[13px] leading-relaxed outline-none placeholder:text-muted focus:border-line-strong"
      />
    </RailCard>
  )
}

function MomentsCard({ t, time, onSeek, onSave }: { t: Transcript; time: number; onSeek: (sec: number) => void; onSave: (b: Bookmark[]) => void }): ReactNode {
  const list = t.bookmarks ?? []
  return (
    <RailCard
      title="Momente"
      aside={
        t.audioPath || t.originalPath ? (
          <button
            className="inline-flex items-center gap-1 text-[12px] font-medium text-fg-2 hover:text-fg"
            onClick={() => onSave([...list, { time, label: `Lesezeichen ${list.length + 1}` }].sort((a, b) => a.time - b.time))}
          >
            <Plus className="size-3.5" /> Hier markieren
          </button>
        ) : undefined
      }
    >
      {list.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-muted">Noch keine Lesezeichen. Markiere wichtige Stellen beim Anhören.</p>
      ) : (
        <div className="-mx-1 flex flex-col gap-0.5">
          {list.map((b, i) => (
            <div key={`${b.time}-${i}`} className="group flex items-center gap-2 rounded-lg px-1 text-[13px]">
              <button onClick={() => onSeek(b.time)} className="w-10 shrink-0 text-left font-mono text-[12px] text-muted tabular hover:text-fg">
                {clock(b.time)}
              </button>
              <input
                defaultValue={b.label}
                onBlur={(e) => e.target.value.trim() !== b.label && onSave(list.map((x, j) => (j === i ? { ...x, label: e.target.value.trim() || x.label } : x)))}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 outline-none hover:bg-surface-2 focus:bg-surface-2"
              />
              <button
                aria-label="Lesezeichen entfernen"
                className="text-faint opacity-0 group-hover:opacity-100 hover:text-fg"
                onClick={() => onSave(list.filter((_, j) => j !== i))}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </RailCard>
  )
}

function TalkTimeCard({ t, current }: { t: Transcript; current?: number }): ReactNode {
  const stats = useMemo(() => speakerStats(t), [t])
  if (!stats.length) return null
  return (
    <RailCard title="Redeanteile">
      {stats.map((s) => (
        <div key={s.id} className="flex flex-col gap-1 text-[13px]">
          <div className="flex justify-between gap-3">
            <span className={cn('truncate', current === s.id && 'font-medium')}>{speakerName(t.speakers, s.id)}</span>
            <span className="font-mono text-[12px] text-muted tabular">{Math.round(s.share * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-[3px] bg-surface-2">
            <div className="h-1.5 rounded-[3px] transition-[width] duration-500" style={{ width: `${s.share * 100}%`, background: speakerColor(s.id) }} />
          </div>
        </div>
      ))}
    </RailCard>
  )
}

// ------------------------------------------------------------ Sprecher bearbeiten

function SpeakersModal({
  open,
  onClose,
  t,
  onRename,
  onMerge,
  onListen
}: {
  open: boolean
  onClose: () => void
  t: Transcript
  onRename: (id: number, name: string) => void
  onMerge: (from: number, into: number) => void
  onListen: (id: number) => void
}): ReactNode {
  const stats = speakerStats(t)
  return (
    <Modal open={open} onClose={onClose} width={520}>
      <div className="text-[16px] font-semibold">Sprecher bearbeiten</div>
      <p className="mt-1 text-[13px] text-muted">Namen vergeben oder doppelt erkannte Personen zusammenführen.</p>
      <div className="mt-5 flex flex-col divide-y divide-line">
        {stats.map((s) => {
          const name = speakerName(t.speakers, s.id)
          return (
            <div key={s.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={name} speaker={s.id} size={32} />
              <div className="min-w-0 flex-1">
                <input
                  key={name}
                  defaultValue={name}
                  onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== name && onRename(s.id, e.target.value.trim())}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  className="w-full rounded-md bg-transparent px-1.5 py-0.5 text-[14px] font-medium outline-none hover:bg-surface-2 focus:bg-surface-2"
                />
                <div className="px-1.5 text-[12px] text-muted">
                  {longDuration(s.sec)} · {Math.round(s.share * 100)}%
                </div>
              </div>
              <IconButton label="Anhören" onClick={() => onListen(s.id)}>
                <Play />
              </IconButton>
              {stats.length > 1 && (
                <Select
                  className="w-40"
                  value={null}
                  placeholder="Zusammenführen …"
                  options={stats.filter((x) => x.id !== s.id).map((x) => ({ value: String(x.id), label: `in ${speakerName(t.speakers, x.id)}` }))}
                  onChange={(v) => onMerge(s.id, Number(v))}
                />
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="primary" onClick={onClose}>
          Fertig
        </Button>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------ Seite

export function TranscriptView({ id }: { id: string }): ReactNode {
  const navigate = useApp((s) => s.navigate)
  const toast = useApp((s) => s.toast)
  const query = useApp((s) => s.search)
  const models = useApp((s) => s.models)
  const job = useApp((s) => s.jobs.find((j) => j.transcriptId === id && !['done', 'error', 'cancelled'].includes(j.stage)))
  const [t, setT] = useState<Transcript | null>(null)
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [follow, setFollow] = useState(true)
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [speakersOpen, setSpeakersOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const programmaticScroll = useRef(false)

  useEffect(() => {
    let alive = true
    void window.api.transcripts.get(id).then((x) => {
      if (!alive) return
      setT(x)
      if (x?.peaks?.length) setPeaks(x.peaks)
      else if (x && x.status === 'done' && (x.audioPath || x.originalPath)) void window.api.transcripts.peaks(id).then((p) => alive && setPeaks(p))
    })
    const off = window.api.transcripts.onChange((x) => {
      if (x && x.id === id) {
        setT(x)
        if (x.peaks?.length) setPeaks(x.peaks)
      }
    })
    return () => {
      alive = false
      off()
    }
  }, [id])

  // Wiedergabeposition flüssig verfolgen (für die Wort-Hervorhebung)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = 0
    const tick = (now: number): void => {
      if (now - last > 66 && audioRef.current) {
        last = now
        setTime(audioRef.current.currentTime)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const save = useCallback(
    (patch: Partial<Transcript>) => {
      setT((cur) => (cur ? { ...cur, ...patch } : cur))
      void window.api.transcripts.update(id, patch)
    },
    [id]
  )

  const blocks = useMemo(() => (t ? toBlocks(t.segments) : []), [t])
  const activeBlock = useMemo(() => {
    if (!t || (!playing && time === 0)) return null
    return blocks.find((b) => time >= b.start && time < b.end + 0.3)?.key ?? null
  }, [blocks, time, playing, t])

  // Laufenden Absatz im Blick behalten
  useEffect(() => {
    if (!activeBlock || !follow || !playing) return
    const el = document.getElementById(`block-${activeBlock}`)
    const box = scrollRef.current
    if (!el || !box) return
    const r = el.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    if (r.top < b.top + 120 || r.bottom > b.bottom - 60) {
      programmaticScroll.current = true
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setTimeout(() => (programmaticScroll.current = false), 700)
    }
  }, [activeBlock, follow, playing])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      const a = audioRef.current
      if (!a) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (a.paused) void a.play()
        else a.pause()
      } else if (e.key === 'ArrowLeft') a.currentTime -= 5
      else if (e.key === 'ArrowRight') a.currentTime += 5
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const seek = useCallback((sec: number): void => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = sec
    setTime(sec)
    void a.play()
    setFollow(true)
  }, [])

  const saveText = useCallback(
    (segId: string, text: string) => {
      setT((cur) => {
        if (!cur) return cur
        const segments = cur.segments.map((x) => (x.id === segId ? { ...x, text, words: undefined } : x))
        void window.api.transcripts.update(id, { segments })
        return { ...cur, segments }
      })
    },
    [id]
  )

  const assign = useCallback(
    (block: Block, target: number | 'new') => {
      setT((cur) => {
        if (!cur) return cur
        const used = [...cur.speakers.map((s) => s.id), ...cur.segments.map((s) => s.speaker ?? -1)]
        const sid = target === 'new' ? Math.max(-1, ...used) + 1 : target
        const ids = new Set(block.segments.map((s) => s.id))
        const segments = cur.segments.map((x) => (ids.has(x.id) ? { ...x, speaker: sid } : x))
        const speakers = cur.speakers.some((s) => s.id === sid) ? cur.speakers : [...cur.speakers, { id: sid, name: `Sprecher ${sid + 1}` }]
        const patch = { segments, speakers: speakers.filter((s) => segments.some((x) => x.speaker === s.id)) }
        void window.api.transcripts.update(id, patch)
        return { ...cur, ...patch }
      })
    },
    [id]
  )

  if (!t)
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    )

  const audioSrc = t.audioPath ? `media://local/${encodeURIComponent(t.audioPath)}` : t.originalPath ? `media://local/${encodeURIComponent(t.originalPath)}` : undefined
  const stats = speakerStats(t)
  const currentSpeaker = blocks.find((b) => b.key === activeBlock)?.speaker
  const modelName = models.find((m) => m.id === t.modelId)?.name ?? t.modelId
  const language = LANGUAGES.find((l) => l.code === t.language)?.label ?? t.language
  const source = t.source === 'recording' ? 'Live-Aufnahme' : t.originalPath ? `Datei: ${t.originalPath.split(/[\\/]/).pop()}` : 'Datei'
  const longStamps = t.duration >= 3600
  const matches = query ? t.segments.filter((s) => s.text.toLowerCase().includes(query.toLowerCase())).length : 0

  const copyAll = async (): Promise<void> => {
    await window.api.transcripts.copyText(t.id, { speakers: true, timestamps: false })
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className="relative h-full">
      {audioSrc && (
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="metadata"
          onTimeUpdate={(e) => !playing && setTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={(e) => {
            setPlaying(false)
            setTime(e.currentTarget.currentTime)
          }}
          onError={() => toast('Audio kann nicht abgespielt werden', 'error')}
        />
      )}
      <div
        ref={scrollRef}
        onScroll={() => {
          if (!programmaticScroll.current && playing) setFollow(false)
        }}
        className="h-full overflow-y-auto"
      >
        {/* Kopf */}
        <div className="flex flex-wrap items-end gap-4 px-7 pt-7 pb-5">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {t.status === 'done' && (
                <Badge tone="success" size="md">
                  <Check strokeWidth={2.6} /> Transkribiert
                </Badge>
              )}
              {t.status === 'processing' && (
                <Badge tone="accent" size="md">
                  <Spinner className="size-3" /> Wird transkribiert
                </Badge>
              )}
              {t.status === 'error' && (
                <Badge tone="danger" size="md">
                  <CircleAlert /> Fehler
                </Badge>
              )}
              {stats.length > 0 && (
                <Badge tone="accent" size="md">
                  {stats.length === 1 ? '1 Sprecher erkannt' : `${stats.length} Sprecher erkannt`}
                </Badge>
              )}
              <Badge size="md">{language}</Badge>
            </div>
            <input
              key={t.id + t.title}
              defaultValue={t.title}
              onBlur={(e) => e.target.value.trim() && e.target.value !== t.title && save({ title: e.target.value.trim() })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              aria-label="Titel"
              className="-mx-1.5 w-full truncate rounded-lg bg-transparent px-1.5 text-[30px] leading-[1.15] font-semibold tracking-[-0.02em] outline-none hover:bg-surface-2/70 focus:bg-surface-2/70"
            />
            <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-muted">
              <span>{dateLine(t.createdAt)}</span>
              {t.duration > 0 && <span>{longDuration(t.duration)}</span>}
              <span className="max-w-[320px] truncate">{source}</span>
              <span>{modelName}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {t.originalPath && (
              <IconButton label="Im Ordner zeigen" className="size-10" onClick={() => window.api.system.showInFolder(t.originalPath!)}>
                <FolderOpen />
              </IconButton>
            )}
            <IconButton label="Löschen" className="size-10" onClick={() => setConfirmDelete(true)}>
              <Trash2 />
            </IconButton>
            <ExportMenu t={t} />
            <Button size="lg" variant="primary" icon={copied ? <Check /> : <Copy />} onClick={copyAll}>
              {copied ? 'Kopiert' : 'Text kopieren'}
            </Button>
          </div>
        </div>

        {/* Player bleibt beim Scrollen oben */}
        {audioSrc && t.status !== 'error' && (
          <div className="sticky top-0 z-20 bg-bg/90 px-7 pt-1 pb-3 backdrop-blur-md">
            <Player audio={audioRef.current} t={t} peaks={peaks} playing={playing} time={time} />
          </div>
        )}

        {job && (
          <div className="mx-7 mt-2 flex items-center gap-4 rounded-[14px] border border-line bg-panel px-4 py-3">
            <Spinner className="text-accent" />
            <span className="text-[13px] font-medium">
              {job.stage === 'diarizing' ? 'Sprecher werden erkannt …' : job.stage === 'transcribing' ? 'Transkribiere …' : 'Wird vorbereitet …'}
            </span>
            <Progress value={job.progress} indeterminate={job.stage !== 'transcribing'} className="max-w-xs flex-1" />
            <span className="font-mono text-[12px] text-muted tabular">{job.stage === 'transcribing' ? `${Math.round(job.progress * 100)}%` : ''}</span>
          </div>
        )}

        <div className="flex gap-6 px-7 pt-5 pb-10">
          {/* Transkript */}
          <section aria-label="Transkript" className="flex min-w-0 flex-1 flex-col">
            <div className="mb-2 flex flex-wrap items-center gap-1.5 border-b border-line pb-3">
              <span className="flex h-8 items-center rounded-lg bg-ink px-3 text-[13px] font-medium text-ink-fg">Transkript</span>
              {query && (
                <span className="px-2 text-[13px] text-muted">
                  {matches === 1 ? '1 Treffer' : `${matches} Treffer`} für „{query}“
                </span>
              )}
              {stats.length > 0 && (
                <button onClick={() => setSpeakersOpen(true)} className="ml-auto flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-fg">
                  <span className="flex">
                    {stats.slice(0, 5).map((s, i) => (
                      <Avatar
                        key={s.id}
                        name={speakerName(t.speakers, s.id)}
                        speaker={s.id}
                        size={22}
                        className={cn('ring-2 ring-bg', i > 0 && '-ml-1')}
                      />
                    ))}
                  </span>
                  Sprecher bearbeiten
                </button>
              )}
            </div>

            {t.status === 'error' && (
              <div className="mt-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger-text">{t.error}</div>
            )}
            {t.segments.length === 0 && t.status === 'done' && <div className="py-16 text-center text-muted">Keine Sprache erkannt.</div>}

            {blocks.map((b) => (
              <TranscriptBlock
                key={b.key}
                block={b}
                speakers={t.speakers}
                time={b.key === activeBlock ? time : -1}
                playing={playing}
                query={query}
                longStamps={longStamps}
                editingId={b.segments.some((s) => s.id === editingId) ? editingId : null}
                onSeek={seek}
                onEdit={setEditingId}
                onSaveText={saveText}
                onAssign={assign}
              />
            ))}
            {t.segments.length > 0 && <p className="mt-4 px-3 text-[12px] text-faint">Doppelklick auf einen Satz zum Bearbeiten · Klick auf ein Wort springt zur Stelle</p>}
          </section>

          {/* Seitenleiste */}
          <aside className="sticky top-[100px] flex max-h-[calc(100vh-170px)] w-[300px] shrink-0 flex-col gap-4 self-start overflow-y-auto pb-1 max-lg:hidden">
            <NotesCard t={t} onSave={(notes) => save({ notes })} />
            <MomentsCard t={t} time={time} onSeek={seek} onSave={(bookmarks) => save({ bookmarks })} />
            <TalkTimeCard t={t} current={currentSpeaker} />
          </aside>
        </div>
      </div>

      <AnimatePresence>
        {!follow && playing && (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            onClick={() => setFollow(true)}
            className="absolute bottom-5 left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12.5px] font-medium text-ink-fg shadow-lg"
          >
            Zur aktuellen Stelle
          </motion.button>
        )}
      </AnimatePresence>

      <SpeakersModal
        open={speakersOpen}
        onClose={() => setSpeakersOpen(false)}
        t={t}
        onRename={(sid, name) => {
          const others = t.speakers.filter((x) => x.id !== sid)
          save({ speakers: [...others, { id: sid, name }].sort((a, b) => a.id - b.id) })
        }}
        onMerge={(from, into) => {
          const segments = t.segments.map((s) => (s.speaker === from ? { ...s, speaker: into } : s))
          save({ segments, speakers: t.speakers.filter((s) => s.id !== from) })
        }}
        onListen={(sid) => {
          const first = t.segments.find((s) => s.speaker === sid)
          if (first) seek(first.start)
        }}
      />

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} width={400}>
        <div className="text-[16px] font-semibold">Transkript löschen?</div>
        <p className="mt-2 text-[13px] text-muted">„{t.title}“ wird dauerhaft entfernt. Die Originaldatei bleibt erhalten.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(false)}>Abbrechen</Button>
          <Button
            variant="danger"
            onClick={async () => {
              await window.api.transcripts.remove(t.id)
              navigate({ name: 'library' })
            }}
          >
            Löschen
          </Button>
        </div>
      </Modal>
    </div>
  )
}

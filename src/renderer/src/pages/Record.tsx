import { motion } from 'motion/react'
import { Bookmark, Mic, Pause, Play, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Card, IconButton, Select, Spinner, Switch, cn } from '../components/ui'
import { clock } from '../lib/format'
import { addBookmark, discardLive, startLive, stopLive, togglePause, useLive } from '../lib/live'
import { listMicrophones } from '../lib/recorder'
import { useApp } from '../lib/store'
import { useDiarizationReady } from '../lib/diarization'

function defaultTitle(ts: number): string {
  const d = new Date(ts)
  return `Aufnahme vom ${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
}

/** Status-Kapsel links in der Kopfzeile. */
function StatusPill(): ReactNode {
  const phase = useLive((s) => s.phase)
  const paused = useLive((s) => s.paused)
  const elapsed = useLive((s) => s.elapsed)
  if (phase === 'recording')
    return (
      <div
        className={cn(
          'flex h-9 shrink-0 items-center gap-2.5 rounded-full pr-3.5 pl-3 text-[13px] font-semibold',
          paused ? 'bg-surface-2 text-fg-2' : 'bg-danger-soft text-danger-text'
        )}
      >
        <span className={cn('size-[9px] rounded-full', paused ? 'bg-muted' : 'animate-pulse-soft bg-danger')} />
        {paused ? 'Pausiert' : 'Aufnahme'}
        <span className="font-mono font-medium tabular opacity-80">{clock(elapsed)}</span>
      </div>
    )
  if (phase === 'starting' || phase === 'finishing')
    return (
      <div className="flex h-9 shrink-0 items-center gap-2.5 rounded-full bg-surface-2 pr-3.5 pl-3 text-[13px] font-semibold text-fg-2">
        <Spinner className="size-3.5" />
        {phase === 'starting' ? 'Startet' : 'Wird gespeichert'}
      </div>
    )
  return (
    <div className="flex h-9 shrink-0 items-center gap-2.5 rounded-full bg-surface-2 pr-3.5 pl-3 text-[13px] font-semibold text-fg-2">
      <span className="size-[9px] rounded-full bg-faint" />
      Bereit
    </div>
  )
}

/** Pegelanzeige unter dem Live-Transkript. */
function LevelMeter({ levels, active }: { levels: number[]; active: boolean }): ReactNode {
  const bars = 64
  const data = levels.slice(-bars)
  const padded = [...Array(Math.max(0, bars - data.length)).fill(0), ...data]
  const recent = levels.slice(-40)
  const peak = recent.length ? Math.max(...recent) : 0
  const loud = active && peak >= 0.98
  const status = !active ? 'Mikrofon aus' : loud ? 'Zu laut – Abstand halten' : peak < 0.08 ? 'Wartet auf Sprache' : 'Pegel gut'
  return (
    <div className="flex items-center gap-4 border-t border-line-soft bg-bg px-5 py-3.5">
      <Mic className="size-4 shrink-0 text-fg" />
      <div className="flex h-8 min-w-0 flex-1 items-center gap-[3px] overflow-hidden" aria-hidden>
        {padded.map((l, i) => (
          <span
            key={i}
            className={cn('min-w-[3px] flex-1 rounded-[2px] transition-[height] duration-100', active && l > 0.04 ? 'bg-fg' : 'bg-line-strong')}
            style={{ height: `${Math.max(4, Math.round(6 + l * 26))}px` }}
          />
        ))}
      </div>
      <span className={cn('shrink-0 text-right text-[12px]', loud ? 'text-danger-text' : 'text-muted')}>{status}</span>
    </div>
  )
}

function SideCard({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }): ReactNode {
  return (
    <Card className={cn('flex flex-col gap-3.5 rounded-2xl p-[18px]', className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {aside && <span className="text-[12px] text-muted">{aside}</span>}
      </div>
      {children}
    </Card>
  )
}

export function Record(): ReactNode {
  const live = useLive()
  const settings = useApp((s) => s.settings!)
  const models = useApp((s) => s.models)
  const setSettings = useApp((s) => s.setSettings)
  const navigate = useApp((s) => s.navigate)
  const toast = useApp((s) => s.toast)
  const listRef = useRef<HTMLDivElement>(null)
  const [micLabel, setMicLabel] = useState('Systemmikrofon')

  const model = models.find((m) => m.id === settings.transcriptionModel)
  const diarReady = useDiarizationReady()
  const diarOn = settings.diarization.enabled && diarReady
  const recording = live.phase === 'recording'
  const busy = live.phase !== 'idle'
  const placeholderTitle = useMemo(() => defaultTitle(live.startedAt || Date.now()), [live.startedAt])

  useEffect(() => {
    void listMicrophones().then((mics) => {
      const m = mics.find((x) => x.deviceId === settings.micDeviceId) ?? mics.find((x) => x.deviceId === 'default')
      if (m?.label) setMicLabel(m.label.replace(/^(Standard|Default) - /, ''))
    })
  }, [settings.micDeviceId])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [live.segments.length, live.partial])

  useEffect(() => {
    if (live.error) toast(live.error, 'error')
  }, [live.error, toast])

  const stop = async (): Promise<void> => {
    const id = await stopLive(diarOn, settings.diarization.numSpeakers)
    if (id) navigate({ name: 'transcript', id })
  }

  const lastIndex = live.segments.length - 1

  return (
    <div className="flex h-full flex-col">
      {/* Kopfzeile der Aufnahme */}
      <header className="flex flex-wrap items-center gap-4 border-b border-line bg-panel px-7 py-4">
        <StatusPill />
        <div className="flex min-w-0 flex-1 flex-col">
          <input
            value={live.title}
            onChange={(e) => useLive.setState({ title: e.target.value })}
            placeholder={placeholderTitle}
            aria-label="Titel der Aufnahme"
            className="w-full min-w-0 truncate bg-transparent text-[16px] font-semibold tracking-[-0.01em] outline-none placeholder:text-fg"
          />
          <span className="truncate text-[12px] text-muted">
            {micLabel} · {model ? model.name : 'Kein Modell installiert'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {recording ? (
            <>
              <Button size="lg" icon={<Bookmark />} onClick={addBookmark}>
                Lesezeichen
              </Button>
              <Button size="lg" icon={live.paused ? <Play className="fill-current" /> : <Pause className="fill-current" />} onClick={togglePause}>
                {live.paused ? 'Fortsetzen' : 'Pause'}
              </Button>
              <IconButton label="Aufnahme verwerfen" className="size-10" onClick={() => void discardLive()}>
                <Trash2 />
              </IconButton>
              <Button size="lg" variant="primary" onClick={() => void stop()}>
                <span className="size-2.5 rounded-[2px] bg-ink-fg" />
                Stopp &amp; speichern
              </Button>
            </>
          ) : (
            <Button size="lg" variant="accent" icon={busy ? <Spinner /> : <Mic />} disabled={busy || !model?.installed} onClick={() => void startLive()}>
              Aufnahme starten
            </Button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-6 px-7 pt-6 pb-7">
        {/* Live-Transkript */}
        <section aria-label="Live-Transkript" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
          <div className="flex items-center gap-2.5 border-b border-line-soft px-5 py-3.5">
            <h2 className="text-[14px] font-semibold">Live-Transkript</h2>
            <span className="truncate text-[12px] text-muted">{diarOn ? 'Sprecher werden nach dem Stopp zugeordnet' : 'Ohne Sprechererkennung'}</span>
            <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-success-text">
              <span className="size-1.5 rounded-full bg-success" />
              Auf dem Gerät
            </span>
          </div>

          <div ref={listRef} className="selectable min-h-0 flex-1 overflow-y-auto px-2 pt-3 pb-5">
            {live.segments.length === 0 && !live.partial ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-muted">
                  <Mic className="size-5" />
                </div>
                <div className="text-[15px] font-semibold">{recording ? 'Sprich einfach los' : 'Noch keine Aufnahme'}</div>
                <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
                  {recording
                    ? 'Der Text erscheint hier fortlaufend, sobald du eine kurze Pause machst.'
                    : model?.installed
                      ? 'Meetings, Interviews oder Notizen live mitschreiben – komplett lokal.'
                      : 'Bitte zuerst unter Modelle ein Transkriptionsmodell herunterladen.'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {live.segments.map((s, i) => {
                  const current = recording && !live.partial && i === lastIndex
                  return (
                    <motion.div
                      key={s.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                      className={cn('flex gap-3.5 rounded-xl px-3.5 py-3', current && 'bg-accent-soft')}
                    >
                      <span className={cn('w-11 shrink-0 pt-[3px] font-mono text-[12px] tabular', current ? 'text-accent-text' : 'text-muted')}>{clock(s.start)}</span>
                      <p className="min-w-0 flex-1 text-[16px] leading-[1.6]">{s.text}</p>
                    </motion.div>
                  )
                })}
                {live.partial && (
                  <div className="flex gap-3.5 rounded-xl bg-accent-soft px-3.5 py-3">
                    <span className="w-11 shrink-0 pt-[3px] font-mono text-[12px] text-accent-text tabular">{clock(Math.max(0, live.elapsed - 2))}</span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center gap-2 text-[13px] font-semibold text-accent-text">
                        Spricht
                        <span className="flex h-3 items-end gap-[2px]" aria-hidden>
                          {[0, 0.2, 0.4].map((d) => (
                            <span key={d} className="bar-bounce h-3 w-[2px] rounded-[1px] bg-accent" style={{ animationDelay: `${d}s` }} />
                          ))}
                        </span>
                      </div>
                      <p className="text-[16px] leading-[1.6] text-muted">
                        {live.partial}
                        <span className="caret text-accent" />
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <LevelMeter levels={live.levels} active={recording && !live.paused} />
        </section>

        {/* Seitenleiste */}
        <aside className="flex w-[320px] shrink-0 flex-col gap-4">
          <SideCard title="Sprecher" aside={diarOn ? (settings.diarization.numSpeakers ? `${settings.diarization.numSpeakers} erwartet` : 'Automatisch') : 'Aus'}>
            <label className="flex items-center justify-between gap-3 text-[13px]">
              <span>
                <span className="block font-medium">Sprecher erkennen</span>
                <span className="block text-[12px] text-muted">{diarReady ? 'Ordnet jeden Satz einer Person zu.' : 'Modelle dafür fehlen noch.'}</span>
              </span>
              <Switch checked={diarOn} disabled={!diarReady || live.phase === 'finishing'} onChange={(v) => setSettings({ diarization: { enabled: v } })} />
            </label>
            {diarOn ? (
              <label className="flex items-center justify-between gap-3 text-[13px]">
                <span className="font-medium">Anzahl</span>
                <Select
                  className="w-40"
                  value={String(settings.diarization.numSpeakers)}
                  options={[{ value: '0', label: 'Automatisch' }, ...[2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} Sprecher` }))]}
                  onChange={(v) => setSettings({ diarization: { numSpeakers: Number(v) } })}
                />
              </label>
            ) : (
              !diarReady && (
                <button className="self-start text-[12.5px] font-medium text-accent-text hover:underline" onClick={() => navigate({ name: 'models' })}>
                  Sprechererkennung installieren
                </button>
              )
            )}
          </SideCard>

          <SideCard title="Momente" aside={live.bookmarks.length ? `${live.bookmarks.length}` : undefined}>
            {live.bookmarks.length === 0 ? (
              <p className="text-[13px] leading-relaxed text-muted">Markiere wichtige Stellen mit „Lesezeichen“. Sie erscheinen später im Transkript.</p>
            ) : (
              <div className="-mx-1 flex max-h-44 flex-col gap-0.5 overflow-y-auto">
                {live.bookmarks.map((b, i) => (
                  <div key={i} className="group flex items-center gap-2.5 rounded-lg px-1 text-[13px]">
                    <span className="w-10 shrink-0 font-mono text-[12px] text-muted tabular">{clock(b.time)}</span>
                    <input
                      value={b.label}
                      onChange={(e) => useLive.setState((s) => ({ bookmarks: s.bookmarks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))}
                      className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 outline-none hover:bg-surface-2 focus:bg-surface-2"
                    />
                    <button
                      aria-label="Lesezeichen entfernen"
                      className="text-faint opacity-0 group-hover:opacity-100 hover:text-fg"
                      onClick={() => useLive.setState((s) => ({ bookmarks: s.bookmarks.filter((_, j) => j !== i) }))}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </SideCard>

          <SideCard title="Deine Notizen" className="min-h-0 flex-1">
            <textarea
              value={live.notes}
              onChange={(e) => useLive.setState({ notes: e.target.value })}
              placeholder="Schreib mit, während du zuhörst. Die Notizen werden mit dem Transkript gespeichert."
              className="selectable min-h-[120px] flex-1 resize-none rounded-[10px] border border-line bg-bg p-3 text-[13px] leading-relaxed outline-none placeholder:text-muted focus:border-line-strong"
            />
          </SideCard>
        </aside>
      </div>
    </div>
  )
}

import { motion } from 'motion/react'
import { AudioLines, BookText, Boxes, FileAudio2, House, Keyboard, Mic, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { clock } from '../lib/format'
import { startLive, useLive } from '../lib/live'
import { useApp, type Route } from '../lib/store'
import { Logo } from './Logo'
import { cn, Hotkey } from './ui'

function NavItem({ route, label, icon, count }: { route: Route['name']; label: string; icon: ReactNode; count?: ReactNode }): ReactNode {
  const current = useApp((s) => s.route.name)
  const navigate = useApp((s) => s.navigate)
  const active = current === route || (route === 'library' && current === 'transcript')
  return (
    <button
      onClick={() => navigate({ name: route } as Route)}
      className={cn(
        'relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[14px] transition-colors duration-150 [&_svg]:size-4',
        active ? 'font-medium text-fg' : 'text-fg-2 hover:bg-surface-2/70 hover:text-fg'
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 rounded-lg bg-panel shadow-[0_0_0_1px_var(--line)]"
          transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }}
        />
      )}
      <span className="relative">{icon}</span>
      <span className="relative flex-1 text-left">{label}</span>
      {count !== undefined && <span className="relative text-[12px] font-normal text-muted tabular">{count}</span>}
    </button>
  )
}

function GroupLabel({ children }: { children: ReactNode }): ReactNode {
  return <div className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">{children}</div>
}

/** Großer Knopf oben: startet eine Aufnahme oder zeigt die laufende an. */
function RecordButton(): ReactNode {
  const navigate = useApp((s) => s.navigate)
  const phase = useLive((s) => s.phase)
  const paused = useLive((s) => s.paused)
  const elapsed = useLive((s) => s.elapsed)
  const busy = phase !== 'idle'
  return (
    <button
      onClick={() => {
        navigate({ name: 'record' })
        if (!busy) void startLive()
      }}
      className={cn(
        'no-drag flex h-11 items-center justify-center gap-2 rounded-[10px] text-[14px] font-medium transition-[background,transform] duration-150 active:scale-[0.98]',
        busy ? 'bg-danger-soft text-danger-text hover:bg-danger/15' : 'bg-accent text-accent-fg hover:bg-accent-strong'
      )}
    >
      {busy ? (
        <>
          <span className={cn('size-2 rounded-full bg-danger', !paused && 'animate-pulse-soft')} />
          {paused ? 'Pausiert' : 'Aufnahme läuft'}
          <span className="font-mono text-[12.5px] tabular">{clock(elapsed)}</span>
        </>
      ) : (
        <>
          <Mic className="size-4" />
          Neue Aufnahme
        </>
      )}
    </button>
  )
}

export function Sidebar(): ReactNode {
  const transcripts = useApp((s) => s.transcripts.length)
  const jobs = useApp((s) => s.jobs.filter((j) => !['done', 'error', 'cancelled'].includes(j.stage)).length)
  const dictations = useApp((s) => s.dictations.length)
  const vocabulary = useApp((s) => s.settings!.replacements.length)
  const settings = useApp((s) => s.settings!)
  const models = useApp((s) => s.models)
  const dictModel = models.find((m) => m.id === (settings.dictationModel ?? settings.transcriptionModel))
  const ready = settings.dictation.enabled && dictModel?.installed

  return (
    <aside className="flex w-[240px] shrink-0 flex-col gap-[22px] border-r border-line bg-sidebar px-3.5 pt-5 pb-3.5">
      <div className="drag flex items-center gap-2.5 px-1.5">
        <Logo size={28} />
        <span className="text-[16px] font-semibold tracking-[-0.01em]">Flusstext</span>
      </div>

      <RecordButton />

      <nav className="flex flex-col gap-0.5">
        <NavItem route="home" label="Start" icon={<House />} />
        <NavItem
          route="library"
          label="Transkripte"
          icon={<FileAudio2 />}
          count={
            jobs > 0 ? (
              <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10.5px] font-semibold text-accent-fg">
                {jobs}
              </span>
            ) : (
              transcripts || undefined
            )
          }
        />
        <NavItem route="history" label="Diktat-Verlauf" icon={<AudioLines />} count={dictations || undefined} />
        <NavItem route="vocabulary" label="Wörterbuch" icon={<BookText />} count={vocabulary || undefined} />
      </nav>

      <nav className="flex flex-col gap-0.5">
        <GroupLabel>Einrichtung</GroupLabel>
        <NavItem route="dictation" label="Diktat" icon={<Keyboard />} />
        <NavItem route="models" label="Modelle" icon={<Boxes />} />
        <NavItem route="settings" label="Einstellungen" icon={<Settings />} />
      </nav>

      <button
        onClick={() => useApp.getState().navigate({ name: 'dictation' })}
        className="mt-auto flex flex-col gap-2.5 rounded-xl border border-line bg-panel p-3.5 text-left transition-colors hover:border-line-strong"
      >
        <div className="flex items-center gap-2 text-[14px] font-medium">
          <span className={cn('size-2 rounded-full', ready ? 'bg-success' : 'bg-faint')} />
          {ready ? 'Diktat bereit' : settings.dictation.enabled ? 'Kein Modell installiert' : 'Diktat ausgeschaltet'}
        </div>
        {ready ? (
          <div className="text-[13px] leading-[1.7] text-muted">
            {settings.dictation.mode === 'toggle' ? 'Drück' : 'Halte'} <Hotkey keys={settings.dictation.hotkey} className="mx-0.5 align-middle" /> überall,
            um zu sprechen. {settings.dictation.mode === 'toggle' ? 'Erneut drücken' : 'Loslassen'} fügt ein.
          </div>
        ) : (
          <div className="text-[13px] text-muted">{settings.dictation.enabled ? 'Unter Modelle eines herunterladen.' : 'In den Diktat-Einstellungen einschalten.'}</div>
        )}
      </button>
    </aside>
  )
}

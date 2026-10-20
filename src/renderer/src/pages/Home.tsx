import { motion } from 'motion/react'
import { ArrowRight, AudioLines, Check, Copy, FileUp, Mic, Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { DictationEntry } from '@shared/types'
import { transcribePaths } from '../components/GlobalDrop'
import { Card, EmptyState, Hotkey, IconButton } from '../components/ui'
import { greeting, num, time } from '../lib/format'
import { useApp } from '../lib/store'
import { TranscriptRow } from './Library'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): ReactNode {
  return (
    <div className="px-5 py-4">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1 text-[22px] font-semibold tracking-[-0.02em] tabular">{value}</div>
      {hint && <div className="mt-0.5 text-[11.5px] text-faint">{hint}</div>}
    </div>
  )
}

function QuickAction({ icon, title, text, onClick }: { icon: ReactNode; title: string; text: string; onClick: () => void }): ReactNode {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3.5 rounded-[14px] border border-line bg-panel p-4 text-left transition-all duration-200 hover:-translate-y-px hover:border-line-strong hover:shadow-[0_8px_20px_-10px_rgba(20,21,23,0.2)]"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-fg [&_svg]:size-[18px]">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold">{title}</div>
        <div className="text-[12.5px] leading-snug text-muted">{text}</div>
      </div>
      <ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
    </button>
  )
}

function DictationRow({ entry }: { entry: DictationEntry }): ReactNode {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    await window.api.dictation.copy(entry.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <div className="group flex gap-4 px-5 py-3 transition-colors hover:bg-surface">
      <div className="w-12 shrink-0 pt-[3px] font-mono text-[12px] text-muted tabular">{time(entry.createdAt)}</div>
      <p className="selectable min-w-0 flex-1 text-[13.5px] leading-relaxed">{entry.text}</p>
      <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton label="Kopieren" onClick={copy}>
          {copied ? <Check className="text-success" /> : <Copy />}
        </IconButton>
        <IconButton label="Löschen" onClick={() => window.api.dictation.remove(entry.id)}>
          <Trash2 />
        </IconButton>
      </div>
    </div>
  )
}

export function Home(): ReactNode {
  const dictations = useApp((s) => s.dictations)
  const transcripts = useApp((s) => s.transcripts)
  const settings = useApp((s) => s.settings!)
  const navigate = useApp((s) => s.navigate)

  const stats = useMemo(() => {
    const words = dictations.reduce((n, d) => n + d.words, 0)
    const seconds = dictations.reduce((n, d) => n + d.duration, 0)
    const wpm = seconds > 0 ? Math.round(words / (seconds / 60)) : 0
    // Gegenüber Tippen mit ~40 WPM gesparte Zeit
    const saved = Math.max(0, words / 40 - seconds / 60)
    const audio = transcripts.reduce((n, t) => n + t.duration, 0)
    return { words, wpm, saved, audio }
  }, [dictations, transcripts])

  const pick = async (): Promise<void> => {
    const paths = await window.api.jobs.pickFiles()
    if (paths.length) await transcribePaths(paths)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[880px] px-7 pt-8 pb-16">
        <motion.h1 initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-[30px] leading-[1.15] font-semibold tracking-[-0.02em]">
          {greeting()}
        </motion.h1>
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[14px] text-muted">
          {settings.dictation.enabled ? (
            <>
              Halte <Hotkey keys={settings.dictation.hotkey} /> in einem beliebigen Textfeld und sprich los.
            </>
          ) : (
            'Transkribiere Dateien und Aufnahmen – komplett lokal auf deinem Rechner.'
          )}
        </p>

        <div className="mt-7 grid grid-cols-3 gap-3">
          <QuickAction icon={<FileUp />} title="Datei transkribieren" text="Audio & Video, auch per Drag & Drop" onClick={pick} />
          <QuickAction icon={<Mic />} title="Aufnahme starten" text="Live mitschreiben, mit Sprechern" onClick={() => navigate({ name: 'record' })} />
          <QuickAction icon={<AudioLines />} title="Diktat einrichten" text="Kurzbefehl, Modus, Modell" onClick={() => navigate({ name: 'dictation' })} />
        </div>

        {stats.words + transcripts.length > 0 && (
          <Card className="mt-4 grid grid-cols-4 divide-x divide-line">
            <Stat label="Diktierte Wörter" value={num(stats.words)} />
            <Stat label="Sprechtempo" value={stats.wpm ? `${stats.wpm} WPM` : '–'} hint="Tippen: ca. 40 WPM" />
            <Stat label="Zeit gespart" value={stats.saved >= 60 ? `${(stats.saved / 60).toFixed(1).replace('.', ',')} h` : `${Math.round(stats.saved)} min`} />
            <Stat label="Transkribiert" value={stats.audio >= 3600 ? `${(stats.audio / 3600).toFixed(1).replace('.', ',')} h` : `${Math.round(stats.audio / 60)} min`} hint={`${transcripts.length} Transkripte`} />
          </Card>
        )}

        <SectionHead title="Zuletzt transkribiert" onAll={transcripts.length > 4 ? () => navigate({ name: 'library' }) : undefined} />
        {transcripts.length === 0 ? (
          <Card>
            <EmptyState icon={<FileUp />} title="Noch keine Transkripte" text="Zieh eine Audio- oder Videodatei ins Fenster oder starte eine Aufnahme." />
          </Card>
        ) : (
          <Card className="divide-y divide-line-soft overflow-hidden">
            {transcripts.slice(0, 4).map((t) => (
              <TranscriptRow key={t.id} t={t} />
            ))}
          </Card>
        )}

        {dictations.length > 0 && (
          <>
            <SectionHead title="Letzte Diktate" onAll={() => navigate({ name: 'history' })} />
            <Card className="divide-y divide-line-soft overflow-hidden">
              {dictations.slice(0, 3).map((d) => (
                <DictationRow key={d.id} entry={d} />
              ))}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

function SectionHead({ title, onAll }: { title: string; onAll?: () => void }): ReactNode {
  return (
    <div className="mt-10 mb-3 flex items-center justify-between gap-4 px-1">
      <h2 className="text-[14px] font-semibold">{title}</h2>
      {onAll && (
        <button onClick={onAll} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
          Alle anzeigen <ArrowRight className="size-3.5" />
        </button>
      )}
    </div>
  )
}

import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, FileAudio2, FileUp, Mic, Search, Trash2, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Job, SearchHit, TranscriptMeta } from '@shared/types'
import { transcribePaths } from '../components/GlobalDrop'
import { Badge, Button, Card, EmptyState, IconButton, PageHeader, Progress, Select, Switch, cn } from '../components/ui'
import { clock, relative } from '../lib/format'
import { highlight } from '../lib/highlight'
import { useApp } from '../lib/store'
import { useDiarizationReady } from '../lib/diarization'

const STAGE: Record<string, string> = {
  queued: 'Wartet …',
  loading: 'Modell wird geladen …',
  decoding: 'Audio wird gelesen …',
  diarizing: 'Sprecher werden erkannt …',
  transcribing: 'Transkribiere …'
}

function JobRow({ job }: { job: Job }): ReactNode {
  const navigate = useApp((s) => s.navigate)
  const indeterminate = job.stage === 'diarizing' || job.stage === 'loading' || job.stage === 'queued'
  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div
        role="button"
        onClick={() => navigate({ name: 'transcript', id: job.transcriptId })}
        className="flex cursor-default items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent-text">
          <FileAudio2 className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-[13.5px] font-medium">{job.fileName}</span>
            <span className="shrink-0 text-[12px] text-muted tabular">
              {job.stage === 'transcribing' || job.stage === 'decoding' ? `${Math.round(job.progress * 100)} %` : ''}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <Progress value={job.progress} indeterminate={indeterminate} className="flex-1" />
          </div>
          <div className="mt-1.5 text-[12px] text-muted">{STAGE[job.stage] ?? job.stage}</div>
        </div>
        <IconButton
          label="Abbrechen"
          onClick={(e) => {
            e.stopPropagation()
            void window.api.jobs.cancel(job.id)
          }}
        >
          <X />
        </IconButton>
      </div>
    </motion.div>
  )
}

export function TranscriptRow({ t, snippet, query = '' }: { t: TranscriptMeta; snippet?: string; query?: string }): ReactNode {
  const navigate = useApp((s) => s.navigate)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate({ name: 'transcript', id: t.id })}
      onKeyDown={(e) => e.key === 'Enter' && navigate({ name: 'transcript', id: t.id })}
      className="group flex cursor-default items-start gap-4 px-5 py-4 transition-colors hover:bg-surface"
    >
      <div
        className={cn(
          'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-4',
          t.source === 'recording' ? 'bg-danger-soft text-danger-text' : 'bg-surface-2 text-fg-2'
        )}
      >
        {t.source === 'recording' ? <Mic /> : <FileAudio2 />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-medium">{highlight(t.title, query)}</span>
          {t.status === 'processing' && <Badge tone="accent">In Arbeit</Badge>}
          {t.status === 'error' && (
            <Badge tone="danger">
              <CircleAlert /> Fehler
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[12px] text-muted">
          <span>{relative(t.createdAt)}</span>
          <span>·</span>
          <span className="tabular">{clock(t.duration)}</span>
          {t.speakerCount > 1 && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Users className="size-3" /> {t.speakerCount}
              </span>
            </>
          )}
          {t.words > 0 && (
            <>
              <span>·</span>
              <span>{t.words.toLocaleString('de-DE')} Wörter</span>
            </>
          )}
        </div>
        {(snippet || t.preview || t.error) && (
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-fg-2">{t.status === 'error' ? t.error : snippet ? highlight(snippet, query) : t.preview}</p>
        )}
      </div>
      <IconButton
        label="Löschen"
        className="opacity-0 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation()
          void window.api.transcripts.remove(t.id)
        }}
      >
        <Trash2 />
      </IconButton>
    </div>
  )
}

export function TranscribeOptionsBar(): ReactNode {
  const settings = useApp((s) => s.settings!)
  const models = useApp((s) => s.models)
  const setSettings = useApp((s) => s.setSettings)
  const asr = models.filter((m) => m.kind === 'asr' && m.installed)
  const diarReady = useDiarizationReady()
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3.5">
      <label className="flex items-center gap-2.5 text-[13px] text-muted">
        Modell
        <Select
          className="w-56"
          value={settings.transcriptionModel}
          placeholder="Kein Modell installiert"
          options={asr.map((m) => ({ value: m.id, label: m.name, hint: m.gpu ? 'GPU' : 'CPU' }))}
          onChange={(v) => setSettings({ transcriptionModel: v })}
        />
      </label>
      <label className="flex items-center gap-2.5 text-[13px] text-muted">
        <Switch
          checked={settings.diarization.enabled && diarReady}
          disabled={!diarReady}
          onChange={(v) => setSettings({ diarization: { enabled: v } })}
        />
        Sprecher erkennen
      </label>
      {settings.diarization.enabled && diarReady && (
        <label className="flex items-center gap-2.5 text-[13px] text-muted">
          Anzahl
          <Select
            className="w-36"
            value={String(settings.diarization.numSpeakers)}
            options={[{ value: '0', label: 'Automatisch' }, ...[2, 3, 4, 5, 6, 8].map((n) => ({ value: String(n), label: `${n} Sprecher` }))]}
            onChange={(v) => setSettings({ diarization: { numSpeakers: Number(v) } })}
          />
        </label>
      )}
      {!diarReady && (
        <button className="text-[12.5px] font-medium text-accent-text hover:underline" onClick={() => useApp.getState().navigate({ name: 'models' })}>
          Sprechererkennung installieren
        </button>
      )}
    </div>
  )
}

export function Library(): ReactNode {
  const transcripts = useApp((s) => s.transcripts)
  const jobs = useApp((s) => s.jobs)
  const query = useApp((s) => s.search.trim())
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const active = jobs.filter((j) => !['done', 'error', 'cancelled'].includes(j.stage))

  // Volltextsuche (Titel, Text, Sprecher, Notizen) im Hauptprozess
  useEffect(() => {
    if (!query) {
      setHits(null)
      return
    }
    let alive = true
    const id = setTimeout(() => void window.api.transcripts.search(query).then((h) => alive && setHits(h)), 150)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [query, transcripts])

  const list = useMemo(() => {
    const items = transcripts.filter((t) => t.status !== 'processing' || !active.some((j) => j.transcriptId === t.id))
    if (!hits) return items.map((t) => ({ t, snippet: undefined as string | undefined }))
    const byId = new Map(items.map((t) => [t.id, t]))
    return hits.filter((h) => byId.has(h.id)).map((h) => ({ t: byId.get(h.id)!, snippet: h.snippet }))
  }, [transcripts, hits, active])

  const pick = async (): Promise<void> => {
    const paths = await window.api.jobs.pickFiles()
    if (paths.length) await transcribePaths(paths)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[920px] px-7 pt-8 pb-16">
        <PageHeader
          title="Transkripte"
          subtitle="Audio- und Videodateien lokal in Text umwandeln – mit Zeitstempeln und Sprechern."
          actions={
            <Button size="lg" variant="primary" icon={<FileUp />} onClick={pick}>
              Dateien hinzufügen
            </Button>
          }
        />

        <Card className="mb-6 overflow-visible">
          <TranscribeOptionsBar />
        </Card>

        <AnimatePresence>
          {active.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-6">
              <div className="mb-2 px-1 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">In Bearbeitung</div>
              <Card className="divide-y divide-line-soft overflow-hidden">
                <AnimatePresence initial={false}>
                  {active.map((j) => (
                    <JobRow key={j.id} job={j} />
                  ))}
                </AnimatePresence>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {transcripts.length === 0 && active.length === 0 ? (
          <button
            onClick={pick}
            className="flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line-strong px-6 py-20 text-center transition-colors hover:border-accent/50 hover:bg-accent-soft/40"
          >
            <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-fg">
              <FileUp className="size-5" />
            </div>
            <div className="text-[15px] font-semibold">Dateien hierher ziehen</div>
            <p className="mt-1 max-w-sm text-[13px] text-muted">oder klicken, um auszuwählen · MP3, WAV, M4A, MP4, MKV, OGG, FLAC und mehr</p>
          </button>
        ) : (
          <>
            <div className="mb-2 px-1 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">
              {query ? (list.length === 1 ? '1 Treffer' : `${list.length} Treffer`) : 'Alle Transkripte'}
            </div>
            <Card className="divide-y divide-line-soft overflow-hidden">
              {list.map(({ t, snippet }) => (
                <TranscriptRow key={t.id} t={t} snippet={snippet} query={query} />
              ))}
              {list.length === 0 && query && <EmptyState icon={<Search />} title="Keine Treffer" text={`Nichts gefunden für „${query}“.`} />}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

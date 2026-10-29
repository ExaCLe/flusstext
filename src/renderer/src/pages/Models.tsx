import { motion } from 'motion/react'
import { Check, Cpu, Download, ExternalLink, Gauge, Globe, HardDrive, Scale, Sparkles, Trash2, X, Zap } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { ModelStatus, SystemInfo } from '@shared/types'
import { Badge, Button, IconButton, Meter, PageHeader, Progress, Segmented, cn } from '../components/ui'
import { bytes, mb } from '../lib/format'
import { useApp } from '../lib/store'
import { pickDiarization } from '@shared/diarization'

function DownloadState({ m }: { m: ModelStatus }): ReactNode {
  const d = m.download!
  if (d.state === 'extracting')
    return (
      <div className="flex flex-1 items-center gap-3">
        <Progress value={1} indeterminate className="flex-1" />
        <span className="text-[12px] text-muted">Entpacken …</span>
      </div>
    )
  const pct = d.total ? d.received / d.total : 0
  return (
    <div className="flex flex-1 items-center gap-3">
      <Progress value={pct} className="flex-1" />
      <span className="w-[150px] text-right text-[12px] text-muted tabular">
        {Math.round(pct * 100)} % · {d.speed > 0 ? `${(d.speed / 1e6).toFixed(1).replace('.', ',')} MB/s` : '…'}
      </span>
      <IconButton label="Abbrechen" onClick={() => window.api.models.cancel(m.id)}>
        <X />
      </IconButton>
    </div>
  )
}

function ModelCard({ m, roles }: { m: ModelStatus; roles: { transcription: boolean; dictation: boolean; diarization: boolean } }): ReactNode {
  const setSettings = useApp((s) => s.setSettings)
  const [confirm, setConfirm] = useState(false)
  const downloading = m.download && (m.download.state === 'downloading' || m.download.state === 'extracting')
  const active = roles.transcription || roles.dictation || roles.diarization
  return (
    <motion.div
      layout
      className={cn(
        'rounded-xl border bg-panel p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors',
        active ? 'border-accent/45 ring-1 ring-accent/20' : m.recommended ? 'border-accent/25' : 'border-line'
      )}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[15px] font-semibold tracking-tight">{m.name}</span>
            {m.experimental && <Badge tone="warning">Experimentell</Badge>}
            {m.recommended && (
              <Badge tone="accent">
                <Sparkles /> Empfohlen
              </Badge>
            )}
            {m.gpu && (
              <Badge tone="warning">
                <Zap /> GPU
              </Badge>
            )}
            {m.dictation && m.kind === 'asr' && <Badge>Ideal für Diktat</Badge>}
            {roles.transcription && (
              <Badge tone="success">
                <Check /> Transkription
              </Badge>
            )}
            {roles.dictation && (
              <Badge tone="success">
                <Check /> Diktat
              </Badge>
            )}
            {m.nonCommercial && (
              <Badge tone="warning" className="cursor-help">
                <span title="Lizenz erlaubt nur private, nicht-kommerzielle Nutzung – nicht für berufliche Aufnahmen.">Nur privat</span>
              </Badge>
            )}
            {roles.diarization && (
              <Badge tone="success">
                <Check /> Aktiv
              </Badge>
            )}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{m.description}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        {m.kind === 'asr' && (
          <>
            <Meter label="Geschwindigkeit" value={m.speed} />
            {m.experimental ? <span className="text-[12px] text-muted">Deutsch noch nicht bewertet</span> : <Meter label="Genauigkeit (DE)" value={m.accuracy} />}
          </>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-faint">
        <span className="inline-flex items-center gap-1.5">
          <HardDrive className="size-3.5" /> {mb(m.sizeMB)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Globe className="size-3.5" /> {m.languages}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Scale className="size-3.5" /> {m.license}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Cpu className="size-3.5" /> {m.engine === 'whispercpp' ? 'whisper.cpp' : m.engine === 'onnx' ? 'ONNX Runtime · CPU' : 'sherpa-onnx'}
        </span>
        <button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => window.api.system.openExternal(m.source)}>
          Quelle <ExternalLink className="size-3" />
        </button>
      </div>
      <div className="mt-4 flex min-h-8 items-center gap-2 border-t border-line pt-3">
        {downloading ? (
          <DownloadState m={m} />
        ) : m.installed ? (
          <>
            {m.kind === 'asr' && (
              <>
                <Button size="sm" variant={roles.transcription ? 'subtle' : 'secondary'} disabled={roles.transcription} onClick={() => setSettings({ transcriptionModel: m.id })}>
                  {roles.transcription ? 'Für Transkription aktiv' : 'Für Transkription nutzen'}
                </Button>
                <Button size="sm" variant={roles.dictation ? 'subtle' : 'secondary'} disabled={roles.dictation} onClick={() => setSettings({ dictationModel: m.id })}>
                  {roles.dictation ? 'Für Diktat aktiv' : 'Für Diktat nutzen'}
                </Button>
              </>
            )}
            {(m.kind === 'embedding' || m.kind === 'segmentation') && !roles.diarization && (
              <Button
                size="sm"
                onClick={() => setSettings({ diarization: m.kind === 'embedding' ? { embeddingModel: m.id } : { segmentationModel: m.id } })}
              >
                Verwenden
              </Button>
            )}
            <div className="ml-auto">
              {confirm ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] text-muted">Wirklich löschen?</span>
                  <Button size="sm" variant="danger" onClick={() => window.api.models.remove(m.id)}>
                    Löschen
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                    Nein
                  </Button>
                </div>
              ) : (
                <IconButton label="Löschen" onClick={() => setConfirm(true)}>
                  <Trash2 />
                </IconButton>
              )}
            </div>
          </>
        ) : (
          <>
            <Button size="sm" variant={m.recommended ? 'primary' : 'secondary'} icon={<Download />} onClick={() => window.api.models.download(m.id)}>
              Herunterladen
            </Button>
            {m.download?.state === 'error' && <span className="text-[12px] text-danger">{m.download.error}</span>}
          </>
        )}
      </div>
    </motion.div>
  )
}

type Tab = 'asr' | 'diarization' | 'system'

export function Models(): ReactNode {
  const models = useApp((s) => s.models)
  const settings = useApp((s) => s.settings!)
  const [tab, setTab] = useState<Tab>('asr')
  const [info, setInfo] = useState<SystemInfo | null>(null)
  useEffect(() => {
    void window.api.system.info().then(setInfo)
  }, [models])

  const list = models.filter((m) =>
    tab === 'asr' ? m.kind === 'asr' : tab === 'diarization' ? m.kind === 'segmentation' || m.kind === 'embedding' : m.kind === 'vad' || m.kind === 'runtime'
  )
  const installedSize = models.filter((m) => m.installed).reduce((n, m) => n + m.sizeMB, 0)
  const installedIds = new Set(models.filter((m) => m.installed).map((m) => m.id))
  const diar = pickDiarization((id) => installedIds.has(id), settings)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[920px] px-7 pt-8 pb-16">
        <PageHeader
          title="Modelle"
          subtitle="Open-Source-Modelle, die vollständig offline auf deinem Rechner laufen."
          actions={
            info && (
              <div className="flex items-center gap-4 text-[12px] text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <HardDrive className="size-3.5" /> {mb(installedSize)} belegt · {bytes(info.freeDiskBytes)} frei
                </span>
                {info.gpuName && (
                  <span className="inline-flex items-center gap-1.5">
                    <Gauge className="size-3.5" /> {info.gpuName}
                  </span>
                )}
              </div>
            )
          }
        />
        <div className="mb-5">
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'asr', label: 'Spracherkennung' },
              { value: 'diarization', label: 'Sprechererkennung' },
              { value: 'system', label: 'Komponenten' }
            ]}
          />
        </div>
        {tab === 'diarization' && (
          <p className="mb-4 text-[13px] leading-relaxed text-muted">
            Die Sprechererkennung kombiniert ein Segmentierungsmodell (wer spricht wann) mit einem Stimmprofil-Modell (wer ist wer). Von
            beiden wird jeweils eines verwendet.
          </p>
        )}
        {tab === 'system' && (
          <p className="mb-4 text-[13px] leading-relaxed text-muted">
            Die Sprachaktivitätserkennung teilt lange Aufnahmen in Abschnitte. Die GPU-Laufzeit beschleunigt Whisper-Modelle auf NVIDIA-Grafikkarten.
          </p>
        )}
        {(tab === 'diarization'
          ? [
              { title: 'Segmentierung', items: list.filter((m) => m.kind === 'segmentation') },
              { title: 'Stimmprofile', items: list.filter((m) => m.kind === 'embedding') }
            ]
          : [{ title: '', items: list }]
        ).map((g) => (
          <div key={g.title} className="mb-8">
            {g.title && <h2 className="mb-3 px-1 text-[13px] font-semibold tracking-tight">{g.title}</h2>}
            <div className="flex flex-col gap-3">
              {g.items.map((m) => (
                <ModelCard
                  key={m.id}
                  m={m}
                  roles={{
                    transcription: m.installed && settings.transcriptionModel === m.id,
                    dictation: m.installed && (settings.dictationModel ?? settings.transcriptionModel) === m.id,
                    diarization: m.installed && m.id === (m.kind === 'embedding' ? diar.emb?.id : m.kind === 'segmentation' ? diar.seg?.id : undefined)
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

import { Ban, Check, Cpu, Download, ExternalLink, Gauge, Globe, HardDrive, Info, Scale, Sparkles, Trash2, X, Zap } from 'lucide-react-native'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { NativeModel, SystemInfo } from '../../core/contracts'
import { Badge, Button, EmptyState, IconButton, Meter, PageHeader, Progress, Segmented, T } from '../components'
import { bytes, mb } from '../format'
import { attempt, downloadModel, errorDetail, getApi, isDownloading, pickDiarization, setSettings, setState, toast, useApp } from '../store'
import { alpha, mono, useLayout, useTheme } from '../theme'
import { Page } from './common'

function DownloadState({ m }: { m: NativeModel }): ReactNode {
  const c = useTheme()
  const d = m.download!
  if (d.state === 'extracting')
    return (
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Progress value={1} indeterminate style={{ flex: 1 }} />
        <T size={12} color={c.muted}>
          Entpacken …
        </T>
      </View>
    )
  const pct = d.total ? d.received / d.total : 0
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Progress value={pct} style={{ flex: 1 }} />
      <Text style={[mono, { fontSize: 12, color: c.muted, textAlign: 'right' }]}>
        {Math.round(pct * 100)} % · {d.speed > 0 ? `${(d.speed / 1e6).toFixed(1).replace('.', ',')} MB/s` : '…'}
      </Text>
      <IconButton icon={X} label="Abbrechen" onPress={() => void attempt('Download konnte nicht abgebrochen werden', () => getApi().models.cancel(m.id))} />
    </View>
  )
}

function Fact({ icon: IconC, children }: { icon: typeof HardDrive; children: ReactNode }): ReactNode {
  const c = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <IconC size={14} color={c.faint} />
      <T size={12} color={c.faint}>
        {children}
      </T>
    </View>
  )
}

/** Geräteempfehlung, Ressourcenhinweis und Verfügbarkeit – getrennt dargestellt. */
export function ModelNotes({ m, compact }: { m: NativeModel; compact?: boolean }): ReactNode {
  const c = useTheme()
  if (!m.recommendation && !m.resourceNote && m.available) return null
  return (
    <View style={{ marginTop: compact ? 8 : 12, gap: 6 }}>
      {m.recommendation ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          <Sparkles size={14} color={c.accentText} style={{ marginTop: 2 }} />
          <T size={12.5} color={c.accentText} style={{ flex: 1, lineHeight: 18 }}>
            {m.recommendation}
          </T>
        </View>
      ) : null}
      {m.resourceNote ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          <Info size={14} color={c.muted} style={{ marginTop: 2 }} />
          <T size={12.5} color={c.muted} style={{ flex: 1, lineHeight: 18 }}>
            {m.resourceNote}
          </T>
        </View>
      ) : null}
      {!m.available ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          <Ban size={14} color={c.dangerText} style={{ marginTop: 2 }} />
          <T size={12.5} color={c.dangerText} style={{ flex: 1, lineHeight: 18 }}>
            {m.unavailableReason ?? 'Auf diesem Gerät nicht verfügbar.'}
          </T>
        </View>
      ) : null}
    </View>
  )
}

function ModelCard({ m, roles }: { m: NativeModel; roles: { transcription: boolean; dictation: boolean; diarization: boolean } }): ReactNode {
  const c = useTheme()
  const { wide } = useLayout()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const downloading = isDownloading(m)
  const active = roles.transcription || roles.dictation || roles.diarization
  const suggested = !!m.recommendation || !!m.recommended
  const engine = m.engine === 'whispercpp' ? 'whisper.cpp' : m.engine === 'onnx' ? 'ONNX Runtime · CPU' : 'sherpa-onnx'

  return (
    <View
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: active ? alpha(c.accent, 0.45) : suggested && m.available ? alpha(c.accent, 0.25) : c.line,
        backgroundColor: c.panel,
        padding: 16
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <T size={15} weight={600} style={{ marginRight: 4, letterSpacing: -0.2, color: m.available ? c.fg : c.muted }}>
          {m.name}
        </T>
        {m.experimental && <Badge tone="warning">Experimentell</Badge>}
        {suggested && (
          <Badge tone="accent" icon={Sparkles}>
            Empfohlen
          </Badge>
        )}
        {m.gpu && (
          <Badge tone="warning" icon={Zap}>
            GPU
          </Badge>
        )}
        {m.dictation && m.kind === 'asr' && <Badge>Ideal für Diktat</Badge>}
        {roles.transcription && (
          <Badge tone="success" icon={Check}>
            Transkription
          </Badge>
        )}
        {roles.dictation && (
          <Badge tone="success" icon={Check}>
            Diktat
          </Badge>
        )}
        {m.nonCommercial && <Badge tone="warning">Nur privat</Badge>}
        {roles.diarization && (
          <Badge tone="success" icon={Check}>
            Aktiv
          </Badge>
        )}
        {!m.available && <Badge tone="danger">Nicht verfügbar</Badge>}
      </View>
      <T size={13} color={c.muted} style={{ marginTop: 4, lineHeight: 20 }}>
        {m.description}
      </T>
      {m.nonCommercial && (
        <T size={12} color={c.warningText} style={{ marginTop: 4 }}>
          Lizenz erlaubt nur private, nicht-kommerzielle Nutzung – nicht für berufliche Aufnahmen.
        </T>
      )}
      <ModelNotes m={m} />

      {m.kind === 'asr' && (
        <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 24, rowGap: 8 }}>
          <Meter label="Geschwindigkeit" value={m.speed} />
          {m.experimental ? (
            <T size={12} color={c.muted}>
              Deutsch noch nicht bewertet
            </T>
          ) : (
            <Meter label="Genauigkeit (DE)" value={m.accuracy} />
          )}
        </View>
      )}
      <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 16, rowGap: 6 }}>
        <Fact icon={HardDrive}>{mb(m.sizeMB)}</Fact>
        <Fact icon={Globe}>{m.languages}</Fact>
        <Fact icon={Scale}>{m.license}</Fact>
        <Fact icon={Cpu}>{engine}</Fact>
        <Pressable
          accessibilityRole="link"
          hitSlop={10}
          onPress={() => void attempt('Link konnte nicht geöffnet werden', () => getApi().system.openExternal(m.source))}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
        >
          <T size={12} color={c.faint}>
            Quelle
          </T>
          <ExternalLink size={12} color={c.faint} />
        </Pressable>
      </View>

      <View style={{ marginTop: 16, minHeight: 32, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 12 }}>
        {downloading ? (
          <DownloadState m={m} />
        ) : m.installed ? (
          <>
            {m.kind === 'asr' && (
              <>
                <Button size="sm" variant={roles.transcription ? 'subtle' : 'secondary'} disabled={roles.transcription} onPress={() => void setSettings({ transcriptionModel: m.id })}>
                  {roles.transcription ? 'Für Transkription aktiv' : 'Für Transkription nutzen'}
                </Button>
                <Button size="sm" variant={roles.dictation ? 'subtle' : 'secondary'} disabled={roles.dictation} onPress={() => void setSettings({ dictationModel: m.id })}>
                  {roles.dictation ? 'Für Diktat aktiv' : 'Für Diktat nutzen'}
                </Button>
              </>
            )}
            {(m.kind === 'embedding' || m.kind === 'segmentation') && !roles.diarization && (
              <Button size="sm" onPress={() => void setSettings({ diarization: m.kind === 'embedding' ? { embeddingModel: m.id } : { segmentationModel: m.id } })}>
                Verwenden
              </Button>
            )}
            <View style={{ marginLeft: 'auto' }}>
              {confirm ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {wide && (
                    <T size={12} color={c.muted}>
                      Wirklich löschen?
                    </T>
                  )}
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy}
                    onPress={async () => {
                      setBusy(true)
                      await attempt(`${m.name} konnte nicht gelöscht werden`, () => getApi().models.remove(m.id))
                      setBusy(false)
                      setConfirm(false)
                    }}
                  >
                    Löschen
                  </Button>
                  <Button size="sm" variant="ghost" onPress={() => setConfirm(false)}>
                    Nein
                  </Button>
                </View>
              ) : (
                <IconButton icon={Trash2} label="Löschen" onPress={() => setConfirm(true)} />
              )}
            </View>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant={suggested && m.available ? 'primary' : 'secondary'}
              icon={Download}
              disabled={!m.available}
              label={m.available ? 'Herunterladen' : `Herunterladen nicht möglich: ${m.unavailableReason ?? 'nicht verfügbar'}`}
              onPress={() => void downloadModel(m)}
            >
              Herunterladen
            </Button>
            {m.download?.state === 'error' && (
              <T size={12} color={c.danger} style={{ flex: 1 }}>
                {m.download.error ?? 'Download fehlgeschlagen'}
              </T>
            )}
          </>
        )}
      </View>
    </View>
  )
}

type Tab = 'asr' | 'diarization' | 'system'

/** Empfehlungen fürs Gerät zuerst, nicht verfügbare zuletzt – ohne etwas auszublenden. */
export function sortForDevice(list: NativeModel[]): NativeModel[] {
  const rank = (m: NativeModel): number => (!m.available ? 3 : m.recommendation ? 0 : m.installed ? 1 : 2)
  return list.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map((x) => x.m)
}

export function Models(): ReactNode {
  const c = useTheme()
  const { wide, desktop } = useLayout()
  const models = useApp((s) => s.models)
  const settings = useApp((s) => s.settings!)
  const [tab, setTab] = useState<Tab>('asr')
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const installedKey = models.filter((m) => m.installed).length

  useEffect(() => {
    let alive = true
    getApi()
      .system.info()
      .then((x) => alive && setInfo(x))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [installedKey])

  const list = useMemo(
    () =>
      sortForDevice(
        models.filter((m) =>
          tab === 'asr' ? m.kind === 'asr' : tab === 'diarization' ? m.kind === 'segmentation' || m.kind === 'embedding' : m.kind === 'vad' || m.kind === 'runtime'
        )
      ),
    [models, tab]
  )
  const installedSize = models.filter((m) => m.installed).reduce((n, m) => n + m.sizeMB, 0)
  const diar = pickDiarization(models, settings)

  const refresh = async (): Promise<void> => {
    try {
      const [m, i] = await Promise.all([getApi().models.list(), getApi().system.info()])
      setInfo(i)
      setState({ models: m })
    } catch (e) {
      toast('Modelle konnten nicht geladen werden', 'error', errorDetail(e))
    }
  }

  const groups =
    tab === 'diarization'
      ? [
          { title: 'Segmentierung', items: list.filter((m) => m.kind === 'segmentation') },
          { title: 'Stimmprofile', items: list.filter((m) => m.kind === 'embedding') }
        ]
      : [{ title: '', items: list }]

  return (
    <Page maxWidth={920} onRefresh={refresh}>
      <PageHeader
        title="Modelle"
        subtitle={desktop ? 'Open-Source-Modelle, die vollständig offline auf deinem Rechner laufen.' : 'Open-Source-Modelle, die vollständig offline auf deinem Gerät laufen.'}
        actions={
          info ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
              <Fact icon={HardDrive}>
                {mb(installedSize)} belegt · {bytes(info.freeDiskBytes)} frei
              </Fact>
              {info.gpuName ? <Fact icon={Gauge}>{info.gpuName}</Fact> : null}
            </View>
          ) : undefined
        }
      />
      <View style={{ marginBottom: 20 }}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          stretch={!wide}
          size={wide ? 'md' : 'sm'}
          options={[
            { value: 'asr', label: 'Spracherkennung' },
            { value: 'diarization', label: 'Sprechererkennung' },
            { value: 'system', label: 'Komponenten' }
          ]}
        />
      </View>
      {tab === 'asr' && !desktop && (
        <T size={13} color={c.muted} style={{ marginBottom: 16, lineHeight: 20 }}>
          Für dieses Gerät empfohlene Modelle stehen oben. Größere Modelle bleiben verfügbar, brauchen aber mehr Speicher und Zeit.
        </T>
      )}
      {tab === 'diarization' && (
        <T size={13} color={c.muted} style={{ marginBottom: 16, lineHeight: 20 }}>
          Die Sprechererkennung kombiniert ein Segmentierungsmodell (wer spricht wann) mit einem Stimmprofil-Modell (wer ist wer). Von beiden wird jeweils eines verwendet.
        </T>
      )}
      {tab === 'system' && (
        <T size={13} color={c.muted} style={{ marginBottom: 16, lineHeight: 20 }}>
          Die Sprachaktivitätserkennung teilt lange Aufnahmen in Abschnitte. Laufzeit-Komponenten beschleunigen einzelne Modelle.
        </T>
      )}
      {models.length === 0 ? (
        <EmptyState icon={HardDrive} title="Keine Modelle gefunden" text="Die Modellliste ist leer. Zum Aktualisieren nach unten ziehen." />
      ) : (
        groups.map((g) => (
          <View key={g.title || 'all'} style={{ marginBottom: 32 }}>
            {g.title ? (
              <T size={13} weight={600} style={{ marginBottom: 12, paddingHorizontal: 4 }}>
                {g.title}
              </T>
            ) : null}
            <View style={{ gap: 12 }}>
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
              {g.items.length === 0 && (
                <T size={13} color={c.muted} style={{ paddingHorizontal: 4 }}>
                  Für diesen Bereich gibt es auf diesem Gerät keine Modelle.
                </T>
              )}
            </View>
          </View>
        ))
      )}
    </Page>
  )
}

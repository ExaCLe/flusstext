import { FolderOpen, Monitor, Moon, Sun } from 'lucide-react-native'
import { useEffect, useState, type ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { SystemInfo } from '../../core/contracts'
import { LANGUAGES, type Theme } from '../../../../src/shared/types'
import { Button, Confirm, PageHeader, Section, Segmented, Select, SettingRow, Switch, T } from '../components'
import { num } from '../format'
import { attempt, errorDetail, getApi, navigate, pickDiarization, setSettings, toast, useApp } from '../store'
import { mono, useLayout, useTheme } from '../theme'
import { Page } from './common'

function PathText({ path }: { path?: string }): ReactNode {
  const c = useTheme()
  return <Text style={[mono, { fontSize: 11.5, color: c.muted }]}>{path ?? '…'}</Text>
}

export function SettingsPage(): ReactNode {
  const c = useTheme()
  const { wide, desktop } = useLayout()
  const settings = useApp((s) => s.settings!)
  const models = useApp((s) => s.models)
  const dictations = useApp((s) => s.dictations.length)
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [mic, setMic] = useState<'unknown' | 'checking' | 'granted' | 'denied'>('unknown')
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    let alive = true
    getApi()
      .system.info()
      .then((x) => alive && setInfo(x))
      .catch((e) => alive && setInfoError(errorDetail(e) ?? 'Systeminformationen nicht verfügbar'))
    return () => {
      alive = false
    }
  }, [])

  const current = models.find((m) => m.id === settings.transcriptionModel)
  const diar = pickDiarization(models, settings)
  const segModels = models.filter((m) => m.kind === 'segmentation' && m.installed)
  const embModels = models.filter((m) => m.kind === 'embedding' && m.installed)
  const stack = !wide

  const checkMic = async (): Promise<void> => {
    setMic('checking')
    try {
      setMic((await getApi().system.requestMicrophone()) ? 'granted' : 'denied')
    } catch (e) {
      setMic('unknown')
      toast('Mikrofonzugriff konnte nicht geprüft werden', 'error', errorDetail(e))
    }
  }

  const open = (path?: string): void => {
    if (path) void attempt('Ordner konnte nicht geöffnet werden', () => getApi().system.openPath(path))
  }

  return (
    <Page maxWidth={760}>
      <PageHeader title="Einstellungen" />

      <Section title="Allgemein">
        <SettingRow title="Erscheinungsbild">
          <Segmented<Theme>
            value={settings.theme}
            onChange={(v) => void setSettings({ theme: v })}
            options={[
              { value: 'system', label: 'System', icon: Monitor },
              { value: 'light', label: 'Hell', icon: Sun },
              { value: 'dark', label: 'Dunkel', icon: Moon }
            ]}
          />
        </SettingRow>
        <SettingRow
          stack={stack}
          title="Sprache der Aufnahmen"
          description={
            current?.multilingual
              ? 'Whisper-Modelle können die Sprache auch automatisch erkennen.'
              : 'Parakeet erkennt die Sprache automatisch; die Auswahl gilt für Whisper- und Canary-Modelle.'
          }
        >
          <Select
            style={{ width: wide ? 208 : undefined, flex: wide ? 0 : 1 }}
            title="Sprache der Aufnahmen"
            value={settings.language}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
            onChange={(v) => void setSettings({ language: v })}
          />
        </SettingRow>
        {desktop && (
          <SettingRow title="Bei der Anmeldung starten" description="Flusstext startet im Hintergrund, damit das Diktat sofort bereit ist.">
            <Switch label="Bei der Anmeldung starten" value={settings.launchAtLogin} onChange={(v) => void setSettings({ launchAtLogin: v })} />
          </SettingRow>
        )}
      </Section>

      <Section title="Audio">
        <SettingRow
          title="Mikrofon"
          description={
            mic === 'granted'
              ? 'Zugriff erlaubt. Aufgenommen wird mit dem Mikrofon des Geräts.'
              : mic === 'denied'
                ? 'Kein Zugriff. Bitte in den Systemeinstellungen für Flusstext erlauben.'
                : 'Aufgenommen wird mit dem Mikrofon des Geräts.'
          }
        >
          <Button size="sm" loading={mic === 'checking'} onPress={() => void checkMic()}>
            {mic === 'granted' ? 'Erlaubt' : 'Zugriff prüfen'}
          </Button>
        </SettingRow>
      </Section>

      <Section title="Leistung">
        <SettingRow title="CPU-Threads" description={`Für sherpa-onnx-Modelle. Dein Prozessor hat ${info?.cpuThreads ?? '…'} Threads.`}>
          <Select
            style={{ width: 96, minWidth: 96 }}
            title="CPU-Threads"
            value={String(settings.threads)}
            options={[1, 2, 4, 6, 8, 12, 16].filter((n) => !info || n <= info.cpuThreads).map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(v) => void setSettings({ threads: Number(v) })}
          />
        </SettingRow>
        {info?.gpuName ? (
          <SettingRow title="GPU verwenden" description={`Unterstützte Modelle laufen auf: ${info.gpuName}`}>
            <Switch label="GPU verwenden" value={settings.useGpu} onChange={(v) => void setSettings({ useGpu: v })} />
          </SettingRow>
        ) : null}
      </Section>

      <Section
        title="Sprechererkennung"
        description="Weitere Modelle findest du unter Modelle › Sprechererkennung."
        action={
          <Button size="sm" variant="ghost" onPress={() => navigate({ name: 'models' })}>
            Modelle verwalten
          </Button>
        }
      >
        <SettingRow stack={stack} title="Segmentierung" description="Erkennt, wann jemand spricht.">
          <Select
            style={{ width: wide ? 240 : undefined, flex: wide ? 0 : 1 }}
            title="Segmentierung"
            value={diar.seg?.id ?? null}
            placeholder="Nicht installiert"
            options={segModels.map((m) => ({ value: m.id, label: m.name, hint: m.nonCommercial ? 'Nur privat' : m.license }))}
            onChange={(v) => void setSettings({ diarization: { segmentationModel: v } })}
          />
        </SettingRow>
        <SettingRow stack={stack} title="Stimmprofile" description="Unterscheidet, wer spricht.">
          <Select
            style={{ width: wide ? 240 : undefined, flex: wide ? 0 : 1 }}
            title="Stimmprofile"
            value={diar.emb?.id ?? null}
            placeholder="Nicht installiert"
            options={embModels.map((m) => ({ value: m.id, label: m.name, hint: `${m.sizeMB} MB` }))}
            onChange={(v) => void setSettings({ diarization: { embeddingModel: v } })}
          />
        </SettingRow>
        <SettingRow
          stack={stack}
          title="Trennschärfe"
          description="Gilt bei automatischer Sprecherzahl. Werden Personen zusammengelegt, „Feiner“ wählen; tauchen zu viele Sprecher auf, „Gröber“."
        >
          <Segmented<string>
            size="sm"
            stretch={stack}
            value={String(settings.diarization.thresholdOffset)}
            onChange={(v) => void setSettings({ diarization: { thresholdOffset: Number(v) } })}
            options={[
              { value: '-0.1', label: 'Feiner' },
              { value: '0', label: 'Standard' },
              { value: '0.1', label: 'Gröber' }
            ]}
          />
        </SettingRow>
      </Section>

      <Section title="Speicher">
        <SettingRow title="Modelle" description={<PathText path={info?.modelsDir} />}>
          {desktop ? (
            <Button size="sm" icon={FolderOpen} disabled={!info} onPress={() => open(info?.modelsDir)}>
              Öffnen
            </Button>
          ) : undefined}
        </SettingRow>
        <SettingRow title="Transkripte & Aufnahmen" description={<PathText path={info?.dataDir} />}>
          {desktop ? (
            <Button size="sm" icon={FolderOpen} disabled={!info} onPress={() => open(info?.dataDir)}>
              Öffnen
            </Button>
          ) : undefined}
        </SettingRow>
        <SettingRow stack={stack} title="Diktat-Verlauf löschen" description="Entfernt alle gespeicherten Diktate. Transkripte bleiben erhalten.">
          <Button size="sm" variant="danger" disabled={dictations === 0} onPress={() => setConfirmClear(true)}>
            Verlauf löschen
          </Button>
        </SettingRow>
      </Section>

      <Section title="Über">
        <SettingRow
          title={`Flusstext ${info?.version ?? ''}`}
          description="Alle Daten bleiben auf diesem Gerät. Modelle: NVIDIA Parakeet, Canary & TitaNet (CC-BY-4.0), OpenAI Whisper (MIT), pyannote (MIT), 3D-Speaker (Apache-2.0), WeSpeaker (CC-BY-4.0), Rev Reverb (Rev Non-Production – nur private Nutzung). Engines: sherpa-onnx, whisper.cpp."
        />
        {infoError ? (
          <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
            <T size={12.5} color={c.dangerText}>
              {infoError}
            </T>
          </View>
        ) : null}
        <SettingRow title="Einrichtung erneut durchlaufen">
          <Button size="sm" onPress={() => void setSettings({ onboardingDone: false })}>
            Starten
          </Button>
        </SettingRow>
      </Section>

      <Confirm
        open={confirmClear}
        title="Diktat-Verlauf löschen?"
        text={`Alle ${num(dictations)} gespeicherten Diktate werden entfernt. Transkripte bleiben erhalten.`}
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          await attempt('Verlauf konnte nicht gelöscht werden', () => getApi().dictation.clear())
          setConfirmClear(false)
        }}
      />
    </Page>
  )
}

import { FolderOpen, Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { LANGUAGES, type SystemInfo, type Theme } from '@shared/types'
import { Button, PageHeader, Section, Segmented, Select, SettingRow, Switch } from '../components/ui'
import { listMicrophones } from '../lib/recorder'
import { useApp } from '../lib/store'
import { pickDiarization } from '@shared/diarization'

export function SettingsPage(): ReactNode {
  const settings = useApp((s) => s.settings!)
  const models = useApp((s) => s.models)
  const setSettings = useApp((s) => s.setSettings)
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [info, setInfo] = useState<SystemInfo | null>(null)

  useEffect(() => {
    void listMicrophones().then(setMics)
    void window.api.system.info().then(setInfo)
  }, [])

  const current = models.find((m) => m.id === settings.transcriptionModel)
  const installedIds = new Set(models.filter((m) => m.installed).map((m) => m.id))
  const diar = pickDiarization((id) => installedIds.has(id), settings)
  const segModels = models.filter((m) => m.kind === 'segmentation' && m.installed)
  const embModels = models.filter((m) => m.kind === 'embedding' && m.installed)
  const whisperish = current?.multilingual

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-7 pt-8 pb-16">
        <PageHeader title="Einstellungen" />

        <Section title="Allgemein">
          <SettingRow title="Erscheinungsbild">
            <Segmented<Theme>
              value={settings.theme}
              onChange={(v) => setSettings({ theme: v })}
              options={[
                { value: 'system', label: <Monitor className="size-3.5" /> },
                { value: 'light', label: <Sun className="size-3.5" /> },
                { value: 'dark', label: <Moon className="size-3.5" /> }
              ]}
            />
          </SettingRow>
          <SettingRow
            title="Sprache der Aufnahmen"
            description={whisperish ? 'Whisper-Modelle können die Sprache auch automatisch erkennen.' : 'Parakeet erkennt die Sprache automatisch; die Auswahl gilt für Whisper- und Canary-Modelle.'}
          >
            <Select className="w-52" value={settings.language} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} onChange={(v) => setSettings({ language: v })} />
          </SettingRow>
          <SettingRow title={window.api.platform === 'darwin' ? 'Bei Anmeldung starten' : 'Mit Windows starten'} description="Flusstext startet minimiert im Infobereich, damit das Diktat sofort bereit ist.">
            <Switch checked={settings.launchAtLogin} onChange={(v) => setSettings({ launchAtLogin: v })} />
          </SettingRow>
        </Section>

        <Section title="Audio">
          <SettingRow title="Mikrofon">
            <Select
              className="w-64"
              value={settings.micDeviceId}
              options={[
                { value: 'default', label: 'Systemstandard' },
                ...mics.filter((m) => m.deviceId !== 'default' && m.deviceId !== 'communications').map((m) => ({ value: m.deviceId, label: m.label || 'Mikrofon' }))
              ]}
              onChange={(v) => setSettings({ micDeviceId: v })}
            />
          </SettingRow>
        </Section>

        <Section title="Leistung">
          <SettingRow title="CPU-Threads" description={`Für sherpa-onnx-Modelle. Dein Prozessor hat ${info?.cpuThreads ?? '…'} Threads.`}>
            <Select
              className="w-28"
              value={String(settings.threads)}
              options={[1, 2, 4, 6, 8, 12, 16].filter((n) => !info || n <= info.cpuThreads).map((n) => ({ value: String(n), label: String(n) }))}
              onChange={(v) => setSettings({ threads: Number(v) })}
            />
          </SettingRow>
          <SettingRow title="GPU verwenden" description={info?.gpuName ? `Whisper-Modelle (whisper.cpp) laufen auf: ${info.gpuName}` : 'Für whisper.cpp-Modelle mit NVIDIA-Grafikkarte.'}>
            <Switch checked={settings.useGpu} onChange={(v) => setSettings({ useGpu: v })} />
          </SettingRow>
        </Section>

        <Section
          title="Sprechererkennung"
          description="Weitere Modelle findest du unter Modelle › Sprechererkennung."
          action={
            <Button size="sm" variant="ghost" onClick={() => useApp.getState().navigate({ name: 'models' })}>
              Modelle verwalten
            </Button>
          }
        >
          <SettingRow title="Segmentierung" description="Erkennt, wann jemand spricht.">
            <Select
              className="w-60"
              value={diar.seg?.id ?? null}
              placeholder="Nicht installiert"
              options={segModels.map((m) => ({ value: m.id, label: m.name, hint: m.nonCommercial ? 'Nur privat' : m.license }))}
              onChange={(v) => setSettings({ diarization: { segmentationModel: v } })}
            />
          </SettingRow>
          <SettingRow title="Stimmprofile" description="Unterscheidet, wer spricht.">
            <Select
              className="w-60"
              value={diar.emb?.id ?? null}
              placeholder="Nicht installiert"
              options={embModels.map((m) => ({ value: m.id, label: m.name, hint: `${m.sizeMB} MB` }))}
              onChange={(v) => setSettings({ diarization: { embeddingModel: v } })}
            />
          </SettingRow>
          <SettingRow
            title="Trennschärfe"
            description="Gilt bei automatischer Sprecherzahl. Werden Personen zusammengelegt, „Feiner“ wählen; tauchen zu viele Sprecher auf, „Gröber“."
          >
            <Segmented<string>
              size="sm"
              value={String(settings.diarization.thresholdOffset)}
              onChange={(v) => setSettings({ diarization: { thresholdOffset: Number(v) } })}
              options={[
                { value: '-0.1', label: 'Feiner' },
                { value: '0', label: 'Standard' },
                { value: '0.1', label: 'Gröber' }
              ]}
            />
          </SettingRow>
        </Section>

        <Section title="Speicher">
          <SettingRow title="Modelle" description={<span className="font-mono text-[11.5px] break-all">{info?.modelsDir}</span>}>
            <Button size="sm" icon={<FolderOpen />} onClick={() => info && window.api.system.openPath(info.modelsDir)}>
              Öffnen
            </Button>
          </SettingRow>
          <SettingRow title="Transkripte & Aufnahmen" description={<span className="font-mono text-[11.5px] break-all">{info?.dataDir}</span>}>
            <Button size="sm" icon={<FolderOpen />} onClick={() => info && window.api.system.openPath(info.dataDir)}>
              Öffnen
            </Button>
          </SettingRow>
          <SettingRow title="Diktat-Verlauf löschen" description="Entfernt alle gespeicherten Diktate. Transkripte bleiben erhalten.">
            <Button size="sm" variant="danger" onClick={() => window.api.dictation.clear()}>
              Verlauf löschen
            </Button>
          </SettingRow>
        </Section>

        <Section title="Über">
          <SettingRow title={`Flusstext ${info?.version ?? ''}`} description="Alle Daten bleiben auf diesem Gerät. Modelle: NVIDIA Parakeet, Canary & TitaNet (CC-BY-4.0), OpenAI Whisper (MIT), pyannote (MIT), 3D-Speaker (Apache-2.0), WeSpeaker (CC-BY-4.0), Rev Reverb (Rev Non-Production – nur private Nutzung). Engines: sherpa-onnx, whisper.cpp." />
          <SettingRow title="Einrichtung erneut durchlaufen">
            <Button size="sm" onClick={() => setSettings({ onboardingDone: false })}>
              Starten
            </Button>
          </SettingRow>
        </Section>
      </div>
    </div>
  )
}

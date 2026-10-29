import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Check, FileAudio2, Keyboard, Lock, Mic, Users } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DictationMode } from '@shared/types'
import { HotkeyRecorder } from '../components/HotkeyRecorder'
import { Logo } from '../components/Logo'
import { Button, Hotkey, Meter, Progress, Segmented, Select, Switch, cn } from '../components/ui'
import { mb } from '../lib/format'
import { listMicrophones, startRecorder, type Recorder } from '../lib/recorder'
import { useApp } from '../lib/store'

const STEPS = ['Willkommen', 'Modell', 'Mikrofon', 'Kurzbefehl', 'Fertig']

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }): ReactNode {
  return (
    <div className="flex gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-fg [&_svg]:size-4">{icon}</div>
      <div>
        <div className="text-[13.5px] font-semibold">{title}</div>
        <div className="text-[12.5px] leading-relaxed text-muted">{text}</div>
      </div>
    </div>
  )
}

function ModelStep(): ReactNode {
  const models = useApp((s) => s.models)
  const settings = useApp((s) => s.settings!)
  const setSettings = useApp((s) => s.setSettings)
  const options = models.filter((m) => m.kind === 'asr' && m.recommended)
  const [diar, setDiar] = useState(true)
  const selected = settings.transcriptionModel

  const choose = async (id: string): Promise<void> => {
    await setSettings({ transcriptionModel: id })
    const m = models.find((x) => x.id === id)
    if (m && !m.installed && !m.download) await window.api.models.download(id)
  }

  useEffect(() => {
    if (!diar) return
    for (const m of models) {
      const needed = m.id === settings.diarization.segmentationModel || m.id === settings.diarization.embeddingModel
      if (needed && !m.installed && !m.download) void window.api.models.download(m.id)
    }
  }, [diar, models, settings.diarization.segmentationModel, settings.diarization.embeddingModel])

  return (
    <div>
      <h2 className="text-[20px] font-semibold tracking-tight">Wähle ein Modell</h2>
      <p className="mt-1 text-[13px] text-muted">Der Download startet sofort im Hintergrund. Weitere Modelle findest du später unter „Modelle“.</p>
      <div className="mt-5 flex flex-col gap-2.5">
        {options.map((m) => {
          const dl = m.download && (m.download.state === 'downloading' || m.download.state === 'extracting')
          return (
            <button
              key={m.id}
              onClick={() => choose(m.id)}
              className={cn(
                'rounded-xl border p-4 text-left transition-all',
                selected === m.id ? 'border-ink bg-surface ring-1 ring-ink/20' : 'border-line hover:border-line-strong hover:bg-surface'
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn('flex size-4 items-center justify-center rounded-full border', selected === m.id ? 'border-ink bg-ink text-ink-fg' : 'border-line-strong')}>
                  {selected === m.id && <Check className="size-2.5" strokeWidth={3} />}
                </span>
                <span className="text-[14px] font-semibold">{m.name}</span>
                <span className="ml-auto text-[12px] text-faint">{mb(m.sizeMB)}</span>
              </div>
              <p className="mt-1.5 ml-6 text-[12.5px] leading-relaxed text-muted">{m.description}</p>
              <div className="mt-2.5 ml-6 flex gap-6">
                <Meter label="Geschwindigkeit" value={m.speed} />
                <Meter label="Genauigkeit" value={m.accuracy} />
              </div>
              {(dl || m.installed) && (
                <div className="mt-3 ml-6 flex items-center gap-3">
                  {m.installed ? (
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-success">
                      <Check className="size-3.5" /> Installiert
                    </span>
                  ) : (
                    <>
                      <Progress value={m.download!.total ? m.download!.received / m.download!.total : 0} className="flex-1" />
                      <span className="text-[11.5px] text-muted tabular">
                        {m.download!.total ? Math.round((m.download!.received / m.download!.total) * 100) : 0} %
                      </span>
                    </>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>
      <label className="mt-4 flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-[13px]">
        <Users className="size-4 text-muted" />
        <span className="flex-1">Sprechererkennung mitinstallieren (ca. 35 MB)</span>
        <Switch checked={diar} onChange={setDiar} />
      </label>
    </div>
  )
}

function MicStep(): ReactNode {
  const settings = useApp((s) => s.settings!)
  const setSettings = useApp((s) => s.setSettings)
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Recorder | null>(null)

  useEffect(() => {
    let alive = true
    setError(null)
    startRecorder({ deviceId: settings.micDeviceId, keep: false, onLevel: (l) => setLevel((p) => p * 0.6 + l * 0.4) })
      .then(async (r) => {
        if (!alive) return r.close()
        rec.current = r
        setMics(await listMicrophones())
      })
      .catch(() => setError(window.api.platform === 'darwin' ? 'Kein Zugriff aufs Mikrofon. Bitte unter Systemeinstellungen › Datenschutz & Sicherheit › Mikrofon erlauben.' : 'Kein Zugriff aufs Mikrofon. Bitte unter Windows-Einstellungen › Datenschutz › Mikrofon erlauben.'))
    return () => {
      alive = false
      rec.current?.close()
    }
  }, [settings.micDeviceId])

  return (
    <div>
      <h2 className="text-[20px] font-semibold tracking-tight">Mikrofon testen</h2>
      <p className="mt-1 text-[13px] text-muted">Sag etwas – der Balken sollte sich bewegen.</p>
      <div className="mt-6 flex flex-col gap-5">
        <Select
          value={settings.micDeviceId}
          options={[
            { value: 'default', label: 'Systemstandard' },
            ...mics.filter((m) => m.deviceId !== 'default' && m.deviceId !== 'communications').map((m) => ({ value: m.deviceId, label: m.label || 'Mikrofon' }))
          ]}
          onChange={(v) => setSettings({ micDeviceId: v })}
        />
        <div className="flex h-24 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface">
          {Array.from({ length: 24 }, (_, i) => {
            const center = 1 - Math.abs(i - 11.5) / 12
            const h = 4 + level * 70 * (0.4 + center * 0.6) * (0.75 + Math.sin(i * 1.7) * 0.25)
            return <span key={i} className="w-1.5 rounded-full bg-accent transition-[height] duration-75" style={{ height: `${Math.min(72, h)}px` }} />
          })}
        </div>
        {error && <p className="text-[12.5px] text-danger">{error}</p>}
      </div>
    </div>
  )
}

function HotkeyStep(): ReactNode {
  const settings = useApp((s) => s.settings!)
  const setSettings = useApp((s) => s.setSettings)
  const d = settings.dictation
  return (
    <div>
      <h2 className="text-[20px] font-semibold tracking-tight">Diktieren – überall</h2>
      <p className="mt-1 text-[13px] text-muted">Mit einem Kurzbefehl sprichst du in jedes Textfeld. Der Text wird automatisch eingefügt.</p>
      <div className="mt-6 flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-xl border border-line px-4 py-3">
          <span className="text-[13.5px] font-medium">Kurzbefehl</span>
          <HotkeyRecorder value={d.hotkey} onChange={(keys) => setSettings({ dictation: { hotkey: keys } })} />
        </div>
        <div className="flex items-center justify-between rounded-xl border border-line px-4 py-3">
          <span className="text-[13.5px] font-medium">Modus</span>
          <Segmented<DictationMode>
            size="sm"
            value={d.mode}
            onChange={(v) => setSettings({ dictation: { mode: v } })}
            options={[
              { value: 'hybrid', label: 'Halten & Tippen' },
              { value: 'hold', label: 'Halten' },
              { value: 'toggle', label: 'Umschalten' }
            ]}
          />
        </div>
        {window.api.platform === 'darwin' && <p className="text-[13px] leading-relaxed text-muted">Für globale Kurzbefehle und automatisches Einfügen: Im Menü Flusstext › Diktat-Zugriff erlauben öffnen und Flusstext unter Bedienungshilfen erlauben. Danach zur App zurückkehren.</p>}
        <label className="flex items-center justify-between rounded-xl border border-line px-4 py-3 text-[13.5px] font-medium">
          Diktat aktivieren
          <Switch checked={d.enabled} onChange={(v) => setSettings({ dictation: { enabled: v } })} />
        </label>
      </div>
    </div>
  )
}

function DoneStep(): ReactNode {
  const settings = useApp((s) => s.settings!)
  const models = useApp((s) => s.models)
  const m = models.find((x) => x.id === settings.transcriptionModel)
  const pct = m?.download?.total ? m.download.received / m.download.total : 0
  return (
    <div>
      <h2 className="text-[20px] font-semibold tracking-tight">Alles bereit</h2>
      <p className="mt-1 flex flex-wrap items-center gap-1 text-[13px] text-muted">
        Probier es aus: Klick ins Feld, halte <Hotkey keys={settings.dictation.hotkey} /> und sprich.
      </p>
      {m && !m.installed && (
        <div className="mt-5 rounded-xl border border-line px-4 py-3">
          <div className="mb-2 flex justify-between text-[12.5px]">
            <span className="font-medium">{m.name} wird geladen</span>
            <span className="text-muted tabular">{Math.round(pct * 100)} %</span>
          </div>
          <Progress value={pct} indeterminate={m.download?.state === 'extracting'} />
        </div>
      )}
      <textarea
        autoFocus
        placeholder="Hier hineindiktieren …"
        className="selectable mt-5 h-32 w-full resize-none rounded-xl border border-line bg-surface px-4 py-3 text-[14px] leading-relaxed outline-none placeholder:text-faint focus:border-accent/60"
      />
    </div>
  )
}

export function Onboarding(): ReactNode {
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const setSettings = useApp((s) => s.setSettings)
  const settings = useApp((s) => s.settings!)
  const go = (n: number): void => {
    setDir(n > step ? 1 : -1)
    setStep(n)
  }
  const finish = (): Promise<void> => setSettings({ onboardingDone: true })

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-bg/80 backdrop-blur-md">
      <div className="drag absolute inset-x-0 top-0 h-11" />
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex h-[600px] w-[560px] flex-col overflow-hidden rounded-3xl border border-line bg-panel shadow-[0_32px_80px_-16px_rgba(0,0,0,0.45)]"
      >
        <div className="flex items-center gap-1.5 px-8 pt-7">
          {STEPS.map((s, i) => (
            <div key={s} className={cn('h-1 flex-1 rounded-full transition-colors duration-300', i <= step ? 'bg-accent' : 'bg-surface-2')} />
          ))}
        </div>
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              initial={{ opacity: 0, x: dir * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -24 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="px-8 pt-7 pb-4"
            >
              {step === 0 && (
                <div>
                  <Logo size={52} />
                  <h1 className="mt-6 text-[28px] leading-tight font-semibold tracking-[-0.025em]">
                    Sprache wird Text.
                    <br />
                    <span className="text-muted">Lokal und privat.</span>
                  </h1>
                  <div className="mt-8 flex flex-col gap-5">
                    <Feature icon={<Keyboard />} title="Diktat in jeder App" text="Kurzbefehl halten, sprechen, loslassen – fertig eingefügt." />
                    <Feature icon={<FileAudio2 />} title="Dateien & Meetings transkribieren" text="Mit Zeitstempeln, Sprechererkennung und Export nach Word oder SRT." />
                    <Feature icon={<Lock />} title="100 % offline" text="Open-Source-Modelle laufen auf deinem Rechner. Nichts verlässt das Gerät." />
                  </div>
                </div>
              )}
              {step === 1 && <ModelStep />}
              {step === 2 && <MicStep />}
              {step === 3 && <HotkeyStep />}
              {step === 4 && <DoneStep />}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="flex items-center gap-2 border-t border-line px-8 py-4">
          {step > 0 ? (
            <Button variant="ghost" icon={<ArrowLeft />} onClick={() => go(step - 1)}>
              Zurück
            </Button>
          ) : (
            <Button variant="ghost" onClick={finish}>
              Überspringen
            </Button>
          )}
          <div className="flex-1" />
          {step < STEPS.length - 1 ? (
            <Button variant="primary" size="lg" onClick={() => go(step + 1)} disabled={step === 1 && !settings.transcriptionModel}>
              {step === 0 ? 'Los geht’s' : 'Weiter'} <ArrowRight />
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={finish} icon={<Mic />}>
              Fertig
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

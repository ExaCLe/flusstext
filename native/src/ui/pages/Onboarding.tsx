import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, FileAudio2, Keyboard, Lock, Mic, MicOff, Users } from 'lucide-react-native'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { NativeModel } from '../../core/contracts'
import type { DictationMode } from '../../../../src/shared/types'
import { Button, Hotkey, Logo, Meter, Progress, Segmented, Switch, T, type Icon } from '../components'
import { mb } from '../format'
import { attempt, downloadModel, errorDetail, getApi, getState, isDownloading, setSettings, toast, useApp } from '../store'
import { nativeAnimations, alpha, mono, useLayout, useTheme } from '../theme'
import { ModelNotes, sortForDevice } from './Models'

function Feature({ icon: IconC, title, text }: { icon: Icon; title: string; text: string }): ReactNode {
  const c = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <IconC size={16} color={c.fg} />
      </View>
      <View style={{ flex: 1 }}>
        <T size={13.5} weight={600}>
          {title}
        </T>
        <T size={12.5} color={c.muted} style={{ lineHeight: 19 }}>
          {text}
        </T>
      </View>
    </View>
  )
}

function StepTitle({ title, text }: { title: string; text: string }): ReactNode {
  const c = useTheme()
  return (
    <>
      <T size={20} weight={600} style={{ letterSpacing: -0.3 }} accessibilityRole="header">
        {title}
      </T>
      <T size={13} color={c.muted} style={{ marginTop: 4, lineHeight: 19 }}>
        {text}
      </T>
    </>
  )
}

function ModelOption({ m, selected, onPress }: { m: NativeModel; selected: boolean; onPress: () => void }): ReactNode {
  const c = useTheme()
  const dl = isDownloading(m)
  const pct = m.download?.total ? m.download.received / m.download.total : 0
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !m.available }}
      accessibilityLabel={m.name}
      accessibilityHint={m.available ? m.recommendation : m.unavailableReason}
      disabled={!m.available}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 12,
        borderWidth: 1,
        borderColor: selected ? c.ink : pressed ? c.lineStrong : c.line,
        backgroundColor: selected || pressed ? c.surface : 'transparent',
        padding: 16
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View
          style={{
            width: 16,
            height: 16,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: selected ? c.ink : c.lineStrong,
            backgroundColor: selected ? c.ink : 'transparent',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {selected && <Check size={10} strokeWidth={3} color={c.inkFg} />}
        </View>
        <T size={14} weight={600} color={m.available ? c.fg : c.muted} lines={1} style={{ flex: 1 }}>
          {m.name}
        </T>
        <T size={12} color={c.faint}>
          {mb(m.sizeMB)}
        </T>
      </View>
      <View style={{ marginLeft: 24 }}>
        <T size={12.5} color={c.muted} style={{ marginTop: 6, lineHeight: 19 }}>
          {m.description}
        </T>
        <View style={{ marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', columnGap: 24, rowGap: 6 }}>
          <Meter label="Geschwindigkeit" value={m.speed} />
          <Meter label="Genauigkeit" value={m.accuracy} />
        </View>
        <ModelNotes m={m} compact />
        {(dl || m.installed || m.download?.state === 'error') && (
          <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {m.installed ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Check size={14} color={c.success} />
                <T size={12} weight={500} color={c.success}>
                  Installiert
                </T>
              </View>
            ) : m.download?.state === 'error' ? (
              <T size={12} color={c.danger}>
                {m.download.error ?? 'Download fehlgeschlagen'} – zum erneuten Versuch antippen.
              </T>
            ) : (
              <>
                <Progress value={pct} indeterminate={m.download?.state === 'extracting'} style={{ flex: 1 }} />
                <Text style={[mono, { fontSize: 11.5, color: c.muted }]}>{Math.round(pct * 100)} %</Text>
              </>
            )}
          </View>
        )}
      </View>
    </Pressable>
  )
}

function useDiarModels(): NativeModel[] {
  const models = useApp((s) => s.models)
  const seg = useApp((s) => s.settings!.diarization.segmentationModel)
  const emb = useApp((s) => s.settings!.diarization.embeddingModel)
  return useMemo(() => models.filter((m) => m.id === seg || m.id === emb), [models, seg, emb])
}

function ModelStep({ diar, setDiar }: { diar: boolean; setDiar: (v: boolean) => void }): ReactNode {
  const c = useTheme()
  const models = useApp((s) => s.models)
  const selected = useApp((s) => s.settings!.transcriptionModel)
  const diarModels = useDiarModels()
  const [showAll, setShowAll] = useState(false)

  const asr = useMemo(() => models.filter((m) => m.kind === 'asr'), [models])
  const suggested = useMemo(() => {
    const device = asr.filter((m) => m.recommendation && m.available)
    return device.length ? device : asr.filter((m) => m.recommended && m.available)
  }, [asr])
  const rest = useMemo(() => sortForDevice(asr.filter((m) => !suggested.includes(m))), [asr, suggested])
  const selectedInRest = rest.some((m) => m.id === selected)
  const expanded = showAll || selectedInRest || suggested.length === 0

  const choose = async (m: NativeModel): Promise<void> => {
    const ok = await setSettings({ transcriptionModel: m.id })
    if (ok && !m.installed && !isDownloading(m)) await downloadModel(m)
  }

  const diarAvailable = diarModels.length > 0 && diarModels.every((m) => m.available)
  const diarSize = diarModels.filter((m) => !m.installed).reduce((n, m) => n + m.sizeMB, 0)

  return (
    <View>
      <StepTitle title="Wähle ein Modell" text="Der Download startet sofort im Hintergrund. Weitere Modelle findest du später unter „Modelle“." />
      {asr.length === 0 ? (
        <T size={13} color={c.muted} style={{ marginTop: 20 }}>
          Auf diesem Gerät wurden keine Spracherkennungsmodelle gefunden.
        </T>
      ) : (
        <View style={{ marginTop: 20, gap: 10 }}>
          {suggested.length > 0 && (
            <T size={11} weight={600} color={c.muted} style={{ letterSpacing: 0.66, textTransform: 'uppercase' }}>
              Empfohlen für dieses Gerät
            </T>
          )}
          {suggested.map((m) => (
            <ModelOption key={m.id} m={m} selected={selected === m.id} onPress={() => void choose(m)} />
          ))}
          {rest.length > 0 && suggested.length > 0 && !selectedInRest && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowAll(!showAll)}
              style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}
            >
              <T size={13} weight={500} color={c.fg2}>
                {expanded ? 'Weniger anzeigen' : `Alle Modelle anzeigen (${rest.length})`}
              </T>
              {expanded ? <ChevronUp size={14} color={c.fg2} /> : <ChevronDown size={14} color={c.fg2} />}
            </Pressable>
          )}
          {expanded && rest.map((m) => <ModelOption key={m.id} m={m} selected={selected === m.id} onPress={() => void choose(m)} />)}
        </View>
      )}
      {diarModels.length > 0 && (
        <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, borderWidth: 1, borderColor: c.line, paddingHorizontal: 16, paddingVertical: 10 }}>
          <Users size={16} color={c.muted} />
          <View style={{ flex: 1 }}>
            <T size={13}>{diarSize > 0 ? `Sprechererkennung mitinstallieren (ca. ${mb(diarSize)})` : 'Sprechererkennung ist installiert'}</T>
            {!diarAvailable && (
              <T size={12} color={c.dangerText}>
                {diarModels.find((m) => !m.available)?.unavailableReason ?? 'Auf diesem Gerät nicht verfügbar.'}
              </T>
            )}
          </View>
          <Switch label="Sprechererkennung mitinstallieren" value={diar && diarAvailable} disabled={!diarAvailable || diarSize === 0} onChange={setDiar} />
        </View>
      )}
    </View>
  )
}

function MicStep(): ReactNode {
  const c = useTheme()
  const model = useApp((s) => s.models.find((m) => m.id === s.settings?.transcriptionModel))
  const phase = useApp((s) => s.recording.phase)
  const level = useApp((s) => s.recording.level)
  const [permission, setPermission] = useState<'unknown' | 'asking' | 'granted' | 'denied'>('unknown')
  const [testing, setTesting] = useState(false)
  const testingRef = useRef(false)
  const smooth = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(smooth, { toValue: testing ? level : 0, duration: 90, easing: Easing.out(Easing.ease), useNativeDriver: false }).start()
  }, [level, testing, smooth])

  // Test beim Verlassen des Schritts beenden
  useEffect(
    () => () => {
      if (testingRef.current) void getApi().recording.cancel().catch(() => undefined)
    },
    []
  )

  const ask = async (): Promise<void> => {
    setPermission('asking')
    try {
      setPermission((await getApi().system.requestMicrophone()) ? 'granted' : 'denied')
    } catch (e) {
      setPermission('denied')
      toast('Mikrofonzugriff konnte nicht angefragt werden', 'error', errorDetail(e))
    }
  }

  const toggleTest = async (): Promise<void> => {
    if (testing) {
      testingRef.current = false
      setTesting(false)
      await attempt('Test konnte nicht beendet werden', () => getApi().recording.cancel())
      return
    }
    if (phase !== 'idle') {
      toast('Es läuft bereits eine Aufnahme', 'error')
      return
    }
    try {
      await getApi().recording.start({})
      testingRef.current = true
      setTesting(true)
    } catch (e) {
      toast('Mikrofontest konnte nicht gestartet werden', 'error', errorDetail(e))
    }
  }

  return (
    <View>
      <StepTitle title="Mikrofon testen" text="Flusstext braucht Zugriff aufs Mikrofon. Die Aufnahmen bleiben auf diesem Gerät." />
      <View style={{ marginTop: 24, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, borderWidth: 1, borderColor: c.line, paddingHorizontal: 16, paddingVertical: 12 }}>
          {permission === 'denied' ? <MicOff size={16} color={c.dangerText} /> : <Mic size={16} color={permission === 'granted' ? c.success : c.muted} />}
          <T size={13.5} weight={500} style={{ flex: 1 }} color={permission === 'denied' ? c.dangerText : c.fg}>
            {permission === 'granted' ? 'Zugriff erlaubt' : permission === 'denied' ? 'Kein Zugriff aufs Mikrofon' : 'Mikrofonzugriff'}
          </T>
          {permission !== 'granted' && (
            <Button size="sm" variant="primary" loading={permission === 'asking'} onPress={() => void ask()}>
              {permission === 'denied' ? 'Erneut fragen' : 'Erlauben'}
            </Button>
          )}
        </View>
        {permission === 'denied' && (
          <T size={12.5} color={c.danger} style={{ lineHeight: 19 }}>
            Bitte den Mikrofonzugriff für Flusstext in den Systemeinstellungen erlauben.
          </T>
        )}

        {permission === 'granted' && (
          <>
            <T size={13} color={c.muted}>
              {model?.installed ? 'Sag etwas – der Balken sollte sich bewegen.' : 'Der Pegeltest ist möglich, sobald das Modell geladen ist.'}
            </T>
            <View style={{ height: 96, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
              {Array.from({ length: 24 }, (_, i) => {
                const center = 1 - Math.abs(i - 11.5) / 12
                const k = 70 * (0.4 + center * 0.6) * (0.75 + Math.sin(i * 1.7) * 0.25)
                return (
                  <Animated.View
                    key={i}
                    style={{ width: 6, borderRadius: 3, backgroundColor: c.accent, height: smooth.interpolate({ inputRange: [0, 1], outputRange: [4, Math.min(72, 4 + k)], extrapolate: 'clamp' }) }}
                  />
                )
              })}
            </View>
            <Button variant={testing ? 'secondary' : 'subtle'} icon={testing ? undefined : Mic} disabled={!model?.installed} onPress={() => void toggleTest()} style={{ alignSelf: 'flex-start' }}>
              {testing ? 'Test beenden' : 'Pegel testen'}
            </Button>
          </>
        )}
      </View>
    </View>
  )
}

function DictationStep(): ReactNode {
  const c = useTheme()
  const d = useApp((s) => s.settings!.dictation)
  return (
    <View>
      <StepTitle title="Diktieren – überall" text="Mit einem Kurzbefehl sprichst du in jedes Textfeld. Der Text wird automatisch eingefügt." />
      <View style={{ marginTop: 24, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, borderWidth: 1, borderColor: c.line, paddingHorizontal: 16, paddingVertical: 12 }}>
          <T size={13.5} weight={500}>
            Kurzbefehl
          </T>
          <Hotkey keys={d.hotkey} />
        </View>
        <View style={{ gap: 10, borderRadius: 12, borderWidth: 1, borderColor: c.line, paddingHorizontal: 16, paddingVertical: 12 }}>
          <T size={13.5} weight={500}>
            Modus
          </T>
          <Segmented<DictationMode>
            size="sm"
            value={d.mode}
            onChange={(v) => void setSettings({ dictation: { mode: v } })}
            options={[
              { value: 'hybrid', label: 'Halten & Tippen' },
              { value: 'hold', label: 'Halten' },
              { value: 'toggle', label: 'Umschalten' }
            ]}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, borderWidth: 1, borderColor: c.line, paddingHorizontal: 16, paddingVertical: 12 }}>
          <T size={13.5} weight={500}>
            Diktat aktivieren
          </T>
          <Switch label="Diktat aktivieren" value={d.enabled} onChange={(v) => void setSettings({ dictation: { enabled: v } })} />
        </View>
      </View>
    </View>
  )
}

function DoneStep(): ReactNode {
  const c = useTheme()
  const { desktop } = useLayout()
  const settings = useApp((s) => s.settings!)
  const m = useApp((s) => s.models.find((x) => x.id === s.settings?.transcriptionModel))
  const diarModels = useDiarModels()
  const pending = [m, ...diarModels].filter((x): x is NativeModel => !!x && !x.installed && (isDownloading(x) || x.download?.state === 'error'))
  return (
    <View>
      <T size={20} weight={600} style={{ letterSpacing: -0.3 }} accessibilityRole="header">
        Alles bereit
      </T>
      {desktop ? (
        <View style={{ marginTop: 4, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
          <T size={13} color={c.muted}>
            Probier es aus: Klick in ein Textfeld, halte
          </T>
          <Hotkey keys={settings.dictation.hotkey} />
          <T size={13} color={c.muted}>
            und sprich.
          </T>
        </View>
      ) : (
        <T size={13} color={c.muted} style={{ marginTop: 4, lineHeight: 19 }}>
          Starte eine Aufnahme, wähle eine Datei oder diktiere kurze Notizen. Alles bleibt auf diesem Gerät.
        </T>
      )}
      {!m && (
        <T size={13} color={c.dangerText} style={{ marginTop: 20 }}>
          Noch kein Modell gewählt. Du kannst es später unter „Modelle“ herunterladen.
        </T>
      )}
      {pending.map((x) => {
        const pct = x.download?.total ? x.download.received / x.download.total : 0
        const failed = x.download?.state === 'error'
        return (
          <View key={x.id} style={{ marginTop: 16, borderRadius: 12, borderWidth: 1, borderColor: c.line, paddingHorizontal: 16, paddingVertical: 12 }}>
            <View style={{ marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <T size={12.5} weight={500} lines={1} style={{ flex: 1 }}>
                {failed ? `${x.name}: Download fehlgeschlagen` : `${x.name} wird geladen`}
              </T>
              {!failed && <Text style={[mono, { fontSize: 12.5, color: c.muted }]}>{Math.round(pct * 100)} %</Text>}
            </View>
            {failed ? (
              <Button size="sm" onPress={() => void downloadModel(x)} style={{ alignSelf: 'flex-start' }}>
                Erneut versuchen
              </Button>
            ) : (
              <Progress value={pct} indeterminate={x.download?.state === 'extracting'} />
            )}
          </View>
        )
      })}
      {m?.installed && (
        <View style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Check size={16} color={c.success} />
          <T size={13} color={c.successText}>
            {m.name} ist installiert.
          </T>
        </View>
      )}
    </View>
  )
}

export function Onboarding(): ReactNode {
  const c = useTheme()
  const { wide, desktop } = useLayout()
  const insets = useSafeAreaInsets()
  const selected = useApp((s) => s.settings!.transcriptionModel)
  const steps = desktop ? ['Willkommen', 'Modell', 'Mikrofon', 'Kurzbefehl', 'Fertig'] : ['Willkommen', 'Modell', 'Mikrofon', 'Fertig']
  const [step, setStep] = useState(0)
  const [diar, setDiar] = useState(true)
  const [finishing, setFinishing] = useState(false)
  const anim = useRef(new Animated.Value(1)).current
  const dir = useRef(1)
  const scroll = useRef<ScrollView>(null)
  const name = steps[step]

  useEffect(() => {
    anim.setValue(0)
    Animated.timing(anim, { toValue: 1, duration: 220, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: nativeAnimations }).start()
    scroll.current?.scrollTo({ y: 0, animated: false })
  }, [step, anim])

  const go = (n: number): void => {
    dir.current = n > step ? 1 : -1
    if (name === 'Modell' && n > step && diar) {
      const s = getState()
      const wanted = s.models.filter((m) => m.id === s.settings?.diarization.segmentationModel || m.id === s.settings?.diarization.embeddingModel)
      for (const m of wanted) if (m.available && !m.installed && !isDownloading(m)) void downloadModel(m)
    }
    setStep(n)
  }
  const finish = async (): Promise<void> => {
    setFinishing(true)
    await setSettings({ onboardingDone: true })
    setFinishing(false)
  }

  const card = (
    <View
      style={
        wide
          ? { width: 560, height: 600, maxHeight: '92%', borderRadius: 24, borderWidth: 1, borderColor: c.line, backgroundColor: c.panel, overflow: 'hidden' }
          : { flex: 1, backgroundColor: c.panel, paddingTop: insets.top }
      }
    >
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: wide ? 32 : 20, paddingTop: wide ? 28 : 16 }} accessibilityLabel={`Schritt ${step + 1} von ${steps.length}`}>
        {steps.map((s, i) => (
          <View key={s} style={{ height: 4, flex: 1, borderRadius: 999, backgroundColor: i <= step ? c.accent : c.surface2 }} />
        ))}
      </View>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: wide ? 32 : 20, paddingTop: 28, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
        <Animated.View style={{ opacity: anim, transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [dir.current * 24, 0] }) }] }}>
          {name === 'Willkommen' && (
            <View>
              <Logo size={52} />
              <Text style={{ marginTop: 24 }}>
                <T size={28} weight={600} style={{ letterSpacing: -0.7, lineHeight: 34 }}>
                  {'Sprache wird Text.\n'}
                </T>
                <T size={28} weight={600} color={c.muted} style={{ letterSpacing: -0.7, lineHeight: 34 }}>
                  Lokal und privat.
                </T>
              </Text>
              <View style={{ marginTop: 32, gap: 20 }}>
                <Feature
                  icon={Keyboard}
                  title={desktop ? 'Diktat in jeder App' : 'Diktat mit einem Tipp'}
                  text={desktop ? 'Kurzbefehl halten, sprechen, loslassen – fertig eingefügt.' : 'Tippen, sprechen, erneut tippen – der Text landet im Verlauf.'}
                />
                <Feature icon={FileAudio2} title="Dateien & Meetings transkribieren" text="Mit Zeitstempeln, Sprechererkennung und Export nach Word oder SRT." />
                <Feature
                  icon={Lock}
                  title="100 % offline"
                  text={desktop ? 'Open-Source-Modelle laufen auf deinem Rechner. Nichts verlässt das Gerät.' : 'Open-Source-Modelle laufen auf deinem Gerät. Nichts wird hochgeladen.'}
                />
              </View>
            </View>
          )}
          {name === 'Modell' && <ModelStep diar={diar} setDiar={setDiar} />}
          {name === 'Mikrofon' && <MicStep />}
          {name === 'Kurzbefehl' && <DictationStep />}
          {name === 'Fertig' && <DoneStep />}
        </Animated.View>
      </ScrollView>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          borderTopWidth: 1,
          borderTopColor: c.line,
          paddingHorizontal: wide ? 32 : 20,
          paddingTop: 16,
          paddingBottom: 16 + (wide ? 0 : insets.bottom)
        }}
      >
        {step > 0 ? (
          <Button variant="ghost" icon={ArrowLeft} onPress={() => go(step - 1)}>
            Zurück
          </Button>
        ) : (
          <Button variant="ghost" loading={finishing} onPress={() => void finish()}>
            Überspringen
          </Button>
        )}
        <View style={{ flex: 1 }} />
        {step < steps.length - 1 ? (
          <Button variant="primary" size="lg" disabled={name === 'Modell' && !selected} onPress={() => go(step + 1)}>
            <T size={13.5} weight={500} color={c.inkFg}>
              {step === 0 ? 'Los geht’s' : 'Weiter'}
            </T>
            <ArrowRight size={15} color={c.inkFg} />
          </Button>
        ) : (
          <Button variant="primary" size="lg" icon={Mic} loading={finishing} onPress={() => void finish()}>
            Fertig
          </Button>
        )}
      </View>
    </View>
  )

  return wide ? (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(c.bg, 0.8) }}>{card}</View>
  ) : (
    <View style={{ flex: 1, backgroundColor: c.panel }}>{card}</View>
  )
}

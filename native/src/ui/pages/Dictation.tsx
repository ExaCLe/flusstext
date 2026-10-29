import {HotkeyRecorder} from '../HotkeyRecorder'
import { Mic, Square, X } from 'lucide-react-native'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Text, TextInput, View } from 'react-native'
import type { DictationMode } from '../../../../src/shared/types'
import { Badge, Button, Card, Hotkey, PageHeader, PulseDot, Section, Segmented, Select, SettingRow, Spinner, Switch, T } from '../components'
import { clock } from '../format'
import { errorDetail, getApi, navigate, setSettings, toast, useApp } from '../store'
import { font, mono, useLayout, useTheme } from '../theme'
import { Page } from './common'

function ModeHint({ mode, keys }: { mode: DictationMode; keys: number[] }): ReactNode {
  const c = useTheme()
  const t = (s: string): ReactNode => (
    <T size={13.5} color={c.muted} style={{ lineHeight: 28 }}>
      {s}
    </T>
  )
  const k = <Hotkey keys={keys} />
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
      {mode === 'hold' ? (
        <>
          {t('Halte')}
          {k}
          {t('gedrückt, sprich und lass los.')}
        </>
      ) : mode === 'toggle' ? (
        <>
          {t('Drück')}
          {k}
          {t('zum Starten und erneut zum Einfügen.')}
        </>
      ) : (
        <>
          {t('Halte')}
          {k}
          {t('zum Sprechen – oder tippe kurz für freihändiges Diktat und drück erneut zum Beenden.')}
        </>
      )}
    </View>
  )
}

type Phase = 'idle' | 'starting' | 'listening' | 'processing'

/** Diktat in der App: starten, stoppen, Ergebnis landet im Probierfeld und im Verlauf. */
function TryDictation(): ReactNode {
  const c = useTheme()
  const { desktop } = useLayout()
  const d = useApp((s) => s.settings!.dictation)
  const model = useApp((s) => s.models.find((m) => m.id === (s.settings?.dictationModel ?? s.settings?.transcriptionModel)))
  const dictations = useApp((s) => s.dictations)
  const recordingBusy = useApp((s) => s.recording.phase !== 'idle')
  const native = useApp((s) => s.dictationState)
  const [starting, setStarting] = useState(false)
  const phase: Phase = starting ? 'starting' : native.phase
  const [text, setText] = useState('')
  const elapsed = native.elapsed
  const seen = useRef(new Set(dictations.map(x => x.id)))
  const ownsSession = useRef(false)

  useEffect(() => {
    const fresh = dictations.filter(x => !seen.current.has(x.id)).reverse()
    for (const item of fresh) {
      seen.current.add(item.id)
      setText(value => value ? `${value}${/\s$/.test(value) ? '' : ' '}${item.text}` : item.text)
    }
    if (native.phase === 'idle') ownsSession.current = false
  }, [dictations, native.phase])

  useEffect(() => () => {
    if (ownsSession.current) void getApi().dictation.cancel().catch(() => undefined)
  }, [])

  const start = async (): Promise<void> => {
    if (!model?.installed) {
      toast('Bitte zuerst ein Modell für das Diktat herunterladen', 'error')
      navigate({ name: 'models' })
      return
    }
    setStarting(true)
    try {
      await getApi().dictation.start()
      ownsSession.current = true
    } catch (error) {
      toast('Diktat konnte nicht gestartet werden', 'error', errorDetail(error))
    } finally { setStarting(false) }
  }
  const stop = async (): Promise<void> => {
    try { await getApi().dictation.stop() }
    catch (error) { toast('Diktat konnte nicht abgeschlossen werden', 'error', errorDetail(error)) }
  }
  const cancel = async (): Promise<void> => {
    try { await getApi().dictation.cancel() }
    catch (error) { toast('Diktat konnte nicht abgebrochen werden', 'error', errorDetail(error)) }
  }

  return (
    <Card style={{ marginBottom: 32 }}>
      <View style={{ paddingHorizontal: 24, paddingVertical: 20 }}>
        <Badge tone="accent" size="md">
          Ausprobieren
        </Badge>
        <View style={{ marginTop: 10 }}>
          {desktop ? (
            <ModeHint mode={d.mode} keys={d.hotkey} />
          ) : (
            <T size={13.5} color={c.muted} style={{ lineHeight: 20 }}>
              Tippe auf „Diktat starten“, sprich und tippe auf „Fertig“. Der Text erscheint hier und im Diktat-Verlauf.
            </T>
          )}
        </View>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          textAlignVertical="top"
          accessibilityLabel="Probierfeld"
          placeholder={desktop ? 'Hier klicken und den Kurzbefehl verwenden …' : 'Hier erscheint dein diktierter Text …'}
          placeholderTextColor={c.muted}
          style={[font(400), { marginTop: 16, height: 96, borderRadius: 10, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, lineHeight: 23, color: c.fg }]}
        />
        <View style={{ marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {phase === 'listening' ? (
            <>
              <View style={{ height: 36, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: c.dangerSoft, paddingHorizontal: 12 }}>
                <PulseDot color={c.danger} />
                <Text style={[mono, { fontSize: 12.5, color: c.dangerText }]}>{clock(elapsed)}</Text>
              </View>
              <Button variant="primary" size="lg" icon={Square} onPress={() => void stop()}>
                Fertig
              </Button>
              <Button variant="ghost" size="lg" icon={X} onPress={() => void cancel()}>
                Abbrechen
              </Button>
            </>
          ) : phase === 'processing' ? (
            <View style={{ height: 40, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Spinner />
              <T size={13} color={c.muted}>
                Wird erkannt …
              </T>
            </View>
          ) : (
            <Button variant="accent" size="lg" icon={Mic} loading={phase === 'starting'} disabled={!d.enabled || recordingBusy} onPress={() => void start()}>
              Diktat starten
            </Button>
          )}
          {!d.enabled && phase === 'idle' && (
            <T size={12.5} color={c.muted}>
              Diktat ist ausgeschaltet.
            </T>
          )}
          {d.enabled && recordingBusy && phase === 'idle' && (
            <T size={12.5} color={c.muted}>
              Während einer Aufnahme nicht verfügbar.
            </T>
          )}
        </View>
      </View>
    </Card>
  )
}

export function Dictation(): ReactNode {
  const { wide, desktop } = useLayout()
  const settings = useApp((s) => s.settings!)
  const models = useApp((s) => s.models)
  const d = settings.dictation
  const asr = models.filter((m) => m.kind === 'asr' && m.installed)
  const set = (patch: Partial<typeof d>): void => void setSettings({ dictation: patch })
  const stack = !wide

  return (
    <Page maxWidth={760}>
      <PageHeader
        title="Diktat"
        subtitle={
          desktop
            ? 'Sprich in jedes Textfeld – E-Mail, Chat, Dokument. Der Text wird automatisch eingefügt.'
            : 'Kurze Notizen sprechen statt tippen. Jedes Diktat landet im Verlauf und lässt sich überall einfügen.'
        }
        actions={<Switch label="Diktat aktivieren" value={d.enabled} onChange={(v) => set({ enabled: v })} />}
      />

      <TryDictation />

      {desktop && (
        <Section title="Kurzbefehl">
          <SettingRow title="Bedienungshilfen" description="Für globale Kurzbefehle und automatisches Einfügen Flusstext in den macOS-Systemeinstellungen erlauben.">
            <Button onPress={()=>void getApi().system.requestDictationAccess().catch(error=>toast('Freigabe konnte nicht geöffnet werden','error',errorDetail(error)))}>Zugriff erlauben</Button>
          </SettingRow>
          <SettingRow title="Diktat starten" description="Funktioniert global in allen Programmen.">
            <HotkeyRecorder value={d.hotkey} onChange={hotkey=>void set({hotkey})} />
          </SettingRow>
          <SettingRow
            stack={stack}
            title="Modus"
            description={
              d.mode === 'hybrid'
                ? 'Halten zum Sprechen, kurz antippen für freihändiges Diktat.'
                : d.mode === 'hold'
                  ? 'Nur solange die Tasten gedrückt sind.'
                  : 'Einmal drücken zum Starten, erneut zum Beenden.'
            }
          >
            <Segmented<DictationMode>
              value={d.mode}
              onChange={(v) => set({ mode: v })}
              options={[
                { value: 'hybrid', label: 'Halten & Tippen' },
                { value: 'hold', label: 'Halten' },
                { value: 'toggle', label: 'Umschalten' }
              ]}
            />
          </SettingRow>
          <SettingRow title="Letztes Diktat erneut einfügen">
            <HotkeyRecorder value={d.pasteLastHotkey} onChange={pasteLastHotkey=>void set({pasteLastHotkey})} />
          </SettingRow>
          <SettingRow title="Abbrechen" description="Während der Aufnahme – nichts wird eingefügt.">
            <Hotkey keys={[1]} />
          </SettingRow>
        </Section>
      )}

      <Section title="Erkennung">
        <SettingRow stack={stack} title="Modell für Diktat" description="Schnelle Modelle sorgen für kaum spürbare Wartezeit.">
          <Select
            style={{ width: wide ? 240 : undefined, flex: wide ? 0 : 1 }}
            title="Modell für Diktat"
            value={settings.dictationModel ?? settings.transcriptionModel}
            placeholder="Kein Modell installiert"
            options={asr.map((m) => ({ value: m.id, label: m.name, hint: m.dictation ? 'Empfohlen für Diktat' : (m.recommendation ?? (m.gpu ? 'GPU' : undefined)) }))}
            onChange={(v) => void setSettings({ dictationModel: v })}
          />
        </SettingRow>
      </Section>

      <Section title="Verhalten">
        {desktop && (
          <SettingRow title="Automatisch einfügen" description="Text direkt ins aktive Textfeld einfügen. Sonst nur in die Zwischenablage kopieren.">
            <Switch label="Automatisch einfügen" value={d.autoPaste} onChange={(v) => set({ autoPaste: v })} />
          </SettingRow>
        )}
        {desktop && (
          <SettingRow title="Zwischenablage wiederherstellen" description="Nach dem Einfügen den vorherigen Inhalt zurücksetzen.">
            <Switch label="Zwischenablage wiederherstellen" value={d.restoreClipboard} onChange={(v) => set({ restoreClipboard: v })} />
          </SettingRow>
        )}
        <SettingRow title="Leerzeichen anhängen" description="Damit mehrere Diktate nahtlos aneinander passen.">
          <Switch label="Leerzeichen anhängen" value={d.trailingSpace} onChange={(v) => set({ trailingSpace: v })} />
        </SettingRow>
        {desktop && (
          <SettingRow title="Pille immer zeigen" description="Schmale Leiste unten am Bildschirm – ein Klick startet das Diktat ohne Tastatur.">
            <Switch label="Pille immer zeigen" value={d.idlePill} onChange={(v) => set({ idlePill: v })} />
          </SettingRow>
        )}
        <SettingRow title="Töne" description="Dezenter Klang bei Start und Ende.">
          <Switch label="Töne" value={d.sounds} onChange={(v) => set({ sounds: v })} />
        </SettingRow>
      </Section>

      <Section title="Wörterbuch" description="Ersetzungen für Namen und Fachbegriffe gelten auch beim Diktat.">
        <SettingRow stack={stack} title={`${settings.replacements.length} Einträge`} description="Wird ein Wort immer wieder falsch erkannt, lässt es sich dort korrigieren.">
          <Button size="sm" onPress={() => navigate({ name: 'vocabulary' })}>
            Wörterbuch öffnen
          </Button>
        </SettingRow>
      </Section>
    </Page>
  )
}

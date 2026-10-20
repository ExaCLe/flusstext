import type { ReactNode } from 'react'
import type { DictationMode } from '@shared/types'
import { HotkeyRecorder } from '../components/HotkeyRecorder'
import { Badge, Button, Card, Hotkey, PageHeader, Section, Segmented, Select, SettingRow, Switch } from '../components/ui'
import { useApp } from '../lib/store'

function ModeHint({ mode, keys }: { mode: DictationMode; keys: number[] }): ReactNode {
  const k = <Hotkey keys={keys} className="mx-0.5 align-middle" />
  if (mode === 'hold') return <span className="leading-7">Halte {k} gedrückt, sprich und lass los.</span>
  if (mode === 'toggle') return <span className="leading-7">Drück {k} zum Starten und erneut zum Einfügen.</span>
  return (
    <span className="leading-7">
      Halte {k} zum Sprechen – oder tippe kurz für freihändiges Diktat und drück erneut zum Beenden.
    </span>
  )
}

export function Dictation(): ReactNode {
  const settings = useApp((s) => s.settings!)
  const models = useApp((s) => s.models)
  const setSettings = useApp((s) => s.setSettings)
  const d = settings.dictation
  const asr = models.filter((m) => m.kind === 'asr' && m.installed)
  const set = (patch: Partial<typeof d>): Promise<void> => setSettings({ dictation: patch })

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-7 pt-8 pb-16">
        <PageHeader
          title="Diktat"
          subtitle="Sprich in jedes Textfeld – E-Mail, Chat, Dokument. Der Text wird automatisch eingefügt."
          actions={<Switch checked={d.enabled} onChange={(v) => set({ enabled: v })} />}
        />

        <Card className="mb-8 overflow-hidden">
          <div className="px-6 py-5">
            <Badge tone="accent" size="md">
              Ausprobieren
            </Badge>
            <p className="mt-2.5 text-[13.5px] text-muted">
              <ModeHint mode={d.mode} keys={d.hotkey} />
            </p>
            <textarea
              placeholder="Hier klicken und den Kurzbefehl verwenden …"
              className="selectable mt-4 h-24 w-full resize-none rounded-[10px] border border-line bg-bg px-4 py-3 text-[15px] leading-relaxed outline-none placeholder:text-muted focus:border-line-strong"
            />
          </div>
        </Card>

        <Section title="Kurzbefehl">
          <SettingRow title="Diktat starten" description="Funktioniert global in allen Programmen.">
            <HotkeyRecorder value={d.hotkey} onChange={(keys) => set({ hotkey: keys })} />
          </SettingRow>
          <SettingRow
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
            <HotkeyRecorder value={d.pasteLastHotkey} onChange={(keys) => set({ pasteLastHotkey: keys })} allowSingle={false} />
          </SettingRow>
          <SettingRow title="Abbrechen" description="Während der Aufnahme – nichts wird eingefügt.">
            <Hotkey keys={[1]} />
          </SettingRow>
        </Section>

        <Section title="Erkennung">
          <SettingRow title="Modell für Diktat" description="Schnelle Modelle sorgen für kaum spürbare Wartezeit.">
            <Select
              className="w-60"
              value={settings.dictationModel ?? settings.transcriptionModel}
              placeholder="Kein Modell installiert"
              options={asr.map((m) => ({ value: m.id, label: m.name, hint: m.dictation ? 'Empfohlen für Diktat' : m.gpu ? 'GPU' : undefined }))}
              onChange={(v) => setSettings({ dictationModel: v })}
            />
          </SettingRow>
        </Section>

        <Section title="Verhalten">
          <SettingRow title="Automatisch einfügen" description="Text direkt ins aktive Textfeld einfügen. Sonst nur in die Zwischenablage kopieren.">
            <Switch checked={d.autoPaste} onChange={(v) => set({ autoPaste: v })} />
          </SettingRow>
          <SettingRow title="Zwischenablage wiederherstellen" description="Nach dem Einfügen den vorherigen Inhalt zurücksetzen.">
            <Switch checked={d.restoreClipboard} onChange={(v) => set({ restoreClipboard: v })} />
          </SettingRow>
          <SettingRow title="Leerzeichen anhängen" description="Damit mehrere Diktate nahtlos aneinander passen.">
            <Switch checked={d.trailingSpace} onChange={(v) => set({ trailingSpace: v })} />
          </SettingRow>
          <SettingRow title="Pille immer zeigen" description="Schmale Leiste unten am Bildschirm – ein Klick startet das Diktat ohne Tastatur.">
            <Switch checked={d.idlePill} onChange={(v) => set({ idlePill: v })} />
          </SettingRow>
          <SettingRow title="Töne" description="Dezenter Klang bei Start und Ende.">
            <Switch checked={d.sounds} onChange={(v) => set({ sounds: v })} />
          </SettingRow>
        </Section>

        <Section title="Wörterbuch" description="Ersetzungen für Namen und Fachbegriffe gelten auch beim Diktat.">
          <SettingRow title={`${settings.replacements.length} Einträge`} description="Wird ein Wort immer wieder falsch erkannt, lässt es sich dort korrigieren.">
            <Button size="sm" onClick={() => useApp.getState().navigate({ name: 'vocabulary' })}>
              Wörterbuch öffnen
            </Button>
          </SettingRow>
        </Section>
      </div>
    </div>
  )
}

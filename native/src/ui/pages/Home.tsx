import { ArrowRight, AudioLines, FileUp, Mic } from 'lucide-react-native'
import { useMemo, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { Card, EmptyState, Hotkey, T, type Icon } from '../components'
import { greeting, num } from '../format'
import { load, navigate, pickAndTranscribe, useApp } from '../store'
import { tabular, useLayout, useTheme } from '../theme'
import { DictationRow, Page, SectionHead, TranscriptRow } from './common'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): ReactNode {
  const c = useTheme()
  return (
    <View style={{ paddingHorizontal: 20, paddingVertical: 16 }}>
      <T size={12} color={c.muted}>
        {label}
      </T>
      <T size={22} weight={600} style={[tabular, { marginTop: 4, letterSpacing: -0.44 }]}>
        {value}
      </T>
      {hint && (
        <T size={11.5} color={c.faint} style={{ marginTop: 2 }}>
          {hint}
        </T>
      )}
    </View>
  )
}

function QuickAction({ icon: IconC, title, text, onPress }: { icon: Icon; title: string; text: string; onPress: () => void }): ReactNode {
  const c = useTheme()
  const { wide } = useLayout()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={text}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: wide ? 1 : undefined,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: pressed ? c.lineStrong : c.line,
        backgroundColor: c.panel,
        padding: 16,
        transform: [{ scale: pressed ? 0.99 : 1 }]
      })}
    >
      <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <IconC size={18} color={c.fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T size={13.5} weight={600}>
          {title}
        </T>
        <T size={12.5} color={c.muted} style={{ lineHeight: 17 }}>
          {text}
        </T>
      </View>
      <ArrowRight size={16} color={c.muted} />
    </Pressable>
  )
}

export function Home(): ReactNode {
  const c = useTheme()
  const { wide, desktop } = useLayout()
  const dictations = useApp((s) => s.dictations)
  const transcripts = useApp((s) => s.transcripts)
  const settings = useApp((s) => s.settings!)

  const stats = useMemo(() => {
    const words = dictations.reduce((n, d) => n + d.words, 0)
    const seconds = dictations.reduce((n, d) => n + d.duration, 0)
    const wpm = seconds > 0 ? Math.round(words / (seconds / 60)) : 0
    // Gegenüber Tippen mit ~40 WPM gesparte Zeit
    const saved = Math.max(0, words / 40 - seconds / 60)
    const audio = transcripts.reduce((n, t) => n + t.duration, 0)
    return { words, wpm, saved, audio }
  }, [dictations, transcripts])

  const statItems = [
    { label: 'Diktierte Wörter', value: num(stats.words) },
    { label: 'Sprechtempo', value: stats.wpm ? `${stats.wpm} WPM` : '–', hint: 'Tippen: ca. 40 WPM' },
    { label: 'Zeit gespart', value: stats.saved >= 60 ? `${(stats.saved / 60).toFixed(1).replace('.', ',')} h` : `${Math.round(stats.saved)} min` },
    {
      label: 'Transkribiert',
      value: stats.audio >= 3600 ? `${(stats.audio / 3600).toFixed(1).replace('.', ',')} h` : `${Math.round(stats.audio / 60)} min`,
      hint: `${transcripts.length} Transkripte`
    }
  ]

  return (
    <Page onRefresh={load}>
      <T size={30} weight={600} style={{ letterSpacing: -0.6, lineHeight: 35 }} accessibilityRole="header">
        {greeting()}
      </T>
      {settings.dictation.enabled && desktop ? (
        <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <T size={14} color={c.muted}>
            Halte
          </T>
          <Hotkey keys={settings.dictation.hotkey} />
          <T size={14} color={c.muted}>
            in einem beliebigen Textfeld und sprich los.
          </T>
        </View>
      ) : (
        <T size={14} color={c.muted} style={{ marginTop: 8, lineHeight: 20 }}>
          {desktop ? 'Transkribiere Dateien und Aufnahmen – komplett lokal auf deinem Rechner.' : 'Transkribiere Dateien und Aufnahmen – komplett lokal auf deinem Gerät.'}
        </T>
      )}

      <View style={{ marginTop: 28, flexDirection: wide ? 'row' : 'column', gap: 12 }}>
        <QuickAction icon={FileUp} title="Datei transkribieren" text={desktop ? 'Audio & Video, auch per Drag & Drop' : 'Audio & Video aus deinen Dateien'} onPress={() => void pickAndTranscribe()} />
        <QuickAction icon={Mic} title="Aufnahme starten" text="Live mitschreiben, mit Sprechern" onPress={() => navigate({ name: 'record' })} />
        <QuickAction icon={AudioLines} title="Diktat einrichten" text={desktop ? 'Kurzbefehl, Modus, Modell' : 'Modus, Modell, Verhalten'} onPress={() => navigate({ name: 'dictation' })} />
      </View>

      {stats.words + transcripts.length > 0 && (
        <Card style={{ marginTop: 16, flexDirection: 'row', flexWrap: 'wrap' }}>
          {statItems.map((s, i) => (
            <View
              key={s.label}
              style={{
                width: wide ? '25%' : '50%',
                borderLeftWidth: (wide ? i > 0 : i % 2 === 1) ? 1 : 0,
                borderTopWidth: !wide && i >= 2 ? 1 : 0,
                borderColor: c.line
              }}
            >
              <Stat label={s.label} value={s.value} hint={s.hint} />
            </View>
          ))}
        </Card>
      )}

      <SectionHead title="Zuletzt transkribiert" onAll={transcripts.length > 4 ? () => navigate({ name: 'library' }) : undefined} />
      {transcripts.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileUp}
            title="Noch keine Transkripte"
            text={desktop ? 'Zieh eine Audio- oder Videodatei ins Fenster oder starte eine Aufnahme.' : 'Wähle eine Audio- oder Videodatei aus oder starte eine Aufnahme.'}
          />
        </Card>
      ) : (
        <Card divided>
          {transcripts.slice(0, 4).map((t) => (
            <TranscriptRow key={t.id} t={t} />
          ))}
        </Card>
      )}

      {dictations.length > 0 && (
        <>
          <SectionHead title="Letzte Diktate" onAll={() => navigate({ name: 'history' })} />
          <Card divided>
            {dictations.slice(0, 3).map((d) => (
              <DictationRow key={d.id} entry={d} />
            ))}
          </Card>
        </>
      )}
    </Page>
  )
}

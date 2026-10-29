// Gemeinsame Zeilen und Seitenrahmen für mehrere Seiten.
import { ArrowRight, Check, CircleAlert, Copy, FileAudio2, Mic, Trash2, Users } from 'lucide-react-native'
import { useState, type ReactNode } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View, type ScrollViewProps } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DictationEntry, TranscriptMeta } from '../../core/contracts'
import { Badge, Confirm, Highlight, IconButton, LinkButton, Select, Switch, T } from '../components'
import { clock, num, relative, time } from '../format'
import { attempt, getApi, navigate, setSettings, useApp, useDiarizationReady } from '../store'
import { font, mono, useLayout, useTheme } from '../theme'

/** Scrollbarer Seiteninhalt mit zentrierter Maximalbreite wie auf dem Desktop. */
export function Page({
  children,
  maxWidth = 880,
  onRefresh,
  ...rest
}: { children: ReactNode; maxWidth?: number; onRefresh?: () => Promise<unknown> } & Omit<ScrollViewProps, 'children'>): ReactNode {
  const c = useTheme()
  const { pad, wide } = useLayout()
  const insets = useSafeAreaInsets()
  const [refreshing, setRefreshing] = useState(false)
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingHorizontal: pad, paddingTop: wide ? 32 : 20, paddingBottom: 64 + (wide ? 0 : insets.bottom) }}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            tintColor={c.muted}
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true)
              try {
                await onRefresh()
              } finally {
                setRefreshing(false)
              }
            }}
          />
        ) : undefined
      }
      {...rest}
    >
      <View style={{ width: '100%', maxWidth, alignSelf: 'center' }}>{children}</View>
    </ScrollView>
  )
}

export function SectionHead({ title, onAll }: { title: string; onAll?: () => void }): ReactNode {
  const c = useTheme()
  return (
    <View style={{ marginTop: 40, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingHorizontal: 4 }}>
      <T size={14} weight={600} accessibilityRole="header">
        {title}
      </T>
      {onAll && (
        <Pressable accessibilityRole="button" onPress={onAll} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <T size={13} color={c.muted}>
            Alle anzeigen
          </T>
          <ArrowRight size={14} color={c.muted} />
        </Pressable>
      )}
    </View>
  )
}

function Dot(): ReactNode {
  const c = useTheme()
  return (
    <T size={12} color={c.muted}>
      ·
    </T>
  )
}

export function TranscriptRow({ t, snippet, query = '' }: { t: TranscriptMeta; snippet?: string; query?: string }): ReactNode {
  const c = useTheme()
  const [confirm, setConfirm] = useState(false)
  const recording = t.source === 'recording'
  const IconC = recording ? Mic : FileAudio2
  const body = t.status === 'error' ? t.error : snippet || t.preview
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.title}
        onPress={() => navigate({ name: 'transcript', id: t.id })}
        onLongPress={() => setConfirm(true)}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'flex-start', gap: 16, paddingHorizontal: 20, paddingVertical: 16, backgroundColor: pressed ? c.surface : 'transparent' })}
      >
        <View
          style={{
            marginTop: 2,
            width: 36,
            height: 36,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: recording ? c.dangerSoft : c.surface2
          }}
        >
          <IconC size={16} color={recording ? c.dangerText : c.fg2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Highlight text={t.title} query={query} lines={1} style={[font(500), { fontSize: 14, color: c.fg, flexShrink: 1 }]} />
            {t.status === 'processing' && <Badge tone="accent">In Arbeit</Badge>}
            {t.status === 'error' && (
              <Badge tone="danger" icon={CircleAlert}>
                Fehler
              </Badge>
            )}
          </View>
          <View style={{ marginTop: 2, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8 }}>
            <T size={12} color={c.muted}>
              {relative(t.createdAt)}
            </T>
            <Dot />
            <Text style={[mono, { fontSize: 12, color: c.muted }]}>{clock(t.duration)}</Text>
            {t.speakerCount > 1 && (
              <>
                <Dot />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Users size={12} color={c.muted} />
                  <T size={12} color={c.muted}>
                    {t.speakerCount}
                  </T>
                </View>
              </>
            )}
            {t.words > 0 && (
              <>
                <Dot />
                <T size={12} color={c.muted}>
                  {num(t.words)} Wörter
                </T>
              </>
            )}
          </View>
          {body ? (
            <Highlight
              text={body}
              query={t.status === 'error' || !snippet ? '' : query}
              lines={2}
              style={[font(400), { marginTop: 6, fontSize: 13, lineHeight: 20, color: t.status === 'error' ? c.dangerText : c.fg2 }]}
            />
          ) : null}
        </View>
        <IconButton icon={Trash2} label="Löschen" onPress={() => setConfirm(true)} />
      </Pressable>
      <Confirm
        open={confirm}
        title="Transkript löschen?"
        text={`„${t.title}“ wird dauerhaft entfernt. Die Originaldatei bleibt erhalten.`}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          await attempt('Transkript konnte nicht gelöscht werden', () => getApi().transcripts.remove(t.id))
          setConfirm(false)
        }}
      />
    </>
  )
}

export function DictationRow({ entry, query = '', meta }: { entry: DictationEntry; query?: string; meta?: boolean }): ReactNode {
  const c = useTheme()
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    const ok = await attempt('Kopieren fehlgeschlagen', () => getApi().dictation.copy(entry.text))
    if (ok === undefined) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <View style={{ flexDirection: 'row', gap: 16, paddingLeft: 20, paddingRight: 12, paddingVertical: 14 }}>
      <Text style={[mono, { width: 44, paddingTop: 3, fontSize: 12, color: c.muted }]}>{time(entry.createdAt)}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Highlight text={entry.text} query={query} style={[font(400), { fontSize: meta ? 14.5 : 13.5, lineHeight: meta ? 23 : 21, color: c.fg }]} />
        {meta && (
          <T size={12} color={c.faint} style={{ marginTop: 4 }}>
            {entry.words === 1 ? '1 Wort' : `${num(entry.words)} Wörter`} · {Math.max(1, Math.round(entry.duration))} s gesprochen
          </T>
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 2 }}>
        <IconButton icon={copied ? Check : Copy} color={copied ? c.success : undefined} label="Kopieren" onPress={copy} />
        <IconButton
          icon={Trash2}
          label="Löschen"
          onPress={() => void attempt('Diktat konnte nicht gelöscht werden', () => getApi().dictation.remove(entry.id))}
        />
      </View>
    </View>
  )
}

export const SPEAKER_COUNTS = (max: number): { value: string; label: string }[] => [
  { value: '0', label: 'Automatisch' },
  ...[2, 3, 4, 5, 6, 8].filter((n) => n <= max).map((n) => ({ value: String(n), label: `${n} Sprecher` }))
]

export function TranscribeOptionsBar(): ReactNode {
  const c = useTheme()
  const { wide } = useLayout()
  const settings = useApp((s) => s.settings!)
  const models = useApp((s) => s.models)
  const asr = models.filter((m) => m.kind === 'asr' && m.installed)
  const diarReady = useDiarizationReady()
  const diarOn = settings.diarization.enabled && diarReady
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 }
  return (
    <View style={{ flexDirection: wide ? 'row' : 'column', flexWrap: 'wrap', alignItems: wide ? 'center' : 'stretch', columnGap: 20, rowGap: 12, paddingHorizontal: 20, paddingVertical: 14 }}>
      <View style={row}>
        <T size={13} color={c.muted}>
          Modell
        </T>
        <Select
          style={{ width: wide ? 224 : undefined, flex: wide ? 0 : 1 }}
          title="Modell für Transkription"
          value={settings.transcriptionModel}
          placeholder="Kein Modell installiert"
          options={asr.map((m) => ({ value: m.id, label: m.name, hint: m.recommendation ?? (m.gpu ? 'GPU' : 'CPU') }))}
          onChange={(v) => void setSettings({ transcriptionModel: v })}
        />
      </View>
      <View style={[row, !wide && { justifyContent: 'space-between' }]}>
        {wide && <Switch label="Sprecher erkennen" value={diarOn} disabled={!diarReady} onChange={(v) => void setSettings({ diarization: { enabled: v } })} />}
        <T size={13} color={c.muted}>
          Sprecher erkennen
        </T>
        {!wide && <Switch label="Sprecher erkennen" value={diarOn} disabled={!diarReady} onChange={(v) => void setSettings({ diarization: { enabled: v } })} />}
      </View>
      {diarOn && (
        <View style={row}>
          <T size={13} color={c.muted}>
            Anzahl
          </T>
          <Select
            style={{ width: wide ? 144 : undefined, flex: wide ? 0 : 1 }}
            title="Anzahl Sprecher"
            value={String(settings.diarization.numSpeakers)}
            options={SPEAKER_COUNTS(8)}
            onChange={(v) => void setSettings({ diarization: { numSpeakers: Number(v) } })}
          />
        </View>
      )}
      {!diarReady && <LinkButton onPress={() => navigate({ name: 'models' })}>Sprechererkennung installieren</LinkButton>}
    </View>
  )
}

import { Bookmark, Mic, Pause, Play, Trash2, X } from 'lucide-react-native'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, Card, Confirm, IconButton, LinkButton, PulseDot, Select, Spinner, Switch, T } from '../components'
import { clock, defaultTitle } from '../format'
import {
  addBookmark,
  discardRecording,
  navigate,
  setLive,
  setSettings,
  startRecording,
  stopRecording,
  togglePause,
  transcriptionModel,
  useApp,
  useDiarizationReady
} from '../store'
import { nativeAnimations, font, mono, useLayout, useTheme } from '../theme'
import { SPEAKER_COUNTS } from './common'

/** Status-Kapsel links in der Kopfzeile. */
function StatusPill(): ReactNode {
  const c = useTheme()
  const phase = useApp((s) => s.recording.phase)
  const elapsed = useApp((s) => Math.floor(s.recording.elapsed))
  const pending = useApp((s) => s.live.pending)
  const pill = { height: 36, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, borderRadius: 999, paddingLeft: 12, paddingRight: 14 }
  if (pending || phase === 'processing')
    return (
      <View style={[pill, { backgroundColor: c.surface2 }]}>
        <Spinner color={c.fg2} />
        <T size={13} weight={600} color={c.fg2}>
          {pending === 'starting' ? 'Startet' : 'Wird gespeichert'}
        </T>
      </View>
    )
  if (phase === 'recording' || phase === 'paused') {
    const paused = phase === 'paused'
    return (
      <View style={[pill, { backgroundColor: paused ? c.surface2 : c.dangerSoft }]} accessibilityLiveRegion="polite">
        <PulseDot color={paused ? c.muted : c.danger} size={9} active={!paused} />
        <T size={13} weight={600} color={paused ? c.fg2 : c.dangerText}>
          {paused ? 'Pausiert' : 'Aufnahme'}
        </T>
        <Text style={[mono, { fontSize: 13, color: paused ? c.fg2 : c.dangerText, opacity: 0.8 }]}>{clock(elapsed)}</Text>
      </View>
    )
  }
  return (
    <View style={[pill, { backgroundColor: c.surface2 }]}>
      <View style={{ width: 9, height: 9, borderRadius: 9, backgroundColor: c.faint }} />
      <T size={13} weight={600} color={c.fg2}>
        Bereit
      </T>
    </View>
  )
}

/** Pegelanzeige unter dem Live-Transkript. */
function LevelMeter({ active }: { active: boolean }): ReactNode {
  const c = useTheme()
  const { wide } = useLayout()
  const levels = useApp((s) => s.live.levels)
  const bars = wide ? 64 : 36
  const data = levels.slice(-bars)
  const padded = [...Array(Math.max(0, bars - data.length)).fill(0), ...data] as number[]
  const recent = levels.slice(-40)
  const peak = recent.length ? Math.max(...recent) : 0
  const loud = active && peak >= 0.98
  const status = !active ? 'Mikrofon aus' : loud ? 'Zu laut – Abstand halten' : peak < 0.08 ? 'Wartet auf Sprache' : 'Pegel gut'
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, borderTopWidth: 1, borderTopColor: c.lineSoft, backgroundColor: c.bg, paddingHorizontal: 20, paddingVertical: 14 }}>
      <Mic size={16} color={c.fg} />
      <View style={{ flex: 1, height: 32, flexDirection: 'row', alignItems: 'center', gap: 3, overflow: 'hidden' }} importantForAccessibility="no-hide-descendants">
        {padded.map((l, i) => (
          <View key={i} style={{ flex: 1, minWidth: 2, borderRadius: 2, height: Math.max(4, Math.round(6 + l * 26)), backgroundColor: active && l > 0.04 ? c.fg : c.lineStrong }} />
        ))}
      </View>
      <T size={12} color={loud ? c.dangerText : c.muted} style={{ textAlign: 'right' }}>
        {status}
      </T>
    </View>
  )
}

function SideCard({ title, aside, children, grow }: { title: string; aside?: string; children: ReactNode; grow?: boolean }): ReactNode {
  const c = useTheme()
  return (
    <Card style={{ gap: 14, borderRadius: 16, padding: 18, flexGrow: grow ? 1 : 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <T size={14} weight={600}>
          {title}
        </T>
        {aside && (
          <T size={12} color={c.muted}>
            {aside}
          </T>
        )}
      </View>
      {children}
    </Card>
  )
}

/** Drei wippende Balken neben „Spricht“. */
function Bars(): ReactNode {
  const c = useTheme()
  const v = useRef([0, 1, 2].map(() => new Animated.Value(0.25))).current
  useEffect(() => {
    const loops = v.map((x, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 200),
          Animated.timing(x, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: nativeAnimations }),
          Animated.timing(x, { toValue: 0.25, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: nativeAnimations })
        ])
      )
    )
    loops.forEach((l) => l.start())
    return () => loops.forEach((l) => l.stop())
  }, [v])
  return (
    <View style={{ height: 12, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {v.map((x, i) => (
        <Animated.View key={i} style={{ width: 2, height: 12, borderRadius: 1, backgroundColor: c.accent, transform: [{ scaleY: x }] }} />
      ))}
    </View>
  )
}

function LiveTranscript({ recording, modelReady }: { recording: boolean; modelReady: boolean }): ReactNode {
  const c = useTheme()
  const { wide } = useLayout()
  const text = useApp((s) => s.recording.text ?? '')
  const paused = useApp((s) => s.recording.phase === 'paused')
  const diarReady = useDiarizationReady()
  const diarOn = useApp((s) => !!s.settings?.diarization.enabled) && diarReady
  const scroll = useRef<ScrollView>(null)

  return (
    <View
      accessibilityLabel="Live-Transkript"
      style={{ flex: wide ? 1 : undefined, minHeight: wide ? 0 : 320, borderRadius: 16, borderWidth: 1, borderColor: c.line, backgroundColor: c.panel, overflow: 'hidden' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: c.lineSoft, paddingHorizontal: 20, paddingVertical: 14 }}>
        <T size={14} weight={600}>
          Live-Transkript
        </T>
        <T size={12} color={c.muted} lines={1} style={{ flex: 1 }}>
          {diarOn ? 'Sprecher werden nach dem Stopp zugeordnet' : 'Ohne Sprechererkennung'}
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 6, backgroundColor: c.success }} />
          <T size={12} weight={500} color={c.successText}>
            Auf dem Gerät
          </T>
        </View>
      </View>

      <ScrollView
        ref={scroll}
        style={{ flex: 1, minHeight: wide ? 0 : 220, maxHeight: wide ? undefined : 380 }}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 8, paddingTop: 12, paddingBottom: 20 }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        nestedScrollEnabled
      >
        {!text ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32 }}>
            <View style={{ marginBottom: 16, width: 48, height: 48, borderRadius: 16, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Mic size={20} color={c.muted} />
            </View>
            <T size={15} weight={600} style={{ textAlign: 'center' }}>
              {recording ? 'Sprich einfach los' : 'Noch keine Aufnahme'}
            </T>
            <T size={13} color={c.muted} style={{ marginTop: 4, maxWidth: 384, textAlign: 'center', lineHeight: 20 }}>
              {recording
                ? 'Der Text erscheint hier fortlaufend, sobald du eine kurze Pause machst.'
                : modelReady
                  ? 'Meetings, Interviews oder Notizen live mitschreiben – komplett lokal.'
                  : 'Bitte zuerst unter Modelle ein Transkriptionsmodell herunterladen.'}
            </T>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 14, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: recording && !paused ? c.accentSoft : 'transparent' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              {recording && !paused && (
                <View style={{ marginBottom: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T size={13} weight={600} color={c.accentText}>
                    Spricht
                  </T>
                  <Bars />
                </View>
              )}
              <Text selectable style={[font(400), { fontSize: 16, lineHeight: 26, color: c.fg }]}>
                {text}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      <LevelMeter active={recording && !paused} />
    </View>
  )
}

export function Record(): ReactNode {
  const c = useTheme()
  const { wide, pad } = useLayout()
  const insets = useSafeAreaInsets()
  const settings = useApp((s) => s.settings!)
  const model = useApp((s) => transcriptionModel(s))
  const phase = useApp((s) => s.recording.phase)
  const live = useApp((s) => s.live)
  const diarReady = useDiarizationReady()
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const diarOn = settings.diarization.enabled && diarReady
  const recording = phase === 'recording' || phase === 'paused'
  const busy = phase !== 'idle' || live.pending !== null
  const placeholderTitle = useMemo(() => defaultTitle(live.startedAt || Date.now()), [live.startedAt])

  const stop = async (): Promise<void> => {
    const id = await stopRecording(diarOn, settings.diarization.numSpeakers)
    if (id) navigate({ name: 'transcript', id })
  }

  const controls = recording ? (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <Button size="lg" icon={Bookmark} onPress={addBookmark}>
        Lesezeichen
      </Button>
      <Button size="lg" icon={phase === 'paused' ? Play : Pause} onPress={() => void togglePause()} disabled={live.pending !== null}>
        {phase === 'paused' ? 'Fortsetzen' : 'Pause'}
      </Button>
      <IconButton icon={Trash2} label="Aufnahme verwerfen" size={40} disabled={live.pending !== null} onPress={() => setConfirmDiscard(true)} />
      <Button size="lg" variant="primary" loading={live.pending === 'finishing'} onPress={() => void stop()} grow={!wide}>
        <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: c.inkFg }} />
        <T size={13.5} weight={500} color={c.inkFg}>
          Stopp & speichern
        </T>
      </Button>
    </View>
  ) : (
    <Button size="lg" variant="accent" icon={Mic} loading={busy} disabled={busy || !model?.installed} onPress={() => void startRecording()}>
      Aufnahme starten
    </Button>
  )

  const rail = (
    <View style={{ width: wide ? 320 : undefined, gap: 16 }}>
      <SideCard title="Sprecher" aside={diarOn ? (settings.diarization.numSpeakers ? `${settings.diarization.numSpeakers} erwartet` : 'Automatisch') : 'Aus'}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <T size={13} weight={500}>
              Sprecher erkennen
            </T>
            <T size={12} color={c.muted}>
              {diarReady ? 'Ordnet jeden Satz einer Person zu.' : 'Modelle dafür fehlen noch.'}
            </T>
          </View>
          <Switch
            label="Sprecher erkennen"
            value={diarOn}
            disabled={!diarReady || live.pending === 'finishing'}
            onChange={(v) => void setSettings({ diarization: { enabled: v } })}
          />
        </View>
        {diarOn ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <T size={13} weight={500}>
              Anzahl
            </T>
            <Select
              style={{ width: 160 }}
              title="Anzahl Sprecher"
              value={String(settings.diarization.numSpeakers)}
              options={SPEAKER_COUNTS(6)}
              onChange={(v) => void setSettings({ diarization: { numSpeakers: Number(v) } })}
            />
          </View>
        ) : (
          !diarReady && <LinkButton onPress={() => navigate({ name: 'models' })}>Sprechererkennung installieren</LinkButton>
        )}
      </SideCard>

      <SideCard title="Momente" aside={live.bookmarks.length ? `${live.bookmarks.length}` : undefined}>
        {live.bookmarks.length === 0 ? (
          <T size={13} color={c.muted} style={{ lineHeight: 20 }}>
            Markiere wichtige Stellen mit „Lesezeichen“. Sie erscheinen später im Transkript.
          </T>
        ) : (
          <View style={{ gap: 2, marginHorizontal: -4 }}>
            {live.bookmarks.map((b, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 }}>
                <Text style={[mono, { width: 40, fontSize: 12, color: c.muted }]}>{clock(b.time)}</Text>
                <TextInput
                  value={b.label}
                  accessibilityLabel="Name des Lesezeichens"
                  onChangeText={(v) => setLive((l) => ({ bookmarks: l.bookmarks.map((x, j) => (j === i ? { ...x, label: v } : x)) }))}
                  style={[font(400), { flex: 1, fontSize: 13, color: c.fg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 6 }]}
                />
                <IconButton
                  icon={X}
                  label="Lesezeichen entfernen"
                  size={28}
                  onPress={() => setLive((l) => ({ bookmarks: l.bookmarks.filter((_, j) => j !== i) }))}
                />
              </View>
            ))}
          </View>
        )}
      </SideCard>

      <SideCard title="Deine Notizen" grow={wide}>
        <TextInput
          value={live.notes}
          onChangeText={(v) => setLive({ notes: v })}
          multiline
          textAlignVertical="top"
          accessibilityLabel="Deine Notizen"
          placeholder="Schreib mit, während du zuhörst. Die Notizen werden mit dem Transkript gespeichert."
          placeholderTextColor={c.muted}
          style={[
            font(400),
            { minHeight: 120, flexGrow: 1, borderRadius: 10, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg, padding: 12, fontSize: 13, lineHeight: 20, color: c.fg }
          ]}
        />
      </SideCard>
    </View>
  )

  const header = (
    <View
      style={{
        flexDirection: wide ? 'row' : 'column',
        flexWrap: 'wrap',
        alignItems: wide ? 'center' : 'stretch',
        gap: 16,
        borderBottomWidth: 1,
        borderBottomColor: c.line,
        backgroundColor: c.panel,
        paddingHorizontal: pad,
        paddingVertical: 16
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flex: wide ? 1 : undefined, minWidth: 0 }}>
        <StatusPill />
        <View style={{ flex: 1, minWidth: 0 }}>
          <TextInput
            value={live.title}
            onChangeText={(v) => setLive({ title: v })}
            placeholder={placeholderTitle}
            placeholderTextColor={c.fg}
            accessibilityLabel="Titel der Aufnahme"
            returnKeyType="done"
            style={[font(600), { fontSize: 16, letterSpacing: -0.16, color: c.fg, paddingVertical: 0 }]}
          />
          <T size={12} color={c.muted} lines={1}>
            Mikrofon des Geräts · {model ? model.name : 'Kein Modell installiert'}
          </T>
        </View>
      </View>
      {controls}
    </View>
  )

  return (
    <View style={{ flex: 1 }}>
      {wide ? (
        <>
          {header}
          <View style={{ flex: 1, flexDirection: 'row', gap: 24, paddingHorizontal: pad, paddingTop: 24, paddingBottom: 28 }}>
            <LiveTranscript recording={recording} modelReady={!!model?.installed} />
            <ScrollView style={{ width: 320, flexGrow: 0 }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
              {rail}
            </ScrollView>
          </View>
        </>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" stickyHeaderIndices={[0]} contentContainerStyle={{ paddingBottom: 48 + insets.bottom }}>
          {header}
          <View style={{ gap: 16, paddingHorizontal: pad, paddingTop: 20 }}>
            <LiveTranscript recording={recording} modelReady={!!model?.installed} />
            {rail}
          </View>
        </ScrollView>
      )}

      <Confirm
        open={confirmDiscard}
        title="Aufnahme verwerfen?"
        text="Audio, Live-Text, Notizen und Lesezeichen dieser Aufnahme werden nicht gespeichert."
        confirm="Verwerfen"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={async () => {
          await discardRecording()
          setConfirmDiscard(false)
        }}
      />
    </View>
  )
}

import { ArrowDownToLine, Check, ChevronDown, CircleAlert, Copy, FileQuestion, FolderOpen, Pause, Play, Plus, Trash2, X } from 'lucide-react-native'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, View, type LayoutChangeEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ExportFormat, Transcript } from '../../core/contracts'
import { LANGUAGES, type Bookmark, type Segment, type Speaker } from '../../../../src/shared/types'
import { Avatar, Badge, Button, Card, Confirm, EmptyState, IconButton, MenuItem, Modal, Progress, Select, Sheet, Spinner, Switch, T } from '../components'
import { clock, dateLine, longDuration, stamp } from '../format'
import { ACTIVE_JOB, attempt, errorDetail, getApi, goBack, toast, useApp } from '../store'
import { font, mono, speakerColor, useLayout, useTheme } from '../theme'

// ------------------------------------------------------------ Hilfsfunktionen

interface Block {
  key: string
  speaker?: number
  start: number
  end: number
  segments: Segment[]
}

function toBlocks(segments: Segment[]): Block[] {
  const out: Block[] = []
  for (const s of segments) {
    const last = out[out.length - 1]
    if (last && last.speaker === s.speaker && s.start - last.end < 8) {
      last.segments.push(s)
      last.end = s.end
    } else out.push({ key: s.id, speaker: s.speaker, start: s.start, end: s.end, segments: [s] })
  }
  return out
}

function speakerName(speakers: Speaker[], id?: number): string {
  if (id === undefined) return ''
  return speakers.find((s) => s.id === id)?.name ?? `Sprecher ${id + 1}`
}

/** Startzeit jedes Wortes – aus der Erkennung oder gleichmäßig nach Zeichen verteilt. */
function wordTimes(s: Segment, words: string[]): number[] {
  if (s.words && s.words.length === words.length) return s.words
  const total = words.reduce((n, w) => n + w.length + 1, 0) || 1
  let acc = 0
  return words.map((w) => {
    const t = s.start + (acc / total) * (s.end - s.start)
    acc += w.length + 1
    return t
  })
}

function speakerStats(t: Transcript): { id: number; sec: number; share: number }[] {
  const m = new Map<number, number>()
  for (const s of t.segments) if (s.speaker !== undefined) m.set(s.speaker, (m.get(s.speaker) ?? 0) + (s.end - s.start))
  const total = [...m.values()].reduce((a, b) => a + b, 0) || 1
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([id, sec]) => ({ id, sec, share: sec / total }))
}

function splitHighlight(text: string, q: string, mark: string): ReactNode {
  if (!q) return text
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return parts.map((p, i) =>
    i % 2 ? (
      <Text key={i} style={{ backgroundColor: mark }}>
        {p}
      </Text>
    ) : (
      p
    )
  )
}

// ------------------------------------------------------------ Export

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'docx', label: 'Word (.docx)', hint: 'Formatiert mit Sprechern' },
  { id: 'txt', label: 'Text (.txt)', hint: 'Reiner Text' },
  { id: 'md', label: 'Markdown (.md)', hint: 'Für Notizen-Apps' },
  { id: 'srt', label: 'Untertitel (.srt)', hint: 'Für Videoplayer' },
  { id: 'vtt', label: 'WebVTT (.vtt)', hint: 'Untertitel fürs Web' },
  { id: 'json', label: 'JSON', hint: 'Mit allen Zeitstempeln' }
]

function ExportMenu({ t }: { t: Transcript }): ReactNode {
  const c = useTheme()
  const [open, setOpen] = useState(false)
  const [speakers, setSpeakers] = useState(true)
  const [timestamps, setTimestamps] = useState(true)
  const [busy, setBusy] = useState(false)
  const run = async (f: ExportFormat): Promise<void> => {
    setOpen(false)
    setBusy(true)
    try {
      await getApi().transcripts.export(t.id, f, { speakers, timestamps })
      toast('Exportiert', 'success')
    } catch (e) {
      toast('Export fehlgeschlagen', 'error', errorDetail(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button size="lg" icon={ArrowDownToLine} iconRight={ChevronDown} loading={busy} onPress={() => setOpen(true)}>
        Exportieren
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Exportieren">
        {FORMATS.map((f) => (
          <MenuItem key={f.id} label={f.label} hint={f.hint} onPress={() => void run(f.id)} />
        ))}
        <View style={{ marginVertical: 4, height: 1, backgroundColor: c.line }} />
        <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10 }}>
          <T size={13}>Sprecher einfügen</T>
          <Switch label="Sprecher einfügen" value={speakers} onChange={setSpeakers} />
        </View>
        <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10 }}>
          <T size={13}>Zeitstempel einfügen</T>
          <Switch label="Zeitstempel einfügen" value={timestamps} onChange={setTimestamps} />
        </View>
      </Sheet>
    </>
  )
}

// ------------------------------------------------------------ Player

function Waveform({ t, time, dur, onSeek }: { t: Transcript; time: number; dur: number; onSeek: (sec: number) => void }): ReactNode {
  const c = useTheme()
  const [width, setWidth] = useState(0)
  const [scrub, setScrub] = useState<number | null>(null)
  const count = Math.max(30, Math.floor(width / 5))
  const peaks = t.peaks?.length ? t.peaks : null

  const bars = useMemo(() => {
    const hasSpeakers = t.segments.some((s) => s.speaker !== undefined)
    let seg = 0
    return Array.from({ length: count }, (_, i) => {
      let v = 0
      if (peaks) {
        const a = Math.floor((i / count) * peaks.length)
        const b = Math.max(a + 1, Math.floor(((i + 1) / count) * peaks.length))
        for (let j = a; j < b; j++) v = Math.max(v, peaks[j])
      }
      const mid = ((i + 0.5) / count) * dur
      while (seg < t.segments.length - 1 && t.segments[seg].end < mid) seg++
      const s = t.segments[seg]
      const inSpeech = s && mid >= s.start - 0.3 && mid <= s.end + 0.3
      const color = !inSpeech ? c.lineStrong : hasSpeakers ? speakerColor(c, s.speaker) : c.fg
      // Ohne Pegeldaten zeigen Sprachabschnitte einen mittleren Balken, Pausen einen flachen
      const h = peaks ? Math.max(4, Math.round(4 + Math.pow(v, 0.75) * 34)) : inSpeech ? 14 : 4
      return { h, color, at: mid }
    })
  }, [peaks, count, t.segments, dur, c])

  const at = (x: number): number => Math.max(0, Math.min(dur, (x / Math.max(1, width)) * dur))
  const shown = scrub ?? time

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel="Wiedergabeposition"
      accessibilityValue={{ text: `${stamp(time)} von ${stamp(dur)}` }}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => setScrub(at(e.nativeEvent.locationX))}
      onResponderMove={(e) => setScrub(at(e.nativeEvent.locationX))}
      onResponderRelease={(e) => {
        setScrub(null)
        onSeek(at(e.nativeEvent.locationX))
      }}
      style={{ height: 40, flexDirection: 'row', alignItems: 'center', gap: 2, overflow: 'hidden' }}
    >
      {width > 0 &&
        bars.map((b, i) => <View key={i} pointerEvents="none" style={{ flex: 1, minWidth: 2, height: b.h, borderRadius: 2, backgroundColor: b.color, opacity: b.at <= shown ? 1 : 0.28 }} />)}
    </View>
  )
}

function SpeakerStrip({ t, dur, bookmarks }: { t: Transcript; dur: number; bookmarks: Bookmark[] }): ReactNode {
  const c = useTheme()
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surface2, overflow: 'hidden' }} pointerEvents="none">
      {t.segments.map((s) => (
        <View
          key={s.id}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${(s.start / dur) * 100}%`,
            width: `${Math.max(0.2, ((s.end - s.start) / dur) * 100)}%`,
            backgroundColor: s.speaker === undefined ? c.lineStrong : speakerColor(c, s.speaker)
          }}
        />
      ))}
      {bookmarks.map((b, i) => (
        <View key={i} style={{ position: 'absolute', top: 0, bottom: 0, width: 3, marginLeft: -1.5, left: `${(b.time / dur) * 100}%`, backgroundColor: c.fg }} />
      ))}
    </View>
  )
}

function Player({ t, playing, time, dur, onToggle, onSeek }: { t: Transcript; playing: boolean; time: number; dur: number; onToggle: () => void; onSeek: (s: number) => void }): ReactNode {
  const c = useTheme()
  const { wide } = useLayout()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: wide ? 16 : 12, borderRadius: 14, borderWidth: 1, borderColor: c.line, backgroundColor: c.panel, paddingHorizontal: wide ? 16 : 12, paddingVertical: 14 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause' : 'Abspielen'}
        onPress={onToggle}
        style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 44, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.95 : 1 }] })}
      >
        {playing ? <Pause size={16} color={c.inkFg} fill={c.inkFg} /> : <Play size={16} color={c.inkFg} fill={c.inkFg} style={{ marginLeft: 2 }} />}
      </Pressable>
      {wide && <Text style={[mono, { width: 56, fontSize: 12, color: c.fg }]}>{stamp(time, dur >= 3600)}</Text>}
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <Waveform t={t} time={time} dur={dur} onSeek={onSeek} />
        <SpeakerStrip t={t} dur={dur} bookmarks={t.bookmarks ?? []} />
        {!wide && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[mono, { fontSize: 11.5, color: c.fg }]}>{stamp(time, dur >= 3600)}</Text>
            <Text style={[mono, { fontSize: 11.5, color: c.muted }]}>{stamp(dur, dur >= 3600)}</Text>
          </View>
        )}
      </View>
      {wide && <Text style={[mono, { width: 56, textAlign: 'right', fontSize: 12, color: c.muted }]}>{stamp(dur, dur >= 3600)}</Text>}
    </View>
  )
}

// ------------------------------------------------------------ Transkript-Blöcke

interface BlockProps {
  block: Block
  speakers: Speaker[]
  /** Wiedergabeposition, falls dieser Block gerade läuft – sonst -1 */
  time: number
  playing: boolean
  query: string
  longStamps: boolean
  editingId: string | null
  canPlay: boolean
  onSeek: (sec: number) => void
  onEdit: (id: string | null) => void
  onSaveText: (id: string, text: string) => void
  onSpeakerMenu: (block: Block) => void
  onLayout: (key: string, y: number) => void
}

const TranscriptBlock = memo(function TranscriptBlock({
  block,
  speakers,
  time,
  playing,
  query,
  longStamps,
  editingId,
  canPlay,
  onSeek,
  onEdit,
  onSaveText,
  onSpeakerMenu,
  onLayout
}: BlockProps): ReactNode {
  const c = useTheme()
  const active = time >= 0
  const name = speakerName(speakers, block.speaker)
  const color = speakerColor(c, block.speaker)
  const editing = block.segments.find((s) => s.id === editingId)
  const [draft, setDraft] = useState('')
  useEffect(() => {
    if (editing) setDraft(editing.text)
  }, [editing?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const renderSegment = (s: Segment): ReactNode => {
    if (query || !active) return splitHighlight(s.text, query, c.mark)
    if (time >= s.end) return s.text
    if (time < s.start) return <Text style={{ color: c.muted }}>{s.text}</Text>
    // Laufender Satz: Wort für Wort hervorheben
    const words = s.text.split(/\s+/).filter(Boolean)
    const times = wordTimes(s, words)
    let cur = 0
    for (let i = 0; i < times.length; i++) if (times[i] <= time) cur = i
    return words.map((w, i) => (
      <Text key={i}>
        <Text
          onPress={() => onSeek(times[i])}
          style={i === cur ? { backgroundColor: c.accent, color: c.accentFg, borderRadius: 4 } : i > cur ? { color: c.muted } : undefined}
        >
          {i === cur ? ` ${w} ` : w}
        </Text>
        {i < words.length - 1 ? ' ' : ''}
      </Text>
    ))
  }

  const finish = (): void => {
    if (!editing) return
    const text = draft.trim()
    onEdit(null)
    if (text && text !== editing.text) onSaveText(editing.id, text)
  }

  return (
    <View
      onLayout={(e) => onLayout(block.key, e.nativeEvent.layout.y)}
      style={{
        flexDirection: 'row',
        gap: 14,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 14,
        backgroundColor: active ? c.panel : 'transparent',
        borderWidth: 1,
        borderColor: active ? c.line : 'transparent'
      }}
    >
      {block.speaker !== undefined && <Avatar name={name} speaker={block.speaker} size={32} />}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 10 }}>
          {block.speaker !== undefined && (
            <Pressable accessibilityRole="button" accessibilityLabel={`${name}, Sprecher ändern`} hitSlop={8} onPress={() => onSpeakerMenu(block)}>
              <T size={14} weight={600} color={color}>
                {name}
              </T>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" accessibilityLabel={`Zu ${stamp(block.start, longStamps)} springen`} hitSlop={8} disabled={!canPlay} onPress={() => onSeek(block.start)}>
            <Text style={[mono, { fontSize: 12, color: c.muted }]}>{stamp(block.start, longStamps)}</Text>
          </Pressable>
          {active && playing && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 6, height: 6, borderRadius: 6, backgroundColor: c.accent }} />
              <T size={12} weight={500} color={c.accentText}>
                Wiedergabe
              </T>
            </View>
          )}
        </View>
        {editing ? (
          <View style={{ gap: 6 }}>
            {block.segments.indexOf(editing) > 0 && (
              <Text style={[font(400), { fontSize: 15, lineHeight: 24, color: c.muted }]}>
                {block.segments
                  .slice(0, block.segments.indexOf(editing))
                  .map((s) => s.text)
                  .join(' ')}
              </Text>
            )}
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              multiline
              accessibilityLabel="Satz bearbeiten"
              onBlur={finish}
              blurOnSubmit
              onSubmitEditing={finish}
              returnKeyType="done"
              style={[font(400), { fontSize: 15, lineHeight: 24, color: c.fg, backgroundColor: c.accentSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4 }]}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button size="sm" variant="primary" onPress={finish}>
                Übernehmen
              </Button>
              <Button size="sm" variant="ghost" onPress={() => onEdit(null)}>
                Abbrechen
              </Button>
            </View>
          </View>
        ) : (
          <Text selectable={false} style={[font(400), { fontSize: 15, lineHeight: 24, color: c.fg }]}>
            {block.segments.map((s) => (
              <Text key={s.id} onPress={canPlay ? () => onSeek(s.start) : undefined} onLongPress={() => onEdit(s.id)}>
                {renderSegment(s)}{' '}
              </Text>
            ))}
          </Text>
        )}
      </View>
    </View>
  )
})

// ------------------------------------------------------------ Seitenleiste

function RailCard({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <Card style={{ gap: 12, padding: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <T size={14} weight={600}>
          {title}
        </T>
        {aside}
      </View>
      {children}
    </Card>
  )
}

function NotesCard({ t, onSave }: { t: Transcript; onSave: (notes: string) => void }): ReactNode {
  const c = useTheme()
  const [value, setValue] = useState(t.notes ?? '')
  const [saved, setSaved] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => setValue(t.notes ?? ''), [t.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(timer.current), [])
  const change = (v: string): void => {
    setValue(v)
    setSaved(false)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      onSave(v)
      setSaved(true)
    }, 600)
  }
  return (
    <RailCard
      title="Notizen"
      aside={
        <T size={12} color={c.muted}>
          {saved ? 'Gespeichert' : 'Wird gespeichert'}
        </T>
      }
    >
      <TextInput
        value={value}
        onChangeText={change}
        onBlur={() => {
          clearTimeout(timer.current)
          if (value !== (t.notes ?? '')) onSave(value)
          setSaved(true)
        }}
        multiline
        textAlignVertical="top"
        accessibilityLabel="Notizen"
        placeholder="Eigene Notizen, Aufgaben, Zusammenfassung …"
        placeholderTextColor={c.muted}
        style={[font(400), { minHeight: 92, borderRadius: 10, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg, padding: 12, fontSize: 13, lineHeight: 20, color: c.fg }]}
      />
    </RailCard>
  )
}

function MomentsCard({ t, time, canPlay, onSeek, onSave }: { t: Transcript; time: number; canPlay: boolean; onSeek: (sec: number) => void; onSave: (b: Bookmark[]) => void }): ReactNode {
  const c = useTheme()
  const list = t.bookmarks ?? []
  return (
    <RailCard
      title="Momente"
      aside={
        canPlay ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => onSave([...list, { time, label: `Lesezeichen ${list.length + 1}` }].sort((a, b) => a.time - b.time))}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Plus size={14} color={c.fg2} />
            <T size={12} weight={500} color={c.fg2}>
              Hier markieren
            </T>
          </Pressable>
        ) : undefined
      }
    >
      {list.length === 0 ? (
        <T size={13} color={c.muted} style={{ lineHeight: 20 }}>
          Noch keine Lesezeichen. Markiere wichtige Stellen beim Anhören.
        </T>
      ) : (
        <View style={{ gap: 2, marginHorizontal: -4 }}>
          {list.map((b, i) => (
            <View key={`${b.time}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Zu ${clock(b.time)} springen`} disabled={!canPlay} hitSlop={8} onPress={() => onSeek(b.time)}>
                <Text style={[mono, { width: 40, fontSize: 12, color: c.muted }]}>{clock(b.time)}</Text>
              </Pressable>
              <TextInput
                defaultValue={b.label}
                accessibilityLabel="Name des Lesezeichens"
                returnKeyType="done"
                onEndEditing={(e) => {
                  const v = e.nativeEvent.text.trim()
                  if (v !== b.label) onSave(list.map((x, j) => (j === i ? { ...x, label: v || x.label } : x)))
                }}
                style={[font(400), { flex: 1, fontSize: 13, color: c.fg, paddingHorizontal: 6, paddingVertical: 6 }]}
              />
              <IconButton icon={X} label="Lesezeichen entfernen" size={28} onPress={() => onSave(list.filter((_, j) => j !== i))} />
            </View>
          ))}
        </View>
      )}
    </RailCard>
  )
}

function TalkTimeCard({ t, current }: { t: Transcript; current?: number }): ReactNode {
  const c = useTheme()
  const stats = useMemo(() => speakerStats(t), [t])
  if (!stats.length) return null
  return (
    <RailCard title="Redeanteile">
      {stats.map((s) => (
        <View key={s.id} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <T size={13} weight={current === s.id ? 500 : 400} lines={1} style={{ flexShrink: 1 }}>
              {speakerName(t.speakers, s.id)}
            </T>
            <Text style={[mono, { fontSize: 12, color: c.muted }]}>{Math.round(s.share * 100)}%</Text>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surface2 }}>
            <View style={{ height: 6, borderRadius: 3, width: `${s.share * 100}%`, backgroundColor: speakerColor(c, s.id) }} />
          </View>
        </View>
      ))}
    </RailCard>
  )
}

// ------------------------------------------------------------ Sprecher bearbeiten

function SpeakersModal({
  open,
  onClose,
  t,
  canPlay,
  onRename,
  onMerge,
  onListen
}: {
  open: boolean
  onClose: () => void
  t: Transcript
  canPlay: boolean
  onRename: (id: number, name: string) => void
  onMerge: (from: number, into: number) => void
  onListen: (id: number) => void
}): ReactNode {
  const c = useTheme()
  const stats = speakerStats(t)
  return (
    <Modal open={open} onClose={onClose} width={520}>
      <T size={16} weight={600} style={{ paddingRight: 32 }}>
        Sprecher bearbeiten
      </T>
      <T size={13} color={c.muted} style={{ marginTop: 4 }}>
        Namen vergeben oder doppelt erkannte Personen zusammenführen.
      </T>
      <ScrollView style={{ marginTop: 20 }} keyboardShouldPersistTaps="handled">
        {stats.map((s, i) => {
          const name = speakerName(t.speakers, s.id)
          return (
            <View key={s.id} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: c.line }}>
              <Avatar name={name} speaker={s.id} size={32} />
              <View style={{ flex: 1, minWidth: 140 }}>
                <TextInput
                  key={name}
                  defaultValue={name}
                  accessibilityLabel="Name des Sprechers"
                  returnKeyType="done"
                  onEndEditing={(e) => {
                    const v = e.nativeEvent.text.trim()
                    if (v && v !== name) onRename(s.id, v)
                  }}
                  style={[font(500), { fontSize: 14, color: c.fg, paddingHorizontal: 6, paddingVertical: 2 }]}
                />
                <T size={12} color={c.muted} style={{ paddingHorizontal: 6 }}>
                  {longDuration(s.sec)} · {Math.round(s.share * 100)}%
                </T>
              </View>
              {canPlay && <IconButton icon={Play} label="Anhören" onPress={() => onListen(s.id)} />}
              {stats.length > 1 && (
                <Select
                  style={{ width: 160 }}
                  title="Zusammenführen"
                  value={null}
                  placeholder="Zusammenführen …"
                  options={stats.filter((x) => x.id !== s.id).map((x) => ({ value: String(x.id), label: `in ${speakerName(t.speakers, x.id)}` }))}
                  onChange={(v) => onMerge(s.id, Number(v))}
                />
              )}
            </View>
          )
        })}
      </ScrollView>
      <View style={{ marginTop: 20, flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Button variant="primary" onPress={onClose}>
          Fertig
        </Button>
      </View>
    </Modal>
  )
}

// ------------------------------------------------------------ Seite

type PhoneTab = 'transcript' | 'notes' | 'moments' | 'talk'

export function TranscriptView({ id }: { id: string }): ReactNode {
  const c = useTheme()
  const { wide, pad, desktop } = useLayout()
  const insets = useSafeAreaInsets()
  const query = useApp((s) => s.search.trim())
  const models = useApp((s) => s.models)
  const job = useApp((s) => s.jobs.find((j) => j.transcriptId === id && ACTIVE_JOB(j)))
  const metaKey = useApp((s) => {
    const m = s.transcripts.find((x) => x.id === id)
    return m ? `${m.status}|${m.words}|${m.speakerCount}|${m.duration}|${m.error ?? ''}` : 'missing'
  })
  const [t, setT] = useState<Transcript | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const playback = useApp((s) => s.playback)
  const time = playback.transcriptId === id ? playback.time : 0
  const playing = playback.transcriptId === id && playback.playing
  const [follow, setFollow] = useState(true)
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [speakersOpen, setSpeakersOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [menuBlock, setMenuBlock] = useState<Block | null>(null)
  const [tab, setTab] = useState<PhoneTab>('transcript')
  const [reload, setReload] = useState(0)
  const scrollRef = useRef<ScrollView>(null)
  const sectionY = useRef(0)
  const blockY = useRef(new Map<string, number>())
  const viewport = useRef({ y: 0, h: 0 })
  const programmatic = useRef(false)

  // Laden und neu laden, wenn sich der Stand in der Liste ändert (z. B. Transkription fertig)
  useEffect(() => {
    let alive = true
    getApi()
      .transcripts.get(id)
      .then((x) => {
        if (!alive) return
        if (!x) {
          setLoadState('missing')
          return
        }
        setT(x)
        setLoadState('ready')
      })
      .catch((e) => {
        if (!alive) return
        setLoadError(errorDetail(e) ?? null)
        setLoadState((s) => (s === 'ready' ? s : 'error'))
      })
    return () => {
      alive = false
    }
  }, [id, metaKey, reload])

  // Wiedergabe beim Verlassen anhalten
  useEffect(
    () => () => {
      void getApi()
        .transcripts.pause()
        .catch(() => undefined)
    },
    [id]
  )

  const dur = Math.max(1, t?.duration ?? 1)

  const canPlay = !!t && !!(t.audioPath || t.originalPath) && t.status !== 'error'

  const seek = useCallback(
    async (sec: number): Promise<void> => {
      if (!canPlay) return
      const at = Math.max(0, Math.min(dur, sec))
      setFollow(true)
      try {
        await getApi().transcripts.play(id, at)
      } catch (e) {
        toast('Audio kann nicht abgespielt werden', 'error', errorDetail(e))
      }
    },
    [id, canPlay, dur]
  )

  const toggle = useCallback(async (): Promise<void> => {
    if (playing) {
      await attempt('Wiedergabe konnte nicht angehalten werden', () => getApi().transcripts.pause())
    } else await seek(time >= dur ? 0 : time)
  }, [playing, seek, time, dur])

  const save = useCallback(
    (patch: Partial<Transcript>) => {
      setT((cur) => (cur ? { ...cur, ...patch } : cur))
      getApi()
        .transcripts.update(id, patch)
        .then((x) => x && setT(x))
        .catch((e) => {
          toast('Änderung konnte nicht gespeichert werden', 'error', errorDetail(e))
          setReload((n) => n + 1)
        })
    },
    [id]
  )

  const blocks = useMemo(() => (t ? toBlocks(t.segments) : []), [t])
  const activeBlock = useMemo(() => {
    if (!t || (!playing && time === 0)) return null
    return blocks.find((b) => time >= b.start && time < b.end + 0.3)?.key ?? null
  }, [blocks, time, playing, t])

  // Laufenden Absatz im Blick behalten
  useEffect(() => {
    if (!activeBlock || !follow || !playing) return
    const y = blockY.current.get(activeBlock)
    if (y === undefined) return
    const abs = sectionY.current + y
    const { y: top, h } = viewport.current
    if (abs < top + 120 || abs > top + h - 140) {
      programmatic.current = true
      scrollRef.current?.scrollTo({ y: Math.max(0, abs - h / 3), animated: true })
      setTimeout(() => (programmatic.current = false), 700)
    }
  }, [activeBlock, follow, playing])

  const saveText = useCallback(
    (segId: string, text: string) => {
      setT((cur) => {
        if (!cur) return cur
        const segments = cur.segments.map((x) => (x.id === segId ? { ...x, text, words: undefined } : x))
        save({ segments })
        return { ...cur, segments }
      })
    },
    [save]
  )

  const assign = useCallback(
    (block: Block, target: number | 'new') => {
      if (!t) return
      const used = [...t.speakers.map((s) => s.id), ...t.segments.map((s) => s.speaker ?? -1)]
      const sid = target === 'new' ? Math.max(-1, ...used) + 1 : target
      const ids = new Set(block.segments.map((s) => s.id))
      const segments = t.segments.map((x) => (ids.has(x.id) ? { ...x, speaker: sid } : x))
      const speakers = t.speakers.some((s) => s.id === sid) ? t.speakers : [...t.speakers, { id: sid, name: `Sprecher ${sid + 1}` }]
      save({ segments, speakers: speakers.filter((s) => segments.some((x) => x.speaker === s.id)) })
    },
    [t, save]
  )

  const onBlockLayout = useCallback((key: string, y: number) => {
    blockY.current.set(key, y)
  }, [])

  if (loadState === 'loading')
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </View>
    )

  if (loadState === 'missing' || loadState === 'error' || !t)
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: pad }}>
        <EmptyState
          icon={loadState === 'error' ? CircleAlert : FileQuestion}
          title={loadState === 'error' ? 'Transkript konnte nicht geladen werden' : 'Transkript nicht gefunden'}
          text={loadState === 'error' ? (loadError ?? 'Bitte versuche es erneut.') : 'Es wurde gelöscht oder ist nicht mehr verfügbar.'}
          action={
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button onPress={() => goBack()}>Zurück</Button>
              {loadState === 'error' && (
                <Button
                  variant="primary"
                  onPress={() => {
                    setLoadState('loading')
                    setReload((n) => n + 1)
                  }}
                >
                  Erneut versuchen
                </Button>
              )}
            </View>
          }
        />
      </View>
    )

  const stats = speakerStats(t)
  const currentSpeaker = blocks.find((b) => b.key === activeBlock)?.speaker
  const modelName = models.find((m) => m.id === t.modelId)?.name ?? t.modelId
  const language = LANGUAGES.find((l) => l.code === t.language)?.label ?? t.language
  const source = t.source === 'recording' ? 'Live-Aufnahme' : t.originalPath ? `Datei: ${t.originalPath.split(/[\\/]/).pop()}` : 'Datei'
  const longStamps = t.duration >= 3600
  const matches = query ? t.segments.filter((s) => s.text.toLowerCase().includes(query.toLowerCase())).length : 0
  const folder = t.originalPath ? t.originalPath.replace(/[\\/][^\\/]*$/, '') : ''

  const copyAll = async (): Promise<void> => {
    const ok = await attempt('Kopieren fehlgeschlagen', () => getApi().transcripts.copy(t.id, { speakers: true, timestamps: false }))
    if (ok === undefined) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  const head = (
    <View style={{ flexDirection: wide ? 'row' : 'column', flexWrap: 'wrap', alignItems: wide ? 'flex-end' : 'stretch', gap: 16, paddingHorizontal: pad, paddingTop: wide ? 28 : 20, paddingBottom: 20 }}>
      <View style={{ flex: wide ? 1 : undefined, minWidth: wide ? 420 : 0, gap: 8 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {t.status === 'done' && (
            <Badge tone="success" size="md" icon={Check}>
              Transkribiert
            </Badge>
          )}
          {t.status === 'processing' && (
            <Badge tone="accent" size="md" left={<Spinner color={c.accentText} />}>
              Wird transkribiert
            </Badge>
          )}
          {t.status === 'error' && (
            <Badge tone="danger" size="md" icon={CircleAlert}>
              Fehler
            </Badge>
          )}
          {stats.length > 0 && (
            <Badge tone="accent" size="md">
              {stats.length === 1 ? '1 Sprecher erkannt' : `${stats.length} Sprecher erkannt`}
            </Badge>
          )}
          <Badge size="md">{language}</Badge>
        </View>
        <TextInput
          key={t.id + t.title}
          defaultValue={t.title}
          accessibilityLabel="Titel"
          returnKeyType="done"
          multiline={!wide}
          blurOnSubmit
          onEndEditing={(e) => {
            const v = e.nativeEvent.text.trim()
            if (v && v !== t.title) save({ title: v })
          }}
          style={[font(600), { fontSize: wide ? 30 : 26, lineHeight: wide ? 35 : 31, letterSpacing: -0.6, color: c.fg, paddingVertical: 0, marginHorizontal: -6, paddingHorizontal: 6, borderRadius: 8 }]}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 }}>
          <T size={13} color={c.muted}>
            {dateLine(t.createdAt)}
          </T>
          {t.duration > 0 && (
            <T size={13} color={c.muted}>
              {longDuration(t.duration)}
            </T>
          )}
          <T size={13} color={c.muted} lines={1} style={{ maxWidth: 320 }}>
            {source}
          </T>
          <T size={13} color={c.muted}>
            {modelName}
          </T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {desktop && folder ? <IconButton icon={FolderOpen} label="Im Ordner zeigen" size={40} onPress={() => void attempt('Ordner konnte nicht geöffnet werden', () => getApi().system.openPath(folder))} /> : null}
        <IconButton icon={Trash2} label="Löschen" size={40} onPress={() => setConfirmDelete(true)} />
        <ExportMenu t={t} />
        <Button size="lg" variant="primary" icon={copied ? Check : Copy} onPress={() => void copyAll()} grow={!wide}>
          {copied ? 'Kopiert' : 'Text kopieren'}
        </Button>
      </View>
    </View>
  )

  const player = canPlay ? (
    <View key="player" style={{ backgroundColor: c.bg, paddingHorizontal: pad, paddingTop: 4, paddingBottom: 12 }}>
      <Player t={t} playing={playing} time={time} dur={dur} onToggle={() => void toggle()} onSeek={(s) => void seek(s)} />
      <View style={{alignItems:'flex-end',paddingHorizontal:pad}}><Select value={String(playback.rate)} options={[0.5,0.75,1,1.25,1.5,2].map(rate=>({value:String(rate),label:`${rate}×`}))} onChange={v=>void attempt('Tempo konnte nicht geändert werden',()=>getApi().transcripts.setRate(Number(v)))} /></View>
    </View>
  ) : null

  const jobBar = job ? (
    <View style={{ marginHorizontal: pad, marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16, borderRadius: 14, borderWidth: 1, borderColor: c.line, backgroundColor: c.panel, paddingHorizontal: 16, paddingVertical: 12 }}>
      <Spinner color={c.accent} />
      <T size={13} weight={500}>
        {job.stage === 'diarizing' ? 'Sprecher werden erkannt …' : job.stage === 'transcribing' ? 'Transkribiere …' : 'Wird vorbereitet …'}
      </T>
      <Progress value={job.progress} indeterminate={job.stage !== 'transcribing'} style={{ flex: 1, minWidth: 120, maxWidth: 320 }} />
      <Text style={[mono, { fontSize: 12, color: c.muted }]}>{job.stage === 'transcribing' ? `${Math.round(job.progress * 100)}%` : ''}</Text>
    </View>
  ) : null

  const tabs: { id: PhoneTab; label: string }[] = [
    { id: 'transcript', label: 'Transkript' },
    { id: 'notes', label: 'Notizen' },
    { id: 'moments', label: 'Momente' },
    ...(stats.length ? [{ id: 'talk' as const, label: 'Redeanteile' }] : [])
  ]
  const showTranscript = wide || tab === 'transcript'

  const transcript = (
    <View>
      {t.status === 'error' && (
        <View style={{ marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: c.dangerSoft, backgroundColor: c.dangerSoft, paddingHorizontal: 16, paddingVertical: 12 }}>
          <T size={13} color={c.dangerText}>
            {t.error ?? 'Die Transkription ist fehlgeschlagen.'}
          </T>
        </View>
      )}
      {t.segments.length === 0 && t.status === 'done' && (
        <T size={14} color={c.muted} style={{ paddingVertical: 64, textAlign: 'center' }}>
          Keine Sprache erkannt.
        </T>
      )}
      {t.segments.length === 0 && t.status === 'processing' && !job && (
        <T size={14} color={c.muted} style={{ paddingVertical: 64, textAlign: 'center' }}>
          Der Text erscheint hier, sobald die Transkription fertig ist.
        </T>
      )}
      {blocks.map((b) => (
        <TranscriptBlock
          key={b.key}
          block={b}
          speakers={t.speakers}
          time={b.key === activeBlock ? time : -1}
          playing={playing}
          query={query}
          longStamps={longStamps}
          editingId={b.segments.some((s) => s.id === editingId) ? editingId : null}
          canPlay={canPlay}
          onSeek={(s) => void seek(s)}
          onEdit={setEditingId}
          onSaveText={saveText}
          onSpeakerMenu={setMenuBlock}
          onLayout={onBlockLayout}
        />
      ))}
      {t.segments.length > 0 && (
        <T size={12} color={c.faint} style={{ marginTop: 16, paddingHorizontal: 12 }}>
          {canPlay ? 'Lange drücken zum Bearbeiten · Tippen springt zur Stelle' : 'Lange auf einen Satz drücken, um ihn zu bearbeiten'}
        </T>
      )}
    </View>
  )

  const notes = <NotesCard t={t} onSave={(n) => save({ notes: n })} />
  const moments = <MomentsCard t={t} time={time} canPlay={canPlay} onSeek={(s) => void seek(s)} onSave={(b) => save({ bookmarks: b })} />
  const talk = <TalkTimeCard t={t} current={currentSpeaker} />

  const body = (
    <View style={{ flexDirection: 'row', gap: 24, paddingHorizontal: pad, paddingTop: 20, paddingBottom: 40 + (wide ? 0 : insets.bottom) }}>
      <View style={{ flex: 1, minWidth: 0 }} onLayout={(e) => (sectionY.current = e.nativeEvent.layout.y)}>
        <View style={{ marginBottom: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, borderBottomWidth: 1, borderBottomColor: c.line, paddingBottom: 12 }}>
          {(wide ? tabs.slice(0, 1) : tabs).map((x) => {
            const on = wide || tab === x.id
            return (
              <Pressable
                key={x.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setTab(x.id)}
                style={{ height: 32, justifyContent: 'center', borderRadius: 8, paddingHorizontal: 12, backgroundColor: on ? c.ink : 'transparent' }}
              >
                <T size={13} weight={500} color={on ? c.inkFg : c.fg2}>
                  {x.label}
                </T>
              </Pressable>
            )
          })}
          {showTranscript && query ? (
            <T size={13} color={c.muted} style={{ paddingHorizontal: 8 }}>
              {matches === 1 ? '1 Treffer' : `${matches} Treffer`} für „{query}“
            </T>
          ) : null}
          {showTranscript && stats.length > 0 && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setSpeakersOpen(true)}
              style={({ pressed }) => ({ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 4, backgroundColor: pressed ? c.surface2 : 'transparent' })}
            >
              <View style={{ flexDirection: 'row' }}>
                {stats.slice(0, 5).map((s, i) => (
                  <View key={s.id} style={{ marginLeft: i > 0 ? -4 : 0 }}>
                    <Avatar name={speakerName(t.speakers, s.id)} speaker={s.id} size={22} ring={c.bg} />
                  </View>
                ))}
              </View>
              <T size={12} color={c.muted}>
                Sprecher bearbeiten
              </T>
            </Pressable>
          )}
        </View>
        {showTranscript && transcript}
        {!wide && tab === 'notes' && <View style={{ marginTop: 8 }}>{notes}</View>}
        {!wide && tab === 'moments' && <View style={{ marginTop: 8 }}>{moments}</View>}
        {!wide && tab === 'talk' && <View style={{ marginTop: 8 }}>{talk}</View>}
      </View>
      {wide && (
        <View style={{ width: 300, gap: 16 }}>
          {notes}
          {moments}
          {talk}
        </View>
      )}
    </View>
  )

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        stickyHeaderIndices={player ? [1] : undefined}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={64}
        onLayout={(e) => (viewport.current.h = e.nativeEvent.layout.height)}
        onScroll={(e) => (viewport.current.y = e.nativeEvent.contentOffset.y)}
        onScrollBeginDrag={() => {
          if (!programmatic.current && playing) setFollow(false)
        }}
      >
        {head}
        {player}
        {jobBar}
        {body}
      </ScrollView>

      {!follow && playing && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setFollow(true)}
          style={{ position: 'absolute', bottom: 20 + insets.bottom, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', borderRadius: 999, backgroundColor: c.ink, paddingHorizontal: 16, paddingVertical: 9 }}
        >
          <T size={12.5} weight={500} color={c.inkFg}>
            Zur aktuellen Stelle
          </T>
        </Pressable>
      )}

      <Sheet open={!!menuBlock} onClose={() => setMenuBlock(null)} title="Absatz zuordnen">
        {t.speakers.map((s) => (
          <MenuItem
            key={s.id}
            label={s.name}
            selected={s.id === menuBlock?.speaker}
            left={<Avatar name={s.name} speaker={s.id} size={20} />}
            onPress={() => {
              if (menuBlock) assign(menuBlock, s.id)
              setMenuBlock(null)
            }}
          />
        ))}
        <MenuItem
          label="Neuer Sprecher"
          left={
            <View style={{ width: 20, height: 20, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.lineStrong, alignItems: 'center', justifyContent: 'center' }}>
              <Plus size={12} color={c.fg2} />
            </View>
          }
          onPress={() => {
            if (menuBlock) assign(menuBlock, 'new')
            setMenuBlock(null)
          }}
        />
      </Sheet>

      <SpeakersModal
        open={speakersOpen}
        onClose={() => setSpeakersOpen(false)}
        t={t}
        canPlay={canPlay}
        onRename={(sid, name) => {
          const others = t.speakers.filter((x) => x.id !== sid)
          save({ speakers: [...others, { id: sid, name }].sort((a, b) => a.id - b.id) })
        }}
        onMerge={(from, into) => {
          const segments = t.segments.map((s) => (s.speaker === from ? { ...s, speaker: into } : s))
          save({ segments, speakers: t.speakers.filter((s) => s.id !== from) })
        }}
        onListen={(sid) => {
          const first = t.segments.find((s) => s.speaker === sid)
          if (first) void seek(first.start)
        }}
      />

      <Confirm
        open={confirmDelete}
        title="Transkript löschen?"
        text={`„${t.title}“ wird dauerhaft entfernt. Die Originaldatei bleibt erhalten.`}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await getApi().transcripts.remove(t.id)
            setConfirmDelete(false)
            goBack()
          } catch (e) {
            toast('Transkript konnte nicht gelöscht werden', 'error', errorDetail(e))
          }
        }}
      />
    </View>
  )
}

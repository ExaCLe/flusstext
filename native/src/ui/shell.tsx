// Seitenleiste, Kopfzeile und Toasts (src/renderer/src/components/Sidebar.tsx, TopBar.tsx, Toasts.tsx).
import { AudioLines, BookText, Boxes, ChevronLeft, CircleAlert, CircleCheck, FileAudio2, House, Keyboard, Menu, Mic, Search, Settings, X } from 'lucide-react-native'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Hotkey, Logo, PulseDot, T, type Icon } from './components'
import { clock } from './format'
import { ACTIVE_JOB, currentRoute, navigate, goBack, setSearch, startRecording, useApp, type RouteName } from './store'
import { nativeAnimations, alpha, font, mono, useLayout, useTheme } from './theme'

export const TITLES: Record<RouteName, string> = {
  home: 'Start',
  library: 'Transkripte',
  transcript: 'Transkripte',
  record: 'Aufnahme',
  history: 'Diktat-Verlauf',
  vocabulary: 'Wörterbuch',
  dictation: 'Diktat',
  models: 'Modelle',
  settings: 'Einstellungen'
}

const PLACEHOLDER: Partial<Record<RouteName, string>> = {
  transcript: 'In diesem Transkript suchen',
  history: 'Diktate durchsuchen',
  vocabulary: 'Wörterbuch durchsuchen'
}

/** Seiten, auf denen das Suchfeld direkt filtert – sonst springt die Suche zu den Transkripten. */
const SEARCHABLE = new Set<RouteName>(['library', 'transcript', 'history', 'vocabulary'])

function onSearchChange(text: string): void {
  if (!SEARCHABLE.has(currentRoute().name)) navigate({ name: 'library' })
  setSearch(text)
}

// ------------------------------------------------------------ Seitenleiste

function NavItem({ route, label, icon: IconC, count, onNavigate }: { route: RouteName; label: string; icon: Icon; count?: ReactNode; onNavigate?: () => void }): ReactNode {
  const c = useTheme()
  const current = useApp((s) => currentRoute(s).name)
  const active = current === route || (route === 'library' && current === 'transcript')
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onAccessibilityTap={() => { navigate({ name: route } as never); onNavigate?.() }}
      onPress={() => {
        navigate({ name: route } as never)
        onNavigate?.()
      }}
      style={({ pressed }) => ({
        height: 36,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 8,
        paddingHorizontal: 10,
        backgroundColor: active ? c.panel : pressed ? alpha(c.surface2, 0.7) : 'transparent',
        borderWidth: 1,
        borderColor: active ? c.line : 'transparent'
      })}
    >
      <IconC size={16} color={active ? c.fg : c.fg2} />
      <T size={14} weight={active ? 500 : 400} color={active ? c.fg : c.fg2} style={{ flex: 1 }} lines={1}>
        {label}
      </T>
      {typeof count === 'number' ? (
        <Text style={[mono, { fontSize: 12, color: c.muted }]}>{count}</Text>
      ) : (
        count
      )}
    </Pressable>
  )
}

function GroupLabel({ children }: { children: string }): ReactNode {
  const c = useTheme()
  return (
    <T size={11} weight={600} color={c.muted} style={{ paddingHorizontal: 10, paddingBottom: 6, letterSpacing: 0.66, textTransform: 'uppercase' }}>
      {children}
    </T>
  )
}

/** Großer Knopf oben: startet eine Aufnahme oder zeigt die laufende an. */
function RecordButton({ onNavigate }: { onNavigate?: () => void }): ReactNode {
  const c = useTheme()
  const phase = useApp((s) => s.recording.phase)
  const elapsed = useApp((s) => Math.floor(s.recording.elapsed))
  const pending = useApp((s) => s.live.pending)
  const busy = phase !== 'idle' || pending !== null
  const paused = phase === 'paused'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy ? (paused ? 'Pausiert' : 'Aufnahme läuft') : 'Neue Aufnahme'}
      onPress={() => {
        navigate({ name: 'record' })
        onNavigate?.()
        if (!busy) void startRecording()
      }}
      style={({ pressed }) => ({
        height: 44,
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: busy ? c.dangerSoft : pressed ? c.accentStrong : c.accent,
        transform: [{ scale: pressed ? 0.98 : 1 }]
      })}
    >
      {busy ? (
        <>
          <PulseDot color={c.danger} active={!paused} />
          <T size={14} weight={500} color={c.dangerText}>
            {paused ? 'Pausiert' : pending === 'finishing' ? 'Wird gespeichert' : 'Aufnahme läuft'}
          </T>
          <Text style={[mono, { fontSize: 12.5, color: c.dangerText }]}>{clock(elapsed)}</Text>
        </>
      ) : (
        <>
          <Mic size={16} color={c.accentFg} />
          <T size={14} weight={500} color={c.accentFg}>
            Neue Aufnahme
          </T>
        </>
      )}
    </Pressable>
  )
}

function DictationCard({ onNavigate }: { onNavigate?: () => void }): ReactNode {
  const c = useTheme()
  const { desktop } = useLayout()
  const settings = useApp((s) => s.settings!)
  const model = useApp((s) => s.models.find((m) => m.id === (s.settings?.dictationModel ?? s.settings?.transcriptionModel)))
  const ready = settings.dictation.enabled && !!model?.installed
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        navigate({ name: 'dictation' })
        onNavigate?.()
      }}
      style={({ pressed }) => ({ gap: 10, borderRadius: 12, borderWidth: 1, borderColor: pressed ? c.lineStrong : c.line, backgroundColor: c.panel, padding: 14 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 8, backgroundColor: ready ? c.success : c.faint }} />
        <T size={14} weight={500}>
          {ready ? 'Diktat bereit' : settings.dictation.enabled ? 'Kein Modell installiert' : 'Diktat ausgeschaltet'}
        </T>
      </View>
      {ready ? (
        desktop ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
            <T size={13} color={c.muted}>
              {settings.dictation.mode === 'toggle' ? 'Drück' : 'Halte'}
            </T>
            <Hotkey keys={settings.dictation.hotkey} />
            <T size={13} color={c.muted} style={{ lineHeight: 22 }}>
              überall, um zu sprechen. {settings.dictation.mode === 'toggle' ? 'Erneut drücken' : 'Loslassen'} fügt ein.
            </T>
          </View>
        ) : (
          <T size={13} color={c.muted} style={{ lineHeight: 20 }}>
            Tippen, sprechen, erneut tippen – der Text landet im Diktat-Verlauf.
          </T>
        )
      ) : (
        <T size={13} color={c.muted}>
          {settings.dictation.enabled ? 'Unter Modelle eines herunterladen.' : 'In den Diktat-Einstellungen einschalten.'}
        </T>
      )}
    </Pressable>
  )
}

export function Sidebar({ onNavigate, drawer }: { onNavigate?: () => void; drawer?: boolean }): ReactNode {
  const c = useTheme()
  const insets = useSafeAreaInsets()
  const transcripts = useApp((s) => s.transcripts.length)
  const jobs = useApp((s) => s.jobs.filter(ACTIVE_JOB).length)
  const dictations = useApp((s) => s.dictations.length)
  const vocabulary = useApp((s) => s.settings!.replacements.length)

  return (
    <View
      style={{
        width: drawer ? 280 : 240,
        height: '100%',
        flexGrow: 0,
        flexShrink: 0,
        backgroundColor: c.sidebar,
        borderRightWidth: 1,
        borderRightColor: c.line
      }}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, gap: 22, paddingHorizontal: 14, paddingTop: 20 + (drawer ? insets.top : 0), paddingBottom: 14 + (drawer ? insets.bottom : 0) }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 }}>
          <Logo size={28} />
          <T size={16} weight={600} style={{ letterSpacing: -0.16 }}>
            Flusstext
          </T>
        </View>

        <RecordButton onNavigate={onNavigate} />

        <View style={{ gap: 2 }}>
          <NavItem route="home" label="Start" icon={House} onNavigate={onNavigate} />
          <NavItem
            route="library"
            label="Transkripte"
            icon={FileAudio2}
            onNavigate={onNavigate}
            count={
              jobs > 0 ? (
                <View style={{ height: 18, minWidth: 18, paddingHorizontal: 4, borderRadius: 999, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                  <T size={10.5} weight={600} color={c.accentFg}>
                    {jobs}
                  </T>
                </View>
              ) : (
                transcripts || undefined
              )
            }
          />
          <NavItem route="history" label="Diktat-Verlauf" icon={AudioLines} count={dictations || undefined} onNavigate={onNavigate} />
          <NavItem route="vocabulary" label="Wörterbuch" icon={BookText} count={vocabulary || undefined} onNavigate={onNavigate} />
        </View>

        <View style={{ gap: 2 }}>
          <GroupLabel>Einrichtung</GroupLabel>
          <NavItem route="dictation" label="Diktat" icon={Keyboard} onNavigate={onNavigate} />
          <NavItem route="models" label="Modelle" icon={Boxes} onNavigate={onNavigate} />
          <NavItem route="settings" label="Einstellungen" icon={Settings} onNavigate={onNavigate} />
        </View>

        <View style={{ flex: 1 }} />
        <DictationCard onNavigate={onNavigate} />
      </ScrollView>
    </View>
  )
}

/** Seitenleiste als Schublade auf dem Telefon. */
export function Drawer({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const c = useTheme()
  const v = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) setMounted(true)
    Animated.timing(v, { toValue: open ? 1 : 0, duration: open ? 260 : 200, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: nativeAnimations }).start(({ finished }) => {
      if (finished && !open) setMounted(false)
    })
  }, [open, v])
  if (!mounted) return null
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.backdrop, opacity: v }]}>
        <Pressable accessibilityLabel="Menü schließen" style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-290, 0] }) }] }}
      >
        <Sidebar drawer onNavigate={onClose} />
      </Animated.View>
    </View>
  )
}

// ------------------------------------------------------------ Kopfzeile

function SearchField({ autoFocus, onDone }: { autoFocus?: boolean; onDone?: () => void }): ReactNode {
  const c = useTheme()
  const search = useApp((s) => s.search)
  const route = useApp((s) => currentRoute(s).name)
  const [focused, setFocused] = useState(false)
  return (
    <View
      style={{
        flex: 1,
        height: 36,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: focused ? c.lineStrong : c.line,
        backgroundColor: c.panel,
        paddingHorizontal: 12
      }}
    >
      <Search size={15} color={c.muted} />
      <TextInput
        value={search}
        onChangeText={onSearchChange}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={PLACEHOLDER[route] ?? 'Wörter, Sprecher, Titel suchen'}
        placeholderTextColor={c.muted}
        returnKeyType="search"
        accessibilityLabel="Suchen"
        autoCorrect={false}
        style={[font(400), { flex: 1, fontSize: 13, color: c.fg, paddingVertical: 0 }]}
      />
      {search ? (
        <Pressable accessibilityLabel="Suche leeren" hitSlop={10} onPress={() => setSearch('')}>
          <X size={14} color={c.muted} />
        </Pressable>
      ) : onDone ? (
        <Pressable accessibilityLabel="Suche schließen" hitSlop={10} onPress={onDone}>
          <X size={14} color={c.muted} />
        </Pressable>
      ) : null}
    </View>
  )
}

/** Breite Kopfzeile mit Brotkrumen und Suchfeld (Desktop-Layout). */
export function TopBar({ trail }: { trail?: string }): ReactNode {
  const c = useTheme()
  const route = useApp((s) => currentRoute(s).name)
  const crumbs = [TITLES[route], ...(trail ? [trail] : [])]
  return (
    <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: c.line, paddingHorizontal: 28 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 }}>
        {crumbs.map((label, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: i === crumbs.length - 1 ? 1 : 0 }}>
            {i > 0 && (
              <T size={13} color={c.muted}>
                /
              </T>
            )}
            {i === 0 && crumbs.length > 1 ? (
              <Pressable accessibilityRole="button" onPress={() => (route === 'transcript' ? navigate({ name: 'library' }) : goBack())} hitSlop={8}>
                <T size={13} color={c.muted}>
                  {label}
                </T>
              </Pressable>
            ) : (
              <T size={13} color={i === crumbs.length - 1 ? c.fg : c.muted} lines={1}>
                {label}
              </T>
            )}
          </View>
        ))}
      </View>
      <View style={{ flex: 1 }} />
      {route !== 'record' && (
        <View style={{ width: 320, flexShrink: 1, flexDirection: 'row' }}>
          <SearchField />
        </View>
      )}
    </View>
  )
}

/** Telefon-Kopfzeile: Menü oder Zurück, Titel, Suche. */
export function PhoneHeader({ onMenu, trail }: { onMenu: () => void; trail?: string }): ReactNode {
  const c = useTheme()
  const insets = useSafeAreaInsets()
  const route = useApp((s) => currentRoute(s).name)
  const canGoBack = useApp((s) => s.stack.length > 1)
  const search = useApp((s) => s.search)
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    if (!search && !SEARCHABLE.has(route)) setSearching(false)
  }, [route, search])
  const showSearch = route !== 'record'

  return (
    <View style={{ paddingTop: insets.top, backgroundColor: c.bg, borderBottomWidth: 1, borderBottomColor: c.line }}>
      {searching || search ? (
        <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
          <SearchField
            autoFocus={searching && !search}
            onDone={() => {
              setSearch('')
              setSearching(false)
            }}
          />
        </View>
      ) : (
        <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6 }}>
          {canGoBack ? (
            <HeaderButton icon={ChevronLeft} label="Zurück" onPress={() => goBack()} />
          ) : (
            <HeaderButton icon={Menu} label="Menü öffnen" onPress={onMenu} />
          )}
          <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
            {!canGoBack && <Logo size={22} />}
            <T size={15} weight={600} lines={1} style={{ flexShrink: 1 }} accessibilityRole="header">
              {trail ?? TITLES[route]}
            </T>
          </View>
          <HeaderRecord />
          {showSearch && <HeaderButton icon={Search} label="Suchen" onPress={() => setSearching(true)} />}
        </View>
      )}
    </View>
  )
}

function HeaderButton({ icon: IconC, label, onPress }: { icon: Icon; label: string; onPress: () => void }): ReactNode {
  const c = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.surface2 : 'transparent' })}
    >
      <IconC size={20} color={c.fg} />
    </Pressable>
  )
}

/** Laufende Aufnahme bleibt in der Kopfzeile sichtbar, wenn man die Seite verlässt. */
function HeaderRecord(): ReactNode {
  const c = useTheme()
  const phase = useApp((s) => s.recording.phase)
  const elapsed = useApp((s) => Math.floor(s.recording.elapsed))
  const route = useApp((s) => currentRoute(s).name)
  if (phase === 'idle' || route === 'record') return null
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Zur laufenden Aufnahme"
      onPress={() => navigate({ name: 'record' })}
      style={{ height: 30, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: c.dangerSoft, paddingHorizontal: 10 }}
    >
      <PulseDot color={c.danger} size={7} active={phase === 'recording'} />
      <Text style={[mono, { fontSize: 12, color: c.dangerText }]}>{clock(elapsed)}</Text>
    </Pressable>
  )
}

// ------------------------------------------------------------ Toasts

function ToastPill({ text, detail, tone }: { text: string; detail?: string; tone: 'default' | 'success' | 'error' }): ReactNode {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 240, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: nativeAnimations }).start()
  }, [v])
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={{
        maxWidth: 520,
        flexDirection: 'row',
        alignItems: detail ? 'flex-start' : 'center',
        gap: 8,
        borderRadius: detail ? 16 : 999,
        backgroundColor: '#0c0c0d',
        borderWidth: 1,
        borderColor: '#33353b',
        paddingHorizontal: 16,
        paddingVertical: 9,
        opacity: v,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }]
      }}
    >
      {tone === 'success' && <CircleCheck size={16} color="#5be49b" />}
      {tone === 'error' && <CircleAlert size={16} color="#f97066" />}
      <View style={{ flexShrink: 1 }}>
        <T size={13} weight={500} color="#ecedee">
          {text}
        </T>
        {detail ? (
          <T size={12} color="#a1a4ab" style={{ marginTop: 2 }}>
            {detail}
          </T>
        ) : null}
      </View>
    </Animated.View>
  )
}

export function Toasts(): ReactNode {
  const toasts = useApp((s) => s.toasts)
  const insets = useSafeAreaInsets()
  if (!toasts.length) return null
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: 20 + insets.bottom, alignItems: 'center', gap: 8 }}>
      {toasts.map((t) => (
        <ToastPill key={t.id} text={t.text} detail={t.detail} tone={t.tone} />
      ))}
    </View>
  )
}

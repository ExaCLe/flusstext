// Wurzel der nativen Oberfläche – entspricht src/renderer/src/App.tsx.
import { CircleAlert } from 'lucide-react-native'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, BackHandler, Easing, KeyboardAvoidingView, Platform, StatusBar, StyleSheet, View, useColorScheme, useWindowDimensions } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { FlusstextApi } from '../core/contracts'
import { Button, EmptyState, Logo, Spinner } from './components'
import { Dictation } from './pages/Dictation'
import { History } from './pages/History'
import { Home } from './pages/Home'
import { Library } from './pages/Library'
import { Models } from './pages/Models'
import { Onboarding } from './pages/Onboarding'
import { Record } from './pages/Record'
import { SettingsPage } from './pages/Settings'
import { TranscriptView } from './pages/TranscriptView'
import { Vocabulary } from './pages/Vocabulary'
import { Drawer, PhoneHeader, Sidebar, Toasts, TopBar } from './shell'
import { connect, currentRoute, getState, goBack, load, setSearch, useApp, type Route } from './store'
import { nativeAnimations, ThemeContext, dark, light, useTheme, type Layout } from './theme'

/** Ab dieser Breite (Tablet quer, Mac) gibt es die feste Seitenleiste wie auf dem Desktop. */
const WIDE = 900

function routeKey(r: Route): string {
  return r.name === 'transcript' ? `t-${r.id}` : r.name
}

function PageFor({ route }: { route: Route }): ReactNode {
  switch (route.name) {
    case 'home':
      return <Home />
    case 'library':
      return <Library />
    case 'transcript':
      return <TranscriptView id={route.id} />
    case 'record':
      return <Record />
    case 'history':
      return <History />
    case 'vocabulary':
      return <Vocabulary />
    case 'dictation':
      return <Dictation />
    case 'models':
      return <Models />
    case 'settings':
      return <SettingsPage />
  }
}

/** Seitenwechsel: leichtes Einblenden, auf dem Telefon Schieben bei Vor/Zurück. */
function Transition({ route, wide }: { route: Route; wide: boolean }): ReactNode {
  const nav = useApp((s) => s.nav)
  const v = useRef(new Animated.Value(1)).current
  const key = routeKey(route)
  useEffect(() => {
    v.setValue(0)
    Animated.timing(v, { toValue: 1, duration: !wide && nav !== 'replace' ? 260 : 160, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: nativeAnimations }).start()
  }, [key, v]) // eslint-disable-line react-hooks/exhaustive-deps
  const shift = !wide && nav === 'push' ? 32 : !wide && nav === 'pop' ? -32 : 0
  return (
    <Animated.View
      key={key}
      style={{
        flex: 1,
        opacity: v,
        transform: shift ? [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [shift, 0] }) }] : [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }]
      }}
    >
      <PageFor route={route} />
    </Animated.View>
  )
}

function Splash(): ReactNode {
  const c = useTheme()
  const status = useApp((s) => s.status)
  const error = useApp((s) => s.loadError)
  if (status === 'error')
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: c.bg, padding: 24 }}>
        <EmptyState
          icon={CircleAlert}
          title="Flusstext konnte nicht starten"
          text={error ? `Die lokalen Daten ließen sich nicht laden: ${error}` : 'Die lokalen Daten ließen sich nicht laden.'}
          action={
            <Button variant="primary" onPress={() => void load()}>
              Erneut versuchen
            </Button>
          }
        />
      </View>
    )
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, backgroundColor: c.bg }} accessibilityLabel="Flusstext wird geladen">
      <Logo size={44} />
      <Spinner />
    </View>
  )
}

function Shell(): ReactNode {
  const c = useTheme()
  const { width } = useWindowDimensions()
  const wide = width >= WIDE
  const route = useApp((s) => currentRoute(s))
  const onboardingDone = useApp((s) => s.settings?.onboardingDone)
  const trail = useApp((s) => {
    const r = currentRoute(s)
    return r.name === 'transcript' ? s.transcripts.find((t) => t.id === r.id)?.title : undefined
  })
  const [drawer, setDrawer] = useState(false)

  useEffect(() => {
    if (wide) setDrawer(false)
  }, [wide])

  // Android-Zurück: Schublade schließen, Suche leeren, dann im Verlauf zurück
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (drawer) {
        setDrawer(false)
        return true
      }
      if (getState().search) {
        setSearch('')
        return true
      }
      return goBack()
    })
    return () => sub.remove()
  }, [drawer])

  if (!onboardingDone) return <Onboarding />

  const content = (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Transition route={route} wide={wide} />
    </KeyboardAvoidingView>
  )

  return wide ? (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.sidebar }}>
      <Sidebar />
      <View style={{ flex: 1, minWidth: 0, backgroundColor: c.bg }}>
        <TopBar trail={trail} />
        {content}
      </View>
    </View>
  ) : (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PhoneHeader onMenu={() => setDrawer(true)} trail={trail} />
      {content}
      <Drawer open={drawer} onClose={() => setDrawer(false)} />
    </View>
  )
}

function Root({ api }: { api: FlusstextApi }): ReactNode {
  const scheme = useColorScheme()
  const { width } = useWindowDimensions()
  const theme = useApp((s) => s.settings?.theme ?? 'system')
  const status = useApp((s) => s.status)
  const isDark = theme === 'dark' || (theme === 'system' && scheme === 'dark')
  const c = isDark ? dark : light

  useEffect(() => connect(api), [api])

  const value = useMemo(() => {
    const wide = width >= WIDE
    const layout: Layout = { wide, width, pad: wide ? 28 : 16, platform: api.platform, desktop: api.platform === 'macos' }
    return { c, layout }
  }, [c, width, api.platform])

  return (
    <ThemeContext.Provider value={value}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={c.bg} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}>
        {status === 'ready' && getState().settings ? <Shell /> : <Splash />}
        <Toasts />
      </View>
    </ThemeContext.Provider>
  )
}

export function FlusstextApp({ api }: { api: FlusstextApi }): ReactNode {
  return (
    <SafeAreaProvider>
      <Root api={api} />
    </SafeAreaProvider>
  )
}

export default FlusstextApp

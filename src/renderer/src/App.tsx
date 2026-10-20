import { AnimatePresence, motion } from 'motion/react'
import { useEffect, type ReactNode } from 'react'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { Toasts } from './components/Toasts'
import { useApp } from './lib/store'
import { Home } from './pages/Home'
import { Library } from './pages/Library'
import { TranscriptView } from './pages/TranscriptView'
import { Record } from './pages/Record'
import { Dictation } from './pages/Dictation'
import { History } from './pages/History'
import { Vocabulary } from './pages/Vocabulary'
import { Models } from './pages/Models'
import { SettingsPage } from './pages/Settings'
import { Onboarding } from './pages/Onboarding'
import { GlobalDrop } from './components/GlobalDrop'

function useThemeClass(): void {
  const theme = useApp((s) => s.settings?.theme ?? 'system')
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

export function App(): ReactNode {
  useThemeClass()
  const route = useApp((s) => s.route)
  const onboardingDone = useApp((s) => s.settings?.onboardingDone)
  const trail = useApp((s) => (s.route.name === 'transcript' ? s.transcripts.find((t) => t.id === (s.route as { id: string }).id)?.title : undefined))

  let page: ReactNode
  switch (route.name) {
    case 'home':
      page = <Home />
      break
    case 'library':
      page = <Library />
      break
    case 'transcript':
      page = <TranscriptView id={route.id} />
      break
    case 'record':
      page = <Record />
      break
    case 'history':
      page = <History />
      break
    case 'vocabulary':
      page = <Vocabulary />
      break
    case 'dictation':
      page = <Dictation />
      break
    case 'models':
      page = <Models />
      break
    case 'settings':
      page = <SettingsPage />
      break
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      {/* Die Kopfzeile ist zugleich Titelleiste; die Fensterknöpfe kommen nativ über titleBarOverlay */}
      <main className="flex min-w-0 flex-1 flex-col bg-bg">
        <TopBar trail={trail} />
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={route.name === 'transcript' ? `t-${route.id}` : route.name}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="h-full"
            >
              {page}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      <GlobalDrop />
      <Toasts />
      {!onboardingDone && <Onboarding />}
    </div>
  )
}

import { Search, X } from 'lucide-react'
import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import { useApp, type Route } from '../lib/store'

const TITLES: Record<Route['name'], string> = {
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

const PLACEHOLDER: Partial<Record<Route['name'], string>> = {
  transcript: 'In diesem Transkript suchen',
  history: 'Diktate durchsuchen',
  vocabulary: 'Wörterbuch durchsuchen'
}

/** Seiten, auf denen das Suchfeld direkt filtert – sonst springt die Suche zu den Transkripten. */
const SEARCHABLE = new Set<Route['name']>(['library', 'transcript', 'history', 'vocabulary'])

export function TopBar({ trail }: { trail?: string }): ReactNode {
  const route = useApp((s) => s.route)
  const navigate = useApp((s) => s.navigate)
  const search = useApp((s) => s.search)
  const setSearch = useApp((s) => s.setSearch)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((window.api.platform === 'darwin' ? e.metaKey : e.ctrlKey) && (e.key === 'k' || e.key === 'f')) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const crumbs = [TITLES[route.name], ...(trail ? [trail] : [])]
  const hideSearch = route.name === 'record'

  return (
    <div className="drag flex h-[52px] shrink-0 items-center gap-3 border-b border-line pr-[150px] pl-7">
      <div className="no-drag flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <span aria-hidden>/</span>}
            {i === 0 && crumbs.length > 1 ? (
              <button className="hover:text-fg" onClick={() => navigate({ name: route.name === 'transcript' ? 'library' : route.name } as Route)}>
                {c}
              </button>
            ) : (
              <span className={i === crumbs.length - 1 ? 'truncate text-fg' : ''}>{c}</span>
            )}
          </Fragment>
        ))}
      </div>
      {!hideSearch && (
        <label className="no-drag ml-auto flex h-9 w-[320px] min-w-0 shrink items-center gap-2 rounded-[9px] border border-line bg-panel px-3 text-muted transition-colors focus-within:border-line-strong">
          <Search className="size-[15px] shrink-0" />
          <span className="sr-only">Suchen</span>
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              if (!SEARCHABLE.has(route.name)) {
                navigate({ name: 'library' })
                setSearch(e.target.value)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearch('')
                e.currentTarget.blur()
              }
            }}
            placeholder={PLACEHOLDER[route.name] ?? 'Wörter, Sprecher, Titel suchen'}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-muted"
          />
          {search ? (
            <button aria-label="Suche leeren" className="hover:text-fg" onClick={() => setSearch('')}>
              <X className="size-3.5" />
            </button>
          ) : (
            <kbd className="font-mono text-[11px]">{window.api.platform === 'darwin' ? '⌘ K' : 'Strg K'}</kbd>
          )}
        </label>
      )}
    </div>
  )
}

import { ArrowRight, BookText, Plus, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Replacement } from '@shared/types'
import { Button, Card, EmptyState, IconButton, PageHeader } from '../components/ui'
import { useApp } from '../lib/store'

const SUGGESTIONS: Replacement[] = [
  { from: 'neue Zeile', to: '\n' },
  { from: 'Doppelpunkt', to: ':' },
  { from: 'Fragezeichen', to: '?' }
]

function target(r: Replacement): ReactNode {
  if (r.to === '\n') return <span className="text-muted">⏎ Zeilenumbruch</span>
  if (!r.to) return <em className="text-muted">wird entfernt</em>
  return r.to
}

export function Vocabulary(): ReactNode {
  const list = useApp((s) => s.settings!.replacements)
  const setSettings = useApp((s) => s.setSettings)
  const query = useApp((s) => s.search.trim().toLowerCase())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const save = (next: Replacement[]): Promise<void> => setSettings({ replacements: next })
  const add = (r: Replacement): void => {
    if (!r.from.trim()) return
    void save([...list.filter((x) => x.from.toLowerCase() !== r.from.trim().toLowerCase()), { from: r.from.trim(), to: r.to }])
  }
  const shown = query ? list.filter((r) => r.from.toLowerCase().includes(query) || r.to.toLowerCase().includes(query)) : list
  const unused = SUGGESTIONS.filter((s) => !list.some((r) => r.from.toLowerCase() === s.from.toLowerCase()))

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[880px] px-7 pt-8 pb-16">
        <PageHeader
          title="Wörterbuch"
          subtitle="Korrigiert falsch erkannte Namen und Fachbegriffe oder erweitert Kürzel – in Diktaten und Transkripten."
        />

        <Card className="mb-6 p-4">
          <div className="flex items-center gap-3">
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (add({ from, to }), setFrom(''), setTo(''))}
              placeholder="Erkannt als … (z. B. „Jasmin“)"
              className="h-10 min-w-0 flex-1 rounded-[9px] border border-line bg-bg px-3 text-[13.5px] outline-none placeholder:text-muted focus:border-line-strong"
            />
            <ArrowRight className="size-4 shrink-0 text-muted" />
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (add({ from, to }), setFrom(''), setTo(''))}
              placeholder="Ersetzen durch … (z. B. „Yasmin“)"
              className="h-10 min-w-0 flex-1 rounded-[9px] border border-line bg-bg px-3 text-[13.5px] outline-none placeholder:text-muted focus:border-line-strong"
            />
            <Button
              size="lg"
              variant="primary"
              icon={<Plus />}
              disabled={!from.trim()}
              onClick={() => {
                add({ from, to })
                setFrom('')
                setTo('')
              }}
            >
              Hinzufügen
            </Button>
          </div>
          {unused.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
              Vorschläge:
              {unused.map((s) => (
                <button
                  key={s.from}
                  onClick={() => add(s)}
                  className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 font-medium text-fg-2 hover:bg-line-strong/70 hover:text-fg"
                >
                  <Plus className="size-3" />
                  {s.from} → {s.to === '\n' ? '⏎' : s.to}
                </button>
              ))}
            </div>
          )}
        </Card>

        {list.length === 0 ? (
          <Card>
            <EmptyState
              icon={<BookText />}
              title="Noch keine Einträge"
              text="Wird ein Name immer wieder falsch geschrieben? Trag ihn hier ein – Groß- und Kleinschreibung spielt keine Rolle, es werden nur ganze Wörter ersetzt."
            />
          </Card>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">
              <span>{list.length === 1 ? '1 Eintrag' : `${list.length} Einträge`}</span>
            </div>
            <Card className="divide-y divide-line-soft overflow-hidden">
              {shown.map((r) => (
                <div key={r.from} className="group flex items-center gap-4 px-5 py-3 hover:bg-surface">
                  <span className="min-w-0 flex-1 truncate text-[14px] text-fg-2">{r.from}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{target(r)}</span>
                  <IconButton label="Entfernen" className="opacity-0 group-hover:opacity-100" onClick={() => save(list.filter((x) => x !== r))}>
                    <Trash2 />
                  </IconButton>
                </div>
              ))}
              {shown.length === 0 && <div className="px-5 py-8 text-center text-[13px] text-muted">Keine Treffer für „{query}“</div>}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

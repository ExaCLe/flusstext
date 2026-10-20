import { AudioLines, Check, Copy, Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { DictationEntry } from '@shared/types'
import { Button, Card, EmptyState, Hotkey, IconButton, Modal, PageHeader } from '../components/ui'
import { dayLabel, num, time } from '../lib/format'
import { highlight } from '../lib/highlight'
import { useApp } from '../lib/store'

function DictationRow({ entry, query }: { entry: DictationEntry; query: string }): ReactNode {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    await window.api.dictation.copy(entry.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <div className="group flex gap-4 px-5 py-3.5 transition-colors hover:bg-surface">
      <div className="w-12 shrink-0 pt-[3px] font-mono text-[12px] text-muted tabular">{time(entry.createdAt)}</div>
      <div className="min-w-0 flex-1">
        <p className="selectable text-[14.5px] leading-[1.6]">{highlight(entry.text, query)}</p>
        <div className="mt-1 text-[12px] text-faint">
          {entry.words === 1 ? '1 Wort' : `${num(entry.words)} Wörter`} · {Math.max(1, Math.round(entry.duration))} s gesprochen
        </div>
      </div>
      <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton label="Kopieren" onClick={copy}>
          {copied ? <Check className="text-success" /> : <Copy />}
        </IconButton>
        <IconButton label="Löschen" onClick={() => window.api.dictation.remove(entry.id)}>
          <Trash2 />
        </IconButton>
      </div>
    </div>
  )
}

export function History(): ReactNode {
  const dictations = useApp((s) => s.dictations)
  const settings = useApp((s) => s.settings!)
  const query = useApp((s) => s.search.trim())
  const [confirm, setConfirm] = useState(false)

  const groups = useMemo(() => {
    const q = query.toLowerCase()
    const list = q ? dictations.filter((d) => d.text.toLowerCase().includes(q)) : dictations.slice(0, 300)
    const out: { label: string; items: DictationEntry[] }[] = []
    for (const d of list) {
      const label = dayLabel(d.createdAt)
      const g = out[out.length - 1]
      if (g && g.label === label) g.items.push(d)
      else out.push({ label, items: [d] })
    }
    return out
  }, [dictations, query])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[880px] px-7 pt-8 pb-16">
        <PageHeader
          title="Diktat-Verlauf"
          subtitle={
            <span className="inline-flex flex-wrap items-center gap-1.5">
              Alles, was du mit <Hotkey keys={settings.dictation.hotkey} /> diktierst – durchsuchbar und jederzeit kopierbar.
            </span>
          }
          actions={
            dictations.length > 0 && (
              <Button variant="ghost" icon={<Trash2 />} onClick={() => setConfirm(true)}>
                Verlauf löschen
              </Button>
            )
          }
        />

        {dictations.length === 0 ? (
          <Card>
            <EmptyState
              icon={<AudioLines />}
              title="Noch keine Diktate"
              text="Halte den Kurzbefehl in einem beliebigen Textfeld, sprich und lass los – der Text wird eingefügt und erscheint hier."
            />
          </Card>
        ) : groups.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-muted">Keine Treffer für „{query}“</div>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((g) => (
              <div key={g.label}>
                <div className="mb-2 px-1 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">{g.label}</div>
                <Card className="divide-y divide-line-soft overflow-hidden">
                  {g.items.map((d) => (
                    <DictationRow key={d.id} entry={d} query={query} />
                  ))}
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={confirm} onClose={() => setConfirm(false)} width={400}>
        <div className="text-[16px] font-semibold">Diktat-Verlauf löschen?</div>
        <p className="mt-2 text-[13px] text-muted">Alle {num(dictations.length)} gespeicherten Diktate werden entfernt. Transkripte bleiben erhalten.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={() => setConfirm(false)}>Abbrechen</Button>
          <Button
            variant="danger"
            onClick={async () => {
              await window.api.dictation.clear()
              setConfirm(false)
            }}
          >
            Löschen
          </Button>
        </div>
      </Modal>
    </div>
  )
}

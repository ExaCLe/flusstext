import { AudioLines, Trash2 } from 'lucide-react-native'
import { useMemo, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import type { DictationEntry } from '../../core/contracts'
import { Button, Card, Confirm, EmptyState, Eyebrow, Hotkey, PageHeader, T } from '../components'
import { dayLabel, num } from '../format'
import { attempt, getApi, load, navigate, useApp } from '../store'
import { useLayout, useTheme } from '../theme'
import { DictationRow, Page } from './common'

export function History(): ReactNode {
  const c = useTheme()
  const { desktop } = useLayout()
  const dictations = useApp((s) => s.dictations)
  const hotkey = useApp((s) => s.settings!.dictation.hotkey)
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
    <Page onRefresh={load}>
      <PageHeader
        title="Diktat-Verlauf"
        subtitle={
          desktop ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <T size={13.5} color={c.muted}>
                Alles, was du mit
              </T>
              <Hotkey keys={hotkey} />
              <T size={13.5} color={c.muted}>
                diktierst – durchsuchbar und jederzeit kopierbar.
              </T>
            </View>
          ) : (
            'Alles, was du diktierst – durchsuchbar und jederzeit kopierbar.'
          )
        }
        actions={
          dictations.length > 0 ? (
            <Button variant="ghost" icon={Trash2} onPress={() => setConfirm(true)}>
              Verlauf löschen
            </Button>
          ) : undefined
        }
      />

      {dictations.length === 0 ? (
        <Card>
          <EmptyState
            icon={AudioLines}
            title="Noch keine Diktate"
            text={
              desktop
                ? 'Halte den Kurzbefehl in einem beliebigen Textfeld, sprich und lass los – der Text wird eingefügt und erscheint hier.'
                : 'Starte unter „Diktat“ ein Diktat, sprich und tippe auf „Fertig“ – der Text erscheint hier.'
            }
            action={
              desktop ? undefined : (
                <Button variant="primary" onPress={() => navigate({ name: 'dictation' })}>
                  Zum Diktat
                </Button>
              )
            }
          />
        </Card>
      ) : groups.length === 0 ? (
        <T size={13} color={c.muted} style={{ paddingVertical: 64, textAlign: 'center' }}>
          Keine Treffer für „{query}“
        </T>
      ) : (
        <View style={{ gap: 24 }}>
          {groups.map((g) => (
            <View key={g.label}>
              <Eyebrow>{g.label}</Eyebrow>
              <Card divided>
                {g.items.map((d) => (
                  <DictationRow key={d.id} entry={d} query={query} meta />
                ))}
              </Card>
            </View>
          ))}
        </View>
      )}

      <Confirm
        open={confirm}
        title="Diktat-Verlauf löschen?"
        text={`Alle ${num(dictations.length)} gespeicherten Diktate werden entfernt. Transkripte bleiben erhalten.`}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          await attempt('Verlauf konnte nicht gelöscht werden', () => getApi().dictation.clear())
          setConfirm(false)
        }}
      />
    </Page>
  )
}

import { ArrowDown, ArrowRight, BookText, Plus, Trash2 } from 'lucide-react-native'
import { useState, type ReactNode } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import type { Replacement } from '../../../../src/shared/types'
import { Button, Card, EmptyState, Eyebrow, IconButton, PageHeader, T, inputStyle } from '../components'
import { setSettings, useApp } from '../store'
import { useLayout, useTheme } from '../theme'
import { Page } from './common'

const SUGGESTIONS: Replacement[] = [
  { from: 'neue Zeile', to: '\n' },
  { from: 'Doppelpunkt', to: ':' },
  { from: 'Fragezeichen', to: '?' }
]

function Target({ r }: { r: Replacement }): ReactNode {
  const c = useTheme()
  if (r.to === '\n')
    return (
      <T size={14} color={c.muted} lines={1} style={{ flex: 1 }}>
        ⏎ Zeilenumbruch
      </T>
    )
  if (!r.to)
    return (
      <T size={14} color={c.muted} lines={1} style={{ flex: 1, fontStyle: 'italic' }}>
        wird entfernt
      </T>
    )
  return (
    <T size={14} weight={500} lines={1} style={{ flex: 1 }}>
      {r.to}
    </T>
  )
}

export function Vocabulary(): ReactNode {
  const c = useTheme()
  const { wide } = useLayout()
  const list = useApp((s) => s.settings!.replacements)
  const query = useApp((s) => s.search.trim().toLowerCase())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [focus, setFocus] = useState<'from' | 'to' | null>(null)

  const save = (next: Replacement[]): Promise<boolean> => setSettings({ replacements: next })
  const add = async (r: Replacement): Promise<void> => {
    if (!r.from.trim()) return
    const ok = await save([...list.filter((x) => x.from.toLowerCase() !== r.from.trim().toLowerCase()), { from: r.from.trim(), to: r.to }])
    if (ok && r.from === from) {
      setFrom('')
      setTo('')
    }
  }
  const shown = query ? list.filter((r) => r.from.toLowerCase().includes(query) || r.to.toLowerCase().includes(query)) : list
  const unused = SUGGESTIONS.filter((s) => !list.some((r) => r.from.toLowerCase() === s.from.toLowerCase()))

  return (
    <Page>
      <PageHeader title="Wörterbuch" subtitle="Korrigiert falsch erkannte Namen und Fachbegriffe oder erweitert Kürzel – in Diktaten und Transkripten." />

      <Card style={{ marginBottom: 24, padding: 16 }}>
        <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'stretch', gap: wide ? 12 : 8 }}>
          <TextInput
            value={from}
            onChangeText={setFrom}
            onFocus={() => setFocus('from')}
            onBlur={() => setFocus(null)}
            onSubmitEditing={() => void add({ from, to })}
            returnKeyType="done"
            autoCorrect={false}
            accessibilityLabel="Erkannt als"
            placeholder="Erkannt als … (z. B. „Jasmin“)"
            placeholderTextColor={c.muted}
            style={[inputStyle(c, focus === 'from'), { flex: wide ? 1 : undefined, fontSize: 13.5 }]}
          />
          {wide ? <ArrowRight size={16} color={c.muted} /> : <ArrowDown size={16} color={c.muted} style={{ alignSelf: 'center' }} />}
          <TextInput
            value={to}
            onChangeText={setTo}
            onFocus={() => setFocus('to')}
            onBlur={() => setFocus(null)}
            onSubmitEditing={() => void add({ from, to })}
            returnKeyType="done"
            autoCorrect={false}
            accessibilityLabel="Ersetzen durch"
            placeholder="Ersetzen durch … (z. B. „Yasmin“)"
            placeholderTextColor={c.muted}
            style={[inputStyle(c, focus === 'to'), { flex: wide ? 1 : undefined, fontSize: 13.5 }]}
          />
          <Button size="lg" variant="primary" icon={Plus} disabled={!from.trim()} onPress={() => void add({ from, to })}>
            Hinzufügen
          </Button>
        </View>
        {unused.length > 0 && (
          <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <T size={12} color={c.muted}>
              Vorschläge:
            </T>
            {unused.map((s) => (
              <Pressable
                key={s.from}
                accessibilityRole="button"
                accessibilityLabel={`Vorschlag ${s.from} hinzufügen`}
                onPress={() => void add(s)}
                hitSlop={{ top: 10, bottom: 10 }}
                style={({ pressed }) => ({ height: 24, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: pressed ? c.lineStrong : c.surface2, paddingHorizontal: 10 })}
              >
                <Plus size={12} color={c.fg2} />
                <T size={12} weight={500} color={c.fg2}>
                  {s.from} → {s.to === '\n' ? '⏎' : s.to}
                </T>
              </Pressable>
            ))}
          </View>
        )}
      </Card>

      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={BookText}
            title="Noch keine Einträge"
            text="Wird ein Name immer wieder falsch geschrieben? Trag ihn hier ein – Groß- und Kleinschreibung spielt keine Rolle, es werden nur ganze Wörter ersetzt."
          />
        </Card>
      ) : (
        <>
          <Eyebrow>{list.length === 1 ? '1 Eintrag' : `${list.length} Einträge`}</Eyebrow>
          <Card divided>
            {shown.map((r) => (
              <View key={r.from} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingLeft: 20, paddingRight: 12, paddingVertical: 12 }}>
                <T size={14} color={c.fg2} lines={1} style={{ flex: 1 }}>
                  {r.from}
                </T>
                <ArrowRight size={14} color={c.faint} />
                <Target r={r} />
                <IconButton icon={Trash2} label={`${r.from} entfernen`} onPress={() => void save(list.filter((x) => x !== r))} />
              </View>
            ))}
            {shown.length === 0 && (
              <T size={13} color={c.muted} style={{ paddingHorizontal: 20, paddingVertical: 32, textAlign: 'center' }}>
                Keine Treffer für „{query}“
              </T>
            )}
          </Card>
        </>
      )}
    </Page>
  )
}

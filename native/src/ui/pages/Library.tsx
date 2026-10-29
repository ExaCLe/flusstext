import { FileAudio2, FileUp, Search, X } from 'lucide-react-native'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { Job, SearchHit } from '../../core/contracts'
import { Button, Card, EmptyState, Eyebrow, IconButton, PageHeader, Progress, Spinner, T } from '../components'
import { ACTIVE_JOB, attempt, errorDetail, getApi, load, navigate, pickAndTranscribe, useApp } from '../store'
import { alpha, mono, useLayout, useTheme } from '../theme'
import { Page, TranscribeOptionsBar, TranscriptRow } from './common'

export const STAGE: Record<string, string> = {
  queued: 'Wartet …',
  loading: 'Modell wird geladen …',
  decoding: 'Audio wird gelesen …',
  diarizing: 'Sprecher werden erkannt …',
  transcribing: 'Transkribiere …'
}

function JobRow({ job }: { job: Job }): ReactNode {
  const c = useTheme()
  const indeterminate = job.stage === 'diarizing' || job.stage === 'loading' || job.stage === 'queued'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${job.fileName}, ${STAGE[job.stage] ?? job.stage}`}
      onPress={() => navigate({ name: 'transcript', id: job.transcriptId })}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 16, paddingLeft: 20, paddingRight: 12, paddingVertical: 14, backgroundColor: pressed ? c.surface : 'transparent' })}
    >
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <FileAudio2 size={16} color={c.accentText} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <T size={13.5} weight={500} lines={1} style={{ flexShrink: 1 }}>
            {job.fileName}
          </T>
          <Text style={[mono, { fontSize: 12, color: c.muted }]}>
            {job.stage === 'transcribing' || job.stage === 'decoding' ? `${Math.round(job.progress * 100)} %` : ''}
          </Text>
        </View>
        <Progress value={job.progress} indeterminate={indeterminate} style={{ marginTop: 8 }} />
        <T size={12} color={c.muted} style={{ marginTop: 6 }}>
          {STAGE[job.stage] ?? job.stage}
        </T>
      </View>
      <IconButton icon={X} label="Abbrechen" onPress={() => void attempt('Abbrechen fehlgeschlagen', () => getApi().jobs.cancel(job.id))} />
    </Pressable>
  )
}

export function Library(): ReactNode {
  const c = useTheme()
  const { desktop } = useLayout()
  const transcripts = useApp((s) => s.transcripts)
  const jobs = useApp((s) => s.jobs)
  const query = useApp((s) => s.search.trim())
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const active = useMemo(() => jobs.filter(ACTIVE_JOB), [jobs])

  // Volltextsuche (Titel, Text, Sprecher, Notizen) in der nativen Schicht
  useEffect(() => {
    if (!query) {
      setHits(null)
      setSearchError(null)
      return
    }
    let alive = true
    setSearching(true)
    const id = setTimeout(() => {
      getApi()
        .transcripts.search(query)
        .then((h) => {
          if (!alive) return
          setHits(h)
          setSearchError(null)
        })
        .catch((e) => alive && setSearchError(errorDetail(e) ?? 'Die Suche ist fehlgeschlagen.'))
        .finally(() => alive && setSearching(false))
    }, 150)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [query, transcripts])

  const list = useMemo(() => {
    const items = transcripts.filter((t) => t.status !== 'processing' || !active.some((j) => j.transcriptId === t.id))
    if (!hits) return items.map((t) => ({ t, snippet: undefined as string | undefined }))
    const byId = new Map(items.map((t) => [t.id, t]))
    return hits.filter((h) => byId.has(h.id)).map((h) => ({ t: byId.get(h.id)!, snippet: h.snippet }))
  }, [transcripts, hits, active])

  return (
    <Page maxWidth={920} onRefresh={load}>
      <PageHeader
        title="Transkripte"
        subtitle="Audio- und Videodateien lokal in Text umwandeln – mit Zeitstempeln und Sprechern."
        actions={
          <Button size="lg" variant="primary" icon={FileUp} onPress={() => void pickAndTranscribe()}>
            Dateien hinzufügen
          </Button>
        }
      />

      <Card style={{ marginBottom: 24, overflow: 'visible' }}>
        <TranscribeOptionsBar />
      </Card>

      {active.length > 0 && (
        <View style={{ marginBottom: 24 }}>
          <Eyebrow>In Bearbeitung</Eyebrow>
          <Card divided>
            {active.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </Card>
        </View>
      )}

      {transcripts.length === 0 && active.length === 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dateien auswählen"
          onPress={() => void pickAndTranscribe()}
          style={({ pressed }) => ({
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 16,
            borderWidth: 2,
            borderStyle: 'dashed',
            borderColor: pressed ? alpha(c.accent, 0.5) : c.lineStrong,
            backgroundColor: pressed ? c.accentSoft : 'transparent',
            paddingHorizontal: 24,
            paddingVertical: 72
          })}
        >
          <View style={{ marginBottom: 16, width: 48, height: 48, borderRadius: 16, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <FileUp size={20} color={c.fg} />
          </View>
          <T size={15} weight={600}>
            {desktop ? 'Dateien hierher ziehen' : 'Dateien auswählen'}
          </T>
          <T size={13} color={c.muted} style={{ marginTop: 4, maxWidth: 384, textAlign: 'center', lineHeight: 19 }}>
            {desktop ? 'oder klicken, um auszuwählen' : 'Tippen, um auszuwählen'} · MP3, WAV, M4A, QTA, MP4, MKV, OGG, FLAC und mehr
          </T>
        </Pressable>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Eyebrow>{query ? (list.length === 1 ? '1 Treffer' : `${list.length} Treffer`) : 'Alle Transkripte'}</Eyebrow>
            {searching && (
              <View style={{ marginBottom: 8 }}>
                <Spinner />
              </View>
            )}
          </View>
          <Card divided>
            {list.map(({ t, snippet }) => (
              <TranscriptRow key={t.id} t={t} snippet={snippet} query={query} />
            ))}
            {list.length === 0 && query && !searching && (
              <EmptyState icon={Search} title={searchError ? 'Suche fehlgeschlagen' : 'Keine Treffer'} text={searchError ?? `Nichts gefunden für „${query}“.`} />
            )}
          </Card>
        </>
      )}
    </Page>
  )
}

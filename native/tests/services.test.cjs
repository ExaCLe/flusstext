// Dienste mit speicherinternem Dateisystem: Modellinstallation, Transkript-Speicher und Auftragswarteschlange.
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { mock, core } = require('./helpers/load.cjs')
const { createMemFs } = require('./helpers/memfs.cjs')

const fs = createMemFs()
mock('@dr.pogodin/react-native-fs', fs)
const extracted = []
mock('react-native-sherpa-onnx/extraction', {
  async extractArchive(archive, dir, opts) {
    extracted.push(archive.archivePath)
    const spec = fs.remoteArchives.get(archive.archivePath.split('/').pop().replace(/-[0-9a-f-]{36}\.tar\.bz2$/, ''))
    if (opts.signal?.aborted) throw Object.assign(new Error('Extraction aborted'), { name: 'AbortError' })
    for (const [name, data] of Object.entries(spec)) {
      await fs.mkdir(`${dir}/${name.split('/').slice(0, -1).join('/')}`.replace(/\/$/, ''))
      await fs.writeFile(`${dir}/${name}`, data)
    }
    return { success: true }
  }
})
fs.remoteArchives = new Map()

const { Bus } = require(core('bus'))
const { pathsFor, ensureDirs, writeAtomic } = require(core('fs'))
const { SettingsStore } = require(core('settings'))
const { ModelManager } = require(core('models'))
const { TranscriptStore } = require(core('store'))
const { JobQueue } = require(core('jobs'))
const { CATALOG } = require('../../src/shared/catalog.ts')

const paths = pathsFor({ version: '0', dataDir: 'file:///app/data', modelsDir: '/app/models', tempDir: '/app/tmp', freeDiskBytes: 1e12, cpuThreads: 8, memoryBytes: 6e9 })
const host = { engineCall: async () => { throw new Error('nicht erwartet') } }
const tick = () => new Promise((r) => setImmediate(r))

async function setup() {
  await ensureDirs(paths)
  const bus = new Bus()
  const events = []
  bus.subscribe((e) => events.push(e))
  const settings = await SettingsStore.load(paths, bus, 'ios', 8)
  const models = new ModelManager(paths, bus, settings, host, 'ios', { memoryBytes: 6e9, cpuThreads: 8 })
  await models.init()
  return { bus, events, settings, models }
}

test('Pfade: file://-URLs werden zu Dateipfaden, Staging liegt beim Modellordner', () => {
  assert.equal(paths.data, '/app/data')
  assert.equal(paths.staging, '/app/models/.staging')
  assert.equal(paths.tmp, '/app/tmp/flusstext')
})

test('Modell-Download: Dateien prüfen, im Staging sammeln und atomar installieren', async () => {
  const { models, settings } = await setup()
  const def = CATALOG.find((m) => m.id === 'whisper-base')
  const body = crypto.randomBytes(def.files[0].size)
  fs.remote.set(def.files[0].url, { body })
  fs.remote.set(CATALOG.find((m) => m.id === 'vad-silero').files[0].url, { body: crypto.randomBytes(643854) })
  await models.download('whisper-base')
  assert.ok(models.isInstalled('whisper-base'))
  assert.equal(fs.nodes.get('/app/models/whisper-base/model.bin').length, body.length)
  assert.ok(fs.nodes.has('/app/models/whisper-base/.complete'))
  assert.deepEqual([...fs.nodes.keys()].filter((k) => k.startsWith('/app/models/.staging/')), [])
  assert.equal(settings.get().transcriptionModel, 'whisper-base')
  const listed = models.list().find((m) => m.id === 'whisper-base')
  assert.ok(listed.installed && listed.recommendation)
})

test('Modell-Download: falsche Prüfsumme, falsche Größe und HTML-Seiten werden abgewiesen', async () => {
  const { models } = await setup()
  const nemotron = CATALOG.find((m) => m.id === 'nemotron-3.5-transcribe-lite')
  // Prüfsumme: kleine Datei mit passender Größe, aber falschem Inhalt
  for (const f of nemotron.files) fs.remote.set(f.url, { body: Buffer.alloc(f.size), contentLength: f.size })
  await assert.rejects(models.download('nemotron-3.5-transcribe-lite'), /Prüfsumme/)
  assert.equal(models.isInstalled('nemotron-3.5-transcribe-lite'), false)
  assert.equal(models.list().find((m) => m.id === 'nemotron-3.5-transcribe-lite').download.state, 'error')
  assert.deepEqual([...fs.nodes.keys()].filter((k) => k.startsWith('/app/models/.staging/')), [])

  const small = CATALOG.find((m) => m.id === 'whisper-small')
  fs.remote.set(small.files[0].url, { body: Buffer.alloc(10) })
  await assert.rejects(models.download('whisper-small'), /unerwartete Größe|unvollständig/)

  const emb = CATALOG.find((m) => m.id === 'emb-speakernet')
  fs.remote.set(emb.files[0].url, { body: Buffer.from('<!DOCTYPE html><html>Login</html>'.padEnd(emb.files[0].size, ' ')) })
  await assert.rejects(models.download('emb-speakernet'), /Webseite/)
  fs.remote.set(emb.files[0].url, { body: Buffer.alloc(emb.files[0].size), headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  await assert.rejects(models.download('emb-speakernet'), /Webseite/)
  assert.equal(models.isInstalled('emb-speakernet'), false)
})

test('Modell-Download: Abbruch entfernt Teildateien und Staging', async () => {
  const { models } = await setup()
  const def = CATALOG.find((m) => m.id === 'emb-titanet-small')
  let release
  fs.remote.set(def.files[0].url, { body: Buffer.alloc(def.files[0].size), hold: new Promise((r) => (release = r)) })
  const running = models.download('emb-titanet-small')
  await tick()
  await tick()
  assert.equal(models.list().find((m) => m.id === 'emb-titanet-small').download.state, 'downloading')
  await models.cancel('emb-titanet-small')
  release()
  await running
  assert.equal(models.isInstalled('emb-titanet-small'), false)
  assert.equal(models.list().find((m) => m.id === 'emb-titanet-small').download, undefined)
  assert.deepEqual([...fs.nodes.keys()].filter((k) => k.includes('.part') || k.startsWith('/app/models/.staging/')), [])
})

test('Archiv-Modell: entpacken, Wurzelordner auflösen, Pflichtdateien prüfen', async () => {
  const { models } = await setup()
  const def = CATALOG.find((m) => m.id === 'nemo-fastconformer-de')
  fs.remote.set(def.archive.url, { body: crypto.randomBytes(def.archive.size) })
  fs.remoteArchives.set('nemo-fastconformer-de', {
    'root/encoder.int8.onnx': 'e',
    'root/decoder.int8.onnx': 'd',
    'root/joiner.int8.onnx': 'j',
    'root/tokens.txt': 't',
    'root/test_wavs/0.wav': 'w'
  })
  await models.download('nemo-fastconformer-de')
  assert.ok(models.isInstalled('nemo-fastconformer-de'))
  assert.ok(fs.nodes.has('/app/models/nemo-fastconformer-de/tokens.txt'))
  assert.ok(!fs.nodes.has('/app/models/nemo-fastconformer-de/test_wavs'))
  assert.deepEqual([...fs.nodes.keys()].filter((k) => k.endsWith('.tar.bz2')), [])

  // Unvollständiges Archiv wird nicht installiert
  const canary = CATALOG.find((m) => m.id === 'canary-180m-flash')
  fs.remote.set(canary.archive.url, { body: crypto.randomBytes(canary.archive.size) })
  fs.remoteArchives.set('canary-180m-flash', { 'x/encoder.int8.onnx': 'e' })
  await assert.rejects(models.download('canary-180m-flash'), /unvollständig/)
  assert.equal(models.isInstalled('canary-180m-flash'), false)
})

test('Start: halbe Installationen werden entfernt, fremde Ordner bleiben', async () => {
  await fs.mkdir('/app/models/whisper-medium')
  await fs.writeFile('/app/models/whisper-medium/model.bin', 'halb')
  await fs.mkdir('/app/models/fremd')
  await fs.mkdir('/app/models/.staging/x-1')
  const { models } = await setup()
  assert.equal(models.isInstalled('whisper-medium'), false)
  assert.ok(!fs.nodes.has('/app/models/whisper-medium'))
  assert.ok(fs.nodes.has('/app/models/fremd'))
  assert.ok(!fs.nodes.has('/app/models/.staging/x-1'))
  assert.ok(models.isInstalled('whisper-base'))
})

test('Modell entfernen gibt geladene Modelle frei und korrigiert die Auswahl', async () => {
  const { models, settings } = await setup()
  const released = []
  models.onRemoved(async (id) => released.push(id))
  await settings.set({ transcriptionModel: 'nemo-fastconformer-de' })
  await models.remove('nemo-fastconformer-de')
  assert.deepEqual(released, ['nemo-fastconformer-de'])
  assert.ok(!fs.nodes.has('/app/models/nemo-fastconformer-de'))
  assert.equal(settings.get().transcriptionModel, 'whisper-base')
})

test('Einstellungen: gleichzeitige Änderungen gehen nicht verloren und werden gespeichert', async () => {
  const { settings, bus } = await setup()
  await Promise.all([settings.set({ language: 'en' }), settings.set({ diarization: { numSpeakers: 2 } }), settings.set({ threads: 3 })])
  const again = await SettingsStore.load(paths, bus, 'ios', 8)
  assert.equal(again.get().language, 'en')
  assert.equal(again.get().diarization.numSpeakers, 2)
  assert.equal(again.get().threads, 3)
  await assert.rejects(settings.set('kaputt'))
})

function fakeSpeech(behaviour) {
  return {
    kind: 'device',
    calls: [],
    async preload() {},
    async release() {},
    async assignSpeakers(_p, segs) {
      return segs
    },
    async transcribe(req) {
      this.calls.push(req.path)
      return behaviour(req)
    }
  }
}

async function queueWith(speech) {
  const { bus, events, settings, models } = await setup()
  await settings.set({ transcriptionModel: 'whisper-base', replacements: [{ from: 'flusstext', to: 'Flusstext' }] })
  const transcripts = new TranscriptStore(paths, bus)
  await transcripts.init()
  const jobs = new JobQueue(paths, bus, transcripts, settings, models, speech)
  return { jobs, transcripts, events }
}

async function until(fn, ms = 2000) {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('Zeitüberschreitung')
    await new Promise((r) => setTimeout(r, 5))
  }
}

test('Aufträge: Import aus content://-URI, Ergebnis mit Ersetzungen, Bearbeitungen bleiben erhalten', async () => {
  await fs.writeFile('/content-provider-file', 'audio')
  fs.nodes.set('content://media/document/audio%3A42', fs.nodes.get('/content-provider-file'))
  let resolveRun
  const speech = fakeSpeech((req) => {
    req.onProgress?.('transcribing', 0.5)
    req.onSegments?.([{ start: 0, end: 1, text: 'Teil' }])
    return new Promise((r) => (resolveRun = () => r({ segments: [{ start: 0, end: 1, text: 'hallo flusstext' }], duration: 1, peaks: [1] })))
  })
  const { jobs, transcripts } = await queueWith(speech)
  const [job] = await jobs.add(['content://media/document/audio%3A42'], { diarization: false })
  await until(() => !!resolveRun)
  const t0 = transcripts.list().find((m) => m.id === job.transcriptId)
  assert.equal(t0.status, 'processing')
  // Nutzer ändert den Titel während der Verarbeitung
  await transcripts.update(job.transcriptId, { title: 'Mein Titel', audioPath: '/app/data/settings.json' })
  resolveRun()
  await until(() => jobs.list().find((j) => j.id === job.id)?.stage === 'done')
  const t = await transcripts.get(job.transcriptId)
  assert.equal(t.title, 'Mein Titel')
  assert.equal(t.status, 'done')
  assert.equal(t.segments[0].text, 'hallo Flusstext')
  assert.ok(t.audioPath.startsWith('/app/data/imports/'), 'geschützter Audiopfad unverändert')
  assert.equal(speech.calls[0], t.audioPath)
})

test('Aufträge laufen nacheinander; Abbruch übernimmt kein spätes Ergebnis', async () => {
  await fs.writeFile('/a.m4a', 'a')
  await fs.writeFile('/b.m4a', 'b')
  const pending = []
  let active = 0
  let maxActive = 0
  const speech = fakeSpeech(
    (req) =>
      new Promise((r) => {
        active++
        maxActive = Math.max(maxActive, active)
        pending.push(() => {
          active--
          r({ segments: [{ start: 0, end: 1, text: `spät ${req.path}` }], duration: 1, peaks: [] })
        })
      })
  )
  const { jobs, transcripts } = await queueWith(speech)
  const [a, b] = await jobs.add(['/a.m4a', '/b.m4a'], {})
  await until(() => pending.length === 1)
  await jobs.cancel(a.id)
  pending[0]() // Engine liefert trotzdem noch ein Ergebnis
  await until(() => pending.length === 2)
  assert.equal(maxActive, 1)
  assert.equal(transcripts.has(a.transcriptId), false, 'abgebrochenes Transkript gelöscht')
  assert.deepEqual([...fs.nodes.keys()].filter((k) => k.startsWith(`/app/data/imports/${a.transcriptId}`)), [])
  // Zweites Transkript wird während der Verarbeitung gelöscht
  jobs.cancelForTranscript(b.transcriptId)
  await transcripts.remove(b.transcriptId)
  pending[1]()
  await until(() => jobs.list().every((j) => ['cancelled', 'done', 'error'].includes(j.stage)))
  assert.equal(transcripts.has(b.transcriptId), false, 'kein Wiederanlegen nach dem Löschen')
  assert.equal(await transcripts.get(b.transcriptId), null)
})

test('Aufträge: Fehler landen am Transkript, ohne Modell wird gar nicht erst eingereiht', async () => {
  await fs.writeFile('/c.wav', 'c')
  const { jobs, transcripts } = await queueWith(fakeSpeech(() => Promise.reject(new Error('Datei konnte nicht gelesen werden.'))))
  const [c] = await jobs.add(['/c.wav'], {})
  await until(() => jobs.list().find((j) => j.id === c.id)?.stage === 'error')
  const t = await transcripts.get(c.transcriptId)
  assert.equal(t.status, 'error')
  assert.match(t.error, /nicht gelesen/)
  await assert.rejects(jobs.add(['/c.wav'], { modelId: 'cohere-transcribe' }), /nicht installiert/)
})

test('Transkript-Speicher: liegengebliebene .tmp wird beim Start übernommen, Löschen entfernt nur eigenes Audio', async () => {
  const bus = new Bus()
  const t = { id: 'abc-1', title: 'x', createdAt: 1, source: 'file', duration: 0, language: 'de', modelId: '', status: 'processing', speakerCount: 0, preview: '', words: 0, segments: [], speakers: [], audioPath: '/elsewhere/keep.wav' }
  await fs.mkdir('/elsewhere')
  await fs.writeFile('/elsewhere/keep.wav', 'x')
  await fs.writeFile(`${paths.transcripts}/abc-1.json.tmp`, JSON.stringify(t))
  const store = new TranscriptStore(paths, bus)
  await store.init()
  const loaded = await store.get('abc-1')
  assert.equal(loaded.status, 'error', 'unterbrochene Verarbeitung markiert')
  assert.equal(await store.get('../settings'), null)
  await store.remove('abc-1')
  assert.ok(fs.nodes.has('/elsewhere/keep.wav'))
  assert.ok(!fs.nodes.has(`${paths.transcripts}/abc-1.json`))
  await writeAtomic(`${paths.data}/probe.json`, '1')
  await writeAtomic(`${paths.data}/probe.json`, '2')
  assert.equal(Buffer.from(fs.nodes.get(`${paths.data}/probe.json`)).toString(), '2')
})

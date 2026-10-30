// Aufnahme und Diktat mit nachgebildetem Host (Mikrofon schreibt WAV) und nachgebildeter Erkennung.
const test = require('node:test')
const assert = require('node:assert/strict')
const { mock, core } = require('./helpers/load.cjs')
const { createMemFs } = require('./helpers/memfs.cjs')

const fs = createMemFs()
mock('@dr.pogodin/react-native-fs', fs)
mock('react-native-sherpa-onnx/extraction', { async extractArchive() {} })

const { Bus } = require(core('bus'))
const { pathsFor, ensureDirs } = require(core('fs'))
const { SettingsStore } = require(core('settings'))
const { ModelManager } = require(core('models'))
const { TranscriptStore, DictationStore } = require(core('store'))
const { Microphone } = require(core('microphone'))
const { Recorder } = require(core('recording'))
const { Dictation } = require(core('dictation'))
const { Playback } = require(core('playback'))
const wav = require(core('domain/wav'))

const paths = pathsFor({ version: '0', dataDir: '/d', modelsDir: '/m', tempDir: '/t', freeDiskBytes: 1e12, cpuThreads: 8, memoryBytes: 6e9 })
const SR = 16000

/** Host, dessen Mikrofon pro Sekunde 32 000 Bytes in eine WAV-Datei schreibt. */
function fakeHost() {
  const h = {
    seconds: 0,
    path: null,
    paused: false,
    allowMic: true,
    clipboard: [],
    pasted: [],
    played: [],
    hotkeys: null,
    async requestMicrophone() {
      return h.allowMic
    },
    async audioStart(path) {
      h.path = path
      h.seconds = 0
      await fs.writeFile(path, wav.wavHeader(0))
    },
    async speak(sec) {
      if (h.paused) return
      h.seconds += sec
      const samples = new Int16Array(Math.round(sec * SR)).map((_, i) => Math.round(Math.sin(i / 4) * 9000))
      await fs.appendFile(h.path, samples.buffer)
    },
    async audioPause() {
      h.paused = true
    },
    async audioResume() {
      h.paused = false
    },
    async audioSnapshot(since) {
      const out = `/t/flusstext/snap-${since}.wav`
      const data = fs.nodes.get(h.path)
      const from = 44 + Math.floor(since * SR) * 2
      await fs.writeFile(out, wav.concatBuffers(wav.wavHeader(data.length - from), new Uint8Array(data.subarray(from)).buffer))
      return { path: out, duration: h.seconds - since }
    },
    async audioStop() {
      const p = h.path
      h.path = null
      return { path: p, duration: h.seconds }
    },
    async audioCancel() {
      h.path = null
    },
    async copyText(t) {
      h.clipboard.push(t)
    },
    async pasteText(t) {
      h.pasted.push(t)
      return true
    },
    async setHotkeys(c) {
      h.hotkeys = c
    },
    async play(path, at, rate) {
      h.played.push([path, at, rate])
    },
    async pausePlayback() {}
  }
  return h
}

/** Erkennung: jede volle Sekunde der Datei wird ein Wort „wN“ (N = absolute Sekunde ab Dateianfang). */
function fakeSpeech() {
  return {
    kind: 'device',
    calls: [],
    async preload() {},
    async release() {},
    async assignSpeakers(_p, segs) {
      return segs.map((s, i) => ({ ...s, speaker: i % 2 }))
    },
    async transcribe(req) {
      const data = fs.nodes.get(req.path)
      const info = wav.parseWavHeader(new Uint8Array(data).buffer, data.length)
      const dur = info.dataBytes / 2 / SR
      this.calls.push(dur)
      const segments = []
      for (let s = 0; s + 1 <= dur + 1e-9; s++) segments.push({ start: s, end: s + 0.9, text: `w${s} flusstext` })
      return { segments, duration: dur, peaks: [] }
    }
  }
}

async function setup(platform = 'ios') {
  for (const k of [...fs.nodes.keys()]) if (k !== '/') fs.nodes.delete(k)
  await ensureDirs(paths)
  const bus = new Bus()
  const events = []
  bus.subscribe((e) => events.push(e))
  const settings = await SettingsStore.load(paths, bus, platform, 8)
  const models = new ModelManager(paths, bus, settings, {}, platform, { memoryBytes: 6e9, cpuThreads: 8 })
  // Installiertes Modell vortäuschen
  await fs.mkdir('/m/whisper-base')
  await fs.writeFile('/m/whisper-base/model.bin', 'x')
  await fs.writeFile('/m/whisper-base/.complete', '{}')
  await models.init()
  await settings.set({ replacements: [{ from: 'flusstext', to: 'Flusstext' }] })
  const host = fakeHost()
  const speech = fakeSpeech()
  const mic = new Microphone(host)
  const transcripts = new TranscriptStore(paths, bus)
  await transcripts.init()
  const history = new DictationStore(paths, bus)
  await history.init()
  const recorder = new Recorder(paths, bus, host, mic, transcripts, settings, models, speech, platform)
  const dictation = new Dictation(paths, bus, host, mic, history, settings, models, speech, platform)
  return { bus, events, settings, models, host, speech, mic, transcripts, history, recorder, dictation }
}

test('Aufnahme: Pegel aus Host-Ereignissen, Live-Text, Pause und vollständiges Speichern', async () => {
  const x = await setup('ios')
  await x.recorder.start({})
  assert.equal(x.recorder.state().phase, 'recording')
  x.mic.handle({ type: 'audio', elapsed: 1.5, level: 0.4 })
  assert.deepEqual([x.recorder.state().elapsed, x.recorder.state().level], [1.5, 0.4])
  await x.host.speak(5)
  // Live-Schritt direkt auslösen (statt auf den Timer zu warten)
  const session = x.recorder.session
  await x.recorder.liveTick(session)
  // 5 s Ausschnitt, die letzten 1,5 s bleiben offen: w0–w2 festgeschrieben, w3 offen
  assert.equal(session.committed, 2.9)
  assert.match(x.recorder.state().text, /^w0 Flusstext w1 Flusstext w2 Flusstext w3 Flusstext/)
  await x.recorder.pause()
  assert.equal(x.recorder.state().phase, 'paused')
  x.mic.handle({ type: 'audio', elapsed: 9, level: 1 })
  assert.equal(x.recorder.state().elapsed, 1.5, 'pausiert: keine Pegelupdates')
  await x.recorder.resume()
  await x.host.speak(3)
  const id = await x.recorder.stop({ diarization: true, numSpeakers: 2, title: ' Team ', notes: 'Notiz', bookmarks: [{ time: 2, label: 'Wichtig' }] })
  assert.equal(x.recorder.state().phase, 'idle')
  const t = await x.transcripts.get(id)
  assert.equal(t.title, 'Team')
  assert.equal(t.notes, 'Notiz')
  assert.deepEqual(t.bookmarks, [{ time: 2, label: 'Wichtig' }])
  assert.equal(t.duration, 8)
  assert.equal(t.source, 'recording')
  assert.ok(t.audioPath.startsWith('/d/recordings/'))
  // Festgeschriebene Live-Segmente + Rest ab 2,9 s, ohne Lücke und ohne Doppelung
  const starts = t.segments.map((s) => s.start)
  assert.deepEqual(starts, [0, 1, 2, 2.9, 3.9, 4.9, 5.9, 6.9])
  assert.ok(t.segments.every((s) => s.text.endsWith('Flusstext')))
  assert.equal(t.peaks.length, 1200)
})

test('Aufnahme ohne Modell (Mikrofontest) und Abbruch löschen die Datei', async () => {
  const x = await setup('ios')
  await x.models.remove('whisper-base')
  await x.recorder.start({})
  const path = x.host.path
  await x.host.speak(1)
  await assert.rejects(x.recorder.stop({ diarization: false }), /Transkriptionsmodell|nicht installiert/)
  assert.equal(x.recorder.state().phase, 'recording', 'Aufnahme bleibt erhalten')
  await x.recorder.cancel()
  assert.equal(x.recorder.state().phase, 'idle')
  assert.ok(!fs.nodes.has(path))
  assert.equal(x.mic.busy, null)
})

test('Mikrofon: verweigerter Zugriff und gegenseitiger Ausschluss', async () => {
  const x = await setup('ios')
  x.host.allowMic = false
  await assert.rejects(x.recorder.start({}), /Kein Zugriff/)
  assert.equal(x.mic.busy, null)
  x.host.allowMic = true
  await x.recorder.start({})
  await assert.rejects(x.dictation.start(), /Aufnahme/)
  x.mic.handle({ type: 'audioError', message: 'Gerät getrennt' })
  await new Promise((r) => setImmediate(r))
  assert.equal(x.recorder.state().phase, 'idle')
  assert.ok(x.events.some((e) => e.type === 'error' && /Gerät getrennt/.test(e.message)))
})

test('Diktat (Telefon): Text mit Ersetzungen in den Verlauf, Zwischenablage nur auf Wunsch', async () => {
  const x = await setup('ios')
  await x.dictation.start()
  assert.equal(x.dictation.state().phase, 'listening')
  await x.host.speak(2)
  await x.dictation.stop()
  const [entry] = x.history.list()
  assert.equal(entry.text, 'w0 Flusstext w1 Flusstext')
  assert.equal(entry.duration, 2)
  assert.deepEqual(x.host.clipboard, [])
  assert.deepEqual(x.host.pasted, [])
  assert.equal(x.dictation.state().text, 'w0 Flusstext w1 Flusstext')
  await x.settings.set({ dictation: { autoPaste: true } })
  await x.dictation.start()
  await x.host.speak(1)
  await x.dictation.stop()
  assert.deepEqual(x.host.clipboard, ['w0 Flusstext '])
  // Zu kurz
  await x.dictation.start()
  await assert.rejects(x.dictation.stop(), /Nichts gehört/)
  assert.equal(x.dictation.state().phase, 'idle')
  assert.equal(x.mic.busy, null)
  // Abbruch
  await x.dictation.start()
  await x.dictation.cancel()
  assert.equal(x.history.list().length, 2)
  assert.equal(x.host.hotkeys, null, 'keine globalen Tastenkürzel auf Telefonen')
})

test('Diktat (Mac): Tastenkürzel, Einfügen und letztes Diktat erneut einfügen', async () => {
  const x = await setup('macos')
  await x.dictation.applyHotkeys(x.settings.get())
  assert.deepEqual(x.host.hotkeys.hotkey, [29, 3675])
  x.dictation.onHotkey('start')
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(x.dictation.state().phase, 'listening')
  await x.host.speak(1)
  x.dictation.onHotkey('start') // Umschalten beendet
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(x.host.pasted, ['w0 Flusstext '])
  assert.equal(x.dictation.state().pasted, true)
  await x.dictation.pasteLast()
  assert.deepEqual(x.host.pasted, ['w0 Flusstext ', 'w0 Flusstext '])
})

test('Wiedergabe: Zustand folgt den Player-Ereignissen, Tempo begrenzt', async () => {
  const x = await setup('ios')
  await x.recorder.start({})
  await x.host.speak(2)
  const id = await x.recorder.stop({ diarization: false })
  const playback = new Playback(x.bus, x.host, x.transcripts)
  await playback.play(id, 1, 9)
  assert.equal(x.host.played[0][2], 3)
  playback.handle({ type: 'playback', path: x.host.played[0][0], time: 1.6, duration: 2, playing: true })
  assert.deepEqual([playback.state().time, playback.state().playing], [1.6, true])
  playback.handle({ type: 'playback', path: '/fremd.wav', time: 9, duration: 9, playing: false })
  assert.equal(playback.state().time, 1.6, 'fremde Ereignisse ignoriert')
  await playback.setRate(1.25)
  assert.deepEqual(x.host.played[1].slice(1), [1.6, 1.25])
  playback.handle({ type: 'playback', path: x.host.played[0][0], time: 2, duration: 2, playing: false })
  assert.equal(playback.state().playing, false)
  await playback.forget(id)
  assert.equal(playback.state().transcriptId, null)
})

test('Systemunterbrechung erhält die WAV und legt ein wiederherstellbares Transkript an', async () => {
  const x = await setup('ios')
  await x.recorder.start({})
  await x.host.speak(7)
  const path = x.host.path
  x.mic.handle({ type: 'audioError', message: 'Anruf' })
  await x.recorder.session.recovery
  assert.equal(x.recorder.state().phase, 'idle')
  assert.equal(x.mic.busy, null)
  assert.ok(fs.nodes.has(path), 'system interruption must never delete captured audio')
  const [meta] = x.transcripts.list()
  const saved = await x.transcripts.get(meta.id)
  assert.equal(saved.status, 'error')
  assert.equal(saved.duration, 7)
  assert.equal(saved.audioPath, path)
  assert.match(saved.error, /Anruf/)
})

test('Auch ein bereits systemseitig gestoppter Recorder behält seine Audiodatei', async () => {
  const x = await setup('ios')
  await x.recorder.start({})
  await x.host.speak(3)
  const path = x.host.path
  x.host.audioStop = async () => { x.host.path = null; throw new Error('Keine aktive Aufnahme') }
  x.mic.handle({ type: 'audioError', message: 'Gerät getrennt' })
  await x.recorder.session.recovery
  assert.ok(fs.nodes.has(path))
  const [saved] = x.transcripts.list()
  assert.equal(saved.duration, 3)
  assert.equal(saved.status, 'error')
})

test('Diktat: Escape während der Berechtigungsabfrage startet später kein Mikrofon', async () => {
  const x = await setup('macos')
  let allow
  x.host.requestMicrophone = () => new Promise(resolve => { allow = resolve })
  const starting = x.dictation.start()
  await x.dictation.cancel()
  allow(true)
  await starting
  assert.equal(x.host.path, null)
  assert.equal(x.mic.busy, null)
  assert.equal(x.dictation.state().phase, 'idle')
})

test('Diktat: Abbruch eines laufenden audioStart räumt danach auf und hält seine Mikrofon-Lease', async () => {
  const x = await setup('macos')
  let finish
  const realStart = x.host.audioStart
  x.host.audioStart = path => new Promise(resolve => { finish = async () => { await realStart(path); resolve() } })
  const starting = x.dictation.start()
  await new Promise(resolve => setImmediate(resolve))
  const path = x.dictation.session.path
  await x.dictation.cancel()
  assert.equal(x.mic.busy, 'dictation', 'no newer owner may start before late startup cleanup')
  await assert.rejects(x.recorder.start({}), /Diktat/)
  await finish()
  await starting
  assert.equal(x.host.path, null)
  assert.equal(x.mic.busy, null)
  assert.equal(x.dictation.state().phase, 'idle')
  assert.ok(!fs.nodes.has(path))
})

test('Späte Antwort einer abgebrochenen Berechtigung darf eine neue Aufnahme nicht freigeben', async () => {
  const x = await setup('macos')
  let allow
  x.host.requestMicrophone = () => new Promise(resolve => { allow = resolve })
  const old = x.dictation.start()
  await x.dictation.cancel()
  x.host.requestMicrophone = async () => true
  await x.recorder.start({})
  const newPath = x.host.path
  allow(true)
  await old
  assert.equal(x.mic.busy, 'recording')
  assert.equal(x.host.path, newPath)
  await x.recorder.cancel()
})

test('Aufnahme kann schon während der Mikrofon-Berechtigungsabfrage verworfen werden', async () => {
  const x = await setup('ios')
  let allow
  x.host.requestMicrophone = () => new Promise(resolve => { allow = resolve })
  const starting = x.recorder.start({})
  await x.recorder.cancel()
  allow(true)
  await starting
  assert.equal(x.host.path, null)
  assert.equal(x.mic.busy, null)
  assert.equal(x.recorder.state().phase, 'idle')
})

test('Spätes Ergebnis nach Verwerfen überschreibt keine neu gestartete Aufnahme', async () => {
  const x = await setup('ios')
  await x.recorder.start({})
  await x.host.speak(3)
  let finish
  x.speech.transcribe = () => new Promise(resolve => { finish = () => resolve({ segments: [{start:0,end:3,text:'late'}], duration:3, peaks:[] }) })
  const stopping = x.recorder.stop({ diarization:false })
  const rejected = assert.rejects(stopping, /cancelled/)
  await new Promise(resolve => setImmediate(resolve))
  await x.recorder.cancel()
  await x.recorder.start({})
  const current = x.host.path
  finish()
  await rejected
  assert.equal(x.recorder.state().phase, 'recording')
  assert.equal(x.host.path, current)
  assert.equal(x.mic.busy, 'recording')
  assert.equal(x.transcripts.list().length, 0, 'discarded work cannot recreate a transcript')
  await x.recorder.cancel()
})

// Fachlogik ohne native Abhängigkeiten: Text, Segmente, Abschnitte, WAV, Katalog, Einstellungen, Export.
const test = require('node:test')
const assert = require('node:assert/strict')
const { core } = require('./helpers/load.cjs')

const text = require(core('domain/text'))
const seg = require(core('domain/segments'))
const chunking = require(core('domain/chunking'))
const wav = require(core('domain/wav'))
const catalog = require(core('domain/catalog'))
const settings = require(core('domain/settings'))
const exporter = require(core('domain/export'))
const speechTypes = require(core('speech-types'))
const { CATALOG } = require('../../src/shared/catalog.ts')

const device = { memoryBytes: 6e9, cpuThreads: 8 }

test('Ersetzungen greifen nur auf ganze Wörter und unterstützen Zeilenumbrüche', () => {
  const list = [
    { from: 'flusstext', to: 'Flusstext' },
    { from: 'neue zeile', to: '\\n' }
  ]
  assert.equal(text.applyReplacements('flusstext und flusstexte', list), 'Flusstext und flusstexte')
  assert.equal(text.applyReplacements('Hallo neue Zeile. Welt', list), 'Hallo\nWelt')
})

test('Dateinamen aus content://-URIs und Pfaden sind lesbar und ohne Trenner', () => {
  assert.deepEqual(text.displayName('content://com.android.providers/document/primary%3AMusic%2FInterview%20Mai.m4a'), { base: 'Interview Mai', ext: 'm4a' })
  assert.deepEqual(text.displayName('file:///var/mobile/Docs/Gespr%C3%A4ch.WAV'), { base: 'Gespräch', ext: 'wav' })
  assert.deepEqual(text.displayName('content://media/external/audio/12345'), { base: '12345', ext: '' })
  assert.equal(text.safeFileName('../../etc/passwd'), 'etc passwd')
  assert.equal(text.safeFileName('   '), 'Transkript')
})

test('IDs sind eindeutig und als Dateiname gültig', () => {
  const ids = new Set(Array.from({ length: 2000 }, () => text.uuid()))
  assert.equal(ids.size, 2000)
  for (const id of ids) assert.match(id, /^[0-9a-f-]{36}$/)
})

test('Suche liefert Ausschnitt um den Treffer', () => {
  const metas = [{ id: 'a', createdAt: 1 }, { id: 'b', createdAt: 2 }]
  const texts = new Map([['a', 'x '.repeat(60) + 'Haushalt 2027 beschlossen'], ['b', 'nichts']])
  const hits = text.searchHits('haushalt', metas, texts)
  assert.equal(hits.length, 1)
  assert.ok(hits[0].snippet.startsWith('…'))
  assert.ok(hits[0].snippet.includes('Haushalt 2027'))
})

test('Tokens werden satzweise gruppiert und Wortstarts erfasst', () => {
  const toks = [
    { text: ' Hallo', start: 0, end: 0.4 },
    { text: ' Welt.', start: 0.5, end: 0.9 },
    { text: ' Neu', start: 1, end: 1.3 },
    { text: 'er', start: 1.3, end: 1.4 },
    { text: ' Satz', start: 1.5, end: 1.9 }
  ]
  const out = seg.buildSegments(toks)
  assert.equal(out.length, 2)
  assert.equal(out[0].text, 'Hallo Welt.')
  assert.equal(out[1].text, 'Neuer Satz')
  assert.deepEqual(out[1].words, [1, 1.5])
})

test('Sprecherwechsel trennt Segmente', () => {
  const turns = [{ start: 0, end: 1, speaker: 0 }, { start: 1, end: 2, speaker: 1 }]
  const out = seg.buildSegments([{ text: ' ja', start: 0.1, end: 0.5 }, { text: ' nein', start: 1.2, end: 1.6 }], turns)
  assert.deepEqual(out.map((s) => s.speaker), [0, 1])
})

test('whisper.cpp-Zeiten (10 ms) werden in Sekunden umgerechnet, Halluzinationen verworfen', () => {
  const toks = seg.whisperTokens(
    [
      { text: ' Guten Morgen.', t0: 50, t1: 180 },
      { text: 'Untertitel im Auftrag des ZDF', t0: 200, t1: 400 }
    ],
    10,
    5
  )
  assert.equal(toks.length, 1)
  assert.equal(toks[0].start, 10.5)
  assert.equal(toks[0].end, 11.8)
})

test('sherpa-Ergebnis nutzt Token-Zeiten, sonst einen Block', () => {
  const timed = seg.sherpaTokens({ text: 'a b', tokens: ['a', ' b'], timestamps: [0.1, 0.5], durations: [] }, 'nemo', 2, 1)
  assert.deepEqual(timed.map((t) => [t.text, t.start]), [[' a', 2.1], [' b', 2.5]])
  const block = seg.sherpaTokens({ text: 'hallo', tokens: [], timestamps: [] }, 'canary', 2, 1)
  assert.deepEqual(block, [{ text: ' hallo', start: 2, end: 3 }])
})

test('Whisper-Token behalten Wortgrenzen, Teilwörter und Satzzeichen mit nativen Zeiten', () => {
  const tokens = seg.whisperTokens([
    { text: ' Hello', t0: 10, t1: 30 },
    { text: ' trans', t0: 40, t1: 50 },
    { text: 'cription', t0: 50, t1: 80 },
    { text: '.', t0: 80, t1: 90 }
  ], 2, 5, true)
  const result = seg.buildSegments(tokens)
  assert.equal(result[0].text, 'Hello transcription.')
  assert.deepEqual(result[0].words, [2.1, 2.4])
})

test('Diarisierung: Phantom-Sprecher werden aufgenommen und Sprecher nach Auftreten nummeriert', () => {
  const raw = [
    { start: 10, end: 20, speaker: 5 },
    { start: 0, end: 9, speaker: 3 },
    { start: 9, end: 9.5, speaker: 7 },
    { start: 'x', end: 1, speaker: 1 }
  ]
  const turns = seg.normalizeTurns(raw, 0)
  assert.deepEqual(turns.map((t) => t.speaker), [0, 0, 1])
  // Feste Sprecherzahl: keine Zusammenlegung
  assert.equal(new Set(seg.normalizeTurns(raw, 3).map((t) => t.speaker)).size, 3)
  assert.throws(() => seg.normalizeTurns({}, 0))
  assert.equal(seg.dominantSpeaker(turns, { start: 8, end: 12 }), 1)
})

test('Verschobene Live-Segmente behalten Wortzeiten', () => {
  const [s] = seg.shiftSegments([{ start: 1, end: 2, text: 'x', words: [1, 1.5] }], 10)
  assert.deepEqual([s.start, s.end, s.words], [11, 12, [11, 11.5]])
})

test('Segmente und Sprechernamen: Ersetzungen angewendet, umbenannte Sprecher bleiben', () => {
  const out = seg.toSegments([{ start: 1, end: 2, text: 'ok flusstext', speaker: 1 }], [{ from: 'flusstext', to: 'Flusstext' }])
  assert.equal(out[0].text, 'ok Flusstext')
  assert.deepEqual(seg.speakersFor(out, [{ id: 1, name: 'Anna' }]), [{ id: 1, name: 'Anna' }])
  assert.deepEqual(seg.speakersFor(out), [{ id: 1, name: 'Sprecher 2' }])
})

test('Pegelspitzen werden blockweise gesammelt und normiert', () => {
  const p = new seg.PeakCollector(400, 4)
  p.add(new Float32Array(200).fill(0.25))
  p.add(Float32Array.from({ length: 200 }, (_, i) => (i === 150 ? -0.5 : 0)))
  assert.deepEqual(p.result(), [0.5, 0.5, 0, 1])
})

function energyFor(seconds) {
  // seconds: Liste [dauer, amplitude]
  const e = new chunking.FrameEnergy()
  let total = 0
  for (const [dur, amp] of seconds) {
    const n = Math.round(dur * chunking.SR)
    const block = Float32Array.from({ length: n }, (_, i) => (amp ? amp * Math.sin(i / 3) : (Math.random() - 0.5) * 0.0004))
    // in ungeraden Blockgrößen einspeisen
    for (let at = 0; at < n; at += 7919) e.add(block.subarray(at, Math.min(n, at + 7919)))
    total += n
  }
  return { energy: e.result(), total }
}

test('Stille ergibt keine Abschnitte (keine Whisper-Halluzinationen)', () => {
  const { energy, total } = energyFor([[10, 0]])
  assert.deepEqual(chunking.planChunks(energy, total), [])
})

test('Sprachabschnitte werden mit Rand geplant und kurze Pausen zusammengefasst', () => {
  const { energy, total } = energyFor([[2, 0], [3, 0.3], [0.5, 0], [2, 0.3], [5, 0], [2, 0.3], [2, 0]])
  const chunks = chunking.planChunks(energy, total)
  assert.equal(chunks.length, 2)
  assert.ok(Math.abs(chunks[0].start / chunking.SR - 1.75) < 0.1)
  assert.ok(Math.abs(chunks[0].end / chunking.SR - 7.75) < 0.1)
})

test('Lange Sprache wird in Abschnitte ≤ maxSec geteilt, bevorzugt an leisen Stellen', () => {
  const { energy, total } = energyFor([[18, 0.3], [0.2, 0.01], [40, 0.3]])
  const chunks = chunking.planChunks(energy, total, { maxSec: 24 })
  for (const c of chunks) assert.ok((c.end - c.start) / chunking.SR <= 24.01)
  assert.ok(Math.abs(chunks[0].end / chunking.SR - 18) < 0.3, `Schnitt bei ${chunks[0].end / chunking.SR}`)
  const covered = chunks.reduce((n, c) => n + c.end - c.start, 0)
  assert.ok(covered / chunking.SR > 57)
})

test('WAV-Kopf: Schreiben/Lesen, laufende Aufnahmen und ungeeignete Formate', () => {
  const head = wav.wavHeader(32000)
  const info = wav.parseWavHeader(head, 44 + 32000)
  assert.deepEqual(info, { sampleRate: 16000, channels: 1, bitsPerSample: 16, dataOffset: 44, dataBytes: 32000 })
  assert.ok(wav.isSpeechWav(info))
  // Länge 0 (noch nicht abgeschlossen) → Dateigröße zählt, auf ganze Samples gekürzt
  const open = wav.wavHeader(0)
  assert.equal(wav.parseWavHeader(open, 44 + 1001).dataBytes, 1000)
  // Deklarierte Länge größer als die Datei → auf Datei begrenzt
  assert.equal(wav.parseWavHeader(head, 44 + 100).dataBytes, 100)
  const float = wav.wavHeader(10)
  new DataView(float).setUint16(34, 32, true)
  assert.throws(() => wav.parseWavHeader(float, 54), /16-Bit/)
  assert.throws(() => wav.parseWavHeader(new ArrayBuffer(44), 44), /WAV/)
  const pcm = new Int16Array([0, 16384, -32768]).buffer
  assert.deepEqual(Array.from(wav.pcm16ToFloat(pcm)), [0, 0.5, -1])
  assert.ok(wav.looksLikeHtml('  <!DOCTYPE html><html>'))
  assert.ok(!wav.looksLikeHtml('ggml\u0000\u0001'))
})

test('Katalog: nur Windows-Laufzeiten ausgeblendet, alle anderen Modelle bleiben nutzbar', () => {
  const visible = catalog.catalogFor()
  assert.deepEqual(CATALOG.filter((m) => !visible.includes(m)).map((m) => m.id).sort(), ['whispercpp-cpu', 'whispercpp-cuda'])
  for (const platform of ['ios', 'android', 'macos']) {
    const list = visible.map((d) => catalog.toNativeModel(d, platform, device, false))
    assert.ok(list.every((m) => m.available))
    assert.ok(list.some((m) => m.kind === 'segmentation') && list.some((m) => m.kind === 'embedding'))
    assert.equal(list.filter((m) => m.kind === 'asr').length, CATALOG.filter((m) => m.kind === 'asr').length)
  }
})

test('Telefon-Empfehlung ist von der Fähigkeit getrennt', () => {
  const list = catalog.catalogFor().map((d) => catalog.toNativeModel(d, 'android', device, false))
  const suggested = list.filter((m) => m.kind === 'asr' && m.recommendation).map((m) => m.id).sort()
  assert.deepEqual(suggested, ['nemo-fastconformer-de', 'whisper-base'])
  assert.deepEqual(list.filter((m) => m.kind === 'asr' && m.recommended).map((m) => m.id).sort(), suggested)
  const cohere = list.find((m) => m.id === 'cohere-transcribe')
  assert.ok(cohere.available && !cohere.recommendation && /Groß für ein Telefon/.test(cohere.resourceNote))
  assert.match(list.find((m) => m.id === 'nemotron-3.5-transcribe-lite').resourceNote, /CPU/)
  // Kleine Modelle ohne Hinweis
  assert.equal(list.find((m) => m.id === 'whisper-base').resourceNote, undefined)
  // Stimmprofil-Empfehlung bleibt
  assert.ok(list.find((m) => m.id === 'emb-eres2net-voxceleb').recommended)
  // Wenig Arbeitsspeicher: Warnung
  const small = catalog.toNativeModel(CATALOG.find((m) => m.id === 'whisper-large-v3'), 'ios', { memoryBytes: 3e9, cpuThreads: 6 }, false)
  assert.match(small.resourceNote, /beenden/)
  // Mac: Desktop-Empfehlungen, keine Telefon-Texte
  const mac = catalog.catalogFor().map((d) => catalog.toNativeModel(d, 'macos', { memoryBytes: 32e9, cpuThreads: 10 }, false))
  assert.ok(mac.find((m) => m.id === 'parakeet-tdt-0.6b-v3').recommended)
  assert.ok(mac.every((m) => !m.recommendation))
})

test('Pflichtdateien, Speicherbedarf und automatische Auswahl', () => {
  const def = (id) => CATALOG.find((m) => m.id === id)
  assert.deepEqual(catalog.requiredFiles(def('nemo-fastconformer-de')), ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'])
  assert.deepEqual(catalog.requiredFiles(def('cohere-transcribe')), ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt'])
  assert.deepEqual(catalog.requiredFiles(def('seg-reverb-v2')), ['model.int8.onnx'])
  assert.deepEqual(catalog.requiredFiles(def('whisper-base')), ['model.bin'])
  assert.ok(catalog.requiredDiskBytes(def('parakeet-tdt-0.6b-v3')) > 2 * 487170055)
  const s = settings.defaultSettings('ios', 6)
  const installed = new Set(['whisper-base'])
  assert.deepEqual(catalog.selectionAfterInstall(def('whisper-base'), s, (id) => installed.has(id)), { transcriptionModel: 'whisper-base' })
  installed.add('nemo-fastconformer-de')
  assert.deepEqual(catalog.selectionRepair({ ...s, transcriptionModel: 'gone', dictationModel: 'gone' }, (id) => installed.has(id), 'ios'), {
    transcriptionModel: 'nemo-fastconformer-de',
    dictationModel: null
  })
  assert.equal(catalog.selectionRepair({ ...s, transcriptionModel: 'whisper-base' }, (id) => installed.has(id), 'ios'), null)
})

test('Einstellungen: Telefonstandard schont Ressourcen, Zusammenführen ist sicher', () => {
  const phone = settings.defaultSettings('android', 8)
  assert.equal(phone.threads, 4)
  assert.equal(settings.defaultSettings('ios', 2).threads, 1)
  assert.equal(phone.dictation.autoPaste, false)
  assert.equal(settings.defaultSettings('macos', 10).dictation.autoPaste, true)
  const merged = settings.merge(phone, JSON.parse('{"__proto__":{"polluted":1},"diarization":{"numSpeakers":3}}'))
  assert.equal({}.polluted, undefined)
  assert.equal(merged.diarization.numSpeakers, 3)
  assert.equal(merged.diarization.embeddingModel, 'emb-eres2net-voxceleb')
  const clean = settings.sanitizeSettings(
    { ...phone, threads: 99, theme: 'neon', replacements: [{ from: 'a', to: 'b' }, { from: 1 }, null], dictation: { ...phone.dictation, hotkey: 'x' } },
    phone,
    8
  )
  assert.equal(clean.threads, 8)
  assert.equal(clean.theme, phone.theme)
  assert.deepEqual(clean.replacements, [{ from: 'a', to: 'b' }])
  assert.deepEqual(clean.dictation.hotkey, phone.dictation.hotkey)
})

const transcript = {
  id: 't1',
  title: 'Besprechung',
  createdAt: Date.UTC(2026, 9, 1),
  source: 'file',
  duration: 3725.5,
  language: 'de',
  modelId: 'whisper-base',
  status: 'done',
  speakerCount: 2,
  preview: '',
  words: 4,
  segments: [
    { id: 'a', start: 0, end: 1.5, text: 'Hallo zusammen.', speaker: 0 },
    { id: 'b', start: 1.5, end: 2, text: 'Los geht es.', speaker: 0 },
    { id: 'c', start: 3725, end: 3725.5, text: 'Danke.', speaker: 1 }
  ],
  speakers: [{ id: 0, name: 'Anna' }, { id: 1, name: 'Ben' }]
}

test('Export: TXT, MD, SRT, VTT, JSON', () => {
  const o = { speakers: true, timestamps: true }
  assert.equal(exporter.exportText(transcript, 'txt', o), '[0:00] Anna: Hallo zusammen. Los geht es.\n\n[1:02:05] Ben: Danke.')
  assert.ok(exporter.exportText(transcript, 'md', o).startsWith('# Besprechung\n\n**Anna** · `0:00`'))
  const srt = exporter.exportText(transcript, 'srt', o)
  assert.ok(srt.includes('3\n01:02:05,000 --> 01:02:05,500\nBen: Danke.'))
  const vtt = exporter.exportText(transcript, 'vtt', { speakers: true, timestamps: false })
  assert.ok(vtt.startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:01.500\n<v Anna>Hallo zusammen.'))
  const json = JSON.parse(exporter.exportText(transcript, 'json', o))
  assert.equal(json.segments.length, 3)
  assert.equal(json.createdAt, '2026-10-01T00:00:00.000Z')
  assert.equal(exporter.exportText(transcript, 'txt', { speakers: false, timestamps: false }), 'Hallo zusammen. Los geht es.\n\nDanke.')
})

test('Export: DOCX ist ein gültiges ZIP (Base64)', async () => {
  const out = await exporter.exportTranscript(transcript, 'docx', { speakers: true, timestamps: true })
  assert.equal(out.encoding, 'base64')
  const bytes = Buffer.from(out.data, 'base64')
  assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK')
  assert.ok(bytes.includes(Buffer.from('word/document.xml')))
})

test('Host-Antwort der Mac-Engine wird geprüft', () => {
  const r = speechTypes.parseHostTranscription({
    segments: [{ start: 0, end: 1, text: ' Hallo  Welt ', speaker: 0, words: [0, 0.5] }, { start: 'x', text: 'kaputt' }, { start: 2, end: 1, text: 'rückwärts' }, { start: 3, end: 4, text: '  ' }],
    duration: 4,
    peaks: [0.5, 2, 'x'],
    speakers: 1
  })
  assert.deepEqual(r.segments[0], { start: 0, end: 1, text: 'Hallo Welt', speaker: 0, words: [0, 0.5] })
  assert.deepEqual(r.segments[1], { start: 2, end: 2, text: 'rückwärts' })
  assert.equal(r.segments.length, 2)
  assert.deepEqual(r.peaks, [0.5, 1])
  assert.throws(() => speechTypes.parseHostTranscription(null))
})

test('Abbruch-Token ruft Handler einmal und meldet Abbruch', () => {
  const t = new speechTypes.CancelToken()
  let n = 0
  t.onCancel(() => n++)
  t.cancel()
  t.cancel()
  assert.equal(n, 1)
  assert.throws(() => t.throwIfCancelled(), (e) => speechTypes.isCancelled(e))
  t.onCancel(() => n++)
  assert.equal(n, 2)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { mock, core } = require('./helpers/load.cjs')
const { createMemFs } = require('./helpers/memfs.cjs')
const fs = createMemFs()
mock('@dr.pogodin/react-native-fs', fs)
mock('react-native-sherpa-onnx/stt', {})
mock('react-native-sherpa-onnx/audio', {})
mock('whisper.rn/index', {})
mock('onnxruntime-react-native', {})
const { CancelToken } = require(core('speech-types'))
const { createSpeechEngine } = require(core('speech'))
const { engineCall } = require(core('engine-call'))
const wav = require(core('domain/wav'))

test('Ein vorab abgebrochener Engine-Aufruf startet keine native Arbeit', async () => {
  const token = new CancelToken()
  token.cancel()
  await assert.rejects(engineCall({ engineCall() { throw new Error('must not run') } }, 'diarize', {}, token), /cancelled/)
})

test('Abbruch nativer Diarisierung gibt den Aufrufer sofort frei und adressiert nur dessen Request', async () => {
  await fs.writeFile('/audio.wav', wav.concatBuffers(wav.wavHeader(96000), new ArrayBuffer(96000)))
  const calls = [], pending = []
  const host = { engineCall(method, params) {
    calls.push({ method, params })
    if (method === 'cancel') return Promise.resolve(1)
    return new Promise(resolve => pending.push(resolve))
  } }
  const speech = createSpeechEngine({ tmp: '/tmp' }, host)
  const token = new CancelToken()
  const segments = [{ start: 0, end: 1, text: 'hello' }]
  const args = ['/audio.wav', segments, { threads: 2 }, { segmentation: '/s', embedding: '/e', numSpeakers: 1, threshold: .5 }, {}]
  const first = speech.assignSpeakers(...args, token)
  await new Promise(resolve => setImmediate(resolve))
  const id = calls[0].params.requestId
  assert.ok(id)
  token.cancel()
  await assert.rejects(first, /cancelled/)
  assert.deepEqual(calls[1], { method: 'cancel', params: { requestId: id } })
  const second = speech.assignSpeakers(...args, new CancelToken())
  await new Promise(resolve => setImmediate(resolve))
  assert.notEqual(calls[2].params.requestId, id)
  pending[1]([{ start: 0, end: 3, speaker: 0 }])
  assert.equal((await second)[0].speaker, 0)
  pending[0]([{ start: 0, end: 3, speaker: 8 }]) // the abandoned result cannot overwrite the next job
})

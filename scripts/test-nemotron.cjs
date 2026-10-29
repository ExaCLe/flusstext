const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawn } = require('node:child_process')
const { createInterface } = require('node:readline')
const ts = require('typescript')
const temp = mkdtempSync(join(tmpdir(), 'flusstext-nemotron-test-'))
const file = join(temp, 'frontend.cjs')
writeFileSync(file, ts.transpileModule(readFileSync('src/engine/nemotron-frontend.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText)
const { logMel, decodeCtc } = require(file)
process.on('exit', () => rmSync(temp, { recursive: true, force: true }))

test('CTC collapses repeats, preserves words separated by a blank, and ignores control tags', () => {
  const vocab = ['▁Hallo', '▁Welt', '<spk:0>']
  const tokens = decodeCtc(Int32Array.from([0, 0, 3, 0, 2, 1, 1]), vocab, 1)
  assert.equal(tokens.map((t) => t.text).join(''), ' Hallo Hallo Welt')
  assert.deepEqual(tokens.map((t) => t.start), [0, 0.12, 0.2])
})
test('SentencePiece UTF-8 fallback preserves German characters', () => {
  const tokens = decodeCtc(Int32Array.from([0, 1, 2, 3]), ['▁Gr', '<0xC3>', '<0xBC>', 'ße'], 1)
  assert.equal(tokens.map((t) => t.text).join(''), ' Grüße')
})
test('timestamps exclude padded model output and stay within the recording', () => {
  const tokens = decodeCtc(Int32Array.from([0, 1, 0]), ['▁a'], 0.09)
  assert.equal(tokens.length, 2)
  assert.equal(tokens[1].end, 0.09)
  assert.deepEqual(decodeCtc(new Int32Array(10).fill(1), ['▁a'], 1), [])
  assert.throws(() => decodeCtc(Int32Array.of(9), ['a'], 1), /Token-ID/)
})
test('frontend handles tiny recordings and rejects invalid input', () => {
  const window = new Float32Array(400).fill(1)
  const bank = new Float32Array(128 * 257).fill(1)
  assert.equal(logMel(new Float32Array(100), window, bank).valid, 0)
  assert.throws(() => logMel(new Float32Array(1000), window.subarray(1), bank), /Tabellen/)
  const invalid = new Float32Array(1000)
  invalid[25] = NaN
  assert.throws(() => logMel(invalid, window, bank), /Audiodaten/)
  const silence = logMel(new Float32Array(16000), window, bank)
  assert.ok(silence.mel.every((v) => Number.isFinite(v) && v === 0))
  assert.equal(silence.frames % 8, 0)
})

// Optional real-model smoke test: npm run build, then set both paths to local files.
test('real model runs repeatedly with JavaScript networking disabled', {
  skip: !process.env.NEMOTRON_TEST_MODEL || !process.env.NEMOTRON_TEST_AUDIO,
  timeout: 180_000
}, async () => {
  const wave = readFileSync(process.env.NEMOTRON_TEST_AUDIO)
  let pcm
  for (let p = 12; p + 8 <= wave.length;) {
    const name = wave.toString('ascii', p, p + 4)
    const size = wave.readUInt32LE(p + 4)
    if (name === 'fmt ') {
      assert.equal(wave.readUInt16LE(p + 8), 1)
      assert.equal(wave.readUInt16LE(p + 10), 1)
      assert.equal(wave.readUInt32LE(p + 12), 16000)
      assert.equal(wave.readUInt16LE(p + 22), 16)
    }
    if (name === 'data') pcm = wave.subarray(p + 8, p + 8 + size)
    p += 8 + size + size % 2
  }
  assert.ok(pcm)
  const samples = Buffer.alloc(pcm.length * 2)
  for (let i = 0; i < pcm.length / 2; i++) samples.writeFloatLE(pcm.readInt16LE(i * 2) / 32768, i * 4)
  const child = spawn(process.execPath, ['--require', resolve('scripts/nemotron-lite/offline-guard.cjs'), resolve(process.env.NEMOTRON_TEST_WORKER || 'out/main/nemotron-worker.js')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ORT_DISABLE_TELEMETRY: '1' }, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true
  })
  const watchdog = setTimeout(() => child.kill(), 170_000)
  const pending = new Map()
  createInterface({ input: child.stdout }).on('line', (line) => {
    const reply = JSON.parse(line)
    const task = pending.get(reply.id)
    if (!task) return
    pending.delete(reply.id)
    reply.error ? task.reject(new Error(reply.error)) : task.resolve(reply.result)
  })
  child.on('exit', (code) => { for (const task of pending.values()) task.reject(new Error(`Worker exited: ${code}`)) })
  child.on('error', (error) => { for (const task of pending.values()) task.reject(error) })
  let id = 0
  const call = (method, data) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject })
    child.stdin.write(JSON.stringify({ id, method, modelDir: resolvePath(process.env.NEMOTRON_TEST_MODEL), threads: 4, samples: data })+'\n')
  })
  function resolvePath(p) { return require('node:path').resolve(p) }
  try {
    assert.equal(await call('load'), true)
    const tokens = await call('transcribe', samples.toString('base64'))
    const text = tokens.map((t) => t.text).join('').trim()
    console.log('Real model transcript:', text)
    assert.ok(text.length > 10)
    if (process.env.NEMOTRON_TEST_EXPECT) assert.match(text.toLowerCase(), new RegExp(process.env.NEMOTRON_TEST_EXPECT))
    assert.ok(tokens.every((t) => t.start >= 0 && t.end <= pcm.length / 32000 && t.end >= t.start))
    assert.deepEqual(await call('transcribe', samples.toString('base64')), tokens)
    assert.deepEqual(await call('transcribe', ''), [])
  } finally { clearTimeout(watchdog); child.kill() }
})

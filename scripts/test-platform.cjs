const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { EventEmitter } = require('node:events')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, platform, mocks = {}, extra = '') {
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(resolve(file), 'utf8') + extra, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (name) => name in mocks ? mocks[name] : require(name),
    process: { platform, resourcesPath: '/app/Contents/Resources', env: {} },
    console, Buffer, Blob, setTimeout, clearTimeout, AbortController
  }, { filename: file })
  return module.exports
}
const keys = load('src/shared/keys.ts', 'darwin')
function dictation(platform, allowed) {
  const app = new EventEmitter()
  const ipcMain = new EventEmitter()
  ipcMain.handle = () => {}
  const hook = new EventEmitter()
  const taps = []
  let starts = 0, clipboard = ''
  hook.start = () => starts++
  hook.keyTap = (...args) => taps.push(args)
  const settings = { dictation: { enabled: true, hotkey: [29, 3675], pasteLastHotkey: [], mode: 'hold' }, transcriptionModel: null }
  const mod = load('src/main/dictation.ts', platform, {
    electron: { app, ipcMain, Notification: {}, clipboard: { writeText: async (text) => { clipboard = text } },
      systemPreferences: { isTrustedAccessibilityClient: () => allowed.value } },
    'uiohook-napi': { uIOhook: hook, UiohookKey: { V: 47, Ctrl: 29, Meta: 3675, F24: 107, Escape: 1 } },
    '@shared/keys': keys,
    './asr': {}, './engine': {}, './models': {}, './settings': { settings: { get: () => settings } },
    './store': {}, './windows': { showOverlay() {}, sendToAll() {}, getOverlayWindow() {} }
  }, '\n;module.exports.testOnly = { paste, onKeyDown };')
  return { ...mod, app, ipcMain, taps, starts: () => starts, clipboard: () => clipboard }
}

test('Mac can start without Accessibility and starts the hook once after permission', () => {
  const allowed = { value: false }
  const d = dictation('darwin', allowed)
  d.initDictation()
  assert.equal(d.starts(), 0)
  assert.equal(d.ipcMain.listenerCount('overlay:start'), 1)
  allowed.value = true
  d.app.emit('browser-window-focus')
  d.app.emit('browser-window-focus')
  assert.equal(d.starts(), 1)
})
for (const [platform, modifier] of [['darwin', 3675], ['win32', 29]]) {
  test(`${platform} pastes with the platform modifier`, async () => {
    const d = dictation(platform, { value: true })
    assert.equal(await d.testOnly.paste('Hallo', false), true)
    assert.equal(d.clipboard(), 'Hallo')
    assert.equal(JSON.stringify(d.taps), JSON.stringify([[47, [modifier]]]))
  })
  test(`${platform} only suppresses the Windows Start menu on Windows`, () => {
    const d = dictation(platform, { value: true })
    d.testOnly.onKeyDown(29)
    d.testOnly.onKeyDown(3675)
    assert.equal(d.taps.length, platform === 'win32' ? 1 : 0)
  })
}
test('Mac without Accessibility retains text for manual paste and does not inject keys', async () => {
  const d = dictation('darwin', { value: false })
  assert.equal(await d.testOnly.paste('Hallo', false), false)
  assert.equal(d.clipboard(), 'Hallo')
  assert.equal(d.taps.length, 0)
})
test('Mac key labels use Command, Control and Option; Windows labels stay intact', () => {
  assert.equal(keys.keyLabel(3675, 'darwin'), '⌘')
  assert.equal(keys.keyLabel(29, 'darwin'), '⌃')
  assert.equal(keys.keyLabel(56, 'darwin'), '⌥')
  assert.equal(keys.keyLabel(3675, 'win32'), 'Win')
})
for (const platform of ['darwin', 'win32']) {
  test(`${platform} catalog and automatic Whisper runtime downloads`, async () => {
    const urls = []
    const catalog = load('src/shared/catalog.ts', platform)
    const settings = { transcriptionModel: null, dictationModel: null, useGpu: true, diarization: {} }
    const mod = load('src/main/models.ts', platform, {
      '@shared/catalog': catalog,
      './paths': { paths: { models: '/models', tmp: '/tmp' } },
      './settings': { settings: { get: () => settings, set() {} } },
      './download': { fetchTo: async (url) => { urls.push(url); throw new Error('stop fixture download') }, downloadError: (e) => e.message },
      'node:fs': { existsSync: () => false, mkdirSync() {} }
    })
    assert.equal(mod.models.list().some((m) => m.kind === 'runtime'), platform === 'win32')
    await mod.models.download('whisper-base')
    assert.equal(urls.some((url) => /whisper-bin/.test(url)), platform === 'win32')
  })
}
test('Mac Whisper chooses the bundled runtime and honours CPU mode', () => {
  let present = true
  const mod = load('src/main/asr.ts', 'darwin', {
    electron: { app: { isPackaged: true } },
    'node:fs': { existsSync: (path) => present && path === '/app/Contents/Resources/whisper/whisper-server' },
    '@shared/diarization': {}, './models': { isInstalled: () => true }, './paths': {}, './settings': {}
  })
  assert.equal(mod.whisperRuntime(true).id, 'whispercpp-metal')
  assert.equal(mod.whisperRuntime(true).gpu, true)
  assert.equal(mod.whisperRuntime(false).gpu, false)
  present = false
  assert.equal(mod.whisperRuntime(true), null)
})

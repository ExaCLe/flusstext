const assert = require('node:assert/strict')
const { app, BrowserWindow } = require('electron')
const { mkdirSync } = require('node:fs')
const { resolve } = require('node:path')
const { buildSync } = require('esbuild')
const ffi = require('koffi')

const output = resolve('out/tests/dictation.cjs')
mkdirSync(resolve('out/tests'), { recursive: true })
buildSync({
  stdin: {
    contents: 'export * from "./src/main/pressed-keys"; export * from "./src/main/windows-keyboard"',
    resolveDir: process.cwd()
  },
  bundle: true,
  platform: 'node',
  packages: 'external',
  outfile: output
})
const { PressedKeys, createWindowsKeyboard, shortcutCode } = require(output)

function testShortcuts() {
  const leftCtrl = { id: 'internal:29', code: 29, virtualKey: 0xa2, down: true, time: 100 }
  const rightCtrl = { ...leftCtrl, id: 'internal:3613', code: 3613, virtualKey: 0xa3 }
  const win = { id: 'internal:3675', code: 3675, virtualKey: 0x5b, down: true, time: 110 }
  const keys = [29, 3675]
  const pressed = new PressedKeys()

  assert.equal(pressed.update(win), 3675)
  assert.equal(pressed.update(leftCtrl), 29)
  assert.equal(pressed.matches(keys, leftCtrl, () => false), false, 'a stale Win press must not complete Ctrl')
  assert.equal(pressed.matches(keys, leftCtrl, (vk) => vk === win.virtualKey), true)
  assert.equal(pressed.update(leftCtrl), null, 'a repeated key is not a new shortcut')

  assert.equal(pressed.update(rightCtrl), null)
  assert.equal(pressed.update({ ...leftCtrl, down: false }), null, 'the other Ctrl key is still held')
  assert.equal(pressed.update({ ...rightCtrl, down: false }), 29)
  assert.equal(pressed.update({ ...leftCtrl, down: false }), null, 'an unmatched release is ignored')

  assert.deepEqual(pressed.prune(() => false), [], 'allow an already queued key-up to arrive')
  assert.deepEqual(pressed.prune(() => false), [3675], 'recover a missing key-up')
  assert.equal(pressed.update(leftCtrl), 29)
  assert.equal(pressed.matches(keys, leftCtrl, () => true), false, 'Ctrl alone still cannot start dictation')
  assert.equal(pressed.update({ ...win, time: 200 }), 3675)
  assert.equal(pressed.matches(keys, win, () => true), true, 'a fresh Ctrl + Win press works after recovery')
  assert.equal(pressed.matches([29], win, () => true), false, 'extra keys must not match a one-key shortcut')

  assert.equal(shortcutCode(0x5a, false), 44, 'the stored Z shortcut works on QWERTZ')
  assert.equal(shortcutCode(0x59, false), 21)
  assert.equal(shortcutCode(0x87, false), 107)
  assert.equal(shortcutCode(0x25, true), 57419)
  assert.equal(shortcutCode(0x0d, true), 3612)
}

function testRawInput() {
  const win = new BrowserWindow({ show: false })
  const device = ffi.struct({
    usagePage: 'uint16_t', usage: 'uint16_t', flags: 'uint32_t', target: 'uintptr_t'
  })
  const user32 = ffi.load('user32.dll')
  const readDevices = user32.func('uint32_t __stdcall GetRegisteredRawInputDevices(void *, _Inout_ uint32_t *, uint32_t)')
  const sendMessage = user32.func('intptr_t __stdcall SendMessageW(uintptr_t, uint32_t, uintptr_t, intptr_t)')
  const windowHash = ffi.decode(win.getNativeWindowHandle(), 'uintptr_t')
  const size = ffi.sizeof(device)
  const registered = () => {
    const count = [0]
    assert.equal(readDevices(null, count, size), 0)
    if (!count[0]) return []
    const buffer = Buffer.alloc(count[0] * size)
    assert.equal(readDevices(buffer, count, size), count[0])
    return ffi.decode(buffer, device, count[0]).filter((entry) => entry.target === windowHash)
  }
  let reset = 0
  const keyboard = createWindowsKeyboard(win, () => {}, () => reset++)
  try {
    keyboard.listen(true)
    assert.deepEqual(registered().map((entry) => ({ ...entry, flags: entry.flags & ~0x2000 })), [
      { usagePage: 1, usage: 6, flags: 0x0100, target: windowHash }
    ], 'register only the keyboard, with ordinary Windows input left enabled')
    sendMessage(windowHash, 0x00fe, 2, 0)
    assert.equal(reset, 1, 'device removal clears the shortcut state')
    keyboard.listen(false)
    assert.deepEqual(registered(), [], 'disable unregisters the keyboard')
  } finally {
    win.destroy()
  }
}

app.whenReady().then(() => {
  testShortcuts()
  testRawInput()
  console.log('Diktat-Tests bestanden: Tastenkombinationen, verlorene Key-ups und Windows Raw Input.')
  app.exit(0)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})

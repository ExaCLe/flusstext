import type { BrowserWindow } from 'electron'
import type * as Koffi from 'koffi'

const WM_INPUT = 0x00ff
const WM_INPUT_DEVICE_CHANGE = 0x00fe
const RID_INPUT = 0x10000003
const RIDEV_REMOVE = 0x0001
const RIDEV_INPUTSINK = 0x0100
const RIDEV_DEVNOTIFY = 0x2000
const GIDC_REMOVAL = 2
const RIM_TYPEKEYBOARD = 1
const RI_KEY_BREAK = 1
const RI_KEY_E0 = 2
const RI_KEY_E1 = 4
const INPUT_KEYBOARD = 1
const KEYEVENTF_KEYUP = 2
const INJECTED_BY_FLUSSTEXT = 0x464c5553
const VK_LWIN = 0x5b
const VK_RWIN = 0x5c
const VK_LCONTROL = 0xa2
// Windows uses Ctrl+Win+F24 to toggle the touchpad. Use an unassigned virtual key to mask Win.
const START_MENU_MASK_KEY = 0xe8
const MODIFIERS = [VK_LWIN, VK_RWIN, 0xa0, 0xa1, VK_LCONTROL, 0xa3, 0xa4, 0xa5]

// Keep the stored shortcut codes, including the logical letter on layouts such as QWERTZ.
const LETTER_CODES = [30, 48, 46, 32, 18, 33, 34, 35, 23, 36, 37, 38, 50, 49, 24, 25, 16, 19, 31, 20, 22, 47, 17, 45, 21, 44]
const FUNCTION_CODES = [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88, 91, 92, 93, 99, 100, 101, 102, 103, 104, 105, 106, 107]
const NUMPAD_CODES = [82, 79, 80, 81, 75, 76, 77, 71, 72, 73]
const NAVIGATION_CODES = [3657, 3665, 3663, 3655, 57419, 57416, 57421, 57424]
const OTHER_CODES: Record<number, number> = {
  0x08: 14, 0x09: 15, 0x0c: 0xe04c, 0x13: 0xe45, 0x14: 58, 0x1b: 1, 0x20: 57,
  0x2c: 0xe37, 0x2d: 0xe52, 0x2e: 0xe53, 0x5b: 0xe5b, 0x5c: 0xe5c, 0x5d: 0xe5d, 0x5f: 0xe05f,
  0x6a: 55, 0x6b: 78, 0x6c: 83, 0x6d: 74, 0x6e: 83, 0x6f: 0xe35, 0x90: 69, 0x91: 70,
  0xa0: 42, 0xa1: 54, 0xa2: 29, 0xa3: 0xe1d, 0xa4: 56, 0xa5: 0xe38,
  0xa6: 0xe06a, 0xa7: 0xe069, 0xa8: 0xe067, 0xa9: 0xe068, 0xaa: 0xe065, 0xab: 0xe066, 0xac: 0xe032,
  0xad: 0xe020, 0xae: 0xe02e, 0xaf: 0xe030, 0xb0: 0xe019, 0xb1: 0xe010, 0xb2: 0xe024, 0xb3: 0xe022,
  0xb5: 0xe06d, 0xb6: 0xe06c, 0xb7: 0xe021,
  0xba: 39, 0xbb: 13, 0xbc: 51, 0xbd: 12, 0xbe: 52, 0xbf: 53, 0xc0: 41,
  0xdb: 26, 0xdc: 43, 0xdd: 27, 0xde: 40, 0xdf: 125, 0xe2: 0xe46, 0xe5: 0xe064, 0xe6: 0xe03c
}

export function shortcutCode(virtualKey: number, extended: boolean): number {
  if (virtualKey >= 0x41 && virtualKey <= 0x5a) return LETTER_CODES[virtualKey - 0x41]
  if (virtualKey >= 0x30 && virtualKey <= 0x39) return virtualKey === 0x30 ? 11 : virtualKey - 0x31 + 2
  if (virtualKey >= 0x60 && virtualKey <= 0x69) return NUMPAD_CODES[virtualKey - 0x60]
  if (virtualKey >= 0x70 && virtualKey <= 0x87) return FUNCTION_CODES[virtualKey - 0x70]
  if (virtualKey === 0x0d) return extended ? 0xe1c : 28
  const navigation = NAVIGATION_CODES[virtualKey - 0x21]
  if (navigation !== undefined) return extended ? navigation : navigation | 0xee00
  const code = OTHER_CODES[virtualKey] ?? 0x10000 + virtualKey
  return !extended && (virtualKey === 0x2d || virtualKey === 0x2e) ? code | 0xee00 : code
}

interface KeyEvent {
  id: string
  code: number
  virtualKey: number
  down: boolean
  time: number
}

function loadWin32() {
  // Load lazily so a missing native module cannot prevent the rest of the app from starting.
  const ffi: typeof Koffi = require('koffi')
  const user32 = ffi.load('user32.dll')
  const rawInputDevice = ffi.struct({
    usagePage: 'uint16_t', usage: 'uint16_t', flags: 'uint32_t', target: 'uintptr_t'
  })
  const rawInputHeader = ffi.struct({
    type: 'uint32_t', size: 'uint32_t', device: 'uintptr_t', wParam: 'uintptr_t'
  })
  const rawKeyboard = ffi.struct({
    makeCode: 'uint16_t', flags: 'uint16_t', reserved: 'uint16_t', virtualKey: 'uint16_t',
    message: 'uint32_t', extra: 'uint32_t'
  })
  const keyboardInput = ffi.struct({
    virtualKey: 'uint16_t', scanCode: 'uint16_t', flags: 'uint32_t', time: 'uint32_t', extra: 'uintptr_t'
  })
  // INPUT's union has the size and alignment of its largest member, MOUSEINPUT.
  const mouseInput = ffi.struct({
    x: 'int32_t', y: 'int32_t', data: 'uint32_t', flags: 'uint32_t', time: 'uint32_t', extra: 'uintptr_t'
  })
  const input = ffi.struct({ type: 'uint32_t', data: ffi.union({ keyboard: keyboardInput, mouse: mouseInput }) })
  return {
    ffi, rawInputDevice, rawInputHeader, rawKeyboard, input,
    register: user32.func('__stdcall', 'RegisterRawInputDevices', 'int', [ffi.pointer(rawInputDevice), 'uint32_t', 'uint32_t']),
    read: user32.func('uint32_t __stdcall GetRawInputData(uintptr_t, uint32_t, void *, _Inout_ uint32_t *, uint32_t)'),
    getState: user32.func('int16_t __stdcall GetAsyncKeyState(int)'),
    getTime: user32.func('int32_t __stdcall GetMessageTime()'),
    send: user32.func('__stdcall', 'SendInput', 'uint32_t', ['uint32_t', ffi.pointer(input), 'int'])
  }
}

export function createWindowsKeyboard(win: BrowserWindow, onKey: (key: KeyEvent) => void, onReset: () => void) {
  const api = loadWin32()
  const { ffi } = api
  const headerSize = ffi.sizeof(api.rawInputHeader)
  const keyboardSize = ffi.sizeof(api.rawKeyboard)
  // RAWINPUT can include padding for the other members of its data union.
  const packet = Buffer.alloc(headerSize + Math.max(keyboardSize, 24))
  let listening = false

  function readKey(_wParam: Buffer, lParam: Buffer): void {
    const handle = ffi.decode(lParam, 'uintptr_t')
    const size = [packet.length]
    const bytes = api.read(handle, RID_INPUT, packet, size, headerSize)
    if (bytes < headerSize + keyboardSize || bytes > packet.length) return
    const header = ffi.decode(packet, api.rawInputHeader)
    if (header.type !== RIM_TYPEKEYBOARD || !header.device) return
    const key = ffi.decode(packet, headerSize, api.rawKeyboard)
    if (key.extra === INJECTED_BY_FLUSSTEXT || key.virtualKey === 0xff || key.makeCode === 0xff) return

    const extended = (key.flags & RI_KEY_E0) !== 0
    let virtualKey: number = key.virtualKey
    if (virtualKey === 0x10) virtualKey = key.makeCode === 0x36 ? 0xa1 : 0xa0
    else if (virtualKey === 0x11) virtualKey = extended ? 0xa3 : VK_LCONTROL
    else if (virtualKey === 0x12) virtualKey = extended ? 0xa5 : 0xa4
    onKey({
      id: `${header.device}:${key.makeCode || virtualKey}:${key.flags & (RI_KEY_E0 | RI_KEY_E1)}`,
      code: shortcutCode(virtualKey, extended),
      virtualKey,
      down: (key.flags & RI_KEY_BREAK) === 0,
      time: api.getTime() >>> 0
    })
  }

  function listen(enabled: boolean): void {
    if (enabled === listening || win.isDestroyed()) return
    if (enabled) {
      win.hookWindowMessage(WM_INPUT, readKey)
      win.hookWindowMessage(WM_INPUT_DEVICE_CHANGE, (wParam) => {
        if (Number(ffi.decode(wParam, 'uintptr_t')) === GIDC_REMOVAL) onReset()
      })
    }
    // Usage page 1, usage 6 is keyboard only. Windows still delivers ordinary input as usual.
    const ok = api.register({
      usagePage: 1,
      usage: 6,
      flags: enabled ? RIDEV_INPUTSINK | RIDEV_DEVNOTIFY : RIDEV_REMOVE,
      target: enabled ? ffi.decode(win.getNativeWindowHandle(), 'uintptr_t') : 0
    }, 1, ffi.sizeof(api.rawInputDevice))
    if (!enabled || !ok) {
      win.unhookWindowMessage(WM_INPUT)
      win.unhookWindowMessage(WM_INPUT_DEVICE_CHANGE)
    }
    listening = enabled && !!ok
    if (!ok) throw new Error('Windows Raw Input konnte nicht registriert werden')
  }

  function isDown(virtualKey: number): boolean {
    return api.getState(virtualKey) < 0
  }

  function inject(virtualKey: number, up: boolean) {
    return {
      type: INPUT_KEYBOARD,
      data: { keyboard: { virtualKey, scanCode: 0, flags: up ? KEYEVENTF_KEYUP : 0, time: 0, extra: INJECTED_BY_FLUSSTEXT } }
    }
  }

  function send(events: ReturnType<typeof inject>[]): boolean {
    const size = ffi.sizeof(api.input)
    const sent = api.send(events.length, events, size)
    if (sent === events.length) return true
    if (sent > 0) {
      const keys = new Set<number>()
      for (const { data: { keyboard: key } } of events.slice(0, sent)) {
        if (key.flags === KEYEVENTF_KEYUP) keys.delete(key.virtualKey)
        else keys.add(key.virtualKey)
      }
      const releases = [...keys].reverse().map((key) => inject(key, true))
      if (releases.length) api.send(releases.length, releases, size)
    }
    return false
  }

  const modifiersDown = (): boolean => MODIFIERS.some(isDown)
  return {
    listen,
    isDown,
    modifiersDown,
    dismissStartMenuOnRelease(): void {
      if ((isDown(VK_LWIN) || isDown(VK_RWIN)) && !isDown(START_MENU_MASK_KEY)) {
        send([inject(START_MENU_MASK_KEY, false), inject(START_MENU_MASK_KEY, true)])
      }
    },
    paste(): boolean {
      // Send the entire shortcut together, after confirming no modifier is held.
      return !modifiersDown() && !isDown(0x56) && send([
        inject(VK_LCONTROL, false), inject(0x56, false), inject(0x56, true), inject(VK_LCONTROL, true)
      ])
    }
  }
}

export type { KeyEvent }

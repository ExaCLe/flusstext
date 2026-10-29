// Generiert aus uiohook-napi UiohookKey: Keycode -> deutsches Label
export const KEY_LABELS: Record<number, string> = {
  "1": "Esc",
  "2": "1",
  "3": "2",
  "4": "3",
  "5": "4",
  "6": "5",
  "7": "6",
  "8": "7",
  "9": "8",
  "10": "9",
  "11": "0",
  "12": "Minus",
  "13": "Equal",
  "14": "Rücktaste",
  "15": "Tab",
  "16": "Q",
  "17": "W",
  "18": "E",
  "19": "R",
  "20": "T",
  "21": "Y",
  "22": "U",
  "23": "I",
  "24": "O",
  "25": "P",
  "26": "BracketLeft",
  "27": "BracketRight",
  "28": "Eingabe",
  "29": "Strg",
  "30": "A",
  "31": "S",
  "32": "D",
  "33": "F",
  "34": "G",
  "35": "H",
  "36": "J",
  "37": "K",
  "38": "L",
  "39": "Semicolon",
  "40": "Quote",
  "41": "Backquote",
  "42": "Umschalt",
  "43": "Backslash",
  "44": "Z",
  "45": "X",
  "46": "C",
  "47": "V",
  "48": "B",
  "49": "N",
  "50": "M",
  "51": "Comma",
  "52": "Period",
  "53": "Slash",
  "54": "Umschalt rechts",
  "55": "Num Multiply",
  "56": "Alt",
  "57": "Leertaste",
  "58": "Feststell",
  "59": "F1",
  "60": "F2",
  "61": "F3",
  "62": "F4",
  "63": "F5",
  "64": "F6",
  "65": "F7",
  "66": "F8",
  "67": "F9",
  "68": "F10",
  "69": "Num",
  "70": "Rollen",
  "71": "Num 7",
  "72": "Num 8",
  "73": "Num 9",
  "74": "Num Subtract",
  "75": "Num 4",
  "76": "Num 5",
  "77": "Num 6",
  "78": "Num Add",
  "79": "Num 1",
  "80": "Num 2",
  "81": "Num 3",
  "82": "Num 0",
  "83": "Num Decimal",
  "87": "F11",
  "88": "F12",
  "91": "F13",
  "92": "F14",
  "93": "F15",
  "99": "F16",
  "100": "F17",
  "101": "F18",
  "102": "F19",
  "103": "F20",
  "104": "F21",
  "105": "F22",
  "106": "F23",
  "107": "F24",
  "3612": "Num Enter",
  "3613": "Strg rechts",
  "3637": "Num Divide",
  "3639": "Druck",
  "3640": "AltGr",
  "3655": "Pos1",
  "3657": "Bild auf",
  "3663": "Ende",
  "3665": "Bild ab",
  "3666": "Einfg",
  "3667": "Entf",
  "3675": "Win",
  "3676": "Win rechts",
  "57416": "↑",
  "57419": "←",
  "57421": "→",
  "57424": "↓",
  "60999": "Num Home",
  "61000": "Num ArrowUp",
  "61001": "Num PageUp",
  "61003": "Num ArrowLeft",
  "61005": "Num ArrowRight",
  "61007": "Num End",
  "61008": "Num ArrowDown",
  "61009": "Num PageDown",
  "61010": "Num Insert",
  "61011": "Num Delete"
}

export const MODIFIER_KEYS = new Set<number>([29, 3613, 56, 3640, 42, 54, 3675, 3676])

/** Linke/rechte Modifier werden gleich behandelt. */
export function normalizeKey(code: number): number {
  switch (code) {
    case 3613: return 29
    case 54: return 42
    case 3676: return 3675
    default: return code
  }
}

const ORDER = [29, 3675, 56, 3640, 42]

export function sortKeys(keys: number[]): number[] {
  return [...keys].sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a - b
  })
}

export function keyLabel(code: number, platform = 'win32'): string {
  if (platform === 'darwin') {
    if (code === 3675 || code === 3676) return '⌘'
    if (code === 56 || code === 3640) return '⌥'
    if (code === 29 || code === 3613) return '⌃'
  }
  return KEY_LABELS[code] ?? `#${code}`
}

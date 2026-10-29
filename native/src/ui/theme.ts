// Farben und Schrift aus src/renderer/src/styles.css, übertragen auf React Native.
import { createContext, useContext } from 'react'
import { Platform, type TextStyle } from 'react-native'

// RN macOS 0.83 does not advance native-driven opacity in the bridgeless host.
export const nativeAnimations = Platform.OS !== ('macos' as string)

export interface Palette {
  dark: boolean
  bg: string
  sidebar: string
  panel: string
  surface: string
  surface2: string
  line: string
  lineSoft: string
  lineStrong: string
  fg: string
  fg2: string
  muted: string
  faint: string
  ink: string
  inkFg: string
  accent: string
  accentStrong: string
  accentSoft: string
  accentText: string
  accentFg: string
  success: string
  successSoft: string
  successText: string
  danger: string
  dangerSoft: string
  dangerText: string
  warning: string
  warningSoft: string
  warningText: string
  mark: string
  backdrop: string
  spk: string[]
}

export const light: Palette = {
  dark: false,
  bg: '#fafaf9',
  sidebar: '#f3f3f1',
  panel: '#ffffff',
  surface: 'rgba(20, 21, 23, 0.03)',
  surface2: '#efefec',
  line: '#e6e6e3',
  lineSoft: '#efefec',
  lineStrong: '#dadad6',
  fg: '#141517',
  fg2: '#3d4046',
  muted: '#5f6368',
  faint: '#8b8f97',
  ink: '#141517',
  inkFg: '#ffffff',
  accent: '#3b5bdb',
  accentStrong: '#2b44a8',
  accentSoft: '#eef1fd',
  accentText: '#2b44a8',
  accentFg: '#ffffff',
  success: '#1f9d55',
  successSoft: '#e8f5ee',
  successText: '#146c3c',
  danger: '#d92d20',
  dangerSoft: '#fdecec',
  dangerText: '#b42318',
  warning: '#d97706',
  warningSoft: 'rgba(217, 119, 6, 0.12)',
  warningText: '#92400e',
  mark: '#fff1b8',
  backdrop: 'rgba(0, 0, 0, 0.3)',
  spk: ['#3b5bdb', '#b5531a', '#0f7a70', '#7a3fc8', '#b42373', '#4d7c0f', '#0369a1', '#a16207']
}

export const dark: Palette = {
  dark: true,
  bg: '#141517',
  sidebar: '#1a1b1e',
  panel: '#1e1f23',
  surface: 'rgba(255, 255, 255, 0.035)',
  surface2: '#26272c',
  line: '#2a2c31',
  lineSoft: '#25272b',
  lineStrong: '#3a3c42',
  fg: '#ecedee',
  fg2: '#c9cbcf',
  muted: '#a1a4ab',
  faint: '#7c8088',
  ink: '#ecedee',
  inkFg: '#141517',
  accent: '#8b9bff',
  accentStrong: '#a9b4ff',
  accentSoft: 'rgba(139, 155, 255, 0.14)',
  accentText: '#a9b4ff',
  accentFg: '#0c0c0d',
  success: '#3dd68c',
  successSoft: 'rgba(61, 214, 140, 0.12)',
  successText: '#5be49b',
  danger: '#f97066',
  dangerSoft: 'rgba(249, 112, 102, 0.12)',
  dangerText: '#fda29b',
  warning: '#d97706',
  warningSoft: 'rgba(217, 119, 6, 0.12)',
  warningText: '#fbbf24',
  mark: 'rgba(255, 214, 102, 0.32)',
  backdrop: 'rgba(0, 0, 0, 0.5)',
  spk: ['#8b9bff', '#f0915a', '#3cc4b4', '#b48cf2', '#f27bb5', '#9bcb4f', '#5ab8f0', '#e8b84a']
}

/** #rrggbb mit Deckkraft – Ersatz für Tailwinds `accent/45` usw. */
export function alpha(hex: string, a: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export const FONT = 'Geist'
export const MONO = 'Geist Mono'

export function font(weight: 400 | 500 | 600 = 400): TextStyle {
  return { fontFamily: FONT, fontWeight: String(weight) as TextStyle['fontWeight'] }
}

export const mono: TextStyle = { fontFamily: MONO, fontVariant: ['tabular-nums'] }
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] }

export interface Layout {
  /** Breites Fenster (Tablet, Mac): Seitenleiste wie in der Desktop-App */
  wide: boolean
  width: number
  /** Seitenabstand der Inhalte */
  pad: number
  platform: 'ios' | 'android' | 'macos'
  desktop: boolean
}

export const ThemeContext = createContext<{ c: Palette; layout: Layout }>({
  c: light,
  layout: { wide: false, width: 390, pad: 16, platform: Platform.OS === 'android' ? 'android' : 'ios', desktop: false }
})

export const useTheme = (): Palette => useContext(ThemeContext).c
export const useLayout = (): Layout => useContext(ThemeContext).layout

export function speakerColor(c: Palette, id: number | undefined): string {
  return id === undefined ? c.muted : c.spk[id % 8]
}

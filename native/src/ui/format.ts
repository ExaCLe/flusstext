// Entspricht src/renderer/src/lib/format.ts
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

export function bytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace('.', ',')} GB`
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`
  return `${n} B`
}

export function mb(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')} GB` : `${Math.round(n)} MB`
}

export const num = (n: number): string => n.toLocaleString('de-DE')

const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })
const shortDateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })

export function time(ts: number): string {
  return timeFmt.format(ts)
}

export function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const start = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(today) - start(d)) / 86400000)
  if (diff === 0) return 'Heute'
  if (diff === 1) return 'Gestern'
  if (diff < 7) return dayFmt.format(d).split(',')[0]
  return dayFmt.format(d)
}

export function relative(ts: number): string {
  const diff = (Date.now() - ts) / 1000
  if (diff < 60) return 'gerade eben'
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} min`
  if (diff < 86400 && new Date(ts).getDate() === new Date().getDate()) return `heute, ${time(ts)}`
  if (diff < 172800) return `${dayLabel(ts)}, ${time(ts)}`
  return dateFmt.format(ts)
}

export function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Gute Nacht'
  if (h < 11) return 'Guten Morgen'
  if (h < 18) return 'Guten Tag'
  return 'Guten Abend'
}

/** Zeitstempel mit zweistelligen Minuten: 01:05 bzw. 01:02:05 */
export function stamp(sec: number, withHours = false): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return withHours || h > 0 ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`
}

/** „42 min 18 s“ bzw. „1 h 5 min“ */
export function longDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`
  if (m > 0) return `${m} min ${s % 60} s`
  return `${s} s`
}

/** „Di., 20. Okt. · 09:30“ */
export function dateLine(ts: number): string {
  return `${shortDateFmt.format(ts)} · ${time(ts)}`
}

export function defaultTitle(ts: number): string {
  const d = new Date(ts)
  return `Aufnahme vom ${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
}

import type { ReactNode } from 'react'

/** Suchbegriff im Text gelb markieren (Groß-/Kleinschreibung egal). */
export function highlight(text: string, q: string): ReactNode {
  if (!q) return text
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return parts.map((p, i) =>
    i % 2 ? (
      <mark key={i} className="rounded-[3px] bg-mark px-0.5 text-inherit">
        {p}
      </mark>
    ) : (
      p
    )
  )
}

/** Wortmarke: dunkles Quadrat mit vier Pegelbalken. */
export function Logo({ size = 28 }: { size?: number }): React.ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <rect width="28" height="28" rx="8" style={{ fill: 'var(--ink)' }} />
      <g style={{ fill: 'var(--ink-fg)' }}>
        <rect x="5" y="10" width="3" height="8" rx="1.5" />
        <rect x="10" y="7" width="3" height="14" rx="1.5" />
        <rect x="15" y="9" width="3" height="10" rx="1.5" />
        <rect x="20" y="11.5" width="3" height="5" rx="1.5" />
      </g>
    </svg>
  )
}

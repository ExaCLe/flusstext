import { clsx } from 'clsx'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown, X } from 'lucide-react'
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { keyLabel, sortKeys } from '@shared/keys'

export const cn = clsx

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'subtle'

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode }
>(function Button({ variant = 'secondary', size = 'md', icon, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap transition-[background,color,border-color,box-shadow,transform,opacity] duration-150 ease-snappy select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' && 'h-8 rounded-lg px-2.5 text-[12.5px] [&_svg]:size-3.5',
        size === 'md' && 'h-9 rounded-[9px] px-3.5 text-[13px] [&_svg]:size-[15px]',
        size === 'lg' && 'h-10 rounded-[9px] px-4 text-[13.5px] [&_svg]:size-[15px]',
        variant === 'primary' && 'bg-ink text-ink-fg hover:opacity-[0.88]',
        variant === 'accent' && 'bg-accent text-accent-fg hover:bg-accent-strong',
        variant === 'secondary' && 'border border-line-strong bg-panel text-fg hover:bg-surface',
        variant === 'ghost' && 'text-fg-2 hover:bg-surface-2 hover:text-fg',
        variant === 'subtle' && 'bg-surface-2 text-fg hover:bg-line-strong/70',
        variant === 'danger' && 'bg-danger-soft text-danger-text hover:bg-danger/15',
        className
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
})

export function IconButton({
  className,
  label,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }): ReactNode {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg active:scale-95 disabled:opacity-40 [&_svg]:size-[15px]',
        active && 'bg-surface-2 text-fg',
        className
      )}
      {...rest}
    />
  )
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div className={cn('rounded-[14px] border border-line bg-panel shadow-[var(--card-shadow)]', className)} {...rest}>
      {children}
    </div>
  )
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }): ReactNode {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40',
        checked ? 'bg-ink' : 'bg-line-strong'
      )}
    >
      <span
        className={cn(
          'absolute top-[3px] left-[3px] size-4 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform duration-200 ease-out-expo',
          checked ? 'translate-x-4 bg-ink-fg' : 'bg-white'
        )}
      />
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md'
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}): ReactNode {
  return (
    <div className="inline-flex rounded-[9px] bg-surface-2 p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative rounded-md px-3 font-medium transition-colors',
            size === 'sm' ? 'h-6 text-[12px]' : 'h-7 text-[13px]',
            value === o.value ? 'text-fg' : 'text-fg-2 hover:text-fg'
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${options.map((x) => x.value).join()}`}
              className="absolute inset-0 rounded-md bg-panel shadow-[0_1px_2px_rgba(20,21,23,0.08),0_0_0_1px_var(--line)]"
              transition={{ type: 'spring', duration: 0.3, bounce: 0.15 }}
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
  placeholder
}: {
  value: T | null
  options: { value: T; label: string; hint?: string; disabled?: boolean }[]
  onChange: (v: T) => void
  className?: string
  placeholder?: string
}): ReactNode {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const current = options.find((o) => o.value === value)
  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex h-9 w-full items-center gap-2 rounded-[9px] border border-line bg-panel pr-2.5 pl-3 text-left text-[13px] transition-colors hover:border-line-strong"
      >
        <span className={cn('flex-1 truncate', !current && 'text-faint')}>{current?.label ?? placeholder ?? 'Auswählen'}</span>
        <ChevronDown className={cn('size-3.5 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 left-0 z-50 mt-1 max-h-72 min-w-56 origin-top overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-[0_16px_40px_-12px_rgba(20,21,23,0.28),0_4px_8px_-2px_rgba(20,21,23,0.06)]"
          >
            {options.map((o) => (
              <button
                key={o.value}
                disabled={o.disabled}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2 disabled:opacity-40"
              >
                <span className="flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-[11.5px] text-faint">{o.hint}</span>}
                </span>
                {o.value === value && <Check className="size-3.5 text-fg" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  return (
    <kbd
      className={cn(
        'inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] border border-line-strong border-b-2 bg-bg px-1.5 font-mono text-[11.5px] font-medium text-fg',
        className
      )}
    >
      {children}
    </kbd>
  )
}

export function Hotkey({ keys, className }: { keys: number[]; className?: string }): ReactNode {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {sortKeys(keys).map((k) => (
        <Kbd key={k}>{keyLabel(k)}</Kbd>
      ))}
    </span>
  )
}

export function Badge({
  children,
  tone = 'default',
  size = 'sm',
  className
}: {
  children: ReactNode
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger'
  size?: 'sm' | 'md'
  className?: string
}): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium whitespace-nowrap',
        size === 'sm' ? 'h-5 gap-1 px-2 text-[11px] [&_svg]:size-3' : 'h-6 gap-1.5 px-2.5 text-[12px] [&_svg]:size-3',
        tone === 'default' && 'bg-surface-2 text-fg-2',
        tone === 'accent' && 'bg-accent-soft text-accent-text',
        tone === 'success' && 'bg-success-soft text-success-text',
        tone === 'warning' && 'bg-warning/12 text-[#92400e] dark:text-[#fbbf24]',
        tone === 'danger' && 'bg-danger-soft text-danger-text',
        className
      )}
    >
      {children}
    </span>
  )
}

export function Progress({ value, className, indeterminate }: { value: number; className?: string; indeterminate?: boolean }): ReactNode {
  return (
    <div className={cn('relative h-1.5 overflow-hidden rounded-full bg-surface-2', className)}>
      {indeterminate ? (
        <div className="absolute inset-y-0 w-1/3 animate-[indeterminate_1.3s_ease-in-out_infinite] rounded-full bg-accent" />
      ) : (
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
          style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
        />
      )}
    </div>
  )
}

export function Meter({ value, max = 5, label }: { value: number; max?: number; label: string }): ReactNode {
  return (
    <div className="flex items-center gap-2" title={`${label}: ${value}/${max}`}>
      <span className="text-[11.5px] whitespace-nowrap text-muted">{label}</span>
      <div className="flex gap-[3px]">
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={cn('h-1.5 w-3 rounded-full', i < value ? 'bg-accent' : 'bg-surface-2')} />
        ))}
      </div>
    </div>
  )
}

export function SettingRow({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children?: ReactNode; className?: string }): ReactNode {
  return (
    <div className={cn('flex items-center gap-6 px-5 py-3.5', className)}>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium">{title}</div>
        {description && <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{description}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

export function Section({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }): ReactNode {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-end justify-between gap-4 px-1">
        <div>
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
        </div>
        {action}
      </div>
      <Card className="divide-y divide-line">{children}</Card>
    </section>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }): ReactNode {
  return (
    <div className="mb-7 flex items-end justify-between gap-6">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[13.5px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Modal({ open, onClose, children, width = 440 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }): ReactNode {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{ width }}
            className="relative max-w-[calc(100vw-48px)] rounded-2xl border border-line bg-panel p-6 shadow-[0_24px_64px_-12px_rgba(20,21,23,0.35)]"
          >
            <IconButton label="Schließen" className="absolute top-3 right-3" onClick={onClose}>
              <X />
            </IconButton>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-muted [&_svg]:size-5">{icon}</div>
      <div className="text-[15px] font-semibold">{title}</div>
      <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Spinner({ className }: { className?: string }): ReactNode {
  return (
    <svg className={cn('size-4 animate-spin', className)} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/** Sprecherfarben kommen aus dem Theme (--spk-0 … --spk-7), damit sie im Dunkelmodus heller sind. */
export function speakerColor(id: number | undefined): string {
  return id === undefined ? 'var(--muted)' : `var(--spk-${id % 8})`
}

/** „Maya Chen“ → MC, „Sprecher 2“ → S2, „Anna“ → An */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).replace(/^./, (c) => c.toUpperCase())
  const last = words[words.length - 1]
  return (words[0][0] + (/^\d+$/.test(last) ? last : last[0])).toUpperCase()
}

export function Avatar({ name, speaker, size = 32, className }: { name: string; speaker?: number; size?: number; className?: string }): ReactNode {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none dark:text-[#0c0c0d]', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), background: speakerColor(speaker) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}

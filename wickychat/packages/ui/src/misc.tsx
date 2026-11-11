'use client'
import { Switch as S, Tabs as Tb } from 'radix-ui'
import { cn } from './cn'

export function Skeleton({
  className,
  style,
}: {
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn(
        'relative block overflow-hidden rounded-md bg-bg-muted after:absolute after:inset-0 after:-translate-x-full after:animate-[q-shimmer_1.4s_infinite] after:bg-gradient-to-r after:from-transparent after:via-bg-emphasis/60 after:to-transparent',
        className,
      )}
    />
  )
}

export function EmptyState({
  icon,
  emoji,
  illustration,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode
  /** A friendly emoji shown in a hand-drawn bubble; takes the place of `icon`. */
  emoji?: string
  /** Room for a custom SVG or image; takes the place of `emoji` and `icon`. */
  illustration?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'group/empty flex flex-col items-center justify-center px-6 py-14 text-center animate-in',
        className,
      )}
    >
      {illustration ? (
        <div className="mb-4">{illustration}</div>
      ) : emoji ? (
        <div
          aria-hidden="true"
          className="q-sketch mb-4 flex size-14 items-center justify-center border-2 border-dashed border-accent/35 bg-accent-subtle text-[26px] leading-none"
        >
          <span className="inline-block group-hover/empty:animate-[q-wiggle_500ms_ease-in-out]">
            {emoji}
          </span>
        </div>
      ) : (
        icon && (
          <div className="mb-4 flex size-10 items-center justify-center rounded-lg border border-border bg-bg-subtle text-fg-subtle [&_svg]:size-5">
            {icon}
          </div>
        )
      )}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] text-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'accent' | 'danger' | 'warning' | 'success'
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-[5px] px-1.5 text-2xs font-medium',
        tone === 'neutral' && 'bg-bg-muted text-fg-muted',
        tone === 'accent' && 'bg-accent-subtle text-accent-text',
        tone === 'danger' && 'bg-danger-subtle text-danger',
        tone === 'warning' && 'bg-warning/15 text-warning',
        tone === 'success' && 'bg-success/15 text-success',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Unread counter pill. */
export function Count({ n, tone = 'accent' }: { n: number; tone?: 'accent' | 'muted' }) {
  if (n <= 0) return null
  return (
    <span
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-2xs font-semibold tabular-nums',
        tone === 'accent' ? 'bg-accent text-accent-fg' : 'bg-bg-emphasis text-fg-muted',
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
  )
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-bg-subtle px-1 font-sans text-2xs text-fg-muted">
      {children}
    </kbd>
  )
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  label,
}: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
  id?: string
  label?: string
}) {
  return (
    <S.Root
      id={id}
      aria-label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-bg-emphasis transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
    >
      <S.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
    </S.Root>
  )
}

export const Tabs = Tb.Root
export const TabsContent = Tb.Content

export function TabsList({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <Tb.List className={cn('flex items-center gap-4 border-b border-border', className)}>
      {children}
    </Tb.List>
  )
}

export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <Tb.Trigger
      value={value}
      className="relative -mb-px flex h-9 items-center gap-1.5 border-b-2 border-transparent text-[13px] font-medium text-fg-muted transition-colors hover:text-fg data-[state=active]:border-fg data-[state=active]:text-fg"
    >
      {children}
    </Tb.Trigger>
  )
}

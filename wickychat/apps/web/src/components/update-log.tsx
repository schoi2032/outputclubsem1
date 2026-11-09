import { cn } from '@quid/ui'
import { UPDATES } from '@/lib/changelog'

const TAG = {
  new: { label: 'New', className: 'bg-accent-subtle text-accent-text' },
  improved: { label: 'Improved', className: 'bg-success/15 text-success' },
  fixed: { label: 'Fixed', className: 'bg-bg-emphasis text-fg-muted' },
}

const day = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

/** The update log as a timeline. Plain markup, so the public site can use it too. */
export function UpdateLog({ highlightAfter }: { highlightAfter?: string }) {
  const seenIndex = highlightAfter ? UPDATES.findIndex((u) => u.id === highlightAfter) : -1
  return (
    <ol className="relative flex flex-col gap-8 border-l border-border pl-6">
      {UPDATES.map((u, i) => {
        const fresh = highlightAfter !== undefined && (seenIndex === -1 || i < seenIndex)
        return (
          <li key={u.id} id={u.id} className="relative">
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-0.5 -left-[38px] flex size-7 items-center justify-center rounded-full border border-border bg-bg text-sm',
                fresh && 'border-accent ring-3 ring-accent/15',
              )}
            >
              {u.emoji}
            </span>
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
              <time dateTime={u.date}>{day(u.date)}</time>
              {u.tag && (
                <span className={cn('rounded-full px-2 py-0.5 font-medium', TAG[u.tag].className)}>
                  {TAG[u.tag].label}
                </span>
              )}
              {fresh && (
                <span className="font-medium text-accent-text">· Since your last visit</span>
              )}
            </div>
            <h2 className="mt-1 text-base font-semibold tracking-[-0.01em] text-fg">{u.title}</h2>
            <p className="mt-0.5 text-[13px] text-fg-muted">{u.summary}</p>
            <ul className="mt-2.5 flex flex-col gap-1.5 text-[13.5px] leading-relaxed text-fg-muted">
              {u.items.map((it) => (
                <li key={it} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-[9px] size-1 shrink-0 rounded-full bg-fg-subtle"
                  />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </li>
        )
      })}
    </ol>
  )
}

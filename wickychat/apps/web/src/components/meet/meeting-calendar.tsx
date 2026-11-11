'use client'
import type { Meeting } from '@quid/shared'
import { Button, cn, IconButton } from '@quid/ui'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { formatTime } from '@/lib/format'
import { useOrgContext } from '../org-context'

const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }),
)
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const when = (m: Meeting) => new Date(m.scheduledFor ?? m.startedAt ?? m.createdAt)

/** Month view of the meetings someone hosts, was invited to or attended. */
export function MeetingCalendar({ meetings }: { meetings: Meeting[] }) {
  const { base } = useOrgContext()
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const byDay = useMemo(() => {
    const map = new Map<string, Meeting[]>()
    for (const m of meetings) {
      const k = dayKey(when(m))
      map.set(
        k,
        [...(map.get(k) ?? []), m].sort((a, b) => when(a).getTime() - when(b).getTime()),
      )
    }
    return map
  }, [meetings])

  // Six weeks starting on the Sunday on or before the 1st.
  const first = new Date(cursor)
  first.setDate(1 - cursor.getDay())
  const days = Array.from(
    { length: 42 },
    (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i),
  )
  const today = dayKey(new Date())

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[15px] font-semibold">
          {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
          >
            Today
          </Button>
          <IconButton
            label="Previous month"
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
          >
            <ChevronLeft />
          </IconButton>
          <IconButton
            label="Next month"
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
          >
            <ChevronRight />
          </IconButton>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-7 border-b border-border bg-bg-subtle">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-1.5 text-2xs font-medium text-fg-subtle uppercase">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const items = byDay.get(dayKey(d)) ?? []
            const outside = d.getMonth() !== cursor.getMonth()
            return (
              <div
                key={dayKey(d)}
                className={cn(
                  'min-h-24 border-border p-1.5',
                  i % 7 !== 6 && 'border-r',
                  i < 35 && 'border-b',
                  outside && 'bg-bg-subtle/60',
                )}
              >
                <span
                  className={cn(
                    'inline-flex size-6 items-center justify-center rounded-full text-xs',
                    outside ? 'text-fg-subtle' : 'text-fg-muted',
                    dayKey(d) === today && 'bg-accent font-semibold text-accent-fg',
                  )}
                >
                  {d.getDate()}
                </span>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {items.slice(0, 3).map((m) => (
                    <li key={m.id}>
                      <Link
                        href={`${base}/meet/${m.code}`}
                        title={`${m.title} · ${formatTime(when(m).toISOString())}`}
                        className={cn(
                          'block truncate rounded px-1.5 py-0.5 text-2xs font-medium',
                          m.status === 'live'
                            ? 'bg-success/15 text-success'
                            : m.status === 'ended'
                              ? 'bg-bg-muted text-fg-subtle'
                              : 'bg-accent-subtle text-accent-text',
                        )}
                      >
                        {formatTime(when(m).toISOString())} {m.title}
                      </Link>
                    </li>
                  ))}
                  {items.length > 3 && (
                    <li className="px-1.5 text-2xs text-fg-subtle">+{items.length - 3} more</li>
                  )}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

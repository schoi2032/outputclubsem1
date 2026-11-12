'use client'
import type { CalendarEvent, CalendarItem } from '@quid/shared'
import { Button, cn, IconButton, Skeleton } from '@quid/ui'
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import {
  EventDialog,
  ItemDialog,
  itemDone,
  itemKind,
  itemTitle,
  KIND_STYLE,
} from '@/components/school/event-dialogs'
import {
  addDays,
  dayKey,
  isTeacherRole,
  longDay,
  parseDayKey,
  startOfDay,
  timeOf,
  useCalendar,
} from '@/lib/calendar-data'

const FILTERS = [
  ['homework', 'Homework'],
  ['test', 'Tests'],
  ['event', 'Class events'],
  ['personal', 'Personal'],
  ['task', 'Tasks'],
  ['meeting', 'Meetings'],
  ['booking', 'Office hours'],
] as const

function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = addDays(first, -first.getDay())
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

function onDay(i: CalendarItem, d: Date) {
  const s = new Date(i.startsAt)
  const e = i.endsAt ? new Date(i.endsAt) : s
  return s < addDays(d, 1) && e >= d
}

function CalendarInner() {
  const { org, me } = useOrgContext()
  const router = useRouter()
  const params = useSearchParams()
  const teacher = isTeacherRole(org.role)
  const [selected, setSelected] = useState(
    () => parseDayKey(params.get('d')) ?? startOfDay(new Date()),
  )
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1))
  const [hidden, setHidden] = useState<string[]>([])
  const [open, setOpen] = useState<CalendarItem | null>(null)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [adding, setAdding] = useState(false)

  const days = useMemo(() => monthGrid(month), [month])
  const q = useCalendar(days[0]!, addDays(days[41]!, 1))
  const items = (q.data ?? []).filter((i) => !hidden.includes(itemKind(i)))

  const wantId = params.get('e')
  useEffect(() => {
    if (!wantId || !q.data) return
    const hit = q.data.find((i) => i.id === wantId)
    if (hit) setOpen(hit)
    router.replace(`?d=${dayKey(selected)}`, { scroll: false })
  }, [wantId, q.data, router, selected])

  const today = startOfDay(new Date())
  const dayItems = items.filter((i) => onDay(i, selected))
  const upcomingDue = items.filter(
    (i) =>
      (itemKind(i) === 'homework' || itemKind(i) === 'test') &&
      !itemDone(i) &&
      new Date(i.startsAt) >= new Date() &&
      new Date(i.startsAt) < addDays(today, 8),
  )

  const pick = (d: Date) => {
    setSelected(d)
    if (d.getMonth() !== month.getMonth()) setMonth(new Date(d.getFullYear(), d.getMonth(), 1))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Calendar"
        icon={<CalendarDays />}
        actions={
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            <Plus />
            {teacher ? 'Add' : 'New event'}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 p-3 md:p-6 lg:flex-row">
          <section className="min-w-0 flex-1">
            <div className="mb-3 flex items-center gap-1">
              <h2 className="mr-auto text-lg font-semibold">
                {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </h2>
              <Button
                size="sm"
                onClick={() => {
                  pick(today)
                  setMonth(new Date(today.getFullYear(), today.getMonth(), 1))
                }}
              >
                Today
              </Button>
              <IconButton
                label="Last month"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              >
                <ChevronLeft />
              </IconButton>
              <IconButton
                label="Next month"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              >
                <ChevronRight />
              </IconButton>
            </div>

            <div className="mb-3 flex flex-wrap gap-1.5">
              {FILTERS.map(([k, label]) => {
                const off = hidden.includes(k)
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={!off}
                    onClick={() => setHidden(off ? hidden.filter((x) => x !== k) : [...hidden, k])}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs',
                      off ? 'text-fg-subtle line-through' : 'text-fg',
                    )}
                  >
                    <span
                      className={cn('size-2 rounded-full', KIND_STYLE[k]!.dot, off && 'opacity-30')}
                    />
                    {label}
                  </button>
                )
              })}
            </div>

            <div className="overflow-hidden rounded-lg border border-border">
              <div className="grid grid-cols-7 border-b border-border bg-bg-subtle text-center text-[11px] font-semibold uppercase text-fg-subtle">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="py-1.5">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {days.map((d) => {
                  const list = items.filter((i) => onDay(i, d))
                  const other = d.getMonth() !== month.getMonth()
                  const isSel = dayKey(d) === dayKey(selected)
                  const isToday = dayKey(d) === dayKey(today)
                  return (
                    <button
                      key={dayKey(d)}
                      type="button"
                      onClick={() => pick(d)}
                      onDoubleClick={() => {
                        pick(d)
                        setAdding(true)
                      }}
                      className={cn(
                        'flex min-h-16 flex-col gap-0.5 border-b border-r border-border p-1 text-left align-top md:min-h-[6.5rem]',
                        '[&:nth-child(7n)]:border-r-0',
                        other && 'bg-bg-subtle/60 text-fg-subtle',
                        isSel && 'ring-2 ring-inset ring-accent',
                      )}
                    >
                      <span
                        className={cn(
                          'grid size-6 place-items-center rounded-full text-xs',
                          isToday && 'bg-accent font-semibold text-accent-fg',
                        )}
                      >
                        {d.getDate()}
                      </span>
                      <span className="flex flex-wrap gap-0.5 md:hidden">
                        {list.slice(0, 4).map((i) => (
                          <span
                            key={i.id}
                            className={cn('size-1.5 rounded-full', KIND_STYLE[itemKind(i)]!.dot)}
                          />
                        ))}
                      </span>
                      <span className="hidden flex-col gap-0.5 md:flex">
                        {list.slice(0, 3).map((i) => (
                          <span
                            key={i.id}
                            className={cn(
                              'truncate rounded px-1 py-px text-[11px] font-medium',
                              KIND_STYLE[itemKind(i)]!.chip,
                              itemDone(i) && 'line-through opacity-60',
                            )}
                          >
                            {itemTitle(i, me.id)}
                          </span>
                        ))}
                        {list.length > 3 && (
                          <span className="px-1 text-[11px] text-fg-subtle">
                            +{list.length - 3} more
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          <aside className="flex w-full shrink-0 flex-col gap-6 lg:w-80">
            <section>
              <h2 className="mb-2 text-sm font-semibold">{longDay(selected)}</h2>
              {q.isLoading ? (
                <Skeleton className="h-24" />
              ) : !dayItems.length ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-[13px] text-fg-subtle">
                  Nothing on this day.{' '}
                  <button
                    type="button"
                    className="text-accent-text hover:underline"
                    onClick={() => setAdding(true)}
                  >
                    Add something
                  </button>
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {dayItems.map((i) => (
                    <ItemRow key={i.id} item={i} onOpen={() => setOpen(i)} />
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase text-fg-subtle">
                Due this week <span className="font-normal">{upcomingDue.length}</span>
              </h2>
              {!upcomingDue.length ? (
                <p className="text-[13px] text-fg-subtle">
                  {teacher
                    ? 'No homework or tests coming up.'
                    : 'Your all caught up for the next 7 days.'}
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {upcomingDue.map((i) => (
                    <ItemRow key={i.id} item={i} onOpen={() => setOpen(i)} showDay />
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </div>

      <ItemDialog
        item={open}
        onOpenChange={(o) => !o && setOpen(null)}
        onEdit={(e) => {
          setOpen(null)
          setEditing(e)
        }}
      />
      <EventDialog
        open={adding || !!editing}
        onOpenChange={(o) => {
          if (!o) {
            setAdding(false)
            setEditing(null)
          }
        }}
        event={editing}
        day={selected}
      />
    </div>
  )
}

function ItemRow({
  item,
  onOpen,
  showDay,
}: {
  item: CalendarItem
  onOpen: () => void
  showDay?: boolean
}) {
  const { me } = useOrgContext()
  const kind = itemKind(item)
  const style = KIND_STYLE[kind]!
  const allDay = item.type === 'event' && item.event.allDay
  const d = new Date(item.startsAt)
  const done = itemDone(item)
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-2.5 rounded-lg border border-border bg-bg p-2.5 text-left hover:bg-bg-muted"
      >
        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', style.dot)} />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-[13.5px] font-medium',
              done && 'line-through opacity-60',
            )}
          >
            {itemTitle(item, me.id)}
          </span>
          <span className="block truncate text-xs text-fg-muted">
            {showDay &&
              `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · `}
            {allDay ? 'All day' : timeOf(item.startsAt)}
            {item.type === 'event' && item.event.channelName && ` · #${item.event.channelName}`}
            {item.type === 'event' &&
              item.event.doneCount !== null &&
              ` · ${item.event.doneCount}/${item.event.memberCount} done`}
          </span>
        </span>
        {done && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}
      </button>
    </li>
  )
}

export default function CalendarPage() {
  return (
    <Suspense>
      <CalendarInner />
    </Suspense>
  )
}

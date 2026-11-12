'use client'
import type { OfficeHour, OfficeHourBooking, OfficeHourSlot, OfficeHourTeacher } from '@quid/shared'
import {
  Avatar,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from '@quid/ui'
import { ArrowLeft, Clock, MapPin, Pencil, Plus, Trash2, Video } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { del, errorMessage, patch, post } from '@/lib/api'
import {
  dayKey,
  isTeacherRole,
  longDay,
  timeOf,
  twelveHour,
  useBookings,
  useMyHours,
  useRefreshSchool,
  useSlots,
  useTeachers,
  WEEKDAYS,
} from '@/lib/calendar-data'
import { displayName } from '@/lib/format'

type Tab = 'book' | 'bookings' | 'hours'

function Person({
  user,
  size = 'md',
}: {
  user: OfficeHourTeacher['teacher']
  size?: 'xs' | 'md' | 'lg'
}) {
  return (
    <Avatar
      name={user.name}
      id={user.id}
      src={user.avatarUrl}
      decoration={user.decoration}
      size={size}
    />
  )
}

const hourLine = (h: OfficeHour) =>
  `${WEEKDAYS[h.weekday]!.slice(0, 3)} ${twelveHour(h.startTime)} to ${twelveHour(h.endTime)}`

function Inner() {
  const { org } = useOrgContext()
  const router = useRouter()
  const params = useSearchParams()
  const teacher = isTeacherRole(org.role)
  const raw = params.get('tab')
  const tab: Tab = raw === 'bookings' || (raw === 'hours' && teacher) ? raw : 'book'
  const bookings = useBookings()
  const upcoming = (bookings.data ?? []).filter(
    (b) => b.status === 'booked' && new Date(b.endsAt) > new Date(),
  ).length
  const tabs: [Tab, string][] = [
    ['book', 'Book a time'],
    ['bookings', `My bookings${upcoming ? ` (${upcoming})` : ''}`],
    ...(teacher ? ([['hours', 'My office hours']] as [Tab, string][]) : []),
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Office hours" icon={<Clock />}>
        <nav className="flex gap-4 px-3 md:px-6" aria-label="Office hours">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-current={tab === k ? 'page' : undefined}
              onClick={() => router.replace(`?tab=${k}`, { scroll: false })}
              className={cn(
                '-mb-px h-9 border-b-2 border-transparent text-[13px] font-medium text-fg-muted hover:text-fg',
                tab === k && 'border-fg text-fg',
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-4 md:p-6">
          {tab === 'book' && <BookTab />}
          {tab === 'bookings' && <BookingsTab list={bookings.data} loading={bookings.isLoading} />}
          {tab === 'hours' && <HoursTab />}
        </div>
      </div>
    </div>
  )
}

function BookTab() {
  const { me } = useOrgContext()
  const teachers = useTeachers()
  const [pickedId, setPickedId] = useState<string | null>(null)
  const list = (teachers.data ?? []).filter((t) => t.teacher.id !== me.id)
  const picked = list.find((t) => t.teacher.id === pickedId) ?? null

  if (teachers.isLoading) return <Skeleton className="h-48" />
  if (picked) return <SlotPicker t={picked} onBack={() => setPickedId(null)} />
  if (!list.length)
    return (
      <EmptyState
        emoji="🕒"
        title="No office hours yet"
        description="When a teacher sets up there office hours they show up here and you can book a time."
      />
    )
  return (
    <div className="flex flex-col gap-2">
      <p className="mb-2 text-[13px] text-fg-muted">
        Pick a teacher to see open times for the next two weeks.
      </p>
      {list.map((t) => (
        <button
          key={t.teacher.id}
          type="button"
          onClick={() => setPickedId(t.teacher.id)}
          className="flex items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-bg-muted"
        >
          <Person user={t.teacher} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium">{displayName(t.teacher)}</span>
            <span className="block truncate text-xs text-fg-muted">
              {t.hours.map(hourLine).join(', ')}
            </span>
          </span>
          <span className="shrink-0 text-right text-xs text-fg-subtle">
            {t.nextOpen ? (
              <>
                Next open
                <br />
                <span className="font-medium text-fg">
                  {new Date(t.nextOpen).toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}{' '}
                  {timeOf(t.nextOpen)}
                </span>
              </>
            ) : (
              'Fully booked'
            )}
          </span>
        </button>
      ))}
    </div>
  )
}

function SlotPicker({ t, onBack }: { t: OfficeHourTeacher; onBack: () => void }) {
  const slots = useSlots(t.teacher.id)
  const [chosen, setChosen] = useState<OfficeHourSlot | null>(null)
  const byDay = new Map<string, OfficeHourSlot[]>()
  for (const s of slots.data ?? []) {
    const k = dayKey(new Date(s.startsAt))
    byDay.set(k, [...(byDay.get(k) ?? []), s])
  }
  const notes = t.hours.filter((h) => h.note)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft />
          Teachers
        </Button>
        <Person user={t.teacher} />
        <h2 className="text-[15px] font-semibold">{displayName(t.teacher)}</h2>
      </div>
      {notes.map((h) => (
        <p key={h.id} className="rounded-lg bg-bg-muted px-3 py-2 text-[13px] text-fg-muted">
          {hourLine(h)}: {h.note}
        </p>
      ))}
      {slots.isLoading ? (
        <Skeleton className="h-48" />
      ) : !byDay.size ? (
        <p className="text-[13px] text-fg-subtle">No open times in the next two weeks.</p>
      ) : (
        [...byDay.entries()].map(([k, list]) => (
          <section key={k}>
            <h3 className="mb-2 text-xs font-semibold uppercase text-fg-subtle">
              {longDay(new Date(list[0]!.startsAt))}
              {list[0]!.location && (
                <span className="ml-2 font-normal normal-case">
                  {list[0]!.online ? '· Online' : `· ${list[0]!.location}`}
                </span>
              )}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {list.map((s) => (
                <button
                  key={s.startsAt}
                  type="button"
                  disabled={s.taken}
                  onClick={() => setChosen(s)}
                  className={cn(
                    'rounded-md border border-border px-3 py-1.5 text-[13px] font-medium',
                    s.taken
                      ? 'cursor-not-allowed text-fg-subtle line-through opacity-60'
                      : 'hover:border-accent hover:bg-accent-subtle hover:text-accent-text',
                  )}
                >
                  {timeOf(s.startsAt)}
                </button>
              ))}
            </div>
          </section>
        ))
      )}
      {chosen && (
        <ConfirmBooking slot={chosen} t={t} onClose={() => setChosen(null)} onDone={onBack} />
      )}
    </div>
  )
}

function ConfirmBooking({
  slot,
  t,
  onClose,
  onDone,
}: {
  slot: OfficeHourSlot
  t: OfficeHourTeacher
  onClose: () => void
  onDone: () => void
}) {
  const { api } = useOrgContext()
  const router = useRouter()
  const refresh = useRefreshSchool()
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const book = async () => {
    setBusy(true)
    try {
      await post(`${api}/office-hours/bookings`, {
        officeHourId: slot.officeHourId,
        startsAt: slot.startsAt,
        topic: topic.trim(),
      })
      toast.success(`Booked with ${displayName(t.teacher)}`)
      refresh()
      onClose()
      onDone()
      router.replace('?tab=bookings', { scroll: false })
    } catch (e) {
      toast.error(errorMessage(e))
      refresh()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Book ${displayName(t.teacher)}`}
        description={`${longDay(new Date(slot.startsAt))}, ${timeOf(slot.startsAt)} to ${timeOf(slot.endsAt)}`}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void book()
          }}
        >
          {(slot.location || slot.online) && (
            <p className="inline-flex items-center gap-1.5 text-[13px] text-fg-muted">
              {slot.online ? <Video className="size-4" /> : <MapPin className="size-4" />}
              {slot.online ? 'Online, you get a meeting link' : slot.location}
            </p>
          )}
          <Field label="What do you need help with?">
            {(p) => (
              <Textarea
                {...p}
                autoFocus
                rows={3}
                maxLength={300}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="So your teacher can get ready, like which problem or topic"
              />
            )}
          </Field>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Book it
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BookingsTab({ list, loading }: { list?: OfficeHourBooking[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-48" />
  const now = new Date()
  const upcoming = (list ?? []).filter((b) => b.status === 'booked' && new Date(b.endsAt) > now)
  const past = (list ?? [])
    .filter((b) => !upcoming.includes(b))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
  if (!upcoming.length && !past.length)
    return (
      <EmptyState
        emoji="📅"
        title="No bookings"
        description="Book a time with a teacher and it'll show up here and on your calendar."
      />
    )
  const groups = new Map<string, OfficeHourBooking[]>()
  for (const b of upcoming) {
    const k = dayKey(new Date(b.startsAt))
    groups.set(k, [...(groups.get(k) ?? []), b])
  }
  return (
    <div className="flex flex-col gap-7">
      {[...groups.values()].map((g) => (
        <section key={g[0]!.id}>
          <h2 className="mb-2 text-xs font-semibold uppercase text-fg-subtle">
            {longDay(new Date(g[0]!.startsAt))}
          </h2>
          <div className="flex flex-col gap-1.5">
            {g.map((b) => (
              <BookingRow key={b.id} b={b} />
            ))}
          </div>
        </section>
      ))}
      {!!past.length && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase text-fg-subtle">
            Past and cancelled
          </h2>
          <div className="flex flex-col gap-1.5 opacity-70">
            {past.slice(0, 20).map((b) => (
              <BookingRow key={b.id} b={b} past />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function BookingRow({ b, past }: { b: OfficeHourBooking; past?: boolean }) {
  const { api, base, me } = useOrgContext()
  const refresh = useRefreshSchool()
  const [busy, setBusy] = useState(false)
  const iAmStudent = b.student.id === me.id
  const other = iAmStudent ? b.teacher : b.student
  const cancelled = b.status === 'cancelled'
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-3">
      <Person user={other} />
      <div className="min-w-0 flex-1">
        <p className={cn('text-[14px] font-medium', cancelled && 'line-through')}>
          {iAmStudent ? displayName(other) : `${displayName(other)} is coming`}
        </p>
        <p className="text-xs text-fg-muted">
          {past &&
            `${new Date(b.startsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · `}
          {timeOf(b.startsAt)} to {timeOf(b.endsAt)}
          {b.location && ` · ${b.location}`}
          {cancelled && ` · cancelled${b.cancelledByMe ? ' by you' : ''}`}
        </p>
        {b.topic && <p className="mt-1 text-[13px]">{b.topic}</p>}
      </div>
      {!past && !cancelled && (
        <div className="flex shrink-0 gap-1.5">
          {b.meetingCode && (
            <Button asChild size="sm" variant="primary">
              <Link href={`${base}/meet/${b.meetingCode}`}>
                <Video />
                Join
              </Link>
            </Button>
          )}
          <Button
            size="sm"
            variant="danger-ghost"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await post(`${api}/office-hours/bookings/${b.id}/cancel`)
                toast.success('Cancelled, they got a notification')
                refresh()
              } catch (e) {
                toast.error(errorMessage(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

function HoursTab() {
  const hours = useMyHours(true)
  const [editing, setEditing] = useState<OfficeHour | 'new' | null>(null)
  if (hours.isLoading) return <Skeleton className="h-48" />
  const list = hours.data ?? []
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center">
        <p className="mr-auto text-[13px] text-fg-muted">
          Students can book these times for the next two weeks.
        </p>
        <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
          <Plus />
          Add a time
        </Button>
      </div>
      {!list.length ? (
        <EmptyState
          emoji="🍎"
          title="You havent set any office hours"
          description="Add a weekly time, like Tuesdays after school, and students can book a slot in it."
        />
      ) : (
        list.map((h) => (
          <div
            key={h.id}
            className={cn(
              'flex items-center gap-3 rounded-lg border border-border p-3',
              !h.active && 'opacity-60',
            )}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-bg-muted text-xs font-semibold">
              {WEEKDAYS[h.weekday]!.slice(0, 3)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">
                {twelveHour(h.startTime)} to {twelveHour(h.endTime)}
                <span className="ml-2 text-xs font-normal text-fg-muted">
                  {h.slotMinutes} min slots
                </span>
              </p>
              <p className="truncate text-xs text-fg-muted">
                {[
                  h.online ? 'Online' : h.location,
                  !h.active && 'paused',
                  h.skipDates.length &&
                    `skipping ${h.skipDates.length} day${h.skipDates.length > 1 ? 's' : ''}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(h)}>
              <Pencil />
              Edit
            </Button>
          </div>
        ))
      )}
      {editing && (
        <HourDialog hour={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function HourDialog({ hour, onClose }: { hour: OfficeHour | null; onClose: () => void }) {
  const { api } = useOrgContext()
  const refresh = useRefreshSchool()
  const [weekday, setWeekday] = useState(hour?.weekday ?? 2)
  const [startTime, setStart] = useState(hour?.startTime ?? '15:15')
  const [endTime, setEnd] = useState(hour?.endTime ?? '16:00')
  const [slotMinutes, setSlot] = useState(hour?.slotMinutes ?? 15)
  const [location, setLocation] = useState(hour?.location ?? '')
  const [online, setOnline] = useState(hour?.online ?? false)
  const [note, setNote] = useState(hour?.note ?? '')
  const [active, setActive] = useState(hour?.active ?? true)
  const [skipDates, setSkip] = useState<string[]>(hour?.skipDates ?? [])
  const [skipPick, setSkipPick] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (skipPick && !skipDates.includes(skipPick)) setSkip([...skipDates, skipPick].sort())
    setSkipPick('')
  }, [skipPick, skipDates])

  const save = async () => {
    setBusy(true)
    const today = dayKey(new Date())
    const body = {
      weekday,
      startTime,
      endTime,
      slotMinutes,
      location: location.trim(),
      online,
      note: note.trim(),
      active,
      skipDates: skipDates.filter((d) => d >= today),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
    try {
      if (hour) await patch(`${api}/office-hours/${hour.id}`, body)
      else await post(`${api}/office-hours`, body)
      toast.success('Saved')
      refresh()
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={hour ? 'Edit office hours' : 'Add office hours'}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Day">
              {(p) => (
                <Select {...p} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="From">
              {(p) => (
                <Input
                  {...p}
                  type="time"
                  value={startTime}
                  onChange={(e) => setStart(e.target.value)}
                />
              )}
            </Field>
            <Field label="Until">
              {(p) => (
                <Input
                  {...p}
                  type="time"
                  value={endTime}
                  onChange={(e) => setEnd(e.target.value)}
                />
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Each slot">
              {(p) => (
                <Select
                  {...p}
                  value={slotMinutes}
                  onChange={(e) => setSlot(Number(e.target.value))}
                >
                  {[5, 10, 15, 20, 30, 45, 60].map((m) => (
                    <option key={m} value={m}>
                      {m} minutes
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Room">
              {(p) => (
                <Input
                  {...p}
                  value={location}
                  maxLength={120}
                  disabled={online}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Room 204"
                />
              )}
            </Field>
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <Switch id="sw-online" checked={online} onCheckedChange={setOnline} />
            <label htmlFor="sw-online">Online (each booking gets a video meeting)</label>
          </div>
          <Field label="Note for students (optional)">
            {(p) => (
              <Textarea
                {...p}
                rows={2}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Bring your notebook"
              />
            )}
          </Field>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">Skip these days</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {skipDates.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSkip(skipDates.filter((x) => x !== d))}
                  className="rounded-full bg-bg-muted px-2.5 py-1 text-xs hover:line-through"
                  title="Remove"
                >
                  {new Date(`${d}T12:00`).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}{' '}
                  ×
                </button>
              ))}
              <Input
                type="date"
                className="h-8 w-40"
                value={skipPick}
                min={dayKey(new Date())}
                onChange={(e) => setSkipPick(e.target.value)}
                aria-label="Add a day to skip"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <Switch id="sw-active" checked={active} onCheckedChange={setActive} />
            <label htmlFor="sw-active">Taking bookings</label>
          </div>
          <DialogFooter>
            {hour && (
              <Button
                type="button"
                variant="danger-ghost"
                className="mr-auto"
                onClick={async () => {
                  try {
                    const r = await del<{ cancelled: number }>(`${api}/office-hours/${hour.id}`)
                    toast.success(
                      r.cancelled
                        ? `Removed, ${r.cancelled} booking${r.cancelled > 1 ? 's were' : ' was'} cancelled`
                        : 'Removed',
                    )
                    refresh()
                    onClose()
                  } catch (e) {
                    toast.error(errorMessage(e))
                  }
                }}
              >
                <Trash2 />
                Remove
              </Button>
            )}
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function OfficeHoursPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  )
}

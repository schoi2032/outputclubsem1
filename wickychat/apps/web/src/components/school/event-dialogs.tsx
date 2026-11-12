'use client'
import type { CalendarEvent, CalendarEventKind, CalendarItem } from '@quid/shared'
import {
  Avatar,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Select,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from '@quid/ui'
import { CheckCircle2, Circle, Hash, MapPin, Video } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { del, errorMessage, patch, post } from '@/lib/api'
import { isTeacherRole, longDay, timeOf, useProgress, useRefreshSchool } from '@/lib/calendar-data'
import { displayName } from '@/lib/format'
import { useChannels } from '@/lib/queries'

export const KIND_STYLE: Record<string, { label: string; chip: string; dot: string }> = {
  homework: { label: 'Homework', chip: 'bg-warning/15 text-warning', dot: 'bg-warning' },
  test: { label: 'Test', chip: 'bg-danger/12 text-danger', dot: 'bg-danger' },
  event: { label: 'Class event', chip: 'bg-accent-subtle text-accent-text', dot: 'bg-accent' },
  personal: { label: 'Personal', chip: 'bg-bg-muted text-fg', dot: 'bg-fg-subtle' },
  task: { label: 'Task', chip: 'bg-success/12 text-success', dot: 'bg-success' },
  meeting: {
    label: 'Meeting',
    chip: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  booking: {
    label: 'Office hours',
    chip: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
}

export function itemKind(i: CalendarItem) {
  return i.type === 'event' ? i.event.kind : i.type
}

export function itemTitle(i: CalendarItem, meId: string) {
  if (i.type === 'event') return i.event.title
  if (i.type === 'task') return i.task.title
  if (i.type === 'meeting') return i.title
  return i.booking.student.id === meId
    ? `Office hours: ${displayName(i.booking.teacher)}`
    : `${displayName(i.booking.student)} (office hours)`
}

export function itemDone(i: CalendarItem) {
  if (i.type === 'event') return i.event.done
  if (i.type === 'task') return i.task.status === 'done'
  return false
}

const pad = (n: number) => String(n).padStart(2, '0')
const localInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

export function EventDialog({
  open,
  onOpenChange,
  event,
  day,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  event?: CalendarEvent | null
  day?: Date
}) {
  const { api, org } = useOrgContext()
  const teacher = isTeacherRole(org.role)
  const refresh = useRefreshSchool()
  const channels = useChannels(org.id)
  const classes = useMemo(
    () =>
      (channels.data ?? [])
        .filter(
          (c) => (c.kind === 'public' || c.kind === 'private') && c.membership && !c.archivedAt,
        )
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    [channels.data],
  )
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [kind, setKind] = useState<CalendarEventKind>('personal')
  const [channelId, setChannelId] = useState('')
  const [allDay, setAllDay] = useState(false)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const base = day ? new Date(day) : new Date()
    if (!event) {
      base.setHours(day ? 15 : base.getHours() + 1, 0, 0, 0)
    }
    setTitle(event?.title ?? '')
    setNotes(event?.notes ?? '')
    setKind(event?.kind ?? (teacher ? 'homework' : 'personal'))
    setChannelId(event?.channelId ?? '')
    setAllDay(event?.allDay ?? false)
    setStart(localInput(event ? new Date(event.startsAt) : base))
    setEnd(event?.endsAt ? localInput(new Date(event.endsAt)) : '')
  }, [open, event, day, teacher])

  const inClass = !!channelId
  const kinds: CalendarEventKind[] = inClass
    ? ['homework', 'test', 'event']
    : ['personal', 'homework', 'test']
  const fixKind = (k: CalendarEventKind, c: string) =>
    c && k === 'personal' ? 'homework' : !c && k === 'event' ? 'personal' : k

  const submit = async () => {
    setBusy(true)
    const s = allDay ? new Date(`${start.slice(0, 10)}T00:00`) : new Date(start)
    const e = end ? (allDay ? new Date(`${end.slice(0, 10)}T23:59`) : new Date(end)) : null
    const body = {
      title: title.trim(),
      notes,
      kind,
      allDay,
      startsAt: s.toISOString(),
      endsAt: e ? e.toISOString() : null,
    }
    try {
      if (event) await patch(`${api}/calendar/events/${event.id}`, body)
      else await post(`${api}/calendar/events`, { ...body, channelId: channelId || null })
      toast.success(event ? 'Saved' : inClass ? 'Added, the class got a notification' : 'Added')
      refresh()
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const kindLabel = (k: CalendarEventKind) =>
    k === 'personal' ? 'Personal event' : k === 'event' ? 'Class event' : KIND_STYLE[k]!.label

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={event ? 'Edit' : 'Add to calendar'}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (title.trim() && start) void submit()
          }}
        >
          <Field label="Title">
            {(p) => (
              <Input
                {...p}
                autoFocus
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={kind === 'homework' ? 'Chapter 4 questions' : 'What is it?'}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {teacher && !event && (
              <Field label="Where">
                {(p) => (
                  <Select
                    {...p}
                    value={channelId}
                    onChange={(e) => {
                      setChannelId(e.target.value)
                      setKind(fixKind(kind, e.target.value))
                    }}
                  >
                    <option value="">Just me</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        #{c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Type">
              {(p) => (
                <Select
                  {...p}
                  value={kind}
                  onChange={(e) => setKind(e.target.value as CalendarEventKind)}
                >
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <Switch id="sw-allDay" checked={allDay} onCheckedChange={setAllDay} />
            <label htmlFor="sw-allDay">All day</label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={kind === 'homework' ? 'Due' : 'Starts'}>
              {(p) => (
                <Input
                  {...p}
                  type={allDay ? 'date' : 'datetime-local'}
                  value={allDay ? start.slice(0, 10) : start}
                  onChange={(e) => setStart(allDay ? `${e.target.value}T00:00` : e.target.value)}
                />
              )}
            </Field>
            {kind !== 'homework' && (
              <Field label="Ends (optional)">
                {(p) => (
                  <Input
                    {...p}
                    type={allDay ? 'date' : 'datetime-local'}
                    value={allDay ? end.slice(0, 10) : end}
                    onChange={(e) =>
                      setEnd(allDay && e.target.value ? `${e.target.value}T00:00` : e.target.value)
                    }
                  />
                )}
              </Field>
            )}
          </div>
          <Field label="Notes">
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                value={notes}
                maxLength={4000}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={inClass ? 'Instructions, pages, links' : 'Anything to remember'}
              />
            )}
          </Field>
          {inClass && !event && (
            <p className="text-xs text-fg-subtle">
              Everyone in this channel will see it on there calendar and get a reminder before it.
            </p>
          )}
          <DialogFooter>
            {event && (
              <Button
                type="button"
                variant="danger-ghost"
                className="mr-auto"
                onClick={async () => {
                  try {
                    await del(`${api}/calendar/events/${event.id}`)
                    refresh()
                    onOpenChange(false)
                  } catch (err) {
                    toast.error(errorMessage(err))
                  }
                }}
              >
                Delete
              </Button>
            )}
            <Button type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={!title.trim() || !start}
            >
              {event ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Progress({ eventId }: { eventId: string }) {
  const q = useProgress(eventId)
  if (q.isLoading) return <Skeleton className="h-24" />
  const list = q.data ?? []
  if (!list.length)
    return <p className="text-xs text-fg-subtle">No students in this channel yet.</p>
  const missing = list.filter((x) => !x.doneAt)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase text-fg-subtle">
        {list.length - missing.length}/{list.length} done
      </p>
      <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
        {list.map((x) => (
          <li key={x.user.id} className="flex items-center gap-2 text-[13px]">
            <Avatar
              name={x.user.name}
              id={x.user.id}
              src={x.user.avatarUrl}
              decoration={x.user.decoration}
              size="xs"
            />
            <span className={cn('flex-1 truncate', x.doneAt && 'text-fg-muted')}>
              {displayName(x.user)}
            </span>
            {x.doneAt ? (
              <CheckCircle2 className="size-4 text-success" />
            ) : (
              <span className="text-xs text-fg-subtle">not yet</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ItemDialog({
  item,
  onOpenChange,
  onEdit,
}: {
  item: CalendarItem | null
  onOpenChange: (o: boolean) => void
  onEdit: (e: CalendarEvent) => void
}) {
  const { api, base, me } = useOrgContext()
  const refresh = useRefreshSchool()
  const [busy, setBusy] = useState(false)
  if (!item) return null
  const kind = itemKind(item)
  const style = KIND_STYLE[kind]!
  const start = new Date(item.startsAt)
  const allDay = item.type === 'event' && item.event.allDay
  const when = allDay
    ? longDay(start)
    : `${longDay(start)}, ${timeOf(item.startsAt)}${item.endsAt ? ` to ${timeOf(item.endsAt)}` : ''}`

  const toggle = async (done: boolean) => {
    if (item.type !== 'event') return
    setBusy(true)
    try {
      await post(`${api}/calendar/events/${item.event.id}/done`, { done })
      refresh()
      onOpenChange(false)
      if (done) toast.success('Nice, checked off')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent title={itemTitle(item, me.id)} description={when}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded px-1.5 py-0.5 text-[11.5px] font-medium', style.chip)}>
              {style.label}
            </span>
            {item.type === 'event' && item.event.channelName && (
              <Link
                href={`${base}/c/${item.event.channelId}`}
                className="inline-flex items-center gap-0.5 text-[13px] text-fg-muted hover:underline"
              >
                <Hash className="size-3.5" />
                {item.event.channelName}
              </Link>
            )}
            {item.type === 'event' && item.event.createdBy && item.event.channelId && (
              <span className="text-[13px] text-fg-subtle">
                from {displayName(item.event.createdBy)}
              </span>
            )}
          </div>

          {item.type === 'event' && item.event.notes && (
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{item.event.notes}</p>
          )}
          {item.type === 'task' && (
            <p className="text-[13px] text-fg-muted">
              A task in #{item.task.channelName}.{' '}
              <Link href={`${base}/tasks`} className="text-accent-text hover:underline">
                Open my tasks
              </Link>
            </p>
          )}
          {item.type === 'booking' && (
            <div className="flex flex-col gap-1.5 text-[13px]">
              {item.booking.topic && <p className="text-[14px]">{item.booking.topic}</p>}
              {item.booking.location && (
                <p className="inline-flex items-center gap-1 text-fg-muted">
                  <MapPin className="size-3.5" />
                  {item.booking.location}
                </p>
              )}
              <Link
                href={`${base}/office-hours?tab=bookings`}
                className="text-accent-text hover:underline"
              >
                See my bookings
              </Link>
            </div>
          )}

          {item.type === 'event' && item.event.doneCount !== null && (
            <Progress eventId={item.event.id} />
          )}

          <DialogFooter>
            {item.type === 'event' && item.event.canEdit && (
              <Button type="button" className="mr-auto" onClick={() => onEdit(item.event)}>
                Edit
              </Button>
            )}
            {(item.type === 'meeting' || (item.type === 'booking' && item.booking.meetingCode)) && (
              <Button asChild variant="primary">
                <Link
                  href={`${base}/meet/${item.type === 'meeting' ? item.code : item.booking.meetingCode}`}
                >
                  <Video />
                  Join
                </Link>
              </Button>
            )}
            {item.type === 'event' &&
              (item.event.kind === 'homework' || item.event.kind === 'test') &&
              item.event.doneCount === null &&
              (item.event.done ? (
                <Button type="button" loading={busy} onClick={() => toggle(false)}>
                  <Circle />
                  Mark not done
                </Button>
              ) : (
                <Button type="button" variant="primary" loading={busy} onClick={() => toggle(true)}>
                  <CheckCircle2 />
                  {item.event.kind === 'test' ? 'I studied' : 'Mark done'}
                </Button>
              ))}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

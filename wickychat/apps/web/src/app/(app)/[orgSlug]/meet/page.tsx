'use client'
import type { Meeting } from '@quid/shared'
import { Avatar, Badge, Button, EmptyState, Input, Skeleton, toast } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { CalendarPlus, Keyboard, Video } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useCalls } from '@/components/calls/call-provider'
import { MeetingActions } from '@/components/meet/meeting-actions'
import { MeetingCalendar } from '@/components/meet/meeting-calendar'
import { ScheduleDialog } from '@/components/meet/schedule-dialog'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { errorMessage, get, post } from '@/lib/api'
import { displayName, formatTime, relative } from '@/lib/format'

type Lists = { live: Meeting[]; upcoming: Meeting[]; past: Meeting[] }

function when(m: Meeting) {
  if (!m.scheduledFor) return 'Instant meeting'
  const d = new Date(m.scheduledFor)
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${formatTime(m.scheduledFor)} · ${m.durationMinutes} min`
}

function MeetingRow({ m, action }: { m: Meeting; action: React.ReactNode }) {
  const { base } = useOrgContext()
  const people = m.participants.filter((p) => p.status !== 'denied' && p.status !== 'removed')
  return (
    <li className="flex items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <Link
          href={`${base}/meet/${m.code}`}
          className="block truncate text-[14px] font-medium hover:underline"
        >
          {m.title}
        </Link>
        <p className="truncate text-xs text-fg-subtle">
          {m.status === 'ended' && m.endedAt ? `Ended ${relative(m.endedAt)}` : when(m)} · hosted by{' '}
          {m.host ? displayName(m.host) : 'someone'}
        </p>
      </div>
      <span className="hidden -space-x-1 sm:flex">
        {people.slice(0, 4).map((p) => (
          <Avatar
            key={p.user.id}
            name={p.user.name}
            id={p.user.id}
            src={p.user.avatarUrl}
            decoration={p.user.decoration}
            size="xs"
            className="ring-2 ring-bg"
          />
        ))}
      </span>
      {action}
      <MeetingActions m={m} />
    </li>
  )
}

export default function MeetPage() {
  const { org, api, base } = useOrgContext()
  const router = useRouter()
  const calls = useCalls()
  const lists = useQuery({
    queryKey: ['meetings', org.id],
    queryFn: ({ signal }) => get<Lists>(`${api}/meetings`, signal),
  })
  const [code, setCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const available = calls.available

  const startNow = async () => {
    setCreating(true)
    try {
      const m = await post<Meeting>(`${api}/meetings`, {
        title: 'Instant meeting',
        waitingRoom: true,
      })
      router.push(`${base}/meet/${m.code}`)
    } catch (e) {
      toast.error(errorMessage(e))
      setCreating(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Meet" icon={<Video />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-4 md:p-8">
          {!available && (
            <div className="mb-6 rounded-lg border border-warning/40 bg-warning/10 p-3 text-[13px]">
              Meetings aren't configured on this server yet. An administrator needs to set up
              LiveKit (see docs/DEPLOYMENT.md).
            </div>
          )}
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            Video meetings for {org.name}
          </h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            Start a meeting now, schedule one, or join with a code.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="lg"
              loading={creating}
              disabled={!available || org.role === 'guest'}
              onClick={startNow}
            >
              <Video /> New meeting
            </Button>
            <Button
              size="lg"
              disabled={!available || org.role === 'guest'}
              onClick={() => setScheduleOpen(true)}
            >
              <CalendarPlus /> Schedule
            </Button>
            <form
              className="flex flex-1 items-center gap-2 sm:ml-4"
              onSubmit={(e) => {
                e.preventDefault()
                const c = code.trim().toLowerCase().split('/').pop()
                if (c) router.push(`${base}/meet/${c}`)
              }}
            >
              <div className="relative min-w-40 flex-1">
                <Keyboard className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
                <Input
                  className="h-10 pl-8"
                  placeholder="Enter a code or link"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  aria-label="Meeting code"
                />
              </div>
              <Button type="submit" variant="ghost" size="lg" disabled={!code.trim()}>
                Join
              </Button>
            </form>
          </div>

          <div className="mt-10 mb-4 flex gap-1">
            {(['list', 'calendar'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`h-7 rounded-md px-2.5 text-[13px] font-medium capitalize ${view === v ? 'bg-bg-emphasis text-fg' : 'text-fg-muted hover:bg-bg-muted'}`}
              >
                {v}
              </button>
            ))}
          </div>
          {view === 'calendar' && lists.data ? (
            <MeetingCalendar
              meetings={[...lists.data.live, ...lists.data.upcoming, ...lists.data.past]}
            />
          ) : lists.isLoading ? (
            <Skeleton className="mt-10 h-40" />
          ) : (
            <div className="flex flex-col gap-8">
              {!!lists.data?.live.length && (
                <section>
                  <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold text-fg-subtle uppercase">
                    <span className="size-2 animate-pulse rounded-full bg-success" /> Live now
                  </h2>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {lists.data.live.map((m) => (
                      <MeetingRow
                        key={m.id}
                        m={m}
                        action={
                          <Button size="sm" variant="primary" asChild>
                            <Link href={`${base}/meet/${m.code}`}>Join</Link>
                          </Button>
                        }
                      />
                    ))}
                  </ul>
                </section>
              )}
              <section>
                <h2 className="mb-2 text-xs font-semibold text-fg-subtle uppercase">Upcoming</h2>
                {lists.data?.upcoming.length ? (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {lists.data.upcoming.map((m) => (
                      <MeetingRow
                        key={m.id}
                        m={m}
                        action={
                          <Button size="sm" asChild>
                            <Link href={`${base}/meet/${m.code}`}>Open</Link>
                          </Button>
                        }
                      />
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    className="rounded-lg border border-dashed border-border py-8"
                    emoji="📅"
                    title="Your calendar’s wide open"
                    description="Meetings you host or get invited to will show up here."
                  />
                )}
              </section>
              {!!lists.data?.past.length && (
                <section>
                  <h2 className="mb-2 text-xs font-semibold text-fg-subtle uppercase">History</h2>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {lists.data.past.map((m) => (
                      <MeetingRow
                        key={m.id}
                        m={m}
                        action={
                          <Badge>{m.participants.filter((p) => p.joinedAt).length} attended</Badge>
                        }
                      />
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
          <p className="mt-10 rounded-lg border border-border bg-bg-subtle p-3 text-xs text-fg-muted">
            <Badge tone="accent" className="mr-1.5">
              Coming later
            </Badge>
            Breakout rooms and large town halls are on the way.
          </p>
        </div>
      </div>
      <ScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} />
    </div>
  )
}

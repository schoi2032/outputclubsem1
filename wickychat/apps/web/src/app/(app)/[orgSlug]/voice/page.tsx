'use client'
import type { Call } from '@quid/shared'
import { Avatar, Badge, Button, cn, EmptyState, Skeleton } from '@quid/ui'
import { useInfiniteQuery } from '@tanstack/react-query'
import {
  Headphones,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
} from 'lucide-react'
import Link from 'next/link'
import { useCalls } from '@/components/calls/call-provider'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { useVoiceRooms } from '@/components/voice-rooms/voice-room-provider'
import { get } from '@/lib/api'
import { channelTitle } from '@/lib/channels'
import { dayLabel, displayName, formatTime, sameDay } from '@/lib/format'
import { useChannels } from '@/lib/queries'

function duration(c: Call) {
  if (!c.answeredAt || !c.endedAt) return null
  const s = Math.round((new Date(c.endedAt).getTime() - new Date(c.answeredAt).getTime()) / 1000)
  const m = Math.floor(s / 60)
  return m ? `${m}m ${s % 60}s` : `${s}s`
}

export default function VoicePage() {
  const { org, api, me, base } = useOrgContext()
  const calls = useCalls()
  const rooms = useVoiceRooms()
  const channels = useChannels(org.id)
  const history = useInfiniteQuery({
    queryKey: ['calls-history', org.id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      get<{ calls: Call[]; nextCursor: string | null }>(
        `${api}/calls?limit=50${pageParam ? `&before=${pageParam}` : ''}`,
        signal,
      ),
    getNextPageParam: (p) => p.nextCursor,
  })
  const list =
    history.data?.pages
      .flatMap((p) => p.calls)
      .filter((c) => c.status !== 'ringing' && c.status !== 'active') ?? []
  const name = (c: Call) => {
    const ch = channels.data?.find((x) => x.id === c.channelId)
    if (!ch) return 'Conversation'
    return ch.kind === 'public' || ch.kind === 'private' ? `#${ch.name}` : channelTitle(ch, me.id)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Voice" icon={<Headphones />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-4 md:p-6">
          {!calls.available && (
            <div className="mb-6 rounded-lg border border-warning/40 bg-warning/10 p-3 text-[13px]">
              Voice calls aren't configured on this server yet. An administrator needs to set the
              LiveKit connection (see docs/DEPLOYMENT.md).
            </div>
          )}

          <section className="mb-8">
            <h2 className="mb-2 text-xs font-semibold text-fg-subtle uppercase">Happening now</h2>
            {calls.activeCalls.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-[13px] text-fg-muted">
                No calls right now. Start one with the <Phone className="inline size-3.5" /> button
                in any conversation or channel.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {calls.activeCalls.map((c) => {
                  const joined = c.participants.filter((p) => p.status === 'joined')
                  const mine = calls.current?.call.id === c.id
                  return (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 rounded-lg border border-border p-3"
                    >
                      <span className="size-2 animate-pulse rounded-full bg-success" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">{name(c)}</p>
                        <p className="text-xs text-fg-subtle">
                          {joined.length} in call · started by{' '}
                          {c.startedBy ? displayName(c.startedBy) : 'someone'}
                        </p>
                      </div>
                      <span className="flex -space-x-1">
                        {joined.slice(0, 5).map((p) => (
                          <Avatar
                            key={p.user.id}
                            name={p.user.name}
                            id={p.user.id}
                            src={p.user.avatarUrl}
                            decoration={p.user.decoration}
                            size="sm"
                            className="ring-2 ring-bg"
                          />
                        ))}
                      </span>
                      {mine ? (
                        <Badge tone="success">You're here</Badge>
                      ) : (
                        <Button size="sm" variant="primary" onClick={() => void calls.join(c.id)}>
                          Join
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-xs font-semibold text-fg-subtle uppercase">Recent calls</h2>
            {history.isLoading ? (
              <Skeleton className="h-40" />
            ) : list.length === 0 ? (
              <EmptyState
                emoji="📞"
                title="No calls yet"
                description="Your call history will show up here once you start talking."
              />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {list.map((c, i) => {
                  const outgoing = c.startedBy?.id === me.id
                  const missed = c.status === 'missed' || c.status === 'rejected'
                  const Icon = missed
                    ? outgoing
                      ? PhoneOff
                      : PhoneMissed
                    : outgoing
                      ? PhoneOutgoing
                      : PhoneIncoming
                  const showDay = i === 0 || !sameDay(list[i - 1]!.createdAt, c.createdAt)
                  const others = c.participants.filter((p) => p.user.id !== me.id)
                  return (
                    <li key={c.id}>
                      {showDay && (
                        <p className="bg-bg-subtle px-3 py-1 text-2xs font-medium text-fg-subtle">
                          {dayLabel(c.createdAt)}
                        </p>
                      )}
                      <Link
                        href={c.channelId ? `${base}/c/${c.channelId}` : base}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-bg-subtle"
                      >
                        <Icon
                          className={cn(
                            'size-4 shrink-0',
                            missed ? 'text-danger' : 'text-fg-subtle',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              'truncate text-[13.5px] font-medium',
                              missed && 'text-danger',
                            )}
                          >
                            {name(c)}
                          </p>
                          <p className="truncate text-xs text-fg-subtle">
                            {c.status === 'missed'
                              ? outgoing
                                ? 'No answer'
                                : 'Missed call'
                              : c.status === 'rejected'
                                ? 'Declined'
                                : `${outgoing ? 'Outgoing' : 'Incoming'} · ${duration(c) ?? ''}`}
                            {others.length > 1 && ` · ${others.length} people`}
                          </p>
                        </div>
                        <span className="text-xs text-fg-subtle tabular-nums">
                          {formatTime(c.createdAt)}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
            {history.hasNextPage && (
              <div className="mt-4 flex justify-center">
                <Button
                  size="sm"
                  loading={history.isFetchingNextPage}
                  onClick={() => history.fetchNextPage()}
                >
                  Load more
                </Button>
              </div>
            )}
          </section>

          <section className="mt-8">
            <h2 className="mb-2 text-xs font-semibold text-fg-subtle uppercase">Voice rooms</h2>
            {rooms.activeRooms.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-[13px] text-fg-muted">
                Every channel has a voice room people can drop into, with no ringing. Open one with
                the <Headphones className="inline size-3.5" /> button in a channel header.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {rooms.activeRooms.map((r) => {
                  const here = rooms.session?.room.id === r.id
                  return (
                    <li
                      key={r.id}
                      className="flex items-center gap-3 rounded-lg border border-border p-3"
                    >
                      <Headphones className="size-4 text-success" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">{r.name}</p>
                        <p className="text-xs text-fg-subtle">
                          {r.participants.length} in the room{r.mode === 'stage' ? ' · Stage' : ''}
                        </p>
                      </div>
                      <span className="flex -space-x-1">
                        {r.participants.slice(0, 5).map((p) => (
                          <Avatar
                            key={p.user.id}
                            name={p.user.name}
                            id={p.user.id}
                            src={p.user.avatarUrl}
                            decoration={p.user.decoration}
                            size="sm"
                            className="ring-2 ring-bg"
                          />
                        ))}
                      </span>
                      {here ? (
                        <Badge tone="success">You're here</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => void rooms.join(r.channelId)}
                        >
                          Join
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

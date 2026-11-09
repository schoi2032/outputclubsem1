'use client'
import type { Notification } from '@quid/shared'
import { Avatar, Button, cn, EmptyState, Skeleton } from '@quid/ui'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlarmClock,
  AtSign,
  Bell,
  CalendarClock,
  CheckCheck,
  ListTodo,
  Megaphone,
  MessageSquareText,
  MessagesSquare,
  Phone,
  PhoneMissed,
  Video,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { get, post } from '@/lib/api'
import { dayLabel, relative, sameDay } from '@/lib/format'
import { keys, type NotificationPage } from '@/lib/queries'

const FILTERS = [
  ['all', 'All'],
  ['mentions', 'Mentions'],
  ['threads', 'Threads'],
  ['direct', 'Direct messages'],
] as const

function kindIcon(n: Notification) {
  if (n.kind === 'mention') return AtSign
  if (n.kind === 'thread_reply') return MessageSquareText
  if (n.kind === 'announcement') return Megaphone
  if (n.kind === 'direct_message') return MessagesSquare
  if (n.kind === 'missed_call') return PhoneMissed
  if (n.kind === 'incoming_call') return Phone
  if (n.kind === 'meeting_invite') return Video
  if (n.kind === 'task_assigned') return ListTodo
  if (n.kind === 'task_due') return CalendarClock
  if (n.kind === 'reminder') return AlarmClock
  return Bell
}

/** Collapses consecutive notifications from the same conversation/thread into one row. */
function group(list: Notification[]) {
  const out: { head: Notification; count: number; unread: boolean; ids: string[] }[] = []
  for (const n of list) {
    const last = out[out.length - 1]
    if (
      last &&
      last.head.groupKey === n.groupKey &&
      n.kind !== 'announcement' &&
      sameDay(last.head.createdAt, n.createdAt)
    ) {
      last.count++
      last.ids.push(n.id)
      last.unread ||= !n.readAt
    } else out.push({ head: n, count: 1, unread: !n.readAt, ids: [n.id] })
  }
  return out
}

export default function ActivityPage() {
  const { org, api, base } = useOrgContext()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all')
  const q = useInfiniteQuery({
    queryKey: keys.notifications(org.id, filter),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      get<NotificationPage>(
        `${api}/notifications?kind=${filter}&limit=50${pageParam ? `&before=${pageParam}` : ''}`,
        signal,
      ),
    getNextPageParam: (p) => p.nextCursor,
  })
  const items = group(q.data?.pages.flatMap((p) => p.notifications) ?? [])

  const markRead = async (body: Record<string, unknown>) => {
    await post(`${api}/notifications/read`, body).catch(() => {})
    void qc.invalidateQueries({ queryKey: ['notifications', org.id] })
    void qc.invalidateQueries({ queryKey: keys.unread(org.id) })
  }

  const href = (n: Notification) => {
    if (n.link) return n.link
    if (!n.channelId) return null
    if (n.threadId) return `${base}/c/${n.channelId}?thread=${n.threadId}`
    return `${base}/c/${n.channelId}${n.messageId ? `?m=${n.messageId}` : ''}`
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Activity"
        icon={<Bell />}
        actions={
          <Button size="sm" variant="ghost" onClick={() => markRead({ all: true })}>
            <CheckCheck /> Mark all read
          </Button>
        }
      >
        <nav className="flex gap-1 px-3 pb-2 md:px-6">
          {FILTERS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={cn(
                'h-7 rounded-md px-2.5 text-[13px] font-medium text-fg-muted hover:bg-bg-muted',
                filter === k && 'bg-bg-emphasis text-fg',
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {q.isLoading ? (
          <div className="space-y-4 p-6">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            emoji="🎉"
            title="You’re all caught up"
            description="Mentions, replies to your threads, DMs and announcements will land here. Enjoy the quiet."
          />
        ) : (
          <ul className="mx-auto max-w-3xl py-2">
            {items.map(({ head: n, count, unread, ids }, i) => {
              const Icon = kindIcon(n)
              const link = href(n)
              const showDay = i === 0 || !sameDay(items[i - 1]!.head.createdAt, n.createdAt)
              const body = (
                <div
                  className={cn(
                    'flex gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-bg-subtle',
                    unread && 'bg-accent-subtle/40',
                  )}
                >
                  <span className="relative">
                    {n.actor ? (
                      <Avatar
                        name={n.actor.name}
                        id={n.actor.id}
                        src={n.actor.avatarUrl}
                        size="md"
                      />
                    ) : (
                      <span className="flex size-8 items-center justify-center rounded-md bg-bg-muted">
                        <Icon className="size-4" />
                      </span>
                    )}
                    <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-bg text-fg-muted ring-1 ring-border">
                      <Icon className="size-2.5" />
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px]">
                      <span className={cn(unread && 'font-semibold')}>{n.title}</span>
                      {count > 1 && <span className="text-fg-subtle"> · {count} new</span>}
                    </p>
                    {n.preview && (
                      <p className="mt-0.5 line-clamp-2 text-[13px] text-fg-muted">{n.preview}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-fg-subtle">{relative(n.createdAt)}</span>
                  {unread && (
                    <span
                      className="mt-1.5 size-2 shrink-0 rounded-full bg-accent"
                      role="img"
                      aria-label="Unread"
                    />
                  )}
                </div>
              )
              return (
                <li key={n.id} className="px-3">
                  {showDay && (
                    <p className="px-3 pt-4 pb-1 text-xs font-medium text-fg-subtle">
                      {dayLabel(n.createdAt)}
                    </p>
                  )}
                  {link ? (
                    <Link href={link} onClick={() => unread && void markRead({ ids })}>
                      {body}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => unread && void markRead({ ids })}
                    >
                      {body}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {q.hasNextPage && (
          <div className="flex justify-center pb-6">
            <Button size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

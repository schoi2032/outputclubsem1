'use client'
import type { ModerationEvent, ModerationOffender } from '@quid/shared'
import { Avatar, Button, cn, EmptyState, Skeleton } from '@quid/ui'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ShieldAlert, X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { SettingsTitle } from '@/components/settings-ui'
import { errorMessage, get } from '@/lib/api'
import { displayName, formatFull, relative } from '@/lib/format'

type Range = '7d' | '30d' | 'all'
const RANGES: { value: Range; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
]

const SOURCE_LABEL: Record<ModerationEvent['source'], string> = {
  message: 'Message',
  edit: 'Edited message',
  scheduled: 'Scheduled message',
}

/** Shows the original text with the caught words highlighted. */
function Highlighted({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(${[...new Set(words)].map(esc).join('|')})`, 'gi')
  const lower = new Set(words.map((w) => w.toLowerCase()))
  return (
    <>
      {text.split(re).map((part, i) =>
        lower.has(part.toLowerCase()) ? (
          <mark key={i} className="rounded bg-danger/15 px-0.5 font-medium text-danger">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

function where(e: ModerationEvent) {
  if (!e.channel) return 'a deleted chat'
  if (e.channel.kind === 'dm') return 'a direct message'
  if (e.channel.kind === 'group') return 'a group chat'
  return `#${e.channel.name}`
}

export default function ModerationSettings() {
  const { org, api, base } = useOrgContext()
  const [range, setRange] = useState<Range>('30d')
  const [person, setPerson] = useState<ModerationOffender['user'] | null>(null)

  const offenders = useQuery({
    queryKey: ['moderation-offenders', org.id, range],
    queryFn: ({ signal }) =>
      get<{ offenders: ModerationOffender[] }>(
        `${api}/moderation/offenders?range=${range}`,
        signal,
      ),
  })

  const events = useInfiniteQuery({
    queryKey: ['moderation-events', org.id, person?.id ?? null],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      get<{ events: ModerationEvent[]; nextCursor: string | null }>(
        `${api}/moderation/events?limit=30${person ? `&userId=${person.id}` : ''}${pageParam ? `&before=${pageParam}` : ''}`,
        signal,
      ),
    getNextPageParam: (p) => p.nextCursor,
  })
  const list = events.data?.pages.flatMap((p) => p.events) ?? []
  const rows = offenders.data?.offenders ?? []

  return (
    <>
      <SettingsTitle
        title="Rule breakers"
        description="Everyone the swear filter caught. Students never see their swears, since they're replaced with *** for everyone, but every attempt is logged here so teachers can follow up."
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Most caught</h2>
        <div className="flex gap-1 rounded-lg border border-border p-0.5" role="tablist">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              role="tab"
              aria-selected={range === r.value}
              onClick={() => setRange(r.value)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs',
                range === r.value
                  ? 'bg-bg-muted font-medium text-fg'
                  : 'text-fg-muted hover:text-fg',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {offenders.isError ? (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
          Couldn't load the rule breakers log: {errorMessage(offenders.error)}
        </p>
      ) : offenders.isLoading ? (
        <Skeleton className="h-40" />
      ) : !rows.length ? (
        <EmptyState
          icon={<ShieldAlert />}
          title="Nobody's been caught"
          description="When the swear filter hides something, the person shows up here."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border text-2xs text-fg-subtle uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 text-right font-medium">Times caught</th>
                <th className="px-3 py-2 text-right font-medium">Words hidden</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">Top words</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">Last time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((o, i) => (
                <tr
                  key={o.user.id}
                  onClick={() => setPerson(o.user)}
                  className={cn(
                    'cursor-pointer hover:bg-bg-subtle',
                    person?.id === o.user.id && 'bg-bg-subtle',
                  )}
                >
                  <td className="px-3 py-2 text-fg-subtle tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={o.user.name} id={o.user.id} src={o.user.avatarUrl} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{displayName(o.user)}</p>
                        <p className="truncate text-2xs text-fg-subtle">{o.user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{o.incidents}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{o.words}</td>
                  <td className="hidden px-3 py-2 font-mono text-xs text-fg-muted sm:table-cell">
                    {o.topWords.join(', ')}
                  </td>
                  <td className="hidden px-3 py-2 text-xs text-fg-subtle sm:table-cell">
                    {relative(o.lastAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">
          {person ? `Incidents by ${displayName(person)}` : 'All incidents'}
        </h2>
        {person && (
          <Button size="sm" variant="ghost" onClick={() => setPerson(null)}>
            <X className="size-3.5" /> Show everyone
          </Button>
        )}
      </div>

      {events.isError ? (
        <p className="text-[13px] text-danger">
          Couldn't load incidents: {errorMessage(events.error)}
        </p>
      ) : events.isLoading ? (
        <Skeleton className="h-60" />
      ) : !list.length ? (
        <p className="text-[13px] text-fg-subtle">No incidents yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.map((e) => (
            <li key={e.id} className="flex items-start gap-3 p-3">
              <Avatar name={e.user.name} id={e.user.id} src={e.user.avatarUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px]">
                  <button
                    type="button"
                    className="font-medium hover:underline"
                    onClick={() => setPerson(e.user)}
                  >
                    {displayName(e.user)}
                  </button>{' '}
                  <span className="text-fg-subtle">
                    in {where(e)} · {SOURCE_LABEL[e.source]}
                  </span>
                </p>
                <p className="mt-1 rounded-md bg-bg-subtle px-2 py-1.5 text-[13px] break-words whitespace-pre-wrap">
                  <Highlighted text={e.original} words={e.words} />
                </p>
                {e.channel && e.messageId && e.channel.kind === 'public' && (
                  <Link
                    href={`${base}/c/${e.channel.id}?m=${e.messageId}`}
                    className="mt-1 inline-block text-xs text-accent-text hover:underline"
                  >
                    Open message
                  </Link>
                )}
              </div>
              <span className="shrink-0 text-right text-xs text-fg-subtle">
                {formatFull(e.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {events.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button
            size="sm"
            loading={events.isFetchingNextPage}
            onClick={() => events.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      )}
    </>
  )
}

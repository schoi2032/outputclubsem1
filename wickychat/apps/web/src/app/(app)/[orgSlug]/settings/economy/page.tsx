'use client'
/**
 * WickyChat economy dashboard (teachers): coins in circulation, where they come from and go,
 * top earners and spenders, things that look off, and the latest changes from the data log.
 */
import type { UserSummary } from '@quid/shared'
import { Avatar, cn, Skeleton, Tooltip } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { useOrgContext } from '@/components/org-context'
import { SettingsCard, SettingsTitle } from '@/components/settings-ui'
import { itemName, useCommunity } from '@/components/shop/items'
import { get } from '@/lib/api'
import { displayName, relative } from '@/lib/format'

type Flag = {
  kind: 'coin_sends' | 'big_trade' | 'duel_pair' | 'teacher_reward' | 'busy' | 'fast_earner'
  text: string
  userIds: string[]
  amount: number
}
type Row = { userId: string; value: number }
type Economy = {
  circulation: { total: number; people: number; median: number; top10Share: number }
  daily: { day: string; earned: number; spent: number }[]
  byReason: { reason: string; earned: number; spent: number }[]
  richest: Row[]
  earners: Row[]
  spenders: Row[]
  market: { key: string; supply: number }[]
  flags: Flag[]
  recent: { at: string; tbl: string; op: string; userId: string | null; text: string }[]
  users: Record<string, UserSummary>
}

const n = (v: number) => v.toLocaleString()
const FLAG_ICON: Record<Flag['kind'], string> = {
  coin_sends: '💸',
  big_trade: '🤝',
  duel_pair: '🪙',
  teacher_reward: '🍎',
  busy: '⚡',
  fast_earner: '🚀',
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-[-0.02em] tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
    </div>
  )
}

function Person({ u }: { u?: UserSummary }) {
  if (!u) return <span className="text-fg-subtle">someone</span>
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar name={u.name} id={u.id} src={u.avatarUrl} size="xs" />
      <span className="truncate font-medium">{displayName(u)}</span>
    </span>
  )
}

function FlowChart({ daily }: { daily: Economy['daily'] }) {
  const max = Math.max(1, ...daily.flatMap((d) => [d.earned, d.spent]))
  return (
    <div>
      <div
        className="flex h-36 items-end gap-1"
        role="img"
        aria-label="Coins earned and spent per day"
      >
        {daily.map((d) => (
          <Tooltip key={d.day} content={`${d.day}: +${n(d.earned)} earned, −${n(d.spent)} spent`}>
            <div className="flex h-full flex-1 items-end gap-px">
              <div
                className="w-1/2 rounded-t-sm bg-success/80"
                style={{ height: `${Math.max(1, (d.earned / max) * 100)}%` }}
              />
              <div
                className="w-1/2 rounded-t-sm bg-danger/70"
                style={{ height: `${Math.max(1, (d.spent / max) * 100)}%` }}
              />
            </div>
          </Tooltip>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-2xs text-fg-subtle">
        <span>
          <span className="mr-1 inline-block size-2 rounded-sm bg-success/80" />
          earned
          <span className="mr-1 ml-3 inline-block size-2 rounded-sm bg-danger/70" />
          spent
        </span>
        <span>last 14 days</span>
      </div>
    </div>
  )
}

function Board({
  title,
  rows,
  users,
  sign = '',
}: {
  title: string
  rows: Row[]
  users: Economy['users']
  sign?: string
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 text-xs font-semibold text-fg-subtle uppercase">{title}</p>
      {!rows.length ? (
        <p className="text-[13px] text-fg-subtle">Nobody yet.</p>
      ) : (
        <ol className="flex flex-col gap-1.5 text-[13px]">
          {rows.map((r, i) => (
            <li key={r.userId} className="flex items-center gap-2">
              <span className="w-4 text-fg-subtle tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <Person u={users[r.userId]} />
              </span>
              <span className="font-semibold tabular-nums">
                {sign}🪙 {n(r.value)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export default function EconomyPage() {
  const { org, api } = useOrgContext()
  const community = useCommunity()
  const q = useQuery({
    queryKey: ['economy', org.id],
    queryFn: ({ signal }) => get<Economy>(`${api}/economy`, signal),
    refetchInterval: 60_000,
  })
  const e = q.data
  return (
    <div>
      <SettingsTitle
        title="Economy"
        description="How Wicky Coins move around your school. Everything here comes from the data log, which saves every coin and item change."
      />
      {!e ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-4">
            <Stat
              label="Coins out there"
              value={n(e.circulation.total)}
              hint={`${e.circulation.people} people`}
            />
            <Stat label="Typical balance" value={n(e.circulation.median)} hint="median" />
            <Stat
              label="Held by the top 10"
              value={`${e.circulation.top10Share}%`}
              hint="of all coins"
            />
            <Stat
              label="This week"
              value={`+${n(e.byReason.reduce((a, r) => a + r.earned, 0))}`}
              hint={`−${n(e.byReason.reduce((a, r) => a + r.spent, 0))} spent`}
            />
          </div>

          <SettingsCard
            title={`⚠️ Worth a look (${e.flags.length})`}
            description="Patterns that can mean coin farming or pressure between students. Not proof of anything: just places to check."
          >
            {!e.flags.length ? (
              <p className="text-[13px] text-fg-subtle">Nothing unusual this week. 🎉</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {e.flags.map((f, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[13px]"
                  >
                    <span aria-hidden="true">{FLAG_ICON[f.kind]}</span>
                    <Person u={e.users[f.userIds[0]!]} />
                    {f.userIds[1] && (
                      <>
                        <span className="text-fg-subtle">↔</span>
                        <Person u={e.users[f.userIds[1]]} />
                      </>
                    )}
                    <span className="text-fg-muted">{f.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </SettingsCard>

          <SettingsCard title="Coins in and out">
            <FlowChart daily={e.daily} />
            <table className="mt-4 w-full text-[13px]">
              <thead>
                <tr className="text-left text-xs text-fg-subtle">
                  <th className="py-1 font-medium">Why (this week)</th>
                  <th className="py-1 text-right font-medium">Earned</th>
                  <th className="py-1 text-right font-medium">Spent</th>
                </tr>
              </thead>
              <tbody>
                {e.byReason.map((r) => (
                  <tr key={r.reason} className="border-t border-border">
                    <td className="py-1.5">{r.reason.replace(/_/g, ' ')}</td>
                    <td className="py-1.5 text-right text-success tabular-nums">
                      {r.earned ? `+${n(r.earned)}` : ''}
                    </td>
                    <td className="py-1.5 text-right text-danger tabular-nums">
                      {r.spent ? `−${n(r.spent)}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SettingsCard>

          <div className="mb-6 grid gap-3 md:grid-cols-3">
            <Board title="Richest" rows={e.richest} users={e.users} />
            <Board title="Top earners (7 days)" rows={e.earners} users={e.users} sign="+" />
            <Board title="Top spenders (7 days)" rows={e.spenders} users={e.users} sign="−" />
          </div>

          {e.market.length > 0 && (
            <SettingsCard title="📈 Stock Market: most held">
              <ul className="grid gap-1.5 text-[13px] sm:grid-cols-2">
                {e.market.map((m) => (
                  <li
                    key={m.key}
                    className="flex justify-between rounded-md bg-bg-muted/50 px-3 py-1.5"
                  >
                    <span className="truncate">
                      {m.key.startsWith('p:') ? (
                        <>
                          Shares in <Person u={e.users[m.key.slice(2)]} />
                        </>
                      ) : (
                        itemName(m.key, community.data ?? [])
                      )}
                    </span>
                    <span className="font-semibold tabular-nums">{m.supply} held</span>
                  </li>
                ))}
              </ul>
            </SettingsCard>
          )}

          <SettingsCard title="Latest changes" description="The newest entries in the data log.">
            <ul className="divide-y divide-border text-[13px]">
              {e.recent.map((r, i) => (
                <li key={i} className="flex items-center gap-3 py-1.5">
                  <span className="w-48 shrink-0">
                    <Person u={r.userId ? e.users[r.userId] : undefined} />
                  </span>
                  <span className={cn('min-w-0 flex-1 truncate text-fg-muted')}>{r.text}</span>
                  <span className="shrink-0 text-2xs text-fg-subtle">{relative(r.at)}</span>
                </li>
              ))}
            </ul>
          </SettingsCard>
        </>
      )}
    </div>
  )
}

'use client'
/** WickyChat Class vs Class: this week's group chat race and last week's winners. */
import { CLASS_WAR, type ClassWar } from '@quid/shared'
import { cn, Skeleton } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useOrgContext } from '@/components/org-context'
import { get } from '@/lib/api'

const MEDAL = ['🥇', '🥈', '🥉']

function rewardText(place: number) {
  const r = CLASS_WAR.rewards.find((x) => x.place === place)
  if (!r) return ''
  return [r.crates ? `📦 ${r.crates} crate` : '', r.coins ? `🪙 ${r.coins}` : '']
    .filter(Boolean)
    .join(' + ')
}

export function ClassWarView() {
  const { org, api, base } = useOrgContext()
  const q = useQuery({
    queryKey: ['class-war', org.id],
    queryFn: ({ signal }) => get<ClassWar>(`${api}/class-war`, signal),
    refetchInterval: 60_000,
  })
  if (!q.data) return <Skeleton className="h-60" />
  const d = q.data
  const max = Math.max(1, ...d.standings.map((r) => r.score))
  const days = Math.max(0, Math.ceil((new Date(d.endsAt).getTime() - Date.now()) / 86_400_000))

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-border bg-gradient-to-br from-[#8052ff]/10 to-[#ff4d6d]/10 p-4">
        <p className="text-[16px] font-bold">⚔️ Class vs Class</p>
        <p className="mt-1 text-[13px] text-fg-muted">
          Group chats race all week. Every message counts (up to {CLASS_WAR.dailyCap} per person a
          day, so get everyone talking). Ends in {days} day{days === 1 ? '' : 's'}. Everyone who
          sent at least {CLASS_WAR.minMessages} messages in a top chat wins:
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
          {CLASS_WAR.rewards.map((r) => (
            <span key={r.place} className="rounded-full bg-bg-overlay px-2.5 py-1">
              {MEDAL[r.place - 1]} {rewardText(r.place)}
            </span>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-[14px] font-semibold">This week</h3>
        {!d.standings.length ? (
          <p className="py-6 text-center text-[13px] text-fg-subtle">
            No chats have scored yet. Start talking in one with {CLASS_WAR.minMembers}+ people!
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {d.standings.map((r, i) => {
              const row = (
                <div
                  className={cn(
                    'relative flex items-center gap-3 overflow-hidden rounded-lg border px-3 py-2',
                    r.mine ? 'border-accent' : 'border-border',
                  )}
                >
                  <div
                    className={cn(
                      'absolute inset-y-0 left-0 -z-10',
                      i === 0 ? 'bg-[#ffb829]/25' : r.mine ? 'bg-accent-subtle' : 'bg-bg-muted',
                    )}
                    style={{ width: `${(r.score / max) * 100}%` }}
                  />
                  <span className="w-7 text-center text-[15px] font-bold tabular-nums">
                    {MEDAL[i] ?? i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                    {r.name}
                    {r.mine && <span className="ml-2 text-2xs text-accent-text">your chat</span>}
                  </span>
                  <span className="text-2xs text-fg-subtle">{r.people} people</span>
                  <span className="w-14 text-right text-[14px] font-bold tabular-nums">
                    {r.score}
                  </span>
                </div>
              )
              return (
                <li key={r.channelId} className="isolate">
                  {r.mine ? <Link href={`${base}/c/${r.channelId}`}>{row}</Link> : row}
                </li>
              )
            })}
          </ol>
        )}
      </section>

      {d.lastWeek.length > 0 && (
        <section>
          <h3 className="mb-3 text-[14px] font-semibold">Last week's winners</h3>
          <ul className="flex flex-wrap gap-2">
            {d.lastWeek.map((r) => (
              <li
                key={r.place}
                className="rounded-lg border border-border px-3 py-2 text-[13px] font-semibold"
              >
                {MEDAL[r.place - 1]} {r.name}{' '}
                <span className="text-fg-subtle tabular-nums">· {r.score}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

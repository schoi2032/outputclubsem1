'use client'
/** WickyChat daily quests: today's 3 tasks, progress, and coins to claim. */
import { QUEST_BONUS, QUESTS, type QuestDay, type Wallet } from '@quid/shared'
import { Button, cn, Skeleton, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { errorMessage, get, post } from '@/lib/api'

export function useQuests() {
  return useQuery({
    queryKey: ['quests'],
    queryFn: ({ signal }) => get<QuestDay>('/api/me/quests', signal),
    staleTime: 20_000,
    refetchInterval: 60_000,
  })
}

/** Quests ready to claim (and the bonus), for the badge. */
export function questsClaimable(d: QuestDay | undefined) {
  if (!d) return 0
  const n = d.quests.filter((x) => x.done && !x.claimed).length
  return n + (d.quests.every((x) => x.claimed) && !d.bonusClaimed ? 1 : 0)
}

function useCountdown(to: string | undefined) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  if (!to) return ''
  const ms = Math.max(0, new Date(to).getTime() - now)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `${h}h ${m}m`
}

export function QuestsView() {
  const qc = useQueryClient()
  const day = useQuests()
  const [busy, setBusy] = useState<string | null>(null)
  const left = useCountdown(day.data?.resetsAt)
  if (!day.data) return <Skeleton className="h-48" />
  const d = day.data
  const allClaimed = d.quests.every((x) => x.claimed)

  const claim = async (id: string, reward: number) => {
    setBusy(id)
    try {
      const r = await post<{ quests: QuestDay; wallet: Wallet }>(`/api/me/quests/${id}/claim`, {})
      qc.setQueryData(['quests'], r.quests)
      qc.setQueryData(['wallet'], r.wallet)
      toast.success(`+${reward} Wicky Coins! ${id === 'bonus' ? '🌟 All done today!' : '✅'}`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <p className="mb-3 text-[13px] text-fg-muted">
        3 new quests every day. Finish all 3 for a 🪙 {QUEST_BONUS} bonus. New ones in {left}.
      </p>
      <ul className="flex flex-col gap-2">
        {d.quests.map((p) => {
          const qd = QUESTS.find((x) => x.id === p.id)!
          const ready = p.done && !p.claimed
          return (
            <li
              key={p.id}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3',
                ready ? 'border-accent bg-accent-subtle' : 'border-border',
                p.claimed && 'opacity-60',
              )}
            >
              <span className="text-[26px]" aria-hidden="true">
                {qd.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">{qd.text}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-muted">
                    <div
                      className="h-full rounded-full bg-accent transition-[width]"
                      style={{ width: `${(p.progress / qd.goal) * 100}%` }}
                    />
                  </div>
                  <span className="text-2xs text-fg-subtle tabular-nums">
                    {p.progress}/{qd.goal}
                  </span>
                </div>
              </div>
              {p.claimed ? (
                <span className="text-2xs font-semibold text-fg-subtle">✓ Claimed</span>
              ) : (
                <Button
                  size="sm"
                  variant={ready ? 'primary' : 'secondary'}
                  disabled={!ready}
                  loading={busy === p.id}
                  onClick={() => claim(p.id, qd.reward)}
                  className="tabular-nums"
                >
                  🪙 {qd.reward}
                </Button>
              )}
            </li>
          )
        })}
        <li
          className={cn(
            'flex items-center gap-3 rounded-xl border border-dashed p-3',
            allClaimed && !d.bonusClaimed ? 'border-accent bg-accent-subtle' : 'border-border',
          )}
        >
          <span className="text-[26px]" aria-hidden="true">
            🌟
          </span>
          <p className="flex-1 text-[14px] font-semibold">Finish all 3</p>
          {d.bonusClaimed ? (
            <span className="text-2xs font-semibold text-fg-subtle">✓ Claimed</span>
          ) : (
            <Button
              size="sm"
              variant={allClaimed ? 'primary' : 'secondary'}
              disabled={!allClaimed}
              loading={busy === 'bonus'}
              onClick={() => claim('bonus', QUEST_BONUS)}
            >
              🪙 {QUEST_BONUS}
            </Button>
          )}
        </li>
      </ul>
    </div>
  )
}

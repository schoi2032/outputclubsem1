'use client'
/** WickyChat: achievements with progress bars and coin rewards to claim. */
import { ACHIEVEMENTS, type AchievementProgress, type Wallet } from '@quid/shared'
import { Button, cn, Skeleton, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { errorMessage, get, post } from '@/lib/api'

export function useAchievements() {
  return useQuery({
    queryKey: ['achievements'],
    queryFn: ({ signal }) => get<AchievementProgress[]>('/api/me/achievements', signal),
    staleTime: 30_000,
  })
}

export function AchievementsView() {
  const qc = useQueryClient()
  const list = useAchievements()
  const [busy, setBusy] = useState<string | null>(null)
  if (!list.data) return <Skeleton className="h-60" />
  const byId = new Map(list.data.map((p) => [p.id, p]))
  const done = list.data.filter((p) => p.claimed).length

  const claim = async (id: string, reward: number) => {
    setBusy(id)
    try {
      const r = await post<{ achievements: AchievementProgress[]; wallet: Wallet }>(
        `/api/me/achievements/${id}/claim`,
        {},
      )
      qc.setQueryData(['achievements'], r.achievements)
      qc.setQueryData(['wallet'], r.wallet)
      toast.success(`+${reward} Wicky Coins! 🏆`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  // Ready to claim first, then the closest to done, then finished ones.
  const order = (id: string) => {
    const p = byId.get(id)
    const def = ACHIEVEMENTS.find((a) => a.id === id)!
    if (!p) return 2
    if (p.done && !p.claimed) return -1
    if (p.claimed) return 3
    return 1 - p.progress / def.goal
  }
  const sorted = [...ACHIEVEMENTS].sort((a, b) => order(a.id) - order(b.id))

  return (
    <div>
      <p className="mb-3 text-[13px] text-fg-muted">
        🏆 {done} of {ACHIEVEMENTS.length} done. Finish one, then claim its coins.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {sorted.map((a) => {
          const p = byId.get(a.id)
          const pct = p ? Math.round((p.progress / a.goal) * 100) : 0
          const ready = p?.done && !p.claimed
          return (
            <li
              key={a.id}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3',
                ready ? 'border-accent bg-accent-subtle' : 'border-border',
                p?.claimed && 'opacity-60',
              )}
            >
              <span className="text-[26px]" aria-hidden="true">
                {a.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">{a.name}</p>
                <p className="text-xs text-fg-muted">{a.how}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-muted">
                    <div
                      className="h-full rounded-full bg-accent transition-[width]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-2xs text-fg-subtle tabular-nums">
                    {(p?.progress ?? 0).toLocaleString()}/{a.goal.toLocaleString()}
                  </span>
                </div>
              </div>
              {p?.claimed ? (
                <span className="text-2xs font-semibold text-fg-subtle">✓ Claimed</span>
              ) : (
                <Button
                  size="sm"
                  variant={ready ? 'primary' : 'secondary'}
                  disabled={!ready}
                  loading={busy === a.id}
                  onClick={() => claim(a.id, a.reward)}
                  className="tabular-nums"
                >
                  🪙 {a.reward}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

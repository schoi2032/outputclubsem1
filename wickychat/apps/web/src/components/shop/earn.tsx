'use client'
/**
 * WickyChat Earn tab: the daily spin (plus spin tickets from crates), daily trivia and a list of
 * every way to earn coins.
 */
import {
  BOUNTY,
  COINS,
  type EarnStatus,
  LIKES,
  QUEST_BONUS,
  TRIVIA_REWARD,
  type TriviaDay,
  type Wallet,
  WHEEL,
} from '@quid/shared'
import { Button, cn, Skeleton, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { errorMessage, get, post } from '@/lib/api'

export function useEarn() {
  const { org, api } = useOrgContext()
  return useQuery({
    queryKey: ['earn', org.id],
    queryFn: ({ signal }) => get<EarnStatus>(`${api}/earn`, signal),
    staleTime: 30_000,
  })
}

export function useTrivia() {
  const { org, api } = useOrgContext()
  return useQuery({
    queryKey: ['trivia', org.id],
    queryFn: ({ signal }) => get<TriviaDay>(`${api}/trivia`, signal),
    staleTime: 60_000,
  })
}

/** Things waiting for you today (for the badge). */
export function earnWaiting(e?: EarnStatus, t?: TriviaDay) {
  return (e?.spinAvailable ? 1 : 0) + (t && t.picked == null ? 1 : 0)
}

const SLICE = 360 / WHEEL.length

function Wheel() {
  const { api, org } = useOrgContext()
  const qc = useQueryClient()
  const earn = useEarn()
  const [angle, setAngle] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [won, setWon] = useState<number | null>(null)

  const spin = async () => {
    setSpinning(true)
    setWon(null)
    try {
      const r = await post<{ slice: number; coins: number; wallet: Wallet }>(`${api}/earn/spin`, {})
      // Land the middle of the winning slice under the pointer, after a few full turns.
      const target = 360 * 6 + (360 - (r.slice * SLICE + SLICE / 2))
      setAngle((a) => a - (a % 360) + target)
      setTimeout(() => {
        setSpinning(false)
        setWon(r.coins)
        qc.setQueryData(['wallet'], r.wallet)
        void qc.invalidateQueries({ queryKey: ['earn', org.id] })
        toast.success(`+${r.coins} Wicky Coins from the wheel! 🎡`)
      }, 4200)
    } catch (e) {
      setSpinning(false)
      toast.error(errorMessage(e))
    }
  }

  const r = 110
  const path = (i: number) => {
    const a0 = ((i * SLICE - 90) * Math.PI) / 180
    const a1 = (((i + 1) * SLICE - 90) * Math.PI) / 180
    return `M ${r} ${r} L ${r + r * Math.cos(a0)} ${r + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${r + r * Math.cos(a1)} ${r + r * Math.sin(a1)} Z`
  }
  const can = !!earn.data && (earn.data.spinAvailable || earn.data.spinTickets > 0) && !spinning

  return (
    <section className="flex flex-col items-center gap-3 rounded-xl border border-border p-5">
      <p className="text-[15px] font-bold">🎡 Daily spin</p>
      <div className="relative">
        <div
          className="absolute -top-2 left-1/2 z-10 -translate-x-1/2 text-[22px]"
          aria-hidden="true"
        >
          🔻
        </div>
        <svg
          viewBox={`0 0 ${r * 2} ${r * 2}`}
          className="size-56 drop-shadow-md"
          style={{
            transform: `rotate(${angle}deg)`,
            transition: spinning ? 'transform 4s cubic-bezier(0.15, 0.85, 0.25, 1)' : 'none',
          }}
          role="img"
          aria-label="Prize wheel"
        >
          {WHEEL.map((w, i) => {
            const mid = ((i + 0.5) * SLICE - 90) * (Math.PI / 180)
            return (
              <g key={i}>
                <path d={path(i)} fill={w.color} stroke="#fff" strokeWidth="2" />
                <text
                  x={r + r * 0.68 * Math.cos(mid)}
                  y={r + r * 0.68 * Math.sin(mid)}
                  fill="#fff"
                  fontSize="15"
                  fontWeight="800"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={`rotate(${(i + 0.5) * SLICE}, ${r + r * 0.68 * Math.cos(mid)}, ${r + r * 0.68 * Math.sin(mid)})`}
                >
                  {w.coins}
                </text>
              </g>
            )
          })}
          <circle cx={r} cy={r} r="18" fill="#fff" />
          <text x={r} y={r} fontSize="16" textAnchor="middle" dominantBaseline="middle">
            🪙
          </text>
        </svg>
      </div>
      <p className="h-5 text-[14px] font-semibold" aria-live="polite">
        {won != null && !spinning ? `You won 🪙 ${won}!` : ''}
      </p>
      <Button variant="primary" disabled={!can} loading={spinning} onClick={spin}>
        {!earn.data || earn.data.spinAvailable
          ? 'Spin for free'
          : earn.data.spinTickets > 0
            ? `Use a 🎟️ ticket (${earn.data.spinTickets} left)`
            : 'Come back tomorrow'}
      </Button>
      <p className="text-2xs text-fg-subtle">
        🎟️ {earn.data?.spinTickets ?? 0} spin ticket{earn.data?.spinTickets === 1 ? '' : 's'}. Get
        more from crates.
      </p>
    </section>
  )
}

function Trivia() {
  const { api, org } = useOrgContext()
  const qc = useQueryClient()
  const trivia = useTrivia()
  const [busy, setBusy] = useState<number | null>(null)
  const d = trivia.data
  if (!d) return <Skeleton className="h-48" />
  const answered = d.picked != null
  const pick = async (i: number) => {
    setBusy(i)
    try {
      const r = await post<{ trivia: TriviaDay; wallet: Wallet }>(`${api}/trivia`, { picked: i })
      qc.setQueryData(['trivia', org.id], r.trivia)
      qc.setQueryData(['wallet'], r.wallet)
      if (r.trivia.correct) toast.success(`Correct! +${TRIVIA_REWARD} Wicky Coins 🧠`)
      else toast.info('Not quite! New question tomorrow.')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border p-5">
      <p className="text-[15px] font-bold">🧠 Daily trivia · 🪙 {TRIVIA_REWARD}</p>
      <p className="text-[14px] font-medium">{d.question}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {d.options.map((o, i) => (
          <Button
            key={o}
            className={cn(
              'justify-start',
              answered && i === d.answer && 'border-success bg-success/15 text-fg',
              answered && i === d.picked && i !== d.answer && 'border-danger bg-danger/10 text-fg',
            )}
            disabled={answered}
            loading={busy === i}
            onClick={() => pick(i)}
          >
            {o}
          </Button>
        ))}
      </div>
      <p className="text-2xs text-fg-subtle">
        {answered
          ? `${d.correct ? '✅ You got it!' : '❌ Not this time.'} ${d.rightToday} ${d.rightToday === 1 ? 'person' : 'people'} got it right today.`
          : 'One try. A new question every day.'}
      </p>
    </section>
  )
}

const WAYS: { emoji: string; title: string; how: string; tab?: string }[] = [
  {
    emoji: '🎁',
    title: 'Daily bonus',
    how: `${COINS.daily}+ coins a day, more with a streak`,
    tab: 'all',
  },
  { emoji: '🎡', title: 'Daily spin', how: '5 to 250 coins, free once a day' },
  { emoji: '🎟️', title: 'Spin tickets', how: 'Extra spins that drop from crates', tab: 'crates' },
  { emoji: '🧠', title: 'Daily trivia', how: `${TRIVIA_REWARD} coins for the right answer` },
  {
    emoji: '✅',
    title: 'Daily quests',
    how: `3 tasks a day + 🪙 ${QUEST_BONUS} bonus`,
    tab: 'quests',
  },
  {
    emoji: '💬',
    title: 'Chatting',
    how: `${COINS.perMessage} per message, up to ${COINS.messageDailyCap} a day`,
  },
  {
    emoji: '❤️',
    title: 'Reactions',
    how: `1 coin when someone reacts to your message (up to ${LIKES.dailyCap} a day)`,
  },
  {
    emoji: '❓',
    title: 'Answer bounties',
    how: `Best answer to a ❓ question wins its coins (up to ${BOUNTY.max})`,
  },
  {
    emoji: '🏆',
    title: 'Achievements',
    how: 'One-time rewards for milestones',
    tab: 'achievements',
  },
  {
    emoji: '⚔️',
    title: 'Class vs Class',
    how: 'Top 3 group chats each week win crates and coins',
    tab: 'classwar',
  },
  {
    emoji: '🎨',
    title: 'Make and sell',
    how: 'Cosmetics, crates, bundles and stickers: you keep 90%',
    tab: 'create',
  },
  {
    emoji: '🖌️',
    title: 'Be an Official Artist',
    how: 'Get paid for custom art requests',
    tab: 'artists',
  },
  {
    emoji: '📈',
    title: 'Invest',
    how: 'Buy low, sell high; back people for a share of what they earn',
    tab: 'invest',
  },
  {
    emoji: '🔨',
    title: 'Trade and auction',
    how: 'Sell rare and limited items to other students',
    tab: 'auctions',
  },
  { emoji: '📊', title: 'Polls and quizzes', how: 'Teachers can reward taking part' },
  { emoji: '🍎', title: 'Teacher rewards', how: 'For helping, kindness and great work' },
]

export function EarnView({ onGo }: { onGo: (tab: string) => void }) {
  const earn = useEarn()
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Wheel />
        <div className="flex flex-col gap-4">
          <Trivia />
          {earn.data && (
            <section className="rounded-xl border border-border p-4">
              <p className="text-[13px] font-semibold">❤️ Coins from reactions today</p>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-muted">
                  <div
                    className="h-full rounded-full bg-[#e0457b]"
                    style={{ width: `${(earn.data.likesToday / LIKES.dailyCap) * 100}%` }}
                  />
                </div>
                <span className="text-2xs text-fg-subtle tabular-nums">
                  {earn.data.likesToday}/{LIKES.dailyCap}
                </span>
              </div>
            </section>
          )}
        </div>
      </div>
      <section>
        <h3 className="mb-3 text-[14px] font-semibold">💰 Every way to earn</h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {WAYS.map((w) => (
            <li key={w.title}>
              <button
                type="button"
                disabled={!w.tab}
                onClick={() => w.tab && onGo(w.tab)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left',
                  w.tab && 'hover:border-border-strong hover:bg-bg-muted/50',
                )}
              >
                <span className="text-[22px]" aria-hidden="true">
                  {w.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{w.title}</span>
                  <span className="block text-xs text-fg-muted">{w.how}</span>
                </span>
                {w.tab && <span className="text-fg-subtle">→</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

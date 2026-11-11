'use client'
/**
 * WickyChat: the Wicky Shop. Your coin balance, the daily bonus, and animated avatar
 * decorations to buy and wear.
 */
import {
  COINS,
  type CoinTransaction,
  DECORATIONS,
  type Decoration,
  type DecorationRarity,
  decorationById,
  type Wallet,
} from '@quid/shared'
import { Avatar, Button, cn, Skeleton, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Gift, Store } from 'lucide-react'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { errorMessage, get, post, put } from '@/lib/api'
import { relative } from '@/lib/format'
import { keys } from '@/lib/queries'

const RARITY: Record<DecorationRarity, { label: string; className: string }> = {
  common: { label: 'Common', className: 'bg-bg-muted text-fg-muted' },
  rare: { label: 'Rare', className: 'bg-[#3b8fc9]/15 text-[#3b8fc9]' },
  epic: { label: 'Epic', className: 'bg-[#8052ff]/15 text-[#8052ff]' },
  legendary: { label: 'Legendary', className: 'bg-[#ffb829]/20 text-[#b07800]' },
}

const REASON: Record<CoinTransaction['reason'], string> = {
  daily: 'Daily bonus',
  message: 'Sent a message',
  swear: 'Swear filter caught you',
  purchase: 'Bought',
  gift: 'Reward from a teacher',
}

function Coin({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('inline-block', className)}>
      🪙
    </span>
  )
}

export default function ShopPage() {
  const { me } = useOrgContext()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const wallet = useQuery({
    queryKey: ['wallet'],
    queryFn: ({ signal }) => get<Wallet>('/api/me/wallet', signal),
  })
  const w = wallet.data

  const act = async (key: string, fn: () => Promise<Wallet>, success?: string) => {
    setBusy(key)
    try {
      const next = await fn()
      qc.setQueryData(['wallet'], next)
      // Your avatar (and coin count) appear in lots of places; refresh them.
      void qc.invalidateQueries({ queryKey: keys.me })
      void qc.invalidateQueries({ queryKey: ['members'] })
      if (success) toast.success(success)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const claim = () =>
    act(
      'daily',
      () => post<Wallet>('/api/me/wallet/daily'),
      `+${COINS.daily} Wicky Coins! See you tomorrow 🎉`,
    )
  const buy = (d: Decoration) =>
    act(d.id, () => post<Wallet>(`/api/me/shop/${d.id}/buy`), `${d.name} is yours! ✨`)
  const equip = (id: string | null) =>
    act(`equip:${id}`, () => put<Wallet>('/api/me/decoration', { itemId: id }))

  const equipped = decorationById(w?.equipped)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Wicky Shop" icon={<Store />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-4 md:p-6">
          {/* Wallet */}
          <section className="mb-8 grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="flex items-center gap-5 rounded-xl border border-border bg-gradient-to-br from-[#8052ff]/10 to-[#15846e]/10 p-5">
              <Avatar
                name={me.name}
                id={me.id}
                src={me.avatarUrl}
                decoration={w?.equipped ?? me.decoration}
                size="xl"
              />
              <div className="min-w-0">
                <p className="text-[13px] text-fg-muted">Your Wicky Coins</p>
                {w ? (
                  <p className="text-3xl font-bold tabular-nums">
                    <Coin className="mr-1.5 text-2xl" />
                    {w.coins.toLocaleString()}
                  </p>
                ) : (
                  <Skeleton className="mt-1 h-9 w-28" />
                )}
                <p className="mt-1 text-xs text-fg-subtle">
                  Wearing: {equipped ? equipped.name : 'nothing'}
                  {equipped && (
                    <button
                      type="button"
                      className="ml-2 text-accent-text hover:underline"
                      onClick={() => equip(null)}
                    >
                      Take off
                    </button>
                  )}
                </p>
              </div>
            </div>
            <div className="flex flex-col justify-center gap-2 rounded-xl border border-border p-5 md:w-64">
              <Button
                variant="primary"
                disabled={!w?.dailyAvailable}
                loading={busy === 'daily'}
                onClick={claim}
              >
                <Gift />{' '}
                {w?.dailyAvailable ? `Claim ${COINS.daily} daily coins` : 'Claimed today ✓'}
              </Button>
              <div className="text-xs text-fg-muted">
                <p>
                  Messages today: {w?.earnedFromMessagesToday ?? 0}/{COINS.messageDailyCap} coins
                </p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-muted">
                  <div
                    className="h-full rounded-full bg-accent transition-[width]"
                    style={{
                      width: `${Math.min(100, ((w?.earnedFromMessagesToday ?? 0) / COINS.messageDailyCap) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* How to earn */}
          <section className="mb-8 grid gap-3 text-[13px] sm:grid-cols-4">
            {[
              ['🎁', `+${COINS.daily}`, 'Daily bonus, once a day'],
              ['💬', `+${COINS.perMessage}`, `Each message, up to ${COINS.messageDailyCap} a day`],
              ['🍎', 'Bonus', 'Teachers can reward you'],
              ['🤬', `−${COINS.swearPenalty}`, 'Every time the swear filter catches you'],
            ].map(([icon, amount, text]) => (
              <div key={text} className="rounded-lg border border-border p-3">
                <p className="text-lg">{icon}</p>
                <p className="font-semibold">{amount}</p>
                <p className="text-fg-muted">{text}</p>
              </div>
            ))}
          </section>

          {/* Decorations */}
          <h2 className="mb-3 text-[15px] font-semibold">Avatar decorations</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {DECORATIONS.map((d) => {
              const owned = w?.owned.includes(d.id)
              const wearing = w?.equipped === d.id
              const afford = (w?.coins ?? 0) >= d.price
              return (
                <li
                  key={d.id}
                  className={cn(
                    'flex flex-col items-center rounded-xl border p-4 text-center',
                    wearing ? 'border-accent bg-accent-subtle' : 'border-border',
                  )}
                >
                  <div className="my-3">
                    <Avatar
                      name={me.name}
                      id={me.id}
                      src={me.avatarUrl}
                      decoration={d.id}
                      size="xl"
                    />
                  </div>
                  <p className="mt-2 text-[14px] font-semibold">{d.name}</p>
                  <span
                    className={cn(
                      'mt-1 rounded-full px-2 py-0.5 text-2xs font-semibold',
                      RARITY[d.rarity].className,
                    )}
                  >
                    {RARITY[d.rarity].label}
                  </span>
                  <p className="mt-2 min-h-[2.5em] text-xs text-fg-muted">{d.description}</p>
                  <div className="mt-3 w-full">
                    {wearing ? (
                      <Button
                        size="sm"
                        className="w-full"
                        loading={busy === 'equip:null'}
                        onClick={() => equip(null)}
                      >
                        Wearing ✓
                      </Button>
                    ) : owned ? (
                      <Button
                        size="sm"
                        variant="primary"
                        className="w-full"
                        loading={busy === `equip:${d.id}`}
                        onClick={() => equip(d.id)}
                      >
                        Wear
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant={afford ? 'primary' : 'secondary'}
                        className="w-full tabular-nums"
                        disabled={!afford || !w}
                        loading={busy === d.id}
                        onClick={() => buy(d)}
                        title={afford ? undefined : `You need ${d.price - (w?.coins ?? 0)} more`}
                      >
                        <Coin /> {d.price}
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          {/* History */}
          {!!w?.history.length && (
            <section className="mt-10">
              <h2 className="mb-3 text-[15px] font-semibold">Recent coins</h2>
              <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
                {w.history.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex-1">
                      {REASON[h.reason]}
                      {h.reason === 'purchase' && h.ref
                        ? ` ${decorationById(h.ref)?.name ?? h.ref}`
                        : h.reason === 'gift' && h.ref
                          ? ` · “${h.ref}”`
                          : ''}
                    </span>
                    <span className="text-xs text-fg-subtle">{relative(h.createdAt)}</span>
                    <span
                      className={cn(
                        'w-14 text-right font-semibold tabular-nums',
                        h.amount > 0 ? 'text-success' : 'text-danger',
                      )}
                    >
                      {h.amount > 0 ? '+' : ''}
                      {h.amount}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

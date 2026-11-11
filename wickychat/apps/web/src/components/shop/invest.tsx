'use client'
/**
 * WickyChat Stock Market: buy and sell copies of items whose price follows demand, and back
 * people with shares that pay a bonus whenever they earn coins.
 */
import {
  INVEST,
  type MarketQuote,
  type PersonQuote,
  type Portfolio,
  personKey,
  type Wallet,
} from '@quid/shared'
import { Avatar, Button, cn, Input, Select, Skeleton, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { errorMessage, get, post } from '@/lib/api'
import { displayName } from '@/lib/format'
import { ItemPreview, useCatalog } from './items'

export function useStocks() {
  const { org, api } = useOrgContext()
  return useQuery({
    queryKey: ['stocks', org.id],
    queryFn: ({ signal }) => get<MarketQuote[]>(`${api}/stocks`, signal),
    staleTime: 15_000,
  })
}

function usePeopleStocks() {
  const { org, api } = useOrgContext()
  return useQuery({
    queryKey: ['stocks', org.id, 'people'],
    queryFn: ({ signal }) => get<PersonQuote[]>(`${api}/stocks/people`, signal),
    staleTime: 15_000,
  })
}

function usePortfolio() {
  return useQuery({
    queryKey: ['portfolio'],
    queryFn: ({ signal }) => get<Portfolio>('/api/me/portfolio', signal),
  })
}

export function Sparkline({ points, className }: { points: number[]; className?: string }) {
  const w = 84
  const h = 26
  if (points.length < 2) points = [points[0] ?? 0, points[0] ?? 0]
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * w},${h - 2 - ((p - min) / span) * (h - 4)}`)
    .join(' ')
  const up = points[points.length - 1]! >= points[0]!
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className={className} aria-hidden="true">
      <polyline
        points={d}
        fill="none"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        className={up ? 'stroke-success' : 'stroke-danger'}
      />
    </svg>
  )
}

function Change({ pct }: { pct: number }) {
  if (!pct) return <span className="text-2xs text-fg-subtle tabular-nums">0%</span>
  const up = pct > 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-2xs font-semibold tabular-nums',
        up ? 'text-success' : 'text-danger',
      )}
    >
      {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {up ? '+' : ''}
      {pct}%
    </span>
  )
}

type Sort = 'hot' | 'held' | 'cheap' | 'pricey' | 'mine'

export function InvestView({ wallet, person }: { wallet: Wallet | undefined; person?: string }) {
  const { api, org, me } = useOrgContext()
  const qc = useQueryClient()
  const catalog = useCatalog()
  const stocks = useStocks()
  const people = usePeopleStocks()
  const folio = usePortfolio()
  const [view, setView] = useState<'items' | 'people'>(person ? 'people' : 'items')
  const [sort, setSort] = useState<Sort>('hot')
  const [qty, setQty] = useState(1)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const mine = folio.data

  const trade = async (key: string, side: 'buy' | 'sell', label: string) => {
    setBusy(`${side}:${key}`)
    try {
      const r = await post<{ wallet: Wallet; portfolio: Portfolio }>(
        `${api}/stocks/${encodeURIComponent(key)}/${side}`,
        { qty },
      )
      qc.setQueryData(['wallet'], r.wallet)
      qc.setQueryData(['portfolio'], r.portfolio)
      void qc.invalidateQueries({ queryKey: ['stocks', org.id] })
      toast.success(`${side === 'buy' ? 'Bought' : 'Sold'} ${qty} × ${label}`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const value =
    (stocks.data ?? []).reduce((n, s) => n + (mine?.items[s.key] ?? 0) * s.sell, 0) +
    (people.data ?? []).reduce((n, p) => n + (mine?.people[p.user.id] ?? 0) * p.sell, 0)

  const needle = q.trim().toLowerCase()
  const order = <T extends MarketQuote>(list: T[], held: (x: T) => number) =>
    [...list].sort((a, b) =>
      sort === 'hot'
        ? b.change - a.change || b.supply - a.supply
        : sort === 'held'
          ? b.supply - a.supply
          : sort === 'cheap'
            ? a.price - b.price
            : sort === 'pricey'
              ? b.price - a.price
              : held(b) - held(a),
    )

  const items = order(
    (stocks.data ?? []).filter((s) => {
      const it = catalog.get(s.key)
      if (!it) return false
      const have = mine?.items[s.key] ?? 0
      if (!it.live && !have) return false
      return !needle || it.name.toLowerCase().includes(needle)
    }),
    (s) => mine?.items[s.key] ?? 0,
  )
  const folks = order(
    (people.data ?? []).filter(
      (p) =>
        p.user.id !== me.id &&
        (!needle || displayName(p.user).toLowerCase().includes(needle)) &&
        (!person || p.user.id === person || !needle),
    ),
    (p) => mine?.people[p.user.id] ?? 0,
  )
  // Whoever you came here to back goes first.
  if (person) folks.sort((a, b) => Number(b.user.id === person) - Number(a.user.id === person))

  const buttons = (
    key: string,
    quote: MarketQuote,
    have: number,
    label: string,
    closed = false,
  ) => (
    <div className="flex shrink-0 gap-1.5">
      <Button
        size="sm"
        variant="primary"
        className="tabular-nums"
        disabled={closed || (wallet?.coins ?? 0) < quote.price}
        loading={busy === `buy:${key}`}
        onClick={() => trade(key, 'buy', label)}
        title={closed ? 'Event over: you can only sell' : `Buy ${qty}`}
      >
        Buy 🪙 {quote.price}
      </Button>
      <Button
        size="sm"
        className="tabular-nums"
        disabled={!have || quote.sell <= 0}
        loading={busy === `sell:${key}`}
        onClick={() => trade(key, 'sell', label)}
        title={
          quote.supply <= 0
            ? 'Nobody bought one here yet, so nothing to sell back into'
            : quote.made && quote.sell <= 0
              ? "Sells back only what it's gone up since the maker's price"
              : `Sell ${qty}`
        }
      >
        Sell {quote.sell > 0 ? `🪙 ${quote.sell}` : '—'}
      </Button>
    </div>
  )

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border p-3">
          <p className="text-2xs font-semibold text-fg-subtle uppercase">Your portfolio</p>
          <p className="text-[20px] font-bold tabular-nums">🪙 {value.toLocaleString()}</p>
          <p className="text-2xs text-fg-muted">What it sells for right now</p>
        </div>
        <div className="rounded-xl border border-border p-3">
          <p className="text-2xs font-semibold text-fg-subtle uppercase">Bonus from people</p>
          <p className="text-[20px] font-bold tabular-nums">🪙 {mine?.dividends ?? 0}</p>
          <p className="text-2xs text-fg-muted">
            {Math.round(INVEST.dividend * 100)}% extra whenever someone you back earns
          </p>
        </div>
        <div className="rounded-xl border border-border p-3 text-xs text-fg-muted">
          <p className="mb-1 text-2xs font-semibold text-fg-subtle uppercase">How it works</p>
          Every buy pushes the price up {Math.round(INVEST.step * 100)}% of its base; every sell
          brings it back. Selling pays {Math.round(INVEST.fee * 100)}% under the last buy, so you
          profit when others buy after you.
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border p-0.5">
          {(['items', 'people'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                'rounded-md px-3 py-1 text-[13px] font-medium',
                view === v ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {v === 'items' ? '📈 Items' : '🧑‍🤝‍🧑 People'}
            </button>
          ))}
        </div>
        <Input
          placeholder={view === 'items' ? 'Search items' : 'Search people'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-44"
          aria-label="Search"
        />
        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="w-auto"
          aria-label="Sort"
        >
          <option value="hot">🔥 Trending</option>
          <option value="held">Most held</option>
          <option value="cheap">Cheapest</option>
          <option value="pricey">Priciest</option>
          <option value="mine">Mine first</option>
        </Select>
        <Select
          value={String(qty)}
          onChange={(e) => setQty(Number(e.target.value))}
          className="w-auto"
          aria-label="How many"
        >
          {[1, 2, 5, 10].map((n) => (
            <option key={n} value={n}>
              × {n}
            </option>
          ))}
        </Select>
      </div>

      {view === 'items' ? (
        !stocks.data ? (
          <Skeleton className="h-60" />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {items.map((s) => {
              const it = catalog.get(s.key)!
              const have = mine?.items[s.key] ?? 0
              return (
                <li key={s.key} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div className="w-16 shrink-0">
                    <ItemPreview it={it} compact />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold">{it.name}</p>
                    <p className="text-2xs text-fg-subtle">
                      {s.supply} held · base 🪙 {s.base}
                      {have > 0 && <span className="text-accent-text"> · you have {have}</span>}
                    </p>
                  </div>
                  <Sparkline points={s.spark} className="hidden sm:block" />
                  <div className="w-14 text-right">
                    <Change pct={s.change} />
                  </div>
                  {buttons(s.key, s, have, it.name, !it.live)}
                </li>
              )
            })}
          </ul>
        )
      ) : !people.data ? (
        <Skeleton className="h-60" />
      ) : (
        <>
          <p className="mb-2 text-xs text-fg-muted">
            Back someone you think will be active. Whenever they earn coins (daily bonus, messages,
            quizzes, selling their creations, achievements), everyone who backs them splits{' '}
            {Math.round(INVEST.dividend * 100)}% extra. Up to {INVEST.maxShares} shares each.
          </p>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {folks.map((p) => {
              const key = personKey(p.user.id)
              const have = mine?.people[p.user.id] ?? 0
              return (
                <li
                  key={p.user.id}
                  className={cn(
                    'flex flex-wrap items-center gap-3 px-3 py-2',
                    p.user.id === person && 'bg-accent-subtle',
                  )}
                >
                  <Avatar name={p.user.name} id={p.user.id} src={p.user.avatarUrl} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold">{displayName(p.user)}</p>
                    <p className="text-2xs text-fg-subtle">
                      Earned 🪙 {p.earned7d} this week · {p.holders} backer
                      {p.holders === 1 ? '' : 's'}
                      {have > 0 && <span className="text-accent-text"> · you have {have}</span>}
                    </p>
                  </div>
                  <Sparkline points={p.spark} className="hidden sm:block" />
                  <div className="w-14 text-right">
                    <Change pct={p.change} />
                  </div>
                  {buttons(key, p, have, displayName(p.user))}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

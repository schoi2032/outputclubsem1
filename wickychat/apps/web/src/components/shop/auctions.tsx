'use client'
/** WickyChat: auctions. Timed bidding; the top bid when time runs out wins. */
import { AUCTION, type Auction, minBid, type Wallet } from '@quid/shared'
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Select,
  Skeleton,
  toast,
} from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Gavel } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { del, errorMessage, get, post } from '@/lib/api'
import { displayName } from '@/lib/format'
import { cosmeticItem, ItemPreview, ItemTags, RARITY, type ShopItem, useCatalog } from './items'

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

function left(endsAt: string, now: number) {
  const s = Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}h ${m}m` : `${m}:${String(sec).padStart(2, '0')}`
}

export function AuctionsView({ wallet }: { wallet: Wallet | undefined }) {
  const { api, org, me } = useOrgContext()
  const qc = useQueryClient()
  const catalog = useCatalog()
  const now = useNow()
  const list = useQuery({
    queryKey: ['auctions', org.id],
    queryFn: ({ signal }) => get<Auction[]>(`${api}/auctions`, signal),
    refetchInterval: 15_000,
  })
  const [bids, setBids] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Refresh right when one ends, so it settles.
  const nextEnd = (list.data ?? [])
    .filter((a) => a.status === 'open')
    .map((a) => new Date(a.endsAt).getTime())
    .sort()[0]
  useEffect(() => {
    if (!nextEnd) return
    const t = setTimeout(
      () => {
        void qc.invalidateQueries({ queryKey: ['auctions', org.id] })
        void qc.invalidateQueries({ queryKey: ['wallet'] })
      },
      Math.max(1000, nextEnd - Date.now() + 1500),
    )
    return () => clearTimeout(t)
  }, [nextEnd, qc, org.id])

  const itemFor = (a: Auction): ShopItem | undefined =>
    a.cosmetic ? cosmeticItem(a.cosmetic) : catalog.get(a.itemId)

  const bid = async (a: Auction) => {
    const amount = Number(bids[a.id] || minBid(a.startPrice, a.topBid))
    setBusy(a.id)
    try {
      const r = await post<{ auctions: Auction[]; wallet: Wallet }>(`${api}/auctions/${a.id}/bid`, {
        amount,
      })
      qc.setQueryData(['auctions', org.id], r.auctions)
      qc.setQueryData(['wallet'], r.wallet)
      setBids((b) => ({ ...b, [a.id]: '' }))
      toast.success(`You're the top bidder at 🪙 ${amount}! 🔨`)
    } catch (e) {
      toast.error(errorMessage(e))
      void list.refetch()
    } finally {
      setBusy(null)
    }
  }

  const cancel = async (a: Auction) => {
    setBusy(a.id)
    try {
      qc.setQueryData(['auctions', org.id], await del<Auction[]>(`${api}/auctions/${a.id}`, {}))
      void qc.invalidateQueries({ queryKey: ['wallet'] })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  if (!list.data) return <Skeleton className="h-60" />
  const open = list.data.filter((a) => a.status === 'open')
  const ended = list.data.filter((a) => a.status !== 'open')

  const card = (a: Auction) => {
    const it = itemFor(a)
    const live = a.status === 'open'
    const mine = a.seller.id === me.id
    const top = a.topBidder?.id === me.id
    const need = minBid(a.startPrice, a.topBid)
    const soon = live && new Date(a.endsAt).getTime() - now < AUCTION.snipeMs
    return (
      <li
        key={a.id}
        className={cn(
          'flex flex-col items-center rounded-xl border p-4 text-center',
          top && live ? 'border-accent bg-accent-subtle' : 'border-border',
          !live && 'opacity-70',
        )}
      >
        {it ? <ItemPreview it={it} /> : <div className="h-24" />}
        <p className="mt-1 text-[14px] font-semibold">{it?.name ?? 'Item'}</p>
        {it && (
          <span
            className={cn(
              'mt-1 rounded-full px-2 py-0.5 text-2xs font-semibold',
              RARITY[it.rarity].className,
            )}
          >
            {RARITY[it.rarity].label}
          </span>
        )}
        {it && <ItemTags it={it} serial={a.serial ?? undefined} />}
        <p className="mt-2 text-2xs text-fg-subtle">by {displayName(a.seller)}</p>
        <p className="mt-1 text-[18px] font-bold tabular-nums">🪙 {a.topBid ?? a.startPrice}</p>
        <p className="text-2xs text-fg-muted">
          {a.topBidder
            ? `${top ? 'You' : displayName(a.topBidder)} · ${a.bids} bid${a.bids === 1 ? '' : 's'}`
            : 'Starting price · no bids yet'}
        </p>
        <p
          className={cn(
            'mt-1 text-xs font-semibold tabular-nums',
            soon ? 'text-danger' : 'text-fg-muted',
          )}
        >
          {live
            ? `⏳ ${left(a.endsAt, now)}`
            : a.status === 'sold'
              ? `Sold to ${a.topBidder ? displayName(a.topBidder) : 'someone'}`
              : 'Ended, no bids'}
        </p>
        {live && !mine && (
          <div className="mt-3 flex w-full gap-1.5">
            <Input
              type="number"
              aria-label="Your bid"
              min={need}
              placeholder={String(need)}
              value={bids[a.id] ?? ''}
              onChange={(e) => setBids((b) => ({ ...b, [a.id]: e.target.value }))}
              className="min-w-0 flex-1"
              disabled={top}
            />
            <Button
              size="sm"
              variant="primary"
              disabled={top || (wallet?.coins ?? 0) < Number(bids[a.id] || need)}
              loading={busy === a.id}
              onClick={() => bid(a)}
            >
              <Gavel /> Bid
            </Button>
          </div>
        )}
        {live && mine && !a.topBidder && (
          <Button
            size="sm"
            className="mt-3 w-full"
            loading={busy === a.id}
            onClick={() => cancel(a)}
          >
            Call it off
          </Button>
        )}
      </li>
    )
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="flex-1 text-[13px] text-fg-muted">
          Bid on items people put up. Coins are held while you're on top and come back if someone
          outbids you. A bid in the last 2 minutes adds time. Sellers get{' '}
          {Math.round(AUCTION.share * 100)}%.
        </p>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Gavel /> Start an auction
        </Button>
      </div>
      {!open.length ? (
        <p className="py-10 text-center text-[13px] text-fg-subtle">
          No auctions right now. Start one!
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{open.map(card)}</ul>
      )}
      {ended.length > 0 && (
        <>
          <h3 className="mt-8 mb-3 text-[14px] font-semibold">Ended today</h3>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {ended.map(card)}
          </ul>
        </>
      )}
      {creating && <StartAuction wallet={wallet} onClose={() => setCreating(false)} />}
    </div>
  )
}

function StartAuction({ wallet, onClose }: { wallet: Wallet | undefined; onClose: () => void }) {
  const { api, org } = useOrgContext()
  const qc = useQueryClient()
  const catalog = useCatalog()
  const items = (wallet?.owned ?? [])
    .map((id) => catalog.get(id))
    .filter((it): it is ShopItem => !!it && it.visibility !== 'private')
  const [itemId, setItemId] = useState(items[0]?.itemId ?? '')
  const [price, setPrice] = useState(50)
  const [hours, setHours] = useState<number>(6)
  const [busy, setBusy] = useState(false)
  const it = catalog.get(itemId)

  const start = async () => {
    setBusy(true)
    try {
      qc.setQueryData(
        ['auctions', org.id],
        await post<Auction[]>(`${api}/auctions`, { itemId, startPrice: price, hours }),
      )
      void qc.invalidateQueries({ queryKey: ['wallet'] })
      toast.success('Your auction is live! 🔨')
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Start an auction"
        description="The item leaves your stuff while it runs. No bids? You get it back."
      >
        {!items.length ? (
          <p className="text-[13px] text-fg-subtle">You don't have anything to auction yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Item">
              {(p) => (
                <Select {...p} value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  {items.map((x) => (
                    <option key={x.itemId} value={x.itemId}>
                      {x.name}
                      {wallet?.serials[x.itemId] ? ` #${wallet.serials[x.itemId]}` : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {it && (
              <div className="flex justify-center">
                <div className="w-40">
                  <ItemPreview it={it} compact />
                </div>
              </div>
            )}
            <Field label="Starting price">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={AUCTION.start.min}
                  max={AUCTION.start.max}
                  value={price}
                  onChange={(e) => setPrice(Math.max(1, Number(e.target.value) || 1))}
                />
              )}
            </Field>
            <Field label="Runs for">
              {(p) => (
                <Select
                  {...p}
                  value={String(hours)}
                  onChange={(e) => setHours(Number(e.target.value))}
                >
                  {AUCTION.hours.map((h) => (
                    <option key={h} value={h}>
                      {h} hour{h === 1 ? '' : 's'}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!itemId || price < AUCTION.start.min}
            loading={busy}
            onClick={start}
          >
            <Gavel /> Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

'use client'
/**
 * WickyChat trading: send someone an offer (your items, crates and coins for some of theirs).
 * Nothing moves until they accept, then it all swaps at once.
 */
import {
  crateById,
  type Inventory,
  TRADE_LIMITS,
  type Trade,
  type TradeSide,
  type Wallet,
} from '@quid/shared'
import {
  Avatar,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  Input,
  Skeleton,
  toast,
} from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Check, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PeoplePicker } from '@/components/dialogs/people-picker'
import { useOrgContext } from '@/components/org-context'
import { errorMessage, get, post } from '@/lib/api'
import { displayName, relative } from '@/lib/format'
import { keys, useMembers } from '@/lib/queries'
import { CrateArt } from './crates'
import { cosmeticItem, ItemPreview, type ShopItem } from './items'

type Catalog = Map<string, ShopItem>

export function useTrades() {
  const { org, api } = useOrgContext()
  return useQuery({
    queryKey: ['trades', org.id],
    queryFn: ({ signal }) => get<Trade[]>(`${api}/trades`, signal),
    refetchInterval: 45_000,
  })
}

const EMPTY: TradeSide = { items: [], crates: [], coins: 0 }

/** A tiny tile for something in a trade. */
function Chip({
  it,
  crateId,
  coins,
  selected,
  onClick,
}: {
  it?: ShopItem
  crateId?: string
  coins?: number
  selected?: boolean
  onClick?: () => void
}) {
  const crate = crateById(crateId)
  const body = (
    <>
      <div className="flex h-16 w-full items-center justify-center overflow-hidden">
        {it ? (
          <ItemPreview it={it} compact />
        ) : crate ? (
          <CrateArt crate={crate} size="sm" />
        ) : (
          <span className="text-3xl">🪙</span>
        )}
      </div>
      <p className="w-full truncate text-center text-2xs font-medium">
        {it?.name ?? crate?.name ?? `${coins?.toLocaleString()} coins`}
      </p>
    </>
  )
  const cls = cn(
    'flex w-24 flex-col items-center gap-1 rounded-lg border p-1.5',
    selected ? 'border-accent bg-accent-subtle' : 'border-border',
  )
  return onClick ? (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(cls, 'hover:border-border-strong')}
      onClick={onClick}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

function SideView({ s, t, catalog }: { s: TradeSide; t: Trade; catalog: Catalog }) {
  const extra = new Map(t.cosmetics.map((c) => [`u:${c.id}`, cosmeticItem(c)]))
  if (!s.items.length && !s.crates.length && !s.coins)
    return <p className="text-xs text-fg-subtle">Nothing</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {s.items.map((id) => {
        const it = catalog.get(id) ?? extra.get(id)
        return it ? <Chip key={id} it={it} /> : null
      })}
      {s.crates.map((id) => (
        <Chip key={id} crateId={t.crateKinds[id]} />
      ))}
      {!!s.coins && <Chip coins={s.coins} />}
    </div>
  )
}

const STATUS: Record<Trade['status'], string> = {
  pending: '⏳ Waiting',
  accepted: '✅ Done',
  declined: '❌ Declined',
  cancelled: 'Cancelled',
  failed: '⚠️ Failed (something was gone)',
}

function TradeCard({ t, catalog }: { t: Trade; catalog: Catalog }) {
  const { me, api, org } = useOrgContext()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const incoming = t.to.id === me.id
  const other = incoming ? t.from : t.to
  const act = async (action: 'accept' | 'decline' | 'cancel') => {
    setBusy(action)
    try {
      await post(`${api}/trades/${t.id}/${action}`)
      if (action === 'accept') toast.success('Trade done! 🔁')
      void qc.invalidateQueries({ queryKey: ['wallet'] })
      void qc.invalidateQueries({ queryKey: keys.me })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
      void qc.invalidateQueries({ queryKey: ['trades', org.id] })
    }
  }
  return (
    <li className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-center gap-2 text-[13px]">
        <Avatar name={other.name} id={other.id} src={other.avatarUrl} size="sm" />
        <span className="flex-1">
          {incoming ? (
            <>
              <strong>{displayName(other)}</strong> wants to trade
            </>
          ) : (
            <>
              Your offer to <strong>{displayName(other)}</strong>
            </>
          )}
        </span>
        <span className="text-xs text-fg-subtle">
          {t.status === 'pending' ? relative(t.createdAt) : STATUS[t.status]}
        </span>
      </div>
      {t.note && <p className="mb-3 text-[13px] text-fg-muted">“{t.note}”</p>}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
        <div>
          <p className="mb-1.5 text-2xs font-semibold text-fg-subtle uppercase">
            {incoming ? 'You get' : 'You give'}
          </p>
          <SideView s={t.give} t={t} catalog={catalog} />
        </div>
        <ArrowLeftRight className="hidden size-4 self-center text-fg-subtle sm:block" />
        <div>
          <p className="mb-1.5 text-2xs font-semibold text-fg-subtle uppercase">
            {incoming ? 'You give' : 'You get'}
          </p>
          <SideView s={t.get} t={t} catalog={catalog} />
        </div>
      </div>
      {t.status === 'pending' && (
        <div className="mt-3 flex justify-end gap-2">
          {incoming ? (
            <>
              <Button size="sm" loading={busy === 'decline'} onClick={() => act('decline')}>
                <X /> Decline
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={busy === 'accept'}
                onClick={() => act('accept')}
              >
                <Check /> Accept
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'cancel'}
              onClick={() => act('cancel')}
            >
              Cancel offer
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

/** Picking items and crates (and coins) for one side of a new trade. */
function Picker({
  inv,
  value,
  onChange,
  catalog,
  maxCoins,
}: {
  inv: Inventory | undefined
  value: TradeSide
  onChange: (s: TradeSide) => void
  catalog: Catalog
  maxCoins: number
}) {
  const extra = useMemo(
    () => new Map((inv?.cosmetics ?? []).map((c) => [`u:${c.id}`, cosmeticItem(c)])),
    [inv],
  )
  if (!inv) return <Skeleton className="h-32" />
  const toggle = <K extends 'items' | 'crates'>(k: K, id: string) =>
    onChange({
      ...value,
      [k]: value[k].includes(id)
        ? value[k].filter((x) => x !== id)
        : value[k].length >= TRADE_LIMITS[k]
          ? value[k]
          : [...value[k], id],
    })
  const items = inv.items
    .map((id) => catalog.get(id) ?? extra.get(id))
    .filter((x): x is ShopItem => !!x)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex max-h-60 flex-wrap gap-1.5 overflow-y-auto">
        {!items.length && !inv.crates.length && (
          <p className="text-xs text-fg-subtle">No items or crates.</p>
        )}
        {items.map((it) => (
          <Chip
            key={it.itemId}
            it={it}
            selected={value.items.includes(it.itemId)}
            onClick={() => toggle('items', it.itemId)}
          />
        ))}
        {inv.crates.map((c) => (
          <Chip
            key={c.id}
            crateId={c.crateId}
            selected={value.crates.includes(c.id)}
            onClick={() => toggle('crates', c.id)}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        🪙 Coins
        <Input
          type="number"
          min={0}
          max={Math.min(maxCoins, TRADE_LIMITS.coins)}
          aria-label="Coins"
          value={value.coins || ''}
          placeholder="0"
          onChange={(e) =>
            onChange({
              ...value,
              coins: Math.max(0, Math.min(TRADE_LIMITS.coins, Number(e.target.value) || 0)),
            })
          }
          className="w-28"
        />
      </div>
    </div>
  )
}

export function NewTradeDialog({
  wallet,
  catalog,
  presetTo,
  onClose,
}: {
  wallet: Wallet | undefined
  catalog: Catalog
  presetTo?: string
  onClose: () => void
}) {
  const { me, org, api } = useOrgContext()
  const qc = useQueryClient()
  const members = useMembers(org.id)
  const [to, setTo] = useState<string[]>(presetTo ? [presetTo] : [])
  const [give, setGive] = useState<TradeSide>(EMPTY)
  const [want, setWant] = useState<TradeSide>(EMPTY)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const person = members.data?.find((m) => m.id === to[0])
  const mineInv = useQuery({
    queryKey: ['inventory', org.id, me.id],
    queryFn: ({ signal }) => get<Inventory>(`${api}/members/${me.id}/inventory`, signal),
  })
  const theirs = useQuery({
    queryKey: ['inventory', org.id, to[0]],
    queryFn: ({ signal }) => get<Inventory>(`${api}/members/${to[0]}/inventory`, signal),
    enabled: !!to[0],
  })
  const empty = (s: TradeSide) => !s.items.length && !s.crates.length && !s.coins

  const send = async () => {
    if (!to[0]) return
    setBusy(true)
    try {
      await post(`${api}/trades`, { to: to[0], give, get: want, note })
      toast.success(`Offer sent to ${person ? displayName(person) : 'them'} 🔁`)
      void qc.invalidateQueries({ queryKey: ['trades', org.id] })
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
        title={person ? `Trade with ${displayName(person)}` : 'New trade'}
        description="Pick what you give and what you want. They have to accept before anything moves."
        className="max-w-3xl"
      >
        {!to[0] ? (
          <PeoplePicker
            value={to}
            onChange={(ids) => setTo(ids.slice(-1))}
            exclude={[me.id]}
            autoFocus
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-lg border border-border p-3">
                <p className="mb-2 text-[13px] font-semibold">You give</p>
                <Picker
                  inv={mineInv.data}
                  value={give}
                  onChange={setGive}
                  catalog={catalog}
                  maxCoins={wallet?.coins ?? 0}
                />
              </section>
              <section className="rounded-lg border border-border p-3">
                <p className="mb-2 flex items-center justify-between text-[13px] font-semibold">
                  You want
                  {!presetTo && (
                    <button
                      type="button"
                      className="text-xs font-normal text-accent-text hover:underline"
                      onClick={() => {
                        setTo([])
                        setWant(EMPTY)
                      }}
                    >
                      Change person
                    </button>
                  )}
                </p>
                <Picker
                  inv={theirs.data}
                  value={want}
                  onChange={setWant}
                  catalog={catalog}
                  maxCoins={TRADE_LIMITS.coins}
                />
              </section>
            </div>
            <Input
              placeholder="Add a note (optional)"
              maxLength={140}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="text-xs text-fg-subtle">
              Private items can't be traded. Things they already own can't be offered to them.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!to[0] || empty(give) || empty(want)}
            loading={busy}
            onClick={send}
          >
            <ArrowLeftRight /> Send offer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TradesView({
  wallet,
  catalog,
  presetTo,
}: {
  wallet: Wallet | undefined
  catalog: Catalog
  presetTo?: string
}) {
  const { me } = useOrgContext()
  const trades = useTrades()
  const [making, setMaking] = useState<boolean | string>(presetTo ?? false)
  const list = trades.data ?? []
  const incoming = list.filter((t) => t.status === 'pending' && t.to.id === me.id)
  const outgoing = list.filter((t) => t.status === 'pending' && t.from.id === me.id)
  const done = list.filter((t) => t.status !== 'pending').slice(0, 15)

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-gradient-to-r from-[#3b8fc9]/10 to-[#8052ff]/10 p-4">
        <ArrowLeftRight className="size-5 text-accent-text" />
        <p className="flex-1 text-[13px] text-fg-muted">
          Swap items, crates and coins with anyone in your school. Both of you have to agree.
        </p>
        <Button variant="primary" onClick={() => setMaking(true)}>
          New trade
        </Button>
      </div>
      {trades.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <section>
            <h3 className="mb-3 text-[14px] font-semibold">Offers for you</h3>
            {!incoming.length ? (
              <p className="text-[13px] text-fg-subtle">No offers right now.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {incoming.map((t) => (
                  <TradeCard key={t.id} t={t} catalog={catalog} />
                ))}
              </ul>
            )}
          </section>
          {!!outgoing.length && (
            <section>
              <h3 className="mb-3 text-[14px] font-semibold">Your offers</h3>
              <ul className="flex flex-col gap-3">
                {outgoing.map((t) => (
                  <TradeCard key={t.id} t={t} catalog={catalog} />
                ))}
              </ul>
            </section>
          )}
          {!!done.length && (
            <section>
              <h3 className="mb-3 text-[14px] font-semibold">History</h3>
              <ul className="flex flex-col gap-3">
                {done.map((t) => (
                  <TradeCard key={t.id} t={t} catalog={catalog} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {making && (
        <NewTradeDialog
          wallet={wallet}
          catalog={catalog}
          presetTo={typeof making === 'string' ? making : undefined}
          onClose={() => setMaking(false)}
        />
      )}
    </div>
  )
}

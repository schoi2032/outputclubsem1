'use client'
/**
 * WickyChat bundles: several items bought at once. Built-in ones plus ones students make from
 * their own cosmetics and Shop items.
 */
import {
  BUNDLES,
  type BundleDef,
  bundleFloor,
  CREATOR_SHARE,
  CUSTOM_BUNDLE,
  type CustomBundle,
  customBundleDef,
  isEventLive,
  seasonEventById,
  type Wallet,
} from '@quid/shared'
import { Button, cn, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Gift } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { del, errorMessage, get, post } from '@/lib/api'
import { displayName } from '@/lib/format'
import { keys, useMembers } from '@/lib/queries'
import { CrateArt, GiftDialog, PackFields } from './crates'
import { ItemPicker, ItemPreview, type ShopItem } from './items'

type Catalog = Map<string, ShopItem>

export function useBundleDefs() {
  const { org, api } = useOrgContext()
  const q = useQuery({
    queryKey: ['custom-bundles', org.id],
    queryFn: ({ signal }) => get<CustomBundle[]>(`${api}/bundles/custom`, signal),
    staleTime: 60_000,
  })
  return useMemo(() => {
    const custom = (q.data ?? []).map(customBundleDef)
    const map = new Map(custom.map((c) => [c.id, c]))
    return {
      raw: q.data ?? [],
      custom,
      byId: (id: string | null | undefined) =>
        BUNDLES.find((b) => b.id === id) ?? (id ? map.get(id) : undefined),
    }
  }, [q.data])
}

/** Looks like a crate box, so bundles and crates match. */
const art = (b: BundleDef) => ({
  id: b.id,
  name: b.name,
  emoji: b.emoji,
  description: b.description,
  price: b.price,
  colors: b.colors,
  drops: [],
})

export function BundleCard({
  b,
  catalog,
  wallet,
  onBuy,
  onGift,
  onTakeDown,
  busy,
}: {
  b: BundleDef
  catalog: Catalog
  wallet: Wallet | undefined
  onBuy: () => void
  onGift: () => void
  onTakeDown?: () => void
  busy: boolean
}) {
  const items = b.items.map((id) => catalog.get(id)).filter((x): x is ShopItem => !!x)
  const worth = items.reduce((n, it) => n + it.price, 0)
  const owned = b.items.filter((id) => wallet?.owned.includes(id)).length
  const all = owned === b.items.length
  const afford = (wallet?.coins ?? 0) >= b.price
  const ev = seasonEventById(b.event)
  const live = !b.event || isEventLive(b.event)
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex items-center gap-3">
        <CrateArt crate={art(b)} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">{b.name}</p>
          <p className="text-xs text-fg-muted">
            {b.items.length} items
            {worth > b.price && (
              <span className="ml-1 font-semibold text-success">
                · save {Math.round((1 - b.price / worth) * 100)}%
              </span>
            )}
            {ev && ` · ${ev.emoji} ${ev.name}`}
          </p>
          {b.creator && (
            <p className="text-2xs text-fg-subtle">
              by {displayName(b.creator)}
              {onTakeDown && (
                <button
                  type="button"
                  className="ml-2 text-danger hover:underline"
                  onClick={onTakeDown}
                >
                  Take off sale
                </button>
              )}
            </p>
          )}
        </div>
      </div>
      {b.description && <p className="text-xs text-fg-muted">{b.description}</p>}
      <ul className="grid grid-cols-3 gap-1.5">
        {items.slice(0, 6).map((it) => (
          <li
            key={it.itemId}
            title={it.name}
            className={cn(
              'flex flex-col items-center overflow-hidden rounded-lg border border-border p-1',
              wallet?.owned.includes(it.itemId) && 'opacity-50',
            )}
          >
            <div className="flex h-16 w-full items-center justify-center overflow-hidden">
              <ItemPreview it={it} compact />
            </div>
            <span className="w-full truncate text-center text-2xs">{it.name}</span>
          </li>
        ))}
      </ul>
      {items.length > 6 && <p className="text-2xs text-fg-subtle">+{items.length - 6} more</p>}
      <div className="mt-auto flex items-center gap-1.5">
        <Button
          size="sm"
          className="flex-1 tabular-nums"
          variant={afford && !all && live ? 'primary' : 'secondary'}
          disabled={!afford || all || !live || !wallet}
          loading={busy}
          onClick={onBuy}
        >
          {all ? 'You own all of it' : !live ? 'Event over' : `🪙 ${b.price}`}
          {worth > b.price && !all && live && (
            <span className="text-2xs line-through opacity-70">{worth}</span>
          )}
        </Button>
        <Button
          size="sm"
          title="Gift it"
          aria-label={`Gift ${b.name}`}
          disabled={!live || !afford}
          onClick={onGift}
        >
          <Gift />
        </Button>
      </div>
      {!!owned && !all && (
        <p className="-mt-1 text-2xs text-fg-subtle">
          You own {owned} of these already (dimmed). You still pay the full price.
        </p>
      )}
    </li>
  )
}

export function BundlesView({
  wallet,
  catalog,
  onlyEvent,
}: {
  wallet: Wallet | undefined
  catalog: Catalog
  onlyEvent?: string
}) {
  const { org, me } = useOrgContext()
  const qc = useQueryClient()
  const members = useMembers(org.id)
  const defs = useBundleDefs()
  const [busy, setBusy] = useState<string | null>(null)
  const [gift, setGift] = useState<BundleDef | null>(null)
  const isTeacher = org.role === 'owner' || org.role === 'admin'
  const builtin = BUNDLES.filter((b) =>
    onlyEvent ? b.event === onlyEvent : !b.event || isEventLive(b.event),
  )
  const student = onlyEvent ? [] : defs.custom.filter((b) => !b.removed)

  const buy = async (b: BundleDef, giftTo?: string) => {
    setBusy(b.id)
    try {
      const w = await post<Wallet>('/api/me/bundles/buy', { bundleId: b.id, giftTo })
      qc.setQueryData(['wallet'], w)
      void qc.invalidateQueries({ queryKey: keys.me })
      void qc.invalidateQueries({ queryKey: ['cosmetics', org.id] })
      const m = members.data?.find((x) => x.id === giftTo)
      toast.success(
        giftTo ? `Sent ${b.name} to ${m ? displayName(m) : 'them'} 🎁` : `${b.name} is yours! ✨`,
      )
    } catch (e) {
      toast.error(errorMessage(e))
      throw e
    } finally {
      setBusy(null)
    }
  }
  const takeDown = async (b: BundleDef) => {
    try {
      await del(`/api/orgs/${org.id}/bundles/custom/${b.id.slice(2)}`)
      toast.success(`${b.name} is off sale.`)
      void qc.invalidateQueries({ queryKey: ['custom-bundles', org.id] })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const card = (b: BundleDef) => (
    <BundleCard
      key={b.id}
      b={b}
      catalog={catalog}
      wallet={wallet}
      busy={busy === b.id}
      onBuy={() => buy(b).catch(() => {})}
      onGift={() => setGift(b)}
      onTakeDown={
        b.creator && (b.creator.id === me.id || isTeacher) ? () => takeDown(b) : undefined
      }
    />
  )

  return (
    <div className="flex flex-col gap-8">
      <section>
        {!onlyEvent && (
          <p className="mb-3 text-xs text-fg-muted">
            Bundles give you everything inside at once, usually cheaper than buying each one.
          </p>
        )}
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {builtin.map(card)}
        </ul>
      </section>
      {!onlyEvent && (
        <section>
          <h3 className="mb-1 text-[14px] font-semibold">🎨 Student bundles</h3>
          <p className="mb-3 text-xs text-fg-muted">Make your own in Create → Bundle.</p>
          {!student.length ? (
            <p className="text-[13px] text-fg-subtle">No student bundles yet. Be the first!</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {student.map(card)}
            </ul>
          )}
        </section>
      )}
      {gift && (
        <GiftDialog
          title={`Gift ${gift.name}`}
          description={`You pay 🪙 ${gift.price}. They get everything in it they don't already have.`}
          onClose={() => setGift(null)}
          onSend={(to) => buy(gift, to)}
        />
      )}
    </div>
  )
}

/** Students make bundles from their own cosmetics and Shop items. */
export function CreateBundle() {
  const { org, api } = useOrgContext()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🎁')
  const [description, setDescription] = useState('')
  const [colors, setColors] = useState<[string, string]>(['#15846e', '#8052ff'])
  const [price, setPrice] = useState(200)
  const [items, setItems] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const floor = bundleFloor(items)
  const minPrice = Math.max(CUSTOM_BUNDLE.price.min, floor)
  // Adding Shop items raises the lowest price; follow it so the form stays valid.
  useEffect(() => {
    setPrice((p) => Math.max(p, minPrice))
  }, [minPrice])
  const earn = Math.floor(Math.max(0, price - floor) * CREATOR_SHARE)

  const submit = async () => {
    setSaving(true)
    try {
      await post(`${api}/bundles/custom`, { name, emoji, description, colors, price, items })
      toast.success('Your bundle is on sale in the Bundles tab! 🎁')
      setName('')
      setDescription('')
      setItems([])
      void qc.invalidateQueries({ queryKey: ['custom-bundles', org.id] })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_260px]">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <PackFields
          what="bundle"
          name={name}
          setName={setName}
          emoji={emoji}
          setEmoji={setEmoji}
          description={description}
          setDescription={setDescription}
          colors={colors}
          setColors={setColors}
          price={price}
          setPrice={setPrice}
          minPrice={minPrice}
          maxPrice={CUSTOM_BUNDLE.price.max}
          note={
            floor
              ? `The Shop items inside cost 🪙 ${floor} together, so that's the lowest price. You earn ${Math.round(CREATOR_SHARE * 100)}% of the part above it: 🪙 ${earn} a sale.`
              : `You get ${Math.round(CREATOR_SHARE * 100)}% of every sale.`
          }
        />
        <div>
          <p className="mb-1 text-[13px] font-medium">
            What's in it ({items.length}/{CUSTOM_BUNDLE.maxItems})
          </p>
          <ItemPicker
            selected={items}
            max={CUSTOM_BUNDLE.maxItems}
            onToggle={(id) =>
              setItems((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))
            }
          />
        </div>
        <p className="text-xs text-fg-subtle">
          Buyers get everything inside they don't already have. Teachers can take bundles off sale.
        </p>
        <div>
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={
              items.length < CUSTOM_BUNDLE.minItems || name.trim().length < 2 || price < minPrice
            }
          >
            Put it on sale
          </Button>
        </div>
      </form>
      <div className="flex flex-col items-center gap-3 self-start rounded-xl border border-border p-5">
        <p className="text-2xs font-semibold text-fg-subtle uppercase">Preview</p>
        <CrateArt
          crate={art({ id: 'p', name, emoji: emoji || '🎁', description, price, colors, items })}
          size="lg"
        />
        <p className="text-[14px] font-semibold">{name || 'Your bundle'}</p>
        <p className="text-xs text-fg-muted">
          🪙 {price} · {items.length} items
        </p>
      </div>
    </div>
  )
}

/** Your bundles on sale, in My stuff. */
export function MyBundles() {
  const { me, org, api } = useOrgContext()
  const qc = useQueryClient()
  const defs = useBundleDefs()
  const mine = defs.raw.filter((c) => c.creator.id === me.id)
  if (!mine.length) return null
  return (
    <section className="mt-10">
      <h3 className="mb-3 text-[14px] font-semibold">Your bundles</h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {mine.map((c) => (
          <li key={c.id} className="flex items-center gap-4 p-3 text-[13px]">
            <CrateArt crate={art(customBundleDef(c))} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {c.name} <span className="text-fg-subtle">· 🪙 {c.price}</span>
              </p>
              <p className={c.status === 'active' ? 'text-success' : 'text-fg-subtle'}>
                {c.status === 'active' ? '✅ On sale' : 'Off sale'} · {c.sales} sold ·{' '}
                {c.items.length} items
              </p>
            </div>
            {c.status === 'active' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await del(`${api}/bundles/custom/${c.id}`)
                    void qc.invalidateQueries({ queryKey: ['custom-bundles', org.id] })
                  } catch (e) {
                    toast.error(errorMessage(e))
                  }
                }}
              >
                Take off sale
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

'use client'
/** WickyChat: the trade-up contract. 5 items of one tier in, 1 of the next tier out. */
import {
  type CrateDef,
  type CrateTier,
  nextTier,
  TIER_STYLE,
  TRADE_UP,
  type TradeUpResult,
  tierOfPrice,
  type Wallet,
} from '@quid/shared'
import { Button, cn, Dialog, DialogContent, DialogFooter, toast } from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { FlaskConical } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { errorMessage, post } from '@/lib/api'
import { DropTile, Reel } from './crates'
import { ItemPreview, type ShopItem, useCatalog } from './items'

export function TradeUpPanel({ wallet }: { wallet: Wallet | undefined }) {
  const { api } = useOrgContext()
  const qc = useQueryClient()
  const catalog = useCatalog()
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [spin, setSpin] = useState<TradeUpResult | null>(null)
  const [revealed, setRevealed] = useState(false)

  // Items that can go in: not limited, not private.
  const eligible = useMemo(() => {
    const out: (ShopItem & { tier: CrateTier })[] = []
    for (const id of wallet?.owned ?? []) {
      const it = catalog.get(id)
      if (!it || wallet?.serials[id] || it.visibility === 'private') continue
      const tier = tierOfPrice(it.price)
      if (nextTier(tier)) out.push({ ...it, tier })
    }
    return out.sort((a, b) => a.price - b.price)
  }, [wallet, catalog])
  const tier = eligible.find((e) => e.itemId === picked[0])?.tier
  const up = tier ? nextTier(tier) : null

  const toggle = (id: string, t: CrateTier) => {
    if (picked.includes(id)) return setPicked(picked.filter((p) => p !== id))
    if (tier && t !== tier) return toast.error('All 5 items need to be the same tier.')
    if (picked.length >= TRADE_UP.inputs) return
    setPicked([...picked, id])
  }

  const sign = async () => {
    setBusy(true)
    try {
      const r = await post<TradeUpResult & { wallet: Wallet }>(`${api}/trade-up`, {
        items: picked,
      })
      setRevealed(false)
      setSpin(r)
      qc.setQueryData(['wallet'], r.wallet)
      void qc.invalidateQueries({ queryKey: ['achievements'] })
      setPicked([])
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const reelCrate: CrateDef | null = spin
    ? {
        id: 'trade-up',
        name: 'Trade-up',
        emoji: '🧪',
        description: '',
        price: 0,
        colors: ['#000', '#000'],
        drops: spin.pool.map((item) => ({ tier: spin.tier, item })),
      }
    : null

  return (
    <section className="mt-10">
      <h3 className="mb-1 flex items-center gap-1.5 text-[14px] font-semibold">
        <FlaskConical className="size-4" /> Trade-up contract
      </h3>
      <p className="mb-3 text-xs text-fg-muted">
        Put in {TRADE_UP.inputs} items of the same tier and get 1 random item of the next tier that
        you don't own yet. It can even give seasonal items whose event is over.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {Array.from({ length: TRADE_UP.inputs }, (_, i) => {
          const it = catalog.get(picked[i] ?? '')
          return (
            <button
              key={i}
              type="button"
              disabled={!it}
              onClick={() => it && setPicked(picked.filter((p) => p !== it.itemId))}
              className={cn(
                'flex h-16 w-20 items-center justify-center overflow-hidden rounded-lg border text-2xs',
                it
                  ? 'border-accent bg-accent-subtle'
                  : 'border-dashed border-border text-fg-subtle',
              )}
              title={it ? `Take out ${it.name}` : 'Empty slot'}
            >
              {it ? <span className="truncate px-1 font-semibold">{it.name}</span> : i + 1}
            </button>
          )
        })}
        <span className="mx-1 text-fg-subtle">→</span>
        <span
          className="rounded-full px-2 py-1 text-xs font-semibold"
          style={
            up
              ? { background: `${TIER_STYLE[up].color}22`, color: TIER_STYLE[up].color }
              : undefined
          }
        >
          {up ? `1 random ${TIER_STYLE[up].label}` : 'Pick items'}
        </span>
        <Button
          variant="primary"
          disabled={picked.length !== TRADE_UP.inputs}
          loading={busy}
          onClick={sign}
        >
          Sign contract
        </Button>
      </div>
      {!eligible.length ? (
        <p className="text-[13px] text-fg-subtle">
          You need some items first. Limited and private items can't go in.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
          {eligible.map((it) => {
            const on = picked.includes(it.itemId)
            const wrong = !!tier && it.tier !== tier
            return (
              <li key={it.itemId}>
                <button
                  type="button"
                  onClick={() => toggle(it.itemId, it.tier)}
                  aria-pressed={on}
                  className={cn(
                    'flex w-full flex-col items-center rounded-lg border p-1.5 text-center transition-opacity',
                    on
                      ? 'border-accent bg-accent-subtle'
                      : 'border-border hover:border-border-strong',
                    wrong && 'opacity-40',
                  )}
                >
                  <ItemPreview it={it} compact />
                  <span className="w-full truncate text-2xs font-semibold">{it.name}</span>
                  <span
                    className="text-[10px] font-semibold"
                    style={{ color: TIER_STYLE[it.tier].color }}
                  >
                    {TIER_STYLE[it.tier].label}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={!!spin} onOpenChange={(o) => !o && revealed && setSpin(null)}>
        <DialogContent
          title="Trade-up contract"
          description={revealed ? 'Here’s what you got!' : 'Signing…'}
          className="max-w-2xl"
        >
          {spin && reelCrate && (
            <>
              <Reel
                crate={reelCrate}
                result={{ tier: spin.tier, item: spin.item }}
                owned={new Set()}
                catalog={catalog}
                sound
                skip={false}
                onDone={() => setRevealed(true)}
              />
              {revealed && (
                <div className="mt-4 flex flex-col items-center">
                  <DropTile drop={{ tier: spin.tier, item: spin.item }} catalog={catalog} big />
                  <p className="mt-2 text-[14px] font-semibold">
                    {catalog.get(spin.item)?.name} is yours! ✨
                  </p>
                </div>
              )}
            </>
          )}
          <DialogFooter>
            <Button disabled={!revealed} onClick={() => setSpin(null)}>
              Nice!
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

'use client'
/**
 * WickyChat crates: the crate shop, your unopened crates, and opening one with a spinning reel
 * that lands on what the server rolled (like opening a case in a game).
 */
import {
  CRATES,
  CREATOR_SHARE,
  type CrateDef,
  type CrateDrop,
  type CrateResult,
  type CrateTier,
  CUSTOM_CRATE,
  type CustomCrate,
  crateById,
  crateFloor,
  crateOdds,
  customCrateDef,
  dropKey,
  effectById,
  isEventLive,
  isSpecKind,
  type SpecKind,
  STREAK_CRATE,
  TIER_ODDS,
  TIER_STYLE,
  type UserSummary,
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
  Select,
  Skeleton,
  toast,
} from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Gift, Info, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PeoplePicker } from '@/components/dialogs/people-picker'
import { useOrgContext } from '@/components/org-context'
import { NamePlate } from '@/components/profile/cosmetics-fx'
import { FlairPreview } from '@/components/shop/flair-preview'
import { ThemeSwatch } from '@/components/shop/theme-swatch'
import { del, errorMessage, get, post, put } from '@/lib/api'
import { displayName, relative } from '@/lib/format'
import { keys, useMembers } from '@/lib/queries'
import { ItemPicker, type ShopItem } from './items'
import { QtyPicker } from './qty-picker'

type Catalog = Map<string, ShopItem>

/** Built-in and student-made crates. */
export function useCrateDefs() {
  const { org, api } = useOrgContext()
  const q = useQuery({
    queryKey: ['custom-crates', org.id],
    queryFn: ({ signal }) => get<CustomCrate[]>(`${api}/crates/custom`, signal),
    staleTime: 60_000,
  })
  return useMemo(() => {
    const custom = (q.data ?? []).map(customCrateDef)
    const map = new Map(custom.map((c) => [c.id, c]))
    return {
      custom,
      byId: (id: string | null | undefined) => crateById(id) ?? (id ? map.get(id) : undefined),
    }
  }, [q.data])
}

/** The box itself. */
export function CrateArt({ crate, size = 'md' }: { crate: CrateDef; size?: 'sm' | 'md' | 'lg' }) {
  const box =
    size === 'lg' ? 'size-36 text-6xl' : size === 'sm' ? 'size-12 text-2xl' : 'size-24 text-5xl'
  return (
    <div
      aria-hidden="true"
      className={cn(
        'q-crate relative flex shrink-0 items-center justify-center rounded-2xl shadow-md',
        box,
      )}
      style={{
        background: `linear-gradient(135deg, ${crate.colors[0]}, ${crate.colors[1]})`,
      }}
    >
      <span className="drop-shadow-[0_2px_4px_rgb(0_0_0/0.35)]">{crate.emoji}</span>
      <span className="pointer-events-none absolute inset-x-0 top-1/2 h-[14%] -translate-y-1/2 bg-black/15" />
    </div>
  )
}

export function dropName(d: CrateDrop | CrateResult, catalog: Catalog) {
  if ('item' in d) return catalog.get(d.item)?.name ?? d.item
  if ('tickets' in d) return `${d.tickets} spin ticket${d.tickets === 1 ? '' : 's'}`
  return `${d.coins.toLocaleString()} coins`
}

/** One square in the reel or the odds list. */
export function DropTile({
  drop,
  catalog,
  big,
}: {
  drop: CrateDrop | CrateResult
  catalog: Catalog
  big?: boolean
}) {
  const { me } = useOrgContext()
  const it = 'item' in drop ? catalog.get(drop.item) : undefined
  const tier = TIER_STYLE[drop.tier]
  const fx = it?.kind === 'effect' ? effectById(it.itemId) : undefined
  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-between overflow-hidden rounded-lg border border-white/10 bg-gradient-to-b from-[#2a2d3a] to-[#1a1c25] text-white',
        big ? 'h-44 w-44 p-3' : 'h-28 w-28 p-2',
      )}
      style={{
        boxShadow: `inset 0 -4px 0 ${tier.color}, inset 0 -40px 40px -30px ${tier.color}55`,
      }}
    >
      <div className="flex flex-1 items-center justify-center">
        {'coins' in drop ? (
          <span className={big ? 'text-6xl' : 'text-4xl'}>🪙</span>
        ) : 'tickets' in drop ? (
          <span className={big ? 'text-6xl' : 'text-4xl'}>🎟️</span>
        ) : !it ? (
          <span className="text-3xl">❔</span>
        ) : it.kind === 'decoration' ? (
          <Avatar
            name={me.name}
            id={me.id}
            src={me.avatarUrl}
            decoration={it.decoration}
            size={big ? 'xl' : 'md'}
          />
        ) : it.kind === 'theme' ? (
          <ThemeSwatch css={it.css ?? ''} className={big ? 'h-20 w-32' : 'h-12 w-20'} />
        ) : it.kind === 'bubble' || isSpecKind(it.kind) ? (
          <span className={cn('max-w-full overflow-hidden', big ? 'scale-100' : 'scale-75')}>
            <FlairPreview kind={it.kind as SpecKind} value={it.value} compact={!big} />
          </span>
        ) : it.kind === 'plate' ? (
          <span
            className={cn(
              'relative isolate flex items-center overflow-hidden rounded-md px-2 font-semibold',
              big ? 'h-10 w-32 text-sm' : 'h-7 w-20 text-2xs',
            )}
          >
            <NamePlate value={it.value} />
            {displayName(me)}
          </span>
        ) : (
          <span className={cn('tracking-tight', big ? 'text-4xl' : 'text-2xl')}>
            {(fx?.particles ?? [fx?.particle ?? '✨']).slice(0, 3).join('')}
          </span>
        )}
      </div>
      <p
        className={cn(
          'w-full truncate text-center font-semibold',
          big ? 'text-[14px]' : 'text-[11px]',
        )}
      >
        {dropName(drop, catalog)}
      </p>
    </div>
  )
}

// --- Reel ---------------------------------------------------------------------------------

const TILE = 120
const WIN = 46
const COUNT = 54
const SOUND_KEY = 'wicky-crate-sound'

function pick(odds: { drop: CrateDrop; chance: number }[]) {
  let r = Math.random() * 100
  for (const o of odds) {
    r -= o.chance
    if (r < 0) return o.drop
  }
  return odds[odds.length - 1]!.drop
}

/** A short click as each tile passes the middle. */
function useTick(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null)
  return () => {
    if (!enabled) return
    try {
      ctxRef.current ??= new AudioContext()
      const ac = ctxRef.current
      const o = ac.createOscillator()
      const g = ac.createGain()
      o.frequency.value = 1600
      g.gain.setValueAtTime(0.04, ac.currentTime)
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.03)
      o.connect(g).connect(ac.destination)
      o.start()
      o.stop(ac.currentTime + 0.035)
    } catch {
      // No sound, no problem.
    }
  }
}

export function Reel({
  crate,
  result,
  owned,
  catalog,
  sound,
  skip,
  onDone,
}: {
  crate: CrateDef
  result: CrateResult
  owned: Set<string>
  catalog: Catalog
  sound: boolean
  skip: boolean
  onDone: () => void
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per opening / spin
  const tiles = useMemo(() => {
    const odds = crateOdds(crate, owned)
    return Array.from({ length: COUNT }, (_, i) => (i === WIN ? result : pick(odds)))
  }, [crate, result])
  const wrap = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const [x, setX] = useState<number | null>(null)
  const tick = useTick(sound)
  const done = useRef(false)
  const finish = () => {
    if (done.current) return
    done.current = true
    onDone()
  }

  useEffect(() => {
    const w = wrap.current?.clientWidth ?? 600
    const jitter = (Math.random() - 0.5) * TILE * 0.7
    const target = -(WIN * TILE + TILE / 2 - w / 2 + jitter)
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setX(target)))
    return () => cancelAnimationFrame(id)
  }, [])

  // Click as tiles pass the marker.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per opening / spin
  useEffect(() => {
    if (x == null || skip) return
    let last = -1
    let raf = 0
    const loop = () => {
      const el = strip.current
      const w = wrap.current?.clientWidth ?? 600
      if (el) {
        const now = new DOMMatrixReadOnly(getComputedStyle(el).transform).m41
        const idx = Math.floor((w / 2 - now) / TILE)
        if (idx !== last) {
          if (last !== -1) tick()
          last = idx
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [x, skip])

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per opening / spin
  useEffect(() => {
    if (skip) finish()
  }, [skip])

  return (
    <div
      ref={wrap}
      className="relative overflow-hidden rounded-xl border border-border bg-[#101218] py-3"
    >
      <div
        ref={strip}
        className="flex will-change-transform"
        style={{
          transform: `translateX(${x ?? 0}px)`,
          transition:
            x == null || skip ? 'none' : 'transform 6.5s cubic-bezier(0.08, 0.72, 0.14, 1)',
        }}
        onTransitionEnd={finish}
      >
        {tiles.map((d, i) => (
          <div key={i} className="flex shrink-0 justify-center" style={{ width: TILE }}>
            <DropTile drop={d} catalog={catalog} />
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-[#f0b400] shadow-[0_0_10px_#f0b400]" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-[#101218] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[#101218] to-transparent" />
    </div>
  )
}

/** Opening a crate: confirm, spin, reveal. */
function OpenDialog({
  crateRowId,
  wallet,
  catalog,
  onClose,
  onOpenNext,
}: {
  crateRowId: string
  wallet: Wallet
  catalog: Catalog
  onClose: () => void
  onOpenNext: (id: string) => void
}) {
  const qc = useQueryClient()
  // Kept from the start: once it's opened, the crate leaves the wallet.
  const defs = useCrateDefs()
  const [crate] = useState(() => defs.byId(wallet.crates.find((c) => c.id === crateRowId)?.crateId))
  const [owned] = useState(() => new Set(wallet.owned))
  const [phase, setPhase] = useState<'ready' | 'spinning' | 'done'>('ready')
  const [result, setResult] = useState<CrateResult | null>(null)
  const [next, setNext] = useState<Wallet | null>(null)
  const [skip, setSkip] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem(SOUND_KEY) !== 'off'
    } catch {
      return true
    }
  })
  const toggleSound = () => {
    setSound((s) => {
      try {
        localStorage.setItem(SOUND_KEY, s ? 'off' : 'on')
      } catch {}
      return !s
    })
  }

  const open = async () => {
    setBusy(true)
    try {
      const r = await post<{ result: CrateResult; wallet: Wallet }>(
        `/api/me/crates/${crateRowId}/open`,
      )
      setResult(r.result)
      setNext(r.wallet)
      setPhase('spinning')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const reveal = () => {
    setPhase('done')
    if (next) qc.setQueryData(['wallet'], next)
    void qc.invalidateQueries({ queryKey: ['crates-opened'] })
  }

  const wear = async () => {
    if (!result || !('item' in result)) return
    const it = catalog.get(result.item)
    if (!it) return
    try {
      const w =
        it.kind === 'theme'
          ? await put<Wallet>('/api/me/theme', { itemId: it.itemId })
          : it.kind === 'decoration'
            ? await put<Wallet>('/api/me/decoration', { itemId: it.itemId })
            : await put<Wallet>('/api/me/equip', { slot: it.kind, itemId: it.itemId })
      qc.setQueryData(['wallet'], w)
      void qc.invalidateQueries({ queryKey: keys.me })
      void qc.invalidateQueries({ queryKey: ['members'] })
      toast.success(`Now ${it.kind === 'theme' ? 'using' : 'wearing'} ${it.name} ✨`)
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (!crate) return null
  const another = (next ?? wallet).crates.find((c) => c.crateId === crate.id && c.id !== crateRowId)
  const tier = result ? TIER_STYLE[result.tier] : null
  const canWear = result && 'item' in result && catalog.has(result.item)

  return (
    <Dialog open onOpenChange={(o) => !o && phase !== 'spinning' && onClose()}>
      <DialogContent title={`Open ${crate.name}`} className="max-w-2xl">
        {phase === 'ready' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="q-crate-idle">
              <CrateArt crate={crate} size="lg" />
            </div>
            <p className="max-w-sm text-center text-[13px] text-fg-muted">{crate.description}</p>
            <p className="text-xs text-fg-subtle">
              You never get something you already own. If you own it all, you get coins.
            </p>
          </div>
        )}
        {phase !== 'ready' && result && (
          <div className="flex flex-col gap-4">
            <Reel
              crate={crate}
              result={result}
              owned={owned}
              catalog={catalog}
              sound={sound}
              skip={skip}
              onDone={reveal}
            />
            {phase === 'done' && tier && (
              <div className="q-reveal flex flex-col items-center gap-2 py-2 text-center">
                <div
                  className="rounded-xl p-1"
                  style={{ boxShadow: `0 0 40px 6px ${tier.color}88` }}
                >
                  <DropTile drop={result} catalog={catalog} big />
                </div>
                <p
                  className="text-2xs font-bold tracking-wider uppercase"
                  style={{ color: tier.color }}
                >
                  {tier.label}
                </p>
                <p className="text-lg font-bold">
                  {'coins' in result
                    ? `+${result.coins.toLocaleString()} Wicky Coins!`
                    : 'tickets' in result
                      ? `+${result.tickets} 🎟️ spin ticket${result.tickets === 1 ? '' : 's'}! Use it in Earn.`
                      : `You got ${dropName(result, catalog)}!`}
                </p>
                {result.tier === 'legendary' && <p className="text-2xl">🎉🎉🎉</p>}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto"
            aria-label={sound ? 'Turn sound off' : 'Turn sound on'}
            onClick={toggleSound}
          >
            {sound ? <Volume2 /> : <VolumeX />}
          </Button>
          {phase === 'ready' && (
            <>
              <Button onClick={onClose}>Not yet</Button>
              <Button variant="primary" loading={busy} onClick={open}>
                Open it!
              </Button>
            </>
          )}
          {phase === 'spinning' && <Button onClick={() => setSkip(true)}>Skip</Button>}
          {phase === 'done' && (
            <>
              <Button onClick={onClose}>Done</Button>
              {another && (
                <Button onClick={() => onOpenNext(another.id)}>
                  Open another (
                  {(next ?? wallet).crates.filter((c) => c.crateId === crate.id).length})
                </Button>
              )}
              {canWear && (
                <Button variant="primary" onClick={wear}>
                  {catalog.get((result as { item: string }).item)?.kind === 'theme'
                    ? 'Use it'
                    : 'Wear it'}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OddsDialog({
  crate,
  owned,
  catalog,
  onClose,
}: {
  crate: CrateDef
  owned: Set<string>
  catalog: Catalog
  onClose: () => void
}) {
  const odds = crateOdds(crate, owned)
  const order = ['legendary', 'epic', 'rare', 'common']
  const left = new Set(odds.map((o) => dropKey(o.drop)))
  const all = [...crate.drops].sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`What's in the ${crate.name}`}
        description="Chances for you right now. Things you already own are skipped."
        className="max-w-2xl"
      >
        <ul className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {all.map((d) => {
            const k = dropKey(d)
            const o = odds.find((x) => dropKey(x.drop) === k)
            return (
              <li
                key={k}
                className={cn('flex flex-col items-center gap-1', !left.has(k) && 'opacity-40')}
              >
                <DropTile drop={d} catalog={catalog} />
                <span
                  className="text-2xs font-semibold"
                  style={{ color: TIER_STYLE[d.tier].color }}
                >
                  {o ? `${o.chance < 1 ? o.chance.toFixed(2) : o.chance.toFixed(1)}%` : 'Owned'}
                </span>
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

export function GiftDialog({
  title,
  description,
  onSend,
  onClose,
}: {
  title: string
  description: string
  onSend: (to: string) => Promise<void>
  onClose: () => void
}) {
  const { me } = useOrgContext()
  const [to, setTo] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} description={description}>
        <PeoplePicker
          value={to}
          onChange={(ids) => setTo(ids.slice(-1))}
          exclude={[me.id]}
          autoFocus
        />
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!to.length}
            loading={busy}
            onClick={async () => {
              if (!to[0]) return
              setBusy(true)
              try {
                await onSend(to[0])
                onClose()
              } catch {
                // The error was shown already; keep the dialog open.
              } finally {
                setBusy(false)
              }
            }}
          >
            <Gift /> Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface FeedRow {
  id: string
  crateId: string
  result: CrateResult
  openedAt: string
  user: UserSummary
}

export function CratesView({
  wallet,
  catalog,
  onlyEvent,
}: {
  wallet: Wallet | undefined
  catalog: Catalog
  /** Just this event's crate (on the event tab). */
  onlyEvent?: string
}) {
  const { org, api, me } = useOrgContext()
  const qc = useQueryClient()
  const members = useMembers(org.id)
  const [opening, setOpening] = useState<string | null>(null)
  const [openMany, setOpenMany] = useState<{ crate: CrateDef; have: number } | null>(null)
  const [odds, setOdds] = useState<CrateDef | null>(null)
  const [gift, setGift] = useState<{ crate: CrateDef; rowId?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const feed = useQuery({
    queryKey: ['crates-feed', org.id],
    queryFn: ({ signal }) => get<FeedRow[]>(`${api}/crates/feed`, signal),
    enabled: !onlyEvent,
    refetchInterval: 60_000,
  })
  const owned = useMemo(() => new Set(wallet?.owned ?? []), [wallet?.owned])
  const defs = useCrateDefs()
  const isTeacher = org.role === 'owner' || org.role === 'admin'
  const forSale = CRATES.filter((c) =>
    onlyEvent ? c.event === onlyEvent : !c.event || isEventLive(c.event),
  )
  const studentCrates = defs.custom.filter((c) => !c.removed)
  const mine = wallet?.crates ?? []
  const groups = [...CRATES, ...defs.custom]
    .map((c) => ({
      crate: c,
      rows: mine.filter((r) => r.crateId === c.id),
    }))
    .filter((g) => g.rows.length && (!onlyEvent || g.crate.event === onlyEvent))
  const nameOf = (id: string) => {
    const m = members.data?.find((x) => x.id === id)
    return m ? displayName(m) : 'them'
  }

  const takeDown = async (crate: CrateDef) => {
    try {
      await del(`${api}/crates/custom/${crate.id.slice(2)}`)
      toast.success(`${crate.name} is off sale. Crates people already have still open.`)
      void qc.invalidateQueries({ queryKey: ['custom-crates', org.id] })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  // How many to buy at once (×1 ×5 ×10 ×20 ×100 or custom).
  const [qty, setQty] = useState(1)
  const buy = async (crate: CrateDef, count = 1, giftTo?: string) => {
    setBusy(`${crate.id}:${count}`)
    try {
      const w = await post<Wallet>('/api/me/crates/buy', { crateId: crate.id, count, giftTo })
      qc.setQueryData(['wallet'], w)
      toast.success(
        giftTo
          ? `Sent a ${crate.name} to ${nameOf(giftTo)} 🎁`
          : count > 1
            ? `${count} ${crate.name}s are in your crates`
            : `${crate.name} is in your crates. Open it whenever you like!`,
      )
    } catch (e) {
      toast.error(errorMessage(e))
      throw e
    } finally {
      setBusy(null)
    }
  }

  const saleCard = (crate: CrateDef) => {
    const afford = (wallet?.coins ?? 0) >= crate.price
    return (
      <li key={crate.id} className="flex gap-4 rounded-xl border border-border p-4">
        <CrateArt crate={crate} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-[14px] font-semibold">{crate.name}</p>
          <p className="text-xs text-fg-muted">{crate.description}</p>
          {crate.creator && (
            <p className="text-2xs text-fg-subtle">
              by {displayName(crate.creator)}
              {(crate.creator.id === me.id || isTeacher) && (
                <button
                  type="button"
                  className="ml-2 text-danger hover:underline"
                  onClick={() => takeDown(crate)}
                >
                  Take off sale
                </button>
              )}
            </p>
          )}
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1 self-start text-xs text-accent-text hover:underline"
            onClick={() => setOdds(crate)}
          >
            <Info className="size-3" /> What's inside
          </button>
          <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
            <Button
              size="sm"
              variant={(wallet?.coins ?? 0) >= crate.price * qty ? 'primary' : 'secondary'}
              disabled={(wallet?.coins ?? 0) < crate.price * qty || !wallet}
              loading={busy === `${crate.id}:${qty}`}
              onClick={() => buy(crate, qty).catch(() => {})}
              className="tabular-nums"
            >
              {qty > 1 ? `Buy ×${qty} · ` : ''}🪙 {(crate.price * qty).toLocaleString()}
            </Button>
            <Button
              size="sm"
              title="Gift one"
              aria-label={`Gift a ${crate.name}`}
              disabled={!afford}
              onClick={() => setGift({ crate })}
            >
              <Gift />
            </Button>
          </div>
        </div>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {!!groups.length && (
        <section>
          <h3 className="mb-3 text-[14px] font-semibold">Your crates</h3>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {groups.map(({ crate, rows }) => (
              <li
                key={crate.id}
                className="flex flex-col items-center gap-2 rounded-xl border border-border p-4 text-center"
              >
                <div className="q-crate-idle relative">
                  <CrateArt crate={crate} />
                  {rows.length > 1 && (
                    <span className="absolute -top-2 -right-2 rounded-full bg-accent px-2 py-0.5 text-2xs font-bold text-accent-fg">
                      ×{rows.length}
                    </span>
                  )}
                </div>
                <p className="text-[14px] font-semibold">{crate.name}</p>
                {rows[0]?.giftedBy && (
                  <p className="text-2xs text-accent-text">🎁 from {rows[0].giftedBy.name}</p>
                )}
                <div className="flex w-full gap-1.5">
                  <Button
                    size="sm"
                    variant="primary"
                    className="flex-1"
                    onClick={() => setOpening(rows[0]!.id)}
                  >
                    Open
                  </Button>
                  {rows.length > 1 && (
                    <Button
                      size="sm"
                      title="Open lots at once"
                      onClick={() => setOpenMany({ crate, have: rows.length })}
                    >
                      Open many
                    </Button>
                  )}
                  <Button
                    size="sm"
                    title="Give this crate to someone"
                    aria-label={`Give a ${crate.name}`}
                    onClick={() => setGift({ crate, rowId: rows[0]!.id })}
                  >
                    <Gift />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-1 text-[14px] font-semibold">
          {onlyEvent ? 'Event crate' : 'Buy crates'}
        </h3>
        {!onlyEvent && (
          <p className="mb-3 text-xs text-fg-muted">
            Crates go into your inventory and stay closed until you open them, so you can save them,
            gift them or trade them. Every {STREAK_CRATE.every}-day streak gives you a free Wicky
            Crate.
          </p>
        )}
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          Buy
          <QtyPicker value={qty} onChange={setQty} max={100} label="Crates to buy" />
          at a time
        </div>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {forSale.map(saleCard)}
        </ul>
      </section>

      {!onlyEvent && (
        <section>
          <h3 className="mb-1 text-[14px] font-semibold">🎨 Student crates</h3>
          <p className="mb-3 text-xs text-fg-muted">
            Made by students from their own cosmetics. The maker gets most of what you pay. Make
            your own in Create → Crate.
          </p>
          {!studentCrates.length ? (
            <p className="text-[13px] text-fg-subtle">No student crates yet. Be the first!</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {studentCrates.map(saleCard)}
            </ul>
          )}
        </section>
      )}

      {!onlyEvent && (
        <section>
          <h3 className="mb-3 text-[14px] font-semibold">🔥 Big drops this week</h3>
          {feed.isLoading ? (
            <Skeleton className="h-20" />
          ) : !feed.data?.length ? (
            <p className="text-[13px] text-fg-subtle">
              Nobody's pulled an Epic or Legendary yet this week. Could be you!
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
              {feed.data.map((f) => (
                <li key={f.id} className="flex items-center gap-2 px-3 py-2">
                  <Avatar name={f.user.name} id={f.user.id} src={f.user.avatarUrl} size="xs" />
                  <span className="min-w-0 flex-1 truncate">
                    <strong>{displayName(f.user)}</strong> pulled{' '}
                    <strong style={{ color: TIER_STYLE[f.result.tier].color }}>
                      {dropName(f.result, catalog)}
                    </strong>{' '}
                    from a {defs.byId(f.crateId)?.name ?? 'crate'}
                  </span>
                  <span className="text-xs text-fg-subtle">{relative(f.openedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {opening && wallet && (
        <OpenDialog
          key={opening}
          crateRowId={opening}
          wallet={wallet}
          catalog={catalog}
          onClose={() => setOpening(null)}
          onOpenNext={setOpening}
        />
      )}
      {openMany && (
        <OpenManyDialog
          key={openMany.crate.id}
          crate={openMany.crate}
          have={openMany.have}
          catalog={catalog}
          onClose={() => setOpenMany(null)}
        />
      )}
      {odds && (
        <OddsDialog crate={odds} owned={owned} catalog={catalog} onClose={() => setOdds(null)} />
      )}
      {gift && (
        <GiftDialog
          title={gift.rowId ? `Give your ${gift.crate.name}` : `Gift a ${gift.crate.name}`}
          description={
            gift.rowId
              ? "It goes to them unopened. They'll get a notification."
              : `You pay 🪙 ${gift.crate.price}. It goes to them unopened.`
          }
          onClose={() => setGift(null)}
          onSend={async (to) => {
            if (gift.rowId) {
              try {
                const w = await post<Wallet>(`/api/me/crates/${gift.rowId}/gift`, { to })
                qc.setQueryData(['wallet'], w)
                toast.success(`Gave a ${gift.crate.name} to ${nameOf(to)} 🎁`)
              } catch (e) {
                toast.error(errorMessage(e))
                throw e
              }
            } else await buy(gift.crate, 1, to)
          }}
        />
      )}
    </div>
  )
}

// --- Making a crate ----------------------------------------------------------------------

const TIERS: CrateTier[] = ['common', 'rare', 'epic', 'legendary']

/** Students pack their own cosmetics and Shop items into a crate to sell. */
export function CreateCrate({ catalog }: { catalog: Catalog }) {
  const { org, api, me } = useOrgContext()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🎁')
  const [description, setDescription] = useState('')
  const [colors, setColors] = useState<[string, string]>(['#8052ff', '#ff5c8a'])
  const [price, setPrice] = useState(100)
  const [drops, setDrops] = useState<Record<string, CrateTier>>({})
  const [saving, setSaving] = useState(false)
  const picked = Object.entries(drops).map(([item, tier]) => ({ item, tier }))
  const preview: CrateDef = {
    id: 'preview',
    name: name || 'Your crate',
    emoji: emoji || '📦',
    description,
    price,
    colors,
    drops: picked,
    creator: { id: me.id, name: me.name, displayName: me.displayName ?? null },
  }
  const odds = picked.length ? crateOdds(preview) : []
  const floor = crateFloor(picked.map((d) => d.item))
  const minPrice = Math.max(CUSTOM_CRATE.price.min, floor)
  // Adding Shop items raises the lowest price; follow it so the form stays valid.
  useEffect(() => {
    setPrice((p) => Math.max(p, minPrice))
  }, [minPrice])
  const earn = Math.floor(Math.max(0, price - floor) * CREATOR_SHARE)

  const submit = async () => {
    setSaving(true)
    try {
      await post(`${api}/crates/custom`, { name, emoji, description, colors, price, drops: picked })
      toast.success('Your crate is on sale in the Crates tab! 📦')
      setName('')
      setDescription('')
      setDrops({})
      void qc.invalidateQueries({ queryKey: ['custom-crates', org.id] })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_280px]">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <PackFields
          what="crate"
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
          maxPrice={CUSTOM_CRATE.price.max}
          note={
            floor
              ? `With Shop items inside, it has to cost at least 🪙 ${floor} (the priciest one). You earn ${Math.round(CREATOR_SHARE * 100)}% of the part above that: 🪙 ${earn} a crate.`
              : `You get ${Math.round(CREATOR_SHARE * 100)}% of every crate sold.`
          }
        />
        <div>
          <p className="mb-1 text-[13px] font-medium">
            What's inside ({picked.length}/{CUSTOM_CRATE.maxItems})
          </p>
          <p className="mb-2 text-xs text-fg-subtle">
            Pick anything: your own cosmetics or Shop items, and how rare each one is. Rarer tiers
            drop less often:{' '}
            {TIERS.map((t) => `${TIER_STYLE[t].label} ${TIER_ODDS[t]}%`).join(' · ')} (shared by the
            items in each tier).
          </p>
          <ItemPicker
            selected={picked.map((d) => d.item)}
            max={CUSTOM_CRATE.maxItems}
            onToggle={(id) =>
              setDrops((d) => {
                const next = { ...d }
                if (id in next) delete next[id]
                else next[id] = 'common'
                return next
              })
            }
            extra={(id) => (
              <Select
                aria-label="Rarity"
                className="w-32"
                value={drops[id]}
                onChange={(e) => setDrops((d) => ({ ...d, [id]: e.target.value as CrateTier }))}
              >
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {TIER_STYLE[t].label}
                  </option>
                ))}
              </Select>
            )}
          />
        </div>
        <p className="text-xs text-fg-subtle">
          Nobody gets the same thing twice. If someone already owns everything left in your crate,
          opening it gives them {Math.round(CUSTOM_CRATE.refund * 100)}% of the price back. Teachers
          can take crates off sale.
        </p>
        <div>
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={
              picked.length < CUSTOM_CRATE.minItems || name.trim().length < 2 || price < minPrice
            }
          >
            Put it on sale
          </Button>
        </div>
      </form>
      <div className="flex flex-col items-center gap-3 self-start rounded-xl border border-border p-5">
        <p className="text-2xs font-semibold text-fg-subtle uppercase">Preview</p>
        <div className="q-crate-idle">
          <CrateArt crate={preview} size="lg" />
        </div>
        <p className="text-[14px] font-semibold">{preview.name}</p>
        <p className="text-xs text-fg-muted">🪙 {price}</p>
        {!!odds.length && (
          <ul className="w-full text-xs">
            {odds.map((o) => (
              <li key={dropKey(o.drop)} className="flex justify-between gap-2">
                <span className="truncate">{dropName(o.drop, catalog)}</span>
                <span style={{ color: TIER_STYLE[o.drop.tier].color }}>{o.chance.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Your crates on sale, in My stuff. */
export function MyCrates() {
  const { me, org, api } = useOrgContext()
  const qc = useQueryClient()
  const defs = useCrateDefs()
  const q = useQuery({
    queryKey: ['custom-crates', org.id],
    queryFn: ({ signal }) => get<CustomCrate[]>(`${api}/crates/custom`, signal),
  })
  const mine = (q.data ?? []).filter((c) => c.creator.id === me.id)
  if (!mine.length) return null
  return (
    <section className="mt-10">
      <h3 className="mb-3 text-[14px] font-semibold">Your crates</h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {mine.map((c) => {
          const def = defs.byId(c.crateId)
          return (
            <li key={c.id} className="flex items-center gap-4 p-3 text-[13px]">
              {def && <CrateArt crate={def} size="sm" />}
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.name} <span className="text-fg-subtle">· 🪙 {c.price}</span>
                </p>
                <p className={c.status === 'active' ? 'text-success' : 'text-fg-subtle'}>
                  {c.status === 'active' ? '✅ On sale' : 'Off sale'} · {c.sales} sold ·{' '}
                  {c.drops.length} items
                </p>
              </div>
              {c.status === 'active' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await del(`${api}/crates/custom/${c.id}`)
                      void qc.invalidateQueries({ queryKey: ['custom-crates', org.id] })
                    } catch (e) {
                      toast.error(errorMessage(e))
                    }
                  }}
                >
                  Take off sale
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Name, emoji, description, colours and price, for making a crate or a bundle. */
export function PackFields(p: {
  what: string
  name: string
  setName: (v: string) => void
  emoji: string
  setEmoji: (v: string) => void
  description: string
  setDescription: (v: string) => void
  colors: [string, string]
  setColors: (fn: (c: [string, string]) => [string, string]) => void
  price: number
  setPrice: (v: number) => void
  minPrice: number
  maxPrice: number
  note: string
}) {
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-1 flex-col gap-1 text-[13px] font-medium">
          <span>Name</span>
          <Input
            aria-label={`${p.what} name`}
            required
            minLength={2}
            maxLength={40}
            value={p.name}
            onChange={(e) => p.setName(e.target.value)}
          />
        </div>
        <div className="flex w-20 flex-col gap-1 text-[13px] font-medium">
          <span>Emoji</span>
          <Input
            aria-label={`${p.what} emoji`}
            maxLength={4}
            value={p.emoji}
            onChange={(e) => p.setEmoji(e.target.value)}
            className="text-center text-lg"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1 text-[13px] font-medium">
        <span>Description</span>
        <Input
          aria-label={`${p.what} description`}
          maxLength={140}
          value={p.description}
          onChange={(e) => p.setDescription(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1 text-[13px] font-medium">
          <span>Colours</span>
          <span className="flex gap-2">
            {([0, 1] as const).map((i) => (
              <input
                key={i}
                type="color"
                aria-label={`Colour ${i + 1}`}
                value={p.colors[i]}
                onChange={(e) =>
                  p.setColors((c) => (i === 0 ? [e.target.value, c[1]] : [c[0], e.target.value]))
                }
                className="h-9 w-12 cursor-pointer rounded-md border border-border bg-transparent"
              />
            ))}
          </span>
        </div>
        <div className="flex flex-col gap-1 text-[13px] font-medium">
          <span>Price</span>
          <Input
            aria-label={`${p.what} price`}
            type="number"
            min={p.minPrice}
            max={p.maxPrice}
            value={p.price}
            onChange={(e) => p.setPrice(Number(e.target.value))}
            className="w-28"
          />
        </div>
        <p className="max-w-sm pb-2 text-xs text-fg-subtle">{p.note}</p>
      </div>
    </>
  )
}

const TIER_RANK: Record<string, number> = { legendary: 0, epic: 1, rare: 2, common: 3 }

/** Opens many crates of one kind at once and shows everything that came out. */
function OpenManyDialog({
  crate,
  have,
  catalog,
  onClose,
}: {
  crate: CrateDef
  have: number
  catalog: Catalog
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [count, setCount] = useState(Math.min(have, 10))
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<CrateResult[] | null>(null)

  const open = async () => {
    setBusy(true)
    try {
      const r = await post<{ results: CrateResult[]; wallet: Wallet }>('/api/me/crates/open-many', {
        crateId: crate.id,
        count,
      })
      setResults(r.results)
      qc.setQueryData(['wallet'], r.wallet)
      void qc.invalidateQueries({ queryKey: ['crates-opened'] })
      void qc.invalidateQueries({ queryKey: ['earn'] })
      void qc.invalidateQueries({ queryKey: ['achievements'] })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const coins = (results ?? []).reduce((n, r) => n + ('coins' in r ? r.coins : 0), 0)
  const best = [...(results ?? [])].sort((a, b) => TIER_RANK[a.tier]! - TIER_RANK[b.tier]!)[0]
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        title={`Open ${crate.name}s`}
        description={
          results
            ? `Opened ${results.length}.${coins ? ` +🪙 ${coins} in coins.` : ''}${best ? ` Best pull: ${TIER_STYLE[best.tier].label}!` : ''}`
            : `You have ${have}. How many do you want to open?`
        }
        className="max-w-3xl"
      >
        {!results ? (
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="q-crate-idle">
              <CrateArt crate={crate} />
            </div>
            <QtyPicker
              value={count}
              onChange={setCount}
              max={Math.min(have, 100)}
              label="Crates to open"
            />
            <Button variant="primary" loading={busy} onClick={open}>
              Open ×{count}
            </Button>
          </div>
        ) : (
          <ul className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
            {[...results]
              .map((r, i) => ({ r, i }))
              .sort((a, b) => TIER_RANK[a.r.tier]! - TIER_RANK[b.r.tier]! || a.i - b.i)
              .map(({ r, i }) => (
                <li
                  key={i}
                  className="q-drop-in flex justify-center"
                  style={{ animationDelay: `${Math.min(i, 40) * 45}ms` }}
                >
                  <DropTile drop={r} catalog={catalog} />
                </li>
              ))}
          </ul>
        )}
        <DialogFooter>
          <Button disabled={busy} onClick={onClose}>
            {results ? 'Nice!' : 'Cancel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

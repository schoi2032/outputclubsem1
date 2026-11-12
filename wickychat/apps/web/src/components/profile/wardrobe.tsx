'use client'
/**
 * WickyChat Wardrobe: everything you own in one place. Search, filter by kind, hover to try
 * something on in the preview, click to wear it (click again to take it off).
 */
import type { FlairKind, ItemKind, Wallet } from '@quid/shared'
import { specFromValue } from '@quid/shared'
import { Avatar, Button, cn, Input, Select, Skeleton, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { SettingsCard } from '@/components/settings-ui'
import { FlairPreview } from '@/components/shop/flair-preview'
import { ItemPreview, RARITY, type ShopItem, useCatalog } from '@/components/shop/items'
import { errorMessage, get, put } from '@/lib/api'
import { displayName } from '@/lib/format'
import { keys } from '@/lib/queries'
import { NamePlate, ProfileEffect } from './cosmetics-fx'
import { bubbleProps, nameEffectProps } from './flair'

type Filter = ItemKind | 'all' | 'wearing'

const TABS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'wearing', label: 'Wearing' },
  { id: 'decoration', label: 'Decorations' },
  { id: 'effect', label: 'Effects' },
  { id: 'plate', label: 'Name plates' },
  { id: 'bubble', label: 'Chat bubbles' },
  { id: 'name_effect', label: 'Name effects' },
  { id: 'message_effect', label: 'Message effects' },
  { id: 'typing', label: 'Typing' },
  { id: 'reaction_skin', label: 'Reactions' },
  { id: 'mention_style', label: 'Mentions' },
  { id: 'sound_pack', label: 'Sounds' },
  { id: 'theme', label: 'Themes' },
]

const SLOT_LABEL: Record<ItemKind, string> = {
  decoration: 'Decoration',
  effect: 'Effect',
  plate: 'Name plate',
  bubble: 'Chat bubble',
  name_effect: 'Name effect',
  message_effect: 'Message effect',
  typing: 'Typing indicator',
  reaction_skin: 'Reaction skin',
  mention_style: 'Mention style',
  sound_pack: 'Sound pack',
  theme: 'Theme',
}

const RANK = { legendary: 0, epic: 1, event: 2, community: 3, rare: 4, common: 5 }

export function Wardrobe() {
  const { me, base } = useOrgContext()
  const qc = useQueryClient()
  const wallet = useQuery({
    queryKey: ['wallet'],
    queryFn: ({ signal }) => get<Wallet>('/api/me/wallet', signal),
  })
  const catalog = useCatalog()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'rarity' | 'name' | 'price'>('rarity')
  const [hover, setHover] = useState<ShopItem | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const w = wallet.data

  const isWearing = (it: ShopItem) => {
    if (!w) return false
    if (it.kind === 'theme') return w.equippedTheme === it.itemId
    if (it.kind === 'effect') return w.equippedEffect === it.value
    if (it.kind === 'plate') return w.equippedPlate === it.value
    if (it.kind === 'bubble') return w.equippedBubble === it.value
    if (it.kind in w.equippedFlair) return w.equippedFlair[it.kind as FlairKind] === it.value
    return w.equipped?.split('|')[0] === it.itemId
  }

  const owned = useMemo(
    () =>
      (w?.owned ?? [])
        .map((id) => catalog.get(id))
        .filter((it): it is ShopItem => !!it && it.kind in SLOT_LABEL),
    [w?.owned, catalog],
  )
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: owned.length }
    for (const it of owned) c[it.kind] = (c[it.kind] ?? 0) + 1
    return c
  }, [owned])

  const needle = q.trim().toLowerCase()
  const list = owned
    .filter((it) =>
      filter === 'all' ? true : filter === 'wearing' ? isWearing(it) : it.kind === filter,
    )
    .filter(
      (it) =>
        !needle ||
        it.name.toLowerCase().includes(needle) ||
        it.description.toLowerCase().includes(needle) ||
        RARITY[it.rarity].label.toLowerCase().includes(needle) ||
        SLOT_LABEL[it.kind].toLowerCase().includes(needle),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'price'
          ? b.price - a.price
          : RANK[a.rarity] - RANK[b.rarity] || a.name.localeCompare(b.name),
    )

  const wear = async (it: ShopItem, on: boolean) => {
    setBusy(it.kind)
    try {
      const id = on ? it.itemId : null
      const next =
        it.kind === 'theme'
          ? await put<Wallet>('/api/me/theme', { itemId: id })
          : it.kind === 'decoration'
            ? await put<Wallet>('/api/me/decoration', { itemId: id })
            : await put<Wallet>('/api/me/equip', { slot: it.kind, itemId: id })
      qc.setQueryData(['wallet'], next)
      void qc.invalidateQueries({ queryKey: keys.me })
      void qc.invalidateQueries({ queryKey: ['members'] })
      toast.success(on ? `Wearing ${it.name} ✨` : `Took off ${it.name}`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  // What's on right now, per slot (as Shop items, so they can be taken off).
  const wearingNow = (kind: ItemKind) => owned.find((it) => it.kind === kind && isWearing(it))
  // The preview: what you're wearing, with whatever you're hovering tried on top.
  const look = {
    decoration: hover?.kind === 'decoration' ? hover.decoration : (w?.equipped ?? undefined),
    effect: hover?.kind === 'effect' ? hover.value : w?.equippedEffect,
    plate: hover?.kind === 'plate' ? hover.value : w?.equippedPlate,
    bubble: hover?.kind === 'bubble' ? hover.value : w?.equippedBubble,
    name: hover?.kind === 'name_effect' ? hover.value : w?.equippedFlair.name_effect,
  }
  const nameFx = nameEffectProps(specFromValue('name_effect', look.name))
  const bubbleLook = bubbleProps(look.bubble)
  const otherFlair =
    hover && hover.kind !== 'name_effect' && hover.kind in (w?.equippedFlair ?? {}) ? hover : null

  return (
    <SettingsCard
      title="Wardrobe"
      description="Everything you own. Hover to try it on, click to wear it."
    >
      <div className="flex flex-col gap-5">
        <div className="q-anim-on flex flex-col gap-4 rounded-xl border border-border bg-bg-subtle p-4 sm:flex-row sm:items-center">
          <div className="relative flex h-32 w-full shrink-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-lg bg-gradient-to-b from-[#3b2a6b] to-[#1b1530] sm:w-56">
            <Avatar
              name={me.name}
              id={me.id}
              src={me.avatarUrl}
              decoration={look.decoration}
              size="xl"
            />
            <ProfileEffect value={look.effect} />
            <div className="relative isolate overflow-hidden rounded-md px-2 py-0.5">
              <NamePlate value={look.plate} />
              <span
                className={cn('text-[13px] font-semibold text-white', nameFx?.className)}
                style={nameFx?.style}
              >
                {displayName(me)}
              </span>
            </div>
            {look.bubble && (
              <span
                className={cn('max-w-[90%] truncate text-[12px] text-white', bubbleLook.className)}
                style={bubbleLook.style}
              >
                hi 👋
              </span>
            )}
            {otherFlair && (
              <span className="rounded-md bg-bg px-2 py-1">
                <FlairPreview
                  kind={otherFlair.kind as FlairKind}
                  value={otherFlair.value}
                  compact
                />
              </span>
            )}
          </div>
          <ul className="grid flex-1 grid-cols-2 gap-2">
            {(Object.keys(SLOT_LABEL) as ItemKind[]).map((k) => {
              const it = wearingNow(k)
              return (
                <li
                  key={k}
                  className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-bg px-2.5 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-2xs font-semibold text-fg-subtle uppercase">
                      {SLOT_LABEL[k]}
                    </p>
                    <p className="truncate text-[13px] font-medium">
                      {it?.name ?? <span className="text-fg-subtle">None</span>}
                    </p>
                  </div>
                  {it && (
                    <button
                      type="button"
                      className="rounded p-1 text-fg-muted hover:bg-bg-muted hover:text-fg"
                      aria-label={`Take off ${it.name}`}
                      disabled={busy === k}
                      onClick={() => wear(it, false)}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <nav
            aria-label="Filter"
            className="flex flex-wrap gap-1 rounded-lg border border-border p-0.5"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={filter === t.id}
                onClick={() => setFilter(t.id)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[13px]',
                  filter === t.id ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-muted',
                )}
              >
                {t.label}
                {t.id !== 'wearing' && (
                  <span className="ml-1 text-2xs opacity-70">{counts[t.id] ?? 0}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="relative min-w-40 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" />
            <Input
              aria-label="Search your stuff"
              placeholder="Search your stuff…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select
            aria-label="Sort"
            className="w-auto"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            <option value="rarity">Rarest first</option>
            <option value="price">Priciest first</option>
            <option value="name">A to Z</option>
          </Select>
        </div>

        {wallet.isLoading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        ) : !owned.length ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-[13px] text-fg-muted">
            You don't own anything yet.
            <Button size="sm" variant="primary" onClick={() => location.assign(`${base}/shop`)}>
              Go to the Wicky Shop
            </Button>
          </div>
        ) : !list.length ? (
          <p className="py-8 text-center text-[13px] text-fg-subtle">Nothing matches.</p>
        ) : (
          <ul
            className="grid max-h-[560px] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4"
            onMouseLeave={() => setHover(null)}
          >
            {list.map((it) => {
              const on = isWearing(it)
              return (
                <li key={it.itemId}>
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={busy === it.kind}
                    onMouseEnter={() => it.kind !== 'theme' && setHover(it)}
                    onFocus={() => it.kind !== 'theme' && setHover(it)}
                    onClick={() => wear(it, !on)}
                    className={cn(
                      'q-anim-on relative flex w-full flex-col items-center rounded-xl border p-2 text-center transition-colors disabled:opacity-60',
                      on
                        ? 'border-accent bg-accent-subtle'
                        : 'border-border hover:border-border-strong hover:bg-bg-subtle',
                    )}
                  >
                    {on && (
                      <span className="absolute top-1.5 right-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-accent text-accent-fg">
                        <Check className="size-3" />
                      </span>
                    )}
                    <div className="flex h-20 w-full items-center justify-center">
                      <ItemPreview it={it} compact />
                    </div>
                    <p className="w-full truncate text-[13px] font-medium">{it.name}</p>
                    <p className="flex items-center gap-1 text-2xs text-fg-subtle">
                      <span
                        className={cn('rounded px-1 font-semibold', RARITY[it.rarity].className)}
                      >
                        {RARITY[it.rarity].label}
                      </span>
                      {SLOT_LABEL[it.kind]}
                    </p>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </SettingsCard>
  )
}

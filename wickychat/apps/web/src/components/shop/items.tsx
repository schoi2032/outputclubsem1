'use client'
/**
 * WickyChat: one model for everything sold in the Shop (built-in decorations, effects, name
 * plates and themes, seasonal items and student-made cosmetics) plus how to draw each one.
 */
import {
  type Cosmetic,
  DECORATIONS,
  type DecorationRarity,
  decorationById,
  EFFECTS,
  effectById,
  type ItemKind,
  isEventLive,
  PLATES,
  plateById,
  seasonEventById,
  THEMES,
  themeById,
  themeCss,
} from '@quid/shared'
import { Avatar, cn } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useOrgContext } from '@/components/org-context'
import { NamePlate, ProfileEffect } from '@/components/profile/cosmetics-fx'
import { ThemeSwatch } from '@/components/shop/theme-swatch'
import { get } from '@/lib/api'
import { displayName } from '@/lib/format'

export type Rarity = DecorationRarity | 'community' | 'event'

export const RARITY: Record<Rarity, { label: string; className: string }> = {
  common: { label: 'Common', className: 'bg-bg-muted text-fg-muted' },
  rare: { label: 'Rare', className: 'bg-[#3b8fc9]/15 text-[#3b8fc9]' },
  epic: { label: 'Epic', className: 'bg-[#8052ff]/15 text-[#8052ff]' },
  legendary: { label: 'Legendary', className: 'bg-[#ffb829]/20 text-[#b07800]' },
  community: { label: 'Student-made', className: 'bg-[#15846e]/15 text-[#15846e]' },
  event: { label: 'Seasonal', className: 'bg-[#ff7a00]/15 text-[#c25a00]' },
}

export const KIND_LABEL: Record<ItemKind, string> = {
  decoration: 'Decoration',
  effect: 'Profile effect',
  plate: 'Name plate',
  theme: 'Theme (CSS)',
}

/** Item shown in a grid: built-in or student-made. */
export interface ShopItem {
  kind: ItemKind
  /** Stored value for effects and plates (student-made ones include the image). */
  value?: string
  /** Theme CSS and whether it's a dark theme (themes only). */
  css?: string
  dark?: boolean | null
  itemId: string
  decoration: string
  name: string
  description: string
  price: number
  rarity: Rarity
  creator?: Cosmetic['creator']
  sales?: number
  /** Seasonal event id; `live` says whether it's on sale right now. */
  event?: string
  live?: boolean
  /** Student-made only. */
  visibility?: Cosmetic['visibility']
  stock?: number | null
}

const evFields = (event?: string) =>
  event ? { event, live: isEventLive(event), rarity: 'event' as const } : { live: true }

export const BUILTIN_ITEMS: ShopItem[] = [
  ...DECORATIONS.map(
    (d): ShopItem => ({
      kind: 'decoration',
      itemId: d.id,
      decoration: d.id,
      name: d.name,
      description: d.description,
      price: d.price,
      rarity: d.rarity,
      live: true,
    }),
  ),
  ...EFFECTS.map(
    (e): ShopItem => ({
      kind: 'effect',
      value: e.id,
      itemId: e.id,
      decoration: '',
      name: e.name,
      description: e.description,
      price: e.price,
      rarity: e.price >= 200 ? 'epic' : 'rare',
      ...evFields(e.event),
    }),
  ),
  ...PLATES.map(
    (pl): ShopItem => ({
      kind: 'plate',
      value: pl.id,
      itemId: pl.id,
      decoration: '',
      name: pl.name,
      description: pl.description,
      price: pl.price,
      rarity: pl.price >= 180 ? 'epic' : pl.price >= 120 ? 'rare' : 'common',
      ...evFields(pl.event),
    }),
  ),
  ...THEMES.map(
    (t): ShopItem => ({
      kind: 'theme',
      css: themeCss(t),
      dark: t.dark,
      itemId: t.id,
      decoration: '',
      name: t.name,
      description: `${t.dark ? 'Dark' : 'Light'} theme · palette by ${t.credit}`,
      price: t.price,
      rarity: t.price >= 200 ? 'epic' : 'rare',
      ...evFields(t.event),
    }),
  ),
]

export function cosmeticItem(c: Cosmetic): ShopItem {
  return {
    kind: c.kind,
    value: c.value,
    css: c.css ?? undefined,
    dark: null,
    itemId: `u:${c.id}`,
    decoration: c.decoration,
    name: c.name,
    description: c.description,
    price: c.price,
    rarity: 'community',
    creator: c.creator,
    sales: c.sales,
    visibility: c.visibility,
    stock: c.stock,
    live: true,
  }
}

/** Student-made cosmetics on sale (plus private ones you made or were given). */
export function useCommunity() {
  const { org, api } = useOrgContext()
  return useQuery({
    queryKey: ['cosmetics', org.id, 'shop'],
    queryFn: ({ signal }) => get<Cosmetic[]>(`${api}/cosmetics?view=shop`, signal),
  })
}

/** Every item by id: built-in ones and the student-made ones the app knows about. */
const NONE: Cosmetic[] = []

export function useCatalog(extra: Cosmetic[] = NONE) {
  const community = useCommunity()
  return useMemo(() => {
    const all = [...BUILTIN_ITEMS, ...[...(community.data ?? []), ...extra].map(cosmeticItem)]
    return new Map(all.map((it) => [it.itemId, it] as const))
  }, [community.data, extra])
}

export function itemName(id: string | null | undefined, community: Cosmetic[]) {
  if (!id) return ''
  const key = id.split('|')[0]!
  if (key.startsWith('u:')) return community.find((c) => `u:${c.id}` === key)?.name ?? 'a cosmetic'
  return (
    decorationById(key)?.name ??
    themeById(key)?.name ??
    effectById(key)?.name ??
    plateById(key)?.name ??
    key
  )
}

/** Small tag for limited, private and seasonal items. */
export function ItemTags({ it, serial }: { it: ShopItem; serial?: number }) {
  const ev = seasonEventById(it.event)
  const left = it.stock != null ? Math.max(0, it.stock - (it.sales ?? 0)) : null
  return (
    <div className="mt-1 flex flex-wrap justify-center gap-1">
      {ev && (
        <span className="rounded-full bg-[#ff7a00]/15 px-2 py-0.5 text-2xs font-semibold text-[#c25a00]">
          {ev.emoji} {ev.name}
          {!it.live && ' · ended'}
        </span>
      )}
      {it.visibility === 'private' && (
        <span className="rounded-full bg-bg-muted px-2 py-0.5 text-2xs font-semibold text-fg-muted">
          🔒 Private
        </span>
      )}
      {left != null && (
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-2xs font-semibold',
            left ? 'bg-[#e0399a]/15 text-[#c0267f]' : 'bg-bg-muted text-fg-subtle',
          )}
        >
          {left ? `Limited · ${left}/${it.stock} left` : `Sold out · ${it.stock} made`}
        </span>
      )}
      {serial != null && (
        <span className="rounded-full bg-[#ffb829]/20 px-2 py-0.5 text-2xs font-semibold text-[#b07800]">
          #{serial}
          {it.stock ? ` of ${it.stock}` : ''}
        </span>
      )}
    </div>
  )
}

/** The picture of an item on its Shop card. */
export function ItemPreview({ it, compact }: { it: ShopItem; compact?: boolean }) {
  const { me } = useOrgContext()
  const h = compact ? 'h-16' : 'h-24'
  if (it.kind === 'theme') return <ThemeSwatch css={it.css ?? ''} className={cn('mb-1', h)} />
  if (it.kind === 'effect')
    return (
      <div
        className={cn(
          'relative mb-1 flex w-full items-center justify-center overflow-hidden rounded-lg bg-gradient-to-b from-[#3b2a6b] to-[#1b1530]',
          h,
        )}
      >
        <Avatar name={me.name} id={me.id} src={me.avatarUrl} size={compact ? 'md' : 'lg'} />
        <ProfileEffect value={it.value} />
      </div>
    )
  if (it.kind === 'plate')
    return (
      <div
        className={cn(
          'mb-1 flex w-full flex-col justify-center gap-1.5 rounded-lg border border-border bg-bg-subtle p-2',
          h,
        )}
      >
        <div className="relative isolate flex items-center gap-2 overflow-hidden rounded-md px-2 py-1.5">
          <NamePlate value={it.value} />
          <Avatar name={me.name} id={me.id} src={me.avatarUrl} size="xs" />
          <span className="truncate text-[13px] font-semibold">{displayName(me)}</span>
        </div>
        {!compact && (
          <div className="flex items-center gap-2 px-2 py-1 text-[13px] text-fg-subtle">
            <span className="size-5 rounded-full bg-bg-emphasis" /> Someone else
          </div>
        )}
      </div>
    )
  return (
    <div className={compact ? 'my-1' : 'my-4'}>
      <Avatar
        name={me.name}
        id={me.id}
        src={me.avatarUrl}
        decoration={it.decoration}
        size={compact ? 'lg' : 'xl'}
      />
    </div>
  )
}

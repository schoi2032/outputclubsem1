'use client'
/**
 * WickyChat: the Wicky Shop. Coin balance and daily bonus, built-in animated decorations,
 * student-made cosmetics (create them from a form or a cosmetic.json pack), and gifting.
 */
import {
  type Attachment,
  COINS,
  COSMETIC_PRICE,
  type CoinTransaction,
  type Cosmetic,
  type CosmeticManifest,
  CREATOR_SHARE,
  DECORATIONS,
  type DecorationRarity,
  decorationById,
  EFFECTS,
  effectById,
  type ItemKind,
  type Leaderboard,
  MARKET_PRICE,
  MARKET_SHARE,
  type MarketListing,
  PLATES,
  plateById,
  STICKER_POSITIONS,
  type StickerPosition,
  sanitizeThemeCss,
  streakBonus,
  THEME_TEMPLATE,
  THEMES,
  themeById,
  themeCss,
  type Wallet,
} from '@quid/shared'
import {
  Avatar,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Gift, Store, Upload, X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { PeoplePicker } from '@/components/dialogs/people-picker'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { NamePlate, ProfileEffect } from '@/components/profile/cosmetics-fx'
import { ThemeSwatch } from '@/components/shop/theme-swatch'
import { del, errorMessage, get, post, put, upload } from '@/lib/api'
import { applyAppTheme } from '@/lib/app-theme'
import { displayName, relative } from '@/lib/format'
import { keys, useMembers } from '@/lib/queries'

const RARITY: Record<DecorationRarity | 'community', { label: string; className: string }> = {
  common: { label: 'Common', className: 'bg-bg-muted text-fg-muted' },
  rare: { label: 'Rare', className: 'bg-[#3b8fc9]/15 text-[#3b8fc9]' },
  epic: { label: 'Epic', className: 'bg-[#8052ff]/15 text-[#8052ff]' },
  legendary: { label: 'Legendary', className: 'bg-[#ffb829]/20 text-[#b07800]' },
  community: { label: 'Student-made', className: 'bg-[#15846e]/15 text-[#15846e]' },
}

const REASON: Record<CoinTransaction['reason'], string> = {
  daily: 'Daily bonus',
  message: 'Sent a message',
  swear: 'Swear filter caught you',
  purchase: 'Bought',
  gift: 'Reward from a teacher',
  sale: 'Someone bought your',
  gift_item: 'Gifted',
  market_buy: 'Bought from the Market:',
  market_sale: 'Sold on the Market:',
  poll: 'Voted in a poll',
  quiz: 'Got a quiz right',
}

const POSITION_LABEL: Record<StickerPosition, string> = {
  tl: 'Top left',
  t: 'Top',
  tr: 'Top right',
  r: 'Right',
  br: 'Bottom right',
  b: 'Bottom',
  bl: 'Bottom left',
  l: 'Left',
}

const EXAMPLE_MANIFEST: CosmeticManifest = {
  name: 'Galaxy Ring',
  description: 'Stars all around you',
  price: 150,
  frame: 'frame.gif',
  sticker: 'star.png',
  stickerPosition: 'tr',
}

/** Item shown in a grid: a built-in decoration or theme, or a student-made cosmetic. */
interface ShopItem {
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
  rarity: DecorationRarity | 'community'
  creator?: Cosmetic['creator']
  sales?: number
}

function itemName(id: string | null | undefined, community: Cosmetic[]) {
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

/** The picture of an item on its Shop card. */
function ItemPreview({ it }: { it: ShopItem }) {
  const { me } = useOrgContext()
  return (
    <>
      {it.kind === 'theme' ? (
        <ThemeSwatch css={it.css ?? ''} className="mb-1" />
      ) : it.kind === 'effect' ? (
        <div className="relative mb-1 flex h-24 w-full items-center justify-center overflow-hidden rounded-lg bg-gradient-to-b from-[#3b2a6b] to-[#1b1530]">
          <Avatar name={me.name} id={me.id} src={me.avatarUrl} size="lg" />
          <ProfileEffect value={it.value} />
        </div>
      ) : it.kind === 'plate' ? (
        <div className="mb-1 flex h-24 w-full flex-col justify-center gap-1.5 rounded-lg border border-border bg-bg-subtle p-2">
          <div className="relative isolate flex items-center gap-2 overflow-hidden rounded-md px-2 py-1.5">
            <NamePlate value={it.value} />
            <Avatar name={me.name} id={me.id} src={me.avatarUrl} size="xs" />
            <span className="truncate text-[13px] font-semibold">{displayName(me)}</span>
          </div>
          <div className="flex items-center gap-2 px-2 py-1 text-[13px] text-fg-subtle">
            <span className="size-5 rounded-full bg-bg-emphasis" /> Someone else
          </div>
        </div>
      ) : (
        <div className="my-4">
          <Avatar
            name={me.name}
            id={me.id}
            src={me.avatarUrl}
            decoration={it.decoration}
            size="xl"
          />
        </div>
      )}
    </>
  )
}

function ShopInner() {
  const { me, org, api } = useOrgContext()
  const qc = useQueryClient()
  const router = useRouter()
  const params = useSearchParams()
  const members = useMembers(org.id)
  const [busy, setBusy] = useState<string | null>(null)
  const [giftItem, setGiftItem] = useState<ShopItem | null>(null)
  const [giftTo, setGiftTo] = useState<string[]>([])
  const presetGift = params.get('gift')
  const presetPerson = members.data?.find((m) => m.id === presetGift)

  const wallet = useQuery({
    queryKey: ['wallet'],
    queryFn: ({ signal }) => get<Wallet>('/api/me/wallet', signal),
  })
  const community = useQuery({
    queryKey: ['cosmetics', org.id, 'shop'],
    queryFn: ({ signal }) => get<Cosmetic[]>(`${api}/cosmetics?view=shop`, signal),
  })
  const w = wallet.data
  const communityList = community.data ?? []

  const builtinItems: ShopItem[] = DECORATIONS.map((d) => ({
    kind: 'decoration',
    itemId: d.id,
    decoration: d.id,
    name: d.name,
    description: d.description,
    price: d.price,
    rarity: d.rarity,
  }))
  const themeItems: ShopItem[] = THEMES.map((t) => ({
    kind: 'theme',
    css: themeCss(t),
    dark: t.dark,
    itemId: t.id,
    decoration: '',
    name: t.name,
    description: `${t.dark ? 'Dark' : 'Light'} theme · palette by ${t.credit}`,
    price: t.price,
    rarity: t.price >= 200 ? 'epic' : 'rare',
  }))
  const effectItems: ShopItem[] = EFFECTS.map((e) => ({
    kind: 'effect',
    value: e.id,
    itemId: e.id,
    decoration: '',
    name: e.name,
    description: e.description,
    price: e.price,
    rarity: e.price >= 200 ? 'epic' : 'rare',
  }))
  const plateItems: ShopItem[] = PLATES.map((pl) => ({
    kind: 'plate',
    value: pl.id,
    itemId: pl.id,
    decoration: '',
    name: pl.name,
    description: pl.description,
    price: pl.price,
    rarity: pl.price >= 180 ? 'epic' : pl.price >= 120 ? 'rare' : 'common',
  }))
  const allCommunity: ShopItem[] = communityList.map((c) => ({
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
  }))
  const communityItems = allCommunity.filter((it) => it.kind === 'decoration')
  const communityThemes = allCommunity.filter((it) => it.kind === 'theme')
  const communityEffects = allCommunity.filter((it) => it.kind === 'effect')
  const communityPlates = allCommunity.filter((it) => it.kind === 'plate')

  // Previewing a theme puts it on for a moment; leaving the Shop puts yours back.
  const [preview, setPreview] = useState<string | null>(null)
  const myThemeKey = JSON.stringify(me.appTheme)
  useEffect(() => {
    if (!preview) return
    return () => applyAppTheme(JSON.parse(myThemeKey))
  }, [preview, myThemeKey])
  const togglePreview = (it: ShopItem) => {
    if (preview === it.itemId) return setPreview(null)
    applyAppTheme({ css: it.css ?? '', dark: it.dark ?? null }, { cache: false })
    setPreview(it.itemId)
  }

  const refresh = (next?: Wallet) => {
    if (next) qc.setQueryData(['wallet'], next)
    void qc.invalidateQueries({ queryKey: keys.me })
    void qc.invalidateQueries({ queryKey: ['members'] })
  }

  const act = async (key: string, fn: () => Promise<Wallet>, success?: string) => {
    setBusy(key)
    try {
      refresh(await fn())
      if (success) toast.success(success)
      return true
    } catch (e) {
      toast.error(errorMessage(e))
      return false
    } finally {
      setBusy(null)
    }
  }

  const claim = () =>
    act(
      'daily',
      () => post<Wallet>('/api/me/wallet/daily'),
      `+${COINS.daily + streakBonus((w?.streak ?? 0) + 1)} Wicky Coins! 🔥 ${(w?.streak ?? 0) + 1}-day streak. See you tomorrow 🎉`,
    )
  const buy = (it: ShopItem) =>
    act(
      it.itemId,
      () => post<Wallet>(`/api/me/shop/${encodeURIComponent(it.itemId)}/buy`, {}),
      `${it.name} is yours! ✨`,
    )
  const equip = (id: string | null) =>
    act(`equip:${id}`, () => put<Wallet>('/api/me/decoration', { itemId: id }))
  const equipSlot = (slot: 'effect' | 'plate', id: string | null) =>
    act(`${slot}:${id}`, () => put<Wallet>('/api/me/equip', { slot, itemId: id }))
  const switchTheme = (id: string | null) => {
    setPreview(null)
    return act(`theme:${id}`, () => put<Wallet>('/api/me/theme', { itemId: id }))
  }
  const sendGift = async (it: ShopItem, to: string) => {
    const person = members.data?.find((m) => m.id === to)
    const ok = await act(
      `gift:${it.itemId}`,
      () =>
        post<Wallet>(`/api/me/shop/${encodeURIComponent(it.itemId)}/buy`, {
          giftTo: to,
        }),
      `Sent ${it.name} to ${person ? displayName(person) : 'them'} 🎁`,
    )
    if (ok) {
      setGiftItem(null)
      setGiftTo([])
      if (presetGift) router.replace('?')
    }
  }

  const equippedKey = w?.equipped?.split('|')[0] ?? null

  const grid = (items: ShopItem[], empty: string) =>
    !items.length ? (
      <p className="py-10 text-center text-[13px] text-fg-subtle">{empty}</p>
    ) : (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((it) => {
          const owned = w?.owned.includes(it.itemId)
          const isTheme = it.kind === 'theme'
          const slot = it.kind === 'effect' || it.kind === 'plate' ? it.kind : null
          const wearing = isTheme
            ? w?.equippedTheme === it.itemId
            : slot
              ? (slot === 'effect' ? w?.equippedEffect : w?.equippedPlate) === it.value
              : equippedKey === it.itemId
          const takeOff = () =>
            isTheme ? switchTheme(null) : slot ? equipSlot(slot, null) : equip(null)
          const putOn = () =>
            isTheme ? switchTheme(it.itemId) : slot ? equipSlot(slot, it.itemId) : equip(it.itemId)
          const busyKey = isTheme ? 'theme' : (slot ?? 'equip')
          const afford = (w?.coins ?? 0) >= it.price
          const gifted = w?.giftedBy[it.itemId]
          return (
            <li
              key={it.itemId}
              className={cn(
                'group relative flex flex-col items-center rounded-xl border p-4 text-center transition-colors',
                wearing
                  ? 'border-accent bg-accent-subtle'
                  : 'border-border hover:border-border-strong',
              )}
            >
              <ItemPreview it={it} />
              <p className="mt-1 text-[14px] font-semibold">{it.name}</p>
              <span
                className={cn(
                  'mt-1 rounded-full px-2 py-0.5 text-2xs font-semibold',
                  RARITY[it.rarity].className,
                )}
              >
                {RARITY[it.rarity].label}
              </span>
              <p className="mt-2 min-h-[2.5em] text-xs text-fg-muted">{it.description}</p>
              {it.creator && (
                <p className="text-2xs text-fg-subtle">
                  by {displayName(it.creator)} · {it.sales ?? 0} sold
                </p>
              )}
              {gifted && <p className="text-2xs text-accent-text">🎁 from {gifted.name}</p>}
              <div className="mt-3 flex w-full gap-1.5">
                {presetGift ? (
                  <Button
                    size="sm"
                    variant="primary"
                    className="w-full tabular-nums"
                    disabled={!afford || !w}
                    loading={busy === `gift:${it.itemId}`}
                    onClick={() => sendGift(it, presetGift)}
                  >
                    <Gift /> 🪙 {it.price}
                  </Button>
                ) : (
                  <>
                    {wearing ? (
                      <Button
                        size="sm"
                        className="flex-1"
                        loading={busy === `${busyKey}:null`}
                        onClick={() => takeOff()}
                      >
                        {isTheme ? 'Using ✓' : 'Wearing ✓'}
                      </Button>
                    ) : owned ? (
                      <Button
                        size="sm"
                        variant="primary"
                        className="flex-1"
                        loading={busy === `${busyKey}:${it.itemId}`}
                        onClick={() => putOn()}
                      >
                        {isTheme ? 'Use' : 'Wear'}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant={afford ? 'primary' : 'secondary'}
                        className="flex-1 tabular-nums"
                        disabled={!afford || !w}
                        loading={busy === it.itemId}
                        onClick={() => buy(it)}
                        title={afford ? undefined : `You need ${it.price - (w?.coins ?? 0)} more`}
                      >
                        🪙 {it.price}
                      </Button>
                    )}
                    {isTheme && !wearing && (
                      <Button
                        size="sm"
                        title={preview === it.itemId ? 'Stop preview' : 'Preview'}
                        aria-label={`${preview === it.itemId ? 'Stop previewing' : 'Preview'} ${it.name}`}
                        aria-pressed={preview === it.itemId}
                        onClick={() => togglePreview(it)}
                      >
                        {preview === it.itemId ? <EyeOff /> : <Eye />}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      title="Gift to someone"
                      aria-label={`Gift ${it.name}`}
                      onClick={() => setGiftItem(it)}
                    >
                      <Gift />
                    </Button>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    )

  const catalog = new Map(
    [...builtinItems, ...themeItems, ...effectItems, ...plateItems, ...allCommunity].map(
      (it) => [it.itemId, it] as const,
    ),
  )
  const ownedItems = [
    ...builtinItems,
    ...themeItems,
    ...effectItems,
    ...plateItems,
    ...allCommunity,
  ].filter((it) => w?.owned.includes(it.itemId))

  return (
    <div className="q-anim-on flex min-h-0 flex-1 flex-col">
      <PageHeader title="Wicky Shop" icon={<Store />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl p-4 md:p-6">
          {presetGift && (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-accent bg-accent-subtle px-4 py-3 text-[13px]">
              <Gift className="size-4 text-accent-text" />
              <span className="flex-1">
                Picking a gift for{' '}
                <strong>{presetPerson ? displayName(presetPerson) : 'someone'}</strong>. You pay,
                they get it.
              </span>
              <Button size="sm" variant="ghost" onClick={() => router.replace('?')}>
                <X /> Cancel
              </Button>
            </div>
          )}

          {/* Wallet */}
          <section className="mb-6 grid gap-4 md:grid-cols-[1fr_auto]">
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
                  <p className="text-3xl font-bold tabular-nums">🪙 {w.coins.toLocaleString()}</p>
                ) : (
                  <Skeleton className="mt-1 h-9 w-28" />
                )}
                <p className="mt-1 text-xs text-fg-subtle">
                  Wearing: {w?.equipped ? itemName(w.equipped, communityList) : 'nothing'}
                  {w?.equipped && (
                    <button
                      type="button"
                      className="ml-2 text-accent-text hover:underline"
                      onClick={() => equip(null)}
                    >
                      Take off
                    </button>
                  )}
                </p>
                <p className="text-xs text-fg-subtle">
                  Theme: {w?.equippedTheme ? itemName(w.equippedTheme, communityList) : 'default'}
                  {w?.equippedTheme && (
                    <button
                      type="button"
                      className="ml-2 text-accent-text hover:underline"
                      onClick={() => switchTheme(null)}
                    >
                      Turn off
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
                {w?.dailyAvailable
                  ? `Claim ${COINS.daily + streakBonus((w?.streak ?? 0) + 1)} daily coins`
                  : 'Claimed today ✓'}
              </Button>
              <p className="text-xs text-fg-muted">
                🔥 {w?.streak ?? 0}-day streak
                {w && ` · tomorrow +${streakBonus(w.streak + (w.dailyAvailable ? 2 : 1))} bonus`}
              </p>
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

          <Tabs defaultValue="decorations">
            <TabsList>
              <TabsTrigger value="decorations">Decorations</TabsTrigger>
              <TabsTrigger value="effects">Effects</TabsTrigger>
              <TabsTrigger value="plates">Name plates</TabsTrigger>
              <TabsTrigger value="themes">Themes</TabsTrigger>
              <TabsTrigger value="community">Community</TabsTrigger>
              <TabsTrigger value="create">Create</TabsTrigger>
              <TabsTrigger value="market">Market</TabsTrigger>
              <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
              <TabsTrigger value="mine">My stuff</TabsTrigger>
            </TabsList>
            <TabsContent value="decorations" className="pt-4">
              {grid(builtinItems, '')}
            </TabsContent>
            <TabsContent value="effects" className="pt-4">
              <p className="mb-3 text-[13px] text-fg-muted">
                Animated effects that play over your profile card.
              </p>
              {grid(effectItems, '')}
              <h3 className="mt-8 mb-3 text-[14px] font-semibold">Made by students</h3>
              {grid(communityEffects, 'No student-made effects yet. Make one in the Create tab!')}
            </TabsContent>
            <TabsContent value="plates" className="pt-4">
              <p className="mb-3 text-[13px] text-fg-muted">
                An animated background behind your name in DMs and member lists.
              </p>
              {grid(plateItems, '')}
              <h3 className="mt-8 mb-3 text-[14px] font-semibold">Made by students</h3>
              {grid(
                communityPlates,
                'No student-made name plates yet. Make one in the Create tab!',
              )}
            </TabsContent>
            <TabsContent value="themes" className="pt-4">
              <p className="mb-3 text-[13px] text-fg-muted">
                Themes change the colours of the whole app, just for you. Press 👁 to try one on
                first.
              </p>
              {grid(themeItems, '')}
              <h3 className="mt-8 mb-3 text-[14px] font-semibold">Made by students</h3>
              {grid(
                communityThemes,
                'No student-made themes yet. Write one in CSS in the Create tab!',
              )}
            </TabsContent>
            <TabsContent value="community" className="pt-4">
              {community.isLoading ? (
                <Skeleton className="h-60" />
              ) : (
                grid(
                  communityItems,
                  'No student-made cosmetics yet. Make the first one in the Create tab!',
                )
              )}
            </TabsContent>
            <TabsContent value="market" className="pt-4">
              <MarketView
                catalog={catalog}
                owned={w?.owned ?? []}
                coins={w?.coins ?? 0}
                onChange={() => refresh()}
              />
            </TabsContent>
            <TabsContent value="leaderboard" className="pt-4">
              <LeaderboardView />
            </TabsContent>
            <TabsContent value="create" className="pt-4">
              <CreatePicker />
            </TabsContent>
            <TabsContent value="mine" className="pt-4">
              <h3 className="mb-3 text-[14px] font-semibold">Your collection</h3>
              {grid(ownedItems, "You don't own any decorations or themes yet.")}
              <MyCreations />
              {!!w?.history.length && (
                <section className="mt-10">
                  <h3 className="mb-3 text-[14px] font-semibold">Recent coins</h3>
                  <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
                    {w.history.map((h) => (
                      <li key={h.id} className="flex items-center gap-3 px-3 py-2">
                        <span className="flex-1">
                          {REASON[h.reason]}
                          {(h.reason === 'purchase' ||
                            h.reason === 'market_buy' ||
                            h.reason === 'market_sale' ||
                            h.reason === 'sale' ||
                            h.reason === 'gift_item') &&
                            h.ref &&
                            ` ${itemName(h.ref, communityList)}`}
                          {h.reason === 'gift' && h.ref && ` · “${h.ref}”`}
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
            </TabsContent>
          </Tabs>

          <p className="mt-10 border-t border-border pt-4 text-center text-2xs text-fg-subtle">
            Animated stickers are{' '}
            <a
              className="underline"
              href="https://googlefonts.github.io/noto-emoji-animation/"
              target="_blank"
              rel="noreferrer"
            >
              Noto Animated Emoji
            </a>{' '}
            by Google, used under{' '}
            <a
              className="underline"
              href="https://creativecommons.org/licenses/by/4.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC BY 4.0
            </a>
            . Theme palettes from Catppuccin, Dracula, Nord, Gruvbox, Tokyo Night, Rosé Pine and
            Solarized (MIT licensed). Student-made cosmetics belong to their creators and are
            checked by a teacher before they're sold.
          </p>
        </div>
      </div>

      <Dialog open={!!giftItem} onOpenChange={(o) => !o && setGiftItem(null)}>
        <DialogContent
          title={`Gift ${giftItem?.name ?? ''}`}
          description={`Pick who gets it. You pay 🪙 ${giftItem?.price ?? 0}.`}
        >
          <PeoplePicker
            value={giftTo}
            onChange={(ids) => setGiftTo(ids.slice(-1))}
            exclude={[me.id]}
            autoFocus
          />
          <DialogFooter>
            <Button onClick={() => setGiftItem(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!giftTo.length || (w?.coins ?? 0) < (giftItem?.price ?? 0)}
              loading={busy === `gift:${giftItem?.itemId}`}
              onClick={() => giftItem && giftTo[0] && sendGift(giftItem, giftTo[0])}
            >
              <Gift /> Send gift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Draws an avatar with a not-yet-uploaded custom decoration (local image previews). */
function CustomPreview({
  frame,
  sticker,
  position,
}: {
  frame: string | null
  sticker: string | null
  position: StickerPosition
}) {
  const { me } = useOrgContext()
  return (
    <span className="q-ava relative inline-flex shrink-0" data-size="xl">
      <Avatar name={me.name} id={me.id} src={me.avatarUrl} size="xl" />
      <span aria-hidden="true" className="q-deco q-deco-custom">
        {frame && <img className="q-deco-frame" src={frame} alt="" />}
        {sticker && <img className={`q-deco-art q-deco-at-${position}`} src={sticker} alt="" />}
      </span>
    </span>
  )
}

function cosmeticItem(c: Cosmetic): ShopItem {
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
  }
}

function MarketView({
  catalog,
  owned,
  coins,
  onChange,
}: {
  catalog: Map<string, ShopItem>
  owned: string[]
  coins: number
  onChange: () => void
}) {
  const { org, api, me } = useOrgContext()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [sellId, setSellId] = useState('')
  const [price, setPrice] = useState(100)
  const listings = useQuery({
    queryKey: ['market', org.id],
    queryFn: ({ signal }) => get<MarketListing[]>(`${api}/market`, signal),
  })
  const itemFor = (l: MarketListing) =>
    catalog.get(l.itemId) ?? (l.cosmetic ? cosmeticItem(l.cosmetic) : undefined)
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    try {
      await fn()
      toast.success(ok)
      void qc.invalidateQueries({ queryKey: ['market', org.id] })
      void qc.invalidateQueries({ queryKey: ['wallet'] })
      onChange()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  const all = listings.data ?? []
  const mine = all.filter((l) => l.seller.id === me.id)
  const others = all.filter((l) => l.seller.id !== me.id)
  const listed = new Set(mine.map((l) => l.itemId))
  const sellable = owned.filter((id) => !listed.has(id) && catalog.has(id))

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-xl border border-border p-4">
        <h3 className="text-[14px] font-semibold">Sell something you own</h3>
        <p className="mb-3 text-xs text-fg-muted">
          Set your own price. When it sells you get {Math.round(MARKET_SHARE * 100)}% and the item
          goes to the buyer (it's taken off you if you're wearing it).
        </p>
        {!sellable.length ? (
          <p className="text-[13px] text-fg-subtle">You don't have anything to sell yet.</p>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!sellId) return
              void run(
                'sell',
                () => post(`${api}/market`, { itemId: sellId, price }),
                'Listed on the Market 🏷️',
              )
            }}
          >
            <Select
              aria-label="Item to sell"
              value={sellId}
              onChange={(e) => {
                setSellId(e.target.value)
                const it = catalog.get(e.target.value)
                if (it) setPrice(it.price)
              }}
              className="min-w-48"
            >
              <option value="">Pick an item…</option>
              {sellable.map((id) => (
                <option key={id} value={id}>
                  {catalog.get(id)?.name ?? id}
                </option>
              ))}
            </Select>
            <Input
              aria-label="Price"
              type="number"
              min={MARKET_PRICE.min}
              max={MARKET_PRICE.max}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              className="w-28"
            />
            <Button type="submit" variant="primary" disabled={!sellId} loading={busy === 'sell'}>
              List for 🪙 {price}
            </Button>
          </form>
        )}
        {!!mine.length && (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border text-[13px]">
            {mine.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2">
                <span className="flex-1">
                  {itemFor(l)?.name ?? l.itemId} · 🪙 {l.price}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === `cancel:${l.id}`}
                  onClick={() =>
                    run(`cancel:${l.id}`, () => del(`${api}/market/${l.id}`), 'Listing removed')
                  }
                >
                  Stop selling
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-[14px] font-semibold">For sale</h3>
        {listings.isLoading ? (
          <Skeleton className="h-60" />
        ) : !others.length ? (
          <p className="py-10 text-center text-[13px] text-fg-subtle">
            Nothing for sale right now. Check back later!
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {others.map((l) => {
              const it = itemFor(l)
              if (!it) return null
              const has = owned.includes(l.itemId)
              const afford = coins >= l.price
              return (
                <li
                  key={l.id}
                  className="flex flex-col items-center rounded-xl border border-border p-4 text-center"
                >
                  <ItemPreview it={it} />
                  <p className="mt-1 text-[14px] font-semibold">{it.name}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-fg-muted">
                    <Avatar
                      name={l.seller.name}
                      id={l.seller.id}
                      src={l.seller.avatarUrl}
                      size="xs"
                    />
                    {displayName(l.seller)}
                  </p>
                  {l.price < it.price && (
                    <p className="mt-1 text-2xs text-success">
                      {Math.round((1 - l.price / it.price) * 100)}% under Shop price
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant={afford && !has ? 'primary' : 'secondary'}
                    className="mt-3 w-full tabular-nums"
                    disabled={has || !afford}
                    loading={busy === `buy:${l.id}`}
                    onClick={() =>
                      run(
                        `buy:${l.id}`,
                        () => post(`${api}/market/${l.id}/buy`, {}),
                        `${it.name} is yours! ✨`,
                      )
                    }
                  >
                    {has ? 'You own this' : `🪙 ${l.price}`}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function Board({
  title,
  unit,
  rows,
}: {
  title: string
  unit: string
  rows: Leaderboard['earners']
}) {
  const medal = ['🥇', '🥈', '🥉']
  return (
    <section className="rounded-xl border border-border p-4">
      <h3 className="mb-3 text-[14px] font-semibold">{title}</h3>
      {!rows.length ? (
        <p className="text-[13px] text-fg-subtle">Nobody yet. Be the first!</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <li key={r.user.id} className="flex items-center gap-2 text-[13px]">
              <span className="w-6 text-center tabular-nums text-fg-subtle">
                {medal[i] ?? i + 1}
              </span>
              <Avatar
                name={r.user.name}
                id={r.user.id}
                src={r.user.avatarUrl}
                decoration={r.user.decoration}
                size="sm"
              />
              <span className="min-w-0 flex-1 truncate font-medium">{displayName(r.user)}</span>
              <span className="font-semibold tabular-nums">
                {r.value.toLocaleString()}{' '}
                <span className="font-normal text-fg-subtle">{unit}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function LeaderboardView() {
  const { org, api } = useOrgContext()
  const q = useQuery({
    queryKey: ['leaderboard', org.id],
    queryFn: ({ signal }) => get<Leaderboard>(`${api}/leaderboard`, signal),
  })
  if (!q.data) return <Skeleton className="h-60" />
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Board title="🪙 Top earners this week" unit="coins" rows={q.data.earners} />
      <Board title="🎨 Top creators" unit="sold" rows={q.data.creators} />
      <Board title="🔥 Longest streaks" unit="days" rows={q.data.streaks} />
    </div>
  )
}

const KIND_LABEL: Record<ItemKind, string> = {
  decoration: 'Decoration',
  effect: 'Profile effect',
  plate: 'Name plate',
  theme: 'Theme (CSS)',
}

/** Profile effects and name plates students make: one image each. */
function CreateImageItem({ kind }: { kind: 'effect' | 'plate' }) {
  const { org, api, me } = useOrgContext()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState(120)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])

  const submit = async () => {
    if (!file) return
    setSaving(true)
    try {
      const f = await upload<Attachment>(`${api}/files?purpose=cosmetic`, file).promise
      await post(`${api}/cosmetics`, { kind, name, description, price, frameFileId: f.id })
      toast.success('Sent to a teacher for review. It shows in the Shop once approved!')
      setName('')
      setDescription('')
      setFile(null)
      void qc.invalidateQueries({ queryKey: ['cosmetics', org.id] })
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
        <Field label="Name">
          {(p) => (
            <Input
              {...p}
              required
              minLength={2}
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Description">
          {(p) => (
            <Input
              {...p}
              maxLength={140}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Price"
          hint={`${COSMETIC_PRICE.min}–${COSMETIC_PRICE.max} coins. You get ${Math.round(CREATOR_SHARE * 100)}% of every sale.`}
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              min={COSMETIC_PRICE.min}
              max={COSMETIC_PRICE.max}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              className="w-32"
            />
          )}
        </Field>
        <div>
          <p className="mb-1 text-[13px] font-medium">Image</p>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] hover:bg-bg-muted">
            <Upload className="size-3.5" /> {file ? file.name : 'Choose image'}
            <input
              type="file"
              accept="image/png,image/gif,image/webp"
              hidden
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
          </label>
          <p className="mt-1 text-2xs text-fg-subtle">
            {kind === 'effect'
              ? 'A transparent GIF or WebP that plays over the whole card (about 340×500). Keep the middle mostly clear so people can read the card.'
              : 'A wide image or GIF (about 600×80) that goes behind your name. Darker or softer images keep names readable.'}{' '}
            Up to 2 MB.
          </p>
        </div>
        <p className="text-xs text-fg-subtle">
          Only use art you made yourself or have permission to use. A teacher checks it first.
        </p>
        <div>
          <Button type="submit" variant="primary" loading={saving} disabled={!file}>
            Submit for review
          </Button>
        </div>
      </form>
      <div className="flex flex-col items-center gap-3 self-start rounded-xl border border-border p-5">
        <p className="text-2xs font-semibold text-fg-subtle uppercase">Preview</p>
        {kind === 'effect' ? (
          <div className="relative flex h-40 w-full items-center justify-center overflow-hidden rounded-lg bg-gradient-to-b from-[#3b2a6b] to-[#1b1530]">
            <Avatar name={me.name} id={me.id} src={me.avatarUrl} size="xl" />
            {url && (
              // biome-ignore lint/performance/noImgElement: local preview of the picked file
              <img src={url} alt="" className="absolute inset-0 size-full object-cover" />
            )}
          </div>
        ) : (
          <div className="relative isolate flex w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1.5">
            {url && (
              <span
                aria-hidden="true"
                className="q-plate q-plate-img"
                style={{ backgroundImage: `url("${url}")` }}
              />
            )}
            <Avatar name={me.name} id={me.id} src={me.avatarUrl} size="xs" />
            <span className="truncate text-[13px] font-semibold">{displayName(me)}</span>
          </div>
        )}
        <p className="text-[14px] font-semibold">
          {name || `Your ${KIND_LABEL[kind].toLowerCase()}`}
        </p>
        <p className="text-xs text-fg-muted">🪙 {price}</p>
      </div>
    </div>
  )
}

function CreatePicker() {
  const [kind, setKind] = useState<ItemKind>('decoration')
  return (
    <>
      <div className="mb-5 inline-flex rounded-lg border border-border p-0.5 text-[13px]">
        {(['decoration', 'effect', 'plate', 'theme'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              'rounded-md px-3 py-1',
              kind === k ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-muted',
            )}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {kind === 'decoration' ? (
        <CreateCosmetic />
      ) : kind === 'theme' ? (
        <CreateTheme />
      ) : (
        <CreateImageItem key={kind} kind={kind} />
      )}
    </>
  )
}

function CreateTheme() {
  const { org, api, me } = useOrgContext()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState(150)
  const [css, setCss] = useState(THEME_TEMPLATE)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const clean = useMemo(() => sanitizeThemeCss(css), [css])
  const myThemeKey = JSON.stringify(me.appTheme)

  // Live preview while it's on; your own theme comes back when you stop or leave.
  useEffect(() => {
    if (!previewing) return
    applyAppTheme({ css: clean.css, dark: null }, { cache: false })
  }, [previewing, clean.css])
  useEffect(() => {
    if (!previewing) return
    return () => applyAppTheme(JSON.parse(myThemeKey))
  }, [previewing, myThemeKey])

  const submit = async () => {
    setSaving(true)
    try {
      await post(`${api}/cosmetics`, { kind: 'theme', name, description, price, css })
      toast.success('Sent to a teacher for review. It shows under Themes once approved!')
      setName('')
      setDescription('')
      setPreviewing(false)
      void qc.invalidateQueries({ queryKey: ['cosmetics', org.id] })
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
        <Field label="Name">
          {(p) => (
            <Input
              {...p}
              required
              minLength={2}
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Description">
          {(p) => (
            <Input
              {...p}
              maxLength={140}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Price"
          hint={`${COSMETIC_PRICE.min}–${COSMETIC_PRICE.max} coins. You get ${Math.round(CREATOR_SHARE * 100)}% of every sale.`}
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              min={COSMETIC_PRICE.min}
              max={COSMETIC_PRICE.max}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              className="w-32"
            />
          )}
        </Field>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium">CSS</p>
            <div className="flex gap-1.5">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-bg-muted">
                <Upload className="size-3.5" /> Load .css file
                <input
                  type="file"
                  accept=".css,text/css"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) setCss((await f.text()).slice(0, 20_000))
                  }}
                />
              </label>
              <Button type="button" size="sm" onClick={() => setCss(THEME_TEMPLATE)}>
                Reset
              </Button>
            </div>
          </div>
          <Textarea
            aria-label="Theme CSS"
            spellCheck={false}
            rows={18}
            value={css}
            onChange={(e) => setCss(e.target.value)}
            className="font-mono text-xs"
          />
          <p className="mt-1 text-2xs text-fg-subtle">
            Set the <code>--q-…</code> colour variables (bg, fg, accent, border…). You can add other
            CSS too. Links to other sites (<code>url()</code>, <code>@import</code>) are removed so
            nobody gets tracked.
          </p>
          {!!clean.removed.length && (
            <p className="mt-1 text-xs text-warning">
              These will be removed: {clean.removed.join(', ')}
            </p>
          )}
        </div>
        <p className="text-xs text-fg-subtle">
          A teacher checks every theme before it goes on sale. Themes that make WickyChat hard to
          use or hide things won't be approved.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => setPreviewing((v) => !v)}>
            {previewing ? <EyeOff /> : <Eye />} {previewing ? 'Stop preview' : 'Preview on the app'}
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!clean.css}>
            Submit for review
          </Button>
        </div>
      </form>
      <div className="flex flex-col items-center gap-3 self-start rounded-xl border border-border p-5">
        <p className="text-2xs font-semibold text-fg-subtle uppercase">Preview</p>
        <ThemeSwatch css={clean.css} />
        <p className="text-[14px] font-semibold">{name || 'Your theme'}</p>
        <p className="text-xs text-fg-muted">🪙 {price}</p>
      </div>
    </div>
  )
}

function CreateCosmetic() {
  const { org, api } = useOrgContext()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState(100)
  const [frame, setFrame] = useState<File | null>(null)
  const [sticker, setSticker] = useState<File | null>(null)
  const [position, setPosition] = useState<StickerPosition>('tr')
  const [saving, setSaving] = useState(false)

  const frameUrl = useMemo(() => (frame ? URL.createObjectURL(frame) : null), [frame])
  const stickerUrl = useMemo(() => (sticker ? URL.createObjectURL(sticker) : null), [sticker])
  useEffect(() => () => void (frameUrl && URL.revokeObjectURL(frameUrl)), [frameUrl])
  useEffect(() => () => void (stickerUrl && URL.revokeObjectURL(stickerUrl)), [stickerUrl])

  /** Reads a pack: a cosmetic.json plus the images it names. */
  const loadPack = async (list: FileList | null) => {
    const picked = Array.from(list ?? [])
    const json = picked.find((f) => f.name.toLowerCase().endsWith('.json'))
    if (!json) return toast.error('Include a cosmetic.json in what you pick.')
    let m: Partial<CosmeticManifest>
    try {
      m = JSON.parse(await json.text())
    } catch {
      return toast.error("cosmetic.json isn't valid JSON.")
    }
    const byName = (n?: string) =>
      n ? picked.find((f) => f.name.toLowerCase() === n.toLowerCase()) : undefined
    if (typeof m.name === 'string') setName(m.name.slice(0, 40))
    if (typeof m.description === 'string') setDescription(m.description.slice(0, 140))
    if (typeof m.price === 'number') setPrice(Math.round(m.price))
    if (m.stickerPosition && STICKER_POSITIONS.includes(m.stickerPosition))
      setPosition(m.stickerPosition)
    const f = byName(m.frame)
    const s = byName(m.sticker)
    if (m.frame && !f) toast.error(`Couldn't find ${m.frame} in what you picked.`)
    if (m.sticker && !s) toast.error(`Couldn't find ${m.sticker} in what you picked.`)
    setFrame(f ?? null)
    setSticker(s ?? null)
    if (f || s) toast.success('Pack loaded. Check the preview, then submit.')
  }

  const downloadExample = () => {
    const blob = new Blob([JSON.stringify(EXAMPLE_MANIFEST, null, 2)], {
      type: 'application/json',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'cosmetic.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const submit = async () => {
    setSaving(true)
    try {
      const up = async (f: File | null) =>
        f ? (await upload<Attachment>(`${api}/files?purpose=cosmetic`, f).promise).id : null
      const [frameFileId, stickerFileId] = await Promise.all([up(frame), up(sticker)])
      await post(`${api}/cosmetics`, {
        name,
        description,
        price,
        frameFileId,
        stickerFileId,
        stickerPosition: position,
      })
      toast.success('Sent to a teacher for review. It shows in the Shop once approved!')
      setName('')
      setDescription('')
      setFrame(null)
      setSticker(null)
      void qc.invalidateQueries({ queryKey: ['cosmetics', org.id] })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const imgInput = (
    label: string,
    hint: string,
    file: File | null,
    set: (f: File | null) => void,
  ) => (
    <div>
      <p className="mb-1 text-[13px] font-medium">{label}</p>
      <div className="flex items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] hover:bg-bg-muted">
          <Upload className="size-3.5" /> {file ? 'Change' : 'Choose image'}
          <input
            type="file"
            accept="image/png,image/gif,image/webp"
            hidden
            onChange={(e) => {
              set(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </label>
        {file && (
          <>
            <span className="truncate text-xs text-fg-muted">{file.name}</span>
            <button
              type="button"
              aria-label={`Remove ${label}`}
              className="text-fg-subtle hover:text-danger"
              onClick={() => set(null)}
            >
              <X className="size-3.5" />
            </button>
          </>
        )}
      </div>
      <p className="mt-1 text-2xs text-fg-subtle">{hint}</p>
    </div>
  )

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_240px]">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="rounded-lg border border-dashed border-border p-4 text-[13px]">
          <p className="font-medium">Have a pack?</p>
          <p className="mt-0.5 text-fg-muted">
            Pick your <code>cosmetic.json</code> and its images together and everything fills in.{' '}
            <button type="button" className="text-accent-text underline" onClick={downloadExample}>
              Download an example cosmetic.json
            </button>
          </p>
          <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 hover:bg-bg-muted">
            <Upload className="size-3.5" /> Upload pack
            <input
              type="file"
              multiple
              accept=".json,application/json,image/png,image/gif,image/webp"
              hidden
              onChange={(e) => {
                void loadPack(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        <Field label="Name">
          {(p) => (
            <Input
              {...p}
              required
              minLength={2}
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Description">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              maxLength={140}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Price"
          hint={`${COSMETIC_PRICE.min}–${COSMETIC_PRICE.max} coins. You get ${Math.round(CREATOR_SHARE * 100)}% of every sale.`}
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              min={COSMETIC_PRICE.min}
              max={COSMETIC_PRICE.max}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              className="w-32"
            />
          )}
        </Field>
        {imgInput(
          'Frame',
          'A square PNG, GIF or WebP that goes around the whole picture. Leave the middle transparent. Up to 2 MB; GIFs animate.',
          frame,
          setFrame,
        )}
        {imgInput(
          'Sticker',
          'A small image that sits on the edge of the picture.',
          sticker,
          setSticker,
        )}
        {sticker && (
          <Field label="Sticker position">
            {(p) => (
              <Select
                {...p}
                value={position}
                onChange={(e) => setPosition(e.target.value as StickerPosition)}
              >
                {STICKER_POSITIONS.map((s) => (
                  <option key={s} value={s}>
                    {POSITION_LABEL[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <p className="text-xs text-fg-subtle">
          Only use art you made yourself or have permission to use. No art copied from Discord,
          games or other apps. A teacher checks every cosmetic before it goes on sale.
        </p>
        <div>
          <Button type="submit" variant="primary" loading={saving} disabled={!frame && !sticker}>
            Submit for review
          </Button>
        </div>
      </form>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border p-6">
        <p className="text-2xs font-semibold text-fg-subtle uppercase">Preview</p>
        <div className="my-4">
          <CustomPreview frame={frameUrl} sticker={stickerUrl} position={position} />
        </div>
        <p className="text-[14px] font-semibold">{name || 'Your cosmetic'}</p>
        <p className="text-xs text-fg-muted">🪙 {price}</p>
      </div>
    </div>
  )
}

function MyCreations() {
  const { org, api } = useOrgContext()
  const qc = useQueryClient()
  const mine = useQuery({
    queryKey: ['cosmetics', org.id, 'mine'],
    queryFn: ({ signal }) => get<Cosmetic[]>(`${api}/cosmetics?view=mine`, signal),
  })
  if (!mine.data?.length) return null
  const status = {
    pending: { label: '⏳ Waiting for review', className: 'text-fg-muted' },
    approved: { label: '✅ On sale', className: 'text-success' },
    rejected: { label: '❌ Not approved', className: 'text-danger' },
  }
  return (
    <section className="mt-10">
      <h3 className="mb-3 text-[14px] font-semibold">Your creations</h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {mine.data.map((c) => (
          <li key={c.id} className="flex items-center gap-4 p-3">
            {c.kind === 'theme' ? (
              <ThemeSwatch css={c.css ?? ''} className="h-14 w-20" />
            ) : c.kind === 'effect' || c.kind === 'plate' ? (
              <span className="relative isolate block h-14 w-20 overflow-hidden rounded-md bg-bg-muted">
                <NamePlate value={c.value} />
              </span>
            ) : (
              <span className="p-2">
                <Avatar name="" id={c.id} decoration={c.decoration} size="lg" />
              </span>
            )}
            <div className="min-w-0 flex-1 text-[13px]">
              <p className="font-medium">
                {c.name} <span className="text-fg-subtle">· 🪙 {c.price}</span>
              </p>
              <p className={status[c.status].className}>
                {status[c.status].label}
                {c.status === 'approved' && ` · ${c.sales} sold`}
              </p>
              {c.reviewNote && <p className="text-xs text-fg-muted">Teacher: “{c.reviewNote}”</p>}
            </div>
            {c.status !== 'approved' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await del(`${api}/cosmetics/${c.id}`)
                    void qc.invalidateQueries({ queryKey: ['cosmetics', org.id] })
                  } catch (e) {
                    toast.error(errorMessage(e))
                  }
                }}
              >
                Delete
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function ShopPage() {
  return (
    <Suspense>
      <ShopInner />
    </Suspense>
  )
}

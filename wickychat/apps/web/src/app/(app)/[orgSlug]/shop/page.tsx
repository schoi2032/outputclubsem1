'use client'
/**
 * WickyChat: the Wicky Shop. Coin balance and daily bonus, built-in animated decorations,
 * student-made cosmetics (create them from a form or a cosmetic.json pack), and gifting.
 */
import {
  ACHIEVEMENTS,
  type Attachment,
  COINS,
  COSMETIC_PRICE,
  COSMETIC_STOCK,
  type CoinTransaction,
  type Cosmetic,
  type CosmeticManifest,
  CRATES,
  CREATOR_SHARE,
  eventEndsAt,
  eventStartsAt,
  FLAIR_KINDS,
  type FlairKind,
  type ItemKind,
  isEventLive,
  isSpecKind,
  type Leaderboard,
  liveEvents,
  MARKET_PRICE,
  MARKET_SHARE,
  type MarketListing,
  type SpecKind,
  STICKER_POSITIONS,
  STREAK_CRATE,
  type StickerPosition,
  sanitizeThemeCss,
  streakBonus,
  THEME_TEMPLATE,
  upcomingEvents,
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
import {
  ArrowLeftRight,
  Coins,
  Eye,
  EyeOff,
  Gift,
  Heart,
  Pin,
  Store,
  Upload,
  X,
} from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { PeoplePicker } from '@/components/dialogs/people-picker'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { NamePlate } from '@/components/profile/cosmetics-fx'
import { useMyShelf } from '@/components/profile/shelf'
import { AchievementsView, useAchievements } from '@/components/shop/achievements'
import { ArtistsView } from '@/components/shop/artists'
import { AuctionsView } from '@/components/shop/auctions'
import { BundlesView, CreateBundle, MyBundles, useBundleDefs } from '@/components/shop/bundles'
import { ClassWarView } from '@/components/shop/classwar'
import { CrateArt, CratesView, CreateCrate, MyCrates, useCrateDefs } from '@/components/shop/crates'
import { CreateFlair } from '@/components/shop/create-flair'
import { EarnView, earnWaiting, useEarn, useTrivia } from '@/components/shop/earn'
import { FlairPreview } from '@/components/shop/flair-preview'
import { InvestView, useStocks } from '@/components/shop/invest'
import {
  BUILTIN_ITEMS,
  cosmeticItem,
  ItemPreview,
  ItemTags,
  itemName,
  KIND_LABEL,
  RARITY,
  type ShopItem,
  useCatalog,
  useCommunity,
  useMakers,
} from '@/components/shop/items'
import { QuestsView, questsClaimable, useQuests } from '@/components/shop/quests'
import { SendCoinsDialog } from '@/components/shop/send-coins'
import { StickersView } from '@/components/shop/sticker-shop'
import { ThemeSwatch } from '@/components/shop/theme-swatch'
import { TradesView, useTrades } from '@/components/shop/trades'
import { TradeUpPanel } from '@/components/shop/tradeup'
import { del, errorMessage, get, post, put, upload } from '@/lib/api'
import { applyAppTheme } from '@/lib/app-theme'
import { displayName, relative } from '@/lib/format'
import { keys, useMembers } from '@/lib/queries'

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
  crate: 'Bought a',
  crate_gift: 'Gifted a',
  crate_coins: 'Coins from a',
  coins_sent: 'Sent coins to',
  coins_received: 'Coins from',
  trade: 'Trade',
  crate_sale: 'Someone bought your',
  bundle: 'Bought the',
  bundle_gift: 'Gifted the',
  bundle_sale: 'Someone bought your',
  achievement: 'Achievement:',
  trade_up: 'Trade-up gave you',
  auction_bid: 'Bid on',
  auction_refund: 'Outbid, coins back for',
  auction_sale: 'Auction sold:',
  invest_buy: 'Stock Market: bought',
  invest_sell: 'Stock Market: sold',
  share_buy: 'Backed',
  share_sell: 'Sold shares in',
  dividend: 'Bonus for backing',
  invest_cut: 'Stock Market cut:',
  duel_bet: 'Coinflip duel bet',
  duel_win: 'Won a coinflip duel 🎉',
  duel_refund: 'Coinflip duel refunded',
  sticker_pack: 'Bought a sticker pack',
  sticker_gift: 'Gifted a sticker pack',
  sticker_sale: 'Someone bought your sticker pack',
  quest: 'Daily quest done',
  class_war: 'Class vs Class reward',
  commission_hold: 'Art request (held)',
  commission_refund: 'Art request refunded',
  commission_pay: 'Paid for your art 🎨',
  flip_bet: 'Coinflip bet',
  flip_win: 'Won a coinflip 🎉',
  spin: 'Daily spin 🎡',
  liked: 'Someone reacted to your message ❤️',
  bounty_hold: 'Put coins on a question',
  bounty_refund: 'Question bounty refunded',
  bounty_win: 'Your answer won a bounty 🏅',
  trivia: 'Daily trivia 🧠',
  referral: 'Bring-a-friend bonus 🤝',
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

type Tab =
  | 'all'
  | 'crates'
  | 'bundles'
  | 'event'
  | 'decorations'
  | 'effects'
  | 'plates'
  | 'bubbles'
  | 'name_effect'
  | 'message_effect'
  | 'typing'
  | 'reaction_skin'
  | 'mention_style'
  | 'sound_pack'
  | 'themes'
  | 'stickers'
  | 'create'
  | 'invest'
  | 'market'
  | 'auctions'
  | 'trades'
  | 'leaderboard'
  | 'achievements'
  | 'quests'
  | 'classwar'
  | 'artists'
  | 'earn'
  | 'mine'
const TABS: Tab[] = [
  'all',
  'crates',
  'bundles',
  'event',
  'decorations',
  'effects',
  'plates',
  'bubbles',
  'name_effect',
  'message_effect',
  'typing',
  'reaction_skin',
  'mention_style',
  'sound_pack',
  'themes',
  'stickers',
  'create',
  'invest',
  'market',
  'auctions',
  'trades',
  'leaderboard',
  'achievements',
  'quests',
  'classwar',
  'artists',
  'earn',
  'mine',
]

/**
 * The Shop's sections. Each kind of cosmetic keeps its own tab; trading, auctions and your own
 * things live together.
 */
const GROUPS: { id: string; label: string; tabs: Tab[] }[] = [
  {
    id: 'shop',
    label: '🛍️ Shop',
    tabs: [
      'all',
      'event',
      'decorations',
      'effects',
      'plates',
      'themes',
      'stickers',
      'crates',
      'bundles',
    ],
  },
  {
    id: 'flair',
    label: '✨ Chat flair',
    tabs: [
      'bubbles',
      'name_effect',
      'message_effect',
      'typing',
      'reaction_skin',
      'mention_style',
      'sound_pack',
    ],
  },
  { id: 'earn', label: '💰 Earn', tabs: ['earn'] },
  { id: 'trade', label: '🎒 My stuff & trading', tabs: ['mine', 'trades', 'auctions', 'market'] },
  { id: 'invest', label: '📈 Invest', tabs: ['invest'] },
  { id: 'create', label: '🎨 Create & artists', tabs: ['create', 'artists'] },
  {
    id: 'goals',
    label: '🏆 Quests & goals',
    tabs: ['quests', 'classwar', 'achievements', 'leaderboard'],
  },
]
const groupOf = (t: Tab) => GROUPS.find((g) => g.tabs.includes(t)) ?? GROUPS[0]!

const TAB_LABEL: Record<Tab, string> = {
  all: 'All',
  crates: 'Crates',
  bundles: 'Bundles',
  event: 'Event',
  decorations: 'Decorations',
  effects: 'Effects',
  plates: 'Name plates',
  bubbles: 'Chat bubbles',
  name_effect: 'Name effects',
  message_effect: 'Message effects',
  typing: 'Typing',
  reaction_skin: 'Reactions',
  mention_style: 'Mentions',
  sound_pack: 'Sounds',
  themes: 'Themes',
  stickers: 'Stickers',
  create: 'Create',
  invest: 'Invest',
  market: 'Market',
  auctions: 'Auctions',
  trades: 'Trades',
  leaderboard: 'Leaderboard',
  achievements: 'Achievements',
  quests: 'Daily quests',
  classwar: '⚔️ Class vs Class',
  artists: '🎨 Official Artists',
  earn: 'Earn',
  mine: 'My stuff',
}

type KindFilter = 'all' | ItemKind | 'crate'
type SourceFilter = 'all' | 'builtin' | 'community' | 'event'
type SortBy = 'popular' | 'cheap' | 'pricey' | 'name'

const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'decoration', label: 'Decorations' },
  { id: 'effect', label: 'Effects' },
  { id: 'plate', label: 'Name plates' },
  { id: 'bubble', label: 'Chat bubbles' },
  { id: 'theme', label: 'Themes' },
  { id: 'crate', label: 'Crates' },
]

function daysLeft(d: Date) {
  const n = Math.ceil((d.getTime() - Date.now()) / 86_400_000)
  return n <= 1 ? 'ends today' : `${n} days left`
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
  const [sendCoins, setSendCoins] = useState<string | boolean>(params.get('coins') ?? false)
  const presetGift = params.get('gift')
  const presetTrade = params.get('trade') ?? undefined
  const presetBack = params.get('back')
  const presetPerson = members.data?.find((m) => m.id === presetGift)
  const urlTab = params.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(
    presetTrade
      ? 'trades'
      : presetBack
        ? 'invest'
        : params.get('artist')
          ? 'artists'
          : urlTab && TABS.includes(urlTab)
            ? urlTab
            : 'all',
  )
  const events = liveEvents()
  const group = groupOf(tab)
  // Coming back to a section opens the tab you were last on there.
  const [lastTab, setLastTab] = useState<Record<string, Tab>>({})
  useEffect(() => {
    setLastTab((m) => (m[groupOf(tab).id] === tab ? m : { ...m, [groupOf(tab).id]: tab }))
  }, [tab])
  const trades = useTrades()
  const incomingTrades = (trades.data ?? []).filter(
    (t) => t.status === 'pending' && t.to.id === me.id,
  ).length

  const wallet = useQuery({
    queryKey: ['wallet'],
    queryFn: ({ signal }) => get<Wallet>('/api/me/wallet', signal),
  })
  const community = useCommunity()
  const catalog = useCatalog()
  const crateDefs = useCrateDefs()
  const bundleDefs = useBundleDefs()
  const isTeacher = org.role === 'owner' || org.role === 'admin'
  const [selfCoins, setSelfCoins] = useState('')
  const w = wallet.data
  const communityList = community.data ?? []
  const ownedSet = useMemo(() => new Set(w?.owned ?? []), [w?.owned])

  // Shop prices follow the Stock Market: they go up as more people hold an item.
  const stocks = useStocks()
  const liveCatalog = useMemo(() => {
    if (!stocks.data) return catalog
    const now = new Map(stocks.data.map((q) => [q.key, q.price]))
    return new Map(
      [...catalog].map(([id, it]) => [id, now.has(id) ? { ...it, price: now.get(id)! } : it]),
    )
  }, [catalog, stocks.data])
  const allItems = [...liveCatalog.values()]
  // Seasonal items only show in their tabs while the event is on (or if you own them).
  const shown = (it: ShopItem) => it.live || ownedSet.has(it.itemId)
  const byKind = (k: ItemKind, community: boolean) =>
    allItems.filter(
      (it) =>
        it.kind === k &&
        shown(it) &&
        (community ? it.rarity === 'community' : it.rarity !== 'community'),
    )

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
      `+${COINS.daily + streakBonus((w?.streak ?? 0) + 1)} Wicky Coins! 🔥 ${(w?.streak ?? 0) + 1}-day streak.${((w?.streak ?? 0) + 1) % STREAK_CRATE.every === 0 ? ' 📦 Free crate!' : ''} See you tomorrow 🎉`,
    )
  const buy = (it: ShopItem) =>
    act(
      it.itemId,
      async () => {
        const next = await post<Wallet>(`/api/me/shop/${encodeURIComponent(it.itemId)}/buy`, {})
        if (it.stock != null) void qc.invalidateQueries({ queryKey: ['cosmetics', org.id] })
        return next
      },
      `${it.name} is yours! ✨`,
    )
  const equip = (id: string | null) =>
    act(`equip:${id}`, () => put<Wallet>('/api/me/decoration', { itemId: id }))
  const equipSlot = (slot: 'effect' | 'plate' | 'bubble' | FlairKind, id: string | null) =>
    act(`${slot}:${id}`, () => put<Wallet>('/api/me/equip', { slot, itemId: id }))
  const switchTheme = (id: string | null) => {
    setPreview(null)
    return act(`theme:${id}`, () => put<Wallet>('/api/me/theme', { itemId: id }))
  }
  const sendGift = async (it: ShopItem, to: string) => {
    const person = members.data?.find((m) => m.id === to)
    const name = person ? displayName(person) : 'them'
    const ok = await act(
      `gift:${it.itemId}`,
      async () => {
        if (it.visibility === 'private') {
          // Private: the creator gives a free copy.
          await post(`${api}/cosmetics/${it.itemId.slice(2)}/give`, { to })
          void qc.invalidateQueries({ queryKey: ['cosmetics', org.id] })
          return get<Wallet>('/api/me/wallet')
        }
        return post<Wallet>(`/api/me/shop/${encodeURIComponent(it.itemId)}/buy`, { giftTo: to })
      },
      it.visibility === 'private'
        ? `Gave ${name} a copy of ${it.name} 🎁`
        : `Sent ${it.name} to ${name} 🎁`,
    )
    if (ok) {
      setGiftItem(null)
      setGiftTo([])
      if (presetGift) router.replace('?')
    }
  }

  const equippedKey = w?.equipped?.split('|')[0] ?? null
  const shelf = useMyShelf()
  const achievements = useAchievements()
  const claimable = (achievements.data ?? []).filter((x) => x.done && !x.claimed).length
  const questsQ = useQuests()
  const questCount = questsClaimable(questsQ.data)
  const earnQ = useEarn()
  const triviaQ = useTrivia()
  const earnCount = earnWaiting(earnQ.data, triviaQ.data)

  const card = (it: ShopItem) => {
    const owned = ownedSet.has(it.itemId)
    const isTheme = it.kind === 'theme'
    const slot =
      it.kind === 'effect' ||
      it.kind === 'plate' ||
      it.kind === 'bubble' ||
      (FLAIR_KINDS as string[]).includes(it.kind)
        ? (it.kind as 'effect' | 'plate' | 'bubble' | FlairKind)
        : null
    const wearing = isTheme
      ? w?.equippedTheme === it.itemId
      : slot
        ? (slot === 'effect'
            ? w?.equippedEffect
            : slot === 'plate'
              ? w?.equippedPlate
              : slot === 'bubble'
                ? w?.equippedBubble
                : w?.equippedFlair[slot]) === it.value
        : equippedKey === it.itemId
    const takeOff = () => (isTheme ? switchTheme(null) : slot ? equipSlot(slot, null) : equip(null))
    const putOn = () =>
      isTheme ? switchTheme(it.itemId) : slot ? equipSlot(slot, it.itemId) : equip(it.itemId)
    const busyKey = isTheme ? 'theme' : (slot ?? 'equip')
    const afford = (w?.coins ?? 0) >= it.price
    const gifted = w?.giftedBy[it.itemId]
    const soldOut = it.stock != null && (it.sales ?? 0) >= it.stock
    const isPrivate = it.visibility === 'private'
    const mineToGive = isPrivate && it.creator?.id === me.id
    const canBuy = it.live && !soldOut && !isPrivate
    const canGift = mineToGive ? !soldOut : canBuy
    return (
      <li
        key={it.itemId}
        className={cn(
          'group relative flex flex-col items-center rounded-xl border p-4 text-center transition-colors',
          wearing ? 'border-accent bg-accent-subtle' : 'border-border hover:border-border-strong',
        )}
      >
        {!presetGift && (owned || canBuy) && (
          <button
            type="button"
            className={cn(
              'absolute top-2 right-2 z-10 rounded-full p-1 transition-opacity hover:bg-bg-muted',
              (owned ? shelf.pinned : shelf.wanted).has(it.itemId)
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            )}
            title={
              owned
                ? shelf.pinned.has(it.itemId)
                  ? 'Unpin from your profile'
                  : 'Pin to your profile shelf'
                : shelf.wanted.has(it.itemId)
                  ? 'Remove from wishlist'
                  : 'Add to wishlist'
            }
            aria-label={`${owned ? 'Pin' : 'Wishlist'} ${it.name}`}
            aria-pressed={(owned ? shelf.pinned : shelf.wanted).has(it.itemId)}
            onClick={() => (owned ? shelf.togglePin(it.itemId) : shelf.toggleWant(it.itemId))}
          >
            {owned ? (
              <Pin
                className={cn(
                  'size-4',
                  shelf.pinned.has(it.itemId) ? 'fill-accent text-accent' : 'text-fg-subtle',
                )}
              />
            ) : (
              <Heart
                className={cn(
                  'size-4',
                  shelf.wanted.has(it.itemId) ? 'fill-[#e0457b] text-[#e0457b]' : 'text-fg-subtle',
                )}
              />
            )}
          </button>
        )}
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
        <ItemTags it={it} serial={owned ? w?.serials[it.itemId] : undefined} />
        <p className="mt-2 min-h-[2.5em] text-xs text-fg-muted">{it.description}</p>
        {it.creator && (
          <p className="text-2xs text-fg-subtle">
            by {displayName(it.creator)}
            {!isPrivate && it.sales != null && ` · ${it.sales} sold`}
          </p>
        )}
        {gifted && <p className="text-2xs text-accent-text">🎁 from {gifted.name}</p>}
        <div className="mt-3 flex w-full gap-1.5">
          {presetGift ? (
            <Button
              size="sm"
              variant="primary"
              className="w-full tabular-nums"
              disabled={!canGift || (!mineToGive && !afford) || !w}
              loading={busy === `gift:${it.itemId}`}
              onClick={() => sendGift(it, presetGift)}
            >
              <Gift /> {mineToGive ? 'Free' : `🪙 ${it.price}`}
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
              ) : !canBuy ? (
                <Button size="sm" className="flex-1" disabled>
                  {soldOut ? 'Sold out' : !it.live ? 'Event over' : 'Private'}
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
              {canGift && (
                <Button
                  size="sm"
                  title={mineToGive ? 'Give someone a copy' : 'Gift to someone'}
                  aria-label={`Gift ${it.name}`}
                  onClick={() => setGiftItem(it)}
                >
                  <Gift />
                </Button>
              )}
            </>
          )}
        </div>
      </li>
    )
  }

  const grid = (items: ShopItem[], empty: string) =>
    !items.length ? (
      <p className="py-10 text-center text-[13px] text-fg-subtle">{empty}</p>
    ) : (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{items.map(card)}</ul>
    )

  // --- The All tab ---
  const [kind, setKind] = useState<KindFilter>('all')
  const [source, setSource] = useState<SourceFilter>('all')
  const [sort, setSort] = useState<SortBy>('popular')
  const [q, setQ] = useState('')
  const [hideOwned, setHideOwned] = useState(false)
  const needle = q.trim().toLowerCase()
  const filtered = allItems
    .filter((it) => kind === 'all' || it.kind === kind)
    .filter((it) =>
      source === 'all'
        ? true
        : source === 'community'
          ? it.rarity === 'community'
          : source === 'event'
            ? !!it.event
            : it.rarity !== 'community' && !it.event,
    )
    .filter((it) => !hideOwned || !ownedSet.has(it.itemId))
    .filter(
      (it) =>
        !needle ||
        it.name.toLowerCase().includes(needle) ||
        it.description.toLowerCase().includes(needle),
    )
    .sort((a, b) =>
      sort === 'cheap'
        ? a.price - b.price
        : sort === 'pricey'
          ? b.price - a.price
          : sort === 'name'
            ? a.name.localeCompare(b.name)
            : Number(b.live) - Number(a.live) || (b.sales ?? 0) - (a.sales ?? 0),
    )
  const crateList = [...CRATES, ...crateDefs.custom.filter((c) => !c.removed)].filter(
    (c) =>
      (kind === 'all' || kind === 'crate') &&
      (source === 'all' || (source === 'event' ? !!c.event : source === 'builtin' && !c.event)) &&
      (!needle || c.name.toLowerCase().includes(needle)) &&
      (!c.event || isEventLive(c.event) || w?.crates.some((x) => x.crateId === c.id)),
  )

  const ownedItems = allItems.filter((it) => ownedSet.has(it.itemId))

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

          {events.map((ev) => (
            <button
              key={ev.id}
              type="button"
              onClick={() => setTab('event')}
              className="q-event-banner mb-4 flex w-full items-center gap-4 overflow-hidden rounded-xl p-4 text-left text-white shadow-sm"
              style={{ background: `linear-gradient(110deg, ${ev.colors[0]}, ${ev.colors[1]})` }}
            >
              <span className="text-4xl drop-shadow">{ev.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-2xs font-bold tracking-wider uppercase opacity-90">
                  Event on now · {daysLeft(eventEndsAt(ev))}
                </span>
                <span className="block text-lg font-bold drop-shadow-sm">{ev.name}</span>
                <span className="block text-[13px] opacity-90">{ev.description}</span>
              </span>
              <span className="hidden rounded-lg bg-white/20 px-3 py-1.5 text-[13px] font-semibold backdrop-blur sm:block">
                See the items →
              </span>
            </button>
          ))}

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
              <div className="min-w-0 flex-1">
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
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button size="sm" onClick={() => setSendCoins(true)}>
                    <Coins /> Send coins
                  </Button>
                  <Button size="sm" onClick={() => setTab('trades')}>
                    <ArrowLeftRight /> Trade
                  </Button>
                  {isTeacher && (
                    <form
                      className="flex gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault()
                        const amount = Number.parseInt(selfCoins, 10)
                        if (!amount || amount < 1) return
                        void act(
                          'self-coins',
                          async () => {
                            await post(`${api}/members/${me.id}/coins`, {
                              amount,
                              note: 'Teacher top-up',
                            })
                            return get<Wallet>('/api/me/wallet')
                          },
                          `Added 🪙 ${amount} to your wallet`,
                        ).then((ok) => ok && setSelfCoins(''))
                      }}
                    >
                      <Input
                        type="number"
                        min={1}
                        max={10000}
                        placeholder="Coins"
                        aria-label="Coins to add to your own wallet"
                        value={selfCoins}
                        onChange={(e) => setSelfCoins(e.target.value)}
                        className="h-8 w-24"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!selfCoins}
                        loading={busy === 'self-coins'}
                      >
                        🍎 Add coins
                      </Button>
                    </form>
                  )}
                  {!!w?.crates.length && (
                    <Button size="sm" onClick={() => setTab('crates')}>
                      📦 {w.crates.length} crate{w.crates.length === 1 ? '' : 's'} to open
                    </Button>
                  )}
                </div>
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
              {w && (
                <p className="text-xs text-fg-muted">
                  📦 Free crate in{' '}
                  {STREAK_CRATE.every -
                    ((w.streak + (w.dailyAvailable ? 1 : 0)) % STREAK_CRATE.every ||
                      STREAK_CRATE.every) || STREAK_CRATE.every}{' '}
                  {w.dailyAvailable ? 'claims' : 'days'}
                </p>
              )}
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

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            {/* Sections first, then the tabs inside the one you're in. */}
            <nav className="mb-2 flex flex-wrap gap-1.5" aria-label="Shop sections">
              {GROUPS.map((g) => {
                const count =
                  g.id === 'trade'
                    ? incomingTrades
                    : g.id === 'goals'
                      ? claimable + questCount
                      : g.id === 'earn'
                        ? earnCount
                        : 0
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={group.id === g.id}
                    onClick={() => setTab(lastTab[g.id] ?? g.tabs[0]!)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
                      group.id === g.id
                        ? 'border-accent bg-accent text-accent-fg'
                        : 'border-border text-fg-muted hover:bg-bg-muted hover:text-fg',
                    )}
                  >
                    {g.label}
                    {count > 0 && (
                      <span
                        className={cn(
                          'rounded-full px-1.5 text-2xs',
                          group.id === g.id ? 'bg-accent-fg/20' : 'bg-danger text-white',
                        )}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </nav>
            {group.tabs.length > 1 && (
              <TabsList className="flex-wrap gap-x-4 gap-y-0">
                {group.tabs
                  .filter((t) => t !== 'event' || events.length > 0)
                  .map((t) => (
                    <TabsTrigger key={t} value={t}>
                      {t === 'event' && events[0]
                        ? `${events[0].emoji} ${events.length > 1 ? 'Events' : events[0].name}`
                        : TAB_LABEL[t]}
                      {t === 'crates' && !!w?.crates.length && (
                        <span className="rounded-full bg-accent px-1.5 text-2xs text-accent-fg">
                          {w.crates.length}
                        </span>
                      )}
                      {t === 'trades' && !!incomingTrades && (
                        <span className="rounded-full bg-danger px-1.5 text-2xs text-white">
                          {incomingTrades}
                        </span>
                      )}
                      {t === 'quests' && questCount > 0 && (
                        <span className="rounded-full bg-accent px-1.5 text-2xs text-accent-fg">
                          {questCount}
                        </span>
                      )}
                      {t === 'achievements' && claimable > 0 && (
                        <span className="rounded-full bg-accent px-1.5 text-2xs text-accent-fg">
                          {claimable}
                        </span>
                      )}
                    </TabsTrigger>
                  ))}
              </TabsList>
            )}

            <TabsContent value="all" className="pt-4">
              <div className="mb-4 flex flex-col gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {KIND_FILTERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={kind === f.id}
                      onClick={() => setKind(f.id)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-[13px]',
                        kind === f.id
                          ? 'border-accent bg-accent text-accent-fg'
                          : 'border-border text-fg-muted hover:bg-bg-muted',
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    placeholder="Search everything…"
                    aria-label="Search the Shop"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    className="w-56"
                  />
                  <Select
                    className="w-auto"
                    aria-label="Made by"
                    value={source}
                    onChange={(e) => setSource(e.target.value as SourceFilter)}
                  >
                    <option value="all">Made by anyone</option>
                    <option value="builtin">WickyChat</option>
                    <option value="community">Students</option>
                    <option value="event">Seasonal</option>
                  </Select>
                  <Select
                    className="w-auto"
                    aria-label="Sort"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortBy)}
                  >
                    <option value="popular">Popular</option>
                    <option value="cheap">Cheapest</option>
                    <option value="pricey">Priciest</option>
                    <option value="name">A–Z</option>
                  </Select>
                  <label className="flex items-center gap-1.5 text-[13px] text-fg-muted">
                    <input
                      type="checkbox"
                      checked={hideOwned}
                      onChange={(e) => setHideOwned(e.target.checked)}
                    />
                    Hide what I own
                  </label>
                  <span className="ml-auto text-xs text-fg-subtle">
                    {(kind === 'crate' ? 0 : filtered.length) + crateList.length} things
                  </span>
                </div>
              </div>
              {!!crateList.length && (
                <ul className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {crateList.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setTab('crates')}
                        className="flex w-full flex-col items-center gap-2 rounded-xl border border-border p-4 text-center hover:border-border-strong"
                      >
                        <CrateArt crate={c} />
                        <span className="text-[14px] font-semibold">{c.name}</span>
                        <span className="rounded-full bg-bg-muted px-2 py-0.5 text-2xs font-semibold text-fg-muted">
                          Crate · 🪙 {c.price}
                        </span>
                        <span className="text-xs text-fg-muted">{c.description}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {kind !== 'crate' && grid(filtered, 'Nothing matches that.')}
            </TabsContent>

            <TabsContent value="crates" className="pt-4">
              <CratesView wallet={w} catalog={catalog} />
            </TabsContent>

            <TabsContent value="bundles" className="pt-4">
              <BundlesView wallet={w} catalog={catalog} />
            </TabsContent>

            <TabsContent value="event" className="pt-4">
              {events.map((ev) => (
                <section key={ev.id} className="mb-10">
                  <h3 className="mb-1 text-[16px] font-bold">
                    {ev.emoji} {ev.name}
                  </h3>
                  <p className="mb-4 text-[13px] text-fg-muted">
                    {ev.description} Only in the Shop until{' '}
                    {new Date(eventEndsAt(ev).getTime() - 1).toLocaleDateString(undefined, {
                      month: 'long',
                      day: 'numeric',
                    })}
                    . After that, the only way to get them is trading or the Market.
                  </p>
                  {grid(
                    allItems.filter((it) => it.event === ev.id),
                    '',
                  )}
                  <div className="mt-6">
                    <CratesView wallet={w} catalog={catalog} onlyEvent={ev.id} />
                  </div>
                  <div className="mt-6">
                    <BundlesView wallet={w} catalog={catalog} onlyEvent={ev.id} />
                  </div>
                </section>
              ))}
              <section>
                <h3 className="mb-3 text-[14px] font-semibold">Coming up</h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {upcomingEvents()
                    .slice(0, 4)
                    .map((ev) => (
                      <li
                        key={ev.id}
                        className="flex items-center gap-3 rounded-lg border border-border p-3 text-[13px]"
                      >
                        <span className="text-2xl">{ev.emoji}</span>
                        <span className="flex-1">
                          <strong>{ev.name}</strong>
                          <span className="block text-xs text-fg-muted">
                            Starts{' '}
                            {eventStartsAt(ev).toLocaleDateString(undefined, {
                              month: 'long',
                              day: 'numeric',
                            })}
                          </span>
                        </span>
                      </li>
                    ))}
                </ul>
              </section>
            </TabsContent>

            <TabsContent value="decorations" className="pt-4">
              {grid(byKind('decoration', false), '')}
              <h3 className="mt-8 mb-3 text-[14px] font-semibold">Made by students</h3>
              {community.isLoading ? (
                <Skeleton className="h-60" />
              ) : (
                grid(
                  byKind('decoration', true),
                  'No student-made decorations yet. Make the first one in the Create tab!',
                )
              )}
            </TabsContent>
            <TabsContent value="effects" className="pt-4">
              <p className="mb-3 text-[13px] text-fg-muted">
                Animated effects that play over your profile card.
              </p>
              {grid(byKind('effect', false), '')}
              <h3 className="mt-8 mb-3 text-[14px] font-semibold">Made by students</h3>
              {grid(
                byKind('effect', true),
                'No student-made effects yet. Make one in the Create tab!',
              )}
            </TabsContent>
            <TabsContent value="plates" className="pt-4">
              <p className="mb-3 text-[13px] text-fg-muted">
                An animated background behind your name in DMs and member lists.
              </p>
              {grid(byKind('plate', false), '')}
              <h3 className="mt-8 mb-3 text-[14px] font-semibold">Made by students</h3>
              {grid(
                byKind('plate', true),
                'No student-made name plates yet. Make one in the Create tab!',
              )}
            </TabsContent>
            <TabsContent value="bubbles" className="pt-4">
              <p className="mb-3 text-[13px] text-fg-muted">
                A style behind every message you send, so everyone in the chat can see it. Theres
                also a Bubble Crate if your feeling lucky.
              </p>
              {grid(byKind('bubble', false), '')}
              <h3 className="mt-8 mb-3 text-[14px] font-semibold">Made by students</h3>
              {grid(
                byKind('bubble', true),
                'No student-made bubbles yet. Make one in the Create tab!',
              )}
            </TabsContent>
            <TabsContent value="name_effect" className="pt-4">
              <p className="mb-3 text-[13px] text-fg-muted">
                Animated colours for your name, everywhere it shows up in chat.
              </p>
              {grid(byKind('name_effect', false), '')}
              <h3 className="mt-8 mb-3 text-[14px] font-semibold">Made by students</h3>
              {grid(
                byKind('name_effect', true),
                'Nobody has made one yet. Be the first in the Create tab!',
              )}
            </TabsContent>
            <TabsContent value="message_effect" className="pt-4">
              <p className="mb-3 text-[13px] text-fg-muted">
                A quick animation that plays once when each of your messages shows up for everyone.
              </p>
              {grid(byKind('message_effect', false), '')}
              <h3 className="mt-8 mb-3 text-[14px] font-semibold">Made by students</h3>
              {grid(
                byKind('message_effect', true),
                'Nobody has made one yet. Be the first in the Create tab!',
              )}
            </TabsContent>
            <TabsContent value="typing" className="pt-4">
              <p className="mb-3 text-[13px] text-fg-muted">
                What people see while your typing, instead of the three gray dots.
              </p>
              {grid(byKind('typing', false), '')}
              <h3 className="mt-8 mb-3 text-[14px] font-semibold">Made by students</h3>
              {grid(
                byKind('typing', true),
                'Nobody has made one yet. Be the first in the Create tab!',
              )}
            </TabsContent>
            <TabsContent value="reaction_skin" className="pt-4">
              <p className="mb-3 text-[13px] text-fg-muted">
                Changes how the reactions look on your messages, so everyone who reacts sees it.
              </p>
              {grid(byKind('reaction_skin', false), '')}
              <h3 className="mt-8 mb-3 text-[14px] font-semibold">Made by students</h3>
              {grid(
                byKind('reaction_skin', true),
                'Nobody has made one yet. Be the first in the Create tab!',
              )}
            </TabsContent>
            <TabsContent value="mention_style" className="pt-4">
              <p className="mb-3 text-[13px] text-fg-muted">
                How your @mentions look in the messages you send.
              </p>
              {grid(byKind('mention_style', false), '')}
              <h3 className="mt-8 mb-3 text-[14px] font-semibold">Made by students</h3>
              {grid(
                byKind('mention_style', true),
                'Nobody has made one yet. Be the first in the Create tab!',
              )}
            </TabsContent>
            <TabsContent value="sound_pack" className="pt-4">
              <p className="mb-3 text-[13px] text-fg-muted">
                Sounds for when you get a ping and when you send a message. Only you can here them.
              </p>
              {grid(byKind('sound_pack', false), '')}
              <h3 className="mt-8 mb-3 text-[14px] font-semibold">Made by students</h3>
              {grid(
                byKind('sound_pack', true),
                'Nobody has made one yet. Be the first in the Create tab!',
              )}
            </TabsContent>
            <TabsContent value="themes" className="pt-4">
              <p className="mb-3 text-[13px] text-fg-muted">
                Themes change the colours of the whole app, just for you. Press 👁 to try one on
                first.
              </p>
              {grid(byKind('theme', false), '')}
              <h3 className="mt-8 mb-3 text-[14px] font-semibold">Made by students</h3>
              {grid(
                byKind('theme', true),
                'No student-made themes yet. Write one in CSS in the Create tab!',
              )}
            </TabsContent>
            <TabsContent value="market" className="pt-4">
              <MarketView
                catalog={liveCatalog}
                owned={w?.owned ?? []}
                coins={w?.coins ?? 0}
                onChange={() => refresh()}
              />
            </TabsContent>
            <TabsContent value="stickers" className="pt-4">
              <StickersView wallet={w} />
            </TabsContent>
            <TabsContent value="invest" className="pt-4">
              <InvestView wallet={w} person={params.get('back') ?? undefined} />
            </TabsContent>
            <TabsContent value="auctions" className="pt-4">
              <AuctionsView wallet={w} />
            </TabsContent>
            <TabsContent value="trades" className="pt-4">
              <TradesView wallet={w} catalog={catalog} presetTo={presetTrade} />
            </TabsContent>
            <TabsContent value="quests" className="pt-4">
              <QuestsView />
            </TabsContent>
            <TabsContent value="earn" className="pt-4">
              <EarnView onGo={(t) => setTab(t as Tab)} />
            </TabsContent>
            <TabsContent value="artists" className="pt-4">
              <ArtistsView wallet={w} preset={params.get('artist') ?? undefined} />
            </TabsContent>
            <TabsContent value="classwar" className="pt-4">
              <ClassWarView />
            </TabsContent>
            <TabsContent value="achievements" className="pt-4">
              <AchievementsView />
            </TabsContent>
            <TabsContent value="leaderboard" className="pt-4">
              <LeaderboardView />
            </TabsContent>
            <TabsContent value="create" className="pt-4">
              <CreatePicker catalog={catalog} />
            </TabsContent>
            <TabsContent value="mine" className="pt-4">
              <h3 className="mb-3 text-[14px] font-semibold">Your collection</h3>
              {grid(ownedItems, "You don't own anything yet.")}
              <TradeUpPanel wallet={w} />
              <MyCreations />
              <MyCrates />
              <MyBundles />
              {!!w?.history.length && (
                <section className="mt-10">
                  <h3 className="mb-3 text-[14px] font-semibold">Recent coins</h3>
                  <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
                    {w.history.map((h) => (
                      <li key={h.id} className="flex items-center gap-3 px-3 py-2">
                        <span className="flex-1">
                          {REASON[h.reason] ?? h.reason}
                          {(h.reason === 'purchase' ||
                            h.reason === 'market_buy' ||
                            h.reason === 'market_sale' ||
                            h.reason === 'sale' ||
                            h.reason === 'gift_item') &&
                            h.ref &&
                            ` ${itemName(h.ref, communityList)}`}
                          {(h.reason === 'crate' ||
                            h.reason === 'crate_sale' ||
                            h.reason === 'crate_gift' ||
                            h.reason === 'crate_coins') &&
                            h.ref &&
                            ` ${crateDefs.byId(h.ref)?.name ?? 'crate'}`}
                          {(h.reason === 'bundle' ||
                            h.reason === 'bundle_gift' ||
                            h.reason === 'bundle_sale') &&
                            h.ref &&
                            ` ${bundleDefs.byId(h.ref)?.name ?? 'bundle'}`}
                          {(h.reason === 'share_buy' ||
                            h.reason === 'share_sell' ||
                            h.reason === 'dividend') &&
                            h.ref &&
                            (() => {
                              const m = members.data?.find((x) => x.id === h.ref)
                              return ` ${m ? displayName(m) : 'someone'}`
                            })()}
                          {(h.reason === 'coins_sent' || h.reason === 'coins_received') &&
                            h.ref &&
                            (() => {
                              const [who, note] = h.ref.split('|')
                              const m = members.data?.find((x) => x.id === who)
                              return ` ${m ? displayName(m) : 'someone'}${note ? ` · “${note}”` : ''}`
                            })()}
                          {h.reason === 'gift' && h.ref && ` · “${h.ref}”`}
                          {(h.reason === 'trade_up' ||
                            h.reason === 'auction_bid' ||
                            h.reason === 'auction_refund' ||
                            h.reason === 'auction_sale' ||
                            h.reason === 'invest_buy' ||
                            h.reason === 'invest_sell') &&
                            h.ref &&
                            ` ${itemName(h.ref, communityList)}`}
                          {h.reason === 'achievement' &&
                            h.ref &&
                            ` ${ACHIEVEMENTS.find((x) => x.id === h.ref)?.name ?? ''}`}
                        </span>
                        <span className="text-xs text-fg-subtle">{relative(h.createdAt)}</span>
                        <span
                          className={cn(
                            'w-14 text-right font-semibold tabular-nums',
                            h.amount > 0
                              ? 'text-success'
                              : h.amount < 0
                                ? 'text-danger'
                                : 'text-fg-subtle',
                          )}
                        >
                          {h.amount > 0 ? '+' : ''}
                          {h.amount || '—'}
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
            checked by a teacher before they're sold. Crate odds are shown on every crate.
          </p>
        </div>
      </div>

      <Dialog open={!!giftItem} onOpenChange={(o) => !o && setGiftItem(null)}>
        <DialogContent
          title={`Gift ${giftItem?.name ?? ''}`}
          description={
            giftItem?.visibility === 'private'
              ? "It's private: they can use it, but can't sell, trade or pass it on. Free for you."
              : `Pick who gets it. You pay 🪙 ${giftItem?.price ?? 0}.`
          }
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
              disabled={
                !giftTo.length ||
                (giftItem?.visibility !== 'private' && (w?.coins ?? 0) < (giftItem?.price ?? 0))
              }
              loading={busy === `gift:${giftItem?.itemId}`}
              onClick={() => giftItem && giftTo[0] && sendGift(giftItem, giftTo[0])}
            >
              <Gift /> Send gift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {sendCoins && (
        <SendCoinsDialog
          presetTo={typeof sendCoins === 'string' ? sendCoins : undefined}
          onClose={() => setSendCoins(false)}
        />
      )}
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
  const sellable = owned.filter(
    (id) => !listed.has(id) && catalog.has(id) && catalog.get(id)?.visibility !== 'private',
  )

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

/** Profile effects and name plates students make: one image each. */
function CreateImageItem({ kind }: { kind: 'effect' | 'plate' }) {
  const { org, api, me } = useOrgContext()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState(120)
  const avail = useAvailability()
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])

  const submit = async () => {
    if (!file) return
    setSaving(true)
    try {
      const f = await upload<Attachment>(`${api}/files?purpose=cosmetic`, file).promise
      await post(`${api}/cosmetics`, {
        kind,
        name,
        description,
        price,
        frameFileId: f.id,
        ...avail.body,
      })
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
        <AvailabilityFields a={avail} />
        {avail.visibility === 'public' && (
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
        )}
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

function useAvailability() {
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [limited, setLimited] = useState(false)
  const [stock, setStock] = useState(25)
  const [dynamic, setDynamic] = useState(false)
  return {
    visibility,
    setVisibility,
    limited,
    setLimited,
    stock,
    setStock,
    dynamic,
    setDynamic,
    body: {
      visibility,
      stock: limited ? stock : null,
      dynamic: dynamic && !limited && visibility === 'public',
    },
  }
}

/** Who can use it (sold to everyone, or private) and whether it's a limited edition. */
function AvailabilityFields({ a }: { a: ReturnType<typeof useAvailability> }) {
  const opt = (v: 'public' | 'private', title: string, hint: string) => (
    <button
      type="button"
      aria-pressed={a.visibility === v}
      onClick={() => a.setVisibility(v)}
      className={cn(
        'flex-1 rounded-lg border p-3 text-left',
        a.visibility === v ? 'border-accent bg-accent-subtle' : 'border-border hover:bg-bg-muted',
      )}
    >
      <p className="text-[13px] font-semibold">{title}</p>
      <p className="text-xs text-fg-muted">{hint}</p>
    </button>
  )
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-medium">Who can use it</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {opt('public', '🛒 Everyone', 'Sold in the Shop. You earn coins from every sale.')}
        {opt(
          'private',
          '🔒 Just me + who I pick',
          "Not sold. You give free copies to friends; they can't sell or trade them.",
        )}
      </div>
      <label className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={a.limited}
          onChange={(e) => a.setLimited(e.target.checked)}
        />
        💎 Limited edition: only
        <Input
          type="number"
          aria-label="Number of copies"
          min={COSMETIC_STOCK.min}
          max={COSMETIC_STOCK.max}
          value={a.stock}
          disabled={!a.limited}
          onChange={(e) =>
            a.setStock(
              Math.max(
                COSMETIC_STOCK.min,
                Math.min(COSMETIC_STOCK.max, Number(e.target.value) || 1),
              ),
            )
          }
          className="w-20"
        />
        {a.visibility === 'private' ? 'copies can ever be given' : 'copies can ever be sold'}
      </label>
      {a.limited && (
        <p className="text-2xs text-fg-subtle">
          Each copy gets a number (#1, #2…). Once they're gone, they're gone, so people can only get
          one by trading.
        </p>
      )}
      {a.visibility === 'public' && !a.limited && (
        <label className="mt-1 flex flex-col gap-0.5 text-[13px]">
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={a.dynamic}
              onChange={(e) => a.setDynamic(e.target.checked)}
            />
            📈 Put it on the Stock Market
          </span>
          <span className="pl-6 text-2xs text-fg-subtle">
            The price goes up as more people buy it and down when they sell. You still get{' '}
            {Math.round(CREATOR_SHARE * 100)}% of your price on every buy; anything above your price
            is what investors can earn.
          </span>
        </label>
      )}
    </div>
  )
}

function CreateFlairItem({ kind }: { kind: SpecKind }) {
  const avail = useAvailability()
  return (
    <CreateFlair
      kind={kind}
      availability={<AvailabilityFields a={avail} />}
      availabilityBody={avail.body}
      isPublic={avail.visibility === 'public'}
    />
  )
}

function CreatePicker({ catalog }: { catalog: Map<string, ShopItem> }) {
  const [kind, setKind] = useState<ItemKind | 'crate' | 'bundle'>('decoration')
  return (
    <>
      <div className="mb-5 inline-flex flex-wrap rounded-lg border border-border p-0.5 text-[13px]">
        {(
          [
            'decoration',
            'effect',
            'plate',
            'theme',
            'bubble',
            'name_effect',
            'message_effect',
            'typing',
            'reaction_skin',
            'mention_style',
            'sound_pack',
            'crate',
            'bundle',
          ] as const
        ).map((k) => (
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
            {k === 'crate' ? '📦 Crate' : k === 'bundle' ? '🎁 Bundle' : KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {isSpecKind(kind) ? (
        <CreateFlairItem key={kind} kind={kind} />
      ) : kind === 'decoration' ? (
        <CreateCosmetic />
      ) : kind === 'theme' ? (
        <CreateTheme />
      ) : kind === 'crate' ? (
        <CreateCrate catalog={catalog} />
      ) : kind === 'bundle' ? (
        <CreateBundle />
      ) : kind === 'effect' || kind === 'plate' ? (
        <CreateImageItem key={kind} kind={kind} />
      ) : null}
    </>
  )
}

function CreateTheme() {
  const { org, api, me } = useOrgContext()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState(150)
  const avail = useAvailability()
  const [css, setCss] = useState(THEME_TEMPLATE)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const clean = useMemo(() => sanitizeThemeCss(css), [css])
  const myThemeKey = JSON.stringify(me.appTheme)

  // Live preview while it's on; your own theme comes back when you stop or leave.
  useEffect(() => {
    if (!previewing) return
    applyAppTheme(
      { css: clean.css, dark: /color-scheme\s*:\s*dark/i.test(clean.css) ? true : null },
      { cache: false },
    )
  }, [previewing, clean.css])
  useEffect(() => {
    if (!previewing) return
    return () => applyAppTheme(JSON.parse(myThemeKey))
  }, [previewing, myThemeKey])

  const submit = async () => {
    setSaving(true)
    try {
      await post(`${api}/cosmetics`, {
        kind: 'theme',
        name,
        description,
        price,
        css,
        ...avail.body,
      })
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
        <AvailabilityFields a={avail} />
        {avail.visibility === 'public' && (
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
        )}
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
  const avail = useAvailability()
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
        ...avail.body,
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
        <AvailabilityFields a={avail} />
        {avail.visibility === 'public' && (
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
        )}
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
  const [giving, setGiving] = useState<Cosmetic | null>(null)
  const [to, setTo] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const { me } = useOrgContext()
  const give = async () => {
    if (!giving || !to[0]) return
    setBusy(true)
    try {
      await post(`${api}/cosmetics/${giving.id}/give`, { to: to[0] })
      toast.success(`Gave a copy of ${giving.name} 🎁`)
      void qc.invalidateQueries({ queryKey: ['cosmetics', org.id] })
      setGiving(null)
      setTo([])
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const makers = useMakers()
  const mine = useQuery({
    queryKey: ['cosmetics', org.id, 'mine'],
    queryFn: ({ signal }) => get<Cosmetic[]>(`${api}/cosmetics?view=mine`, signal),
  })
  const builtinMine = BUILTIN_ITEMS.filter((it) => makers.data?.[it.itemId]?.id === me.id)
  if (!mine.data?.length && !builtinMine.length) return null
  const status = {
    pending: { label: '⏳ Waiting for review', className: 'text-fg-muted' },
    approved: { label: '✅ On sale', className: 'text-success' },
    rejected: { label: '❌ Not approved', className: 'text-danger' },
  }
  return (
    <section className="mt-10">
      <h3 className="mb-3 text-[14px] font-semibold">Your creations</h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {builtinMine.map((it) => (
          <li key={it.itemId} className="flex items-center gap-4 p-3">
            <div className="w-20 shrink-0">
              <ItemPreview it={it} compact />
            </div>
            <div className="min-w-0 flex-1 text-[13px]">
              <p className="font-medium">
                {it.name} <span className="text-fg-subtle">· 🪙 {it.price}</span>
              </p>
              <p className="text-success">✅ Sold in the Shop as an official item</p>
            </div>
          </li>
        ))}
        {(mine.data ?? []).map((c) => (
          <li key={c.id} className="flex items-center gap-4 p-3">
            {isSpecKind(c.kind) ? (
              <span className="flex h-14 w-28 items-center justify-center overflow-hidden rounded-md bg-bg-muted">
                <FlairPreview kind={c.kind} value={c.value} compact />
              </span>
            ) : c.kind === 'theme' ? (
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
                {c.status === 'approved' && c.visibility === 'private'
                  ? `🔒 Private · ${c.sales} given`
                  : status[c.status].label}
                {c.status === 'approved' && c.visibility === 'public' && ` · ${c.sales} sold`}
                {c.stock != null && ` · limited to ${c.stock}`}
              </p>
              {c.reviewNote && <p className="text-xs text-fg-muted">Teacher: “{c.reviewNote}”</p>}
            </div>
            {c.status === 'approved' && c.visibility === 'private' && (
              <Button
                size="sm"
                disabled={c.stock != null && c.sales >= c.stock}
                onClick={() => setGiving(c)}
              >
                <Gift /> Give a copy
              </Button>
            )}
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
      <Dialog open={!!giving} onOpenChange={(o) => !o && setGiving(null)}>
        <DialogContent
          title={`Give a copy of ${giving?.name ?? ''}`}
          description="Free. They can use it, but can't sell, trade or pass it on."
        >
          <PeoplePicker
            value={to}
            onChange={(ids) => setTo(ids.slice(-1))}
            exclude={[me.id]}
            autoFocus
          />
          <DialogFooter>
            <Button onClick={() => setGiving(null)}>Cancel</Button>
            <Button variant="primary" disabled={!to.length} loading={busy} onClick={give}>
              <Gift /> Give
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

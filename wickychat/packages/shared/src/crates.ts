/**
 * WickyChat crates (mystery boxes). You buy one and it sits in your inventory until you open it,
 * like a case in a game: open it whenever you like, gift it or trade it. Opening rolls one drop.
 * The server rolls; the web app only plays the spinning reel that lands on what you got.
 */
import { decorationById, effectById, plateById, themeById } from './wicky'

export type CrateTier = 'common' | 'rare' | 'epic' | 'legendary'

/** One possible drop: an item, a pile of coins, or spin tickets (extra daily spins). */
export type CrateDrop = { tier: CrateTier } & (
  | { item: string }
  | { coins: number }
  | { tickets: number }
)

export interface CrateDef {
  id: string
  name: string
  emoji: string
  description: string
  price: number
  /** Seasonal crates are only sold while their event is on. Unopened ones keep forever. */
  event?: string
  colors: [string, string]
  drops: CrateDrop[]
  /** Student-made crates: who made it. */
  creator?: { id: string; name: string; displayName: string | null }
  /** Student-made crates taken off sale (unopened ones still open). */
  removed?: boolean
}

/** Chance of each tier (per cent). Each tier's chance is shared by the drops in it. */
export const TIER_ODDS: Record<CrateTier, number> = {
  common: 70,
  rare: 22,
  epic: 6.5,
  legendary: 1.5,
}

export const TIER_STYLE: Record<CrateTier, { label: string; color: string }> = {
  common: { label: 'Common', color: '#4b8bd6' },
  rare: { label: 'Rare', color: '#8052ff' },
  epic: { label: 'Epic', color: '#e0399a' },
  legendary: { label: 'Legendary', color: '#f0b400' },
}

const i = (tier: CrateTier, item: string): CrateDrop => ({ tier, item })
const c = (tier: CrateTier, coins: number): CrateDrop => ({ tier, coins })
const tk = (tier: CrateTier, tickets: number): CrateDrop => ({ tier, tickets })

export const CRATES: CrateDef[] = [
  {
    id: 'c-wicky',
    name: 'Wicky Crate',
    emoji: '📦',
    description:
      'Decorations, effects, name plates, coins or 🎟️ spin tickets. Small chance of a crown!',
    price: 120,
    colors: ['#8052ff', '#15846e'],
    drops: [
      c('common', 40),
      c('common', 70),
      tk('common', 1),
      i('common', 'p-mint'),
      i('common', 'p-sunset'),
      i('common', 'p-ocean'),
      i('common', 'party'),
      i('common', 'clover'),
      i('common', 'e-bubbles'),
      c('rare', 150),
      tk('rare', 3),
      i('rare', 'e-snow'),
      i('rare', 'e-sparkle'),
      i('rare', 'p-matrix'),
      i('rare', 'rocket'),
      i('rare', 'rainbow'),
      c('epic', 400),
      i('epic', 'e-stars'),
      i('epic', 'e-confetti'),
      i('epic', 'p-galaxy'),
      i('epic', 'unicorn'),
      i('epic', 'fire'),
      c('legendary', 1500),
      i('legendary', 'crown'),
      i('legendary', 'kite'),
    ],
  },
  {
    id: 'c-theme',
    name: 'Theme Crate',
    emoji: '🎨',
    description: 'A whole new look for the app, or coins.',
    price: 180,
    colors: ['#cba6f7', '#89b4fa'],
    drops: [
      c('common', 60),
      c('common', 100),
      tk('common', 1),
      i('common', 't-solarized'),
      i('common', 't-latte'),
      i('rare', 't-nord'),
      i('rare', 't-gruvbox'),
      i('rare', 't-frappe'),
      i('epic', 't-mocha'),
      i('epic', 't-dracula'),
      i('epic', 't-tokyo'),
      i('epic', 't-rosepine'),
      c('legendary', 1200),
      i('legendary', 't-macchiato'),
    ],
  },
  ...seasonCrate('halloween', '🎃', 'Spooky Crate', '#ff7a00', '#6d28d9', [
    i('common', 'pumpkin'),
    i('common', 'ghost'),
    i('rare', 'p-pumpkin'),
    i('epic', 'e-bats'),
    i('legendary', 't-spooky'),
  ]),
  ...seasonCrate('harvest', '🍁', 'Harvest Crate', '#c2410c', '#eab308', [
    i('common', 'clover'),
    i('rare', 'p-harvest'),
    i('epic', 'e-leaves'),
    i('legendary', 't-maple'),
  ]),
  ...seasonCrate('winter', '🎁', 'Winter Crate', '#38bdf8', '#e0f2fe', [
    i('common', 'snow'),
    i('rare', 'p-frost'),
    i('epic', 'e-winter'),
    i('legendary', 't-frost'),
  ]),
  ...seasonCrate('lunar', '🧧', 'Lucky Crate', '#d7263d', '#f6c344', [
    i('rare', 'p-lunar'),
    i('epic', 'e-lanterns'),
    c('legendary', 888),
  ]),
  ...seasonCrate('valentine', '💝', 'Sweetheart Crate', '#ff4d8d', '#ffb3c6', [
    i('common', 'hearts'),
    i('rare', 'p-rose'),
    i('epic', 'e-cupid'),
  ]),
  ...seasonCrate('spring', '🌷', 'Bloom Crate', '#f9a8d4', '#86efac', [
    i('common', 'sakura'),
    i('common', 'butterfly'),
    i('rare', 'p-bloom'),
    i('epic', 'e-spring'),
  ]),
  ...seasonCrate('finals', '📚', 'Study Crate', '#1e3a8a', '#fbbf24', [
    i('rare', 'p-study'),
    i('epic', 'e-finals'),
  ]),
  ...seasonCrate('summer', '🏖️', 'Beach Crate', '#06b6d4', '#facc15', [
    i('common', 'wave'),
    i('rare', 'p-tropical'),
    i('epic', 'e-beach'),
  ]),
]

/** Seasonal crates: the event's items plus coins in every tier. */
function seasonCrate(
  event: string,
  emoji: string,
  name: string,
  a: string,
  b: string,
  items: CrateDrop[],
): CrateDef[] {
  return [
    {
      id: `c-${event}`,
      name,
      emoji,
      description: 'Only sold during the event. Unopened crates keep forever.',
      price: 150,
      event,
      colors: [a, b],
      drops: [
        c('common', 50),
        c('common', 90),
        tk('common', 1),
        c('rare', 200),
        tk('rare', 2),
        c('epic', 500),
        c('legendary', 2000),
        ...items,
      ],
    },
  ]
}

export const CRATE_IDS = CRATES.map((x) => x.id)
export const crateById = (id: string | null | undefined) => CRATES.find((x) => x.id === id)

/** Every 7th day of a streak gives a free crate. */
export const STREAK_CRATE = { every: 7, crateId: 'c-wicky' } as const

export const dropKey = (d: CrateDrop) =>
  'item' in d ? d.item : 'coins' in d ? `coins:${d.coins}` : `tickets:${d.tickets}`

/** Name of a built-in item, for crate contents. */
export function builtinName(id: string) {
  return (
    decorationById(id)?.name ?? effectById(id)?.name ?? plateById(id)?.name ?? themeById(id)?.name
  )
}

/**
 * What you can still get from a crate: items you already own are left out (no duplicates).
 * Returns each drop with its chance in per cent.
 */
export function crateOdds(crate: CrateDef, owned: Set<string> = new Set()) {
  const left = crate.drops.filter((d) => !('item' in d) || !owned.has(d.item))
  const tiers = (Object.keys(TIER_ODDS) as CrateTier[]).filter((t) =>
    left.some((d) => d.tier === t),
  )
  const total = tiers.reduce((n, t) => n + TIER_ODDS[t], 0)
  return left.map((d) => ({
    drop: d,
    chance: (TIER_ODDS[d.tier] / total / left.filter((x) => x.tier === d.tier).length) * 100,
  }))
}

/** Picks a drop. `rand` is a number in [0, 1). */
export function rollCrate(crate: CrateDef, owned: Set<string>, rand: number): CrateDrop {
  const odds = crateOdds(crate, owned)
  let r = rand * 100
  for (const o of odds) {
    r -= o.chance
    if (r < 0) return o.drop
  }
  return odds[odds.length - 1]!.drop
}

/** What a crate gave you, as stored and sent to the app. */
export type CrateResult = CrateDrop

// --- Trading ---------------------------------------------------------------------------

export interface TradeSide {
  /** Item ids (built-in or `u:<id>`). */
  items: string[]
  /** Unopened crate ids (the crate in your inventory, not the kind). */
  crates: string[]
  coins: number
}

export const TRADE_LIMITS = { items: 10, crates: 10, coins: 5000, pending: 10 } as const

export interface Trade {
  id: string
  from: import('./types').UserSummary
  to: import('./types').UserSummary
  /** What `from` gives. */
  give: TradeSide
  /** What `from` wants back from `to`. */
  get: TradeSide
  /** Crate kind of each crate in the trade, by crate id. */
  crateKinds: Record<string, string>
  /** Student-made items in the trade, so they can be shown. */
  cosmetics: import('./wicky').Cosmetic[]
  note: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'failed'
  createdAt: string
  resolvedAt: string | null
}

/** Someone's items and crates, for picking what to ask for in a trade. */
export interface Inventory {
  items: string[]
  crates: { id: string; crateId: string }[]
  cosmetics: import('./wicky').Cosmetic[]
}

// --- Student-made crates ------------------------------------------------------------------

/** Students pack their own approved cosmetics into a crate and sell it. */
export const CUSTOM_CRATE = {
  minItems: 2,
  maxItems: 12,
  price: { min: 20, max: 2000 },
  /** Opening one when you already own everything left in it gives this share back as coins. */
  refund: 0.5,
  maxActive: 10,
} as const

export interface CustomCrate {
  id: string
  /** `u:<id>`: what's stored on crates people own. */
  crateId: string
  name: string
  emoji: string
  description: string
  colors: [string, string]
  price: number
  drops: { item: string; tier: CrateTier }[]
  creator: { id: string; name: string; displayName: string | null }
  status: 'active' | 'removed'
  sales: number
  createdAt: string
}

export const customCrateDef = (c: CustomCrate): CrateDef => ({
  id: c.crateId,
  name: c.name,
  emoji: c.emoji,
  description: c.description,
  price: c.price,
  colors: c.colors,
  drops: c.drops.map((d) => ({ tier: d.tier, item: d.item })),
  creator: c.creator,
  removed: c.status === 'removed',
})

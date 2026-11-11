/**
 * WickyChat extras: Wicky Coins and avatar decorations.
 * Shared by the API (prices, rules) and the web app (shop, rendering).
 */

/** How Wicky Coins are earned and lost. */
export const COINS = {
  /** Claimed once a day from the shop page. */
  daily: 25,
  /** Per message sent... */
  perMessage: 2,
  /** ...up to this many coins a day from messages, so spamming doesn't pay. */
  messageDailyCap: 50,
  /** Taken away when the swear filter catches you (never below zero). */
  swearPenalty: 5,
} as const

export type DecorationRarity = 'common' | 'rare' | 'epic' | 'legendary'

export interface Decoration {
  id: string
  name: string
  description: string
  price: number
  rarity: DecorationRarity
}

/**
 * Animated rings drawn around avatars. The look of each one lives in
 * packages/ui/src/styles.css as `.q-deco-<id>`.
 */
export const DECORATIONS: Decoration[] = [
  {
    id: 'pulse',
    name: 'Neon Pulse',
    description: 'A glowing ring that breathes.',
    price: 60,
    rarity: 'common',
  },
  {
    id: 'orbit',
    name: 'Orbit',
    description: 'A little moon circling your picture.',
    price: 100,
    rarity: 'common',
  },
  {
    id: 'sparkle',
    name: 'Sparkles',
    description: 'Twinkling stars around the edge.',
    price: 150,
    rarity: 'rare',
  },
  {
    id: 'rainbow',
    name: 'Rainbow Spin',
    description: 'A spinning rainbow border.',
    price: 200,
    rarity: 'rare',
  },
  {
    id: 'hearts',
    name: 'Floating Hearts',
    description: 'Hearts that drift upward.',
    price: 250,
    rarity: 'epic',
  },
  {
    id: 'fire',
    name: 'On Fire',
    description: 'Flickering flames. You are on fire.',
    price: 350,
    rarity: 'epic',
  },
  {
    id: 'kite',
    name: 'Wicky Kite',
    description: 'The Wicky kite soaring around you.',
    price: 500,
    rarity: 'legendary',
  },
  {
    id: 'crown',
    name: 'Royal Crown',
    description: 'A golden crown with a shimmering ring.',
    price: 800,
    rarity: 'legendary',
  },
]

export const DECORATION_IDS = DECORATIONS.map((d) => d.id)

export const decorationById = (id: string | null | undefined) =>
  id ? DECORATIONS.find((d) => d.id === id) : undefined

/** Colours for the profile card banner (anyone can pick these for free). */
export const BANNER_COLORS = [
  '#8052ff',
  '#15846e',
  '#ffb829',
  '#e2694a',
  '#d6409f',
  '#3b8fc9',
  '#2c9c6a',
  '#5b6ee8',
  '#c4483e',
  '#1b1726',
] as const

export interface CoinTransaction {
  id: string
  amount: number
  reason: 'daily' | 'message' | 'swear' | 'purchase' | 'gift'
  ref: string | null
  createdAt: string
}

export interface Wallet {
  coins: number
  owned: string[]
  equipped: string | null
  /** Whether today's daily bonus can still be claimed. */
  dailyAvailable: boolean
  /** Coins earned from messages today, out of COINS.messageDailyCap. */
  earnedFromMessagesToday: number
  history: CoinTransaction[]
}

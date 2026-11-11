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
 * Built-in avatar decorations: a ring (CSS in packages/ui/src/styles.css, `.q-deco-<id>`) plus
 * an animated sticker at /decorations/<id>.webp. The stickers are Google's Noto Animated Emoji
 * (CC BY 4.0, https://googlefonts.github.io/noto-emoji-animation/), credited in the Shop.
 */
export const DECORATIONS: Decoration[] = [
  {
    id: 'party',
    name: 'Party Time',
    description: 'Confetti for every message.',
    price: 90,
    rarity: 'common',
  },
  {
    id: 'pulse',
    name: 'Neon Pulse',
    description: 'A breathing neon ring with a spark.',
    price: 60,
    rarity: 'common',
  },
  {
    id: 'orbit',
    name: 'Orbit',
    description: 'A dizzy star circling your picture.',
    price: 100,
    rarity: 'common',
  },
  {
    id: 'ghost',
    name: 'Spooky',
    description: 'A friendly ghost peeking out.',
    price: 120,
    rarity: 'common',
  },
  {
    id: 'pumpkin',
    name: 'Pumpkin',
    description: 'Halloween all year round.',
    price: 120,
    rarity: 'common',
  },
  {
    id: 'clover',
    name: 'Lucky',
    description: 'A four-leaf clover for test day.',
    price: 130,
    rarity: 'common',
  },
  {
    id: 'wave',
    name: 'Ocean',
    description: 'Waves lapping at the bottom.',
    price: 140,
    rarity: 'common',
  },
  {
    id: 'sparkle',
    name: 'Sparkles',
    description: 'A golden ring with twinkles.',
    price: 150,
    rarity: 'rare',
  },
  {
    id: 'cat',
    name: 'Kitty',
    description: 'A cat that keeps you company.',
    price: 150,
    rarity: 'rare',
  },
  {
    id: 'cool',
    name: 'Too Cool',
    description: 'Sunglasses on, always.',
    price: 160,
    rarity: 'rare',
  },
  {
    id: 'sakura',
    name: 'Blossom',
    description: 'Cherry blossoms in spring.',
    price: 170,
    rarity: 'rare',
  },
  {
    id: 'rocket',
    name: 'Blast Off',
    description: 'A rocket launching past you.',
    price: 180,
    rarity: 'rare',
  },
  { id: 'boom', name: 'Kaboom', description: 'Makes an entrance.', price: 190, rarity: 'rare' },
  {
    id: 'rainbow',
    name: 'Rainbow Spin',
    description: 'A spinning rainbow ring.',
    price: 200,
    rarity: 'rare',
  },
  {
    id: 'robot',
    name: 'Robotics',
    description: 'Beep boop. For the robotics club.',
    price: 200,
    rarity: 'rare',
  },
  {
    id: 'butterfly',
    name: 'Butterfly',
    description: 'A butterfly flutters by.',
    price: 220,
    rarity: 'rare',
  },
  {
    id: 'hearts',
    name: 'Love Struck',
    description: 'A pink ring and a sparkling heart.',
    price: 250,
    rarity: 'epic',
  },
  { id: 'guitar', name: 'Rockstar', description: 'For the band kids.', price: 280, rarity: 'epic' },
  {
    id: 'snow',
    name: 'Frosty',
    description: 'An icy ring and a snowflake.',
    price: 300,
    rarity: 'epic',
  },
  {
    id: 'fire',
    name: 'On Fire',
    description: 'A blazing ring. You are on fire.',
    price: 350,
    rarity: 'epic',
  },
  {
    id: 'unicorn',
    name: 'Unicorn',
    description: 'Rare, magical, a bit extra.',
    price: 400,
    rarity: 'epic',
  },
  {
    id: 'star',
    name: 'Superstar',
    description: 'A glowing star for a glowing person.',
    price: 450,
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
    description: 'A shimmering gold ring and a crown.',
    price: 800,
    rarity: 'legendary',
  },
]

export const DECORATION_IDS = DECORATIONS.map((d) => d.id)

export const decorationById = (id: string | null | undefined) =>
  id ? DECORATIONS.find((d) => d.id === id) : undefined

// --- Student-made cosmetics ---------------------------------------------------------

/** Where a cosmetic's sticker sits on the avatar. */
export const STICKER_POSITIONS = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'] as const
export type StickerPosition = (typeof STICKER_POSITIONS)[number]

/** Price limits for cosmetics students make. The creator gets CREATOR_SHARE of each sale. */
export const COSMETIC_PRICE = { min: 10, max: 2000 } as const
export const CREATOR_SHARE = 0.9

export interface Cosmetic {
  id: string
  /** What goes in `users.decoration` / `Avatar decoration`: `u:<id>|f:<file>|s:<file>:<pos>`. */
  decoration: string
  name: string
  description: string
  price: number
  creator: { id: string; name: string; displayName: string | null }
  frameUrl: string | null
  stickerUrl: string | null
  stickerPosition: StickerPosition
  status: 'pending' | 'approved' | 'rejected'
  reviewNote: string | null
  sales: number
  createdAt: string
}

/**
 * The `cosmetic.json` in a pack people upload. Image fields are file names of images in the
 * same upload.
 *
 * {
 *   "name": "Galaxy Ring",
 *   "description": "Stars all around",
 *   "price": 150,
 *   "frame": "frame.gif",
 *   "sticker": "star.png",
 *   "stickerPosition": "tr"
 * }
 */
export interface CosmeticManifest {
  name: string
  description?: string
  price: number
  frame?: string
  sticker?: string
  stickerPosition?: StickerPosition
}

/** Builds the decoration string the Avatar component draws for a student-made cosmetic. */
export function cosmeticDecoration(c: {
  id: string
  frameFileId: string | null
  stickerFileId: string | null
  stickerPosition: string
}) {
  return [
    `u:${c.id}`,
    c.frameFileId ? `f:${c.frameFileId}` : null,
    c.stickerFileId ? `s:${c.stickerFileId}:${c.stickerPosition}` : null,
  ]
    .filter(Boolean)
    .join('|')
}

// --- Profile styles -------------------------------------------------------------------

/** Fonts people can pick for their name and bio. CSS classes `.q-font-<id>` load them. */
export const PROFILE_FONTS = [
  { id: 'default', name: 'Default' },
  { id: 'rounded', name: 'Rounded' },
  { id: 'serif', name: 'Serif' },
  { id: 'mono', name: 'Typewriter' },
  { id: 'hand', name: 'Handwritten' },
  { id: 'pixel', name: 'Pixel' },
  { id: 'display', name: 'Bold Display' },
  { id: 'future', name: 'Futuristic' },
] as const
export type ProfileFontId = (typeof PROFILE_FONTS)[number]['id']

export interface ProfileStyle {
  /** Font for the display name (in chat and on the card). */
  nameFont?: ProfileFontId
  /** One colour, or two for a gradient name. */
  nameColors?: string[]
  /** Font for "About me". */
  bioFont?: ProfileFontId
  /** Two colours for the profile card background gradient (Discord's profile themes). */
  theme?: [string, string]
  /** guns.lol username, shown as a link under Connections. */
  gunslol?: string
}

const HEX = /^#[0-9a-fA-F]{6}$/
const FONT_IDS = PROFILE_FONTS.map((f) => f.id) as string[]

/** Keeps only valid values, so stored styles are always safe to render. */
export function cleanProfileStyle(raw: unknown): ProfileStyle {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: ProfileStyle = {}
  if (typeof r.nameFont === 'string' && FONT_IDS.includes(r.nameFont))
    out.nameFont = r.nameFont as ProfileFontId
  if (typeof r.bioFont === 'string' && FONT_IDS.includes(r.bioFont))
    out.bioFont = r.bioFont as ProfileFontId
  if (Array.isArray(r.nameColors)) {
    const c = r.nameColors.filter((x): x is string => typeof x === 'string' && HEX.test(x))
    if (c.length) out.nameColors = c.slice(0, 2)
  }
  if (Array.isArray(r.theme)) {
    const c = r.theme.filter((x): x is string => typeof x === 'string' && HEX.test(x))
    if (c.length === 2) out.theme = [c[0]!, c[1]!]
  }
  if (typeof r.gunslol === 'string') {
    const name = r.gunslol
      .trim()
      .replace(/^(https?:\/\/)?(www\.)?guns\.lol\//i, '')
      .replace(/^@/, '')
    if (/^[A-Za-z0-9_.-]{1,32}$/.test(name)) out.gunslol = name
  }
  return out
}

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
  reason: 'daily' | 'message' | 'swear' | 'purchase' | 'gift' | 'sale' | 'gift_item'
  ref: string | null
  createdAt: string
}

export interface Wallet {
  coins: number
  /** Built-in decoration ids and `u:<id>` for student-made ones. */
  owned: string[]
  /** Who gave you which item, for items that were gifts. */
  giftedBy: Record<string, { id: string; name: string }>
  equipped: string | null
  /** Whether today's daily bonus can still be claimed. */
  dailyAvailable: boolean
  /** Coins earned from messages today, out of COINS.messageDailyCap. */
  earnedFromMessagesToday: number
  history: CoinTransaction[]
}

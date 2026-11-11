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
  /** A decoration around the avatar, an app theme (CSS), a profile effect or a name plate. */
  kind: 'decoration' | 'theme' | 'effect' | 'plate'
  /** What gets stored when it's equipped (effects and plates). */
  value: string
  /** Theme CSS (themes only). */
  css: string | null
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
  /** Private ones aren't sold: only the creator and people they give a copy to can use them. */
  visibility: 'public' | 'private'
  /** Limited: only this many copies will ever exist (null = unlimited). */
  stock: number | null
  createdAt: string
}

/** How many copies a limited cosmetic can have. */
export const COSMETIC_STOCK = { min: 1, max: 1000 } as const

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
  /** Solid background colour for the card (text colour adjusts to stay readable). */
  cardBg?: string
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
  if (typeof r.cardBg === 'string' && HEX.test(r.cardBg)) out.cardBg = r.cardBg
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
  reason:
    | 'daily'
    | 'message'
    | 'swear'
    | 'purchase'
    | 'gift'
    | 'sale'
    | 'gift_item'
    | 'market_buy'
    | 'market_sale'
    | 'poll'
    | 'quiz'
    | 'crate'
    | 'crate_gift'
    | 'crate_coins'
    | 'coins_sent'
    | 'coins_received'
    | 'trade'
    | 'crate_sale'
    | 'bundle'
    | 'bundle_gift'
    | 'bundle_sale'
    | 'achievement'
    | 'trade_up'
    | 'auction_bid'
    | 'auction_refund'
    | 'auction_sale'
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
  /** Equipped app theme: a built-in theme id or `u:<id>`. */
  equippedTheme: string | null
  equippedEffect: string | null
  equippedPlate: string | null
  /** Days in a row the daily bonus was claimed. */
  streak: number
  /** Whether today's daily bonus can still be claimed. */
  dailyAvailable: boolean
  /** Coins earned from messages today, out of COINS.messageDailyCap. */
  earnedFromMessagesToday: number
  history: CoinTransaction[]
  /** Crates you haven't opened yet. */
  crates: { id: string; crateId: string; giftedBy: { id: string; name: string } | null }[]
  /** Copy numbers of limited items you own, e.g. #3 of 20. */
  serials: Record<string, number>
  /** Coins you've sent to people today, out of COIN_GIFT.dailyMax. */
  coinsSentToday: number
}

/** Students sending their own coins to each other. */
export const COIN_GIFT = { max: 500, dailyMax: 1000 } as const

// --- App themes ------------------------------------------------------------------------

/** Colour variables a theme can set. Every part of the app reads these. */
export const THEME_VARS = [
  'bg',
  'bg-subtle',
  'bg-rail',
  'bg-muted',
  'bg-emphasis',
  'bg-overlay',
  'border',
  'border-strong',
  'fg',
  'fg-muted',
  'fg-subtle',
  'accent',
  'accent-hover',
  'accent-subtle',
  'accent-fg',
  'accent-text',
  'danger',
  'success',
  'warning',
  'mention-bg',
  'mention-border',
] as const
export type ThemeVar = (typeof THEME_VARS)[number]

export interface BuiltinTheme {
  id: string
  name: string
  price: number
  /** Made for dark mode (switches the app to dark while it's on). */
  dark: boolean
  /** Who made the original palette (all MIT licensed). */
  credit: string
  vars: Record<ThemeVar, string>
  /** Seasonal event it belongs to: only sold while the event is on. */
  event?: string
}

function palette(
  p: {
    base: string
    mantle: string
    crust: string
    s0: string
    s1: string
    s2: string
    text: string
    sub: string
    overlay: string
    accent: string
    accent2: string
    red: string
    green: string
    yellow: string
  },
  dark: boolean,
): Record<ThemeVar, string> {
  const mix = (a: string, b: string, pct: number) => `color-mix(in oklab, ${a} ${pct}%, ${b})`
  return {
    bg: p.base,
    'bg-subtle': p.mantle,
    'bg-rail': p.crust,
    'bg-muted': p.s0,
    'bg-emphasis': p.s1,
    'bg-overlay': p.mantle,
    border: p.s0,
    'border-strong': p.s2,
    fg: p.text,
    'fg-muted': p.sub,
    'fg-subtle': p.overlay,
    accent: p.accent,
    'accent-hover': p.accent2,
    'accent-subtle': mix(p.accent, p.base, dark ? 22 : 16),
    'accent-fg': dark ? p.crust : '#ffffff',
    'accent-text': p.accent,
    danger: p.red,
    success: p.green,
    warning: p.yellow,
    'mention-bg': mix(p.yellow, p.base, dark ? 18 : 22),
    'mention-border': mix(p.yellow, p.base, 55),
  }
}

/** Themes sold in the Shop. Palettes from open-source (MIT) colour schemes. */
export const THEMES: BuiltinTheme[] = [
  {
    id: 't-mocha',
    name: 'Catppuccin Mocha',
    price: 200,
    dark: true,
    credit: 'Catppuccin',
    vars: palette(
      {
        base: '#1e1e2e',
        mantle: '#181825',
        crust: '#11111b',
        s0: '#313244',
        s1: '#45475a',
        s2: '#585b70',
        text: '#cdd6f4',
        sub: '#bac2de',
        overlay: '#7f849c',
        accent: '#cba6f7',
        accent2: '#b4befe',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
      },
      true,
    ),
  },
  {
    id: 't-macchiato',
    name: 'Catppuccin Macchiato',
    price: 200,
    dark: true,
    credit: 'Catppuccin',
    vars: palette(
      {
        base: '#24273a',
        mantle: '#1e2030',
        crust: '#181926',
        s0: '#363a4f',
        s1: '#494d64',
        s2: '#5b6078',
        text: '#cad3f5',
        sub: '#b8c0e0',
        overlay: '#8087a2',
        accent: '#8aadf4',
        accent2: '#b7bdf8',
        red: '#ed8796',
        green: '#a6da95',
        yellow: '#eed49f',
      },
      true,
    ),
  },
  {
    id: 't-frappe',
    name: 'Catppuccin Frappé',
    price: 200,
    dark: true,
    credit: 'Catppuccin',
    vars: palette(
      {
        base: '#303446',
        mantle: '#292c3c',
        crust: '#232634',
        s0: '#414559',
        s1: '#51576d',
        s2: '#626880',
        text: '#c6d0f5',
        sub: '#b5bfe2',
        overlay: '#838ba7',
        accent: '#f4b8e4',
        accent2: '#ca9ee6',
        red: '#e78284',
        green: '#a6d189',
        yellow: '#e5c890',
      },
      true,
    ),
  },
  {
    id: 't-latte',
    name: 'Catppuccin Latte',
    price: 200,
    dark: false,
    credit: 'Catppuccin',
    vars: palette(
      {
        base: '#eff1f5',
        mantle: '#e6e9ef',
        crust: '#dce0e8',
        s0: '#ccd0da',
        s1: '#bcc0cc',
        s2: '#acb0be',
        text: '#4c4f69',
        sub: '#5c5f77',
        overlay: '#8c8fa1',
        accent: '#8839ef',
        accent2: '#7287fd',
        red: '#d20f39',
        green: '#40a02b',
        yellow: '#df8e1d',
      },
      false,
    ),
  },
  {
    id: 't-dracula',
    name: 'Dracula',
    price: 150,
    dark: true,
    credit: 'Dracula Theme',
    vars: palette(
      {
        base: '#282a36',
        mantle: '#21222c',
        crust: '#191a21',
        s0: '#343746',
        s1: '#44475a',
        s2: '#565973',
        text: '#f8f8f2',
        sub: '#d6d6e0',
        overlay: '#8a8fb0',
        accent: '#bd93f9',
        accent2: '#ff79c6',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
      },
      true,
    ),
  },
  {
    id: 't-nord',
    name: 'Nord',
    price: 150,
    dark: true,
    credit: 'Nord (Arctic Ice Studio)',
    vars: palette(
      {
        base: '#2e3440',
        mantle: '#2a303b',
        crust: '#242933',
        s0: '#3b4252',
        s1: '#434c5e',
        s2: '#4c566a',
        text: '#eceff4',
        sub: '#d8dee9',
        overlay: '#8f9bb3',
        accent: '#88c0d0',
        accent2: '#81a1c1',
        red: '#bf616a',
        green: '#a3be8c',
        yellow: '#ebcb8b',
      },
      true,
    ),
  },
  {
    id: 't-gruvbox',
    name: 'Gruvbox',
    price: 150,
    dark: true,
    credit: 'Gruvbox (morhetz)',
    vars: palette(
      {
        base: '#282828',
        mantle: '#1d2021',
        crust: '#161819',
        s0: '#3c3836',
        s1: '#504945',
        s2: '#665c54',
        text: '#ebdbb2',
        sub: '#d5c4a1',
        overlay: '#928374',
        accent: '#fe8019',
        accent2: '#fabd2f',
        red: '#fb4934',
        green: '#b8bb26',
        yellow: '#fabd2f',
      },
      true,
    ),
  },
  {
    id: 't-tokyo',
    name: 'Tokyo Night',
    price: 150,
    dark: true,
    credit: 'Tokyo Night (enkia)',
    vars: palette(
      {
        base: '#1a1b26',
        mantle: '#16161e',
        crust: '#101014',
        s0: '#232433',
        s1: '#2f3549',
        s2: '#414868',
        text: '#c0caf5',
        sub: '#a9b1d6',
        overlay: '#737aa2',
        accent: '#7aa2f7',
        accent2: '#bb9af7',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
      },
      true,
    ),
  },
  {
    id: 't-rosepine',
    name: 'Rosé Pine',
    price: 150,
    dark: true,
    credit: 'Rosé Pine',
    vars: palette(
      {
        base: '#191724',
        mantle: '#1f1d2e',
        crust: '#13111c',
        s0: '#26233a',
        s1: '#2f2b45',
        s2: '#403d52',
        text: '#e0def4',
        sub: '#c4c0de',
        overlay: '#908caa',
        accent: '#ebbcba',
        accent2: '#c4a7e7',
        red: '#eb6f92',
        green: '#9ccfd8',
        yellow: '#f6c177',
      },
      true,
    ),
  },
  {
    id: 't-solarized',
    name: 'Solarized Light',
    price: 120,
    dark: false,
    credit: 'Solarized (Ethan Schoonover)',
    vars: palette(
      {
        base: '#fdf6e3',
        mantle: '#f5efdc',
        crust: '#eee8d5',
        s0: '#e8e1cb',
        s1: '#ddd6c1',
        s2: '#c9c2ad',
        text: '#073642',
        sub: '#586e75',
        overlay: '#93a1a1',
        accent: '#268bd2',
        accent2: '#2aa198',
        red: '#dc322f',
        green: '#859900',
        yellow: '#b58900',
      },
      false,
    ),
  },
  {
    id: 't-spooky',
    name: 'Spooky Night',
    price: 220,
    dark: true,
    credit: 'WickyChat',
    event: 'halloween',
    vars: palette(
      {
        base: '#16121f',
        mantle: '#110d18',
        crust: '#0b0810',
        s0: '#2a2238',
        s1: '#3a3049',
        s2: '#4d405e',
        text: '#efe6ff',
        sub: '#c9bce0',
        overlay: '#8a7ba3',
        accent: '#ff8a1f',
        accent2: '#ffb347',
        red: '#ff5470',
        green: '#8bd450',
        yellow: '#ffd166',
      },
      true,
    ),
  },
  {
    id: 't-maple',
    name: 'Maple Harvest',
    price: 200,
    dark: false,
    credit: 'WickyChat',
    event: 'harvest',
    vars: palette(
      {
        base: '#fdf6ee',
        mantle: '#f7ecdf',
        crust: '#f0e0cd',
        s0: '#ecdcc8',
        s1: '#e0ccb4',
        s2: '#cfb697',
        text: '#3b2414',
        sub: '#6e4a30',
        overlay: '#a07c5e',
        accent: '#c2410c',
        accent2: '#9a3412',
        red: '#b91c1c',
        green: '#4d7c0f',
        yellow: '#b45309',
      },
      false,
    ),
  },
  {
    id: 't-frost',
    name: 'Frostbite',
    price: 220,
    dark: true,
    credit: 'WickyChat',
    event: 'winter',
    vars: palette(
      {
        base: '#0f1a26',
        mantle: '#0b141e',
        crust: '#070e15',
        s0: '#1c2c3d',
        s1: '#273b50',
        s2: '#355068',
        text: '#e6f4ff',
        sub: '#b8d4ea',
        overlay: '#7d9bb5',
        accent: '#7dd3fc',
        accent2: '#bae6fd',
        red: '#fb7185',
        green: '#6ee7b7',
        yellow: '#fde68a',
      },
      true,
    ),
  },
]

export const THEME_IDS = THEMES.map((t) => t.id)
export const themeById = (id: string | null | undefined) => THEMES.find((t) => t.id === id)

/** CSS for a built-in theme. Applies in both light and dark mode. */
export function themeCss(t: BuiltinTheme) {
  const body = THEME_VARS.map((v) => `  --q-${v}: ${t.vars[v]};`).join('\n')
  return `:root[data-wtheme],\n:root.dark[data-wtheme] {\n${body}\n  color-scheme: ${t.dark ? 'dark' : 'light'};\n}`
}

/** A starting point for people making their own theme. */
export const THEME_TEMPLATE = `/* Change the colours, keep the names. Keep the :root[data-wtheme] selectors so your theme
   wins over the normal colours. Links and images from other sites (url()) are removed. */
${themeCss(THEMES[0]!)}

/* You can style more than colours too, e.g. square corners everywhere: */
/* * { border-radius: 0 !important; } */`

export const MAX_THEME_CSS = 20_000

/**
 * Makes student-written theme CSS safe to load: no loading things from other sites (which
 * could track people), no imports, and nothing that could break out of the <style> tag.
 * Returns the cleaned CSS and what was removed, so the editor can tell the creator.
 */
export function sanitizeThemeCss(raw: string): { css: string; removed: string[] } {
  const removed = new Set<string>()
  let css = raw.slice(0, MAX_THEME_CSS).replace(/\/\*[\s\S]*?\*\//g, (c) =>
    // Keep comments, but they mustn't hide anything.
    c.replace(/</g, ''),
  )
  const strip = (re: RegExp, what: string) => {
    css = css.replace(re, () => {
      removed.add(what)
      return ''
    })
  }
  strip(/<\/?\s*style/gi, '<style>')
  strip(/</g, '<')
  strip(/\\/g, 'backslashes')
  strip(/@import[^;]*;?/gi, '@import')
  strip(/@font-face\s*\{[^}]*\}/gi, '@font-face')
  strip(/@namespace[^;]*;?/gi, '@namespace')
  // Remove the whole call when it's closed, then any opener that's left (an unclosed url( is
  // still valid CSS).
  strip(/\b(url|image-set|image|cross-fade|element|paint|src)\s*\([^)]*\)/gi, 'url() / images')
  strip(/\b(url|image-set|image|cross-fade|element|paint|src)\s*\(/gi, 'url() / images')
  strip(/expression\s*\(/gi, 'expression()')
  strip(/javascript:/gi, 'javascript:')
  strip(/behavior\s*:/gi, 'behavior')
  strip(/-moz-binding/gi, '-moz-binding')
  return { css: css.trim(), removed: [...removed] }
}

// --- Badges, streaks, leaderboard ------------------------------------------------------

export interface BadgeDef {
  id: string
  emoji: string
  name: string
  /** How you get it. */
  how: string
  /** Only teachers can give it. */
  manual?: boolean
}

export const BADGES: BadgeDef[] = [
  {
    id: 'teacher_pick',
    emoji: '⭐',
    name: "Teacher's pick",
    how: 'Given by a teacher',
    manual: true,
  },
  {
    id: 'helper',
    emoji: '🤝',
    name: 'Helper',
    how: 'Given by a teacher for helping others',
    manual: true,
  },
  {
    id: 'kindness',
    emoji: '💛',
    name: 'Kindness',
    how: 'Given by a teacher for being kind',
    manual: true,
  },
  { id: 'streak7', emoji: '🔥', name: 'On fire', how: 'Claim daily coins 7 days in a row' },
  { id: 'streak30', emoji: '☄️', name: 'Unstoppable', how: 'Claim daily coins 30 days in a row' },
  { id: 'chatter', emoji: '💬', name: 'Chatterbox', how: 'Send 1,000 messages' },
  { id: 'creator', emoji: '🎨', name: 'Creator', how: 'Get a cosmetic approved for the Shop' },
  { id: 'seller', emoji: '💰', name: 'Top seller', how: 'Sell 10 of your creations' },
  { id: 'rich', emoji: '🪙', name: 'Coin collector', how: 'Have 1,000 Wicky Coins at once' },
  { id: 'quiz', emoji: '🧠', name: 'Quiz whiz', how: 'Answer 10 quiz questions right' },
  { id: 'early', emoji: '🐣', name: 'Early bird', how: 'Joined WickyChat in its first month' },
]
export const badgeById = (id: string) => BADGES.find((b) => b.id === id)
export const MANUAL_BADGES = BADGES.filter((b) => b.manual).map((b) => b.id)

export interface EarnedBadge {
  id: string
  /** For teacher-given badges: who gave it and why. */
  note?: string
  by?: string
}

export interface ProfileStats {
  badges: EarnedBadge[]
  streak: number
  bestStreak: number
}

/** Extra coins for a daily streak: +5 a day from day 2, up to +30. */
export const streakBonus = (streak: number) => Math.min(Math.max(streak - 1, 0) * 5, 30)

export interface LeaderRow {
  user: import('./types').UserSummary
  value: number
}
export interface Leaderboard {
  /** Coins earned in the last 7 days. */
  earners: LeaderRow[]
  /** Creations sold, all time. */
  creators: LeaderRow[]
  /** Current daily streak. */
  streaks: LeaderRow[]
}

// --- Profile effects and name plates ----------------------------------------------------

export interface SimpleItem {
  id: string
  name: string
  description: string
  price: number
  /** Seasonal event it belongs to: only sold while the event is on. */
  event?: string
  /** Email of the student who designed it: shown as its maker, and they get CREATOR_SHARE of sales. */
  madeBy?: string
}

/** Animated overlays on the profile card. Drawn with CSS (`.q-fx-<name>`). */
export const EFFECTS: (SimpleItem & {
  particle: string
  particles?: string[]
  /** How the particles move (seasonal effects); the older ones are styled by id in CSS. */
  motion?: 'fall' | 'rise' | 'drift' | 'twinkle'
})[] = [
  {
    id: 'e-snow',
    name: 'Snowfall',
    description: 'Soft snow drifting down',
    price: 150,
    particle: '❄',
  },
  {
    id: 'e-sparkle',
    name: 'Sparkles',
    description: 'Twinkling sparkles',
    price: 150,
    particle: '✦',
  },
  {
    id: 'e-hearts',
    name: 'Floating hearts',
    description: 'Hearts rising up',
    price: 180,
    particle: '♥',
  },
  {
    id: 'e-sakura',
    name: 'Sakura',
    description: 'Cherry blossom petals',
    price: 200,
    particle: '🌸',
  },
  {
    id: 'e-bubbles',
    name: 'Bubbles',
    description: 'Bubbles floating up',
    price: 120,
    particle: '◯',
  },
  {
    id: 'e-stars',
    name: 'Shooting stars',
    description: 'Stars streaking across',
    price: 250,
    particle: '★',
  },
  {
    id: 'e-confetti',
    name: 'Confetti',
    description: 'A party on your card',
    price: 220,
    particle: '▮',
  },
  {
    id: 'e-fireflies',
    name: 'Fireflies',
    description: 'Glowing dots drifting around',
    price: 200,
    particle: '●',
  },
  {
    id: 'e-emorain',
    name: 'Dark Rain',
    description: 'Gray rain, a gloomy sky and the odd black heart',
    price: 180,
    madeBy: 'teum2032@chadwickschool.org',
    particle: '│',
    // Every 5th drop is a heart (see .q-fx-emorain in globals.css).
    particles: ['│', '│', '│', '│', '🖤'],
  },
  // Seasonal (sold only while their event is on, then they're collectibles).
  ev('e-bats', 'Haunted', 'Bats, pumpkins and a ghost or two', 220, 'halloween', 'drift', [
    '🦇',
    '🎃',
    '👻',
  ]),
  ev('e-leaves', 'Falling Leaves', 'Autumn leaves drifting down', 180, 'harvest', 'fall', [
    '🍂',
    '🍁',
    '🍂',
    '🌰',
  ]),
  ev('e-winter', 'Winter Wonderland', 'Snowmen, trees and presents', 220, 'winter', 'fall', [
    '❄️',
    '⛄',
    '🎄',
    '🎁',
  ]),
  ev('e-lanterns', 'Lantern Festival', 'Red lanterns rising up', 220, 'lunar', 'rise', [
    '🏮',
    '🧧',
    '✨',
  ]),
  ev('e-cupid', "Cupid's Arrow", 'Hearts everywhere', 200, 'valentine', 'rise', ['💘', '💝', '💖']),
  ev('e-spring', 'Spring Bloom', 'Tulips and butterflies', 180, 'spring', 'drift', [
    '🌷',
    '🦋',
    '🌼',
  ]),
  ev('e-finals', 'Finals Week', 'Coffee, books and pencils', 150, 'finals', 'fall', [
    '☕',
    '📚',
    '✏️',
    '💯',
  ]),
  ev('e-beach', 'Beach Day', 'Waves, shells and watermelon', 200, 'summer', 'drift', [
    '🌊',
    '🍉',
    '🐚',
    '☀️',
  ]),
]

function ev(
  id: string,
  name: string,
  description: string,
  price: number,
  event: string,
  motion: 'fall' | 'rise' | 'drift' | 'twinkle',
  particles: string[],
) {
  return { id, name, description, price, event, motion, particle: particles[0]!, particles }
}

/** Animated backgrounds behind your name in lists. Drawn with CSS (`.q-plate-<name>`). */
export const PLATES: SimpleItem[] = [
  { id: 'p-sunset', name: 'Sunset', description: 'Warm orange and pink', price: 120 },
  { id: 'p-ocean', name: 'Ocean', description: 'Rolling blues', price: 120 },
  { id: 'p-aurora', name: 'Aurora', description: 'Northern lights', price: 180 },
  { id: 'p-candy', name: 'Candy', description: 'Pastel pink and blue', price: 120 },
  { id: 'p-galaxy', name: 'Galaxy', description: 'Deep space purple', price: 200 },
  { id: 'p-matrix', name: 'Terminal', description: 'Green on black', price: 150 },
  { id: 'p-lava', name: 'Lava', description: 'Hot reds that flow', price: 180 },
  { id: 'p-mint', name: 'Mint', description: 'Fresh and green', price: 100 },
  {
    id: 'p-pumpkin',
    name: 'Pumpkin Patch',
    description: 'Orange and purple',
    price: 160,
    event: 'halloween',
  },
  {
    id: 'p-harvest',
    name: 'Harvest',
    description: 'Maple, gold and brown',
    price: 150,
    event: 'harvest',
  },
  { id: 'p-frost', name: 'Frost', description: 'Icy blue and white', price: 160, event: 'winter' },
  { id: 'p-lunar', name: 'Lucky Red', description: 'Red and gold', price: 160, event: 'lunar' },
  { id: 'p-rose', name: 'Rose', description: 'Pinks and reds', price: 150, event: 'valentine' },
  { id: 'p-bloom', name: 'Bloom', description: 'Spring pastels', price: 140, event: 'spring' },
  {
    id: 'p-study',
    name: 'All-nighter',
    description: 'Midnight blue and lamp light',
    price: 120,
    event: 'finals',
  },
  {
    id: 'p-tropical',
    name: 'Tropical',
    description: 'Turquoise and sunshine',
    price: 150,
    event: 'summer',
  },
]

export const EFFECT_IDS = EFFECTS.map((e) => e.id)
export const PLATE_IDS = PLATES.map((p) => p.id)
export const effectById = (id: string | null | undefined) => EFFECTS.find((e) => e.id === id)
export const plateById = (id: string | null | undefined) => PLATES.find((p) => p.id === id)

/** Value stored for a student-made effect or plate: `u:<cosmetic id>|i:<image file id>`. */
export const customImageValue = (c: { id: string; frameFileId: string | null }) =>
  `u:${c.id}${c.frameFileId ? `|i:${c.frameFileId}` : ''}`

/** The image file of a student-made effect or plate, if the value is one. */
export function customImageFile(value: string | null | undefined): string | null {
  const m = /^u:[0-9a-f-]{36}\|i:([0-9a-f-]{36})$/.exec(value ?? '')
  return m?.[1] ?? null
}

export type ItemKind = 'decoration' | 'theme' | 'effect' | 'plate'

// --- Marketplace -----------------------------------------------------------------------

/** Sellers get this share when someone buys their listing (the rest is a small fee). */
export const MARKET_SHARE = 0.9
export const MARKET_PRICE = { min: 1, max: 5000 } as const

export interface MarketListing {
  id: string
  itemId: string
  price: number
  seller: import('./types').UserSummary
  /** Set for student-made items, so they can be drawn and named. */
  cosmetic: Cosmetic | null
  createdAt: string
}

// --- Polls and quizzes -----------------------------------------------------------------

export interface Poll {
  id: string
  messageId: string
  channelId: string
  kind: 'poll' | 'quiz'
  question: string
  options: { id: string; text: string; votes: number }[]
  totalVoters: number
  multiple: boolean
  anonymous: boolean
  reward: number
  /** Options this person picked. */
  myVotes: string[]
  /** Quizzes: shown once you've answered, once it's closed, or to teachers. */
  correctOptionId: string | null
  closesAt: string | null
  closed: boolean
  /** Who picked what (not for anonymous polls). */
  voters: Record<string, import('./types').UserSummary[]>
  canClose: boolean
}

export const POLL_REWARD_MAX = 50

// --- Staff tags ------------------------------------------------------------------------

export type StaffTag = 'founder' | 'developer'

/** The people who made WickyChat. Shown on their profile instead of the Teacher tag. */
const STAFF: Record<string, StaffTag[]> = {
  'teum2032@chadwickschool.org': ['developer'],
  'schoi2032@chadwickschool.org': ['founder'],
}

export const staffTags = (email: string | null | undefined): StaffTag[] =>
  STAFF[(email ?? '').toLowerCase()] ?? []

/** Built-in items a student designed, by item id → the maker's email. */
export const builtinMakers = (): Record<string, string> =>
  Object.fromEntries(
    [...EFFECTS, ...PLATES].filter((x) => x.madeBy).map((x) => [x.id, x.madeBy!.toLowerCase()]),
  )

// --- Profile shelf and wishlist ---------------------------------------------------------

/** How many items fit on a profile's showcase shelf, and on a wishlist. */
export const SHELF = { max: 6, wishlistMax: 30 }

export interface Shelf {
  /** Pinned items, with their copy number when limited. */
  showcase: { itemId: string; serial: number | null }[]
  /** Items they want and don't own yet. */
  wishlist: string[]
}

// --- Achievements ------------------------------------------------------------------------

/** Things the server counts for achievements. */
export type AchievementStat =
  | 'messages'
  | 'crates'
  | 'trades'
  | 'gifts'
  | 'items'
  | 'sold'
  | 'streak'
  | 'quiz'
  | 'serialOne'
  | 'coinsSent'
  | 'tradeUps'
  | 'auctionsWon'

export interface AchievementDef {
  id: string
  emoji: string
  name: string
  how: string
  stat: AchievementStat
  goal: number
  /** Coins you get when you claim it. */
  reward: number
}

const ach = (
  id: string,
  emoji: string,
  name: string,
  how: string,
  stat: AchievementStat,
  goal: number,
  reward: number,
): AchievementDef => ({ id, emoji, name, how, stat, goal, reward })

export const ACHIEVEMENTS: AchievementDef[] = [
  ach('chat-100', '💬', 'Say hi', 'Send 100 messages', 'messages', 100, 20),
  ach('chat-1000', '🗣️', 'Chatterbox', 'Send 1,000 messages', 'messages', 1000, 100),
  ach('crate-1', '📦', 'Unboxer', 'Open your first crate', 'crates', 1, 10),
  ach('crate-25', '🎰', 'Crate addict', 'Open 25 crates', 'crates', 25, 75),
  ach('trade-1', '🤝', 'Deal!', 'Finish your first trade', 'trades', 1, 15),
  ach('trade-10', '📈', 'Trader', 'Finish 10 trades', 'trades', 10, 60),
  ach('gift-1', '🎁', 'Thoughtful', 'Gift someone an item, crate or bundle', 'gifts', 1, 15),
  ach('gift-10', '🎅', 'Secret Santa', 'Send 10 gifts', 'gifts', 10, 80),
  ach('own-10', '🧺', 'Collector', 'Own 10 items', 'items', 10, 30),
  ach('own-40', '🏛️', 'Museum', 'Own 40 items', 'items', 40, 150),
  ach('sell-1', '💰', 'First sale', 'Sell one of your creations', 'sold', 1, 20),
  ach('sell-25', '🏪', 'Shopkeeper', 'Sell 25 of your creations', 'sold', 25, 150),
  ach('streak-7', '🔥', 'On fire', 'Claim daily coins 7 days in a row', 'streak', 7, 30),
  ach('streak-30', '☄️', 'Unstoppable', 'Claim daily coins 30 days in a row', 'streak', 30, 200),
  ach('quiz-10', '🧠', 'Quiz whiz', 'Answer 10 quiz questions right', 'quiz', 10, 50),
  ach('serial-1', '🥇', 'Number one', 'Own copy #001 of a limited item', 'serialOne', 1, 50),
  ach('tradeup-1', '🧪', 'Alchemist', 'Do a trade-up contract', 'tradeUps', 1, 15),
  ach('tradeup-10', '⚗️', 'Trade-up master', 'Do 10 trade-up contracts', 'tradeUps', 10, 100),
  ach('auction-1', '🔨', 'Going, going, gone', 'Win an auction', 'auctionsWon', 1, 20),
  ach('send-500', '💸', 'Generous', 'Send 500 coins to friends in total', 'coinsSent', 500, 25),
]
export const achievementById = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)

export interface AchievementProgress {
  id: string
  progress: number
  done: boolean
  claimed: boolean
}

// --- Auctions ----------------------------------------------------------------------------

export const AUCTION = {
  /** How long an auction can run, in hours. */
  hours: [1, 6, 24] as const,
  start: { min: 5, max: 20000 },
  /** Each bid must beat the top bid by this much (5%, at least 1 coin). */
  step: 0.05,
  /** The seller gets this share of the winning bid. */
  share: 0.95,
  /** A bid in the last 2 minutes pushes the end back to 2 minutes from now. */
  snipeMs: 120_000,
  maxOpen: 5,
}

export const minBid = (start: number, top: number | null) =>
  top == null ? start : Math.max(top + 1, Math.ceil(top * (1 + AUCTION.step)))

export interface Auction {
  id: string
  itemId: string
  serial: number | null
  seller: import('./types').UserSummary
  startPrice: number
  topBid: number | null
  topBidder: { id: string; name: string; displayName: string | null } | null
  bids: number
  endsAt: string
  status: 'open' | 'sold' | 'unsold' | 'cancelled'
  cosmetic: Cosmetic | null
}

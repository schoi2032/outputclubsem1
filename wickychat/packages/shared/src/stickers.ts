/**
 * WickyChat stickers: big pictures you send in chat. Built-in packs are drawn with emoji (no
 * images needed); students can make packs from their own images and sell them in the Shop.
 */

export interface BuiltinSticker {
  id: string
  emoji: string
  text: string
}

export interface BuiltinStickerPack {
  id: string
  name: string
  description: string
  /** 0 = everyone has it. */
  price: number
  colors: [string, string]
  stickers: BuiltinSticker[]
}

const s = (id: string, emoji: string, text: string): BuiltinSticker => ({ id, emoji, text })

export const STICKER_PACKS: BuiltinStickerPack[] = [
  {
    id: 'basics',
    name: 'Wicky Basics',
    description: 'Free for everyone',
    price: 0,
    colors: ['#8052ff', '#15846e'],
    stickers: [
      s('hi', '👋', 'HI!'),
      s('lol', '😂', 'LOL'),
      s('gg', '🏆', 'GG'),
      s('ty', '🙏', 'THANK YOU'),
      s('ok', '👌', 'OK!'),
      s('wow', '🤩', 'WOW'),
      s('sad', '🥲', 'NOOO'),
      s('bye', '✌️', 'BYE'),
    ],
  },
  {
    id: 'study',
    name: 'Study Grind',
    description: 'For homework at 11:59pm',
    price: 80,
    colors: ['#3b8fc9', '#1b2a4a'],
    stickers: [
      s('grind', '📚', 'GRINDING'),
      s('due', '⏰', 'DUE TONIGHT??'),
      s('brain', '🧠', 'BIG BRAIN'),
      s('dead', '💀', 'I AM DEAD'),
      s('coffee', '☕', 'NEED COFFEE'),
      s('aplus', '💯', 'A+'),
      s('help', '🆘', 'HELP'),
      s('done', '✅', 'DONE!'),
    ],
  },
  {
    id: 'hype',
    name: 'Hype Squad',
    description: 'Maximum energy',
    price: 120,
    colors: ['#ff4d6d', '#ffb829'],
    stickers: [
      s('fire', '🔥', 'FIRE'),
      s('goat', '🐐', 'GOAT'),
      s('letsgo', '🚀', "LET'S GO"),
      s('clap', '👏', 'CLAP CLAP'),
      s('crown', '👑', 'KING'),
      s('bet', '🤝', 'BET'),
      s('sus', '🤨', 'SUS'),
      s('cap', '🧢', 'NO CAP'),
    ],
  },
]

export const stickerPackById = (id: string) => STICKER_PACKS.find((p) => p.id === id)

export const STICKER_PACK = { minStickers: 3, maxStickers: 12, price: { min: 10, max: 2000 } }

/** One sticker, built-in or student-made. */
export interface Sticker {
  /** `b:<pack>:<sticker>` or `u:<sticker uuid>`. */
  key: string
  name: string
  emoji?: string
  text?: string
  url?: string
}

export interface StickerPack {
  /** `b:<pack id>` or the student pack's uuid. */
  key: string
  name: string
  description: string
  price: number
  colors?: [string, string]
  stickers: Sticker[]
  creator?: { id: string; name: string; displayName: string | null }
  status: 'pending' | 'approved' | 'rejected'
  reviewNote?: string | null
  sales?: number
  owned: boolean
}

export function builtinSticker(key: string): Sticker | null {
  const m = /^b:([a-z0-9-]+):([a-z0-9-]+)$/.exec(key)
  if (!m) return null
  const st = stickerPackById(m[1]!)?.stickers.find((x) => x.id === m[2])
  return st ? { key, name: st.text, emoji: st.emoji, text: st.text } : null
}

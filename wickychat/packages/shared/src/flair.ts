import { z } from 'zod'

export type FlairKind =
  | 'name_effect'
  | 'message_effect'
  | 'typing'
  | 'reaction_skin'
  | 'mention_style'
  | 'sound_pack'

export type SpecKind = FlairKind | 'bubble'

export const FLAIR_KINDS: FlairKind[] = [
  'name_effect',
  'message_effect',
  'typing',
  'reaction_skin',
  'mention_style',
  'sound_pack',
]

export const FLAIR_LABEL: Record<SpecKind, { one: string; many: string; emoji: string }> = {
  bubble: { one: 'Chat bubble', many: 'Chat bubbles', emoji: '💬' },
  name_effect: { one: 'Name effect', many: 'Name effects', emoji: '🌈' },
  message_effect: { one: 'Message effect', many: 'Message effects', emoji: '🎉' },
  typing: { one: 'Typing indicator', many: 'Typing indicators', emoji: '✏️' },
  reaction_skin: { one: 'Reaction skin', many: 'Reaction skins', emoji: '👍' },
  mention_style: { one: 'Mention style', many: 'Mention styles', emoji: '@' },
  sound_pack: { one: 'Sound pack', many: 'Sound packs', emoji: '🔔' },
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const glyph = z
  .string()
  .min(1)
  .max(8)
  .regex(/^[^<>"'`\\{}();:]+$/)

export const NAME_ANIMS = [
  'none',
  'shimmer',
  'rainbow',
  'pulse',
  'glow',
  'wave',
  'glitch',
  'fire',
] as const
export const MESSAGE_MOTIONS = [
  'burst',
  'rain',
  'float',
  'confetti',
  'shake',
  'pop',
  'glow',
] as const
export const TYPING_ANIMS = ['bounce', 'wave', 'pulse', 'spin', 'blink'] as const
export const SYNTHS = [
  'retro',
  'chime',
  'pop',
  'drop',
  'kalimba',
  'typewriter',
  'bell',
  'arcade',
] as const

export const SPEC_SCHEMAS = {
  name_effect: z.object({
    colors: z.array(hex).min(1).max(4),
    anim: z.enum(NAME_ANIMS),
    speed: z.number().min(0.5).max(3).default(1),
  }),
  message_effect: z.object({
    motion: z.enum(MESSAGE_MOTIONS),
    particles: z.array(glyph).max(4).default([]),
    color: hex.optional(),
  }),
  typing: z.object({
    glyphs: z.array(glyph).min(1).max(3),
    anim: z.enum(TYPING_ANIMS),
    color: hex.optional(),
  }),
  reaction_skin: z.object({
    bg: z.array(hex).min(1).max(2),
    border: hex,
    text: hex,
    shape: z.enum(['pill', 'square', 'pixel']),
    glow: z.boolean().default(false),
  }),
  mention_style: z.object({
    bg: z.array(hex).min(1).max(2),
    text: hex,
    shape: z.enum(['pill', 'box', 'underline']),
    glow: z.boolean().default(false),
  }),
  bubble: z.object({
    bg: z.array(hex).min(1).max(3),
    text: hex,
    border: hex.nullable().default(null),
    borderStyle: z.enum(['solid', 'dashed', 'dotted', 'none']).default('none'),
    shape: z.enum(['round', 'soft', 'square']).default('round'),
    pattern: z.enum(['none', 'dots', 'stripes', 'grid', 'stars']).default('none'),
    anim: z.enum(['none', 'shimmer', 'glow', 'gradient']).default('none'),
  }),
  sound_pack: z.union([
    z.object({ synth: z.enum(SYNTHS) }),
    z.object({ notify: z.uuid(), send: z.uuid().nullable().default(null) }),
  ]),
}

export type NameEffectSpec = z.infer<typeof SPEC_SCHEMAS.name_effect>
export type MessageEffectSpec = z.infer<typeof SPEC_SCHEMAS.message_effect>
export type TypingSpec = z.infer<typeof SPEC_SCHEMAS.typing>
export type ReactionSkinSpec = z.infer<typeof SPEC_SCHEMAS.reaction_skin>
export type MentionStyleSpec = z.infer<typeof SPEC_SCHEMAS.mention_style>
export type BubbleSpec = z.infer<typeof SPEC_SCHEMAS.bubble>
export type SoundPackSpec = z.infer<typeof SPEC_SCHEMAS.sound_pack>
export type SpecOf<K extends SpecKind> = z.infer<(typeof SPEC_SCHEMAS)[K]>

export function parseSpec<K extends SpecKind>(kind: K, raw: unknown): SpecOf<K> | null {
  const r = SPEC_SCHEMAS[kind].safeParse(raw)
  return r.success ? (r.data as SpecOf<K>) : null
}

export const SPEC_KINDS: SpecKind[] = ['bubble', ...FLAIR_KINDS]
export const isSpecKind = (k: string): k is SpecKind => (SPEC_KINDS as string[]).includes(k)

export const specValue = (c: { id: string; spec?: unknown }) =>
  `u:${c.id}|s:${encodeURIComponent(JSON.stringify(c.spec))}`

export function specFromValue<K extends SpecKind>(
  kind: K,
  value: string | null | undefined,
): SpecOf<K> | null {
  if (!value) return null
  const builtin = flairById(value)
  if (builtin) return builtin.kind === kind ? (builtin.spec as SpecOf<K>) : null
  const m = /^u:[0-9a-f-]{36}\|s:(.+)$/.exec(value)
  if (!m) return null
  try {
    return parseSpec(kind, JSON.parse(decodeURIComponent(m[1]!)))
  } catch {
    return null
  }
}

export interface FlairItem {
  id: string
  kind: FlairKind
  name: string
  description: string
  price: number
  event?: string
  spec: unknown
}

const ne = (
  id: string,
  name: string,
  description: string,
  price: number,
  colors: string[],
  anim: NameEffectSpec['anim'],
  event?: string,
): FlairItem => ({
  id,
  kind: 'name_effect',
  name,
  description,
  price,
  event,
  spec: { colors, anim, speed: 1 },
})

const mf = (
  id: string,
  name: string,
  description: string,
  price: number,
  motion: MessageEffectSpec['motion'],
  particles: string[],
  color?: string,
  event?: string,
): FlairItem => ({
  id,
  kind: 'message_effect',
  name,
  description,
  price,
  event,
  spec: { motion, particles, ...(color && { color }) },
})

const ty = (
  id: string,
  name: string,
  description: string,
  price: number,
  glyphs: string[],
  anim: TypingSpec['anim'],
  color?: string,
): FlairItem => ({
  id,
  kind: 'typing',
  name,
  description,
  price,
  spec: { glyphs, anim, ...(color && { color }) },
})

const rs = (
  id: string,
  name: string,
  description: string,
  price: number,
  bg: string[],
  border: string,
  text: string,
  shape: ReactionSkinSpec['shape'],
  glow = false,
): FlairItem => ({
  id,
  kind: 'reaction_skin',
  name,
  description,
  price,
  spec: { bg, border, text, shape, glow },
})

const ms = (
  id: string,
  name: string,
  description: string,
  price: number,
  bg: string[],
  text: string,
  shape: MentionStyleSpec['shape'],
  glow = false,
): FlairItem => ({
  id,
  kind: 'mention_style',
  name,
  description,
  price,
  spec: { bg, text, shape, glow },
})

const sp = (
  id: string,
  name: string,
  description: string,
  price: number,
  synth: (typeof SYNTHS)[number],
): FlairItem => ({ id, kind: 'sound_pack', name, description, price, spec: { synth } })

export const FLAIR: FlairItem[] = [
  ne(
    'ne-shimmer',
    'Silver Shimmer',
    'A shine that slides across your name',
    120,
    ['#9aa3b5', '#ffffff'],
    'shimmer',
  ),
  ne('ne-gold', 'Gold Shine', 'Shiny gold letters', 220, ['#b8860b', '#ffe27a'], 'shimmer'),
  ne(
    'ne-rainbow',
    'Rainbow',
    'Every colour, always moving',
    300,
    ['#ff4d4d', '#4dc9ff'],
    'rainbow',
  ),
  ne('ne-fire', 'On Fire', 'Flickering flames', 260, ['#ff3d00', '#ffb300'], 'fire'),
  ne('ne-ice', 'Ice', 'Cold blue glow', 160, ['#5bc8ff', '#e8fbff'], 'glow'),
  ne('ne-neon', 'Neon Pink', 'Glowing like a sign', 180, ['#ff3ccf'], 'glow'),
  ne('ne-ocean', 'Ocean Wave', 'Blues that roll', 170, ['#00b4d8', '#0077b6', '#90e0ef'], 'wave'),
  ne('ne-glitch', 'Glitch', 'Cyan and magenta that jitter', 240, ['#00e5ff', '#ff00c8'], 'glitch'),
  ne('ne-heartbeat', 'Heartbeat', 'Red that pulses', 140, ['#ff4d6d'], 'pulse'),
  ne('ne-toxic', 'Toxic', 'Radioactive green', 150, ['#7ddc00', '#38ff9c'], 'glow'),
  ne(
    'ne-spooky',
    'Spooky',
    'Orange and purple waves',
    170,
    ['#ff7a00', '#8b5cf6'],
    'wave',
    'halloween',
  ),

  mf('mf-confetti', 'Confetti Pop', 'Party poppers when your message lands', 160, 'burst', [
    '🎉',
    '🎊',
    '✨',
  ]),
  mf('mf-sparkle', 'Sparkles', 'A little burst of sparkles', 120, 'burst', ['✨', '⭐']),
  mf('mf-hearts', 'Floating Hearts', 'Hearts drift up', 140, 'float', ['💖', '💕', '💗']),
  mf('mf-fire', 'Hot Take', 'Flames rise off your message', 150, 'float', ['🔥']),
  mf('mf-snow', 'Snowfall', 'Snow falls over it', 130, 'rain', ['❄️']),
  mf('mf-money', 'Make It Rain', 'Coins and cash fall down', 200, 'rain', ['💸', '🪙']),
  mf('mf-stars', 'Shooting Stars', 'Stars burst out', 170, 'burst', ['🌟', '💫']),
  mf('mf-rocket', 'Lift Off', 'Rockets blast up', 190, 'float', ['🚀', '☁️']),
  mf('mf-party', 'Paper Confetti', 'Coloured paper everywhere', 220, 'confetti', []),
  mf('mf-shake', 'Shake', 'Your message wobbles in', 110, 'shake', []),
  mf('mf-pop', 'Pop In', 'Your message bounces in', 100, 'pop', []),
  mf('mf-glow', 'Glow Up', 'A purple glow flashes', 130, 'glow', [], '#8052ff'),
  mf(
    'mf-pumpkin',
    'Boo!',
    'Pumpkins and ghosts float up',
    160,
    'float',
    ['🎃', '👻'],
    undefined,
    'halloween',
  ),

  ty(
    'ty-dots',
    'Purple Dots',
    'The classic dots, in purple',
    60,
    ['●', '●', '●'],
    'bounce',
    '#8052ff',
  ),
  ty('ty-pencil', 'Pencil', 'A pencil scribbling', 110, ['✏️'], 'wave'),
  ty('ty-cat', 'Paw Prints', 'Little paws walking', 130, ['🐾', '🐾', '🐾'], 'wave'),
  ty('ty-hearts', 'Heart Beats', 'Three hearts that pulse', 120, ['💗', '💗', '💗'], 'pulse'),
  ty('ty-think', 'Thinking', 'Hmm...', 100, ['🤔'], 'pulse'),
  ty('ty-keys', 'Keyboard Smash', 'Bouncing keyboard', 110, ['⌨️'], 'bounce'),
  ty('ty-stars', 'Twinkle', 'Stars that blink', 140, ['⭐', '✨', '⭐'], 'blink'),
  ty('ty-snail', 'Slow Typer', 'A snail inching along', 90, ['🐌'], 'wave'),
  ty('ty-music', 'Humming', 'Music notes bouncing', 130, ['🎵', '🎶', '🎵'], 'wave'),
  ty('ty-loading', 'Loading', 'A spinning loader', 100, ['⏳'], 'spin'),
  ty('ty-fire', 'Fired Up', 'Three flames', 150, ['🔥', '🔥', '🔥'], 'bounce'),

  rs(
    'rs-gold',
    'Gold',
    'Reactions on your messages turn gold',
    220,
    ['#ffe27a', '#d4a017'],
    '#b8860b',
    '#3d2a00',
    'pill',
    true,
  ),
  rs(
    'rs-pixel',
    'Pixel',
    'Chunky 8 bit reaction boxes',
    140,
    ['#ffffff'],
    '#222222',
    '#111111',
    'pixel',
  ),
  rs(
    'rs-candy',
    'Candy',
    'Pink and blue',
    120,
    ['#ffb3d9', '#b3e5ff'],
    '#ff7ab8',
    '#4a0a2c',
    'pill',
  ),
  rs('rs-neon', 'Neon', 'Glowing pink', 180, ['#160616'], '#ff3ccf', '#ffe3f8', 'pill', true),
  rs('rs-mint', 'Mint', 'Fresh green', 100, ['#c9f5e1'], '#3ccf91', '#12402c', 'pill'),
  rs(
    'rs-midnight',
    'Midnight',
    'Deep purple with a glow',
    160,
    ['#1a1f3c', '#3a2f6b'],
    '#6c63ff',
    '#e8e6ff',
    'pill',
    true,
  ),
  rs(
    'rs-sunset',
    'Sunset',
    'Orange into pink',
    150,
    ['#ff9a3c', '#ff5e7e'],
    '#e04b6b',
    '#ffffff',
    'pill',
  ),
  rs(
    'rs-chalk',
    'Chalkboard',
    'Green board, wood frame',
    130,
    ['#2f4a3a'],
    '#8b5a2b',
    '#f1f6ef',
    'square',
  ),

  ms(
    'ms-highlighter',
    'Highlighter',
    'Your @mentions look highlighted',
    90,
    ['#fff275'],
    '#3d3400',
    'box',
  ),
  ms('ms-candy', 'Candy', 'Pink to blue', 120, ['#ffb3d9', '#b3e5ff'], '#4a0a2c', 'pill'),
  ms('ms-neon', 'Neon', 'Glowing pink tag', 170, ['#160616'], '#ff6be0', 'pill', true),
  ms('ms-gold', 'Gold', 'Shiny gold tag', 220, ['#ffe27a', '#d4a017'], '#3d2a00', 'pill', true),
  ms('ms-ocean', 'Ocean', 'Cool blues', 140, ['#48cae4', '#0077b6'], '#ffffff', 'pill'),
  ms(
    'ms-underline',
    'Underline',
    'A clean purple underline',
    80,
    ['#8052ff'],
    '#8052ff',
    'underline',
  ),
  ms('ms-terminal', 'Terminal', 'Green on black', 130, ['#0b0f0b'], '#3dff7a', 'box'),
  ms(
    'ms-fire',
    'Fire',
    'Red and orange with heat',
    180,
    ['#ff3d00', '#ffb300'],
    '#ffffff',
    'pill',
    true,
  ),

  sp('sp-retro', 'Retro 8 Bit', 'Beeps like an old game console', 150, 'retro'),
  sp('sp-chime', 'Soft Chimes', 'Gentle and calm', 120, 'chime'),
  sp('sp-pop', 'Bubble Pop', 'Little pops', 100, 'pop'),
  sp('sp-drop', 'Water Drop', 'Plink', 110, 'drop'),
  sp('sp-kalimba', 'Kalimba', 'Warm plucked notes', 160, 'kalimba'),
  sp('sp-typewriter', 'Typewriter', 'Clack and ding', 130, 'typewriter'),
  sp('sp-bell', 'Desk Bell', 'Ding!', 120, 'bell'),
  sp('sp-arcade', 'Arcade Coin', 'Coin collect sound', 180, 'arcade'),
]

export const FLAIR_IDS = FLAIR.map((f) => f.id)
export const flairById = (id: string | null | undefined) => FLAIR.find((f) => f.id === id)

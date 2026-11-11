/**
 * WickyChat bundles: several items sold together, usually cheaper than buying each one.
 * Built-in bundles are below; students make their own from their cosmetics and Shop items.
 */
import { isEventLive } from './seasons'
import { decorationById, effectById, plateById, themeById } from './wicky'

/** A built-in Shop item's price and event (if it's seasonal). */
export function builtinItem(id: string): { price: number; event?: string } | undefined {
  const d = decorationById(id)
  if (d) return { price: d.price }
  const x = effectById(id) ?? plateById(id) ?? themeById(id)
  return x ? { price: x.price, event: x.event } : undefined
}

/** Built-in items that can go in student crates and bundles right now (seasonal only while on). */
export function sellableBuiltin(id: string, now = new Date()) {
  const b = builtinItem(id)
  return !!b && (!b.event || isEventLive(b.event, now))
}

/**
 * Students earn from their own work, not from reselling Shop items. So a student crate must cost
 * at least its priciest Shop item, a bundle at least what its Shop items cost together, and the
 * maker only earns their share of the price above that.
 */
export const crateFloor = (items: string[]) =>
  Math.max(0, ...items.map((i) => builtinItem(i)?.price ?? 0))
export const bundleFloor = (items: string[]) =>
  items.reduce((n, i) => n + (builtinItem(i)?.price ?? 0), 0)

export interface BundleDef {
  id: string
  name: string
  emoji: string
  description: string
  price: number
  colors: [string, string]
  items: string[]
  /** Seasonal bundles are only sold while their event is on. */
  event?: string
  creator?: { id: string; name: string; displayName: string | null }
  removed?: boolean
}

const sum = (items: string[]) => items.reduce((n, i) => n + (builtinItem(i)?.price ?? 0), 0)
/** Built-in bundles are 20% off. */
const deal = (items: string[]) => Math.round((sum(items) * 0.8) / 10) * 10

const b = (
  id: string,
  name: string,
  emoji: string,
  description: string,
  colors: [string, string],
  items: string[],
  event?: string,
): BundleDef => ({ id, name, emoji, description, colors, items, price: deal(items), event })

export const BUNDLES: BundleDef[] = [
  b(
    'b-emo',
    'Emo Kit',
    '🖤',
    'Emo Rain, a dark theme and a galaxy name plate.',
    ['#1a1a1f', '#c1121f'],
    ['e-emorain', 't-dracula', 'p-galaxy', 'ghost'],
  ),
  b(
    'b-cozy',
    'Cozy Pastel',
    '🌸',
    'Soft colours all over.',
    ['#ffafcc', '#a2d2ff'],
    ['p-candy', 'e-sakura', 't-latte', 'sakura'],
  ),
  b(
    'b-space',
    'Space Cadet',
    '🚀',
    'Rockets, stars and deep space.',
    ['#1a0b3d', '#2c73d2'],
    ['rocket', 'e-stars', 'p-galaxy', 't-tokyo'],
  ),
  b(
    'b-hacker',
    'Hacker',
    '💻',
    'Green on black, for the coders.',
    ['#001a00', '#00a83a'],
    ['p-matrix', 'robot', 't-gruvbox'],
  ),
  b(
    'b-harvest',
    'Harvest Bundle',
    '🍁',
    'Everything from Autumn Harvest.',
    ['#c2410c', '#eab308'],
    ['e-leaves', 'p-harvest', 't-maple', 'clover'],
    'harvest',
  ),
  b(
    'b-spooky',
    'Spooky Bundle',
    '🎃',
    'Everything from Halloween.',
    ['#ff7a00', '#6d28d9'],
    ['pumpkin', 'ghost', 'e-bats', 'p-pumpkin', 't-spooky'],
    'halloween',
  ),
  b(
    'b-winter',
    'Winter Bundle',
    '⛄',
    'Everything from Winter Wonderland.',
    ['#38bdf8', '#e0f2fe'],
    ['snow', 'e-winter', 'p-frost', 't-frost'],
    'winter',
  ),
]

export const bundleById = (id: string | null | undefined) => BUNDLES.find((x) => x.id === id)

export const CUSTOM_BUNDLE = {
  minItems: 2,
  maxItems: 12,
  price: { min: 20, max: 20_000 },
  maxActive: 10,
} as const

export interface CustomBundle {
  id: string
  /** `u:<id>` */
  bundleId: string
  name: string
  emoji: string
  description: string
  colors: [string, string]
  price: number
  items: string[]
  creator: { id: string; name: string; displayName: string | null }
  status: 'active' | 'removed'
  sales: number
  createdAt: string
}

export const customBundleDef = (c: CustomBundle): BundleDef => ({
  id: c.bundleId,
  name: c.name,
  emoji: c.emoji,
  description: c.description,
  price: c.price,
  colors: c.colors,
  items: c.items,
  creator: c.creator,
  removed: c.status === 'removed',
})

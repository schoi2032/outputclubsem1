/**
 * WickyChat: the trade-up contract. Put in 5 items of the same tier and get 1 random item of
 * the next tier up that you don't own yet. It can even give seasonal items whose event is over.
 */
import type { CrateTier } from './crates'

export const TRADE_UP = { inputs: 5 }

const ORDER: CrateTier[] = ['common', 'rare', 'epic', 'legendary']

/** Every item's tier comes from its price, so student-made items have one too. */
export function tierOfPrice(price: number): CrateTier {
  if (price >= 500) return 'legendary'
  if (price >= 250) return 'epic'
  if (price >= 150) return 'rare'
  return 'common'
}

export const nextTier = (t: CrateTier): CrateTier | null => ORDER[ORDER.indexOf(t) + 1] ?? null

export interface TradeUpResult {
  item: string
  tier: CrateTier
  /** Everything it could have given, for the reel. */
  pool: string[]
}

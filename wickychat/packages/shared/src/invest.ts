/**
 * WickyChat Stock Market. Shop items (and student items whose maker turned it on) have a
 * price that goes up 4% of the base for every copy people hold and comes back down when they
 * sell. Selling back pays 10% less than the last buy, so buying and selling straight away
 * always loses a little: you only make coins when other people buy after you.
 *
 * You can also back a person: buy shares in them, and whenever they earn coins, their
 * shareholders get a bonus on top (paid by the school, not taken from them).
 */
export const INVEST = {
  /** Price rises by this share of the base price per copy held. */
  step: 0.04,
  /** Selling back pays this much less. */
  fee: 0.1,
  /** Makers of student items on the market get this share of each buy. */
  creatorCut: 0.05,
  /** A share in a person starts at this many coins. */
  personBase: 20,
  /** Most shares you can hold in one person. */
  maxShares: 50,
  /** When someone earns coins, their shareholders split this much extra. */
  dividend: 0.1,
  /** Most bonus coins one shareholder can get in a day. */
  dividendDailyMax: 200,
  /** Most you can buy or sell in one go. */
  maxQty: 10,
}

/** What the next copy costs when `supply` are already held. */
export const buyPrice = (base: number, supply: number) =>
  Math.max(1, Math.round(base * (1 + INVEST.step * supply)))

/**
 * What selling one back pays. You can only sell back while people hold copies bought here
 * (supply > 0). For items with a maker, the base price went to them, so selling back only
 * pays back how much the price has gone up.
 */
export function sellPrice(base: number, supply: number, made = false) {
  if (supply <= 0) return 0
  const last = buyPrice(base, supply - 1)
  return Math.max(0, Math.floor((made ? last - base : last) * (1 - INVEST.fee)))
}

/** Total cost of buying `qty` in a row, and what selling `qty` in a row pays. */
export function buyTotal(base: number, supply: number, qty: number) {
  let n = 0
  for (let i = 0; i < qty; i++) n += buyPrice(base, supply + i)
  return n
}
export function sellTotal(base: number, supply: number, qty: number, made = false) {
  let n = 0
  for (let i = 0; i < qty; i++) n += sellPrice(base, supply - i, made)
  return n
}

export const personKey = (userId: string) => `p:${userId}`

export interface MarketQuote {
  /** Item id, or `p:<user id>` for a person. */
  key: string
  base: number
  supply: number
  price: number
  sell: number
  /** Price change over the last 24 hours, in per cent. */
  change: number
  /** Recent prices, oldest first, for a little chart. */
  spark: number[]
  /** Has a maker: selling back only pays the rise above the base price. */
  made: boolean
}

export interface PersonQuote extends MarketQuote {
  user: import('./types').UserSummary
  /** How many people hold shares. */
  holders: number
  /** Coins they earned in the last 7 days. */
  earned7d: number
}

export interface Portfolio {
  /** Copies of items you hold (the one you can wear counts as 1 when you have it). */
  items: Record<string, number>
  /** Shares in people. */
  people: Record<string, number>
  /** Bonus coins from people you back, all time. */
  dividends: number
}

/**
 * WickyChat: Wicky Coins. The balance lives on `users.coins`; every change is also written to
 * `coin_transactions` so people can see their history.
 */
import { coinTransactions, cosmetics, personShares, users } from '@quid/db'
import {
  COINS,
  type CoinTransaction,
  cosmeticDecoration,
  customImageValue,
  INVEST,
  type Me,
  specValue,
  themeById,
  themeCss,
} from '@quid/shared'
import { and, eq, gt, gte, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { AppContext } from '../../core/context'

type Db = AppContext['db']
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Midnight in Korea (the school's day), as a Date. */
export function startOfSchoolDay(now = new Date()): Date {
  const kst = new Date(now.getTime() + 9 * 3_600_000)
  return new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3_600_000,
  )
}

/**
 * Adds (or takes away) coins and records why. The balance never goes below zero; the ledger
 * records what actually changed. Returns the new balance.
 */
export async function changeCoins(
  db: Db | Tx,
  userId: string,
  amount: number,
  reason: CoinTransaction['reason'],
  ref: string | null = null,
): Promise<number> {
  const [before] = await db
    .select({ coins: users.coins })
    .from(users)
    .where(eq(users.id, userId))
    .for('update')
  if (!before) return 0
  const next = Math.max(0, before.coins + amount)
  const delta = next - before.coins
  if (delta === 0) return next
  await db.update(users).set({ coins: next }).where(eq(users.id, userId))
  await db.insert(coinTransactions).values({ id: uuidv7(), userId, amount: delta, reason, ref })
  if (delta > 0 && EARNINGS.has(reason)) await payDividends(db, userId, delta)
  return next
}

/**
 * Coins someone earned themselves (not gifts, trades or sales of things they bought). Their
 * shareholders get a bonus on these.
 */
const EARNINGS = new Set<CoinTransaction['reason']>([
  'daily',
  'message',
  'poll',
  'quiz',
  'sale',
  'crate_sale',
  'bundle_sale',
  'achievement',
  'quest',
  'commission_pay',
  'spin',
  'liked',
  'trivia',
  'bounty_win',
])

/** Rounds randomly so small amounts still pay out fairly on average. */
const roundFair = (x: number) => Math.floor(x) + (Math.random() < x - Math.floor(x) ? 1 : 0)

/**
 * When someone earns coins, the people holding shares in them split INVEST.dividend of it
 * extra (new coins, nothing is taken from the earner), up to a daily cap each.
 */
async function payDividends(db: Db | Tx, earnerId: string, earned: number) {
  const holders = await db
    .select({ holderId: personShares.holderId, qty: personShares.qty })
    .from(personShares)
    .where(and(eq(personShares.targetId, earnerId), gt(personShares.qty, 0)))
  if (!holders.length) return
  const total = holders.reduce((n, h) => n + h.qty, 0)
  const pool = earned * INVEST.dividend
  for (const h of holders) {
    let n = roundFair((pool * h.qty) / total)
    if (n <= 0) continue
    const [today] = await db
      .select({ n: sql<number>`coalesce(sum(${coinTransactions.amount}), 0)::int` })
      .from(coinTransactions)
      .where(
        and(
          eq(coinTransactions.userId, h.holderId),
          eq(coinTransactions.reason, 'dividend'),
          gte(coinTransactions.createdAt, startOfSchoolDay()),
        ),
      )
    n = Math.min(n, INVEST.dividendDailyMax - Number(today?.n ?? 0))
    if (n > 0) await changeCoins(db, h.holderId, n, 'dividend', earnerId)
  }
}

/** Coins earned from messages since the start of today. */
export async function earnedFromMessagesToday(db: Db | Tx, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${coinTransactions.amount}), 0)::int` })
    .from(coinTransactions)
    .where(
      and(
        eq(coinTransactions.userId, userId),
        eq(coinTransactions.reason, 'message'),
        gte(coinTransactions.createdAt, startOfSchoolDay()),
      ),
    )
  return Number(row?.n ?? 0)
}

/**
 * Called after someone posts. Clean messages earn a couple of coins (capped per day);
 * a message the swear filter caught earns nothing and costs a few. Never blocks posting.
 */
export async function coinsForMessage(ctx: AppContext, userId: string, swore: boolean) {
  try {
    await ctx.db.transaction(async (tx) => {
      if (swore) {
        await changeCoins(tx, userId, -COINS.swearPenalty, 'swear')
        return
      }
      const earned = await earnedFromMessagesToday(tx, userId)
      const amount = Math.min(COINS.perMessage, COINS.messageDailyCap - earned)
      if (amount > 0) await changeCoins(tx, userId, amount, 'message')
    })
  } catch (err) {
    ctx.log.warn({ err }, 'could not update coins for message')
  }
}

/** Turns an equipped theme id into the CSS the app loads. */
export async function resolveTheme(db: Db, id: string | null): Promise<Me['appTheme']> {
  if (!id) return null
  const builtin = themeById(id)
  if (builtin) return { id, name: builtin.name, css: themeCss(builtin), dark: builtin.dark }
  const m = /^u:([0-9a-f-]{36})$/.exec(id)
  if (!m) return null
  const c = await db.query.cosmetics.findFirst({
    where: eq(cosmetics.id, m[1]!),
    columns: { name: true, css: true, kind: true, status: true },
  })
  if (c?.kind !== 'theme' || !c.css || c.status === 'rejected') return null
  // A theme that says `color-scheme: dark` switches the app to dark mode too.
  return {
    id,
    name: c.name,
    css: c.css,
    dark: /color-scheme\s*:\s*dark/i.test(c.css) ? true : null,
  }
}

/** The daily streak that still counts: it breaks if yesterday was missed. */
export function currentStreak(lastClaim: Date | null, streak: number) {
  if (!lastClaim) return 0
  const yesterday = new Date(startOfSchoolDay().getTime() - 86_400_000)
  return lastClaim >= yesterday ? streak : 0
}

/** Takes an item off someone if they're wearing or using it (after it's sold or traded). */
export async function takeOffItem(db: Db | Tx, userId: string, itemId: string) {
  const u = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      decoration: true,
      appTheme: true,
      profileEffect: true,
      namePlate: true,
      chatBubble: true,
      nameEffect: true,
      messageEffect: true,
      typingStyle: true,
      reactionSkin: true,
      mentionStyle: true,
      soundPack: true,
    },
  })
  if (!u) return
  const m = /^u:([0-9a-f-]{36})$/.exec(itemId)
  const c = m ? await db.query.cosmetics.findFirst({ where: eq(cosmetics.id, m[1]!) }) : null
  const values = new Set([
    itemId,
    ...(c ? [cosmeticDecoration(c), customImageValue(c), ...(c.spec ? [specValue(c)] : [])] : []),
  ])
  const off: Partial<typeof users.$inferInsert> = {}
  if (u.decoration && values.has(u.decoration)) off.decoration = null
  if (u.appTheme && values.has(u.appTheme)) off.appTheme = null
  if (u.profileEffect && values.has(u.profileEffect)) off.profileEffect = null
  if (u.namePlate && values.has(u.namePlate)) off.namePlate = null
  if (u.chatBubble && values.has(u.chatBubble)) off.chatBubble = null
  for (const col of [
    'nameEffect',
    'messageEffect',
    'typingStyle',
    'reactionSkin',
    'mentionStyle',
    'soundPack',
  ] as const) {
    const v = u[col]
    if (v && values.has(v)) off[col] = null
  }
  if (Object.keys(off).length) await db.update(users).set(off).where(eq(users.id, userId))
}

/** Private student-made items can't be sold, traded or passed on. */
export async function isPrivateItem(db: Db | Tx, itemId: string) {
  const m = /^u:([0-9a-f-]{36})$/.exec(itemId)
  if (!m) return false
  const c = await db.query.cosmetics.findFirst({
    where: eq(cosmetics.id, m[1]!),
    columns: { visibility: true },
  })
  return c?.visibility === 'private'
}

/**
 * WickyChat: Wicky Coins. The balance lives on `users.coins`; every change is also written to
 * `coin_transactions` so people can see their history.
 */
import { coinTransactions, cosmetics, users } from '@quid/db'
import { COINS, type CoinTransaction, type Me, themeById, themeCss } from '@quid/shared'
import { and, eq, gte, sql } from 'drizzle-orm'
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
  return next
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
  return { id, name: c.name, css: c.css, dark: null }
}

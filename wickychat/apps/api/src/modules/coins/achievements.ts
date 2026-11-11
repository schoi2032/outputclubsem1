/**
 * WickyChat: achievements. Progress is counted from what you've already done (messages,
 * crates, trades...), and each one pays its coin reward once when you claim it.
 */
import {
  achievementClaims,
  coinTransactions,
  cosmetics,
  messages,
  polls,
  pollVotes,
  trades,
  userCrates,
  userItems,
  users,
} from '@quid/db'
import {
  ACHIEVEMENTS,
  type AchievementProgress,
  type AchievementStat,
  achievementById,
} from '@quid/shared'
import { and, count, eq, inArray, isNotNull, isNull, or, sql, sum } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, notFound } from '../../core/errors'
import type { App } from '../../core/http'
import { loadWallet } from './routes'
import { changeCoins } from './service'

type Stats = Record<AchievementStat, number>
const num = (rows: { n: unknown }[]) => Number(rows[0]?.n ?? 0)

export async function achievementStats(ctx: AppContext, userId: string): Promise<Stats> {
  const db = ctx.db
  const [u, msgs, crates, trd, gifts, items, sold, quiz, serial, sent, ups] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId), columns: { bestStreak: true } }),
    db
      .select({ n: count() })
      .from(messages)
      .where(and(eq(messages.authorId, userId), isNull(messages.deletedAt))),
    db
      .select({ n: count() })
      .from(userCrates)
      .where(and(eq(userCrates.userId, userId), isNotNull(userCrates.openedAt))),
    db
      .select({ n: count() })
      .from(trades)
      .where(
        and(eq(trades.status, 'accepted'), or(eq(trades.fromId, userId), eq(trades.toId, userId))),
      ),
    db
      .select({ n: count() })
      .from(coinTransactions)
      .where(
        and(
          eq(coinTransactions.userId, userId),
          inArray(coinTransactions.reason, ['gift_item', 'crate_gift', 'bundle_gift']),
        ),
      ),
    db.select({ n: count() }).from(userItems).where(eq(userItems.userId, userId)),
    db
      .select({ n: sum(cosmetics.sales) })
      .from(cosmetics)
      .where(and(eq(cosmetics.creatorId, userId), eq(cosmetics.status, 'approved'))),
    db
      .select({ n: count() })
      .from(pollVotes)
      .innerJoin(polls, eq(polls.id, pollVotes.pollId))
      .where(
        and(
          eq(pollVotes.userId, userId),
          eq(polls.kind, 'quiz'),
          eq(pollVotes.optionId, sql`${polls.correctOptionId}`),
        ),
      ),
    db
      .select({ n: count() })
      .from(userItems)
      .where(and(eq(userItems.userId, userId), eq(userItems.serial, 1))),
    db
      .select({ n: sql<number>`coalesce(-sum(${coinTransactions.amount}), 0)::int` })
      .from(coinTransactions)
      .where(and(eq(coinTransactions.userId, userId), eq(coinTransactions.reason, 'coins_sent'))),
    db
      .select({ n: count() })
      .from(coinTransactions)
      .where(and(eq(coinTransactions.userId, userId), eq(coinTransactions.reason, 'trade_up'))),
  ])
  return {
    messages: num(msgs),
    crates: num(crates),
    trades: num(trd),
    gifts: num(gifts),
    items: num(items),
    sold: num(sold),
    streak: u?.bestStreak ?? 0,
    quiz: num(quiz),
    serialOne: num(serial),
    coinsSent: num(sent),
    tradeUps: num(ups),
  }
}

async function progressFor(ctx: AppContext, userId: string): Promise<AchievementProgress[]> {
  const [stats, claims] = await Promise.all([
    achievementStats(ctx, userId),
    ctx.db
      .select({ id: achievementClaims.achievementId })
      .from(achievementClaims)
      .where(eq(achievementClaims.userId, userId)),
  ])
  const claimed = new Set(claims.map((c) => c.id))
  return ACHIEVEMENTS.map((a) => ({
    id: a.id,
    progress: Math.min(stats[a.stat], a.goal),
    done: stats[a.stat] >= a.goal,
    claimed: claimed.has(a.id),
  }))
}

export async function achievementRoutes(app: App, ctx: AppContext) {
  app.get('/api/me/achievements', async (req) => progressFor(ctx, requireUser(req).id))

  app.post(
    '/api/me/achievements/:id/claim',
    { schema: { params: z.object({ id: z.string().max(40) }) } },
    async (req) => {
      const me = requireUser(req)
      const def = achievementById(req.params.id)
      if (!def) throw notFound('Achievement')
      const stats = await achievementStats(ctx, me.id)
      if (stats[def.stat] < def.goal) throw badRequest("You haven't finished this one yet.")
      await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(achievementClaims)
          .values({ userId: me.id, achievementId: def.id })
          .onConflictDoNothing()
          .returning()
        if (!row) throw conflict('Already claimed.')
        await changeCoins(tx, me.id, def.reward, 'achievement', def.id)
      })
      return { achievements: await progressFor(ctx, me.id), wallet: await loadWallet(ctx, me.id) }
    },
  )
}

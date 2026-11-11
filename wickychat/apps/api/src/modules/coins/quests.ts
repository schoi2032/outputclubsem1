/**
 * WickyChat daily quests: 3 small tasks a day, a different mix for everyone, each paying a few
 * coins, plus a bonus for doing all 3. Progress is counted from what you did today.
 */

import { createHash } from 'node:crypto'
import {
  coinTransactions,
  duels,
  messageStickers,
  messages,
  pollVotes,
  questClaims,
  reactions,
  userCrates,
  users,
} from '@quid/db'
import {
  QUEST_BONUS,
  QUESTS,
  QUESTS_PER_DAY,
  type QuestDay,
  type QuestDef,
  type QuestStat,
} from '@quid/shared'
import { and, count, eq, gte, inArray, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, notFound } from '../../core/errors'
import type { App } from '../../core/http'
import { loadWallet } from './routes'
import { changeCoins, startOfSchoolDay } from './service'

const dayKey = (start: Date) => new Date(start.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)

/** Today's 3 quests for this person: random-looking but the same all day. */
export function questsFor(userId: string, day: string): QuestDef[] {
  const scored = QUESTS.map((qd) => ({
    qd,
    score: createHash('sha256').update(`${userId}|${day}|${qd.id}`).digest().readUInt32BE(0),
  })).sort((a, b) => a.score - b.score)
  // No two quests that count the same thing.
  const out: QuestDef[] = []
  for (const { qd } of scored) {
    if (out.some((o) => o.stat === qd.stat)) continue
    out.push(qd)
    if (out.length === QUESTS_PER_DAY) break
  }
  return out
}

async function statToday(
  ctx: AppContext,
  userId: string,
  stat: QuestStat,
  since: Date,
): Promise<number> {
  const db = ctx.db
  const n = (rows: { n: number }[]) => Number(rows[0]?.n ?? 0)
  const tx = (reasons: string[]) =>
    db
      .select({ n: count() })
      .from(coinTransactions)
      .where(
        and(
          eq(coinTransactions.userId, userId),
          inArray(coinTransactions.reason, reasons),
          gte(coinTransactions.createdAt, since),
        ),
      )
  switch (stat) {
    case 'messages':
      return n(
        await db
          .select({ n: count() })
          .from(messages)
          .where(
            and(
              eq(messages.authorId, userId),
              gte(messages.createdAt, since),
              isNull(messages.deletedAt),
            ),
          ),
      )
    case 'reactions':
      return n(
        await db
          .select({ n: count() })
          .from(reactions)
          .where(and(eq(reactions.userId, userId), gte(reactions.createdAt, since))),
      )
    case 'daily': {
      const u = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { dailyClaimedAt: true },
      })
      return u?.dailyClaimedAt && u.dailyClaimedAt >= since ? 1 : 0
    }
    case 'shop':
      return n(
        await tx(['purchase', 'invest_buy', 'crate', 'bundle', 'sticker_pack', 'market_buy']),
      )
    case 'gift':
      return n(await tx(['gift_item', 'crate_gift', 'bundle_gift', 'sticker_gift', 'coins_sent']))
    case 'sticker':
      return n(
        await db
          .select({ n: count() })
          .from(messageStickers)
          .innerJoin(messages, eq(messages.id, messageStickers.messageId))
          .where(and(eq(messages.authorId, userId), gte(messages.createdAt, since))),
      )
    case 'duel':
      return n(
        await db
          .select({ n: count() })
          .from(duels)
          .where(
            and(
              eq(duels.status, 'done'),
              or(eq(duels.challengerId, userId), eq(duels.acceptedBy, userId)),
              gte(duels.createdAt, since),
            ),
          ),
      )
    case 'vote':
      return n(
        await db
          .select({ n: count() })
          .from(pollVotes)
          .where(and(eq(pollVotes.userId, userId), gte(pollVotes.createdAt, since))),
      )
    case 'crate':
      return n(
        await db
          .select({ n: count() })
          .from(userCrates)
          .where(and(eq(userCrates.userId, userId), gte(userCrates.openedAt, since))),
      )
  }
}

async function questDay(ctx: AppContext, userId: string): Promise<QuestDay> {
  const since = startOfSchoolDay()
  const day = dayKey(since)
  const list = questsFor(userId, day)
  const [progress, claims] = await Promise.all([
    Promise.all(list.map((qd) => statToday(ctx, userId, qd.stat, since))),
    ctx.db
      .select({ id: questClaims.questId })
      .from(questClaims)
      .where(and(eq(questClaims.userId, userId), eq(questClaims.day, day))),
  ])
  const claimed = new Set(claims.map((c) => c.id))
  return {
    day,
    quests: list.map((qd, i) => ({
      id: qd.id,
      progress: Math.min(progress[i]!, qd.goal),
      done: progress[i]! >= qd.goal,
      claimed: claimed.has(qd.id),
    })),
    bonusClaimed: claimed.has('bonus'),
    resetsAt: new Date(since.getTime() + 86_400_000).toISOString(),
  }
}

export async function questRoutes(app: App, ctx: AppContext) {
  app.get('/api/me/quests', async (req) => questDay(ctx, requireUser(req).id))

  /** Claims one quest's coins, or `bonus` once all 3 are claimed. */
  app.post(
    '/api/me/quests/:id/claim',
    { schema: { params: z.object({ id: z.string().max(30) }) } },
    async (req) => {
      const me = requireUser(req)
      const today = await questDay(ctx, me.id)
      let reward: number
      if (req.params.id === 'bonus') {
        if (!today.quests.every((x) => x.claimed))
          throw badRequest('Finish and claim all 3 quests first.')
        reward = QUEST_BONUS
      } else {
        const qd = QUESTS.find((x) => x.id === req.params.id)
        const p = today.quests.find((x) => x.id === req.params.id)
        if (!qd || !p) throw notFound('Quest')
        if (!p.done) throw badRequest("You haven't finished this one yet.")
        reward = qd.reward
      }
      await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(questClaims)
          .values({ userId: me.id, day: today.day, questId: req.params.id })
          .onConflictDoNothing()
          .returning()
        if (!row) throw conflict('Already claimed.')
        await changeCoins(tx, me.id, reward, 'quest', req.params.id)
      })
      return { quests: await questDay(ctx, me.id), wallet: await loadWallet(ctx, me.id) }
    },
  )
}

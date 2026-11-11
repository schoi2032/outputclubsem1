/**
 * WickyChat: more ways to earn. A free daily spin, daily trivia, a bonus for bringing a friend,
 * and coins when people react to your messages (see `payForReaction`).
 */

import { randomInt } from 'node:crypto'
import {
  coinTransactions,
  messages,
  orgMemberships,
  referrals,
  triviaAnswers,
  users,
} from '@quid/db'
import {
  type EarnStatus,
  LIKES,
  REFERRAL,
  TRIVIA_REWARD,
  type TriviaDay,
  triviaFor,
  WHEEL,
  wheelSlice,
} from '@quid/shared'
import { and, count, eq, gte, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, notFound } from '../../core/errors'
import { type App, orgParams } from '../../core/http'
import { loadWallet } from './routes'
import { changeCoins, startOfSchoolDay } from './service'

type Db = Parameters<typeof changeCoins>[0]
const dayKey = () =>
  new Date(startOfSchoolDay().getTime() + 9 * 3_600_000).toISOString().slice(0, 10)

async function countToday(db: Db, userId: string, reason: string) {
  const [r] = await db
    .select({ n: count(), sum: sql<number>`coalesce(sum(${coinTransactions.amount}), 0)::int` })
    .from(coinTransactions)
    .where(
      and(
        eq(coinTransactions.userId, userId),
        sql`${coinTransactions.reason} = ${reason}`,
        gte(coinTransactions.createdAt, startOfSchoolDay()),
      ),
    )
  return { n: Number(r?.n ?? 0), sum: Number(r?.sum ?? 0) }
}

/**
 * Someone reacted to a message: its author gets a coin, once per person per message, up to a
 * daily cap. Never for your own messages, bots, or old messages. Never blocks the reaction.
 */
export async function payForReaction(ctx: AppContext, messageId: string, reactorId: string) {
  try {
    const m = await ctx.db.query.messages.findFirst({
      where: eq(messages.id, messageId),
      columns: { authorId: true, createdAt: true, kind: true },
    })
    if (!m?.authorId || m.authorId === reactorId || m.kind !== 'user') return
    if (Date.now() - m.createdAt.getTime() > LIKES.maxAgeDays * 86_400_000) return
    const author = m.authorId
    const ref = `${messageId}|${reactorId}`
    await ctx.db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, author)).for('update')
      const already = await tx
        .select({ n: count() })
        .from(coinTransactions)
        .where(and(eq(coinTransactions.userId, author), eq(coinTransactions.ref, ref)))
      if (Number(already[0]?.n ?? 0)) return
      const today = await countToday(tx, author, 'liked')
      if (today.sum >= LIKES.dailyCap) return
      await changeCoins(tx, author, LIKES.perReaction, 'liked', ref)
    })
  } catch (err) {
    ctx.log.warn({ err }, 'could not pay for a reaction')
  }
}

async function trivia(ctx: AppContext, orgId: string, userId: string): Promise<TriviaDay> {
  const day = dayKey()
  const q = triviaFor(day)
  const [mine, right] = await Promise.all([
    ctx.db.query.triviaAnswers.findFirst({
      where: and(eq(triviaAnswers.userId, userId), eq(triviaAnswers.day, day)),
    }),
    ctx.db
      .select({ n: count() })
      .from(triviaAnswers)
      .innerJoin(orgMemberships, eq(orgMemberships.userId, triviaAnswers.userId))
      .where(
        and(
          eq(triviaAnswers.day, day),
          eq(triviaAnswers.correct, true),
          eq(orgMemberships.orgId, orgId),
        ),
      ),
  ])
  return {
    day,
    question: q.q,
    options: q.options,
    picked: mine?.picked ?? null,
    // The answer only shows once you've answered.
    answer: mine ? q.answer : null,
    correct: mine?.correct ?? null,
    rightToday: Number(right[0]?.n ?? 0),
  }
}

export async function earnRoutes(app: App, ctx: AppContext) {
  app.get(
    '/api/orgs/:orgId/earn',
    { schema: { params: orgParams } },
    async (req): Promise<EarnStatus> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const [spin, likes, member, mine, brought] = await Promise.all([
        countToday(ctx.db, scope.userId, 'spin'),
        countToday(ctx.db, scope.userId, 'liked'),
        ctx.db.query.orgMemberships.findFirst({
          where: and(
            eq(orgMemberships.orgId, scope.orgId),
            eq(orgMemberships.userId, scope.userId),
          ),
          columns: { joinedAt: true },
        }),
        ctx.db.query.referrals.findFirst({ where: eq(referrals.userId, scope.userId) }),
        ctx.db.select({ n: count() }).from(referrals).where(eq(referrals.referrerId, scope.userId)),
      ])
      const fresh =
        !!member && Date.now() - member.joinedAt.getTime() < REFERRAL.withinDays * 86_400_000
      return {
        spinAvailable: spin.n === 0,
        likesToday: likes.sum,
        referral: {
          canClaim: fresh && !mine,
          claimed: !!mine,
          referredCount: Number(brought[0]?.n ?? 0),
        },
      }
    },
  )

  /** One free spin a day. */
  app.post('/api/orgs/:orgId/earn/spin', { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const slice = await ctx.db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, scope.userId)).for('update')
      if ((await countToday(tx, scope.userId, 'spin')).n)
        throw conflict('You already spun today. Come back tomorrow!')
      const i = wheelSlice(randomInt(0, 100))
      await changeCoins(tx, scope.userId, WHEEL[i]!.coins, 'spin', String(i))
      return i
    })
    return { slice, coins: WHEEL[slice]!.coins, wallet: await loadWallet(ctx, scope.userId) }
  })

  app.get('/api/orgs/:orgId/trivia', { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    return trivia(ctx, scope.orgId, scope.userId)
  })

  app.post(
    '/api/orgs/:orgId/trivia',
    { schema: { params: orgParams, body: z.object({ picked: z.number().int().min(0).max(9) }) } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const day = dayKey()
      const q = triviaFor(day)
      if (req.body.picked >= q.options.length) throw badRequest('Pick one of the answers.')
      const correct = req.body.picked === q.answer
      await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(triviaAnswers)
          .values({ userId: scope.userId, day, picked: req.body.picked, correct })
          .onConflictDoNothing()
          .returning()
        if (!row) throw conflict("You've already answered today's question.")
        if (correct) await changeCoins(tx, scope.userId, TRIVIA_REWARD, 'trivia', day)
      })
      return {
        trivia: await trivia(ctx, scope.orgId, scope.userId),
        wallet: await loadWallet(ctx, scope.userId),
      }
    },
  )

  /** A new member names the friend who brought them. Both get REFERRAL.reward, once. */
  app.post(
    '/api/orgs/:orgId/earn/referral',
    { schema: { params: orgParams, body: z.object({ referrerId: z.uuid() }) } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { referrerId } = req.body
      if (referrerId === scope.userId) throw badRequest("You can't name yourself.")
      const [me, them] = await Promise.all([
        ctx.db.query.orgMemberships.findFirst({
          where: and(
            eq(orgMemberships.orgId, scope.orgId),
            eq(orgMemberships.userId, scope.userId),
          ),
          columns: { joinedAt: true },
        }),
        ctx.db
          .select({ joinedAt: orgMemberships.joinedAt, isBot: users.isBot })
          .from(orgMemberships)
          .innerJoin(users, eq(users.id, orgMemberships.userId))
          .where(
            and(
              eq(orgMemberships.orgId, scope.orgId),
              eq(orgMemberships.userId, referrerId),
              isNull(orgMemberships.deactivatedAt),
            ),
          ),
      ])
      if (!me || Date.now() - me.joinedAt.getTime() > REFERRAL.withinDays * 86_400_000)
        throw badRequest(`This is only for people in their first ${REFERRAL.withinDays} days.`)
      const friend = them[0]
      if (!friend || friend.isBot) throw notFound('Person')
      // They must have been here before you (so two new accounts can't name each other).
      if (friend.joinedAt >= me.joinedAt) throw badRequest('Name someone who was here before you.')
      await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(referrals)
          .values({ userId: scope.userId, orgId: scope.orgId, referrerId })
          .onConflictDoNothing()
          .returning()
        if (!row) throw conflict('You already named who brought you.')
        await changeCoins(tx, scope.userId, REFERRAL.reward, 'referral', referrerId)
        await changeCoins(tx, referrerId, REFERRAL.reward, 'referral', scope.userId)
      })
      return loadWallet(ctx, scope.userId)
    },
  )
}

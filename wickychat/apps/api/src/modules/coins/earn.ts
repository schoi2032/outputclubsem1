/**
 * WickyChat: more ways to earn. A free daily spin (plus spin tickets from crates), daily
 * trivia, and coins when people react to your messages (see `payForReaction`).
 */

import { randomInt } from 'node:crypto'
import { coinTransactions, messages, orgMemberships, triviaAnswers, users } from '@quid/db'
import {
  type EarnStatus,
  LIKES,
  TRIVIA_REWARD,
  type TriviaDay,
  triviaFor,
  WHEEL,
  wheelSlice,
} from '@quid/shared'
import { and, count, eq, gte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict } from '../../core/errors'
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

/** Free spins used today (ticket spins don't count). */
async function freeSpinsToday(db: Db, userId: string) {
  const [r] = await db
    .select({ n: count() })
    .from(coinTransactions)
    .where(
      and(
        eq(coinTransactions.userId, userId),
        eq(coinTransactions.reason, 'spin'),
        sql`${coinTransactions.ref} not like '%|ticket'`,
        gte(coinTransactions.createdAt, startOfSchoolDay()),
      ),
    )
  return Number(r?.n ?? 0)
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
      const [spin, likes, u] = await Promise.all([
        freeSpinsToday(ctx.db, scope.userId),
        countToday(ctx.db, scope.userId, 'liked'),
        ctx.db.query.users.findFirst({
          where: eq(users.id, scope.userId),
          columns: { spinTickets: true },
        }),
      ])
      return {
        spinAvailable: spin === 0,
        spinTickets: u?.spinTickets ?? 0,
        likesToday: likes.sum,
      }
    },
  )

  /**
   * One free spin a day; after that, each spin uses a 🎟️ spin ticket from a crate. `count` spins
   * several times at once (the free one first, then tickets).
   */
  app.post(
    '/api/orgs/:orgId/earn/spin',
    {
      schema: {
        params: orgParams,
        body: z
          .object({ count: z.number().int().min(1).max(100).default(1) })
          .default({ count: 1 }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const n = req.body.count
      const slices = await ctx.db.transaction(async (tx) => {
        const [u] = await tx
          .select({ tickets: users.spinTickets })
          .from(users)
          .where(eq(users.id, scope.userId))
          .for('update')
        const free = (await freeSpinsToday(tx, scope.userId)) === 0 ? 1 : 0
        const tickets = u?.tickets ?? 0
        if (free + tickets === 0)
          throw conflict(
            'You already spun today. Get 🎟️ spin tickets from crates, or come back tomorrow!',
          )
        if (n > free + tickets)
          throw badRequest(
            `You only have ${free + tickets} spin${free + tickets === 1 ? '' : 's'}.`,
          )
        const used = n - free
        if (used > 0)
          await tx
            .update(users)
            .set({ spinTickets: tickets - used })
            .where(eq(users.id, scope.userId))
        const out: number[] = []
        for (let k = 0; k < n; k++) {
          const i = wheelSlice(randomInt(0, 100))
          // The ref says which slice, and whether it was the free spin or a ticket.
          const kind = k < free ? 'free' : 'ticket'
          await changeCoins(tx, scope.userId, WHEEL[i]!.coins, 'spin', `${i}|${kind}`)
          out.push(i)
        }
        return out
      })
      const coins = slices.reduce((t, i) => t + WHEEL[i]!.coins, 0)
      return {
        slice: slices[slices.length - 1]!,
        slices,
        coins,
        wallet: await loadWallet(ctx, scope.userId),
      }
    },
  )

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
}

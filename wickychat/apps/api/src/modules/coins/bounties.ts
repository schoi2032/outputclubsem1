/**
 * WickyChat Q&A bounties: ask a question in chat with coins on it. People answer in the
 * thread; the asker picks the best answer and that person gets the coins. Once someone has
 * answered, the asker can't take the coins back (only a teacher can call it off).
 */
import { bounties, messages, users } from '@quid/db'
import { BOUNTY, type Bounty, topics } from '@quid/shared'
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { z } from 'zod'
import { type OrgScope, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors'
import { type App, orgIdParams } from '../../core/http'
import { requireChannel } from '../channels/service'
import { createMessage, serializeMessage } from '../messages/service'
import { toUserSummary, userCols } from '../users/serialize'
import { loadWallet } from './routes'
import { changeCoins } from './service'

type Row = typeof bounties.$inferSelect
const isTeacher = (s: OrgScope) => s.role === 'owner' || s.role === 'admin'

async function toBounty(ctx: AppContext, b: Row): Promise<Bounty> {
  const ids = [b.askerId, b.winnerId].filter((x): x is string => !!x)
  const people = await ctx.db.select(userCols).from(users).where(inArray(users.id, ids))
  const who = (id: string | null) => {
    const u = id ? people.find((p) => p.id === id) : undefined
    return u ? toUserSummary(u) : null
  }
  return {
    id: b.id,
    messageId: b.messageId,
    channelId: b.channelId,
    asker: who(b.askerId)!,
    amount: b.amount,
    status: b.status as Bounty['status'],
    winner: who(b.winnerId),
    answerMessageId: b.answerMessageId,
  }
}

async function getBounty(ctx: AppContext, scope: OrgScope, id: string) {
  const b = await ctx.db.query.bounties.findFirst({
    where: and(eq(bounties.id, id), eq(bounties.orgId, scope.orgId)),
  })
  if (!b) throw notFound('Bounty')
  await requireChannel(ctx, scope, b.channelId, 'read')
  return b
}

/** Thread replies from people other than the asker. */
async function answers(ctx: AppContext, b: Row) {
  return ctx.db
    .select({ m: messages, author: userCols })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(
      and(
        eq(messages.parentId, b.messageId),
        ne(messages.authorId, b.askerId),
        isNull(messages.deletedAt),
        eq(users.isBot, false),
      ),
    )
    .orderBy(asc(messages.createdAt))
    .limit(100)
}

async function republish(ctx: AppContext, scope: OrgScope, b: Row) {
  const row = await ctx.db.query.messages.findFirst({ where: eq(messages.id, b.messageId) })
  if (!row) return
  await ctx.bus.publish(topics.channel(b.channelId), {
    type: 'message.updated',
    orgId: scope.orgId,
    message: await serializeMessage(ctx, scope.userId, row),
  })
}

export async function bountyRoutes(app: App, ctx: AppContext) {
  app.post(
    '/api/orgs/:orgId/channels/:id/bounties',
    {
      schema: {
        params: orgIdParams,
        body: z.object({
          question: z.string().trim().min(5).max(500),
          amount: z.number().int().min(BOUNTY.min).max(BOUNTY.max),
        }),
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { channel } = await requireChannel(ctx, scope, req.params.id, 'post')
      const { question, amount } = req.body
      const me = await ctx.db.query.users.findFirst({
        where: eq(users.id, scope.userId),
        columns: { coins: true },
      })
      if (!me || me.coins < amount)
        throw badRequest(`You need ${amount - (me?.coins ?? 0)} more Wicky Coins.`)
      const message = await createMessage(ctx, scope, channel, {
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: `❓ ${question}` }] }],
        },
        fileIds: [],
      })
      const b = await ctx.db.transaction(async (tx) => {
        const [u] = await tx
          .select({ coins: users.coins })
          .from(users)
          .where(eq(users.id, scope.userId))
          .for('update')
        if (!u || u.coins < amount) throw badRequest("You don't have enough coins.")
        const [row] = await tx
          .insert(bounties)
          .values({
            orgId: scope.orgId,
            channelId: channel.id,
            messageId: message.id,
            askerId: scope.userId,
            amount,
          })
          .returning()
        await changeCoins(tx, scope.userId, -amount, 'bounty_hold', row!.id)
        return row!
      })
      await republish(ctx, scope, b)
      return reply.code(201).send(await toBounty(ctx, b))
    },
  )

  app.get('/api/orgs/:orgId/bounties/:id', { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    return toBounty(ctx, await getBounty(ctx, scope, req.params.id))
  })

  /** The answers so far (thread replies), for picking the best one. */
  app.get(
    '/api/orgs/:orgId/bounties/:id/answers',
    { schema: { params: orgIdParams } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const b = await getBounty(ctx, scope, req.params.id)
      return (await answers(ctx, b)).map((a) => ({
        messageId: a.m.id,
        author: toUserSummary(a.author),
        text: a.m.bodyText.slice(0, 300),
        createdAt: a.m.createdAt.toISOString(),
      }))
    },
  )

  app.post(
    '/api/orgs/:orgId/bounties/:id/award',
    { schema: { params: orgIdParams, body: z.object({ messageId: z.uuid() }) } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const found = await getBounty(ctx, scope, req.params.id)
      if (found.askerId !== scope.userId) throw forbidden('Only the person who asked can pick.')
      const pick = (await answers(ctx, found)).find((a) => a.m.id === req.body.messageId)
      if (!pick) throw badRequest('Pick one of the replies in the thread.')
      const b = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .update(bounties)
          .set({ status: 'awarded', winnerId: pick.author.id, answerMessageId: pick.m.id })
          .where(and(eq(bounties.id, found.id), eq(bounties.status, 'open')))
          .returning()
        if (!row) throw conflict('This bounty is already closed.')
        await changeCoins(tx, pick.author.id, row.amount, 'bounty_win', row.id)
        return row
      })
      await ctx.bus
        .publish(topics.user(pick.author.id), {
          type: 'wicky.updated',
          orgId: scope.orgId,
          text: `🏅 Your answer won a 🪙 ${b.amount} bounty!`,
        })
        .catch(() => {})
      await republish(ctx, scope, b)
      return { bounty: await toBounty(ctx, b), wallet: await loadWallet(ctx, scope.userId) }
    },
  )

  /** Call it off (coins back). Not once someone has answered, except for teachers. */
  app.post(
    '/api/orgs/:orgId/bounties/:id/cancel',
    { schema: { params: orgIdParams } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const found = await getBounty(ctx, scope, req.params.id)
      if (found.askerId !== scope.userId && !isTeacher(scope)) throw forbidden()
      if (!isTeacher(scope) && (await answers(ctx, found)).length)
        throw conflict('Someone already answered. Pick the best answer instead!')
      const b = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .update(bounties)
          .set({ status: 'cancelled' })
          .where(and(eq(bounties.id, found.id), eq(bounties.status, 'open')))
          .returning()
        if (!row) throw conflict('This bounty is already closed.')
        await changeCoins(tx, row.askerId, row.amount, 'bounty_refund', row.id)
        return row
      })
      await republish(ctx, scope, b)
      return { bounty: await toBounty(ctx, b), wallet: await loadWallet(ctx, scope.userId) }
    },
  )
}

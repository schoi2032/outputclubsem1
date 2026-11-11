/**
 * WickyChat: coinflip duels in chat. The challenger's coins are held when it's posted; the
 * opponent's when they accept; then a fair coin is flipped and the winner takes both. Nobody
 * takes a cut. Nobody accepts in 10 minutes? The challenger gets their coins back.
 */

import { randomInt } from 'node:crypto'
import { duels, messages, users } from '@quid/db'
import { DUEL, type Duel, topics } from '@quid/shared'
import { and, eq, inArray, lt } from 'drizzle-orm'
import { z } from 'zod'
import { type OrgScope, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors'
import { type App, orgIdParams } from '../../core/http'
import { requireChannel } from '../channels/service'
import { createMessage, serializeMessage } from '../messages/service'
import { loadCustomization } from '../orgs/customization'
import { toUserSummary, userCols } from '../users/serialize'
import { loadWallet } from './routes'
import { changeCoins } from './service'

type DuelRow = typeof duels.$inferSelect
const isTeacher = (scope: OrgScope) => scope.role === 'owner' || scope.role === 'admin'

async function toDuel(ctx: AppContext, d: DuelRow): Promise<Duel> {
  const ids = [d.challengerId, d.opponentId, d.acceptedBy].filter((x): x is string => !!x)
  const people = await ctx.db.select(userCols).from(users).where(inArray(users.id, ids))
  const who = (id: string | null) => {
    const u = id ? people.find((p) => p.id === id) : undefined
    return u ? toUserSummary(u) : null
  }
  return {
    id: d.id,
    messageId: d.messageId,
    channelId: d.channelId,
    challenger: who(d.challengerId)!,
    opponent: who(d.opponentId),
    acceptedBy: who(d.acceptedBy),
    amount: d.amount,
    side: d.side as Duel['side'],
    result: d.result as Duel['result'],
    winnerId: d.winnerId,
    status: d.status as Duel['status'],
    expiresAt: d.expiresAt.toISOString(),
  }
}

/** Gives back coins for duels nobody took in time. */
async function expireDuels(ctx: AppContext, ids?: string[]) {
  const due = await ctx.db
    .select({ id: duels.id })
    .from(duels)
    .where(
      and(
        eq(duels.status, 'open'),
        lt(duels.expiresAt, new Date()),
        ...(ids ? [inArray(duels.id, ids)] : []),
      ),
    )
    .limit(50)
  for (const { id } of due)
    await ctx.db.transaction(async (tx) => {
      const [d] = await tx
        .update(duels)
        .set({ status: 'expired' })
        .where(and(eq(duels.id, id), eq(duels.status, 'open')))
        .returning()
      if (d) await changeCoins(tx, d.challengerId, d.amount, 'duel_refund', d.id)
    })
}

async function getDuel(ctx: AppContext, scope: OrgScope, id: string) {
  await expireDuels(ctx, [id])
  const d = await ctx.db.query.duels.findFirst({
    where: and(eq(duels.id, id), eq(duels.orgId, scope.orgId)),
  })
  if (!d) throw notFound('Duel')
  await requireChannel(ctx, scope, d.channelId, 'read')
  return d
}

/** Re-sends the message so everyone's card updates. */
async function republish(ctx: AppContext, scope: OrgScope, d: DuelRow) {
  const row = await ctx.db.query.messages.findFirst({ where: eq(messages.id, d.messageId) })
  if (!row) return
  await ctx.bus.publish(topics.channel(d.channelId), {
    type: 'message.updated',
    orgId: scope.orgId,
    message: await serializeMessage(ctx, scope.userId, row),
  })
}

export async function duelRoutes(app: App, ctx: AppContext) {
  app.post(
    '/api/orgs/:orgId/channels/:id/duels',
    {
      schema: {
        params: orgIdParams,
        body: z.object({
          amount: z.number().int().min(DUEL.min).max(DUEL.max),
          side: z.enum(['heads', 'tails']).default('heads'),
          opponentId: z.uuid().nullable().default(null),
        }),
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { channel } = await requireChannel(ctx, scope, req.params.id, 'post')
      if (!(await loadCustomization(ctx, scope.orgId)).duels)
        throw forbidden('Coinflip duels are turned off at this school.')
      const { amount, side, opponentId } = req.body
      if (opponentId === scope.userId) throw badRequest("You can't duel yourself.")
      const opponent = opponentId
        ? await ctx.db.query.users.findFirst({
            where: eq(users.id, opponentId),
            columns: { id: true, name: true, displayName: true, isBot: true },
          })
        : null
      if (opponentId && (!opponent || opponent.isBot)) throw notFound('Person')
      const me = await ctx.db.query.users.findFirst({
        where: eq(users.id, scope.userId),
        columns: { coins: true },
      })
      if (!me || me.coins < amount)
        throw badRequest(`You need ${amount - (me?.coins ?? 0)} more Wicky Coins.`)

      const vs = opponent ? ` @${opponent.displayName || opponent.name}` : ' anyone'
      const message = await createMessage(ctx, scope, channel, {
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: `🪙 Coinflip duel for ${amount} coins vs${vs}!` }],
            },
          ],
        },
        fileIds: [],
      })
      const d = await ctx.db.transaction(async (tx) => {
        const [u] = await tx
          .select({ coins: users.coins })
          .from(users)
          .where(eq(users.id, scope.userId))
          .for('update')
        if (!u || u.coins < amount) throw badRequest("You don't have enough coins.")
        await changeCoins(tx, scope.userId, -amount, 'duel_bet', null)
        const [row] = await tx
          .insert(duels)
          .values({
            orgId: scope.orgId,
            channelId: channel.id,
            messageId: message.id,
            challengerId: scope.userId,
            opponentId,
            amount,
            side,
            expiresAt: new Date(Date.now() + DUEL.expiresMs),
          })
          .returning()
        return row!
      })
      await republish(ctx, scope, d)
      return reply.code(201).send(await toDuel(ctx, d))
    },
  )

  app.get('/api/orgs/:orgId/duels/:id', { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    return toDuel(ctx, await getDuel(ctx, scope, req.params.id))
  })

  app.post(
    '/api/orgs/:orgId/duels/:id/accept',
    {
      schema: { params: orgIdParams },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const found = await getDuel(ctx, scope, req.params.id)
      const done = await ctx.db.transaction(async (tx) => {
        const [d] = await tx.select().from(duels).where(eq(duels.id, found.id)).for('update')
        if (!d || d.status !== 'open') throw conflict('Too late! This duel is over.')
        if (d.challengerId === scope.userId) throw badRequest("You can't accept your own duel.")
        if (d.opponentId && d.opponentId !== scope.userId)
          throw forbidden('This duel is for someone else.')
        const [u] = await tx
          .select({ coins: users.coins })
          .from(users)
          .where(eq(users.id, scope.userId))
          .for('update')
        if (!u || u.coins < d.amount)
          throw badRequest(`You need ${d.amount - (u?.coins ?? 0)} more Wicky Coins.`)
        await changeCoins(tx, scope.userId, -d.amount, 'duel_bet', d.id)
        const result = randomInt(2) === 0 ? 'heads' : 'tails'
        const winnerId = result === d.side ? d.challengerId : scope.userId
        await changeCoins(tx, winnerId, d.amount * 2, 'duel_win', d.id)
        const [next] = await tx
          .update(duels)
          .set({ status: 'done', acceptedBy: scope.userId, result, winnerId })
          .where(eq(duels.id, d.id))
          .returning()
        return next!
      })
      await republish(ctx, scope, done)
      return { duel: await toDuel(ctx, done), wallet: await loadWallet(ctx, scope.userId) }
    },
  )

  /** The challenger (or a teacher) calls it off before anyone accepts. */
  app.post(
    '/api/orgs/:orgId/duels/:id/cancel',
    { schema: { params: orgIdParams } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const found = await getDuel(ctx, scope, req.params.id)
      if (found.challengerId !== scope.userId && !isTeacher(scope)) throw forbidden()
      const d = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .update(duels)
          .set({ status: 'cancelled' })
          .where(and(eq(duels.id, found.id), eq(duels.status, 'open')))
          .returning()
        if (!row) throw conflict('This duel is already over.')
        await changeCoins(tx, row.challengerId, row.amount, 'duel_refund', row.id)
        return row
      })
      await republish(ctx, scope, d)
      return toDuel(ctx, d)
    },
  )
}

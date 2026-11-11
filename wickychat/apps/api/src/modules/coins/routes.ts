/**
 * WickyChat: wallet, daily bonus, decoration shop, and teachers gifting coins.
 */
import { coinTransactions, orgMemberships, userItems, users } from '@quid/db'
import {
  COINS,
  type CoinTransaction,
  DECORATION_IDS,
  decorationById,
  type Wallet,
} from '@quid/shared'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '../../core/audit'
import { authorize, requireOrg, requireUser } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, notFound } from '../../core/errors'
import { type App, orgIdParams } from '../../core/http'
import { changeCoins, earnedFromMessagesToday, startOfSchoolDay } from './service'

async function loadWallet(ctx: AppContext, userId: string): Promise<Wallet> {
  const [u, owned, history, earned] = await Promise.all([
    ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { coins: true, decoration: true, dailyClaimedAt: true },
    }),
    ctx.db.select({ itemId: userItems.itemId }).from(userItems).where(eq(userItems.userId, userId)),
    ctx.db
      .select()
      .from(coinTransactions)
      .where(eq(coinTransactions.userId, userId))
      .orderBy(desc(coinTransactions.id))
      .limit(30),
    earnedFromMessagesToday(ctx.db, userId),
  ])
  if (!u) throw notFound('User')
  return {
    coins: u.coins,
    owned: owned.map((o) => o.itemId).filter((id) => DECORATION_IDS.includes(id)),
    equipped: u.decoration,
    dailyAvailable: !u.dailyClaimedAt || u.dailyClaimedAt < startOfSchoolDay(),
    earnedFromMessagesToday: earned,
    history: history.map((h) => ({
      id: h.id,
      amount: h.amount,
      reason: h.reason as CoinTransaction['reason'],
      ref: h.ref,
      createdAt: h.createdAt.toISOString(),
    })),
  }
}

export async function coinRoutes(app: App, ctx: AppContext) {
  app.get('/api/me/wallet', async (req) => loadWallet(ctx, requireUser(req).id))

  /** Once per school day (midnight in Korea). */
  app.post('/api/me/wallet/daily', async (req) => {
    const me = requireUser(req)
    await ctx.db.transaction(async (tx) => {
      // Lock the row so two quick clicks can't both claim.
      const [u] = await tx
        .select({ at: users.dailyClaimedAt })
        .from(users)
        .where(eq(users.id, me.id))
        .for('update')
      if (u?.at && u.at >= startOfSchoolDay())
        throw conflict("You've already claimed today's coins. Come back tomorrow!")
      await tx.update(users).set({ dailyClaimedAt: new Date() }).where(eq(users.id, me.id))
      await changeCoins(tx, me.id, COINS.daily, 'daily')
    })
    return loadWallet(ctx, me.id)
  })

  app.post(
    '/api/me/shop/:itemId/buy',
    { schema: { params: z.object({ itemId: z.string().max(40) }) } },
    async (req) => {
      const me = requireUser(req)
      const item = decorationById(req.params.itemId)
      if (!item) throw notFound('Item')
      await ctx.db.transaction(async (tx) => {
        const has = await tx.query.userItems.findFirst({
          where: and(eq(userItems.userId, me.id), eq(userItems.itemId, item.id)),
        })
        if (has) throw conflict('You already own this.')
        const [u] = await tx
          .select({ coins: users.coins })
          .from(users)
          .where(eq(users.id, me.id))
          .for('update')
        if (!u || u.coins < item.price)
          throw badRequest(`You need ${item.price - (u?.coins ?? 0)} more Wicky Coins for this.`)
        await changeCoins(tx, me.id, -item.price, 'purchase', item.id)
        await tx.insert(userItems).values({ userId: me.id, itemId: item.id })
        // Wear it straight away.
        await tx.update(users).set({ decoration: item.id }).where(eq(users.id, me.id))
      })
      return loadWallet(ctx, me.id)
    },
  )

  app.put(
    '/api/me/decoration',
    { schema: { body: z.object({ itemId: z.string().max(40).nullable() }) } },
    async (req) => {
      const me = requireUser(req)
      const { itemId } = req.body
      if (itemId) {
        const owned = await ctx.db.query.userItems.findFirst({
          where: and(eq(userItems.userId, me.id), eq(userItems.itemId, itemId)),
        })
        if (!owned || !decorationById(itemId)) throw badRequest("You don't own that decoration.")
      }
      await ctx.db.update(users).set({ decoration: itemId }).where(eq(users.id, me.id))
      return loadWallet(ctx, me.id)
    },
  )

  /** Teachers (org admins) reward someone with coins. */
  app.post(
    '/api/orgs/:orgId/members/:id/coins',
    {
      schema: {
        params: orgIdParams,
        body: z.object({
          amount: z.number().int().min(1).max(1000),
          note: z.string().trim().max(120).optional(),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'audit.read')
      const member = await ctx.db.query.orgMemberships.findFirst({
        where: and(eq(orgMemberships.orgId, scope.orgId), eq(orgMemberships.userId, req.params.id)),
        columns: { id: true },
      })
      if (!member) throw notFound('Member')
      const coins = await changeCoins(
        ctx.db,
        req.params.id,
        req.body.amount,
        'gift',
        req.body.note ?? null,
      )
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'coins.gifted',
        targetType: 'user',
        targetId: req.params.id,
        metadata: { amount: req.body.amount, note: req.body.note ?? null },
        ip: req.ip,
      })
      return { coins }
    },
  )
}

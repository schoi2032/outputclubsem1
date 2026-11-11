/**
 * WickyChat: the Marketplace, where people resell items they own to each other.
 * The seller gets MARKET_SHARE of the price; the item moves to the buyer.
 */
import { cosmetics, marketListings, userItems, users } from '@quid/db'
import { MARKET_PRICE, MARKET_SHARE, type MarketListing } from '@quid/shared'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { toUserSummary, userCols } from '../users/serialize'
import { serializeCosmetic } from './routes'
import { changeCoins, isPrivateItem, takeOffItem } from './service'

const CUSTOM = /^u:([0-9a-f-]{36})$/

export async function marketRoutes(app: App, ctx: AppContext) {
  app.get(
    '/api/orgs/:orgId/market',
    { schema: { params: orgParams } },
    async (req): Promise<MarketListing[]> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const rows = await ctx.db
        .select({ l: marketListings, seller: userCols })
        .from(marketListings)
        .innerJoin(users, eq(users.id, marketListings.sellerId))
        .where(and(eq(marketListings.orgId, scope.orgId), eq(marketListings.status, 'open')))
        .orderBy(desc(marketListings.id))
        .limit(300)
      const customIds = rows
        .map((r) => CUSTOM.exec(r.l.itemId)?.[1])
        .filter((x): x is string => !!x)
      const custom = customIds.length
        ? await ctx.db
            .select({
              c: cosmetics,
              creator: { id: users.id, name: users.name, displayName: users.displayName },
            })
            .from(cosmetics)
            .innerJoin(users, eq(users.id, cosmetics.creatorId))
            .where(inArray(cosmetics.id, customIds))
        : []
      const byId = new Map(custom.map((c) => [c.c.id, serializeCosmetic(c.c, c.creator)]))
      return rows.map((r) => ({
        id: r.l.id,
        itemId: r.l.itemId,
        price: r.l.price,
        seller: toUserSummary(r.seller),
        cosmetic: byId.get(CUSTOM.exec(r.l.itemId)?.[1] ?? '') ?? null,
        createdAt: r.l.createdAt.toISOString(),
      }))
    },
  )

  app.post(
    '/api/orgs/:orgId/market',
    {
      schema: {
        params: orgParams,
        body: z.object({
          itemId: z.string().max(60),
          price: z.number().int().min(MARKET_PRICE.min).max(MARKET_PRICE.max),
        }),
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const owned = await ctx.db.query.userItems.findFirst({
        where: and(eq(userItems.userId, scope.userId), eq(userItems.itemId, req.body.itemId)),
      })
      if (!owned) throw badRequest("You don't own that.")
      if (await isPrivateItem(ctx.db, req.body.itemId))
        throw badRequest("Private items can't be sold.")
      const [row] = await ctx.db
        .insert(marketListings)
        .values({
          orgId: scope.orgId,
          sellerId: scope.userId,
          itemId: req.body.itemId,
          price: req.body.price,
        })
        .onConflictDoNothing()
        .returning({ id: marketListings.id })
      if (!row) throw conflict("You're already selling that.")
      return reply.code(201).send({ id: row.id })
    },
  )

  app.delete('/api/orgs/:orgId/market/:id', { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const l = await ctx.db.query.marketListings.findFirst({
      where: and(eq(marketListings.id, req.params.id), eq(marketListings.orgId, scope.orgId)),
    })
    if (l?.status !== 'open') throw notFound('Listing')
    if (l.sellerId !== scope.userId) throw forbidden()
    await ctx.db
      .update(marketListings)
      .set({ status: 'cancelled' })
      .where(eq(marketListings.id, l.id))
    return { ok: true }
  })

  app.post('/api/orgs/:orgId/market/:id/buy', { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const me = scope.userId
    await ctx.db.transaction(async (tx) => {
      const [l] = await tx
        .select()
        .from(marketListings)
        .where(and(eq(marketListings.id, req.params.id), eq(marketListings.orgId, scope.orgId)))
        .for('update')
      if (l?.status !== 'open') throw conflict('Someone else got it first.')
      if (l.sellerId === me) throw badRequest("That's your own listing.")
      const sellerHas = await tx.query.userItems.findFirst({
        where: and(eq(userItems.userId, l.sellerId), eq(userItems.itemId, l.itemId)),
      })
      if (!sellerHas) {
        await tx
          .update(marketListings)
          .set({ status: 'cancelled' })
          .where(eq(marketListings.id, l.id))
        throw conflict("The seller doesn't have this any more.")
      }
      const mine = await tx.query.userItems.findFirst({
        where: and(eq(userItems.userId, me), eq(userItems.itemId, l.itemId)),
      })
      if (mine) throw conflict('You already own this.')
      const [u] = await tx
        .select({ coins: users.coins })
        .from(users)
        .where(eq(users.id, me))
        .for('update')
      if (!u || u.coins < l.price)
        throw badRequest(`You need ${l.price - (u?.coins ?? 0)} more Wicky Coins for this.`)

      await changeCoins(tx, me, -l.price, 'market_buy', l.itemId)
      await changeCoins(tx, l.sellerId, Math.floor(l.price * MARKET_SHARE), 'market_sale', l.itemId)
      // The item (and its copy number, if limited) moves to the buyer.
      await tx
        .update(userItems)
        .set({ userId: me, giftedBy: null })
        .where(and(eq(userItems.userId, l.sellerId), eq(userItems.itemId, l.itemId)))
      await tx
        .update(marketListings)
        .set({ status: 'sold', buyerId: me, soldAt: new Date() })
        .where(eq(marketListings.id, l.id))
      await takeOffItem(tx, l.sellerId, l.itemId)
    })
    return { ok: true }
  })
}

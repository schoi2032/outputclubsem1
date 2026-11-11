/**
 * WickyChat: auctions. The seller's item is held while it runs; each bid holds the bidder's
 * coins and gives the previous bidder theirs back. When time runs out, the top bidder gets the
 * item and the seller gets AUCTION.share of the bid. No bids: the item goes back.
 *
 * There's no always-on worker, so ended auctions are settled whenever someone looks at the
 * auctions or their wallet (and on the cron tick).
 */
import { auctions, cosmetics, marketListings, userItems, users } from '@quid/db'
import { AUCTION, type Auction, minBid, topics } from '@quid/shared'
import { and, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors'
import { type App, orgParams } from '../../core/http'
import { onTick } from '../../core/jobs'
import { toUserSummary, userCols } from '../users/serialize'
import { CUSTOM_ITEM } from './contents'
import { loadWallet, serializeCosmetic } from './routes'
import { changeCoins, isPrivateItem, takeOffItem } from './service'

async function notify(ctx: AppContext, orgId: string, userId: string, text: string) {
  await ctx.bus.publish(topics.user(userId), { type: 'wicky.updated', orgId, text })
}

/** Finishes auctions whose time is up. Safe to call from many places at once. */
export async function settleAuctions(ctx: AppContext) {
  const due = await ctx.db
    .select({ id: auctions.id })
    .from(auctions)
    .where(and(eq(auctions.status, 'open'), lt(auctions.endsAt, new Date())))
    .limit(20)
  for (const { id } of due) {
    const done = await ctx.db.transaction(async (tx) => {
      const [a] = await tx
        .select()
        .from(auctions)
        .where(and(eq(auctions.id, id), eq(auctions.status, 'open')))
        .for('update', { skipLocked: true })
      if (!a || a.endsAt > new Date()) return null
      const giveTo = async (userId: string) =>
        (
          await tx
            .insert(userItems)
            .values({ userId, itemId: a.itemId, serial: a.serial })
            .onConflictDoNothing()
            .returning()
        ).length > 0
      if (a.topBidderId && a.topBid != null && (await giveTo(a.topBidderId))) {
        await changeCoins(
          tx,
          a.sellerId,
          Math.floor(a.topBid * AUCTION.share),
          'auction_sale',
          a.itemId,
        )
        await tx.update(auctions).set({ status: 'sold' }).where(eq(auctions.id, a.id))
        return { a, sold: true }
      }
      // No bids (or the winner somehow got one already): refund and give it back.
      if (a.topBidderId && a.topBid != null)
        await changeCoins(tx, a.topBidderId, a.topBid, 'auction_refund', a.itemId)
      await giveTo(a.sellerId)
      await tx.update(auctions).set({ status: 'unsold' }).where(eq(auctions.id, a.id))
      return { a, sold: false }
    })
    if (!done) continue
    const { a, sold } = done
    if (sold && a.topBidderId) {
      await notify(ctx, a.orgId, a.topBidderId, `🔨 You won the auction! It's yours.`)
      await notify(ctx, a.orgId, a.sellerId, `🔨 Your auction sold for 🪙 ${a.topBid}!`)
    } else
      await notify(
        ctx,
        a.orgId,
        a.sellerId,
        '🔨 Your auction ended with no bids. You got the item back.',
      )
  }
}

async function list(ctx: AppContext, orgId: string): Promise<Auction[]> {
  const bidder = alias(users, 'bidder')
  const rows = await ctx.db
    .select({
      a: auctions,
      seller: userCols,
      bidder: { id: bidder.id, name: bidder.name, displayName: bidder.displayName },
    })
    .from(auctions)
    .innerJoin(users, eq(users.id, auctions.sellerId))
    .leftJoin(bidder, eq(bidder.id, auctions.topBidderId))
    .where(
      and(
        eq(auctions.orgId, orgId),
        or(eq(auctions.status, 'open'), gt(auctions.endsAt, new Date(Date.now() - 24 * 3_600_000))),
        sql`${auctions.status} <> 'cancelled'`,
      ),
    )
    .orderBy(desc(sql`${auctions.status} = 'open'`), auctions.endsAt)
    .limit(100)
  const customIds = rows
    .map((r) => CUSTOM_ITEM.exec(r.a.itemId)?.[1])
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
    id: r.a.id,
    itemId: r.a.itemId,
    serial: r.a.serial,
    seller: toUserSummary(r.seller),
    startPrice: r.a.startPrice,
    topBid: r.a.topBid,
    topBidder: r.bidder
      ? { id: r.bidder.id, name: r.bidder.name, displayName: r.bidder.displayName }
      : null,
    bids: r.a.bids,
    endsAt: r.a.endsAt.toISOString(),
    status: r.a.status as Auction['status'],
    cosmetic: byId.get(CUSTOM_ITEM.exec(r.a.itemId)?.[1] ?? '') ?? null,
  }))
}

export async function auctionRoutes(app: App, ctx: AppContext) {
  onTick(settleAuctions)

  app.get('/api/orgs/:orgId/auctions', { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    await settleAuctions(ctx)
    return list(ctx, scope.orgId)
  })

  app.post(
    '/api/orgs/:orgId/auctions',
    {
      schema: {
        params: orgParams,
        body: z.object({
          itemId: z.string().max(60),
          startPrice: z.number().int().min(AUCTION.start.min).max(AUCTION.start.max),
          hours: z
            .number()
            .int()
            .refine(
              (h) => (AUCTION.hours as readonly number[]).includes(h),
              'Pick 1, 6 or 24 hours',
            ),
        }),
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { itemId, startPrice, hours } = req.body
      if (await isPrivateItem(ctx.db, itemId)) throw badRequest("Private items can't be sold.")
      await ctx.db.transaction(async (tx) => {
        const [own] = await tx
          .select({ serial: userItems.serial })
          .from(userItems)
          .where(and(eq(userItems.userId, scope.userId), eq(userItems.itemId, itemId)))
          .for('update')
        if (!own) throw badRequest("You don't own that.")
        const listed = await tx.query.marketListings.findFirst({
          where: and(
            eq(marketListings.sellerId, scope.userId),
            eq(marketListings.itemId, itemId),
            eq(marketListings.status, 'open'),
          ),
          columns: { id: true },
        })
        if (listed) throw badRequest('Take it off the Market first.')
        const [open] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(auctions)
          .where(and(eq(auctions.sellerId, scope.userId), eq(auctions.status, 'open')))
        if ((open?.n ?? 0) >= AUCTION.maxOpen)
          throw badRequest(`You can run ${AUCTION.maxOpen} auctions at once.`)
        await takeOffItem(tx, scope.userId, itemId)
        await tx
          .delete(userItems)
          .where(and(eq(userItems.userId, scope.userId), eq(userItems.itemId, itemId)))
        await tx.insert(auctions).values({
          orgId: scope.orgId,
          sellerId: scope.userId,
          itemId,
          serial: own.serial,
          startPrice,
          endsAt: new Date(Date.now() + hours * 3_600_000),
        })
      })
      return list(ctx, scope.orgId)
    },
  )

  app.post(
    '/api/orgs/:orgId/auctions/:id/bid',
    {
      schema: {
        params: orgParams.extend({ id: z.uuid() }),
        body: z.object({ amount: z.number().int().min(1).max(1_000_000) }),
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      await settleAuctions(ctx)
      const { amount } = req.body
      const outbid = await ctx.db.transaction(async (tx) => {
        const [a] = await tx
          .select()
          .from(auctions)
          .where(and(eq(auctions.id, req.params.id), eq(auctions.orgId, scope.orgId)))
          .for('update')
        if (!a) throw notFound('Auction')
        if (a.status !== 'open' || a.endsAt <= new Date()) throw conflict('This auction is over.')
        if (a.sellerId === scope.userId) throw forbidden("You can't bid on your own auction.")
        if (a.topBidderId === scope.userId) throw conflict("You're already the top bidder.")
        const need = minBid(a.startPrice, a.topBid)
        if (amount < need) throw badRequest(`Bid at least 🪙 ${need}.`)
        const has = await tx.query.userItems.findFirst({
          where: and(eq(userItems.userId, scope.userId), eq(userItems.itemId, a.itemId)),
          columns: { itemId: true },
        })
        if (has) throw conflict('You already own this one.')
        const [u] = await tx
          .select({ coins: users.coins })
          .from(users)
          .where(eq(users.id, scope.userId))
          .for('update')
        if (!u || u.coins < amount)
          throw badRequest(`You need ${amount - (u?.coins ?? 0)} more Wicky Coins.`)
        await changeCoins(tx, scope.userId, -amount, 'auction_bid', a.itemId)
        if (a.topBidderId && a.topBid != null)
          await changeCoins(tx, a.topBidderId, a.topBid, 'auction_refund', a.itemId)
        const left = a.endsAt.getTime() - Date.now()
        await tx
          .update(auctions)
          .set({
            topBid: amount,
            topBidderId: scope.userId,
            bids: a.bids + 1,
            endsAt: left < AUCTION.snipeMs ? new Date(Date.now() + AUCTION.snipeMs) : a.endsAt,
          })
          .where(eq(auctions.id, a.id))
        return a.topBidderId
      })
      if (outbid)
        await notify(
          ctx,
          scope.orgId,
          outbid,
          `🔨 Someone outbid you (🪙 ${amount}). Your coins are back. Bid again?`,
        )
      return { auctions: await list(ctx, scope.orgId), wallet: await loadWallet(ctx, scope.userId) }
    },
  )

  /** The seller can call it off while nobody has bid. */
  app.delete(
    '/api/orgs/:orgId/auctions/:id',
    { schema: { params: orgParams.extend({ id: z.uuid() }) } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      await ctx.db.transaction(async (tx) => {
        const [a] = await tx
          .select()
          .from(auctions)
          .where(and(eq(auctions.id, req.params.id), eq(auctions.orgId, scope.orgId)))
          .for('update')
        if (!a) throw notFound('Auction')
        if (a.sellerId !== scope.userId) throw forbidden()
        if (a.status !== 'open') throw conflict('This auction is over.')
        if (a.topBidderId) throw conflict("Someone has bid, so it can't be called off.")
        await tx
          .insert(userItems)
          .values({ userId: a.sellerId, itemId: a.itemId, serial: a.serial })
          .onConflictDoNothing()
        await tx.update(auctions).set({ status: 'cancelled' }).where(eq(auctions.id, a.id))
      })
      return list(ctx, scope.orgId)
    },
  )
}

/**
 * WickyChat: wallet, daily bonus, the Shop (built-in and student-made decorations), gifting,
 * teachers rewarding coins, and the review queue for student-made cosmetics.
 */
import { coinTransactions, cosmetics, files, orgMemberships, userItems, users } from '@quid/db'
import {
  COINS,
  COSMETIC_PRICE,
  type CoinTransaction,
  type Cosmetic,
  CREATOR_SHARE,
  censorText,
  cosmeticDecoration,
  DECORATION_IDS,
  decorationById,
  STICKER_POSITIONS,
  type StickerPosition,
  type Wallet,
} from '@quid/shared'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '../../core/audit'
import { authorize, requireOrg, requireUser } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { avatarUrl } from '../users/serialize'
import { changeCoins, earnedFromMessagesToday, startOfSchoolDay } from './service'

const CUSTOM = /^u:([0-9a-f-]{36})$/

type CosmeticRow = typeof cosmetics.$inferSelect

function serializeCosmetic(
  c: CosmeticRow,
  creator: { id: string; name: string; displayName: string | null },
): Cosmetic {
  return {
    id: c.id,
    decoration: cosmeticDecoration(c),
    name: c.name,
    description: c.description,
    price: c.price,
    creator,
    frameUrl: avatarUrl(c.frameFileId),
    stickerUrl: avatarUrl(c.stickerFileId),
    stickerPosition: c.stickerPosition as StickerPosition,
    status: c.status as Cosmetic['status'],
    reviewNote: c.reviewNote,
    sales: c.sales,
    createdAt: c.createdAt.toISOString(),
  }
}

async function loadWallet(ctx: AppContext, userId: string): Promise<Wallet> {
  const [u, owned, history, earned] = await Promise.all([
    ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { coins: true, decoration: true, dailyClaimedAt: true },
    }),
    ctx.db
      .select({ itemId: userItems.itemId, giverId: userItems.giftedBy, giverName: users.name })
      .from(userItems)
      .leftJoin(users, eq(users.id, userItems.giftedBy))
      .where(eq(userItems.userId, userId)),
    ctx.db
      .select()
      .from(coinTransactions)
      .where(eq(coinTransactions.userId, userId))
      .orderBy(desc(coinTransactions.id))
      .limit(30),
    earnedFromMessagesToday(ctx.db, userId),
  ])
  if (!u) throw notFound('User')
  const valid = owned.filter((o) => DECORATION_IDS.includes(o.itemId) || CUSTOM.test(o.itemId))
  const giftedBy: Wallet['giftedBy'] = {}
  for (const o of valid)
    if (o.giverId && o.giverName) giftedBy[o.itemId] = { id: o.giverId, name: o.giverName }
  return {
    coins: u.coins,
    owned: valid.map((o) => o.itemId),
    giftedBy,
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

/** Both people must be active members of the same school organization. */
async function sameOrg(ctx: AppContext, a: string, b: string) {
  const rows = await ctx.db
    .select({ orgId: orgMemberships.orgId, userId: orgMemberships.userId })
    .from(orgMemberships)
    .where(and(inArray(orgMemberships.userId, [a, b]), isNull(orgMemberships.deactivatedAt)))
  const orgsA = new Set(rows.filter((r) => r.userId === a).map((r) => r.orgId))
  return rows.some((r) => r.userId === b && orgsA.has(r.orgId))
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

  /**
   * Buys a decoration (built-in id, or `u:<id>` for a student-made one) for yourself, or as a
   * gift for someone else with `giftTo`.
   */
  app.post(
    '/api/me/shop/:itemId/buy',
    {
      schema: {
        params: z.object({ itemId: z.string().max(60) }),
        body: z.object({ giftTo: z.uuid().optional() }).optional(),
      },
    },
    async (req) => {
      const me = requireUser(req)
      const giftTo = req.body?.giftTo
      const itemId = req.params.itemId
      if (giftTo === me.id) throw badRequest("You can't gift something to yourself.")

      let price: number
      let custom: CosmeticRow | undefined
      const builtin = decorationById(itemId)
      const m = CUSTOM.exec(itemId)
      if (builtin) {
        price = builtin.price
      } else if (m) {
        custom = await ctx.db.query.cosmetics.findFirst({ where: eq(cosmetics.id, m[1]!) })
        if (custom?.status !== 'approved') throw notFound('Item')
        price = custom.price
      } else throw notFound('Item')

      const owner = giftTo ?? me.id
      if (giftTo) {
        const target = await ctx.db.query.users.findFirst({
          where: eq(users.id, giftTo),
          columns: { id: true, isBot: true },
        })
        if (!target || target.isBot || !(await sameOrg(ctx, me.id, giftTo)))
          throw notFound('Person')
      }

      await ctx.db.transaction(async (tx) => {
        const has = await tx.query.userItems.findFirst({
          where: and(eq(userItems.userId, owner), eq(userItems.itemId, itemId)),
        })
        if (has) throw conflict(giftTo ? 'They already have this one.' : 'You already own this.')
        const [u] = await tx
          .select({ coins: users.coins })
          .from(users)
          .where(eq(users.id, me.id))
          .for('update')
        if (!u || u.coins < price)
          throw badRequest(`You need ${price - (u?.coins ?? 0)} more Wicky Coins for this.`)
        await changeCoins(tx, me.id, -price, giftTo ? 'gift_item' : 'purchase', itemId)
        await tx
          .insert(userItems)
          .values({ userId: owner, itemId, giftedBy: giftTo ? me.id : null })
        // Buying for yourself puts it on straight away.
        if (!giftTo)
          await tx
            .update(users)
            .set({ decoration: custom ? cosmeticDecoration(custom) : itemId })
            .where(eq(users.id, me.id))
        // The student who made it earns most of the price.
        if (custom) {
          await tx
            .update(cosmetics)
            .set({ sales: sql`${cosmetics.sales} + 1` })
            .where(eq(cosmetics.id, custom.id))
          if (custom.creatorId !== me.id)
            await changeCoins(
              tx,
              custom.creatorId,
              Math.floor(price * CREATOR_SHARE),
              'sale',
              itemId,
            )
        }
      })
      return loadWallet(ctx, me.id)
    },
  )

  app.put(
    '/api/me/decoration',
    { schema: { body: z.object({ itemId: z.string().max(60).nullable() }) } },
    async (req) => {
      const me = requireUser(req)
      const { itemId } = req.body
      let decoration: string | null = null
      if (itemId) {
        const owned = await ctx.db.query.userItems.findFirst({
          where: and(eq(userItems.userId, me.id), eq(userItems.itemId, itemId)),
        })
        if (!owned) throw badRequest("You don't own that decoration.")
        const m = CUSTOM.exec(itemId)
        if (m) {
          const c = await ctx.db.query.cosmetics.findFirst({ where: eq(cosmetics.id, m[1]!) })
          if (!c) throw badRequest('That decoration no longer exists.')
          decoration = cosmeticDecoration(c)
        } else if (decorationById(itemId)) {
          decoration = itemId
        } else throw badRequest("You don't own that decoration.")
      }
      await ctx.db.update(users).set({ decoration }).where(eq(users.id, me.id))
      return loadWallet(ctx, me.id)
    },
  )

  // --- Student-made cosmetics ----------------------------------------------------------

  app.get(
    '/api/orgs/:orgId/cosmetics',
    {
      schema: {
        params: orgParams,
        querystring: z.object({
          view: z.enum(['shop', 'mine', 'review']).default('shop'),
        }),
      },
    },
    async (req): Promise<Cosmetic[]> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { view } = req.query
      if (view === 'review') authorize(scope, 'audit.read')
      const rows = await ctx.db
        .select({
          c: cosmetics,
          creator: { id: users.id, name: users.name, displayName: users.displayName },
        })
        .from(cosmetics)
        .innerJoin(users, eq(users.id, cosmetics.creatorId))
        .where(
          and(
            eq(cosmetics.orgId, scope.orgId),
            view === 'shop'
              ? eq(cosmetics.status, 'approved')
              : view === 'mine'
                ? eq(cosmetics.creatorId, scope.userId)
                : eq(cosmetics.status, 'pending'),
          ),
        )
        .orderBy(view === 'shop' ? desc(cosmetics.sales) : desc(cosmetics.id))
        .limit(200)
      return rows.map((r) => serializeCosmetic(r.c, r.creator))
    },
  )

  app.post(
    '/api/orgs/:orgId/cosmetics',
    {
      schema: {
        params: orgParams,
        body: z.object({
          name: z.string().trim().min(2).max(40),
          description: z.string().trim().max(140).default(''),
          price: z.number().int().min(COSMETIC_PRICE.min).max(COSMETIC_PRICE.max),
          frameFileId: z.uuid().nullable().default(null),
          stickerFileId: z.uuid().nullable().default(null),
          stickerPosition: z.enum(STICKER_POSITIONS).default('tr'),
        }),
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const b = req.body
      if (!b.frameFileId && !b.stickerFileId)
        throw badRequest('Add a frame image, a sticker image, or both.')
      if (censorText(b.name).hits || censorText(b.description).hits)
        throw badRequest('Keep the name and description school-friendly.')
      const ids = [b.frameFileId, b.stickerFileId].filter((x): x is string => !!x)
      const mine = await ctx.db
        .select({ id: files.id })
        .from(files)
        .where(
          and(
            inArray(files.id, ids),
            eq(files.uploaderId, scope.userId),
            eq(files.purpose, 'cosmetic'),
            isNull(files.deletedAt),
          ),
        )
      if (mine.length !== ids.length) throw badRequest('Upload the images first.')
      const [{ pending } = { pending: 0 }] = await ctx.db
        .select({ pending: sql<number>`count(*)::int` })
        .from(cosmetics)
        .where(and(eq(cosmetics.creatorId, scope.userId), eq(cosmetics.status, 'pending')))
      if (pending >= 5)
        throw badRequest('You have 5 cosmetics waiting for review. Wait for a teacher first.')
      const [row] = await ctx.db
        .insert(cosmetics)
        .values({
          orgId: scope.orgId,
          creatorId: scope.userId,
          name: b.name,
          description: b.description,
          price: b.price,
          frameFileId: b.frameFileId,
          stickerFileId: b.stickerFileId,
          stickerPosition: b.stickerPosition,
        })
        .returning()
      const me = await ctx.db.query.users.findFirst({
        where: eq(users.id, scope.userId),
        columns: { id: true, name: true, displayName: true },
      })
      return reply.code(201).send(serializeCosmetic(row!, me!))
    },
  )

  /** Teachers approve or reject a student-made cosmetic (or take an approved one down). */
  app.post(
    '/api/orgs/:orgId/cosmetics/:id/review',
    {
      schema: {
        params: orgIdParams,
        body: z.object({
          approve: z.boolean(),
          note: z.string().trim().max(200).optional(),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'audit.read')
      const c = await ctx.db.query.cosmetics.findFirst({
        where: and(eq(cosmetics.id, req.params.id), eq(cosmetics.orgId, scope.orgId)),
      })
      if (!c) throw notFound('Cosmetic')
      const status = req.body.approve ? 'approved' : 'rejected'
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(cosmetics)
          .set({
            status,
            reviewNote: req.body.note ?? null,
            reviewedBy: scope.userId,
            reviewedAt: new Date(),
          })
          .where(eq(cosmetics.id, c.id))
        // The creator always gets their own cosmetic once it's approved.
        if (req.body.approve)
          await tx
            .insert(userItems)
            .values({ userId: c.creatorId, itemId: `u:${c.id}` })
            .onConflictDoNothing()
      })
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: req.body.approve ? 'cosmetic.approved' : 'cosmetic.rejected',
        targetType: 'cosmetic',
        targetId: c.id,
        metadata: { name: c.name, note: req.body.note ?? null },
        ip: req.ip,
      })
      return { ok: true, status }
    },
  )

  /** Creators can delete their own unapproved cosmetics. */
  app.delete('/api/orgs/:orgId/cosmetics/:id', { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const c = await ctx.db.query.cosmetics.findFirst({
      where: and(eq(cosmetics.id, req.params.id), eq(cosmetics.orgId, scope.orgId)),
    })
    if (!c) throw notFound('Cosmetic')
    if (c.creatorId !== scope.userId) throw forbidden()
    if (c.status === 'approved')
      throw badRequest("Approved cosmetics can't be deleted, since people may own them.")
    await ctx.db.delete(cosmetics).where(eq(cosmetics.id, c.id))
    return { ok: true }
  })

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

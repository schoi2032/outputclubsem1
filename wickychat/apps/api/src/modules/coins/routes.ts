/**
 * WickyChat: wallet, daily bonus, the Shop (built-in and student-made decorations), gifting,
 * teachers rewarding coins, and the review queue for student-made cosmetics.
 */
import {
  coinTransactions,
  cosmetics,
  files,
  orgMemberships,
  userCrates,
  userItems,
  users,
} from '@quid/db'
import {
  COIN_GIFT,
  COINS,
  COSMETIC_PRICE,
  COSMETIC_STOCK,
  type CoinTransaction,
  type Cosmetic,
  CRATE_IDS,
  CREATOR_SHARE,
  censorText,
  cosmeticDecoration,
  customImageValue,
  DECORATION_IDS,
  decorationById,
  EFFECT_IDS,
  effectById,
  isEventLive,
  MAX_THEME_CSS,
  PLATE_IDS,
  plateById,
  STICKER_POSITIONS,
  STREAK_CRATE,
  type StickerPosition,
  sanitizeThemeCss,
  streakBonus,
  THEME_IDS,
  themeById,
  type Wallet,
} from '@quid/shared'
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '../../core/audit'
import { authorize, requireOrg, requireUser } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { avatarUrl } from '../users/serialize'
import { changeCoins, currentStreak, earnedFromMessagesToday, startOfSchoolDay } from './service'

const CUSTOM = /^u:([0-9a-f-]{36})$/

/** Which column an item goes in when it's put on, and what's stored there. */
function equipFor(
  itemId: string,
  custom?: {
    id: string
    kind: string
    frameFileId: string | null
    stickerFileId: string | null
    stickerPosition: string
  },
): Partial<typeof users.$inferInsert> {
  if (themeById(itemId) || custom?.kind === 'theme') return { appTheme: itemId }
  if (effectById(itemId)) return { profileEffect: itemId }
  if (plateById(itemId)) return { namePlate: itemId }
  if (custom?.kind === 'effect') return { profileEffect: customImageValue(custom) }
  if (custom?.kind === 'plate') return { namePlate: customImageValue(custom) }
  return { decoration: custom ? cosmeticDecoration(custom) : itemId }
}

type CosmeticRow = typeof cosmetics.$inferSelect

export function serializeCosmetic(
  c: CosmeticRow,
  creator: { id: string; name: string; displayName: string | null },
): Cosmetic {
  return {
    id: c.id,
    kind: c.kind as Cosmetic['kind'],
    css: c.kind === 'theme' ? c.css : null,
    decoration: c.kind === 'decoration' ? cosmeticDecoration(c) : '',
    value: c.kind === 'effect' || c.kind === 'plate' ? customImageValue(c) : `u:${c.id}`,
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
    visibility: c.visibility as Cosmetic['visibility'],
    stock: c.stock,
    createdAt: c.createdAt.toISOString(),
  }
}

export async function loadWallet(ctx: AppContext, userId: string): Promise<Wallet> {
  const [u, owned, history, earned, crates, sent] = await Promise.all([
    ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        coins: true,
        decoration: true,
        appTheme: true,
        dailyClaimedAt: true,
        dailyStreak: true,
        profileEffect: true,
        namePlate: true,
      },
    }),
    ctx.db
      .select({
        itemId: userItems.itemId,
        serial: userItems.serial,
        giverId: userItems.giftedBy,
        giverName: users.name,
      })
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
    ctx.db
      .select({
        id: userCrates.id,
        crateId: userCrates.crateId,
        giverId: userCrates.giftedBy,
        giverName: users.name,
      })
      .from(userCrates)
      .leftJoin(users, eq(users.id, userCrates.giftedBy))
      .where(and(eq(userCrates.userId, userId), isNull(userCrates.openedAt)))
      .orderBy(desc(userCrates.id))
      .limit(200),
    coinsSentToday(ctx, userId),
  ])
  if (!u) throw notFound('User')
  const valid = owned.filter(
    (o) =>
      DECORATION_IDS.includes(o.itemId) ||
      THEME_IDS.includes(o.itemId) ||
      EFFECT_IDS.includes(o.itemId) ||
      PLATE_IDS.includes(o.itemId) ||
      CUSTOM.test(o.itemId),
  )
  const giftedBy: Wallet['giftedBy'] = {}
  for (const o of valid)
    if (o.giverId && o.giverName) giftedBy[o.itemId] = { id: o.giverId, name: o.giverName }
  const serials: Wallet['serials'] = {}
  for (const o of valid) if (o.serial) serials[o.itemId] = o.serial
  return {
    crates: crates
      .filter((c) => CRATE_IDS.includes(c.crateId))
      .map((c) => ({
        id: c.id,
        crateId: c.crateId,
        giftedBy: c.giverId && c.giverName ? { id: c.giverId, name: c.giverName } : null,
      })),
    serials,
    coinsSentToday: sent,
    coins: u.coins,
    owned: valid.map((o) => o.itemId),
    giftedBy,
    equipped: u.decoration,
    equippedTheme: u.appTheme,
    equippedEffect: u.profileEffect,
    equippedPlate: u.namePlate,
    streak: currentStreak(u.dailyClaimedAt, u.dailyStreak),
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

async function coinsSentToday(ctx: AppContext, userId: string) {
  const [row] = await ctx.db
    .select({ n: sql<number>`coalesce(-sum(${coinTransactions.amount}), 0)::int` })
    .from(coinTransactions)
    .where(
      and(
        eq(coinTransactions.userId, userId),
        eq(coinTransactions.reason, 'coins_sent'),
        gte(coinTransactions.createdAt, startOfSchoolDay()),
      ),
    )
  return Number(row?.n ?? 0)
}

/**
 * Takes one copy of a student-made cosmetic, if any are left (limited ones). Returns the copy
 * number for limited ones, null for unlimited, or throws when it's sold out.
 */
export async function takeCopy(
  tx: Parameters<Parameters<AppContext['db']['transaction']>[0]>[0],
  id: string,
) {
  const [row] = await tx
    .update(cosmetics)
    .set({ sales: sql`${cosmetics.sales} + 1` })
    .where(
      and(
        eq(cosmetics.id, id),
        or(isNull(cosmetics.stock), sql`${cosmetics.sales} < ${cosmetics.stock}`),
      ),
    )
    .returning({ sales: cosmetics.sales, stock: cosmetics.stock })
  if (!row) throw conflict('Sold out! Every copy of this one is taken.')
  return row.stock ? row.sales : null
}

/** Both people must be active members of the same school organization. */
export async function sameOrg(ctx: AppContext, a: string, b: string) {
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
        .select({ at: users.dailyClaimedAt, streak: users.dailyStreak, best: users.bestStreak })
        .from(users)
        .where(eq(users.id, me.id))
        .for('update')
      if (u?.at && u.at >= startOfSchoolDay())
        throw conflict("You've already claimed today's coins. Come back tomorrow!")
      // Claimed yesterday too? The streak keeps going.
      const streak = currentStreak(u?.at ?? null, u?.streak ?? 0) + 1
      await tx
        .update(users)
        .set({
          dailyClaimedAt: new Date(),
          dailyStreak: streak,
          bestStreak: Math.max(streak, u?.best ?? 0),
        })
        .where(eq(users.id, me.id))
      await changeCoins(tx, me.id, COINS.daily + streakBonus(streak), 'daily')
      // Every 7 days in a row: a free crate.
      if (streak % STREAK_CRATE.every === 0)
        await tx.insert(userCrates).values({ userId: me.id, crateId: STREAK_CRATE.crateId })
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
      const builtin =
        decorationById(itemId) ?? themeById(itemId) ?? effectById(itemId) ?? plateById(itemId)
      const m = CUSTOM.exec(itemId)
      if (builtin) {
        if ('event' in builtin && builtin.event && !isEventLive(builtin.event))
          throw badRequest('That event is over. Look for one on the Market or trade for it!')
        price = builtin.price
      } else if (m) {
        custom = await ctx.db.query.cosmetics.findFirst({ where: eq(cosmetics.id, m[1]!) })
        if (custom?.status !== 'approved') throw notFound('Item')
        if (custom.visibility === 'private') throw notFound('Item')
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
        const serial = custom ? await takeCopy(tx, custom.id) : null
        await tx
          .insert(userItems)
          .values({ userId: owner, itemId, giftedBy: giftTo ? me.id : null, serial })
        // Buying for yourself puts it on straight away.
        if (!giftTo) await tx.update(users).set(equipFor(itemId, custom)).where(eq(users.id, me.id))
        // The student who made it earns most of the price.
        if (custom) {
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
          if (c?.kind !== 'decoration') throw badRequest('That decoration no longer exists.')
          decoration = cosmeticDecoration(c)
        } else if (decorationById(itemId)) {
          decoration = itemId
        } else throw badRequest("You don't own that decoration.")
      }
      await ctx.db.update(users).set({ decoration }).where(eq(users.id, me.id))
      return loadWallet(ctx, me.id)
    },
  )

  /** Puts on (or takes off, with null) a profile effect or name plate you own. */
  app.put(
    '/api/me/equip',
    {
      schema: {
        body: z.object({
          slot: z.enum(['effect', 'plate']),
          itemId: z.string().max(60).nullable(),
        }),
      },
    },
    async (req) => {
      const me = requireUser(req)
      const { slot, itemId } = req.body
      const column = slot === 'effect' ? 'profileEffect' : 'namePlate'
      let value: string | null = null
      if (itemId) {
        const owned = await ctx.db.query.userItems.findFirst({
          where: and(eq(userItems.userId, me.id), eq(userItems.itemId, itemId)),
        })
        if (!owned) throw badRequest("You don't own that.")
        const m = CUSTOM.exec(itemId)
        const custom = m
          ? await ctx.db.query.cosmetics.findFirst({ where: eq(cosmetics.id, m[1]!) })
          : undefined
        const set = equipFor(itemId, custom)
        if (!(column in set)) throw badRequest("That doesn't go there.")
        value = set[column] ?? null
      }
      await ctx.db
        .update(users)
        .set({ [column]: value })
        .where(eq(users.id, me.id))
      return loadWallet(ctx, me.id)
    },
  )

  /** Puts on (or takes off, with null) an app theme you own. */
  app.put(
    '/api/me/theme',
    { schema: { body: z.object({ itemId: z.string().max(60).nullable() }) } },
    async (req) => {
      const me = requireUser(req)
      const { itemId } = req.body
      if (itemId) {
        const owned = await ctx.db.query.userItems.findFirst({
          where: and(eq(userItems.userId, me.id), eq(userItems.itemId, itemId)),
        })
        const m = CUSTOM.exec(itemId)
        const ok =
          owned &&
          (themeById(itemId) ||
            (m &&
              (await ctx.db.query.cosmetics.findFirst({
                where: and(eq(cosmetics.id, m[1]!), eq(cosmetics.kind, 'theme')),
                columns: { id: true },
              }))))
        if (!ok) throw badRequest("You don't own that theme.")
      }
      await ctx.db.update(users).set({ appTheme: itemId }).where(eq(users.id, me.id))
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
              ? and(
                  eq(cosmetics.status, 'approved'),
                  or(
                    eq(cosmetics.visibility, 'public'),
                    eq(cosmetics.creatorId, scope.userId),
                    sql`exists (select 1 from ${userItems} where ${userItems.userId} = ${scope.userId} and ${userItems.itemId} = 'u:' || ${cosmetics.id}::text)`,
                  ),
                )
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
          kind: z.enum(['decoration', 'theme', 'effect', 'plate']).default('decoration'),
          css: z.string().max(MAX_THEME_CSS).optional(),
          frameFileId: z.uuid().nullable().default(null),
          stickerFileId: z.uuid().nullable().default(null),
          stickerPosition: z.enum(STICKER_POSITIONS).default('tr'),
          visibility: z.enum(['public', 'private']).default('public'),
          stock: z
            .number()
            .int()
            .min(COSMETIC_STOCK.min)
            .max(COSMETIC_STOCK.max)
            .nullable()
            .default(null),
        }),
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const b = req.body
      const isTheme = b.kind === 'theme'
      const css = isTheme ? sanitizeThemeCss(b.css ?? '').css : null
      if (isTheme && !css) throw badRequest('Write some CSS for your theme.')
      const isImage = b.kind === 'effect' || b.kind === 'plate'
      if (isImage && !b.frameFileId) throw badRequest('Add an image.')
      if (b.kind === 'decoration' && !b.frameFileId && !b.stickerFileId)
        throw badRequest('Add a frame image, a sticker image, or both.')
      if (censorText(b.name).hits || censorText(b.description).hits)
        throw badRequest('Keep the name and description school-friendly.')
      if (css && censorText(css).hits)
        throw badRequest('Keep the CSS (and its comments) school-friendly.')
      const ids = isTheme ? [] : [b.frameFileId, b.stickerFileId].filter((x): x is string => !!x)
      const mine = !ids.length
        ? []
        : await ctx.db
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
          kind: b.kind,
          css,
          frameFileId: isTheme ? null : b.frameFileId,
          stickerFileId: isTheme || isImage ? null : b.stickerFileId,
          stickerPosition: b.stickerPosition,
          visibility: b.visibility,
          stock: b.stock,
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

  /**
   * The creator of a private cosmetic gives someone a copy. Free, but limited ones still only
   * have so many copies. The person who gets it can use it but can't sell, trade or pass it on.
   */
  app.post(
    '/api/orgs/:orgId/cosmetics/:id/give',
    { schema: { params: orgIdParams, body: z.object({ to: z.uuid() }) } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const c = await ctx.db.query.cosmetics.findFirst({
        where: and(eq(cosmetics.id, req.params.id), eq(cosmetics.orgId, scope.orgId)),
      })
      if (!c) throw notFound('Cosmetic')
      if (c.creatorId !== scope.userId)
        throw forbidden('Only the person who made it can give copies.')
      if (c.visibility !== 'private')
        throw badRequest('This one is sold in the Shop. Gift it from there instead.')
      if (c.status !== 'approved') throw badRequest('A teacher needs to approve it first.')
      const to = req.body.to
      if (to === scope.userId) throw badRequest('You already have it.')
      const target = await ctx.db.query.orgMemberships.findFirst({
        where: and(
          eq(orgMemberships.orgId, scope.orgId),
          eq(orgMemberships.userId, to),
          isNull(orgMemberships.deactivatedAt),
        ),
        columns: { id: true },
      })
      if (!target) throw notFound('Person')
      const itemId = `u:${c.id}`
      await ctx.db.transaction(async (tx) => {
        const has = await tx.query.userItems.findFirst({
          where: and(eq(userItems.userId, to), eq(userItems.itemId, itemId)),
        })
        if (has) throw conflict('They already have this one.')
        const serial = await takeCopy(tx, c.id)
        await tx.insert(userItems).values({ userId: to, itemId, giftedBy: scope.userId, serial })
      })
      return { ok: true }
    },
  )

  /** Students send some of their own coins to someone. */
  app.post(
    '/api/orgs/:orgId/members/:id/send-coins',
    {
      schema: {
        params: orgIdParams,
        body: z.object({
          amount: z.number().int().min(1).max(COIN_GIFT.max),
          note: z.string().trim().max(80).optional(),
        }),
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const to = req.params.id
      if (to === scope.userId) throw badRequest("You can't send coins to yourself.")
      const target = await ctx.db
        .select({ id: users.id, isBot: users.isBot })
        .from(orgMemberships)
        .innerJoin(users, eq(users.id, orgMemberships.userId))
        .where(
          and(
            eq(orgMemberships.orgId, scope.orgId),
            eq(orgMemberships.userId, to),
            isNull(orgMemberships.deactivatedAt),
          ),
        )
      if (!target[0] || target[0].isBot) throw notFound('Person')
      const { amount } = req.body
      const note = req.body.note ? censorText(req.body.note).text : null
      await ctx.db.transaction(async (tx) => {
        const [u] = await tx
          .select({ coins: users.coins })
          .from(users)
          .where(eq(users.id, scope.userId))
          .for('update')
        if (!u || u.coins < amount) throw badRequest("You don't have that many coins.")
        const sent = await coinsSentToday(ctx, scope.userId)
        if (sent + amount > COIN_GIFT.dailyMax)
          throw badRequest(
            `You can send up to ${COIN_GIFT.dailyMax} coins a day. ${Math.max(0, COIN_GIFT.dailyMax - sent)} left today.`,
          )
        await changeCoins(tx, scope.userId, -amount, 'coins_sent', to)
        await changeCoins(
          tx,
          to,
          amount,
          'coins_received',
          note ? `${scope.userId}|${note}` : scope.userId,
        )
      })
      return loadWallet(ctx, scope.userId)
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

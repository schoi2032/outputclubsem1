/**
 * WickyChat: crates. Bought into your inventory and opened whenever you like (the server rolls
 * the drop). Unopened crates can be gifted or traded.
 */
import { randomInt } from 'node:crypto'
import { cosmetics, customCrates, orgMemberships, userCrates, userItems, users } from '@quid/db'
import {
  CREATOR_SHARE,
  type CrateDef,
  type CrateResult,
  type CrateTier,
  CUSTOM_CRATE,
  type CustomCrate,
  censorText,
  crateById,
  crateOdds,
  customCrateDef,
  isEventLive,
  rollCrate,
  topics,
} from '@quid/shared'
import { and, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireOrg, requireUser } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { toUserSummary, userCols } from '../users/serialize'
import { loadWallet, sameOrg, takeCopy } from './routes'
import { changeCoins } from './service'

type Db = AppContext['db']
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type CustomRow = typeof customCrates.$inferSelect
const CUSTOM = /^u:([0-9a-f-]{36})$/
const creatorCols = { id: users.id, name: users.name, displayName: users.displayName }

function toCustom(r: CustomRow, creator: CustomCrate['creator']): CustomCrate {
  return {
    id: r.id,
    crateId: `u:${r.id}`,
    name: r.name,
    emoji: r.emoji,
    description: r.description,
    colors: [r.colorA, r.colorB],
    price: r.price,
    drops: r.drops.map((d) => ({ item: d.item, tier: d.tier as CrateTier })),
    creator,
    status: r.status as CustomCrate['status'],
    sales: r.sales,
    createdAt: r.createdAt.toISOString(),
  }
}

/** A built-in crate, or a student-made one (`u:<id>`). */
async function resolveCrate(
  db: Db | Tx,
  crateId: string,
): Promise<{ def: CrateDef; row?: CustomRow } | null> {
  const builtin = crateById(crateId)
  if (builtin) return { def: builtin }
  const m = CUSTOM.exec(crateId)
  if (!m) return null
  const [r] = await db
    .select({ c: customCrates, creator: creatorCols })
    .from(customCrates)
    .innerJoin(users, eq(users.id, customCrates.creatorId))
    .where(eq(customCrates.id, m[1]!))
  return r ? { def: customCrateDef(toCustom(r.c, r.creator)), row: r.c } : null
}

/** Student-made items in a crate that can't drop any more (sold out or taken down). */
async function unavailable(db: Db | Tx, def: CrateDef) {
  const ids = def.drops
    .map((d) => ('item' in d ? CUSTOM.exec(d.item)?.[1] : undefined))
    .filter((x): x is string => !!x)
  if (!ids.length) return []
  const rows = await db
    .select({
      id: cosmetics.id,
      status: cosmetics.status,
      stock: cosmetics.stock,
      sales: cosmetics.sales,
    })
    .from(cosmetics)
    .where(inArray(cosmetics.id, ids))
  const ok = new Set(
    rows
      .filter((r) => r.status === 'approved' && (r.stock == null || r.sales < r.stock))
      .map((r) => r.id),
  )
  return ids.filter((id) => !ok.has(id)).map((id) => `u:${id}`)
}

async function ownedBy(db: Db | Tx, userId: string) {
  return new Set(
    (
      await db
        .select({ itemId: userItems.itemId })
        .from(userItems)
        .where(eq(userItems.userId, userId))
    ).map((r) => r.itemId),
  )
}

async function checkPerson(ctx: AppContext, me: string, to: string) {
  if (to === me) throw badRequest("You can't gift something to yourself.")
  const target = await ctx.db.query.users.findFirst({
    where: eq(users.id, to),
    columns: { id: true, isBot: true },
  })
  if (!target || target.isBot || !(await sameOrg(ctx, me, to))) throw notFound('Person')
}

async function notify(ctx: AppContext, userId: string, text: string) {
  const m = await ctx.db.query.orgMemberships.findFirst({
    where: and(eq(orgMemberships.userId, userId), isNull(orgMemberships.deactivatedAt)),
    columns: { orgId: true },
  })
  await ctx.bus.publish(topics.user(userId), { type: 'wicky.updated', orgId: m?.orgId ?? '', text })
}

export async function crateRoutes(app: App, ctx: AppContext) {
  /** Buys a crate for yourself, or for someone else with `giftTo`. It isn't opened yet. */
  app.post(
    '/api/me/crates/buy',
    {
      schema: {
        body: z.object({
          crateId: z.string().max(60),
          giftTo: z.uuid().optional(),
          count: z.number().int().min(1).max(10).default(1),
        }),
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      const me = requireUser(req)
      const { crateId, giftTo, count } = req.body
      const found = await resolveCrate(ctx.db, crateId)
      if (!found) throw notFound('Crate')
      const { def: crate, row: custom } = found
      if (crate.event && !isEventLive(crate.event))
        throw badRequest('That event is over, so its crate is gone from the Shop.')
      if (custom) {
        if (custom.status !== 'active') throw badRequest("That crate isn't for sale any more.")
        const member = await ctx.db.query.orgMemberships.findFirst({
          where: and(
            eq(orgMemberships.orgId, custom.orgId),
            eq(orgMemberships.userId, me.id),
            isNull(orgMemberships.deactivatedAt),
          ),
          columns: { id: true },
        })
        if (!member) throw notFound('Crate')
      }
      if (giftTo) await checkPerson(ctx, me.id, giftTo)
      // Don't sell a crate that can only give coins back.
      const blocked = new Set([
        ...(await ownedBy(ctx.db, giftTo ?? me.id)),
        ...(await unavailable(ctx.db, crate)),
      ])
      if (custom && !crateOdds(crate, blocked).length)
        throw badRequest(
          giftTo
            ? 'They already have everything left in this crate.'
            : 'You already have everything left in this crate.',
        )
      const price = crate.price * count
      await ctx.db.transaction(async (tx) => {
        const [u] = await tx
          .select({ coins: users.coins })
          .from(users)
          .where(eq(users.id, me.id))
          .for('update')
        if (!u || u.coins < price)
          throw badRequest(`You need ${price - (u?.coins ?? 0)} more Wicky Coins for this.`)
        await changeCoins(tx, me.id, -price, giftTo ? 'crate_gift' : 'crate', crateId)
        await tx.insert(userCrates).values(
          Array.from({ length: count }, () => ({
            userId: giftTo ?? me.id,
            crateId,
            giftedBy: giftTo ? me.id : null,
          })),
        )
        // The student who made the crate earns most of the price.
        if (custom) {
          await tx
            .update(customCrates)
            .set({ sales: sql`${customCrates.sales} + ${count}` })
            .where(eq(customCrates.id, custom.id))
          if (custom.creatorId !== me.id)
            await changeCoins(
              tx,
              custom.creatorId,
              Math.floor(price * CREATOR_SHARE),
              'crate_sale',
              crateId,
            )
        }
      })
      if (giftTo) await notify(ctx, giftTo, `🎁 ${me.name} sent you a ${crate.name}!`)
      return loadWallet(ctx, me.id)
    },
  )

  /** Opens a crate. The drop is rolled here, never in the browser. */
  app.post(
    '/api/me/crates/:id/open',
    {
      schema: { params: z.object({ id: z.uuid() }) },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req) => {
      const me = requireUser(req)
      const result = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(userCrates)
          .where(and(eq(userCrates.id, req.params.id), eq(userCrates.userId, me.id)))
          .for('update')
        if (!row) throw notFound('Crate')
        if (row.openedAt) throw conflict('That crate is already open.')
        const found = await resolveCrate(tx, row.crateId)
        if (!found) throw notFound('Crate')
        const crate = found.def
        const blocked = new Set([...(await ownedBy(tx, me.id)), ...(await unavailable(tx, crate))])
        // Nothing left you don't own: some coins back instead.
        const drop: CrateResult = crateOdds(crate, blocked).length
          ? rollCrate(crate, blocked, randomInt(0, 1_000_000) / 1_000_000)
          : { tier: 'common', coins: Math.max(1, Math.floor(crate.price * CUSTOM_CRATE.refund)) }
        if ('item' in drop) {
          const m = CUSTOM.exec(drop.item)
          const serial = m ? await takeCopy(tx, m[1]!) : null
          await tx
            .insert(userItems)
            .values({ userId: me.id, itemId: drop.item, serial })
            .onConflictDoNothing()
        } else await changeCoins(tx, me.id, drop.coins, 'crate_coins', crate.id)
        await tx
          .update(userCrates)
          .set({ openedAt: new Date(), result: drop })
          .where(eq(userCrates.id, row.id))
        return drop
      })
      return { result, wallet: await loadWallet(ctx, me.id) }
    },
  )

  /** Gives an unopened crate you own to someone else. */
  app.post(
    '/api/me/crates/:id/gift',
    { schema: { params: z.object({ id: z.uuid() }), body: z.object({ to: z.uuid() }) } },
    async (req) => {
      const me = requireUser(req)
      await checkPerson(ctx, me.id, req.body.to)
      const [row] = await ctx.db
        .update(userCrates)
        .set({ userId: req.body.to, giftedBy: me.id })
        .where(
          and(
            eq(userCrates.id, req.params.id),
            eq(userCrates.userId, me.id),
            isNull(userCrates.openedAt),
          ),
        )
        .returning({ crateId: userCrates.crateId })
      if (!row) throw notFound('Crate')
      await notify(
        ctx,
        req.body.to,
        `🎁 ${me.name} sent you a ${crateById(row.crateId)?.name ?? 'crate'}!`,
      )
      return loadWallet(ctx, me.id)
    },
  )

  /** Your last openings. */
  app.get('/api/me/crates/opened', async (req) => {
    const me = requireUser(req)
    const rows = await ctx.db
      .select({
        id: userCrates.id,
        crateId: userCrates.crateId,
        result: userCrates.result,
        openedAt: userCrates.openedAt,
      })
      .from(userCrates)
      .where(and(eq(userCrates.userId, me.id), sql`${userCrates.openedAt} is not null`))
      .orderBy(desc(userCrates.openedAt))
      .limit(20)
    return rows.map((r) => ({ ...r, openedAt: r.openedAt?.toISOString() }))
  })

  /** Big drops (epic and legendary) people in the school got this week. */
  app.get('/api/orgs/:orgId/crates/feed', { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const rows = await ctx.db
      .select({
        id: userCrates.id,
        crateId: userCrates.crateId,
        result: userCrates.result,
        openedAt: userCrates.openedAt,
        user: userCols,
      })
      .from(userCrates)
      .innerJoin(users, eq(users.id, userCrates.userId))
      .innerJoin(
        orgMemberships,
        and(eq(orgMemberships.userId, users.id), eq(orgMemberships.orgId, scope.orgId)),
      )
      .where(
        and(
          gte(userCrates.openedAt, new Date(Date.now() - 7 * 86_400_000)),
          inArray(sql`${userCrates.result}->>'tier'`, ['epic', 'legendary']),
        ),
      )
      .orderBy(desc(userCrates.openedAt))
      .limit(15)
    return rows.map((r) => ({
      id: r.id,
      crateId: r.crateId,
      result: r.result,
      openedAt: r.openedAt?.toISOString(),
      user: toUserSummary(r.user),
    }))
  })

  // --- Student-made crates ---------------------------------------------------------------

  app.get(
    '/api/orgs/:orgId/crates/custom',
    { schema: { params: orgParams } },
    async (req): Promise<CustomCrate[]> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const rows = await ctx.db
        .select({ c: customCrates, creator: creatorCols })
        .from(customCrates)
        .innerJoin(users, eq(users.id, customCrates.creatorId))
        .where(eq(customCrates.orgId, scope.orgId))
        .orderBy(desc(customCrates.sales))
        .limit(300)
      return rows.map((r) => toCustom(r.c, r.creator))
    },
  )

  app.post(
    '/api/orgs/:orgId/crates/custom',
    {
      schema: {
        params: orgParams,
        body: z.object({
          name: z.string().trim().min(2).max(40),
          emoji: z.string().trim().min(1).max(16),
          description: z.string().trim().max(140).default(''),
          colors: z.tuple([
            z.string().regex(/^#[0-9a-fA-F]{6}$/),
            z.string().regex(/^#[0-9a-fA-F]{6}$/),
          ]),
          price: z.number().int().min(CUSTOM_CRATE.price.min).max(CUSTOM_CRATE.price.max),
          drops: z
            .array(
              z.object({
                item: z.string().regex(CUSTOM),
                tier: z.enum(['common', 'rare', 'epic', 'legendary']),
              }),
            )
            .min(CUSTOM_CRATE.minItems)
            .max(CUSTOM_CRATE.maxItems),
        }),
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const b = req.body
      if (censorText(b.name).hits || censorText(b.description).hits || censorText(b.emoji).hits)
        throw badRequest('Keep the name and description school-friendly.')
      if ([...b.emoji].length > 2 || /[A-Za-z0-9<>]/.test(b.emoji))
        throw badRequest('Pick one emoji for the crate.')
      const items = [...new Set(b.drops.map((d) => d.item))]
      if (items.length !== b.drops.length) throw badRequest('Each item can only be in it once.')
      const ids = items.map((i) => CUSTOM.exec(i)![1]!)
      const mine = await ctx.db
        .select({ id: cosmetics.id })
        .from(cosmetics)
        .where(
          and(
            inArray(cosmetics.id, ids),
            eq(cosmetics.orgId, scope.orgId),
            eq(cosmetics.creatorId, scope.userId),
            eq(cosmetics.status, 'approved'),
            eq(cosmetics.visibility, 'public'),
          ),
        )
      if (mine.length !== ids.length)
        throw badRequest('Crates can only hold your own approved cosmetics that are for sale.')
      const [{ n } = { n: 0 }] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(customCrates)
        .where(and(eq(customCrates.creatorId, scope.userId), eq(customCrates.status, 'active')))
      if (n >= CUSTOM_CRATE.maxActive)
        throw badRequest(`You can have ${CUSTOM_CRATE.maxActive} crates on sale. Remove one first.`)
      const [row] = await ctx.db
        .insert(customCrates)
        .values({
          orgId: scope.orgId,
          creatorId: scope.userId,
          name: b.name,
          emoji: b.emoji,
          description: b.description,
          colorA: b.colors[0],
          colorB: b.colors[1],
          price: b.price,
          drops: b.drops,
        })
        .returning()
      const [creator] = await ctx.db
        .select(creatorCols)
        .from(users)
        .where(eq(users.id, scope.userId))
      return reply.code(201).send(toCustom(row!, creator!))
    },
  )

  /** Takes a crate off sale (its maker, or a teacher). Crates people already own still open. */
  app.delete(
    '/api/orgs/:orgId/crates/custom/:id',
    { schema: { params: orgIdParams } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const c = await ctx.db.query.customCrates.findFirst({
        where: and(eq(customCrates.id, req.params.id), eq(customCrates.orgId, scope.orgId)),
      })
      if (!c) throw notFound('Crate')
      const teacher = scope.role === 'owner' || scope.role === 'admin'
      if (c.creatorId !== scope.userId && !teacher) throw forbidden()
      await ctx.db
        .update(customCrates)
        .set({ status: 'removed' })
        .where(and(eq(customCrates.id, c.id), ne(customCrates.status, 'removed')))
      return { ok: true }
    },
  )
}

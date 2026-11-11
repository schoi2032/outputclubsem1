/**
 * WickyChat: crates. Bought into your inventory and opened whenever you like (the server rolls
 * the drop). Unopened crates can be gifted or traded.
 */
import { randomInt } from 'node:crypto'
import { orgMemberships, userCrates, userItems, users } from '@quid/db'
import { type CrateResult, crateById, isEventLive, rollCrate, topics } from '@quid/shared'
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireOrg, requireUser } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, notFound } from '../../core/errors'
import { type App, orgParams } from '../../core/http'
import { toUserSummary, userCols } from '../users/serialize'
import { loadWallet, sameOrg } from './routes'
import { changeCoins } from './service'

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
          crateId: z.string().max(40),
          giftTo: z.uuid().optional(),
          count: z.number().int().min(1).max(10).default(1),
        }),
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      const me = requireUser(req)
      const { crateId, giftTo, count } = req.body
      const crate = crateById(crateId)
      if (!crate) throw notFound('Crate')
      if (crate.event && !isEventLive(crate.event))
        throw badRequest('That event is over, so its crate is gone from the Shop.')
      if (giftTo) await checkPerson(ctx, me.id, giftTo)
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
        const crate = crateById(row.crateId)
        if (!crate) throw notFound('Crate')
        const owned = new Set(
          (
            await tx
              .select({ itemId: userItems.itemId })
              .from(userItems)
              .where(eq(userItems.userId, me.id))
          ).map((r) => r.itemId),
        )
        const drop = rollCrate(crate, owned, randomInt(0, 1_000_000) / 1_000_000)
        if ('item' in drop)
          await tx
            .insert(userItems)
            .values({ userId: me.id, itemId: drop.item })
            .onConflictDoNothing()
        else await changeCoins(tx, me.id, drop.coins, 'crate_coins', crate.id)
        await tx
          .update(userCrates)
          .set({ openedAt: new Date(), result: drop })
          .where(eq(userCrates.id, row.id))
        return drop as CrateResult
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
}

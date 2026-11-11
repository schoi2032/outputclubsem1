/**
 * WickyChat: trading. One person offers items, crates and coins for some of the other person's.
 * Nothing moves until the other person accepts; then everything swaps at once, or nothing does.
 */
import {
  cosmetics,
  marketListings,
  orgMemberships,
  trades,
  userCrates,
  userItems,
  users,
} from '@quid/db'
import {
  censorText,
  type Inventory,
  TRADE_LIMITS,
  type Trade,
  type TradeSide,
  topics,
} from '@quid/shared'
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { toUserSummary, userCols } from '../users/serialize'
import { serializeCosmetic } from './routes'
import { changeCoins, takeOffItem } from './service'

type Db = AppContext['db']
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const CUSTOM = /^u:([0-9a-f-]{36})$/
const side = z.object({
  items: z.array(z.string().max(60)).max(TRADE_LIMITS.items).default([]),
  crates: z.array(z.uuid()).max(TRADE_LIMITS.crates).default([]),
  coins: z.number().int().min(0).max(TRADE_LIMITS.coins).default(0),
})

const uniq = (s: TradeSide): TradeSide => ({
  items: [...new Set(s.items)],
  crates: [...new Set(s.crates)],
  coins: s.coins,
})

async function cosmeticsFor(db: Db | Tx, itemIds: string[]) {
  const ids = itemIds.map((i) => CUSTOM.exec(i)?.[1]).filter((x): x is string => !!x)
  if (!ids.length) return []
  const rows = await db
    .select({
      c: cosmetics,
      creator: { id: users.id, name: users.name, displayName: users.displayName },
    })
    .from(cosmetics)
    .innerJoin(users, eq(users.id, cosmetics.creatorId))
    .where(inArray(cosmetics.id, ids))
  return rows.map((r) => serializeCosmetic(r.c, r.creator))
}

/**
 * Checks `owner` has everything on their side and `other` doesn't already own those items.
 * Throws a friendly error if not.
 */
async function checkSide(db: Db | Tx, owner: string, other: string, s: TradeSide, who: string) {
  if (s.items.length) {
    const priv = (await cosmeticsFor(db, s.items)).filter((c) => c.visibility === 'private')
    if (priv.length) throw badRequest(`Private items can't be traded (${priv[0]!.name}).`)
    const have = await db
      .select({ itemId: userItems.itemId })
      .from(userItems)
      .where(and(eq(userItems.userId, owner), inArray(userItems.itemId, s.items)))
    if (have.length !== s.items.length)
      throw conflict(`${who} no longer has everything in this trade.`)
    const dup = await db
      .select({ itemId: userItems.itemId })
      .from(userItems)
      .where(and(eq(userItems.userId, other), inArray(userItems.itemId, s.items)))
    if (dup.length) throw conflict('Someone would get an item they already own.')
  }
  if (s.crates.length) {
    const have = await db
      .select({ id: userCrates.id })
      .from(userCrates)
      .where(
        and(
          eq(userCrates.userId, owner),
          inArray(userCrates.id, s.crates),
          isNull(userCrates.openedAt),
        ),
      )
    if (have.length !== s.crates.length) throw conflict(`${who} no longer has those crates.`)
  }
  if (s.coins) {
    const u = await db.query.users.findFirst({
      where: eq(users.id, owner),
      columns: { coins: true },
    })
    if ((u?.coins ?? 0) < s.coins) throw conflict(`${who} doesn't have enough coins.`)
  }
}

/** Moves one side of a trade from `from` to `to` (inside the accept transaction). */
async function moveSide(tx: Tx, from: string, to: string, s: TradeSide, tradeId: string) {
  for (const itemId of s.items) {
    await tx
      .update(userItems)
      .set({ userId: to, giftedBy: null })
      .where(and(eq(userItems.userId, from), eq(userItems.itemId, itemId)))
    await takeOffItem(tx, from, itemId)
    await tx
      .update(marketListings)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(marketListings.sellerId, from),
          eq(marketListings.itemId, itemId),
          eq(marketListings.status, 'open'),
        ),
      )
  }
  if (s.crates.length)
    await tx
      .update(userCrates)
      .set({ userId: to, giftedBy: null })
      .where(and(eq(userCrates.userId, from), inArray(userCrates.id, s.crates)))
  if (s.coins) {
    await changeCoins(tx, from, -s.coins, 'trade', tradeId)
    await changeCoins(tx, to, s.coins, 'trade', tradeId)
  }
}

async function serialize(db: Db, rows: (typeof trades.$inferSelect)[]): Promise<Trade[]> {
  if (!rows.length) return []
  const people = await db
    .select(userCols)
    .from(users)
    .where(inArray(users.id, [...new Set(rows.flatMap((r) => [r.fromId, r.toId]))]))
  const byId = new Map(people.map((p) => [p.id, toUserSummary(p)]))
  const crateIds = rows.flatMap((r) => [...r.give.crates, ...r.get.crates])
  const kinds = crateIds.length
    ? await db
        .select({ id: userCrates.id, crateId: userCrates.crateId })
        .from(userCrates)
        .where(inArray(userCrates.id, crateIds))
    : []
  const kindById = new Map(kinds.map((k) => [k.id, k.crateId]))
  const custom = await cosmeticsFor(
    db,
    rows.flatMap((r) => [...r.give.items, ...r.get.items]),
  )
  return rows.map((r) => ({
    id: r.id,
    from: byId.get(r.fromId)!,
    to: byId.get(r.toId)!,
    give: r.give,
    get: r.get,
    crateKinds: Object.fromEntries(
      [...r.give.crates, ...r.get.crates].map((id) => [id, kindById.get(id) ?? '']),
    ),
    cosmetics: custom.filter((c) => [...r.give.items, ...r.get.items].includes(`u:${c.id}`)),
    note: r.note,
    status: r.status as Trade['status'],
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  }))
}

export async function tradeRoutes(app: App, ctx: AppContext) {
  /** What someone owns that could be traded (private items left out). */
  app.get(
    '/api/orgs/:orgId/members/:id/inventory',
    { schema: { params: orgIdParams } },
    async (req): Promise<Inventory> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const member = await ctx.db.query.orgMemberships.findFirst({
        where: and(eq(orgMemberships.orgId, scope.orgId), eq(orgMemberships.userId, req.params.id)),
        columns: { id: true },
      })
      if (!member) throw notFound('Member')
      const [items, crates] = await Promise.all([
        ctx.db
          .select({ itemId: userItems.itemId })
          .from(userItems)
          .where(eq(userItems.userId, req.params.id)),
        ctx.db
          .select({ id: userCrates.id, crateId: userCrates.crateId })
          .from(userCrates)
          .where(and(eq(userCrates.userId, req.params.id), isNull(userCrates.openedAt)))
          .limit(200),
      ])
      const custom = await cosmeticsFor(
        ctx.db,
        items.map((i) => i.itemId),
      )
      const priv = new Set(custom.filter((c) => c.visibility === 'private').map((c) => `u:${c.id}`))
      return {
        items: items.map((i) => i.itemId).filter((i) => !priv.has(i)),
        crates,
        cosmetics: custom.filter((c) => c.visibility === 'public'),
      }
    },
  )

  app.get('/api/orgs/:orgId/trades', { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const rows = await ctx.db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.orgId, scope.orgId),
          or(eq(trades.fromId, scope.userId), eq(trades.toId, scope.userId)),
        ),
      )
      .orderBy(desc(trades.id))
      .limit(50)
    return serialize(ctx.db, rows)
  })

  app.post(
    '/api/orgs/:orgId/trades',
    {
      schema: {
        params: orgParams,
        body: z.object({
          to: z.uuid(),
          give: side,
          get: side,
          note: z.string().trim().max(140).default(''),
        }),
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const me = scope.userId
      const { to } = req.body
      const give = uniq(req.body.give)
      const get = uniq(req.body.get)
      if (to === me) throw badRequest("You can't trade with yourself.")
      if (!give.items.length && !give.crates.length && !give.coins)
        throw badRequest('Offer something.')
      if (!get.items.length && !get.crates.length && !get.coins)
        throw badRequest('Ask for something back. (To just give stuff away, use a gift.)')
      const target = await ctx.db
        .select({ isBot: users.isBot })
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
      const [{ n } = { n: 0 }] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(trades)
        .where(and(eq(trades.fromId, me), eq(trades.status, 'pending')))
      if (n >= TRADE_LIMITS.pending)
        throw badRequest(`You have ${TRADE_LIMITS.pending} trades waiting. Cancel one first.`)
      await checkSide(ctx.db, me, to, give, 'You')
      await checkSide(ctx.db, to, me, get, 'They')
      const [row] = await ctx.db
        .insert(trades)
        .values({
          orgId: scope.orgId,
          fromId: me,
          toId: to,
          give,
          get,
          note: censorText(req.body.note).text,
        })
        .returning()
      const meRow = await ctx.db.query.users.findFirst({
        where: eq(users.id, me),
        columns: { name: true, displayName: true },
      })
      await ctx.bus.publish(topics.user(to), {
        type: 'wicky.updated',
        orgId: scope.orgId,
        text: `🔁 ${meRow?.displayName || meRow?.name} wants to trade with you. Open the Shop → Trades.`,
      })
      return reply.code(201).send((await serialize(ctx.db, [row!]))[0])
    },
  )

  app.post(
    '/api/orgs/:orgId/trades/:id/:action',
    {
      schema: {
        params: z.object({
          orgId: z.uuid(),
          id: z.uuid(),
          action: z.enum(['accept', 'decline', 'cancel']),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const me = scope.userId
      const { action } = req.params
      let failed: unknown = null
      const t = await ctx.db.transaction(async (tx) => {
        const [t] = await tx
          .select()
          .from(trades)
          .where(and(eq(trades.id, req.params.id), eq(trades.orgId, scope.orgId)))
          .for('update')
        if (!t) throw notFound('Trade')
        if (t.status !== 'pending') throw conflict('This trade is already done.')
        if (action === 'cancel' ? t.fromId !== me : t.toId !== me) throw forbidden()
        if (action !== 'accept') {
          const [row] = await tx
            .update(trades)
            .set({ status: action === 'cancel' ? 'cancelled' : 'declined', resolvedAt: new Date() })
            .where(eq(trades.id, t.id))
            .returning()
          return row!
        }
        // Lock both people's balances in a fixed order so two trades can't deadlock.
        const [a, b] = [t.fromId, t.toId].sort()
        await tx.select({ id: users.id }).from(users).where(eq(users.id, a!)).for('update')
        await tx.select({ id: users.id }).from(users).where(eq(users.id, b!)).for('update')
        try {
          await checkSide(tx, t.fromId, t.toId, t.give, 'They')
          await checkSide(tx, t.toId, t.fromId, t.get, 'You')
        } catch (e) {
          failed = e
          const [row] = await tx
            .update(trades)
            .set({ status: 'failed', resolvedAt: new Date() })
            .where(eq(trades.id, t.id))
            .returning()
          return row!
        }
        await moveSide(tx, t.fromId, t.toId, t.give, t.id)
        await moveSide(tx, t.toId, t.fromId, t.get, t.id)
        const [row] = await tx
          .update(trades)
          .set({ status: 'accepted', resolvedAt: new Date() })
          .where(eq(trades.id, t.id))
          .returning()
        return row!
      })
      if (failed) throw failed
      const other = t.fromId === me ? t.toId : t.fromId
      const meRow = await ctx.db.query.users.findFirst({
        where: eq(users.id, me),
        columns: { name: true, displayName: true },
      })
      const who = meRow?.displayName || meRow?.name
      await ctx.bus.publish(topics.user(other), {
        type: 'wicky.updated',
        orgId: scope.orgId,
        text:
          action === 'accept'
            ? `✅ ${who} accepted your trade!`
            : action === 'decline'
              ? `${who} declined your trade.`
              : '',
      })
      return (await serialize(ctx.db, [t]))[0]
    },
  )
}

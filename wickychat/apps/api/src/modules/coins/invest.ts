/**
 * WickyChat Stock Market: buy and sell copies of items at prices that follow demand, and
 * back people with shares (see INVEST in @quid/shared for the rules and why they're safe).
 */
import {
  coinTransactions,
  cosmetics,
  holdings,
  marketListings,
  marketSupply,
  orgMemberships,
  personShares,
  priceTicks,
  userItems,
  users,
} from '@quid/db'
import {
  BUBBLE_IDS,
  builtinItem,
  builtinMakers,
  buyPrice,
  buyTotal,
  CREATOR_SHARE,
  DECORATION_IDS,
  EFFECT_IDS,
  INVEST,
  isEventLive,
  type MarketQuote,
  type PersonQuote,
  PLATE_IDS,
  type Portfolio,
  personKey,
  sellPrice,
  sellTotal,
  THEME_IDS,
} from '@quid/shared'
import { and, asc, eq, gt, gte, inArray, isNull, lte, sql, sum } from 'drizzle-orm'
import { z } from 'zod'
import { requireOrg, requireUser } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, notFound } from '../../core/errors'
import { type App, orgParams } from '../../core/http'
import { toUserSummary, userCols } from '../users/serialize'
import { CUSTOM_ITEM } from './contents'
import { loadWallet } from './routes'
import { changeCoins, takeOffItem } from './service'

type Db = AppContext['db']
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const BUILTIN_IDS = [...DECORATION_IDS, ...EFFECT_IDS, ...PLATE_IDS, ...BUBBLE_IDS, ...THEME_IDS]
const PERSON = /^p:([0-9a-f-]{36})$/

export interface Listed {
  base: number
  /** Someone gets the base price on each buy (a student maker). */
  makerId: string | null
  made: boolean
  /** Can't be bought right now (a seasonal item whose event is over). */
  closed: boolean
}

async function makerIdByEmail(db: Db | Tx, email: string) {
  const u = await db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${email}`,
    columns: { id: true },
  })
  return u?.id ?? null
}

/** An item (or person) on the Stock Market, or null when it isn't on it. */
export async function listed(db: Db | Tx, orgId: string, key: string): Promise<Listed | null> {
  if (PERSON.test(key))
    return { base: INVEST.personBase, makerId: null, made: false, closed: false }
  const b = builtinItem(key)
  if (b) {
    const email = builtinMakers()[key]
    const makerId = email ? await makerIdByEmail(db, email) : null
    return {
      base: b.price,
      makerId,
      made: !!email,
      closed: !!b.event && !isEventLive(b.event),
    }
  }
  const m = CUSTOM_ITEM.exec(key)
  if (!m) return null
  const c = await db.query.cosmetics.findFirst({ where: eq(cosmetics.id, m[1]!) })
  if (
    !c ||
    c.orgId !== orgId ||
    !c.dynamic ||
    c.status !== 'approved' ||
    c.visibility !== 'public' ||
    c.stock != null
  )
    return null
  return { base: c.price, makerId: c.creatorId, made: true, closed: false }
}

/** Locks and returns how many are held. */
export async function lockSupply(tx: Tx, orgId: string, key: string) {
  await tx.insert(marketSupply).values({ orgId, key }).onConflictDoNothing()
  const [row] = await tx
    .select({ supply: marketSupply.supply })
    .from(marketSupply)
    .where(and(eq(marketSupply.orgId, orgId), eq(marketSupply.key, key)))
    .for('update')
  return row?.supply ?? 0
}

export async function setSupply(tx: Tx, orgId: string, key: string, supply: number, base: number) {
  await tx
    .update(marketSupply)
    .set({ supply })
    .where(and(eq(marketSupply.orgId, orgId), eq(marketSupply.key, key)))
  await tx.insert(priceTicks).values({ orgId, key, price: buyPrice(base, supply) })
}

/** The school someone belongs to (WickyChat users are in one). */
export async function orgOf(db: Db | Tx, userId: string) {
  const m = await db.query.orgMemberships.findFirst({
    where: and(eq(orgMemberships.userId, userId), isNull(orgMemberships.deactivatedAt)),
    columns: { orgId: true },
  })
  return m?.orgId ?? null
}

/** Current prices, 24h change and a small chart for the given keys. */
async function quotes(
  db: Db,
  orgId: string,
  items: { key: string; base: number; made: boolean }[],
): Promise<MarketQuote[]> {
  if (!items.length) return []
  const keys = items.map((i) => i.key)
  const dayAgo = new Date(Date.now() - 86_400_000)
  const [supply, recent, before] = await Promise.all([
    db
      .select({ key: marketSupply.key, supply: marketSupply.supply })
      .from(marketSupply)
      .where(and(eq(marketSupply.orgId, orgId), inArray(marketSupply.key, keys))),
    db
      .select({ key: priceTicks.key, price: priceTicks.price })
      .from(priceTicks)
      .where(
        and(eq(priceTicks.orgId, orgId), inArray(priceTicks.key, keys), gt(priceTicks.at, dayAgo)),
      )
      .orderBy(asc(priceTicks.at)),
    db
      .selectDistinctOn([priceTicks.key], { key: priceTicks.key, price: priceTicks.price })
      .from(priceTicks)
      .where(
        and(eq(priceTicks.orgId, orgId), inArray(priceTicks.key, keys), lte(priceTicks.at, dayAgo)),
      )
      .orderBy(priceTicks.key, sql`${priceTicks.at} desc`),
  ])
  const supplyOf = new Map(supply.map((s) => [s.key, s.supply]))
  const beforeOf = new Map(before.map((b) => [b.key, b.price]))
  const ticks = new Map<string, number[]>()
  for (const t of recent) ticks.set(t.key, [...(ticks.get(t.key) ?? []), t.price])
  return items.map(({ key, base, made }) => {
    const s = supplyOf.get(key) ?? 0
    const price = buyPrice(base, s)
    const start = beforeOf.get(key) ?? base
    const spark = [start, ...(ticks.get(key) ?? [])].slice(-24)
    if (spark[spark.length - 1] !== price) spark.push(price)
    return {
      key,
      base,
      supply: s,
      price,
      sell: sellPrice(base, s, made),
      change: Math.round(((price - start) / start) * 1000) / 10,
      spark,
      made,
    }
  })
}

async function portfolio(db: Db, userId: string): Promise<Portfolio> {
  const [extra, owned, shares, div] = await Promise.all([
    db
      .select({ itemId: holdings.itemId, qty: holdings.qty })
      .from(holdings)
      .where(and(eq(holdings.userId, userId), gt(holdings.qty, 0))),
    db.select({ itemId: userItems.itemId }).from(userItems).where(eq(userItems.userId, userId)),
    db
      .select({ targetId: personShares.targetId, qty: personShares.qty })
      .from(personShares)
      .where(and(eq(personShares.holderId, userId), gt(personShares.qty, 0))),
    db
      .select({ n: sum(coinTransactions.amount) })
      .from(coinTransactions)
      .where(and(eq(coinTransactions.userId, userId), eq(coinTransactions.reason, 'dividend'))),
  ])
  const items: Record<string, number> = {}
  for (const o of owned) items[o.itemId] = 1
  for (const h of extra) items[h.itemId] = (items[h.itemId] ?? 0) + h.qty
  return {
    items,
    people: Object.fromEntries(shares.map((s) => [s.targetId, s.qty])),
    dividends: Number(div[0]?.n ?? 0),
  }
}

const qtyBody = z.object({ qty: z.number().int().min(1).max(INVEST.maxQty).default(1) })
const keyParams = orgParams.extend({ key: z.string().max(60) })

export async function investRoutes(app: App, ctx: AppContext) {
  /** Every item on the Stock Market at this school. */
  app.get('/api/orgs/:orgId/stocks', { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const custom = await ctx.db
      .select({ id: cosmetics.id, price: cosmetics.price })
      .from(cosmetics)
      .where(
        and(
          eq(cosmetics.orgId, scope.orgId),
          eq(cosmetics.dynamic, true),
          eq(cosmetics.status, 'approved'),
          eq(cosmetics.visibility, 'public'),
          isNull(cosmetics.stock),
        ),
      )
    const makers = builtinMakers()
    return quotes(ctx.db, scope.orgId, [
      ...BUILTIN_IDS.map((key) => ({ key, base: builtinItem(key)!.price, made: !!makers[key] })),
      ...custom.map((c) => ({ key: `u:${c.id}`, base: c.price, made: true })),
    ])
  })

  /** Everyone you can back, with their share price. */
  app.get(
    '/api/orgs/:orgId/stocks/people',
    { schema: { params: orgParams } },
    async (req): Promise<PersonQuote[]> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const week = new Date(Date.now() - 7 * 86_400_000)
      const [people, holders, earned] = await Promise.all([
        ctx.db
          .select({ user: userCols })
          .from(orgMemberships)
          .innerJoin(users, eq(users.id, orgMemberships.userId))
          .where(
            and(
              eq(orgMemberships.orgId, scope.orgId),
              isNull(orgMemberships.deactivatedAt),
              eq(users.isBot, false),
            ),
          )
          .limit(1000),
        ctx.db
          .select({ targetId: personShares.targetId, n: sql<number>`count(*)::int` })
          .from(personShares)
          .where(and(eq(personShares.orgId, scope.orgId), gt(personShares.qty, 0)))
          .groupBy(personShares.targetId),
        ctx.db
          .select({
            userId: coinTransactions.userId,
            n: sql<number>`sum(${coinTransactions.amount})::int`,
          })
          .from(coinTransactions)
          .innerJoin(orgMemberships, eq(orgMemberships.userId, coinTransactions.userId))
          .where(
            and(
              eq(orgMemberships.orgId, scope.orgId),
              gte(coinTransactions.createdAt, week),
              inArray(coinTransactions.reason, [
                'daily',
                'message',
                'poll',
                'quiz',
                'sale',
                'crate_sale',
                'bundle_sale',
                'achievement',
              ]),
            ),
          )
          .groupBy(coinTransactions.userId),
      ])
      const q = await quotes(
        ctx.db,
        scope.orgId,
        people.map((p) => ({ key: personKey(p.user.id), base: INVEST.personBase, made: false })),
      )
      const holdersOf = new Map(holders.map((h) => [h.targetId, h.n]))
      const earnedOf = new Map(earned.map((e) => [e.userId, Number(e.n)]))
      return people.map((p, i) => ({
        ...q[i]!,
        user: toUserSummary(p.user),
        holders: holdersOf.get(p.user.id) ?? 0,
        earned7d: earnedOf.get(p.user.id) ?? 0,
      }))
    },
  )

  app.get('/api/me/portfolio', async (req) => portfolio(ctx.db, requireUser(req).id))

  app.post(
    '/api/orgs/:orgId/stocks/:key/buy',
    {
      schema: { params: keyParams, body: qtyBody },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { key } = req.params
      const { qty } = req.body
      const item = await listed(ctx.db, scope.orgId, key)
      if (!item) throw notFound('Stock')
      if (item.closed) throw badRequest('That event is over, so it can only be sold right now.')
      const person = PERSON.exec(key)?.[1]
      if (person) {
        if (person === scope.userId) throw badRequest("You can't buy shares in yourself.")
        const m = await ctx.db
          .select({ id: users.id })
          .from(orgMemberships)
          .innerJoin(users, eq(users.id, orgMemberships.userId))
          .where(
            and(
              eq(orgMemberships.orgId, scope.orgId),
              eq(orgMemberships.userId, person),
              isNull(orgMemberships.deactivatedAt),
              eq(users.isBot, false),
            ),
          )
        if (!m.length) throw notFound('Person')
      }
      await ctx.db.transaction(async (tx) => {
        const supply = await lockSupply(tx, scope.orgId, key)
        const cost = buyTotal(item.base, supply, qty)
        const [u] = await tx
          .select({ coins: users.coins })
          .from(users)
          .where(eq(users.id, scope.userId))
          .for('update')
        if (!u || u.coins < cost)
          throw badRequest(`You need ${cost - (u?.coins ?? 0)} more Wicky Coins.`)
        if (person) {
          const [cur] = await tx
            .select({ qty: personShares.qty })
            .from(personShares)
            .where(and(eq(personShares.holderId, scope.userId), eq(personShares.targetId, person)))
          if ((cur?.qty ?? 0) + qty > INVEST.maxShares)
            throw badRequest(`You can hold up to ${INVEST.maxShares} shares in one person.`)
          await changeCoins(tx, scope.userId, -cost, 'share_buy', person)
          await tx
            .insert(personShares)
            .values({ holderId: scope.userId, targetId: person, orgId: scope.orgId, qty })
            .onConflictDoUpdate({
              target: [personShares.holderId, personShares.targetId],
              set: { qty: sql`${personShares.qty} + ${qty}` },
            })
        } else {
          await changeCoins(tx, scope.userId, -cost, 'invest_buy', key)
          // The first copy is one you can wear; the rest are extra.
          const [first] = await tx
            .insert(userItems)
            .values({ userId: scope.userId, itemId: key })
            .onConflictDoNothing()
            .returning()
          const extra = first ? qty - 1 : qty
          if (extra > 0)
            await tx
              .insert(holdings)
              .values({ userId: scope.userId, itemId: key, qty: extra })
              .onConflictDoUpdate({
                target: [holdings.userId, holdings.itemId],
                set: { qty: sql`${holdings.qty} + ${extra}` },
              })
          if (item.makerId && item.makerId !== scope.userId)
            await changeCoins(
              tx,
              item.makerId,
              Math.floor(item.base * CREATOR_SHARE) * qty,
              'sale',
              key,
            )
        }
        await setSupply(tx, scope.orgId, key, supply + qty, item.base)
      })
      return {
        wallet: await loadWallet(ctx, scope.userId),
        portfolio: await portfolio(ctx.db, scope.userId),
      }
    },
  )

  app.post(
    '/api/orgs/:orgId/stocks/:key/sell',
    {
      schema: { params: keyParams, body: qtyBody },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { key } = req.params
      const { qty } = req.body
      const item = await listed(ctx.db, scope.orgId, key)
      if (!item) throw notFound('Stock')
      const person = PERSON.exec(key)?.[1]
      await ctx.db.transaction(async (tx) => {
        const supply = await lockSupply(tx, scope.orgId, key)
        if (supply < qty)
          throw badRequest(
            supply
              ? `Only ${supply} can be sold back right now.`
              : "Nobody has bought this on the Stock Market yet, so there's nothing to sell back into.",
          )
        const pay = sellTotal(item.base, supply, qty, item.made)
        if (pay <= 0)
          throw badRequest("The price hasn't gone up since the maker's price, so it sells for 0.")
        if (person) {
          const [cur] = await tx
            .select({ qty: personShares.qty })
            .from(personShares)
            .where(and(eq(personShares.holderId, scope.userId), eq(personShares.targetId, person)))
            .for('update')
          if ((cur?.qty ?? 0) < qty) throw badRequest("You don't have that many shares.")
          await tx
            .update(personShares)
            .set({ qty: sql`${personShares.qty} - ${qty}` })
            .where(and(eq(personShares.holderId, scope.userId), eq(personShares.targetId, person)))
          await changeCoins(tx, scope.userId, pay, 'share_sell', person)
        } else {
          const [extra] = await tx
            .select({ qty: holdings.qty })
            .from(holdings)
            .where(and(eq(holdings.userId, scope.userId), eq(holdings.itemId, key)))
            .for('update')
          const [own] = await tx
            .select({ serial: userItems.serial })
            .from(userItems)
            .where(and(eq(userItems.userId, scope.userId), eq(userItems.itemId, key)))
            .for('update')
          const fromExtra = Math.min(extra?.qty ?? 0, qty)
          const needOwn = qty - fromExtra
          if (needOwn > 1 || (needOwn === 1 && !own)) throw badRequest("You don't have that many.")
          if (needOwn === 1) {
            const onMarket = await tx.query.marketListings.findFirst({
              where: and(
                eq(marketListings.sellerId, scope.userId),
                eq(marketListings.itemId, key),
                eq(marketListings.status, 'open'),
              ),
              columns: { id: true },
            })
            if (onMarket) throw badRequest('Take it off the Market first.')
            await takeOffItem(tx, scope.userId, key)
            await tx
              .delete(userItems)
              .where(and(eq(userItems.userId, scope.userId), eq(userItems.itemId, key)))
          }
          if (fromExtra)
            await tx
              .update(holdings)
              .set({ qty: sql`${holdings.qty} - ${fromExtra}` })
              .where(and(eq(holdings.userId, scope.userId), eq(holdings.itemId, key)))
          await changeCoins(tx, scope.userId, pay, 'invest_sell', key)
        }
        await setSupply(tx, scope.orgId, key, supply - qty, item.base)
      })
      return {
        wallet: await loadWallet(ctx, scope.userId),
        portfolio: await portfolio(ctx.db, scope.userId),
      }
    },
  )
}

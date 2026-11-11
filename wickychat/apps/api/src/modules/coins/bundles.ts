/**
 * WickyChat: bundles. Several items bought together. Built-in ones are in @quid/shared; students
 * make their own from their cosmetics and Shop items.
 */
import { customBundles, orgMemberships, userItems, users } from '@quid/db'
import {
  type BundleDef,
  bundleById,
  bundleFloor,
  CREATOR_SHARE,
  CUSTOM_BUNDLE,
  type CustomBundle,
  censorText,
  customBundleDef,
  isEventLive,
  topics,
} from '@quid/shared'
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireOrg, requireUser } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { CUSTOM_ITEM, checkContents, isItemId, outOfSeason } from './contents'
import { checkPerson } from './crates'
import { loadWallet, takeCopy } from './routes'
import { changeCoins } from './service'

type Row = typeof customBundles.$inferSelect
const creatorCols = { id: users.id, name: users.name, displayName: users.displayName }

const toCustom = (r: Row, creator: CustomBundle['creator']): CustomBundle => ({
  id: r.id,
  bundleId: `u:${r.id}`,
  name: r.name,
  emoji: r.emoji,
  description: r.description,
  colors: [r.colorA, r.colorB],
  price: r.price,
  items: r.items,
  creator,
  status: r.status as CustomBundle['status'],
  sales: r.sales,
  createdAt: r.createdAt.toISOString(),
})

async function resolveBundle(
  ctx: AppContext,
  id: string,
): Promise<{ def: BundleDef; row?: Row } | null> {
  const builtin = bundleById(id)
  if (builtin) return { def: builtin }
  const m = CUSTOM_ITEM.exec(id)
  if (!m) return null
  const [r] = await ctx.db
    .select({ b: customBundles, creator: creatorCols })
    .from(customBundles)
    .innerJoin(users, eq(users.id, customBundles.creatorId))
    .where(eq(customBundles.id, m[1]!))
  return r ? { def: customBundleDef(toCustom(r.b, r.creator)), row: r.b } : null
}

export async function bundleRoutes(app: App, ctx: AppContext) {
  app.post(
    '/api/me/bundles/buy',
    {
      schema: {
        body: z.object({ bundleId: z.string().max(60), giftTo: z.uuid().optional() }),
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      const me = requireUser(req)
      const { bundleId, giftTo } = req.body
      const found = await resolveBundle(ctx, bundleId)
      if (!found) throw notFound('Bundle')
      const { def, row } = found
      if (def.event && !isEventLive(def.event))
        throw badRequest('That event is over, so its bundle is gone from the Shop.')
      if (row) {
        if (row.status !== 'active') throw badRequest("That bundle isn't for sale any more.")
        const member = await ctx.db.query.orgMemberships.findFirst({
          where: and(
            eq(orgMemberships.orgId, row.orgId),
            eq(orgMemberships.userId, me.id),
            isNull(orgMemberships.deactivatedAt),
          ),
          columns: { id: true },
        })
        if (!member) throw notFound('Bundle')
        if (outOfSeason(def.items).length)
          throw badRequest("This bundle has seasonal items, so it's only sold during their event.")
      }
      if (giftTo) await checkPerson(ctx, me.id, giftTo)
      const owner = giftTo ?? me.id
      const name = def.name

      await ctx.db.transaction(async (tx) => {
        const [u] = await tx
          .select({ coins: users.coins })
          .from(users)
          .where(eq(users.id, me.id))
          .for('update')
        const have = new Set(
          (
            await tx
              .select({ itemId: userItems.itemId })
              .from(userItems)
              .where(and(eq(userItems.userId, owner), inArray(userItems.itemId, def.items)))
          ).map((r) => r.itemId),
        )
        const give = def.items.filter((i) => !have.has(i))
        if (!give.length)
          throw conflict(
            giftTo ? 'They already have everything in it.' : 'You already have everything in it.',
          )
        if (!u || u.coins < def.price)
          throw badRequest(`You need ${def.price - (u?.coins ?? 0)} more Wicky Coins for this.`)
        await changeCoins(tx, me.id, -def.price, giftTo ? 'bundle_gift' : 'bundle', bundleId)
        for (const itemId of give) {
          const m = CUSTOM_ITEM.exec(itemId)
          // Limited ones take a copy (and fail the whole purchase if sold out).
          const serial = m ? await takeCopy(tx, m[1]!) : null
          await tx
            .insert(userItems)
            .values({ userId: owner, itemId, giftedBy: giftTo ? me.id : null, serial })
        }
        if (row) {
          await tx
            .update(customBundles)
            .set({ sales: sql`${customBundles.sales} + 1` })
            .where(eq(customBundles.id, row.id))
          const share = Math.floor(Math.max(0, def.price - bundleFloor(def.items)) * CREATOR_SHARE)
          if (row.creatorId !== me.id && share > 0)
            await changeCoins(tx, row.creatorId, share, 'bundle_sale', bundleId)
        }
      })
      if (giftTo)
        await ctx.bus.publish(topics.user(giftTo), {
          type: 'wicky.updated',
          orgId: row?.orgId ?? '',
          text: `🎁 ${me.name} sent you the ${name} bundle!`,
        })
      return loadWallet(ctx, me.id)
    },
  )

  app.get(
    '/api/orgs/:orgId/bundles/custom',
    { schema: { params: orgParams } },
    async (req): Promise<CustomBundle[]> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const rows = await ctx.db
        .select({ b: customBundles, creator: creatorCols })
        .from(customBundles)
        .innerJoin(users, eq(users.id, customBundles.creatorId))
        .where(eq(customBundles.orgId, scope.orgId))
        .orderBy(desc(customBundles.sales))
        .limit(300)
      return rows.map((r) => toCustom(r.b, r.creator))
    },
  )

  app.post(
    '/api/orgs/:orgId/bundles/custom',
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
          price: z.number().int().min(CUSTOM_BUNDLE.price.min).max(CUSTOM_BUNDLE.price.max),
          items: z
            .array(z.string().max(60).refine(isItemId, 'Unknown item'))
            .min(CUSTOM_BUNDLE.minItems)
            .max(CUSTOM_BUNDLE.maxItems),
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
        throw badRequest('Pick one emoji for the bundle.')
      const items = [...new Set(b.items)]
      if (items.length !== b.items.length) throw badRequest('Each item can only be in it once.')
      await checkContents(ctx.db, scope, items, 'bundle')
      const floor = bundleFloor(items)
      if (b.price < floor)
        throw badRequest(
          `With those Shop items inside, the bundle has to cost at least 🪙 ${floor} (what they cost in the Shop).`,
        )
      const [{ n } = { n: 0 }] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(customBundles)
        .where(and(eq(customBundles.creatorId, scope.userId), eq(customBundles.status, 'active')))
      if (n >= CUSTOM_BUNDLE.maxActive)
        throw badRequest(
          `You can have ${CUSTOM_BUNDLE.maxActive} bundles on sale. Remove one first.`,
        )
      const [row] = await ctx.db
        .insert(customBundles)
        .values({
          orgId: scope.orgId,
          creatorId: scope.userId,
          name: b.name,
          emoji: b.emoji,
          description: b.description,
          colorA: b.colors[0],
          colorB: b.colors[1],
          price: b.price,
          items,
        })
        .returning()
      const [creator] = await ctx.db
        .select(creatorCols)
        .from(users)
        .where(eq(users.id, scope.userId))
      return reply.code(201).send(toCustom(row!, creator!))
    },
  )

  app.delete(
    '/api/orgs/:orgId/bundles/custom/:id',
    { schema: { params: orgIdParams } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const c = await ctx.db.query.customBundles.findFirst({
        where: and(eq(customBundles.id, req.params.id), eq(customBundles.orgId, scope.orgId)),
      })
      if (!c) throw notFound('Bundle')
      const teacher = scope.role === 'owner' || scope.role === 'admin'
      if (c.creatorId !== scope.userId && !teacher) throw forbidden()
      await ctx.db
        .update(customBundles)
        .set({ status: 'removed' })
        .where(and(eq(customBundles.id, c.id), ne(customBundles.status, 'removed')))
      return { ok: true }
    },
  )
}

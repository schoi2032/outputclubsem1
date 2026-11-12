/**
 * WickyChat: the trade-up contract. 5 items of one tier in, 1 random item of the next tier out
 * (one you don't own yet). Limited, private and listed items can't go in.
 */

import { randomInt } from 'node:crypto'
import { coinTransactions, cosmetics, marketListings, userItems } from '@quid/db'
import {
  BUBBLE_IDS,
  builtinItem,
  type CrateTier,
  DECORATION_IDS,
  EFFECT_IDS,
  FLAIR_IDS,
  nextTier,
  PLATE_IDS,
  THEME_IDS,
  TRADE_UP,
  type TradeUpResult,
  tierOfPrice,
} from '@quid/shared'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict } from '../../core/errors'
import { type App, orgParams } from '../../core/http'
import { CUSTOM_ITEM } from './contents'
import { loadWallet } from './routes'
import { takeOffItem } from './service'

const BUILTIN_IDS = [
  ...DECORATION_IDS,
  ...EFFECT_IDS,
  ...PLATE_IDS,
  ...BUBBLE_IDS,
  ...FLAIR_IDS,
  ...THEME_IDS,
]

export async function tradeUpRoutes(app: App, ctx: AppContext) {
  app.post(
    '/api/orgs/:orgId/trade-up',
    {
      schema: {
        params: orgParams,
        body: z.object({ items: z.array(z.string().max(60)).length(TRADE_UP.inputs) }),
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const items = [...new Set(req.body.items)]
      if (items.length !== TRADE_UP.inputs)
        throw badRequest(`Pick ${TRADE_UP.inputs} different items.`)

      const result = await ctx.db.transaction(async (tx): Promise<TradeUpResult> => {
        const rows = await tx
          .select({ itemId: userItems.itemId, serial: userItems.serial })
          .from(userItems)
          .where(and(eq(userItems.userId, scope.userId), inArray(userItems.itemId, items)))
          .for('update')
        if (rows.length !== items.length) throw badRequest("You don't own all of those.")
        if (rows.some((r) => r.serial != null))
          throw badRequest('Limited items are too special for a trade-up. Keep them!')
        const listed = await tx
          .select({ id: marketListings.id })
          .from(marketListings)
          .where(
            and(
              eq(marketListings.sellerId, scope.userId),
              eq(marketListings.status, 'open'),
              inArray(marketListings.itemId, items),
            ),
          )
        if (listed.length) throw badRequest('Take it off the Market first.')

        // Every input's tier, from its price.
        const customIds = items.map((i) => CUSTOM_ITEM.exec(i)?.[1]).filter((x): x is string => !!x)
        const custom = customIds.length
          ? await tx
              .select({
                id: cosmetics.id,
                price: cosmetics.price,
                visibility: cosmetics.visibility,
              })
              .from(cosmetics)
              .where(inArray(cosmetics.id, customIds))
          : []
        if (custom.some((c) => c.visibility === 'private'))
          throw badRequest("Private items can't go in a trade-up.")
        const tiers = new Set<CrateTier>()
        for (const i of items) {
          const m = CUSTOM_ITEM.exec(i)
          const price = m ? custom.find((c) => c.id === m[1])?.price : builtinItem(i)?.price
          if (price == null) throw badRequest('One of those items no longer exists.')
          tiers.add(tierOfPrice(price))
        }
        if (tiers.size !== 1) throw badRequest('All 5 items need to be the same tier.')
        const tier = [...tiers][0]!
        const up = nextTier(tier)
        if (!up) throw badRequest("Legendary is the top. There's nothing higher to trade up to!")

        // What it could give: next-tier items you don't own yet.
        const owned = new Set(
          (
            await tx
              .select({ itemId: userItems.itemId })
              .from(userItems)
              .where(eq(userItems.userId, scope.userId))
          ).map((r) => r.itemId),
        )
        const builtins = BUILTIN_IDS.filter(
          (id) => !owned.has(id) && tierOfPrice(builtinItem(id)!.price) === up,
        )
        const studentMade = (
          await tx
            .select({ id: cosmetics.id, price: cosmetics.price })
            .from(cosmetics)
            .where(
              and(
                eq(cosmetics.orgId, scope.orgId),
                eq(cosmetics.status, 'approved'),
                eq(cosmetics.visibility, 'public'),
                isNull(cosmetics.stock),
              ),
            )
        )
          .filter((c) => tierOfPrice(c.price) === up)
          .map((c) => `u:${c.id}`)
          .filter((id) => !owned.has(id))
        const pool = [...builtins, ...studentMade]
        if (!pool.length)
          throw conflict(`You already own every ${up} item. Nothing left to trade up for!`)

        const win = pool[randomInt(pool.length)]!
        for (const i of items) await takeOffItem(tx, scope.userId, i)
        await tx
          .delete(userItems)
          .where(and(eq(userItems.userId, scope.userId), inArray(userItems.itemId, items)))
        await tx.insert(userItems).values({ userId: scope.userId, itemId: win })
        // No coins move, but it goes in your history (and counts for achievements).
        await tx
          .insert(coinTransactions)
          .values({ id: uuidv7(), userId: scope.userId, amount: 0, reason: 'trade_up', ref: win })
        return { item: win, tier: up, pool }
      })
      return { ...result, wallet: await loadWallet(ctx, scope.userId) }
    },
  )
}

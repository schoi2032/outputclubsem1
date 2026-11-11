/**
 * WickyChat solo coinflip: bet against the house. A fair coin; a win pays flipPayout(bet).
 * Limited per day, and off whenever a teacher turns coin games off.
 */

import { randomInt } from 'node:crypto'
import { coinTransactions, users } from '@quid/db'
import { flipPayout, SOLO_FLIP, type SoloFlip } from '@quid/shared'
import { and, count, eq, gte } from 'drizzle-orm'
import { z } from 'zod'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, forbidden } from '../../core/errors'
import { type App, orgParams } from '../../core/http'
import { loadCustomization } from '../orgs/customization'
import { loadWallet } from './routes'
import { changeCoins, startOfSchoolDay } from './service'

async function flipsToday(db: Parameters<typeof changeCoins>[0], userId: string) {
  const [r] = await db
    .select({ n: count() })
    .from(coinTransactions)
    .where(
      and(
        eq(coinTransactions.userId, userId),
        eq(coinTransactions.reason, 'flip_bet'),
        gte(coinTransactions.createdAt, startOfSchoolDay()),
      ),
    )
  return Number(r?.n ?? 0)
}

export async function flipRoutes(app: App, ctx: AppContext) {
  app.get('/api/orgs/:orgId/coinflip', { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    return { flipsToday: await flipsToday(ctx.db, scope.userId) }
  })

  app.post(
    '/api/orgs/:orgId/coinflip',
    {
      schema: {
        params: orgParams,
        body: z.object({
          bet: z.number().int().min(SOLO_FLIP.min).max(SOLO_FLIP.max),
          side: z.enum(['heads', 'tails']),
        }),
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      if (!(await loadCustomization(ctx, scope.orgId)).duels)
        throw forbidden('Coin games are turned off at this school.')
      const { bet, side } = req.body
      const flip = await ctx.db.transaction(async (tx) => {
        const [u] = await tx
          .select({ coins: users.coins })
          .from(users)
          .where(eq(users.id, scope.userId))
          .for('update')
        if (!u || u.coins < bet)
          throw badRequest(`You need ${bet - (u?.coins ?? 0)} more Wicky Coins.`)
        // Counted under the lock, so quick double-clicks can't go past the limit.
        const done = await flipsToday(tx, scope.userId)
        if (done >= SOLO_FLIP.dailyMax)
          throw badRequest(`That's ${SOLO_FLIP.dailyMax} flips today. Come back tomorrow!`)
        await changeCoins(tx, scope.userId, -bet, 'flip_bet', side)
        const result = randomInt(2) === 0 ? 'heads' : 'tails'
        const won = result === side
        const payout = won ? flipPayout(bet) : 0
        if (won) await changeCoins(tx, scope.userId, payout, 'flip_win', result)
        return { side, result, won, bet, payout, flipsToday: done + 1 } satisfies SoloFlip
      })
      return { flip, wallet: await loadWallet(ctx, scope.userId) }
    },
  )
}

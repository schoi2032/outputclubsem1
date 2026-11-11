/** Hourly housekeeping: removes credentials that can no longer be used. */
import { accessTokens, oauthCodes, sessions } from '@quid/db'
import { and, isNotNull, isNull, lt, or } from 'drizzle-orm'
import type { AppContext } from '../../core/context'

const HOUR = 3_600_000
let lastRun = 0

export async function cleanupExpired(ctx: AppContext, now = new Date()) {
  const day = new Date(now.getTime() - 24 * HOUR)
  const month = new Date(now.getTime() - 30 * 24 * HOUR)
  const codes = await ctx.db
    .delete(oauthCodes)
    .where(
      or(
        lt(oauthCodes.expiresAt, day),
        and(isNotNull(oauthCodes.usedAt), lt(oauthCodes.usedAt, day)),
      ),
    )
    .returning({ id: oauthCodes.id })
  // Kept for a month after they stop working, so people can still see what was connected.
  const tokens = await ctx.db
    .delete(accessTokens)
    .where(
      or(
        lt(accessTokens.revokedAt, month),
        and(isNotNull(accessTokens.refreshExpiresAt), lt(accessTokens.refreshExpiresAt, month)),
        and(
          isNotNull(accessTokens.expiresAt),
          lt(accessTokens.expiresAt, month),
          isNull(accessTokens.clientId),
        ),
      ),
    )
    .returning({ id: accessTokens.id })
  const expiredSessions = await ctx.db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ id: sessions.id })
  return { codes: codes.length, tokens: tokens.length, sessions: expiredSessions.length }
}

export async function cleanupTick(ctx: AppContext) {
  if (Date.now() - lastRun < HOUR) return
  lastRun = Date.now()
  const r = await cleanupExpired(ctx)
  if (r.codes || r.tokens || r.sessions) ctx.log.info(r, 'removed expired credentials')
}

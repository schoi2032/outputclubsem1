import { orgMemberships } from '@quid/db'
import { setPresenceSchema } from '@quid/shared'
import { and, eq, isNull } from 'drizzle-orm'
import { requireOrg, requireUser } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { type App, orgParams } from '../../core/http'
import { presenceFor, setPresence } from './service'

export async function presenceRoutes(app: App, ctx: AppContext) {
  app.put('/api/me/presence', { schema: { body: setPresenceSchema } }, async (req) => {
    const me = requireUser(req)
    const b = req.body
    await setPresence(ctx, me.id, {
      ...(b.status !== undefined && { status: b.status }),
      ...(b.statusText !== undefined && { statusText: b.statusText || null }),
      ...(b.statusEmoji !== undefined && { statusEmoji: b.statusEmoji || null }),
      ...(b.statusExpiresAt !== undefined && {
        statusExpiresAt: b.statusExpiresAt ? new Date(b.statusExpiresAt) : null,
      }),
    })
    return (await presenceFor(ctx, [me.id])).get(me.id)
  })

  /** Presence for every member of an org (small teams; paginate when orgs grow). */
  app.get('/api/orgs/:orgId/presence', { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const rows = await ctx.db
      .select({ userId: orgMemberships.userId })
      .from(orgMemberships)
      .where(and(eq(orgMemberships.orgId, scope.orgId), isNull(orgMemberships.deactivatedAt)))
      .limit(5000)
    const map = await presenceFor(
      ctx,
      rows.map((r) => r.userId),
    )
    return [...map.values()]
  })
}

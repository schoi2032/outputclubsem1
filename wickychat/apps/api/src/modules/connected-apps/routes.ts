import { accessTokens } from '@quid/db'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '../../core/audit'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { forbidden, notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { mcpRoutes } from './mcp'
import { mcpUrl, oauthRoutes } from './oauth'
import { connectedAppsAllowed, createPersonalToken, normalizeScopes, SCOPES } from './tokens'

/** Connected apps: the MCP server, OAuth, and each person's own app connections. */
export async function connectedAppRoutes(app: App, ctx: AppContext) {
  await oauthRoutes(app, ctx)
  await mcpRoutes(app, ctx)

  const base = '/api/orgs/:orgId/connected-apps'

  app.get(base, { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const rows = await ctx.db
      .select()
      .from(accessTokens)
      .where(
        and(
          eq(accessTokens.userId, scope.userId),
          eq(accessTokens.orgId, scope.orgId),
          isNull(accessTokens.revokedAt),
        ),
      )
      .orderBy(desc(accessTokens.createdAt))
    const now = Date.now()
    // An OAuth grant stays connected while its refresh token is valid.
    const live = rows.filter((r) =>
      r.clientId
        ? (r.refreshExpiresAt?.getTime() ?? 0) > now
        : !r.expiresAt || r.expiresAt.getTime() > now,
    )
    return {
      enabled: await connectedAppsAllowed(ctx, scope.orgId),
      mcpUrl: mcpUrl(ctx),
      apps: live.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.clientId ? ('oauth' as const) : ('personal' as const),
        scopes: normalizeScopes(r.scopes),
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        expiresAt: r.clientId ? null : (r.expiresAt?.toISOString() ?? null),
      })),
    }
  })

  app.post(
    `${base}/tokens`,
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params: orgParams,
        body: z.object({
          name: z.string().trim().min(1).max(60),
          scopes: z.array(z.enum(SCOPES)).max(SCOPES.length),
          expiresInDays: z.union([
            z.literal(7),
            z.literal(30),
            z.literal(90),
            z.literal(365),
            z.null(),
          ]),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      if (!(await connectedAppsAllowed(ctx, scope.orgId)))
        throw forbidden('Your organization has turned off connected apps.')
      const scopes = normalizeScopes(scope.role === 'guest' ? ['read'] : req.body.scopes)
      const t = await createPersonalToken(ctx, {
        userId: scope.userId,
        orgId: scope.orgId,
        name: req.body.name,
        scopes,
        expiresInDays: req.body.expiresInDays,
      })
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'connected_app.token_created',
        targetType: 'access_token',
        targetId: t.id,
        metadata: { name: req.body.name, scopes },
        ip: req.ip,
      })
      return { id: t.id, token: t.token }
    },
  )

  app.delete(`${base}/:id`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const [row] = await ctx.db
      .update(accessTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(accessTokens.id, req.params.id),
          eq(accessTokens.userId, scope.userId),
          eq(accessTokens.orgId, scope.orgId),
          isNull(accessTokens.revokedAt),
        ),
      )
      .returning({ id: accessTokens.id, name: accessTokens.name })
    if (!row) throw notFound('Connection')
    await audit(ctx.db, {
      orgId: scope.orgId,
      actorId: scope.userId,
      action: 'connected_app.revoked',
      targetType: 'access_token',
      targetId: row.id,
      metadata: { name: row.name },
      ip: req.ip,
    })
    return { ok: true }
  })
}

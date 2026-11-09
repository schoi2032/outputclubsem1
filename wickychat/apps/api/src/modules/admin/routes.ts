/**
 * Admin dashboard: usage at a glance, and organization-wide security controls.
 * Counts only; no message content leaves this module.
 */
import {
  accessTokens,
  calls,
  channels,
  files,
  invitations,
  meetings,
  messages,
  organizations,
  orgMemberships,
  presence,
  users,
} from '@quid/db'
import { and, count, desc, eq, gt, gte, isNotNull, isNull, or, sql, sum } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '../../core/audit'
import { authorize, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { normalizeScopes } from '../connected-apps/tokens'

const DAY = 86_400_000

export async function adminRoutes(app: App, ctx: AppContext) {
  const base = '/api/orgs/:orgId/admin'

  app.get(`${base}/overview`, { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    authorize(scope, 'audit.read')
    const orgId = scope.orgId
    const now = Date.now()
    const d7 = new Date(now - 7 * DAY)
    const d30 = new Date(now - 30 * DAY)

    const [
      members,
      active7,
      invites,
      chans,
      msgs7,
      msgs30,
      daily,
      storage,
      meet30,
      calls30,
      apps,
      org,
    ] = await Promise.all([
      ctx.db
        .select({ role: orgMemberships.role, n: count() })
        .from(orgMemberships)
        .where(and(eq(orgMemberships.orgId, orgId), isNull(orgMemberships.deactivatedAt)))
        .groupBy(orgMemberships.role),
      ctx.db
        .select({ n: count() })
        .from(orgMemberships)
        .innerJoin(presence, eq(presence.userId, orgMemberships.userId))
        .where(
          and(
            eq(orgMemberships.orgId, orgId),
            isNull(orgMemberships.deactivatedAt),
            gte(presence.lastActiveAt, d7),
          ),
        ),
      ctx.db
        .select({ n: count() })
        .from(invitations)
        .where(
          and(
            eq(invitations.orgId, orgId),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, new Date()),
          ),
        ),
      ctx.db
        .select({
          kind: channels.kind,
          archived: sql<boolean>`${channels.archivedAt} is not null`,
          n: count(),
        })
        .from(channels)
        .where(eq(channels.orgId, orgId))
        .groupBy(channels.kind, sql`${channels.archivedAt} is not null`),
      ctx.db
        .select({ n: count() })
        .from(messages)
        .where(
          and(
            eq(messages.orgId, orgId),
            gte(messages.createdAt, d7),
            isNull(messages.deletedAt),
            sql`${messages.kind} <> 'system'`,
          ),
        ),
      ctx.db
        .select({ n: count() })
        .from(messages)
        .where(
          and(
            eq(messages.orgId, orgId),
            gte(messages.createdAt, d30),
            isNull(messages.deletedAt),
            sql`${messages.kind} <> 'system'`,
          ),
        ),
      ctx.db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${messages.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
          n: count(),
        })
        .from(messages)
        .where(
          and(
            eq(messages.orgId, orgId),
            gte(messages.createdAt, d30),
            isNull(messages.deletedAt),
            sql`${messages.kind} <> 'system'`,
          ),
        )
        .groupBy(sql`1`),
      ctx.db
        .select({ n: count(), bytes: sum(files.size) })
        .from(files)
        .where(and(eq(files.orgId, orgId), isNull(files.deletedAt))),
      ctx.db
        .select({
          n: count(),
          minutes: sql<number>`coalesce(sum(extract(epoch from (coalesce(${meetings.endedAt}, now()) - ${meetings.startedAt})) / 60), 0)::int`,
        })
        .from(meetings)
        .where(
          and(
            eq(meetings.orgId, orgId),
            isNotNull(meetings.startedAt),
            gte(meetings.startedAt, d30),
          ),
        ),
      ctx.db
        .select({ n: count() })
        .from(calls)
        .where(and(eq(calls.orgId, orgId), gte(calls.createdAt, d30))),
      ctx.db
        .select({ n: count() })
        .from(accessTokens)
        .where(and(eq(accessTokens.orgId, orgId), isNull(accessTokens.revokedAt), liveToken())),
      ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, orgId),
        columns: { settings: true },
      }),
    ])

    const byDay = new Map(daily.map((d) => [d.day, d.n]))
    const series = Array.from({ length: 30 }, (_, i) => {
      const day = new Date(now - (29 - i) * DAY).toISOString().slice(0, 10)
      return { day, messages: byDay.get(day) ?? 0 }
    })
    const roleCount = (r: string) => members.find((m) => m.role === r)?.n ?? 0
    const total = members.reduce((a, m) => a + m.n, 0)
    const chan = (pred: (c: (typeof chans)[number]) => boolean) =>
      chans.filter(pred).reduce((a, c) => a + c.n, 0)
    return {
      members: {
        total,
        active7d: active7[0]?.n ?? 0,
        admins: roleCount('owner') + roleCount('admin'),
        guests: roleCount('guest'),
        pendingInvites: invites[0]?.n ?? 0,
      },
      messages: { last7d: msgs7[0]?.n ?? 0, last30d: msgs30[0]?.n ?? 0, daily: series },
      channels: {
        public: chan((c) => c.kind === 'public' && !c.archived),
        private: chan((c) => c.kind === 'private' && !c.archived),
        archived: chan((c) => (c.kind === 'public' || c.kind === 'private') && c.archived),
      },
      files: { count: storage[0]?.n ?? 0, bytes: Number(storage[0]?.bytes ?? 0) },
      meetings: { last30d: meet30[0]?.n ?? 0, minutes30d: meet30[0]?.minutes ?? 0 },
      calls: { last30d: calls30[0]?.n ?? 0 },
      connectedApps: { enabled: org?.settings.connectedApps !== false, active: apps[0]?.n ?? 0 },
    }
  })

  app.patch(
    `${base}/security`,
    { schema: { params: orgParams, body: z.object({ connectedApps: z.boolean() }) } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'org.update')
      await ctx.db
        .update(organizations)
        .set({
          settings: sql`${organizations.settings} || ${JSON.stringify({ connectedApps: req.body.connectedApps })}::jsonb`,
        })
        .where(eq(organizations.id, scope.orgId))
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: req.body.connectedApps
          ? 'org.connected_apps_enabled'
          : 'org.connected_apps_disabled',
        targetType: 'organization',
        targetId: scope.orgId,
        ip: req.ip,
      })
      return { ok: true }
    },
  )

  /** Every live connection in the organization, so admins can see and cut off access. */
  app.get(`${base}/connected-apps`, { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    authorize(scope, 'audit.read')
    const rows = await ctx.db
      .select({
        t: accessTokens,
        userName: users.name,
        display: users.displayName,
        email: users.email,
      })
      .from(accessTokens)
      .innerJoin(users, eq(users.id, accessTokens.userId))
      .where(and(eq(accessTokens.orgId, scope.orgId), isNull(accessTokens.revokedAt), liveToken()))
      .orderBy(desc(accessTokens.createdAt))
      .limit(500)
    return rows.map((r) => ({
      id: r.t.id,
      name: r.t.name,
      kind: r.t.clientId ? ('oauth' as const) : ('personal' as const),
      scopes: normalizeScopes(r.t.scopes),
      user: { id: r.t.userId, name: r.display || r.userName, email: r.email },
      createdAt: r.t.createdAt.toISOString(),
      lastUsedAt: r.t.lastUsedAt?.toISOString() ?? null,
    }))
  })

  app.delete(`${base}/connected-apps/:id`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    authorize(scope, 'org.update')
    const [row] = await ctx.db
      .update(accessTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(accessTokens.id, req.params.id),
          eq(accessTokens.orgId, scope.orgId),
          isNull(accessTokens.revokedAt),
        ),
      )
      .returning({ id: accessTokens.id, name: accessTokens.name, userId: accessTokens.userId })
    if (!row) throw notFound('Connection')
    await audit(ctx.db, {
      orgId: scope.orgId,
      actorId: scope.userId,
      action: 'connected_app.revoked_by_admin',
      targetType: 'access_token',
      targetId: row.id,
      metadata: { name: row.name, userId: row.userId },
      ip: req.ip,
    })
    return { ok: true }
  })
}

/** Not expired: OAuth grants live as long as their refresh token. */
function liveToken() {
  const now = new Date()
  return or(
    and(isNotNull(accessTokens.clientId), gt(accessTokens.refreshExpiresAt, now)),
    and(
      isNull(accessTokens.clientId),
      or(isNull(accessTokens.expiresAt), gt(accessTokens.expiresAt, now)),
    ),
  )
}

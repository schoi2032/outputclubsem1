import { channels, notificationPreferences, notifications, orgMemberships, users } from '@quid/db'
import { announcementSchema, notificationPrefsSchema } from '@quid/shared'
import { and, desc, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '../../core/audit'
import { authorize, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { type App, orgParams, queryBool } from '../../core/http'
import { toUserSummary, userCols } from '../users/serialize'
import { createNotifications, loadPrefs, serializeNotification } from './service'

export async function notificationRoutes(app: App, ctx: AppContext) {
  const base = '/api/orgs/:orgId'

  app.get(
    `${base}/notifications`,
    {
      schema: {
        params: orgParams,
        querystring: z.object({
          before: z.uuid().optional(),
          unread: queryBool.default(false),
          kind: z.enum(['all', 'mentions', 'threads', 'direct']).default('all'),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const q = req.query
      const kinds =
        q.kind === 'mentions'
          ? ['mention']
          : q.kind === 'threads'
            ? ['thread_reply']
            : q.kind === 'direct'
              ? ['direct_message']
              : null
      const rows = await ctx.db
        .select({
          n: notifications,
          actor: userCols,
          channelName: channels.name,
          channelKind: channels.kind,
        })
        .from(notifications)
        .leftJoin(users, eq(users.id, notifications.actorId))
        .leftJoin(channels, eq(channels.id, notifications.channelId))
        .where(
          and(
            eq(notifications.userId, scope.userId),
            eq(notifications.orgId, scope.orgId),
            q.before ? lt(notifications.id, q.before) : undefined,
            q.unread ? isNull(notifications.readAt) : undefined,
            kinds ? inArray(notifications.kind, kinds) : undefined,
          ),
        )
        .orderBy(desc(notifications.id))
        .limit(q.limit + 1)
      const more = rows.length > q.limit
      const items = rows
        .slice(0, q.limit)
        .map((r) =>
          serializeNotification(
            r.n,
            r.actor?.id ? toUserSummary(r.actor) : null,
            r.channelKind === 'public' || r.channelKind === 'private' ? r.channelName : null,
          ),
        )
      return { notifications: items, nextCursor: more ? items[items.length - 1]!.id : null }
    },
  )

  app.get(`${base}/notifications/unread-count`, { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const [r] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, scope.userId),
          eq(notifications.orgId, scope.orgId),
          isNull(notifications.readAt),
        ),
      )
    return { count: r?.n ?? 0 }
  })

  app.post(
    `${base}/notifications/read`,
    {
      schema: {
        params: orgParams,
        body: z.object({
          ids: z.array(z.uuid()).max(500).optional(),
          channelId: z.uuid().optional(),
          upTo: z.uuid().optional(),
          all: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const b = req.body
      await ctx.db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, scope.userId),
            eq(notifications.orgId, scope.orgId),
            isNull(notifications.readAt),
            b.all ? undefined : b.ids ? inArray(notifications.id, b.ids) : undefined,
            b.channelId ? eq(notifications.channelId, b.channelId) : undefined,
            b.upTo ? lte(notifications.messageId, b.upTo) : undefined,
            !b.all && !b.ids && !b.channelId ? sql`false` : undefined,
          ),
        )
      return { ok: true }
    },
  )

  app.get(`${base}/notification-preferences`, { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    return (await loadPrefs(ctx, scope.orgId, [scope.userId])).get(scope.userId)
  })

  app.put(
    `${base}/notification-preferences`,
    { schema: { params: orgParams, body: notificationPrefsSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      await ctx.db
        .insert(notificationPreferences)
        .values({ userId: scope.userId, orgId: scope.orgId, ...req.body })
        .onConflictDoUpdate({
          target: [notificationPreferences.userId, notificationPreferences.orgId],
          set: req.body,
        })
      return (await loadPrefs(ctx, scope.orgId, [scope.userId])).get(scope.userId)
    },
  )

  /** Organization-wide announcement, delivered as a notification to every member. */
  app.post(
    `${base}/announcements`,
    { schema: { params: orgParams, body: announcementSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'org.announce')
      const members = await ctx.db
        .select({ userId: orgMemberships.userId })
        .from(orgMemberships)
        .where(and(eq(orgMemberships.orgId, scope.orgId), isNull(orgMemberships.deactivatedAt)))
      await createNotifications(
        ctx,
        members.map((m) => ({
          orgId: scope.orgId,
          userId: m.userId,
          kind: 'announcement' as const,
          actorId: scope.userId,
          channelId: null,
          messageId: null,
          threadId: null,
          title: req.body.title,
          preview: req.body.body,
        })),
      )
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'org.announcement_sent',
        metadata: { title: req.body.title, recipients: members.length },
        ip: req.ip,
      })
      return { sent: members.length }
    },
  )
}

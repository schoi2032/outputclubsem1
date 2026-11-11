/**
 * WickyChat: students report messages to teachers, and teachers put people in a timeout
 * (they can read but can't post until it ends).
 */
import { channelMembers, channels, messageReports, messages, orgMemberships, users } from '@quid/db'
import { type MessageReport, REPORT_REASONS } from '@quid/shared'
import { and, count, desc, eq, inArray, ne } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { audit } from '../../core/audit'
import { authorize, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { AppError, badRequest, conflict, notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { requireChannel } from '../channels/service'
import { toUserSummary, userCols } from '../users/serialize'

const TEACHER_ROLES = new Set(['owner', 'admin'])

/** Throws if a teacher has this person in a timeout right now. */
export async function assertNotTimedOut(ctx: AppContext, orgId: string, userId: string) {
  const m = await ctx.db.query.orgMemberships.findFirst({
    where: and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
    columns: { timeoutUntil: true, timeoutReason: true },
  })
  if (m?.timeoutUntil && m.timeoutUntil > new Date()) {
    const mins = Math.ceil((m.timeoutUntil.getTime() - Date.now()) / 60_000)
    const left =
      mins >= 120 ? `${Math.round(mins / 60)} hours` : `${mins} minute${mins === 1 ? '' : 's'}`
    throw new AppError(
      403,
      'timed_out',
      `A teacher put you in a timeout, so you can't post for ${left}.${m.timeoutReason ? ` Reason: ${m.timeoutReason}` : ''}`,
    )
  }
}

export async function schoolModerationRoutes(app: App, ctx: AppContext) {
  app.post(
    '/api/orgs/:orgId/messages/:id/report',
    {
      schema: {
        params: orgIdParams,
        body: z.object({
          reason: z.enum(REPORT_REASONS),
          note: z.string().trim().max(500).default(''),
        }),
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const msg = await ctx.db.query.messages.findFirst({
        where: and(eq(messages.id, req.params.id), eq(messages.orgId, scope.orgId)),
        columns: { id: true, channelId: true, authorId: true, bodyText: true, deletedAt: true },
      })
      if (!msg || msg.deletedAt) throw notFound('Message')
      await requireChannel(ctx, scope, msg.channelId, 'read')
      if (msg.authorId === scope.userId) throw badRequest("You can't report your own message.")
      const [row] = await ctx.db
        .insert(messageReports)
        .values({
          orgId: scope.orgId,
          messageId: msg.id,
          channelId: msg.channelId,
          reporterId: scope.userId,
          authorId: msg.authorId,
          reason: req.body.reason,
          note: req.body.note,
          excerpt: msg.bodyText.slice(0, 1000),
        })
        .onConflictDoNothing()
        .returning({ id: messageReports.id })
      if (!row) throw conflict("You've already reported this message. A teacher will look at it.")
      return reply.code(201).send({ ok: true })
    },
  )

  app.get(
    '/api/orgs/:orgId/moderation/reports',
    {
      schema: {
        params: orgParams,
        querystring: z.object({ status: z.enum(['open', 'closed']).default('open') }),
      },
    },
    async (req): Promise<{ reports: MessageReport[] }> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'audit.read')
      const reporter = alias(users, 'reporter')
      const author = alias(users, 'author')
      const rows = await ctx.db
        .select({
          r: messageReports,
          reporter: {
            id: reporter.id,
            name: reporter.name,
            displayName: reporter.displayName,
            avatarKey: reporter.avatarKey,
            avatarAnimated: reporter.avatarAnimated,
            isBot: reporter.isBot,
            decoration: reporter.decoration,
          },
          author: {
            id: author.id,
            name: author.name,
            displayName: author.displayName,
            avatarKey: author.avatarKey,
            avatarAnimated: author.avatarAnimated,
            isBot: author.isBot,
            decoration: author.decoration,
          },
          channelName: channels.name,
          channelKind: channels.kind,
          deletedAt: messages.deletedAt,
        })
        .from(messageReports)
        .innerJoin(reporter, eq(reporter.id, messageReports.reporterId))
        .leftJoin(author, eq(author.id, messageReports.authorId))
        .leftJoin(channels, eq(channels.id, messageReports.channelId))
        .leftJoin(messages, eq(messages.id, messageReports.messageId))
        .where(
          and(
            eq(messageReports.orgId, scope.orgId),
            req.query.status === 'open'
              ? eq(messageReports.status, 'open')
              : inArray(messageReports.status, ['resolved', 'dismissed']),
          ),
        )
        .orderBy(desc(messageReports.id))
        .limit(200)
      const ids = [...new Set(rows.map((r) => r.r.messageId).filter((x): x is string => !!x))]
      const counts = ids.length
        ? await ctx.db
            .select({ messageId: messageReports.messageId, n: count() })
            .from(messageReports)
            .where(inArray(messageReports.messageId, ids))
            .groupBy(messageReports.messageId)
        : []
      const countBy = new Map(counts.map((c) => [c.messageId, Number(c.n)]))
      return {
        reports: rows.map((x) => {
          const r = x.r
          return {
            id: r.id,
            reason: r.reason as MessageReport['reason'],
            note: r.note,
            excerpt: r.excerpt,
            status: r.status as MessageReport['status'],
            reporter: toUserSummary(x.reporter),
            author: x.author?.id ? toUserSummary(x.author as typeof x.reporter) : null,
            channel:
              r.channelId && x.channelName !== null
                ? { id: r.channelId, name: x.channelName, kind: x.channelKind ?? 'public' }
                : null,
            messageId: r.messageId,
            messageDeleted: !r.messageId || !!x.deletedAt,
            reportCount: (r.messageId && countBy.get(r.messageId)) || 1,
            createdAt: r.createdAt.toISOString(),
            resolvedAt: r.resolvedAt?.toISOString() ?? null,
          }
        }),
      }
    },
  )

  /** Close a report. Closes every open report on the same message too. */
  app.post(
    '/api/orgs/:orgId/moderation/reports/:id/resolve',
    {
      schema: {
        params: orgIdParams,
        body: z.object({ outcome: z.enum(['resolved', 'dismissed']) }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'audit.read')
      const r = await ctx.db.query.messageReports.findFirst({
        where: and(eq(messageReports.id, req.params.id), eq(messageReports.orgId, scope.orgId)),
      })
      if (!r) throw notFound('Report')
      const set = {
        status: req.body.outcome,
        resolvedBy: scope.userId,
        resolvedAt: new Date(),
      }
      await ctx.db
        .update(messageReports)
        .set(set)
        .where(
          r.messageId
            ? and(eq(messageReports.messageId, r.messageId), eq(messageReports.status, 'open'))
            : eq(messageReports.id, r.id),
        )
      return { ok: true }
    },
  )

  /** Read receipts for teachers: who in the channel has seen a message, and who hasn't. */
  app.get(
    '/api/orgs/:orgId/messages/:id/seen',
    { schema: { params: orgIdParams } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'audit.read')
      const msg = await ctx.db.query.messages.findFirst({
        where: and(eq(messages.id, req.params.id), eq(messages.orgId, scope.orgId)),
        columns: { id: true, channelId: true, authorId: true },
      })
      if (!msg) throw notFound('Message')
      await requireChannel(ctx, scope, msg.channelId, 'read')
      const rows = await ctx.db
        .select({
          user: userCols,
          lastRead: channelMembers.lastReadMessageId,
          lastReadAt: channelMembers.lastReadAt,
        })
        .from(channelMembers)
        .innerJoin(users, eq(users.id, channelMembers.userId))
        .where(
          and(
            eq(channelMembers.channelId, msg.channelId),
            eq(users.isBot, false),
            msg.authorId ? ne(channelMembers.userId, msg.authorId) : undefined,
          ),
        )
        .orderBy(users.name)
      // Message ids are time-ordered (uuidv7), so "read up to" covers everything before it.
      const seen = rows.filter((r) => r.lastRead && r.lastRead >= msg.id)
      const notSeen = rows.filter((r) => !r.lastRead || r.lastRead < msg.id)
      return {
        seen: seen.map((r) => ({
          ...toUserSummary(r.user),
          at: r.lastReadAt?.toISOString() ?? null,
        })),
        notSeen: notSeen.map((r) => toUserSummary(r.user)),
      }
    },
  )

  /** Teachers put someone in a timeout. `minutes: 0` ends it. */
  app.post(
    '/api/orgs/:orgId/members/:id/timeout',
    {
      schema: {
        params: orgIdParams,
        body: z.object({
          minutes: z
            .number()
            .int()
            .min(0)
            .max(60 * 24 * 7),
          reason: z.string().trim().max(200).optional(),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'audit.read')
      const m = await ctx.db.query.orgMemberships.findFirst({
        where: and(eq(orgMemberships.orgId, scope.orgId), eq(orgMemberships.userId, req.params.id)),
        columns: { id: true, role: true },
      })
      if (!m) throw notFound('Member')
      if (TEACHER_ROLES.has(m.role)) throw badRequest("Teachers can't be put in a timeout.")
      const until = req.body.minutes ? new Date(Date.now() + req.body.minutes * 60_000) : null
      await ctx.db
        .update(orgMemberships)
        .set({ timeoutUntil: until, timeoutReason: until ? (req.body.reason ?? null) : null })
        .where(eq(orgMemberships.id, m.id))
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: until ? 'member.timeout' : 'member.timeout_ended',
        targetType: 'user',
        targetId: req.params.id,
        metadata: { minutes: req.body.minutes, reason: req.body.reason ?? null },
        ip: req.ip,
      })
      return { timeoutUntil: until?.toISOString() ?? null }
    },
  )
}

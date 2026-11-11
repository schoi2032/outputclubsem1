/**
 * Reminders ("Later"): about a message ("Remind me about this") or about anything
 * (/remind). Private to the person who set them; delivered as a notification.
 */
import { channels, messages, organizations, reminders } from '@quid/db'
import type { Reminder } from '@quid/shared'
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, notFound } from '../../core/errors'
import type { App } from '../../core/http'
import { onTick } from '../../core/jobs'
import { getChannelAccess } from '../channels/service'
import { serializeMessages } from '../messages/service'
import { createNotifications } from '../notifications/service'

type Row = typeof reminders.$inferSelect

const MAX_AHEAD_MS = 366 * 86_400_000

async function serialize(ctx: AppContext, viewerId: string, rows: Row[]): Promise<Reminder[]> {
  const ids = rows.map((r) => r.messageId).filter((x): x is string => !!x)
  const msgRows = ids.length
    ? await ctx.db
        .select()
        .from(messages)
        .where(and(inArray(messages.id, ids), isNull(messages.deletedAt)))
    : []
  const serialized = await serializeMessages(ctx, viewerId, msgRows)
  const byId = new Map(serialized.map((m) => [m.id, m]))
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    dueAt: r.dueAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
    doneAt: r.doneAt?.toISOString() ?? null,
    message: (r.messageId && byId.get(r.messageId)) || null,
    channelId: r.channelId,
    createdAt: r.createdAt.toISOString(),
  }))
}

export async function reminderRoutes(app: App, ctx: AppContext) {
  const base = '/api/orgs/:orgId/reminders'
  const params = z.object({ orgId: z.uuid(), id: z.uuid() })

  async function mine(orgId: string, userId: string, id: string) {
    const row = await ctx.db.query.reminders.findFirst({
      where: and(eq(reminders.id, id), eq(reminders.orgId, orgId), eq(reminders.userId, userId)),
    })
    if (!row) throw notFound('Reminder')
    return row
  }

  app.get(base, { schema: { params: z.object({ orgId: z.uuid() }) } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const rows = await ctx.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.orgId, scope.orgId), eq(reminders.userId, scope.userId)))
      // Open ones first (soonest first), then the most recently finished.
      .orderBy(sql`case when ${reminders.doneAt} is null then 0 else 1 end`, asc(reminders.dueAt))
      .limit(200)
    const open = rows.filter((r) => !r.doneAt)
    const done = rows
      .filter((r) => r.doneAt)
      .sort((a, b) => b.doneAt!.getTime() - a.doneAt!.getTime())
      .slice(0, 50)
    return serialize(ctx, scope.userId, [...open, ...done])
  })

  app.post(
    base,
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ orgId: z.uuid() }),
        body: z.object({
          dueAt: z.iso.datetime({ offset: true }),
          text: z.string().trim().max(500).default(''),
          messageId: z.uuid().nullable().optional(),
        }),
      },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const due = new Date(req.body.dueAt)
      if (due.getTime() < Date.now() - 60_000) throw badRequest('Pick a time in the future.')
      if (due.getTime() > Date.now() + MAX_AHEAD_MS)
        throw badRequest('Reminders can be up to a year ahead.')
      let channelId: string | null = null
      if (req.body.messageId) {
        const m = await ctx.db.query.messages.findFirst({
          where: and(eq(messages.id, req.body.messageId), eq(messages.orgId, scope.orgId)),
        })
        if (!m || m.deletedAt) throw notFound('Message')
        await getChannelAccess(ctx, scope, m.channelId)
        channelId = m.channelId
      } else if (!req.body.text) throw badRequest('What should we remind you about?')
      const [row] = await ctx.db
        .insert(reminders)
        .values({
          orgId: scope.orgId,
          userId: scope.userId,
          text: req.body.text,
          messageId: req.body.messageId ?? null,
          channelId,
          dueAt: due,
        })
        .returning()
      return reply.code(201).send((await serialize(ctx, scope.userId, [row!]))[0])
    },
  )

  /** Mark done / not done, or snooze to a new time. */
  app.patch(
    `${base}/:id`,
    {
      schema: {
        params,
        body: z.object({
          done: z.boolean().optional(),
          dueAt: z.iso.datetime({ offset: true }).optional(),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const row = await mine(scope.orgId, scope.userId, req.params.id)
      const due = req.body.dueAt ? new Date(req.body.dueAt) : null
      if (due && due.getTime() > Date.now() + MAX_AHEAD_MS)
        throw badRequest('Reminders can be up to a year ahead.')
      const [saved] = await ctx.db
        .update(reminders)
        .set({
          ...(req.body.done !== undefined && { doneAt: req.body.done ? new Date() : null }),
          // Snoozing re-arms it.
          ...(due && { dueAt: due, sentAt: null, doneAt: null }),
        })
        .where(eq(reminders.id, row.id))
        .returning()
      return (await serialize(ctx, scope.userId, [saved!]))[0]
    },
  )

  app.delete(`${base}/:id`, { schema: { params } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await mine(scope.orgId, scope.userId, req.params.id)
    await ctx.db.delete(reminders).where(eq(reminders.id, row.id))
    return { ok: true }
  })

  onTick(sendDueReminders)
}

/** Delivers due reminders as notifications. Each is claimed first, so it's sent once. */
export async function sendDueReminders(ctx: AppContext, now = new Date()) {
  const due = await ctx.db
    .update(reminders)
    .set({ sentAt: now })
    .where(and(isNull(reminders.sentAt), isNull(reminders.doneAt), lte(reminders.dueAt, now)))
    .returning()
  for (const r of due) {
    const [org] = await ctx.db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, r.orgId))
    const msg = r.messageId
      ? await ctx.db.query.messages.findFirst({ where: eq(messages.id, r.messageId) })
      : null
    const chan = r.channelId
      ? await ctx.db.query.channels.findFirst({
          where: eq(channels.id, r.channelId),
          columns: { name: true },
        })
      : null
    await createNotifications(ctx, [
      {
        orgId: r.orgId,
        userId: r.userId,
        kind: 'reminder',
        actorId: null,
        channelId: r.channelId,
        messageId: r.messageId,
        threadId: msg?.parentId ?? null,
        title: msg
          ? `Reminder: a message${chan?.name ? ` in #${chan.name}` : ''}`
          : `Reminder: ${r.text}`,
        preview: (msg?.bodyText ?? r.text).slice(0, 200),
        link: msg
          ? `/${org?.slug}/c/${msg.channelId}?${msg.parentId ? `thread=${msg.parentId}&` : ''}m=${msg.id}`
          : `/${org?.slug}/saved?tab=reminders`,
      },
    ])
  }
}

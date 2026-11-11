/**
 * Tasks: to-dos that live in a channel, often made from a message. Channel
 * members can add and update them; the assignee is notified, and again when a
 * task is due within the hour.
 */
import { channelMembers, channels, messages, tasks } from '@quid/db'
import { type Task, topics } from '@quid/shared'
import { and, desc, eq, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { type OrgScope, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, forbidden, notFound } from '../../core/errors'
import type { App } from '../../core/http'
import { onTick } from '../../core/jobs'
import { assertOrgMembers, check, getChannelAccess, requireChannel } from '../channels/service'
import { createNotifications } from '../notifications/service'
import { readableChannels, userSummaries } from './common'

type Row = typeof tasks.$inferSelect

export async function serializeTasks(ctx: AppContext, rows: Row[]): Promise<Task[]> {
  const people = await userSummaries(
    ctx,
    rows.flatMap((r) => [r.assigneeId, r.createdBy]),
  )
  const chanIds = [...new Set(rows.map((r) => r.channelId))]
  const names = chanIds.length
    ? await ctx.db
        .select({ id: channels.id, name: channels.name })
        .from(channels)
        .where(inArray(channels.id, chanIds))
    : []
  const nameOf = new Map(names.map((c) => [c.id, c.name]))
  return rows.map((r) => ({
    id: r.id,
    channelId: r.channelId,
    channelName: nameOf.get(r.channelId) ?? null,
    messageId: r.messageId,
    title: r.title,
    notes: r.notes,
    status: r.status,
    assignee: (r.assigneeId && people.get(r.assigneeId)) || null,
    dueAt: r.dueAt?.toISOString() ?? null,
    createdBy: (r.createdBy && people.get(r.createdBy)) || null,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  }))
}

async function publish(ctx: AppContext, r: Row, deleted = false) {
  const event = {
    type: 'task.updated' as const,
    orgId: r.orgId,
    channelId: r.channelId,
    taskId: r.id,
    ...(deleted && { deleted: true }),
  }
  await ctx.bus.publish(
    [topics.channel(r.channelId), ...(r.assigneeId ? [topics.user(r.assigneeId)] : [])],
    event,
  )
}

/** The assignee must be able to see the task's channel. */
async function assertAssignable(
  ctx: AppContext,
  scope: OrgScope,
  channel: typeof channels.$inferSelect,
  userId: string,
) {
  await assertOrgMembers(ctx, scope.orgId, [userId])
  if (channel.kind === 'public') return
  const m = await ctx.db.query.channelMembers.findFirst({
    where: and(eq(channelMembers.channelId, channel.id), eq(channelMembers.userId, userId)),
  })
  if (!m) throw badRequest("That person isn't in this conversation.")
}

async function notifyAssigned(ctx: AppContext, r: Row, actorId: string) {
  if (!r.assigneeId || r.assigneeId === actorId) return
  const actor = (await userSummaries(ctx, [actorId])).get(actorId)
  await createNotifications(ctx, [
    {
      orgId: r.orgId,
      userId: r.assigneeId,
      kind: 'task_assigned',
      actorId,
      channelId: r.channelId,
      messageId: r.messageId,
      threadId: null,
      title: `${actor ? actor.displayName || actor.name : 'Someone'} assigned you a task`,
      preview: r.title,
      link: `/${await orgSlug(ctx, r.orgId)}/c/${r.channelId}?tab=tasks&task=${r.id}`,
    },
  ])
}

async function orgSlug(ctx: AppContext, orgId: string) {
  const o = await ctx.db.query.organizations.findFirst({
    where: (t, { eq }) => eq(t.id, orgId),
    columns: { slug: true },
  })
  return o?.slug ?? ''
}

/** Creates a task. Callers check the channel first. Used by the API, /todo and workflows. */
export async function createTask(
  ctx: AppContext,
  scope: OrgScope,
  channel: typeof channels.$inferSelect,
  input: {
    title: string
    notes?: string
    assigneeId?: string | null
    dueAt?: Date | null
    messageId?: string | null
  },
) {
  if (input.assigneeId) await assertAssignable(ctx, scope, channel, input.assigneeId)
  if (input.messageId) {
    const m = await ctx.db.query.messages.findFirst({
      where: and(eq(messages.id, input.messageId), eq(messages.channelId, channel.id)),
      columns: { id: true },
    })
    if (!m) throw badRequest("That message isn't in this channel.")
  }
  const [row] = await ctx.db
    .insert(tasks)
    .values({
      orgId: scope.orgId,
      channelId: channel.id,
      messageId: input.messageId ?? null,
      title: input.title,
      notes: input.notes ?? '',
      assigneeId: input.assigneeId ?? null,
      dueAt: input.dueAt ?? null,
      createdBy: scope.userId,
    })
    .returning()
  await publish(ctx, row!)
  await notifyAssigned(ctx, row!, scope.userId)
  return row!
}

const taskInput = z.object({
  title: z.string().trim().min(1).max(300),
  notes: z.string().max(5000).optional(),
  assigneeId: z.uuid().nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
})

export async function taskRoutes(app: App, ctx: AppContext) {
  const base = '/api/orgs/:orgId/tasks'
  const params = z.object({ orgId: z.uuid(), id: z.uuid() })

  async function load(scope: OrgScope, id: string) {
    const row = await ctx.db.query.tasks.findFirst({
      where: and(eq(tasks.id, id), eq(tasks.orgId, scope.orgId)),
    })
    if (!row) throw notFound('Task')
    const access = await getChannelAccess(ctx, scope, row.channelId)
    return { row, access }
  }

  /** A channel's tasks, or everything assigned to (or created by) me. */
  app.get(
    base,
    {
      schema: {
        params: z.object({ orgId: z.uuid() }),
        querystring: z.object({
          channelId: z.uuid().optional(),
          mine: z.enum(['assigned', 'created']).optional(),
          includeDone: z.enum(['true', 'false']).default('true'),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { channelId, mine, includeDone } = req.query
      if (!channelId && !mine) throw badRequest('Pass channelId or mine.')
      if (channelId) await requireChannel(ctx, scope, channelId, 'read')
      const rows = await ctx.db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.orgId, scope.orgId),
            channelId ? eq(tasks.channelId, channelId) : undefined,
            mine === 'assigned' ? eq(tasks.assigneeId, scope.userId) : undefined,
            mine === 'created' ? eq(tasks.createdBy, scope.userId) : undefined,
            includeDone === 'false' ? ne(tasks.status, 'done') : undefined,
            readableChannels(scope, tasks.channelId),
          ),
        )
        .orderBy(
          // Open first, then by due date (no date last), then newest.
          sql`case ${tasks.status} when 'done' then 1 else 0 end`,
          sql`${tasks.dueAt} asc nulls last`,
          desc(tasks.createdAt),
        )
        .limit(500)
      return serializeTasks(ctx, rows)
    },
  )

  app.post(
    base,
    {
      schema: {
        params: z.object({ orgId: z.uuid() }),
        body: taskInput.extend({ channelId: z.uuid(), messageId: z.uuid().nullable().optional() }),
      },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { channel } = await requireChannel(ctx, scope, req.body.channelId, 'reply')
      const row = await createTask(ctx, scope, channel, {
        ...req.body,
        dueAt: req.body.dueAt ? new Date(req.body.dueAt) : null,
      })
      return reply.code(201).send((await serializeTasks(ctx, [row]))[0])
    },
  )

  app.patch(
    `${base}/:id`,
    {
      schema: {
        params,
        body: taskInput.partial().extend({ status: z.enum(['todo', 'doing', 'done']).optional() }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { row, access } = await load(scope, req.params.id)
      if (!check(scope, access, 'reply')) throw forbidden('Join the channel to update its tasks.')
      const b = req.body
      if (b.assigneeId) await assertAssignable(ctx, scope, access.channel, b.assigneeId)
      const [saved] = await ctx.db
        .update(tasks)
        .set({
          ...(b.title !== undefined && { title: b.title }),
          ...(b.notes !== undefined && { notes: b.notes }),
          ...(b.assigneeId !== undefined && { assigneeId: b.assigneeId }),
          ...(b.dueAt !== undefined && {
            dueAt: b.dueAt ? new Date(b.dueAt) : null,
            dueNotifiedAt: null,
          }),
          ...(b.status !== undefined && {
            status: b.status,
            completedAt: b.status === 'done' ? (row.completedAt ?? new Date()) : null,
          }),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, row.id))
        .returning()
      await publish(ctx, saved!)
      if (b.assigneeId && b.assigneeId !== row.assigneeId)
        await notifyAssigned(ctx, saved!, scope.userId)
      // Also tell the previous assignee's other tabs.
      if (row.assigneeId && row.assigneeId !== saved!.assigneeId)
        await ctx.bus.publish(topics.user(row.assigneeId), {
          type: 'task.updated',
          orgId: row.orgId,
          channelId: row.channelId,
          taskId: row.id,
        })
      return (await serializeTasks(ctx, [saved!]))[0]
    },
  )

  app.delete(`${base}/:id`, { schema: { params } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const { row, access } = await load(scope, req.params.id)
    const allowed =
      row.createdBy === scope.userId ||
      row.assigneeId === scope.userId ||
      check(scope, access, 'manage')
    if (!allowed)
      throw forbidden('Only the creator, the assignee or a channel admin can delete it.')
    await ctx.db.delete(tasks).where(eq(tasks.id, row.id))
    await publish(ctx, row, true)
    return { ok: true }
  })

  onTick(notifyDueTasks)
}

/** Tells assignees about open tasks due within the hour, once. */
export async function notifyDueTasks(ctx: AppContext, now = new Date()) {
  const due = await ctx.db
    .update(tasks)
    .set({ dueNotifiedAt: now })
    .where(
      and(
        isNotNull(tasks.assigneeId),
        isNotNull(tasks.dueAt),
        isNull(tasks.dueNotifiedAt),
        ne(tasks.status, 'done'),
        lte(tasks.dueAt, new Date(now.getTime() + 3600_000)),
      ),
    )
    .returning()
  for (const r of due) {
    await createNotifications(ctx, [
      {
        orgId: r.orgId,
        userId: r.assigneeId!,
        kind: 'task_due',
        actorId: null,
        channelId: r.channelId,
        messageId: r.messageId,
        threadId: null,
        title: r.dueAt! <= now ? 'Task is due' : 'Task due within the hour',
        preview: r.title,
        link: `/${await orgSlug(ctx, r.orgId)}/c/${r.channelId}?tab=tasks&task=${r.id}`,
      },
    ])
  }
}

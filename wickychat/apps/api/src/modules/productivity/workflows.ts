/**
 * Workflow Builder: no-code automations made of a trigger, an optional form and
 * up to ten steps.
 *
 * Triggers: a shortcut someone runs in a channel (optionally filling in a form),
 * someone joining a channel, someone joining the workspace, a schedule, or a
 * keyword in a channel. Steps: post a message, send a DM, create a task.
 * Messages come from a bot named after the workflow. Bots never trigger workflows,
 * so workflows can't loop.
 */
import {
  channelMembers,
  channels,
  orgMemberships,
  users,
  type WorkflowFormField,
  type WorkflowStep,
  type WorkflowTrigger,
  workflows,
} from '@quid/db'
import { simpleMarkdownToDoc } from '@quid/shared'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { type OrgScope, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, forbidden, notFound } from '../../core/errors'
import { onHook } from '../../core/hooks'
import type { App } from '../../core/http'
import { onTick } from '../../core/jobs'
import { publishChannelJoined } from '../channels/events'
import { assertOrgMembers, requireChannel } from '../channels/service'
import { createBot } from '../integrations/routes'
import { createMessage } from '../messages/service'
import { userSummaries } from './common'
import { createTask } from './tasks'

type Row = typeof workflows.$inferSelect

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const id = z.string().min(1).max(40)
const text = z.string().trim().min(1).max(2000)

const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('shortcut'), channelId: z.uuid() }),
  z.object({ type: z.literal('channel_join'), channelId: z.uuid() }),
  z.object({ type: z.literal('workspace_join') }),
  z.object({
    type: z.literal('schedule'),
    channelId: z.uuid(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    timezone: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal('keyword'),
    channelId: z.uuid(),
    keyword: z.string().trim().min(2).max(60),
  }),
])

const fieldSchema = z.object({
  id,
  label: z.string().trim().min(1).max(80),
  kind: z.enum(['text', 'long', 'select']),
  options: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  required: z.boolean().default(false),
})

const target = z.union([z.literal('trigger_user'), z.uuid()])

const stepSchema = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('message'), channelId: z.uuid(), text }),
  z.object({ id, type: z.literal('dm'), to: target, text }),
  z.object({
    id,
    type: z.literal('task'),
    channelId: z.uuid(),
    title: z.string().trim().min(1).max(300),
    assignee: target.nullable(),
    dueInDays: z.number().int().min(0).max(365).nullable(),
  }),
])

const workflowSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(''),
  emoji: z.string().trim().min(1).max(8).default('⚡'),
  enabled: z.boolean().default(true),
  trigger: triggerSchema,
  form: z.array(fieldSchema).max(10).default([]),
  steps: z.array(stepSchema).min(1).max(10),
})

function validZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Checks the channels and people a workflow refers to, as its author. */
async function checkReferences(
  ctx: AppContext,
  scope: OrgScope,
  w: z.infer<typeof workflowSchema>,
) {
  if (w.trigger.type === 'schedule' && !validZone(w.trigger.timezone))
    throw badRequest('Unknown time zone.')
  if (w.form.length && w.trigger.type !== 'shortcut')
    throw badRequest('Forms only work with shortcut workflows.')
  for (const f of w.form)
    if (f.kind === 'select' && !f.options?.length) throw badRequest(`Add options to “${f.label}”.`)
  if ('channelId' in w.trigger) await requireChannel(ctx, scope, w.trigger.channelId, 'read')
  const people: string[] = []
  for (const s of w.steps) {
    if (s.type === 'message') await requireChannel(ctx, scope, s.channelId, 'post')
    if (s.type === 'task') await requireChannel(ctx, scope, s.channelId, 'reply')
    if (s.type === 'dm' && s.to !== 'trigger_user') people.push(s.to)
    if (s.type === 'task' && s.assignee && s.assignee !== 'trigger_user') people.push(s.assignee)
    if (
      w.trigger.type === 'schedule' &&
      ((s.type === 'dm' && s.to === 'trigger_user') ||
        (s.type === 'task' && s.assignee === 'trigger_user'))
    )
      throw badRequest('Scheduled workflows have no “person who triggered it”. Pick someone.')
  }
  if (people.length) await assertOrgMembers(ctx, scope.orgId, people)
}

function serialize(r: Row, scope: OrgScope, creator: unknown) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    emoji: r.emoji,
    enabled: r.enabled,
    trigger: r.trigger,
    form: r.form,
    steps: r.steps,
    createdBy: creator,
    canEdit: r.createdBy === scope.userId || scope.role === 'owner' || scope.role === 'admin',
    runCount: r.runCount,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    lastError: r.lastError,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export interface RunContext {
  /** Who triggered it (null for schedules). */
  userId: string | null
  channelId?: string | null
  values?: Record<string, string>
  messageText?: string
}

async function ensureBot(ctx: AppContext, w: Row) {
  if (w.botUserId) {
    const bot = await ctx.db.query.users.findFirst({ where: eq(users.id, w.botUserId) })
    if (bot) {
      if (bot.name !== w.name)
        await ctx.db.update(users).set({ name: w.name }).where(eq(users.id, bot.id))
      return bot.id
    }
  }
  const botId = await createBot(ctx, w.orgId, w.name)
  await ctx.db.update(workflows).set({ botUserId: botId }).where(eq(workflows.id, w.id))
  return botId
}

async function botInChannel(ctx: AppContext, orgId: string, channelId: string, botId: string) {
  await ctx.db
    .insert(channelMembers)
    .values({ channelId, userId: botId, orgId })
    .onConflictDoNothing()
}

/** The bot's DM with a person, created on first use. */
async function dmWith(ctx: AppContext, orgId: string, botId: string, userId: string) {
  const dmKey = [botId, userId].sort().join(':')
  let ch = await ctx.db.query.channels.findFirst({
    where: and(eq(channels.orgId, orgId), eq(channels.dmKey, dmKey)),
  })
  if (!ch) {
    const [c] = await ctx.db
      .insert(channels)
      .values({ orgId, kind: 'dm', dmKey, createdBy: botId })
      .onConflictDoNothing()
      .returning()
    ch =
      c ??
      (await ctx.db.query.channels.findFirst({
        where: and(eq(channels.orgId, orgId), eq(channels.dmKey, dmKey)),
      }))!
    await ctx.db
      .insert(channelMembers)
      .values([botId, userId].map((u) => ({ channelId: ch!.id, userId: u, orgId })))
      .onConflictDoNothing()
    await publishChannelJoined(ctx, orgId, ch.id, userId)
  }
  return ch
}

/** Fills in {{user}}, {{channel}}, {{date}}, {{message}} and {{form field}} placeholders. */
export function fillTemplate(
  template: string,
  vars: { user: string; channel: string; message: string; date: string },
  form: WorkflowFormField[],
  values: Record<string, string>,
) {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (all, key: string) => {
    const k = key.toLowerCase()
    if (k === 'user') return vars.user
    if (k === 'channel') return vars.channel
    if (k === 'date') return vars.date
    if (k === 'message') return vars.message
    const f = form.find((x) => x.id === key || x.label.toLowerCase() === k.replace(/^form\./, ''))
    return f ? (values[f.id] ?? '') || '—' : all
  })
}

export async function runWorkflow(ctx: AppContext, w: Row, run: RunContext) {
  try {
    const botId = await ensureBot(ctx, w)
    const people = await userSummaries(ctx, [run.userId, w.createdBy])
    const who = run.userId ? people.get(run.userId) : null
    const trigChan = run.channelId
      ? await ctx.db.query.channels.findFirst({ where: eq(channels.id, run.channelId) })
      : null
    const vars = {
      user: who ? `@${who.displayName || who.name}` : 'someone',
      channel: trigChan?.name ? `#${trigChan.name}` : '',
      message: run.messageText ?? '',
      date: new Date().toLocaleDateString('en-US', { dateStyle: 'medium' }),
    }
    const fill = (t: string) => fillTemplate(t, vars, w.form, run.values ?? {})
    const resolve = (t: string | null) => (t === 'trigger_user' ? (run.userId ?? w.createdBy) : t)
    const botScope: OrgScope = { orgId: w.orgId, userId: botId, role: 'member', departmentId: null }

    for (const step of w.steps as WorkflowStep[]) {
      if (step.type === 'message') {
        const ch = await ctx.db.query.channels.findFirst({ where: eq(channels.id, step.channelId) })
        if (!ch || ch.archivedAt) throw new Error('A channel in this workflow is gone or archived.')
        await botInChannel(ctx, w.orgId, ch.id, botId)
        await createMessage(ctx, { orgId: w.orgId, userId: botId }, ch, {
          body: simpleMarkdownToDoc(fill(step.text).slice(0, 4000)),
          kind: 'bot',
        })
      } else if (step.type === 'dm') {
        const to = resolve(step.to)
        if (!to) continue
        const ch = await dmWith(ctx, w.orgId, botId, to)
        await createMessage(ctx, { orgId: w.orgId, userId: botId }, ch, {
          body: simpleMarkdownToDoc(fill(step.text).slice(0, 4000)),
          kind: 'bot',
        })
      } else {
        const ch = await ctx.db.query.channels.findFirst({ where: eq(channels.id, step.channelId) })
        if (!ch || ch.archivedAt) throw new Error('A channel in this workflow is gone or archived.')
        await botInChannel(ctx, w.orgId, ch.id, botId)
        await createTask(ctx, botScope, ch, {
          title: fill(step.title).slice(0, 300),
          assigneeId: resolve(step.assignee),
          dueAt:
            step.dueInDays === null ? null : new Date(Date.now() + step.dueInDays * 86_400_000),
        })
      }
    }
    await ctx.db
      .update(workflows)
      .set({ runCount: sql`${workflows.runCount} + 1`, lastRunAt: new Date(), lastError: null })
      .where(eq(workflows.id, w.id))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.log.warn({ err, workflowId: w.id }, 'workflow failed')
    await ctx.db
      .update(workflows)
      .set({ lastRunAt: new Date(), lastError: message.slice(0, 500) })
      .where(eq(workflows.id, w.id))
    throw err
  }
}

/** Enabled workflows in an org with this trigger type (and channel). */
async function triggered(
  ctx: AppContext,
  orgId: string,
  type: WorkflowTrigger['type'],
  channelId?: string,
) {
  return ctx.db
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.orgId, orgId),
        eq(workflows.enabled, true),
        sql`${workflows.trigger}->>'type' = ${type}`,
        channelId ? sql`${workflows.trigger}->>'channelId' = ${channelId}` : undefined,
      ),
    )
}

async function isBot(ctx: AppContext, userId: string) {
  const u = await ctx.db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { isBot: true },
  })
  return !u || u.isBot
}

const runQuietly = (ctx: AppContext, w: Row, run: RunContext) =>
  runWorkflow(ctx, w, run).catch(() => {})

onHook('messageCreated', async (ctx, e) => {
  if (e.byBot || e.message.kind !== 'user' || e.message.author.isBot) return
  const text = e.message.text.toLowerCase()
  if (!text) return
  for (const w of await triggered(ctx, e.orgId, 'keyword', e.channel.id)) {
    const t = w.trigger as Extract<WorkflowTrigger, { type: 'keyword' }>
    if (text.includes(t.keyword.toLowerCase()))
      await runQuietly(ctx, w, {
        userId: e.message.author.id,
        channelId: e.channel.id,
        messageText: e.message.text,
      })
  }
})

onHook('channelJoined', async (ctx, e) => {
  const list = await triggered(ctx, e.orgId, 'channel_join', e.channel.id)
  if (!list.length || (await isBot(ctx, e.userId))) return
  for (const w of list) await runQuietly(ctx, w, { userId: e.userId, channelId: e.channel.id })
})

onHook('orgJoined', async (ctx, e) => {
  const list = await triggered(ctx, e.orgId, 'workspace_join')
  if (!list.length || (await isBot(ctx, e.userId))) return
  for (const w of list) await runQuietly(ctx, w, { userId: e.userId })
})

/** Wall-clock day and time in a zone. */
function localNow(now: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  )
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday as string),
  }
}

/** Runs scheduled workflows whose time has come today (within half an hour, once a day). */
export async function runScheduledWorkflows(ctx: AppContext, now = new Date()) {
  const list = await ctx.db
    .select()
    .from(workflows)
    .where(and(eq(workflows.enabled, true), sql`${workflows.trigger}->>'type' = 'schedule'`))
    .limit(1000)
  for (const w of list) {
    const t = w.trigger as Extract<WorkflowTrigger, { type: 'schedule' }>
    let local: ReturnType<typeof localNow>
    try {
      local = localNow(now, t.timezone)
    } catch {
      continue
    }
    const [h, m] = t.time.split(':').map(Number) as [number, number]
    const at = h * 60 + m
    if (!t.days.includes(local.weekday) || local.minutes < at || local.minutes > at + 30) continue
    // Claim today's run.
    const [claimed] = await ctx.db
      .update(workflows)
      .set({ lastScheduledDate: local.date })
      .where(
        and(
          eq(workflows.id, w.id),
          or(
            isNull(workflows.lastScheduledDate),
            sql`${workflows.lastScheduledDate} <> ${local.date}`,
          ),
        ),
      )
      .returning()
    if (claimed) await runQuietly(ctx, claimed, { userId: null, channelId: t.channelId })
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function workflowRoutes(app: App, ctx: AppContext) {
  const base = '/api/orgs/:orgId/workflows'
  const params = z.object({ orgId: z.uuid(), id: z.uuid() })

  async function load(scope: OrgScope, wid: string) {
    const row = await ctx.db.query.workflows.findFirst({
      where: and(eq(workflows.id, wid), eq(workflows.orgId, scope.orgId)),
    })
    if (!row) throw notFound('Workflow')
    return row
  }
  const canEdit = (scope: OrgScope, r: Row) =>
    r.createdBy === scope.userId || scope.role === 'owner' || scope.role === 'admin'

  async function serializeAll(scope: OrgScope, rows: Row[]) {
    const people = await userSummaries(
      ctx,
      rows.map((r) => r.createdBy),
    )
    return rows.map((r) => serialize(r, scope, (r.createdBy && people.get(r.createdBy)) || null))
  }

  /** All workflows (for the builder), or the shortcuts you can run in a channel. */
  app.get(
    base,
    {
      schema: {
        params: z.object({ orgId: z.uuid() }),
        querystring: z.object({ shortcutsIn: z.uuid().optional() }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      if (req.query.shortcutsIn) {
        await requireChannel(ctx, scope, req.query.shortcutsIn, 'read')
        return serializeAll(
          scope,
          await triggered(ctx, scope.orgId, 'shortcut', req.query.shortcutsIn),
        )
      }
      if (scope.role === 'guest') return []
      const rows = await ctx.db
        .select()
        .from(workflows)
        .where(eq(workflows.orgId, scope.orgId))
        .orderBy(desc(workflows.updatedAt))
      return serializeAll(scope, rows)
    },
  )

  app.post(
    base,
    { schema: { params: z.object({ orgId: z.uuid() }), body: workflowSchema } },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      if (scope.role === 'guest') throw forbidden('Guests can’t build workflows.')
      await checkReferences(ctx, scope, req.body)
      const [row] = await ctx.db
        .insert(workflows)
        .values({ orgId: scope.orgId, ...req.body, createdBy: scope.userId })
        .returning()
      return reply.code(201).send((await serializeAll(scope, [row!]))[0])
    },
  )

  app.put(`${base}/:id`, { schema: { params, body: workflowSchema } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await load(scope, req.params.id)
    if (!canEdit(scope, row))
      throw forbidden('Only its creator or an admin can edit this workflow.')
    await checkReferences(ctx, scope, req.body)
    const [saved] = await ctx.db
      .update(workflows)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(workflows.id, row.id))
      .returning()
    return (await serializeAll(scope, [saved!]))[0]
  })

  app.patch(
    `${base}/:id`,
    { schema: { params, body: z.object({ enabled: z.boolean() }) } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const row = await load(scope, req.params.id)
      if (!canEdit(scope, row)) throw forbidden()
      const [saved] = await ctx.db
        .update(workflows)
        .set({ enabled: req.body.enabled, updatedAt: new Date() })
        .where(eq(workflows.id, row.id))
        .returning()
      return (await serializeAll(scope, [saved!]))[0]
    },
  )

  app.delete(`${base}/:id`, { schema: { params } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await load(scope, req.params.id)
    if (!canEdit(scope, row)) throw forbidden()
    await ctx.db.delete(workflows).where(eq(workflows.id, row.id))
    // The bot stays as the author of what it posted, but leaves the workspace.
    if (row.botUserId)
      await ctx.db
        .update(orgMemberships)
        .set({ deactivatedAt: new Date() })
        .where(and(eq(orgMemberships.orgId, row.orgId), eq(orgMemberships.userId, row.botUserId)))
    return { ok: true }
  })

  /** Runs a shortcut workflow, with the form's answers. */
  app.post(
    `${base}/:id/run`,
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params,
        body: z.object({ values: z.record(z.string(), z.string().max(4000)).default({}) }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const row = await load(scope, req.params.id)
      const t = row.trigger
      if (t.type !== 'shortcut') throw badRequest('This workflow runs by itself.')
      if (!row.enabled) throw badRequest('This workflow is turned off.')
      const { membership } = await requireChannel(ctx, scope, t.channelId, 'read')
      if (!membership) throw forbidden('Join the channel to run its workflows.')
      for (const f of row.form) {
        const v = (req.body.values[f.id] ?? '').trim()
        if (f.required && !v) throw badRequest(`“${f.label}” is required.`)
        if (v && f.kind === 'select' && !f.options?.includes(v))
          throw badRequest(`Pick one of the options for “${f.label}”.`)
      }
      try {
        await runWorkflow(ctx, row, {
          userId: scope.userId,
          channelId: t.channelId,
          values: req.body.values,
        })
      } catch (e) {
        throw badRequest(
          `The workflow couldn't finish: ${e instanceof Error ? e.message : 'error'}`,
        )
      }
      return { ok: true }
    },
  )

  onTick(runScheduledWorkflows)
}

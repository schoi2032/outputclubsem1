import {
  calendarEventDone,
  calendarEvents,
  channelMembers,
  channels,
  meetingParticipants,
  meetings,
  officeHourBookings,
  organizations,
  orgMemberships,
  tasks,
} from '@quid/db'
import type { CalendarEvent, CalendarItem } from '@quid/shared'
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'
import { type OrgScope, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, forbidden, notFound } from '../../core/errors'
import type { App } from '../../core/http'
import { onTick } from '../../core/jobs'
import { requireChannel } from '../channels/service'
import { createNotifications } from '../notifications/service'
import { readableChannels, userSummaries } from './common'
import { serializeBookings } from './office-hours'
import { serializeTasks } from './tasks'

type Row = typeof calendarEvents.$inferSelect

const isTeacher = (s: OrgScope) => s.role === 'owner' || s.role === 'admin'
const DAY = 86_400_000
const LEAD: Record<Row['kind'], number> = {
  test: DAY,
  homework: 12 * 3_600_000,
  event: 3_600_000,
  personal: 30 * 60_000,
}
const KIND_WORD: Record<Row['kind'], string> = {
  homework: 'Homework',
  test: 'Test',
  event: 'Event',
  personal: 'Event',
}

const myChannels = (scope: OrgScope) =>
  sql`${calendarEvents.channelId} in (select cm.channel_id from channel_members cm where cm.user_id = ${scope.userId} and cm.org_id = ${scope.orgId})`

function canEdit(scope: OrgScope, r: Row) {
  return r.createdBy === scope.userId || (!!r.channelId && isTeacher(scope))
}

async function studentsIn(ctx: AppContext, orgId: string, channelIds: string[]) {
  if (!channelIds.length) return new Map<string, string[]>()
  const rows = await ctx.db
    .select({ channelId: channelMembers.channelId, userId: channelMembers.userId })
    .from(channelMembers)
    .innerJoin(
      orgMemberships,
      and(eq(orgMemberships.userId, channelMembers.userId), eq(orgMemberships.orgId, orgId)),
    )
    .where(
      and(
        inArray(channelMembers.channelId, channelIds),
        isNull(orgMemberships.deactivatedAt),
        sql`${orgMemberships.role} not in ('owner', 'admin')`,
      ),
    )
  const out = new Map<string, string[]>()
  for (const r of rows) out.set(r.channelId, [...(out.get(r.channelId) ?? []), r.userId])
  return out
}

export async function serializeEvents(
  ctx: AppContext,
  scope: OrgScope,
  rows: Row[],
): Promise<CalendarEvent[]> {
  if (!rows.length) return []
  const people = await userSummaries(
    ctx,
    rows.map((r) => r.createdBy),
  )
  const chanIds = [...new Set(rows.map((r) => r.channelId).filter((x): x is string => !!x))]
  const names = chanIds.length
    ? await ctx.db
        .select({ id: channels.id, name: channels.name })
        .from(channels)
        .where(inArray(channels.id, chanIds))
    : []
  const nameOf = new Map(names.map((c) => [c.id, c.name]))
  const ids = rows.map((r) => r.id)
  const dones = await ctx.db
    .select({ eventId: calendarEventDone.eventId, userId: calendarEventDone.userId })
    .from(calendarEventDone)
    .where(inArray(calendarEventDone.eventId, ids))
  const tracked = rows.filter(
    (r) => r.channelId && (r.kind === 'homework' || r.kind === 'test') && canEdit(scope, r),
  )
  const students = await studentsIn(ctx, scope.orgId, [
    ...new Set(tracked.map((r) => r.channelId!)),
  ])
  return rows.map((r) => {
    const mine = dones.some((d) => d.eventId === r.id && d.userId === scope.userId)
    const isTracked = tracked.includes(r)
    const kids = isTracked ? (students.get(r.channelId!) ?? []) : []
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      notes: r.notes,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt?.toISOString() ?? null,
      allDay: r.allDay,
      channelId: r.channelId,
      channelName: (r.channelId && nameOf.get(r.channelId)) || null,
      createdBy: (r.createdBy && people.get(r.createdBy)) || null,
      canEdit: canEdit(scope, r),
      done: mine,
      doneCount: isTracked
        ? dones.filter((d) => d.eventId === r.id && kids.includes(d.userId)).length
        : null,
      memberCount: isTracked ? kids.length : null,
    }
  })
}

const eventBody = z.object({
  kind: z.enum(['event', 'homework', 'test', 'personal']).default('event'),
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(4000).default(''),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  allDay: z.boolean().default(false),
  channelId: z.uuid().nullable().optional(),
})

function checkTimes(startsAt: Date, endsAt: Date | null) {
  if (Number.isNaN(startsAt.getTime())) throw badRequest('That start time looks wrong.')
  if (endsAt && endsAt < startsAt) throw badRequest('It has to end after it starts.')
  if (endsAt && endsAt.getTime() - startsAt.getTime() > 31 * DAY)
    throw badRequest('Events can be up to a month long.')
  if (Math.abs(startsAt.getTime() - Date.now()) > 3 * 366 * DAY)
    throw badRequest('Pick a date closer to now.')
}

async function orgSlug(ctx: AppContext, orgId: string) {
  const [o] = await ctx.db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, orgId))
  return o?.slug ?? ''
}

const dayParam = (d: Date) => d.toISOString().slice(0, 10)

async function announce(ctx: AppContext, r: Row, actorId: string) {
  if (!r.channelId || r.startsAt.getTime() < Date.now()) return
  const [chan] = await ctx.db
    .select({ name: channels.name })
    .from(channels)
    .where(eq(channels.id, r.channelId))
  const members = await ctx.db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, r.channelId), ne(channelMembers.userId, actorId)))
  if (!members.length) return
  const slug = await orgSlug(ctx, r.orgId)
  await createNotifications(
    ctx,
    members.map((m) => ({
      orgId: r.orgId,
      userId: m.userId,
      kind: 'calendar' as const,
      actorId,
      channelId: r.channelId,
      messageId: null,
      threadId: null,
      title: `New ${KIND_WORD[r.kind].toLowerCase()}${chan?.name ? ` in #${chan.name}` : ''}: ${r.title}`,
      preview: r.notes.slice(0, 200),
      link: `/${slug}/calendar?d=${dayParam(r.startsAt)}&e=${r.id}`,
    })),
  )
}

export async function calendarRoutes(app: App, ctx: AppContext) {
  const base = '/api/orgs/:orgId/calendar'
  const params = z.object({ orgId: z.uuid(), id: z.uuid() })

  async function visible(scope: OrgScope, id: string) {
    const row = await ctx.db.query.calendarEvents.findFirst({
      where: and(eq(calendarEvents.id, id), eq(calendarEvents.orgId, scope.orgId)),
    })
    if (!row) throw notFound('Event')
    if (row.channelId) await requireChannel(ctx, scope, row.channelId, 'read')
    else if (row.createdBy !== scope.userId) throw notFound('Event')
    return row
  }

  async function editable(scope: OrgScope, id: string) {
    const row = await visible(scope, id)
    if (!canEdit(scope, row)) throw forbidden('Only the teacher who added it can change it.')
    return row
  }

  async function checkChannel(scope: OrgScope, kind: Row['kind'], channelId: string | null) {
    if (!channelId) return
    if (kind === 'personal') throw badRequest('Personal events cant go in a channel.')
    if (!isTeacher(scope)) throw forbidden('Only teachers can add events to a class.')
    await requireChannel(ctx, scope, channelId, 'post')
  }

  app.get(
    base,
    {
      schema: {
        params: z.object({ orgId: z.uuid() }),
        querystring: z.object({
          from: z.iso.datetime({ offset: true }),
          to: z.iso.datetime({ offset: true }),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const from = new Date(req.query.from)
      const to = new Date(req.query.to)
      if (to <= from) throw badRequest('to has to be after from.')
      if (to.getTime() - from.getTime() > 100 * DAY) throw badRequest('Ask for 100 days at most.')

      const eventRows = await ctx.db
        .select()
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.orgId, scope.orgId),
            or(
              and(isNull(calendarEvents.channelId), eq(calendarEvents.createdBy, scope.userId)),
              myChannels(scope),
            ),
            lt(calendarEvents.startsAt, to),
            or(
              gte(calendarEvents.startsAt, from),
              and(isNotNull(calendarEvents.endsAt), gte(calendarEvents.endsAt, from)),
            ),
          ),
        )
        .orderBy(asc(calendarEvents.startsAt))
        .limit(1000)

      const taskRows = await ctx.db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.orgId, scope.orgId),
            eq(tasks.assigneeId, scope.userId),
            gte(tasks.dueAt, from),
            lt(tasks.dueAt, to),
            readableChannels(scope, tasks.channelId),
          ),
        )
        .limit(500)

      const meetingRows = await ctx.db
        .select({
          id: meetings.id,
          title: meetings.title,
          code: meetings.code,
          scheduledFor: meetings.scheduledFor,
          durationMinutes: meetings.durationMinutes,
        })
        .from(meetings)
        .innerJoin(
          meetingParticipants,
          and(
            eq(meetingParticipants.meetingId, meetings.id),
            eq(meetingParticipants.userId, scope.userId),
          ),
        )
        .where(
          and(
            eq(meetings.orgId, scope.orgId),
            isNull(meetings.endedAt),
            gte(meetings.scheduledFor, from),
            lt(meetings.scheduledFor, to),
          ),
        )
        .limit(300)

      const bookingRows = await ctx.db
        .select()
        .from(officeHourBookings)
        .where(
          and(
            eq(officeHourBookings.orgId, scope.orgId),
            eq(officeHourBookings.status, 'booked'),
            or(
              eq(officeHourBookings.studentId, scope.userId),
              eq(officeHourBookings.teacherId, scope.userId),
            ),
            gte(officeHourBookings.startsAt, from),
            lt(officeHourBookings.startsAt, to),
          ),
        )
        .limit(500)

      const [events, taskList, bookings] = await Promise.all([
        serializeEvents(ctx, scope, eventRows),
        serializeTasks(ctx, taskRows),
        serializeBookings(ctx, scope.userId, bookingRows),
      ])
      const items: CalendarItem[] = [
        ...events.map((e) => ({
          type: 'event' as const,
          id: e.id,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          event: e,
        })),
        ...taskList.map((t) => ({
          type: 'task' as const,
          id: t.id,
          startsAt: t.dueAt!,
          endsAt: null,
          task: t,
        })),
        ...meetingRows.map((m) => ({
          type: 'meeting' as const,
          id: m.id,
          startsAt: m.scheduledFor!.toISOString(),
          endsAt: new Date(m.scheduledFor!.getTime() + m.durationMinutes * 60_000).toISOString(),
          title: m.title,
          code: m.code,
        })),
        ...bookings.map((b) => ({
          type: 'booking' as const,
          id: b.id,
          startsAt: b.startsAt,
          endsAt: b.endsAt,
          booking: b,
        })),
      ]
      return items.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    },
  )

  app.post(
    `${base}/events`,
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { params: z.object({ orgId: z.uuid() }), body: eventBody },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const b = req.body
      const channelId = b.channelId ?? null
      const kind = channelId ? b.kind : b.kind === 'event' ? 'personal' : b.kind
      await checkChannel(scope, kind, channelId)
      const startsAt = new Date(b.startsAt)
      const endsAt = b.endsAt ? new Date(b.endsAt) : null
      checkTimes(startsAt, endsAt)
      const soon = startsAt.getTime() - Date.now() <= LEAD[kind]
      const [row] = await ctx.db
        .insert(calendarEvents)
        .values({
          orgId: scope.orgId,
          channelId,
          createdBy: scope.userId,
          kind,
          title: b.title,
          notes: b.notes,
          startsAt,
          endsAt,
          allDay: b.allDay,
          remindedAt: soon ? new Date() : null,
        })
        .returning()
      await announce(ctx, row!, scope.userId)
      return reply.code(201).send((await serializeEvents(ctx, scope, [row!]))[0])
    },
  )

  app.get(`${base}/events/:id`, { schema: { params } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await visible(scope, req.params.id)
    return (await serializeEvents(ctx, scope, [row]))[0]
  })

  app.patch(
    `${base}/events/:id`,
    { schema: { params, body: eventBody.partial() } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const row = await editable(scope, req.params.id)
      const b = req.body
      const kind = b.kind ?? row.kind
      if (row.channelId && kind === 'personal') throw badRequest('Class events cant be personal.')
      if (!row.channelId && kind !== 'personal' && kind !== 'homework' && kind !== 'test')
        throw badRequest('Pick personal, homework or test.')
      const startsAt = b.startsAt ? new Date(b.startsAt) : row.startsAt
      const endsAt = b.endsAt === undefined ? row.endsAt : b.endsAt ? new Date(b.endsAt) : null
      checkTimes(startsAt, endsAt)
      const moved = startsAt.getTime() !== row.startsAt.getTime() || kind !== row.kind
      const soon = startsAt.getTime() - Date.now() <= LEAD[kind]
      const [saved] = await ctx.db
        .update(calendarEvents)
        .set({
          kind,
          ...(b.title !== undefined && { title: b.title }),
          ...(b.notes !== undefined && { notes: b.notes }),
          ...(b.allDay !== undefined && { allDay: b.allDay }),
          startsAt,
          endsAt,
          ...(moved && { remindedAt: soon ? new Date() : null }),
          updatedAt: new Date(),
        })
        .where(eq(calendarEvents.id, row.id))
        .returning()
      return (await serializeEvents(ctx, scope, [saved!]))[0]
    },
  )

  app.delete(`${base}/events/:id`, { schema: { params } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await editable(scope, req.params.id)
    await ctx.db.delete(calendarEvents).where(eq(calendarEvents.id, row.id))
    return { ok: true }
  })

  app.post(
    `${base}/events/:id/done`,
    { schema: { params, body: z.object({ done: z.boolean() }) } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const row = await visible(scope, req.params.id)
      if (row.kind !== 'homework' && row.kind !== 'test')
        throw badRequest('Only homework and tests can be checked off.')
      if (req.body.done)
        await ctx.db
          .insert(calendarEventDone)
          .values({ eventId: row.id, userId: scope.userId })
          .onConflictDoNothing()
      else
        await ctx.db
          .delete(calendarEventDone)
          .where(
            and(eq(calendarEventDone.eventId, row.id), eq(calendarEventDone.userId, scope.userId)),
          )
      return (await serializeEvents(ctx, scope, [row]))[0]
    },
  )

  app.get(`${base}/events/:id/progress`, { schema: { params } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await editable(scope, req.params.id)
    if (!row.channelId) throw badRequest('Only class homework has progress.')
    const kids = (await studentsIn(ctx, scope.orgId, [row.channelId])).get(row.channelId) ?? []
    const dones = await ctx.db
      .select()
      .from(calendarEventDone)
      .where(eq(calendarEventDone.eventId, row.id))
    const doneAt = new Map(dones.map((d) => [d.userId, d.doneAt]))
    const people = await userSummaries(ctx, kids)
    return kids
      .map((id) => ({
        user: people.get(id)!,
        doneAt: doneAt.get(id)?.toISOString() ?? null,
      }))
      .filter((x) => x.user)
      .sort((a, b) =>
        a.doneAt === b.doneAt ? a.user.name.localeCompare(b.user.name) : a.doneAt ? 1 : -1,
      )
  })

  onTick(remindCalendar)
}

export async function remindCalendar(ctx: AppContext, now = new Date()) {
  for (const kind of Object.keys(LEAD) as Row['kind'][]) {
    const due = await ctx.db
      .update(calendarEvents)
      .set({ remindedAt: now })
      .where(
        and(
          eq(calendarEvents.kind, kind),
          isNull(calendarEvents.remindedAt),
          gt(calendarEvents.startsAt, now),
          lte(calendarEvents.startsAt, new Date(now.getTime() + LEAD[kind])),
        ),
      )
      .returning()
    for (const r of due) {
      let who: string[]
      if (!r.channelId) who = r.createdBy ? [r.createdBy] : []
      else {
        const members = await ctx.db
          .select({ userId: channelMembers.userId })
          .from(channelMembers)
          .where(eq(channelMembers.channelId, r.channelId))
        const done = await ctx.db
          .select({ userId: calendarEventDone.userId })
          .from(calendarEventDone)
          .where(eq(calendarEventDone.eventId, r.id))
        const skip = new Set([...done.map((d) => d.userId), r.createdBy])
        who = members.map((m) => m.userId).filter((id) => !skip.has(id))
      }
      if (!who.length) continue
      const slug = await orgSlug(ctx, r.orgId)
      const word =
        r.kind === 'homework'
          ? 'Homework due soon'
          : r.kind === 'test'
            ? 'Test tomorrow'
            : 'Starting soon'
      await createNotifications(
        ctx,
        who.map((userId) => ({
          orgId: r.orgId,
          userId,
          kind: 'calendar' as const,
          actorId: null,
          channelId: r.channelId,
          messageId: null,
          threadId: null,
          title: `${word}: ${r.title}`,
          preview: r.notes.slice(0, 200),
          link: `/${slug}/calendar?d=${dayParam(r.startsAt)}&e=${r.id}`,
        })),
      )
    }
  }
}

import { meetings, officeHourBookings, officeHours, organizations, orgMemberships } from '@quid/db'
import type { OfficeHour, OfficeHourBooking, OfficeHourSlot, OfficeHourTeacher } from '@quid/shared'
import { and, asc, eq, gt, gte, inArray, isNull, lte, ne, or } from 'drizzle-orm'
import { z } from 'zod'
import { type OrgScope, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors'
import type { App } from '../../core/http'
import { onTick } from '../../core/jobs'
import { createMeeting } from '../meetings/service'
import { createNotifications } from '../notifications/service'
import { userSummaries } from './common'

type HourRow = typeof officeHours.$inferSelect
type BookingRow = typeof officeHourBookings.$inferSelect

const DAY = 86_400_000
const AHEAD_DAYS = 14
const isTeacher = (s: OrgScope) => s.role === 'owner' || s.role === 'admin'
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

function validZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function zoneParts(at: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  )
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    asUtc: Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    ),
  }
}

export function wallToUtc(date: string, minutes: number, tz: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const guess = Date.UTC(y, m - 1, d, 0, minutes)
  let t = guess - (zoneParts(new Date(guess), tz).asUtc - guess)
  t = guess - (zoneParts(new Date(t), tz).asUtc - t)
  return new Date(t)
}

function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay()

export function slotsFor(h: HourRow, now = new Date(), days = AHEAD_DAYS) {
  const out: { startsAt: Date; endsAt: Date }[] = []
  if (!h.active) return out
  const today = zoneParts(now, h.timezone).date
  const start = toMin(h.startTime)
  const end = toMin(h.endTime)
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i)
    if (weekdayOf(date) !== h.weekday || h.skipDates.includes(date)) continue
    for (let m = start; m + h.slotMinutes <= end; m += h.slotMinutes) {
      const s = wallToUtc(date, m, h.timezone)
      if (s.getTime() <= now.getTime()) continue
      out.push({ startsAt: s, endsAt: new Date(s.getTime() + h.slotMinutes * 60_000) })
    }
  }
  return out
}

async function serializeHours(ctx: AppContext, rows: HourRow[]): Promise<OfficeHour[]> {
  const people = await userSummaries(
    ctx,
    rows.map((r) => r.teacherId),
  )
  return rows
    .filter((r) => people.has(r.teacherId))
    .map((r) => ({
      id: r.id,
      teacher: people.get(r.teacherId)!,
      weekday: r.weekday,
      startTime: r.startTime,
      endTime: r.endTime,
      slotMinutes: r.slotMinutes,
      location: r.location,
      online: r.online,
      note: r.note,
      timezone: r.timezone,
      skipDates: r.skipDates,
      active: r.active,
    }))
}

export async function serializeBookings(
  ctx: AppContext,
  viewerId: string,
  rows: BookingRow[],
): Promise<OfficeHourBooking[]> {
  if (!rows.length) return []
  const people = await userSummaries(
    ctx,
    rows.flatMap((r) => [r.teacherId, r.studentId]),
  )
  const meetIds = rows.map((r) => r.meetingId).filter((x): x is string => !!x)
  const codes = meetIds.length
    ? await ctx.db
        .select({ id: meetings.id, code: meetings.code })
        .from(meetings)
        .where(inArray(meetings.id, meetIds))
    : []
  const codeOf = new Map(codes.map((c) => [c.id, c.code]))
  const hourIds = rows.map((r) => r.officeHourId).filter((x): x is string => !!x)
  const hours = hourIds.length
    ? await ctx.db
        .select({ id: officeHours.id, online: officeHours.online })
        .from(officeHours)
        .where(inArray(officeHours.id, hourIds))
    : []
  const onlineOf = new Map(hours.map((h) => [h.id, h.online]))
  return rows
    .filter((r) => people.has(r.teacherId) && people.has(r.studentId))
    .map((r) => ({
      id: r.id,
      teacher: people.get(r.teacherId)!,
      student: people.get(r.studentId)!,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      topic: r.topic,
      location: r.location,
      online: !!r.meetingId || (!!r.officeHourId && onlineOf.get(r.officeHourId) === true),
      meetingCode: (r.meetingId && codeOf.get(r.meetingId)) || null,
      status: r.status,
      cancelledByMe: r.cancelledBy === viewerId,
    }))
}

async function orgSlug(ctx: AppContext, orgId: string) {
  const [o] = await ctx.db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, orgId))
  return o?.slug ?? ''
}

function when(d: Date, tz: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

const hourBody = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: hhmm,
  endTime: hhmm,
  slotMinutes: z.number().int().min(5).max(120).default(15),
  location: z.string().trim().max(120).default(''),
  online: z.boolean().default(false),
  note: z.string().trim().max(500).default(''),
  timezone: z.string().min(1).max(64),
  skipDates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .max(60)
    .default([]),
  active: z.boolean().default(true),
})

function checkHour(h: z.infer<typeof hourBody>) {
  if (!validZone(h.timezone)) throw badRequest('Unknown time zone.')
  const len = toMin(h.endTime) - toMin(h.startTime)
  if (len < h.slotMinutes)
    throw badRequest('The end time has to be at least one slot after the start.')
  if (len / h.slotMinutes > 48) throw badRequest('Thats too many slots, make them longer.')
}

export async function officeHourRoutes(app: App, ctx: AppContext) {
  const base = '/api/orgs/:orgId/office-hours'
  const params = z.object({ orgId: z.uuid(), id: z.uuid() })

  async function ownHour(scope: OrgScope, id: string) {
    const row = await ctx.db.query.officeHours.findFirst({
      where: and(
        eq(officeHours.id, id),
        eq(officeHours.orgId, scope.orgId),
        eq(officeHours.teacherId, scope.userId),
      ),
    })
    if (!row) throw notFound('Office hours')
    return row
  }

  async function activeTeacherIds(orgId: string) {
    const rows = await ctx.db
      .select({ userId: orgMemberships.userId })
      .from(orgMemberships)
      .where(
        and(
          eq(orgMemberships.orgId, orgId),
          isNull(orgMemberships.deactivatedAt),
          inArray(orgMemberships.role, ['owner', 'admin']),
        ),
      )
    return new Set(rows.map((r) => r.userId))
  }

  async function takenFor(teacherId: string, from: Date) {
    const rows = await ctx.db
      .select({ startsAt: officeHourBookings.startsAt })
      .from(officeHourBookings)
      .where(
        and(
          eq(officeHourBookings.teacherId, teacherId),
          eq(officeHourBookings.status, 'booked'),
          gte(officeHourBookings.startsAt, from),
        ),
      )
    return new Set(rows.map((r) => r.startsAt.getTime()))
  }

  app.get(
    `${base}/teachers`,
    { schema: { params: z.object({ orgId: z.uuid() }) } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const teachers = await activeTeacherIds(scope.orgId)
      const rows = (
        await ctx.db
          .select()
          .from(officeHours)
          .where(and(eq(officeHours.orgId, scope.orgId), eq(officeHours.active, true)))
          .orderBy(asc(officeHours.weekday), asc(officeHours.startTime))
      ).filter((r) => teachers.has(r.teacherId))
      const hours = await serializeHours(ctx, rows)
      const now = new Date()
      const byTeacher = new Map<string, OfficeHourTeacher>()
      for (const h of hours) {
        const t = byTeacher.get(h.teacher.id) ?? { teacher: h.teacher, hours: [], nextOpen: null }
        t.hours.push(h)
        byTeacher.set(h.teacher.id, t)
      }
      for (const t of byTeacher.values()) {
        const taken = await takenFor(t.teacher.id, now)
        const next = rows
          .filter((r) => r.teacherId === t.teacher.id)
          .flatMap((r) => slotsFor(r, now))
          .filter((s) => !taken.has(s.startsAt.getTime()))
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0]
        t.nextOpen = next?.startsAt.toISOString() ?? null
      }
      return [...byTeacher.values()].sort((a, b) => a.teacher.name.localeCompare(b.teacher.name))
    },
  )

  app.get(
    `${base}/teachers/:teacherId/slots`,
    { schema: { params: z.object({ orgId: z.uuid(), teacherId: z.uuid() }) } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const rows = await ctx.db
        .select()
        .from(officeHours)
        .where(
          and(
            eq(officeHours.orgId, scope.orgId),
            eq(officeHours.teacherId, req.params.teacherId),
            eq(officeHours.active, true),
          ),
        )
      const now = new Date()
      const taken = await takenFor(req.params.teacherId, now)
      const slots: OfficeHourSlot[] = rows.flatMap((r) =>
        slotsFor(r, now).map((s) => ({
          officeHourId: r.id,
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
          taken: taken.has(s.startsAt.getTime()),
          location: r.location,
          online: r.online,
        })),
      )
      const seen = new Set<string>()
      return slots
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .filter((s) => {
          if (seen.has(s.startsAt)) return false
          seen.add(s.startsAt)
          return true
        })
    },
  )

  app.get(`${base}/mine`, { schema: { params: z.object({ orgId: z.uuid() }) } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const rows = await ctx.db
      .select()
      .from(officeHours)
      .where(and(eq(officeHours.orgId, scope.orgId), eq(officeHours.teacherId, scope.userId)))
      .orderBy(asc(officeHours.weekday), asc(officeHours.startTime))
    return serializeHours(ctx, rows)
  })

  app.post(
    base,
    { schema: { params: z.object({ orgId: z.uuid() }), body: hourBody } },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      if (!isTeacher(scope)) throw forbidden('Only teachers can set office hours.')
      checkHour(req.body)
      const count = await ctx.db
        .select({ id: officeHours.id })
        .from(officeHours)
        .where(and(eq(officeHours.orgId, scope.orgId), eq(officeHours.teacherId, scope.userId)))
      if (count.length >= 20) throw badRequest('You can have 20 office hour times at most.')
      const [row] = await ctx.db
        .insert(officeHours)
        .values({ ...req.body, orgId: scope.orgId, teacherId: scope.userId })
        .returning()
      return reply.code(201).send((await serializeHours(ctx, [row!]))[0])
    },
  )

  app.patch(`${base}/:id`, { schema: { params, body: hourBody.partial() } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await ownHour(scope, req.params.id)
    const next = { ...row, ...req.body }
    checkHour(next)
    const [saved] = await ctx.db
      .update(officeHours)
      .set(req.body)
      .where(eq(officeHours.id, row.id))
      .returning()
    return (await serializeHours(ctx, [saved!]))[0]
  })

  app.delete(`${base}/:id`, { schema: { params } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await ownHour(scope, req.params.id)
    const future = await ctx.db
      .select()
      .from(officeHourBookings)
      .where(
        and(
          eq(officeHourBookings.officeHourId, row.id),
          eq(officeHourBookings.status, 'booked'),
          gt(officeHourBookings.startsAt, new Date()),
        ),
      )
    for (const b of future) await cancel(ctx, scope, b, row.timezone)
    await ctx.db.delete(officeHours).where(eq(officeHours.id, row.id))
    return { ok: true, cancelled: future.length }
  })

  app.get(
    `${base}/bookings`,
    { schema: { params: z.object({ orgId: z.uuid() }) } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const rows = await ctx.db
        .select()
        .from(officeHourBookings)
        .where(
          and(
            eq(officeHourBookings.orgId, scope.orgId),
            or(
              eq(officeHourBookings.studentId, scope.userId),
              eq(officeHourBookings.teacherId, scope.userId),
            ),
            gte(officeHourBookings.endsAt, new Date(Date.now() - 7 * DAY)),
          ),
        )
        .orderBy(asc(officeHourBookings.startsAt))
        .limit(300)
      return serializeBookings(ctx, scope.userId, rows)
    },
  )

  app.post(
    `${base}/bookings`,
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ orgId: z.uuid() }),
        body: z.object({
          officeHourId: z.uuid(),
          startsAt: z.iso.datetime({ offset: true }),
          topic: z.string().trim().max(300).default(''),
        }),
      },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const hour = await ctx.db.query.officeHours.findFirst({
        where: and(eq(officeHours.id, req.body.officeHourId), eq(officeHours.orgId, scope.orgId)),
      })
      if (!hour?.active) throw notFound('Office hours')
      if (hour.teacherId === scope.userId) throw badRequest('You cant book your own office hours.')
      if (!(await activeTeacherIds(scope.orgId)).has(hour.teacherId)) throw notFound('Office hours')
      const at = new Date(req.body.startsAt).getTime()
      const slot = slotsFor(hour).find((s) => s.startsAt.getTime() === at)
      if (!slot) throw badRequest('That slot isnt open anymore.')
      const already = await ctx.db
        .select({ id: officeHourBookings.id })
        .from(officeHourBookings)
        .where(
          and(
            eq(officeHourBookings.teacherId, hour.teacherId),
            eq(officeHourBookings.studentId, scope.userId),
            eq(officeHourBookings.status, 'booked'),
            gt(officeHourBookings.endsAt, new Date()),
          ),
        )
      if (already.length)
        throw conflict(
          'You already have a slot with this teacher. Cancel it first to pick another.',
        )
      const [row] = await ctx.db
        .insert(officeHourBookings)
        .values({
          orgId: scope.orgId,
          officeHourId: hour.id,
          teacherId: hour.teacherId,
          studentId: scope.userId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          topic: req.body.topic,
          location: hour.location || (hour.online ? 'Online' : ''),
        })
        .onConflictDoNothing()
        .returning()
      if (!row) throw conflict('Someone just took that slot. Pick another one.')

      const people = await userSummaries(ctx, [scope.userId, hour.teacherId])
      const student = people.get(scope.userId)
      let saved = row
      if (hour.online && ctx.media.configured) {
        try {
          const teacherScope = await ctx.db.query.orgMemberships.findFirst({
            where: and(
              eq(orgMemberships.orgId, scope.orgId),
              eq(orgMemberships.userId, hour.teacherId),
            ),
          })
          const meeting = await createMeeting(
            ctx,
            {
              orgId: scope.orgId,
              userId: hour.teacherId,
              role: teacherScope?.role ?? 'admin',
              departmentId: teacherScope?.departmentId ?? null,
            },
            {
              title: `Office hours with ${student?.displayName || student?.name || 'a student'}`,
              description: req.body.topic,
              scheduledFor: slot.startsAt.toISOString(),
              durationMinutes: hour.slotMinutes,
              waitingRoom: false,
              guestAccess: false,
              channelId: null,
              inviteeIds: [scope.userId],
            },
          )
          const [withMeeting] = await ctx.db
            .update(officeHourBookings)
            .set({ meetingId: meeting.id })
            .where(eq(officeHourBookings.id, row.id))
            .returning()
          saved = withMeeting ?? row
        } catch (err) {
          ctx.log.warn({ err }, 'office hours meeting failed')
        }
      }

      const slug = await orgSlug(ctx, scope.orgId)
      await createNotifications(ctx, [
        {
          orgId: scope.orgId,
          userId: hour.teacherId,
          kind: 'office_hours',
          actorId: scope.userId,
          channelId: null,
          messageId: null,
          threadId: null,
          title: `${student?.displayName || student?.name || 'A student'} booked office hours for ${when(slot.startsAt, hour.timezone)}`,
          preview: req.body.topic.slice(0, 200),
          link: `/${slug}/office-hours?tab=bookings`,
        },
      ])
      return reply.code(201).send((await serializeBookings(ctx, scope.userId, [saved]))[0])
    },
  )

  app.post(`${base}/bookings/:id/cancel`, { schema: { params } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await ctx.db.query.officeHourBookings.findFirst({
      where: and(
        eq(officeHourBookings.id, req.params.id),
        eq(officeHourBookings.orgId, scope.orgId),
        or(
          eq(officeHourBookings.studentId, scope.userId),
          eq(officeHourBookings.teacherId, scope.userId),
        ),
      ),
    })
    if (!row) throw notFound('Booking')
    if (row.status === 'cancelled') return (await serializeBookings(ctx, scope.userId, [row]))[0]
    const hour = row.officeHourId
      ? await ctx.db.query.officeHours.findFirst({ where: eq(officeHours.id, row.officeHourId) })
      : null
    const saved = await cancel(ctx, scope, row, hour?.timezone ?? 'UTC')
    return (await serializeBookings(ctx, scope.userId, [saved]))[0]
  })

  onTick(remindBookings)
}

async function cancel(ctx: AppContext, scope: OrgScope, row: BookingRow, tz: string) {
  const [saved] = await ctx.db
    .update(officeHourBookings)
    .set({ status: 'cancelled', cancelledBy: scope.userId })
    .where(and(eq(officeHourBookings.id, row.id), ne(officeHourBookings.status, 'cancelled')))
    .returning()
  if (!saved) return row
  if (row.meetingId)
    await ctx.db
      .update(meetings)
      .set({ endedAt: new Date() })
      .where(and(eq(meetings.id, row.meetingId), isNull(meetings.startedAt)))
  const other = scope.userId === row.studentId ? row.teacherId : row.studentId
  const people = await userSummaries(ctx, [scope.userId])
  const me = people.get(scope.userId)
  const slug = await orgSlug(ctx, row.orgId)
  await createNotifications(ctx, [
    {
      orgId: row.orgId,
      userId: other,
      kind: 'office_hours',
      actorId: scope.userId,
      channelId: null,
      messageId: null,
      threadId: null,
      title: `${me?.displayName || me?.name || 'Someone'} cancelled office hours on ${when(row.startsAt, tz)}`,
      preview: row.topic.slice(0, 200),
      link: `/${slug}/office-hours?tab=bookings`,
    },
  ])
  return saved
}

export async function remindBookings(ctx: AppContext, now = new Date()) {
  const due = await ctx.db
    .update(officeHourBookings)
    .set({ remindedAt: now })
    .where(
      and(
        eq(officeHourBookings.status, 'booked'),
        isNull(officeHourBookings.remindedAt),
        gt(officeHourBookings.startsAt, now),
        lte(officeHourBookings.startsAt, new Date(now.getTime() + 10 * 60_000)),
      ),
    )
    .returning()
  for (const b of due) {
    const people = await userSummaries(ctx, [b.teacherId, b.studentId])
    const name = (id: string) => people.get(id)?.displayName || people.get(id)?.name || 'someone'
    const slug = await orgSlug(ctx, b.orgId)
    const where = b.location ? ` (${b.location})` : ''
    await createNotifications(
      ctx,
      [
        {
          userId: b.studentId,
          title: `Office hours with ${name(b.teacherId)} in 10 minutes${where}`,
        },
        {
          userId: b.teacherId,
          title: `${name(b.studentId)} is coming to office hours in 10 minutes`,
        },
      ].map((x) => ({
        orgId: b.orgId,
        userId: x.userId,
        kind: 'office_hours' as const,
        actorId: null,
        channelId: null,
        messageId: null,
        threadId: null,
        title: x.title,
        preview: b.topic.slice(0, 200),
        link: `/${slug}/office-hours?tab=bookings`,
      })),
    )
  }
}

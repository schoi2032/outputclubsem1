import { organizations, orgMemberships } from '@quid/db'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { remindCalendar } from '../src/modules/productivity/calendar'
import { remindBookings, wallToUtc } from '../src/modules/productivity/office-hours'
import { makeApp, signUp } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
beforeAll(async () => {
  t = await makeApp({ SCHOOL_EMAIL_DOMAIN: 'example.com' })
})
afterAll(async () => {
  await t.app.close()
})

async function school() {
  const owner = await signUp(t.app, t.email, 'Teacher')
  const ana = await signUp(t.app, t.email, 'Ana')
  const ben = await signUp(t.app, t.email, 'Ben')
  const org = await t.ctx.db.query.organizations.findFirst({
    where: eq(organizations.slug, t.ctx.config.SCHOOL_ORG_SLUG),
  })
  const orgId = org!.id
  for (const [u, role] of [
    [owner, 'admin'],
    [ana, 'member'],
    [ben, 'member'],
  ] as const)
    await t.ctx.db
      .update(orgMemberships)
      .set({ role })
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, u.id)))
  const base = `/api/orgs/${orgId}`
  const ch = await owner.client.post(`${base}/channels`, {
    name: `bio-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    memberIds: [ana.id, ben.id],
  })
  if (ch.status !== 201) throw new Error(JSON.stringify(ch.body))
  return { owner, orgId, ana, ben, base, channelId: ch.body.id as string }
}

const kindsOf = async (client: { get: (u: string) => Promise<{ body: unknown }> }, base: string) =>
  (
    (await client.get(`${base}/notifications`)).body as {
      notifications: { kind: string; title: string }[]
    }
  ).notifications.filter((n) => n.kind === 'calendar' || n.kind === 'office_hours')

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

describe('calendar', () => {
  it('teachers post homework, students check it off, teachers see who is missing', async () => {
    const o = await school()
    const hw = await o.owner.client.post(`${o.base}/calendar/events`, {
      kind: 'homework',
      title: 'Lab report',
      startsAt: inDays(3),
      channelId: o.channelId,
    })
    expect(hw.status).toBe(201)
    expect(hw.body.memberCount).toBe(2)
    expect(hw.body.doneCount).toBe(0)

    expect((await kindsOf(o.ana.client, o.base))[0]?.title).toContain('New homework')

    const range = `from=${encodeURIComponent(inDays(0))}&to=${encodeURIComponent(inDays(7))}`
    const cal = await o.ana.client.get(`${o.base}/calendar?${range}`)
    expect(cal.body.map((i: { id: string }) => i.id)).toContain(hw.body.id)

    const done = await o.ana.client.post(`${o.base}/calendar/events/${hw.body.id}/done`, {
      done: true,
    })
    expect(done.body.done).toBe(true)
    expect(done.body.doneCount).toBeNull()

    const prog = await o.owner.client.get(`${o.base}/calendar/events/${hw.body.id}/progress`)
    expect(prog.body.map((p: { user: { name: string } }) => p.user.name)).toEqual(['Ben', 'Ana'])
    expect(prog.body[1].doneAt).not.toBeNull()

    const nope = await o.ana.client.patch(`${o.base}/calendar/events/${hw.body.id}`, {
      title: 'No homework',
    })
    expect(nope.status).toBe(403)
  })

  it('students only make personal events, which nobody else sees', async () => {
    const o = await school()
    const bad = await o.ana.client.post(`${o.base}/calendar/events`, {
      kind: 'test',
      title: 'Fake test',
      startsAt: inDays(2),
      channelId: o.channelId,
    })
    expect(bad.status).toBe(403)
    const mine = await o.ana.client.post(`${o.base}/calendar/events`, {
      title: 'Dentist',
      startsAt: inDays(2),
    })
    expect(mine.status).toBe(201)
    expect(mine.body.kind).toBe('personal')
    const range = `from=${encodeURIComponent(inDays(0))}&to=${encodeURIComponent(inDays(7))}`
    const bens = await o.ben.client.get(`${o.base}/calendar?${range}`)
    expect(bens.body.map((i: { id: string }) => i.id)).not.toContain(mine.body.id)
    expect((await o.ben.client.get(`${o.base}/calendar/events/${mine.body.id}`)).status).toBe(404)
  })

  it('reminds people who have not finished, once', async () => {
    const o = await school()
    const hw = await o.owner.client.post(`${o.base}/calendar/events`, {
      kind: 'homework',
      title: 'Worksheet',
      startsAt: inDays(1),
      channelId: o.channelId,
    })
    await o.ben.client.post(`${o.base}/calendar/events/${hw.body.id}/done`, { done: true })
    const later = new Date(Date.now() + 14 * 3_600_000)
    await remindCalendar(t.ctx, later)
    await remindCalendar(t.ctx, later)
    const ana = (await kindsOf(o.ana.client, o.base)).filter((n) => n.title.includes('due soon'))
    const ben = (await kindsOf(o.ben.client, o.base)).filter((n) => n.title.includes('due soon'))
    expect(ana).toHaveLength(1)
    expect(ben).toHaveLength(0)
  })
})

describe('office hours', () => {
  it('converts wall time in a zone to UTC', () => {
    expect(wallToUtc('2026-11-17', 15 * 60, 'Asia/Seoul').toISOString()).toBe(
      '2026-11-17T06:00:00.000Z',
    )
    expect(wallToUtc('2026-07-01', 9 * 60, 'America/Los_Angeles').toISOString()).toBe(
      '2026-07-01T16:00:00.000Z',
    )
  })

  it('students book open slots, one at a time, and either side can cancel', async () => {
    const o = await school()
    const bad = await o.ana.client.post(`${o.base}/office-hours`, {
      weekday: 2,
      startTime: '15:00',
      endTime: '16:00',
      timezone: 'Asia/Seoul',
    })
    expect(bad.status).toBe(403)

    const hours = await Promise.all(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) =>
        o.owner.client.post(`${o.base}/office-hours`, {
          weekday,
          startTime: '00:00',
          endTime: '23:30',
          slotMinutes: 30,
          location: 'Room 204',
          timezone: 'Asia/Seoul',
        }),
      ),
    )
    expect(hours.every((h) => h.status === 201)).toBe(true)

    const teachers = await o.ana.client.get(`${o.base}/office-hours/teachers`)
    const mine = teachers.body.find((x: { teacher: { id: string } }) => x.teacher.id === o.owner.id)
    expect(mine.hours).toHaveLength(7)
    expect(mine.nextOpen).not.toBeNull()

    const slots = (await o.ana.client.get(`${o.base}/office-hours/teachers/${o.owner.id}/slots`))
      .body as { officeHourId: string; startsAt: string; taken: boolean }[]
    const pick = slots[2]!
    const booked = await o.ana.client.post(`${o.base}/office-hours/bookings`, {
      officeHourId: pick.officeHourId,
      startsAt: pick.startsAt,
      topic: 'Question about mitosis',
    })
    expect(booked.status).toBe(201)
    expect(booked.body.location).toBe('Room 204')

    const twice = await o.ana.client.post(`${o.base}/office-hours/bookings`, {
      officeHourId: slots[3]!.officeHourId,
      startsAt: slots[3]!.startsAt,
    })
    expect(twice.status).toBe(409)

    const taken = await o.ben.client.post(`${o.base}/office-hours/bookings`, {
      officeHourId: pick.officeHourId,
      startsAt: pick.startsAt,
    })
    expect(taken.status).toBe(409)

    const fake = await o.ben.client.post(`${o.base}/office-hours/bookings`, {
      officeHourId: pick.officeHourId,
      startsAt: new Date(new Date(pick.startsAt).getTime() + 60_000).toISOString(),
    })
    expect(fake.status).toBe(400)

    const after = (await o.ben.client.get(`${o.base}/office-hours/teachers/${o.owner.id}/slots`))
      .body as { startsAt: string; taken: boolean }[]
    expect(after.find((s) => s.startsAt === pick.startsAt)?.taken).toBe(true)

    expect((await kindsOf(o.owner.client, o.base))[0]?.title).toContain('booked office hours')

    await remindBookings(t.ctx, new Date(new Date(pick.startsAt).getTime() - 5 * 60_000))
    expect(
      (await kindsOf(o.ana.client, o.base)).some((n) => n.title.includes('in 10 minutes')),
    ).toBe(true)

    const cancelled = await o.owner.client.post(
      `${o.base}/office-hours/bookings/${booked.body.id}/cancel`,
    )
    expect(cancelled.body.status).toBe('cancelled')
    expect((await kindsOf(o.ana.client, o.base))[0]?.title).toContain('cancelled')

    const again = await o.ben.client.post(`${o.base}/office-hours/bookings`, {
      officeHourId: pick.officeHourId,
      startsAt: pick.startsAt,
    })
    expect(again.status).toBe(201)
  })
})

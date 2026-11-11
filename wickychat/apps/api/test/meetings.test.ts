import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, makeApp, setupOrg } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
beforeAll(async () => {
  t = await makeApp()
})
afterAll(async () => {
  await t.app.close()
})

async function org() {
  const o = await setupOrg(t.app, t.email)
  const bea = await o.addMember('member', 'Bea')
  const carl = await o.addMember('member', 'Carl')
  const gus = await o.addMember('guest', 'Gus')
  return { ...o, bea, carl, gus, base: `/api/orgs/${o.orgId}/meetings` }
}

describe('meetings', () => {
  it('creates an instant meeting the host can join, with moderator rights', async () => {
    const o = await org()
    const m = await o.owner.client.post(o.base, { title: 'Standup' })
    expect(m.status).toBe(201)
    expect(m.body.code).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/)
    expect(m.body.myRole).toBe('host')
    const j = await o.owner.client.post(`${o.base}/${m.body.code}/join`)
    expect(j.body.status).toBe('joined')
    expect(j.body.token).toBeTruthy()
    expect(t.media.grants.at(-1)).toMatchObject({ roomAdmin: true, room: `meet_${m.body.code}` })
    expect(j.body.meeting.status).toBe('live')
  })

  it('holds uninvited people in the waiting room until admitted', async () => {
    const o = await org()
    const m = await o.owner.client.post(o.base, { title: 'Review', waitingRoom: true })
    await o.owner.client.post(`${o.base}/${m.body.code}/join`)

    const wait = await o.carl.client.post(`${o.base}/${m.body.code}/join`)
    expect(wait.body.status).toBe('waiting')
    expect(wait.body.token).toBeUndefined()

    // Only moderators can admit.
    expect(
      (await o.bea.client.post(`${o.base}/${m.body.code}/admit`, { userId: o.carl.id })).status,
    ).toBe(403)
    expect(
      (await o.owner.client.post(`${o.base}/${m.body.code}/admit`, { userId: o.carl.id })).status,
    ).toBe(200)
    const inside = await o.carl.client.post(`${o.base}/${m.body.code}/join`)
    expect(inside.body.status).toBe('joined')
    expect(t.media.grants.at(-1)).toMatchObject({ identity: o.carl.id, roomAdmin: false })
  })

  it('lets invitees skip the waiting room, and denied people stay out', async () => {
    const o = await org()
    const m = await o.owner.client.post(o.base, { title: 'Plan', inviteeIds: [o.bea.id] })
    expect((await o.bea.client.post(`${o.base}/${m.body.code}/join`)).body.status).toBe('joined')
    const notes = await o.bea.client.get(`/api/orgs/${o.orgId}/notifications`)
    expect(notes.body.notifications[0]).toMatchObject({
      kind: 'meeting_invite',
      link: `/${o.slug}/meet/${m.body.code}`,
    })

    await o.carl.client.post(`${o.base}/${m.body.code}/join`)
    await o.owner.client.post(`${o.base}/${m.body.code}/deny`, { userId: o.carl.id })
    const meeting = await o.carl.client.get(`${o.base}/${m.body.code}`)
    expect(
      meeting.body.participants.find((p: { user: { id: string } }) => p.user.id === o.carl.id)
        .status,
    ).toBe('denied')
  })

  it('supports host controls: co-hosts, mute, remove, end for everyone', async () => {
    const o = await org()
    const m = await o.owner.client.post(o.base, { title: 'All hands', waitingRoom: false })
    const code = m.body.code
    for (const c of [o.owner.client, o.bea.client, o.carl.client])
      await c.post(`${o.base}/${code}/join`)

    expect(
      (await o.owner.client.post(`${o.base}/${code}/role`, { userId: o.bea.id, role: 'co_host' }))
        .status,
    ).toBe(200)
    expect((await o.bea.client.post(`${o.base}/${code}/mute`, { userId: o.carl.id })).status).toBe(
      200,
    )
    expect(t.media.actions).toContain(`mute:meet_${code}:${o.carl.id}`)

    expect(
      (await o.bea.client.post(`${o.base}/${code}/remove`, { userId: o.carl.id })).status,
    ).toBe(200)
    expect(t.media.actions).toContain(`remove:meet_${code}:${o.carl.id}`)
    expect((await o.carl.client.post(`${o.base}/${code}/join`)).status).toBe(403)
    // Nobody can remove the host.
    expect(
      (await o.bea.client.post(`${o.base}/${code}/remove`, { userId: o.owner.id })).status,
    ).toBe(403)

    expect((await o.carl.client.post(`${o.base}/${code}/end`)).status).toBe(403)
    expect((await o.bea.client.post(`${o.base}/${code}/end`)).status).toBe(200)
    expect(t.media.actions).toContain(`end:meet_${code}`)
    const after = await o.owner.client.get(o.base)
    expect(after.body.past.some((x: { code: string }) => x.code === code)).toBe(true)
  })

  it('ends when the last person leaves and lists scheduled meetings', async () => {
    const o = await org()
    const when = new Date(Date.now() + 86_400_000).toISOString()
    const s = await o.owner.client.post(o.base, {
      title: 'Quarterly review',
      scheduledFor: when,
      inviteeIds: [o.bea.id],
    })
    expect(s.status).toBe(201)
    // Scheduled invitations go out by email.
    expect(
      t.email.sent.some((e) => e.to === o.bea.email && e.subject.includes('Quarterly review')),
    ).toBe(true)
    const list = await o.bea.client.get(o.base)
    expect(list.body.upcoming.map((x: { code: string }) => x.code)).toContain(s.body.code)

    const m = await o.owner.client.post(o.base, { title: 'Quick sync' })
    await o.owner.client.post(`${o.base}/${m.body.code}/join`)
    await o.owner.client.post(`${o.base}/${m.body.code}/leave`)
    expect((await o.owner.client.get(`${o.base}/${m.body.code}`)).body.status).toBe('ended')
  })

  it('keeps meetings inside the organization and away from uninvited guests', async () => {
    const o = await org()
    const m = await o.owner.client.post(o.base, { title: 'Secret' })
    expect((await o.gus.client.get(`${o.base}/${m.body.code}`)).status).toBe(404)
    expect((await o.gus.client.post(o.base, { title: 'x' })).status).toBe(403)
    const other = await setupOrg(t.app, t.email)
    expect(
      (await other.owner.client.get(`/api/orgs/${other.orgId}/meetings/${m.body.code}`)).status,
    ).toBe(404)
    expect(
      (await other.owner.client.post(`/api/orgs/${o.orgId}/meetings/${m.body.code}/join`)).status,
    ).toBe(404)
  })

  it('moves a voice call into a meeting', async () => {
    const o = await org()
    const dm = await o.owner.client.post(`/api/orgs/${o.orgId}/conversations`, {
      userIds: [o.bea.id],
    })
    const call = await o.owner.client.post(`/api/orgs/${o.orgId}/channels/${dm.body.id}/calls`)
    await o.bea.client.post(`/api/orgs/${o.orgId}/calls/${call.body.call.id}/join`)
    const up = await o.owner.client.post(`/api/orgs/${o.orgId}/calls/${call.body.call.id}/upgrade`)
    expect(up.status).toBe(201)
    expect(up.body.waitingRoom).toBe(false)
    expect((await o.bea.client.post(`${o.base}/${up.body.code}/join`)).body.status).toBe('joined')
  })
})

describe('meeting guest links', () => {
  async function guestSetup(guestAccess: boolean) {
    const o = await org()
    const m = await o.owner.client.post(o.base, {
      title: 'Client call',
      guestAccess,
      waitingRoom: false,
    })
    await o.owner.client.post(`${o.base}/${m.body.code}/join`)
    return { ...o, code: m.body.code as string }
  }
  const anon = () => new Client(t.app)

  it('hides meetings without guest access', async () => {
    const o = await guestSetup(false)
    expect((await anon().get(`/api/public/meetings/${o.code}`)).status).toBe(404)
    expect(
      (await anon().post(`/api/public/meetings/${o.code}/guests`, { name: 'Visitor' })).status,
    ).toBe(404)
  })

  it('makes guests wait for a moderator, even with the waiting room off', async () => {
    const o = await guestSetup(true)
    const g = anon()
    const preview = await g.get(`/api/public/meetings/${o.code}`)
    expect(preview.body).toMatchObject({ title: 'Client call', status: 'live' })

    const req = await g.post(`/api/public/meetings/${o.code}/guests`, { name: 'Vera Visitor' })
    expect(req.status).toBe(201)
    const { guestId, guestToken } = req.body
    const join = (token = guestToken) =>
      t.app.inject({
        method: 'POST',
        url: `/api/public/meetings/${o.code}/guests/${guestId}/join`,
        headers: { origin: 'http://localhost:3000', 'x-guest-token': token },
      })

    expect((await join()).json().status).toBe('waiting')
    expect((await join('forged')).statusCode).toBe(401)

    const meeting = await o.owner.client.get(`${o.base}/${o.code}`)
    expect(meeting.body.guests).toEqual([
      expect.objectContaining({ name: 'Vera Visitor', status: 'waiting' }),
    ])
    // Regular members can't let guests in.
    expect((await o.bea.client.post(`${o.base}/${o.code}/guests/${guestId}/admit`)).status).toBe(
      403,
    )
    expect((await o.owner.client.post(`${o.base}/${o.code}/guests/${guestId}/admit`)).status).toBe(
      200,
    )

    const inside = (await join()).json()
    expect(inside.status).toBe('joined')
    expect(t.media.grants.at(-1)).toMatchObject({
      identity: `guest:${guestId}`,
      name: 'Vera Visitor (guest)',
      roomAdmin: false,
    })

    await o.owner.client.post(`${o.base}/${o.code}/guests/${guestId}/remove`)
    expect(t.media.actions).toContain(`remove:meet_${o.code}:guest:${guestId}`)
    expect((await join()).json().status).toBe('removed')
  })

  it('lets moderators deny guests', async () => {
    const o = await guestSetup(true)
    const req = await anon().post(`/api/public/meetings/${o.code}/guests`, { name: 'Spammer' })
    await o.owner.client.post(`${o.base}/${o.code}/guests/${req.body.guestId}/deny`)
    const r = await t.app.inject({
      method: 'POST',
      url: `/api/public/meetings/${o.code}/guests/${req.body.guestId}/join`,
      headers: { origin: 'http://localhost:3000', 'x-guest-token': req.body.guestToken },
    })
    expect(r.json().status).toBe('denied')
  })
})

describe('meeting calendar', () => {
  it('attaches calendar invites, emails updates and cancellations, and serves .ics', async () => {
    const o = await org()
    const when = new Date(Date.now() + 2 * 86_400_000)
    when.setUTCHours(15, 0, 0, 0)
    const m = await o.owner.client.post(o.base, {
      title: 'Roadmap',
      scheduledFor: when.toISOString(),
      durationMinutes: 60,
      inviteeIds: [o.bea.id],
    })

    const invite = t.email.sent.findLast(
      (e) => e.to === o.bea.email && e.subject.startsWith('Invitation: Roadmap'),
    )!
    const ics = invite.attachments?.[0]
    expect(ics?.contentType).toContain('text/calendar')
    expect(ics?.content).toContain('METHOD:REQUEST')
    expect(ics?.content).toContain(`UID:${m.body.id}@quid`)

    const later = new Date(when.getTime() + 3600_000)
    await o.owner.client.patch(`${o.base}/${m.body.code}`, { scheduledFor: later.toISOString() })
    const update = t.email.sent.findLast(
      (e) => e.to === o.bea.email && e.subject.startsWith('Updated: Roadmap'),
    )!
    expect(update.attachments?.[0]?.content).toContain(
      `DTSTART:${later
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '')}`,
    )

    const file = await t.app.inject({
      method: 'GET',
      url: `${o.base}/${m.body.code}/ics`,
      headers: { cookie: o.bea.client.cookie },
    })
    expect(file.headers['content-type']).toContain('text/calendar')
    expect(file.body).toContain('METHOD:PUBLISH')

    expect((await o.bea.client.del(`${o.base}/${m.body.code}`)).status).toBe(400)
    expect((await o.owner.client.del(`${o.base}/${m.body.code}`)).status).toBe(200)
    const cancel = t.email.sent.findLast(
      (e) => e.to === o.bea.email && e.subject.startsWith('Canceled: Roadmap'),
    )!
    expect(cancel.attachments?.[0]?.content).toContain('METHOD:CANCEL')
    expect((await o.owner.client.get(`${o.base}/${m.body.code}`)).status).toBe(404)
  })
})

describe('meeting transcripts', () => {
  it('stores speakers’ own caption lines and shows them only to attendees', async () => {
    const o = await org()
    const m = await o.owner.client.post(o.base, { title: 'Retro', waitingRoom: false })
    const code = m.body.code
    const now = new Date().toISOString()

    // Not in the meeting yet: can't add lines.
    expect(
      (
        await o.bea.client.post(`${o.base}/${code}/transcript`, {
          segments: [{ text: 'hi', spokenAt: now }],
        })
      ).status,
    ).toBe(403)

    await o.owner.client.post(`${o.base}/${code}/join`)
    await o.bea.client.post(`${o.base}/${code}/join`)
    await o.owner.client.post(`${o.base}/${code}/transcript`, {
      segments: [{ text: 'Welcome everyone', spokenAt: now }],
    })
    await o.bea.client.post(`${o.base}/${code}/transcript`, {
      segments: [
        { text: 'Thanks, glad to be here', spokenAt: new Date(Date.now() + 1000).toISOString() },
      ],
    })

    const t1 = await o.bea.client.get(`${o.base}/${code}/transcript`)
    expect(
      t1.body.map((s: { speakerName: string; text: string }) => `${s.speakerName}: ${s.text}`),
    ).toEqual(['Owner: Welcome everyone', 'Bea: Thanks, glad to be here'])
    expect((await o.owner.client.get(`${o.base}/${code}`)).body.transcriptLines).toBe(2)

    // Carl never attended.
    expect((await o.carl.client.get(`${o.base}/${code}/transcript`)).status).toBe(403)
  })
})

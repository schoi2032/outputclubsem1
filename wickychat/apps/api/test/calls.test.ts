import type { ServerEvent } from '@quid/shared'
import { topics } from '@quid/shared'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeApp, setupOrg } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
beforeAll(async () => {
  t = await makeApp()
})
afterAll(async () => {
  await t.app.close()
})

async function dmPair() {
  const o = await setupOrg(t.app, t.email)
  const bea = await o.addMember('member', 'Bea')
  const dm = await o.owner.client.post(`/api/orgs/${o.orgId}/conversations`, { userIds: [bea.id] })
  return { ...o, bea, dmId: dm.body.id as string, base: `/api/orgs/${o.orgId}` }
}

describe('voice calls', () => {
  it('rings, connects and ends a direct call', async () => {
    const o = await dmPair()
    const ringing: ServerEvent[] = []
    const off = t.bus.subscribe(topics.user(o.bea.id), (e) => ringing.push(e))

    const start = await o.owner.client.post(`${o.base}/channels/${o.dmId}/calls`)
    expect(start.status).toBe(201)
    expect(start.body.token).toBeTruthy()
    expect(start.body.url).toBe('ws://livekit.test')
    expect(start.body.call.status).toBe('ringing')
    expect(ringing.some((e) => e.type === 'call.ringing')).toBe(true)
    off()

    // Starting again joins the same call instead of creating a second one.
    const again = await o.owner.client.post(`${o.base}/channels/${o.dmId}/calls`)
    expect(again.status).toBe(200)
    expect(again.body.call.id).toBe(start.body.call.id)

    const answer = await o.bea.client.post(`${o.base}/calls/${start.body.call.id}/join`)
    expect(answer.status).toBe(200)
    expect(answer.body.call.status).toBe('active')
    expect(answer.body.call.answeredAt).not.toBeNull()

    const active = await o.bea.client.get(`${o.base}/calls/active`)
    expect(active.body).toHaveLength(1)

    const hangup = await o.bea.client.post(`${o.base}/calls/${start.body.call.id}/leave`)
    expect(hangup.body.status).toBe('ended')
    const history = await o.owner.client.get(`${o.base}/calls`)
    expect(history.body.calls[0].status).toBe('ended')
    const msgs = await o.owner.client.get(`${o.base}/channels/${o.dmId}/messages`)
    expect(msgs.body.messages.at(-1).text).toMatch(/^Call ended/)
  })

  it('records a declined call', async () => {
    const o = await dmPair()
    const start = await o.owner.client.post(`${o.base}/channels/${o.dmId}/calls`)
    const d = await o.bea.client.post(`${o.base}/calls/${start.body.call.id}/decline`)
    expect(d.body.status).toBe('rejected')
  })

  it('marks unanswered calls as missed and notifies', async () => {
    const o = await dmPair()
    const start = await o.owner.client.post(`${o.base}/channels/${o.dmId}/calls`)
    await t.ctx.db.execute(
      sql`update jobs set run_at = now() - interval '1 second' where kind = 'call.ring_timeout'`,
    )
    await t.app.inject({
      method: 'POST',
      url: '/internal/cron/tick',
      headers: { 'x-internal-token': 'test-internal' },
    })
    const history = await o.owner.client.get(`${o.base}/calls`)
    expect(history.body.calls.find((c: { id: string }) => c.id === start.body.call.id).status).toBe(
      'missed',
    )
    const notes = await o.bea.client.get(`${o.base}/notifications`)
    expect(notes.body.notifications.map((n: { kind: string }) => n.kind)).toEqual(
      expect.arrayContaining(['missed_call', 'incoming_call']),
    )
  })

  it("doesn't let outsiders join or see calls", async () => {
    const o = await dmPair()
    const carl = await o.addMember('member', 'Carl')
    const start = await o.owner.client.post(`${o.base}/channels/${o.dmId}/calls`)
    expect((await carl.client.post(`${o.base}/calls/${start.body.call.id}/join`)).status).toBe(404)
    expect((await carl.client.post(`${o.base}/channels/${o.dmId}/calls`)).status).toBe(404)
    expect((await carl.client.get(`${o.base}/calls/active`)).body).toHaveLength(0)
    const other = await setupOrg(t.app, t.email)
    expect(
      (await other.owner.client.post(`/api/orgs/${other.orgId}/calls/${start.body.call.id}/join`))
        .status,
    ).toBe(404)
  })

  it('opens channel calls to members without ringing everyone', async () => {
    const o = await dmPair()
    const ch = await o.owner.client.post(`${o.base}/channels`, {
      name: 'standup',
      memberIds: [o.bea.id],
    })
    const start = await o.owner.client.post(`${o.base}/channels/${ch.body.id}/calls`)
    expect(start.body.call.status).toBe('active')
    expect(start.body.call.participants).toHaveLength(1)
    const join = await o.bea.client.post(`${o.base}/calls/${start.body.call.id}/join`)
    expect(join.body.call.participants).toHaveLength(2)
    await o.owner.client.post(`${o.base}/calls/${start.body.call.id}/leave`)
    const still = await o.bea.client.get(`${o.base}/calls/active`)
    expect(still.body[0].status).toBe('active')
    const end = await o.bea.client.post(`${o.base}/calls/${start.body.call.id}/leave`)
    expect(end.body.status).toBe('ended')
  })
})

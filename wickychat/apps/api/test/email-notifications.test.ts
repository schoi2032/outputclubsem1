import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { localHour, sendDigests } from '../src/modules/notifications/email'
import { doc, makeApp, setupOrg } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
beforeAll(async () => {
  t = await makeApp()
})
afterAll(async () => {
  await t.app.close()
})

const mention = (id: string, label: string, text: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'mention', attrs: { id, label, kind: 'user' } },
        { type: 'text', text: ` ${text}` },
      ],
    },
  ],
})

async function runDueEmails() {
  await t.ctx.db.execute(
    sql`update jobs set run_at = now() - interval '1 second' where kind = 'notify.offline_email' and status = 'pending'`,
  )
  await t.app.inject({
    method: 'POST',
    url: '/internal/cron/tick',
    headers: { 'x-internal-token': 'test-internal' },
  })
}

async function setup() {
  const o = await setupOrg(t.app, t.email)
  const bea = await o.addMember('member', 'Bea')
  const ch = await o.owner.client.post(`/api/orgs/${o.orgId}/channels`, {
    name: 'ops',
    memberIds: [bea.id],
  })
  return { ...o, bea, channelId: ch.body.id as string, base: `/api/orgs/${o.orgId}` }
}

describe('offline email summaries', () => {
  it('batches what you missed into one email', async () => {
    const o = await setup()
    await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: mention(o.bea.id, 'Bea', 'can you check the deploy?'),
    })
    await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: mention(o.bea.id, 'Bea', 'also the alerts'),
    })
    const [{ n }] = (await t.ctx.db.execute(
      sql`select count(*)::int as n from jobs where kind = 'notify.offline_email' and status = 'pending' and payload->>'userId' = ${o.bea.id}`,
    )) as unknown as [{ n: number }]
    expect(n).toBe(1)

    const before = t.email.sent.length
    await runDueEmails()
    const sent = t.email.sent.slice(before).filter((e) => e.to === o.bea.email)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.subject).toContain('2 new notifications')
    expect(sent[0]!.text).toContain('can you check the deploy?')

    // Nothing new: no second email.
    await runDueEmails()
    expect(t.email.sent.slice(before).filter((e) => e.to === o.bea.email)).toHaveLength(1)
  })

  it("doesn't email people who are online or already read it", async () => {
    const o = await setup()
    t.ctx.online.connect(o.bea.id)
    await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: mention(o.bea.id, 'Bea', 'hello'),
    })
    t.ctx.online.disconnect(o.bea.id)
    const before = t.email.sent.length
    await runDueEmails()
    expect(t.email.sent.slice(before).filter((e) => e.to === o.bea.email)).toHaveLength(0)

    await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: mention(o.bea.id, 'Bea', 'again'),
    })
    await o.bea.client.post(`${o.base}/notifications/read`, { all: true })
    await runDueEmails()
    expect(t.email.sent.slice(before).filter((e) => e.to === o.bea.email)).toHaveLength(0)
  })

  it('respects the preference', async () => {
    const o = await setup()
    await o.bea.client.put(`${o.base}/notification-preferences`, { emailOffline: false })
    const before = t.email.sent.length
    await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: mention(o.bea.id, 'Bea', 'ping'),
    })
    await runDueEmails()
    expect(t.email.sent.slice(before).filter((e) => e.to === o.bea.email)).toHaveLength(0)
  })
})

describe('daily digest', () => {
  it('computes local hours', () => {
    expect(localHour(new Date('2026-10-05T00:30:00Z'), 'Asia/Seoul')).toBe(9)
    expect(localHour(new Date('2026-10-05T00:30:00Z'), 'Not/AZone')).toBe(0)
  })

  it('sends one morning summary in the user’s time zone', async () => {
    const o = await setup()
    await o.bea.client.patch('/api/me', { timezone: 'Asia/Seoul' })
    await o.bea.client.put(`${o.base}/notification-preferences`, {
      emailDigest: true,
      emailOffline: false,
    })
    await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: doc('Morning update'),
    })
    await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: mention(o.bea.id, 'Bea', 'please review'),
    })

    const before = t.email.sent.length
    await sendDigests(t.ctx, new Date('2026-10-05T18:00:00Z')) // 03:00 in Seoul: too early
    expect(t.email.sent.slice(before).filter((e) => e.to === o.bea.email)).toHaveLength(0)

    await sendDigests(t.ctx, new Date('2026-10-06T00:30:00Z')) // 09:30 in Seoul
    const digest = t.email.sent.slice(before).filter((e) => e.to === o.bea.email)
    expect(digest).toHaveLength(1)
    expect(digest[0]!.subject).toContain('daily summary')
    expect(digest[0]!.text).toContain('#ops')

    await sendDigests(t.ctx, new Date('2026-10-06T01:30:00Z')) // same morning
    expect(t.email.sent.slice(before).filter((e) => e.to === o.bea.email)).toHaveLength(1)
  })
})

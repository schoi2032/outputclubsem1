import type { ServerEvent } from '@quid/shared'
import { topics } from '@quid/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { doc, makeApp, setupOrg } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
beforeAll(async () => {
  t = await makeApp()
})
afterAll(async () => {
  await t.app.close()
})

async function orgWithChannel() {
  const o = await setupOrg(t.app, t.email)
  const member = await o.addMember('member', 'Bea')
  const c = await o.owner.client.post(`/api/orgs/${o.orgId}/channels`, {
    name: 'project',
    memberIds: [member.id],
  })
  return { ...o, member, channelId: c.body.id as string, base: `/api/orgs/${o.orgId}` }
}

describe('message lifecycle', () => {
  it('sends, edits, deletes and broadcasts', async () => {
    const o = await orgWithChannel()
    const events: ServerEvent[] = []
    const off = t.bus.subscribe(topics.channel(o.channelId), (e) => events.push(e))

    const sent = await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: doc('hello'),
      clientId: 'c1',
    })
    expect(sent.status).toBe(201)
    expect(sent.body.text).toBe('hello')
    expect(sent.body.clientId).toBe('c1')

    expect(
      (await o.member.client.patch(`${o.base}/messages/${sent.body.id}`, { body: doc('hijack') }))
        .status,
    ).toBe(403)
    const edited = await o.owner.client.patch(`${o.base}/messages/${sent.body.id}`, {
      body: doc('hello, edited'),
    })
    expect(edited.body.editedAt).not.toBeNull()

    expect((await o.member.client.del(`${o.base}/messages/${sent.body.id}`)).status).toBe(403)
    expect((await o.owner.client.del(`${o.base}/messages/${sent.body.id}`)).status).toBe(200)
    const hist = await o.member.client.get(`${o.base}/channels/${o.channelId}/messages`)
    expect(hist.body.messages.find((m: { id: string }) => m.id === sent.body.id)).toBeUndefined()

    off()
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['message.created', 'message.updated', 'message.deleted']),
    )
  })

  it('rejects unsafe rich text', async () => {
    const o = await orgWithChannel()
    const r = await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      },
    })
    expect(r.status).toBe(400)
  })

  it('paginates history with cursors', async () => {
    const o = await orgWithChannel()
    for (let i = 0; i < 25; i++) {
      await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
        body: doc(`m${i}`),
      })
    }
    const p1 = await o.owner.client.get(`${o.base}/channels/${o.channelId}/messages?limit=10`)
    expect(p1.body.messages).toHaveLength(10)
    expect(p1.body.hasMoreBefore).toBe(true)
    expect(p1.body.messages.at(-1).text).toBe('m24')
    const p2 = await o.owner.client.get(
      `${o.base}/channels/${o.channelId}/messages?limit=10&before=${p1.body.messages[0].id}`,
    )
    expect(p2.body.messages.at(-1).text).toBe('m14')
    const ids = new Set([...p1.body.messages, ...p2.body.messages].map((m: { id: string }) => m.id))
    expect(ids.size).toBe(20)
    const around = await o.owner.client.get(
      `${o.base}/channels/${o.channelId}/messages?limit=6&around=${p2.body.messages[5].id}`,
    )
    expect(around.body.messages.map((m: { id: string }) => m.id)).toContain(p2.body.messages[5].id)
  })

  it('tracks unread counts and mentions', async () => {
    const o = await orgWithChannel()
    const mention = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: o.member.id, label: 'Bea', kind: 'user' } },
            { type: 'text', text: ' look' },
          ],
        },
      ],
    }
    const m1 = await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: doc('one'),
    })
    await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, { body: mention })
    const mine = await o.member.client.get(`${o.base}/channels/mine`)
    const ch = mine.body.find((c: { id: string }) => c.id === o.channelId)
    expect(ch.membership.unreadCount).toBe(2)
    expect(ch.membership.mentionCount).toBe(1)

    const notes = await o.member.client.get(`${o.base}/notifications`)
    expect(notes.body.notifications[0].kind).toBe('mention')

    await o.member.client.post(`${o.base}/channels/${o.channelId}/read`, { messageId: m1.body.id })
    const after = await o.member.client.get(`${o.base}/channels/mine`)
    expect(
      after.body.find((c: { id: string }) => c.id === o.channelId).membership.unreadCount,
    ).toBe(1)
  })

  it('supports threads, reactions, pins and bookmarks', async () => {
    const o = await orgWithChannel()
    const root = await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: doc('root'),
    })
    const reply = await o.member.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: doc('reply'),
      parentId: root.body.id,
    })
    expect(reply.status).toBe(201)
    const nested = await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: doc('x'),
      parentId: reply.body.id,
    })
    expect(nested.status).toBe(400)

    const thread = await o.owner.client.get(`${o.base}/messages/${root.body.id}/thread`)
    expect(thread.body.root.replyCount).toBe(1)
    expect(thread.body.replies).toHaveLength(1)
    expect(thread.body.root.replyUsers[0].id).toBe(o.member.id)
    const notes = await o.owner.client.get(`${o.base}/notifications?kind=threads`)
    expect(notes.body.notifications).toHaveLength(1)

    const r1 = await o.member.client.post(`${o.base}/messages/${root.body.id}/reactions`, {
      emoji: '👍',
    })
    await o.owner.client.post(`${o.base}/messages/${root.body.id}/reactions`, { emoji: '👍' })
    expect(r1.body.reactions[0].count).toBe(1)
    const msg = await o.owner.client.get(`${o.base}/messages/${root.body.id}`)
    expect(msg.body.reactions[0]).toMatchObject({ emoji: '👍', count: 2 })
    await o.owner.client.del(`${o.base}/messages/${root.body.id}/reactions`, { emoji: '👍' })

    await o.member.client.post(`${o.base}/messages/${root.body.id}/pin`)
    const pins = await o.owner.client.get(`${o.base}/channels/${o.channelId}/pins`)
    expect(pins.body).toHaveLength(1)

    await o.member.client.post(`${o.base}/messages/${root.body.id}/bookmark`)
    expect((await o.member.client.get(`${o.base}/bookmarks`)).body).toHaveLength(1)
    expect((await o.owner.client.get(`${o.base}/bookmarks`)).body).toHaveLength(0)
  })

  it('forwards with a snapshot and keeps DMs unique per pair', async () => {
    const o = await orgWithChannel()
    const src = await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: doc('forward me'),
    })
    const dm1 = await o.owner.client.post(`${o.base}/conversations`, { userIds: [o.member.id] })
    const dm2 = await o.member.client.post(`${o.base}/conversations`, { userIds: [o.owner.id] })
    expect(dm1.body.id).toBe(dm2.body.id)
    expect(dm1.body.kind).toBe('dm')

    const fwd = await o.owner.client.post(`${o.base}/messages/${src.body.id}/forward`, {
      targetChannelId: dm1.body.id,
    })
    expect(fwd.status).toBe(201)
    expect(fwd.body.forwardedFrom.text).toBe('forward me')

    const group = await o.owner.client.post(`${o.base}/conversations`, {
      userIds: [o.member.id],
      name: 'Pair',
    })
    expect(group.body.kind).toBe('group')
  })

  it('saves drafts and sends scheduled messages', async () => {
    const o = await orgWithChannel()
    await o.owner.client.put(`${o.base}/channels/${o.channelId}/draft`, {
      body: doc('half-written'),
    })
    const drafts = await o.owner.client.get(`${o.base}/drafts`)
    expect(drafts.body).toHaveLength(1)

    const tooSoon = await o.owner.client.post(`${o.base}/scheduled`, {
      channelId: o.channelId,
      body: doc('later'),
      sendAt: new Date().toISOString(),
    })
    expect(tooSoon.status).toBe(400)
    const s = await o.owner.client.post(`${o.base}/scheduled`, {
      channelId: o.channelId,
      body: doc('scheduled hello'),
      sendAt: new Date(Date.now() + 120_000).toISOString(),
    })
    expect(s.status).toBe(201)
    // Pretend time has passed.
    await t.ctx.db.execute(
      (await import('drizzle-orm'))
        .sql`update scheduled_messages set send_at = now() - interval '1 second' where id = ${s.body.id}`,
    )
    const tick = await t.app.inject({
      method: 'POST',
      url: '/internal/cron/tick',
      headers: { authorization: 'Bearer test-internal' },
    })
    expect(tick.statusCode).toBe(200)
    const hist = await o.owner.client.get(`${o.base}/channels/${o.channelId}/messages`)
    expect(hist.body.messages.some((m: { text: string }) => m.text === 'scheduled hello')).toBe(
      true,
    )
  })

  it('searches with filters', async () => {
    const o = await orgWithChannel()
    await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: doc('quarterly budget review'),
    })
    await o.member.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: doc('budget looks fine'),
    })
    const all = await o.member.client.get(`${o.base}/search?q=budget`)
    expect(all.body.messages).toHaveLength(2)
    const fromBea = await o.member.client.get(
      `${o.base}/search?q=${encodeURIComponent('budget from:bea')}`,
    )
    expect(fromBea.body.messages).toHaveLength(1)
    const inProject = await o.member.client.get(
      `${o.base}/search?q=${encodeURIComponent('in:#project budget')}`,
    )
    expect(inProject.body.messages).toHaveLength(2)
    expect(all.body.messages[0].highlight).toContain('«')
  })

  it('accepts incoming webhooks as a bot', async () => {
    const o = await orgWithChannel()
    const hook = await o.owner.client.post(`${o.base}/integrations/incoming-webhooks`, {
      name: 'Deploy bot',
      channelId: o.channelId,
    })
    expect(hook.status).toBe(201)
    const path = new URL(hook.body.secretUrl).pathname
    const res = await t.app.inject({
      method: 'POST',
      url: path,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ text: 'Deployed v1.2' }),
    })
    expect(res.statusCode).toBe(200)
    const hist = await o.owner.client.get(`${o.base}/channels/${o.channelId}/messages`)
    const last = hist.body.messages.at(-1)
    expect(last.text).toBe('Deployed v1.2')
    expect(last.author.isBot).toBe(true)
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/hooks/not-a-real-token-but-long-enough',
      headers: { 'content-type': 'application/json' },
      payload: '{"text":"x"}',
    })
    expect(bad.statusCode).toBe(404)
  })
})

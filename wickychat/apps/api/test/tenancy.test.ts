import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { doc, makeApp, setupOrg } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
beforeAll(async () => {
  t = await makeApp()
})
afterAll(async () => {
  await t.app.close()
})

describe('tenant isolation', () => {
  it('hides other organizations entirely', async () => {
    const a = await setupOrg(t.app, t.email)
    const b = await setupOrg(t.app, t.email)
    const chans = await a.owner.client.get(`/api/orgs/${a.orgId}/channels/mine`)
    const general = chans.body.find((c: { name: string }) => c.name === 'general')
    const msg = await a.owner.client.post(`/api/orgs/${a.orgId}/channels/${general.id}/messages`, {
      body: doc('secret'),
    })
    expect(msg.status).toBe(201)

    const outsider = b.owner.client
    expect((await outsider.get(`/api/orgs/${a.orgId}`)).status).toBe(404)
    expect((await outsider.get(`/api/orgs/${a.orgId}/members`)).status).toBe(404)
    // Using their own org id with another org's channel or message must also fail.
    expect((await outsider.get(`/api/orgs/${b.orgId}/channels/${general.id}`)).status).toBe(404)
    expect(
      (await outsider.get(`/api/orgs/${b.orgId}/channels/${general.id}/messages`)).status,
    ).toBe(404)
    expect((await outsider.get(`/api/orgs/${b.orgId}/messages/${msg.body.id}`)).status).toBe(404)
    expect(
      (
        await outsider.post(`/api/orgs/${b.orgId}/messages/${msg.body.id}/reactions`, {
          emoji: '👍',
        })
      ).status,
    ).toBe(404)
    const search = await outsider.get(`/api/orgs/${b.orgId}/search?q=secret`)
    expect(search.body.messages).toHaveLength(0)
  })
})

describe('roles and channel permissions', () => {
  it('enforces org roles on the server', async () => {
    const o = await setupOrg(t.app, t.email)
    const member = await o.addMember('member')
    expect(
      (
        await member.client.post(`/api/orgs/${o.orgId}/invitations`, {
          emails: ['x@example.com'],
          role: 'member',
        })
      ).status,
    ).toBe(403)
    expect(
      (await member.client.patch(`/api/orgs/${o.orgId}/members/${o.owner.id}`, { role: 'guest' }))
        .status,
    ).toBe(403)
    expect((await member.client.get(`/api/orgs/${o.orgId}/audit`)).status).toBe(403)
    expect((await member.client.patch(`/api/orgs/${o.orgId}`, { name: 'Hacked' })).status).toBe(403)

    const admin = await o.addMember('admin', 'Admin')
    // Admins cannot create owners or demote owners.
    expect(
      (await admin.client.patch(`/api/orgs/${o.orgId}/members/${member.id}`, { role: 'owner' }))
        .status,
    ).toBe(403)
    expect(
      (await admin.client.patch(`/api/orgs/${o.orgId}/members/${o.owner.id}`, { role: 'member' }))
        .status,
    ).toBe(403)
    expect(
      (
        await admin.client.patch(`/api/orgs/${o.orgId}/members/${member.id}`, {
          role: 'team_manager',
        })
      ).status,
    ).toBe(200)

    const audit = await o.owner.client.get(`/api/orgs/${o.orgId}/audit`)
    expect(
      audit.body.entries.some((e: { action: string }) => e.action === 'member.role_changed'),
    ).toBe(true)
  })

  it('keeps private channels private, even from admins', async () => {
    const o = await setupOrg(t.app, t.email)
    const member = await o.addMember('member')
    const admin = await o.addMember('admin')
    const priv = await member.client.post(`/api/orgs/${o.orgId}/channels`, {
      name: 'secret-plans',
      kind: 'private',
    })
    expect(priv.status).toBe(201)
    await member.client.post(`/api/orgs/${o.orgId}/channels/${priv.body.id}/messages`, {
      body: doc('classified roadmap'),
    })

    expect(
      (await admin.client.get(`/api/orgs/${o.orgId}/channels/${priv.body.id}/messages`)).status,
    ).toBe(404)
    expect(
      (await admin.client.post(`/api/orgs/${o.orgId}/channels/${priv.body.id}/join`)).status,
    ).toBe(404)
    const browse = await admin.client.get(`/api/orgs/${o.orgId}/channels/browse`)
    expect(browse.body.some((c: { id: string }) => c.id === priv.body.id)).toBe(false)
    const s = await admin.client.get(`/api/orgs/${o.orgId}/search?q=classified`)
    expect(s.body.messages).toHaveLength(0)
  })

  it('limits guests to channels they were added to', async () => {
    const o = await setupOrg(t.app, t.email)
    const guest = await o.addMember('guest', 'Guest')
    const chans = await o.owner.client.get(`/api/orgs/${o.orgId}/channels/mine`)
    const general = chans.body.find((c: { name: string }) => c.name === 'general')
    expect(
      (await guest.client.get(`/api/orgs/${o.orgId}/channels/${general.id}/messages`)).status,
    ).toBe(404)
    expect(
      (await guest.client.post(`/api/orgs/${o.orgId}/channels`, { name: 'nope' })).status,
    ).toBe(403)
    const mine = await guest.client.get(`/api/orgs/${o.orgId}/channels/mine`)
    expect(mine.body).toHaveLength(0)
    const members = await guest.client.get(`/api/orgs/${o.orgId}/members`)
    expect(members.body.every((m: { email: string }) => m.email === '')).toBe(true)
  })

  it('restricts posting in announcement channels', async () => {
    const o = await setupOrg(t.app, t.email)
    const member = await o.addMember('member')
    const chans = await member.client.get(`/api/orgs/${o.orgId}/channels/mine`)
    const ann = chans.body.find((c: { name: string }) => c.name === 'announcements')
    expect(
      (
        await member.client.post(`/api/orgs/${o.orgId}/channels/${ann.id}/messages`, {
          body: doc('hi'),
        })
      ).status,
    ).toBe(403)
    const post = await o.owner.client.post(`/api/orgs/${o.orgId}/channels/${ann.id}/messages`, {
      body: doc('hi'),
    })
    expect(post.status).toBe(201)
    // Members can still reply in threads.
    const reply = await member.client.post(`/api/orgs/${o.orgId}/channels/${ann.id}/messages`, {
      body: doc('thanks'),
      parentId: post.body.id,
    })
    expect(reply.status).toBe(201)
  })

  it('browses active and archived channels separately', async () => {
    const o = await setupOrg(t.app, t.email)
    const c = await o.owner.client.post(`/api/orgs/${o.orgId}/channels`, { name: 'retired' })
    await o.owner.client.post(`/api/orgs/${o.orgId}/channels/${c.body.id}/archive`)
    const active = await o.owner.client.get(`/api/orgs/${o.orgId}/channels/browse?archived=false`)
    const archived = await o.owner.client.get(`/api/orgs/${o.orgId}/channels/browse?archived=true`)
    expect(active.body.map((x: { name: string }) => x.name)).toEqual(['announcements', 'general'])
    expect(archived.body.map((x: { name: string }) => x.name)).toEqual(['retired'])
  })

  it('makes archived channels read-only', async () => {
    const o = await setupOrg(t.app, t.email)
    const c = await o.owner.client.post(`/api/orgs/${o.orgId}/channels`, { name: 'old-project' })
    expect(
      (await o.owner.client.post(`/api/orgs/${o.orgId}/channels/${c.body.id}/archive`)).status,
    ).toBe(200)
    const r = await o.owner.client.post(`/api/orgs/${o.orgId}/channels/${c.body.id}/messages`, {
      body: doc('late'),
    })
    expect(r.status).toBe(403)
  })
})

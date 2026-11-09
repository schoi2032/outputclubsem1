import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeApp, setupOrg } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
beforeAll(async () => {
  t = await makeApp()
})
afterAll(async () => {
  await t.app.close()
})

const orgOf = (me: { body: { orgs: { id: string }[] } }, id: string) =>
  me.body.orgs.find((o) => o.id === id) as any

describe('org customization', () => {
  it('lets admins brand the workspace and members see it', async () => {
    const o = await setupOrg(t.app, t.email)
    const base = `/api/orgs/${o.orgId}`
    const bea = await o.addMember('member', 'Bea')

    // Defaults are filled in.
    expect(orgOf(await bea.client.get('/api/me'), o.orgId).customization).toMatchObject({
      brandColor: null,
      banner: null,
      expressionsPolicy: 'members',
    })

    expect(
      (await bea.client.patch(`${base}/customization`, { brandColor: '#3b50d8' })).status,
    ).toBe(403)

    const r = await o.owner.client.patch(`${base}/customization`, {
      brandColor: '#3b50d8',
      welcomeMessage: 'Welcome aboard! Start in #general.',
      statusPresets: [{ emoji: '🏢', text: 'In the office', hours: -1 }],
      replaceDefaultStatuses: true,
      banner: { text: 'Offsite on Friday', tone: 'info', linkUrl: 'https://example.com/offsite' },
    })
    expect(r.status).toBe(200)
    const bannerId = r.body.banner.id
    expect(bannerId).toBeTruthy()

    const seen = orgOf(await bea.client.get('/api/me'), o.orgId).customization
    expect(seen).toMatchObject({
      brandColor: '#3b50d8',
      welcomeMessage: 'Welcome aboard! Start in #general.',
      replaceDefaultStatuses: true,
      banner: { text: 'Offsite on Friday', id: bannerId },
    })

    // Saving other fields keeps the banner (and its id); changing it gets a new id.
    const kept = await o.owner.client.patch(`${base}/customization`, { welcomeMessage: 'Hi' })
    expect(kept.body.banner.id).toBe(bannerId)
    const changed = await o.owner.client.patch(`${base}/customization`, {
      banner: { text: 'Offsite moved to Monday', tone: 'warning' },
    })
    expect(changed.body.banner.id).not.toBe(bannerId)
    const removed = await o.owner.client.patch(`${base}/customization`, { banner: null })
    expect(removed.body.banner).toBeNull()

    // Bad input is rejected.
    expect(
      (await o.owner.client.patch(`${base}/customization`, { brandColor: 'blue' })).status,
    ).toBe(400)
    expect(
      (
        await o.owner.client.patch(`${base}/customization`, {
          banner: { text: 'x', linkUrl: 'javascript:alert(1)' },
        })
      ).status,
    ).toBe(400)
  })

  it('adds new members to the channels the org picked', async () => {
    const o = await setupOrg(t.app, t.email)
    const base = `/api/orgs/${o.orgId}`
    const pub = await o.owner.client.post(`${base}/channels`, { name: 'onboarding' })
    const priv = await o.owner.client.post(`${base}/channels`, { name: 'secret', kind: 'private' })

    expect(
      (await o.owner.client.patch(`${base}/customization`, { autoJoinChannelIds: [priv.body.id] }))
        .status,
    ).toBe(400)
    expect(
      (await o.owner.client.patch(`${base}/customization`, { autoJoinChannelIds: [pub.body.id] }))
        .status,
    ).toBe(200)

    const eli = await o.addMember('member', 'Eli')
    const mine = await eli.client.get(`${base}/channels/mine`)
    expect(mine.body.map((c: { name: string }) => c.name)).toContain('onboarding')
    // Unlike default channels, they can leave.
    expect((await eli.client.post(`${base}/channels/${pub.body.id}/leave`)).status).toBe(200)

    const guest = await o.addMember('guest', 'Gus')
    const theirs = await guest.client.get(`${base}/channels/mine`)
    expect(theirs.body.map((c: { name: string }) => c.name)).not.toContain('onboarding')
  })

  it('stores members’ answers to custom profile fields', async () => {
    const o = await setupOrg(t.app, t.email)
    const base = `/api/orgs/${o.orgId}`
    const bea = await o.addMember('member', 'Bea')
    await o.owner.client.patch(`${base}/customization`, {
      profileFields: [
        { id: 'pronouns', label: 'Pronouns', kind: 'text' },
        { id: 'office', label: 'Office', kind: 'select', options: ['Seoul', 'Remote'] },
        { id: 'site', label: 'Website', kind: 'link' },
      ],
    })
    const r = await bea.client.put(`${base}/profile`, {
      pronouns: 'she/her',
      office: 'Mars',
      site: 'not a link',
      unknown: 'x',
    })
    expect(r.body.profile).toEqual({ pronouns: 'she/her' })
    await bea.client.put(`${base}/profile`, { office: 'Seoul', site: 'https://bea.dev' })

    const members = await o.owner.client.get(`${base}/members`)
    const b = members.body.find((m: { id: string }) => m.id === bea.id)
    expect(b.profile).toEqual({ office: 'Seoul', site: 'https://bea.dev' })

    const dup = await o.owner.client.patch(`${base}/customization`, {
      profileFields: [
        { id: 'a', label: 'A', kind: 'text' },
        { id: 'a', label: 'B', kind: 'text' },
      ],
    })
    expect(dup.status).toBe(400)
  })

  it('can limit custom emoji and sounds to admins', async () => {
    const o = await setupOrg(t.app, t.email)
    const base = `/api/orgs/${o.orgId}`
    const bea = await o.addMember('member', 'Bea')
    await o.owner.client.patch(`${base}/customization`, { expressionsPolicy: 'admins' })
    const r = await bea.client.post(`${base}/emojis`, {
      name: 'nope',
      fileId: '01900000-0000-7000-8000-000000000000',
    })
    expect(r.status).toBe(403)
  })
})

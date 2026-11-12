import { organizations, orgMemberships, users } from '@quid/db'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { doc, makeApp, signUp } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
beforeAll(async () => {
  t = await makeApp({ SCHOOL_EMAIL_DOMAIN: 'example.com' })
})
afterAll(async () => {
  await t.app.close()
})

describe('chat bubbles', () => {
  it('buy one, wear it, and it shows on your messages, then trade-off takes it off', async () => {
    const ana = await signUp(t.app, t.email, 'Ana')
    const org = await t.ctx.db.query.organizations.findFirst({
      where: eq(organizations.slug, t.ctx.config.SCHOOL_ORG_SLUG),
    })
    const base = `/api/orgs/${org!.id}`
    await t.ctx.db
      .update(orgMemberships)
      .set({ role: 'member' })
      .where(and(eq(orgMemberships.orgId, org!.id), eq(orgMemberships.userId, ana.id)))
    await t.ctx.db.update(users).set({ coins: 1000 }).where(eq(users.id, ana.id))

    const bought = await ana.client.post('/api/me/shop/b-galaxy/buy', {})
    expect(bought.status).toBe(200)
    expect(bought.body.owned).toContain('b-galaxy')

    const wrongSlot = await ana.client.put('/api/me/equip', { slot: 'plate', itemId: 'b-galaxy' })
    expect(wrongSlot.status).toBe(400)
    const notMine = await ana.client.put('/api/me/equip', { slot: 'bubble', itemId: 'b-gold' })
    expect(notMine.status).toBe(400)

    const worn = await ana.client.put('/api/me/equip', { slot: 'bubble', itemId: 'b-galaxy' })
    expect(worn.body.equippedBubble).toBe('b-galaxy')

    const chans = (await ana.client.get(`${base}/channels/mine`)).body as {
      id: string
      name: string
    }[]
    const general = chans.find((c) => c.name === 'general')!
    const sent = await ana.client.post(`${base}/channels/${general.id}/messages`, {
      body: doc('hello'),
    })
    expect(sent.body.author.chatBubble).toBe('b-galaxy')

    const off = await ana.client.put('/api/me/equip', { slot: 'bubble', itemId: null })
    expect(off.body.equippedBubble).toBeNull()
  })
})

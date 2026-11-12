import { organizations, orgMemberships, users } from '@quid/db'
import { specFromValue } from '@quid/shared'
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

async function person(name: string, role: 'admin' | 'member') {
  const u = await signUp(t.app, t.email, name)
  const org = await t.ctx.db.query.organizations.findFirst({
    where: eq(organizations.slug, t.ctx.config.SCHOOL_ORG_SLUG),
  })
  await t.ctx.db
    .update(orgMemberships)
    .set({ role })
    .where(and(eq(orgMemberships.orgId, org!.id), eq(orgMemberships.userId, u.id)))
  await t.ctx.db.update(users).set({ coins: 2000 }).where(eq(users.id, u.id))
  return { ...u, base: `/api/orgs/${org!.id}` }
}

describe('chat flair', () => {
  it('built-in flair can be bought, worn, and shows on messages', async () => {
    const ana = await person('Ana', 'member')
    for (const id of ['ne-gold', 'mf-confetti', 'ty-cat', 'rs-gold', 'ms-neon', 'sp-retro']) {
      const r = await ana.client.post(`/api/me/shop/${id}/buy`, {})
      expect(r.status, id).toBe(200)
    }
    const slots = [
      ['name_effect', 'ne-gold'],
      ['message_effect', 'mf-confetti'],
      ['typing', 'ty-cat'],
      ['reaction_skin', 'rs-gold'],
      ['mention_style', 'ms-neon'],
      ['sound_pack', 'sp-retro'],
    ] as const
    for (const [slot, itemId] of slots) {
      const r = await ana.client.put('/api/me/equip', { slot, itemId })
      expect(r.status, slot).toBe(200)
      expect(r.body.equippedFlair[slot]).toBe(itemId)
    }
    const wrong = await ana.client.put('/api/me/equip', { slot: 'typing', itemId: 'ne-gold' })
    expect(wrong.status).toBe(400)

    const chans = (await ana.client.get(`${ana.base}/channels/mine`)).body as { id: string; name: string }[]
    const general = chans.find((c) => c.name === 'general')!
    const sent = await ana.client.post(`${ana.base}/channels/${general.id}/messages`, { body: doc('yo') })
    expect(sent.body.author.nameEffect).toBe('ne-gold')
    expect(sent.body.author.messageEffect).toBe('mf-confetti')
    expect(sent.body.author.reactionSkin).toBe('rs-gold')
    expect(sent.body.author.mentionStyle).toBe('ms-neon')
    expect(sent.body.author.typingStyle).toBe('ty-cat')
    expect(sent.body.author.soundPack).toBeUndefined()
    const me = await ana.client.get('/api/me')
    expect(me.body.user?.soundPack ?? me.body.soundPack).toBe('sp-retro')
  })

  it('students make custom flair; teachers approve; others buy and wear it', async () => {
    const maker = await person('Maker', 'member')
    const teacher = await person('Teacher', 'admin')
    const buyer = await person('Buyer', 'member')

    const bad = await maker.client.post(`${maker.base}/cosmetics`, {
      kind: 'name_effect',
      name: 'Broken',
      price: 50,
      spec: { colors: ['red'], anim: 'shimmer' },
    })
    expect(bad.status).toBe(400)
    const noSounds = await maker.client.post(`${maker.base}/cosmetics`, {
      kind: 'sound_pack',
      name: 'Fake',
      price: 50,
      spec: { synth: 'retro' },
    })
    expect(noSounds.status).toBe(400)

    const made = await maker.client.post(`${maker.base}/cosmetics`, {
      kind: 'name_effect',
      name: 'Sunrise',
      price: 50,
      spec: { colors: ['#ff7a00', '#ffd23f'], anim: 'wave', speed: 1.5 },
    })
    expect(made.status).toBe(201)
    const bubble = await maker.client.post(`${maker.base}/cosmetics`, {
      kind: 'bubble',
      name: 'Grape',
      price: 40,
      spec: { bg: ['#6a2c91', '#c13584'], text: '#ffffff', pattern: 'dots' },
    })
    expect(bubble.status).toBe(201)

    for (const c of [made.body, bubble.body]) {
      const r = await teacher.client.post(`${teacher.base}/cosmetics/${c.id}/review`, { approve: true })
      expect(r.status).toBe(200)
    }

    const bought = await buyer.client.post(`/api/me/shop/u:${made.body.id}/buy`, {})
    expect(bought.status).toBe(200)
    const worn = await buyer.client.put('/api/me/equip', { slot: 'name_effect', itemId: `u:${made.body.id}` })
    expect(worn.status).toBe(200)
    const value = worn.body.equippedFlair.name_effect as string
    expect(specFromValue('name_effect', value)).toEqual({
      colors: ['#ff7a00', '#ffd23f'],
      anim: 'wave',
      speed: 1.5,
    })
    await buyer.client.post(`/api/me/shop/u:${bubble.body.id}/buy`, {})
    const b = await buyer.client.put('/api/me/equip', { slot: 'bubble', itemId: `u:${bubble.body.id}` })
    expect(specFromValue('bubble', b.body.equippedBubble)?.pattern).toBe('dots')
    const notThere = await buyer.client.put('/api/me/equip', { slot: 'typing', itemId: `u:${made.body.id}` })
    expect(notThere.status).toBe(400)
  })
})

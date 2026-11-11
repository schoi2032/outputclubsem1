import { messages } from '@quid/db'
import { eq, sql } from 'drizzle-orm'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyRetention } from '../src/modules/admin/compliance'
import { Client, doc, makeApp, setupOrg, uniq } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
beforeAll(async () => {
  t = await makeApp()
})
afterAll(async () => {
  await t.app.close()
})

const cookieOf = (r: LightMyRequestResponse, name: string) => {
  const set = r.headers['set-cookie']
  return (Array.isArray(set) ? set : set ? [set] : [])
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0]
}

/** Signs in through the (fake) Google flow and returns a client with that session. */
async function googleClient(email: string) {
  const start = await t.app.inject({ url: '/api/auth/google/start' })
  const state = new URL(start.headers.location as string).searchParams.get('state')!
  const code = uniq('code')
  t.google.codes.set(code, { sub: uniq('sub'), email, emailVerified: true, name: 'G', state })
  const cb = await t.app.inject({
    url: `/api/auth/google/callback?code=${code}&state=${state}`,
    headers: { cookie: cookieOf(start, 'quid_google_flow')! },
  })
  const c = new Client(t.app)
  c.cookie = cookieOf(cb, 'quid_session')!
  return c
}

describe('compliance (Enterprise+)', () => {
  it('retention deletes messages older than the limit, keeps newer ones', async () => {
    const o = await setupOrg(t.app, t.email)
    const base = `/api/orgs/${o.orgId}`
    const ch = await o.owner.client.post(`${base}/channels`, { name: 'ops' })
    const old = await o.owner.client.post(`${base}/channels/${ch.body.id}/messages`, {
      body: doc('old news'),
    })
    const fresh = await o.owner.client.post(`${base}/channels/${ch.body.id}/messages`, {
      body: doc('fresh'),
    })
    await t.ctx.db
      .update(messages)
      .set({ createdAt: sql`now() - interval '40 days'` })
      .where(eq(messages.id, old.body.id))

    expect(
      (await o.owner.client.patch(`${base}/admin/compliance`, { retentionDays: 7 })).status,
    ).toBe(400) // minimum 30
    expect(
      (await o.owner.client.patch(`${base}/admin/compliance`, { retentionDays: 30 })).status,
    ).toBe(200)
    expect((await o.owner.client.get(`${base}/admin/compliance`)).body).toMatchObject({
      retentionDays: 30,
      enterprise: true,
    })

    await applyRetention(t.ctx)
    expect(
      await t.ctx.db.query.messages.findFirst({ where: eq(messages.id, old.body.id) }),
    ).toBeUndefined()
    expect(
      await t.ctx.db.query.messages.findFirst({ where: eq(messages.id, fresh.body.id) }),
    ).toBeDefined()
  })

  it('can require Google sign-in without locking the admin out', async () => {
    const o = await setupOrg(t.app, t.email)
    const bea = await o.addMember('member', 'Bea')
    const base = `/api/orgs/${o.orgId}`

    // The owner is signed in with a password: refused, to avoid a lockout.
    expect(
      (await o.owner.client.patch(`${base}/admin/compliance`, { requireGoogle: true })).status,
    ).toBe(400)

    const ownerGoogle = await googleClient(o.owner.email)
    expect(
      (await ownerGoogle.patch(`${base}/admin/compliance`, { requireGoogle: true })).status,
    ).toBe(200)

    // Password sessions can't open the workspace; Google sessions can.
    const blocked = await bea.client.get(`${base}/members`)
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('google_required')
    expect(
      (await bea.client.get('/api/me')).body.orgs.find((x: { id: string }) => x.id === o.orgId)
        .requireGoogle,
    ).toBe(true)
    expect((await (await googleClient(bea.email)).get(`${base}/members`)).status).toBe(200)
  })

  it('exports the audit log as CSV', async () => {
    const o = await setupOrg(t.app, t.email)
    const r = await t.app.inject({
      url: `/api/orgs/${o.orgId}/admin/audit.csv`,
      headers: { cookie: o.owner.client.cookie },
    })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('text/csv')
    const [header, ...lines] = r.body.trim().split('\n')
    expect(header).toBe('time,actor_name,actor_email,action,target_type,target_id,ip,details')
    expect(lines.length).toBeGreaterThan(0)
  })
})

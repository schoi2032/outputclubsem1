import { accessTokens } from '@quid/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupExpired } from '../src/modules/admin/cleanup'
import { doc, makeApp, setupOrg } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
beforeAll(async () => {
  t = await makeApp()
})
afterAll(async () => {
  await t.app.close()
})

const ping = async (token: string) =>
  (
    await t.app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
  ).statusCode

describe('admin dashboard', () => {
  it('shows usage to admins only', async () => {
    const o = await setupOrg(t.app, t.email)
    const bea = await o.addMember('member', 'Bea')
    const base = `/api/orgs/${o.orgId}`
    const ch = await o.owner.client.post(`${base}/channels`, { name: 'ops', memberIds: [bea.id] })
    await o.owner.client.post(`${base}/channels/${ch.body.id}/messages`, { body: doc('one') })
    await bea.client.post(`${base}/channels/${ch.body.id}/messages`, { body: doc('two') })

    expect((await bea.client.get(`${base}/admin/overview`)).status).toBe(403)
    const r = await o.owner.client.get(`${base}/admin/overview`)
    expect(r.status).toBe(200)
    expect(r.body.members.total).toBe(2)
    expect(r.body.messages.last7d).toBe(2)
    expect(r.body.messages.daily).toHaveLength(30)
    expect(r.body.messages.daily.at(-1).messages).toBe(2)
    expect(r.body.channels.public).toBeGreaterThanOrEqual(2)
    expect(r.body.connectedApps.enabled).toBe(true)
  })

  it('turning off connected apps cuts off existing tokens; admins can revoke any connection', async () => {
    const o = await setupOrg(t.app, t.email)
    const bea = await o.addMember('member', 'Bea')
    const base = `/api/orgs/${o.orgId}`
    const pat = await bea.client.post(`${base}/connected-apps/tokens`, {
      name: 'Script',
      scopes: ['read'],
      expiresInDays: 7,
    })
    expect(await ping(pat.body.token)).toBe(200)

    expect(
      (await bea.client.patch(`${base}/admin/security`, { connectedApps: false })).status,
    ).toBe(403)
    await o.owner.client.patch(`${base}/admin/security`, { connectedApps: false })
    expect(await ping(pat.body.token)).toBe(401)
    expect(
      (
        await bea.client.post(`${base}/connected-apps/tokens`, {
          name: 'Again',
          scopes: ['read'],
          expiresInDays: 7,
        })
      ).status,
    ).toBe(403)

    await o.owner.client.patch(`${base}/admin/security`, { connectedApps: true })
    expect(await ping(pat.body.token)).toBe(200)

    const list = await o.owner.client.get(`${base}/admin/connected-apps`)
    expect(list.body).toHaveLength(1)
    expect(list.body[0].user.name).toBe('Bea')
    await o.owner.client.del(`${base}/admin/connected-apps/${list.body[0].id}`)
    expect(await ping(pat.body.token)).toBe(401)

    const log = await o.owner.client.get(`${base}/audit`)
    expect(JSON.stringify(log.body)).toContain('connected_app.revoked_by_admin')
  })

  it('cleans up credentials that can no longer be used', async () => {
    const o = await setupOrg(t.app, t.email)
    const base = `/api/orgs/${o.orgId}`
    const pat = await o.owner.client.post(`${base}/connected-apps/tokens`, {
      name: 'Old',
      scopes: ['read'],
      expiresInDays: 7,
    })
    await t.ctx.db
      .update(accessTokens)
      .set({ revokedAt: new Date(Date.now() - 40 * 86_400_000) })
      .where(eq(accessTokens.id, pat.body.id))
    const r = await cleanupExpired(t.ctx)
    expect(r.tokens).toBeGreaterThanOrEqual(1)
    expect(
      await t.ctx.db.query.accessTokens.findFirst({ where: eq(accessTokens.id, pat.body.id) }),
    ).toBeUndefined()
  })
})

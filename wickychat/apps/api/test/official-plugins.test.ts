import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { plugins } from '@quid/db'
import { OFFICIAL_PLUGINS } from '@quid/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pluginSecret } from '../src/modules/plugins/client'
import { officialSecret, syncOfficialPlugins } from '../src/modules/plugins/official'
import { makeApp, setupOrg } from './helpers'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
let t: Awaited<ReturnType<typeof makeApp>>
let server: Server
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/icons/'))
      return res.writeHead(200, { 'content-type': 'image/png' }).end(PNG)
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  t = await makeApp({
    OFFICIAL_PLUGINS_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    OFFICIAL_PLUGINS_KEY: 'test-official-plugins-key',
  })
})
afterAll(async () => {
  await t.app.close()
  server.close()
})

describe('official plugins', () => {
  it('are listed as verified and official, with derived secrets and icons', async () => {
    expect(await syncOfficialPlugins(t.ctx)).toBe(true)
    expect(await syncOfficialPlugins(t.ctx)).toBe(true) // idempotent
    const o = await setupOrg(t.app, t.email)
    const list = (await o.owner.client.get(`/api/orgs/${o.orgId}/plugins`)).body.plugins as {
      slug: string
      official: boolean
      status: string
      iconUrl: string | null
      developerName: string
    }[]
    for (const def of OFFICIAL_PLUGINS) {
      const p = list.find((x) => x.slug === def.slug)
      expect(p).toMatchObject({ official: true, status: 'verified', developerName: 'Quid' })
      expect(p?.iconUrl).toBeTruthy()
    }
    const row = await t.ctx.db.query.plugins.findFirst({ where: eq(plugins.slug, 'quid-polls') })
    expect(pluginSecret(t.ctx, row!)).toBe(
      officialSecret('test-official-plugins-key', 'quid-polls'),
    )
    expect(row!.manifest.baseUrl).toMatch(/\/quid-polls$/)

    // A suspension by the Quid team survives the next sync.
    await t.ctx.db.update(plugins).set({ status: 'suspended' }).where(eq(plugins.id, row!.id))
    await syncOfficialPlugins(t.ctx)
    expect(
      (await t.ctx.db.query.plugins.findFirst({ where: eq(plugins.id, row!.id) }))!.status,
    ).toBe('suspended')
    await t.ctx.db.update(plugins).set({ status: 'verified' }).where(eq(plugins.id, row!.id))
  })

  it("community plugins can't use the Quid name", async () => {
    const { runChecks } = await import('../src/modules/plugins/checks')
    const fake = { name: 'Quid Polls', tagline: 'Polls', developerName: 'Someone' }
    const checks = await runChecks(
      t.ctx,
      {
        id: '00000000-0000-0000-0000-000000000000',
        manifest: { baseUrl: 'https://127.0.0.1:1' },
        ...fake,
      } as never,
      null,
    )
    expect(checks.find((c) => c.id === 'listing')?.status).toBe('failed')
  })
})

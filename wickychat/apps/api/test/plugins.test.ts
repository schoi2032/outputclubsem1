import { createHmac } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { doc, makeApp, setupOrg } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
let server: Server
let baseUrl = ''
/** What the fake plugin server received. */
const received: {
  path: string
  body: Record<string, unknown>
  signature: string
  timestamp: string
  raw: string
}[] = []
let commandVisibility: 'channel' | 'ephemeral' = 'ephemeral'

beforeAll(async () => {
  t = await makeApp()
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = JSON.parse(raw || '{}')
      received.push({
        path: req.url ?? '',
        body,
        raw,
        signature: String(req.headers['x-quid-signature'] ?? ''),
        timestamp: String(req.headers['x-quid-timestamp'] ?? ''),
      })
      res.setHeader('content-type', 'application/json')
      if (req.url === '/quid/verify') return res.end(JSON.stringify({ challenge: body.challenge }))
      if (req.url === '/quid/command')
        return res.end(
          JSON.stringify({ text: `Pong: ${body.text}`, visibility: commandVisibility }),
        )
      res.end('{}')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  server.close()
  await t.app.close()
})

const plugin = (over: Record<string, unknown> = {}) => ({
  name: 'Ping',
  tagline: 'Replies to /ping so you know things work',
  developerName: 'Ping Labs',
  developerEmail: 'dev@ping.test',
  baseUrl,
  commands: [{ name: 'ping', description: 'Check the plugin is alive', usage: '/ping [text]' }],
  events: ['message.created'],
  ...over,
})

async function setup() {
  const o = await setupOrg(t.app, t.email)
  const bea = await o.addMember('member', 'Bea')
  const base = `/api/orgs/${o.orgId}`
  const ops = await o.owner.client.post(`${base}/channels`, { name: 'ops', memberIds: [bea.id] })
  const other = await o.owner.client.post(`${base}/channels`, { name: 'random' })
  return { ...o, bea, base, ops: ops.body.id as string, other: other.body.id as string }
}

describe('plugins', () => {
  it('runs safety checks on submission and lists passing plugins as community (unverified)', async () => {
    const o = await setup()
    const r = await o.owner.client.post(`${o.base}/plugins`, plugin())
    expect(r.status).toBe(201)
    expect(r.body.signingSecret).toMatch(/^qps_/)
    expect(r.body.plugin.status).toBe('unverified')
    const byId = Object.fromEntries(
      r.body.plugin.checks.map((c: { id: string; status: string }) => [c.id, c.status]),
    )
    expect(byId).toMatchObject({
      address: 'passed',
      ownership: 'passed',
      listing: 'passed',
      icon: 'skipped',
      reputation: 'skipped',
    })

    // Pretending to be official fails the listing check and keeps it out of the directory.
    const fake = await o.owner.client.post(
      `${o.base}/plugins`,
      plugin({ name: 'Official Quid Helper' }),
    )
    expect(fake.body.plugin.status).toBe('pending')
    expect(
      (
        await o.owner.client.post(`${o.base}/plugins/${fake.body.plugin.id}/install`, {
          channelIds: [o.ops],
          acceptUnverified: true,
        })
      ).status,
    ).toBe(400)

    // A server that doesn't answer the challenge fails ownership.
    const dead = await o.owner.client.post(
      `${o.base}/plugins`,
      plugin({ name: 'Dead', baseUrl: 'http://127.0.0.1:9/' }),
    )
    expect(dead.body.plugin.checks.find((c: { id: string }) => c.id === 'ownership').status).toBe(
      'failed',
    )
  })

  it('installs into chosen channels, runs slash commands and accepts posts from the plugin', async () => {
    const o = await setup()
    const sub = await o.owner.client.post(`${o.base}/plugins`, plugin({ name: 'Pinger' }))
    const id = sub.body.plugin.id
    const secret = sub.body.signingSecret as string

    // Community plugins need an explicit acknowledgement.
    expect(
      (await o.owner.client.post(`${o.base}/plugins/${id}/install`, { channelIds: [o.ops] }))
        .status,
    ).toBe(400)
    // Members can't install.
    expect(
      (
        await o.bea.client.post(`${o.base}/plugins/${id}/install`, {
          channelIds: [o.ops],
          acceptUnverified: true,
        })
      ).status,
    ).toBe(403)
    const inst = await o.owner.client.post(`${o.base}/plugins/${id}/install`, {
      channelIds: [o.ops],
      acceptUnverified: true,
    })
    expect(inst.status).toBe(201)
    const installed = received.findLast((x) => x.path === '/quid/install')!
    expect(installed.body.installId).toBe(inst.body.installId)
    // Every call is signed with the plugin's secret.
    expect(installed.signature).toBe(
      `sha256=${createHmac('sha256', secret).update(`${installed.timestamp}.${installed.raw}`).digest('hex')}`,
    )
    const token = installed.body.token as string

    // Commands
    const cmds = await o.bea.client.get(`/api/orgs/${o.orgId}/plugin-commands`)
    expect(cmds.body[0]).toMatchObject({ command: 'ping', channelIds: [o.ops] })
    const eph = await o.bea.client.post(`${o.base}/channels/${o.ops}/commands`, {
      command: 'ping',
      text: 'hello',
    })
    expect(eph.body).toMatchObject({ visibility: 'ephemeral', text: 'Pong: hello' })
    commandVisibility = 'channel'
    const pub = await o.bea.client.post(`${o.base}/channels/${o.ops}/commands`, {
      command: 'ping',
      text: 'everyone',
    })
    expect(pub.body.visibility).toBe('channel')
    commandVisibility = 'ephemeral'
    expect(
      (
        await o.owner.client.post(`${o.base}/channels/${o.other}/commands`, {
          command: 'ping',
          text: 'x',
        })
      ).status,
    ).toBe(400)

    // Plugin API: only into channels it was added to.
    const api = (body: unknown) =>
      t.app.inject({
        method: 'POST',
        url: '/api/plugin-api/v1/messages',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: JSON.stringify(body),
      })
    expect((await api({ channelId: o.ops, text: 'Deploy finished ✅' })).statusCode).toBe(201)
    expect((await api({ channelId: o.other, text: 'nope' })).statusCode).toBe(403)
    const hist = JSON.stringify(
      (await o.bea.client.get(`${o.base}/channels/${o.ops}/messages`)).body,
    )
    expect(hist).toContain('Deploy finished')
    expect(hist).toContain('Pong: everyone')

    // Events: people's messages in the channel are delivered, signed.
    await o.bea.client.post(`${o.base}/channels/${o.ops}/messages`, { body: doc('ship it') })
    await t.ctx.db.execute(
      sql`update jobs set run_at = now() - interval '1 second' where status = 'pending'`,
    )
    await t.app.inject({
      method: 'POST',
      url: '/internal/cron/tick',
      headers: { 'x-internal-token': 'test-internal' },
    })
    const ev = received.findLast((x) => x.path === '/quid/events')
    expect(ev?.body).toMatchObject({ event: 'message.created', installId: inst.body.installId })
    expect((ev!.body.message as { text: string }).text).toBe('ship it')

    // Uninstalling cuts it off.
    expect((await o.owner.client.del(`${o.base}/plugins/${id}/install`)).status).toBe(200)
    expect((await api({ channelId: o.ops, text: 'gone?' })).statusCode).toBe(401)
  })

  it('lets Quid staff verify or suspend plugins', async () => {
    const o = await setup()
    t.ctx.config.PLATFORM_ADMIN_EMAILS = o.owner.email
    const sub = await o.owner.client.post(`${o.base}/plugins`, plugin({ name: 'Reviewed' }))
    const id = sub.body.plugin.id
    expect((await o.bea.client.get('/api/platform/plugins')).status).toBe(404)
    expect((await o.owner.client.get('/api/me')).body.user.platformAdmin).toBe(true)

    expect(
      (
        await o.owner.client.post(`/api/platform/plugins/${id}/review`, {
          status: 'verified',
          note: 'Looks good',
        })
      ).status,
    ).toBe(200)
    // Verified plugins install without the community acknowledgement.
    expect(
      (await o.owner.client.post(`${o.base}/plugins/${id}/install`, { channelIds: [o.ops] }))
        .status,
    ).toBe(201)
    expect(
      (
        await o.bea.client.post(`${o.base}/channels/${o.ops}/commands`, {
          command: 'ping',
          text: 'hi',
        })
      ).status,
    ).toBe(200)

    await o.owner.client.post(`/api/platform/plugins/${id}/review`, {
      status: 'suspended',
      note: 'Reported',
    })
    expect(
      (
        await o.bea.client.post(`${o.base}/channels/${o.ops}/commands`, {
          command: 'ping',
          text: 'hi',
        })
      ).status,
    ).toBe(404)
    t.ctx.config.PLATFORM_ADMIN_EMAILS = ''
  })

  it('private plugins are visible only to their workspace', async () => {
    const o = await setup()
    const other = await setup()
    const sub = await o.owner.client.post(
      `${o.base}/plugins`,
      plugin({ name: 'Internal Tool', private: true }),
    )
    expect(sub.body.plugin.private).toBe(true)
    const theirs = (await other.owner.client.get(`${other.base}/plugins`)).body.plugins.map(
      (p: { id: string }) => p.id,
    )
    expect(theirs).not.toContain(sub.body.plugin.id)
    expect(
      (
        await other.owner.client.post(`${other.base}/plugins/${sub.body.plugin.id}/install`, {
          channelIds: [other.ops],
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await o.owner.client.post(`${o.base}/plugins/${sub.body.plugin.id}/install`, {
          channelIds: [o.ops],
        })
      ).status,
    ).toBe(201)
  })
})

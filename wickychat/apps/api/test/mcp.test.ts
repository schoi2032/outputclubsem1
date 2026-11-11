import { createHash, randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { doc, makeApp, ORIGIN, setupOrg } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
beforeAll(async () => {
  t = await makeApp()
})
afterAll(async () => {
  await t.app.close()
})

const REDIRECT = 'http://localhost:33418/callback'

/** Talks to the server the way an MCP client (e.g. Claude) does: no cookies, no Origin. */
async function form(url: string, fields: Record<string, string>) {
  const r = await t.app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  })
  return { status: r.statusCode, body: r.json() }
}

let rpcId = 0
async function rpc(token: string, method: string, params: Record<string, unknown> = {}) {
  const r = await t.app.inject({
    method: 'POST',
    url: '/api/mcp',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    payload: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  })
  return { status: r.statusCode, headers: r.headers, body: r.statusCode === 202 ? null : r.json() }
}
const call = async (token: string, name: string, args: Record<string, unknown> = {}) =>
  (await rpc(token, 'tools/call', { name, arguments: args })).body.result as {
    isError?: boolean
    content: { text: string }[]
  }

async function connect(
  o: Awaited<ReturnType<typeof setupOrg>>,
  user: { client: { post: (u: string, b?: unknown) => Promise<{ status: number; body: any }> } },
  scopes: string[],
) {
  const reg = await t.app.inject({
    method: 'POST',
    url: '/api/oauth/register',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({
      client_name: 'Claude',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
    }),
  })
  expect(reg.statusCode).toBe(201)
  const clientId = reg.json().client_id as string
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const auth = await user.client.post('/api/oauth/authorize', {
    clientId,
    redirectUri: REDIRECT,
    state: 'xyz',
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    orgId: o.orgId,
    scopes,
  })
  expect(auth.status).toBe(200)
  const to = new URL(auth.body.redirectTo)
  expect(to.searchParams.get('state')).toBe('xyz')
  const code = to.searchParams.get('code')!
  return { clientId, verifier, code }
}

describe('Quid MCP server', () => {
  it('publishes OAuth metadata and challenges unauthenticated calls', async () => {
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/mcp',
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize' },
    })
    expect(r.statusCode).toBe(401)
    expect(r.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource/api/mcp')
    const prm = (
      await t.app.inject({ url: '/.well-known/oauth-protected-resource/api/mcp' })
    ).json()
    expect(prm.resource).toBe(`${ORIGIN}/api/mcp`)
    const as = (await t.app.inject({ url: '/.well-known/oauth-authorization-server' })).json()
    expect(as.code_challenge_methods_supported).toEqual(['S256'])
    expect(as.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`)
  })

  it('rejects unsafe redirect URIs', async () => {
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/oauth/register',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ redirect_uris: ['http://evil.example.net/cb'] }),
    })
    expect(r.statusCode).toBe(400)
  })

  it('runs the full OAuth flow and tools act with the user’s permissions', async () => {
    const o = await setupOrg(t.app, t.email)
    const bea = await o.addMember('member', 'Bea')
    const base = `/api/orgs/${o.orgId}`
    const ops = await o.owner.client.post(`${base}/channels`, { name: 'ops', memberIds: [bea.id] })
    await o.owner.client.post(`${base}/channels/${ops.body.id}/messages`, {
      body: doc('Deploy is green'),
    })
    await o.owner.client.post(`${base}/channels`, { name: 'secret-plans', kind: 'private' })

    const { clientId, verifier, code } = await connect(o, bea, ['read'])

    // Wrong verifier fails, and burns the code.
    expect(
      (
        await form('/api/oauth/token', {
          grant_type: 'authorization_code',
          code,
          code_verifier: 'x'.repeat(43),
          client_id: clientId,
          redirect_uri: REDIRECT,
        })
      ).body.error,
    ).toBe('invalid_grant')
    expect(
      (
        await form('/api/oauth/token', {
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          client_id: clientId,
          redirect_uri: REDIRECT,
        })
      ).body.error,
    ).toBe('invalid_grant')

    const again = await connect(o, bea, ['read'])
    const tok = await form('/api/oauth/token', {
      grant_type: 'authorization_code',
      code: again.code,
      code_verifier: again.verifier,
      client_id: again.clientId,
      redirect_uri: REDIRECT,
    })
    expect(tok.status).toBe(200)
    expect(tok.body.scope).toBe('read')
    const access = tok.body.access_token as string

    const init = await rpc(access, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    })
    expect(init.body.result.serverInfo.name).toBe('quid')
    expect((await rpc(access, 'notifications/initialized')).status).toBe(202)

    const listed = (await rpc(access, 'tools/list')).body.result.tools.map(
      (x: { name: string }) => x.name,
    )
    expect(listed).toContain('read_channel')
    expect(listed).not.toContain('send_message')

    expect((await call(access, 'list_channels')).content[0]!.text).toContain('#ops')
    expect((await call(access, 'read_channel', { channel: '#ops' })).content[0]!.text).toContain(
      'Deploy is green',
    )
    // Bea isn't in the private channel: it doesn't exist as far as she can tell.
    const hidden = await call(access, 'read_channel', { channel: 'secret-plans' })
    expect(hidden.isError).toBe(true)
    // Read-only token can't post, even when calling the tool directly.
    expect((await call(access, 'send_message', { channel: 'ops', text: 'hi' })).isError).toBe(true)

    // Refresh rotates; the old refresh token stops working.
    const ref = await form('/api/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: tok.body.refresh_token,
      client_id: again.clientId,
    })
    expect(ref.status).toBe(200)
    expect(
      (
        await form('/api/oauth/token', {
          grant_type: 'refresh_token',
          refresh_token: tok.body.refresh_token,
          client_id: again.clientId,
        })
      ).status,
    ).toBe(400)
    expect((await rpc(access, 'ping')).status).toBe(401)
    expect((await rpc(ref.body.access_token, 'ping')).status).toBe(200)

    // Shows up in settings and can be disconnected.
    const apps = await bea.client.get(`${base}/connected-apps`)
    const app = apps.body.apps.find((a: { name: string }) => a.name === 'Claude')
    expect(app.kind).toBe('oauth')
    await bea.client.del(`${base}/connected-apps/${app.id}`)
    expect((await rpc(ref.body.access_token, 'ping')).status).toBe(401)
  })

  it('posts with the write scope, and stops working when the member is removed', async () => {
    const o = await setupOrg(t.app, t.email)
    const bea = await o.addMember('member', 'Bea')
    const base = `/api/orgs/${o.orgId}`
    const ops = await o.owner.client.post(`${base}/channels`, { name: 'ops', memberIds: [bea.id] })
    const pat = await bea.client.post(`${base}/connected-apps/tokens`, {
      name: 'My script',
      scopes: ['read', 'write'],
      expiresInDays: 30,
    })
    expect(pat.body.token).toMatch(/^quid_pat_/)

    const sent = await call(pat.body.token, 'send_message', {
      channel: '#ops',
      text: 'Posted from Claude',
    })
    expect(sent.isError).toBeFalsy()
    const hist = await o.owner.client.get(`${base}/channels/${ops.body.id}/messages`)
    expect(JSON.stringify(hist.body)).toContain('Posted from Claude')

    const found = await call(pat.body.token, 'search_messages', { query: 'Posted' })
    expect(found.content[0]!.text).toContain('#ops')

    await o.owner.client.del(`${base}/members/${bea.id}`)
    expect((await rpc(pat.body.token, 'ping')).status).toBe(401)
  })
})

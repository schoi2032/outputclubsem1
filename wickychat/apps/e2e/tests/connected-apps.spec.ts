import { createHash, randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'

/** Connecting an MCP client (like Claude) through discovery, consent and PKCE, all via the web origin. */
test('an MCP client connects through the consent page and reads messages', async ({
  page,
  request,
  baseURL,
}) => {
  const meta = await (await request.get('/.well-known/oauth-authorization-server')).json()
  expect(meta.authorization_endpoint).toMatch(/\/oauth\/authorize$/)
  const unauth = await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'ping' } })
  expect(unauth.status()).toBe(401)

  const redirect = 'http://127.0.0.1:47219/callback'
  const reg = await (
    await request.post('/api/oauth/register', {
      data: { client_name: 'Claude', redirect_uris: [redirect] },
    })
  ).json()
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')

  // Sign in, then land on the consent page.
  await page.goto('/login')
  await page.getByLabel('Email').fill('ben@dev.quid.local')
  await page.getByLabel('Password').fill('quid-dev-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/home$/)

  let callback = ''
  await page.route(`${redirect}**`, (route) => {
    callback = route.request().url()
    return route.fulfill({ body: 'ok' })
  })
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: reg.client_id,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'abc',
    scope: 'read',
  })
  await page.goto(`/oauth/authorize?${q}`)
  await expect(page.getByRole('heading', { name: 'Connect Claude to Quid' })).toBeVisible()
  await page.getByRole('button', { name: 'Allow' }).click()
  await expect.poll(() => callback).toContain('code=')
  const code = new URL(callback).searchParams.get('code')!
  expect(new URL(callback).searchParams.get('state')).toBe('abc')

  const tok = await (
    await request.post('/api/oauth/token', {
      form: {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: reg.client_id,
        redirect_uri: redirect,
      },
    })
  ).json()
  expect(tok.token_type).toBe('Bearer')

  const res = await request.post('/api/mcp', {
    headers: { authorization: `Bearer ${tok.access_token}` },
    data: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_channels', arguments: { include_dms: false } },
    },
  })
  const body = await res.json()
  expect(body.result.content[0].text).toContain('#general')

  // It shows up in settings, and disconnecting cuts it off.
  await page.goto('/dev-acme/settings/connected-apps')
  await expect(page.getByText(`${baseURL}/api/mcp`, { exact: true })).toBeVisible()
  const row = page
    .getByRole('listitem')
    .filter({ hasText: 'Claude' })
    .filter({ has: page.getByRole('button', { name: 'Disconnect' }) })
    .first()
  await expect(row.getByText('Read only')).toBeVisible()
  await row.getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.getByText('Claude disconnected')).toBeVisible()
  const after = await request.post('/api/mcp', {
    headers: { authorization: `Bearer ${tok.access_token}` },
    data: { jsonrpc: '2.0', id: 3, method: 'ping' },
  })
  expect(after.status()).toBe(401)
})

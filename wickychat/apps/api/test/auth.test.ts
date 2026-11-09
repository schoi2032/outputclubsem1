import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, makeApp, signUp, uniq } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
beforeAll(async () => {
  t = await makeApp()
})
afterAll(async () => {
  await t.app.close()
})

describe('authentication', () => {
  it('registers, verifies by email and signs in', async () => {
    const { client, email } = await signUp(t.app, t.email, 'Grace')
    const me = await client.get('/api/me')
    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe(email)
    expect(me.body.user.emailVerified).toBe(true)

    const fresh = new Client(t.app)
    const login = await fresh.post('/api/auth/login', { email, password: 'correct-horse-battery' })
    expect(login.status).toBe(200)
    expect(fresh.cookie).toMatch(/^quid_session=/)
  })

  it('does not reveal whether an email is registered', async () => {
    const { email } = await signUp(t.app, t.email)
    const c = new Client(t.app)
    const again = await c.post('/api/auth/register', {
      acceptTerms: true,
      name: 'X',
      email,
      password: 'another-password-1',
    })
    expect(again.status).toBe(202)
    const wrong = await c.post('/api/auth/login', { email, password: 'wrong-password-123' })
    const missing = await c.post('/api/auth/login', {
      email: `${uniq()}@example.com`,
      password: 'wrong-password-123',
    })
    expect(wrong.status).toBe(401)
    expect(missing.status).toBe(401)
    expect(wrong.body.error.message).toBe(missing.body.error.message)
  })

  it('blocks unverified sign-in', async () => {
    const c = new Client(t.app)
    const address = `${uniq()}@example.com`
    await c.post('/api/auth/register', {
      acceptTerms: true,
      name: 'U',
      email: address,
      password: 'correct-horse-battery',
    })
    const r = await c.post('/api/auth/login', { email: address, password: 'correct-horse-battery' })
    expect(r.status).toBe(403)
    expect(r.body.error.code).toBe('email_unverified')
  })

  it('resets the password and signs out other sessions', async () => {
    const { client, email } = await signUp(t.app, t.email)
    const other = new Client(t.app)
    await other.post('/api/auth/login', { email, password: 'correct-horse-battery' })
    expect((await other.get('/api/me')).status).toBe(200)

    await new Client(t.app).post('/api/auth/forgot-password', { email })
    const mail = t.email.sent.findLast((m) => m.to === email && m.subject.includes('Reset'))!
    const token = /token=([\w-]+)/.exec(mail.text)![1]
    const r = await new Client(t.app).post('/api/auth/reset-password', {
      token,
      password: 'brand-new-password',
    })
    expect(r.status).toBe(200)
    expect((await other.get('/api/me')).status).toBe(401)
    expect((await client.get('/api/me')).status).toBe(401)
    // Tokens are single use.
    const again = await new Client(t.app).post('/api/auth/reset-password', {
      token,
      password: 'another-new-password',
    })
    expect(again.status).toBe(400)
  })

  it('logs out', async () => {
    const { client } = await signUp(t.app, t.email)
    await client.post('/api/auth/logout')
    expect((await client.get('/api/me')).status).toBe(401)
  })

  it('stores personal preferences and merges partial updates', async () => {
    const { client } = await signUp(t.app, t.email)
    const before = (await client.get('/api/me')).body.user.preferences
    expect(before).toMatchObject({ density: 'comfortable', sendKey: 'enter' })

    let r = await client.req('PATCH', '/api/me/preferences', { density: 'compact' })
    expect(r.status).toBe(200)
    r = await client.req('PATCH', '/api/me/preferences', { accent: '#0f8f8f', clock: '24h' })
    expect(r.body).toMatchObject({ density: 'compact', accent: '#0f8f8f', clock: '24h' })
    expect((await client.get('/api/me')).body.user.preferences).toMatchObject({
      density: 'compact',
      clock: '24h',
    })

    expect((await client.req('PATCH', '/api/me/preferences', { accent: 'blue' })).status).toBe(400)
    expect((await client.req('PATCH', '/api/me/preferences', { nope: 1 })).status).toBe(400)
  })

  it('rejects cross-origin state changes', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('terms of service', () => {
  it('requires agreement to sign up, and records it', async () => {
    const t2 = await makeApp()
    const c = new Client(t2.app)
    const email = `${uniq()}@example.com`
    const r = await c.post('/api/auth/register', {
      name: 'No Terms',
      email,
      password: 'correct-horse-battery',
    })
    expect(r.status).toBe(400)
    const ok = await c.post('/api/auth/register', {
      name: 'Terms',
      email,
      password: 'correct-horse-battery',
      acceptTerms: true,
    })
    expect(ok.status).toBe(202)
    const u = await t2.ctx.db.query.users.findFirst({ where: (u, { eq }) => eq(u.email, email) })
    expect(u?.termsAcceptedAt).toBeInstanceOf(Date)
    await t2.app.close()
  })
})

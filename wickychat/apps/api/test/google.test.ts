import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, makeApp, signUp, uniq } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
beforeAll(async () => {
  t = await makeApp()
})
afterAll(async () => {
  await t.app.close()
})

const cookieOf = (r: LightMyRequestResponse, name: string) => {
  const set = r.headers['set-cookie']
  const all = Array.isArray(set) ? set : set ? [set] : []
  return all.find((c) => c.startsWith(`${name}=`))?.split(';')[0]
}

/** Runs start → (Google) → callback and returns the final redirect and a client holding the session. */
async function googleSignIn(
  app: typeof t,
  profile: { sub: string; email: string; emailVerified?: boolean; name?: string },
  opts: { next?: string; tamperState?: boolean } = {},
) {
  const start = await app.app.inject({
    url: `/api/auth/google/start${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ''}`,
  })
  expect(start.statusCode).toBe(302)
  const state = new URL(start.headers.location as string).searchParams.get('state')!
  const flow = cookieOf(start, 'quid_google_flow')!
  const code = uniq('code')
  app.google.codes.set(code, { emailVerified: true, name: 'Gina Google', ...profile, state })
  const cb = await app.app.inject({
    url: `/api/auth/google/callback?code=${code}&state=${opts.tamperState ? 'wrong' : state}`,
    headers: { cookie: flow },
  })
  const session = cookieOf(cb, 'quid_session')
  const client = new Client(app.app)
  if (session) client.cookie = session
  return { status: cb.statusCode, location: cb.headers.location as string, client, session }
}

describe('Google sign-in', () => {
  it('is advertised when configured', async () => {
    expect((await t.app.inject({ url: '/api/auth/providers' })).json()).toEqual({ google: true })
  })

  it('creates a verified account on first sign-in, and signs the same person in later', async () => {
    const email = `${uniq()}@gmail.test`
    const sub = uniq('sub')
    const first = await googleSignIn(t, { sub, email }, { next: '/new' })
    expect(first.location).toBe('http://localhost:3000/new')
    const me = await first.client.get('/api/me')
    expect(me.body.user).toMatchObject({
      email,
      name: 'Gina Google',
      emailVerified: true,
      hasPassword: false,
      linkedProviders: ['google'],
    })

    // Changing the address on Google's side doesn't create a second account.
    const again = await googleSignIn(t, { sub, email: `${uniq()}@gmail.test` })
    expect((await again.client.get('/api/me')).body.user.id).toBe(me.body.user.id)

    // A Google-only account can add a password without a current one.
    expect(
      (await first.client.post('/api/me/password', { newPassword: 'another-good-password' }))
        .status,
    ).toBe(200)
    const pw = new Client(t.app)
    expect(
      (await pw.post('/api/auth/login', { email, password: 'another-good-password' })).status,
    ).toBe(200)
  })

  it('links to an existing verified account with the same email', async () => {
    const u = await signUp(t.app, t.email, 'Pat Password')
    const g = await googleSignIn(t, { sub: uniq('sub'), email: u.email.toUpperCase() })
    const me = (await g.client.get('/api/me')).body.user
    expect(me.id).toBe(u.id)
    expect(me.hasPassword).toBe(true)
    expect((await u.client.get('/api/me')).status).toBe(200) // existing sessions are kept
  })

  it('takes an unverified account back for the mailbox owner', async () => {
    const email = `${uniq()}@gmail.test`
    const squatter = new Client(t.app)
    expect(
      (
        await squatter.post('/api/auth/register', {
          acceptTerms: true,
          name: 'Squatter',
          email,
          password: 'squatter-password-1',
        })
      ).status,
    ).toBe(202)
    const g = await googleSignIn(t, { sub: uniq('sub'), email })
    expect((await g.client.get('/api/me')).body.user).toMatchObject({
      email,
      emailVerified: true,
      hasPassword: false,
    })
    // The unproven password no longer works.
    expect(
      (await new Client(t.app).post('/api/auth/login', { email, password: 'squatter-password-1' }))
        .status,
    ).toBe(401)
  })

  it('refuses unverified Google emails and mismatched state', async () => {
    const unverified = await googleSignIn(t, {
      sub: uniq('sub'),
      email: `${uniq()}@gmail.test`,
      emailVerified: false,
    })
    expect(unverified.location).toContain('/login?error=google_unverified')
    expect(unverified.session).toBeUndefined()
    const tampered = await googleSignIn(
      t,
      { sub: uniq('sub'), email: `${uniq()}@gmail.test` },
      { tamperState: true },
    )
    expect(tampered.location).toContain('/login?error=google_expired')
    expect(tampered.session).toBeUndefined()
  })

  it('never redirects off-site', async () => {
    const r = await googleSignIn(
      t,
      { sub: uniq('sub'), email: `${uniq()}@gmail.test` },
      { next: '//evil.test/x' },
    )
    expect(r.location).toBe('http://localhost:3000/')
  })
})

describe('Google sign-in with invite-only registration', () => {
  let closed: Awaited<ReturnType<typeof makeApp>>
  beforeAll(async () => {
    closed = await makeApp({ OPEN_REGISTRATION: 'false' })
  })
  afterAll(async () => {
    await closed.app.close()
  })

  it('only creates accounts for invited addresses', async () => {
    const stranger = await googleSignIn(closed, { sub: uniq('sub'), email: `${uniq()}@gmail.test` })
    expect(stranger.location).toContain('/login?error=invite_only')
  })
})

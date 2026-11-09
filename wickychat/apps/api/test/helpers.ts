import type { LightMyRequestResponse } from 'fastify'
import { MemoryEmail } from '../src/adapters/email'
import type { MediaGrant, MediaProvider } from '../src/adapters/media'
import { buildApp } from '../src/app'
import { loadConfig } from '../src/core/config'
import { MemoryEventBus } from '../src/core/eventbus'
import type { AICompletion, AIMessage, AIProvider } from '../src/modules/ai/providers'

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://quid:quid@localhost:5432/quid_test'
export const ORIGIN = 'http://localhost:3000'

export async function makeApp(overrides: Record<string, string> = {}) {
  const email = new MemoryEmail()
  const bus = new MemoryEventBus()
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB,
    LOG_LEVEL: 'error',
    STORAGE_LOCAL_DIR: '/tmp/quid-test-storage',
    JOBS_POLL: 'false',
    INTERNAL_TOKEN: 'test-internal',
    LIVEKIT_URL: 'ws://livekit.test',
    LIVEKIT_API_KEY: 'testkey',
    LIVEKIT_API_SECRET: 'test-secret-that-is-long-enough-for-hs256',
    ...overrides,
  })
  const media = new FakeMedia()
  const google = new FakeGoogle()
  const ai = new FakeAI()
  const { app, ctx } = await buildApp(config, {
    email,
    bus,
    media,
    google,
    ai: (_provider, apiKey, model) => ai.as(apiKey, model),
  })
  await app.ready()
  return { app, ctx, email, bus, media, google, ai }
}

/** Records AI requests and answers with `reply` instead of calling a provider. */
export class FakeAI {
  readonly calls: { apiKey: string; system: string; messages: AIMessage[] }[] = []
  reply: (input: { system: string; messages: AIMessage[] }) => string | Error = () => 'Fake reply'
  as(apiKey: string, model: string): AIProvider {
    return {
      id: 'anthropic',
      complete: async ({ system, messages }): Promise<AICompletion> => {
        this.calls.push({ apiKey, system, messages })
        const out = this.reply({ system, messages })
        if (out instanceof Error) throw out
        return { text: out, model, stopReason: 'end_turn', refused: false }
      },
      testConnection: async () => ({ ok: true, model }),
    }
  }
}

/** Records media-server actions instead of calling LiveKit. */
export class FakeMedia implements MediaProvider {
  readonly name = 'fake'
  readonly configured = true
  readonly grants: MediaGrant[] = []
  readonly actions: string[] = []
  async createJoinToken(g: MediaGrant) {
    this.grants.push(g)
    return { url: 'ws://livekit.test', token: `token-for-${g.identity}` }
  }
  async removeParticipant(room: string, identity: string) {
    this.actions.push(`remove:${room}:${identity}`)
  }
  async muteMicrophone(room: string, identity: string) {
    this.actions.push(`mute:${room}:${identity}`)
  }
  async endRoom(room: string) {
    this.actions.push(`end:${room}`)
  }
  async setCanPublish(room: string, identity: string, canPublish: boolean) {
    this.actions.push(`publish:${room}:${identity}:${canPublish}`)
  }
}

type App = Awaited<ReturnType<typeof makeApp>>['app']

let counter = 0
export const uniq = (p = 'u') => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`

export class Client {
  cookie = ''
  constructor(private readonly app: App) {}

  async req(method: string, url: string, body?: unknown) {
    const res: LightMyRequestResponse = await this.app.inject({
      method: method as 'GET',
      url,
      headers: {
        origin: ORIGIN,
        ...(this.cookie && { cookie: this.cookie }),
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { payload: JSON.stringify(body) }),
    })
    const set = res.headers['set-cookie']
    const c = Array.isArray(set) ? set[0] : set
    if (c) this.cookie = c.split(';')[0]!
    let json: any = null
    try {
      json = res.json()
    } catch {}
    return { status: res.statusCode, body: json }
  }
  get = (url: string) => this.req('GET', url)
  post = (url: string, body: unknown = {}) => this.req('POST', url, body)
  patch = (url: string, body: unknown) => this.req('PATCH', url, body)
  put = (url: string, body: unknown) => this.req('PUT', url, body)
  del = (url: string, body?: unknown) => this.req('DELETE', url, body)
}

/** Registers and verifies a user through the real email flow. */
export async function signUp(app: App, email: MemoryEmail, name = 'Test User') {
  const c = new Client(app)
  const address = `${uniq()}@example.com`
  const r = await c.post('/api/auth/register', {
    name,
    email: address,
    password: 'correct-horse-battery',
    acceptTerms: true,
  })
  if (r.status !== 202) throw new Error(`register failed: ${JSON.stringify(r.body)}`)
  const mail = email.sent.findLast((m) => m.to === address)!
  const token = /token=([\w-]+)/.exec(mail.text)![1]
  const v = await c.post('/api/auth/verify-email', { token })
  if (v.status !== 200) throw new Error(`verify failed: ${JSON.stringify(v.body)}`)
  return { client: c, email: address, id: v.body.user.id as string }
}

export const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/** Creates an org owned by a fresh user, plus helpers to add members by invitation. */
export async function setupOrg(app: App, email: MemoryEmail) {
  const owner = await signUp(app, email, 'Owner')
  const slug = uniq('org')
  const org = await owner.client.post('/api/orgs', { name: 'Test Org', slug })
  if (org.status !== 201) throw new Error(`org failed: ${JSON.stringify(org.body)}`)
  const orgId = org.body.id as string

  const addMember = async (role = 'member', name = 'Member') => {
    const u = await signUp(app, email, name)
    const inv = await owner.client.post(`/api/orgs/${orgId}/invitations`, {
      emails: [u.email],
      role,
    })
    if (inv.status !== 200) throw new Error(`invite failed: ${JSON.stringify(inv.body)}`)
    const mail = email.sent.findLast((m) => m.to === u.email)!
    const token = /invite\/([\w-]+)/.exec(mail.text)![1]
    const acc = await u.client.post(`/api/invitations/${token}/accept`)
    if (acc.status !== 200) throw new Error(`accept failed: ${JSON.stringify(acc.body)}`)
    return u
  }
  return { owner, orgId, slug, addMember }
}

/** Plays Google: remembers each flow's nonce and returns whatever profile a test assigns to a code. */
export class FakeGoogle {
  private readonly nonces = new Map<string, string>()
  readonly codes = new Map<
    string,
    { sub: string; email: string; emailVerified: boolean; name: string; state: string }
  >()
  authorizeUrl(p: { state: string; nonce: string; codeChallenge: string; redirectUri: string }) {
    this.nonces.set(p.state, p.nonce)
    return `https://google.test/auth?state=${p.state}&redirect_uri=${encodeURIComponent(p.redirectUri)}`
  }
  async exchange(code: string) {
    const p = this.codes.get(code)
    if (!p) throw new Error('bad code')
    return { ...p, nonce: this.nonces.get(p.state) }
  }
}


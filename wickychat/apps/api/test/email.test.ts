import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmailAdapter, parseFrom } from '../src/adapters/email'
import { loadConfig } from '../src/core/config'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('email', () => {
  it('parses sender addresses', () => {
    expect(parseFrom('Quid <hello@example.com>')).toEqual({
      name: 'Quid',
      email: 'hello@example.com',
    })
    expect(parseFrom('"Quid Team" <a@b.co>')).toEqual({ name: 'Quid Team', email: 'a@b.co' })
    expect(parseFrom('a@b.co')).toEqual({ name: undefined, email: 'a@b.co' })
  })

  it('sends through the Brevo API', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ messageId: 'x' }), { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const config = loadConfig({
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'xkeysib-test',
      EMAIL_FROM: 'Quid <me@gmail.com>',
    })
    await createEmailAdapter(config, pino({ level: 'silent' })).send({
      to: 'friend@quid-mail.co',
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')
    expect((init.headers as Record<string, string>)['api-key']).toBe('xkeysib-test')
    expect(JSON.parse(init.body as string)).toMatchObject({
      sender: { name: 'Quid', email: 'me@gmail.com' },
      to: [{ email: 'friend@quid-mail.co' }],
      subject: 'Hi',
    })
  })

  it('reports Brevo errors clearly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ message: 'Key not found' }), { status: 401 }),
      ),
    )
    const config = loadConfig({ EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'bad' })
    await expect(
      createEmailAdapter(config, pino({ level: 'silent' })).send({
        to: 'a@b.co',
        subject: 's',
        text: 't',
        html: 'h',
      }),
    ).rejects.toThrow('Brevo (401): Key not found')
  })

  it('refuses to start without the API key', () => {
    expect(() => loadConfig({ EMAIL_PROVIDER: 'brevo' })).toThrow(/BREVO_API_KEY/)
  })
})

describe('undeliverable addresses', () => {
  it('recognizes reserved test domains', async () => {
    const { isUndeliverable } = await import('../src/adapters/email')
    expect(isUndeliverable('ben@dev.quid.local')).toBe(true)
    expect(isUndeliverable('a@example.com')).toBe(true)
    expect(isUndeliverable('a@mail.example.org')).toBe(true)
    expect(isUndeliverable('a@foo.test')).toBe(true)
    expect(isUndeliverable('someone@gmail.com')).toBe(false)
    expect(isUndeliverable('a@notexample.com')).toBe(false)
  })
})

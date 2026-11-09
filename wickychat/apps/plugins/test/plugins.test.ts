import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, cronToken, runCron } from '../src/app'
import { parseReminder } from '../src/handlers/reminders'
import { hmac, pluginSecret } from '../src/quid'
import { connect, migrate } from '../src/store'
import { zonedToUtc } from '../src/time'

const KEY = 'test-official-plugins-key'
const sql = connect(
  process.env.TEST_DATABASE_URL ?? 'postgres://quid:quid@localhost:5432/quid_test',
)
const posted: { channelId: string; text: string; token: string }[] = []
let clock = new Date('2026-10-07T00:00:00Z') // a Wednesday
const { app } = buildApp({
  key: KEY,
  sql,
  now: () => clock,
  post: async (install, channelId, text) => {
    posted.push({ channelId, text, token: install.token })
  },
  translate: async (text, target) => `[${target}] ${text}`,
})

const uid = () => Math.random().toString(36).slice(2)

async function call(slug: string, action: string, payload: object, sign = true) {
  const body = JSON.stringify(payload)
  const ts = Math.floor(clock.getTime() / 1000).toString()
  return app.inject({
    method: 'POST',
    url: `/${slug}/quid/${action}`,
    headers: {
      'content-type': 'application/json',
      ...(sign && {
        'x-quid-timestamp': ts,
        'x-quid-signature': `sha256=${hmac(pluginSecret(KEY, slug), `${ts}.${body}`)}`,
      }),
    },
    payload: body,
  })
}

async function installed(slug: string) {
  const installId = uid()
  const r = await call(slug, 'install', {
    type: 'installed',
    installId,
    workspace: { id: 'w1' },
    channels: [],
    token: `quid_plg_${installId}`,
    apiBase: 'https://quid.test/api/plugin-api/v1',
  })
  expect(r.statusCode).toBe(200)
  const chan = { id: uid(), name: 'general' }
  const run = async (command: string, text: string, user = { id: 'u1', name: 'Ada' }) =>
    (
      await call(slug, 'command', {
        type: 'command',
        installId,
        command,
        text,
        user,
        channel: chan,
        threadId: null,
      })
    ).json()
  return { installId, chan, run }
}

beforeAll(async () => {
  await migrate(sql)
})
afterAll(async () => {
  await app.close()
  await sql.end()
})

describe('official plugins service', () => {
  it('answers verification, and rejects unsigned or stale calls', async () => {
    expect((await call('quid-polls', 'verify', { challenge: 'abc' }, false)).json()).toEqual({
      challenge: 'abc',
    })
    expect((await call('quid-polls', 'command', { text: 'x' }, false)).statusCode).toBe(401)
    // Signed for a different plugin.
    const body = JSON.stringify({ text: 'x' })
    const ts = Math.floor(clock.getTime() / 1000).toString()
    const wrong = await app.inject({
      method: 'POST',
      url: '/quid-dice/quid/command',
      headers: {
        'content-type': 'application/json',
        'x-quid-timestamp': ts,
        'x-quid-signature': `sha256=${hmac(pluginSecret(KEY, 'quid-polls'), `${ts}.${body}`)}`,
      },
      payload: body,
    })
    expect(wrong.statusCode).toBe(401)
    expect((await call('nope', 'verify', { challenge: 'a' }, false)).statusCode).toBe(404)
  })

  it('runs a poll: one vote per person, results, only the creator closes', async () => {
    const { run } = await installed('quid-polls')
    expect((await run('vote', '1')).text).toContain('no poll')
    const start = await run('poll', 'Lunch? | Pizza | Sushi | Tacos')
    expect(start).toMatchObject({ visibility: 'channel' })
    expect(start.text).toContain('**Lunch?**')
    expect((await run('vote', '2')).text).toContain('You voted for **Sushi**')
    await run('vote', 'tacos', { id: 'u2', name: 'Ben' })
    await run('vote', '1', { id: 'u3', name: 'Cy' })
    await run('vote', '3', { id: 'u3', name: 'Cy' }) // changes vote
    const results = await run('poll', 'results')
    expect(results.text).toContain('**Tacos**')
    expect(results.text).toContain('3 votes')
    expect((await run('poll', 'close', { id: 'u2', name: 'Ben' })).text).toContain(
      'Only the person',
    )
    expect((await run('poll', 'close')).text).toContain('Final results')
    expect((await run('vote', '1')).text).toContain('closed')
  })

  it('reminds the channel when the time comes, once', async () => {
    const { run, chan } = await installed('quid-reminders')
    const set = await run('remind', 'in 30m stretch')
    expect(set.text).toContain('30 minutes')
    expect((await run('remind', 'list')).text).toContain('stretch')
    posted.length = 0
    clock = new Date(clock.getTime() + 31 * 60_000)
    const r = await app.inject({
      method: 'POST',
      url: '/cron',
      headers: { 'x-cron-token': cronToken(KEY) },
    })
    expect(r.statusCode).toBe(200)
    await app.inject({ method: 'POST', url: '/cron', headers: { 'x-cron-token': cronToken(KEY) } })
    const mine = posted.filter((p) => p.channelId === chan.id)
    expect(mine).toHaveLength(1)
    expect(mine[0]!.text).toContain('Reminder** from Ada: stretch')
    expect((await app.inject({ method: 'POST', url: '/cron' })).statusCode).toBe(401)
  })

  it('parses reminder times, including cities', () => {
    const now = new Date('2026-10-07T00:00:00Z') // 09:00 in Seoul
    expect(parseReminder('in 2 hours lunch', now)?.due.toISOString()).toBe(
      '2026-10-07T02:00:00.000Z',
    )
    const at = parseReminder('at 17:30 Seoul ship it', now)
    expect(at?.due.toISOString()).toBe('2026-10-07T08:30:00.000Z')
    expect(at?.what).toBe('ship it')
    expect(parseReminder('tomorrow 9am New York standup', now)?.due.toISOString()).toBe(
      '2026-10-07T13:00:00.000Z', // still Oct 6 in New York
    )
    expect(parseReminder('whenever', now)).toBeNull()
    expect(zonedToUtc('Asia/Seoul', 2026, 10, 7, 9, 0).toISOString()).toBe(
      '2026-10-07T00:00:00.000Z',
    )
  })

  it('posts daily standups on weekdays at the set time', async () => {
    const { run, chan } = await installed('quid-standup')
    clock = new Date('2026-10-07T00:00:00Z') // Wed 09:00 Seoul
    expect((await run('standup', '')).text).toContain('Daily standup')
    expect((await run('standup', 'daily 09:30 Seoul')).text).toContain('09:30')
    posted.length = 0
    const cron = () =>
      app.inject({ method: 'POST', url: '/cron', headers: { 'x-cron-token': cronToken(KEY) } })
    await cron()
    expect(posted.filter((p) => p.channelId === chan.id)).toHaveLength(0)
    clock = new Date('2026-10-07T00:31:00Z')
    await cron()
    await cron()
    expect(posted.filter((p) => p.channelId === chan.id)).toHaveLength(1)
    clock = new Date('2026-10-10T00:31:00Z') // Saturday
    await cron()
    expect(posted.filter((p) => p.channelId === chan.id)).toHaveLength(1)
    expect((await run('standup', 'off')).text).toContain('off')
  })

  it('translates, world clock, dice', async () => {
    const t = await installed('quid-translate')
    expect(await t.run('translate', 'korean Hello')).toMatchObject({
      visibility: 'ephemeral',
      text: '🌐 [ko] Hello',
    })
    expect((await t.run('translate', 'ja! Hi')).visibility).toBe('channel')
    expect((await t.run('translate', 'klingonese hi')).text).toContain("don't know")

    const c = await installed('quid-world-clock')
    clock = new Date('2026-10-07T00:00:00Z')
    const tc = await c.run('time', 'Seoul New York')
    expect(tc.text).toContain('**Seoul**  Wed 9:00 AM')
    expect(tc.text).toContain('**New York**  Tue 8:00 PM')
    expect((await c.run('time', 'Atlantis')).visibility).toBe('ephemeral')

    const d = await installed('quid-dice')
    expect((await d.run('roll', '2d6')).text).toMatch(/rolled 2d6: \*\*\d+\*\* \(\d \+ \d\)/)
    expect((await d.run('flip', '')).text).toMatch(/Heads|Tails/)
    expect((await d.run('pick', 'pizza, sushi')).text).toMatch(/pizza|sushi/)
    expect((await d.run('roll', '99d6')).visibility).toBe('ephemeral')
  })

  it('forgets an install on uninstall', async () => {
    const { installId, run } = await installed('quid-dice')
    await call('quid-dice', 'uninstall', { type: 'uninstalled', installId })
    expect((await run('flip', '')).text).toContain('reinstalled')
  })
})

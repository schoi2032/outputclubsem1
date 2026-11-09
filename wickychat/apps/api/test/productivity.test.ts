import { tasks } from '@quid/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sendDueReminders } from '../src/modules/productivity/reminders'
import { notifyDueTasks } from '../src/modules/productivity/tasks'
import { fillTemplate, runScheduledWorkflows } from '../src/modules/productivity/workflows'
import { doc, makeApp, setupOrg } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
beforeAll(async () => {
  t = await makeApp()
})
afterAll(async () => {
  await t.app.close()
})

async function org() {
  const o = await setupOrg(t.app, t.email)
  const bea = await o.addMember('member', 'Bea')
  const base = `/api/orgs/${o.orgId}`
  const ch = await o.owner.client.post(`${base}/channels`, {
    name: `ops-${Date.now()}`,
    memberIds: [bea.id],
  })
  return { ...o, bea, base, channelId: ch.body.id as string }
}

const notificationsOf = async (
  client: { get: (u: string) => Promise<{ body: unknown }> },
  base: string,
) =>
  (
    (await client.get(`${base}/notifications`)).body as {
      notifications: { kind: string; title: string; preview: string }[]
    }
  ).notifications

const messagesIn = async (o: Awaited<ReturnType<typeof org>>, channelId = o.channelId) =>
  (
    (await o.owner.client.get(`${o.base}/channels/${channelId}/messages`)).body as {
      messages: { text: string; author: { name: string; isBot: boolean } }[]
    }
  ).messages

describe('canvases', () => {
  it('members create and edit; stale saves are refused', async () => {
    const o = await org()
    const c = await o.owner.client.post(`${o.base}/channels/${o.channelId}/canvases`, {
      title: 'Launch plan',
      body: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Goals' }] },
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: true },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pricing page' }] }],
              },
            ],
          },
        ],
      },
    })
    expect(c.status).toBe(201)
    expect(c.body.version).toBe(1)
    expect(c.body.preview).toContain('[x] Pricing page')

    const list = await o.bea.client.get(`${o.base}/channels/${o.channelId}/canvases`)
    expect(list.body.map((x: { title: string }) => x.title)).toEqual(['Launch plan'])

    const saved = await o.bea.client.patch(`${o.base}/canvases/${c.body.id}`, {
      version: 1,
      body: doc('Updated by Bea'),
    })
    expect(saved.status).toBe(200)
    expect(saved.body.version).toBe(2)
    // The owner's editor still thinks it's version 1.
    const stale = await o.owner.client.patch(`${o.base}/canvases/${c.body.id}`, {
      version: 1,
      title: 'Mine',
    })
    expect(stale.status).toBe(409)

    // Scripts and unknown nodes are refused.
    const bad = await o.owner.client.patch(`${o.base}/canvases/${c.body.id}`, {
      version: 2,
      body: { type: 'doc', content: [{ type: 'iframe' }] },
    })
    expect(bad.status).toBe(400)

    // Only the creator (or a channel admin) can delete it.
    expect((await o.bea.client.del(`${o.base}/canvases/${c.body.id}`)).status).toBe(403)
    expect((await o.owner.client.del(`${o.base}/canvases/${c.body.id}`)).status).toBe(200)
    expect((await o.owner.client.get(`${o.base}/canvases/${c.body.id}`)).status).toBe(404)
  })

  it('outsiders cannot see a private channel’s canvases', async () => {
    const o = await org()
    const priv = await o.owner.client.post(`${o.base}/channels`, {
      name: `secret-${Date.now()}`,
      kind: 'private',
    })
    const c = await o.owner.client.post(`${o.base}/channels/${priv.body.id}/canvases`, {
      title: 'Secret',
    })
    expect((await o.bea.client.get(`${o.base}/canvases/${c.body.id}`)).status).toBe(404)
    expect((await o.bea.client.get(`${o.base}/channels/${priv.body.id}/canvases`)).status).toBe(404)
  })
})

describe('tasks', () => {
  it('turns a message into a task, notifies the assignee, and lists mine', async () => {
    const o = await org()
    const m = await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: doc('Ship the docs'),
    })
    const due = new Date(Date.now() + 30 * 60_000).toISOString()
    const task = await o.owner.client.post(`${o.base}/tasks`, {
      channelId: o.channelId,
      messageId: m.body.id,
      title: 'Ship the docs',
      assigneeId: o.bea.id,
      dueAt: due,
    })
    expect(task.status).toBe(201)
    expect(task.body).toMatchObject({
      status: 'todo',
      assignee: { id: o.bea.id },
      messageId: m.body.id,
    })
    expect(
      (await notificationsOf(o.bea.client, o.base)).some((n) => n.kind === 'task_assigned'),
    ).toBe(true)

    const mine = await o.bea.client.get(`${o.base}/tasks?mine=assigned`)
    expect(mine.body.map((x: { id: string }) => x.id)).toContain(task.body.id)

    // Due within the hour: one reminder, however often the tick runs.
    await notifyDueTasks(t.ctx)
    await notifyDueTasks(t.ctx)
    expect(
      (await notificationsOf(o.bea.client, o.base)).filter((n) => n.kind === 'task_due'),
    ).toHaveLength(1)

    const done = await o.bea.client.patch(`${o.base}/tasks/${task.body.id}`, { status: 'done' })
    expect(done.body.completedAt).not.toBeNull()
    const open = await o.bea.client.get(
      `${o.base}/tasks?channelId=${o.channelId}&includeDone=false`,
    )
    expect(open.body).toHaveLength(0)
  })

  it('only assigns people who can see the channel', async () => {
    const o = await org()
    const carl = await o.addMember('member', 'Carl')
    const priv = await o.owner.client.post(`${o.base}/channels`, {
      name: `p-${Date.now()}`,
      kind: 'private',
    })
    const r = await o.owner.client.post(`${o.base}/tasks`, {
      channelId: priv.body.id,
      title: 'x',
      assigneeId: carl.id,
    })
    expect(r.status).toBe(400)
    const ok = await o.owner.client.post(`${o.base}/tasks`, { channelId: o.channelId, title: 'x' })
    // Non-members can't change it; the creator can delete it.
    expect(
      (await carl.client.patch(`${o.base}/tasks/${ok.body.id}`, { status: 'done' })).status,
    ).toBe(403)
    expect((await o.owner.client.del(`${o.base}/tasks/${ok.body.id}`)).status).toBe(200)
    expect(await t.ctx.db.select().from(tasks).where(eq(tasks.id, ok.body.id))).toHaveLength(0)
  })
})

describe('reminders', () => {
  it('reminds you about a message and about anything', async () => {
    const o = await org()
    const m = await o.bea.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: doc('Review the contract'),
    })
    const soon = new Date(Date.now() + 1000).toISOString()
    const r1 = await o.owner.client.post(`${o.base}/reminders`, {
      messageId: m.body.id,
      dueAt: soon,
    })
    const r2 = await o.owner.client.post(`${o.base}/reminders`, {
      text: 'Call the bank',
      dueAt: soon,
    })
    expect(r1.status).toBe(201)
    expect(r1.body.message.text).toBe('Review the contract')
    expect((await o.owner.client.post(`${o.base}/reminders`, { dueAt: soon })).status).toBe(400)

    await sendDueReminders(t.ctx, new Date(Date.now() + 5000))
    const ns = (await notificationsOf(o.owner.client, o.base)).filter((n) => n.kind === 'reminder')
    expect(ns.map((n) => n.title).sort()).toEqual(
      ['Reminder: Call the bank', expect.stringMatching(/^Reminder: a message in #ops/)].sort(),
    )

    // Bea can't see or touch Ada's reminders.
    expect((await o.bea.client.get(`${o.base}/reminders`)).body).toHaveLength(0)
    expect((await o.bea.client.del(`${o.base}/reminders/${r2.body.id}`)).status).toBe(404)

    const done = await o.owner.client.patch(`${o.base}/reminders/${r2.body.id}`, { done: true })
    expect(done.body.doneAt).not.toBeNull()
    const list = (await o.owner.client.get(`${o.base}/reminders`)).body
    expect(list[list.length - 1].id).toBe(r2.body.id)
  })
})

describe('workflows', () => {
  it('fills placeholders', () => {
    const form = [{ id: 'f1', label: 'Topic', kind: 'text' as const, required: true }]
    expect(
      fillTemplate(
        '{{user}} asked about {{Topic}} in {{channel}} {{nope}}',
        { user: '@Ada', channel: '#ops', message: '', date: '' },
        form,
        { f1: 'pricing' },
      ),
    ).toBe('@Ada asked about pricing in #ops {{nope}}')
  })

  it('a shortcut with a form posts, DMs and creates a task', async () => {
    const o = await org()
    const w = await o.owner.client.post(`${o.base}/workflows`, {
      name: 'Request help',
      trigger: { type: 'shortcut', channelId: o.channelId },
      form: [
        { id: 'what', label: 'What do you need', kind: 'long', required: true },
        {
          id: 'urgency',
          label: 'Urgency',
          kind: 'select',
          options: ['Low', 'High'],
          required: true,
        },
      ],
      steps: [
        {
          id: 's1',
          type: 'message',
          channelId: o.channelId,
          text: '**{{user}}** needs: {{What do you need}} ({{Urgency}})',
        },
        { id: 's2', type: 'dm', to: 'trigger_user', text: 'Got it! We’ll be in touch.' },
        {
          id: 's3',
          type: 'task',
          channelId: o.channelId,
          title: 'Help {{user}}: {{What do you need}}',
          assignee: o.owner.id,
          dueInDays: 1,
        },
      ],
    })
    expect(w.status).toBe(201)

    // Bea sees it as a shortcut in the channel.
    const shortcuts = await o.bea.client.get(`${o.base}/workflows?shortcutsIn=${o.channelId}`)
    expect(shortcuts.body.map((x: { name: string }) => x.name)).toEqual(['Request help'])

    expect(
      (
        await o.bea.client.post(`${o.base}/workflows/${w.body.id}/run`, {
          values: { urgency: 'High' },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await o.bea.client.post(`${o.base}/workflows/${w.body.id}/run`, {
          values: { what: 'x', urgency: 'Meh' },
        })
      ).status,
    ).toBe(400)
    const run = await o.bea.client.post(`${o.base}/workflows/${w.body.id}/run`, {
      values: { what: 'a laptop', urgency: 'High' },
    })
    expect(run.status).toBe(200)

    const msgs = await messagesIn(o)
    expect(
      msgs.some(
        (m) =>
          m.text === '@Bea needs: a laptop (High)' &&
          m.author.name === 'Request help' &&
          m.author.isBot,
      ),
    ).toBe(true)
    const taskList = (await o.owner.client.get(`${o.base}/tasks?mine=assigned`)).body
    expect(taskList[0]).toMatchObject({
      title: 'Help @Bea: a laptop',
      assignee: { id: o.owner.id },
    })
    // Bea got a DM from the workflow's bot.
    const convs = (await o.bea.client.get(`${o.base}/channels/mine`)).body as {
      kind: string
      id: string
    }[]
    const dm = convs.filter((c) => c.kind === 'dm')
    const texts = await Promise.all(
      dm.map(async (c) =>
        (
          (await o.bea.client.get(`${o.base}/channels/${c.id}/messages`)).body.messages as {
            text: string
          }[]
        ).map((m) => m.text),
      ),
    )
    expect(texts.flat()).toContain('Got it! We’ll be in touch.')

    const after = (await o.owner.client.get(`${o.base}/workflows`)).body[0]
    expect(after).toMatchObject({ runCount: 1, lastError: null, canEdit: true })
    // Members can't edit someone else's workflow.
    expect(
      (await o.bea.client.patch(`${o.base}/workflows/${w.body.id}`, { enabled: false })).status,
    ).toBe(403)
  })

  it('keywords and joins trigger workflows; bots never do', async () => {
    const o = await org()
    await o.owner.client.post(`${o.base}/workflows`, {
      name: 'Incident bot',
      trigger: { type: 'keyword', channelId: o.channelId, keyword: 'outage' },
      steps: [
        {
          id: 's1',
          type: 'message',
          channelId: o.channelId,
          text: '🚨 {{user}} reported: {{message}} (say outage again to test loops)',
        },
      ],
    })
    const pub = await o.owner.client.post(`${o.base}/channels`, { name: `welcome-${Date.now()}` })
    await o.owner.client.post(`${o.base}/workflows`, {
      name: 'Greeter',
      trigger: { type: 'channel_join', channelId: pub.body.id },
      steps: [{ id: 's1', type: 'message', channelId: pub.body.id, text: 'Welcome {{user}}!' }],
    })

    await o.bea.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: doc('Big OUTAGE on prod'),
    })
    const msgs = await messagesIn(o)
    // Exactly one reply: the bot's own message mentions "outage" but doesn't trigger again.
    expect(
      msgs.filter((m) => m.text.startsWith('🚨 @Bea reported: Big OUTAGE on prod')),
    ).toHaveLength(1)

    await o.bea.client.post(`${o.base}/channels/${pub.body.id}/join`)
    expect((await messagesIn(o, pub.body.id)).some((m) => m.text === 'Welcome @Bea!')).toBe(true)
  })

  it('runs scheduled workflows once a day at their time', async () => {
    const o = await org()
    const w = await o.owner.client.post(`${o.base}/workflows`, {
      name: 'Standup nudge',
      trigger: {
        type: 'schedule',
        channelId: o.channelId,
        time: '09:00',
        days: [1, 2, 3, 4, 5],
        timezone: 'Asia/Seoul',
      },
      steps: [{ id: 's1', type: 'message', channelId: o.channelId, text: 'Standup time ☀️' }],
    })
    expect(w.status).toBe(201)
    // Wednesday 2026-10-07, 09:05 in Seoul.
    const at = new Date('2026-10-07T00:05:00Z')
    await runScheduledWorkflows(t.ctx, at)
    await runScheduledWorkflows(t.ctx, new Date(at.getTime() + 60_000))
    expect((await messagesIn(o)).filter((m) => m.text === 'Standup time ☀️')).toHaveLength(1)
    // Saturday: nothing.
    await runScheduledWorkflows(t.ctx, new Date('2026-10-10T00:05:00Z'))
    expect((await messagesIn(o)).filter((m) => m.text === 'Standup time ☀️')).toHaveLength(1)

    // Scheduled workflows can't target "whoever triggered it".
    const bad = await o.owner.client.post(`${o.base}/workflows`, {
      name: 'x',
      trigger: {
        type: 'schedule',
        channelId: o.channelId,
        time: '09:00',
        days: [1],
        timezone: 'Asia/Seoul',
      },
      steps: [{ id: 's1', type: 'dm', to: 'trigger_user', text: 'hi' }],
    })
    expect(bad.status).toBe(400)
  })
})

describe('whiteboards', () => {
  const el = (id: string, version: number, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'rectangle',
    version,
    versionNonce: 1000 + version,
    isDeleted: false,
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    ...extra,
  })

  it('merges elements per id by version, so people can draw at once', async () => {
    const o = await org()
    const wb = await o.owner.client.post(`${o.base}/channels/${o.channelId}/canvases`, {
      title: 'Brainstorm',
      kind: 'whiteboard',
    })
    expect(wb.status).toBe(201)
    expect(wb.body).toMatchObject({ kind: 'whiteboard', scene: [] })
    const url = `${o.base}/canvases/${wb.body.id}/elements`

    // Two people add different things; both stay.
    expect(
      (
        await o.owner.client.post(url, {
          elements: [el('a', 1), el('t', 1, { type: 'text', text: 'Ideas' })],
        })
      ).body.kept,
    ).toBe(2)
    expect((await o.bea.client.post(url, { elements: [el('b', 1)] })).body.kept).toBe(1)
    // A newer edit wins; a stale one is ignored.
    expect((await o.bea.client.post(url, { elements: [el('a', 3, { x: 50 })] })).body.kept).toBe(1)
    expect((await o.owner.client.post(url, { elements: [el('a', 2, { x: 9 })] })).body.kept).toBe(0)

    const got = (await o.owner.client.get(`${o.base}/canvases/${wb.body.id}`)).body
    expect(got.scene.map((e: { id: string }) => e.id).sort()).toEqual(['a', 'b', 't'])
    expect(got.scene.find((e: { id: string }) => e.id === 'a').x).toBe(50)
    expect(got.preview).toBe('Ideas')

    // Renaming doesn't need a version; doc bodies aren't accepted.
    expect(
      (await o.owner.client.patch(`${o.base}/canvases/${wb.body.id}`, { title: 'Ideas board' }))
        .status,
    ).toBe(200)
    expect(
      (
        await o.owner.client.patch(`${o.base}/canvases/${wb.body.id}`, {
          version: 1,
          body: doc('x'),
        })
      ).status,
    ).toBe(400)
  })

  it('refuses embeds and images, and strips unsafe links', async () => {
    const o = await org()
    const wb = await o.owner.client.post(`${o.base}/channels/${o.channelId}/canvases`, {
      title: 'B',
      kind: 'whiteboard',
    })
    const url = `${o.base}/canvases/${wb.body.id}/elements`
    for (const type of ['image', 'embeddable', 'iframe'])
      expect((await o.owner.client.post(url, { elements: [el('x', 1, { type })] })).status).toBe(
        400,
      )
    await o.owner.client.post(url, {
      elements: [el('l', 1, { link: 'javascript:alert(1)', customData: { a: 1 } })],
    })
    const got = (await o.owner.client.get(`${o.base}/canvases/${wb.body.id}`)).body
    expect(got.scene[0].link).toBeNull()
    expect(got.scene[0].customData).toBeUndefined()

    // People outside the channel can't draw (or see it).
    const carl = await o.addMember('member', 'Carl')
    const priv = await o.owner.client.post(`${o.base}/channels`, {
      name: `p-${Date.now()}`,
      kind: 'private',
    })
    const pwb = await o.owner.client.post(`${o.base}/channels/${priv.body.id}/canvases`, {
      title: 'P',
      kind: 'whiteboard',
    })
    expect(
      (
        await carl.client.post(`${o.base}/canvases/${pwb.body.id}/elements`, {
          elements: [el('z', 1)],
        })
      ).status,
    ).toBe(404)
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assistantIdle } from '../src/modules/ai/assistant'
import { autoNotes } from '../src/modules/ai/meeting-notes'
import { doc, makeApp, setupOrg } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
beforeAll(async () => {
  t = await makeApp()
})
afterAll(async () => {
  await t.app.close()
})

async function org({ configured = true } = {}) {
  const o = await setupOrg(t.app, t.email)
  const bea = await o.addMember('member', 'Bea')
  const base = `/api/orgs/${o.orgId}`
  const ch = await o.owner.client.post(`${base}/channels`, {
    name: `ai-${Date.now()}`,
    kind: 'private',
    memberIds: [bea.id],
  })
  if (configured) {
    const p = await o.owner.client.post(`${base}/ai/providers`, {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      apiKey: `sk-test-${o.orgId}`,
      dataAccessConsent: true,
    })
    expect(p.status).toBe(201)
  }
  const send = async (client: typeof o.owner.client, text: string, parentId?: string) => {
    const r = await client.post(`${base}/channels/${ch.body.id}/messages`, {
      body: doc(text),
      clientId: `c-${Math.random()}`,
      ...(parentId && { parentId }),
    })
    expect(r.status).toBe(201)
    return r.body.id as string
  }
  return { ...o, bea, base, channelId: ch.body.id as string, send }
}

describe('AI status', () => {
  it('is available only once an admin configures a provider', async () => {
    const o = await org({ configured: false })
    expect((await o.bea.client.get(`${o.base}/ai/status`)).body).toEqual({
      available: false,
      assistant: null,
    })
    const r = await o.bea.client.post(`${o.base}/ai/summarize`, { channelId: o.channelId })
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe('ai_not_configured')
  })
})

describe('catch me up', () => {
  it('summarizes messages after the last-read message with the org key', async () => {
    const o = await org()
    expect((await o.bea.client.get(`${o.base}/ai/status`)).body).toMatchObject({
      available: true,
      assistant: { name: 'Claude', isBot: true },
    })
    const seen = await o.send(o.owner.client, 'Old news nobody needs')
    const q = await o.send(o.owner.client, 'Should we ship Friday?')
    await o.send(o.bea.client, 'Yes, I will write the release notes', q)
    await o.send(o.owner.client, 'Great, Friday it is')
    t.ai.reply = () => 'Shipping Friday. **Action items**\n- Bea: release notes'

    const r = await o.bea.client.post(`${o.base}/ai/summarize`, {
      channelId: o.channelId,
      afterMessageId: seen,
    })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({
      summary: 'Shipping Friday. **Action items**\n- Bea: release notes',
      messageCount: 3,
    })
    const call = t.ai.calls.at(-1)!
    expect(call.apiKey).toBe(`sk-test-${o.orgId}`)
    const prompt = call.messages[0]!.content
    expect(prompt).not.toContain('Old news')
    expect(prompt).toContain('Bea (thread reply): Yes, I will write the release notes')
    expect(prompt).toContain('Owner: Great, Friday it is')
  })

  it('summarizes a single thread', async () => {
    const o = await org()
    await o.send(o.owner.client, 'Unrelated channel chatter')
    const root = await o.send(o.owner.client, 'Which logo do we pick?')
    await o.send(o.bea.client, 'The blue one', root)
    const r = await o.bea.client.post(`${o.base}/ai/summarize`, {
      channelId: o.channelId,
      threadId: root,
    })
    expect(r.status).toBe(200)
    const prompt = t.ai.calls.at(-1)!.messages[0]!.content
    expect(prompt).toContain('Which logo do we pick?')
    expect(prompt).toContain('The blue one')
    expect(prompt).not.toContain('Unrelated')
  })

  it('returns no summary when there is nothing new', async () => {
    const o = await org()
    const last = await o.send(o.owner.client, 'Hello')
    const before = t.ai.calls.length
    const r = await o.bea.client.post(`${o.base}/ai/summarize`, {
      channelId: o.channelId,
      afterMessageId: last,
    })
    expect(r.body).toEqual({ summary: null, messageCount: 0 })
    expect(t.ai.calls.length).toBe(before)
  })

  it("can't read channels the person can't read", async () => {
    const o = await org()
    const carl = await o.addMember('member', 'Carl')
    await o.send(o.owner.client, 'Private plans')
    const r = await carl.client.post(`${o.base}/ai/summarize`, { channelId: o.channelId })
    expect(r.status).toBe(404)
  })

  it('reports provider failures without leaking details', async () => {
    const o = await org()
    await o.send(o.owner.client, 'Something to summarize')
    t.ai.reply = () => new Error('upstream exploded with secret details')
    const r = await o.bea.client.post(`${o.base}/ai/summarize`, { channelId: o.channelId })
    expect(r.status).toBe(502)
    expect(JSON.stringify(r.body)).not.toContain('secret')
    t.ai.reply = () => 'Fake reply'
  })
})

const mentionDoc = (botId: string, text: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'mention', attrs: { id: botId, label: 'Claude', kind: 'user' } },
        { type: 'text', text: ` ${text}` },
      ],
    },
  ],
})

async function botOf(o: Awaited<ReturnType<typeof org>>) {
  return (await o.owner.client.get(`${o.base}/ai/status`)).body.assistant.id as string
}

const threadOf = async (o: Awaited<ReturnType<typeof org>>, rootId: string) =>
  (await o.owner.client.get(`${o.base}/messages/${rootId}/thread`)).body as {
    replies: { text: string; kind: string; author: { name: string; isBot: boolean } }[]
  }

describe('@Claude', () => {
  it('answers a mention in a thread, with the channel as context', async () => {
    const o = await org()
    const botId = await botOf(o)
    await o.send(o.bea.client, 'The launch moved to **March 3**')
    t.ai.reply = () => 'The launch is on **March 3**.\n- Bea mentioned it'
    const r = await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: mentionDoc(botId, 'when is the launch?'),
    })
    expect(r.status).toBe(201)
    await assistantIdle()

    const call = t.ai.calls.at(-1)!
    expect(call.system).toContain('#ai-')
    expect(call.messages[0]!.content).toContain('Bea: The launch moved to **March 3**')
    expect(call.messages[0]!.content).toContain('Owner: @Claude when is the launch?')

    const thread = await threadOf(o, r.body.id)
    expect(thread.replies).toHaveLength(1)
    expect(thread.replies[0]).toMatchObject({
      kind: 'bot',
      author: { name: 'Claude', isBot: true },
      text: expect.stringContaining('The launch is on March 3.'),
    })
    t.ai.reply = () => 'Fake reply'
  })

  it('ignores messages that do not mention Claude, and its own messages', async () => {
    const o = await org()
    await botOf(o)
    const before = t.ai.calls.length
    await o.send(o.owner.client, 'Claude is a nice name')
    await assistantIdle()
    expect(t.ai.calls.length).toBe(before)
  })

  it('chats in a DM without needing a mention', async () => {
    const o = await org()
    const botId = await botOf(o)
    const dm = await o.bea.client.post(`${o.base}/conversations`, { userIds: [botId] })
    expect(dm.status).toBe(200)
    t.ai.reply = () => 'Hi Bea!'
    await o.bea.client.post(`${o.base}/channels/${dm.body.id}/messages`, { body: doc('hello') })
    await assistantIdle()
    const msgs = (await o.bea.client.get(`${o.base}/channels/${dm.body.id}/messages`)).body
      .messages as { text: string; parentId: string | null; author: { isBot: boolean } }[]
    expect(msgs.at(-1)).toMatchObject({ text: 'Hi Bea!', parentId: null, author: { isBot: true } })
    expect(t.ai.calls.at(-1)!.system).toContain('a direct message with Bea')
    t.ai.reply = () => 'Fake reply'
  })

  it('says so in the thread when Claude fails or is turned off', async () => {
    const o = await org()
    const botId = await botOf(o)
    t.ai.reply = () => new Error('boom')
    const r = await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: mentionDoc(botId, 'hi'),
    })
    await assistantIdle()
    expect((await threadOf(o, r.body.id)).replies[0]!.text).toContain('couldn’t reach Claude')
    t.ai.reply = () => 'Fake reply'

    const providers = (await o.owner.client.get(`${o.base}/ai/providers`)).body as { id: string }[]
    await o.owner.client.del(`${o.base}/ai/providers/${providers[0]!.id}`)
    const r2 = await o.owner.client.post(`${o.base}/channels/${o.channelId}/messages`, {
      body: mentionDoc(botId, 'still there?'),
    })
    await assistantIdle()
    expect((await threadOf(o, r2.body.id)).replies[0]!.text).toContain('isn’t set up')
  })
})

describe('meeting notes', () => {
  async function meetingWithTranscript(o: Awaited<ReturnType<typeof org>>) {
    const m = await o.owner.client.post(`${o.base}/meetings`, {
      title: 'Roadmap sync',
      waitingRoom: false,
      channelId: o.channelId,
    })
    const code = m.body.code as string
    await o.owner.client.post(`${o.base}/meetings/${code}/join`)
    await o.bea.client.post(`${o.base}/meetings/${code}/join`)
    const at = (s: number) => new Date(Date.now() + s * 1000).toISOString()
    await o.owner.client.post(`${o.base}/meetings/${code}/transcript`, {
      segments: [
        { text: 'Let us pick the launch date', spokenAt: at(0) },
        { text: 'March 3 then, agreed', spokenAt: at(2) },
      ],
    })
    await o.bea.client.post(`${o.base}/meetings/${code}/transcript`, {
      segments: [{ text: 'I will update the site by Friday', spokenAt: at(1) }],
    })
    return { id: m.body.id as string, code }
  }

  it('are written when a meeting with a transcript ends, for attendees only', async () => {
    const o = await org()
    const carl = await o.addMember('member', 'Carl')
    const m = await meetingWithTranscript(o)
    t.ai.reply = () => '**Summary**: Launch is March 3.\n**Action items**\n- Bea: update the site'
    expect((await o.owner.client.post(`${o.base}/meetings/${m.code}/end`)).status).toBe(200)
    // The job runs a little after the meeting ends; run it directly here.
    await autoNotes(t.ctx, m.id)

    const call = t.ai.calls.at(-1)!
    expect(call.messages[0]!.content).toContain('Meeting: Roadmap sync')
    expect(call.messages[0]!.content).toContain('Bea: I will update the site by Friday')

    const notes = await o.bea.client.get(`${o.base}/meetings/${m.code}/notes`)
    expect(notes.body.notes).toMatchObject({
      summary: expect.stringContaining('Launch is March 3'),
      transcriptLines: 3,
      outdated: false,
    })
    expect((await carl.client.get(`${o.base}/meetings/${m.code}/notes`)).status).toBe(403)

    // Already written: the job doesn't spend another request.
    const before = t.ai.calls.length
    await autoNotes(t.ctx, m.id)
    expect(t.ai.calls.length).toBe(before)
    t.ai.reply = () => 'Fake reply'
  })

  it('can be regenerated and shared to the meeting channel as Claude', async () => {
    const o = await org()
    const m = await meetingWithTranscript(o)
    expect((await o.bea.client.get(`${o.base}/meetings/${m.code}/notes`)).body.notes).toBeNull()
    expect((await o.bea.client.post(`${o.base}/meetings/${m.code}/notes/share`)).status).toBe(404)

    t.ai.reply = () => '**Decisions**\n- Launch March 3'
    const gen = await o.bea.client.post(`${o.base}/meetings/${m.code}/notes`)
    expect(gen.status).toBe(200)
    expect(gen.body.notes.summary).toContain('Launch March 3')

    const share = await o.bea.client.post(`${o.base}/meetings/${m.code}/notes/share`)
    expect(share.status).toBe(200)
    const msgs = (await o.owner.client.get(`${o.base}/channels/${o.channelId}/messages`)).body
      .messages as { id: string; text: string; author: { name: string; isBot: boolean } }[]
    const posted = msgs.find((x) => x.id === share.body.messageId)!
    expect(posted.author).toMatchObject({ name: 'Claude', isBot: true })
    expect(posted.text).toContain('Notes from “Roadmap sync” (shared by Bea)')
    expect(posted.text).toContain('Launch March 3')
    t.ai.reply = () => 'Fake reply'
  })
})

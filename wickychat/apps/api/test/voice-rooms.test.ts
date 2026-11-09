import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { makeApp, setupOrg } from './helpers'

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
  const carl = await o.addMember('member', 'Carl')
  const ch = await o.owner.client.post(`/api/orgs/${o.orgId}/channels`, {
    name: 'lounge',
    memberIds: [bea.id],
  })
  return { ...o, bea, carl, channelId: ch.body.id as string, base: `/api/orgs/${o.orgId}` }
}

describe('voice rooms', () => {
  it('lets channel members drop in and out of an open room', async () => {
    const o = await org()
    const j = await o.bea.client.post(`${o.base}/channels/${o.channelId}/voice-room/join`)
    expect(j.status).toBe(200)
    expect(j.body.room.participants).toHaveLength(1)
    expect(t.media.grants.at(-1)).toMatchObject({
      identity: o.bea.id,
      canPublish: true,
      roomAdmin: false,
    })

    await o.owner.client.post(`${o.base}/channels/${o.channelId}/voice-room/join`)
    const active = await o.owner.client.get(`${o.base}/voice-rooms`)
    expect(active.body[0].participants).toHaveLength(2)

    await o.bea.client.post(`${o.base}/voice-rooms/${j.body.room.id}/leave`)
    const after = await o.owner.client.get(`${o.base}/channels/${o.channelId}/voice-room`)
    expect(after.body.room.participants.map((p: { user: { id: string } }) => p.user.id)).toEqual([
      o.owner.id,
    ])
  })

  it('keeps non-members out and hides rooms from them', async () => {
    const o = await org()
    await o.bea.client.post(`${o.base}/channels/${o.channelId}/voice-room/join`)
    expect(
      (await o.carl.client.post(`${o.base}/channels/${o.channelId}/voice-room/join`)).status,
    ).toBe(403)
    expect((await o.carl.client.get(`${o.base}/voice-rooms`)).body).toHaveLength(0)
  })

  it('stage mode: listeners raise hands, moderators choose speakers', async () => {
    const o = await org()
    const own = await o.owner.client.post(`${o.base}/channels/${o.channelId}/voice-room/join`)
    const roomId = own.body.room.id
    expect(own.body.room.canModerate).toBe(true)

    // Members can't change the mode.
    expect(
      (await o.bea.client.patch(`${o.base}/voice-rooms/${roomId}`, { mode: 'stage' })).status,
    ).toBe(403)
    expect(
      (await o.owner.client.patch(`${o.base}/voice-rooms/${roomId}`, { mode: 'stage' })).status,
    ).toBe(200)

    const bea = await o.bea.client.post(`${o.base}/channels/${o.channelId}/voice-room/join`)
    expect(
      bea.body.room.participants.find((p: { user: { id: string } }) => p.user.id === o.bea.id).role,
    ).toBe('listener')
    expect(t.media.grants.at(-1)).toMatchObject({ identity: o.bea.id, canPublish: false })

    await o.bea.client.post(`${o.base}/voice-rooms/${roomId}/hand`, { raised: true })
    const raised = await o.owner.client.get(`${o.base}/channels/${o.channelId}/voice-room`)
    expect(
      raised.body.room.participants.find((p: { user: { id: string } }) => p.user.id === o.bea.id)
        .handRaised,
    ).toBe(true)

    expect(
      (
        await o.bea.client.post(`${o.base}/voice-rooms/${roomId}/role`, {
          userId: o.bea.id,
          role: 'speaker',
        })
      ).status,
    ).toBe(403)
    await o.owner.client.post(`${o.base}/voice-rooms/${roomId}/role`, {
      userId: o.bea.id,
      role: 'speaker',
    })
    expect(t.media.actions).toContain(`publish:room_${o.channelId}:${o.bea.id}:true`)

    await o.owner.client.post(`${o.base}/voice-rooms/${roomId}/mute`, { userId: o.bea.id })
    expect(t.media.actions).toContain(`mute:room_${o.channelId}:${o.bea.id}`)
    await o.owner.client.post(`${o.base}/voice-rooms/${roomId}/remove`, { userId: o.bea.id })
    expect(t.media.actions).toContain(`remove:room_${o.channelId}:${o.bea.id}`)
    const final = await o.owner.client.get(`${o.base}/channels/${o.channelId}/voice-room`)
    expect(final.body.room.participants).toHaveLength(1)
  })

  it('removes people from calls, meetings and rooms when all their connections drop', async () => {
    const o = await org()
    await o.bea.client.post(`${o.base}/channels/${o.channelId}/voice-room/join`)
    const dm = await o.owner.client.post(`${o.base}/conversations`, { userIds: [o.bea.id] })
    const call = await o.owner.client.post(`${o.base}/channels/${dm.body.id}/calls`)
    await o.bea.client.post(`${o.base}/calls/${call.body.call.id}/join`)
    const m = await o.owner.client.post(`${o.base}/meetings`, { title: 'Sync', waitingRoom: false })
    await o.bea.client.post(`${o.base}/meetings/${m.body.code}/join`)

    vi.useFakeTimers({ toFake: ['setTimeout'] })
    t.ctx.online.connect(o.bea.id)
    t.ctx.online.disconnect(o.bea.id)
    vi.advanceTimersByTime(15_000)
    vi.useRealTimers()

    await expect
      .poll(
        async () =>
          (await o.owner.client.get(`${o.base}/channels/${o.channelId}/voice-room`)).body.room
            .participants.length,
        { timeout: 5000 },
      )
      .toBe(0)
    await expect
      .poll(async () => (await o.owner.client.get(`${o.base}/calls`)).body.calls[0].status, {
        timeout: 5000,
      })
      .toBe('ended')
    await expect
      .poll(
        async () =>
          (await o.owner.client.get(`${o.base}/meetings/${m.body.code}`)).body.participants.find(
            (p: { user: { id: string } }) => p.user.id === o.bea.id,
          ).status,
        { timeout: 5000 },
      )
      .toBe('left')
  })
})

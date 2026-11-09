import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Client, makeApp, setupOrg } from './helpers'

let t: Awaited<ReturnType<typeof makeApp>>
beforeAll(async () => {
  t = await makeApp()
})
afterAll(async () => {
  await t.app.close()
})

/** Two 8×8 frames, stacked: red then blue. */
async function animatedGif() {
  const frame = (r: number, b: number) =>
    Buffer.from(Array.from({ length: 64 }, () => [r, 0, b, 255]).flat())
  return sharp(Buffer.concat([frame(255, 0), frame(0, 255)]), {
    raw: { width: 8, height: 16, channels: 4, pageHeight: 8 },
  })
    .gif({ loop: 0, delay: [100, 100] })
    .toBuffer()
}
const stillPng = () =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: '#b8492f' } })
    .png()
    .toBuffer()

/** A minimal valid WAV: 8 kHz mono, 100 ms of silence. */
function wav() {
  const samples = 800
  const b = Buffer.alloc(44 + samples)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + samples, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(8000, 24)
  b.writeUInt32LE(8000, 28)
  b.writeUInt16LE(1, 32)
  b.writeUInt16LE(8, 34)
  b.write('data', 36)
  b.writeUInt32LE(samples, 40)
  b.fill(128, 44)
  return b
}

async function upload(c: Client, url: string, buf: Buffer, filename: string, type: string) {
  const boundary = '----quidtest'
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    buf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const res = await t.app.inject({
    method: 'POST',
    url,
    headers: {
      origin: 'http://localhost:3000',
      cookie: c.cookie,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  })
  return { status: res.statusCode, body: res.json() }
}

describe('custom emoji', () => {
  it('lets members add, use and remove their own emoji', async () => {
    const o = await setupOrg(t.app, t.email)
    const bea = await o.addMember('member', 'Bea')
    const carl = await o.addMember('member', 'Carl')
    const base = `/api/orgs/${o.orgId}`

    const f = await upload(
      bea.client,
      `${base}/files?purpose=emoji`,
      await animatedGif(),
      'parrot.gif',
      'image/gif',
    )
    expect(f.status).toBe(201)
    const add = await bea.client.post(`${base}/emojis`, { name: 'Party_Parrot', fileId: f.body.id })
    expect(add.status).toBe(201)
    expect(add.body.name).toBe('party_parrot')

    const dup = await bea.client.post(`${base}/emojis`, { name: 'party_parrot', fileId: f.body.id })
    expect(dup.status).toBe(409)
    const bad = await bea.client.post(`${base}/emojis`, { name: 'no spaces', fileId: f.body.id })
    expect(bad.status).toBe(400)

    // Someone else's upload can't be registered.
    const stolen = await carl.client.post(`${base}/emojis`, { name: 'mine', fileId: f.body.id })
    expect(stolen.status).toBe(404)

    const list = await carl.client.get(`${base}/emojis`)
    expect(list.body).toEqual([
      expect.objectContaining({
        name: 'party_parrot',
        animated: true,
        createdBy: expect.objectContaining({ id: bea.id }),
      }),
    ])

    // Only the creator or an admin can remove it.
    expect((await carl.client.del(`${base}/emojis/${add.body.id}`)).status).toBe(403)
    expect((await o.owner.client.del(`${base}/emojis/${add.body.id}`)).status).toBe(200)
    expect((await carl.client.get(`${base}/emojis`)).body).toEqual([])
  })

  it('rejects files that are not images', async () => {
    const o = await setupOrg(t.app, t.email)
    const f = await upload(
      o.owner.client,
      `/api/orgs/${o.orgId}/files?purpose=emoji`,
      wav(),
      'x.wav',
      'audio/wav',
    )
    expect(f.status).toBe(400)
  })
})

describe('soundboard', () => {
  it('stores short audio clips for the org', async () => {
    const o = await setupOrg(t.app, t.email)
    const bea = await o.addMember('member', 'Bea')
    const base = `/api/orgs/${o.orgId}`

    const img = await upload(
      bea.client,
      `${base}/files?purpose=sound`,
      await stillPng(),
      'x.png',
      'image/png',
    )
    expect(img.status).toBe(400)

    const f = await upload(
      bea.client,
      `${base}/files?purpose=sound`,
      wav(),
      'boop.wav',
      'audio/wav',
    )
    expect(f.status).toBe(201)
    expect(f.body.mime).toBe('audio/wav')
    const add = await bea.client.post(`${base}/sounds`, {
      name: 'Boop',
      emoji: '🔔',
      fileId: f.body.id,
      volume: 60,
    })
    expect(add.status).toBe(201)

    const edit = await bea.client.patch(`${base}/sounds/${add.body.id}`, { volume: 40 })
    expect(edit.status).toBe(200)
    const list = await o.owner.client.get(`${base}/sounds`)
    expect(list.body).toEqual([expect.objectContaining({ name: 'Boop', emoji: '🔔', volume: 40 })])

    const play = await t.app.inject({
      method: 'GET',
      url: list.body[0].url,
      headers: { cookie: o.owner.client.cookie },
    })
    expect(play.statusCode).toBe(200)
    expect(play.headers['content-type']).toBe('audio/wav')

    expect((await bea.client.del(`${base}/sounds/${add.body.id}`)).status).toBe(200)
  })
})

describe('animated avatars', () => {
  it('marks GIF avatars so clients can play them on hover', async () => {
    const o = await setupOrg(t.app, t.email)
    const base = `/api/orgs/${o.orgId}`
    const gif = await upload(
      o.owner.client,
      `${base}/files?purpose=avatar`,
      await animatedGif(),
      'me.gif',
      'image/gif',
    )
    const me = await o.owner.client.patch('/api/me', { avatarFileId: gif.body.id })
    expect(me.body.user.avatarUrl).toMatch(/inline=1&anim=1$/)

    const still = await upload(
      o.owner.client,
      `${base}/files?purpose=avatar`,
      await stillPng(),
      'me.png',
      'image/png',
    )
    const me2 = await o.owner.client.patch('/api/me', { avatarFileId: still.body.id })
    expect(me2.body.user.avatarUrl).toMatch(/inline=1$/)

    // The still thumbnail of an animated avatar is served as WebP.
    const thumb = await t.app.inject({
      method: 'GET',
      url: `/api/files/${gif.body.id}/content?inline=1&thumb=1`,
      headers: { cookie: o.owner.client.cookie },
    })
    expect(thumb.headers['content-type']).toBe('image/webp')
  })
})

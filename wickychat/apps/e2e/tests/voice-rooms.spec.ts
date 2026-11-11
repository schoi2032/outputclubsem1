import { type Browser, expect, type Page, test } from '@playwright/test'

/** A stage-mode voice room between two seeded dev users, through a real LiveKit server. */
test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
})

async function signIn(browser: Browser, email: string) {
  const page = await (await browser.newContext({ permissions: ['microphone'] })).newPage()
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('quid-dev-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/home$/)
  return page
}

/** Calls the API from inside the page, so the session cookie is used. */
const api = <T>(page: Page, path: string, body?: unknown) =>
  page.evaluate(
    async ([p, b]) => {
      const r = await fetch(p as string, {
        method: b ? 'POST' : 'GET',
        headers: b ? { 'content-type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
      })
      return r.json()
    },
    [path, body] as const,
  ) as Promise<T>

test('stage voice room: listener raises a hand, moderator invites them to speak', async ({
  browser,
}) => {
  const ada = await signIn(browser, 'ada@dev.quid.local')
  const eli = await signIn(browser, 'eli@dev.quid.local')

  const me = await api<{ orgs: { id: string; slug: string }[] }>(ada, '/api/me')
  const org = me.orgs.find((o) => o.slug === 'dev-acme')!
  const members = await api<{ id: string; email: string }[]>(ada, `/api/orgs/${org.id}/members`)
  const eliId = members.find((m) => m.email === 'eli@dev.quid.local')!.id
  const channel = await api<{ id: string }>(ada, `/api/orgs/${org.id}/channels`, {
    name: `room-${Date.now().toString(36)}`,
    memberIds: [eliId],
  })

  for (const p of [ada, eli]) await p.goto(`/dev-acme/c/${channel.id}`)

  await ada.getByRole('button', { name: 'Voice room', exact: true }).click()
  const adaRoom = ada.getByRole('region', { name: 'Voice room' })
  await expect(adaRoom).toBeVisible()
  await adaRoom.getByRole('button', { name: 'Room settings' }).click()
  await ada.getByRole('menuitem', { name: 'Only speakers (stage)' }).click()
  await expect(adaRoom).toContainText('Stage')

  await eli.getByRole('button', { name: /Voice room, 1 people/ }).click()
  const eliRoom = eli.getByRole('region', { name: 'Voice room' })
  await eliRoom.getByRole('button', { name: 'Raise hand' }).click()
  await expect(adaRoom).toContainText('1 ✋')

  await adaRoom.getByRole('button', { name: 'Manage Eli Kim' }).click()
  await ada.getByRole('menuitem', { name: 'Invite to speak' }).click()
  await eliRoom.getByRole('button', { name: 'Unmute microphone' }).click()
  await adaRoom.getByRole('button', { name: 'Unmute microphone' }).click()
  await expect.poll(() => ada.locator('audio').count()).toBeGreaterThan(0)

  await eliRoom.getByRole('button', { name: 'Leave' }).click()
  await expect(adaRoom).toContainText('1 in the room')
  await adaRoom.getByRole('button', { name: 'Leave' }).click()

  // Don't leave test channels behind in the demo workspace.
  await ada.evaluate(
    (p) => fetch(p, { method: 'DELETE' }),
    `/api/orgs/${org.id}/channels/${channel.id}`,
  )
})

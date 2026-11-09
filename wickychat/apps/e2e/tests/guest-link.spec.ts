import { expect, test } from '@playwright/test'

/** Someone without a Quid account joins a meeting through its guest link. */
test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
})

test('host enables guest access, an outside guest waits, is admitted, then removed', async ({
  browser,
}) => {
  const hostCtx = await browser.newContext({
    permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write'],
  })
  const ada = await hostCtx.newPage()
  await ada.goto('/login')
  await ada.getByLabel('Email').fill('ada@dev.quid.local')
  await ada.getByLabel('Password').fill('quid-dev-password')
  await ada.getByRole('button', { name: 'Sign in' }).click()
  await ada.waitForURL(/\/home$/)

  await ada.goto('/dev-acme/meet')
  await ada.getByRole('button', { name: 'New meeting' }).click()
  await ada.waitForURL(/\/meet\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/)
  const code = ada.url().split('/').pop()!
  await ada.getByRole('button', { name: 'Join now' }).click()
  await ada.getByRole('button', { name: 'People', exact: true }).click()
  await ada.getByRole('switch', { name: 'Allow guests' }).click()
  await expect(ada.getByRole('button', { name: 'Copy guest link' })).toBeVisible()

  // A visitor with no account and no cookies.
  const guestCtx = await browser.newContext({ permissions: ['microphone', 'camera'] })
  const guest = await guestCtx.newPage()
  await guest.goto(`/join/${code}`)
  await guest.getByLabel('Your name').fill('Vera Visitor')
  await guest.getByRole('button', { name: 'Ask to join' }).click()
  await expect(guest.getByText('Waiting for the host to let you in')).toBeVisible()

  await expect(ada.getByText('Guests waiting · 1')).toBeVisible()
  await ada.getByRole('button', { name: 'Admit', exact: true }).click()
  await expect(guest.getByText('joined as a guest')).toBeVisible()
  await expect(ada.getByText('Vera Visitor (guest)')).toBeVisible()
  await expect
    .poll(() =>
      guest.evaluate(
        () => [...document.querySelectorAll('video')].filter((v) => v.videoWidth > 0).length,
      ),
    )
    .toBe(2)

  await ada.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(guest.getByText('You were removed from the meeting')).toBeVisible()
})

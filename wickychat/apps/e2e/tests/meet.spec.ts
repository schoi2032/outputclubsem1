import { type Browser, expect, test } from '@playwright/test'

/** A video meeting between two seeded dev users, through a real LiveKit server. */
test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--auto-select-desktop-capture-source=Entire screen',
    ],
  },
})

async function signIn(browser: Browser, email: string) {
  const ctx = await browser.newContext({ permissions: ['microphone', 'camera'] })
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('quid-dev-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/home$/)
  return page
}

test('host admits a guest from the waiting room, they chat, share a screen, and the host ends it', async ({
  browser,
}) => {
  const ada = await signIn(browser, 'ada@dev.quid.local')
  const ben = await signIn(browser, 'ben@dev.quid.local')

  await ada.goto('/dev-acme/meet')
  await ada.getByRole('button', { name: 'New meeting' }).click()
  await ada.waitForURL(/\/meet\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/)
  await ada.getByRole('button', { name: 'Join now' }).click()
  await expect(ada.getByRole('button', { name: 'Leave options' })).toBeVisible()

  await ben.goto(ada.url())
  await ben.getByRole('button', { name: 'Ask to join' }).click()
  await expect(ben.getByText('Waiting for the host to let you in')).toBeVisible()

  await ada.getByText('1 waiting to join').click()
  await ada.getByRole('button', { name: 'Admit', exact: true }).click()
  await expect(ben.getByRole('button', { name: 'Leave', exact: true })).toBeVisible()

  // Both cameras play on Ada's side.
  await expect
    .poll(() =>
      ada.evaluate(
        () => [...document.querySelectorAll('video')].filter((v) => v.videoWidth > 0).length,
      ),
    )
    .toBe(2)

  await ben.getByRole('button', { name: 'Chat', exact: true }).click()
  await ben.getByRole('textbox', { name: 'Message', exact: true }).fill('Hello from the meeting')
  await ben.keyboard.press('Enter')
  await ada.getByRole('button', { name: 'Chat', exact: true }).click()
  await expect(ada.getByText('Hello from the meeting')).toBeVisible()

  await ben.getByRole('button', { name: 'Share screen' }).click()
  await expect(ada.getByText("Ben Ortiz's screen")).toBeVisible()

  await ada.getByRole('button', { name: 'Leave options' }).click()
  await ada.getByRole('menuitem', { name: 'End meeting for everyone' }).click()
  await expect(ben.getByText('The host ended the meeting')).toBeVisible()
})

import { type Browser, expect, test } from '@playwright/test'

/**
 * Voice call between two seeded dev users, through a real LiveKit server.
 * Requires `pnpm db:seed` and LiveKit running (see README).
 */
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
  const ctx = await browser.newContext({ permissions: ['microphone'] })
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('quid-dev-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/home$/)
  return page
}

test('call a teammate, talk, mute and hang up', async ({ browser }) => {
  const ada = await signIn(browser, 'ada@dev.quid.local')
  const ben = await signIn(browser, 'ben@dev.quid.local')

  await ada.getByRole('complementary').getByRole('link', { name: 'Ben Ortiz' }).click()
  // Wait until the DM is open, so the call starts there and not in the previous channel.
  await expect(ada.getByRole('heading', { name: 'Ben Ortiz', exact: true }).first()).toBeVisible()
  await ada.getByRole('button', { name: 'Start voice call' }).click()

  const incoming = ben.getByRole('alertdialog', { name: /Incoming call from Ada Park/ })
  await expect(incoming).toBeVisible()
  await incoming.getByRole('button', { name: 'Accept' }).click()

  // Both sides are connected and Ada receives Ben's audio.
  const adaBar = ada.getByRole('region', { name: 'Current call' })
  await expect(adaBar).toContainText(/\d+:\d{2}/)
  await expect.poll(() => ada.locator('audio[data-quid="call-audio"]').count()).toBeGreaterThan(0)
  await expect.poll(() => ben.locator('audio[data-quid="call-audio"]').count()).toBeGreaterThan(0)

  await ben.getByRole('button', { name: 'Mute microphone' }).click()
  await expect(ben.getByRole('button', { name: 'Unmute microphone' })).toBeVisible()

  await adaBar.getByRole('button', { name: 'Leave' }).click()
  await expect(ben.getByRole('region', { name: 'Current call' })).toHaveCount(0)
  await expect(ada.getByText(/Call ended · /).last()).toBeVisible()
})

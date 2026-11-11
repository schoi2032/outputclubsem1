import { statSync } from 'node:fs'
import { type Browser, expect, test } from '@playwright/test'

/** Recording in the host's browser: everyone sees it, and the video is saved locally. */
test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--auto-select-desktop-capture-source=Entire screen',
      '--auto-accept-this-tab-capture',
    ],
  },
})

async function signIn(browser: Browser, email: string) {
  const ctx = await browser.newContext({
    permissions: ['microphone', 'camera'],
    acceptDownloads: true,
  })
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('quid-dev-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/home$/)
  return page
}

test('host records; participants see the indicator; the video downloads', async ({ browser }) => {
  const ada = await signIn(browser, 'ada@dev.quid.local')
  const ben = await signIn(browser, 'ben@dev.quid.local')
  await ada.goto('/dev-acme/meet')
  await ada.getByRole('button', { name: 'New meeting' }).click()
  await ada.waitForURL(/\/meet\/[a-z-]+$/)
  await ada.getByRole('button', { name: 'Join now' }).click()
  await ben.goto(ada.url())
  await ben.getByRole('button', { name: 'Ask to join' }).click()
  await ada.getByText('1 waiting to join').click()
  await ada.getByRole('button', { name: 'Admit', exact: true }).click()
  await expect(ben.getByRole('button', { name: 'Leave', exact: true })).toBeVisible()

  await ada.getByRole('button', { name: 'Record', exact: true }).click()
  await ada.getByRole('button', { name: 'Start recording' }).click()
  await expect(ada.getByText('Recording · saved to your computer when you stop')).toBeVisible()
  await expect(ben.getByText('Recording by Ada Park')).toBeVisible()
  await ada.waitForTimeout(3000)

  const download = ada.waitForEvent('download')
  await ada.getByRole('button', { name: 'Stop recording' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^quid-[a-z-]+-\d{4}-\d{2}-\d{2}\.(webm|mp4)$/)
  expect(statSync(await file.path()).size).toBeGreaterThan(10_000)
  await expect(ben.getByText('Recording by Ada Park')).toHaveCount(0)

  await ada.getByRole('button', { name: 'Leave options' }).click()
  await ada.getByRole('menuitem', { name: 'End meeting for everyone' }).click()
})

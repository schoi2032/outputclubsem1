import { type Browser, expect, test } from '@playwright/test'

async function signIn(browser: Browser, email: string) {
  const page = await (await browser.newContext()).newPage()
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('quid-dev-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/home$/)
  return page
}

test('admins see the dashboard and control connected apps; members do not', async ({ browser }) => {
  const ada = await signIn(browser, 'ada@dev.quid.local')
  await ada.goto('/dev-acme/settings/dashboard')
  await expect(ada.getByText('Messages per day')).toBeVisible()
  await expect(ada.getByText('Active in the last 7 days')).toBeVisible()
  await ada.screenshot({ path: 'test-results/admin-dashboard.png', fullPage: true })

  const toggle = ada.getByRole('switch', { name: 'Allow connected apps' })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(ada.getByText('Connected apps turned off')).toBeVisible()

  const eli = await signIn(browser, 'eli@dev.quid.local')
  await eli.goto('/dev-acme/settings/connected-apps')
  await expect(eli.getByText('An administrator has turned off connected apps')).toBeVisible()
  await expect(eli.getByRole('link', { name: 'Dashboard' })).toHaveCount(0)

  await toggle.click()
  await expect(ada.getByText('Connected apps allowed')).toBeVisible()
  await expect(toggle).toBeChecked()
})

test('Quid staff see platform analytics; workspace admins do not', async ({ browser }) => {
  const ada = await signIn(browser, 'ada@dev.quid.local')
  await ada.goto('/dev-acme/settings/analytics')
  await expect(ada.getByText('Monthly recurring revenue')).toBeVisible()
  await expect(ada.getByText('Most active workspaces')).toBeVisible()
  await ada.getByRole('button', { name: '90d' }).click()
  await expect(ada.getByText('Messages, 90 days')).toBeVisible()
  await ada.screenshot({ path: 'test-results/platform-analytics.png', fullPage: true })

  const ben = await signIn(browser, 'ben@dev.quid.local')
  await ben.goto('/dev-acme/settings/dashboard')
  await expect(ben.getByRole('link', { name: 'Analytics' })).toHaveCount(0)
})

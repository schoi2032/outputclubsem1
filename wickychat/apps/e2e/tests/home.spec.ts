import { expect, test } from '@playwright/test'

test('signed-out visitors see the landing page; signing in lands on Home', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Where your team talks')
  await page.screenshot({ path: 'test-results/landing.png', fullPage: true })

  await page.getByRole('link', { name: 'Sign in' }).first().click()
  await page.getByLabel('Email').fill('ada@dev.quid.local')
  await page.getByLabel('Password').fill('quid-dev-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/dev-acme\/home$/)
  await expect(
    page.getByRole('heading', { name: /Good (morning|afternoon|evening), Ada/ }),
  ).toBeVisible()
  await expect(page.getByText('Waiting for you')).toBeVisible()
  await expect(page.getByText('Unread conversations')).toBeVisible()
  await expect(page.getByText('Coming up').first()).toBeVisible()
  await page.screenshot({ path: 'test-results/home.png' })

  // Chat is still one click away.
  await page
    .getByRole('navigation', { name: 'Products' })
    .getByRole('link', { name: 'Chat' })
    .click()
  await page.waitForURL(/\/c\//)
})

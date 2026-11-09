import { expect, type Page, test } from '@playwright/test'
import { createDb } from '@quid/db'

const { client: sql } = createDb(
  process.env.DATABASE_URL ?? 'postgres://quid:quid@localhost:5432/quid',
  { max: 1 },
)
test.afterAll(() => sql.end())

async function signIn(page: Page, onboarding = false) {
  if (onboarding) await page.addInitScript(() => localStorage.setItem('quid-e2e-onboarding', '1'))
  await page.goto('/login')
  await page.getByLabel('Email').fill('ada@dev.quid.local')
  await page.getByLabel('Password').fill('quid-dev-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/home$/)
}

test('⌘K finds messages and jumps to them', async ({ page }) => {
  await signIn(page)
  const word = `kumquat${Date.now().toString(36)}`
  await page.getByRole('link', { name: 'general' }).first().click()
  await page.getByRole('textbox', { name: /Message #general/ }).fill(`Who brought the ${word}?`)
  await page.keyboard.press('Enter')
  await expect(page.getByText(`Who brought the ${word}?`)).toBeVisible()

  await page.keyboard.press('ControlOrMeta+k')
  const box = page.getByRole('combobox', { name: 'Search' })
  await expect(box).toBeFocused()
  await box.fill(word)
  const hit = page.getByRole('option', { name: new RegExp(`brought the ${word}`) })
  await expect(hit).toBeVisible()
  await page.screenshot({ path: 'test-results/command-palette.png' })
  await hit.click()
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]+\?m=/)

  // Channels by name, and actions.
  await page.getByRole('button', { name: /Search Acme/ }).click()
  await page.getByRole('combobox', { name: 'Search' }).fill('engin')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'engineering' }).first()).toBeVisible()
})

test('plugins live in the sidebar', async ({ page }) => {
  await signIn(page)
  const plugins = page.locator('[data-tour="plugins"]')
  await plugins.getByRole('link', { name: 'Add plugins' }).click()
  await expect(page).toHaveURL(/\/dev-acme\/plugins$/)
  await expect(page.getByRole('heading', { name: 'Add plugins to Acme Inc.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Developer docs' })).toBeVisible()
  await page.screenshot({ path: 'test-results/plugins-page.png' })

  // Install World Clock into #general unless it's already there.
  const clock = page.locator('li', { hasText: 'World Clock' }).first()
  if (await clock.getByRole('button', { name: 'Install' }).isVisible()) {
    await clock.getByRole('button', { name: 'Install' }).click()
    await page.getByRole('dialog').getByText('general', { exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Install' }).click()
  }
  await plugins.getByRole('button', { name: 'World Clock' }).click()
  await expect(page.getByText('/time Seoul London New York')).toBeVisible()
  await page.screenshot({ path: 'test-results/sidebar-plugin.png' })
})

test('the tour walks through the app once', async ({ page }) => {
  await signIn(page, true)
  await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith('quid-tour-done:'))
      .forEach((k) => {
        localStorage.removeItem(k)
      }),
  )
  await page.reload()
  const tour = page.getByRole('dialog', { name: 'Quid tour' })
  await expect(tour.getByText('Welcome to Quid 👋')).toBeVisible()
  await tour.getByRole('button', { name: 'Show me around' }).click()
  await expect(tour.getByText('Find anything')).toBeVisible()
  await page.screenshot({ path: 'test-results/tour.png' })
  for (let i = 0; i < 5; i++) await tour.getByRole('button', { name: 'Next' }).click()
  await expect(tour.getByText("You're all set")).toBeVisible()
  await tour.getByRole('button', { name: 'Done' }).click()
  await expect(tour).toHaveCount(0)
  await page.reload()
  await page.waitForTimeout(1500)
  await expect(tour).toHaveCount(0)
})

test('trial admins get a billing reminder every two days', async ({ page }) => {
  await signIn(page, true)
  const slug = `nudge-${Date.now().toString(36)}`
  const org = await page.evaluate(
    async (s) =>
      (
        await fetch('/api/orgs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Nudge Test', slug: s }),
        })
      ).json(),
    slug,
  )
  try {
    // Tour already seen; the reminder clock started three days ago.
    await page.evaluate(async (orgId) => {
      const me = await (await fetch('/api/me')).json()
      const userId = me.user?.id ?? me.id
      localStorage.setItem(`quid-tour-done:${userId}`, '1')
      localStorage.setItem(
        `quid-trial-nudge:${orgId}:${userId}`,
        String(Date.now() - 3 * 86_400_000),
      )
    }, org.id)
    await page.goto(`/${slug}/home`)
    const nudge = page.getByRole('dialog', { name: /left on your free trial/ })
    await expect(nudge).toBeVisible({ timeout: 10_000 })
    await expect(nudge.getByText('$3.20')).toBeVisible()
    await page.screenshot({ path: 'test-results/trial-nudge.png' })
    await nudge.getByRole('link', { name: 'Claim 20% off' }).click()
    await expect(page).toHaveURL(/settings\/billing\?offer=welcome/)
    // Not again until two days have passed.
    await page.goto(`/${slug}/home`)
    await page.waitForTimeout(3500)
    await expect(nudge).toHaveCount(0)
  } finally {
    await sql`delete from organizations where id = ${org.id}`
  }
})

test('plugin developer docs are public', async ({ browser }) => {
  const page = await browser.newPage()
  await page.goto('/developers')
  await expect(page.getByRole('heading', { name: 'Build a plugin for Quid' })).toBeVisible()
  await expect(page.getByText('x-quid-signature: sha256=')).toBeVisible()
  await page.screenshot({ path: 'test-results/developers.png', fullPage: true })
  await page.close()
})

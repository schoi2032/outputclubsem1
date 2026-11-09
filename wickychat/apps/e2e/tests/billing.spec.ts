import { expect, test } from '@playwright/test'
import { createDb } from '@quid/db'

const { client: sql } = createDb(
  process.env.DATABASE_URL ?? 'postgres://quid:quid@localhost:5432/quid',
  { max: 1 },
)
test.afterAll(() => sql.end())

test('a new workspace gets a trial, sees per-member pricing, and goes read-only when it ends', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('ada@dev.quid.local')
  await page.getByLabel('Password').fill('quid-dev-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/home$/)

  const slug = `billing-${Date.now().toString(36)}`
  const org = await page.evaluate(
    async (s) =>
      (
        await fetch('/api/orgs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Billing Test', slug: s }),
        })
      ).json(),
    slug,
  )
  try {
    await page.goto(`/${slug}/settings/billing`)
    await expect(page.getByText('Free trial', { exact: true })).toBeVisible()
    await expect(page.getByText('14 days left')).toBeVisible()
    // The welcome offer: 20% off the first two months of a monthly plan.
    await expect(page.getByText('Welcome offer: 20% off your first 2 months.')).toBeVisible()
    await expect(
      page.getByText('1 member today: $3.20 per month for 2 months, then $4'),
    ).toBeVisible()
    // Enterprise+ is offered when its plans are configured.
    await expect(
      page.getByText('1 member today: $6.40 per month for 2 months, then $8'),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Yearly · 2 months free' }).click()
    await expect(page.getByText('1 member today: $40 per year')).toBeVisible()
    await expect(page.getByText('Payments are processed securely by PayPal')).toBeVisible()
    await expect(page.getByText(/Paddle/)).toHaveCount(0)
    await page.screenshot({ path: 'test-results/billing.png', fullPage: true })

    // End the trial.
    await sql`update billing_accounts set trial_ends_at = now() - interval '1 second' where org_id = ${org.id}`
    await page.waitForTimeout(31_000) // the API caches billing state for 30 seconds
    await page.goto(`/${slug}/home`)
    await expect(
      page.getByRole('heading', { name: "Billing Test's free trial has ended" }),
    ).toBeVisible()
    await page.screenshot({ path: 'test-results/paywall.png' })

    // Writing is refused by the API too, and settings stay reachable.
    const status = await page.evaluate(
      async (id) =>
        (
          await fetch(`/api/orgs/${id}/channels`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'nope' }),
          })
        ).status,
      org.id,
    )
    expect(status).toBe(402)
    await page.getByRole('link', { name: 'Choose a plan' }).click()
    await expect(page.getByText('Trial ended')).toBeVisible()
    await expect(page.getByText('Payments are processed securely by PayPal')).toBeVisible()
  } finally {
    await sql`delete from organizations where id = ${org.id}`
  }
})

test('promo codes: typed in, or remembered from a ?promo= link', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('ada@dev.quid.local')
  await page.getByLabel('Password').fill('quid-dev-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/home$/)
  const make = (s: string) =>
    page.evaluate(
      async (slug) =>
        (
          await fetch('/api/orgs', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Promo Test', slug }),
          })
        ).json(),
      s,
    )
  const a = await make(`promo-${Date.now().toString(36)}`)
  const b = await make(`promo2-${Date.now().toString(36)}`)
  try {
    await page.goto(`/${a.slug}/settings/billing`)
    await page.getByRole('button', { name: 'Have a promo code?' }).click()
    await page.getByLabel('Promo code').fill('NOTREAL')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByText("That code doesn't exist.")).toBeVisible()
    await page.getByLabel('Promo code').fill('ph10p')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByText('PH10P', { exact: true })).toBeVisible()
    // The 20% welcome offer is still better during the trial.
    await expect(page.getByText('Your welcome offer is the better deal right now')).toBeVisible()

    // Once the welcome offer is over, the code's price shows.
    await sql`update billing_accounts set trial_ends_at = now() - interval '8 days' where org_id = ${a.id}`
    await page.waitForTimeout(31_000) // billing state is cached for 30 seconds
    await page.reload()
    await expect(
      page.getByText('Product Hunt code PH10P: 10% off your first 3 months.'),
    ).toBeVisible()
    await expect(
      page.getByText('1 member today: $3.60 per month for 3 months, then $4'),
    ).toBeVisible()
    await page.screenshot({ path: 'test-results/promo.png', fullPage: true })

    // A link with ?promo= is remembered and applied when an admin opens billing.
    await page.goto('/pricing?promo=PH10P')
    await page.goto(`/${b.slug}/settings/billing`)
    await expect(page.getByText('Code PH10P applied')).toBeVisible()
    await expect(page.getByText('PH10P', { exact: true })).toBeVisible()
  } finally {
    await sql`delete from organizations where id in (${a.id}, ${b.id})`
  }
})

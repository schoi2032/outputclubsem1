import { expect, test } from '@playwright/test'

/** What payment-provider reviewers check: public legal pages, prices and a contact from the homepage. */
test('legal pages, pricing and contact are public and linked from the homepage', async ({
  page,
}) => {
  await page.goto('/')
  const footer = page.getByRole('navigation', { name: 'Legal' })
  for (const [name, path, heading] of [
    ['Terms of Service', '/terms', 'Terms of Service'],
    ['Privacy Policy', '/privacy', 'Privacy Policy'],
    ['Refund Policy', '/refunds', 'Refund Policy'],
    ['Pricing', '/pricing', 'Simple, per-member pricing'],
  ] as const) {
    await expect(footer.getByRole('link', { name })).toHaveAttribute('href', path)
    await page.goto(path)
    await expect(page).toHaveURL(new RegExp(`${path}$`)) // not redirected to sign-in
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    await page.goto('/')
  }
  await expect(
    footer.getByRole('link', { name: /Contact: lashertaeyang@gmail\.com/ }),
  ).toHaveAttribute('href', 'mailto:lashertaeyang@gmail.com')
  await expect(page.locator('#pricing').getByText(/^\$4\s*per member \/ month$/)).toBeVisible()
  await expect(page.locator('#pricing').getByText(/^\$8\s*per member \/ month$/)).toBeVisible()

  await page.goto('/pricing')
  await page.getByRole('button', { name: 'Yearly · 2 months free' }).click()
  await expect(page.getByText(/^\$40\s*per member \/ year$/)).toBeVisible()
  await expect(page.getByText(/^\$80\s*per member \/ year$/)).toBeVisible()
  await page.screenshot({ path: 'test-results/pricing.png', fullPage: true })
  await page.goto('/terms')
  await expect(page.getByRole('heading', { name: '5. Payments through PayPal' })).toBeVisible()
  // Customers never see Paddle while PayPal is the payment company.
  for (const path of ['/terms', '/privacy', '/refunds', '/pricing']) {
    await page.goto(path)
    await expect(page.getByText(/Paddle/)).toHaveCount(0)
  }
  await page.goto('/terms')
  await expect(page.getByText('Jisun Eum').first()).toBeVisible()
})

test('sign-up requires agreeing to the Terms, Privacy and Refund policies', async ({ page }) => {
  await page.goto('/register')
  const create = page.getByRole('button', { name: 'Create account' })
  await expect(create).toBeDisabled()
  const box = page.getByRole('checkbox', {
    name: /I agree to the Terms of Service, Privacy Policy and Refund Policy/,
  })
  await expect(page.getByRole('link', { name: 'Refund Policy' }).first()).toHaveAttribute(
    'href',
    '/refunds',
  )
  await box.check()
  await expect(create).toBeEnabled()
  await page.screenshot({ path: 'test-results/register.png' })
  // Policies are at the bottom of the sign-in and sign-up pages too.
  for (const path of ['/register', '/login']) {
    await page.goto(path)
    const legal = page.getByRole('navigation', { name: 'Legal' })
    await expect(legal.getByRole('link', { name: 'Terms of Service' })).toBeVisible()
    await expect(legal.getByRole('link', { name: 'Privacy Policy' })).toBeVisible()
    await expect(legal.getByRole('link', { name: 'Refund Policy' })).toBeVisible()
  }

  await page.goto('/')
  await page.locator('#pricing').scrollIntoViewIfNeeded()
  await expect(page.locator('#pricing').getByText('Quid Pro', { exact: true })).toBeVisible()
  await expect(
    page.locator('#pricing').getByText('Quid Enterprise+', { exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/landing-full.png', fullPage: true })
})

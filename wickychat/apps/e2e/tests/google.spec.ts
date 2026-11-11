import { expect, test } from '@playwright/test'

test('Continue with Google sends people to Google with PKCE, state and nonce', async ({
  page,
  request,
}) => {
  await page.goto('/login?next=%2Fnew')
  const link = page.getByRole('link', { name: 'Continue with Google' })
  await expect(link).toHaveAttribute('href', '/api/auth/google/start?next=%2Fnew')
  await page.screenshot({ path: 'test-results/login-google.png' })

  const res = await request.get('/api/auth/google/start?next=%2Fnew', { maxRedirects: 0 })
  expect(res.status()).toBe(302)
  const to = new URL(res.headers().location!)
  expect(to.origin + to.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
  expect(to.searchParams.get('client_id')).toBe('e2e-placeholder.apps.googleusercontent.com')
  expect(to.searchParams.get('redirect_uri')).toMatch(/\/api\/auth\/google\/callback$/)
  expect(to.searchParams.get('code_challenge_method')).toBe('S256')
  expect(to.searchParams.get('state')).toBeTruthy()
  expect(to.searchParams.get('nonce')).toBeTruthy()
  expect(res.headers()['set-cookie']).toContain('quid_google_flow=')

  // Coming back without the flow cookie (e.g. a forged link) is rejected.
  await page.goto('/api/auth/google/callback?code=x&state=y')
  await expect(page).toHaveURL(/\/login\?error=google_expired/)
  await expect(page.getByText('That sign-in attempt expired')).toBeVisible()

  await page.goto('/register')
  await expect(page.getByRole('link', { name: 'Sign up with Google' })).toBeVisible()
})

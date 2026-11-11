import { type Browser, expect, type Page, test } from '@playwright/test'
import { waitForLink } from './mail'

const stamp = Date.now().toString(36)
const password = 'e2e-password-123'

async function signUp(
  browser: Browser,
  name: string,
  email: string,
  invite?: string,
): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto(
    invite ? `/register?invite=${invite}&email=${encodeURIComponent(email)}` : '/register',
  )
  await page.getByLabel('Full name').fill(name)
  if (!invite) await page.getByLabel('Work email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('checkbox', { name: /I agree to the Terms of Service/ }).check()
  await page.getByRole('button', { name: 'Create account' }).click()
  if (!invite) {
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    const link = await waitForLink(email, /http:\/\/[^\s]+\/verify-email\?token=[\w-]+/)
    await page.goto(link)
  }
  // Both flows end with a redirect into the app.
  await page.waitForURL((u) => !/\/(register|verify-email|check-email)/.test(u.pathname))
  return page
}

test('sign up, create an organization, invite a teammate and chat in real time', async ({
  browser,
}) => {
  const ownerEmail = `owner-${stamp}@example.com`
  const mateEmail = `mate-${stamp}@example.com`
  const slug = `e2e-${stamp}`

  // Owner signs up and verifies by email.
  const owner = await signUp(browser, 'Olivia Owner', ownerEmail)
  await owner.waitForURL('**/new')

  // Creates an organization.
  await owner.getByLabel('Organization name').fill(`E2E ${stamp}`)
  await owner.getByLabel('URL').fill(slug)
  await owner.getByRole('button', { name: 'Create organization' }).click()
  await owner.waitForURL(`**/${slug}/c/**`)
  await expect(owner.getByRole('heading', { name: 'general', exact: true })).toBeVisible()

  // Invites a teammate.
  await owner.getByRole('button', { name: 'Invite people' }).last().click()
  await owner.getByLabel('Email addresses').fill(mateEmail)
  await owner.getByRole('button', { name: 'Send invitation' }).click()
  await expect(owner.getByText('1 invitation sent')).toBeVisible()

  // Teammate follows the invitation link, signs up and lands in the org.
  const inviteUrl = await waitForLink(mateEmail, /http:\/\/[^\s]+\/invite\/[\w-]+/)
  const token = inviteUrl.split('/invite/')[1]!
  const mate = await signUp(browser, 'Max Mate', mateEmail, token)
  await mate.goto(`/${slug}`)
  await mate.getByRole('link', { name: 'general' }).first().click()
  await expect(mate.getByRole('heading', { name: 'general', exact: true })).toBeVisible()

  // Owner sends a message; teammate sees it live without reloading.
  const ownerEditor = owner.locator('.ProseMirror').first()
  await ownerEditor.click()
  await ownerEditor.pressSequentially('Welcome aboard, Max!')
  await owner.keyboard.press('Enter')
  await expect(mate.getByText('Welcome aboard, Max!')).toBeVisible()

  // Teammate replies in a thread; owner sees the thread summary update live.
  const message = mate.locator('[id^="m-"]', { hasText: 'Welcome aboard, Max!' })
  await message.hover()
  await message.getByRole('button', { name: 'Reply in thread' }).click()
  const threadEditor = mate.getByRole('complementary', { name: 'Thread' }).locator('.ProseMirror')
  await threadEditor.click()
  await threadEditor.pressSequentially('Thanks, glad to be here')
  await mate.keyboard.press('Enter')
  await expect(owner.getByRole('button', { name: /1 reply/ })).toBeVisible()

  // Teammate reacts; owner sees the reaction.
  await message.hover()
  await message.getByRole('button', { name: 'React with 👍' }).click()
  await expect(owner.getByRole('button', { name: /reacted with 👍/ })).toBeVisible()
})

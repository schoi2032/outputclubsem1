import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { createDb } from '@quid/db'

const { client: sql } = createDb(
  process.env.DATABASE_URL ?? 'postgres://quid:quid@localhost:5432/quid',
  { max: 1 },
)

/** A tiny plugin server: echoes the challenge and answers /ping. */
const server = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const body = JSON.parse(raw || '{}')
    res.setHeader('content-type', 'application/json')
    if (req.url === '/quid/verify') return res.end(JSON.stringify({ challenge: body.challenge }))
    if (req.url === '/quid/command')
      return res.end(JSON.stringify({ text: `Pong: ${body.text}`, visibility: 'ephemeral' }))
    res.end('{}')
  })
})
test.beforeAll(() => new Promise<void>((r) => server.listen(0, '127.0.0.1', r)))
test.afterAll(async () => {
  server.close()
  await sql.end()
})

test('install a community plugin and use its slash command', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('ada@dev.quid.local')
  await page.getByLabel('Password').fill('quid-dev-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/home$/)

  const name = `Ping ${Date.now().toString(36)}`
  const port = (server.address() as AddressInfo).port
  const created = await page.evaluate(
    async ({ name, port }) => {
      const me = await (await fetch('/api/me')).json()
      const org = me.orgs.find((o: { slug: string }) => o.slug === 'dev-acme')
      const r = await fetch(`/api/orgs/${org.id}/plugins`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          tagline: 'Answers /ping',
          developerName: 'E2E',
          developerEmail: 'e2e@quid-mail.co',
          baseUrl: `http://127.0.0.1:${port}`,
          commands: [{ name: 'ping', description: 'Check it works' }],
        }),
      })
      return { orgId: org.id as string, plugin: (await r.json()).plugin }
    },
    { name, port },
  )
  expect(created.plugin.status).toBe('unverified')

  try {
    await page.goto('/dev-acme/settings/plugins')
    await page.getByRole('button', { name: 'Community' }).click()
    const card = page.getByRole('listitem').filter({ hasText: name })
    await expect(card.getByText('Unverified')).toBeVisible()
    await card.getByRole('button', { name: 'Install' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('checkbox', { name: 'general' }).check()
    // Community plugins need an explicit acknowledgement before Install works.
    await expect(dialog.getByRole('button', { name: 'Install' })).toBeDisabled()
    await dialog.getByRole('checkbox', { name: /I understand this plugin/ }).check()
    await dialog.getByRole('button', { name: 'Install' }).click()
    await expect(page.getByText(`${name} installed`)).toBeVisible()
    await page.screenshot({ path: 'test-results/plugins.png' })

    // Use it in #general.
    await page.goto('/dev-acme')
    await page.getByRole('complementary').getByRole('link', { name: 'general' }).click()
    const box = page.getByRole('textbox', { name: /Message #general/ })
    await box.click()
    await page.keyboard.type('/ping hello')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Pong: hello')).toBeVisible()
  } finally {
    await sql`delete from integrations where kind = 'plugin' and config->>'pluginId' = ${created.plugin.id}`
    await sql`delete from plugins where id = ${created.plugin.id}`
  }
})

test('install an official plugin and run a poll', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('ada@dev.quid.local')
  await page.getByLabel('Password').fill('quid-dev-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/home$/)

  await page.goto('/dev-acme/settings/plugins')
  const card = page.getByRole('listitem').filter({ hasText: 'Ask the team and see answers add up' })
  await expect(card.getByText('Official')).toBeVisible()
  await expect(
    page.getByRole('main').getByRole('listitem').filter({ hasText: 'Dice & Decide' }),
  ).toBeVisible()
  // Left installed by an interrupted earlier run.
  if (await card.getByRole('button', { name: 'Uninstall' }).isVisible()) {
    await card.getByRole('button', { name: 'Uninstall' }).click()
    await expect(page.getByText('Polls removed')).toBeVisible()
  }
  await card.getByRole('button', { name: 'Install', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('checkbox', { name: 'general' }).check()
  // Verified plugins don't need the community warning.
  await expect(dialog.getByRole('checkbox', { name: /I understand this plugin/ })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Install' }).click()
  await expect(page.getByText('Polls installed')).toBeVisible()
  await page.screenshot({ path: 'test-results/official-plugins.png', fullPage: true })

  try {
    await page.goto('/dev-acme')
    await page.getByRole('complementary').getByRole('link', { name: 'general' }).click()
    const box = page.getByRole('textbox', { name: /Message #general/ })
    const q = `Team lunch ${Date.now().toString(36)}?`
    await box.click()
    await page.keyboard.type(`/poll ${q} | Pizza | Sushi | Tacos`)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('main').getByText(q)).toBeVisible()
    await box.click()
    await page.keyboard.type('/vote 2')
    await page.keyboard.press('Enter')
    await expect(page.getByText('You voted for Sushi')).toBeVisible()
  } finally {
    await page.goto('/dev-acme/settings/plugins')
    await page.getByRole('button', { name: /Installed/ }).click()
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Ask the team' })
      .getByRole('button', { name: 'Uninstall' })
      .click()
    await expect(page.getByText('Polls removed')).toBeVisible()
  }
})

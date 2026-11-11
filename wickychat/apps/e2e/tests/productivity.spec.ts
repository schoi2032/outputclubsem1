import { expect, type Page, test } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('ada@dev.quid.local')
  await page.getByLabel('Password').fill('quid-dev-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/home$/)
}

/** A fresh channel for each test, so runs don't see each other's data. */
async function freshChannel(page: Page, prefix: string) {
  const name = `${prefix}-${Date.now().toString(36)}`
  const id = await page.evaluate(async (n) => {
    const me = await (await fetch('/api/me')).json()
    const org = me.orgs.find((o: { slug: string }) => o.slug === 'dev-acme')
    const r = await fetch(`/api/orgs/${org.id}/channels`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: n }),
    })
    return (await r.json()).id as string
  }, name)
  await page.goto(`/dev-acme/c/${id}`)
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  return { id, name }
}

const tab = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Channel sections' })
    .getByRole('button', { name, exact: true })

async function post(page: Page, text: string) {
  const box = page.getByRole('textbox', { name: /Message #/ })
  await box.click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

test('canvases: write a doc in a channel and it saves', async ({ page }) => {
  await signIn(page)
  await freshChannel(page, 'canvas')
  await tab(page, 'Canvases').click()
  await page.getByRole('button', { name: 'New canvas' }).click()
  await page.getByRole('menuitem', { name: 'Meeting notes' }).click()
  await expect(page.getByRole('textbox', { name: 'Canvas title' })).toHaveValue('Meeting notes')
  const editor = page.getByLabel('Canvas Meeting notes')
  await editor.getByText('Notes', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Ship the launch email on Friday')
  await expect(page.getByText(/^Saved ·/)).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: 'test-results/canvas.png' })

  // Back to the list, then reopen: it's still there.
  await page.getByRole('button', { name: 'All canvases' }).click()
  await expect(page.getByText(/Ship the launch email on Friday/)).toBeVisible()
  await page.getByRole('button', { name: /Meeting notes/ }).click()
  await expect(editor.getByText('Ship the launch email on Friday')).toBeVisible()
  // The channel says a canvas was created.
  await tab(page, 'Messages').click()
  await expect(page.getByText('created the canvas “Meeting notes”')).toBeVisible()
})

test('tasks: from a message, from /todo, and in My tasks', async ({ page }) => {
  await signIn(page)
  const ch = await freshChannel(page, 'tasks')
  await post(page, 'Can someone update the pricing page?')
  const msg = page.getByText('Can someone update the pricing page?')
  await msg.hover()
  await page.getByRole('button', { name: 'More actions' }).last().click()
  await page.getByRole('menuitem', { name: 'Create task' }).click()
  const dialog = page.getByRole('dialog', { name: 'New task' })
  await expect(dialog.getByLabel('Task')).toHaveValue('Can someone update the pricing page?')
  await dialog.getByLabel('Assignee').selectOption({ label: 'Ada Park (you)' })
  await dialog.getByRole('button', { name: 'Create task' }).click()
  await expect(page.getByText('Task created')).toBeVisible()

  await post(page, '/todo Write the launch email')
  await expect(page.getByText('Task added')).toBeVisible()

  await tab(page, 'Tasks').click()
  const todo = page.getByRole('region', { name: 'To do' })
  await expect(todo.getByText('Can someone update the pricing page?')).toBeVisible()
  await expect(todo.getByText('Write the launch email')).toBeVisible()
  await page.getByRole('button', { name: 'Mark Write the launch email done' }).click()
  await expect(
    page.getByRole('region', { name: 'Done' }).getByText('Write the launch email'),
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/tasks-board.png' })

  await page.goto('/dev-acme/tasks')
  await expect(page.getByText('Can someone update the pricing page?').first()).toBeVisible()
  await expect(page.getByText(`#${ch.name}`).first()).toBeVisible()
})

test('reminders: on a message, with /remind, and in Later', async ({ page }) => {
  await signIn(page)
  await freshChannel(page, 'remind')
  const stamp = Date.now().toString(36)
  await post(page, `Review the contract draft ${stamp}`)
  await page.getByText(`Review the contract draft ${stamp}`).hover()
  await page.getByRole('button', { name: 'More actions' }).last().click()
  await page.getByRole('menuitem', { name: 'Remind me about this' }).hover()
  await page.keyboard.press('ArrowRight')
  // In 20 minutes → In 1 hour → In 3 hours.
  await expect(page.getByRole('menuitem', { name: 'In 3 hours' })).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByText(/We'll remind you/)).toBeVisible()

  // The slash menu lists built-in commands.
  const box = page.getByRole('textbox', { name: /Message #/ })
  await box.click()
  await page.keyboard.type('/rem')
  await expect(
    page.getByRole('listbox', { name: 'Suggestions' }).getByText('/remind'),
  ).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.type(`in 2 hours call the bank ${stamp}`)
  await page.keyboard.press('Enter')
  await expect(page.getByText('Reminder set:')).toBeVisible()

  await page.goto('/dev-acme/saved?tab=reminders')
  await expect(page.getByText(`call the bank ${stamp}`)).toBeVisible()
  await expect(page.getByText(`Review the contract draft ${stamp}`)).toBeVisible()
  await page.screenshot({ path: 'test-results/later.png' })
})

test('workflow builder: a request form that posts and creates a task', async ({ page }) => {
  await signIn(page)
  const ch = await freshChannel(page, 'wf')
  await page.goto(`/dev-acme/workflows/new?template=request&channel=${ch.id}`)
  const name = `Request ${Date.now().toString(36)}`
  await page.getByRole('textbox', { name: 'Workflow name' }).fill(name)
  await expect(page.getByRole('button', { name: 'From a shortcut' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('textbox', { name: 'Question 1' })).toHaveValue('What do you need')
  await page.screenshot({ path: 'test-results/workflow-builder.png', fullPage: true })
  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(page).toHaveURL(/\/workflows$/)
  await expect(page.getByText(name)).toBeVisible()

  await page.goto(`/dev-acme/c/${ch.id}`)
  await page.getByRole('button', { name: 'Workflows' }).click()
  await page.getByRole('button', { name }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('What do you need').fill('A new laptop charger')
  await dialog.getByLabel('Urgency').selectOption('High')
  await dialog.getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByText(`${name} done`)).toBeVisible()
  await expect(page.getByRole('main').getByText('A new laptop charger').first()).toBeVisible()
  await tab(page, 'Tasks').click()
  await expect(page.getByText(/Request from @Ada.*A new laptop charger/)).toBeVisible()
})

test('whiteboard: sticky notes and charts sync live to teammates', async ({ page, browser }) => {
  await signIn(page)
  const ch = await freshChannel(page, 'board')
  await tab(page, 'Canvases').click()
  await page.getByRole('button', { name: 'New canvas' }).click()
  await page.getByRole('menuitem', { name: 'Whiteboard' }).click()
  await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 30_000 })

  // Ben joins the channel and opens the same board.
  const ben = await browser.newPage()
  await ben.goto('/login')
  await ben.getByLabel('Email').fill('ben@dev.quid.local')
  await ben.getByLabel('Password').fill('quid-dev-password')
  await ben.getByRole('button', { name: 'Sign in' }).click()
  await ben.waitForURL(/\/home$/)
  await ben.goto(`/dev-acme/c/${ch.id}`)
  await ben.getByRole('button', { name: 'Join channel' }).click()
  await tab(ben, 'Canvases').click()
  await ben.getByRole('button', { name: /Untitled whiteboard/ }).click()
  await expect(ben.locator('.excalidraw')).toBeVisible({ timeout: 30_000 })

  // Ada adds a sticky note and a chart.
  await page.getByRole('button', { name: 'Sticky' }).click()
  await page.getByRole('menuitem', { name: 'Yellow' }).click()
  await page.getByRole('button', { name: 'Chart' }).click()
  await page.getByRole('button', { name: 'Insert chart' }).click()
  await expect(page.getByText('All changes saved')).toBeVisible()

  const onBoard = (p: typeof page) =>
    p.evaluate(
      () =>
        (
          window as unknown as { __quidBoard?: { getSceneElements: () => unknown[] } }
        ).__quidBoard?.getSceneElements().length ?? 0,
    )
  // Ben sees everything without reloading.
  await expect.poll(() => onBoard(ben)).toBeGreaterThan(10)
  expect(await onBoard(ben)).toBe(await onBoard(page))
  await page.screenshot({ path: 'test-results/whiteboard.png' })
  await ben.screenshot({ path: 'test-results/whiteboard-ben.png' })

  // And it's saved: a fresh load has it all.
  await ben.reload()
  await tab(ben, 'Canvases').click()
  await ben.getByRole('button', { name: /Untitled whiteboard/ }).click()
  await expect.poll(() => onBoard(ben)).toBe(await onBoard(page))
  await ben.close()
})

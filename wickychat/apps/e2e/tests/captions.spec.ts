import { type Browser, expect, test } from '@playwright/test'

/**
 * Captions pipeline: speech recognition (stubbed, since headless browsers can't
 * transcribe) → live caption for others → saved transcript.
 */
test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
})

/** A recognizer that "hears" the given sentence shortly after it starts (or nothing). */
const fakeRecognizer = (sentence: string | null) => {
  class FakeRecognition {
    continuous = false
    interimResults = false
    lang = 'en-US'
    onresult: ((e: unknown) => void) | null = null
    onend: (() => void) | null = null
    onerror: ((e: unknown) => void) | null = null
    private said = false
    start() {
      if (this.said || !sentence) return
      this.said = true
      setTimeout(() => {
        const results = [Object.assign([{ transcript: sentence }], { isFinal: true })]
        this.onresult?.({ resultIndex: 0, results })
      }, 800)
    }
    stop() {}
  }
  const w = window as unknown as { SpeechRecognition: unknown; webkitSpeechRecognition: unknown }
  w.SpeechRecognition = FakeRecognition
  w.webkitSpeechRecognition = FakeRecognition
}

async function signIn(browser: Browser, email: string, sentence: string | null) {
  const ctx = await browser.newContext({ permissions: ['microphone', 'camera'] })
  await ctx.addInitScript(fakeRecognizer, sentence)
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('quid-dev-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/home$/)
  return page
}

test('captions show live for others and are saved to the transcript', async ({ browser }) => {
  const ada = await signIn(browser, 'ada@dev.quid.local', 'Let us review the launch plan')
  const ben = await signIn(browser, 'ben@dev.quid.local', null)

  await ada.goto('/dev-acme/meet')
  await ada.getByRole('button', { name: 'New meeting' }).click()
  await ada.waitForURL(/\/meet\/[a-z-]+$/)
  const url = ada.url()
  await ada.getByRole('button', { name: 'Join now' }).click()
  await ben.goto(url)
  await ben.getByRole('button', { name: 'Ask to join' }).click()
  await ada.getByText('1 waiting to join').click()
  await ada.getByRole('button', { name: 'Admit', exact: true }).click()
  await expect(ben.getByRole('button', { name: 'Leave', exact: true })).toBeVisible()

  // Ben views captions; Ada turns hers on (first time: consent dialog).
  await ben.getByRole('button', { name: 'Turn on captions' }).click()
  await ben.getByRole('button', { name: 'Turn on captions', exact: true }).last().click()
  await ada.getByRole('button', { name: 'Turn on captions' }).click()
  await expect(
    ada.getByText('Your finished lines are saved to the meeting transcript'),
  ).toBeVisible()
  await ada.getByRole('dialog').getByRole('button', { name: 'Turn on captions' }).click()

  await expect(ben.getByText('Let us review the launch plan')).toBeVisible()

  // Saved to the transcript (flushed every few seconds).
  const code = url.split('/').pop()!
  await expect
    .poll(
      () =>
        ben.evaluate(async (c) => {
          const me = await (await fetch('/api/me')).json()
          const org = me.orgs.find((o: { slug: string }) => o.slug === 'dev-acme')
          const r = await fetch(`/api/orgs/${org.id}/meetings/${c}/transcript`)
          return (await r.json()).map(
            (s: { speakerName: string; text: string }) => `${s.speakerName}: ${s.text}`,
          )
        }, code),
      { timeout: 15_000 },
    )
    .toContain('Ada Park: Let us review the launch plan')

  await ada.getByRole('button', { name: 'Leave options' }).click()
  await ada.getByRole('menuitem', { name: 'End meeting for everyone' }).click()
})

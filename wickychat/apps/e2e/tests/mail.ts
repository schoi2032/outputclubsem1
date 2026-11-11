/** Reads emails captured by Mailpit (local SMTP sink). */
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'

export async function waitForLink(
  to: string,
  pattern: RegExp,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
    const data = (await res.json()) as { messages: { ID: string }[] }
    for (const m of data.messages ?? []) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as {
        Text: string
      }
      const match = full.Text.match(pattern)
      if (match) return match[0]
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`No email to ${to} matching ${pattern}`)
}

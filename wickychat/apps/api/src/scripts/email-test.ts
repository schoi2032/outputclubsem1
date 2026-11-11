/**
 * Sends one real email with the current configuration, to check delivery.
 *   pnpm email:test you@example.com
 */
import pino from 'pino'
import { createEmailAdapter, describeEmailConfig, renderEmail } from '../adapters/email'
import { loadConfig } from '../core/config'

const to = process.argv[2]
if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
  console.error('Usage: pnpm email:test you@example.com')
  process.exit(1)
}

const config = loadConfig()
const log = pino({ level: 'warn' })
console.log(`Provider: ${describeEmailConfig(config)}`)
console.log(`From:     ${config.EMAIL_FROM}`)
console.log(`To:       ${to}`)

const email = createEmailAdapter(config, log)
try {
  await email.send({
    to,
    subject: 'WickyChat test email',
    ...renderEmail({
      heading: 'Email is working',
      body: 'If you can read this, WickyChat can deliver verification emails, invitations and password resets.',
      footer: 'Sent by pnpm email:test',
    }),
  })
  const local = config.EMAIL_PROVIDER === 'smtp' && /localhost|127\.0\.0\.1/.test(config.SMTP_URL)
  if (config.EMAIL_PROVIDER === 'console')
    console.log('\nThe console provider only logs emails; nothing was delivered.')
  else if (local)
    console.log(
      '\nSent to the local test inbox (Mailpit) at http://localhost:8025, not to a real mailbox.',
    )
  else console.log('\nSent. Check the inbox, and the spam folder the first time.')
  process.exit(0)
} catch (err) {
  console.error(`\nFailed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

import type { Logger } from 'pino'
import type { Config } from '../core/config'

export interface EmailAttachment {
  filename: string
  /** Plain-text content (e.g. an .ics calendar invite). */
  content: string
  contentType: string
}

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html: string
  attachments?: EmailAttachment[]
}

export interface EmailAdapter {
  send(msg: EmailMessage): Promise<void>
}

class SmtpEmail implements EmailAdapter {
  private transport: Promise<import('nodemailer').Transporter>
  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = import('nodemailer').then((m) => m.createTransport(url))
  }
  async send(msg: EmailMessage) {
    const { attachments, ...rest } = msg
    const ics = attachments?.find((a) => a.contentType.startsWith('text/calendar'))
    await (await this.transport).sendMail({
      from: this.from,
      ...rest,
      ...(attachments?.length && {
        attachments: attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      }),
      // Also sent as a calendar part, which mail apps turn into "Add to calendar" / RSVP buttons.
      ...(ics && {
        icalEvent: {
          content: ics.content,
          method: /METHOD:(\w+)/.exec(ics.content)?.[1] ?? 'REQUEST',
        },
      }),
    })
  }
}

class ResendEmail implements EmailAdapter {
  private client: Promise<import('resend').Resend>
  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = import('resend').then((m) => new m.Resend(apiKey))
  }
  async send(msg: EmailMessage) {
    const { attachments, ...rest } = msg
    const { error } = await (await this.client).emails.send({
      from: this.from,
      ...rest,
      ...(attachments?.length && {
        attachments: attachments.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content).toString('base64'),
          contentType: a.contentType,
        })),
      }),
    })
    if (error) throw new Error(`Resend: ${error.message}`)
  }
}

/** Splits `WickyChat <hello@example.com>` into name and address. */
export function parseFrom(from: string) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from)
  return m
    ? { name: m[1]!.trim() || undefined, email: m[2]!.trim() }
    : { name: undefined, email: from.trim() }
}

/**
 * Brevo transactional email API. Works without owning a domain: the sender
 * address only has to be verified in Brevo (Senders, domains & dedicated IPs).
 */
class BrevoEmail implements EmailAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}
  async send(msg: EmailMessage) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'api-key': this.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: parseFrom(this.from),
        to: [{ email: msg.to }],
        subject: msg.subject,
        htmlContent: msg.html,
        ...(msg.attachments?.length && {
          attachment: msg.attachments.map((a) => ({
            name: a.filename,
            content: Buffer.from(a.content).toString('base64'),
          })),
        }),
        textContent: msg.text,
      }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null
      throw new Error(`Brevo (${res.status}): ${body?.message ?? res.statusText}`)
    }
  }
}

/** Logs instead of sending. Useful in tests; never logs the body in production. */
export class MemoryEmail implements EmailAdapter {
  readonly sent: EmailMessage[] = []
  async send(msg: EmailMessage) {
    this.sent.push(msg)
  }
}

/** Human-readable summary without secrets, for logs and the test command. */
export function describeEmailConfig(config: Config) {
  if (config.EMAIL_PROVIDER === 'resend') return 'Resend API'
  if (config.EMAIL_PROVIDER === 'brevo') return 'Brevo API'
  if (config.EMAIL_PROVIDER === 'console') return 'console (emails are logged, not sent)'
  try {
    const u = new URL(config.SMTP_URL)
    const local = /^(localhost|127\.0\.0\.1)$/.test(u.hostname)
    return `SMTP ${u.hostname}:${u.port || (u.protocol === 'smtps:' ? 465 : 587)}${u.username ? ` as ${decodeURIComponent(u.username)}` : ''}${local ? ' (local test inbox, not delivered)' : ''}`
  } catch {
    return 'SMTP (invalid SMTP_URL)'
  }
}

/** Checks SMTP credentials at startup so misconfiguration shows up in the logs, not as silent failures. */
export async function verifyEmail(config: Config, log: Logger) {
  log.info(`Email: ${describeEmailConfig(config)}`)
  if (config.EMAIL_PROVIDER !== 'smtp') return
  try {
    const nodemailer = await import('nodemailer')
    await nodemailer.createTransport(config.SMTP_URL).verify()
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'SMTP check failed: emails will not be delivered',
    )
  }
}

/** Reserved domains (RFC 2606 / 6761) and seed data: never deliverable, so never sent through a real provider. */
export function isUndeliverable(address: string) {
  const domain = address.split('@').pop()?.toLowerCase() ?? ''
  return (
    /\.(test|example|invalid|localhost|local)$/.test(domain) ||
    /(^|\.)example\.(com|net|org)$/.test(domain)
  )
}

/** Skips undeliverable addresses (logged instead) so test data doesn't hurt the sender's reputation. */
function guarded(inner: EmailAdapter, log: Logger): EmailAdapter {
  return {
    async send(msg) {
      if (isUndeliverable(msg.to)) {
        log.info({ to: msg.to, subject: msg.subject }, 'email skipped: reserved test domain')
        return
      }
      await inner.send(msg)
    },
  }
}

export function createEmailAdapter(config: Config, log: Logger): EmailAdapter {
  switch (config.EMAIL_PROVIDER) {
    case 'brevo':
      return guarded(new BrevoEmail(config.BREVO_API_KEY!, config.EMAIL_FROM), log)
    case 'resend':
      return guarded(new ResendEmail(config.RESEND_API_KEY!, config.EMAIL_FROM), log)
    case 'console':
      return {
        async send(msg) {
          log.info({ to: msg.to, subject: msg.subject }, 'email (console provider, not sent)')
        },
      }
    default:
      return new SmtpEmail(config.SMTP_URL, config.EMAIL_FROM)
  }
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

/** Minimal, client-safe transactional email layout. */
export function renderEmail(opts: {
  heading: string
  body: string
  /** Optional list (e.g. notifications in a digest). */
  items?: { title: string; detail?: string; url?: string }[]
  cta?: { label: string; url: string }
  footer?: string
}) {
  const text = [
    opts.heading,
    '',
    opts.body,
    ...(opts.items ?? []).map(
      (i) => `\n• ${i.title}${i.detail ? `\n  ${i.detail}` : ''}${i.url ? `\n  ${i.url}` : ''}`,
    ),
    opts.cta ? `\n${opts.cta.label}: ${opts.cta.url}` : '',
    opts.footer ? `\n${opts.footer}` : '',
  ]
    .join('\n')
    .trim()
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f7;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#18181b">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e4e4e7;border-radius:12px">
<tr><td style="padding:32px">
<div style="font-weight:700;font-size:18px;letter-spacing:-0.02em;margin-bottom:24px">quid</div>
<h1 style="font-size:20px;margin:0 0 12px">${esc(opts.heading)}</h1>
<p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0 0 24px">${esc(opts.body)}</p>
${
  opts.items?.length
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-top:1px solid #e4e4e7">${opts.items
        .map(
          (i) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e4e4e7">
<div style="font-size:14px;font-weight:600">${i.url ? `<a href="${esc(i.url)}" style="color:#18181b;text-decoration:none">${esc(i.title)}</a>` : esc(i.title)}</div>
${i.detail ? `<div style="font-size:13px;color:#52525b;margin-top:2px">${esc(i.detail)}</div>` : ''}
</td></tr>`,
        )
        .join('')}</table>`
    : ''
}
${
  opts.cta
    ? `<a href="${esc(opts.cta.url)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">${esc(opts.cta.label)}</a>
<p style="font-size:12px;color:#71717a;margin:24px 0 0;word-break:break-all">${esc(opts.cta.url)}</p>`
    : ''
}
${opts.footer ? `<p style="font-size:12px;color:#71717a;margin:24px 0 0">${esc(opts.footer)}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`
  return { text, html }
}

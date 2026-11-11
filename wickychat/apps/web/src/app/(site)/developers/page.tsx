import { Badge } from '@quid/ui'
import { ArrowRight, BadgeCheck, Bell, Lock, ShieldCheck, Terminal, Zap } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock } from '@/components/docs/code-block'
import { CONTACT_EMAIL } from '@/components/site-chrome'

export const metadata: Metadata = {
  title: 'Build a plugin',
  description:
    'Add slash commands and automations to WickyChat. Plugins are small web services that talk to WickyChat over signed HTTPS.',
}

const TOC = [
  ['how-it-works', 'How plugins work'],
  ['quickstart', 'Quickstart'],
  ['submit', 'Submitting'],
  ['signing', 'Verifying requests'],
  ['endpoints', 'Requests from WickyChat'],
  ['commands', 'Slash commands'],
  ['posting', 'Posting messages'],
  ['events', 'Events'],
  ['formatting', 'Formatting'],
  ['review', 'Review and badges'],
  ['limits', 'Limits'],
  ['local', 'Testing locally'],
] as const

const QUICKSTART = `// server.mjs: a complete WickyChat plugin with one command, /hello.
// Run: QUID_SIGNING_SECRET=qps_... node server.mjs
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

const SECRET = process.env.QUID_SIGNING_SECRET ?? ''
const installs = new Map() // installId -> { token, apiBase } (use a database in production)

function signedByQuid(req, raw) {
  const ts = req.headers['x-quid-timestamp']
  const sig = req.headers['x-quid-signature'] ?? ''
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const want = Buffer.from('sha256=' + createHmac('sha256', SECRET).update(ts + '.' + raw).digest('hex'))
  const got = Buffer.from(sig)
  return want.length === got.length && timingSafeEqual(want, got)
}

createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw || '{}')
  const reply = (status, json) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(json ?? {}))
  }

  // WickyChat checks you own the server before you have a secret, so this one is unsigned.
  if (req.url === '/quid/verify') return reply(200, { challenge: body.challenge })
  if (!signedByQuid(req, raw)) return reply(401, { error: 'bad signature' })

  switch (req.url) {
    case '/quid/install':
      installs.set(body.installId, { token: body.token, apiBase: body.apiBase })
      return reply(200)
    case '/quid/uninstall':
      installs.delete(body.installId)
      return reply(200)
    case '/quid/command':
      if (body.command === 'hello')
        return reply(200, { visibility: 'channel', text: \`👋 Hi **\${body.user.name}**!\` })
      return reply(200, { visibility: 'ephemeral', text: 'Unknown command' })
    default:
      return reply(404, { error: 'not found' })
  }
}).listen(3000, () => console.log('Plugin listening on :3000'))`

const VERIFY_PY = `import hashlib, hmac, time

def signed_by_quid(headers, raw_body: bytes, secret: str) -> bool:
    ts = headers.get("x-quid-timestamp", "")
    sig = headers.get("x-quid-signature", "")
    if not ts or abs(time.time() - int(ts)) > 300:
        return False
    want = "sha256=" + hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, sig)`

const POST_MESSAGE = `curl -X POST "$API_BASE/messages" \\
  -H "Authorization: Bearer $INSTALL_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "channelId": "4f1c…", "text": "Deploy finished ✅", "threadId": null }'`

const COMMAND_BODY = `{
  "type": "command",
  "installId": "9b2e…",
  "command": "poll",
  "text": "Lunch? | Pizza | Sushi",
  "user": { "id": "…", "name": "Ada Park" },
  "channel": { "id": "…", "name": "general" },
  "threadId": null
}`

const EVENT_BODY = `{
  "type": "event",
  "event": "message.created",
  "installId": "9b2e…",
  "message": {
    "id": "…", "channelId": "…", "authorId": "…", "authorName": "Ben Ortiz",
    "text": "ship it", "threadId": null, "createdAt": "2026-10-07T09:12:00.000Z"
  }
}`

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 pt-4 text-xl font-semibold tracking-[-0.02em] text-fg">
      <a href={`#${id}`} className="hover:underline">
        {children}
      </a>
    </h2>
  )
}

function C({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-bg-muted px-1.5 py-0.5 font-mono text-[12.5px] text-fg">
      {children}
    </code>
  )
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-bg-subtle text-xs text-fg-subtle">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3.5 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className="px-3.5 py-2.5 align-top text-fg-muted">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function DevelopersPage() {
  return (
    <div>
      <section className="border-b border-border bg-bg-subtle">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <Badge tone="accent">Developers</Badge>
          <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
            Build a plugin for WickyChat
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-fg-muted">
            Add slash commands and automations that teams can install in one click. A plugin is a
            small web service you run; WickyChat talks to it over signed HTTPS. No SDK required: any
            language that can serve JSON works.
          </p>
          <div className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
            {[
              [Terminal, 'Slash commands', 'Reply privately or post to the channel.'],
              [Bell, 'Events', 'React to new messages in channels you’re added to.'],
              [
                ShieldCheck,
                'Safe by design',
                'Signed requests, scoped tokens, no code in WickyChat.',
              ],
            ].map(([Icon, title, body]) => {
              const I = Icon as typeof Terminal
              return (
                <div
                  key={title as string}
                  className="rounded-xl border border-border bg-bg p-4 shadow-[0_1px_2px_rgb(0_0_0/0.03)]"
                >
                  <I className="size-4 text-accent-text" />
                  <p className="mt-2 text-[13.5px] font-semibold">{title as string}</p>
                  <p className="mt-0.5 text-[13px] text-fg-muted">{body as string}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <div className="mx-auto flex max-w-6xl gap-12 px-4 py-12 sm:px-6">
        <nav
          aria-label="On this page"
          className="sticky top-20 hidden h-fit w-52 shrink-0 lg:block"
        >
          <p className="mb-2 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            On this page
          </p>
          <ul className="flex flex-col gap-0.5 border-l border-border text-[13px]">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="-ml-px block border-l border-transparent py-1 pl-3 text-fg-muted hover:border-fg-subtle hover:text-fg"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <article className="flex min-w-0 max-w-3xl flex-1 flex-col gap-5 text-[14.5px] leading-relaxed text-fg-muted [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-fg [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
          <H2 id="how-it-works">How plugins work</H2>
          <ol className="grid gap-3 sm:grid-cols-2">
            {[
              [
                'Submit',
                'Register your plugin in WickyChat with its URL and commands. You get a signing secret once.',
              ],
              [
                'Checks',
                'WickyChat runs automatic safety checks. Pass them and you’re listed as a community plugin.',
              ],
              [
                'Install',
                'A workspace admin installs it into specific channels. You receive an install token.',
              ],
              [
                'Run',
                'People type your commands; WickyChat calls your server, and you reply or post messages.',
              ],
            ].map(([t, b], i) => (
              <li
                key={t}
                className="!ml-0 flex !list-none gap-3 rounded-xl border border-border p-4"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-xs font-semibold text-accent-text">
                  {i + 1}
                </span>
                <span>
                  <strong className="block text-[13.5px]">{t}</strong>
                  <span className="text-[13px]">{b}</span>
                </span>
              </li>
            ))}
          </ol>
          <p>
            <strong>No plugin code runs inside WickyChat or in people’s browsers.</strong> Your
            plugin only ever sees the channels an admin added it to, and admins can remove it at any
            time.
          </p>

          <H2 id="quickstart">Quickstart</H2>
          <p>
            This is a complete plugin in one file with no dependencies (Node 18+). It answers{' '}
            <C>/hello</C> in any channel it’s added to.
          </p>
          <CodeBlock label="server.mjs" code={QUICKSTART} />
          <ul>
            <li>
              Put it on a public <strong>HTTPS</strong> address (Cloud Run, Fly, Render, a VPS…).
            </li>
            <li>
              In WickyChat, open <strong>Plugins → Submit a plugin</strong>, enter that address as
              the base URL and add a <C>hello</C> command.
            </li>
            <li>
              Copy the signing secret you’re shown into <C>QUID_SIGNING_SECRET</C> and restart.
            </li>
            <li>
              Install it into a channel and type <C>/hello</C>.
            </li>
          </ul>

          <H2 id="submit">Submitting</H2>
          <p>A submission has:</p>
          <Table
            head={['Field', 'Rules']}
            rows={[
              ['Name', '2–40 characters. Can’t use “WickyChat” or “official”.'],
              ['Tagline', '4–90 characters, plain text, no links.'],
              ['Description', 'Up to 2,000 characters.'],
              [
                'Developer name and email',
                'The name is shown on the listing; the email is only used to contact you.',
              ],
              ['Base URL', 'Public HTTPS. WickyChat calls {baseUrl}/quid/….'],
              ['Icon URL', 'Optional PNG, JPEG, WebP or GIF under 512 KB. Copied into WickyChat.'],
              ['Commands', 'Up to 10. Names are 2–32 lowercase letters, numbers or dashes.'],
              ['Events', <C key="e">message.created</C>],
              ['Private', 'Workspaces can keep a plugin to themselves.'],
            ]}
          />
          <p>Automatic safety checks run right away:</p>
          <ul>
            <li>The base URL is HTTPS on a public address (private networks are refused).</li>
            <li>Your server echoes a one-time challenge, proving you control it.</li>
            <li>The icon is a real image under 512 KB (SVG is refused).</li>
            <li>
              The listing doesn’t claim to be official or verified and contains no links or HTML.
            </li>
            <li>None of your URLs are on Google Safe Browsing’s list of dangerous sites.</li>
          </ul>

          <H2 id="signing">Verifying requests</H2>
          <p>
            Every request from WickyChat (except <C>/quid/verify</C>) carries two headers:
          </p>
          <CodeBlock
            label="headers"
            code={`x-quid-timestamp: 1791234567
x-quid-signature: sha256=<hex HMAC-SHA256(signing secret, timestamp + "." + raw body)>`}
          />
          <p>
            Compute the HMAC over the <strong>exact raw body bytes</strong>, compare in constant
            time, and reject timestamps more than 5 minutes old. The Node version is in the
            quickstart; here it is in Python:
          </p>
          <CodeBlock label="verify.py" code={VERIFY_PY} />

          <H2 id="endpoints">Requests from WickyChat</H2>
          <p>
            WickyChat sends <C>POST</C> requests with a JSON body to these paths under your base
            URL:
          </p>
          <Table
            head={['Path', 'When', 'Reply']}
            rows={[
              [
                <C key="1">/quid/verify</C>,
                'During the safety checks',
                <span key="r">{'{ "challenge": "<same value>" }'}</span>,
              ],
              [
                <C key="2">/quid/install</C>,
                'Added to a workspace. Body has installId, workspace, channels, token, apiBase',
                'Any 2xx. Store the token',
              ],
              [
                <C key="3">/quid/uninstall</C>,
                'Removed from a workspace',
                'Any 2xx. Forget the token',
              ],
              [
                <C key="4">/quid/command</C>,
                'Someone ran one of your commands',
                'Within 5 s, see below',
              ],
              [
                <C key="5">/quid/events</C>,
                'A subscribed event happened',
                'Any 2xx (retried with backoff)',
              ],
            ]}
          />

          <H2 id="commands">Slash commands</H2>
          <p>
            When someone types <C>/poll Lunch? | Pizza | Sushi</C>, you receive:
          </p>
          <CodeBlock label="POST /quid/command" code={COMMAND_BODY} />
          <p>Reply within 5 seconds with:</p>
          <CodeBlock
            label="response"
            code={`{ "visibility": "channel", "text": "📊 **Lunch?**\\n- Pizza\\n- Sushi" }`}
          />
          <ul>
            <li>
              <C>ephemeral</C> shows the text only to the person who ran the command (good for
              errors and help).
            </li>
            <li>
              <C>channel</C> posts it as your plugin for everyone to see.
            </li>
            <li>
              Need longer? Reply <C>ephemeral</C> right away (“Working on it…”) and post the result
              later with the API.
            </li>
          </ul>

          <H2 id="posting">Posting messages</H2>
          <p>
            Use the install token and <C>apiBase</C> you received at install time. Plugins can post
            only in channels the admin added them to.
          </p>
          <CodeBlock label="POST {apiBase}/messages" code={POST_MESSAGE} />
          <p>
            Text is up to 4,000 characters. Pass a <C>threadId</C> to reply in a thread.
          </p>

          <H2 id="events">Events</H2>
          <p>
            Subscribe to <C>message.created</C> to see new messages in your channels (the listing
            tells admins you can read them). Deliveries are retried with backoff if you don’t answer
            2xx, so make handlers idempotent using <C>message.id</C>.
          </p>
          <CodeBlock label="POST /quid/events" code={EVENT_BODY} />

          <H2 id="formatting">Formatting</H2>
          <p>Plugin messages support a small, safe subset of Markdown:</p>
          <Table
            head={['Write', 'Shows as']}
            rows={[
              [<C key="b">**bold**</C>, <strong key="bb">bold</strong>],
              [<C key="c">`code`</C>, <C key="cc">code</C>],
              [<C key="l">- item</C>, '• item (a bullet list)'],
              ['Emoji', 'As is 🎉'],
            ]}
          />

          <H2 id="review">Review and badges</H2>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              [
                Zap,
                'Community',
                'Passed the automatic checks. Workspaces can install after a warning.',
              ],
              [
                BadgeCheck,
                'Verified',
                'Reviewed by the WickyChat team. Any workspace can install it.',
              ],
              [Lock, 'Private', 'Only the workspace that submitted it can see and install it.'],
            ].map(([Icon, t, b]) => {
              const I = Icon as typeof Zap
              return (
                <div key={t as string} className="rounded-xl border border-border p-4">
                  <I className="size-4 text-accent-text" />
                  <p className="mt-2 text-[13.5px] font-semibold text-fg">{t as string}</p>
                  <p className="mt-0.5 text-[13px]">{b as string}</p>
                </div>
              )
            })}
          </div>
          <p>
            The <strong>Official</strong> badge is reserved for WickyChat’s own plugins. The team
            can suspend a plugin that misbehaves, which stops it everywhere at once.
          </p>

          <H2 id="limits">Limits</H2>
          <Table
            head={['What', 'Limit']}
            rows={[
              ['Command reply', '5 seconds'],
              ['Posting messages', '60 per minute per install'],
              ['Message length', '4,000 characters'],
              ['Commands per plugin', '10'],
              ['Signature window', '5 minutes'],
            ]}
          />

          <H2 id="local">Testing locally</H2>
          <p>
            WickyChat only calls public HTTPS addresses. While developing, expose your local server
            with a tunnel such as <C>cloudflared tunnel --url http://localhost:3000</C> or{' '}
            <C>ngrok http 3000</C>, and submit the tunnel’s URL as a private plugin in your own
            workspace. Update the base URL when you deploy for real.
          </p>

          <div className="mt-6 flex flex-col items-start gap-4 rounded-2xl border border-border bg-bg-subtle p-6 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="text-[15px] font-semibold text-fg">Ready to build?</p>
              <p className="text-[13.5px]">
                Submit from Plugins in your workspace. Questions?{' '}
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent-text underline">
                  Email us
                </a>
                .
              </p>
            </div>
            <Link
              href="/login?next=/"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[13.5px] font-medium text-white hover:opacity-90"
            >
              Open WickyChat <ArrowRight className="size-4" />
            </Link>
          </div>
        </article>
      </div>
    </div>
  )
}

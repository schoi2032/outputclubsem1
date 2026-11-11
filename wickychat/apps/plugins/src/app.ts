/**
 * WickyChat's official plugins, one service. Each plugin lives at /{slug}/quid/* and checks
 * WickyChat's signature with its own secret (derived from OFFICIAL_PLUGINS_KEY).
 */
import { readFile } from 'node:fs/promises'
import { OFFICIAL_PLUGINS } from '@quid/shared'
import Fastify from 'fastify'
import { dice, worldClock } from './handlers/fun'
import { polls } from './handlers/polls'
import { reminders } from './handlers/reminders'
import { standup } from './handlers/standup'
import { translate } from './handlers/translate'
import type { CommandInput, Deps, PluginImpl, Translator } from './handlers/types'
import { hmac, type Install, type Poster, pluginSecret, postMessage, validSignature } from './quid'
import { type Sql, tokenBox } from './store'

export const IMPLS: Record<string, PluginImpl> = {
  'quid-polls': polls,
  'quid-reminders': reminders,
  'quid-standup': standup,
  'quid-translate': translate,
  'quid-world-clock': worldClock,
  'quid-dice': dice,
}

export interface AppOptions {
  key: string
  sql: Sql
  post?: Poster
  translate?: Translator | null
  now?: () => Date
  iconsDir?: string
  logger?: boolean
}

/** The token Cloud Scheduler sends to /cron. */
export const cronToken = (key: string) => hmac(key, 'cron')

export function buildApp(opts: AppOptions) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 256 * 1024 })
  const box = tokenBox(opts.key)
  const deps: Deps = {
    sql: opts.sql,
    post: opts.post ?? postMessage,
    translate: opts.translate ?? null,
    now: opts.now ?? (() => new Date()),
    async install(installId) {
      const [r] = await opts.sql<
        { install_id: string; plugin: string; token: string; api_base: string }[]
      >`select install_id, plugin, token, api_base from official_plugins.installs where install_id = ${installId}`
      return r
        ? {
            installId: r.install_id,
            plugin: r.plugin,
            token: box.open(r.token),
            apiBase: r.api_base,
          }
        : null
    },
  }

  // Keep the raw body: signatures cover the exact bytes WickyChat sent.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, { raw: body as string, json: JSON.parse(body as string) })
    } catch (e) {
      done(e as Error, undefined)
    }
  })

  app.get('/healthz', async () => ({ ok: true }))

  app.get<{ Params: { file: string } }>('/icons/:file', async (req, reply) => {
    const m = /^([a-z0-9-]+)\.png$/.exec(req.params.file)
    if (!m || !IMPLS[m[1]!] || !opts.iconsDir) return reply.code(404).send()
    const buf = await readFile(`${opts.iconsDir}/${m[1]}.png`).catch(() => null)
    if (!buf) return reply.code(404).send()
    return reply
      .header('content-type', 'image/png')
      .header('cache-control', 'public, max-age=86400')
      .send(buf)
  })

  app.post<{ Params: { slug: string; action: string } }>(
    '/:slug/quid/:action',
    async (req, reply) => {
      const { slug, action } = req.params
      const impl = IMPLS[slug]
      const body = req.body as { raw: string; json: Record<string, unknown> } | undefined
      if (!impl || !body) return reply.code(404).send({ error: 'not found' })
      const json = body.json

      // verify runs before a developer would have the secret, so it's answered unsigned.
      if (action === 'verify') return { challenge: json.challenge }

      const ok = validSignature(
        pluginSecret(opts.key, slug),
        req.headers['x-quid-timestamp'] as string | undefined,
        req.headers['x-quid-signature'] as string | undefined,
        body.raw,
        deps.now().getTime(),
      )
      if (!ok) return reply.code(401).send({ error: 'bad signature' })

      if (action === 'install') {
        const token = String(json.token ?? '')
        const apiBase = String(json.apiBase ?? '')
        const installId = String(json.installId ?? '')
        const workspace = (json.workspace as { id?: string } | undefined)?.id ?? ''
        if (!token || !apiBase || !installId) return reply.code(400).send({ error: 'bad install' })
        await opts.sql`
          insert into official_plugins.installs (install_id, plugin, workspace_id, token, api_base)
          values (${installId}, ${slug}, ${workspace}, ${box.seal(token)}, ${apiBase})
          on conflict (install_id) do update
            set token = excluded.token, api_base = excluded.api_base, plugin = excluded.plugin`
        return { ok: true }
      }
      if (action === 'uninstall') {
        await opts.sql`delete from official_plugins.installs where install_id = ${String(json.installId ?? '')}`
        return { ok: true }
      }
      if (action === 'events') return { ok: true }
      if (action !== 'command') return reply.code(404).send({ error: 'not found' })

      const input = json as unknown as CommandInput
      const install = await deps.install(String(input.installId))
      if (!install || install.plugin !== slug)
        return {
          text: 'This plugin needs to be reinstalled. Ask an admin to remove and add it again.',
        }
      return impl.command(deps, {
        ...input,
        text: String(input.text ?? ''),
        user: { id: String(input.user?.id ?? ''), name: String(input.user?.name ?? 'Someone') },
      })
    },
  )

  app.post('/cron', async (req, reply) => {
    if (req.headers['x-cron-token'] !== cronToken(opts.key)) return reply.code(401).send()
    await runCron(deps)
    return { ok: true }
  })

  return { app, deps }
}

export async function runCron(deps: Deps) {
  for (const impl of Object.values(IMPLS)) await impl.cron?.(deps)
}

// Every listed official plugin must have an implementation (and the other way round).
for (const p of OFFICIAL_PLUGINS)
  if (!IMPLS[p.slug]) throw new Error(`No implementation for official plugin ${p.slug}`)

export type { Install }

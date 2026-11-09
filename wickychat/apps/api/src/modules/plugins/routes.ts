/**
 * Plugins: a directory of verified and community plugins, private plugins for
 * Enterprise+ workspaces, installs, slash commands, and the plugin API.
 *
 * Plugins run on their developers' servers. WickyChat only sends them signed HTTPS
 * requests (commands, events) and accepts messages back from them as a bot,
 * in the channels a workspace admin added them to.
 */
import {
  channelMembers,
  channels,
  integrationCredentials,
  integrations,
  orgMemberships,
  plugins,
  users,
} from '@quid/db'
import { simpleMarkdownToDoc } from '@quid/shared'
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '../../core/audit'
import { authorize, requireOrg, requireUser } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { randomToken, sha256 } from '../../core/crypto'
import { AppError, badRequest, forbidden, notFound, unauthorized } from '../../core/errors'
import { type App, orgParams } from '../../core/http'
import { isPlatformAdmin } from '../../core/platform'
import { publishChannelJoined } from '../channels/events'
import { requireChannel } from '../channels/service'
import { createBot } from '../integrations/routes'
import { createMessage } from '../messages/service'
import { imageType, runChecks } from './checks'
import { callPlugin, type PluginRow, pluginActive } from './client'
import { scheduleOfficialPluginSync } from './official'

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

const commandName = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{1,31}$/,
    'Commands are 2–32 lowercase letters, numbers or dashes, starting with a letter',
  )

const submitSchema = z.object({
  name: z.string().trim().min(2).max(40),
  tagline: z.string().trim().min(4).max(90),
  description: z.string().trim().max(2000).default(''),
  developerName: z.string().trim().min(2).max(80),
  developerEmail: z.email(),
  homepageUrl: z.url().max(500).nullable().optional(),
  iconUrl: z.url().max(500).nullable().optional(),
  baseUrl: z.url().max(500),
  commands: z
    .array(
      z.object({
        name: commandName,
        description: z.string().trim().min(2).max(120),
        usage: z.string().trim().max(80).optional(),
      }),
    )
    .max(10),
  events: z.array(z.literal('message.created')).max(1).default([]),
  private: z.boolean().default(false),
})

function serialize(
  p: PluginRow,
  extra: { install?: { id: string; channelIds: string[] } | null; withChecks?: boolean } = {},
) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    tagline: p.tagline,
    description: p.description,
    developerName: p.developerName,
    homepageUrl: p.homepageUrl,
    iconUrl: p.iconKey ? `/api/plugins/${p.id}/icon` : null,
    status: p.status,
    official: p.official,
    private: !!p.privateOrgId,
    commands: p.manifest.commands,
    events: p.manifest.events,
    install: extra.install ?? null,
    ...(extra.withChecks && { checks: p.checks, reviewNote: p.reviewNote }),
    createdAt: p.createdAt.toISOString(),
  }
}

/** Plugin installs in a workspace, with the channels their bot is in. */
async function installsFor(ctx: AppContext, orgId: string) {
  const rows = await ctx.db
    .select()
    .from(integrations)
    .where(and(eq(integrations.orgId, orgId), eq(integrations.kind, 'plugin')))
  const botIds = rows.map((r) => r.botUserId).filter((x): x is string => !!x)
  const memberships = botIds.length
    ? await ctx.db
        .select({ userId: channelMembers.userId, channelId: channelMembers.channelId })
        .from(channelMembers)
        .where(inArray(channelMembers.userId, botIds))
    : []
  return rows.map((r) => ({
    row: r,
    pluginId: String((r.config as { pluginId?: string }).pluginId ?? ''),
    channelIds: memberships.filter((m) => m.userId === r.botUserId).map((m) => m.channelId),
  }))
}

async function postAsBot(
  ctx: AppContext,
  orgId: string,
  botId: string,
  channelId: string,
  text: string,
  threadId?: string | null,
) {
  const channel = await ctx.db.query.channels.findFirst({ where: eq(channels.id, channelId) })
  if (!channel) throw notFound('Channel')
  return createMessage(ctx, { orgId, userId: botId }, channel, {
    body: simpleMarkdownToDoc(text.slice(0, 4000)),
    kind: 'bot',
    parentId: threadId ?? null,
  })
}

export async function pluginRoutes(app: App, ctx: AppContext) {
  const base = '/api/orgs/:orgId/plugins'
  const params = z.object({ orgId: z.uuid(), id: z.uuid() })
  if (ctx.config.NODE_ENV !== 'test') scheduleOfficialPluginSync(ctx)

  // -------------------------------------------------------------------------
  // Directory
  // -------------------------------------------------------------------------

  app.get(base, { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    authorize(scope, 'integrations.manage')
    const rows = await ctx.db
      .select()
      .from(plugins)
      .where(
        or(
          // The public directory: verified and community plugins.
          and(isNull(plugins.privateOrgId), inArray(plugins.status, ['verified', 'unverified'])),
          // This workspace's private plugins, in any state, so admins can follow their checks.
          eq(plugins.privateOrgId, scope.orgId),
          // Public plugins submitted from here that aren't live (yet).
          sql`${plugins.submittedBy} in (select user_id from org_memberships where org_id = ${scope.orgId})`,
        ),
      )
      .orderBy(desc(plugins.createdAt))
    const installs = await installsFor(ctx, scope.orgId)
    return {
      enterprise: true,
      plugins: rows.map((p) => {
        const i = installs.find((x) => x.pluginId === p.id)
        return serialize(p, {
          install: i ? { id: i.row.id, channelIds: i.channelIds } : null,
          withChecks: !!p.privateOrgId || !pluginActive(p),
        })
      }),
    }
  })

  /** Public icons, copied into WickyChat during the safety checks. */
  app.get(
    '/api/plugins/:id/icon',
    { schema: { params: z.object({ id: z.uuid() }) } },
    async (req, reply) => {
      const p = await ctx.db.query.plugins.findFirst({
        where: eq(plugins.id, req.params.id),
        columns: { iconKey: true },
      })
      if (!p?.iconKey) throw notFound('Icon')
      const { stream } = await ctx.storage.get(p.iconKey)
      const chunks: Buffer[] = []
      for await (const c of stream) chunks.push(Buffer.from(c))
      const buf = Buffer.concat(chunks)
      return reply
        .header('content-type', imageType(buf) ?? 'application/octet-stream')
        .header('cache-control', 'public, max-age=3600')
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'")
        .send(buf)
    },
  )

  // -------------------------------------------------------------------------
  // Submitting (developers)
  // -------------------------------------------------------------------------

  app.post(
    base,
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: { params: orgParams, body: submitSchema },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'integrations.manage')
      const b = req.body
      const names = b.commands.map((c) => c.name)
      if (new Set(names).size !== names.length)
        throw badRequest('Each command needs a different name.')

      const secret = `qps_${randomToken(24)}`
      const enc = ctx.secrets.encrypt(secret)
      let s = slug(b.name) || 'plugin'
      if (
        await ctx.db.query.plugins.findFirst({ where: eq(plugins.slug, s), columns: { id: true } })
      )
        s = `${s}-${randomToken(3)}`
      const [row] = await ctx.db
        .insert(plugins)
        .values({
          slug: s,
          name: b.name,
          tagline: b.tagline,
          description: b.description,
          developerName: b.developerName,
          developerEmail: b.developerEmail,
          homepageUrl: b.homepageUrl ?? null,
          manifest: { baseUrl: b.baseUrl, commands: b.commands, events: b.events },
          privateOrgId: b.private ? scope.orgId : null,
          submittedBy: scope.userId,
          secretCiphertext: enc.ciphertext,
          secretIv: enc.iv,
          secretTag: enc.tag,
        })
        .returning()
      await runChecks(ctx, row!, b.iconUrl ?? null)
      const fresh = (await ctx.db.query.plugins.findFirst({ where: eq(plugins.id, row!.id) }))!
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'plugin.submitted',
        targetType: 'plugin',
        targetId: fresh.id,
        metadata: { name: fresh.name, status: fresh.status, private: b.private },
        ip: req.ip,
      })
      // The signing secret is shown once: the developer uses it to verify WickyChat's requests.
      return reply
        .code(201)
        .send({ plugin: serialize(fresh, { withChecks: true }), signingSecret: secret })
    },
  )

  /** Runs the safety checks again (e.g. after fixing the server). */
  app.post(
    `${base}/:id/recheck`,
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } }, schema: { params } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'integrations.manage')
      const p = await ctx.db.query.plugins.findFirst({ where: eq(plugins.id, req.params.id) })
      if (!p) throw notFound('Plugin')
      const fromHere = p.privateOrgId === scope.orgId || (await submittedFrom(ctx, p, scope.orgId))
      if (!fromHere) throw notFound('Plugin')
      if (p.status === 'rejected' || p.status === 'suspended')
        throw forbidden('This plugin was removed by the WickyChat team.')
      const iconUrl = (req.body as { iconUrl?: string } | undefined)?.iconUrl ?? null
      await runChecks(ctx, p, iconUrl)
      const fresh = (await ctx.db.query.plugins.findFirst({ where: eq(plugins.id, p.id) }))!
      return serialize(fresh, { withChecks: true })
    },
  )

  // -------------------------------------------------------------------------
  // Installing
  // -------------------------------------------------------------------------

  app.post(
    `${base}/:id/install`,
    {
      schema: {
        params,
        body: z.object({
          channelIds: z.array(z.uuid()).min(1).max(50),
          acceptUnverified: z.boolean().default(false),
        }),
      },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'integrations.manage')
      const p = await ctx.db.query.plugins.findFirst({ where: eq(plugins.id, req.params.id) })
      if (!p || (p.privateOrgId && p.privateOrgId !== scope.orgId)) throw notFound('Plugin')
      if (!pluginActive(p)) throw badRequest("This plugin can't be installed right now.")
      if (!p.privateOrgId && p.status === 'unverified') {
        if (!req.body.acceptUnverified)
          throw badRequest(
            'Confirm that you understand this plugin has not been reviewed by WickyChat.',
          )
      }
      const existing = (await installsFor(ctx, scope.orgId)).find((i) => i.pluginId === p.id)
      if (existing) throw badRequest('This plugin is already installed.')

      const chans = []
      for (const id of new Set(req.body.channelIds)) {
        const { channel } = await requireChannel(ctx, scope, id, 'read')
        if (channel.kind === 'dm' || channel.kind === 'group')
          throw badRequest('Plugins can only be added to channels.')
        if (channel.archivedAt) throw badRequest(`#${channel.name} is archived.`)
        chans.push(channel)
      }

      const botId = await createBot(ctx, scope.orgId, p.name)
      const token = `quid_plg_${randomToken()}`
      const [row] = await ctx.db
        .insert(integrations)
        .values({
          orgId: scope.orgId,
          kind: 'plugin',
          name: p.name,
          botUserId: botId,
          tokenHash: sha256(token),
          config: {
            pluginId: p.id,
            url: `${p.manifest.baseUrl.replace(/\/$/, '')}/quid/events`,
            events: p.manifest.events,
          },
          createdBy: scope.userId,
        })
        .returning()
      // Event deliveries are signed with the plugin's secret, like every other call.
      await ctx.db.insert(integrationCredentials).values({
        orgId: scope.orgId,
        integrationId: row!.id,
        name: 'plugin_signing_secret',
        ...ctx.secrets.encrypt(
          ctx.secrets.decrypt({ ciphertext: p.secretCiphertext, iv: p.secretIv, tag: p.secretTag }),
        ),
        createdBy: scope.userId,
      })
      for (const c of chans) {
        await ctx.db
          .insert(channelMembers)
          .values({ channelId: c.id, userId: botId, orgId: scope.orgId })
          .onConflictDoNothing()
      }

      // Tell the plugin, and hand it the token it uses to post.
      try {
        await callPlugin(ctx, p, 'install', {
          type: 'installed',
          installId: row!.id,
          workspace: { id: scope.orgId },
          channels: chans.map((c) => ({ id: c.id, name: c.name })),
          token,
          apiBase: `${ctx.config.WEB_ORIGIN}/api/plugin-api/v1`,
        })
      } catch (e) {
        await removeInstall(ctx, scope.orgId, row!.id, botId)
        throw new AppError(
          502,
          'plugin_unreachable',
          `${p.name} didn't respond: ${(e as Error).message}`,
        )
      }
      for (const c of chans) await publishChannelJoined(ctx, scope.orgId, c.id, botId)
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'plugin.installed',
        targetType: 'plugin',
        targetId: p.id,
        metadata: { name: p.name, status: p.status, channels: chans.map((c) => c.name) },
        ip: req.ip,
      })
      return reply.code(201).send({ installId: row!.id })
    },
  )

  app.delete(`${base}/:id/install`, { schema: { params } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    authorize(scope, 'integrations.manage')
    const install = (await installsFor(ctx, scope.orgId)).find((i) => i.pluginId === req.params.id)
    if (!install) throw notFound('Install')
    const p = await ctx.db.query.plugins.findFirst({ where: eq(plugins.id, req.params.id) })
    if (p)
      await callPlugin(ctx, p, 'uninstall', {
        type: 'uninstalled',
        installId: install.row.id,
      }).catch(() => {})
    await removeInstall(ctx, scope.orgId, install.row.id, install.row.botUserId)
    await audit(ctx.db, {
      orgId: scope.orgId,
      actorId: scope.userId,
      action: 'plugin.uninstalled',
      targetType: 'plugin',
      targetId: req.params.id,
      metadata: { name: install.row.name },
      ip: req.ip,
    })
    return { ok: true }
  })

  // -------------------------------------------------------------------------
  // Slash commands
  // -------------------------------------------------------------------------

  /** Commands available in this workspace, for the composer. */
  app.get('/api/orgs/:orgId/plugin-commands', { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const installs = (await installsFor(ctx, scope.orgId)).filter((i) => i.row.enabled)
    if (!installs.length) return []
    const rows = await ctx.db
      .select()
      .from(plugins)
      .where(
        inArray(
          plugins.id,
          installs.map((i) => i.pluginId),
        ),
      )
    return rows.filter(pluginActive).flatMap((p) => {
      const i = installs.find((x) => x.pluginId === p.id)!
      return p.manifest.commands.map((c) => ({
        command: c.name,
        description: c.description,
        usage: c.usage ?? null,
        plugin: {
          id: p.id,
          name: p.name,
          iconUrl: p.iconKey ? `/api/plugins/${p.id}/icon` : null,
          verified: p.status === 'verified',
        },
        channelIds: i.channelIds,
      }))
    })
  })

  app.post(
    '/api/orgs/:orgId/channels/:channelId/commands',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ orgId: z.uuid(), channelId: z.uuid() }),
        body: z.object({
          command: commandName,
          text: z.string().max(2000).default(''),
          threadId: z.uuid().nullable().optional(),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { channel } = await requireChannel(ctx, scope, req.params.channelId, 'post')
      const installs = (await installsFor(ctx, scope.orgId)).filter((i) => i.row.enabled)
      const rows = installs.length
        ? await ctx.db
            .select()
            .from(plugins)
            .where(
              inArray(
                plugins.id,
                installs.map((i) => i.pluginId),
              ),
            )
        : []
      const p = rows.find(
        (x) => pluginActive(x) && x.manifest.commands.some((c) => c.name === req.body.command),
      )
      if (!p) throw notFound(`Command /${req.body.command}`)
      const install = installs.find((i) => i.pluginId === p.id)!
      if (!install.channelIds.includes(channel.id))
        throw badRequest(`Add ${p.name} to this channel to use /${req.body.command} here.`)
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, scope.userId),
        columns: { id: true, name: true, displayName: true },
      })

      let res: { text?: string; visibility?: 'channel' | 'ephemeral' } | null
      try {
        res = await callPlugin(ctx, p, 'command', {
          type: 'command',
          installId: install.row.id,
          command: req.body.command,
          text: req.body.text,
          user: { id: user?.id, name: user?.displayName || user?.name },
          channel: { id: channel.id, name: channel.name },
          threadId: req.body.threadId ?? null,
        })
      } catch (e) {
        throw new AppError(
          502,
          'plugin_unreachable',
          `${p.name} didn't respond: ${(e as Error).message}`,
        )
      }
      const text = typeof res?.text === 'string' ? res.text.trim().slice(0, 4000) : ''
      if (!text) return { visibility: 'ephemeral' as const, text: null, plugin: p.name }
      if (res?.visibility === 'channel') {
        const m = await postAsBot(
          ctx,
          scope.orgId,
          install.row.botUserId!,
          channel.id,
          text,
          req.body.threadId,
        )
        return { visibility: 'channel' as const, text, messageId: m.id, plugin: p.name }
      }
      // Only the person who ran the command sees this reply.
      return { visibility: 'ephemeral' as const, text, plugin: p.name }
    },
  )

  // -------------------------------------------------------------------------
  // Plugin API (called by plugin servers with their install token)
  // -------------------------------------------------------------------------

  app.post(
    '/api/plugin-api/v1/messages',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        body: z.object({
          channelId: z.uuid(),
          text: z.string().trim().min(1).max(4000),
          threadId: z.uuid().nullable().optional(),
        }),
      },
    },
    async (req, reply) => {
      const m = /^Bearer\s+(quid_plg_\S{10,200})$/i.exec(req.headers.authorization ?? '')
      if (!m) throw unauthorized('Missing plugin token')
      const install = await ctx.db.query.integrations.findFirst({
        where: and(
          eq(integrations.tokenHash, sha256(m[1]!)),
          eq(integrations.kind, 'plugin'),
          eq(integrations.enabled, true),
        ),
      })
      if (!install?.botUserId) throw unauthorized('Invalid plugin token')
      const p = await ctx.db.query.plugins.findFirst({
        where: eq(plugins.id, String((install.config as { pluginId?: string }).pluginId)),
      })
      if (!p || !pluginActive(p)) throw forbidden('This plugin is not available.')
      const member = await ctx.db.query.channelMembers.findFirst({
        where: and(
          eq(channelMembers.channelId, req.body.channelId),
          eq(channelMembers.userId, install.botUserId),
        ),
      })
      if (!member) throw forbidden('The plugin was not added to that channel.')
      const msg = await postAsBot(
        ctx,
        install.orgId,
        install.botUserId,
        req.body.channelId,
        req.body.text,
        req.body.threadId,
      )
      return reply.code(201).send({ id: msg.id })
    },
  )

  // -------------------------------------------------------------------------
  // Review (WickyChat staff)
  // -------------------------------------------------------------------------

  const requirePlatformAdmin = (req: Parameters<typeof requireUser>[0]) => {
    const u = requireUser(req)
    if (!isPlatformAdmin(ctx, u.email)) throw notFound('Page')
    return u
  }

  app.get(
    '/api/platform/plugins',
    {
      schema: {
        querystring: z.object({
          status: z.enum(['pending', 'unverified', 'verified', 'suspended', 'rejected']).optional(),
        }),
      },
    },
    async (req) => {
      requirePlatformAdmin(req)
      const rows = await ctx.db
        .select({
          p: plugins,
          submitter: users.email,
          installs: sql<number>`(select count(*)::int from integrations i where i.kind = 'plugin' and i.config->>'pluginId' = ${plugins.id}::text)`,
        })
        .from(plugins)
        .leftJoin(users, eq(users.id, plugins.submittedBy))
        .where(
          and(
            isNull(plugins.privateOrgId),
            req.query.status ? eq(plugins.status, req.query.status) : undefined,
          ),
        )
        .orderBy(desc(plugins.updatedAt))
        .limit(200)
      return rows.map((r) => ({
        ...serialize(r.p, { withChecks: true }),
        developerEmail: r.p.developerEmail,
        baseUrl: r.p.manifest.baseUrl,
        submittedBy: r.submitter,
        installs: r.installs,
      }))
    },
  )

  app.post(
    '/api/platform/plugins/:id/review',
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: z.object({
          status: z.enum(['verified', 'unverified', 'suspended', 'rejected']),
          note: z.string().trim().max(1000).optional(),
        }),
      },
    },
    async (req) => {
      const u = requirePlatformAdmin(req)
      const p = await ctx.db.query.plugins.findFirst({ where: eq(plugins.id, req.params.id) })
      if (!p || p.privateOrgId) throw notFound('Plugin')
      // Only plugins that pass every automatic check can be listed.
      if (
        (req.body.status === 'verified' || req.body.status === 'unverified') &&
        p.checks.some((c) => c.status === 'failed')
      )
        throw badRequest(
          'This plugin is failing safety checks. Ask the developer to fix them first.',
        )
      await ctx.db
        .update(plugins)
        .set({
          status: req.body.status,
          reviewNote: req.body.note ?? null,
          reviewedBy: u.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(plugins.id, p.id))
      ctx.log.info({ plugin: p.id, status: req.body.status, by: u.id }, 'plugin reviewed')
      return { ok: true }
    },
  )
}

async function submittedFrom(ctx: AppContext, p: PluginRow, orgId: string) {
  if (!p.submittedBy) return false
  return !!(await ctx.db.query.orgMemberships.findFirst({
    where: and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, p.submittedBy)),
    columns: { id: true },
  }))
}

async function removeInstall(
  ctx: AppContext,
  orgId: string,
  integrationId: string,
  botId: string | null,
) {
  await ctx.db.delete(integrations).where(eq(integrations.id, integrationId))
  if (botId) {
    await ctx.db.delete(channelMembers).where(eq(channelMembers.userId, botId))
    await ctx.db
      .update(orgMemberships)
      .set({ deactivatedAt: new Date() })
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, botId)))
  }
}

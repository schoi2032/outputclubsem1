import {
  channelMembers,
  channels,
  integrationCredentials,
  integrations,
  orgMemberships,
  users,
  webhookDeliveries,
} from '@quid/db'
import type { Integration } from '@quid/shared'
import { createIncomingWebhookSchema, createOutgoingWebhookSchema, textToDoc } from '@quid/shared'
import { and, desc, eq, ne } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { audit } from '../../core/audit'
import { authorize, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { randomToken, sha256 } from '../../core/crypto'
import { badRequest, notFound, unauthorized } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { publishChannelJoined } from '../channels/events'
import { requireChannel } from '../channels/service'
import { createMessage } from '../messages/service'
import { toUserSummary, userCols } from '../users/serialize'
import { assertPublicUrl } from './outgoing'
import { getIntegration } from './providers'

type Row = typeof integrations.$inferSelect

function serialize(r: Row, createdBy: Integration['createdBy']): Integration {
  const { url, events, channelIds } = r.config as {
    url?: string
    events?: string[]
    channelIds?: string[]
  }
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    enabled: r.enabled,
    channelId: r.channelId,
    config: { ...(url && { url }), ...(events && { events }), ...(channelIds && { channelIds }) },
    createdAt: r.createdAt.toISOString(),
    createdBy,
  }
}

/** Creates a bot identity scoped to one org. Bots cannot sign in. */
export async function createBot(ctx: AppContext, orgId: string, name: string) {
  const id = uuidv7()
  await ctx.db.insert(users).values({
    id,
    email: `bot+${id}@bots.quid.invalid`,
    name,
    isBot: true,
    botOrgId: orgId,
    emailVerifiedAt: new Date(),
  })
  await ctx.db.insert(orgMemberships).values({ orgId, userId: id, role: 'guest', title: 'Bot' })
  return id
}

export async function integrationRoutes(app: App, ctx: AppContext) {
  const base = '/api/orgs/:orgId/integrations'

  app.get(base, { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    authorize(scope, 'integrations.manage')
    const rows = await ctx.db
      .select({ i: integrations, by: userCols })
      .from(integrations)
      .leftJoin(users, eq(users.id, integrations.createdBy))
      // Plugin installs are managed on the Plugins page.
      .where(and(eq(integrations.orgId, scope.orgId), ne(integrations.kind, 'plugin')))
      .orderBy(desc(integrations.createdAt))
    return rows.map((r) => serialize(r.i, r.by?.id ? toUserSummary(r.by) : null))
  })

  app.post(
    `${base}/incoming-webhooks`,
    {
      schema: {
        params: orgParams,
        body: createIncomingWebhookSchema.extend({
          kind: z.enum(['incoming_webhook', 'github']).default('incoming_webhook'),
        }),
      },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'integrations.manage')
      const { channel } = await requireChannel(ctx, scope, req.body.channelId, 'read')
      if (channel.kind === 'dm' || channel.kind === 'group')
        throw badRequest('Webhooks can only post to channels.')
      if (channel.archivedAt) throw badRequest('This channel is archived.')

      const botId = await createBot(ctx, scope.orgId, req.body.name)
      await ctx.db
        .insert(channelMembers)
        .values({ channelId: channel.id, userId: botId, orgId: scope.orgId })
        .onConflictDoNothing()
      const token = randomToken()
      const signingSecret = req.body.kind === 'github' ? randomToken(24) : undefined
      const [row] = await ctx.db
        .insert(integrations)
        .values({
          orgId: scope.orgId,
          kind: req.body.kind,
          name: req.body.name,
          channelId: channel.id,
          botUserId: botId,
          tokenHash: sha256(token),
          createdBy: scope.userId,
        })
        .returning()
      if (signingSecret) {
        await ctx.db.insert(integrationCredentials).values({
          orgId: scope.orgId,
          integrationId: row!.id,
          name: 'github_webhook_secret',
          ...ctx.secrets.encrypt(signingSecret),
          createdBy: scope.userId,
        })
      }
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'integration.created',
        targetType: 'integration',
        targetId: row!.id,
        metadata: { kind: row!.kind, name: row!.name, channelId: channel.id },
        ip: req.ip,
      })
      await publishChannelJoined(ctx, scope.orgId, channel.id, botId)
      const suffix = req.body.kind === 'github' ? '/github' : ''
      return reply.code(201).send({
        ...serialize(row!, null),
        secretUrl: `${ctx.config.WEB_ORIGIN}/api/hooks/${token}${suffix}`,
        ...(signingSecret && { signingSecret }),
      })
    },
  )

  app.post(
    `${base}/outgoing-webhooks`,
    { schema: { params: orgParams, body: createOutgoingWebhookSchema } },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'integrations.manage')
      try {
        await assertPublicUrl(req.body.url, ctx.config.NODE_ENV !== 'production')
      } catch (e) {
        throw badRequest(e instanceof Error ? e.message : 'Invalid URL')
      }
      for (const id of req.body.channelIds) await requireChannel(ctx, scope, id, 'read')
      const secret = randomToken(24)
      const [row] = await ctx.db
        .insert(integrations)
        .values({
          orgId: scope.orgId,
          kind: 'outgoing_webhook',
          name: req.body.name,
          config: { url: req.body.url, events: req.body.events, channelIds: req.body.channelIds },
          createdBy: scope.userId,
        })
        .returning()
      await ctx.db.insert(integrationCredentials).values({
        orgId: scope.orgId,
        integrationId: row!.id,
        name: 'signing_secret',
        ...ctx.secrets.encrypt(secret),
        createdBy: scope.userId,
      })
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'integration.created',
        targetType: 'integration',
        targetId: row!.id,
        metadata: { kind: 'outgoing_webhook', name: row!.name, url: req.body.url },
        ip: req.ip,
      })
      return reply.code(201).send({ ...serialize(row!, null), signingSecret: secret })
    },
  )

  app.patch(
    `${base}/:id`,
    { schema: { params: orgIdParams, body: z.object({ enabled: z.boolean() }) } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'integrations.manage')
      const [row] = await ctx.db
        .update(integrations)
        .set({ enabled: req.body.enabled })
        .where(and(eq(integrations.id, req.params.id), eq(integrations.orgId, scope.orgId)))
        .returning()
      if (!row) throw notFound('Integration')
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: req.body.enabled ? 'integration.enabled' : 'integration.disabled',
        targetType: 'integration',
        targetId: row.id,
        ip: req.ip,
      })
      return serialize(row, null)
    },
  )

  app.delete(`${base}/:id`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    authorize(scope, 'integrations.manage')
    const [row] = await ctx.db
      .delete(integrations)
      .where(and(eq(integrations.id, req.params.id), eq(integrations.orgId, scope.orgId)))
      .returning()
    if (!row) throw notFound('Integration')
    if (row.botUserId) {
      await ctx.db.delete(channelMembers).where(eq(channelMembers.userId, row.botUserId))
      await ctx.db.delete(orgMemberships).where(eq(orgMemberships.userId, row.botUserId))
    }
    await audit(ctx.db, {
      orgId: scope.orgId,
      actorId: scope.userId,
      action: 'integration.deleted',
      targetType: 'integration',
      targetId: row.id,
      metadata: { kind: row.kind, name: row.name },
      ip: req.ip,
    })
    return { ok: true }
  })

  app.get(`${base}/:id/deliveries`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    authorize(scope, 'integrations.manage')
    return ctx.db
      .select({
        id: webhookDeliveries.id,
        event: webhookDeliveries.event,
        status: webhookDeliveries.status,
        attempts: webhookDeliveries.attempts,
        responseStatus: webhookDeliveries.responseStatus,
        createdAt: webhookDeliveries.createdAt,
      })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.integrationId, req.params.id),
          eq(webhookDeliveries.orgId, scope.orgId),
        ),
      )
      .orderBy(desc(webhookDeliveries.id))
      .limit(50)
  })

  // --- Inbound endpoints (public, authenticated by the secret URL) -----------------

  await app.register(async (plain) => {
    const hooks = plain.withTypeProvider<ZodTypeProvider>()
    hooks.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: 1_000_000 },
      (_req, body, done) => done(null, body),
    )

    const handle = async (token: string, kind: string, req: FastifyRequest) => {
      const row = await ctx.db.query.integrations.findFirst({
        where: eq(integrations.tokenHash, sha256(token)),
      })
      if (!row?.enabled || row.kind !== kind || !row.channelId || !row.botUserId)
        throw notFound('Webhook')
      const provider = getIntegration(kind)!
      const raw = typeof req.body === 'string' ? req.body : ''
      if (provider.verify) {
        const cred = await ctx.db.query.integrationCredentials.findFirst({
          where: eq(integrationCredentials.integrationId, row.id),
        })
        if (!provider.verify(req, raw, cred ? ctx.secrets.decrypt(cred) : null))
          throw unauthorized('Invalid signature')
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw badRequest('Body must be JSON')
      }
      let result: ReturnType<typeof provider.toMessage>
      try {
        result = provider.toMessage(req, parsed)
      } catch (e) {
        throw badRequest(e instanceof Error ? e.message : 'Invalid payload')
      }
      if (!result.text) return { ok: true, posted: false }
      const channel = await ctx.db.query.channels.findFirst({
        where: eq(channels.id, row.channelId),
      })
      if (!channel || channel.archivedAt) throw notFound('Channel')
      await createMessage(ctx, { orgId: row.orgId, userId: row.botUserId }, channel, {
        body: textToDoc(result.text),
        kind: 'bot',
      })
      return { ok: true, posted: true }
    }

    const opts = {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { params: z.object({ token: z.string().min(20).max(100) }) },
    }
    hooks.post('/api/hooks/:token', opts, async (req) =>
      handle(req.params.token, 'incoming_webhook', req),
    )
    hooks.post('/api/hooks/:token/github', opts, async (req) =>
      handle(req.params.token, 'github', req),
    )
  })
}

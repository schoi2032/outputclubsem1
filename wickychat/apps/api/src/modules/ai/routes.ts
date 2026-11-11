import { aiProviders, integrationCredentials, organizations, users } from '@quid/db'
import { aiProviderSchema, summarizeSchema } from '@quid/shared'
import { and, eq } from 'drizzle-orm'
import { audit } from '../../core/audit'
import { authorize, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { AppError, badRequest, notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { requireChannel } from '../channels/service'
import { toUserSummary, userCols } from '../users/serialize'
import './assistant'
import { getMessageRow } from '../messages/service'
import { meetingNotesRoutes } from './meeting-notes'
import {
  channelLines,
  ensureAssistantBot,
  formatTranscript,
  orgAssistant,
  SUMMARY_SYSTEM,
  type TranscriptLine,
  threadLines,
} from './service'

/**
 * AI provider configuration (admin only) and the assistant features members use
 * with it. Assistants only read conversations the requesting person can read.
 */
export async function aiRoutes(app: App, ctx: AppContext) {
  await meetingNotesRoutes(app, ctx)

  app.get('/api/orgs/:orgId/ai/status', { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const available = (await orgAssistant(ctx, scope.orgId)) !== null
    const [bot] = available
      ? await ctx.db
          .select(userCols)
          .from(organizations)
          .innerJoin(users, eq(users.id, organizations.assistantBotId))
          .where(eq(organizations.id, scope.orgId))
      : []
    return { available, assistant: bot ? toUserSummary(bot) : null }
  })

  app.post(
    '/api/orgs/:orgId/ai/summarize',
    {
      schema: { params: orgParams, body: summarizeSchema },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { channel } = await requireChannel(ctx, scope, req.body.channelId, 'read')
      const assistant = await orgAssistant(ctx, scope.orgId)
      if (!assistant) throw notSetUp()

      let lines: TranscriptLine[]
      if (req.body.threadId) {
        const root = await getMessageRow(ctx, scope.orgId, req.body.threadId)
        if (root.channelId !== channel.id || root.parentId) throw notFound('Thread')
        lines = await threadLines(ctx, channel.id, root.id)
      } else {
        lines = await channelLines(ctx, channel.id, {
          afterMessageId: req.body.afterMessageId,
          after: req.body.afterMessageId
            ? undefined
            : new Date(Date.now() - (req.body.hours ?? 24) * 3_600_000),
        })
      }
      const transcript = formatTranscript(lines)
      if (!transcript) return { summary: null, messageCount: 0 }

      const result = await assistant
        .complete({
          system: SUMMARY_SYSTEM,
          messages: [
            {
              role: 'user',
              content: `<conversation>\n${transcript}\n</conversation>\n\nSummarize this for me.`,
            },
          ],
          maxTokens: 8_000,
        })
        .catch((err: unknown) => {
          ctx.log.warn({ err }, 'ai summarize failed')
          throw new AppError(
            502,
            'ai_unavailable',
            "Claude couldn't be reached. Try again shortly.",
          )
        })
      if (result.refused || !result.text.trim())
        throw new AppError(502, 'ai_refused', "Claude couldn't summarize this conversation.")
      return { summary: result.text.trim(), messageCount: lines.length }
    },
  )

  const base = '/api/orgs/:orgId/ai/providers'

  app.get(base, { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    authorize(scope, 'ai.manage')
    const rows = await ctx.db.select().from(aiProviders).where(eq(aiProviders.orgId, scope.orgId))
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      model: r.model,
      enabled: r.enabled,
      dataAccessConsentAt: r.dataAccessConsentAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }))
  })

  app.post(base, { schema: { params: orgParams, body: aiProviderSchema } }, async (req, reply) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    authorize(scope, 'ai.manage')
    if (req.body.provider !== 'anthropic')
      throw badRequest('Only Anthropic is available in this release.')
    const [cred] = await ctx.db
      .insert(integrationCredentials)
      .values({
        orgId: scope.orgId,
        name: `ai:${req.body.provider}`,
        ...ctx.secrets.encrypt(req.body.apiKey),
        createdBy: scope.userId,
      })
      .returning({ id: integrationCredentials.id })
    const [row] = await ctx.db
      .insert(aiProviders)
      .values({
        orgId: scope.orgId,
        provider: req.body.provider,
        model: req.body.model,
        credentialId: cred!.id,
        enabled: true,
        dataAccessConsentAt: new Date(),
        consentedBy: scope.userId,
      })
      .returning()
    await ensureAssistantBot(ctx, scope.orgId)
    await audit(ctx.db, {
      orgId: scope.orgId,
      actorId: scope.userId,
      action: 'ai.provider_configured',
      targetType: 'ai_provider',
      targetId: row!.id,
      metadata: { provider: row!.provider, model: row!.model, dataAccessConsent: true },
      ip: req.ip,
    })
    return reply
      .code(201)
      .send({ id: row!.id, provider: row!.provider, model: row!.model, enabled: true })
  })

  app.post(`${base}/:id/test`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    authorize(scope, 'ai.manage')
    const row = await ctx.db.query.aiProviders.findFirst({
      where: and(eq(aiProviders.id, req.params.id), eq(aiProviders.orgId, scope.orgId)),
    })
    if (!row?.credentialId) throw notFound('Provider')
    const cred = await ctx.db.query.integrationCredentials.findFirst({
      where: eq(integrationCredentials.id, row.credentialId),
    })
    if (!cred) throw notFound('Credential')
    return ctx.ai(row.provider, ctx.secrets.decrypt(cred), row.model).testConnection()
  })

  app.delete(`${base}/:id`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    authorize(scope, 'ai.manage')
    const [row] = await ctx.db
      .delete(aiProviders)
      .where(and(eq(aiProviders.id, req.params.id), eq(aiProviders.orgId, scope.orgId)))
      .returning()
    if (!row) throw notFound('Provider')
    if (row.credentialId)
      await ctx.db
        .delete(integrationCredentials)
        .where(eq(integrationCredentials.id, row.credentialId))
    await audit(ctx.db, {
      orgId: scope.orgId,
      actorId: scope.userId,
      action: 'ai.provider_removed',
      targetType: 'ai_provider',
      targetId: row.id,
      ip: req.ip,
    })
    return { ok: true }
  })
}

const notSetUp = () =>
  new AppError(409, 'ai_not_configured', 'An admin needs to set up Claude in Settings → AI first.')

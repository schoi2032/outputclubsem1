import { bookmarks, drafts, files, messages, pins, reactions, scheduledMessages } from '@quid/db'
import type { ScheduledMessage } from '@quid/shared'
import {
  docToText,
  draftSchema,
  editMessageSchema,
  forwardMessageSchema,
  historyQuerySchema,
  markReadSchema,
  reactionSchema,
  scheduleMessageSchema,
  sendMessageSchema,
  topics,
} from '@quid/shared'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, forbidden, notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { check, getChannelAccess, requireChannel } from '../channels/service'
import { payForReaction } from '../coins/earn'
import { coinsForMessage } from '../coins/service'
import { canUseSticker } from '../coins/sticker-lookup'
import { enqueueOutgoingWebhooks } from '../integrations/outgoing'
import {
  createMessage,
  getMessageRow,
  history,
  markRead,
  parseBody,
  parseBodyReport,
  publishThreadUpdated,
  reactionGroups,
  recordSwears,
  serializeMessage,
  serializeMessages,
  threadMessages,
} from './service'

const EMOJI = /^[^\s<>"'`]{1,64}$/u

export async function messageRoutes(app: App, ctx: AppContext) {
  const base = '/api/orgs/:orgId'

  app.get(
    `${base}/channels/:id/messages`,
    { schema: { params: orgIdParams, querystring: historyQuerySchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { channel } = await requireChannel(ctx, scope, req.params.id, 'read')
      return history(ctx, scope.userId, channel.id, req.query)
    },
  )

  app.post(
    `${base}/channels/:id/messages`,
    {
      schema: { params: orgIdParams, body: sendMessageSchema },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { channel } = await requireChannel(
        ctx,
        scope,
        req.params.id,
        req.body.parentId ? 'reply' : 'post',
      )
      const message = await createMessage(ctx, scope, channel, req.body)
      return reply.code(201).send(message)
    },
  )

  app.post(
    `${base}/channels/:id/read`,
    { schema: { params: orgIdParams, body: markReadSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const a = await requireChannel(ctx, scope, req.params.id, 'read')
      if (!a.membership) return { ok: true }
      const m = await ctx.db.query.messages.findFirst({
        where: and(eq(messages.id, req.body.messageId), eq(messages.channelId, a.channel.id)),
        columns: { id: true },
      })
      if (!m) throw notFound('Message')
      await markRead(ctx, scope, a.channel.id, m.id)
      return { ok: true }
    },
  )

  app.get(`${base}/messages/:id`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await getMessageRow(ctx, scope.orgId, req.params.id)
    await requireChannel(ctx, scope, row.channelId, 'read')
    return serializeMessage(ctx, scope.userId, row)
  })

  app.get(`${base}/messages/:id/thread`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await getMessageRow(ctx, scope.orgId, req.params.id)
    await requireChannel(ctx, scope, row.channelId, 'read')
    const root = row.parentId ? await getMessageRow(ctx, scope.orgId, row.parentId) : row
    return threadMessages(ctx, scope.userId, root)
  })

  app.patch(
    `${base}/messages/:id`,
    { schema: { params: orgIdParams, body: editMessageSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const row = await getMessageRow(ctx, scope.orgId, req.params.id)
      const a = await requireChannel(ctx, scope, row.channelId, 'read')
      if (row.authorId !== scope.userId || row.kind !== 'user')
        throw forbidden('You can only edit your own messages.')
      if (row.deletedAt) throw notFound('Message')
      if (a.channel.archivedAt) throw forbidden('This channel is archived.')
      const { body, swears } = parseBodyReport(req.body.body)
      const text = docToText(body)
      if (!text && !JSON.stringify(body).includes('mention')) {
        const hasFiles = await ctx.db.query.files.findFirst({
          where: (f, { eq }) => eq(f.messageId, row.id),
        })
        if (!hasFiles) throw badRequest('Message is empty. Delete it instead.')
      }
      const [updated] = await ctx.db
        .update(messages)
        .set({ bodyJson: body, bodyText: text, editedAt: new Date() })
        .where(eq(messages.id, row.id))
        .returning()
      await recordSwears(
        ctx,
        {
          orgId: scope.orgId,
          userId: scope.userId,
          channelId: row.channelId,
          messageId: row.id,
          source: 'edit',
        },
        swears,
      )
      // Editing a swear into a message still costs coins (but edits never earn any).
      if (swears) await coinsForMessage(ctx, scope.userId, true)
      const message = await serializeMessage(ctx, scope.userId, updated!)
      await ctx.bus.publish(topics.channel(row.channelId), {
        type: 'message.updated',
        orgId: scope.orgId,
        message,
      })
      await enqueueOutgoingWebhooks(ctx, scope.orgId, 'message.updated', {
        channelId: row.channelId,
        message,
      })
      return message
    },
  )

  app.delete(`${base}/messages/:id`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await getMessageRow(ctx, scope.orgId, req.params.id)
    const a = await requireChannel(ctx, scope, row.channelId, 'read')
    const isAuthor = row.authorId === scope.userId
    const isModerator = check(scope, a, 'manage') && a.channel.kind !== 'group'
    if (!isAuthor && !isModerator) throw forbidden('You can only delete your own messages.')
    if (row.deletedAt) return { ok: true }

    await ctx.db.transaction(async (tx) => {
      await tx
        .update(messages)
        .set({ deletedAt: new Date(), bodyJson: { type: 'doc', content: [] }, bodyText: '' })
        .where(eq(messages.id, row.id))
      await tx.delete(reactions).where(eq(reactions.messageId, row.id))
      await tx.delete(pins).where(eq(pins.messageId, row.id))
      if (row.parentId) {
        await tx
          .update(messages)
          .set({ replyCount: sql`greatest(${messages.replyCount} - 1, 0)` })
          .where(eq(messages.id, row.parentId))
      }
    })
    // Detach files so they stop being reachable through the message.
    await ctx.db.update(files).set({ deletedAt: new Date() }).where(eq(files.messageId, row.id))

    await ctx.bus.publish(topics.channel(row.channelId), {
      type: 'message.deleted',
      orgId: scope.orgId,
      channelId: row.channelId,
      messageId: row.id,
      parentId: row.parentId,
    })
    if (row.parentId) await publishThreadUpdated(ctx, scope.orgId, row.parentId)
    await enqueueOutgoingWebhooks(ctx, scope.orgId, 'message.deleted', {
      channelId: row.channelId,
      messageId: row.id,
    })
    return { ok: true }
  })

  // --- Reactions ---------------------------------------------------------------

  for (const method of ['post', 'delete'] as const) {
    app[method](
      `${base}/messages/:id/reactions`,
      { schema: { params: orgIdParams, body: reactionSchema } },
      async (req) => {
        const scope = await requireOrg(ctx, req, req.params.orgId)
        const row = await getMessageRow(ctx, scope.orgId, req.params.id)
        const a = await requireChannel(ctx, scope, row.channelId, 'read')
        if (!a.membership) throw forbidden('Join the channel to react.')
        if (row.deletedAt || row.kind === 'system')
          throw badRequest("You can't react to this message.")
        const emoji = req.body.emoji
        if (!EMOJI.test(emoji)) throw badRequest('Invalid emoji.')
        // Sticker reactions: only with stickers you own.
        if (
          method === 'post' &&
          emoji.startsWith('sticker:') &&
          !(await canUseSticker(ctx.db, scope, emoji.slice(8)))
        )
          throw badRequest("You don't have that sticker pack. Get it in the Shop!")
        if (method === 'post') {
          const [{ n }] = (await ctx.db
            .select({ n: sql<number>`count(distinct ${reactions.emoji})::int` })
            .from(reactions)
            .where(eq(reactions.messageId, row.id))) as [{ n: number }]
          if (n >= 50) throw badRequest('This message has too many different reactions.')
          await ctx.db
            .insert(reactions)
            .values({ messageId: row.id, userId: scope.userId, orgId: scope.orgId, emoji })
            .onConflictDoNothing()
          // People reacting to what you post earns you a coin or two.
          await payForReaction(ctx, row.id, scope.userId)
        } else {
          await ctx.db
            .delete(reactions)
            .where(
              and(
                eq(reactions.messageId, row.id),
                eq(reactions.userId, scope.userId),
                eq(reactions.emoji, emoji),
              ),
            )
        }
        const groups = (await reactionGroups(ctx, [row.id])).get(row.id) ?? []
        await ctx.bus.publish(topics.channel(row.channelId), {
          type: 'reaction.updated',
          orgId: scope.orgId,
          channelId: row.channelId,
          messageId: row.id,
          reactions: groups,
        })
        return { reactions: groups }
      },
    )
  }

  // --- Pins ----------------------------------------------------------------------

  app.get(`${base}/channels/:id/pins`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const { channel } = await requireChannel(ctx, scope, req.params.id, 'read')
    const rows = await ctx.db
      .select({ m: messages })
      .from(pins)
      .innerJoin(messages, eq(messages.id, pins.messageId))
      .where(eq(pins.channelId, channel.id))
      .orderBy(desc(pins.createdAt))
      .limit(100)
    return serializeMessages(
      ctx,
      scope.userId,
      rows.map((r) => r.m),
    )
  })

  for (const method of ['post', 'delete'] as const) {
    app[method](`${base}/messages/:id/pin`, { schema: { params: orgIdParams } }, async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const row = await getMessageRow(ctx, scope.orgId, req.params.id)
      await requireChannel(ctx, scope, row.channelId, 'pin')
      if (row.deletedAt || row.kind === 'system') throw badRequest("This message can't be pinned.")
      if (method === 'post') {
        await ctx.db
          .insert(pins)
          .values({
            channelId: row.channelId,
            messageId: row.id,
            orgId: scope.orgId,
            pinnedBy: scope.userId,
          })
          .onConflictDoNothing()
      } else {
        await ctx.db
          .delete(pins)
          .where(and(eq(pins.channelId, row.channelId), eq(pins.messageId, row.id)))
      }
      await ctx.bus.publish(topics.channel(row.channelId), {
        type: 'pin.updated',
        orgId: scope.orgId,
        channelId: row.channelId,
        messageId: row.id,
        pinned: method === 'post',
      })
      return { ok: true }
    })
  }

  // --- Bookmarks (saved items) ------------------------------------------------------

  app.get(`${base}/bookmarks`, { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const rows = await ctx.db
      .select({ m: messages })
      .from(bookmarks)
      .innerJoin(messages, eq(messages.id, bookmarks.messageId))
      .where(
        and(
          eq(bookmarks.userId, scope.userId),
          eq(bookmarks.orgId, scope.orgId),
          isNull(messages.deletedAt),
        ),
      )
      .orderBy(desc(bookmarks.createdAt))
      .limit(200)
    // Drop items from channels the user can no longer read.
    const readable = []
    for (const r of rows) {
      try {
        await getChannelAccess(ctx, scope, r.m.channelId)
        readable.push(r.m)
      } catch {
        // skip
      }
    }
    return serializeMessages(ctx, scope.userId, readable)
  })

  for (const method of ['post', 'delete'] as const) {
    app[method](
      `${base}/messages/:id/bookmark`,
      { schema: { params: orgIdParams } },
      async (req) => {
        const scope = await requireOrg(ctx, req, req.params.orgId)
        const row = await getMessageRow(ctx, scope.orgId, req.params.id)
        await requireChannel(ctx, scope, row.channelId, 'read')
        if (method === 'post') {
          await ctx.db
            .insert(bookmarks)
            .values({ userId: scope.userId, messageId: row.id, orgId: scope.orgId })
            .onConflictDoNothing()
        } else {
          await ctx.db
            .delete(bookmarks)
            .where(and(eq(bookmarks.userId, scope.userId), eq(bookmarks.messageId, row.id)))
        }
        return { bookmarked: method === 'post' }
      },
    )
  }

  // --- Forwarding ---------------------------------------------------------------------

  app.post(
    `${base}/messages/:id/forward`,
    { schema: { params: orgIdParams, body: forwardMessageSchema } },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const row = await getMessageRow(ctx, scope.orgId, req.params.id)
      await requireChannel(ctx, scope, row.channelId, 'read')
      if (row.deletedAt || row.kind === 'system')
        throw badRequest("This message can't be forwarded.")
      const target = await requireChannel(ctx, scope, req.body.targetChannelId, 'post')
      const message = await createMessage(ctx, scope, target.channel, {
        body: req.body.comment ?? { type: 'doc', content: [] },
        forward: {
          id: row.forwardedFromId ?? row.id,
          snapshot: row.forwardSnapshot ?? {
            channelId: row.channelId,
            authorId: row.authorId,
            bodyText: row.bodyText,
            createdAt: row.createdAt.toISOString(),
          },
        },
      })
      return reply.code(201).send(message)
    },
  )

  // --- Drafts ---------------------------------------------------------------------------

  app.get(`${base}/drafts`, { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const rows = await ctx.db
      .select()
      .from(drafts)
      .where(and(eq(drafts.userId, scope.userId), eq(drafts.orgId, scope.orgId)))
      .orderBy(desc(drafts.updatedAt))
    return rows.map((d) => ({
      channelId: d.channelId,
      parentId: d.parentId,
      body: d.bodyJson,
      updatedAt: d.updatedAt.toISOString(),
    }))
  })

  app.put(
    `${base}/channels/:id/draft`,
    { schema: { params: orgIdParams, body: draftSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { channel } = await requireChannel(ctx, scope, req.params.id, 'read')
      const body = parseBody(req.body.body)
      const parentId = req.body.parentId
      const where = and(
        eq(drafts.userId, scope.userId),
        eq(drafts.channelId, channel.id),
        parentId ? eq(drafts.parentId, parentId) : isNull(drafts.parentId),
      )
      if (!docToText(body) && !JSON.stringify(body).includes('mention')) {
        await ctx.db.delete(drafts).where(where)
        return { ok: true }
      }
      const existing = await ctx.db.query.drafts.findFirst({ where })
      if (existing) {
        await ctx.db
          .update(drafts)
          .set({ bodyJson: body, updatedAt: new Date() })
          .where(eq(drafts.id, existing.id))
      } else {
        await ctx.db
          .insert(drafts)
          .values({
            userId: scope.userId,
            orgId: scope.orgId,
            channelId: channel.id,
            parentId,
            bodyJson: body,
          })
          .onConflictDoNothing()
      }
      return { ok: true }
    },
  )

  app.delete(
    `${base}/channels/:id/draft`,
    { schema: { params: orgIdParams, querystring: z.object({ parentId: z.uuid().optional() }) } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      await ctx.db
        .delete(drafts)
        .where(
          and(
            eq(drafts.userId, scope.userId),
            eq(drafts.orgId, scope.orgId),
            eq(drafts.channelId, req.params.id),
            req.query.parentId ? eq(drafts.parentId, req.query.parentId) : isNull(drafts.parentId),
          ),
        )
      return { ok: true }
    },
  )

  // --- Scheduled messages -------------------------------------------------------------------

  const toScheduled = (r: typeof scheduledMessages.$inferSelect): ScheduledMessage => ({
    id: r.id,
    channelId: r.channelId,
    parentId: r.parentId,
    body: r.bodyJson as ScheduledMessage['body'],
    text: docToText(r.bodyJson as ScheduledMessage['body']),
    sendAt: r.sendAt.toISOString(),
    status: r.status,
  })

  app.get(`${base}/scheduled`, { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const rows = await ctx.db
      .select()
      .from(scheduledMessages)
      .where(
        and(
          eq(scheduledMessages.authorId, scope.userId),
          eq(scheduledMessages.orgId, scope.orgId),
          inArray(scheduledMessages.status, ['pending', 'failed']),
        ),
      )
      .orderBy(scheduledMessages.sendAt)
    return rows.map(toScheduled)
  })

  app.post(
    `${base}/scheduled`,
    { schema: { params: orgParams, body: scheduleMessageSchema } },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { channel } = await requireChannel(
        ctx,
        scope,
        req.body.channelId,
        req.body.parentId ? 'reply' : 'post',
      )
      const sendAt = new Date(req.body.sendAt)
      if (sendAt.getTime() < Date.now() + 30_000)
        throw badRequest('Choose a time at least a minute from now.')
      if (sendAt.getTime() > Date.now() + 120 * 86_400_000)
        throw badRequest('Messages can be scheduled up to 120 days ahead.')
      const { body, swears } = parseBodyReport(req.body.body)
      if (!docToText(body)) throw badRequest('Message is empty.')
      if (req.body.parentId) {
        const p = await ctx.db.query.messages.findFirst({
          where: and(
            eq(messages.id, req.body.parentId),
            eq(messages.channelId, channel.id),
            isNull(messages.parentId),
          ),
        })
        if (!p) throw notFound('Thread')
      }
      const [row] = await ctx.db
        .insert(scheduledMessages)
        .values({
          orgId: scope.orgId,
          channelId: channel.id,
          parentId: req.body.parentId,
          authorId: scope.userId,
          bodyJson: body,
          sendAt,
        })
        .returning()
      // Logged now: the saved body is already censored, so sending it later catches nothing.
      await recordSwears(
        ctx,
        {
          orgId: scope.orgId,
          userId: scope.userId,
          channelId: channel.id,
          messageId: null,
          source: 'scheduled',
        },
        swears,
      )
      return reply.code(201).send(toScheduled(row!))
    },
  )

  app.delete(`${base}/scheduled/:id`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const [row] = await ctx.db
      .update(scheduledMessages)
      .set({ status: 'canceled' })
      .where(
        and(
          eq(scheduledMessages.id, req.params.id),
          eq(scheduledMessages.authorId, scope.userId),
          eq(scheduledMessages.orgId, scope.orgId),
          inArray(scheduledMessages.status, ['pending', 'failed']),
        ),
      )
      .returning()
    if (!row) throw notFound('Scheduled message')
    return { ok: true }
  })
}

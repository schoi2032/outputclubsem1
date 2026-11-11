import {
  bookmarks,
  channelMembers,
  channels,
  drafts,
  files,
  mentions,
  messages,
  moderationEvents,
  pins,
  reactions,
  users,
} from '@quid/db'
import type { DocNode, Message, ReactionGroup, UserSummary } from '@quid/shared'
import {
  censorDocReport,
  docToText,
  extractMentions,
  isDocError,
  isEmptyDoc,
  sanitizeDoc,
  textToDoc,
  topics,
} from '@quid/shared'
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { OrgScope } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, notFound } from '../../core/errors'
import { emitHook } from '../../core/hooks'
import { publishChannelJoined } from '../channels/events'
import type { ChannelRow } from '../channels/service'
import { coinsForMessage } from '../coins/service'
import { serializeFiles } from '../files/serialize'
import { enqueueOutgoingWebhooks } from '../integrations/outgoing'
import { assertNotTimedOut } from '../moderation/school'
import { notifyForMessage } from '../notifications/service'
import { enqueuePluginEvents } from '../plugins/events'
import { deletedUser, toUserSummary, userCols } from '../users/serialize'

export type MessageRow = typeof messages.$inferSelect

/** A message body after the swear filter, plus what it caught (for the rule-breakers log). */
export interface ParsedBody {
  body: DocNode
  swears: { words: string[]; original: string } | null
}

export function parseBodyReport(input: unknown): ParsedBody {
  let clean: DocNode
  try {
    clean = sanitizeDoc(input)
  } catch (e) {
    if (isDocError(e)) throw badRequest(e.message)
    throw e
  }
  // WickyChat: swears are replaced with asterisks before anything is saved or sent.
  const { doc, words } = censorDocReport(clean)
  return {
    body: doc,
    swears: words.length ? { words, original: docToText(clean).slice(0, 2000) } : null,
  }
}

export function parseBody(input: unknown): DocNode {
  return parseBodyReport(input).body
}

/**
 * Logs that the swear filter caught something, so teachers can see it in Settings → Rule
 * breakers. Never fails the message: a logging problem must not stop someone posting.
 */
export async function recordSwears(
  ctx: AppContext,
  where: {
    orgId: string
    userId: string
    channelId: string | null
    messageId: string | null
    source: 'message' | 'edit' | 'scheduled'
  },
  swears: ParsedBody['swears'],
) {
  if (!swears) return
  try {
    await ctx.db.insert(moderationEvents).values({
      id: uuidv7(),
      ...where,
      kind: 'swear',
      words: swears.words.slice(0, 50).map((w) => w.slice(0, 60)),
      original: swears.original,
    })
  } catch (err) {
    ctx.log.warn({ err }, 'could not record moderation event')
  }
}

const systemUser: UserSummary = {
  id: 'system',
  name: 'WickyChat',
  displayName: null,
  avatarUrl: null,
  isBot: true,
}

export async function reactionGroups(
  ctx: AppContext,
  messageIds: string[],
): Promise<Map<string, ReactionGroup[]>> {
  const out = new Map<string, ReactionGroup[]>()
  if (messageIds.length === 0) return out
  const rows = await ctx.db
    .select({
      messageId: reactions.messageId,
      emoji: reactions.emoji,
      userIds: sql<string[]>`array_agg(${reactions.userId} order by ${reactions.createdAt})`,
      first: sql<Date>`min(${reactions.createdAt})`,
    })
    .from(reactions)
    .where(inArray(reactions.messageId, messageIds))
    .groupBy(reactions.messageId, reactions.emoji)
    .orderBy(sql`min(${reactions.createdAt})`)
  for (const r of rows) {
    const list = out.get(r.messageId) ?? []
    list.push({ emoji: r.emoji, count: r.userIds.length, userIds: r.userIds })
    out.set(r.messageId, list)
  }
  return out
}

/** Turns rows into API messages for one viewer. Batches every lookup. */
export async function serializeMessages(
  ctx: AppContext,
  viewerId: string,
  rows: MessageRow[],
): Promise<Message[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const userIds = new Set<string>()
  for (const r of rows) {
    if (r.authorId) userIds.add(r.authorId)
    for (const u of r.replyUserIds.slice(0, 5)) userIds.add(u)
    if (r.forwardSnapshot?.authorId) userIds.add(r.forwardSnapshot.authorId)
  }

  const [userRows, reactionMap, fileRows, pinRows, bookmarkRows] = await Promise.all([
    userIds.size
      ? ctx.db
          .select(userCols)
          .from(users)
          .where(inArray(users.id, [...userIds]))
      : [],
    reactionGroups(ctx, ids),
    ctx.db
      .select()
      .from(files)
      .where(and(inArray(files.messageId, ids), isNull(files.deletedAt)))
      .orderBy(asc(files.createdAt)),
    ctx.db.select({ messageId: pins.messageId }).from(pins).where(inArray(pins.messageId, ids)),
    ctx.db
      .select({ messageId: bookmarks.messageId })
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, viewerId), inArray(bookmarks.messageId, ids))),
  ])
  const userMap = new Map(userRows.map((u) => [u.id, toUserSummary(u)]))
  const pinned = new Set(pinRows.map((p) => p.messageId))
  const bookmarked = new Set(bookmarkRows.map((b) => b.messageId))
  const filesBy = new Map<string, typeof fileRows>()
  for (const f of fileRows) {
    const list = filesBy.get(f.messageId!) ?? []
    list.push(f)
    filesBy.set(f.messageId!, list)
  }

  return rows.map((r) => {
    const deleted = r.deletedAt !== null
    const author =
      r.kind === 'system' && !r.authorId
        ? systemUser
        : (r.authorId && userMap.get(r.authorId)) || deletedUser
    const snap = r.forwardSnapshot
    return {
      id: r.id,
      channelId: r.channelId,
      parentId: r.parentId,
      author,
      body: deleted ? { type: 'doc', content: [] } : (r.bodyJson as DocNode),
      text: deleted ? '' : r.bodyText,
      kind: r.kind,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      deletedAt: r.deletedAt?.toISOString() ?? null,
      reactions: deleted ? [] : (reactionMap.get(r.id) ?? []),
      attachments: deleted ? [] : serializeFiles(filesBy.get(r.id) ?? []),
      replyCount: r.replyCount,
      lastReplyAt: r.lastReplyAt?.toISOString() ?? null,
      replyUsers: r.replyUserIds
        .slice(0, 5)
        .map((u) => userMap.get(u))
        .filter((u): u is UserSummary => !!u),
      pinned: pinned.has(r.id),
      bookmarked: bookmarked.has(r.id),
      forwardedFrom:
        snap && r.forwardedFromId && !deleted
          ? {
              id: r.forwardedFromId,
              channelId: snap.channelId,
              author: (snap.authorId && userMap.get(snap.authorId)) || deletedUser,
              text: snap.bodyText,
              createdAt: snap.createdAt,
            }
          : null,
      ...(r.clientId && { clientId: r.clientId }),
    }
  })
}

export async function serializeMessage(ctx: AppContext, viewerId: string, row: MessageRow) {
  const [m] = await serializeMessages(ctx, viewerId, [row])
  return m!
}

/** Loads a message in a channel the caller can read (404 otherwise). */
export async function getMessageRow(ctx: AppContext, orgId: string, messageId: string) {
  const m = await ctx.db.query.messages.findFirst({
    where: and(eq(messages.id, messageId), eq(messages.orgId, orgId)),
  })
  if (!m) throw notFound('Message')
  return m
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const visible = (parentFilter: ReturnType<typeof isNull> | ReturnType<typeof eq>) =>
  and(parentFilter, or(isNull(messages.deletedAt), gt(messages.replyCount, 0)))

export async function history(
  ctx: AppContext,
  viewerId: string,
  channelId: string,
  q: { before?: string; after?: string; around?: string; limit: number },
) {
  const base = and(eq(messages.channelId, channelId), visible(isNull(messages.parentId)))
  const page = async (dir: 'before' | 'after', cursor: string | undefined, limit: number) => {
    const rows = await ctx.db
      .select()
      .from(messages)
      .where(
        and(
          base,
          cursor
            ? dir === 'before'
              ? lt(messages.id, cursor)
              : gt(messages.id, cursor)
            : undefined,
        ),
      )
      .orderBy(dir === 'before' ? desc(messages.id) : asc(messages.id))
      .limit(limit + 1)
    const more = rows.length > limit
    const list = rows.slice(0, limit)
    return { list: dir === 'before' ? list.reverse() : list, more }
  }

  if (q.around) {
    const half = Math.floor(q.limit / 2)
    const anchor = await ctx.db.query.messages.findFirst({
      where: and(eq(messages.id, q.around), eq(messages.channelId, channelId)),
    })
    if (!anchor) throw notFound('Message')
    const target = anchor.parentId ?? anchor.id
    const [older, newer] = await Promise.all([
      page('before', target, half),
      page('after', target, half),
    ])
    const root = await ctx.db.query.messages.findFirst({ where: eq(messages.id, target) })
    const rows = [...older.list, ...(root ? [root] : []), ...newer.list]
    return {
      messages: await serializeMessages(ctx, viewerId, rows),
      hasMoreBefore: older.more,
      hasMoreAfter: newer.more,
    }
  }
  if (q.after) {
    const p = await page('after', q.after, q.limit)
    return {
      messages: await serializeMessages(ctx, viewerId, p.list),
      hasMoreBefore: true,
      hasMoreAfter: p.more,
    }
  }
  const p = await page('before', q.before, q.limit)
  return {
    messages: await serializeMessages(ctx, viewerId, p.list),
    hasMoreBefore: p.more,
    hasMoreAfter: q.before !== undefined,
  }
}

export async function threadMessages(ctx: AppContext, viewerId: string, root: MessageRow) {
  const replies = await ctx.db
    .select()
    .from(messages)
    .where(and(eq(messages.parentId, root.id), isNull(messages.deletedAt)))
    .orderBy(asc(messages.id))
    .limit(1000)
  return {
    root: await serializeMessage(ctx, viewerId, root),
    replies: await serializeMessages(ctx, viewerId, replies),
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface SendInput {
  body: unknown
  parentId?: string | null
  fileIds?: string[]
  clientId?: string
  kind?: 'user' | 'bot'
  forward?: { id: string; snapshot: NonNullable<MessageRow['forwardSnapshot']> }
}

/**
 * Creates a message. Callers must have already checked `post` permission on
 * the channel. Bots and webhooks reuse this with their own author id.
 */
export async function createMessage(
  ctx: AppContext,
  scope: Pick<OrgScope, 'orgId' | 'userId'>,
  channel: ChannelRow,
  input: SendInput,
): Promise<Message> {
  await assertNotTimedOut(ctx, scope.orgId, scope.userId)
  const { body, swears } = parseBodyReport(input.body)
  const fileIds = [...new Set(input.fileIds ?? [])]
  if (isEmptyDoc(body) && fileIds.length === 0 && !input.forward)
    throw badRequest('Message is empty.')
  const text = docToText(body)

  let parent: MessageRow | undefined
  if (input.parentId) {
    parent = await ctx.db.query.messages.findFirst({
      where: and(eq(messages.id, input.parentId), eq(messages.channelId, channel.id)),
    })
    if (!parent || parent.deletedAt) throw notFound('Thread')
    if (parent.parentId) throw badRequest('Replies cannot have their own threads.')
  }

  // Only notify mentioned users who can actually read the channel.
  const mentioned = extractMentions(body)
  const mentionUserIds = mentioned.filter((m) => m.kind === 'user').map((m) => m.id)
  const broadcast = mentioned.some((m) => m.kind === 'here')
  const memberRows = await ctx.db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(eq(channelMembers.channelId, channel.id))
  const memberSet = new Set(memberRows.map((m) => m.userId))
  const notifyIds = new Set(
    (broadcast ? [...memberSet] : mentionUserIds.filter((id) => memberSet.has(id))).filter(
      (id) => id !== scope.userId,
    ),
  )

  const id = uuidv7()
  const now = new Date()
  const row = await ctx.db.transaction(async (tx) => {
    if (fileIds.length) {
      const attached = await tx
        .update(files)
        .set({ messageId: id, channelId: channel.id })
        .where(
          and(
            inArray(files.id, fileIds),
            eq(files.orgId, scope.orgId),
            eq(files.uploaderId, scope.userId),
            isNull(files.messageId),
            eq(files.purpose, 'attachment'),
            or(isNull(files.channelId), eq(files.channelId, channel.id)),
          ),
        )
        .returning({ id: files.id })
      if (attached.length !== fileIds.length)
        throw badRequest('One or more attachments are invalid.')
    }

    const [m] = await tx
      .insert(messages)
      .values({
        id,
        orgId: scope.orgId,
        channelId: channel.id,
        parentId: parent?.id ?? null,
        authorId: scope.userId,
        kind: input.kind ?? 'user',
        bodyJson: body,
        bodyText: text,
        clientId: input.clientId ?? null,
        forwardedFromId: input.forward?.id ?? null,
        forwardSnapshot: input.forward?.snapshot ?? null,
        createdAt: now,
      })
      .returning()

    if (notifyIds.size) {
      await tx
        .insert(mentions)
        .values(
          [...notifyIds].map((userId) => ({
            messageId: id,
            userId,
            orgId: scope.orgId,
            channelId: channel.id,
          })),
        )
        .onConflictDoNothing()
    }

    if (parent) {
      await tx
        .update(messages)
        .set({
          replyCount: sql`${messages.replyCount} + 1`,
          lastReplyAt: now,
          // Most recent repliers first, deduplicated, capped at five.
          replyUserIds: sql`(array_prepend(${scope.userId}::uuid, array_remove(${messages.replyUserIds}, ${scope.userId}::uuid)))[1:5]`,
        })
        .where(eq(messages.id, parent.id))
    } else {
      await tx.update(channels).set({ lastMessageAt: now }).where(eq(channels.id, channel.id))
      // The sender has obviously read up to their own message.
      await tx
        .update(channelMembers)
        .set({ lastReadMessageId: id, lastReadAt: now })
        .where(
          and(eq(channelMembers.channelId, channel.id), eq(channelMembers.userId, scope.userId)),
        )
    }

    await tx
      .delete(drafts)
      .where(
        and(
          eq(drafts.userId, scope.userId),
          eq(drafts.channelId, channel.id),
          parent ? eq(drafts.parentId, parent.id) : isNull(drafts.parentId),
        ),
      )
    return m!
  })

  if (input.kind !== 'bot') {
    await coinsForMessage(ctx, scope.userId, !!swears)
    await recordSwears(
      ctx,
      {
        orgId: scope.orgId,
        userId: scope.userId,
        channelId: channel.id,
        messageId: row.id,
        source: 'message',
      },
      swears,
    )
  }

  // DMs and groups that people had hidden reappear when someone writes.
  if (channel.kind === 'dm' || channel.kind === 'group') {
    const unhidden = await ctx.db
      .update(channelMembers)
      .set({ hidden: false })
      .where(and(eq(channelMembers.channelId, channel.id), eq(channelMembers.hidden, true)))
      .returning({ userId: channelMembers.userId })
    for (const u of unhidden) await publishChannelJoined(ctx, scope.orgId, channel.id, u.userId)
  }

  const message = await serializeMessage(ctx, scope.userId, row)
  await ctx.bus.publish(topics.channel(channel.id), {
    type: 'message.created',
    orgId: scope.orgId,
    message,
  })
  if (parent) await publishThreadUpdated(ctx, scope.orgId, parent.id)

  await notifyForMessage(ctx, {
    channel,
    message,
    parent,
    mentionedIds: notifyIds,
    members: memberSet,
  })
  await enqueueOutgoingWebhooks(ctx, scope.orgId, 'message.created', {
    channelId: channel.id,
    message,
  })
  await emitHook(ctx, 'messageCreated', {
    orgId: scope.orgId,
    channel,
    message,
    byBot: input.kind === 'bot',
  })
  await enqueuePluginEvents(ctx, scope.orgId, {
    id: message.id,
    channelId: channel.id,
    authorId: scope.userId,
    authorName: message.author ? message.author.displayName || message.author.name : null,
    text,
    threadId: parent?.id ?? null,
    createdAt: message.createdAt,
  })
  return message
}

export async function publishThreadUpdated(ctx: AppContext, orgId: string, rootId: string) {
  const root = await ctx.db.query.messages.findFirst({ where: eq(messages.id, rootId) })
  if (!root) return
  // Viewer-specific fields (bookmarked) are left false; clients keep their own.
  const message = await serializeMessage(ctx, '00000000-0000-0000-0000-000000000000', root)
  await ctx.bus.publish(topics.channel(root.channelId), {
    type: 'thread.updated',
    orgId,
    channelId: root.channelId,
    message,
  })
}

/** Small automated notices ("Ada joined the channel"). */
export async function postSystemMessage(
  ctx: AppContext,
  orgId: string,
  channelId: string,
  actorId: string | null,
  text: string,
) {
  const body = textToDoc(text)
  const [row] = await ctx.db
    .insert(messages)
    .values({ orgId, channelId, authorId: actorId, kind: 'system', bodyJson: body, bodyText: text })
    .returning()
  const message = await serializeMessage(
    ctx,
    actorId ?? '00000000-0000-0000-0000-000000000000',
    row!,
  )
  await ctx.bus.publish(topics.channel(channelId), { type: 'message.created', orgId, message })
}

export async function markRead(
  ctx: AppContext,
  scope: OrgScope,
  channelId: string,
  messageId: string,
) {
  const [updated] = await ctx.db
    .update(channelMembers)
    .set({ lastReadMessageId: messageId, lastReadAt: new Date() })
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.userId, scope.userId),
        or(
          isNull(channelMembers.lastReadMessageId),
          lt(channelMembers.lastReadMessageId, messageId),
        ),
      ),
    )
    .returning({ channelId: channelMembers.channelId })
  if (updated) {
    await ctx.bus.publish(topics.user(scope.userId), {
      type: 'read.updated',
      orgId: scope.orgId,
      channelId,
      messageId,
    })
  }
  return !!updated
}

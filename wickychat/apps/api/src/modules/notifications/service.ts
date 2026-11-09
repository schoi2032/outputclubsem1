/**
 * Notification fan-out. In-app delivery happens here; email, push and
 * integration channels can be added as additional `Deliverer`s without
 * touching messaging code.
 */
import { channelMembers, notificationPreferences, notifications, users } from '@quid/db'
import type { Message, Notification, NotificationKind, NotificationPrefs } from '@quid/shared'
import { topics } from '@quid/shared'
import { and, eq, inArray } from 'drizzle-orm'
import type { AppContext } from '../../core/context'
import type { ChannelRow } from '../channels/service'
import type { MessageRow } from '../messages/service'
import { toUserSummary, userCols } from '../users/serialize'

export const DEFAULT_PREFS: NotificationPrefs = {
  directMessages: true,
  mentions: true,
  threadReplies: true,
  channelActivity: false,
  announcements: true,
  emailDigest: false,
  emailOffline: true,
  muteAll: false,
}

export interface NotificationInput {
  orgId: string
  userId: string
  kind: NotificationKind
  actorId: string | null
  channelId: string | null
  messageId: string | null
  threadId: string | null
  title: string
  preview: string
  link?: string
}

/** Extension point for email / push / integrations. */
export interface Deliverer {
  deliver(ctx: AppContext, n: Notification & { userId: string; orgId: string }): Promise<void>
}
const deliverers: Deliverer[] = []
export function registerDeliverer(d: Deliverer) {
  deliverers.push(d)
}

export async function loadPrefs(ctx: AppContext, orgId: string, userIds: string[]) {
  const out = new Map<string, NotificationPrefs>()
  if (!userIds.length) return out
  const rows = await ctx.db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.orgId, orgId),
        inArray(notificationPreferences.userId, userIds),
      ),
    )
  for (const id of userIds) out.set(id, { ...DEFAULT_PREFS })
  for (const r of rows) {
    out.set(r.userId, {
      directMessages: r.directMessages,
      mentions: r.mentions,
      threadReplies: r.threadReplies,
      channelActivity: r.channelActivity,
      announcements: r.announcements,
      emailDigest: r.emailDigest,
      emailOffline: r.emailOffline,
      muteAll: r.muteAll,
    })
  }
  return out
}

const PREF_FOR: Record<NotificationKind, keyof NotificationPrefs | null> = {
  mention: 'mentions',
  direct_message: 'directMessages',
  thread_reply: 'threadReplies',
  channel_activity: 'channelActivity',
  announcement: 'announcements',
  invitation: null,
  incoming_call: null,
  missed_call: null,
  meeting_invite: null,
  task_assigned: null,
  task_due: null,
  reminder: null,
}

export async function createNotifications(ctx: AppContext, items: NotificationInput[]) {
  if (!items.length) return
  const orgId = items[0]!.orgId
  const prefs = await loadPrefs(ctx, orgId, [...new Set(items.map((i) => i.userId))])
  const allowed = items.filter((i) => {
    const p = prefs.get(i.userId) ?? DEFAULT_PREFS
    // Reminders are ones you set yourself, so they come through even when muted.
    if (p.muteAll && i.kind !== 'announcement' && i.kind !== 'reminder') return false
    const key = PREF_FOR[i.kind]
    return key ? p[key] !== false : true
  })
  if (!allowed.length) return

  const rows = await ctx.db
    .insert(notifications)
    .values(
      allowed.map(({ link, ...i }) => ({
        ...i,
        data: link ? { link } : {},
        groupKey: `${i.kind}:${i.channelId ?? ''}:${i.threadId ?? ''}`,
      })),
    )
    .returning()

  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))]
  const actors = actorIds.length
    ? await ctx.db.select(userCols).from(users).where(inArray(users.id, actorIds))
    : []
  const actorMap = new Map(actors.map((a) => [a.id, toUserSummary(a)]))

  for (const r of rows) {
    const n = serializeNotification(r, r.actorId ? (actorMap.get(r.actorId) ?? null) : null, null)
    await ctx.bus.publish(topics.user(r.userId), {
      type: 'notification.created',
      orgId: r.orgId,
      notification: n,
    })
    for (const d of deliverers) {
      await d
        .deliver(ctx, { ...n, userId: r.userId, orgId: r.orgId })
        .catch((err) => ctx.log.warn({ err }, 'deliverer failed'))
    }
  }
}

export function serializeNotification(
  r: typeof notifications.$inferSelect,
  actor: Notification['actor'],
  channelName: string | null,
): Notification {
  return {
    id: r.id,
    kind: r.kind as NotificationKind,
    actor,
    channelId: r.channelId,
    channelName,
    messageId: r.messageId,
    threadId: r.threadId,
    title: r.title,
    preview: r.preview,
    groupKey: r.groupKey,
    link: typeof r.data?.link === 'string' ? r.data.link : null,
    readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

const preview = (m: Message) => {
  const t =
    m.text ||
    (m.attachments.length
      ? `Shared ${m.attachments.length === 1 ? 'a file' : `${m.attachments.length} files`}`
      : '')
  return t.length > 180 ? `${t.slice(0, 177)}…` : t
}

export async function notifyForMessage(
  ctx: AppContext,
  opts: {
    channel: ChannelRow
    message: Message
    parent?: MessageRow
    mentionedIds: Set<string>
    members: Set<string>
  },
) {
  const { channel, message, parent, mentionedIds, members } = opts
  if (message.kind === 'system') return
  const authorId = message.author.id
  const settings = await ctx.db
    .select({
      userId: channelMembers.userId,
      muted: channelMembers.muted,
      notifyLevel: channelMembers.notifyLevel,
    })
    .from(channelMembers)
    .where(eq(channelMembers.channelId, channel.id))
  const setting = new Map(settings.map((s) => [s.userId, s]))

  const isDirect = channel.kind === 'dm' || channel.kind === 'group'
  const where = isDirect ? 'a direct message' : `#${channel.name}`
  const out = new Map<string, NotificationInput>()
  const add = (userId: string, kind: NotificationKind, title: string) => {
    if (userId === authorId || out.has(userId) || !members.has(userId)) return
    const s = setting.get(userId)
    if (!s || s.notifyLevel === 'none') return
    if (
      (s.muted || s.notifyLevel === 'mentions') &&
      kind !== 'mention' &&
      kind !== 'thread_reply' &&
      !isDirect
    )
      return
    out.set(userId, {
      orgId: channel.orgId,
      userId,
      kind,
      actorId: authorId,
      channelId: channel.id,
      messageId: message.id,
      threadId: parent?.id ?? null,
      title,
      preview: preview(message),
    })
  }

  const name = message.author.displayName || message.author.name
  for (const id of mentionedIds) add(id, 'mention', `${name} mentioned you in ${where}`)

  if (parent) {
    const participants = new Set(
      [parent.authorId, ...parent.replyUserIds].filter((x): x is string => !!x),
    )
    for (const id of participants)
      add(id, 'thread_reply', `${name} replied to a thread in ${where}`)
  } else if (isDirect) {
    for (const id of members) add(id, 'direct_message', `${name} sent you a message`)
  }

  if (!isDirect && !parent) {
    const prefs = await loadPrefs(
      ctx,
      channel.orgId,
      [...members].filter((id) => !out.has(id) && id !== authorId),
    )
    for (const [id, p] of prefs) {
      if (p.channelActivity && setting.get(id)?.notifyLevel === 'all')
        add(id, 'channel_activity', `New message in ${where}`)
    }
  }

  await createNotifications(ctx, [...out.values()])
}

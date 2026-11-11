/**
 * Email delivery for notifications:
 * - Offline summaries: activity that arrives while you have no WickyChat tab open is
 *   batched into one email a few minutes later (skipped if you've read it by then).
 * - Daily digest: one morning email (08:00 in your time zone) with what's unread.
 */
import {
  channelMembers,
  channels,
  jobs,
  notificationPreferences,
  notifications,
  organizations,
  users,
} from '@quid/db'
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { renderEmail } from '../../adapters/email'
import type { AppContext } from '../../core/context'
import { enqueue, onTick, registerJob } from '../../core/jobs'
import { loadPrefs, registerDeliverer } from './service'

export const OFFLINE_EMAIL_DELAY_MS = 5 * 60_000
const OFFLINE_KINDS = [
  'mention',
  'direct_message',
  'thread_reply',
  'missed_call',
  'meeting_invite',
  'task_assigned',
  'reminder',
]

async function savePrefsField(
  ctx: AppContext,
  userId: string,
  orgId: string,
  set: { lastOfflineEmailAt?: Date; lastDigestAt?: Date },
) {
  await ctx.db
    .insert(notificationPreferences)
    .values({ userId, orgId, ...set })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.orgId],
      set,
    })
}

function itemUrl(ctx: AppContext, slug: string, n: typeof notifications.$inferSelect) {
  const link = typeof n.data?.link === 'string' ? n.data.link : null
  if (link) return `${ctx.config.WEB_ORIGIN}${link}`
  if (n.channelId) {
    const q = n.threadId ? `?thread=${n.threadId}` : n.messageId ? `?m=${n.messageId}` : ''
    return `${ctx.config.WEB_ORIGIN}/${slug}/c/${n.channelId}${q}`
  }
  return `${ctx.config.WEB_ORIGIN}/${slug}/activity`
}

async function sendOfflineSummary(ctx: AppContext, userId: string, orgId: string) {
  // Still (or again) connected: they'll see it in the app.
  if (ctx.online.isOnline(userId)) return
  const prefs = (await loadPrefs(ctx, orgId, [userId])).get(userId)
  if (!prefs?.emailOffline || prefs.muteAll) return
  const row = await ctx.db.query.notificationPreferences.findFirst({
    where: and(
      eq(notificationPreferences.userId, userId),
      eq(notificationPreferences.orgId, orgId),
    ),
  })
  const since = new Date(
    Math.max(row?.lastOfflineEmailAt?.getTime() ?? 0, Date.now() - 24 * 3600_000),
  )
  const unread = await ctx.db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.orgId, orgId),
        isNull(notifications.readAt),
        inArray(notifications.kind, OFFLINE_KINDS),
        gt(notifications.createdAt, since),
      ),
    )
    .orderBy(desc(notifications.id))
    .limit(10)
  if (!unread.length) return
  const user = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) })
  const org = await ctx.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) })
  if (!user || !org || user.isBot) return
  await ctx.email.send({
    to: user.email,
    subject:
      unread.length === 1
        ? `${unread[0]!.title} · ${org.name}`
        : `${unread.length} new notifications in ${org.name}`,
    ...renderEmail({
      heading:
        unread.length === 1
          ? 'You have a new notification'
          : `You have ${unread.length} new notifications`,
      body: `Here's what happened in ${org.name} while you were away.`,
      items: unread.map((n) => ({
        title: n.title,
        detail: n.preview || undefined,
        url: itemUrl(ctx, org.slug, n),
      })),
      cta: { label: 'Open WickyChat', url: `${ctx.config.WEB_ORIGIN}/${org.slug}/activity` },
      footer: `Turn these emails off in Settings → Notifications: ${ctx.config.WEB_ORIGIN}/${org.slug}/settings/notifications`,
    }),
  })
  await savePrefsField(ctx, userId, orgId, { lastOfflineEmailAt: new Date() })
}

registerJob('notify.offline_email', async (ctx, payload) => {
  await sendOfflineSummary(ctx, String(payload.userId), String(payload.orgId))
})

/** Local hour (0-23) in an IANA time zone; falls back to UTC. */
export function localHour(now: Date, timeZone: string | null) {
  try {
    return Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: timeZone ?? 'UTC',
      }).format(now),
    )
  } catch {
    return now.getUTCHours()
  }
}

/** Sends due digests. Runs on every scheduler tick; cheap when nothing is due. */
export async function sendDigests(ctx: AppContext, now = new Date()) {
  const due = await ctx.db
    .select({
      userId: notificationPreferences.userId,
      orgId: notificationPreferences.orgId,
      tz: users.timezone,
      email: users.email,
    })
    .from(notificationPreferences)
    .innerJoin(users, eq(users.id, notificationPreferences.userId))
    .where(
      and(
        eq(notificationPreferences.emailDigest, true),
        eq(notificationPreferences.muteAll, false),
        or(
          isNull(notificationPreferences.lastDigestAt),
          lt(notificationPreferences.lastDigestAt, new Date(now.getTime() - 20 * 3600_000)),
        ),
      ),
    )
    .limit(500)
  for (const d of due) {
    const hour = localHour(now, d.tz)
    if (hour < 8 || hour >= 12) continue
    await savePrefsField(ctx, d.userId, d.orgId, { lastDigestAt: now })
    const org = await ctx.db.query.organizations.findFirst({ where: eq(organizations.id, d.orgId) })
    if (!org) continue
    const unread = await ctx.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, d.userId),
          eq(notifications.orgId, d.orgId),
          isNull(notifications.readAt),
        ),
      )
      .orderBy(desc(notifications.id))
      .limit(10)
    const busyChannels = await ctx.db
      .select({
        name: channels.name,
        id: channels.id,
        unread: sql<number>`(select count(*)::int from messages m where m.channel_id = channel_members.channel_id and m.parent_id is null and m.deleted_at is null and m.kind <> 'system' and m.author_id is distinct from channel_members.user_id and (channel_members.last_read_message_id is null or m.id > channel_members.last_read_message_id))`,
      })
      .from(channelMembers)
      .innerJoin(channels, eq(channels.id, channelMembers.channelId))
      .where(
        and(
          eq(channelMembers.userId, d.userId),
          eq(channelMembers.orgId, d.orgId),
          eq(channelMembers.muted, false),
          inArray(channels.kind, ['public', 'private']),
        ),
      )
    const channelsWithUnread = busyChannels
      .filter((c) => c.unread > 0)
      .sort((a, b) => b.unread - a.unread)
      .slice(0, 5)
    if (!unread.length && !channelsWithUnread.length) continue
    await ctx.email
      .send({
        to: d.email,
        subject: `Your daily summary for ${org.name}`,
        ...renderEmail({
          heading: 'Good morning',
          body: `${unread.length ? `${unread.length} unread notification${unread.length === 1 ? '' : 's'}` : 'No new notifications'}${channelsWithUnread.length ? ` and new messages in ${channelsWithUnread.length} channel${channelsWithUnread.length === 1 ? '' : 's'}` : ''}.`,
          items: [
            ...unread.map((n) => ({
              title: n.title,
              detail: n.preview || undefined,
              url: itemUrl(ctx, org.slug, n),
            })),
            ...channelsWithUnread.map((c) => ({
              title: `#${c.name}`,
              detail: `${c.unread >= 100 ? '99+' : c.unread} unread`,
              url: `${ctx.config.WEB_ORIGIN}/${org.slug}/c/${c.id}`,
            })),
          ],
          cta: { label: 'Open WickyChat', url: `${ctx.config.WEB_ORIGIN}/${org.slug}` },
          footer: `Turn the daily summary off in Settings → Notifications.`,
        }),
      })
      .catch((err) => ctx.log.warn({ err }, 'digest email failed'))
  }
}

let installed = false

export function installEmailNotifications() {
  if (installed) return
  installed = true
  registerDeliverer({
    async deliver(ctx, n) {
      if (!OFFLINE_KINDS.includes(n.kind) || ctx.online.isOnline(n.userId)) return
      // One pending summary per person and organization.
      const [pending] = await ctx.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.kind, 'notify.offline_email'),
            eq(jobs.status, 'pending'),
            sql`${jobs.payload}->>'userId' = ${n.userId}`,
            sql`${jobs.payload}->>'orgId' = ${n.orgId}`,
          ),
        )
        .limit(1)
      if (!pending)
        await enqueue(
          ctx,
          'notify.offline_email',
          { userId: n.userId, orgId: n.orgId },
          new Date(Date.now() + OFFLINE_EMAIL_DELAY_MS),
        )
    },
  })
  onTick((ctx) => sendDigests(ctx))
}

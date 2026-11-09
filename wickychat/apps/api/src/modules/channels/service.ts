import { channelMembers, channels, orgMemberships, users } from '@quid/db'
import type { Channel, ChannelAction, ChannelRole, UserSummary } from '@quid/shared'
import { canInChannel } from '@quid/shared'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { OrgScope } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { forbidden, notFound } from '../../core/errors'
import { avatarUrl, toUserSummary, userCols } from '../users/serialize'

export type ChannelRow = typeof channels.$inferSelect
export type MemberRow = typeof channelMembers.$inferSelect

export interface ChannelAccess {
  channel: ChannelRow
  membership: MemberRow | null
}

/**
 * Loads a channel the caller may read, or throws 404. Channels in other orgs,
 * private channels the caller isn't in, and (for guests) public channels they
 * weren't added to are all indistinguishable from missing ones.
 */
export async function getChannelAccess(
  ctx: AppContext,
  scope: OrgScope,
  channelId: string,
): Promise<ChannelAccess> {
  const rows = await ctx.db
    .select({ channel: channels, membership: channelMembers })
    .from(channels)
    .leftJoin(
      channelMembers,
      and(eq(channelMembers.channelId, channels.id), eq(channelMembers.userId, scope.userId)),
    )
    .where(and(eq(channels.id, channelId), eq(channels.orgId, scope.orgId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw notFound('Channel')
  const access = { channel: row.channel, membership: row.membership }
  if (!check(scope, access, 'read')) throw notFound('Channel')
  return access
}

export function check(scope: OrgScope, a: ChannelAccess, action: ChannelAction): boolean {
  return canInChannel(
    {
      orgRole: scope.role,
      kind: a.channel.kind,
      channelRole: (a.membership?.role as ChannelRole | undefined) ?? null,
      archived: a.channel.archivedAt !== null,
      postingPolicy: a.channel.postingPolicy,
      membersCanInvite: a.channel.membersCanInvite,
    },
    action,
  )
}

export async function requireChannel(
  ctx: AppContext,
  scope: OrgScope,
  channelId: string,
  action: ChannelAction,
) {
  const a = await getChannelAccess(ctx, scope, channelId)
  if (action !== 'read' && !check(scope, a, action)) {
    if ((action === 'post' || action === 'reply') && a.channel.archivedAt)
      throw forbidden('This channel is archived.')
    if (action === 'post' && a.channel.postingPolicy === 'admins')
      throw forbidden('Only channel admins can post here.')
    if ((action === 'post' || action === 'reply') && !a.membership)
      throw forbidden('Join the channel to post.')
    throw forbidden()
  }
  return a
}

/** Member ids of a channel. */
export async function channelMemberIds(ctx: AppContext, channelId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(eq(channelMembers.channelId, channelId))
  return rows.map((r) => r.userId)
}

/** Serializes channels for one viewer, including unread and mention counts. */
export async function serializeChannels(
  ctx: AppContext,
  viewerId: string,
  rows: ChannelRow[],
): Promise<Channel[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)

  const memberships = await ctx.db
    .select({
      channelId: channelMembers.channelId,
      role: channelMembers.role,
      muted: channelMembers.muted,
      notifyLevel: channelMembers.notifyLevel,
      lastReadMessageId: channelMembers.lastReadMessageId,
      // Columns are written out qualified: inside a correlated subquery an
      // unqualified "channel_id" would bind to the inner table instead.
      unread: sql<number>`(
        select count(*)::int from (
          select 1 from messages m
          where m.channel_id = channel_members.channel_id
            and m.parent_id is null and m.deleted_at is null and m.kind <> 'system'
            and m.author_id is distinct from channel_members.user_id
            and (channel_members.last_read_message_id is null or m.id > channel_members.last_read_message_id)
          limit 100
        ) x)`,
      mentions: sql<number>`(
        select count(*)::int from mentions mn
        where mn.channel_id = channel_members.channel_id and mn.user_id = channel_members.user_id
          and (channel_members.last_read_message_id is null or mn.message_id > channel_members.last_read_message_id))`,
    })
    .from(channelMembers)
    .where(and(eq(channelMembers.userId, viewerId), inArray(channelMembers.channelId, ids)))
  const byChannel = new Map(memberships.map((m) => [m.channelId, m]))

  const counts = await ctx.db
    .select({ channelId: channelMembers.channelId, n: sql<number>`count(*)::int` })
    .from(channelMembers)
    .where(inArray(channelMembers.channelId, ids))
    .groupBy(channelMembers.channelId)
  const countBy = new Map(counts.map((c) => [c.channelId, c.n]))

  // Participants for DMs and groups.
  const directIds = rows.filter((r) => r.kind === 'dm' || r.kind === 'group').map((r) => r.id)
  const participants = new Map<string, UserSummary[]>()
  if (directIds.length) {
    const ps = await ctx.db
      .select({ channelId: channelMembers.channelId, user: userCols })
      .from(channelMembers)
      .innerJoin(users, eq(users.id, channelMembers.userId))
      .where(inArray(channelMembers.channelId, directIds))
      .orderBy(users.name)
    for (const p of ps) {
      const list = participants.get(p.channelId) ?? []
      list.push(toUserSummary(p.user))
      participants.set(p.channelId, list)
    }
  }

  return rows.map((r) => {
    const m = byChannel.get(r.id)
    let ps = participants.get(r.id)
    if (r.kind === 'dm' && ps && ps.length > 1) ps = ps.filter((p) => p.id !== viewerId)
    return {
      id: r.id,
      kind: r.kind,
      isDefault: r.isDefault,
      name: r.name,
      topic: r.topic,
      description: r.description,
      departmentId: r.departmentId,
      teamId: r.teamId,
      postingPolicy: r.postingPolicy,
      membersCanInvite: r.membersCanInvite,
      archivedAt: r.archivedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy,
      memberCount: countBy.get(r.id) ?? 0,
      avatarUrl: avatarUrl(r.avatarKey),
      ...(ps && { participants: ps }),
      membership: m
        ? {
            role: m.role,
            muted: m.muted,
            notifyLevel: m.notifyLevel,
            lastReadMessageId: m.lastReadMessageId,
            unreadCount: m.unread,
            mentionCount: m.mentions,
          }
        : null,
      lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
    }
  })
}

export async function serializeChannel(
  ctx: AppContext,
  viewerId: string,
  row: ChannelRow,
): Promise<Channel> {
  const [c] = await serializeChannels(ctx, viewerId, [row])
  return c!
}

/** Verifies every id belongs to an active member of the org. */
export async function assertOrgMembers(ctx: AppContext, orgId: string, userIds: string[]) {
  const unique = [...new Set(userIds)]
  if (unique.length === 0) return []
  const rows = await ctx.db
    .select({ userId: orgMemberships.userId, role: orgMemberships.role })
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.orgId, orgId),
        inArray(orgMemberships.userId, unique),
        isNull(orgMemberships.deactivatedAt),
      ),
    )
  if (rows.length !== unique.length) throw notFound('User')
  return rows
}

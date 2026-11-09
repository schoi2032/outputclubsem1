/**
 * Persistent voice rooms: one per channel, always available. People drop in
 * and out without ringing anyone.
 *
 * Modes: `open` lets everyone talk; `stage` lets only speakers talk, while
 * listeners can raise a hand and be promoted by a moderator. Speaking rights
 * are enforced by the media server (publish permission), not just the UI.
 */
import { users, voiceRoomParticipants, voiceRooms } from '@quid/db'
import type { VoiceRoom, VoiceRoomJoinInfo } from '@quid/shared'
import { topics } from '@quid/shared'
import { and, eq, inArray } from 'drizzle-orm'
import type { OrgScope } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, forbidden, notFound, unprocessable } from '../../core/errors'
import { type ChannelAccess, getChannelAccess } from '../channels/service'
import { toUserSummary, userCols } from '../users/serialize'

type RoomRow = typeof voiceRooms.$inferSelect

/** Channel owners/admins, org owners/admins and the room's extra moderators. */
export function isModerator(
  scope: OrgScope,
  access: ChannelAccess,
  room: Pick<RoomRow, 'moderatorIds'>,
) {
  return (
    scope.role === 'owner' ||
    scope.role === 'admin' ||
    access.membership?.role === 'owner' ||
    access.membership?.role === 'admin' ||
    room.moderatorIds.includes(scope.userId)
  )
}

export async function serializeRooms(
  ctx: AppContext,
  rows: RoomRow[],
): Promise<Omit<VoiceRoom, 'canModerate'>[]> {
  if (!rows.length) return []
  const parts = await ctx.db
    .select({ p: voiceRoomParticipants, user: userCols })
    .from(voiceRoomParticipants)
    .innerJoin(users, eq(users.id, voiceRoomParticipants.userId))
    .where(
      inArray(
        voiceRoomParticipants.roomId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(voiceRoomParticipants.joinedAt)
  return rows.map((r) => ({
    id: r.id,
    channelId: r.channelId,
    name: r.name,
    mode: r.mode,
    moderatorIds: r.moderatorIds,
    participants: parts
      .filter((p) => p.p.roomId === r.id)
      .map((p) => ({
        user: toUserSummary(p.user),
        role: p.p.role,
        handRaised: p.p.handRaised,
        joinedAt: p.p.joinedAt.toISOString(),
      })),
  }))
}

async function serializeFor(
  ctx: AppContext,
  scope: OrgScope,
  access: ChannelAccess,
  row: RoomRow,
): Promise<VoiceRoom> {
  const [base] = await serializeRooms(ctx, [row])
  return { ...base!, canModerate: isModerator(scope, access, row) }
}

async function broadcast(ctx: AppContext, row: RoomRow) {
  const [base] = await serializeRooms(ctx, [row])
  await ctx.bus.publish(topics.channel(row.channelId), {
    type: 'voice_room.updated',
    orgId: row.orgId,
    room: { ...base!, canModerate: false },
  })
}

async function access(ctx: AppContext, scope: OrgScope, channelId: string) {
  const a = await getChannelAccess(ctx, scope, channelId)
  if (!a.membership) throw forbidden('Join the channel to use its voice room.')
  return a
}

async function loadRoom(ctx: AppContext, scope: OrgScope, roomId: string) {
  const row = await ctx.db.query.voiceRooms.findFirst({
    where: and(eq(voiceRooms.id, roomId), eq(voiceRooms.orgId, scope.orgId)),
  })
  if (!row) throw notFound('Voice room')
  const a = await getChannelAccess(ctx, scope, row.channelId).catch(() => null)
  if (!a) throw notFound('Voice room')
  return { row, access: a }
}

async function requireModerator(ctx: AppContext, scope: OrgScope, roomId: string) {
  const r = await loadRoom(ctx, scope, roomId)
  if (!isModerator(scope, r.access, r.row)) throw forbidden('Only room moderators can do that.')
  return r
}

/** Gets the channel's room, creating it on first use. */
async function ensureRoom(ctx: AppContext, scope: OrgScope, a: ChannelAccess) {
  const existing = await ctx.db.query.voiceRooms.findFirst({
    where: eq(voiceRooms.channelId, a.channel.id),
  })
  if (existing) return existing
  const name = a.channel.name ? `#${a.channel.name}` : 'Voice room'
  const [row] = await ctx.db
    .insert(voiceRooms)
    .values({
      orgId: scope.orgId,
      channelId: a.channel.id,
      name,
      providerRoom: `room_${a.channel.id}`,
    })
    .onConflictDoNothing()
    .returning()
  return (
    row ??
    (await ctx.db.query.voiceRooms.findFirst({ where: eq(voiceRooms.channelId, a.channel.id) }))!
  )
}

export async function getRoomForChannel(ctx: AppContext, scope: OrgScope, channelId: string) {
  const a = await getChannelAccess(ctx, scope, channelId)
  const row = await ctx.db.query.voiceRooms.findFirst({
    where: eq(voiceRooms.channelId, channelId),
  })
  return row ? serializeFor(ctx, scope, a, row) : null
}

export async function joinRoom(
  ctx: AppContext,
  scope: OrgScope,
  channelId: string,
): Promise<VoiceRoomJoinInfo> {
  if (!ctx.media.configured) throw unprocessable('Voice rooms are not configured on this server.')
  const a = await access(ctx, scope, channelId)
  if (a.channel.kind === 'dm') throw badRequest('Use a call for direct messages.')
  if (a.channel.archivedAt) throw badRequest('This channel is archived.')
  const row = await ensureRoom(ctx, scope, a)
  const mod = isModerator(scope, a, row)
  const existing = await ctx.db.query.voiceRoomParticipants.findFirst({
    where: and(
      eq(voiceRoomParticipants.roomId, row.id),
      eq(voiceRoomParticipants.userId, scope.userId),
    ),
  })
  const role = existing?.role ?? (row.mode === 'open' || mod ? 'speaker' : 'listener')
  if (!existing) {
    await ctx.db
      .insert(voiceRoomParticipants)
      .values({ roomId: row.id, userId: scope.userId, orgId: scope.orgId, role })
  }
  const me = await ctx.db.query.users.findFirst({ where: eq(users.id, scope.userId) })
  const media = await ctx.media.createJoinToken({
    room: row.providerRoom,
    identity: scope.userId,
    name: me?.displayName || me?.name || 'WickyChat user',
    canPublish: role === 'speaker',
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: mod,
  })
  await broadcast(ctx, row)
  return { room: await serializeFor(ctx, scope, a, row), url: media.url, token: media.token }
}

export async function leaveRoom(ctx: AppContext, userId: string, roomId: string) {
  const row = await ctx.db.query.voiceRooms.findFirst({ where: eq(voiceRooms.id, roomId) })
  if (!row) return
  await ctx.db
    .delete(voiceRoomParticipants)
    .where(and(eq(voiceRoomParticipants.roomId, roomId), eq(voiceRoomParticipants.userId, userId)))
  await broadcast(ctx, row)
}

export async function raiseHand(ctx: AppContext, scope: OrgScope, roomId: string, raised: boolean) {
  const { row } = await loadRoom(ctx, scope, roomId)
  const [p] = await ctx.db
    .update(voiceRoomParticipants)
    .set({ handRaised: raised })
    .where(
      and(eq(voiceRoomParticipants.roomId, roomId), eq(voiceRoomParticipants.userId, scope.userId)),
    )
    .returning()
  if (!p) throw badRequest("You're not in this room.")
  await broadcast(ctx, row)
}

export async function setRole(
  ctx: AppContext,
  scope: OrgScope,
  roomId: string,
  userId: string,
  role: 'speaker' | 'listener',
) {
  const { row } = await requireModerator(ctx, scope, roomId)
  const [p] = await ctx.db
    .update(voiceRoomParticipants)
    .set({ role, handRaised: false })
    .where(and(eq(voiceRoomParticipants.roomId, roomId), eq(voiceRoomParticipants.userId, userId)))
    .returning()
  if (!p) throw notFound('Participant')
  // Revoking publish also stops any audio they're sending.
  await ctx.media.setCanPublish(row.providerRoom, userId, role === 'speaker')
  await broadcast(ctx, row)
}

export async function muteParticipant(
  ctx: AppContext,
  scope: OrgScope,
  roomId: string,
  userId: string,
) {
  const { row } = await requireModerator(ctx, scope, roomId)
  await ctx.media.muteMicrophone(row.providerRoom, userId)
}

export async function removeParticipant(
  ctx: AppContext,
  scope: OrgScope,
  roomId: string,
  userId: string,
) {
  const { row } = await requireModerator(ctx, scope, roomId)
  await ctx.media.removeParticipant(row.providerRoom, userId)
  await leaveRoom(ctx, userId, roomId)
}

export async function setMode(
  ctx: AppContext,
  scope: OrgScope,
  roomId: string,
  mode: 'open' | 'stage',
) {
  const { row, access: a } = await requireModerator(ctx, scope, roomId)
  const [updated] = (await ctx.db
    .update(voiceRooms)
    .set({ mode })
    .where(eq(voiceRooms.id, roomId))
    .returning()) as [RoomRow]
  if (mode === 'open') {
    // Everyone becomes a speaker again.
    const listeners = await ctx.db
      .update(voiceRoomParticipants)
      .set({ role: 'speaker', handRaised: false })
      .where(
        and(eq(voiceRoomParticipants.roomId, roomId), eq(voiceRoomParticipants.role, 'listener')),
      )
      .returning({ userId: voiceRoomParticipants.userId })
    for (const l of listeners) await ctx.media.setCanPublish(row.providerRoom, l.userId, true)
  }
  await broadcast(ctx, updated)
  return serializeFor(ctx, scope, a, updated)
}

/** Rooms with people in them, in channels the user belongs to (for sidebar indicators). */
export async function activeRooms(ctx: AppContext, scope: OrgScope) {
  const rows = await ctx.db
    .selectDistinct({ r: voiceRooms })
    .from(voiceRooms)
    .innerJoin(voiceRoomParticipants, eq(voiceRoomParticipants.roomId, voiceRooms.id))
    .where(eq(voiceRooms.orgId, scope.orgId))
  const visible: RoomRow[] = []
  for (const { r } of rows) {
    const a = await getChannelAccess(ctx, scope, r.channelId).catch(() => null)
    if (a?.membership) visible.push(r)
  }
  return serializeRooms(ctx, visible)
}

/** Called when all of a user's connections have dropped. */
export async function leaveAllRooms(ctx: AppContext, userId: string) {
  const rows = await ctx.db
    .select({ roomId: voiceRoomParticipants.roomId })
    .from(voiceRoomParticipants)
    .where(eq(voiceRoomParticipants.userId, userId))
  for (const r of rows) await leaveRoom(ctx, userId, r.roomId)
}

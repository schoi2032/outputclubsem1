/**
 * WickyChat Voice: audio calls in DMs, group conversations and channels.
 *
 * WickyChat owns call state (who was invited, who joined, how it ended). Media
 * flows through the MediaProvider (LiveKit), which only ever sees a room name
 * and short-lived join tokens issued here after a permission check.
 */
import { callParticipants, calls, channelMembers, users } from '@quid/db'
import type { Call, CallParticipantStatus } from '@quid/shared'
import { topics } from '@quid/shared'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { OrgScope } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, notFound, unprocessable } from '../../core/errors'
import { enqueue, registerJob } from '../../core/jobs'
import { type ChannelRow, getChannelAccess } from '../channels/service'
import { postSystemMessage } from '../messages/service'
import { createNotifications } from '../notifications/service'
import { toUserSummary, userCols } from '../users/serialize'

export const RING_TIMEOUT_MS = 45_000
const ONGOING = ['ringing', 'active'] as const

type CallRow = typeof calls.$inferSelect

export async function serializeCalls(ctx: AppContext, rows: CallRow[]): Promise<Call[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const parts = await ctx.db
    .select({ p: callParticipants, user: userCols })
    .from(callParticipants)
    .innerJoin(users, eq(users.id, callParticipants.userId))
    .where(inArray(callParticipants.callId, ids))
  const starterIds = [...new Set(rows.map((r) => r.startedBy).filter((x): x is string => !!x))]
  const starters = starterIds.length
    ? await ctx.db.select(userCols).from(users).where(inArray(users.id, starterIds))
    : []
  const starterMap = new Map(starters.map((u) => [u.id, toUserSummary(u)]))
  return rows.map((r) => ({
    id: r.id,
    channelId: r.channelId,
    kind: r.kind,
    status: r.status,
    startedBy: r.startedBy ? (starterMap.get(r.startedBy) ?? null) : null,
    participants: parts
      .filter((p) => p.p.callId === r.id)
      .map((p) => ({
        user: toUserSummary(p.user),
        status: p.p.status as CallParticipantStatus,
        joinedAt: p.p.joinedAt?.toISOString() ?? null,
        leftAt: p.p.leftAt?.toISOString() ?? null,
      })),
    createdAt: r.createdAt.toISOString(),
    answeredAt: r.answeredAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
  }))
}

async function serializeCall(ctx: AppContext, row: CallRow) {
  return (await serializeCalls(ctx, [row]))[0]!
}

async function loadCall(ctx: AppContext, id: string) {
  const row = await ctx.db.query.calls.findFirst({ where: eq(calls.id, id) })
  if (!row) throw notFound('Call')
  return row
}

/** Sends the current call state to everyone involved and to the channel. */
async function broadcast(ctx: AppContext, row: CallRow) {
  const call = await serializeCall(ctx, row)
  const userTopics = call.participants.map((p) => topics.user(p.user.id))
  await ctx.bus.publish(
    [...userTopics, ...(row.channelId ? [topics.channel(row.channelId)] : [])],
    {
      type: 'call.updated',
      orgId: row.orgId,
      call,
    },
  )
  return call
}

/** The caller must be a member of the conversation. Channel calls are open to all members. */
async function requireCallAccess(ctx: AppContext, scope: OrgScope, row: CallRow) {
  if (row.orgId !== scope.orgId || !row.channelId) throw notFound('Call')
  const a = await getChannelAccess(ctx, scope, row.channelId).catch(() => null)
  if (!a?.membership) throw notFound('Call')
  return a
}

function durationLabel(from: Date, to: Date) {
  const s = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000))
  const m = Math.floor(s / 60)
  return m ? `${m}m ${s % 60}s` : `${s}s`
}

export async function startCall(ctx: AppContext, scope: OrgScope, channel: ChannelRow) {
  if (!ctx.media.configured) throw unprocessable('Voice calls are not configured on this server.')
  if (channel.archivedAt) throw badRequest('This channel is archived.')

  const existing = await ctx.db.query.calls.findFirst({
    where: and(eq(calls.channelId, channel.id), inArray(calls.status, [...ONGOING])),
  })
  if (existing) return { row: existing, created: false }

  const direct = channel.kind === 'dm' || channel.kind === 'group'
  const row = await ctx.db.transaction(async (tx) => {
    const [c] = await tx
      .insert(calls)
      .values({
        orgId: scope.orgId,
        channelId: channel.id,
        kind: channel.kind === 'dm' ? 'direct' : 'group',
        // Conversations ring; channel calls are open rooms people can drop into.
        status: direct ? 'ringing' : 'active',
        answeredAt: direct ? null : new Date(),
        providerRoom: 'pending',
        startedBy: scope.userId,
      })
      .returning()
    await tx
      .update(calls)
      .set({ providerRoom: `call_${c!.id}` })
      .where(eq(calls.id, c!.id))
    const invitees = direct
      ? (
          await tx
            .select({ userId: channelMembers.userId })
            .from(channelMembers)
            .where(eq(channelMembers.channelId, channel.id))
        )
          .map((m) => m.userId)
          .filter((id) => id !== scope.userId)
      : []
    await tx.insert(callParticipants).values([
      { callId: c!.id, userId: scope.userId, orgId: scope.orgId, status: 'invited' as const },
      ...invitees.map((userId) => ({
        callId: c!.id,
        userId,
        orgId: scope.orgId,
        status: 'invited' as const,
      })),
    ])
    return { ...c!, providerRoom: `call_${c!.id}` }
  })

  const call = await serializeCall(ctx, row)
  const invitees = call.participants.filter((p) => p.user.id !== scope.userId && !p.user.isBot)
  if (invitees.length) {
    await ctx.bus.publish(
      invitees.map((p) => topics.user(p.user.id)),
      { type: 'call.ringing', orgId: scope.orgId, call },
    )
    const caller = call.startedBy?.displayName || call.startedBy?.name || 'Someone'
    await createNotifications(
      ctx,
      invitees.map((p) => ({
        orgId: scope.orgId,
        userId: p.user.id,
        kind: 'incoming_call' as const,
        actorId: scope.userId,
        channelId: channel.id,
        messageId: null,
        threadId: null,
        title: `${caller} is calling you`,
        preview: '',
      })),
    )
    await enqueue(
      ctx,
      'call.ring_timeout',
      { callId: row.id },
      new Date(Date.now() + RING_TIMEOUT_MS),
    )
  }
  await postSystemMessage(ctx, scope.orgId, channel.id, scope.userId, 'started a call')
  return { row, created: true }
}

/** Marks the user as joined and issues a media token. */
export async function joinCall(ctx: AppContext, scope: OrgScope, callId: string) {
  const row = await loadCall(ctx, callId)
  await requireCallAccess(ctx, scope, row)
  if (!ONGOING.includes(row.status as (typeof ONGOING)[number]))
    throw badRequest('This call has ended.')
  const now = new Date()
  await ctx.db
    .insert(callParticipants)
    .values({ callId, userId: scope.userId, orgId: scope.orgId, status: 'joined', joinedAt: now })
    .onConflictDoUpdate({
      target: [callParticipants.callId, callParticipants.userId],
      set: { status: 'joined', joinedAt: now, leftAt: null },
    })
  // Someone other than the caller picking up starts the call.
  let updated = row
  if (row.status === 'ringing' && scope.userId !== row.startedBy) {
    ;[updated] = (await ctx.db
      .update(calls)
      .set({ status: 'active', answeredAt: now })
      .where(eq(calls.id, callId))
      .returning()) as [CallRow]
  }
  const me = await ctx.db.query.users.findFirst({ where: eq(users.id, scope.userId) })
  const media = await ctx.media.createJoinToken({
    room: updated.providerRoom,
    identity: scope.userId,
    name: me?.displayName || me?.name || 'WickyChat user',
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: false,
  })
  const call = await broadcast(ctx, updated)
  return { call, url: media.url, token: media.token }
}

export async function declineCall(ctx: AppContext, scope: OrgScope, callId: string) {
  const row = await loadCall(ctx, callId)
  await requireCallAccess(ctx, scope, row)
  await ctx.db
    .update(callParticipants)
    .set({ status: 'declined' })
    .where(
      and(
        eq(callParticipants.callId, callId),
        eq(callParticipants.userId, scope.userId),
        eq(callParticipants.status, 'invited'),
      ),
    )
  const parts = await ctx.db
    .select()
    .from(callParticipants)
    .where(eq(callParticipants.callId, callId))
  const pending = parts.filter((p) => p.userId !== row.startedBy && p.status === 'invited')
  const answered = parts.some((p) => p.userId !== row.startedBy && p.status === 'joined')
  if (row.status === 'ringing' && !pending.length && !answered) {
    return finishCall(ctx, row, 'rejected')
  }
  return broadcast(ctx, row)
}

export async function leaveCall(ctx: AppContext, scope: Pick<OrgScope, 'userId'>, callId: string) {
  const row = await loadCall(ctx, callId)
  await ctx.db
    .update(callParticipants)
    .set({ status: 'left', leftAt: new Date() })
    .where(
      and(
        eq(callParticipants.callId, callId),
        eq(callParticipants.userId, scope.userId),
        inArray(callParticipants.status, ['joined', 'invited']),
      ),
    )
  if (!ONGOING.includes(row.status as (typeof ONGOING)[number])) return serializeCall(ctx, row)
  const remaining = await ctx.db
    .select({ userId: callParticipants.userId })
    .from(callParticipants)
    .where(and(eq(callParticipants.callId, callId), eq(callParticipants.status, 'joined')))
  // A 1:1 call ends when either side hangs up; group calls end when the last person leaves.
  if (!remaining.length || (row.kind === 'direct' && row.status === 'active')) {
    return finishCall(ctx, row, row.answeredAt ? 'ended' : 'missed')
  }
  return broadcast(ctx, row)
}

async function finishCall(ctx: AppContext, row: CallRow, status: 'ended' | 'missed' | 'rejected') {
  const now = new Date()
  const [updated] = (await ctx.db
    .update(calls)
    .set({ status, endedAt: now })
    .where(and(eq(calls.id, row.id), inArray(calls.status, [...ONGOING])))
    .returning()) as [CallRow | undefined]
  if (!updated) return serializeCall(ctx, await loadCall(ctx, row.id))
  await ctx.db
    .update(callParticipants)
    .set({ status: 'left', leftAt: now })
    .where(and(eq(callParticipants.callId, row.id), eq(callParticipants.status, 'joined')))

  if (status === 'missed') {
    const missed = await ctx.db
      .select({ userId: callParticipants.userId })
      .from(callParticipants)
      .where(and(eq(callParticipants.callId, row.id), eq(callParticipants.status, 'invited')))
    const caller = row.startedBy
      ? await ctx.db.query.users.findFirst({ where: eq(users.id, row.startedBy) })
      : null
    await createNotifications(
      ctx,
      missed
        .filter((m) => m.userId !== row.startedBy)
        .map((m) => ({
          orgId: row.orgId,
          userId: m.userId,
          kind: 'missed_call' as const,
          actorId: row.startedBy,
          channelId: row.channelId,
          messageId: null,
          threadId: null,
          title: `Missed call from ${caller?.displayName || caller?.name || 'someone'}`,
          preview: '',
        })),
    )
  }
  if (row.channelId) {
    const text =
      status === 'ended' && updated.answeredAt
        ? `Call ended · ${durationLabel(updated.answeredAt, now)}`
        : status === 'rejected'
          ? 'Call declined'
          : status === 'missed'
            ? 'Missed call'
            : 'Call ended'
    await postSystemMessage(ctx, row.orgId, row.channelId, null, text)
  }
  return broadcast(ctx, updated)
}

/** Ends ringing that nobody answered. */
registerJob('call.ring_timeout', async (ctx, payload) => {
  const row = await ctx.db.query.calls.findFirst({ where: eq(calls.id, String(payload.callId)) })
  if (row?.status === 'ringing') await finishCall(ctx, row, 'missed')
})

/** When someone's last connection drops (closed tab, lost network), they leave their calls. */
export async function leaveAllCalls(ctx: AppContext, userId: string) {
  const joined = await ctx.db
    .select({ callId: callParticipants.callId })
    .from(callParticipants)
    .innerJoin(calls, eq(calls.id, callParticipants.callId))
    .where(
      and(
        eq(callParticipants.userId, userId),
        eq(callParticipants.status, 'joined'),
        inArray(calls.status, [...ONGOING]),
      ),
    )
  for (const j of joined) await leaveCall(ctx, { userId }, j.callId)
}

/** Ongoing calls in conversations the user belongs to. */
export async function activeCallsFor(ctx: AppContext, scope: OrgScope) {
  const rows = await ctx.db
    .select({ c: calls })
    .from(calls)
    .innerJoin(
      channelMembers,
      and(eq(channelMembers.channelId, calls.channelId), eq(channelMembers.userId, scope.userId)),
    )
    .where(
      and(eq(calls.orgId, scope.orgId), inArray(calls.status, [...ONGOING]), isNull(calls.endedAt)),
    )
  return serializeCalls(
    ctx,
    rows.map((r) => r.c),
  )
}

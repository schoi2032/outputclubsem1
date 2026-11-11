/**
 * WickyChat Meet: video meetings with links, waiting rooms and host controls.
 *
 * WickyChat decides who may enter (waiting room, invitations, roles); LiveKit only
 * carries media and accepts tokens issued here. Host actions that affect
 * someone's connection (remove, mute, end) are applied in both places.
 */
import { randomInt } from 'node:crypto'
import {
  meetingGuests,
  meetingParticipants,
  meetings,
  meetingTranscriptSegments,
  organizations,
  users,
} from '@quid/db'
import type {
  Meeting,
  MeetingJoinResult,
  MeetingParticipantStatus,
  MeetingRole,
} from '@quid/shared'
import { topics } from '@quid/shared'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { renderEmail } from '../../adapters/email'
import type { OrgScope } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, forbidden, notFound, unprocessable } from '../../core/errors'
import { emitHook } from '../../core/hooks'
import { assertOrgMembers } from '../channels/service'
import { postSystemMessage } from '../messages/service'
import { createNotifications } from '../notifications/service'
import { toUserSummary, userCols } from '../users/serialize'
import { buildIcs } from './ics'

export type MeetingRow = typeof meetings.$inferSelect
type ParticipantRow = typeof meetingParticipants.$inferSelect

const ALPHABET = 'abcdefghijkmnopqrstuvwxyz'

/** Meeting codes look like `kmt-qrxe-wpa`: easy to read aloud, ~2^56 combinations. */
export function newMeetingCode() {
  const part = (n: number) =>
    Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  return `${part(3)}-${part(4)}-${part(3)}`
}

const isModerator = (role: MeetingRole | null | undefined) => role === 'host' || role === 'co_host'

export async function serializeMeetings(
  ctx: AppContext,
  rows: MeetingRow[],
  viewerId: string,
): Promise<Meeting[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const parts = await ctx.db
    .select({ p: meetingParticipants, user: userCols })
    .from(meetingParticipants)
    .innerJoin(users, eq(users.id, meetingParticipants.userId))
    .where(inArray(meetingParticipants.meetingId, ids))
  const hostIds = [...new Set(rows.map((r) => r.hostId).filter((x): x is string => !!x))]
  const hosts = hostIds.length
    ? await ctx.db.select(userCols).from(users).where(inArray(users.id, hostIds))
    : []
  const hostMap = new Map(hosts.map((h) => [h.id, toUserSummary(h)]))
  const guests = await ctx.db
    .select()
    .from(meetingGuests)
    .where(inArray(meetingGuests.meetingId, ids))
    .orderBy(meetingGuests.createdAt)
  const lineCounts = await ctx.db
    .select({ meetingId: meetingTranscriptSegments.meetingId, n: sql<number>`count(*)::int` })
    .from(meetingTranscriptSegments)
    .where(inArray(meetingTranscriptSegments.meetingId, ids))
    .groupBy(meetingTranscriptSegments.meetingId)
  return rows.map((r) => {
    const mine = parts.filter((p) => p.p.meetingId === r.id)
    const theirGuests = guests.filter((g) => g.meetingId === r.id)
    const live =
      mine.some((p) => p.p.status === 'joined') || theirGuests.some((g) => g.status === 'joined')
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      description: r.description,
      host: r.hostId ? (hostMap.get(r.hostId) ?? null) : null,
      channelId: r.channelId,
      waitingRoom: r.waitingRoom,
      guestAccess: r.guestAccess,
      scheduledFor: r.scheduledFor?.toISOString() ?? null,
      durationMinutes: r.durationMinutes,
      startedAt: r.startedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      status: live ? 'live' : r.endedAt || (r.startedAt && !live) ? 'ended' : 'scheduled',
      participants: mine.map((p) => ({
        user: toUserSummary(p.user),
        role: p.p.role,
        status: p.p.status as MeetingParticipantStatus,
        joinedAt: p.p.joinedAt?.toISOString() ?? null,
        leftAt: p.p.leftAt?.toISOString() ?? null,
      })),
      transcriptLines: lineCounts.find((c) => c.meetingId === r.id)?.n ?? 0,
      guests: theirGuests.map((g) => ({
        id: g.id,
        name: g.name,
        status: g.status,
        joinedAt: g.joinedAt?.toISOString() ?? null,
      })),
      myRole: mine.find((p) => p.p.userId === viewerId)?.p.role ?? null,
    }
  })
}

export async function serializeMeeting(ctx: AppContext, row: MeetingRow, viewerId: string) {
  return (await serializeMeetings(ctx, [row], viewerId))[0]!
}

/** Each viewer gets their own copy (myRole differs), so send per participant. */
export async function broadcastMeeting(ctx: AppContext, row: MeetingRow) {
  const parts = await ctx.db
    .select({ userId: meetingParticipants.userId })
    .from(meetingParticipants)
    .where(eq(meetingParticipants.meetingId, row.id))
  const rows = await serializeMeetings(ctx, [row], '')
  const base = rows[0]!
  await Promise.all(
    parts.map(({ userId }) =>
      ctx.bus.publish(topics.user(userId), {
        type: 'meeting.updated',
        orgId: row.orgId,
        meeting: {
          ...base,
          myRole: base.participants.find((p) => p.user.id === userId)?.role ?? null,
        },
      }),
    ),
  )
}

async function participant(ctx: AppContext, meetingId: string, userId: string) {
  return ctx.db.query.meetingParticipants.findFirst({
    where: and(
      eq(meetingParticipants.meetingId, meetingId),
      eq(meetingParticipants.userId, userId),
    ),
  })
}

export async function findMeeting(ctx: AppContext, scope: OrgScope, idOrCode: string) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrCode)
  const row = await ctx.db.query.meetings.findFirst({
    where: and(
      eq(meetings.orgId, scope.orgId),
      isUuid ? eq(meetings.id, idOrCode) : eq(meetings.code, idOrCode.toLowerCase()),
    ),
  })
  if (!row) throw notFound('Meeting')
  // Guests only see meetings they were invited to.
  if (scope.role === 'guest' && !(await participant(ctx, row.id, scope.userId)))
    throw notFound('Meeting')
  return row
}

async function requireModerator(ctx: AppContext, row: MeetingRow, userId: string) {
  const p = await participant(ctx, row.id, userId)
  if (!isModerator(p?.role)) throw forbidden('Only the host or a co-host can do that.')
  return p!
}

export function meetingLink(ctx: AppContext, orgSlug: string, code: string) {
  return `${ctx.config.WEB_ORIGIN}/${orgSlug}/meet/${code}`
}

async function orgSlug(ctx: AppContext, orgId: string) {
  const o = await ctx.db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { slug: true },
  })
  return o!.slug
}

export async function inviteToMeeting(
  ctx: AppContext,
  scope: OrgScope,
  row: MeetingRow,
  userIds: string[],
  opts: { email: boolean },
) {
  const ids = [...new Set(userIds)].filter((id) => id !== scope.userId)
  if (!ids.length) return
  await assertOrgMembers(ctx, scope.orgId, ids)
  const existing = await ctx.db
    .select({ userId: meetingParticipants.userId, status: meetingParticipants.status })
    .from(meetingParticipants)
    .where(and(eq(meetingParticipants.meetingId, row.id), inArray(meetingParticipants.userId, ids)))
  const fresh = ids.filter((id) => !existing.some((e) => e.userId === id))
  // Re-inviting someone who was removed or denied lets them back in.
  const reinvite = existing
    .filter((e) => e.status === 'removed' || e.status === 'denied' || e.status === 'left')
    .map((e) => e.userId)
  if (fresh.length) {
    await ctx.db.insert(meetingParticipants).values(
      fresh.map((userId) => ({
        meetingId: row.id,
        userId,
        orgId: row.orgId,
        role: 'participant' as const,
        status: 'invited' as const,
      })),
    )
  }
  if (reinvite.length) {
    await ctx.db
      .update(meetingParticipants)
      .set({ status: 'invited' })
      .where(
        and(
          eq(meetingParticipants.meetingId, row.id),
          inArray(meetingParticipants.userId, reinvite),
        ),
      )
  }
  const notify = [...fresh, ...reinvite]
  if (!notify.length) return

  const slug = await orgSlug(ctx, row.orgId)
  const link = meetingLink(ctx, slug, row.code)
  const inviter = await ctx.db.query.users.findFirst({ where: eq(users.id, scope.userId) })
  const who = inviter?.displayName || inviter?.name || 'Someone'
  const when = row.scheduledFor
    ? row.scheduledFor.toLocaleString('en-US', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'UTC',
      }) + ' UTC'
    : null
  await createNotifications(
    ctx,
    notify.map((userId) => ({
      orgId: row.orgId,
      userId,
      kind: 'meeting_invite' as const,
      actorId: scope.userId,
      channelId: null,
      messageId: null,
      threadId: null,
      title: row.scheduledFor
        ? `${who} invited you to "${row.title}"`
        : `${who} invited you to join "${row.title}" now`,
      preview: when ?? 'Happening now',
      link: `/${slug}/meet/${row.code}`,
    })),
  )
  await broadcastMeeting(ctx, row)

  if (opts.email) {
    const recipients = await ctx.db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(inArray(users.id, notify))
    const ics = row.scheduledFor ? await meetingIcs(ctx, row, 'REQUEST') : null
    for (const r of recipients) {
      await ctx.email
        .send({
          to: r.email,
          subject: `Invitation: ${row.title}${when ? ` · ${when}` : ''}`,
          ...(ics && {
            attachments: [
              {
                filename: 'invite.ics',
                content: ics,
                contentType: 'text/calendar; charset=utf-8; method=REQUEST',
              },
            ],
          }),
          ...renderEmail({
            heading: row.title,
            body: `${who} invited you to a WickyChat meeting${when ? ` on ${when}` : ''}.${row.description ? ` ${row.description}` : ''}`,
            cta: { label: 'Join meeting', url: link },
            footer: `Meeting code: ${row.code}`,
          }),
        })
        .catch((err) => ctx.log.warn({ err }, 'meeting invite email failed'))
    }
  }
}

export async function createMeeting(
  ctx: AppContext,
  scope: OrgScope,
  input: {
    title: string
    description: string
    scheduledFor: string | null
    durationMinutes: number
    waitingRoom: boolean
    guestAccess: boolean
    channelId: string | null
    inviteeIds: string[]
  },
) {
  if (!ctx.media.configured) throw unprocessable('Meetings are not configured on this server.')
  if (scope.role === 'guest') throw forbidden('Guests cannot create meetings.')
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null
  if (scheduledFor && scheduledFor.getTime() < Date.now() - 5 * 60_000)
    throw badRequest('Choose a time in the future.')

  let row: MeetingRow | undefined
  for (let attempt = 0; attempt < 5 && !row; attempt++) {
    const code = newMeetingCode()
    ;[row] = await ctx.db
      .insert(meetings)
      .values({
        orgId: scope.orgId,
        code,
        title: input.title,
        description: input.description,
        hostId: scope.userId,
        channelId: input.channelId,
        waitingRoom: input.waitingRoom,
        guestAccess: input.guestAccess,
        scheduledFor,
        durationMinutes: input.durationMinutes,
        providerRoom: `meet_${code}`,
      })
      .onConflictDoNothing()
      .returning()
  }
  if (!row) throw new Error('Could not allocate a meeting code')
  await ctx.db.insert(meetingParticipants).values({
    meetingId: row.id,
    userId: scope.userId,
    orgId: scope.orgId,
    role: 'host',
    status: 'invited',
  })
  await inviteToMeeting(ctx, scope, row, input.inviteeIds, { email: !!scheduledFor })
  return row
}

/**
 * Enter a meeting. Moderators, invitees and people already admitted go straight in;
 * everyone else waits for a moderator when the waiting room is on.
 */
export async function joinMeeting(
  ctx: AppContext,
  scope: OrgScope,
  row: MeetingRow,
): Promise<MeetingJoinResult> {
  if (!ctx.media.configured) throw unprocessable('Meetings are not configured on this server.')
  let p = await participant(ctx, row.id, scope.userId)
  if (p?.status === 'removed') throw forbidden('The host removed you from this meeting.')

  const direct =
    isModerator(p?.role) ||
    p?.status === 'invited' ||
    p?.status === 'joined' ||
    (p?.status === 'left' && !!p.joinedAt) ||
    !row.waitingRoom
  const now = new Date()
  if (!direct) {
    if (!p) {
      await ctx.db.insert(meetingParticipants).values({
        meetingId: row.id,
        userId: scope.userId,
        orgId: scope.orgId,
        role: 'participant',
        status: 'waiting',
      })
    } else if (p.status !== 'waiting') {
      await ctx.db
        .update(meetingParticipants)
        .set({ status: 'waiting' })
        .where(
          and(
            eq(meetingParticipants.meetingId, row.id),
            eq(meetingParticipants.userId, scope.userId),
          ),
        )
    }
    await broadcastMeeting(ctx, row)
    return { status: 'waiting', meeting: await serializeMeeting(ctx, row, scope.userId) }
  }

  if (!p) {
    ;[p] = await ctx.db
      .insert(meetingParticipants)
      .values({
        meetingId: row.id,
        userId: scope.userId,
        orgId: scope.orgId,
        role: 'participant',
        status: 'joined',
        joinedAt: now,
      })
      .returning()
  } else {
    await ctx.db
      .update(meetingParticipants)
      .set({ status: 'joined', joinedAt: now, leftAt: null })
      .where(
        and(
          eq(meetingParticipants.meetingId, row.id),
          eq(meetingParticipants.userId, scope.userId),
        ),
      )
  }
  const firstStart = !row.startedAt
  const [updated] = (await ctx.db
    .update(meetings)
    .set({ startedAt: row.startedAt ?? now, endedAt: null })
    .where(eq(meetings.id, row.id))
    .returning()) as [MeetingRow]
  if (firstStart && row.channelId) {
    const slug = await orgSlug(ctx, row.orgId)
    await postSystemMessage(
      ctx,
      row.orgId,
      row.channelId,
      scope.userId,
      `started a meeting: ${row.title} · ${meetingLink(ctx, slug, row.code)}`,
    )
  }

  const me = await ctx.db.query.users.findFirst({ where: eq(users.id, scope.userId) })
  const media = await ctx.media.createJoinToken({
    room: row.providerRoom,
    identity: scope.userId,
    name: me?.displayName || me?.name || 'WickyChat user',
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: isModerator(p!.role),
  })
  await broadcastMeeting(ctx, updated)
  return {
    status: 'joined',
    meeting: await serializeMeeting(ctx, updated, scope.userId),
    url: media.url,
    token: media.token,
  }
}

export async function admit(
  ctx: AppContext,
  scope: OrgScope,
  row: MeetingRow,
  userId: string,
  allow: boolean,
) {
  await requireModerator(ctx, row, scope.userId)
  const [p] = await ctx.db
    .update(meetingParticipants)
    // "invited" lets them in on their next join call without waiting again.
    .set({ status: allow ? 'invited' : 'denied' })
    .where(
      and(
        eq(meetingParticipants.meetingId, row.id),
        eq(meetingParticipants.userId, userId),
        eq(meetingParticipants.status, 'waiting'),
      ),
    )
    .returning()
  if (!p) throw notFound('Waiting participant')
  await broadcastMeeting(ctx, row)
}

export async function removeFromMeeting(
  ctx: AppContext,
  scope: OrgScope,
  row: MeetingRow,
  userId: string,
) {
  await requireModerator(ctx, row, scope.userId)
  if (userId === row.hostId) throw forbidden("The host can't be removed.")
  await ctx.db
    .update(meetingParticipants)
    .set({ status: 'removed', leftAt: new Date() })
    .where(and(eq(meetingParticipants.meetingId, row.id), eq(meetingParticipants.userId, userId)))
  await ctx.media.removeParticipant(row.providerRoom, userId)
  await broadcastMeeting(ctx, row)
  await maybeEnd(ctx, row)
}

export async function muteInMeeting(
  ctx: AppContext,
  scope: OrgScope,
  row: MeetingRow,
  userId: string,
) {
  await requireModerator(ctx, row, scope.userId)
  await ctx.media.muteMicrophone(row.providerRoom, userId)
}

export async function setMeetingRole(
  ctx: AppContext,
  scope: OrgScope,
  row: MeetingRow,
  userId: string,
  role: 'co_host' | 'participant',
) {
  await requireModerator(ctx, row, scope.userId)
  if (userId === row.hostId) throw forbidden("The host's role can't be changed.")
  const [p] = await ctx.db
    .update(meetingParticipants)
    .set({ role })
    .where(and(eq(meetingParticipants.meetingId, row.id), eq(meetingParticipants.userId, userId)))
    .returning()
  if (!p) throw notFound('Participant')
  await broadcastMeeting(ctx, row)
}

export async function leaveMeeting(ctx: AppContext, userId: string, row: MeetingRow) {
  await ctx.db
    .update(meetingParticipants)
    .set({ status: 'left', leftAt: new Date() })
    .where(
      and(
        eq(meetingParticipants.meetingId, row.id),
        eq(meetingParticipants.userId, userId),
        inArray(meetingParticipants.status, ['joined', 'waiting']),
      ),
    )
  await broadcastMeeting(ctx, row)
  await maybeEnd(ctx, row)
}

/** A meeting ends when the last person leaves. Its link keeps working to start it again. */
async function maybeEnd(ctx: AppContext, row: MeetingRow) {
  const [{ n }] = (await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(meetingParticipants)
    .where(
      and(eq(meetingParticipants.meetingId, row.id), eq(meetingParticipants.status, 'joined')),
    )) as [{ n: number }]
  const [{ g }] = (await ctx.db
    .select({ g: sql<number>`count(*)::int` })
    .from(meetingGuests)
    .where(and(eq(meetingGuests.meetingId, row.id), eq(meetingGuests.status, 'joined')))) as [
    { g: number },
  ]
  if (n > 0 || g > 0) return
  // Nobody from the organization or outside is left: close any guest waiting list too.
  await ctx.db
    .update(meetingGuests)
    .set({ status: 'left', leftAt: new Date() })
    .where(
      and(
        eq(meetingGuests.meetingId, row.id),
        inArray(meetingGuests.status, ['waiting', 'admitted']),
      ),
    )
  const [updated] = (await ctx.db
    .update(meetings)
    .set({ endedAt: new Date() })
    .where(and(eq(meetings.id, row.id), isNull(meetings.endedAt)))
    .returning()) as [MeetingRow | undefined]
  if (updated) {
    await broadcastMeeting(ctx, updated)
    await emitHook(ctx, 'meetingEnded', { orgId: updated.orgId, meetingId: updated.id })
  }
}

export async function endMeeting(ctx: AppContext, scope: OrgScope, row: MeetingRow) {
  await requireModerator(ctx, row, scope.userId)
  const now = new Date()
  await ctx.db
    .update(meetingParticipants)
    .set({ status: 'left', leftAt: now })
    .where(
      and(
        eq(meetingParticipants.meetingId, row.id),
        inArray(meetingParticipants.status, ['joined', 'waiting']),
      ),
    )
  const [updated] = (await ctx.db
    .update(meetings)
    .set({ endedAt: now })
    .where(eq(meetings.id, row.id))
    .returning()) as [MeetingRow]
  await ctx.db
    .update(meetingGuests)
    .set({ status: 'left', leftAt: now })
    .where(
      and(
        eq(meetingGuests.meetingId, row.id),
        inArray(meetingGuests.status, ['waiting', 'admitted', 'joined']),
      ),
    )
  await ctx.media.endRoom(row.providerRoom)
  await broadcastMeeting(ctx, updated)
  if (!row.endedAt) await emitHook(ctx, 'meetingEnded', { orgId: row.orgId, meetingId: row.id })
}

/** Meetings the user hosts, was invited to or attended. */
export async function meetingsFor(ctx: AppContext, scope: OrgScope) {
  const rows = await ctx.db
    .selectDistinct({ m: meetings })
    .from(meetings)
    .innerJoin(meetingParticipants, eq(meetingParticipants.meetingId, meetings.id))
    .where(
      and(
        eq(meetings.orgId, scope.orgId),
        or(eq(meetingParticipants.userId, scope.userId), eq(meetings.hostId, scope.userId)),
      ),
    )
  return rows.map((r) => r.m).filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i)
}

/** Leaves meetings for someone whose connections all dropped (see app.ts). */
export async function leaveAllMeetings(ctx: AppContext, userId: string) {
  const rows = await ctx.db
    .select({ m: meetings })
    .from(meetingParticipants)
    .innerJoin(meetings, eq(meetings.id, meetingParticipants.meetingId))
    .where(
      and(
        eq(meetingParticipants.userId, userId),
        inArray(meetingParticipants.status, ['joined', 'waiting']),
      ),
    )
  for (const r of rows) await leaveMeeting(ctx, userId, r.m)
}

export type { ParticipantRow }

// ---------------------------------------------------------------------------
// Guests without a WickyChat account
// ---------------------------------------------------------------------------

export const guestIdentity = (guestId: string) => `guest:${guestId}`

export async function moderateGuest(
  ctx: AppContext,
  scope: OrgScope,
  row: MeetingRow,
  guestId: string,
  action: 'admit' | 'deny' | 'remove',
) {
  await requireModerator(ctx, row, scope.userId)
  const g = await ctx.db.query.meetingGuests.findFirst({
    where: and(eq(meetingGuests.id, guestId), eq(meetingGuests.meetingId, row.id)),
  })
  if (!g) throw notFound('Guest')
  const status = action === 'admit' ? 'admitted' : action === 'deny' ? 'denied' : 'removed'
  if (action !== 'remove' && g.status !== 'waiting')
    throw badRequest('That guest is no longer waiting.')
  await ctx.db
    .update(meetingGuests)
    .set({ status, ...(action === 'remove' && { leftAt: new Date() }) })
    .where(eq(meetingGuests.id, g.id))
  if (action === 'remove') await ctx.media.removeParticipant(row.providerRoom, guestIdentity(g.id))
  await broadcastMeeting(ctx, row)
  if (action === 'remove') await maybeEnd(ctx, row)
}

/** Public: someone without an account asks to join. Guests always wait for a moderator. */
export async function requestGuestAccess(ctx: AppContext, row: MeetingRow, name: string) {
  const [g] = await ctx.db
    .insert(meetingGuests)
    .values({ meetingId: row.id, orgId: row.orgId, name })
    .returning()
  await broadcastMeeting(ctx, row)
  return g!
}

/** Public: a guest polls this until a moderator admits or denies them. */
export async function guestJoin(ctx: AppContext, row: MeetingRow, guestId: string) {
  const g = await ctx.db.query.meetingGuests.findFirst({
    where: and(eq(meetingGuests.id, guestId), eq(meetingGuests.meetingId, row.id)),
  })
  if (!g) throw notFound('Guest')
  if (g.status === 'waiting' || g.status === 'denied' || g.status === 'removed')
    return { status: g.status } as const
  if (g.status === 'left') return { status: 'ended' } as const
  if (!ctx.media.configured) throw unprocessable('Meetings are not configured on this server.')
  if (g.status !== 'joined') {
    await ctx.db
      .update(meetingGuests)
      .set({ status: 'joined', joinedAt: new Date() })
      .where(eq(meetingGuests.id, g.id))
    await broadcastMeeting(ctx, row)
  }
  const media = await ctx.media.createJoinToken({
    room: row.providerRoom,
    identity: guestIdentity(g.id),
    name: `${g.name} (guest)`,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: false,
  })
  return { status: 'joined', url: media.url, token: media.token } as const
}

export async function guestLeave(ctx: AppContext, row: MeetingRow, guestId: string) {
  await ctx.db
    .update(meetingGuests)
    .set({ status: 'left', leftAt: new Date() })
    .where(
      and(
        eq(meetingGuests.id, guestId),
        eq(meetingGuests.meetingId, row.id),
        inArray(meetingGuests.status, ['waiting', 'admitted', 'joined']),
      ),
    )
  await broadcastMeeting(ctx, row)
  await maybeEnd(ctx, row)
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

/** Calendar file for a meeting. Instant meetings use their start (or creation) time. */
export async function meetingIcs(
  ctx: AppContext,
  row: MeetingRow,
  method: 'REQUEST' | 'CANCEL' | 'PUBLISH',
) {
  const slug = await orgSlug(ctx, row.orgId)
  const host = row.hostId
    ? await ctx.db.query.users.findFirst({ where: eq(users.id, row.hostId) })
    : null
  const people = await ctx.db
    .select({ name: users.name, email: users.email })
    .from(meetingParticipants)
    .innerJoin(users, eq(users.id, meetingParticipants.userId))
    .where(
      and(
        eq(meetingParticipants.meetingId, row.id),
        inArray(meetingParticipants.status, ['invited', 'joined', 'left']),
      ),
    )
  return buildIcs({
    uid: `${row.id}@quid`,
    // Seconds since epoch: always increases, so later versions replace earlier ones.
    sequence: Math.floor(Date.now() / 1000),
    method,
    start: row.scheduledFor ?? row.startedAt ?? row.createdAt,
    durationMinutes: row.durationMinutes,
    title: row.title,
    description: row.description,
    url: meetingLink(ctx, slug, row.code),
    organizer: host ? { name: host.displayName || host.name, email: host.email } : null,
    attendees: people.filter((p) => p.email !== host?.email),
  })
}

/** Emails everyone invited (except the actor) an updated or canceled calendar invitation. */
export async function emailMeetingChange(
  ctx: AppContext,
  row: MeetingRow,
  actorId: string,
  kind: 'updated' | 'canceled',
) {
  if (!row.scheduledFor) return
  const ics = await meetingIcs(ctx, row, kind === 'canceled' ? 'CANCEL' : 'REQUEST')
  const slug = await orgSlug(ctx, row.orgId)
  const recipients = await ctx.db
    .select({ email: users.email, id: users.id })
    .from(meetingParticipants)
    .innerJoin(users, eq(users.id, meetingParticipants.userId))
    .where(
      and(
        eq(meetingParticipants.meetingId, row.id),
        inArray(meetingParticipants.status, ['invited', 'joined', 'left']),
      ),
    )
  const when =
    row.scheduledFor.toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'UTC',
    }) + ' UTC'
  for (const r of recipients.filter((x) => x.id !== actorId)) {
    await ctx.email
      .send({
        to: r.email,
        subject: `${kind === 'canceled' ? 'Canceled' : 'Updated'}: ${row.title} · ${when}`,
        attachments: [
          {
            filename: kind === 'canceled' ? 'cancel.ics' : 'invite.ics',
            content: ics,
            contentType: `text/calendar; charset=utf-8; method=${kind === 'canceled' ? 'CANCEL' : 'REQUEST'}`,
          },
        ],
        ...renderEmail({
          heading: kind === 'canceled' ? `Canceled: ${row.title}` : `Updated: ${row.title}`,
          body:
            kind === 'canceled'
              ? `This meeting on ${when} was canceled.`
              : `The meeting is now on ${when}.`,
          ...(kind === 'updated' && {
            cta: { label: 'Open meeting', url: meetingLink(ctx, slug, row.code) },
          }),
        }),
      })
      .catch((err) => ctx.log.warn({ err }, 'meeting update email failed'))
  }
}

// ---------------------------------------------------------------------------
// Transcripts (from live captions)
// ---------------------------------------------------------------------------

/** A speaker uploads their own finished caption lines while they're in the meeting. */
export async function addTranscriptSegments(
  ctx: AppContext,
  scope: OrgScope,
  row: MeetingRow,
  segments: { text: string; spokenAt: string }[],
) {
  const p = await participant(ctx, row.id, scope.userId)
  if (p?.status !== 'joined')
    throw forbidden('Only people in the meeting can add to its transcript.')
  const me = await ctx.db.query.users.findFirst({ where: eq(users.id, scope.userId) })
  const now = Date.now()
  await ctx.db.insert(meetingTranscriptSegments).values(
    segments.map((s) => {
      const t = new Date(s.spokenAt).getTime()
      return {
        meetingId: row.id,
        orgId: row.orgId,
        speakerId: scope.userId,
        speakerName: me?.displayName || me?.name || 'Someone',
        text: s.text,
        // Don't trust client clocks too far: clamp to the last hour.
        spokenAt: new Date(Math.min(now, Math.max(now - 3600_000, Number.isFinite(t) ? t : now))),
      }
    }),
  )
}

/** People who were in the meeting (or its host) can read the transcript. */
export async function getTranscript(ctx: AppContext, scope: OrgScope, row: MeetingRow) {
  const p = await participant(ctx, row.id, scope.userId)
  if (row.hostId !== scope.userId && !p?.joinedAt) {
    throw forbidden('Only people who attended can read this transcript.')
  }
  const rows = await ctx.db
    .select()
    .from(meetingTranscriptSegments)
    .where(eq(meetingTranscriptSegments.meetingId, row.id))
    .orderBy(meetingTranscriptSegments.spokenAt, meetingTranscriptSegments.id)
    .limit(20_000)
  return rows.map((r) => ({
    id: r.id,
    speakerId: r.speakerId,
    speakerName: r.speakerName,
    text: r.text,
    spokenAt: r.spokenAt.toISOString(),
  }))
}

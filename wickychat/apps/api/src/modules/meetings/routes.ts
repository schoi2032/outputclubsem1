import { callParticipants, calls, meetings } from '@quid/db'
import type { Meeting } from '@quid/shared'
import {
  createMeetingSchema,
  meetingInviteSchema,
  meetingRoleSchema,
  meetingUserSchema,
  transcriptUploadSchema,
  updateMeetingSchema,
} from '@quid/shared'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, notFound } from '../../core/errors'
import { type App, orgParams } from '../../core/http'
import { getChannelAccess } from '../channels/service'
import {
  addTranscriptSegments,
  admit,
  broadcastMeeting,
  createMeeting,
  emailMeetingChange,
  endMeeting,
  findMeeting,
  getTranscript,
  inviteToMeeting,
  joinMeeting,
  leaveMeeting,
  meetingIcs,
  meetingsFor,
  moderateGuest,
  muteInMeeting,
  removeFromMeeting,
  serializeMeeting,
  serializeMeetings,
  setMeetingRole,
} from './service'

const params = orgParams.extend({ meeting: z.string().min(3).max(64) })

export async function meetingRoutes(app: App, ctx: AppContext) {
  const base = '/api/orgs/:orgId/meetings'
  const limit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }

  app.post(
    base,
    { ...limit, schema: { params: orgParams, body: createMeetingSchema } },
    async (req, reply): Promise<Meeting> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      if (req.body.channelId) {
        const a = await getChannelAccess(ctx, scope, req.body.channelId)
        if (!a.membership) throw badRequest('Join the channel first.')
      }
      const row = await createMeeting(ctx, scope, req.body)
      reply.code(201)
      return serializeMeeting(ctx, row, scope.userId)
    },
  )

  app.get(base, { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const rows = await meetingsFor(ctx, scope)
    const list = await serializeMeetings(ctx, rows, scope.userId)
    const sortKey = (m: Meeting) => m.scheduledFor ?? m.startedAt ?? m.createdAt
    return {
      live: list.filter((m) => m.status === 'live'),
      upcoming: list
        .filter(
          (m) =>
            m.status === 'scheduled' &&
            m.scheduledFor &&
            new Date(m.scheduledFor).getTime() > Date.now() - 6 * 3600_000,
        )
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
      past: list
        .filter((m) => m.status === 'ended')
        .sort((a, b) => (b.endedAt ?? sortKey(b)).localeCompare(a.endedAt ?? sortKey(a)))
        .slice(0, 50),
    }
  })

  app.get(`${base}/:meeting`, { schema: { params } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    return serializeMeeting(ctx, await findMeeting(ctx, scope, req.params.meeting), scope.userId)
  })

  app.patch(`${base}/:meeting`, { schema: { params, body: updateMeetingSchema } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await findMeeting(ctx, scope, req.params.meeting)
    if (row.hostId !== scope.userId) throw badRequest('Only the host can edit the meeting.')
    const b = req.body
    const [updated] = await ctx.db
      .update(meetings)
      .set({
        ...(b.title !== undefined && { title: b.title }),
        ...(b.description !== undefined && { description: b.description }),
        ...(b.durationMinutes !== undefined && { durationMinutes: b.durationMinutes }),
        ...(b.waitingRoom !== undefined && { waitingRoom: b.waitingRoom }),
        ...(b.guestAccess !== undefined && { guestAccess: b.guestAccess }),
        ...(b.scheduledFor !== undefined && {
          scheduledFor: b.scheduledFor ? new Date(b.scheduledFor) : null,
        }),
      })
      .where(eq(meetings.id, row.id))
      .returning()
    await broadcastMeeting(ctx, updated!)
    const rescheduled =
      (b.scheduledFor !== undefined &&
        b.scheduledFor !== (row.scheduledFor?.toISOString() ?? null)) ||
      (b.durationMinutes !== undefined && b.durationMinutes !== row.durationMinutes) ||
      (b.title !== undefined && b.title !== row.title)
    if (rescheduled && updated!.scheduledFor)
      await emailMeetingChange(ctx, updated!, scope.userId, 'updated')
    return serializeMeeting(ctx, updated!, scope.userId)
  })

  /** Cancels a meeting that hasn't happened yet and emails a calendar cancellation. */
  app.delete(`${base}/:meeting`, { schema: { params } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await findMeeting(ctx, scope, req.params.meeting)
    if (row.hostId !== scope.userId) throw badRequest('Only the host can cancel the meeting.')
    const m = await serializeMeeting(ctx, row, scope.userId)
    if (m.status === 'live') throw badRequest('End the meeting for everyone instead.')
    await emailMeetingChange(ctx, row, scope.userId, 'canceled')
    await ctx.db.delete(meetings).where(eq(meetings.id, row.id))
    return { ok: true }
  })

  /** Calendar file for adding the meeting to any calendar app. */
  app.get(`${base}/:meeting/ics`, { schema: { params } }, async (req, reply) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await findMeeting(ctx, scope, req.params.meeting)
    const ics = await meetingIcs(ctx, row, 'PUBLISH')
    return reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${row.code}.ics"`)
      .send(ics)
  })

  app.post(`${base}/:meeting/join`, { ...limit, schema: { params } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    return joinMeeting(ctx, scope, await findMeeting(ctx, scope, req.params.meeting))
  })

  app.post(`${base}/:meeting/leave`, { schema: { params } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    await leaveMeeting(ctx, scope.userId, await findMeeting(ctx, scope, req.params.meeting))
    return { ok: true }
  })

  app.post(`${base}/:meeting/end`, { schema: { params } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    await endMeeting(ctx, scope, await findMeeting(ctx, scope, req.params.meeting))
    return { ok: true }
  })

  for (const action of ['admit', 'deny', 'remove', 'mute'] as const) {
    app.post(
      `${base}/:meeting/${action}`,
      { schema: { params, body: meetingUserSchema } },
      async (req) => {
        const scope = await requireOrg(ctx, req, req.params.orgId)
        const row = await findMeeting(ctx, scope, req.params.meeting)
        if (action === 'admit' || action === 'deny')
          await admit(ctx, scope, row, req.body.userId, action === 'admit')
        if (action === 'remove') await removeFromMeeting(ctx, scope, row, req.body.userId)
        if (action === 'mute') await muteInMeeting(ctx, scope, row, req.body.userId)
        return { ok: true }
      },
    )
  }

  app.post(
    `${base}/:meeting/role`,
    { schema: { params, body: meetingRoleSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      await setMeetingRole(
        ctx,
        scope,
        await findMeeting(ctx, scope, req.params.meeting),
        req.body.userId,
        req.body.role,
      )
      return { ok: true }
    },
  )

  app.post(
    `${base}/:meeting/invite`,
    { ...limit, schema: { params, body: meetingInviteSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const row = await findMeeting(ctx, scope, req.params.meeting)
      await inviteToMeeting(ctx, scope, row, req.body.userIds, { email: !!row.scheduledFor })
      return serializeMeeting(ctx, row, scope.userId)
    },
  )

  for (const action of ['admit', 'deny', 'remove'] as const) {
    app.post(
      `${base}/:meeting/guests/:guestId/${action}`,
      { schema: { params: params.extend({ guestId: z.uuid() }) } },
      async (req) => {
        const scope = await requireOrg(ctx, req, req.params.orgId)
        await moderateGuest(
          ctx,
          scope,
          await findMeeting(ctx, scope, req.params.meeting),
          req.params.guestId,
          action,
        )
        return { ok: true }
      },
    )
  }

  app.post(
    `${base}/:meeting/transcript`,
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { params, body: transcriptUploadSchema },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      await addTranscriptSegments(
        ctx,
        scope,
        await findMeeting(ctx, scope, req.params.meeting),
        req.body.segments,
      )
      return { ok: true }
    },
  )

  app.get(`${base}/:meeting/transcript`, { schema: { params } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    return getTranscript(ctx, scope, await findMeeting(ctx, scope, req.params.meeting))
  })

  /** Moves a voice call into a meeting: everyone in the call is invited and skips the waiting room. */
  app.post(
    '/api/orgs/:orgId/calls/:callId/upgrade',
    { ...limit, schema: { params: orgParams.extend({ callId: z.uuid() }) } },
    async (req, reply): Promise<Meeting> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const call = await ctx.db.query.calls.findFirst({
        where: and(eq(calls.id, req.params.callId), eq(calls.orgId, scope.orgId)),
      })
      if (!call?.channelId) throw notFound('Call')
      const a = await getChannelAccess(ctx, scope, call.channelId).catch(() => null)
      if (!a?.membership) throw notFound('Call')
      const people = await ctx.db
        .select({ userId: callParticipants.userId })
        .from(callParticipants)
        .where(
          and(
            eq(callParticipants.callId, call.id),
            inArray(callParticipants.status, ['joined', 'invited']),
          ),
        )
      const name = a.channel.name ? `#${a.channel.name}` : 'Call'
      const row = await createMeeting(ctx, scope, {
        title: `${name} meeting`,
        description: '',
        scheduledFor: null,
        durationMinutes: 60,
        waitingRoom: false,
        guestAccess: false,
        channelId: call.channelId,
        inviteeIds: people.map((p) => p.userId),
      })
      reply.code(201)
      return serializeMeeting(ctx, row, scope.userId)
    },
  )
}

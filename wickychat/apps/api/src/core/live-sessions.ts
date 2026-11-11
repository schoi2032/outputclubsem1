import {
  callParticipants,
  calls,
  meetingGuests,
  meetingParticipants,
  meetings,
  voiceRoomParticipants,
} from '@quid/db'
import { and, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { AppContext } from './context'

/**
 * Clears call, meeting and voice-room presence left behind by a previous
 * process (crash, deploy, restart). Nobody can be connected to a server that
 * just started, and their 15-second disconnect timers died with the old process.
 *
 * Only valid while a single API instance runs (in-memory event bus). With
 * several instances, this must move to a heartbeat-based sweep instead.
 */
export async function resetLiveSessions(ctx: AppContext) {
  const now = new Date()
  const endedCalls = await ctx.db
    .update(calls)
    .set({ status: 'ended', endedAt: now })
    .where(inArray(calls.status, ['ringing', 'active']))
    .returning({ id: calls.id })
  if (endedCalls.length) {
    await ctx.db
      .update(callParticipants)
      .set({ status: 'left', leftAt: now })
      .where(
        inArray(
          callParticipants.callId,
          endedCalls.map((c) => c.id),
        ),
      )
  }
  const left = await ctx.db
    .update(meetingParticipants)
    .set({ status: 'left', leftAt: now })
    .where(inArray(meetingParticipants.status, ['joined', 'waiting']))
    .returning({ meetingId: meetingParticipants.meetingId })
  await ctx.db
    .update(meetingGuests)
    .set({ status: 'left', leftAt: now })
    .where(inArray(meetingGuests.status, ['waiting', 'admitted', 'joined']))
  await ctx.db
    .update(meetings)
    .set({ endedAt: now })
    .where(and(isNull(meetings.endedAt), isNotNull(meetings.startedAt)))
  const rooms = await ctx.db
    .delete(voiceRoomParticipants)
    .returning({ userId: voiceRoomParticipants.userId })
  if (endedCalls.length || left.length || rooms.length) {
    ctx.log.info(
      { calls: endedCalls.length, meetingSeats: left.length, roomSeats: rooms.length },
      'cleared live sessions from a previous run',
    )
  }
}

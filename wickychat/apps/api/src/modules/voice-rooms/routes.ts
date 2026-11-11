import {
  meetingUserSchema,
  voiceRoomHandSchema,
  voiceRoomRoleSchema,
  voiceRoomUpdateSchema,
} from '@quid/shared'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { type App, orgIdParams, orgParams } from '../../core/http'
import {
  activeRooms,
  getRoomForChannel,
  joinRoom,
  leaveRoom,
  muteParticipant,
  raiseHand,
  removeParticipant,
  setMode,
  setRole,
} from './service'

export async function voiceRoomRoutes(app: App, ctx: AppContext) {
  const base = '/api/orgs/:orgId'
  const limit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }

  app.get(`${base}/voice-rooms`, { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    return activeRooms(ctx, scope)
  })

  app.get(`${base}/channels/:id/voice-room`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    return { room: await getRoomForChannel(ctx, scope, req.params.id) }
  })

  app.post(
    `${base}/channels/:id/voice-room/join`,
    { ...limit, schema: { params: orgIdParams } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      return joinRoom(ctx, scope, req.params.id)
    },
  )

  app.post(`${base}/voice-rooms/:id/leave`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    await leaveRoom(ctx, scope.userId, req.params.id)
    return { ok: true }
  })

  app.post(
    `${base}/voice-rooms/:id/hand`,
    { schema: { params: orgIdParams, body: voiceRoomHandSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      await raiseHand(ctx, scope, req.params.id, req.body.raised)
      return { ok: true }
    },
  )

  app.post(
    `${base}/voice-rooms/:id/role`,
    { schema: { params: orgIdParams, body: voiceRoomRoleSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      await setRole(ctx, scope, req.params.id, req.body.userId, req.body.role)
      return { ok: true }
    },
  )

  app.post(
    `${base}/voice-rooms/:id/mute`,
    { schema: { params: orgIdParams, body: meetingUserSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      await muteParticipant(ctx, scope, req.params.id, req.body.userId)
      return { ok: true }
    },
  )

  app.post(
    `${base}/voice-rooms/:id/remove`,
    { schema: { params: orgIdParams, body: meetingUserSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      await removeParticipant(ctx, scope, req.params.id, req.body.userId)
      return { ok: true }
    },
  )

  app.patch(
    `${base}/voice-rooms/:id`,
    { schema: { params: orgIdParams, body: voiceRoomUpdateSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      return setMode(ctx, scope, req.params.id, req.body.mode)
    },
  )
}

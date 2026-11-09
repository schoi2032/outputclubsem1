/**
 * Guest links: people without a WickyChat account joining a meeting.
 *
 * Only meetings whose host turned on guest access are reachable. Guests always
 * wait for a moderator, are labelled "(guest)", and authenticate follow-up
 * requests with a per-guest HMAC token returned when they ask to join.
 */
import { meetings, organizations, users } from '@quid/db'
import type { GuestJoinResult, PublicMeetingPreview } from '@quid/shared'
import { guestRequestSchema } from '@quid/shared'
import { and, eq } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../../core/context'
import { hmacSha256, safeEqual } from '../../core/crypto'
import { notFound, unauthorized } from '../../core/errors'
import type { App } from '../../core/http'
import { guestJoin, guestLeave, requestGuestAccess, serializeMeeting } from './service'

const codeParams = z.object({ code: z.string().regex(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/) })
const guestParams = codeParams.extend({ guestId: z.uuid() })

export async function publicMeetingRoutes(app: App, ctx: AppContext) {
  const secret = hmacSha256(
    ctx.config.ENCRYPTION_KEY ?? 'quid-dev-only-guest-secret',
    'meeting-guest',
  )
  const tokenFor = (guestId: string) => hmacSha256(secret, guestId)
  const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } })

  async function guestMeeting(code: string) {
    const row = await ctx.db.query.meetings.findFirst({
      where: and(eq(meetings.code, code), eq(meetings.guestAccess, true)),
    })
    if (!row) throw notFound('Meeting')
    return row
  }

  function requireGuest(req: FastifyRequest, guestId: string) {
    const token = req.headers['x-guest-token']
    if (typeof token !== 'string' || !safeEqual(token, tokenFor(guestId)))
      throw unauthorized('Invalid guest link')
  }

  app.get(
    '/api/public/meetings/:code',
    { ...limit(60), schema: { params: codeParams } },
    async (req): Promise<PublicMeetingPreview> => {
      const row = await guestMeeting(req.params.code)
      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, row.orgId),
        columns: { name: true },
      })
      const host = row.hostId
        ? await ctx.db.query.users.findFirst({
            where: eq(users.id, row.hostId),
            columns: { name: true, displayName: true },
          })
        : null
      const m = await serializeMeeting(ctx, row, '')
      return {
        title: row.title,
        orgName: org!.name,
        hostName: host ? host.displayName || host.name : null,
        status: m.status,
        scheduledFor: m.scheduledFor,
      }
    },
  )

  app.post(
    '/api/public/meetings/:code/guests',
    { ...limit(10), schema: { params: codeParams, body: guestRequestSchema } },
    async (req, reply) => {
      const row = await guestMeeting(req.params.code)
      const g = await requestGuestAccess(ctx, row, req.body.name)
      reply.code(201)
      return { guestId: g.id, guestToken: tokenFor(g.id) }
    },
  )

  app.post(
    '/api/public/meetings/:code/guests/:guestId/join',
    { ...limit(60), schema: { params: guestParams } },
    async (req): Promise<GuestJoinResult> => {
      requireGuest(req, req.params.guestId)
      return guestJoin(ctx, await guestMeeting(req.params.code), req.params.guestId)
    },
  )

  app.post(
    '/api/public/meetings/:code/guests/:guestId/leave',
    { ...limit(30), schema: { params: guestParams } },
    async (req) => {
      requireGuest(req, req.params.guestId)
      await guestLeave(ctx, await guestMeeting(req.params.code), req.params.guestId)
      return { ok: true }
    },
  )
}

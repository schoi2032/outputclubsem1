import { callParticipants, calls } from '@quid/db'
import type { CallJoinInfo } from '@quid/shared'
import { and, desc, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { requireChannel } from '../channels/service'
import {
  activeCallsFor,
  declineCall,
  joinCall,
  leaveCall,
  serializeCalls,
  startCall,
} from './service'

export async function callRoutes(app: App, ctx: AppContext) {
  const base = '/api/orgs/:orgId'
  const limit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }

  /** Starts a call in a conversation (or joins the one already running) and returns a media token. */
  app.post(
    `${base}/channels/:id/calls`,
    { ...limit, schema: { params: orgIdParams } },
    async (req, reply): Promise<CallJoinInfo> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { channel, membership } = await requireChannel(ctx, scope, req.params.id, 'read')
      if (!membership) throw badRequest('Join the channel to start a call.')
      const { row, created } = await startCall(ctx, scope, channel)
      const info = await joinCall(ctx, scope, row.id)
      reply.code(created ? 201 : 200)
      return info
    },
  )

  app.post(
    `${base}/calls/:id/join`,
    { ...limit, schema: { params: orgIdParams } },
    async (req): Promise<CallJoinInfo> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      return joinCall(ctx, scope, req.params.id)
    },
  )

  app.post(`${base}/calls/:id/decline`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    return declineCall(ctx, scope, req.params.id)
  })

  app.post(`${base}/calls/:id/leave`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await ctx.db.query.calls.findFirst({
      where: and(eq(calls.id, req.params.id), eq(calls.orgId, scope.orgId)),
    })
    if (!row) return { ok: true }
    return leaveCall(ctx, scope, req.params.id)
  })

  app.get(`${base}/calls/active`, { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    return activeCallsFor(ctx, scope)
  })

  /** Call history: calls the user was part of. */
  app.get(
    `${base}/calls`,
    {
      schema: {
        params: orgParams,
        querystring: z.object({
          before: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const rows = await ctx.db
        .select({ c: calls })
        .from(calls)
        .innerJoin(
          callParticipants,
          and(eq(callParticipants.callId, calls.id), eq(callParticipants.userId, scope.userId)),
        )
        .where(
          and(
            eq(calls.orgId, scope.orgId),
            req.query.before ? lt(calls.id, req.query.before) : undefined,
          ),
        )
        .orderBy(desc(calls.id))
        .limit(req.query.limit + 1)
      const more = rows.length > req.query.limit
      const list = await serializeCalls(
        ctx,
        rows.slice(0, req.query.limit).map((r) => r.c),
      )
      return { calls: list, nextCursor: more ? list[list.length - 1]!.id : null }
    },
  )
}

/**
 * WickyChat: the rule-breakers log. Every time the swear filter hides words, the message
 * service records a `moderation_events` row (see `recordSwears`). Only org admins, which is
 * how teachers are set up, can read it.
 */
import { channels, moderationEvents, users } from '@quid/db'
import type { ModerationEvent, ModerationOffender } from '@quid/shared'
import { and, count, desc, eq, gte, lt, max, sql } from 'drizzle-orm'
import { z } from 'zod'
import { authorize, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { type App, orgParams } from '../../core/http'
import { toUserSummary, userCols } from '../users/serialize'

const DAY = 86_400_000
const RANGES = { '7d': 7, '30d': 30, all: null } as const

export async function moderationRoutes(app: App, ctx: AppContext) {
  const base = '/api/orgs/:orgId/moderation'

  /** Who broke the rules most, for a time range. */
  app.get(
    `${base}/offenders`,
    {
      schema: {
        params: orgParams,
        querystring: z.object({ range: z.enum(['7d', '30d', 'all']).default('30d') }),
      },
    },
    async (req): Promise<{ offenders: ModerationOffender[] }> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'audit.read')
      const days = RANGES[req.query.range]
      const since = days ? new Date(Date.now() - days * DAY) : null
      const where = and(
        eq(moderationEvents.orgId, scope.orgId),
        since ? gte(moderationEvents.createdAt, since) : undefined,
      )

      const rows = await ctx.db
        .select({
          ...userCols,
          email: users.email,
          incidents: count(),
          words: sql<number>`coalesce(sum(cardinality(${moderationEvents.words})), 0)::int`,
          lastAt: max(moderationEvents.createdAt),
        })
        .from(moderationEvents)
        .innerJoin(users, eq(users.id, moderationEvents.userId))
        .where(where)
        .groupBy(users.id)
        .orderBy(desc(count()), desc(max(moderationEvents.createdAt)))
        .limit(200)

      // Most-used words per person, normalized to lower case.
      const top = await ctx.db.execute<{ user_id: string; word: string; n: number }>(sql`
        select user_id, word, n from (
          select e.user_id, lower(w) as word, count(*)::int as n,
                 row_number() over (partition by e.user_id order by count(*) desc) as rk
          from ${moderationEvents} e, unnest(e.words) as w
          where e.org_id = ${scope.orgId}
            ${since ? sql`and e.created_at >= ${since.toISOString()}` : sql``}
          group by e.user_id, lower(w)
        ) t where rk <= 3
      `)
      const topBy = new Map<string, string[]>()
      for (const r of top) topBy.set(r.user_id, [...(topBy.get(r.user_id) ?? []), r.word])

      return {
        offenders: rows.map((r) => ({
          user: { ...toUserSummary(r), email: r.email },
          incidents: Number(r.incidents),
          words: Number(r.words),
          topWords: topBy.get(r.id) ?? [],
          lastAt: (r.lastAt ?? new Date()).toISOString(),
        })),
      }
    },
  )

  /** Each incident, newest first. Optionally for one person. */
  app.get(
    `${base}/events`,
    {
      schema: {
        params: orgParams,
        querystring: z.object({
          userId: z.uuid().optional(),
          before: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req): Promise<{ events: ModerationEvent[]; nextCursor: string | null }> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'audit.read')
      const { userId, before, limit } = req.query
      const rows = await ctx.db
        .select({
          e: moderationEvents,
          user: { ...userCols, email: users.email },
          channelName: channels.name,
          channelKind: channels.kind,
        })
        .from(moderationEvents)
        .innerJoin(users, eq(users.id, moderationEvents.userId))
        .leftJoin(channels, eq(channels.id, moderationEvents.channelId))
        .where(
          and(
            eq(moderationEvents.orgId, scope.orgId),
            userId ? eq(moderationEvents.userId, userId) : undefined,
            before ? lt(moderationEvents.id, before) : undefined,
          ),
        )
        .orderBy(desc(moderationEvents.id))
        .limit(limit + 1)
      const page = rows.slice(0, limit)
      return {
        events: page.map((r) => ({
          id: r.e.id,
          user: { ...toUserSummary(r.user), email: r.user.email },
          channel:
            r.e.channelId && r.channelName !== null
              ? { id: r.e.channelId, name: r.channelName, kind: r.channelKind ?? 'public' }
              : null,
          messageId: r.e.messageId,
          kind: 'swear' as const,
          source: r.e.source as ModerationEvent['source'],
          words: r.e.words,
          original: r.e.original,
          createdAt: r.e.createdAt.toISOString(),
        })),
        nextCursor: rows.length > limit ? page[page.length - 1]!.e.id : null,
      }
    },
  )
}

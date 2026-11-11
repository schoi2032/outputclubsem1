import { orgMemberships, users } from '@quid/db'
import type { SearchResults } from '@quid/shared'
import { cleanProfileStyle, searchQuerySchema } from '@quid/shared'
import { and, eq, inArray } from 'drizzle-orm'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { type App, orgParams } from '../../core/http'
import { serializeChannels } from '../channels/service'
import { serializeFile } from '../files/serialize'
import { serializeMessages } from '../messages/service'
import { presenceFor } from '../presence/service'
import { avatarUrl, toUserSummary, userCols } from '../users/serialize'
import { PostgresSearch, parseQuery, type SearchService } from './service'

export async function searchRoutes(
  app: App,
  ctx: AppContext,
  search: SearchService = new PostgresSearch(ctx),
) {
  app.get(
    '/api/orgs/:orgId/search',
    {
      schema: { params: orgParams, querystring: searchQuerySchema },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req): Promise<SearchResults> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { q, type, cursor, limit } = req.query
      const parsed = parseQuery(q)
      const hasFilters =
        parsed.from.length || parsed.in.length || parsed.before || parsed.after || parsed.hasFile
      const empty: SearchResults = {
        messages: [],
        channels: [],
        people: [],
        files: [],
        nextCursor: null,
      }
      // An empty files query lists recent files, which powers the Files page.
      if (!parsed.text && !hasFilters && type !== 'files') return empty
      const want = (t: string) => type === 'all' || type === t
      const isPaged = type !== 'all'

      const [msgHits, chanRows, personIds, fileRows] = await Promise.all([
        want('messages')
          ? search.messages(scope, parsed, { cursor, limit: isPaged ? limit + 1 : 8 })
          : [],
        want('channels') && !hasFilters
          ? search.channels(scope, parsed.text, isPaged ? limit : 5)
          : [],
        want('people') && !hasFilters ? search.people(scope, parsed.text, isPaged ? limit : 5) : [],
        want('files')
          ? search.files(scope, parsed, { cursor, limit: isPaged ? limit + 1 : 5 })
          : [],
      ])

      let nextCursor: string | null = null
      let hits = msgHits
      let fileList = fileRows
      if (type === 'messages' && hits.length > limit) {
        hits = hits.slice(0, limit)
        nextCursor = hits[hits.length - 1]!.row.id
      }
      if (type === 'files' && fileList.length > limit) {
        fileList = fileList.slice(0, limit)
        nextCursor = fileList[fileList.length - 1]!.id
      }

      const serialized = await serializeMessages(
        ctx,
        scope.userId,
        hits.map((h) => h.row),
      )
      const messagesOut = serialized.map((m, i) => {
        const h = hits[i]!
        return { ...m, channelName: h.channelName, highlight: h.highlight }
      })

      const peopleRows = personIds.length
        ? await ctx.db
            .select({
              user: userCols,
              email: users.email,
              bio: users.bio,
              pronouns: users.pronouns,
              bannerColor: users.bannerColor,
              bannerKey: users.bannerKey,
              bannerAnimated: users.bannerAnimated,
              profileStyle: users.profileStyle,
              role: orgMemberships.role,
              title: orgMemberships.title,
              departmentId: orgMemberships.departmentId,
              profile: orgMemberships.profile,
              joinedAt: orgMemberships.joinedAt,
            })
            .from(users)
            .innerJoin(
              orgMemberships,
              and(eq(orgMemberships.userId, users.id), eq(orgMemberships.orgId, scope.orgId)),
            )
            .where(inArray(users.id, personIds))
        : []
      const presence = await presenceFor(ctx, personIds)
      const order = new Map(personIds.map((id, i) => [id, i]))
      const people = peopleRows
        .sort((a, b) => order.get(a.user.id)! - order.get(b.user.id)!)
        .map((r) => {
          const p = presence.get(r.user.id)
          return {
            ...toUserSummary(r.user),
            email: scope.role === 'guest' ? '' : r.email,
            role: r.role,
            title: r.title,
            departmentId: r.departmentId,
            joinedAt: r.joinedAt.toISOString(),
            deactivated: false,
            presence: p?.status ?? ('offline' as const),
            statusText: p?.statusText ?? null,
            statusEmoji: p?.statusEmoji ?? null,
            lastActiveAt: p?.lastActiveAt ?? null,
            profile: r.profile,
            bio: r.bio,
            pronouns: r.pronouns,
            bannerColor: r.bannerColor,
            bannerUrl: avatarUrl(r.bannerKey, r.bannerAnimated),
            profileStyle: cleanProfileStyle(r.profileStyle),
          }
        })

      const uploaderIds = [
        ...new Set(fileList.map((f) => f.uploaderId).filter((x): x is string => !!x)),
      ]
      const uploaders = uploaderIds.length
        ? await ctx.db.select(userCols).from(users).where(inArray(users.id, uploaderIds))
        : []
      const upMap = new Map(uploaders.map((u) => [u.id, toUserSummary(u)]))

      return {
        messages: messagesOut,
        channels: await serializeChannels(ctx, scope.userId, chanRows),
        people,
        files: fileList.map((f) => ({
          ...serializeFile(f),
          channelId: f.channelId,
          messageId: f.messageId,
          uploader: (f.uploaderId && upMap.get(f.uploaderId)) || {
            id: '',
            name: 'Unknown',
            displayName: null,
            avatarUrl: null,
            isBot: false,
          },
          createdAt: f.createdAt.toISOString(),
        })),
        nextCursor,
      }
    },
  )
}

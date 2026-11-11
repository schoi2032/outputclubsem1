import { users } from '@quid/db'
import type { UserSummary } from '@quid/shared'
import { inArray, type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { OrgScope } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { toUserSummary, userCols } from '../users/serialize'

/** User summaries by id (missing ids are left out). */
export async function userSummaries(ctx: AppContext, ids: (string | null | undefined)[]) {
  const want = [...new Set(ids.filter((x): x is string => !!x))]
  const rows = want.length
    ? await ctx.db.select(userCols).from(users).where(inArray(users.id, want))
    : []
  return new Map<string, UserSummary>(rows.map((u) => [u.id, toUserSummary(u)]))
}

/** Channels whose content the user may read (same rule as search). */
export function readableChannels(scope: OrgScope, channelCol: SQL | AnyPgColumn): SQL {
  const member = sql`${channelCol} in (select cm.channel_id from channel_members cm where cm.user_id = ${scope.userId} and cm.org_id = ${scope.orgId})`
  if (scope.role === 'guest') return member
  return sql`(${member} or ${channelCol} in (select c.id from channels c where c.org_id = ${scope.orgId} and c.kind = 'public'))`
}

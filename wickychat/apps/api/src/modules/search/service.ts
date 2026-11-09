/**
 * Search behind an interface so Postgres full-text search can be replaced by
 * a dedicated engine (Typesense, Elasticsearch, ...) without touching routes.
 * Every implementation must apply the same visibility rule: a user only ever
 * finds content from channels they can read.
 */
import { channels, files, messages, orgMemberships, users } from '@quid/db'
import { and, desc, eq, gte, ilike, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { OrgScope } from '../../core/auth'
import type { AppContext } from '../../core/context'

export interface ParsedQuery {
  text: string
  from: string[]
  in: string[]
  before: Date | null
  after: Date | null
  hasFile: boolean
}

/** Parses `from:@ada in:#general before:2026-01-31 after:2026-01-01 has:file budget`. */
export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { text: '', from: [], in: [], before: null, after: null, hasFile: false }
  const rest: string[] = []
  for (const tok of q.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
    const m = /^(from|in|before|after|on|has):(.+)$/i.exec(tok)
    if (!m) {
      rest.push(tok)
      continue
    }
    const key = m[1]!.toLowerCase()
    const val = m[2]!.replace(/^"|"$/g, '')
    if (key === 'from') out.from.push(val.replace(/^@/, '').toLowerCase())
    else if (key === 'in') out.in.push(val.replace(/^#/, '').toLowerCase())
    else if (key === 'has' && val.toLowerCase() === 'file') out.hasFile = true
    else {
      const d = new Date(val)
      if (Number.isNaN(d.getTime())) continue
      if (key === 'before') out.before = d
      else if (key === 'after') out.after = new Date(d.getTime() + 86_400_000)
      else if (key === 'on') {
        out.after = d
        out.before = new Date(d.getTime() + 86_400_000)
      }
    }
  }
  out.text = rest.join(' ').trim()
  return out
}

export interface MessageHit {
  row: typeof messages.$inferSelect
  channelName: string | null
  highlight: string
}

export interface SearchService {
  messages(
    scope: OrgScope,
    q: ParsedQuery,
    opts: { cursor?: string; limit: number },
  ): Promise<MessageHit[]>
  channels(scope: OrgScope, text: string, limit: number): Promise<(typeof channels.$inferSelect)[]>
  people(scope: OrgScope, text: string, limit: number): Promise<string[]>
  files(
    scope: OrgScope,
    q: ParsedQuery,
    opts: { cursor?: string; limit: number },
  ): Promise<(typeof files.$inferSelect)[]>
}

const like = (s: string) => `%${s.replace(/[%_\\]/g, '\\$&')}%`

export class PostgresSearch implements SearchService {
  constructor(private readonly ctx: AppContext) {}

  /** Channels whose content the user may read. */
  private readable(scope: OrgScope, channelCol: SQL | AnyPgColumn): SQL {
    const member = sql`${channelCol} in (select cm.channel_id from channel_members cm where cm.user_id = ${scope.userId} and cm.org_id = ${scope.orgId})`
    if (scope.role === 'guest') return member
    return sql`(${member} or ${channelCol} in (select c.id from channels c where c.org_id = ${scope.orgId} and c.kind = 'public'))`
  }

  private filters(
    scope: OrgScope,
    q: ParsedQuery,
    channelCol: typeof messages.channelId | typeof files.channelId,
    authorCol: typeof messages.authorId | typeof files.uploaderId,
  ) {
    const conds: (SQL | undefined)[] = [this.readable(scope, channelCol)]
    if (q.from.length) {
      conds.push(
        sql`${authorCol} in (select u.id from users u join org_memberships m on m.user_id = u.id
          where m.org_id = ${scope.orgId} and (${sql.join(
            q.from.map(
              (f) =>
                sql`lower(u.name) like ${like(f)} or lower(coalesce(u.display_name, '')) like ${like(f)} or lower(u.email) like ${`${f.replace(/[%_\\]/g, '\\$&')}%`}`,
            ),
            sql` or `,
          )}))`,
      )
    }
    if (q.in.length) {
      conds.push(
        sql`${channelCol} in (select c.id from channels c where c.org_id = ${scope.orgId} and lower(c.name) in (${sql.join(
          q.in.map((n) => sql`${n}`),
          sql`, `,
        )}))`,
      )
    }
    return conds
  }

  async messages(scope: OrgScope, q: ParsedQuery, opts: { cursor?: string; limit: number }) {
    const tsq = q.text ? sql`websearch_to_tsquery('english', ${q.text})` : null
    const rows = await this.ctx.db
      .select({
        row: messages,
        channelName: channels.name,
        highlight: tsq
          ? sql<string>`ts_headline('english', ${messages.bodyText}, ${tsq}, 'StartSel=«,StopSel=»,MaxWords=30,MinWords=12,MaxFragments=2')`
          : sql<string>`left(${messages.bodyText}, 200)`,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(
        and(
          eq(messages.orgId, scope.orgId),
          isNull(messages.deletedAt),
          eq(messages.kind, 'user'),
          tsq ? sql`${messages.search} @@ ${tsq}` : undefined,
          q.before ? lt(messages.createdAt, q.before) : undefined,
          q.after ? gte(messages.createdAt, q.after) : undefined,
          q.hasFile
            ? sql`exists (select 1 from files f where f.message_id = ${messages.id} and f.deleted_at is null)`
            : undefined,
          opts.cursor ? lt(messages.id, opts.cursor) : undefined,
          ...this.filters(scope, q, messages.channelId, messages.authorId),
        ),
      )
      .orderBy(desc(messages.id))
      .limit(opts.limit)
    return rows.map((r) => ({ row: r.row, channelName: r.channelName, highlight: r.highlight }))
  }

  async channels(scope: OrgScope, text: string, limit: number) {
    if (!text) return []
    return this.ctx.db
      .select()
      .from(channels)
      .where(
        and(
          eq(channels.orgId, scope.orgId),
          or(eq(channels.kind, 'public'), eq(channels.kind, 'private')),
          ilike(channels.name, like(text)),
          this.readable(scope, sql`${channels.id}`),
        ),
      )
      .orderBy(sql`similarity(${channels.name}, ${text}) desc`)
      .limit(limit)
  }

  async people(scope: OrgScope, text: string, limit: number) {
    if (!text) return []
    const pattern = like(text)
    const guestFilter =
      scope.role === 'guest'
        ? sql`${users.id} in (select cm2.user_id from channel_members cm1 join channel_members cm2 on cm2.channel_id = cm1.channel_id where cm1.user_id = ${scope.userId})`
        : undefined
    const rows = await this.ctx.db
      .select({ id: users.id })
      .from(orgMemberships)
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(
        and(
          eq(orgMemberships.orgId, scope.orgId),
          isNull(orgMemberships.deactivatedAt),
          eq(users.isBot, false),
          or(
            ilike(users.name, pattern),
            ilike(users.displayName, pattern),
            ilike(users.email, pattern),
            ilike(orgMemberships.title, pattern),
          ),
          guestFilter,
        ),
      )
      .orderBy(sql`similarity(${users.name}, ${text}) desc`)
      .limit(limit)
    return rows.map((r) => r.id)
  }

  async files(scope: OrgScope, q: ParsedQuery, opts: { cursor?: string; limit: number }) {
    return this.ctx.db
      .select()
      .from(files)
      .where(
        and(
          eq(files.orgId, scope.orgId),
          isNull(files.deletedAt),
          isNotNull(files.messageId),
          eq(files.purpose, 'attachment'),
          q.text ? ilike(files.name, like(q.text)) : undefined,
          q.before ? lt(files.createdAt, q.before) : undefined,
          q.after ? gte(files.createdAt, q.after) : undefined,
          opts.cursor ? lt(files.id, opts.cursor) : undefined,
          ...this.filters(scope, q, files.channelId, files.uploaderId),
        ),
      )
      .orderBy(desc(files.id))
      .limit(opts.limit)
  }
}

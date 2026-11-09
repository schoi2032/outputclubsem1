/**
 * Permission-aware conversation context for AI features and the future WickyChat
 * MCP server. It reads only what the acting user could read in the app, using
 * the same channel checks as the HTTP API, and returns plain text.
 */
import { messages, users } from '@quid/db'
import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import type { OrgScope } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { requireChannel } from '../channels/service'

export interface ContextLine {
  id: string
  author: string
  at: string
  text: string
}

export async function channelContext(
  ctx: AppContext,
  scope: OrgScope,
  channelId: string,
  opts: { limit?: number; before?: string; threadId?: string } = {},
): Promise<ContextLine[]> {
  const { channel } = await requireChannel(ctx, scope, channelId, 'read')
  const limit = Math.min(opts.limit ?? 100, 500)
  const rows = await ctx.db
    .select({
      id: messages.id,
      text: messages.bodyText,
      at: messages.createdAt,
      author: users.name,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorId))
    .where(
      and(
        eq(messages.channelId, channel.id),
        isNull(messages.deletedAt),
        opts.threadId ? eq(messages.parentId, opts.threadId) : isNull(messages.parentId),
        opts.before ? lt(messages.id, opts.before) : undefined,
      ),
    )
    .orderBy(desc(messages.id))
    .limit(limit)
  return rows
    .reverse()
    .map((r) => ({ id: r.id, author: r.author ?? 'Unknown', at: r.at.toISOString(), text: r.text }))
}

export function formatTranscript(lines: ContextLine[]) {
  return lines.map((l) => `[${l.at}] ${l.author}: ${l.text}`).join('\n')
}

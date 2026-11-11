import { channels } from '@quid/db'
import { topics } from '@quid/shared'
import { eq } from 'drizzle-orm'
import type { AppContext } from '../../core/context'
import { emitHook } from '../../core/hooks'
import { serializeChannel } from './service'

/** Tells a user they joined a channel (so their sidebar and socket subscriptions update). */
export async function publishChannelJoined(
  ctx: AppContext,
  orgId: string,
  channelId: string,
  userId: string,
) {
  const row = await ctx.db.query.channels.findFirst({ where: eq(channels.id, channelId) })
  if (!row) return
  const channel = await serializeChannel(ctx, userId, row)
  await ctx.bus.publish(topics.user(userId), { type: 'channel.joined', orgId, channel })
  await ctx.bus.publish(topics.channel(channelId), {
    type: 'channel.member_joined',
    orgId,
    channelId,
    userId,
  })
  if (row.kind === 'public' || row.kind === 'private')
    await emitHook(ctx, 'channelJoined', { orgId, channel: row, userId })
}

export async function publishChannelLeft(
  ctx: AppContext,
  orgId: string,
  channelId: string,
  userId: string,
) {
  await ctx.bus.publish(topics.user(userId), { type: 'channel.left', orgId, channelId })
  await ctx.bus.publish(topics.channel(channelId), {
    type: 'channel.member_left',
    orgId,
    channelId,
    userId,
  })
}

/**
 * Broadcasts channel metadata changes. Per-viewer fields (membership, unread
 * counts) are omitted; clients keep their own copy of those.
 */
export async function publishChannelUpdated(ctx: AppContext, orgId: string, channelId: string) {
  const row = await ctx.db.query.channels.findFirst({ where: eq(channels.id, channelId) })
  if (!row) return
  const channel = {
    ...(await serializeChannel(ctx, '00000000-0000-0000-0000-000000000000', row)),
    membership: null,
  }
  if (channel.kind === 'dm') delete channel.participants
  await ctx.bus.publish(topics.channel(channelId), { type: 'channel.updated', orgId, channel })
}

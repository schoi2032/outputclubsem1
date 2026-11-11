/** Sends new messages to plugins added to the channel (signed, retried, via the webhook queue). */
import { channelMembers, integrations, plugins, webhookDeliveries } from '@quid/db'
import { and, eq, inArray } from 'drizzle-orm'
import type { AppContext } from '../../core/context'
import { enqueue } from '../../core/jobs'

export async function enqueuePluginEvents(
  ctx: AppContext,
  orgId: string,
  m: {
    id: string
    channelId: string
    authorId: string | null
    authorName: string | null
    text: string
    threadId: string | null
    createdAt: string
  },
) {
  // Plugins whose bot is in this channel.
  const rows = await ctx.db
    .select({ i: integrations })
    .from(integrations)
    .innerJoin(
      channelMembers,
      and(
        eq(channelMembers.userId, integrations.botUserId),
        eq(channelMembers.channelId, m.channelId),
      ),
    )
    .where(
      and(
        eq(integrations.orgId, orgId),
        eq(integrations.kind, 'plugin'),
        eq(integrations.enabled, true),
      ),
    )
  const wanted = rows
    .map((r) => r.i)
    .filter(
      (i) =>
        i.botUserId !== m.authorId &&
        ((i.config as { events?: string[] }).events ?? []).includes('message.created'),
    )
  if (!wanted.length) return
  const ids = wanted.map((i) => String((i.config as { pluginId?: string }).pluginId))
  const live = new Set(
    (
      await ctx.db
        .select({ id: plugins.id })
        .from(plugins)
        .where(and(inArray(plugins.id, ids), inArray(plugins.status, ['verified', 'unverified'])))
    ).map((p) => p.id),
  )
  for (const i of wanted) {
    if (!live.has(String((i.config as { pluginId?: string }).pluginId))) continue
    const [d] = await ctx.db
      .insert(webhookDeliveries)
      .values({
        orgId,
        integrationId: i.id,
        event: 'message.created',
        payload: { type: 'event', event: 'message.created', installId: i.id, message: m },
        status: 'pending',
      })
      .returning({ id: webhookDeliveries.id })
    await enqueue(ctx, 'webhook.deliver', { deliveryId: d!.id })
  }
}

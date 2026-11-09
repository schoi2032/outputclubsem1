import { scheduledMessages } from '@quid/db'
import { and, eq, lte } from 'drizzle-orm'
import { scopeFor } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { AppError } from '../../core/errors'
import { requireChannel } from '../channels/service'
import { createMessage } from './service'

/** Sends scheduled messages that are due, re-checking permissions at send time. */
export async function sendDueScheduled(ctx: AppContext) {
  const due = await ctx.db
    .select()
    .from(scheduledMessages)
    .where(and(eq(scheduledMessages.status, 'pending'), lte(scheduledMessages.sendAt, new Date())))
    .limit(100)

  for (const s of due) {
    // Claim it first so two instances never send the same message.
    const [claimed] = await ctx.db
      .update(scheduledMessages)
      .set({ status: 'sent' })
      .where(and(eq(scheduledMessages.id, s.id), eq(scheduledMessages.status, 'pending')))
      .returning()
    if (!claimed) continue
    try {
      const scope = await scopeFor(ctx, s.orgId, s.authorId)
      if (!scope)
        throw new AppError(403, 'forbidden', 'You are no longer a member of this organization.')
      const { channel } = await requireChannel(
        ctx,
        scope,
        s.channelId,
        s.parentId ? 'reply' : 'post',
      )
      const m = await createMessage(ctx, scope, channel, { body: s.bodyJson, parentId: s.parentId })
      await ctx.db
        .update(scheduledMessages)
        .set({ sentMessageId: m.id })
        .where(eq(scheduledMessages.id, s.id))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send'
      await ctx.db
        .update(scheduledMessages)
        .set({ status: 'failed', error: message })
        .where(eq(scheduledMessages.id, s.id))
    }
  }
}

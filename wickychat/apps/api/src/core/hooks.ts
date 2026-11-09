/**
 * In-process hooks for things that happen in one module and matter to another
 * (e.g. workflows reacting to new messages), without import cycles. Handlers run
 * after the triggering change is saved; their failures are logged, never thrown.
 */

import type { channels } from '@quid/db'
import type { Message } from '@quid/shared'
import type { AppContext } from './context'

type ChannelRow = typeof channels.$inferSelect

export interface HookEvents {
  messageCreated: { orgId: string; channel: ChannelRow; message: Message; byBot: boolean }
  channelJoined: { orgId: string; channel: ChannelRow; userId: string }
  orgJoined: { orgId: string; userId: string }
  meetingEnded: { orgId: string; meetingId: string }
}

const handlers: {
  [K in keyof HookEvents]: ((ctx: AppContext, e: HookEvents[K]) => Promise<void>)[]
} = { messageCreated: [], channelJoined: [], orgJoined: [], meetingEnded: [] }

export function onHook<K extends keyof HookEvents>(
  name: K,
  fn: (ctx: AppContext, e: HookEvents[K]) => Promise<void>,
) {
  handlers[name].push(fn)
}

export async function emitHook<K extends keyof HookEvents>(
  ctx: AppContext,
  name: K,
  e: HookEvents[K],
) {
  for (const fn of handlers[name]) {
    try {
      await fn(ctx, e)
    } catch (err) {
      ctx.log.warn({ err, hook: name }, 'hook failed')
    }
  }
}

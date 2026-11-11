/**
 * Presence = manual status (active / away / do not disturb) + whether the user
 * has a live connection + how recently they were active.
 *
 * Connection state is tracked per API instance. With several instances this
 * should move to Redis (see docs/ARCHITECTURE.md).
 */
import { orgMemberships, presence } from '@quid/db'
import type { Presence, PresenceStatus } from '@quid/shared'
import { topics } from '@quid/shared'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { AppContext } from '../../core/context'

const IDLE_MS = 10 * 60_000
const ACTIVITY_WRITE_INTERVAL_MS = 60_000

const lastActivity = new Map<string, number>()
const lastWritten = new Map<string, number>()

type Row = typeof presence.$inferSelect

function derive(ctx: AppContext, userId: string, row: Row | undefined): Presence {
  const online = ctx.online.isOnline(userId)
  const expired = row?.statusExpiresAt && row.statusExpiresAt < new Date()
  const lastActive = lastActivity.get(userId) ?? row?.lastActiveAt?.getTime() ?? null
  let status: PresenceStatus = 'offline'
  if (online) {
    if (row?.status === 'dnd' && !expired) status = 'dnd'
    else if (row?.status === 'away') status = 'away'
    else status = lastActive && Date.now() - lastActive > IDLE_MS ? 'away' : 'active'
  }
  return {
    userId,
    status,
    statusText: expired ? null : (row?.statusText ?? null),
    statusEmoji: expired ? null : (row?.statusEmoji ?? null),
    statusExpiresAt: expired ? null : (row?.statusExpiresAt?.toISOString() ?? null),
    lastActiveAt: lastActive ? new Date(lastActive).toISOString() : null,
  }
}

export async function presenceFor(
  ctx: AppContext,
  userIds: string[],
): Promise<Map<string, Presence>> {
  const out = new Map<string, Presence>()
  if (userIds.length === 0) return out
  const rows = await ctx.db
    .select()
    .from(presence)
    .where(inArray(presence.userId, [...new Set(userIds)]))
  const byId = new Map(rows.map((r) => [r.userId, r]))
  for (const id of userIds) out.set(id, derive(ctx, id, byId.get(id)))
  return out
}

/** Everyone who should hear about this user's presence: people in their orgs. */
async function audienceTopics(ctx: AppContext, userId: string): Promise<string[]> {
  const orgs = await ctx.db
    .select({ orgId: orgMemberships.orgId })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.userId, userId), isNull(orgMemberships.deactivatedAt)))
  return orgs.map((o) => topics.org(o.orgId))
}

export async function broadcastPresence(ctx: AppContext, userId: string) {
  const p = (await presenceFor(ctx, [userId])).get(userId)!
  const t = await audienceTopics(ctx, userId)
  if (t.length) await ctx.bus.publish(t, { type: 'presence', presence: p })
}

export async function recordActivity(ctx: AppContext, userId: string) {
  const now = Date.now()
  const wasIdle = (lastActivity.get(userId) ?? 0) < now - IDLE_MS
  lastActivity.set(userId, now)
  if (now - (lastWritten.get(userId) ?? 0) > ACTIVITY_WRITE_INTERVAL_MS) {
    lastWritten.set(userId, now)
    await ctx.db
      .insert(presence)
      .values({ userId, lastActiveAt: new Date(now) })
      .onConflictDoUpdate({ target: presence.userId, set: { lastActiveAt: new Date(now) } })
  }
  if (wasIdle) await broadcastPresence(ctx, userId)
}

export async function setPresence(
  ctx: AppContext,
  userId: string,
  patch: Partial<Pick<Row, 'status' | 'statusText' | 'statusEmoji' | 'statusExpiresAt'>>,
) {
  await ctx.db
    .insert(presence)
    .values({ userId, ...patch })
    .onConflictDoUpdate({ target: presence.userId, set: patch })
  await broadcastPresence(ctx, userId)
}

export function installPresenceTracking(ctx: AppContext) {
  ctx.online.onChange((userId, online) => {
    if (online) lastActivity.set(userId, Date.now())
    void broadcastPresence(ctx, userId).catch((err) =>
      ctx.log.warn({ err }, 'presence broadcast failed'),
    )
    if (!online) {
      void ctx.db
        .insert(presence)
        .values({ userId, lastActiveAt: new Date(lastActivity.get(userId) ?? Date.now()) })
        .onConflictDoUpdate({
          target: presence.userId,
          set: { lastActiveAt: new Date(lastActivity.get(userId) ?? Date.now()) },
        })
        .catch(() => {})
    }
  })
}

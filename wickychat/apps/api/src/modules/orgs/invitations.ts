import {
  channelMembers,
  channels,
  invitations,
  organizations,
  orgMemberships,
  users,
} from '@quid/db'
import { resolveCustomization } from '@quid/shared'
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { audit } from '../../core/audit'
import type { AppContext } from '../../core/context'
import { sha256 } from '../../core/crypto'
import { badRequest, forbidden } from '../../core/errors'
import { emitHook } from '../../core/hooks'
import { publishChannelJoined } from '../channels/events'

export const INVITE_TTL_MS = 7 * 86_400_000

/**
 * Adds a user to an org (idempotent) and to its default and auto-join channels. Guests are
 * not added to default channels: they only see what they are explicitly given.
 */
export async function addUserToOrg(
  ctx: AppContext,
  opts: {
    orgId: string
    userId: string
    role: typeof orgMemberships.$inferInsert.role
    departmentId?: string | null
  },
) {
  let joined = false
  const joinedChannels = await ctx.db.transaction(async (tx) => {
    const existing = await tx.query.orgMemberships.findFirst({
      where: and(eq(orgMemberships.orgId, opts.orgId), eq(orgMemberships.userId, opts.userId)),
    })
    if (existing && !existing.deactivatedAt) return []
    joined = true
    if (existing) {
      await tx
        .update(orgMemberships)
        .set({ deactivatedAt: null, role: opts.role, joinedAt: new Date() })
        .where(eq(orgMemberships.id, existing.id))
    } else {
      await tx.insert(orgMemberships).values({
        orgId: opts.orgId,
        userId: opts.userId,
        role: opts.role,
        departmentId: opts.departmentId ?? null,
      })
    }
    if (opts.role === 'guest') return []
    // Default channels, plus the public channels the org picked for new members.
    const org = await tx.query.organizations.findFirst({
      where: eq(organizations.id, opts.orgId),
      columns: { settings: true },
    })
    const autoJoin = resolveCustomization(org?.settings.customization).autoJoinChannelIds
    const defaults = await tx
      .select({ id: channels.id })
      .from(channels)
      .where(
        and(
          eq(channels.orgId, opts.orgId),
          autoJoin.length
            ? or(eq(channels.isDefault, true), inArray(channels.id, autoJoin))
            : eq(channels.isDefault, true),
          eq(channels.kind, 'public'),
          isNull(channels.archivedAt),
        ),
      )
    if (defaults.length) {
      await tx
        .insert(channelMembers)
        .values(defaults.map((c) => ({ channelId: c.id, userId: opts.userId, orgId: opts.orgId })))
        .onConflictDoNothing()
    }
    return defaults.map((c) => c.id)
  })
  if (joined) await emitHook(ctx, 'orgJoined', { orgId: opts.orgId, userId: opts.userId })
  for (const channelId of joinedChannels)
    await publishChannelJoined(ctx, opts.orgId, channelId, opts.userId)
}

export async function findOpenInvitation(ctx: AppContext, token: string) {
  return ctx.db.query.invitations.findFirst({
    where: and(eq(invitations.tokenHash, sha256(token)), isNull(invitations.revokedAt)),
  })
}

/** Accepts an invitation for a signed-in user whose email matches it. */
export async function acceptInvitation(
  ctx: AppContext,
  token: string,
  userId: string,
  ip: string | null,
) {
  const inv = await findOpenInvitation(ctx, token)
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) {
    throw badRequest('This invitation is invalid or has expired.')
  }
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) })
  if (!u || u.email.toLowerCase() !== inv.email.toLowerCase()) {
    throw forbidden(
      `This invitation was sent to ${inv.email}. Sign in with that address to accept it.`,
    )
  }
  const [claimed] = await ctx.db
    .update(invitations)
    .set({ acceptedAt: new Date() })
    .where(
      and(
        eq(invitations.id, inv.id),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .returning()
  if (!claimed) throw badRequest('This invitation has already been used.')

  // Accepting proves the user controls the mailbox.
  if (!u.emailVerifiedAt) {
    await ctx.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId))
  }
  await addUserToOrg(ctx, {
    orgId: inv.orgId,
    userId,
    role: inv.role,
    departmentId: inv.departmentId,
  })
  await audit(ctx.db, {
    orgId: inv.orgId,
    actorId: userId,
    action: 'invitation.accepted',
    targetType: 'invitation',
    targetId: inv.id,
    metadata: { role: inv.role },
    ip,
  })
  const org = await ctx.db.query.organizations.findFirst({
    where: eq(organizations.id, inv.orgId),
    columns: { id: true, slug: true },
  })
  return org!
}

export function inviteLink(ctx: AppContext, token: string) {
  return `${ctx.config.WEB_ORIGIN}/invite/${token}`
}

export const lowerEmail = (col: typeof invitations.email) => sql`lower(${col})`

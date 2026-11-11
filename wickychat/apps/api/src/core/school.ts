/**
 * WickyChat is one school, one organization. Only @chadwickschool.org addresses can sign up,
 * and everyone who signs in lands in the single "Chadwick International" organization.
 */
import { channelMembers, channels, organizations, orgMemberships } from '@quid/db'
import { and, eq } from 'drizzle-orm'
import { addUserToOrg } from '../modules/orgs/invitations'
import type { AppContext } from './context'
import { forbidden } from './errors'

export const schoolDomain = (ctx: AppContext) => ctx.config.SCHOOL_EMAIL_DOMAIN.toLowerCase()

export function isSchoolEmail(ctx: AppContext, email: string) {
  const at = email.trim().toLowerCase().lastIndexOf('@')
  return (
    at > 0 &&
    email
      .trim()
      .toLowerCase()
      .slice(at + 1) === schoolDomain(ctx)
  )
}

export function assertSchoolEmail(ctx: AppContext, email: string) {
  if (!isSchoolEmail(ctx, email))
    throw forbidden(`WickyChat is only for @${schoolDomain(ctx)} accounts.`)
}

const isAdminEmail = (ctx: AppContext, email: string) =>
  ctx.config.SCHOOL_ADMIN_EMAILS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.trim().toLowerCase())

let cachedOrgId: string | null = null

/** The one organization. Created on first use, together with its default channels. */
export async function schoolOrgId(ctx: AppContext, creatorId: string): Promise<string> {
  if (cachedOrgId) return cachedOrgId
  const slug = ctx.config.SCHOOL_ORG_SLUG
  const found = await ctx.db.query.organizations.findFirst({
    where: eq(organizations.slug, slug),
    columns: { id: true },
  })
  if (found) {
    cachedOrgId = found.id
    return found.id
  }
  const id = await ctx.db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        name: ctx.config.SCHOOL_ORG_NAME,
        slug,
        createdBy: creatorId,
        allowedEmailDomains: [schoolDomain(ctx)],
      })
      .onConflictDoNothing()
      .returning({ id: organizations.id })
    if (!org) {
      const again = await tx.query.organizations.findFirst({
        where: eq(organizations.slug, slug),
        columns: { id: true },
      })
      return again!.id
    }
    const defaults = [
      {
        name: 'general',
        description: 'School-wide conversation',
        postingPolicy: 'everyone' as const,
      },
      {
        name: 'announcements',
        description: 'Official updates from Chadwick International',
        postingPolicy: 'admins' as const,
      },
    ]
    for (const d of defaults) {
      const [c] = await tx
        .insert(channels)
        .values({ orgId: org.id, kind: 'public', isDefault: true, createdBy: creatorId, ...d })
        .returning({ id: channels.id })
      await tx
        .insert(channelMembers)
        .values({ channelId: c!.id, userId: creatorId, orgId: org.id, role: 'owner' })
    }
    return org.id
  })
  cachedOrgId = id
  return id
}

/**
 * Puts a school user into the organization the first time they sign in. Someone an admin
 * deactivated stays deactivated: we never touch an existing membership.
 */
export async function ensureSchoolMember(ctx: AppContext, user: { id: string; email: string }) {
  if (!isSchoolEmail(ctx, user.email)) return
  const orgId = await schoolOrgId(ctx, user.id)
  const existing = await ctx.db.query.orgMemberships.findFirst({
    where: and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, user.id)),
    columns: { id: true },
  })
  if (existing) return
  const owner = await ctx.db.query.orgMemberships.findFirst({
    where: and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, 'owner')),
    columns: { id: true },
  })
  const role = !owner || isAdminEmail(ctx, user.email) ? 'owner' : 'member'
  await addUserToOrg(ctx, { orgId, userId: user.id, role })
}

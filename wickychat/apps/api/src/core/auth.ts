/**
 * Session authentication and organization access.
 *
 * Sessions are opaque random tokens. Only a SHA-256 hash is stored, so a
 * database leak does not leak usable sessions.
 */
import { organizations, orgMemberships, sessions, users } from '@quid/db'
import type { OrgAction, OrgRole } from '@quid/shared'
import { can } from '@quid/shared'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AppContext } from './context'
import { randomToken, sha256 } from './crypto'
import { AppError, forbidden, notFound, unauthorized } from './errors'
import { ensureSchoolMember } from './school'

export const SESSION_COOKIE = 'quid_session'
const TOUCH_INTERVAL_MS = 10 * 60_000

export interface SessionUser {
  id: string
  email: string
  name: string
  emailVerified: boolean
  sessionId: string
  authMethod: 'password' | 'google'
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null
  }
}

export async function createSession(
  ctx: AppContext,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  method: 'password' | 'google' = 'password',
) {
  const token = randomToken()
  const expiresAt = new Date(Date.now() + ctx.config.SESSION_TTL_DAYS * 86_400_000)
  await ctx.db.insert(sessions).values({
    userId,
    method,
    tokenHash: sha256(token),
    expiresAt,
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
  })
  setSessionCookie(ctx, reply, token, expiresAt)
  const u = await ctx.db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, email: true },
  })
  if (u) await ensureSchoolMember(ctx, u)
}

export function setSessionCookie(
  ctx: AppContext,
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: ctx.config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

export function clearSessionCookie(ctx: AppContext, reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    secure: ctx.config.cookieSecure,
    sameSite: 'lax',
  })
}

/** Resolves a session token to a user, sliding the expiry forward on use. */
export async function resolveSession(
  ctx: AppContext,
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null
  const rows = await ctx.db
    .select({
      sessionId: sessions.id,
      method: sessions.method,
      lastSeenAt: sessions.lastSeenAt,
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerifiedAt: users.emailVerifiedAt,
      isBot: users.isBot,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1)
  const row = rows[0]
  if (!row || row.isBot) return null

  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await ctx.db
      .update(sessions)
      .set({
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + ctx.config.SESSION_TTL_DAYS * 86_400_000),
      })
      .where(eq(sessions.id, row.sessionId))
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.emailVerifiedAt !== null,
    sessionId: row.sessionId,
    authMethod: row.method,
  }
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized()
  return req.user
}

export interface OrgScope {
  orgId: string
  userId: string
  role: OrgRole
  departmentId: string | null
  /** The workspace requires Google sign-in (Enterprise+). */
  requireGoogle?: boolean
}

/**
 * Resolves the caller's active membership in an org. Non-members get a 404,
 * so the API never confirms that an organization exists to outsiders.
 */
export async function requireOrg(
  ctx: AppContext,
  req: FastifyRequest,
  orgId: string,
): Promise<OrgScope> {
  const user = requireUser(req)
  const scope = await scopeFor(ctx, orgId, user.id)
  if (!scope) throw notFound('Organization')
  // Enterprise+ workspaces can require Google sign-in for everyone.
  if (user.authMethod !== 'google' && scope.requireGoogle) {
    throw new AppError(403, 'google_required', 'This workspace requires signing in with Google.')
  }
  return scope
}

/** Org scope for a user outside a request (jobs, bots). Null when not an active member. */
export async function scopeFor(
  ctx: AppContext,
  orgId: string,
  userId: string,
): Promise<OrgScope | null> {
  const [m] = await ctx.db
    .select({
      role: orgMemberships.role,
      departmentId: orgMemberships.departmentId,
      settings: organizations.settings,
    })
    .from(orgMemberships)
    .innerJoin(organizations, eq(organizations.id, orgMemberships.orgId))
    .where(
      and(
        eq(orgMemberships.orgId, orgId),
        eq(orgMemberships.userId, userId),
        isNull(orgMemberships.deactivatedAt),
      ),
    )
    .limit(1)
  return m
    ? {
        orgId,
        userId,
        role: m.role,
        departmentId: m.departmentId,
        requireGoogle: m.settings.requireGoogle === true,
      }
    : null
}

export function authorize(scope: OrgScope, action: OrgAction) {
  if (!can(scope.role, action)) throw forbidden()
}

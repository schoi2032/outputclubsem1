/**
 * Bearer tokens for connected apps (the WickyChat MCP server). A token acts as one
 * person in one organization, limited to its scopes, and stops working as soon
 * as that membership ends or an admin turns connected apps off.
 */
import { accessTokens, organizations, users } from '@quid/db'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { type OrgScope, scopeFor } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { randomToken, sha256 } from '../../core/crypto'

export const SCOPES = ['read', 'write'] as const
export type TokenScope = (typeof SCOPES)[number]

export const ACCESS_TTL_S = 3600
const REFRESH_TTL_MS = 30 * 86_400_000
const TOUCH_INTERVAL_MS = 5 * 60_000

export function normalizeScopes(input: string | string[] | undefined): TokenScope[] {
  const list = Array.isArray(input) ? input : (input ?? 'read').split(/\s+/)
  const set = new Set(
    list.filter((s): s is TokenScope => (SCOPES as readonly string[]).includes(s)),
  )
  set.add('read')
  return SCOPES.filter((s) => set.has(s))
}

/** Whether the organization allows connected apps (admins can turn them off). */
export async function connectedAppsAllowed(ctx: AppContext, orgId: string) {
  const org = await ctx.db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { settings: true },
  })
  return !!org && org.settings.connectedApps !== false
}

export async function issueOAuthToken(
  ctx: AppContext,
  t: { userId: string; orgId: string; clientId: string; name: string; scopes: TokenScope[] },
) {
  const accessToken = `quid_at_${randomToken()}`
  const refreshToken = `quid_rt_${randomToken()}`
  await ctx.db.insert(accessTokens).values({
    ...t,
    tokenHash: sha256(accessToken),
    expiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
    refreshHash: sha256(refreshToken),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  })
  return { accessToken, refreshToken }
}

/** Swaps a refresh token for a new pair (the old refresh token stops working). */
export async function rotateRefreshToken(ctx: AppContext, refreshToken: string, clientId: string) {
  const row = await ctx.db.query.accessTokens.findFirst({
    where: and(
      eq(accessTokens.refreshHash, sha256(refreshToken)),
      eq(accessTokens.clientId, clientId),
      isNull(accessTokens.revokedAt),
      gt(accessTokens.refreshExpiresAt, new Date()),
    ),
  })
  if (
    !row ||
    !(await scopeFor(ctx, row.orgId, row.userId)) ||
    !(await connectedAppsAllowed(ctx, row.orgId))
  )
    return null
  const accessToken = `quid_at_${randomToken()}`
  const next = `quid_rt_${randomToken()}`
  const updated = await ctx.db
    .update(accessTokens)
    .set({
      tokenHash: sha256(accessToken),
      expiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
      refreshHash: sha256(next),
      refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    })
    // Only the first of two concurrent refreshes wins.
    .where(and(eq(accessTokens.id, row.id), eq(accessTokens.refreshHash, sha256(refreshToken))))
    .returning({ id: accessTokens.id })
  if (!updated.length) return null
  return { accessToken, refreshToken: next, scopes: row.scopes }
}

export async function createPersonalToken(
  ctx: AppContext,
  t: {
    userId: string
    orgId: string
    name: string
    scopes: TokenScope[]
    expiresInDays: number | null
  },
) {
  const token = `quid_pat_${randomToken()}`
  const [row] = await ctx.db
    .insert(accessTokens)
    .values({
      userId: t.userId,
      orgId: t.orgId,
      name: t.name,
      scopes: t.scopes,
      tokenHash: sha256(token),
      expiresAt: t.expiresInDays ? new Date(Date.now() + t.expiresInDays * 86_400_000) : null,
    })
    .returning({ id: accessTokens.id })
  return { id: row!.id, token }
}

export interface TokenAuth {
  tokenId: string
  name: string
  scopes: TokenScope[]
  scope: OrgScope
}

/** Resolves an `Authorization: Bearer …` header. Null when missing, unknown, expired or revoked. */
export async function resolveBearer(
  ctx: AppContext,
  header: string | undefined,
): Promise<TokenAuth | null> {
  const m = /^Bearer\s+(\S{10,200})$/i.exec(header ?? '')
  if (!m) return null
  const rows = await ctx.db
    .select({ token: accessTokens, isBot: users.isBot })
    .from(accessTokens)
    .innerJoin(users, eq(users.id, accessTokens.userId))
    .where(
      and(
        eq(accessTokens.tokenHash, sha256(m[1]!)),
        isNull(accessTokens.revokedAt),
        or(isNull(accessTokens.expiresAt), gt(accessTokens.expiresAt, new Date())),
      ),
    )
    .limit(1)
  const row = rows[0]
  if (!row || row.isBot) return null
  const scope = await scopeFor(ctx, row.token.orgId, row.token.userId)
  if (!scope || !(await connectedAppsAllowed(ctx, row.token.orgId))) return null
  if (!row.token.lastUsedAt || Date.now() - row.token.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await ctx.db
      .update(accessTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(accessTokens.id, row.token.id))
  }
  return {
    tokenId: row.token.id,
    name: row.token.name,
    scopes: normalizeScopes(row.token.scopes),
    scope,
  }
}

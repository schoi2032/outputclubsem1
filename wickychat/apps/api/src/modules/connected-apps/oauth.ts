/**
 * OAuth 2.1 authorization server for connected apps, as the MCP authorization
 * spec expects: metadata (RFC 8414 / RFC 9728), dynamic client registration
 * (RFC 7591), authorization code + PKCE (S256 only) and refresh-token rotation.
 * Only public clients; consent happens on the web app's /oauth/authorize page.
 */
import { createHash } from 'node:crypto'
import { accessTokens, oauthClients, oauthCodes } from '@quid/db'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '../../core/audit'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { randomToken, sha256 } from '../../core/crypto'
import { badRequest, forbidden, notFound } from '../../core/errors'
import type { App } from '../../core/http'
import {
  ACCESS_TTL_S,
  connectedAppsAllowed,
  issueOAuthToken,
  normalizeScopes,
  rotateRefreshToken,
  SCOPES,
} from './tokens'

export const mcpUrl = (ctx: AppContext) => `${ctx.config.WEB_ORIGIN}/api/mcp`

/** https anywhere, http only on loopback (native and CLI clients). */
export function validRedirectUri(uri: string) {
  try {
    const u = new URL(uri)
    if (u.hash) return false
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  } catch {
    return false
  }
}

const b64url = (buf: Buffer) => buf.toString('base64url')
export const pkceChallenge = (verifier: string) =>
  b64url(createHash('sha256').update(verifier).digest())

class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description)
  }
}

export async function oauthRoutes(app: App, ctx: AppContext) {
  const issuer = ctx.config.WEB_ORIGIN

  // Forms are how OAuth clients talk to the token endpoint.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 16 * 1024 },
    (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)))
    },
  )

  const resourceMetadata = async () => ({
    resource: mcpUrl(ctx),
    authorization_servers: [issuer],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'WickyChat',
    resource_documentation: `${issuer}/settings/connected-apps`,
  })
  app.get('/.well-known/oauth-protected-resource', resourceMetadata)
  app.get('/.well-known/oauth-protected-resource/api/mcp', resourceMetadata)

  const serverMetadata = async () => ({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    scopes_supported: [...SCOPES],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
  })
  app.get('/.well-known/oauth-authorization-server', serverMetadata)
  app.get('/.well-known/openid-configuration', serverMetadata)

  app.post(
    '/api/oauth/register',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: {
        body: z.object({
          client_name: z.string().trim().max(100).optional(),
          redirect_uris: z.array(z.string().max(500)).min(1).max(10),
          token_endpoint_auth_method: z.string().optional(),
          grant_types: z.array(z.string()).optional(),
          response_types: z.array(z.string()).optional(),
          scope: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const b = req.body
      const bad = b.redirect_uris.find((u) => !validRedirectUri(u))
      if (bad)
        return reply.code(400).send({
          error: 'invalid_redirect_uri',
          error_description: `Redirect URI not allowed: ${bad}`,
        })
      if (b.token_endpoint_auth_method && b.token_endpoint_auth_method !== 'none')
        return reply.code(400).send({
          error: 'invalid_client_metadata',
          error_description: 'Only public clients (PKCE) are supported.',
        })
      const clientId = `quid_client_${randomToken(16)}`
      const name = b.client_name || new URL(b.redirect_uris[0]!).hostname
      await ctx.db.insert(oauthClients).values({ clientId, name, redirectUris: b.redirect_uris })
      return reply.code(201).send({
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: name,
        redirect_uris: b.redirect_uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      })
    },
  )

  /** For the consent page: who is asking, after checking the redirect URI. */
  app.get(
    '/api/oauth/clients/:clientId',
    {
      schema: {
        params: z.object({ clientId: z.string().max(100) }),
        querystring: z.object({ redirect_uri: z.string().max(500) }),
      },
    },
    async (req) => {
      const c = await ctx.db.query.oauthClients.findFirst({
        where: eq(oauthClients.clientId, req.params.clientId),
      })
      if (!c) throw notFound('App')
      if (!c.redirectUris.includes(req.query.redirect_uri))
        throw badRequest("This app's redirect address doesn't match its registration.")
      return {
        clientId: c.clientId,
        name: c.name,
        redirectHost: new URL(req.query.redirect_uri).host,
      }
    },
  )

  /** The signed-in user approves: returns where to send the browser, with a code. */
  app.post(
    '/api/oauth/authorize',
    {
      schema: {
        body: z.object({
          clientId: z.string().max(100),
          redirectUri: z.string().max(500),
          state: z.string().max(1000).optional(),
          codeChallenge: z.string().min(43).max(128),
          codeChallengeMethod: z.literal('S256'),
          orgId: z.uuid(),
          scopes: z.array(z.enum(SCOPES)).max(SCOPES.length),
        }),
      },
    },
    async (req) => {
      const b = req.body
      const scope = await requireOrg(ctx, req, b.orgId)
      if (!(await connectedAppsAllowed(ctx, b.orgId)))
        throw forbidden('Your organization has turned off connected apps.')
      const c = await ctx.db.query.oauthClients.findFirst({
        where: eq(oauthClients.clientId, b.clientId),
      })
      if (!c) throw notFound('App')
      if (!c.redirectUris.includes(b.redirectUri))
        throw badRequest("This app's redirect address doesn't match its registration.")
      const scopes = normalizeScopes(scope.role === 'guest' ? ['read'] : b.scopes)
      const code = randomToken()
      await ctx.db.insert(oauthCodes).values({
        codeHash: sha256(code),
        clientId: c.clientId,
        userId: scope.userId,
        orgId: b.orgId,
        scopes,
        redirectUri: b.redirectUri,
        codeChallenge: b.codeChallenge,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      })
      await audit(ctx.db, {
        orgId: b.orgId,
        actorId: scope.userId,
        action: 'connected_app.authorized',
        targetType: 'oauth_client',
        targetId: c.clientId,
        metadata: { name: c.name, scopes },
        ip: req.ip,
      })
      const to = new URL(b.redirectUri)
      to.searchParams.set('code', code)
      if (b.state) to.searchParams.set('state', b.state)
      to.searchParams.set('iss', issuer)
      return { redirectTo: to.toString() }
    },
  )

  app.post(
    '/api/oauth/token',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      reply.header('cache-control', 'no-store')
      const p = (req.body ?? {}) as Record<string, string | undefined>
      try {
        if (p.grant_type === 'authorization_code') {
          if (!p.code || !p.code_verifier || !p.client_id || !p.redirect_uri)
            throw new OAuthError(
              'invalid_request',
              'code, code_verifier, client_id and redirect_uri are required.',
            )
          const [row] = await ctx.db
            .update(oauthCodes)
            .set({ usedAt: new Date() })
            .where(
              and(
                eq(oauthCodes.codeHash, sha256(p.code)),
                isNull(oauthCodes.usedAt),
                gt(oauthCodes.expiresAt, new Date()),
              ),
            )
            .returning()
          if (!row || row.clientId !== p.client_id || row.redirectUri !== p.redirect_uri)
            throw new OAuthError('invalid_grant', 'The authorization code is invalid or expired.')
          if (pkceChallenge(p.code_verifier) !== row.codeChallenge)
            throw new OAuthError('invalid_grant', 'PKCE verification failed.')
          const client = await ctx.db.query.oauthClients.findFirst({
            where: eq(oauthClients.clientId, row.clientId),
          })
          const tokens = await issueOAuthToken(ctx, {
            userId: row.userId,
            orgId: row.orgId,
            clientId: row.clientId,
            name: client?.name ?? 'Connected app',
            scopes: normalizeScopes(row.scopes),
          })
          return {
            access_token: tokens.accessToken,
            token_type: 'Bearer',
            expires_in: ACCESS_TTL_S,
            refresh_token: tokens.refreshToken,
            scope: normalizeScopes(row.scopes).join(' '),
          }
        }
        if (p.grant_type === 'refresh_token') {
          if (!p.refresh_token || !p.client_id)
            throw new OAuthError('invalid_request', 'refresh_token and client_id are required.')
          const r = await rotateRefreshToken(ctx, p.refresh_token, p.client_id)
          if (!r)
            throw new OAuthError(
              'invalid_grant',
              'The refresh token is invalid, expired or revoked.',
            )
          return {
            access_token: r.accessToken,
            token_type: 'Bearer',
            expires_in: ACCESS_TTL_S,
            refresh_token: r.refreshToken,
            scope: normalizeScopes(r.scopes).join(' '),
          }
        }
        throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.')
      } catch (e) {
        if (e instanceof OAuthError)
          return reply.code(e.status).send({ error: e.error, error_description: e.description })
        throw e
      }
    },
  )

  /** RFC 7009: always 200, whether or not the token existed. */
  app.post(
    '/api/oauth/revoke',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => {
      const p = (req.body ?? {}) as Record<string, string | undefined>
      if (p.token) {
        const h = sha256(p.token)
        await ctx.db
          .update(accessTokens)
          .set({ revokedAt: new Date() })
          .where(
            and(
              or(eq(accessTokens.tokenHash, h), eq(accessTokens.refreshHash, h)),
              isNull(accessTokens.revokedAt),
            ),
          )
      }
      return {}
    },
  )
}

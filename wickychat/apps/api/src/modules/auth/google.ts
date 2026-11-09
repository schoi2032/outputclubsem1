/** "Continue with Google": sign in, sign up, or link to an existing account with the same verified email. */
import { createHash } from 'node:crypto'
import { identities, invitations, sessions, users } from '@quid/db'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import type { FastifyReply } from 'fastify'
import { z } from 'zod'
import { createSession } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { randomToken } from '../../core/crypto'
import { type App, authRateLimit } from '../../core/http'
import { isSchoolEmail } from '../../core/school'

const FLOW_COOKIE = 'quid_google_flow'
const COOKIE_PATH = '/api/auth/google'

export const safeNext = (next: string | undefined | null) =>
  next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
    ? next.slice(0, 500)
    : '/'

export async function googleRoutes(app: App, ctx: AppContext) {
  const google = ctx.google
  const redirectUri = `${ctx.config.WEB_ORIGIN}/api/auth/google/callback`

  const fail = (reply: FastifyReply, error: string) => {
    reply.clearCookie(FLOW_COOKIE, { path: COOKIE_PATH })
    return reply.redirect(`${ctx.config.WEB_ORIGIN}/login?error=${error}`, 302)
  }

  app.get('/api/auth/providers', async () => ({ google: !!google }))

  app.get(
    '/api/auth/google/start',
    {
      ...authRateLimit,
      schema: { querystring: z.object({ next: z.string().max(500).optional() }) },
    },
    async (req, reply) => {
      if (!google)
        return reply.redirect(`${ctx.config.WEB_ORIGIN}/login?error=google_unavailable`, 302)
      const flow = {
        state: randomToken(16),
        nonce: randomToken(16),
        verifier: randomToken(32),
        next: safeNext(req.query.next),
      }
      reply.setCookie(FLOW_COOKIE, JSON.stringify(flow), {
        httpOnly: true,
        secure: ctx.config.cookieSecure,
        // Lax: sent on Google's top-level redirect back to us.
        sameSite: 'lax',
        path: COOKIE_PATH,
        maxAge: 600,
      })
      const challenge = createHash('sha256').update(flow.verifier).digest('base64url')
      return reply.redirect(
        google.authorizeUrl({
          state: flow.state,
          nonce: flow.nonce,
          codeChallenge: challenge,
          redirectUri,
          hd: ctx.config.SCHOOL_EMAIL_DOMAIN,
        }),
        302,
      )
    },
  )

  app.get(
    '/api/auth/google/callback',
    {
      ...authRateLimit,
      schema: {
        querystring: z.object({
          code: z.string().max(2000).optional(),
          state: z.string().max(200).optional(),
          error: z.string().max(200).optional(),
        }),
      },
    },
    async (req, reply) => {
      if (!google) return fail(reply, 'google_unavailable')
      let flow: { state: string; nonce: string; verifier: string; next: string } | null = null
      try {
        flow = JSON.parse(req.cookies[FLOW_COOKIE] ?? 'null')
      } catch {}
      if (req.query.error) return fail(reply, 'google_cancelled')
      // The state must match the browser that started the flow (stops login CSRF).
      if (!flow || !req.query.code || !req.query.state || req.query.state !== flow.state)
        return fail(reply, 'google_expired')

      let profile: Awaited<ReturnType<typeof google.exchange>>
      try {
        profile = await google.exchange(req.query.code, flow.verifier, redirectUri)
      } catch (err) {
        req.log.warn({ err }, 'google sign-in failed')
        return fail(reply, 'google_failed')
      }
      if (profile.nonce !== flow.nonce) return fail(reply, 'google_failed')

      const userId = await resolveUser(ctx, profile)
      if ('error' in userId) return fail(reply, userId.error)
      await createSession(ctx, req, reply, userId.id, 'google')
      reply.clearCookie(FLOW_COOKIE, { path: COOKIE_PATH })
      return reply.redirect(`${ctx.config.WEB_ORIGIN}${safeNext(flow.next)}`, 302)
    },
  )
}

async function resolveUser(
  ctx: AppContext,
  p: { sub: string; email: string; emailVerified: boolean; name: string },
): Promise<{ id: string } | { error: string }> {
  p = { ...p, email: p.email.trim().toLowerCase() }
  const linked = await ctx.db
    .select({ id: users.id, isBot: users.isBot })
    .from(identities)
    .innerJoin(users, eq(users.id, identities.userId))
    .where(and(eq(identities.provider, 'google'), eq(identities.subject, p.sub)))
    .limit(1)
  if (linked[0]) return linked[0].isBot ? { error: 'google_failed' } : { id: linked[0].id }

  // Only a mailbox Google has verified may claim or create an account.
  if (!p.emailVerified) return { error: 'google_unverified' }
  if (!isSchoolEmail(ctx, p.email)) return { error: 'school_only' }

  const existing = await ctx.db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${p.email}`,
  })
  if (existing) {
    if (existing.isBot) return { error: 'google_failed' }
    await ctx.db.transaction(async (tx) => {
      await tx
        .insert(identities)
        .values({ userId: existing.id, provider: 'google', subject: p.sub })
        .onConflictDoNothing()
      if (!existing.emailVerifiedAt) {
        // Someone registered this address without proving it. The mailbox owner wins:
        // drop that unproven password and any sessions it created.
        await tx
          .update(users)
          .set({ emailVerifiedAt: new Date(), passwordHash: null, updatedAt: new Date() })
          .where(eq(users.id, existing.id))
        await tx.delete(sessions).where(eq(sessions.userId, existing.id))
      }
    })
    return { id: existing.id }
  }

  if (!ctx.config.OPEN_REGISTRATION) {
    const invited = await ctx.db.query.invitations.findFirst({
      where: and(
        sql`lower(${invitations.email}) = ${p.email}`,
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
      columns: { id: true },
    })
    if (!invited) return { error: 'invite_only' }
  }

  const id = await ctx.db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({
        email: p.email,
        name: p.name,
        emailVerifiedAt: new Date(),
        termsAcceptedAt: new Date(),
      })
      .returning({ id: users.id })
    await tx.insert(identities).values({ userId: u!.id, provider: 'google', subject: p.sub })
    return u!.id
  })
  return { id }
}

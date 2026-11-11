import { hash, verify } from '@node-rs/argon2'
import {
  emailTokens,
  files,
  identities,
  invitations,
  organizations,
  orgMemberships,
  sessions,
  users,
} from '@quid/db'
import type { Me, OrgSummary } from '@quid/shared'
import {
  censorText,
  changePasswordSchema,
  cleanProfileStyle,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  resolveCustomization,
  resolvePreferences,
  updatePreferencesSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from '@quid/shared'
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { renderEmail } from '../../adapters/email'
import { clearSessionCookie, createSession, requireUser, SESSION_COOKIE } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { randomToken, sha256 } from '../../core/crypto'
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../core/errors'
import { type App, authRateLimit, idParams } from '../../core/http'
import { isPlatformAdmin } from '../../core/platform'
import { assertSchoolEmail } from '../../core/school'
import { acceptInvitation } from '../orgs/invitations'
import { avatarUrl, nameStyle } from '../users/serialize'

const VERIFY_TTL_MS = 48 * 3600_000
const RESET_TTL_MS = 60 * 60_000
const GENERIC_LOGIN_ERROR = 'Incorrect email or password'

// Used to keep login timing constant when the account does not exist.
const DUMMY_HASH = hash('quid-timing-equalizer')

async function issueEmailToken(
  ctx: AppContext,
  userId: string,
  kind: 'verify_email' | 'reset_password',
) {
  const token = randomToken()
  await ctx.db.insert(emailTokens).values({
    userId,
    kind,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + (kind === 'verify_email' ? VERIFY_TTL_MS : RESET_TTL_MS)),
  })
  return token
}

async function consumeEmailToken(
  ctx: AppContext,
  token: string,
  kind: 'verify_email' | 'reset_password',
) {
  const [row] = await ctx.db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailTokens.tokenHash, sha256(token)),
        eq(emailTokens.kind, kind),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: emailTokens.userId })
  return row?.userId ?? null
}

async function sendVerification(
  ctx: AppContext,
  user: { id: string; email: string; name: string },
) {
  const token = await issueEmailToken(ctx, user.id, 'verify_email')
  const url = `${ctx.config.WEB_ORIGIN}/verify-email?token=${token}`
  await ctx.email.send({
    to: user.email,
    subject: 'Verify your email for WickyChat',
    ...renderEmail({
      heading: `Welcome to WickyChat, ${user.name}`,
      body: 'Confirm your email address to finish setting up your account. This link expires in 48 hours.',
      cta: { label: 'Verify email', url },
      footer: "If you didn't create a WickyChat account, you can ignore this email.",
    }),
  })
}

export async function loadMe(
  ctx: AppContext,
  userId: string,
  authMethod: 'password' | 'google' = 'password',
): Promise<{ user: Me; orgs: OrgSummary[] }> {
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) })
  if (!u) throw unauthorized()
  const orgs = await ctx.db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      logoKey: organizations.logoKey,
      settings: organizations.settings,
      role: orgMemberships.role,
      joinedAt: orgMemberships.joinedAt,
    })
    .from(orgMemberships)
    .innerJoin(organizations, eq(organizations.id, orgMemberships.orgId))
    .where(and(eq(orgMemberships.userId, userId), isNull(orgMemberships.deactivatedAt)))
    .orderBy(orgMemberships.joinedAt)
  const linked = await ctx.db
    .select({ provider: identities.provider })
    .from(identities)
    .where(eq(identities.userId, userId))
  return {
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      displayName: u.displayName,
      avatarUrl: avatarUrl(u.avatarKey, u.avatarAnimated),
      isBot: false,
      decoration: u.decoration,
      bio: u.bio,
      pronouns: u.pronouns,
      bannerColor: u.bannerColor,
      bannerUrl: avatarUrl(u.bannerKey, u.bannerAnimated),
      profileStyle: cleanProfileStyle(u.profileStyle),
      nameStyle: nameStyle(u.profileStyle),
      coins: u.coins,
      emailVerified: u.emailVerifiedAt !== null,
      timezone: u.timezone,
      createdAt: u.createdAt.toISOString(),
      hasPassword: u.passwordHash !== null,
      linkedProviders: linked.map((l) => l.provider),
      authMethod,
      platformAdmin: isPlatformAdmin(ctx, u.email),
      preferences: resolvePreferences(u.preferences),
    },
    orgs: orgs.map((o) => ({
      id: o.id,
      slug: o.slug,
      name: o.name,
      logoUrl: avatarUrl(o.logoKey),
      role: o.role,
      requireGoogle: o.settings.requireGoogle === true,
      joinedAt: o.joinedAt.toISOString(),
      customization: resolveCustomization(o.settings.customization),
    })),
  }
}

export async function authRoutes(app: App, ctx: AppContext) {
  app.post(
    '/api/auth/register',
    {
      ...authRateLimit,
      schema: { body: registerSchema.extend({ inviteToken: z.string().max(200).optional() }) },
    },
    async (req, reply) => {
      const { name, email, password, inviteToken } = req.body
      assertSchoolEmail(ctx, email)
      if (!ctx.config.OPEN_REGISTRATION && !inviteToken) {
        throw forbidden('Registration is by invitation only')
      }

      const existing = await ctx.db.query.users.findFirst({
        where: sql`lower(${users.email}) = ${email}`,
        columns: { id: true, name: true, isBot: true },
      })
      if (existing && ctx.config.SKIP_EMAIL_VERIFICATION) {
        // No email service to tell the owner, so say it plainly.
        throw conflict('An account with this email already exists. Sign in instead.')
      }
      if (existing) {
        // Don't reveal that the account exists; tell the owner by email instead.
        await ctx.email.send({
          to: email,
          subject: 'You already have a WickyChat account',
          ...renderEmail({
            heading: 'Someone tried to sign up with your email',
            body: 'You already have a WickyChat account. If this was you, sign in or reset your password.',
            cta: { label: 'Sign in', url: `${ctx.config.WEB_ORIGIN}/login` },
          }),
        })
        return reply.code(202).send({ status: 'verification_sent' as const })
      }

      // An invitation sent to this address proves ownership of the mailbox.
      let invite: typeof invitations.$inferSelect | undefined
      if (inviteToken) {
        invite = await ctx.db.query.invitations.findFirst({
          where: and(
            eq(invitations.tokenHash, sha256(inviteToken)),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, new Date()),
          ),
        })
        if (invite && invite.email.toLowerCase() !== email) invite = undefined
      }

      const [user] = await ctx.db
        .insert(users)
        .values({
          email,
          name,
          passwordHash: await hash(password),
          emailVerifiedAt: invite || ctx.config.SKIP_EMAIL_VERIFICATION ? new Date() : null,
          termsAcceptedAt: new Date(),
        })
        .returning()

      if (invite && inviteToken) {
        await acceptInvitation(ctx, inviteToken, user!.id, req.ip)
        await createSession(ctx, req, reply, user!.id)
        return reply.code(201).send({ status: 'signed_in' as const })
      }

      if (ctx.config.SKIP_EMAIL_VERIFICATION) {
        await createSession(ctx, req, reply, user!.id)
        return reply.code(201).send({ status: 'signed_in' as const })
      }

      await sendVerification(ctx, user!)
      return reply.code(202).send({ status: 'verification_sent' as const })
    },
  )

  app.post(
    '/api/auth/login',
    { ...authRateLimit, schema: { body: loginSchema } },
    async (req, reply) => {
      const { email, password } = req.body
      const u = await ctx.db.query.users.findFirst({
        where: and(sql`lower(${users.email}) = ${email}`, eq(users.isBot, false)),
      })
      if (!u?.passwordHash) {
        await verify(await DUMMY_HASH, password).catch(() => false)
        throw unauthorized(GENERIC_LOGIN_ERROR)
      }
      if (!(await verify(u.passwordHash, password))) throw unauthorized(GENERIC_LOGIN_ERROR)
      if (!u.emailVerifiedAt) {
        return reply.code(403).send({
          error: {
            code: 'email_unverified',
            message: 'Verify your email address before signing in.',
          },
        })
      }
      await createSession(ctx, req, reply, u.id)
      return loadMe(ctx, u.id)
    },
  )

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE]
    if (token) await ctx.db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)))
    clearSessionCookie(ctx, reply)
    return { ok: true }
  })

  app.post(
    '/api/auth/verify-email',
    { ...authRateLimit, schema: { body: verifyEmailSchema } },
    async (req, reply) => {
      const userId = await consumeEmailToken(ctx, req.body.token, 'verify_email')
      if (!userId) throw badRequest('This verification link is invalid or has expired.')
      await ctx.db
        .update(users)
        .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)))
      await createSession(ctx, req, reply, userId)
      return loadMe(ctx, userId)
    },
  )

  app.post(
    '/api/auth/resend-verification',
    { ...authRateLimit, schema: { body: forgotPasswordSchema } },
    async (req, reply) => {
      const u = await ctx.db.query.users.findFirst({
        where: and(
          sql`lower(${users.email}) = ${req.body.email}`,
          isNull(users.emailVerifiedAt),
          eq(users.isBot, false),
        ),
      })
      if (u) await sendVerification(ctx, u)
      return reply.code(202).send({ ok: true })
    },
  )

  app.post(
    '/api/auth/forgot-password',
    { ...authRateLimit, schema: { body: forgotPasswordSchema } },
    async (req, reply) => {
      const u = await ctx.db.query.users.findFirst({
        where: and(sql`lower(${users.email}) = ${req.body.email}`, eq(users.isBot, false)),
      })
      if (u) {
        const token = await issueEmailToken(ctx, u.id, 'reset_password')
        await ctx.email.send({
          to: u.email,
          subject: 'Reset your WickyChat password',
          ...renderEmail({
            heading: 'Reset your password',
            body: 'Use the link below to choose a new password. It expires in one hour and can be used once.',
            cta: {
              label: 'Reset password',
              url: `${ctx.config.WEB_ORIGIN}/reset-password?token=${token}`,
            },
            footer:
              "If you didn't ask for this, you can ignore this email. Your password won't change.",
          }),
        })
      }
      return reply.code(202).send({ ok: true })
    },
  )

  app.post(
    '/api/auth/reset-password',
    { ...authRateLimit, schema: { body: resetPasswordSchema } },
    async (req, reply) => {
      const userId = await consumeEmailToken(ctx, req.body.token, 'reset_password')
      if (!userId) throw badRequest('This reset link is invalid or has expired.')
      await ctx.db
        .update(users)
        .set({
          passwordHash: await hash(req.body.password),
          emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
      // Sign out everywhere: a reset usually means the old password is compromised.
      await ctx.db.delete(sessions).where(eq(sessions.userId, userId))
      await createSession(ctx, req, reply, userId)
      return loadMe(ctx, userId)
    },
  )

  app.get('/api/me', async (req) => {
    const u = requireUser(req)
    return loadMe(ctx, u.id, u.authMethod)
  })

  app.patch('/api/me', { schema: { body: updateProfileSchema } }, async (req) => {
    const me = requireUser(req)
    const {
      name,
      displayName,
      timezone,
      avatarFileId,
      bio,
      pronouns,
      bannerColor,
      bannerFileId,
      profileStyle,
    } = req.body
    let bannerAnimated = false
    if (bannerFileId) {
      const f = await ctx.db.query.files.findFirst({
        where: and(
          eq(files.id, bannerFileId),
          eq(files.uploaderId, me.id),
          eq(files.purpose, 'banner'),
        ),
      })
      if (!f) throw notFound('File')
      bannerAnimated = f.animated
    }
    let avatarAnimated = false
    if (avatarFileId) {
      const f = await ctx.db.query.files.findFirst({
        where: and(
          eq(files.id, avatarFileId),
          eq(files.uploaderId, me.id),
          eq(files.purpose, 'avatar'),
        ),
      })
      if (!f) throw notFound('File')
      avatarAnimated = f.animated
    }
    await ctx.db
      .update(users)
      .set({
        ...(name !== undefined && { name }),
        ...(displayName !== undefined && { displayName: displayName || null }),
        ...(timezone !== undefined && { timezone }),
        ...(avatarFileId !== undefined && { avatarKey: avatarFileId, avatarAnimated }),
        // WickyChat profile card. The bio goes through the swear filter like messages do.
        ...(bio !== undefined && { bio: censorText(bio).text }),
        ...(pronouns !== undefined && { pronouns: censorText(pronouns).text }),
        ...(bannerColor !== undefined && { bannerColor }),
        ...(bannerFileId !== undefined && { bannerKey: bannerFileId, bannerAnimated }),
        ...(profileStyle !== undefined && {
          profileStyle: cleanProfileStyle(profileStyle) as Record<string, unknown>,
        }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, me.id))
    return loadMe(ctx, me.id)
  })

  // Merges into the stored preferences, so two devices changing different settings don't clash.
  app.patch('/api/me/preferences', { schema: { body: updatePreferencesSchema } }, async (req) => {
    const me = requireUser(req)
    const [row] = await ctx.db
      .update(users)
      .set({
        preferences: sql`${users.preferences} || ${JSON.stringify(req.body)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, me.id))
      .returning({ preferences: users.preferences })
    if (!row) throw unauthorized()
    return resolvePreferences(row.preferences)
  })

  app.post(
    '/api/me/password',
    { ...authRateLimit, schema: { body: changePasswordSchema } },
    async (req) => {
      const me = requireUser(req)
      const u = await ctx.db.query.users.findFirst({ where: eq(users.id, me.id) })
      if (!u) throw unauthorized()
      if (u.passwordHash && !(await verify(u.passwordHash, req.body.currentPassword ?? ''))) {
        throw badRequest('Your current password is incorrect.')
      }
      await ctx.db
        .update(users)
        .set({ passwordHash: await hash(req.body.newPassword), updatedAt: new Date() })
        .where(eq(users.id, me.id))
      // Keep this session, end all others.
      await ctx.db
        .delete(sessions)
        .where(and(eq(sessions.userId, me.id), ne(sessions.id, me.sessionId)))
      return { ok: true }
    },
  )

  app.get('/api/me/sessions', async (req) => {
    const me = requireUser(req)
    const rows = await ctx.db
      .select({
        id: sessions.id,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, me.id), gt(sessions.expiresAt, new Date())))
      .orderBy(sql`${sessions.lastSeenAt} desc`)
    return rows.map((r) => ({ ...r, current: r.id === me.sessionId }))
  })

  app.delete('/api/me/sessions/:id', { schema: { params: idParams } }, async (req) => {
    const me = requireUser(req)
    await ctx.db
      .delete(sessions)
      .where(and(eq(sessions.id, req.params.id), eq(sessions.userId, me.id)))
    return { ok: true }
  })
}

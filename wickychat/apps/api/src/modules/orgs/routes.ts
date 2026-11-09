import {
  auditLogs,
  channelMembers,
  departments,
  invitations,
  organizations,
  orgMemberships,
  teamMembers,
  teams,
  users,
} from '@quid/db'
import type {
  AuditEntry,
  Department,
  Invitation,
  InvitationPreview,
  Member,
  Org,
  OrgRole,
  Team,
} from '@quid/shared'
import {
  assignableRoles,
  canActOnMember,
  departmentSchema,
  inviteSchema,
  ROLE_LABEL,
  resolveCustomization,
  teamMemberSchema,
  teamSchema,
  updateMemberSchema,
  updateOrgSchema,
} from '@quid/shared'
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { renderEmail } from '../../adapters/email'
import { audit } from '../../core/audit'
import { authorize, type OrgScope, requireOrg, requireUser } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { randomToken, sha256 } from '../../core/crypto'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams, queryBool } from '../../core/http'
import { isSchoolEmail } from '../../core/school'
import { loadMe } from '../auth/routes'
import { publishChannelLeft } from '../channels/events'
import { presenceFor } from '../presence/service'
import { avatarUrl, toUserSummary, userCols } from '../users/serialize'
import { acceptInvitation, findOpenInvitation, INVITE_TTL_MS, inviteLink } from './invitations'

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === '23505'

/**
 * Users a member may see. Guests only see people they share a channel with;
 * everyone else sees the whole directory.
 */
function visibleTo(scope: OrgScope) {
  if (scope.role !== 'guest') return undefined
  return sql`${orgMemberships.userId} in (
    select cm2.user_id from channel_members cm1
    join channel_members cm2 on cm2.channel_id = cm1.channel_id
    where cm1.user_id = ${scope.userId} and cm1.org_id = ${scope.orgId})`
}

async function loadOrg(ctx: AppContext, scope: OrgScope): Promise<Org> {
  const org = await ctx.db.query.organizations.findFirst({
    where: eq(organizations.id, scope.orgId),
  })
  if (!org) throw notFound('Organization')
  const [count] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(orgMemberships)
    .innerJoin(users, eq(users.id, orgMemberships.userId))
    .where(
      and(
        eq(orgMemberships.orgId, org.id),
        isNull(orgMemberships.deactivatedAt),
        eq(users.isBot, false),
      ),
    )
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    logoUrl: avatarUrl(org.logoKey),
    role: scope.role,
    description: org.description,
    allowedEmailDomains: org.allowedEmailDomains,
    customization: resolveCustomization(org.settings.customization),
    createdAt: org.createdAt.toISOString(),
    memberCount: count?.n ?? 0,
  }
}

/** Department admins and team managers may only invite into their own scope. */
function assertCanInvite(scope: OrgScope, role: OrgRole, departmentId: string | null | undefined) {
  if (role === 'guest') authorize(scope, 'members.invite_guest')
  else authorize(scope, 'members.invite')
  if (!assignableRoles(scope.role).includes(role))
    throw forbidden(`You can't invite people as ${ROLE_LABEL[role]}.`)
  if (scope.role === 'dept_admin' && departmentId && departmentId !== scope.departmentId) {
    throw forbidden('You can only invite people into your own department.')
  }
}

export async function orgRoutes(app: App, ctx: AppContext) {
  // --- Organizations -------------------------------------------------------------

  // WickyChat has exactly one organization (Chadwick International); nobody can make another.
  app.post('/api/orgs', async () => {
    throw forbidden('WickyChat has one organization, Chadwick International.')
  })

  app.get('/api/orgs/:orgId', { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    return loadOrg(ctx, scope)
  })

  app.patch(
    '/api/orgs/:orgId',
    {
      schema: {
        params: orgParams,
        body: updateOrgSchema.extend({ logoFileId: z.uuid().nullable().optional() }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'org.update')
      const { logoFileId, ...rest } = req.body
      if (logoFileId) {
        const f = await ctx.db.query.files.findFirst({
          where: (f, { and, eq }) =>
            and(eq(f.id, logoFileId), eq(f.orgId, scope.orgId), eq(f.purpose, 'logo')),
        })
        if (!f) throw notFound('Logo')
      }
      await ctx.db
        .update(organizations)
        .set({ ...rest, ...(logoFileId !== undefined && { logoKey: logoFileId }) })
        .where(eq(organizations.id, scope.orgId))
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'org.settings_updated',
        metadata: { fields: Object.keys(req.body) },
        ip: req.ip,
      })
      await ctx.bus.publish(`org:${scope.orgId}`, { type: 'org.updated', orgId: scope.orgId })
      return loadOrg(ctx, scope)
    },
  )

  app.delete(
    '/api/orgs/:orgId',
    { schema: { params: orgParams, body: z.object({ confirmSlug: z.string() }) } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'org.delete')
      throw forbidden('The Chadwick International organization cannot be deleted.')
    },
  )

  // --- Members & directory -------------------------------------------------------------

  app.get(
    '/api/orgs/:orgId/members',
    {
      schema: {
        params: orgParams,
        querystring: z.object({
          q: z.string().max(100).default(''),
          departmentId: z.uuid().optional(),
          teamId: z.uuid().optional(),
          includeDeactivated: queryBool.default(false),
          limit: z.coerce.number().int().min(1).max(1000).default(500),
        }),
      },
    },
    async (req): Promise<Member[]> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const q = req.query
      const isAdmin = scope.role === 'owner' || scope.role === 'admin'
      const pattern = q.q ? `%${q.q.replace(/[%_\\]/g, '\\$&')}%` : null
      const rows = await ctx.db
        .select({
          user: userCols,
          email: users.email,
          role: orgMemberships.role,
          title: orgMemberships.title,
          departmentId: orgMemberships.departmentId,
          profile: orgMemberships.profile,
          joinedAt: orgMemberships.joinedAt,
          deactivatedAt: orgMemberships.deactivatedAt,
        })
        .from(orgMemberships)
        .innerJoin(users, eq(users.id, orgMemberships.userId))
        .where(
          and(
            eq(orgMemberships.orgId, scope.orgId),
            eq(users.isBot, false),
            q.includeDeactivated && isAdmin ? undefined : isNull(orgMemberships.deactivatedAt),
            q.departmentId ? eq(orgMemberships.departmentId, q.departmentId) : undefined,
            q.teamId
              ? inArray(
                  orgMemberships.userId,
                  ctx.db
                    .select({ id: teamMembers.userId })
                    .from(teamMembers)
                    .where(eq(teamMembers.teamId, q.teamId)),
                )
              : undefined,
            pattern
              ? or(
                  ilike(users.name, pattern),
                  ilike(users.displayName, pattern),
                  ilike(users.email, pattern),
                )
              : undefined,
            visibleTo(scope),
          ),
        )
        .orderBy(asc(users.name))
        .limit(q.limit)
      const presence = await presenceFor(
        ctx,
        rows.map((r) => r.user.id),
      )
      return rows.map((r) => {
        const p = presence.get(r.user.id)
        return {
          ...toUserSummary(r.user),
          // Guests don't see email addresses.
          email: scope.role === 'guest' ? '' : r.email,
          role: r.role,
          title: r.title,
          departmentId: r.departmentId,
          joinedAt: r.joinedAt.toISOString(),
          deactivated: r.deactivatedAt !== null,
          presence: p?.status ?? 'offline',
          statusText: p?.statusText ?? null,
          statusEmoji: p?.statusEmoji ?? null,
          lastActiveAt: p?.lastActiveAt ?? null,
          profile: r.profile,
        }
      })
    },
  )

  app.patch(
    '/api/orgs/:orgId/members/:id',
    { schema: { params: orgIdParams, body: updateMemberSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const target = await ctx.db.query.orgMemberships.findFirst({
        where: and(eq(orgMemberships.orgId, scope.orgId), eq(orgMemberships.userId, req.params.id)),
      })
      if (!target) throw notFound('Member')
      const { role, title, departmentId } = req.body
      const self = target.userId === scope.userId

      if (role !== undefined && role !== target.role) {
        authorize(scope, 'members.change_role')
        if (self) throw badRequest("You can't change your own role.")
        if (!canActOnMember(scope.role, target.role) || !assignableRoles(scope.role).includes(role))
          throw forbidden()
        if (target.role === 'owner') {
          const [owners] = await ctx.db
            .select({ n: sql<number>`count(*)::int` })
            .from(orgMemberships)
            .where(
              and(
                eq(orgMemberships.orgId, scope.orgId),
                eq(orgMemberships.role, 'owner'),
                isNull(orgMemberships.deactivatedAt),
              ),
            )
          if ((owners?.n ?? 0) <= 1) throw badRequest('An organization needs at least one owner.')
        }
      }
      if ((title !== undefined || departmentId !== undefined) && !self) {
        const isAdmin = scope.role === 'owner' || scope.role === 'admin'
        const deptAdminOwnDept =
          scope.role === 'dept_admin' &&
          target.departmentId === scope.departmentId &&
          canActOnMember(scope.role, target.role)
        if (!isAdmin && !deptAdminOwnDept) throw forbidden()
      }
      if (departmentId !== undefined && self && scope.role !== 'owner' && scope.role !== 'admin') {
        throw forbidden('Ask an administrator to change your department.')
      }
      if (departmentId) {
        const d = await ctx.db.query.departments.findFirst({
          where: and(eq(departments.id, departmentId), eq(departments.orgId, scope.orgId)),
        })
        if (!d) throw notFound('Department')
      }

      await ctx.db
        .update(orgMemberships)
        .set({
          ...(role !== undefined && { role }),
          ...(title !== undefined && { title: title || null }),
          ...(departmentId !== undefined && { departmentId }),
        })
        .where(eq(orgMemberships.id, target.id))

      if (role !== undefined && role !== target.role) {
        await audit(ctx.db, {
          orgId: scope.orgId,
          actorId: scope.userId,
          action: 'member.role_changed',
          targetType: 'user',
          targetId: target.userId,
          metadata: { from: target.role, to: role },
          ip: req.ip,
        })
        // A demotion to guest removes access to public channels they weren't explicitly in: nothing to do,
        // since guest visibility is computed from explicit membership.
      }
      if (departmentId !== undefined && departmentId !== target.departmentId) {
        await audit(ctx.db, {
          orgId: scope.orgId,
          actorId: scope.userId,
          action: 'member.department_changed',
          targetType: 'user',
          targetId: target.userId,
          metadata: { departmentId },
          ip: req.ip,
        })
      }
      return { ok: true }
    },
  )

  /** Deactivates a member: they lose access immediately but their messages remain. */
  app.delete('/api/orgs/:orgId/members/:id', { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const self = req.params.id === scope.userId
    const target = await ctx.db.query.orgMemberships.findFirst({
      where: and(
        eq(orgMemberships.orgId, scope.orgId),
        eq(orgMemberships.userId, req.params.id),
        isNull(orgMemberships.deactivatedAt),
      ),
    })
    if (!target) throw notFound('Member')
    if (!self) {
      authorize(scope, 'members.remove')
      if (!canActOnMember(scope.role, target.role)) throw forbidden()
    }
    if (target.role === 'owner') {
      const [owners] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.orgId, scope.orgId),
            eq(orgMemberships.role, 'owner'),
            isNull(orgMemberships.deactivatedAt),
          ),
        )
      if ((owners?.n ?? 0) <= 1)
        throw badRequest('Transfer ownership before leaving. An organization needs an owner.')
    }
    const memberships = await ctx.db
      .delete(channelMembers)
      .where(and(eq(channelMembers.orgId, scope.orgId), eq(channelMembers.userId, target.userId)))
      .returning({ channelId: channelMembers.channelId })
    await ctx.db
      .delete(teamMembers)
      .where(and(eq(teamMembers.orgId, scope.orgId), eq(teamMembers.userId, target.userId)))
    await ctx.db
      .update(orgMemberships)
      .set({ deactivatedAt: new Date() })
      .where(eq(orgMemberships.id, target.id))
    await audit(ctx.db, {
      orgId: scope.orgId,
      actorId: scope.userId,
      action: self ? 'member.left' : 'member.removed',
      targetType: 'user',
      targetId: target.userId,
      metadata: { role: target.role },
      ip: req.ip,
    })
    for (const m of memberships)
      await publishChannelLeft(ctx, scope.orgId, m.channelId, target.userId)
    return { ok: true }
  })

  // --- Invitations ---------------------------------------------------------------------

  app.get(
    '/api/orgs/:orgId/invitations',
    { schema: { params: orgParams } },
    async (req): Promise<Invitation[]> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'members.invite_guest')
      const rows = await ctx.db
        .select({ inv: invitations, by: userCols })
        .from(invitations)
        .leftJoin(users, eq(users.id, invitations.invitedBy))
        .where(
          and(
            eq(invitations.orgId, scope.orgId),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(invitations.createdAt))
      return rows.map((r) => ({
        id: r.inv.id,
        email: r.inv.email,
        role: r.inv.role,
        invitedBy: r.by?.id ? toUserSummary(r.by) : null,
        createdAt: r.inv.createdAt.toISOString(),
        expiresAt: r.inv.expiresAt.toISOString(),
      }))
    },
  )

  app.post(
    '/api/orgs/:orgId/invitations',
    {
      schema: { params: orgParams, body: inviteSchema },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { emails, role, departmentId } = req.body
      assertCanInvite(scope, role, departmentId)
      const effectiveDept =
        scope.role === 'dept_admin' ? (departmentId ?? scope.departmentId) : departmentId
      if (effectiveDept) {
        const d = await ctx.db.query.departments.findFirst({
          where: and(eq(departments.id, effectiveDept), eq(departments.orgId, scope.orgId)),
        })
        if (!d) throw notFound('Department')
      }
      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, scope.orgId),
      })
      const inviter = await ctx.db.query.users.findFirst({ where: eq(users.id, scope.userId) })
      // WickyChat: only school accounts can ever sign in, so only school addresses can be invited.
      const bad = emails.filter((e) => !isSchoolEmail(ctx, e))
      if (bad.length)
        throw badRequest(`Only @${ctx.config.SCHOOL_EMAIL_DOMAIN} addresses can be invited.`)

      const results: { email: string; status: 'invited' | 'already_member' }[] = []
      for (const email of [...new Set(emails)]) {
        const existing = await ctx.db
          .select({ id: orgMemberships.id })
          .from(orgMemberships)
          .innerJoin(users, eq(users.id, orgMemberships.userId))
          .where(
            and(
              eq(orgMemberships.orgId, scope.orgId),
              sql`lower(${users.email}) = ${email}`,
              isNull(orgMemberships.deactivatedAt),
            ),
          )
          .limit(1)
        if (existing.length) {
          results.push({ email, status: 'already_member' })
          continue
        }
        // Replace any outstanding invite for the same address.
        await ctx.db
          .update(invitations)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(invitations.orgId, scope.orgId),
              sql`lower(${invitations.email}) = ${email}`,
              isNull(invitations.acceptedAt),
              isNull(invitations.revokedAt),
            ),
          )
        const token = randomToken()
        const [inv] = await ctx.db
          .insert(invitations)
          .values({
            orgId: scope.orgId,
            email,
            role,
            departmentId: effectiveDept ?? null,
            tokenHash: sha256(token),
            invitedBy: scope.userId,
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          })
          .returning()
        await ctx.email.send({
          to: email,
          subject: `${inviter?.name ?? 'Someone'} invited you to ${org!.name} on WickyChat`,
          ...renderEmail({
            heading: `Join ${org!.name} on WickyChat`,
            body: `${inviter?.name ?? 'A teammate'} invited you to join ${org!.name} as ${ROLE_LABEL[role].toLowerCase()}. This invitation expires in 7 days.`,
            cta: { label: 'Accept invitation', url: inviteLink(ctx, token) },
            footer: `This invitation was sent to ${email}.`,
          }),
        })
        await audit(ctx.db, {
          orgId: scope.orgId,
          actorId: scope.userId,
          action: 'invitation.sent',
          targetType: 'invitation',
          targetId: inv!.id,
          metadata: { email, role },
          ip: req.ip,
        })
        results.push({ email, status: 'invited' })
      }
      return { results }
    },
  )

  app.delete(
    '/api/orgs/:orgId/invitations/:id',
    { schema: { params: orgIdParams } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'members.invite_guest')
      const inv = await ctx.db.query.invitations.findFirst({
        where: and(
          eq(invitations.id, req.params.id),
          eq(invitations.orgId, scope.orgId),
          isNull(invitations.acceptedAt),
        ),
      })
      if (!inv) throw notFound('Invitation')
      if (inv.invitedBy !== scope.userId) authorize(scope, 'members.invite')
      await ctx.db
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(eq(invitations.id, inv.id))
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'invitation.revoked',
        targetType: 'invitation',
        targetId: inv.id,
        metadata: { email: inv.email },
        ip: req.ip,
      })
      return { ok: true }
    },
  )

  /** Public preview so the invite page can show who invited you before you sign in. */
  app.get(
    '/api/invitations/:token',
    {
      schema: { params: z.object({ token: z.string().min(16).max(200) }) },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req): Promise<InvitationPreview> => {
      const inv = await findOpenInvitation(ctx, req.params.token)
      if (!inv) throw notFound('Invitation')
      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, inv.orgId),
      })
      const by = inv.invitedBy
        ? await ctx.db.query.users.findFirst({ where: eq(users.id, inv.invitedBy) })
        : null
      return {
        orgName: org!.name,
        orgSlug: org!.slug,
        email: inv.email,
        role: inv.role,
        invitedByName: by?.name ?? null,
        expired: inv.expiresAt < new Date(),
        accepted: inv.acceptedAt !== null,
      }
    },
  )

  app.post(
    '/api/invitations/:token/accept',
    { schema: { params: z.object({ token: z.string().min(16).max(200) }) } },
    async (req) => {
      const me = requireUser(req)
      const org = await acceptInvitation(ctx, req.params.token, me.id, req.ip)
      return { org, ...(await loadMe(ctx, me.id)) }
    },
  )

  // --- Departments ---------------------------------------------------------------------

  app.get(
    '/api/orgs/:orgId/departments',
    { schema: { params: orgParams } },
    async (req): Promise<Department[]> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const rows = await ctx.db
        .select({
          d: departments,
          n: sql<number>`(select count(*)::int from org_memberships m where m.department_id = departments.id and m.deactivated_at is null)`,
        })
        .from(departments)
        .where(eq(departments.orgId, scope.orgId))
        .orderBy(asc(departments.name))
      return rows.map((r) => ({
        id: r.d.id,
        name: r.d.name,
        description: r.d.description,
        memberCount: r.n,
      }))
    },
  )

  app.post(
    '/api/orgs/:orgId/departments',
    { schema: { params: orgParams, body: departmentSchema } },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'departments.manage')
      try {
        const [d] = await ctx.db
          .insert(departments)
          .values({ orgId: scope.orgId, ...req.body })
          .returning()
        await audit(ctx.db, {
          orgId: scope.orgId,
          actorId: scope.userId,
          action: 'department.created',
          targetType: 'department',
          targetId: d!.id,
          metadata: { name: d!.name },
          ip: req.ip,
        })
        return reply
          .code(201)
          .send({ id: d!.id, name: d!.name, description: d!.description, memberCount: 0 })
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict('A department with that name already exists.')
        throw e
      }
    },
  )

  app.patch(
    '/api/orgs/:orgId/departments/:id',
    { schema: { params: orgIdParams, body: departmentSchema.partial() } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const isOwnDept = scope.role === 'dept_admin' && scope.departmentId === req.params.id
      if (!isOwnDept) authorize(scope, 'departments.manage')
      try {
        const [d] = await ctx.db
          .update(departments)
          .set(req.body)
          .where(and(eq(departments.id, req.params.id), eq(departments.orgId, scope.orgId)))
          .returning()
        if (!d) throw notFound('Department')
        return { ok: true }
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict('A department with that name already exists.')
        throw e
      }
    },
  )

  app.delete(
    '/api/orgs/:orgId/departments/:id',
    { schema: { params: orgIdParams } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'departments.manage')
      const [d] = await ctx.db
        .delete(departments)
        .where(and(eq(departments.id, req.params.id), eq(departments.orgId, scope.orgId)))
        .returning()
      if (!d) throw notFound('Department')
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'department.deleted',
        targetType: 'department',
        targetId: d.id,
        metadata: { name: d.name },
        ip: req.ip,
      })
      return { ok: true }
    },
  )

  // --- Teams -------------------------------------------------------------------------------

  const loadTeams = async (orgId: string, ids?: string[]): Promise<Team[]> => {
    const rows = await ctx.db
      .select()
      .from(teams)
      .where(and(eq(teams.orgId, orgId), ids ? inArray(teams.id, ids) : undefined))
      .orderBy(asc(teams.name))
    if (!rows.length) return []
    const members = await ctx.db
      .select({
        teamId: teamMembers.teamId,
        userId: teamMembers.userId,
        isManager: teamMembers.isManager,
      })
      .from(teamMembers)
      .where(
        inArray(
          teamMembers.teamId,
          rows.map((r) => r.id),
        ),
      )
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      departmentId: t.departmentId,
      members: members
        .filter((m) => m.teamId === t.id)
        .map(({ userId, isManager }) => ({ userId, isManager })),
    }))
  }

  /** Admins manage all teams; dept admins teams in their department; managers their own team's members. */
  const canManageTeam = async (scope: OrgScope, teamId: string, membersOnly: boolean) => {
    if (scope.role === 'owner' || scope.role === 'admin') return true
    const t = await ctx.db.query.teams.findFirst({
      where: and(eq(teams.id, teamId), eq(teams.orgId, scope.orgId)),
    })
    if (!t) throw notFound('Team')
    if (scope.role === 'dept_admin' && t.departmentId && t.departmentId === scope.departmentId)
      return true
    if (membersOnly) {
      const m = await ctx.db.query.teamMembers.findFirst({
        where: and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, scope.userId),
          eq(teamMembers.isManager, true),
        ),
      })
      return !!m
    }
    return false
  }

  app.get('/api/orgs/:orgId/teams', { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    authorize(scope, 'directory.read')
    return loadTeams(scope.orgId)
  })

  app.post(
    '/api/orgs/:orgId/teams',
    { schema: { params: orgParams, body: teamSchema } },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'teams.manage')
      if (scope.role === 'dept_admin' && req.body.departmentId !== scope.departmentId) {
        throw forbidden('You can only create teams in your department.')
      }
      if (req.body.departmentId) {
        const d = await ctx.db.query.departments.findFirst({
          where: and(eq(departments.id, req.body.departmentId), eq(departments.orgId, scope.orgId)),
        })
        if (!d) throw notFound('Department')
      }
      try {
        const [t] = await ctx.db
          .insert(teams)
          .values({ orgId: scope.orgId, ...req.body })
          .returning()
        await audit(ctx.db, {
          orgId: scope.orgId,
          actorId: scope.userId,
          action: 'team.created',
          targetType: 'team',
          targetId: t!.id,
          metadata: { name: t!.name },
          ip: req.ip,
        })
        return reply.code(201).send((await loadTeams(scope.orgId, [t!.id]))[0])
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict('A team with that name already exists.')
        throw e
      }
    },
  )

  app.patch(
    '/api/orgs/:orgId/teams/:id',
    { schema: { params: orgIdParams, body: teamSchema.partial() } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      if (!(await canManageTeam(scope, req.params.id, false))) throw forbidden()
      try {
        const [t] = await ctx.db
          .update(teams)
          .set(req.body)
          .where(and(eq(teams.id, req.params.id), eq(teams.orgId, scope.orgId)))
          .returning()
        if (!t) throw notFound('Team')
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict('A team with that name already exists.')
        throw e
      }
      return (await loadTeams(scope.orgId, [req.params.id]))[0]
    },
  )

  app.delete('/api/orgs/:orgId/teams/:id', { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    if (!(await canManageTeam(scope, req.params.id, false))) throw forbidden()
    const [t] = await ctx.db
      .delete(teams)
      .where(and(eq(teams.id, req.params.id), eq(teams.orgId, scope.orgId)))
      .returning()
    if (!t) throw notFound('Team')
    await audit(ctx.db, {
      orgId: scope.orgId,
      actorId: scope.userId,
      action: 'team.deleted',
      targetType: 'team',
      targetId: t.id,
      metadata: { name: t.name },
      ip: req.ip,
    })
    return { ok: true }
  })

  app.put(
    '/api/orgs/:orgId/teams/:id/members',
    { schema: { params: orgIdParams, body: teamMemberSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      if (!(await canManageTeam(scope, req.params.id, true))) throw forbidden()
      const member = await ctx.db.query.orgMemberships.findFirst({
        where: and(
          eq(orgMemberships.orgId, scope.orgId),
          eq(orgMemberships.userId, req.body.userId),
          isNull(orgMemberships.deactivatedAt),
        ),
      })
      if (!member) throw notFound('Member')
      await ctx.db
        .insert(teamMembers)
        .values({
          teamId: req.params.id,
          userId: req.body.userId,
          orgId: scope.orgId,
          isManager: req.body.isManager,
        })
        .onConflictDoUpdate({
          target: [teamMembers.teamId, teamMembers.userId],
          set: { isManager: req.body.isManager },
        })
      return (await loadTeams(scope.orgId, [req.params.id]))[0]
    },
  )

  app.delete(
    '/api/orgs/:orgId/teams/:id/members/:userId',
    { schema: { params: orgIdParams.extend({ userId: z.uuid() }) } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      if (!(await canManageTeam(scope, req.params.id, true))) throw forbidden()
      await ctx.db
        .delete(teamMembers)
        .where(
          and(eq(teamMembers.teamId, req.params.id), eq(teamMembers.userId, req.params.userId)),
        )
      return (await loadTeams(scope.orgId, [req.params.id]))[0]
    },
  )

  // --- Audit log -------------------------------------------------------------------------

  app.get(
    '/api/orgs/:orgId/audit',
    {
      schema: {
        params: orgParams,
        querystring: z.object({
          before: z.uuid().optional(),
          action: z.string().max(80).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'audit.read')
      const q = req.query
      const rows = await ctx.db
        .select({ a: auditLogs, actor: userCols })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(
          and(
            eq(auditLogs.orgId, scope.orgId),
            q.before ? lt(auditLogs.id, q.before) : undefined,
            q.action
              ? ilike(auditLogs.action, `${q.action.replace(/[%_\\]/g, '\\$&')}%`)
              : undefined,
          ),
        )
        .orderBy(desc(auditLogs.id))
        .limit(q.limit + 1)
      const more = rows.length > q.limit
      const entries: AuditEntry[] = rows.slice(0, q.limit).map((r) => ({
        id: r.a.id,
        action: r.a.action,
        actor: r.actor?.id ? toUserSummary(r.actor) : null,
        targetType: r.a.targetType,
        targetId: r.a.targetId,
        metadata: r.a.metadata,
        ip: r.a.ip,
        createdAt: r.a.createdAt.toISOString(),
      }))
      return { entries, nextCursor: more ? entries[entries.length - 1]!.id : null }
    },
  )
}

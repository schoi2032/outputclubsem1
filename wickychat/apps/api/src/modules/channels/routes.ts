import {
  channelMembers,
  channels,
  departments,
  messages,
  orgMemberships,
  teams,
  users,
} from '@quid/db'
import {
  addMembersSchema,
  can,
  channelPrefsSchema,
  createChannelSchema,
  createConversationSchema,
  updateChannelMemberSchema,
  updateChannelSchema,
  updateConversationSchema,
} from '@quid/shared'
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '../../core/audit'
import { authorize, type OrgScope, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams, queryBool } from '../../core/http'
import { postSystemMessage } from '../messages/service'
import { presenceFor } from '../presence/service'
import { toUserSummary, userCols } from '../users/serialize'
import { publishChannelJoined, publishChannelLeft, publishChannelUpdated } from './events'
import {
  assertOrgMembers,
  check,
  getChannelAccess,
  requireChannel,
  serializeChannel,
  serializeChannels,
} from './service'

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === '23505'

async function latestMessageId(ctx: AppContext, channelId: string) {
  const [m] = await ctx.db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.channelId, channelId), isNull(messages.parentId)))
    .orderBy(desc(messages.id))
    .limit(1)
  return m?.id ?? null
}

async function assertScopeRefs(
  ctx: AppContext,
  orgId: string,
  departmentId?: string | null,
  teamId?: string | null,
) {
  if (departmentId) {
    const d = await ctx.db.query.departments.findFirst({
      where: and(eq(departments.id, departmentId), eq(departments.orgId, orgId)),
    })
    if (!d) throw notFound('Department')
  }
  if (teamId) {
    const t = await ctx.db.query.teams.findFirst({
      where: and(eq(teams.id, teamId), eq(teams.orgId, orgId)),
    })
    if (!t) throw notFound('Team')
  }
}

/** WickyChat: group chats with more than this many people need a teacher in them. */
const MAX_GROUP_WITHOUT_TEACHER = 3

/** Students can't make (or grow) a group chat past 3 people unless a teacher is in it. */
async function assertGroupSupervised(ctx: AppContext, orgId: string, memberIds: string[]) {
  const ids = [...new Set(memberIds)]
  if (ids.length <= MAX_GROUP_WITHOUT_TEACHER) return
  const teacher = await ctx.db.query.orgMemberships.findFirst({
    where: and(
      eq(orgMemberships.orgId, orgId),
      inArray(orgMemberships.userId, ids),
      inArray(orgMemberships.role, ['owner', 'admin']),
      isNull(orgMemberships.deactivatedAt),
    ),
    columns: { id: true },
  })
  if (!teacher)
    throw forbidden(
      `Group chats with more than ${MAX_GROUP_WITHOUT_TEACHER} people need a teacher in them. Add a teacher, or keep it to ${MAX_GROUP_WITHOUT_TEACHER}.`,
    )
}

/** Guests may only start conversations with people they already share a channel with. */
async function assertCanMessage(ctx: AppContext, scope: OrgScope, userIds: string[]) {
  await assertOrgMembers(ctx, scope.orgId, userIds)
  if (scope.role !== 'guest') return
  const shared = await ctx.db
    .selectDistinct({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(
      and(
        inArray(channelMembers.userId, userIds),
        inArray(
          channelMembers.channelId,
          ctx.db
            .select({ id: channelMembers.channelId })
            .from(channelMembers)
            .where(eq(channelMembers.userId, scope.userId)),
        ),
      ),
    )
  if (shared.length !== new Set(userIds).size)
    throw forbidden('Guests can only message people in their channels.')
}

export async function addChannelMembers(
  ctx: AppContext,
  scope: OrgScope,
  channelId: string,
  userIds: string[],
  opts: { announce: boolean },
) {
  const members = await assertOrgMembers(ctx, scope.orgId, userIds)
  const lastId = await latestMessageId(ctx, channelId)
  const inserted = await ctx.db
    .insert(channelMembers)
    .values(
      members.map((m) => ({
        channelId,
        userId: m.userId,
        orgId: scope.orgId,
        lastReadMessageId: lastId,
      })),
    )
    .onConflictDoNothing()
    .returning({ userId: channelMembers.userId })
  for (const { userId } of inserted) await publishChannelJoined(ctx, scope.orgId, channelId, userId)
  if (opts.announce && inserted.length) {
    const names = await ctx.db
      .select({ name: users.name })
      .from(users)
      .where(
        inArray(
          users.id,
          inserted.map((i) => i.userId),
        ),
      )
    const who = names.map((n) => n.name).join(', ')
    const self = inserted.length === 1 && inserted[0]!.userId === scope.userId
    await postSystemMessage(
      ctx,
      scope.orgId,
      channelId,
      scope.userId,
      self ? 'joined the channel' : `added ${who}`,
    )
  }
  if (inserted.length) await publishChannelUpdated(ctx, scope.orgId, channelId)
  return inserted.length
}

export async function channelRoutes(app: App, ctx: AppContext) {
  const base = '/api/orgs/:orgId'

  /** Sidebar: every channel, DM and group the caller belongs to. */
  app.get(`${base}/channels/mine`, { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const rows = await ctx.db
      .select({ c: channels })
      .from(channels)
      .innerJoin(
        channelMembers,
        and(eq(channelMembers.channelId, channels.id), eq(channelMembers.userId, scope.userId)),
      )
      .where(and(eq(channels.orgId, scope.orgId), eq(channelMembers.hidden, false)))
      .orderBy(asc(channels.name))
    return serializeChannels(
      ctx,
      scope.userId,
      rows.map((r) => r.c),
    )
  })

  app.get(
    `${base}/channels/browse`,
    {
      schema: {
        params: orgParams,
        querystring: z.object({
          q: z.string().max(80).default(''),
          archived: queryBool.default(false),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'channels.browse')
      const { q, archived } = req.query
      const rows = await ctx.db
        .select()
        .from(channels)
        .where(
          and(
            eq(channels.orgId, scope.orgId),
            or(
              eq(channels.kind, 'public'),
              and(
                eq(channels.kind, 'private'),
                // WickyChat: admins see every private channel so they can manage or delete it.
                can(scope.role, 'channels.manage_any')
                  ? undefined
                  : sql`exists (select 1 from channel_members cm where cm.channel_id = channels.id and cm.user_id = ${scope.userId})`,
              ),
            ),
            archived ? isNotNull(channels.archivedAt) : isNull(channels.archivedAt),
            q ? ilike(channels.name, `%${q.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
          ),
        )
        .orderBy(asc(channels.name))
        .limit(200)
      return serializeChannels(ctx, scope.userId, rows)
    },
  )

  app.post(
    `${base}/channels`,
    { schema: { params: orgParams, body: createChannelSchema } },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const body = req.body
      authorize(scope, body.kind === 'private' ? 'channels.create_private' : 'channels.create')
      await assertScopeRefs(ctx, scope.orgId, body.departmentId, body.teamId)
      const memberIds = [...new Set([scope.userId, ...body.memberIds])]
      await assertOrgMembers(ctx, scope.orgId, memberIds)

      let row: typeof channels.$inferSelect
      try {
        row = await ctx.db.transaction(async (tx) => {
          const [c] = await tx
            .insert(channels)
            .values({
              orgId: scope.orgId,
              kind: body.kind,
              name: body.name,
              description: body.description,
              departmentId: body.departmentId,
              teamId: body.teamId,
              postingPolicy: body.postingPolicy,
              createdBy: scope.userId,
            })
            .returning()
          await tx.insert(channelMembers).values(
            memberIds.map((userId) => ({
              channelId: c!.id,
              userId,
              orgId: scope.orgId,
              role: userId === scope.userId ? ('owner' as const) : ('member' as const),
            })),
          )
          return c!
        })
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict(`A channel named #${body.name} already exists.`)
        throw e
      }
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'channel.created',
        targetType: 'channel',
        targetId: row.id,
        metadata: { name: row.name, kind: row.kind },
        ip: req.ip,
      })
      for (const userId of memberIds) await publishChannelJoined(ctx, scope.orgId, row.id, userId)
      return reply.code(201).send(await serializeChannel(ctx, scope.userId, row))
    },
  )

  app.get(`${base}/channels/:id`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const { channel } = await requireChannel(ctx, scope, req.params.id, 'read')
    return serializeChannel(ctx, scope.userId, channel)
  })

  app.patch(
    `${base}/channels/:id`,
    { schema: { params: orgIdParams, body: updateChannelSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const a = await requireChannel(ctx, scope, req.params.id, 'manage')
      if (a.channel.kind === 'dm' || a.channel.kind === 'group')
        throw badRequest('Use the conversation endpoint')
      const b = req.body
      await assertScopeRefs(ctx, scope.orgId, b.departmentId, b.teamId)
      try {
        await ctx.db
          .update(channels)
          .set({
            ...(b.name !== undefined && { name: b.name }),
            ...(b.topic !== undefined && { topic: b.topic }),
            ...(b.description !== undefined && { description: b.description }),
            ...(b.postingPolicy !== undefined && { postingPolicy: b.postingPolicy }),
            ...(b.membersCanInvite !== undefined && { membersCanInvite: b.membersCanInvite }),
            ...(b.departmentId !== undefined && { departmentId: b.departmentId }),
            ...(b.teamId !== undefined && { teamId: b.teamId }),
          })
          .where(eq(channels.id, a.channel.id))
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict(`A channel named #${b.name} already exists.`)
        throw e
      }
      if (b.name !== undefined && b.name !== a.channel.name) {
        await postSystemMessage(
          ctx,
          scope.orgId,
          a.channel.id,
          scope.userId,
          `renamed the channel to #${b.name}`,
        )
      } else if (b.topic !== undefined && b.topic !== a.channel.topic) {
        await postSystemMessage(
          ctx,
          scope.orgId,
          a.channel.id,
          scope.userId,
          b.topic ? `set the topic: ${b.topic}` : 'cleared the topic',
        )
      }
      if (b.postingPolicy !== undefined && b.postingPolicy !== a.channel.postingPolicy) {
        await audit(ctx.db, {
          orgId: scope.orgId,
          actorId: scope.userId,
          action: 'channel.permissions_changed',
          targetType: 'channel',
          targetId: a.channel.id,
          metadata: { postingPolicy: b.postingPolicy },
          ip: req.ip,
        })
      }
      await publishChannelUpdated(ctx, scope.orgId, a.channel.id)
      const row = await ctx.db.query.channels.findFirst({ where: eq(channels.id, a.channel.id) })
      return serializeChannel(ctx, scope.userId, row!)
    },
  )

  for (const action of ['archive', 'unarchive'] as const) {
    app.post(`${base}/channels/:id/${action}`, { schema: { params: orgIdParams } }, async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const a = await requireChannel(ctx, scope, req.params.id, 'read')
      const allowed = check(scope, { ...a, channel: { ...a.channel, archivedAt: null } }, 'archive')
      if (!allowed) throw forbidden()
      if (a.channel.isDefault && action === 'archive')
        throw badRequest('Default channels cannot be archived.')
      await ctx.db
        .update(channels)
        .set({ archivedAt: action === 'archive' ? new Date() : null })
        .where(eq(channels.id, a.channel.id))
      await postSystemMessage(
        ctx,
        scope.orgId,
        a.channel.id,
        scope.userId,
        action === 'archive' ? 'archived the channel' : 'unarchived the channel',
      )
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: `channel.${action}d`,
        targetType: 'channel',
        targetId: a.channel.id,
        metadata: { name: a.channel.name },
        ip: req.ip,
      })
      await publishChannelUpdated(ctx, scope.orgId, a.channel.id)
      return { ok: true }
    })
  }

  app.delete(`${base}/channels/:id`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    // WickyChat: admins can delete any channel, including default and private ones.
    const a = await getChannelAccess(ctx, scope, req.params.id, { adminOverride: true })
    if (!check(scope, a, 'delete')) throw forbidden()
    const members = await ctx.db
      .select({ userId: channelMembers.userId })
      .from(channelMembers)
      .where(eq(channelMembers.channelId, a.channel.id))
    await ctx.db.delete(channels).where(eq(channels.id, a.channel.id))
    await audit(ctx.db, {
      orgId: scope.orgId,
      actorId: scope.userId,
      action: 'channel.deleted',
      targetType: 'channel',
      targetId: a.channel.id,
      metadata: { name: a.channel.name, kind: a.channel.kind },
      ip: req.ip,
    })
    for (const m of members) await publishChannelLeft(ctx, scope.orgId, a.channel.id, m.userId)
    return { ok: true }
  })

  app.post(`${base}/channels/:id/join`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const a = await requireChannel(ctx, scope, req.params.id, 'join')
    await addChannelMembers(ctx, scope, a.channel.id, [scope.userId], { announce: true })
    const row = await ctx.db.query.channels.findFirst({ where: eq(channels.id, a.channel.id) })
    return serializeChannel(ctx, scope.userId, row!)
  })

  app.post(`${base}/channels/:id/leave`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const a = await requireChannel(ctx, scope, req.params.id, 'read')
    if (!a.membership) throw badRequest("You're not a member of this channel.")
    if (a.channel.kind === 'dm') {
      // Leaving a DM just hides it until the next message.
      await ctx.db
        .update(channelMembers)
        .set({ hidden: true })
        .where(
          and(eq(channelMembers.channelId, a.channel.id), eq(channelMembers.userId, scope.userId)),
        )
      await ctx.bus.publish(`user:${scope.userId}`, {
        type: 'channel.left',
        orgId: scope.orgId,
        channelId: a.channel.id,
      })
      return { ok: true }
    }
    if (a.channel.isDefault) throw badRequest("You can't leave a default channel.")
    if (a.membership.role === 'owner') {
      const [other] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(channelMembers)
        .where(
          and(
            eq(channelMembers.channelId, a.channel.id),
            eq(channelMembers.role, 'owner'),
            ne(channelMembers.userId, scope.userId),
          ),
        )
      if (!other?.n && a.channel.kind !== 'group') {
        // Promote the longest-standing member so the channel keeps an owner.
        const [next] = await ctx.db
          .select({ userId: channelMembers.userId })
          .from(channelMembers)
          .where(
            and(
              eq(channelMembers.channelId, a.channel.id),
              ne(channelMembers.userId, scope.userId),
            ),
          )
          .orderBy(asc(channelMembers.joinedAt))
          .limit(1)
        if (next) {
          await ctx.db
            .update(channelMembers)
            .set({ role: 'owner' })
            .where(
              and(
                eq(channelMembers.channelId, a.channel.id),
                eq(channelMembers.userId, next.userId),
              ),
            )
        }
      }
    }
    await ctx.db
      .delete(channelMembers)
      .where(
        and(eq(channelMembers.channelId, a.channel.id), eq(channelMembers.userId, scope.userId)),
      )
    await postSystemMessage(
      ctx,
      scope.orgId,
      a.channel.id,
      scope.userId,
      a.channel.kind === 'group' ? 'left the conversation' : 'left the channel',
    )
    await publishChannelLeft(ctx, scope.orgId, a.channel.id, scope.userId)
    await publishChannelUpdated(ctx, scope.orgId, a.channel.id)
    return { ok: true }
  })

  app.get(`${base}/channels/:id/members`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const a = await requireChannel(ctx, scope, req.params.id, 'read')
    const rows = await ctx.db
      .select({
        user: userCols,
        role: channelMembers.role,
        orgRole: orgMemberships.role,
        title: orgMemberships.title,
      })
      .from(channelMembers)
      .innerJoin(users, eq(users.id, channelMembers.userId))
      .leftJoin(
        orgMemberships,
        and(eq(orgMemberships.userId, users.id), eq(orgMemberships.orgId, scope.orgId)),
      )
      .where(eq(channelMembers.channelId, a.channel.id))
      .orderBy(asc(users.name))
      .limit(1000)
    const presence = await presenceFor(
      ctx,
      rows.map((r) => r.user.id),
    )
    return rows.map((r) => ({
      ...toUserSummary(r.user),
      channelRole: r.role,
      orgRole: r.orgRole,
      title: r.title,
      presence: presence.get(r.user.id)?.status ?? 'offline',
    }))
  })

  app.post(
    `${base}/channels/:id/members`,
    { schema: { params: orgIdParams, body: addMembersSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const a = await requireChannel(ctx, scope, req.params.id, 'add_members')
      if (a.channel.kind === 'group') {
        await assertCanMessage(ctx, scope, req.body.userIds)
        const current = await ctx.db
          .select({ userId: channelMembers.userId })
          .from(channelMembers)
          .where(eq(channelMembers.channelId, a.channel.id))
        await assertGroupSupervised(ctx, scope.orgId, [
          ...current.map((m) => m.userId),
          ...req.body.userIds,
        ])
      }
      const added = await addChannelMembers(ctx, scope, a.channel.id, req.body.userIds, {
        announce: true,
      })
      if (a.channel.kind === 'private') {
        await audit(ctx.db, {
          orgId: scope.orgId,
          actorId: scope.userId,
          action: 'channel.members_added',
          targetType: 'channel',
          targetId: a.channel.id,
          metadata: { userIds: req.body.userIds },
          ip: req.ip,
        })
      }
      return { added }
    },
  )

  app.delete(
    `${base}/channels/:id/members/:userId`,
    { schema: { params: orgIdParams.extend({ userId: z.uuid() }) } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const a = await requireChannel(ctx, scope, req.params.id, 'remove_members')
      const { userId } = req.params
      if (userId === scope.userId) throw badRequest('Use leave to remove yourself.')
      const target = await ctx.db.query.channelMembers.findFirst({
        where: and(eq(channelMembers.channelId, a.channel.id), eq(channelMembers.userId, userId)),
      })
      if (!target) throw notFound('Member')
      if (
        target.role === 'owner' &&
        a.membership?.role !== 'owner' &&
        scope.role !== 'owner' &&
        scope.role !== 'admin'
      ) {
        throw forbidden('Only owners can remove another owner.')
      }
      await ctx.db
        .delete(channelMembers)
        .where(and(eq(channelMembers.channelId, a.channel.id), eq(channelMembers.userId, userId)))
      const [u] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, userId))
      await postSystemMessage(
        ctx,
        scope.orgId,
        a.channel.id,
        scope.userId,
        `removed ${u?.name ?? 'a member'}`,
      )
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'channel.member_removed',
        targetType: 'channel',
        targetId: a.channel.id,
        metadata: { userId },
        ip: req.ip,
      })
      await publishChannelLeft(ctx, scope.orgId, a.channel.id, userId)
      await publishChannelUpdated(ctx, scope.orgId, a.channel.id)
      return { ok: true }
    },
  )

  app.patch(
    `${base}/channels/:id/members/:userId`,
    {
      schema: { params: orgIdParams.extend({ userId: z.uuid() }), body: updateChannelMemberSchema },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const a = await requireChannel(ctx, scope, req.params.id, 'manage')
      if (a.channel.kind === 'dm' || a.channel.kind === 'group')
        throw badRequest('Conversations have no member roles.')
      if (
        req.body.role === 'owner' &&
        a.membership?.role !== 'owner' &&
        scope.role !== 'owner' &&
        scope.role !== 'admin'
      ) {
        throw forbidden('Only owners can grant ownership.')
      }
      const [updated] = await ctx.db
        .update(channelMembers)
        .set({ role: req.body.role })
        .where(
          and(
            eq(channelMembers.channelId, a.channel.id),
            eq(channelMembers.userId, req.params.userId),
          ),
        )
        .returning()
      if (!updated) throw notFound('Member')
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'channel.member_role_changed',
        targetType: 'channel',
        targetId: a.channel.id,
        metadata: { userId: req.params.userId, role: req.body.role },
        ip: req.ip,
      })
      return { ok: true }
    },
  )

  app.patch(
    `${base}/channels/:id/prefs`,
    { schema: { params: orgIdParams, body: channelPrefsSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const a = await requireChannel(ctx, scope, req.params.id, 'read')
      if (!a.membership) throw badRequest("You're not a member of this channel.")
      await ctx.db
        .update(channelMembers)
        .set(req.body)
        .where(
          and(eq(channelMembers.channelId, a.channel.id), eq(channelMembers.userId, scope.userId)),
        )
      return serializeChannel(ctx, scope.userId, a.channel)
    },
  )

  // --- Direct messages and group conversations -------------------------------

  app.post(
    `${base}/conversations`,
    { schema: { params: orgParams, body: createConversationSchema } },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'conversations.create')
      const others = [...new Set(req.body.userIds)].filter((id) => id !== scope.userId)
      await assertCanMessage(ctx, scope, others)
      const participantIds = [scope.userId, ...others]

      if (others.length <= 1 && !req.body.name) {
        // One-to-one (or a note-to-self): exactly one DM per pair.
        const dmKey = [...new Set(participantIds)].sort().join(':')
        let row = await ctx.db.query.channels.findFirst({
          where: and(eq(channels.orgId, scope.orgId), eq(channels.dmKey, dmKey)),
        })
        if (!row) {
          row = await ctx.db.transaction(async (tx) => {
            const [c] = await tx
              .insert(channels)
              .values({ orgId: scope.orgId, kind: 'dm', dmKey, createdBy: scope.userId })
              .onConflictDoNothing()
              .returning()
            const ch =
              c ??
              (await tx.query.channels.findFirst({
                where: and(eq(channels.orgId, scope.orgId), eq(channels.dmKey, dmKey)),
              }))!
            await tx
              .insert(channelMembers)
              .values(
                [...new Set(participantIds)].map((userId) => ({
                  channelId: ch.id,
                  userId,
                  orgId: scope.orgId,
                })),
              )
              .onConflictDoNothing()
            return ch
          })
        } else {
          await ctx.db
            .update(channelMembers)
            .set({ hidden: false })
            .where(
              and(eq(channelMembers.channelId, row.id), eq(channelMembers.userId, scope.userId)),
            )
        }
        await publishChannelJoined(ctx, scope.orgId, row.id, scope.userId)
        return reply.code(200).send(await serializeChannel(ctx, scope.userId, row))
      }

      await assertGroupSupervised(ctx, scope.orgId, participantIds)
      const row = await ctx.db.transaction(async (tx) => {
        const [c] = await tx
          .insert(channels)
          .values({
            orgId: scope.orgId,
            kind: 'group',
            name: req.body.name ?? null,
            createdBy: scope.userId,
          })
          .returning()
        await tx.insert(channelMembers).values(
          participantIds.map((userId) => ({
            channelId: c!.id,
            userId,
            orgId: scope.orgId,
            role: userId === scope.userId ? ('owner' as const) : ('member' as const),
          })),
        )
        return c!
      })
      for (const userId of participantIds)
        await publishChannelJoined(ctx, scope.orgId, row.id, userId)
      return reply.code(201).send(await serializeChannel(ctx, scope.userId, row))
    },
  )

  app.patch(
    `${base}/conversations/:id`,
    { schema: { params: orgIdParams, body: updateConversationSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const a = await requireChannel(ctx, scope, req.params.id, 'manage')
      if (a.channel.kind !== 'group') throw badRequest('Only group conversations can be renamed.')
      const { name, avatarFileId } = req.body
      if (avatarFileId) {
        const f = await ctx.db.query.files.findFirst({
          where: (f, { and, eq }) =>
            and(eq(f.id, avatarFileId), eq(f.orgId, scope.orgId), eq(f.uploaderId, scope.userId)),
        })
        if (!f?.mime.startsWith('image/')) throw notFound('Image')
      }
      await ctx.db
        .update(channels)
        .set({
          ...(name !== undefined && { name: name || null }),
          ...(avatarFileId !== undefined && { avatarKey: avatarFileId }),
        })
        .where(eq(channels.id, a.channel.id))
      if (name !== undefined && name !== a.channel.name) {
        await postSystemMessage(
          ctx,
          scope.orgId,
          a.channel.id,
          scope.userId,
          name ? `named the conversation "${name}"` : 'removed the conversation name',
        )
      }
      await publishChannelUpdated(ctx, scope.orgId, a.channel.id)
      const row = await ctx.db.query.channels.findFirst({ where: eq(channels.id, a.channel.id) })
      return serializeChannel(ctx, scope.userId, row!)
    },
  )
}

/**
 * WickyChat: badges on profiles (most are earned automatically, a few are given by teachers)
 * and the Shop leaderboard.
 */
import {
  coinTransactions,
  cosmetics,
  messages,
  organizations,
  orgMemberships,
  polls,
  pollVotes,
  userBadges,
  users,
} from '@quid/db'
import { type EarnedBadge, type Leaderboard, MANUAL_BADGES, type ProfileStats } from '@quid/shared'
import { and, count, desc, eq, gt, gte, isNull, sql, sum } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '../../core/audit'
import { authorize, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { toUserSummary, userCols } from '../users/serialize'
import { currentStreak } from './service'

const MONTH = 30 * 86_400_000

async function statsFor(ctx: AppContext, orgId: string, userId: string): Promise<ProfileStats> {
  const [u, member, org, given, msgCount, creations, quiz] = await Promise.all([
    ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { coins: true, dailyClaimedAt: true, dailyStreak: true, bestStreak: true },
    }),
    ctx.db.query.orgMemberships.findFirst({
      where: and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
      columns: { joinedAt: true },
    }),
    ctx.db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { createdAt: true },
    }),
    ctx.db
      .select({ badge: userBadges.badge, note: userBadges.note, by: users.name })
      .from(userBadges)
      .leftJoin(users, eq(users.id, userBadges.awardedBy))
      .where(and(eq(userBadges.orgId, orgId), eq(userBadges.userId, userId))),
    ctx.db
      .select({ n: count() })
      .from(messages)
      .where(
        and(eq(messages.orgId, orgId), eq(messages.authorId, userId), isNull(messages.deletedAt)),
      ),
    ctx.db
      .select({ approved: count(), sales: sum(cosmetics.sales) })
      .from(cosmetics)
      .where(
        and(
          eq(cosmetics.orgId, orgId),
          eq(cosmetics.creatorId, userId),
          eq(cosmetics.status, 'approved'),
        ),
      ),
    ctx.db
      .select({ n: count() })
      .from(pollVotes)
      .innerJoin(polls, eq(polls.id, pollVotes.pollId))
      .where(
        and(
          eq(pollVotes.userId, userId),
          eq(polls.orgId, orgId),
          eq(polls.kind, 'quiz'),
          eq(pollVotes.optionId, sql`${polls.correctOptionId}`),
        ),
      ),
  ])
  if (!u || !member) throw notFound('Member')
  const badges: EarnedBadge[] = given.map((g) => ({
    id: g.badge,
    note: g.note || undefined,
    by: g.by ?? undefined,
  }))
  const add = (id: string, ok: boolean) => ok && badges.push({ id })
  add('streak30', u.bestStreak >= 30)
  add('streak7', u.bestStreak >= 7 && u.bestStreak < 30)
  add('chatter', Number(msgCount[0]?.n ?? 0) >= 1000)
  add('creator', Number(creations[0]?.approved ?? 0) > 0)
  add('seller', Number(creations[0]?.sales ?? 0) >= 10)
  add('rich', u.coins >= 1000)
  add('quiz', Number(quiz[0]?.n ?? 0) >= 10)
  add('early', !!org && member.joinedAt.getTime() - org.createdAt.getTime() < MONTH)
  return {
    badges,
    streak: currentStreak(u.dailyClaimedAt, u.dailyStreak),
    bestStreak: u.bestStreak,
  }
}

export async function socialRoutes(app: App, ctx: AppContext) {
  app.get(
    '/api/orgs/:orgId/members/:id/stats',
    { schema: { params: orgIdParams } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      return statsFor(ctx, scope.orgId, req.params.id)
    },
  )

  /** Teachers give (or take back) a badge like "Teacher's pick". */
  app.post(
    '/api/orgs/:orgId/members/:id/badges',
    {
      schema: {
        params: orgIdParams,
        body: z.object({
          badge: z.string().refine((b) => MANUAL_BADGES.includes(b), 'Unknown badge'),
          note: z.string().trim().max(120).default(''),
          remove: z.boolean().default(false),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'audit.read')
      const member = await ctx.db.query.orgMemberships.findFirst({
        where: and(eq(orgMemberships.orgId, scope.orgId), eq(orgMemberships.userId, req.params.id)),
        columns: { id: true },
      })
      if (!member) throw notFound('Member')
      const { badge, note, remove } = req.body
      if (remove)
        await ctx.db
          .delete(userBadges)
          .where(
            and(
              eq(userBadges.orgId, scope.orgId),
              eq(userBadges.userId, req.params.id),
              eq(userBadges.badge, badge),
            ),
          )
      else
        await ctx.db
          .insert(userBadges)
          .values({
            orgId: scope.orgId,
            userId: req.params.id,
            badge,
            note,
            awardedBy: scope.userId,
          })
          .onConflictDoUpdate({
            target: [userBadges.orgId, userBadges.userId, userBadges.badge],
            set: { note, awardedBy: scope.userId },
          })
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: remove ? 'badge.removed' : 'badge.given',
        targetType: 'user',
        targetId: req.params.id,
        metadata: { badge, note },
        ip: req.ip,
      })
      return statsFor(ctx, scope.orgId, req.params.id)
    },
  )

  app.get(
    '/api/orgs/:orgId/leaderboard',
    { schema: { params: orgParams } },
    async (req): Promise<Leaderboard> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const week = new Date(Date.now() - 7 * 86_400_000)
      const inOrg = and(
        eq(orgMemberships.orgId, scope.orgId),
        isNull(orgMemberships.deactivatedAt),
        eq(users.isBot, false),
      )
      const earned = sql<number>`sum(${coinTransactions.amount})::int`
      const [earners, creators, streaks] = await Promise.all([
        ctx.db
          .select({ user: userCols, value: earned })
          .from(coinTransactions)
          .innerJoin(users, eq(users.id, coinTransactions.userId))
          .innerJoin(orgMemberships, eq(orgMemberships.userId, users.id))
          .where(and(inOrg, gt(coinTransactions.amount, 0), gte(coinTransactions.createdAt, week)))
          .groupBy(users.id)
          .orderBy(desc(earned))
          .limit(10),
        ctx.db
          .select({ user: userCols, value: sql<number>`sum(${cosmetics.sales})::int` })
          .from(cosmetics)
          .innerJoin(users, eq(users.id, cosmetics.creatorId))
          .innerJoin(orgMemberships, eq(orgMemberships.userId, users.id))
          .where(and(inOrg, eq(cosmetics.orgId, scope.orgId), eq(cosmetics.status, 'approved')))
          .groupBy(users.id)
          .having(gt(sql`sum(${cosmetics.sales})`, 0))
          .orderBy(desc(sql`sum(${cosmetics.sales})`))
          .limit(10),
        ctx.db
          .select({ user: userCols, value: users.dailyStreak, at: users.dailyClaimedAt })
          .from(users)
          .innerJoin(orgMemberships, eq(orgMemberships.userId, users.id))
          .where(and(inOrg, gt(users.dailyStreak, 1)))
          .orderBy(desc(users.dailyStreak))
          .limit(30),
      ])
      const row = (r: { user: Parameters<typeof toUserSummary>[0]; value: number }) => ({
        user: toUserSummary(r.user),
        value: Number(r.value),
      })
      return {
        earners: earners.map(row),
        creators: creators.map(row),
        // Only streaks that haven't been broken.
        streaks: streaks
          .map((r) => ({ ...r, value: currentStreak(r.at, r.value) }))
          .filter((r) => r.value > 1)
          .slice(0, 10)
          .map(row),
      }
    },
  )
}

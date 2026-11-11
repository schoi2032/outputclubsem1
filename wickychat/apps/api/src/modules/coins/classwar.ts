/**
 * WickyChat Class vs Class: group chats race on activity each week (Monday to Monday, Korea
 * time). Each person's messages count up to CLASS_WAR.dailyCap a day. When a week is over, the
 * first time anyone looks, the top 3 chats' active members get their rewards.
 */
import { classWarWeeks, userCrates } from '@quid/db'
import { CLASS_WAR, type ClassWar, type ClassWarRow, topics } from '@quid/shared'
import { and, eq, sql } from 'drizzle-orm'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { type App, orgParams } from '../../core/http'
import { onTick } from '../../core/jobs'
import { changeCoins } from './service'

const DAY = 86_400_000
const KST = 9 * 3_600_000

/** Monday 00:00 in Korea, for the week `now` is in. */
export function weekStart(now = new Date()) {
  const kst = new Date(now.getTime() + KST)
  const back = (kst.getUTCDay() + 6) % 7
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - back) - KST)
}
const weekKey = (start: Date) => new Date(start.getTime() + KST).toISOString().slice(0, 10)

type Raw = {
  channel_id: string
  kind: 'public' | 'private' | 'group'
  name: string | null
  score: number
  people: number
}

async function scores(ctx: AppContext, orgId: string, start: Date, end: Date, limit = 20) {
  const rows = await ctx.db.execute<Raw>(sql`
    select x.channel_id, c.kind, c.name, sum(least(x.n, ${CLASS_WAR.dailyCap}))::int as score,
           count(distinct x.author_id)::int as people
    from (
      select m.channel_id, m.author_id,
             date_trunc('day', m.created_at + interval '9 hours') as d, count(*) as n
      from messages m
      where m.org_id = ${orgId}
        and m.created_at >= ${start.toISOString()} and m.created_at < ${end.toISOString()}
        and m.deleted_at is null and m.kind = 'user' and m.author_id is not null
      group by 1, 2, 3
    ) x
    join channels c on c.id = x.channel_id
    where c.kind in ('public', 'private', 'group') and c.archived_at is null
      and (select count(*) from channel_members cm where cm.channel_id = c.id) >= ${CLASS_WAR.minMembers}
    group by x.channel_id, c.kind, c.name
    order by score desc
    limit ${limit}
  `)
  return [...rows].map((r) => ({ ...r, score: Number(r.score), people: Number(r.people) }))
}

/** Hands out last week's rewards once. */
async function settle(ctx: AppContext, orgId: string) {
  const end = weekStart()
  const start = new Date(end.getTime() - 7 * DAY)
  const week = weekKey(start)
  const done = await ctx.db.query.classWarWeeks.findFirst({
    where: and(eq(classWarWeeks.orgId, orgId), eq(classWarWeeks.week, week)),
    columns: { week: true },
  })
  if (done) return
  const top = (await scores(ctx, orgId, start, end, 3)).filter((r) => r.score > 0)
  const results = top.map((r, i) => ({
    channelId: r.channel_id,
    name:
      r.kind === 'public' && r.name
        ? `#${r.name}`
        : r.kind === 'group'
          ? 'A group chat'
          : 'A private chat',
    score: r.score,
    place: i + 1,
  }))
  const winners: { userId: string; place: number }[] = []
  await ctx.db.transaction(async (tx) => {
    // Whoever inserts this row first hands out the rewards; everyone else stops here.
    const [row] = await tx
      .insert(classWarWeeks)
      .values({ orgId, week, results })
      .onConflictDoNothing()
      .returning()
    if (!row) return
    for (const r of results) {
      const reward = CLASS_WAR.rewards.find((x) => x.place === r.place)
      if (!reward) continue
      const people = await tx.execute<{ author_id: string }>(sql`
        select m.author_id from messages m
        join users u on u.id = m.author_id and u.is_bot = false
        join org_memberships om on om.user_id = m.author_id and om.org_id = ${orgId}
          and om.deactivated_at is null
        where m.channel_id = ${r.channelId} and m.kind = 'user' and m.deleted_at is null
          and m.created_at >= ${start.toISOString()} and m.created_at < ${end.toISOString()}
        group by m.author_id having count(*) >= ${CLASS_WAR.minMessages}
      `)
      for (const p of people) {
        winners.push({ userId: p.author_id, place: r.place })
        if (reward.crates)
          await tx.insert(userCrates).values(
            Array.from({ length: reward.crates }, () => ({
              userId: p.author_id,
              crateId: CLASS_WAR.crateId,
            })),
          )
        if (reward.coins) await changeCoins(tx, p.author_id, reward.coins, 'class_war', week)
      }
    }
  })
  const medal = ['🥇', '🥈', '🥉']
  for (const w of winners)
    await ctx.bus
      .publish(topics.user(w.userId), {
        type: 'wicky.updated',
        orgId,
        text: `${medal[w.place - 1]} Your chat came #${w.place} in Class vs Class! Rewards are in.`,
      })
      .catch(() => {})
}

export async function classWarRoutes(app: App, ctx: AppContext) {
  onTick(async (c) => {
    const orgs = await c.db.execute<{ id: string }>(sql`select id from organizations`)
    for (const o of orgs) await settle(c, o.id)
  })

  app.get(
    '/api/orgs/:orgId/class-war',
    { schema: { params: orgParams } },
    async (req): Promise<ClassWar> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      await settle(ctx, scope.orgId).catch((err) => ctx.log.warn({ err }, 'class war settle'))
      const start = weekStart()
      const end = new Date(start.getTime() + 7 * DAY)
      const rows = await scores(ctx, scope.orgId, start, end)
      // Channel ids straight from the database; checked anyway since they go into the SQL.
      const ids = rows.map((r) => r.channel_id).filter((id) => /^[0-9a-f-]{36}$/.test(id))
      const mine = new Set<string>()
      const groupNames = new Map<string, string>()
      if (ids.length) {
        const m = await ctx.db.execute<{ channel_id: string }>(sql`
          select channel_id from channel_members
          where user_id = ${scope.userId} and channel_id in ${sql.raw(`('${ids.join("','")}')`)}
        `)
        for (const r of m) mine.add(r.channel_id)
        // Group chats have no name: show who's in them (only to their members).
        const g = await ctx.db.execute<{ channel_id: string; names: string }>(sql`
          select cm.channel_id, string_agg(coalesce(u.display_name, u.name), ', ' order by u.name) as names
          from channel_members cm join users u on u.id = cm.user_id
          where cm.channel_id in ${sql.raw(`('${ids.join("','")}')`)}
          group by cm.channel_id
        `)
        for (const r of g) groupNames.set(r.channel_id, r.names)
      }
      const standings: ClassWarRow[] = rows.map((r) => {
        const member = mine.has(r.channel_id)
        const name =
          r.kind === 'public'
            ? `#${r.name}`
            : !member
              ? r.kind === 'group'
                ? 'A group chat'
                : 'A private chat'
              : r.kind === 'group'
                ? (r.name ?? groupNames.get(r.channel_id) ?? 'Group chat')
                : `🔒 ${r.name}`
        return {
          channelId: r.channel_id,
          name,
          kind: r.kind,
          score: r.score,
          people: r.people,
          mine: member,
        }
      })
      const last = await ctx.db.query.classWarWeeks.findFirst({
        where: and(
          eq(classWarWeeks.orgId, scope.orgId),
          eq(classWarWeeks.week, weekKey(new Date(start.getTime() - 7 * DAY))),
        ),
      })
      return {
        week: weekKey(start),
        endsAt: end.toISOString(),
        standings,
        lastWeek: (last?.results ?? []).map((r) => ({
          name: r.name,
          score: r.score,
          place: r.place,
        })),
      }
    },
  )
}

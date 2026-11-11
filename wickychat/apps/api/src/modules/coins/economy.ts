/**
 * WickyChat economy dashboard for teachers: coins in circulation, where coins come from and
 * go, who's earning and spending, and things that look off (built from the coin ledger, the
 * data log and trades/duels).
 */
import { users } from '@quid/db'
import type { UserSummary } from '@quid/shared'
import { inArray, sql } from 'drizzle-orm'
import { authorize, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { type App, orgParams } from '../../core/http'
import { toUserSummary, userCols } from '../users/serialize'

export interface EconomyFlag {
  kind: 'coin_sends' | 'big_trade' | 'duel_pair' | 'teacher_reward' | 'busy' | 'fast_earner'
  text: string
  userIds: string[]
  amount: number
}

export interface Economy {
  circulation: { total: number; people: number; median: number; top10Share: number }
  daily: { day: string; earned: number; spent: number }[]
  byReason: { reason: string; earned: number; spent: number }[]
  richest: { userId: string; value: number }[]
  earners: { userId: string; value: number }[]
  spenders: { userId: string; value: number }[]
  market: { key: string; supply: number }[]
  flags: EconomyFlag[]
  recent: { at: string; tbl: string; op: string; userId: string | null; text: string }[]
  users: Record<string, UserSummary>
}

const num = (v: unknown) => Number(v ?? 0)

/** A short line for one data log row. */
function describe(
  tbl: string,
  op: string,
  o: Record<string, unknown> | null,
  n: Record<string, unknown> | null,
) {
  const r = n ?? o ?? {}
  if (tbl === 'users' && o && n) {
    if (o.coins !== n.coins) return `coins ${o.coins} → ${n.coins}`
    return 'changed what they wear'
  }
  if (tbl === 'coin_transactions')
    return `${num(r.amount) > 0 ? '+' : ''}${r.amount} (${r.reason}${r.ref ? `: ${String(r.ref).split('|')[0]}` : ''})`
  const what = r.item_id ?? r.crate_id ?? r.key ?? r.pack_key ?? r.achievement_id ?? r.badge ?? ''
  const verb = op === 'INSERT' ? 'added' : op === 'DELETE' ? 'removed' : 'updated'
  const extra =
    tbl === 'market_supply' || tbl === 'holdings' || tbl === 'person_shares'
      ? ` (${o?.supply ?? o?.qty ?? 0} → ${n?.supply ?? n?.qty ?? 0})`
      : r.status
        ? ` (${r.status})`
        : ''
  return `${tbl.replace(/_/g, ' ')} ${verb}${what ? `: ${what}` : ''}${extra}`
}

export async function economyRoutes(app: App, ctx: AppContext) {
  app.get(
    '/api/orgs/:orgId/economy',
    { schema: { params: orgParams } },
    async (req): Promise<Economy> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'audit.read')
      const org = scope.orgId
      const members = sql`(select user_id from org_memberships where org_id = ${org} and deactivated_at is null)`
      const week = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const fortnight = new Date(Date.now() - 14 * 86_400_000).toISOString()
      const day = new Date(Date.now() - 86_400_000).toISOString()
      const q = <T extends Record<string, unknown>>(s: ReturnType<typeof sql>) =>
        ctx.db.execute<T>(s).then((r) => [...r])

      const [
        circ,
        balances,
        daily,
        byReason,
        earners,
        spenders,
        market,
        sends,
        bigTrades,
        duelPairs,
        rewards,
        busy,
        fast,
        recent,
      ] = await Promise.all([
        q<{ total: number; people: number }>(sql`
          select coalesce(sum(coins), 0)::int as total, count(*)::int as people
          from users where id in ${members} and is_bot = false`),
        q<{ id: string; coins: number }>(sql`
          select id, coins from users where id in ${members} and is_bot = false order by coins desc`),
        q<{ day: string; earned: number; spent: number }>(sql`
          select to_char(date_trunc('day', created_at + interval '9 hours'), 'YYYY-MM-DD') as day,
                 coalesce(sum(amount) filter (where amount > 0), 0)::int as earned,
                 coalesce(-sum(amount) filter (where amount < 0), 0)::int as spent
          from coin_transactions where user_id in ${members} and created_at >= ${fortnight}
          group by 1 order by 1`),
        q<{ reason: string; earned: number; spent: number }>(sql`
          select reason,
                 coalesce(sum(amount) filter (where amount > 0), 0)::int as earned,
                 coalesce(-sum(amount) filter (where amount < 0), 0)::int as spent
          from coin_transactions where user_id in ${members} and created_at >= ${week}
          group by 1 order by sum(abs(amount)) desc`),
        q<{ user_id: string; value: number }>(sql`
          select user_id, sum(amount)::int as value from coin_transactions
          where user_id in ${members} and created_at >= ${week} and amount > 0
          group by 1 order by 2 desc limit 10`),
        q<{ user_id: string; value: number }>(sql`
          select user_id, (-sum(amount))::int as value from coin_transactions
          where user_id in ${members} and created_at >= ${week} and amount < 0
          group by 1 order by 2 desc limit 10`),
        q<{ key: string; supply: number }>(sql`
          select key, supply from market_supply where org_id = ${org} and supply > 0
          order by supply desc limit 10`),
        // The same person sending lots of coins to the same person.
        q<{ user_id: string; to_id: string; total: number }>(sql`
          select user_id, split_part(ref, '|', 1) as to_id, (-sum(amount))::int as total
          from coin_transactions
          where user_id in ${members} and reason = 'coins_sent' and created_at >= ${week}
          group by 1, 2 having -sum(amount) >= 300 order by 3 desc limit 20`),
        q<{ from_id: string; to_id: string; coins: number }>(sql`
          select from_id, to_id,
                 greatest(coalesce((give->>'coins')::int, 0), coalesce((get->>'coins')::int, 0)) as coins
          from trades where org_id = ${org} and status = 'accepted' and resolved_at >= ${week}
            and greatest(coalesce((give->>'coins')::int, 0), coalesce((get->>'coins')::int, 0)) >= 300
          order by 3 desc limit 20`),
        q<{ a: string; b: string; n: number; total: number }>(sql`
          select least(challenger_id, accepted_by)::text as a, greatest(challenger_id, accepted_by)::text as b,
                 count(*)::int as n, sum(amount)::int as total
          from duels where org_id = ${org} and status = 'done' and created_at >= ${week}
          group by 1, 2 having count(*) >= 8 order by 3 desc limit 20`),
        q<{ user_id: string; amount: number }>(sql`
          select user_id, amount from coin_transactions
          where user_id in ${members} and reason = 'gift' and amount >= 500 and created_at >= ${week}
          order by amount desc limit 20`),
        q<{ user_id: string; n: number }>(sql`
          select user_id, count(*)::int as n from data_log
          where user_id in (select user_id::text from org_memberships where org_id = ${org})
            and at >= ${day}
          group by 1 having count(*) >= 300 order by 2 desc limit 10`),
        q<{ user_id: string; value: number }>(sql`
          select user_id, sum(amount)::int as value from coin_transactions
          where user_id in ${members} and created_at >= ${week} and amount > 0
            and reason in ('daily', 'message', 'poll', 'quiz', 'achievement', 'quest', 'dividend', 'crate_coins', 'duel_win', 'class_war')
          group by 1 having sum(amount) >= 2000 order by 2 desc limit 10`),
        q<{
          at: Date
          tbl: string
          op: string
          user_id: string | null
          old: Record<string, unknown> | null
          new: Record<string, unknown> | null
        }>(sql`
          select at, tbl, op, user_id, old, new from data_log
          where user_id in (select user_id::text from org_memberships where org_id = ${org})
          order by id desc limit 60`),
      ])

      const coins = balances.map((b) => num(b.coins))
      const total = num(circ[0]?.total)
      const median = coins.length ? coins[Math.floor(coins.length / 2)]! : 0
      const top10 = coins.slice(0, 10).reduce((a, b) => a + b, 0)

      const flags: EconomyFlag[] = [
        ...sends.map((s) => ({
          kind: 'coin_sends' as const,
          text: `sent 🪙 ${s.total} to the same person this week`,
          userIds: [s.user_id, s.to_id],
          amount: num(s.total),
        })),
        ...bigTrades.map((t) => ({
          kind: 'big_trade' as const,
          text: `traded with 🪙 ${t.coins} in one trade`,
          userIds: [t.from_id, t.to_id],
          amount: num(t.coins),
        })),
        ...duelPairs.map((d) => ({
          kind: 'duel_pair' as const,
          text: `played ${d.n} coinflip duels against each other this week (🪙 ${d.total})`,
          userIds: [d.a, d.b],
          amount: num(d.total),
        })),
        ...rewards.map((r) => ({
          kind: 'teacher_reward' as const,
          text: `got a 🪙 ${r.amount} teacher reward`,
          userIds: [r.user_id],
          amount: num(r.amount),
        })),
        ...busy.map((b) => ({
          kind: 'busy' as const,
          text: `made ${b.n} economy changes in the last 24 hours`,
          userIds: [b.user_id],
          amount: num(b.n),
        })),
        ...fast.map((f) => ({
          kind: 'fast_earner' as const,
          text: `earned 🪙 ${f.value} from activity this week`,
          userIds: [f.user_id],
          amount: num(f.value),
        })),
      ]

      const ids = new Set<string>()
      for (const b of balances.slice(0, 10)) ids.add(b.id)
      for (const r of [...earners, ...spenders]) ids.add(r.user_id)
      for (const f of flags) for (const u of f.userIds) ids.add(u)
      for (const r of recent) if (r.user_id) ids.add(r.user_id)
      const valid = [...ids].filter((id) => /^[0-9a-f-]{36}$/.test(id))
      const people = valid.length
        ? await ctx.db.select(userCols).from(users).where(inArray(users.id, valid))
        : []

      return {
        circulation: {
          total,
          people: num(circ[0]?.people),
          median,
          top10Share: total ? Math.round((top10 / total) * 100) : 0,
        },
        daily: daily.map((d) => ({ day: d.day, earned: num(d.earned), spent: num(d.spent) })),
        byReason: byReason.map((r) => ({
          reason: r.reason,
          earned: num(r.earned),
          spent: num(r.spent),
        })),
        richest: balances.slice(0, 10).map((b) => ({ userId: b.id, value: num(b.coins) })),
        earners: earners.map((e) => ({ userId: e.user_id, value: num(e.value) })),
        spenders: spenders.map((e) => ({ userId: e.user_id, value: num(e.value) })),
        market: market.map((m) => ({ key: m.key, supply: num(m.supply) })),
        flags,
        recent: recent.map((r) => ({
          at: new Date(r.at).toISOString(),
          tbl: r.tbl,
          op: r.op,
          userId: r.user_id,
          text: describe(r.tbl, r.op, r.old, r.new),
        })),
        users: Object.fromEntries(people.map((p) => [p.id, toUserSummary(p)])),
      }
    },
  )
}

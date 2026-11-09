/**
 * Durable background jobs stored in Postgres. No always-on worker is needed:
 * Cloud Scheduler calls POST /internal/cron/tick every minute in production,
 * and in development an in-process poller does the same.
 */
import { jobs } from '@quid/db'
import { and, eq, lt, sql } from 'drizzle-orm'
import type { AppContext } from './context'

type JobHandler = (ctx: AppContext, payload: Record<string, unknown>) => Promise<void>
const handlers = new Map<string, JobHandler>()
const tickHooks: ((ctx: AppContext) => Promise<void>)[] = []

const MAX_ATTEMPTS = 5

export function registerJob(kind: string, handler: JobHandler) {
  handlers.set(kind, handler)
}

/** Work that should run on every tick (e.g. sending due scheduled messages). */
export function onTick(fn: (ctx: AppContext) => Promise<void>) {
  tickHooks.push(fn)
}

export async function enqueue(
  ctx: AppContext,
  kind: string,
  payload: Record<string, unknown>,
  runAt = new Date(),
) {
  await ctx.db.insert(jobs).values({ kind, payload, runAt })
}

export async function runDueJobs(ctx: AppContext, limit = 50) {
  // Recover jobs from crashed runs.
  await ctx.db
    .update(jobs)
    .set({ status: 'pending', lockedAt: null })
    .where(and(eq(jobs.status, 'running'), lt(jobs.lockedAt, new Date(Date.now() - 10 * 60_000))))

  const claimed = await ctx.db.execute<{
    id: string
    kind: string
    payload: Record<string, unknown>
    attempts: number
  }>(sql`
    update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
    where id in (
      select id from jobs where status = 'pending' and run_at <= now()
      order by run_at limit ${limit} for update skip locked
    )
    returning id, kind, payload, attempts`)

  for (const job of claimed) {
    const handler = handlers.get(job.kind)
    try {
      if (!handler) throw new Error(`No handler for job kind ${job.kind}`)
      await handler(ctx, job.payload)
      await ctx.db.update(jobs).set({ status: 'done', lockedAt: null }).where(eq(jobs.id, job.id))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const final = job.attempts >= MAX_ATTEMPTS
      await ctx.db
        .update(jobs)
        .set({
          status: final ? 'failed' : 'pending',
          lockedAt: null,
          lastError: message.slice(0, 1000),
          runAt: new Date(Date.now() + 2 ** job.attempts * 30_000),
        })
        .where(eq(jobs.id, job.id))
      ctx.log.warn({ kind: job.kind, attempts: job.attempts, err: message }, 'job failed')
    }
  }
  return claimed.length
}

export async function tick(ctx: AppContext) {
  for (const hook of tickHooks) {
    try {
      await hook(ctx)
    } catch (err) {
      ctx.log.error({ err }, 'tick hook failed')
    }
  }
  return runDueJobs(ctx)
}

export function startPoller(ctx: AppContext, intervalMs = 5_000) {
  let running = false
  const timer = setInterval(async () => {
    if (running) return
    running = true
    try {
      await tick(ctx)
    } finally {
      running = false
    }
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

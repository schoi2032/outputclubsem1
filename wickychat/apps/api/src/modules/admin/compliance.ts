/**
 * Enterprise+ compliance controls: message retention, required Google sign-in,
 * and audit log export.
 */
import { auditLogs, files, messages, organizations, users } from '@quid/db'
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '../../core/audit'
import { authorize, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest } from '../../core/errors'
import { type App, orgParams } from '../../core/http'
import { onTick } from '../../core/jobs'

const HOUR = 3_600_000
const BATCH = 2000
let lastRetentionRun = 0

type ComplianceSettings = { retentionDays?: number | null; requireGoogle?: boolean }

/** Deletes messages (and their files) older than each workspace's retention period. Hourly. */
export async function applyRetention(ctx: AppContext, now = new Date()) {
  const orgs = await ctx.db
    .select({ id: organizations.id, settings: organizations.settings })
    .from(organizations)
    .where(isNotNull(sql`${organizations.settings}->'retentionDays'`))
  let removed = 0
  for (const org of orgs) {
    const days = Number((org.settings as ComplianceSettings).retentionDays)
    if (!Number.isFinite(days) || days < 1) continue
    const cutoff = new Date(now.getTime() - days * 86_400_000)
    for (;;) {
      const batch = await ctx.db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.orgId, org.id), lt(messages.createdAt, cutoff)))
        .limit(BATCH)
      if (!batch.length) break
      const ids = batch.map((m) => m.id)
      // Files would only be unlinked by the cascade, so remove them (and their stored bytes) first.
      const attached = await ctx.db
        .select({ id: files.id, key: files.storageKey })
        .from(files)
        .where(inArray(files.messageId, ids))
      for (const f of attached) await ctx.storage.delete(f.key).catch(() => {})
      if (attached.length)
        await ctx.db.delete(files).where(
          inArray(
            files.id,
            attached.map((f) => f.id),
          ),
        )
      await ctx.db.delete(messages).where(inArray(messages.id, ids))
      removed += ids.length
      if (ids.length < BATCH) break
    }
  }
  return removed
}

async function retentionTick(ctx: AppContext) {
  if (Date.now() - lastRetentionRun < HOUR) return
  lastRetentionRun = Date.now()
  const n = await applyRetention(ctx)
  if (n) ctx.log.info({ removed: n }, 'retention removed old messages')
}

const csv = (v: unknown) => {
  const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
  // Quote everything, and defuse spreadsheet formulas.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`
}

export async function complianceRoutes(app: App, ctx: AppContext) {
  onTick(retentionTick)
  const base = '/api/orgs/:orgId/admin'

  app.get(`${base}/compliance`, { schema: { params: orgParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    authorize(scope, 'audit.read')
    const org = await ctx.db.query.organizations.findFirst({
      where: eq(organizations.id, scope.orgId),
      columns: { settings: true },
    })
    const s = (org?.settings ?? {}) as ComplianceSettings
    return {
      enterprise: true,
      googleAvailable: !!ctx.google,
      retentionDays: s.retentionDays ?? null,
      requireGoogle: s.requireGoogle === true,
    }
  })

  app.patch(
    `${base}/compliance`,
    {
      schema: {
        params: orgParams,
        body: z.object({
          retentionDays: z.number().int().min(30).max(3650).nullable().optional(),
          requireGoogle: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'org.update')
      const b = req.body
      if (b.requireGoogle) {
        if (!ctx.google) throw badRequest('Google sign-in is not set up on this server.')
        // Don't let admins lock themselves out: they must be using Google right now.
        if (req.user?.authMethod !== 'google')
          throw badRequest('Sign in with Google first, then turn this on.')
      }
      const patch: ComplianceSettings = {}
      if (b.retentionDays !== undefined) patch.retentionDays = b.retentionDays
      if (b.requireGoogle !== undefined) patch.requireGoogle = b.requireGoogle
      await ctx.db
        .update(organizations)
        .set({ settings: sql`${organizations.settings} || ${JSON.stringify(patch)}::jsonb` })
        .where(eq(organizations.id, scope.orgId))
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'org.compliance_updated',
        targetType: 'organization',
        targetId: scope.orgId,
        metadata: patch,
        ip: req.ip,
      })
      return { ok: true }
    },
  )

  /** The audit log as CSV (up to 50,000 rows, newest first). */
  app.get(
    `${base}/audit.csv`,
    { schema: { params: orgParams, querystring: z.object({ since: z.iso.date().optional() }) } },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'audit.read')
      const rows = await ctx.db
        .select({ log: auditLogs, actorName: users.name, actorEmail: users.email })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(
          and(
            eq(auditLogs.orgId, scope.orgId),
            req.query.since ? gte(auditLogs.createdAt, new Date(req.query.since)) : undefined,
          ),
        )
        .orderBy(desc(auditLogs.id))
        .limit(50_000)
      const lines = [
        [
          'time',
          'actor_name',
          'actor_email',
          'action',
          'target_type',
          'target_id',
          'ip',
          'details',
        ].join(','),
        ...rows.map((r) =>
          [
            r.log.createdAt.toISOString(),
            r.actorName,
            r.actorEmail,
            r.log.action,
            r.log.targetType,
            r.log.targetId,
            r.log.ip,
            r.log.metadata,
          ]
            .map(csv)
            .join(','),
        ),
      ]
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'audit.exported',
        metadata: { rows: rows.length },
        ip: req.ip,
      })
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="quid-audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
        )
        .header('cache-control', 'no-store')
        .send(`${lines.join('\n')}\n`)
    },
  )
}

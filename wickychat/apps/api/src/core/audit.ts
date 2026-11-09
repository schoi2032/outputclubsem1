import { auditLogs, type Db, type Tx } from '@quid/db'

export interface AuditInput {
  orgId: string
  actorId: string | null
  action: string
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
  ip?: string | null
}

/** Records a sensitive administrative action. Never put secrets in metadata. */
export async function audit(db: Db | Tx, e: AuditInput) {
  await db.insert(auditLogs).values({
    orgId: e.orgId,
    actorId: e.actorId,
    action: e.action,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    metadata: e.metadata ?? {},
    ip: e.ip ?? null,
  })
}

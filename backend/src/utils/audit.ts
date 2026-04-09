import { getDb } from '../db/client'

export type AuditEventType =
  | 'user.login'
  | 'user.login_failed'
  | 'user.logout'
  | 'user.created'
  | 'user.deleted'
  | 'user.password_changed'
  | 'account.created'
  | 'account.updated'
  | 'account.deleted'
  | 'account.reconciled'
  | 'account.closed'
  | 'account.reopened'
  | 'transaction.created'
  | 'transaction.updated'
  | 'transaction.deleted'
  | 'transaction.bulk_deleted'
  | 'transactions.imported'
  | 'budget_group.created'
  | 'budget_group.updated'
  | 'budget_group.deleted'
  | 'budget_category.created'
  | 'budget_category.updated'
  | 'budget_category.deleted'
  | 'budget.amount_changed'
  | 'budget.overspend_covered'
  | 'rule_group.created'
  | 'rule_group.updated'
  | 'rule_group.deleted'
  | 'rule.created'
  | 'rule.updated'
  | 'rule.deleted'
  | 'rules.run'

export interface AuditDetails {
  [key: string]: unknown
}

export function logAudit(params: {
  userId: number | null
  username: string
  eventType: AuditEventType
  entityType?: string
  entityId?: number
  details?: AuditDetails
  ipAddress?: string
}): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO audit_log (occurred_at, user_id, username, event_type, entity_type, entity_id, details, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    new Date().toISOString(),
    params.userId ?? null,
    params.username,
    params.eventType,
    params.entityType ?? null,
    params.entityId ?? null,
    params.details ? JSON.stringify(params.details) : null,
    params.ipAddress ?? null,
  )
}

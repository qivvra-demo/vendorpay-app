import { PoolClient } from 'pg';
import { redact } from './logger';

export type AuditType =
  | 'SUPPLIER_CREATED'
  | 'BANK_ACCOUNT_ADDED'
  | 'BANK_ACCOUNT_VERIFIED'
  | 'BANK_CHANGE_REQUESTED'
  | 'BANK_CHANGE_APPROVED'
  | 'BANK_CHANGE_REJECTED'
  | 'PAYMENT_SCHEDULED'
  | 'PAYMENT_RELEASED';

/** Appends an audit event in the same transaction as the change it records (VP-185). */
export async function recordAudit(
  client: PoolClient,
  e: { type: AuditType; actor: string; entityType: 'supplier' | 'payment'; entityId: string; details?: Record<string, unknown> },
): Promise<void> {
  await client.query(
    'INSERT INTO audit_events (type, actor, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
    [e.type, e.actor, e.entityType, e.entityId, JSON.stringify(redact(e.details ?? {}))],
  );
}

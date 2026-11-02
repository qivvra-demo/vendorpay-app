import { Router } from 'express';
import { authenticate, requireRole } from '../auth';
import { recordAudit } from '../audit';
import { pool, withTransaction } from '../db/pool';
import { badRequest, conflict, handle, notFound } from '../errors';
import { log } from '../logger';
import { maskAccount } from '../mask';

/** VP-184: change a supplier's bank account, approved by Finance. */
export const bankChangesRouter = Router();

const ACCOUNT_RE = /^\d{9,18}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const SELECT_REQUESTS = `
  SELECT r.*, s.name AS supplier_name,
         pa.account_number AS previous_number, pa.ifsc AS previous_ifsc,
         na.account_number AS new_number, na.ifsc AS new_ifsc
  FROM bank_change_requests r
  JOIN suppliers s ON s.id = r.supplier_id
  JOIN supplier_bank_accounts pa ON pa.id = r.previous_account_id
  JOIN supplier_bank_accounts na ON na.id = r.new_account_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const view = (r: any) => ({
  id: r.id,
  supplierId: r.supplier_id,
  supplierName: r.supplier_name,
  previousAccount: { id: r.previous_account_id, account: maskAccount(r.previous_number), ifsc: r.previous_ifsc },
  newAccount: { id: r.new_account_id, account: maskAccount(r.new_number), ifsc: r.new_ifsc },
  reason: r.reason,
  status: r.status,
  requestedBy: r.requested_by,
  requestedAt: r.requested_at,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  decisionNote: r.decision_note,
});

async function load(id: string) {
  const r = await pool.query(`${SELECT_REQUESTS} WHERE r.id = $1`, [id]);
  if (!r.rowCount) throw notFound(`Bank change request ${id}`);
  return view(r.rows[0]);
}

bankChangesRouter.get('/bank-change-requests', authenticate, handle(async (req, res) => {
  const where: string[] = [];
  const args: string[] = [];
  if (typeof req.query.supplierId === 'string') { args.push(req.query.supplierId); where.push(`r.supplier_id = $${args.length}`); }
  if (typeof req.query.status === 'string') { args.push(req.query.status); where.push(`r.status = $${args.length}`); }
  const r = await pool.query(`${SELECT_REQUESTS} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.requested_at DESC`, args);
  res.json({ requests: r.rows.map(view) });
}));

bankChangesRouter.get('/bank-change-requests/:id', authenticate, handle(async (req, res) => {
  res.json({ request: await load(req.params.id) });
}));

/**
 * AC1: Procurement submits a new bank account for an active supplier.
 * Finance Approvers may also raise a change when a supplier contacts Finance directly.
 */
bankChangesRouter.post('/suppliers/:id/bank-change-requests', authenticate, requireRole('PROCUREMENT', 'FINANCE_APPROVER'), handle(async (req, res) => {
  const { accountNumber, ifsc, reason } = req.body ?? {};
  const errors: Record<string, string> = {};
  if (typeof accountNumber !== 'string' || !ACCOUNT_RE.test(accountNumber)) errors.accountNumber = 'Enter 9 to 18 digits';
  if (typeof ifsc !== 'string' || !IFSC_RE.test(ifsc)) errors.ifsc = 'Enter a valid IFSC code, e.g. HDFC0001234';
  if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 500) errors.reason = 'Give a reason of 5 to 500 characters';
  if (Object.keys(errors).length) throw badRequest('VALIDATION_FAILED', 'Check the highlighted fields', errors);

  const actor = req.user!.username;
  const id = await withTransaction(async (c) => {
    const s = await c.query('SELECT id, status FROM suppliers WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!s.rowCount) throw notFound(`Supplier ${req.params.id}`);
    const current = await c.query("SELECT id, account_number FROM supplier_bank_accounts WHERE supplier_id = $1 AND status = 'active'", [req.params.id]);
    if (s.rows[0].status !== 'active' || !current.rowCount) throw conflict('SUPPLIER_NOT_ACTIVE', 'Only active suppliers can change their bank account');
    if (current.rows[0].account_number === accountNumber) throw badRequest('VALIDATION_FAILED', 'Check the highlighted fields', { accountNumber: 'This is already the active account' });
    const open = await c.query("SELECT id FROM bank_change_requests WHERE supplier_id = $1 AND status = 'requested'", [req.params.id]);
    if (open.rowCount) throw conflict('CHANGE_ALREADY_PENDING', `${open.rows[0].id} is already waiting for approval`);

    const newAcct = await c.query(
      "INSERT INTO supplier_bank_accounts (supplier_id, account_number, ifsc, status, created_by) VALUES ($1,$2,$3,'proposed',$4) RETURNING id",
      [req.params.id, accountNumber, ifsc, actor]);
    const reqId = 'BCR-' + (await c.query("SELECT nextval('bank_change_seq') AS n")).rows[0].n;
    await c.query(
      "INSERT INTO bank_change_requests (id, supplier_id, previous_account_id, new_account_id, reason, status, requested_by) VALUES ($1,$2,$3,$4,$5,'requested',$6)",
      [reqId, req.params.id, current.rows[0].id, newAcct.rows[0].id, reason.trim(), actor]);
    await recordAudit(c, { type: 'BANK_CHANGE_REQUESTED', actor, entityType: 'supplier', entityId: req.params.id,
      details: { requestId: reqId, from: maskAccount(current.rows[0].account_number), to: maskAccount(accountNumber), ifsc } });
    return reqId;
  });
  log('info', 'bank change requested', { requestId: id, supplierId: req.params.id, actor });
  res.status(201).json({ request: await load(id) });
}));

/** AC2: a Finance Approver approves the change; the new account becomes active. */
bankChangesRouter.post('/bank-change-requests/:id/approve', authenticate, requireRole('FINANCE_APPROVER'), handle(async (req, res) => {
  const actor = req.user!.username;
  await withTransaction(async (c) => {
    const r = await c.query('SELECT * FROM bank_change_requests WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!r.rowCount) throw notFound(`Bank change request ${req.params.id}`);
    const change = r.rows[0];
    if (change.status !== 'requested') throw conflict('ALREADY_DECIDED', `This request is already ${change.status}`);

    await c.query("UPDATE supplier_bank_accounts SET status = 'inactive' WHERE id = $1", [change.previous_account_id]);
    await c.query("UPDATE supplier_bank_accounts SET status = 'active', verified_by = $1, verified_at = now() WHERE id = $2", [actor, change.new_account_id]);
    await c.query("UPDATE bank_change_requests SET status = 'approved', decided_by = $1, decided_at = now() WHERE id = $2", [actor, change.id]);
    const accts = await c.query('SELECT id, account_number FROM supplier_bank_accounts WHERE id = ANY($1)', [[change.previous_account_id, change.new_account_id]]);
    const num = (id: number) => accts.rows.find((a) => a.id === id).account_number;
    await recordAudit(c, { type: 'BANK_CHANGE_APPROVED', actor, entityType: 'supplier', entityId: change.supplier_id,
      details: { requestId: change.id, from: maskAccount(num(change.previous_account_id)), to: maskAccount(num(change.new_account_id)) } });
  });
  log('info', 'bank change approved', { requestId: req.params.id, actor });
  res.json({ request: await load(req.params.id) });
}));

/** A Finance Approver rejects the change; the proposed account is retired and the old one stays active. */
bankChangesRouter.post('/bank-change-requests/:id/reject', authenticate, requireRole('FINANCE_APPROVER'), handle(async (req, res) => {
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  if (note.length < 5) throw badRequest('VALIDATION_FAILED', 'Check the highlighted fields', { note: 'Say why the change is rejected (at least 5 characters)' });
  const actor = req.user!.username;
  await withTransaction(async (c) => {
    const r = await c.query('SELECT * FROM bank_change_requests WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!r.rowCount) throw notFound(`Bank change request ${req.params.id}`);
    const change = r.rows[0];
    if (change.status !== 'requested') throw conflict('ALREADY_DECIDED', `This request is already ${change.status}`);
    await c.query("UPDATE supplier_bank_accounts SET status = 'inactive' WHERE id = $1", [change.new_account_id]);
    await c.query("UPDATE bank_change_requests SET status = 'rejected', decided_by = $1, decided_at = now(), decision_note = $2 WHERE id = $3", [actor, note, change.id]);
    await recordAudit(c, { type: 'BANK_CHANGE_REJECTED', actor, entityType: 'supplier', entityId: change.supplier_id, details: { requestId: change.id, note } });
  });
  log('info', 'bank change rejected', { requestId: req.params.id, actor });
  res.json({ request: await load(req.params.id) });
}));

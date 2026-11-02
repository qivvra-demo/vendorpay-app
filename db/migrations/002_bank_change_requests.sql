-- VP-184: Procurement can change a supplier's bank account; a Finance Approver approves the change.
-- A proposed account sits beside the active one until the change is approved.

ALTER TABLE supplier_bank_accounts DROP CONSTRAINT supplier_bank_accounts_status_check;
ALTER TABLE supplier_bank_accounts
  ADD CONSTRAINT supplier_bank_accounts_status_check CHECK (status IN ('pending', 'active', 'proposed', 'inactive'));

CREATE SEQUENCE bank_change_seq START 1001;
CREATE TABLE bank_change_requests (
  id                   TEXT PRIMARY KEY,
  supplier_id          TEXT NOT NULL REFERENCES suppliers(id),
  previous_account_id  INTEGER NOT NULL REFERENCES supplier_bank_accounts(id),
  new_account_id       INTEGER NOT NULL REFERENCES supplier_bank_accounts(id),
  reason               TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('requested', 'approved', 'rejected')),
  requested_by         TEXT NOT NULL,
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by           TEXT,
  decided_at           TIMESTAMPTZ,
  decision_note        TEXT
);
-- Only one open change per supplier at a time.
CREATE UNIQUE INDEX one_open_change_per_supplier ON bank_change_requests (supplier_id) WHERE status = 'requested';

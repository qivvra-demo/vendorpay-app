# Branch plan: PR #482 (VP-184 bank change)

`main` (this repository) is the baseline. The next step builds the change that QIVVRA will assure.

| Item | Value |
|---|---|
| Branch | `feature/VP-184-bank-change` |
| PR | #482 "VP-184: Let Procurement change a supplier's bank account" |
| Target | `main` |
| Jira | VP-184 (story), VP-170 (epic) |

## Planned commits

1. **Commit 1 (built; the QIVVRA prototype calls it 8e7c4b1)** "VP-184: bank-change request and approval"
   - New table `bank_change_requests` (requested_by, decided_by, status) and migration `002`.
   - `POST /api/suppliers/:id/bank-change-requests` (PROCUREMENT, FINANCE_APPROVER), `POST /api/bank-change-requests/:id/approve` and `/reject` (FINANCE_APPROVER).
   - UI: change form and history on the supplier page, plus a Bank changes queue.
   - On approval the new account becomes active and the old one inactive.
   - **Defect 1 (intentional):** the approver is not checked against the requester. Finance Approvers can also raise changes, so one approver can request and approve their own change.
   - **Defect 2 (intentional, from the silent story):** payments already scheduled to the old account (PAY-7821) are left pointing at it, with no review or notice.
   - Team tests cover all four written acceptance criteria and pass (25/25). See `pr-482-demo.md`.

2. **Commit 2 (next; the QIVVRA prototype calls it c41d9e2)** "VP-184: block self-approval of bank changes"
   - Approval by the requester returns 403 `SELF_APPROVAL_NOT_ALLOWED`.
   - Scheduled payments are still unaddressed, so QIVVRA should move from NOT READY (violated rule) to READY WITH EXCEPTIONS or NOT READY (insufficient evidence on scheduled payments), depending on the policy owner's decision.

## Policy rules this PR exercises

| Rule | Source | Expected on 8e7c4b1 | Expected on c41d9e2 |
|---|---|---|---|
| Bank change approved by a different person | Policy repo (Finance) | VIOLATED | SUPPORTED |
| New account number masked in UI, API and logs | Policy repo (Security) + VP-182 | SUPPORTED | SUPPORTED |
| Change recorded in audit trail | VP-185 | SUPPORTED | SUPPORTED |
| Scheduled payments to the old account are held for review | Policy repo (Finance) | INSUFFICIENT | INSUFFICIENT |
| QE runs the PR commit | `/version` | SUPPORTED | SUPPORTED |

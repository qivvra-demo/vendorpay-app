# PR #482 demo: what the team shipped and what QIVVRA should find

Branch `feature/VP-184-bank-change`, commit 1 ("VP-184: bank-change request and approval"). The QIVVRA prototype calls this commit **8e7c4b1**.

## The team's view: everything is green

- All four written acceptance criteria of VP-184 are implemented.
- The team suite has 25 tests (5 new for VP-184) and all pass.
- CI is green, so a reviewer skimming the PR would approve it.

## Defect 1: the same person can request and approve a bank change

The request endpoint accepts PROCUREMENT **and** FINANCE_APPROVER ("for when a supplier calls Finance directly"). The approve endpoint checks the role but never compares the approver with the requester.

The story says "approved by a Finance Approver" and never says "a different person". The Finance policy in the policy repository does say it, and VendorPay's own maker-checker rules elsewhere (`SELF_VERIFICATION_NOT_ALLOWED`, `SELF_RELEASE_NOT_ALLOWED`) require it.

Reproduce (any shell, app on port 3000):

```bash
T=$(curl -s localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d '{"username":"m.fernandes","password":"VendorPay@2026"}' | jq -r .token)

# m.fernandes requests a change for Northstar Components...
ID=$(curl -s localhost:3000/api/suppliers/SUP-0192/bank-change-requests \
  -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"accountNumber":"918020077665588","ifsc":"UTIB0000918","reason":"Supplier emailed new bank details"}' | jq -r .request.id)

# ...and approves it herself: 200, requestedBy = decidedBy = m.fernandes
curl -s -X POST localhost:3000/api/bank-change-requests/$ID/approve -H "authorization: Bearer $T" | jq .request
```

Expected after the fix (commit 2): 403 `SELF_APPROVAL_NOT_ALLOWED`.

## Defect 2: scheduled payments still go to the old account

VP-184 says nothing about payments already scheduled. After the change above:

```bash
curl -s localhost:3000/api/payments/PAY-7821 -H "authorization: Bearer $T" | jq .payment
# destination "**** 4421" (now INACTIVE), INR 8,50,000, scheduled 2026-11-05, still releasable
```

Nothing holds PAY-7821, flags it for review or tells anyone. The Finance policy requires scheduled payments to a replaced account to be held for review. This one stays open after the self-approval fix, so QIVVRA should still report it after commit 2.

In the UI: sign in as `m.fernandes`, open **Suppliers → Northstar Components**, request a change, approve it, then look at the payments table on the same page.

## What QIVVRA should report on this commit

| Obligation | Source | Expected state |
|---|---|---|
| Bank change approved by a different person | Policy repo (Finance) | VIOLATED |
| Scheduled payments to the old account held for review | Policy repo (Finance) | INSUFFICIENT (story silent, no test, no behaviour) |
| New account masked in UI, API and logs | VP-184 AC3, VP-182, policy (Security) | SUPPORTED |
| Change recorded in audit trail | VP-184 AC4, VP-185 | SUPPORTED |
| New account inactive until approved | VP-184 AC2 | SUPPORTED |
| QE runs this commit | `/version` | SUPPORTED |

Disposition: **NOT READY**.

## Reset the demo data

```bash
npm run db:reset          # or: docker compose down -v && docker compose up --build
```

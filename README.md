# VendorPay

VendorPay is a small supplier-payments app. It is the **reference application for QIVVRA**, a platform that checks whether a code change is ready to ship. This branch, `feature/VP-184-bank-change` (PR #482), adds the bank-change feature (VP-184) on top of `main`. It contains two deliberate defects for QIVVRA to find; see `docs/pr-482-demo.md`.

It is a real, runnable app with a TypeScript API, a simple web UI, a PostgreSQL database with seeded data, Docker, CI and a team Playwright test suite. Every story, test and commit carries a Jira key.

## What it does

| Area | Capability | Jira |
|---|---|---|
| Supplier onboarding | Procurement onboards suppliers with a bank account. A Finance Approver verifies the account before the supplier becomes active; the person who added it cannot verify it. | VP-181 |
| Masked bank details | Account numbers are only ever shown as the last four digits (`**** 4421`), in the UI and in every API response. | VP-182 |
| Payments | Finance Ops schedules payments to active suppliers. A Finance Approver releases them; the scheduler cannot release their own payment. The destination account is fixed when the payment is created. | VP-183 |
| Bank account change | Procurement requests a new bank account for an active supplier; a Finance Approver approves or rejects it. | VP-184 |
| Audit trail | Every change writes an audit event. Auditors and approvers can read it. | VP-185 |
| Platform | `/health` and `/version` (app, version, git commit, environment). Logs mask any 9–18 digit number. | VP-170 |

## Run it

### Option A: Docker (recommended)

```bash
GIT_SHA=$(git rev-parse --short HEAD) docker compose up --build
# open http://localhost:3000
```

The database is migrated and seeded automatically.

### Option B: Node + your own PostgreSQL

Requires Node 22 and PostgreSQL 14+.

```bash
cp .env.example .env            # adjust DATABASE_URL if needed
npm install
npm run db:migrate && npm run db:seed
npm run dev                     # http://localhost:3000
```

`npm run db:reset` drops and rebuilds the demo data. It is blocked when `APP_ENV=production`.

## Demo users

All users share the password **`VendorPay@2026`**.

| Email | Role | Can |
|---|---|---|
| neha.joshi@vendorpay.test | FINANCE_OPS | Schedule payments |
| priya.menon@vendorpay.test | FINANCE_OPS | Schedule payments |
| m.fernandes@vendorpay.test | FINANCE_APPROVER | Verify bank accounts, release payments, read audit |
| j.thomas@vendorpay.test | FINANCE_APPROVER | Same as above (second approver for separation of duties) |
| ravi.kumar@vendorpay.test | PROCUREMENT | Onboard suppliers |
| audit.viewer@vendorpay.test | AUDITOR | Read everything, including the audit trail |

Seeded data: suppliers SUP-0192 Northstar Components (active), SUP-0193 Kaveri Logistics (active) and SUP-0194 Bluepeak Packaging (pending), plus payments PAY-7790 (released), PAY-7815 (scheduled) and **PAY-7821**: INR 8,50,000 to Northstar `**** 4421`, scheduled for 2026-11-05. PAY-7821 matters later: the bank-change feature must not silently redirect it.

## API

All `/api/*` routes except login need `Authorization: Bearer <token>`.

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | any | `{email, password}` → `{token, user}`; 401 `INVALID_CREDENTIALS` |
| GET | `/api/auth/me` | any | Current user |
| GET | `/api/suppliers` | any | Bank details masked |
| GET | `/api/suppliers/:id` | any | Includes bank accounts (masked) |
| POST | `/api/suppliers` | PROCUREMENT | `{name, accountNumber, ifsc}`; 422 on invalid input |
| POST | `/api/suppliers/:id/bank-accounts/:accountId/verify` | FINANCE_APPROVER | 403 `SELF_VERIFICATION_NOT_ALLOWED`, 409 `ALREADY_VERIFIED` |
| GET | `/api/payments?supplierId=` | any | |
| GET | `/api/payments/:id` | any | |
| POST | `/api/payments` | FINANCE_OPS | `{supplierId, amount, scheduledFor}`; 409 `SUPPLIER_NOT_ACTIVE` |
| POST | `/api/payments/:id/release` | FINANCE_APPROVER | 403 `SELF_RELEASE_NOT_ALLOWED`, 409 `ALREADY_RELEASED` |
| POST | `/api/suppliers/:id/bank-change-requests` | PROCUREMENT, FINANCE_APPROVER | `{accountNumber, ifsc, reason}`; 409 `CHANGE_ALREADY_PENDING`, `SUPPLIER_NOT_ACTIVE` |
| GET | `/api/bank-change-requests?supplierId=&status=` | any | Accounts masked |
| POST | `/api/bank-change-requests/:id/approve` | FINANCE_APPROVER | New account active, old one inactive; 409 `ALREADY_DECIDED` |
| POST | `/api/bank-change-requests/:id/reject` | FINANCE_APPROVER | `{note}` |
| GET | `/api/audit-events?entityId=&type=&limit=` | AUDITOR, FINANCE_APPROVER | |
| GET | `/health` | public | |
| GET | `/version` | public | `{app, version, gitSha, builtAt, environment}` |

Wrong role → 403 `FORBIDDEN_ROLE`.

## Tests

The team suite is in `tests/` (25 tests: `api` and `ui` projects). Each test title starts with the Jira key it covers.

```bash
npm test                                  # starts the app itself
BASE_URL=http://localhost:3000 npm test   # against a running app or the QE environment
```

The JUnit report at `test-results/junit.xml` can be imported into Jira Xray.

## How QIVVRA uses this repo

1. A PR is opened with a Jira key in its branch and title (e.g. `feature/VP-184-bank-change`).
2. `deploy-qe.yml` builds the PR's exact commit and deploys it to the QE environment. QIVVRA calls `/version` there to confirm QE runs that commit before assuring it.
3. QIVVRA gathers the PR (GitHub), the story and acceptance criteria (Jira), the team's test results (Xray / this JUnit file) and the rules in the policy repository, all linked by the Jira key.
4. QIVVRA's own verifiers (kept in a separate repository, not here) test the running QE app and publish a disposition back to the PR as a required status check.

Keeping QIVVRA's verifiers out of this repository is deliberate: the team cannot weaken the checks that assure their own change.

See `docs/jira-stories.md` for the backlog and `docs/branch-plan.md` for the upcoming PR #482.

## Layout

```
src/            API (Express + TypeScript)
  routes/       auth, suppliers, payments, audit, meta
  db/           pool, migrate, seed, reset
public/         Web UI (no build step)
db/migrations/  SQL migrations
tests/          Team Playwright tests (api, ui)
docs/           Jira stories, Xray import CSV, branch plan
.github/        CI and QE deploy workflows
```

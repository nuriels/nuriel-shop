# Testing the MAX / Hyp integration

No test talks to Hyp. Unit tests use fakes; E2E uses the local mock; SQL tests run on a local Postgres.
Real terminals, real cards and the live site are never part of an automated test.

## Suites and what each one owns

| Suite | Files | Owns |
| --- | --- | --- |
| Protocol (unit) | `tests/unit/max-protocol.test.ts` | SIGN parameter order and encoding, echo validation, return parsing, VERIFY query, `CCode=0` exactness, code classes, money conversion |
| Environment (unit) | `tests/unit/payments-env.test.ts` | DEMO / production / host rules, mock override conditions, root-key checks, startup line |
| HTTP, crypto, redaction, DB door (unit) | `tests/unit/payments-http.test.ts`, `payments-crypto.test.ts`, `payments-redact.test.ts`, `payments-db.test.ts`, `payments-stepup.test.ts` | timeouts and size caps; token binding (store, scope, field, mode); masking; the RPC allow-list; step-up codes |
| Store and platform flows (unit) | `tests/unit/online-payments-tenant.test.ts`, `online-payments-tick.test.ts`, `payments-platform.test.ts` | handlers with mocked RPCs: which DB functions are called, in which order, with zero Hyp calls when refused |
| Reviewers' probes (unit) | `tests/unit/review-probes-r1.test.ts`, `review-probes-r2.test.ts` | every repro of the independent reviews, asserting the fixed behaviour — never delete or weaken |
| Architecture | `tests/architecture/max-boundaries.test.ts` | static rules U17-B1 … (imports, single callers of settle / secret functions, return-route shape, alert path) |
| Scanners | `tests/unit/payments-scanners.test.ts`, `tests/unit/mock-hyp.test.ts` | the leak scanners catch what they must; the mock behaves like the documented protocol |
| SQL | `scripts/db-tests/online-payments.test.sql` (run by `scripts/db-tests/run.sh`) | every money rule, guard, grant and RLS statement of migration 208 |
| Concurrency | `scripts/db-tests/online-payments-concurrency.sh` | two sessions racing: double settle, open vs return, expire vs return, two alert claimers |
| Rollback | `scripts/db-tests/rollback-check.sh`, `rollback-guards.sh` | 208 rolls back to exactly the 207 schema; the rollback refuses once payment data exists |
| E2E | `e2e/tests/payments-*.spec.ts` with `e2e/scripts/mock-hyp.mjs`, `e2e/fixtures/hyp-fake.mjs` | real browser flows against the mock: checkout, separation of stores and terminals, platform flow, switches, egress block |

## Commands

```bash
npx vitest run                                  # all unit + architecture tests
npx vitest run tests/unit/max-protocol.test.ts  # one file
npm run typecheck                               # both tsconfig files
bash scripts/db-tests/run.sh                    # all SQL tests: clean, clean again, with data
bash scripts/db-tests/online-payments-concurrency.sh
bash scripts/db-tests/rollback-guards.sh && bash scripts/db-tests/rollback-check.sh
npx vite build && node scripts/security/scan-secrets.mjs --mode bundle .output/public
node scripts/security/scan-secrets.mjs --mode repo
npm run e2e:up && npm run test:e2e -- --trace off   # needs Docker; the app runs with the mock
```

The SQL scripts use a local Postgres 16 (port `PGPORT`, socket `KOBI_PGSOCKET`, both with defaults). E2E starts
the app through `e2e/scripts/app-up.sh`, which sets DEMO mode, the loopback mock address and fake roots.
CI (`.github/workflows/tests.yml`) runs all of this and maps Hyp's host to loopback.

## What every change must prove

1. **A test that failed before the change and passes after it**, in the suite that owns the rule (table above).
   A database rule gets a SQL test, not only a unit test with a mocked RPC.
2. **Negative cases, not only the happy path.** For anything on the money path, cover at least:
   - forged or altered return (amount, order reference, terminal, missing `Sign`) → nothing paid;
   - VERIFY down (timeout, HTML, non-zero) → nothing paid, nothing cancelled, order held, retried, then parked
     with one alert;
   - replay of the same return → no second effect; a different approved return → `duplicate_charge`;
   - late return on an expired / cancelled / failed attempt → never silently lost;
   - second payment attempt while the first is unresolved → refused;
   - store A's terminal, token or return used for store B, or a store's for the platform → refused.
3. **Real failure scenarios for a review finding**: reproduce it the way the reviewer did (the repro becomes a
   permanent test), including the periodic jobs being off and the app restarting between return and VERIFY.
4. **No secret anywhere**: the bundle, repo, log, database and artifact scans stay at zero hits. A new fake
   value must be obviously fake and declared in `scripts/security/declared-fakes.json`.
5. **Nothing else moved**: the Grow, Bit, phone, POS and manual-billing suites stay green untouched, and the
   md5 test of `expire_unpaid_orders` still passes.

## DEMO versus production checks

| Check | Where |
| --- | --- |
| `demo` refused on the production platform host; `production` refused elsewhere | `payments-env.test.ts` |
| Mock address ignored unless loopback **and** a `*.localhost` platform host | `payments-env.test.ts` |
| DEMO database refuses `live` mode and non-`00100` terminals; production database refuses test terminals | SQL suite |
| Application and database environments must agree in every money function | SQL suite (`app_env_ok`) |
| A database once marked `demo` never becomes production; marker transitions | SQL suite |
| ₪50 cap in test mode | SQL suite |
| On a real DEMO server: read-only proof script | `deploy/demo/demo-check.sh` (`--proofs`), tested by `tests/unit/deploy-demo-check.test.ts` |

A manual run against a real Hyp test terminal (never in CI) follows `docs/payment-gateways/MAX-DEMO-PLAN.md`
§7 scenarios and needs the owner's approval each time; use Hyp's published test card from the official
"Safe Testing & Environments" page, small amounts, synthetic customer data.

## Before you say done

- [ ] `npx vitest run` and `npm run typecheck` green — report the counts.
- [ ] If SQL or the migration changed: `run.sh`, the concurrency script (run it several times), both rollback
      scripts — report the counts.
- [ ] If any flow changed: the payment E2E specs, then the full E2E suite — report total / passed / skipped /
      failed. Never skip, weaken or quarantine a test to get green.
- [ ] Bundle and repo scans at zero hits.
- [ ] The contract (`DEMO-IMPLEMENTATION-CONTRACT.md` §7) records any new decision.
- [ ] No deployment, no migration on a live database, no merge to `main`, no call to Hyp — unless the owner
      explicitly approved that exact step.

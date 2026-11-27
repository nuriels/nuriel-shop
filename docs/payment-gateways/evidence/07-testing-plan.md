# MAX (Hyp Pay): map of the current tests and a test plan

**Repo and scope.** I worked in `(repo root)`, branch `payments/max-hyp`, at `910b1f9`. I only read files. I ran no test suite, server or database, and made no call to Hyp.

**References.** I give `path:line` for claims about the code. "Docs research §n" means `docs/payment-gateways/evidence/01-hyp-pay-official-docs.md`. "Map §n" means `docs/payment-gateways/evidence/03-nuriel-codebase-payments-map.md`.

**What this report leaves out.** It contains no card numbers, terminal numbers or passwords. Hyp's test cards are referenced only by their page URL.

---

## 0. Findings that shape the plan

1. **Discovery.** New unit tests, SQL tests and E2E specs are picked up automatically:
   - unit: `vitest.config.ts:8`;
   - SQL: `scripts/db-tests/run.sh:42`;
   - E2E: `e2e/playwright.config.ts:18`.

   **Concurrency scripts are not picked up.** Each one is a separate CI step (`.github/workflows/tests.yml:76-83`).
2. **What tests Grow today:**
   - SQL: about 33 assertions in `scripts/db-tests/grow-payments.test.sql`;
   - unit: 6 tests in two files.

   **There is no E2E test of the Grow flow.** The mock server answers every payment call with 503 (`e2e/scripts/mock-services.mjs:224-225`). Nothing tests Grow's HTTP client, parser, crypto, start/status functions or admin authorization.
3. **The SQL helpers never run as `service_role`.** `tests.run` switches only to `anon` or `authenticated` (`scripts/db-tests/test-helpers.sql:13-14`). The Grow tests call `grow_mark_paid` as the superuser through `tests.check` (`grow-payments.test.sql:101-151`), so the `service_role` grant is never exercised. MAX should copy the `tests.lic_server` pattern (`digital-licenses.test.sql:10-24`).
4. **CSRF protection covers server functions only.** The filter is `handlerType === "serverFn"` (`src/start.ts:25-27`). API routes (`src/routes/api.*`) are not covered. The Hyp return is a cross-site GET, so it cannot be a server function: it must be safe without CSRF.
5. **CI does not run on pushes to this branch.** Push triggers are only `hospitality/**`; otherwise only PRs and manual dispatch (`tests.yml:9-13`).
6. **E2E can hide race bugs and logs cannot be scanned:**
   - E2E retries once in CI (`playwright.config.ts:22`), which can mask a flaky payment race;
   - the server's stdout is discarded (`playwright.config.ts:55`), so there is nothing to scan for leaked secrets.
7. **No secret checks run in CI.** There is no secret scanner, client-bundle scan or log scan (searched `.github`, `scripts`, `package.json`).
8. **Hyp Pay documents no notify/webhook, no lookup API and no signature algorithm** (docs research §2, §4). So "notify vs. return" races and local `Sign` HMAC test vectors (draft §7.1) have no documented behaviour to test against. VERIFY is the only authority.
9. **Existing tests constrain MAX names and structure** (§1.10). For example, `remove-hyp.test.sql:60-63` fails if any public function body matches `hyp_`.
10. **SQL test files share one database.** `remove-hyp.test.sql:122-124` asserts exactly 2 orders for fixture customer `…e1`. A `max-*.test.sql` file runs earlier in alphabetical order; if it leaves an order for that customer, `remove-hyp` breaks. MAX tests need their own customer UUID and full cleanup.

---

## 1. Current test infrastructure

### 1.1 Overview

| Layer | Runner and config | Discovery | Environment | CI job (timeout) | Size and time |
|---|---|---|---|---|---|
| Unit and architecture | Vitest 5.0.5 (`package.json:16`, devDeps). `vitest.config.ts:5-15`: node env, `@`→`src`, fake env | `tests/unit/**/*.test.ts`, `tests/architecture/**/*.test.ts` (`vitest.config.ts:8`) | No DB. `SUPABASE_URL=http://127.0.0.1:1` (`:11`) | `checks` (20 min), `tests.yml:43-44` | 1,581 tests in 113 files (`docs/seo-engine/ISTORES-COMPARISON.md:209`) |
| SQL | bash + psql, `scripts/db-tests/run.sh` (`package.json:17`) | `scripts/db-tests/*.test.sql`, alphabetical (`run.sh:42`) | Postgres 16 with Supabase stubs | `db` (20 min), `tests.yml:64-65` | 3,651 assertions × 3 passes (`ISTORES-COMPARISON.md:211`) |
| Concurrency | bash, separate psql sessions, advisory-lock barrier | None; each script is a CI step (`tests.yml:76-83`) | Own DB per script, built from all migrations | `db` | 49 / 8 / 24 / 20 checks (`ISTORES-COMPARISON.md:216`) |
| Rollback and schema rules | bash + Vitest | `rollback-check.sh`, `rollback-guards.sh`, `tests/architecture/migrations.test.ts`, `tests/architecture/rollback-guards.test.ts` | Separate DBs | `db` (`tests.yml:66-75`) and `checks` | 33/33 guards |
| E2E | Playwright 1.63 (`e2e/playwright.config.ts`) | `e2e/tests/*.spec.ts` | Local Supabase in Docker, built app, mock server on :4010 | `e2e` (40 min), `tests.yml:85-124` | 428 passed, 18 skipped, 23.8 min (CI run 209, `ISTORES-COMPARISON.md:216`) |
| Typecheck, lint, build | `tsc` for app and tests (`package.json:14`, `tsconfig.test.json:3`); strict ESLint on an explicit file list (`tests.yml:39`); `vite build` | — | Placeholder `VITE_*` keys (`tests.yml:48-50`) | `checks` | — |

No duration is recorded for the `checks` or `db` jobs. The E2E job (about 24 min) is the slowest.

### 1.2 Unit tests

- **Conventions.**
  - One file per topic, named `tests/unit/<area>-<topic>.test.ts`. The header comment names the finding the file guards (`grow-webhook-failure.test.ts:1-3`).
  - Modules are mocked with `vi.hoisted` + `vi.mock` (`grow-webhook-failure.test.ts:6-24`).
  - Environment variables are set with `vi.stubEnv` (`digital-licenses.test.ts:68-69`).
  - Tests may read source or migration files directly (`env-forwarding.test.ts:22-33`).
- **Templates to copy:**
  - crypto: `digital-licenses.test.ts:67-104` (round trip, `v1:` format, AAD bound to tenant and delivery, tampering, wrong secret, short secret);
  - test-only URL override, accepted only for loopback with a local platform host: `src/platform/ai/router.server.ts:17-33`, tested in `tests/unit/ai-security.test.ts:742-753`;
  - IP rate limiting: `tests/unit/rate-limit-ip.test.ts:13-45`.
- **Coverage.** No coverage tool is installed (none in `package.json` devDependencies).

### 1.3 SQL harness

- **How the database is built** (`run.sh`):
  - PG16 from `/usr/lib/postgresql/16/bin`, port 5499, socket `/tmp/pg`, data in `/tmp/kobi-pgdata`, `initdb -A trust` (`:10-25`);
  - database `shop_test`, UTF8 with C.UTF-8 collation, from `template0`, plus `supabase-stubs.sql` (`:28-31`);
  - every migration in sorted order, then the newest `NEW_MIGRATIONS` (default 1) applied again to prove idempotency (`:55-67`);
  - a third pass: old migrations → `fixtures.sql` → newest migration twice → tests (`:69-74`).
- **Stubs** (`supabase-stubs.sql`):
  - roles `anon`, `authenticated`, and `service_role` with BYPASSRLS (`:6-13`);
  - `auth.users`, `auth.identities`, and `auth.uid()` read from `request.jwt.claim.sub` (`:59-61`);
  - storage tables and Supabase-style default grants (`:95-102`).

  PostgREST and GoTrue are not present; they exist only in E2E.
- **Helpers** (`test-helpers.sql`):
  - `tests.results` table (`:2-3`);
  - `tests.run(name, sql, uid, expect_error, expect_rows)` runs as `anon`/`authenticated` (`:4-34`);
  - `tests.check(name, bool_sql)` runs as the superuser with no RLS (`:36-50`).

  Helpers defined inside test files:
  - `tests.server()`: no JWT, runs as superuser (`remove-hyp.test.sql:8-20`);
  - `tests.lic_server(tenant, sql)`: `SET LOCAL ROLE service_role` plus the tenant header (`digital-licenses.test.sql:10-24`).
- **Fixtures** (`fixtures.sql:2-30`):
  - platform admin `a0…f0`;
  - store A `70000000-…000a` (owner `a1`, agent `a2`);
  - store B `…000b` (admins `b1`, `b2`);
  - store C on trial.
- **Rules:**
  - Each file runs in its own psql session with `ON_ERROR_STOP` (`run.sh:26,42`), so an uncaught error stops the whole job.
  - Files share one database, so each must clean up after itself (`grow-payments.test.sql:180-183`).
  - Tenant context is set with `set_config('request.headers','{"x-tenant-id":…}')` (`grow-payments.test.sql:25`).
- **Coverage tests that will check MAX objects automatically:**
  - `tenant-isolation-coverage.test.sql:12-52`: RLS plus a RESTRICTIVE `tenant_isolation` policy, or no API grant, on every table with `tenant_id`;
  - `db-classification.test.sql`: regenerated by `scripts/db-classification.mjs:1-9`;
  - `ecommerce-engine-guard.test.sql:39-52`: exactly 40 tables.

### 1.4 Concurrency harness

- **`order-guard-concurrency.sh`:**
  - builds a fresh database `conc_orders` from stubs, all migrations and fixtures (`:28-34`);
  - `parallel()` opens one psql session per statement, holds them all behind `pg_advisory_lock(4546)`, then releases them together (`:70-84`);
  - `rc_ok` and `errs` count the successful sessions and specific error texts (`:85-86`);
  - each scenario asserts the exact number of winners (`:88-129`).
- **`hospitality/concurrency/run.sh` adds `held(a, b)`** (`:58-73`):
  - session A keeps a transaction open, and B starts 0.5 s later;
  - B's wait is measured, and `waited()` (≥ 1200 ms) proves B was blocked by A's lock.

  This is the tool for proving that FOR UPDATE serializes callers.
- **Cost.** Each script rebuilds a database from about 200 migrations. `rollback-guards.sh` instead clones a template database (`:20-25`), which is cheaper.

### 1.5 Rollback and migration rules

- **Every migration since `20261101090000`:**
  - needs `supabase/rollbacks/<name>.down.sql`;
  - must appear in `rollback-check.sh` as `Mn=` in order, rolled back newest first and re-applied oldest first (`tests/architecture/migrations.test.ts:42-65`).
- **Destructive rollbacks need a data guard.** A rollback that drops or deletes must contain a `DO … RAISE EXCEPTION` guard, or be listed with a reason. Every rollback is wrapped in `BEGIN`/`COMMIT` (`tests/architecture/rollback-guards.test.ts:47-70`).
- **The guards are proven to stop.** `rollback-guards.sh` seeds one row and runs the rollback, which must stop (`:1-10`).
- **Function fingerprints.** `scripts/audit/gen-migration-fingerprint.py:7-14` computes md5 of (body, SECURITY DEFINER, volatility, SET options). This can be reused for the Grow/Bit "unchanged" checks.

### 1.6 E2E

- **How the app starts:**
  - `e2e:up` starts Supabase CLI 2.122.0 in Docker, copies the migrations, seeds through the Auth admin API plus `seed.sql`, and writes the gitignored `e2e/.env.e2e` (`e2e/scripts/supabase-up.sh:15,46-62`; `.gitignore:39-44`).
  - CI builds the app with that file (`tests.yml:105-108`).
  - The Playwright `webServer` runs `scripts/app-up.sh`, polls `/robots.txt` and allows 240 s (`playwright.config.ts:50-56`).
  - `app-up.sh` sets `*.shop.localhost` hosts, mock URLs and fixed fake secrets. It starts `mock-services.mjs`, then runs `node .output/server/index.mjs` on port 3100 with `NODE_ENV=production` (`e2e/scripts/app-up.sh:12-42`).
  - Because `NODE_ENV` is production, the expiry job runs every 5 minutes (`src/server/services/payment-expiry.ts:26-29`). E2E tests should trigger expiry through SQL rather than wait for it.
- **Test data.**
  - Store A is the default tenant `kobi` (`00000000-…0001`); it stands in for the platform's own store.
  - Store B is `store-b` (`e2e/fixtures/data.mjs:4-28`).
  - Each user logs in once in `auth.setup.ts`, because login is limited to 15 tries per IP (`docs/testing.md:98-104`).
- **Helpers:**
  - `hostGet` sends `Host`/`X-Forwarded-Host` and follows no redirects (`e2e/tests/helpers.ts:40-45`);
  - `sql()` runs psql with `DB_URL` (`e2e/tests/hospitality-helpers.ts:9-15`);
  - `callServerFn` computes the function id and sends `sec-fetch-site: same-origin` by default (`hospitality-helpers.ts:56-89`).
- **Conventions:**
  - `workers: 1`, no parallel runs (`playwright.config.ts:20-21`);
  - `retries` is 1 in CI (`:22`);
  - API-level tests skip the `mobile` project;
  - phone tests carry `@mobile` (`:48`).

  CSRF pattern to copy: the same call with `sec-fetch-site: cross-site` and a foreign `origin` must return ≥ 400 and save nothing (`e2e/tests/websites-inquiries.spec.ts:394-414`).
- **Mock server** (`e2e/scripts/mock-services.mjs`, port 4010):
  - mocks Resend and Anthropic;
  - records every request with its body at `/__calls` (`:174-190`);
  - answers everything else with 503 (`:224-225`).
- **Payment coverage today:**
  - an offline order end to end (`checkout-coupon.spec.ts:5-12`);
  - the cart total (`cart-checkout.spec.ts:6-16`).

  **There is no Bit or Grow flow.**

### 1.7 CI (`.github/workflows/tests.yml`)

| Item | What happens |
|---|---|
| Triggers | Push to `hospitality/**`, `pull_request`, `workflow_dispatch` (`:9-13`). `permissions: contents: read` (`:15-16`). "No secret, no production" (`:2-5`). |
| `checks` | `bun install --frozen-lockfile`, typecheck (`:36-37`), strict lint on an explicit file list (`:38-39`), whole-repo lint as report only (`:40-42`), unit tests (`:43-44`), legacy scripts (`:45-46`), build (`:47-51`) |
| `db` | Installs PG16 with apt if missing (`:59-63`). Then `run.sh` (3 passes), two rollback scripts, a Hospitality availability check, `rollback-check.sh`, `rollback-guards.sh`, and the concurrency scripts for bookings, licenses, AI and order guard (`:64-83`). |
| `e2e` | Chromium (`:98-99`), poppler (`:100-102`), `e2e:up` (`:103-104`), build with `.env.e2e` (`:105-108`), `test:e2e` with `E2E_SKIP_BUILD=1` (`:109-112`). Uploads `e2e/playwright-report` and `e2e/test-results` when it fails (`:113-121`). |
| `preview` | Hospitality screenshots and video (`:126-165`); not related to payments |

### 1.8 How Grow is tested today

| Part | Test | What it asserts | Gap |
|---|---|---|---|
| DB: mark-paid, grants, guard, expiry | `scripts/db-tests/grow-payments.test.sql` (about 33 assertions) | See the list below | Called as superuser, not `service_role`. Not tested: `transaction_id` uniqueness, the ±0.01 amount tolerance, a sandbox payment marking a live order paid |
| Webhook HTTP status | `tests/unit/grow-webhook-failure.test.ts` (3 tests) | DB error → 500, malformed → 400, everything else → 200; an unknown process is tried in production then sandbox | `parseGrowWebhook` is mocked out |
| Paid-late alert | `tests/unit/grow-paid-late-alert.test.ts` (3 tests) | The store's admins are notified; no tenant or no admins → nothing happens; a failure is swallowed | — |
| Client, parser, crypto, start/status, admin, route limit, UI | **none** | — | Untested files: `src/lib/grow.server.ts`, `grow-crypto.server.ts`, `grow-payments.functions.ts:31-112`, `platform-grow.functions.ts:94-237` (which has no rate limit), `src/routes/api.webhooks.grow.ts:18`, `GrowPaymentPage.tsx` |
| E2E | **none** | The mock answers 503 (`mock-services.mjs:224-225`, `cart-checkout.spec.ts:4`) | — |

What `grow-payments.test.sql` asserts:
- store admins cannot read credentials or processes (`:43-52`);
- Grow is off by default (`:54-67`);
- an order waits 2 h for payment (`:70-76`);
- a direct UPDATE to "paid" is silently ignored (`:77-82`);
- only one pending process per order (`:92-97`);
- the outcomes unknown, sandbox mismatch, bad token, wrong amount and not paid (`:101-113`);
- a failure mid-update rolls everything back (`:114-140`);
- paid, with the payment details (`:141-148`);
- a repeated webhook returns already paid (`:149-151`);
- a payment after expiry is recorded as paid late (`:162-178`).

**Bit and offline** are tested only as part of `remove-hyp.test.sql:114-222`:
- phone orders, and `credit_card` mapped to offline;
- a Bit order: waits 24 h, guarded, submitted, approved, then moves to picking;
- guest orders, and quotes mapped to offline;
- expiry returns stock +1;
- settings guards.

POS is tested in `pos.test.sql:190-195`. **Not tested:** Bit rejection (`bit_payment_review(…, false)`), cancelling and un-cancelling an `awaiting_verification` order, reopening a cancelled Bit order on approval, and any Bit unit or E2E test. `cleanPayload` (`src/lib/checkout.functions.ts:49-51`) has no unit test.

### 1.9 Tools for mocking external HTTP

- **Unit tests:**
  - `vi.stubGlobal("fetch", …)` (`tests/unit/health.test.ts:20-34`, `digital-licenses.test.ts:373-377`, `engines.test.ts:210-219`);
  - assigning `globalThis.fetch = vi.fn(…)` (`ai-security.test.ts:195`);
  - `vi.spyOn(globalThis, "fetch")` (`hospitality-security.test.ts:242,325`).

  No msw or nock is used.
- **E2E:**
  - `mock-services.mjs`;
  - URL overrides read only by tests: `RESEND_API_URL` (`app-up.sh:15`); `AI_ASSISTANT_TEST_API_URL`, accepted only for loopback (`router.server.ts:17-33`); `GROW_SANDBOX_URL`, which accepts any URL (`src/lib/grow.server.ts:28-31`); `DNS_TEST_FIXTURES` (`app-up.sh:38`).

### 1.10 How secrets are kept out of tests, and the gaps

**What protects them today:**
- unit: fake environment values (`vitest.config.ts:10-14`) and a fake secret constant (`digital-licenses.test.ts:50`);
- SQL: placeholder ciphertext strings (`grow-payments.test.sql:61-62`), and only hashed tokens in the database (`:89-91`);
- E2E: Supabase CLI demo keys written at run time to a gitignored file (`supabase-up.sh:55-62`); fixed fake secrets marked e2e-only (`app-up.sh:23-26`); fake OAuth secrets (`supabase-up.sh:27-41`);
- CI holds no secrets (`tests.yml:2-5`);
- `env-forwarding.test.ts:14-20,47-49` keeps test-only variables out of `docker-compose.yml`.

**Gaps:**
- there is no secret scanner;
- `GROW_SANDBOX_URL` accepts any URL, not only loopback;
- the `env-forwarding` regex (`:24-26`) misses aliased reads such as `env["X"]` (`router.server.ts:23` escapes it);
- E2E artifacts are uploaded when a run fails (`tests.yml:113-121`), so any log file there is published;
- server stdout is ignored (`playwright.config.ts:55`).

### 1.11 Constraints that existing tests put on MAX

| Test | Constraint | Ref |
|---|---|---|
| `remove-hyp.test.sql` | No public column named `hyp\_%` or `payment_token` | `:45-49` |
| `remove-hyp.test.sql` | No public function body (comments count) may match `hyp_`, `payment_intent`, `tenant_payment_secrets`, `platform_settings`, `card_payments_`, `card_clearing`, `platform_payments_`, `checkout_payment_request` or `payment_token` | `:60-63` |
| `remove-hyp.test.sql` | The old Hyp function names must not come back | `:50-59` |
| `remove-hyp.test.sql` | Among BEFORE INSERT triggers, `orders_default_payment` must sit right between `orders_assign_number` and `orders_enforce_kind` in name order. No new BEFORE INSERT trigger may sort between them. | `:74-84` |
| `remove-hyp.test.sql` | `credit_card` stays in `orders_payment_check` and in the billing CHECK. A `credit_card` request still becomes offline. | `:85-88`, `:120-124` |
| `remove-hyp.test.sql` | `place_order` and `place_guest_order` must keep the literal `_details ->> 'payment_method' = 'bit'` | `:89-92` |
| `remove-hyp.test.sql` | Exactly 2 orders exist for customer `…e1` | `:122-124` |
| `ecommerce-engine-guard.test.sql` | Exactly 40 guarded tables; new store tables need the guard and an updated list | `:39-52` |
| `db-classification.test.sql` | Every public table and function is classified; run `bun run db:classify` | `scripts/db-classification.mjs:1-9` |
| `tenant-isolation-coverage.test.sql` | RLS plus a RESTRICTIVE `tenant_isolation` policy, or no API grants | `:28-52` |
| `migrations.test.ts`, `rollback-guards.test.ts` | A rollback per migration, listed in order; a guard for any destructive rollback; `BEGIN`/`COMMIT` | §1.5 |
| `run.sh` | The newest migration runs twice and over existing data, so string patches must be safe to re-apply | `:63-74` |
| `env-forwarding.test.ts` | Every `process.env.X` is in `docker-compose.yml` and `.env.example`; test-only variables are in `TEST_ONLY` and not in compose | `:35-49` |
| CSP | `form-action 'self'` and `Permissions-Policy payment=()` (`src/lib/security-headers.ts:24-27`). Send the browser to Hyp with a GET navigation, not a form POST that redirects; browsers may enforce `form-action` on the redirect target. An iframe would also need `frame-src` and `payment` permission. | — |

---

## 2. Review of the lead's draft §7

| Draft item | Problem | Evidence | Change |
|---|---|---|---|
| 7.1 "Sign the request and verify the return signature with fixed vectors, official or built from the docs" | Hyp Pay does not document the signature algorithm. Verification is done by Hyp through VERIFY. A local HMAC exists only in the WooCommerce plugin code. | Docs research §2: rows "Signature algorithm… not found", "Local HMAC… only in plugin code" | Test the exact SIGN and VERIFY request strings, the response parsers and how VERIFY results are handled. Do not verify `Sign` locally unless Hyp confirms the algorithm in writing (D/E). The same applies to draft §6 "Sign (HMAC)". |
| 7.1 "Constant-time compare; missing, empty, wrong or case-variant signature" | Constant-time comparison is for our own tokens and hashes. We never compute `Sign`. | Same | Missing or empty `Sign` → rejected locally before VERIFY. Wrong `Sign` → VERIFY returns non-zero. A case-variant key counts as a duplicate or missing key → rejected. Use `safeEqual` for attempt tokens and hashes. |
| 7.1 "Same transaction twice; notify and browser in parallel; 10 notifications in parallel" | Hyp Pay documents no server-to-server notification; webhooks exist only in Hyp Enterprise. | Docs research §4 | Test instead: the same return twice; 10 parallel returns; return vs. VERIFY retry; return vs. expiry; return vs. admin cancel; two attempts that both pay. Keep a disabled "notify" contract test until Hyp answers open question 2. |
| 7.1 "Amount, currency, terminal or attempt number differs" | The terminal is not in the redirect. `Coin` arrives only with `MoreData=True`. | Docs research §3: base parameters and the MoreData list | Terminal check = VERIFY with the attempt's own credentials, plus a snapshot of the credential version. The mock signs per terminal. If currency is checked from the redirect, the SIGN test asserts `MoreData=True`. |
| 7.1 "Store A tries to mark store B's attempt (another Host)" | Correct, but incomplete | `src/server.ts:71-89`, `src/lib/blocked-pages.ts:30-31` | Add a suspended or expired store (the store gate returns 403) and a non-store (zimmer) host |
| 7.1 "Expired attempt; stock release" | Stock is released when the order is cancelled, not when an attempt expires. Grow leaves its process rows `pending`. | `supabase/migrations/20261019360000_remove_hyp.sql:179-200`; map §2.8 | Test attempt expiry and order expiry separately. Test the payment-after-expiry decision. |
| 7.1 Mock: success, decline, cancel, timeout, malformed | Several documented cases are missing | Docs research §3, §8 | Add: an HTML body with HTTP 200 (system error); codes 600/700/800; SIGN 902/904; VERIFY non-zero; duplicate parameters; Windows-1255 percent-encoded values; a portal with an error URL vs. without one |
| 7.1 "Secrets don't reach the browser or the log (E2E + search the build and logs)" | There is no way to do this yet: server stdout is ignored and nothing scans the bundle | `playwright.config.ts:55` | Canary secrets, a bundle scan, a server log file and a log scan, a DB scan, and a scan of responses (§3.6) |
| 7.1 Missing | Not covered: grants tested as `service_role`; append-only events; freezing the amount (the order-items policy lets a customer add lines to a pending order, `20260928090000_order_integrity.sql:151-157`); idempotent migrations; rollback guards; updates to the classification and engine guard; Grow/Bit/offline regression | `test-helpers.sql:13-14`; `run.sh:63-74`; `migrations.test.ts:42-48` | §3.2, §3.7 |
| 7.2 Prerequisites | Correct. Missing details: Hyp gives one terminal per environment by default, so a second is needed for cross-store tests; the portal setting "Verify by signature in the payment page"; the success URL; the owner enters the credentials; staging only. | Docs research §6, §2 "Prerequisites" | D0 in §3.8 |
| 7.2 #2 "Declined card → failed; stock released in time" | If only a success URL is configured (as the docs recommend), a decline never comes back to us | Docs research §1 "Success / error URL", §3 "Error-URL behaviour" | Test both portal setups. Stock is released when the order expires. Decide on the error URL before testing. |
| 7.2 #4 "Change Amount or Order" | Good. Missing: `Coin`, `Id`, `Fild*`, a removed `Sign`, reordered or duplicate parameters | — | D6. If VERIFY returns 0 for a changed field, stop. |
| 7.2 #6 "Notification before and after the browser" | Not applicable to Hyp Pay | Docs research §4 | Replace with D7 (replay) and D12 (double click) |
| 7.2 #7 Installments | Phase 1 should not send `Tash`; without it Hyp makes a single charge | Docs research §7 "Default" | D14 asserts there are no installments |
| 7.2 #9 "Test terminal on a live store → blocked" | How to detect it is not defined. The `00100` prefix is documented, but docs examples contradict it (open question 10). | Docs research §6 | Use an explicit mode flag plus the prefix as a second guard (D13, unit U8, SQL S3 `mode_mismatch`) |
| 7.2 Missing | No rules for evidence or redaction, no stop conditions, no POST check, no encoding check, nothing on production-only features (wallets, bit, 3DS) | Docs research §6, §8 | §3.8 and §3.9 |

---

## 3. Test plan

**Module names used below.** These are placeholders; rename them to match the provider design. Follow the repo's conventions:
- `*.server.ts` for anything that touches credentials;
- `*.functions.ts` for server functions;
- the return route under `/api/`, so that `src/lib/url-normalize.ts:12` never rewrites it.

Code:
- `src/lib/max-hyp.ts`: pure protocol code, no I/O;
- `src/lib/max-hyp.server.ts`: HTTP client;
- `src/lib/max-crypto.server.ts`;
- `src/lib/max-return.server.ts`;
- `src/lib/max-payments.functions.ts`;
- `src/lib/platform-max.functions.ts`;
- `src/routes/api.payments.max.return.ts`;
- `src/routes/checkout_.max.$orderId.tsx`.

Database (no `hyp_` names, per §1.11): `max_payment_credentials`, `max_payment_attempts`, `max_payment_events`, `max_mark_paid(…)`, `max_attempt_open(…)`, `max_payments_active(uuid)`.

**Phase gates.** A test is listed under the phase in which it must first pass. After that it must stay green.

| Gate | Meaning |
|---|---|
| B | Provider layer and settings infrastructure |
| C | Admin UI and tenant separation |
| D | Sandbox |
| E | Independent security review |
| F | Production, only after the owner and Hyp approve |

### 3.1 Unit tests (`tests/unit/`, run by Vitest in `checks`)

| # | File | What it asserts | Gate |
|---|---|---|---|
| U1 | `max-hyp-sign-request.test.ts` | See detail below the table | B |
| U2 | `max-hyp-sign-response.test.ts` | Success requires `action=pay` and a non-empty `signature`. The payment URL is `https://pay.hyp.co.il/p/?` + the response, byte for byte; the host is fixed in code, never taken from the response. A response that contains `KEY` or `PassP` is refused and never forwarded. Characters are limited to `[A-Za-z0-9%._~+=&-]`, which blocks header or HTML injection. 901/902/904 → typed `credentials`/`request` error. An HTML body → `hyp_system_error`, even if it contains `CCode=0`. Empty body, over 64 KB, duplicate keys, JSON, or non-200 → error. | B |
| U3 | `max-hyp-redirect-parse.test.ts` | Input is the raw query string, never re-serialized through `URLSearchParams`. Original order and raw `%XX` are kept byte for byte (`%20`, `+`, `%40`, and Windows-1255 `%EC%EC%E0` from the 3DS example, docs research §3). `Id`, `CCode`, `Amount`, `Order` and `Sign` must be present and non-empty, otherwise reject before VERIFY. Duplicate keys are rejected, case-insensitive and after decoding the name (`Amount` / `amount` / `%41mount`). Keys that only we may send (`action`, `What`, `Masof`, `KEY`, `PassP`, `signature`) → reject; removing them is not enough (the old code removed them, map §5.4). Also rejected: `=x`, `&&`, a bare key, more than 4,000 characters (the old IPN cap), raw non-ASCII. `;` is data, not a separator. The success-URL setting may not have its own query string or fragment. | B |
| U4 | `max-hyp-verify-request.test.ts` | Golden string: `action=APISign&What=VERIFY&Masof=…&KEY=…&PassP=…` + the raw redirect query, unchanged. The credentials are a function parameter taken from the attempt's tenant; no path leads from the request parameters or the Host. The HTTP method is pinned (POST body; GET only if D11 shows POST fails). | B |
| U5 | `max-hyp-verify-response.test.ts` | Valid only when the body is exactly `CCode=0`, with an optional trailing `\r?\n`. Invalid: `CCode=200/902/904/…`, no CCode, `CCode=00`, `CCode= 0`, `ccode=0`, `CCode=0&CCode=1`, HTML containing `CCode=0`, JSON, empty, non-200. | B |
| U6 | `max-hyp-ccode.test.ts` | Mapping of the redirect `CCode`: `0` → call VERIFY. `600`/`700`/`800` → `needs_review`, never paid (we never request J2/J5/Postpone, and nothing is charged). Documented failures (4, 6, 33, 200, 250, 401, 402, 901–904, 920, 990, 996–999; docs research §3) → `failed`, but only after VERIFY confirms the decline. Unknown or non-numeric → `failed`. The test loops over the whole documented list. | B |
| U7 | `max-hyp-amount.test.ts` | Parse the redirect `Amount` into agorot with no floats: `10`→1000, `10.5`→1050, `10.50`→1050, `10.00`→1000. Reject `10.005`, `1,234.50`, `1e3`, `-10`, `+10`, ` 10`, `10 `, `0x10`, `.5`, `10.`, `NaN`, `Infinity`, Arabic-Indic digits, empty. Round trip over 10,000 seeded values. Exact equality, with no ±0.01 tolerance (unlike `grow_mark_paid`, map §1.2). | B |
| U8 | `max-hyp-match.test.ts` | See detail below the table | B |
| U9 | `max-hyp-client.test.ts` (`vi.stubGlobal("fetch")` + fake timers) | See detail below the table | B |
| U10 | `max-crypto.test.ts` | Same checks as `digital-licenses.test.ts:67-104`. In addition: HKDF label differs from the Grow, AI and license keys. AAD = tenant + credential id + field name; a ciphertext moved to another tenant or field fails. Version prefix. Key shorter than 32 characters refused. Random IV. | B |
| U11 | `max-redaction.test.ts` | Logs and events mask `KEY` and `PassP` fully and keep only the last 3 digits of `Masof`. Customer and card fields are masked: `ClientName`, `ClientLName`, `UserId`, `email`, `cell`, `street`, `city`, `Fild1-3`, `L4digit`, `Tmonth`, `Tyear`, `bincard`, `UID`, `Sign`, `signature`. An event payload = sha256 of the raw string plus allowed fields only. | B |
| U12 | `max-return-handler.test.ts` (mocked rpc and fetch) | The `Order` is looked up first. Host tenant ≠ attempt tenant → neutral page; no credentials loaded, no VERIFY. Unknown Order, or a local check failing → no VERIFY. Already paid → "paid" page with no VERIFY. Response: 303 to a URL with no query, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`; no cookie is set or needed; no parameter is echoed. Limits per IP and per attempt → 429 with no state change. | B |
| U13 | `max-start-payment.test.ts` | Requires `payment_method='max'`, `awaiting` and `pending`. The amount comes from `order_amount_due` on the server. MAX off or no credentials → fixed error. A test credential on a live store → refused. A second call returns the same attempt. Rate limit per IP (20 per 15 min, as Grow at `grow-payments.functions.ts:36`) and per order. Caller must be the order owner or hold a per-order token (map risk 11). Error messages come from a fixed list, because server-function errors reach the browser. | B |
| U14 | `checkout-payment-choice.test.ts` | `cleanPayload`/`checkoutPayload` map `bit`→`bit`, `grow`→`grow`, `max`→`max`, and `credit_card` or anything else → `offline` (`src/lib/checkout.functions.ts:49-51`; no test today) | B |
| U15 | Edit `env-forwarding.test.ts` | New MAX variables are in `docker-compose.yml` and `.env.example`; the MAX URL override is in `TEST_ONLY` (`:15-20`). Extend the regex to catch `env["…"]` aliases. | B |
| U16 | Edit `gtm.test.ts` | The return path and `/checkout/max/:id` are cleaned like `/checkout/grow/:id` (`gtm.test.ts:73-74`, `src/platform/analytics/gtm.ts:100-120`). Otherwise the payment page URL (name, email, `UserId`) would reach analytics. | B |
| U17 | `tests/architecture/max-boundaries.test.ts` | Modules that touch credentials are `*.server.ts`, and no client file imports them. No `VITE_*MAX*` or `VITE_*HYP*`. MAX does not import Grow or Bit modules and they do not import MAX. No `rejectUnauthorized` or `NODE_TLS_REJECT_UNAUTHORIZED` in `src`. `src/routes/api.*max*` exports only GET handlers; a state-changing POST must be a server function behind CSRF. No `===` on names matching `/sign\|signature\|token\|hash/i` in MAX files. | B |
| U18 | `tests/architecture/no-payment-secrets-in-repo.test.ts` | In committed files: no 10-digit `00100…` number (the documented prefix of Hyp test terminals) other than the declared fake ones; no `PassP=`/`KEY=` with a non-placeholder value; no 13–19-digit number that passes the Luhn check in `tests/`, `e2e/`, `scripts/` or `docs/` | B |
| U19 | `max-return-fuzz.test.ts` | Seeded random reordering, duplication, encoding and length changes of a valid redirect, checked against an in-memory VERIFY stand-in. Rule: the result is "paid" only when the stand-in returns `CCode=0` and every match passes. No new dependency. | E (may start in B) |

**U1 detail (`max-hyp-sign-request.test.ts`):**
- Only these keys are sent: `action=APISign`, `What=SIGN`, `Masof`, `KEY`, `PassP`, `Amount`, `Order`, `Coin`, `Sign=True`, `MoreData=True`, `PageLang=HEB`, `Info`, `ClientName`, `ClientLName`, `email`, `cell` (`UserId` only if that is decided). Any other key throws.
- Never sent:
  - `J5`, `Postpone`, `HK`;
  - `Tash`/`FixTash` (in Phase 1);
  - `SendHesh=True`, `sendemail=True`;
  - `Fild1-3`, `zip`, `phone`, `BOF`, `blockItemValidation`, `source`.
- `UTF8`/`UTF8out`: decided after D10.
- A golden string with a stable key order.
- Every value is URL-encoded. Inputs tested: Hebrew, `& = + % #`. CR, LF and NUL are rejected. The total length is capped.
- The amount comes only from integer agorot: 1000→`10.00`, 1→`0.01`, 105→`1.05`. Zero, negative, fractional, over the cap, or not a safe integer → throw.
- ILS→`Coin=1`. USD, EUR and GBP are rejected in Phase 1.
- With POST, credentials go only in the body; the URL string contains no `KEY=` or `PassP=`.

**U8 detail (`max-hyp-match.test.ts`):** `match(attempt, parsed, currentDue)` returns `ok` or one of these reasons:
- `amount_mismatch`: against the attempt;
- `amount_drift`: the attempt against the current `order_amount_due`;
- `currency_mismatch`: also when `Coin` is missing although `MoreData=True`;
- `order_mismatch`;
- `credential_changed`: the attempt's credential version is not the current one;
- `mode_mismatch`: a test attempt on a live store.

Also checks the format and length of `Id`. `safeEqual()` uses `crypto.timingSafeEqual` (checked with a spy) and returns false on a length mismatch without throwing.

**U9 detail (`max-hyp-client.test.ts`):**
- The timeout is pinned (for example 15 s, as `grow.server.ts:17`).
  - SIGN timeout → `timeout` and no payment URL.
  - VERIFY timeout → `verify_pending`, never failed and never paid.
- Network errors and 5xx are handled.
- Redirects are never followed (3xx with `redirect:"manual"`), so credentials never go to another host.
- The base URL is the constant `https://pay.hyp.co.il/p/`. A test-only override is accepted only for `http://127.0.0.1` or `localhost` with a `*.localhost` platform host (copy `ai-security.test.ts:742-753`).
- When fetch fails with an error whose message contains the URL or body (for example "Failed to parse URL from …"), the fake `KEY`, `PassP` and `Masof` must not appear in the thrown error, in `describeError()` (`src/lib/error-capture.ts:18-31`, which logs the whole cause chain), or in any `console.*` call.

### 3.2 SQL tests (`scripts/db-tests/`, run by `run.sh`, 3 passes)

**Shared rules:**
- Define a `tests.max_server(tenant, sql)` helper copied from `tests.lic_server` (`digital-licenses.test.sql:10-24`).
- Use a dedicated customer `a0000000-0000-0000-0000-0000000000d1`, with its own product and shipping-method ids.
- Clean up completely, and reset `site_settings` and `kobi.payment_update`.

| # | File | What it asserts | Gate |
|---|---|---|---|
| S1 | `max-payments.test.sql` | See detail below the table | B |
| S2 | `max-payment-states.test.sql` | Table-driven over every (from, to) pair of attempt states. Legal moves work only through the functions. Illegal moves fail, even for `service_role` (trigger). Final states cannot change. After insert, `amount_minor`, `currency`, `order_id`, `tenant_id`, `credential_id` and `order_ref` cannot change. | B |
| S3 | `max-mark-paid.test.sql` | See detail below the table | B |
| S4 | `max-payment-isolation.test.sql` | See detail below the table | B (DB rules) / C (decisions) |
| S5 | `max-payment-idempotency.test.sql` | See detail below the table | B |
| S6 | `max-payment-expiry.test.sql` | An expired attempt alone keeps the stock and the order waiting, and a new attempt is allowed. `expire_unpaid_orders()` (`remove_hyp.sql:179-200`) cancels the MAX order, returns stock exactly once (+1, as in `remove-hyp.test.sql:199-206`) and expires its attempts (Grow leaves process rows `pending`). A second run → 0. A payment after expiry → `paid_late` or `needs_review` as decided; the order is not silently reopened; an alert row is written. | B |
| S7 | `max-payment-events.test.sql` | Each function call writes one event per outcome. UPDATE and DELETE fail, even for `service_role` (same pattern as `license_audit_append_only`, `20261107100000_lic_digital_licenses.sql:168-179`; test `digital-licenses.test.sql:349-352`). No event text contains the sentinel `PassP`, `KEY`, `Tmonth`, `Tyear`, `bincard` or `UserId` values. `payload_sha256` is 64 hex characters. | B |
| S8 | `payments-regression.test.sql` (**write and merge on the code before MAX**) | See §3.7 | B |
| S9 | Edits to existing files | Regenerate `db-classification.test.sql`. Add the attempts and events tables to `ecommerce-engine-guard.test.sql:39-52` (40 → 42). Add `supabase/rollbacks/<ts>_max_payments.down.sql` with a `DO … RAISE EXCEPTION` guard that stops when attempts exist, plus `rollback-check.sh` `Mn=`/`down`/`up` lines and a guard proof in `rollback-guards.sh`. Unchanged and still green: `grow-payments.test.sql`, `remove-hyp.test.sql`, `tenant-isolation-coverage.test.sql`. | B |

**S1 detail (`max-payments.test.sql`):**
- Anon, authenticated users and a store admin get `permission denied` on credentials, attempts and events, and on EXECUTE of `max_mark_paid` and the other functions.
- `service_role` can execute them, tested through the helper (Grow never tests this).
- `max_payments_active` is false by default.
- `place_order(…'max')` while MAX is off → error. When MAX is on → `max`/`awaiting` with the chosen due window.
- An admin's direct UPDATE to "paid" is silently ignored (as `grow-payments.test.sql:77-82`).
- An unpaid order cannot move to picking (as `:83-86`).
- `orders_payment_check` accepts `max` and keeps `credit_card`.
- MAX fields appear only on MAX orders, and other providers' fields never appear on MAX orders.

**S3 detail (`max-mark-paid.test.sql`).** Each case also checks the order, the attempt and the events afterwards:
- `unknown`, `tenant_mismatch`, `amount_mismatch`, `amount_drift`, `currency_mismatch`, `credential_changed`;
- `mode_mismatch`: never paid;
- `ccode_not_zero`;
- `paid`: `paid_at` set, due date cleared, stock unchanged;
- `already_paid`: nothing changes, even with a different `Id`;
- a provider `Id` already used by another attempt → `needs_review` (the unique violation is caught);
- an old superseded attempt pays while a newer one is open → the order is paid once, and the second payment is `needs_review: duplicate_payment` with an alert;
- a failure mid-update rolls back everything (inject a failing trigger, as in `grow-payments.test.sql:114-140`);
- the VERIFY call counter for each attempt is capped;
- the function body contains `FOR UPDATE` on both the attempt and the order. This is a cheap static check; the real proof is C3.

**S4 detail (`max-payment-isolation.test.sql`):**
- A matrix of owner A, owner B, agent, customer, platform admin and anon against credentials, attempts, events and the status function.
- Owner A sending the header for store B sees nothing (the member check in `current_tenant_id()`).
- The platform admin can set or clear credentials through a function and can read "configured", a masked terminal and the update date. No function returns `*_enc` columns.
- `max_mark_paid` with store B's tenant context on store A's attempt → refused.
- The store owner's status function returns only that store's orders, with no raw payload.

**S5 detail (`max-payment-idempotency.test.sql`):**
- A partial unique index allows one active attempt per order; a second one raises `unique_violation`.
- `max_attempt_open` returns the active attempt that already exists.
- UNIQUE `(credential_id, provider_txn_id)` and UNIQUE `order_ref`.
- **The amount is frozen while an attempt is active:**
  - a customer INSERT into `order_items` is refused (today `20260928090000_order_integrity.sql:151-157` allows it);
  - item UPDATE or DELETE is refused;
  - admin changes to shipping, coupon or manual discount are refused;
  - an UPDATE of the attempt amount is refused.
- An admin update of the status alone leaves `total` equal to the attempt amount.

### 3.3 Concurrency tests

New script `scripts/db-tests/max-payments-concurrency.sh`. Copy the `parallel()` and `held()` helpers from `order-guard-concurrency.sh:70-86` and `hospitality/concurrency/run.sh:58-73`. Clone the database from a template, as `rollback-guards.sh:20-25` does. **Gate B.**

| # | Scenario | Must be exactly |
|---|---|---|
| C1 | "Return and notify at the same time". Hyp Pay documents no notify, so the test uses two independent callers of `max_mark_paid` with the same input: a second tab, a VERIFY retry, or a notify if Hyp ever confirms one. | 1 `paid`, 1 `already_paid`; one `paid` event; order paid once |
| C2 | 10 identical returns in parallel | 1 `paid`, 9 `already_paid`; no error, no deadlock; stock unchanged |
| C3 | `held`: A runs `BEGIN; SELECT max_mark_paid(…); SELECT pg_sleep(2); COMMIT;` and B makes the same call | B waited ≥ 1.2 s and got `already_paid` (proves FOR UPDATE) |
| C4 | Double click on "pay": 5 parallel `max_attempt_open` calls for one order | 1 active attempt, and every call returns its id |
| C5 | `max_mark_paid` vs. `expire_unpaid_orders()` on an overdue order, 20 rounds | Each round ends either paid (expiry did nothing) or expired + `paid_late`. Never paid and cancelled. Stock consistent. Zero `deadlock detected`. |
| C6 | The same provider `Id` on two attempts in parallel | 1 paid, 1 `needs_review` |
| C7 | Mark-paid vs. an admin cancelling the order | One consistent final state; no deadlock |
| C8 | Attempts of two stores in parallel | B is not blocked by A (`held` wait ≤ 500 ms) |

### 3.4 Mock Hyp server (for E2E; documented behaviour only)

Add `e2e/scripts/mock-hyp.mjs`, or a `/hyp/` section in `mock-services.mjs`, started by `app-up.sh`. It is reached through a guarded override environment variable, accepted only for loopback (U9). The fake terminals, `KEY`/`PassP` values and success/error URLs per terminal are declared once in `e2e/fixtures/data.mjs` and marked as fake. **Gate B.**

| Request | Mock response | Basis (docs research) |
|---|---|---|
| `APISign&What=SIGN` with correct credentials (GET or POST) | 200. URL-encoded string of the request parameters without `KEY`/`PassP`, with `action=pay` and `signature=<64 hex>` (per-terminal HMAC that only the mock knows) | §1 "APISign response", §2 "SIGN success" |
| SIGN with wrong credentials / without `What` | 200 with `CCode=902` / `CCode=904` | §2 "SIGN failure", §3 CCode table |
| `/hyp/p/?action=pay…` | HTML page with Approve, Decline and Cancel | §1 "Payment page URL" |
| Approve | 302 to the terminal's success URL with `Id, CCode=0, Amount, ACode, Order, Fild1-3, Sign`. With `MoreData`, also `Coin, L4digit, Payments, UID, Brand, Issuer, Tmonth, Tyear, bincard, UserId` carrying sentinel values. One mode puts Windows-1255 bytes in `Fild1`/`Info`. | §3 base set and MoreData list; 3DS example |
| Decline, portal with a success URL only | Stays on the mock page with an error and does not redirect | §1 "Success / error URL" |
| Decline, portal with an error URL | 302 to the error URL with a non-zero CCode | §3 "Error-URL behaviour" |
| VERIFY with the exact raw parameters of a redirect this terminal issued | `CCode=0` | §2 "VERIFY success" |
| VERIFY with missing parameters / anything else (changed, other terminal, reordered) | `CCode=200` / another non-zero code. The real code for tampering is not documented, so the implementation must accept only exactly `0`. | §2 "VERIFY failure" |
| "System error" mode | HTTP 200 with an HTML body | §8 "Parse CCode, not the HTTP status" |
| Not implemented, because not documented for Hyp Pay | Notify/webhook, transaction lookup, IP allow-list | §4 |

**Fault injection.** These cover transport failures, not Hyp behaviour:
- hang longer than the client timeout;
- connection reset;
- HTTP 500/503;
- non-HTML garbage.

They are chosen per terminal or with `POST /__hyp/mode`. Requests are recorded at `/__calls`, as `mock-services.mjs:185-190` does today.

### 3.5 E2E specs (`e2e/tests/`, run in the `e2e` job)

**Shared rules:**
- Add `test.describe.configure({ retries: 0 })` to every MAX spec.
- API-level specs skip the `mobile` project; UI specs carry `@mobile`.
- Use a unique `x-real-ip` per test for rate limits (`rate-limit.server.ts:44-55`).
- Trigger expiry through `sql()`; do not wait for the 5-minute job.

| # | File | Scenario and assertions | Gate |
|---|---|---|---|
| E1 | `max-checkout.spec.ts` | See detail below the table | B (API) / C (UI) |
| E2 | `max-decline-cancel.spec.ts` | Decline with only a success URL → no return; attempt stays `redirected`. After expiry forced through SQL → attempt expired, order expired, stock +1. Decline with an error URL → return with non-zero CCode → VERIFY → `failed`, not paid. A forged decline (VERIFY fails) → nothing changes. Shopper cancels or goes back → still `redirected`, and a new attempt is allowed. | B |
| E3 | `max-provider-failures.spec.ts` | SIGN hangs past the timeout → fixed Hebrew error, attempt not redirected, retry works (one case, about 16 s). SIGN HTML / garbage / 500 / 902 → fixed error, and none of Hyp's body appears in our response. VERIFY hangs or returns HTML → "checking payment" page, attempt `verifying`, not paid. After the mock recovers, a retry from the page → paid. | B |
| E4 | `max-tamper.spec.ts` | The captured success query is altered: `Amount`, `Order` or `Coin` changed, `Sign` removed, `Amount` duplicated, `PassP=` added, parameters reordered → never paid. Local rejections make no VERIFY call (`/__calls`); VERIFY rejections are logged as `verify_failed`. A redirect signed by terminal B and sent to store A → VERIFY non-zero. | B |
| E5 | `max-replay.spec.ts` | The same return twice, and 10 in parallel (`Promise.all` of `hostGet`) → one paid, the same final page for all, one email in `/__calls`, at most 10 VERIFY calls. A decline replayed after payment → stays paid. A success for an old superseded attempt → `duplicate_payment` and a staff alert. | B |
| E6 | `max-tenant-host.spec.ts` | Store A's return on the `store-b` host → neutral page, A unchanged, no VERIFY with B's terminal (checked via `/__calls` Masof). Forged `Host`/`X-Forwarded-Host` (pattern `tenant-routing.spec.ts:248`). A's verified custom domain is accepted. A zimmer host → 404. A suspended or expired store A → the payment is still recorded (decision), and no 403 is returned before recording it (store gate at `src/server.ts:71-89`). | C |
| E7 | `max-expired-attempt.spec.ts` | Attempt or order expired through SQL plus `expire_unpaid_orders()`, then a valid return → `paid_late` or `needs_review` as decided. The order is not reopened, a staff alert row exists, and a second return changes nothing. | B |
| E8 | `max-admin-settings.spec.ts` | See detail below the table | C |
| E9 | `max-csrf-ratelimit.spec.ts` | Every MAX server function called with `sec-fetch-site: cross-site` and a foreign `origin`, and again with no origin headers → 403, nothing written, no SIGN call. TanStack refuses requests with no origin headers (`node_modules/@tanstack/start-client-core/dist/esm/createCsrfMiddleware.js:16-35`). A cross-site return GET works and is idempotent. Limits: start N+1 → error; return N+1 per IP → 429; the per-attempt VERIFY cap → `needs_review`. | B / C |
| E10 | `max-no-leaks.spec.ts` | Pages, `/_serverFn` responses and error pages contain no canary values. Browser `localStorage`, `sessionStorage` and cookies contain no `PassP`, `KEY` or `Sign`. After the run, `sql()` scans every text and jsonb column in public tables for the sentinel card values (`Tmonth`, `Tyear`, `bincard`, `UserId`) and the canary secrets → 0 hits. | B / E |
| E11 | `payments-regression.spec.ts` | See §3.7 | B |

**E1 detail (`max-checkout.spec.ts`).** The success path:
1. A customer token places a MAX order through `place_order` (pattern `checkout-coupon.spec.ts`).
2. `startMaxPayment` is called through `callServerFn`.
3. The returned URL host is the mock, and the URL has no `KEY`/`PassP`.
4. Approve on the mock.
5. The return arrives through `hostGet` → 303.

Then the database shows the order and the attempt paid, with events; stock was reserved once; `/__calls` shows one order email; `page_location` is cleaned. In phase C, the same flow runs through the UI on desktop and `@mobile`.

**E8 detail (`max-admin-settings.spec.ts`):**
- The platform admin saves fake credentials. The UI and JSON then show only "configured", a masked terminal and the date.
- Responses never contain the canary `PassP`/`KEY` (scanned with `page.on('response')`).
- A "test mode" badge is shown.
- Live mode with a `00100` terminal is refused.
- "Check connection" sends a SIGN only and creates no attempt.
- A matrix of owner A, owner B, agent, customer and anon, through `callServerFn` and PostgREST (pattern `manage-integration.spec.ts`).
- An audit row is written.

### 3.6 Security tests

| # | Test | Asserts | Where / CI | Gate |
|---|---|---|---|---|
| X1 | `scripts/security/scan-bundle.mjs` | `.output/public/**` contains no `PassP`, `KEY=`, `APISign`, `What=VERIFY`, MAX environment variable names or canary values | After build in the `checks` job and the `e2e` job, with canary environment values at build time | B |
| X2 | `scripts/security/scan-logs.mjs` | The E2E server log contains no canary value, no `PassP=`/`KEY=` with a value, no raw return query and no sentinel card value | `e2e` job, after `test:e2e`. Needs `app-up.sh` to copy server output to `e2e/test-results/server.log`, because stdout is ignored today (`playwright.config.ts:55`). Never run E2E with real credentials: this folder is uploaded when a run fails (`tests.yml:113-121`). | B |
| X3 | E10 database scan; S7 events | No card data, secrets or raw query in the database | E2E, SQL | B |
| X4 | U9, U11 | No secrets in errors or `console.*`, including the expanded cause chain (`error-capture.ts:55-60`) | Unit | B |
| X5 | E3, U13 | Error pages and server-function messages come from a fixed list, with nothing from Hyp's body. `renderErrorPage()` takes no arguments (`src/lib/error-page.ts:1`). | E2E, unit | B |
| X6 | E9, U17 | CSRF on every state-changing MAX server function; API routes are GET-only | E2E, architecture | B / C |
| X7 | U12, U13, E9, S3 | Limits per IP, per order and per attempt. The VERIFY cap is stored in the database, because in-memory limits are per process (`rate-limit.server.ts:10-37`). | — | B |
| X8 | U11, S7, E10 | No card data. MAX never calls `getToken` and never stores `Tmonth`, `Tyear` or `bincard`. `L4digit` is stored only if that is decided. | — | B |
| X9 | U12, plus `security-headers.test.ts` unchanged | Return response headers are `no-store` and `no-referrer`. CSP `form-action 'self'` is kept, so the jump to Hyp is a GET navigation (§1.11). | Unit | B |
| X10 | U18 in CI; in E, a secret scanner over the branch history | No test terminals, credentials or card numbers in git | Unit; reviewer | B / E |
| X11 | U19 fuzz test; reviewer's own fuzzing of the return endpoint against the mock | "Paid" only after `CCode=0` and every match passes | Unit; manual | E |

### 3.7 Regression: Grow, Bit and offline must behave exactly as today

| # | File | What it asserts | Gate |
|---|---|---|---|
| R1 | `scripts/db-tests/payments-regression.test.sql` | See detail below the table | B |
| R2 | Unchanged files | `grow-payments.test.sql`, `remove-hyp.test.sql`, `pos.test.sql`, `tests/unit/grow-webhook-failure.test.ts` and `tests/unit/grow-paid-late-alert.test.ts` pass without edits | B |
| R3 | `e2e/tests/payments-regression.spec.ts` | An offline order through the UI is unchanged (as `checkout-coupon.spec.ts`). A Bit order through the UI → `/checkout/bit/<id>` shows the Bit page. In a store with Grow on, "start" hits the mock's 503 → today's error text. A store without MAX shows the same payment options as today and no MAX option. | B |
| R4 | U14 | Payment-method mapping on the client and server | B |
| R5 | CI step (optional, needs owner approval) | A MAX pull request that changes `src/lib/grow*`, `src/lib/bit-payments*`, `src/routes/api.webhooks.grow.ts`, `src/routes/checkout_.grow.*`, `src/routes/checkout_.bit.*` or the Grow tests fails unless it carries an explicit label | B |

**R1 detail (`payments-regression.test.sql`).** Write it first and merge it on the code before MAX, so it records today's behaviour.
- **Behaviour matrix** for offline, Bit, Grow, POS, quotes and staff orders, including cases that are untested today:
  - Bit rejection;
  - cancelling and un-cancelling `awaiting_verification`;
  - reopening a cancelled Bit order on approval.
- **Settings guard:** `site_settings_payment_methods_guard`.
- **Fingerprints** (method of `scripts/audit/gen-migration-fingerprint.py:7-14`) for `grow_mark_paid`, `grow_payments_active`, `bit_payment_submit`, `bit_payment_review`, `bit_payment_info`, `bit_payments_active` and `order_amount_due`, plus `expire_unpaid_orders` if MAX leaves it unchanged.

### 3.8 Manual sandbox plan (gate D; only with the owner's approval)

**D0. Preconditions:**
- **Approval.** The owner approves in writing: date, scope and who tests.
- **Terminal.** Use a test terminal that Hyp issued for this business. Test terminals start with `00100` (docs research §6). Hyp gives one terminal per environment by default, so the full version of D8 needs a second one (https://developers.hyp.co.il/pay/getting-started/prerequisites-and-initial-setup).
- **Cards.** Use only the test cards on https://developers.hyp.co.il/pay/getting-started/testing-environments; do not copy them anywhere. Never use the WooCommerce plugin's terminal or any other third-party terminal.
- **Portal setup:**
  - turn on "Verify by signature in the payment page" (https://developers.hyp.co.il/pay/security/transaction-validation);
  - set the success URL to staging `/api/payments/max/return`;
  - record the decision on the error URL.
- **Environment.** Staging app and staging database only. MAX in test mode. The feature flag is on for the platform store only.
- **Credentials.** The owner types the credentials into the admin UI, never into chat, git, CI or tickets. Production credentials are never used.
- **Amounts.** Keep amounts low, about ₪10, as the docs recommend.
- **Network.** Hyp Pay has no server callback, so the staging return URL only has to be reachable from the tester's browser.
- **Evidence handling.** Evidence is kept outside git. It records parameter names, CCode, lengths and hashes only; never the values of `KEY`, `PassP`, `Masof`, `Sign`, `signature` or customer data.

**Stop at once if any of these happen:**
- the terminal does not start with `00100`;
- anything suggests a real charge (a bank SMS, a settlement report);
- a production host or database is touched;
- VERIFY returns `CCode=0` for a tampered field: escalate to Hyp, and gate E is blocked;
- any 600/700/800 appears, which means the terminal is set for J2, J5 or Postpone;
- HTML system errors repeat;
- a secret or card field shows up in logs, the database, browser storage or analytics;
- any Grow, Bit or offline order changes.

| # | Scenario | Expected | Evidence to capture |
|---|---|---|---|
| D1 | Connection check: SIGN only, payment page not opened | `action=pay` and `signature` present; `KEY`/`PassP` not echoed | Parameter names, response length |
| D2 | The owner enters a wrong `PassP` | A 902/904-type CCode → "credentials invalid"; no attempt created | CCode; the redacted log line |
| D3 | Success card, ₪10, Hebrew page | "Paid" only after VERIFY `CCode=0`. Amount, Coin and Order match. `L4digit` handled as decided. `Tmonth`, `Tyear`, `bincard` and `UserId` are in neither the database nor the logs. One email. | Attempt, order and event rows; the VERIFY CCode; screenshots of our pages only |
| D4 | Failure card | Depends on the portal setup (error on Hyp's page, or a return to the error URL). Not paid. Attempt `redirected` or `failed`. Stock returned when the order expires. | Rows; the portal setting used |
| D5 | Shopper cancels or closes Hyp's page | Attempt stays `redirected`, then expires after its time limit. The order expires on its due date. Stock returned once. | Rows, timestamps |
| D6 | Tamper with the D3 return URL: `Amount`, `Order`, `Coin`, `Id`, `Fild1`, `Sign` removed, parameters reordered, `Amount` duplicated | Duplicates and a missing `Sign` are rejected locally with no VERIFY. The other cases get a non-zero VERIFY → not paid. | Which fields VERIFY covers (answers open question 5) |
| D7 | Reload the D3 URL; open it in a second tab | "Already paid", no second email | Whether a repeated VERIFY still returns 0 |
| D8 | Send the D3 URL to store B's staging host | Rejected locally; no VERIFY | Logs, `/__calls`-style trace |
| D9 | Paid after expiry: start a payment, expire the attempt and order on staging (staging write approved by the owner), then pay | `paid_late` or `needs_review`, plus a staff alert. The owner cancels the test transaction in Hyp's test portal; no refund goes through our system. | Rows, alert |
| D10 | Hebrew name; an email with `+` | VERIFY passes with the raw parameters passed through unchanged | The observed encoding, UTF-8 or Windows-1255 (open question 6); decision on `UTF8`/`UTF8out` |
| D11 | SIGN and VERIFY sent by POST | Both work, so credentials stay out of URLs. If not, stop and decide. | Method, result |
| D12 | Double click "pay" in a real browser | One attempt and one Hyp page, or the same `Order` | Rows, calls |
| D13 | Switch the store to live mode with the `00100` terminal | Refused | UI message, event |
| D14 | Installments | None offered; `Payments` is 1 or absent | Screenshot, parameter names |
| D15 | List the MoreData fields | Which redirect parameters actually arrive (names only); whether `Coin` is present | Name list |
| D16 | Non-zero redirects (only if an error URL is set) | What VERIFY returns for a declined redirect (open question 4) | CCode |
| D17 | Evidence review | The owner greps the staging logs for the real `KEY`/`PassP` on their own machine and shares only the count, which must be 0. A database scan for card fields finds 0. Events are complete. | Counts |

**Cannot be tested in the sandbox.** Wallets (Apple Pay, Google Pay), bit through Hyp, and 3DS work only in production (docs research §6). For Phase 1, either hide them (`hideBtns`; a decision is needed) or have the owner accept the risk in writing before F.

### 3.9 Production (gate F)

- **Approval and credentials.** The owner and Hyp both approve in writing. The owner enters the production credentials.
- **Rollout.** The MAX flag is off by default and is turned on for the platform store only.
- **No automated real charges.** Watch the first real payments: the attempt and event views, and an alert on `needs_review`.
- **Reconciliation.** Compare against the Hyp portal by hand, daily, for the first N days.
- **Kill switch.** Practise turning the flag off before launch.
- **Production-only features.** Verify them only by watching real customer payments, or through a transaction the owner makes with their own card, if the owner chooses.

---

## 4. CI changes (`.github/workflows/tests.yml`)

| Where | Change |
|---|---|
| Triggers (`:9-13`) | Add `payments/**` to the push branches |
| `checks` strict lint (`:39`) | Add the MAX source and test files |
| `checks`, after build (`:47-51`) | `node scripts/security/scan-bundle.mjs .output/public` (X1) |
| `db`, after `:83` | `bash scripts/db-tests/max-payments-concurrency.sh` (C1–C8). The SQL files S1–S9 run on their own through `run.sh`. |
| `e2e`, build step (`:105-108`) | Export canary MAX environment values at build time (X1 on the e2e build) |
| `e2e/scripts/app-up.sh` | Mock-Hyp URL override, fake MAX key, start the mock, copy server output to `e2e/test-results/server.log` |
| `e2e`, after `:112` | `node scripts/security/scan-logs.mjs e2e/test-results/server.log` (X2) |
| MAX specs | `retries: 0` (`playwright.config.ts:22` allows 1 in CI) |
| Optional; needs owner approval for a new tool or step | R5 protected-paths check; a secret scanner pinned to a commit SHA |

**Expected extra CI time (estimates, not measured):**
- unit: about +150 cases, a few seconds;
- SQL: about +150 assertions × 3 passes, under 1 minute;
- concurrency: 1 cloned database + 8 scenarios, about 1–2 minutes;
- E2E: about +25 tests, about 3–5 minutes on top of today's 23.8, within the 40-minute timeout.

---

## 5. Acceptance criteria for each phase

| Phase | Done when |
|---|---|
| **B** | See the list below the table |
| **C** | All C rows pass. S4 and E8 cover every account type (as `manage-integration.spec.ts`), and the decisions on store owner vs. platform admin are written into the tests. Response scans show the UI never renders secrets. E9 covers every MAX server function. E6 is decided and passing (suspended store, custom domain, zimmer host). The checkout UI flows (E1 in UI mode) pass on desktop and `@mobile`. |
| **D** | D1–D17 are done, or marked not applicable with a reason. No stop condition was hit. Open questions 2, 4, 5, 6, 10, 15 and 16 are answered by Hyp or the risk is accepted in writing. Redacted sandbox exchanges are recorded, and the mock is updated to match them (contract tests). |
| **E** | A reviewer who did not write the code reviews the code, the tests, the threat model and the D evidence. The reviewer runs U19 and their own fuzzing, X1–X3, and a secret scan of the branch history. Every high or critical finding is fixed with a regression test. The sign-off is recorded. |
| **F** | Written approval from the owner and Hyp. The production checklist is done. The rollout is watched. The kill switch has been practised. There are no automated real charges or refunds. |

**Phase B is done when:**
- every B row in §3 passes in CI on the pull request: U1–U18, S1–S9, C1–C8, E1–E5, E7, E9 and E10 at API level, X1–X10, and R1–R4;
- all three SQL passes pass, including the second run of the MAX migrations (locally with `NEW_MIGRATIONS=<k>`);
- the rollback and its data guard are proven;
- R1 passes both before and after MAX;
- the Grow, Bit and offline tests pass unedited;
- X1 and X2 find 0 hits;
- the CCode and parser tables in U3, U5 and U6 cover every documented code;
- there are no `hyp_` names in the public schema (or a reviewed change to `remove-hyp.test.sql`).

---

## 6. Decisions that change what the tests expect

These must be fixed before the tests are written. Each test above names the case it covers.

| Decision | Tests affected |
|---|---|
| A payment after expiry: mark paid late (as Grow) or reopen the order (as the old Hyp code) | S3, S6, E7, D9 |
| `MoreData=True`, which brings the currency check but also card fields, vs. `False` | U1, U8, U11, X8, D15 |
| Send `UserId`? | U1, U11 |
| Set an error URL in the portal? | U6, E2, D4, D16 |
| Who manages credentials: the platform admin only, as for Grow, or store owners too | S4, E8 |
| Retrying VERIFY: keep no raw query (the browser retries) vs. store it encrypted for a short time | U12, E3, X8 |
| Returns while a store is suspended or expired | E6 |
| Attempt time limit vs. the order's due window; `Order` format and length | S5, S6, U3 |
| Hide wallets in Phase 1 | D, F |

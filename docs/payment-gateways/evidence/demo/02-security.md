# 02 — Payment security for the DEMO stage (MAX/Hyp, two merchant scopes)

**Role:** payment-security agent. **Repository:** `(repo root)` (branch `payments/max-hyp`, code = `910b1f9`). **Status:** complete.
**Builds on** `docs/payment-gateways/evidence/08-security.md` (STRIDE table rows #1–40, findings MX-01..MX-20, requirements SR-01..SR-34) and `07-testing-plan.md` (test IDs U/S/C/E/X/D). Nothing from 08 is repeated unless it changes.

**What I did (all read-only):** read the code and migrations; ran catalog `SELECT`s on the local test DB (`psql -X -h /tmp/pg -p 5499 -U postgres -d shop_test`); read official Hyp Pay pages. I changed no repository file, ran no DDL/DML, sent nothing to any Hyp payment/API host, and opened no `.env*` file or excluded file.
**Hyp sources — important caveat:** `developers.hyp.co.il` does not resolve from this session (WebFetch: `getaddrinfo ENOTFOUND`). Every Hyp quote below is therefore taken from the copies of the **official pages fetched earlier in this same session** (HTTP 200, 2026-11-27 14:07 UTC, (saved copies of the official pages, kept outside the repo), fetch log `fetch-log-pay.txt`). Each quote carries its official URL. To re-verify live, `developers.hyp.co.il` must be allowed in the session's network settings.
**Not copied anywhere:** test card numbers, sample terminal numbers, example `KEY`/`PassP` values (masked when I read the pages).

**Legend:** **(a)** required for DEMO now · **(b)** designed now, built later · **(c)** out of scope.
**DEMO sub-stages used below:** **DEMO-1** = local/CI against a mock Hyp server (no Hyp credentials exist at all); **DEMO-2** = manual run from a non-production NURIEL instance against Hyp's real **test** environment (test terminals only).

---

## 0. Top conclusions

1. **"DEMO can never charge a real card" reduces to one property: the DEMO instance can never hold or use live credentials.** Hyp uses the same URL for test and production, and only the credentials decide (§1b). So the guard must be layered on credentials and on the instance, not on URLs or the terminal prefix: an explicit `PAYMENTS_ENV` (NODE_ENV is `production` in every container, `Dockerfile:41`), a DB instance marker that refuses `live` accounts in DEMO, a separate master secret per environment, and the environment + scope + mode inside the HKDF label and AAD.
2. **New cross-scope attack that did not exist with one scope.** Every platform customer is a merchant who typically holds his own Hyp terminal and the portal account where Hyp shows its `KEY`/`PassP`. He can create a genuine, cheaply self-paid transaction on **his** terminal that carries the platform attempt's `Order` and `Amount`, and replay its return to the platform endpoint. The only defence is that `VERIFY` with the **platform** terminal's credentials rejects a transaction of another terminal. That is undocumented (Hyp Q4). A DEMO-2 test with two test terminals (**NEW-D-XTERM**) must pass before any live platform purchase. Until it passes, platform activation must stay `needs_review`.
3. **Separation needs more than separate tables.** On the platform host, `tenant_for_host` falls back to the **default store**, so `maybeCurrentTenant()` is a real store there (live SQL, §9). The platform terminal and a store terminal can collide across tables unless a **cross-scope terminal registry** exists. Prefix-overlapping return paths would also be a risk. Platform admins are `owner` in **every** store (`store_staff_role`), so any future refund check based on `staff_can` would let NURIEL staff move store money.
4. **Hyp Pay issues invoices by default.** The docs say "Invoicing is enabled on your terminal by default", including for refunds and cancellations (§4). With SmartBee planned, this means duplicate tax documents unless the module is switched off per terminal. This is an owner + Hyp decision **before any live terminal**, and it is observable in DEMO-2 (`Hesh` in the MoreData return).
5. **Refunds from the order screen are feasible on paper but must stay manual for now.** The documented `zikoyAPI`/`CancelTrans` calls are GET requests with `PassP` in the URL. Whether `zPass` is required is contradictory in the docs. A same-day partial refund is not covered ("must have been transmitted and settled"). There is no documented lookup to resolve an unknown outcome. §3 gives the design. In DEMO, refund capability stays `false`, and a test proves no refund code exists (**NEW-NEG-U1**).

---

## 1. Threat-model delta

### 1a. Two merchant scopes: `platform` (NURIEL's terminal) vs `tenant` (each store's terminal)

**Facts this rests on (verified):**
- **The platform host has a "tenant".** `tenant_for_host` returns the default store when nothing matches (live `pg_get_functiondef`: last `COALESCE` branch `WHERE t.is_default`). `server.ts:181` resolves it for the platform host too. `storeGate` returns early on the platform host (`src/server.ts:72`). `currentSite()` deliberately returns `null` there (`src/platform/tenancy/current-site.server.ts:9`). So platform-scope code must key on `isPlatformRequest()` (`src/integrations/supabase/tenant.server.ts:232-235`, an exact host compare) and must never read `maybeCurrentTenant()`.
- **Hyp's return identifies nothing but our `Order`.**
  - The success URL is set once per terminal in the portal. The docs: "specify the URL of the success page on your website that will be displayed to the user after a transaction completes" (https://developers.hyp.co.il/pay/getting-started/prerequisites-and-initial-setup).
  - The redirect sample carries `Id, CCode, Amount, ACode, Order, Fild1-3, Sign` (https://developers.hyp.co.il/pay/getting-started/creating-a-payment-page).
  - The `MoreData` field table lists no terminal number (https://developers.hyp.co.il/pay/reference/actions, MoreData table).
- **Merchants can read their own API credentials.** The docs: "To retrieve your API key and password from your Hyp Portal account" (prerequisites page). So a store owner who holds his terminal's portal account (the normal case: Hyp opens the terminal and portal for the merchant) can call `APISign` himself. So can anyone who opens their own Hyp merchant account.
- **Platform roles have no tiers.** `platform_admins` has only `user_id, created_at` (live `\d`). `is_platform_admin` = row exists (live def). "Super admin" in the DB is a **store** check: `is_super_admin` = admin of `current_tenant_id()`, or a platform admin while a tenant is set (live def). In code comments "מנהל-על/סופר-אדמין" means platform admin (`src/lib/platform-files.server.ts:2`).
- **Platform admins are owners everywhere.** `store_staff_role` returns `owner` for every platform admin, in every store (live def, first `WHEN`). `staff_can`: owner → all permissions; manager → all except `billing.manage` and `staff.managers` (live def).
- **Business Admin (migration 188) is hospitality-only and excluded from money.**
  - `hospitality.can` returns false unless `current_site_type()='hospitality'`.
  - A business admin gets everything except `'billing.manage'` and `'ownership'` (`supabase/migrations/20261113100000_hosp_business_admin.sql:60-80`, esp. `:66-69`).
  - Billing owner functions exclude it: "מנהלים, מנהל/ת עסק ועובדים — לא" (`20261114100000_billing_agreements.sql:660-679`).

**Role matrix (recommended; ✓ = allowed, ✗ = refused, checked in the server function and again in the DB):**

| Role (today's DB meaning) | View platform-terminal status | Edit platform terminal | Pay platform charges | Refund a store transaction (future) | Refund a platform transaction (future) |
|---|---|---|---|---|---|
| Platform admin (`platform_admins` row; equal to all others) | ✓ (platform host) | ✓ DEMO: host + step-up; (b) named list | ✓ (logged as admin) | ✗ (not on store terminals) | ✓ only with the named permission + a second admin |
| Store owner (protected admin; `staff_can('billing.manage')`) | ✗ | ✗ | ✓ own store only | ✓ own store, with step-up | ✗ |
| Store manager (admin, not protected) | ✗ | ✗ | ✗ (`billing.manage` excluded) | ✗ (later: owner-granted, capped) | ✗ |
| Hospitality Business Admin (migration 188) | ✗ | ✗ | ✗ (`billing.manage` excluded) | ✗ | ✗ |
| Cashier / warehouse / agent / customer | ✗ | ✗ | ✗ | ✗ | ✗ |

| # | Threat (new with two scopes) | Control | Enforced at | Class | Test |
|---|---|---|---|---|---|
| T1 | **Credential confusion.** A tenant attempt is verified with the platform credentials, or the reverse. Or a NULL-tenant bug selects the platform row (`tenant_id IS NOT DISTINCT FROM NULL`). | **Separate tables per scope.**<br>• Tenant: `public.payment_provider_accounts` / `payment_attempts`, as in 06b.<br>• Platform: `billing.platform_payment_accounts` / `billing.platform_payment_attempts` / `billing.platform_payment_events`. The `billing` schema is closed to the API (`billing_agreements.sql:35-38`).<br>**Two separate loaders,** each taking only an attempt id of its own scope.<br>**HKDF label and AAD include the scope** (K1 below), so a swapped ciphertext fails to decrypt. | DB + crypto | (a) | NEW-SCOPE-S1 (catalog: no function reads both scopes' account tables)<br>NEW-SCOPE-U1 (U10 extended: a platform ciphertext in a tenant row fails, and vice versa) |
| T2 | **Cross-scope settlement.** A platform return settles a store order, or a store return settles a platform charge. | **Two settle functions, disjoint by construction.**<br>• `max_attempt_mark_paid(_tenant, …)` touches only `payment_attempts` + `orders`.<br>• `platform_attempt_mark_paid(_attempt, …)` touches only `billing.platform_payment_attempts` + billing/add-on objects, and never `orders`.<br>Neither takes a free-form reference: each looks up only its own table. Both are `service_role`-only DEFINER functions with an empty `search_path`. | DB | (a) | NEW-SCOPE-S2 (a platform reference passed to the tenant settle → not found, and vice versa; catalog check of the tables each function body references) |
| T3 | **Cross-terminal genuine-return replay (merchant self-payment).** A store owner signs a page on **his own** terminal with `Order` = the platform attempt reference (visible in his browser) and the same `Amount`. He pays himself and posts the genuine return to the platform endpoint. Our platform lookup finds the attempt and runs VERIFY with the platform credentials. **The outcome depends on whether VERIFY is terminal-bound: undocumented** (Hyp Q4, report §1.6). The same applies tenant→tenant: store A's owner against store B. | • VERIFY always uses the attempt's own terminal credentials (already planned).<br>• **DEMO-2 must prove the cross-terminal VERIFY fails** (2 test terminals).<br>• Until Hyp confirms it in writing **and** the test passes, platform activation = `needs_review` plus a manual check against the platform terminal's portal.<br>• Daily reconciliation of platform payments against that portal. | Hyp + settle + ops | (a) test; (b) reconciliation | **NEW-D-XTERM** (manual, DEMO-2) |
| T4 | **One terminal registered in two scopes or two tenants.** The 06b unique index `(provider, terminal_number)` covers one table only (`06b-proposed-ddl.sql.txt:57-59`). It cannot see the platform table. NURIEL's own store (the default tenant) is the likeliest collision with the platform terminal. | **Cross-scope registry** `payment_terminal_registry(provider, terminal_number) PRIMARY KEY, scope, owner_ref`, `service_role`-only. Both account tables carry an FK to it. A DEFINER `register` function refuses duplicates, and changing the scope or owner requires a new registration. | DB | (a) | NEW-SCOPE-S3 (same terminal → platform + tenant fails; tenant A + tenant B fails) |
| T5 | **Default-store confusion on the platform host.** The tenant return handler runs on the platform host and settles the default store's attempts; or the platform handler trusts `maybeCurrentTenant()`. | **Exact-match, non-overlapping paths:**<br>• tenant `GET /payments/return/max` → 404 when `isPlatformRequest()`;<br>• platform `GET /payments/platform-return/max` → 404 unless `isPlatformRequest()`.<br>Not `/payments/return/max/platform`: a `startsWith` router would send it to the tenant handler.<br>A mismatch writes the event `return_wrong_scope`, loads no credentials and makes **no VERIFY**. | `src/server.ts` routing | (a) | NEW-SCOPE-E1 (each return on the other host type → 404, mock `/__calls` = 0) |
| T6 | **Portal misconfiguration.** The platform terminal's success URL points at a store host, or a store terminal's at the platform host (it is set by hand per terminal). | Same as T5. The admin screen shows the exact success URL for each scope to copy, plus a checklist. `return_wrong_scope` raises an alert. | UI + events | (a) | NEW-SCOPE-E1 |
| T7 | **Who may view or edit the platform terminal.** All platform admins are equal. A platform-admin token lives in each origin's localStorage, and store owners control storefront scripts (MX-14). | • **View status** (configured, mode, last 2 digits, last verified): platform admins, platform host only.<br>• **Edit** (credentials, mode, enable): platform admins via **server function + `isPlatformRequest()` + step-up re-auth**, then a DEFINER function executable by **`service_role` only** with an explicit `_actor`. This is the AI pattern: `requirePlatformAdmin` (`src/platform/ai/admin.server.ts:45-56`); `ai_admin_*` granted to postgres + service_role only (live `proacl`).<br>• **Never:** store owner, manager, Business Admin, staff.<br>• (b) A named-admin permission table (no tiers exist today). | Server + DB | (a) host/step-up/service_role; (b) named permission | SR-20 / E8 extended<br>NEW-SCOPE-E2 (a platform-admin token used from a store host → refused; the DB function called with an authenticated JWT → `permission denied`) |
| T8 | **Store owner tampers with or reads the platform account.** | No grants on the `billing` schema (`billing_agreements.sql:37,273-277`). The platform account never appears in any store response. | DB | (a) | SR-18 catalog test, extended to `billing.platform_*` |
| T9 | **Blast radius when one scope is compromised.** | See table K2. Plus a **per-scope brake**: `max_payments` (global), with `max_payments_platform` and `max_payments_tenant` checked in SQL, so an incident in one scope does not stop the other. Hyp-side terminal permissions as narrow as Hyp allows (question Q-S4). | Flags + Hyp | (a) flags; (b) Hyp permissions | NEW-ENV-E1 (each brake blocks new attempts of its scope only; returns still verified) |

**K1. Key material: recommendation = ONE dedicated secret per environment (`PAYMENTS_SECRETS_KEY`), with separate HKDF labels per scope and mode. Not a second env secret.**

| | Separate HKDF labels (recommended) | Separate env secret for the platform |
|---|---|---|
| **Against a ciphertext swapped between scopes, tenants or modes** (the realistic DB-tamper threat) | Fully covered:<br>• HKDF `info = "v1|<env>|<scope>|<mode>|aes-256-gcm"`, salt `nuriel-payments`;<br>• AAD = `scope|tenant_id or "platform"|max|mode|account_id|field|kid`. | Covered only for scope; mode and tenant still need AAD |
| **Against an RCE, an env-file read or a container inspect** | Both scopes exposed | **Both exposed too**: same process, same compose `environment:` list (docker-compose passes an explicit list, `tests/unit/env-forwarding.test.ts:1-3`) |
| **Against a DB-only leak or backup** | Nothing exposed | Nothing exposed |
| **Operations** | One value to generate, back up and rotate per environment | Two values. Doubles the MX-19 risk (fixed or reused values) and the chance of setting both equal |
| **Future split** | The `kid` prefix lets a later rotation move the platform scope to its own secret, with no data migration | — |

Real isolation of the platform terminal would need a **separate process or host**, not a second variable in the same container: **(c)** for DEMO.

Hard rules (a):
- ≥ 32 characters;
- **no fallback**, unlike AI (`src/platform/ai/secrets.server.ts:65-75`) and login codes (`src/lib/login-code.functions.ts:42`), which fall back to `SUPABASE_SERVICE_ROLE_KEY`;
- the DEMO value ≠ the production value;
- the environment is part of the label, so a production ciphertext restored into DEMO can never decrypt.

The model to copy is the license helper:
- HKDF per purpose (`src/lib/license-crypto.server.ts:35-41`);
- AAD with tenant (`:43-45`);
- a format prefix (`:47-53`).

**Add** a key id (the license `v1:` is a format version, not a key id).

**K2. Blast radius per compromise**

| Compromised | What the attacker can do (from the documented API) | What limits it |
|---|---|---|
| The platform terminal's `KEY`/`PassP` | • `SIGN` pages that pay NURIEL.<br>• `VERIFY` as an oracle.<br>• `CancelTrans` / `zikoyAPI` on NURIEL's received payments. These refunds go to the original cards (docs: `TransId` = the original transaction), so they cost NURIEL money without enriching a third party, unless the attacker was the payer.<br>• With `zPass` and a token, `soft` payouts to **any** card (https://developers.hyp.co.il/pay/reference/actions, "Perform a payout"). | • Never request `zPass` or tokenization permissions.<br>• Ask Hyp to disable unused actions per terminal (Q-S4).<br>• Daily portal reconciliation.<br>• Rotation runbook. |
| One store's terminal credentials | The same, but only on that store's terminal. Platform and other stores are untouched: separate rows, AAD and HKDF scope, registry. | Same |
| `PAYMENTS_SECRETS_KEY` **and** a DB read | Every terminal of that **environment** (both scopes) | • Per-environment secrets, so a DEMO leak ≠ production.<br>• Rotation with `kid`.<br>• Owner-only access to the env file. |
| A platform-admin token | Without step-up: read status only. Cannot change credentials (host binding + step-up + `service_role`-only DB functions). | T7 |
| A store-owner token | Can open platform payments for his own store only. Cannot read the platform account. Future refunds need step-up (§3). | §3, §5 |

### 1b. DEMO mode: guaranteeing no real charge, and no live credentials in DEMO

**What Hyp documents (official pages, cached copies):**

| Fact | Quote | URL |
|---|---|---|
| Only the credentials make a transaction real | "The URL stays the same (`https://pay.hyp.co.il/p/`), but it will only process real transactions when you use your production credentials." | https://developers.hyp.co.il/pay/getting-started/testing-environments |
| The test card fails on production | "This also means that the test credit card will no longer work." | same |
| Test terminals have a prefix | "These terminals are easy to spot because their numbers always start with `00100`." | same |
| Test environment = no real card or transaction | "verify your payment flows without ever touching a real credit card or processing an actual transaction" | same |
| Separate terminal and portal per environment | "By default, you receive one terminal and one Hyp Portal account per environment." | https://developers.hyp.co.il/pay/getting-started/prerequisites-and-initial-setup |
| Some flows are production-only | "3DS is only available on production terminals." | https://developers.hyp.co.il/pay/advanced-features/3ds |
| Real card typed on a **test** terminal | **Not documented.** Question Q-S1 | — |
| An API-visible test/live indicator | **Not documented** (no SIGN/VERIFY field says test or live). Question Q-S2 | — |

**Refined DEMO definition** (refining the working definition):
1. **Credentials, not URLs, define DEMO.** DEMO = an instance that can hold and decrypt only `test`-mode accounts whose terminals Hyp issued for the test environment.
2. **DEMO-1** has no Hyp credential of any kind. It uses fake canaries generated per run, and the Hyp base URL points to the mock (override only under `NODE_ENV=test`).
3. **DEMO-2** runs from a separate stack, as in `docs/hospitality/staging-plan.md:5-14`:
   - its own DB and secrets;
   - basic auth;
   - an email catcher;
   - "no real payments".

   That plan is a **proposal**; whether staging exists is unknown (owner decision D-1).
4. **Only Hyp's published test cards are typed,** and the amount stays at or below the DEMO cap.
5. **At least 3 test terminals** (platform, store A, store B). The default is one per environment, so the extra two must be requested from Hyp.

**Layered guard (all (a) unless noted):**

| ID | Guard | Why it is not redundant | Test |
|---|---|---|---|
| G-1 | **`PAYMENTS_ENV` ∈ {`demo`, `production`}** is required. If absent or unknown, no SIGN and no VERIFY happen (in-flight returns → `needs_review`). It is **not** derived from `NODE_ENV`, which is `production` in every container (`Dockerfile:41`; `docker-compose.yml:31`). | The instance identity is explicit | NEW-ENV-U1 |
| G-2 | **DB instance marker**: a singleton `service_role`-only row, written as `demo` by the migration; promotion to `production` is a separate, owner-approved release step. The app refuses to start payments when G-1 ≠ G-2 (fail closed). | A restored or copied DB, or a wrong env file, is detected | NEW-ENV-S1 |
| G-3 | **A trigger on both account tables:** marker `demo` ⇒ reject `mode='live'`; marker `production` ⇒ reject `mode='test'` (production test accounts only if the owner decides otherwise, D-6). | The DB refuses even when the app is wrong | NEW-ENV-S2 |
| G-4 | **The environment, scope and mode are in the HKDF label and the AAD.** Flipping `mode` in a row, or restoring production ciphertext into DEMO, makes decryption fail. | It defeats DB tampering with `mode` | NEW-ENV-U2 (U10 extended) |
| G-5 | **Prefix tripwire** in both directions: `test` requires the prefix `00100`, and `live` forbids it (as in 06b `:47-49`). The save is blocked, but this is **never** treated as proof: the docs' own examples use sample terminals without the prefix (evidence 01 row "Shared public test terminal"). | It catches a pasted live terminal | D13 + NEW-ENV-U3 |
| G-6 | **DEMO amount cap:** `mode='test'` attempts ≤ ₪50 (CHECK in both attempt tables). Hyp suggests "around 10 ILS" (https://developers.hyp.co.il/pay/getting-started/testing-environments). | It bounds the worst case if every other layer failed | NEW-ENV-S3 |
| G-7 | **Kill switches:** `max_payments`, `max_payments_platform`, `max_payments_tenant` (DB, re-checked in SQL; the 15-s cache fails closed, `src/platform/feature-flags/flags.server.ts:5-29`), plus per-account `enabled`. Practised in DEMO-2. | Operational stop. Flags are **not** an environment guarantee: a platform admin can flip them | NEW-ENV-E1 |
| G-8 | **The Hyp endpoint is a constant.** The override hook is test-only and listed in `TEST_ONLY`, so it is never forwarded to a container (`tests/unit/env-forwarding.test.ts:14-20`). | It prevents a staging URL mix-up and SSRF | U15, SR-29 |
| G-9 | **CI egress:** E2E asserts every Hyp call hit the mock (`/__calls`) and that none went to the real host. | DEMO-1 can never touch Hyp | NEW-LEAK-X1 |
| G-10 | **Test-user allow-list (tenant scope)** at attempt-open and settle, as already planned (decision 13). It is kept in DEMO so the production gate is exercised. | Public test cards (MX-02) | SR-23, S3 |
| G-11 | **Master-secret sanity at startup:** refuse < 32 characters, a value equal to any other app secret, or a known E2E fixture (MX-19). | Weak DEMO keys | NEW-SEC-U1 |
| G-12 | **Provenance record:** the admin saving a `test` account records "issued by Hyp as a test terminal on <date>, ref <email/ticket id>" (no secret). The first DEMO-2 scenario is a published test card at ≤ ₪10. **A decline is a STOP sign**, since the test card "will no longer work" with production credentials. | Human evidence; not a technical control | D-run checklist |

**How to tell test from live, ranked by evidence strength:**
1. Hyp's written assignment of the terminal to the test environment. Per the docs, terminal numbers arrive by email per environment.
2. A published test card approves on that terminal.
3. The `00100` prefix (tripwire only).
4. The person copied the credentials from the **test** portal account (a separate login per environment).

No API field distinguishes test from live (Q-S2).

### 1c. Refunds from the order screen (threat delta; design in §3)

| Threat | Why it matters here |
|---|---|
| **NURIEL staff refunding store money** | `store_staff_role` = `owner` for platform admins in every store (live def), and `current_tenant_id()` lets a platform admin choose any tenant by header (live def, lines 35-43). A refund gate written as `staff_can('payments.refund')` would hand every NURIEL admin every store's refunds. |
| **Insider or friendly fraud** | Refunds go only to the original card (good), so the abuse is "refund my friend's order and still ship". The controls are owner-only rights, step-up, owner notification and velocity caps. |
| **A stolen token** | Tokens sit in localStorage (MX-14), and storefront scripts share the store origin with `/admin`. `/admin` is excluded from store marketing tags (`src/lib/marketing.ts:197-198`), but other storefront pages are not. Hence step-up bound to the action. |
| **A double credit on an unknown outcome** | `CancelTrans` times out, then we fall back to `zikoyAPI` and both succeed. Hyp Pay documents no lookup to resolve it. |
| **Credentials in URLs** | Both documented calls are GET requests with `PassP` in the query (§3). Every proxy, log or error that captures the URL leaks the terminal password. |
| **Invoice side effects** | Hyp issues documents automatically for refunds and cancellations when invoicing is on (§4), which clashes with SmartBee later. |

### 1d. Future SmartBee (threat delta; design in §4)

| Threat | Why it matters here |
|---|---|
| **Coupling** | A payment fails or rolls back because invoicing failed. |
| **Over-sharing** | Card fields, the Israeli ID, `Sign` or the raw return reach a third party. |
| **Credential sprawl** | Invoicing keys stored with payment keys. |
| **Duplicate tax documents** | From Hyp Invoice + SmartBee. |

### 1e. Platform purchases (threat delta; design in §5)

| Threat | Why it matters here |
|---|---|
| **Price tampering** | The amount must never come from the client. Today `addon_purchase` re-quotes in the DB; the platform terminal must keep that property. |
| **Paying, or activating against, another tenant's charge** | Multi-store owners and platform admins can address other tenants: a platform admin picks any tenant by header (`current_tenant_id`). |
| **Double activation** | Manual approval racing the provider settle. |
| **Provider rows without a uniqueness key** | `billing.ledger` has no unique `provider_ref` (live `pg_indexes`). |
| **Locked stores unable to pay renewals** | Renewal is needed exactly when the store is locked (expired). |
| **Over-exposure to the store owner** | The ledger mixes owner-visible fields with NURIEL-internal ones. |

---

## 2. DEMO-blocking controls with test IDs

**Rule.** Every row must pass in DEMO-1 (CI against the mock) **before** any DEMO-2 run against Hyp's test environment. Rows marked "DEMO-2" are manual and need the owner's written go-ahead.

**Test-ID sources:**
- U/S/C/E/X/D = evidence 07;
- SR-xx = the evidence 08 requirement each test proves;
- NEW-… = new.

**Note:** 07 still uses `payment_method='max'` and older table names. Tests must use the anchors: `online`, `max_attempt_mark_paid`, `platform_attempt_mark_paid`.

### 2.1 Environment guards (no real charge, no live credentials in DEMO)

| Control | Test | Pass criterion |
|---|---|---|
| G-1 `PAYMENTS_ENV` required, not from `NODE_ENV` | NEW-ENV-U1 | Unset or unknown → start and VERIFY both refuse, with a fixed message. `NODE_ENV=production` alone does nothing |
| G-2 DB instance marker = app env | NEW-ENV-S1 | Marker ≠ env → payment functions raise. The marker cannot be changed by `authenticated` or by any API function |
| G-3 No `live` account in a `demo` instance (both scopes); no `test` account in `production` | NEW-ENV-S2 | Insert/update with the wrong mode fails **for `service_role`** too |
| G-4 env + scope + mode in HKDF label and AAD | NEW-ENV-U2 (U10 ext.) | Flipping `mode`, `scope`, tenant or env in the AAD inputs → decrypt fails; a wrong `kid` fails; a tampered tag fails |
| G-5 Prefix tripwire | NEW-ENV-U3, D13 | `test` without `00100`, or `live` with it → save refused; the UI says "not proof" |
| G-6 Amount cap for `test` attempts | NEW-ENV-S3 | An attempt above ₪50 in `test` mode is refused in both attempt tables |
| G-7 Kill switches per scope | NEW-ENV-E1 | Each brake stops new attempts of its scope within ≤ 15 s; in-flight returns are still verified |
| G-8 Constant endpoint; test-only override | U15 / SR-29 | The override is listed in `TEST_ONLY` and absent from `docker-compose.yml` |
| G-9 CI cannot reach Hyp | NEW-LEAK-X1 | Every outbound Hyp request in E2E is recorded by the mock; zero requests reach the real host |
| G-10 Test-user allow-list (tenant scope) | SR-23 / S3 | A non-listed customer never sees or opens a test attempt; settle refuses one |
| G-11 Master-secret sanity | NEW-SEC-U1 | < 32 chars, equal to another app secret, or equal to an `e2e/scripts/app-up.sh` fixture → refuse to start payments |

### 2.2 Scope separation (platform vs tenant)

| Control | Test | Pass criterion |
|---|---|---|
| Separate tables; `billing.platform_payment_*` are closed to the API | NEW-SCOPE-S1, SR-18 | Catalog: no grants to `anon`/`authenticated`; no function body reads both `payment_provider_accounts` and `billing.platform_payment_accounts` |
| Scope in crypto | NEW-SCOPE-U1 | A platform ciphertext placed in a tenant row (or the reverse) fails to decrypt |
| Two disjoint settle functions | NEW-SCOPE-S2 | A platform `Order` sent to `max_attempt_mark_paid` → not found (and the reverse); `platform_attempt_mark_paid` never writes `orders` (catalog + trigger test) |
| Cross-scope terminal registry | NEW-SCOPE-S3 | The same terminal is refused in platform + tenant and in two tenants |
| Host-bound, exact, non-overlapping return paths | NEW-SCOPE-E1 | Each return on the wrong host type → 404 + `return_wrong_scope` event; mock `/__calls` shows 0 VERIFY |
| Platform credential functions: host + step-up + `service_role`-only DB | NEW-SCOPE-E2, SR-20/E8 | A platform-admin token from a store host → refused; a direct PostgREST call with an `authenticated` JWT → `permission denied`; no step-up → refused |
| Cross-terminal VERIFY must fail | **NEW-D-XTERM** (DEMO-2) | A genuine return from test terminal B, replayed against an attempt of terminal A with the same `Order`/`Amount`, gets VERIFY ≠ 0 **before** any live platform purchase. If VERIFY = 0: stop, ask Hyp, and keep platform activation in `needs_review` |

### 2.3 Settle gate and leak controls (carried from evidence 08; DEMO-2 exercises them)

| Control (08 ref) | Test | Note for DEMO |
|---|---|---|
| No card data (SR-01) | U11, X8, E10 | Also run on `billing.platform_payment_*` |
| Secrets stay on the server (SR-02) | U2, X1 | — |
| No credentials in URLs, errors or logs; one redactor (SR-03/04) | U9, U11, X2, X4 | The redactor also covers `zPass`, even though it is unused |
| The return never renders: 303, `no-store`, no 308 hop (SR-05/14) | U12, X9 | **Both** return paths |
| Amount from the DB; order frozen; exact match (SR-07/08/09) | S3, U7, U8 | Platform: amount = the open charge or quote at attempt-open (§5) |
| Exactly once; one live attempt (SR-10/11) | C1–C6, E5, D12 | Both scopes |
| Tenant binding; return reachable when the store is locked (SR-12/13) | E6, S4, SR-13 | Platform: NEW-PLAT-E1 |
| CSRF on start, settings and test (SR-15) | E9 | Including the platform start function on the store host |
| DB-backed VERIFY cap per attempt (SR-16) | X7 | Protects Hyp's **test** environment from floods too |
| Encryption (SR-17) | U10 | See G-4 |
| Write-only admin; privileges (SR-19/20) | E8 | — |
| Audit in the same transaction (SR-21) | S7 | **Credential entry in DEMO-2 must be auditable** |
| Late or duplicate payment → `needs_review` (SR-24) | S3, E7 | — |
| Emails only from settle, gated on `paid` (SR-25) | SR-25 unit test | — |
| Minimal PII in SIGN (SR-26) | U1 snapshot | + NEW-NEG-U2 |
| TLS, timeout, decide on `CCode` (SR-28) | U9 | — |
| No new npm package; no real credentials in the repo; bundle guard (SR-30/31/32) | B-diff, U18, X10, X1 | — |
| Fixed Hebrew messages per `CCode` (MX-15) | X5, E3 | — |
| Reconciliation view "redirected, never returned" (SR-33) | SR-33 SQL test | Needed in DEMO-2 for D5 (browser closed) |

### 2.4 Negative capabilities (prove what DEMO must not contain)

| Control | Test | Pass criterion |
|---|---|---|
| No refund, cancel, payout, token or payment-link code | **NEW-NEG-U1** (architecture) | `src/` contains none of `zikoyAPI`, `CancelTrans`, `zPass`, `getToken`, `payRequest`, `commitTrans`, or `action=soft`. Capability flags `refund/cancel` = `false` |
| No Hyp invoicing parameters in SIGN | **NEW-NEG-U2** (U1 ext.) | SIGN parameters never include `SendHesh`, `sendHeshSMS`, `Pritim`, `heshDesc` or `EZ.*` |
| No SmartBee or other invoicing dependency | NEW-NEG-U3 | No SmartBee env name, module or table; settle has no outbound call except Hyp VERIFY |

### 2.5 Platform-purchase controls (only if platform purchases are in DEMO scope; owner decision D-4)

| Control | Test | Pass criterion |
|---|---|---|
| Amount from the DB, never from the client | NEW-PLAT-S1 | The client sends only the item id + the displayed amount; a mismatch is refused (pattern `addon_purchase._expected`) |
| Only the owner of the host's store; only that store's charge | NEW-PLAT-S2 | A manager, a hospitality Business Admin or a cashier → refused; a charge of another tenant → refused; a platform admin acting as owner is logged as such |
| Exactly one activation | NEW-PLAT-C1 | Manual `platform_approve_addon` ∥ provider settle on the same request → exactly one activation, the other → `needs_review` |
| Provider ledger rows only from `platform_attempt_mark_paid` | NEW-PLAT-S3 | `billing.provider_write` is set by that function only (catalog grep); the provider ref is unique |
| A locked or expired store can still pay | NEW-PLAT-E1 | Start from `/admin` billing on a locked store (allowed, `src/lib/blocked-pages.ts:30-31`); the return on the platform host settles |
| The owner sees only his own items | NEW-PLAT-E2 | The response shape has no terminal, raw return, internal note or other tenant |

### 2.6 DEMO-2 manual additions to D1–D18 (evidence 07)

| ID | Scenario | Pass |
|---|---|---|
| D-P1 | Platform purchase, published test card, ≤ ₪10 | Activated only after VERIFY `CCode=0` and the match; one ledger row (`provider`) |
| D-P2 / D-P3 | Platform return replayed to a store host; store return replayed to the platform host | Not found, no VERIFY (logs/trace) |
| D-P4 | = NEW-D-XTERM | As above |
| D-P5 | Kill switch per scope practised mid-run | New attempts blocked, the in-flight return still verified |
| NEW-D-INV | With `MoreData=True`, record whether `Hesh` appears in the return and what the test portal's invoicing setting shows | Names/presence only; feeds D-5 |
| NEW-LEAK-D1 | The owner greps the DEMO logs for the real test `KEY`/`PassP` (D17) **and** for both scopes' terminal numbers outside the masked form | Counts only; all 0 |

## 3. Refund-security design (future: class (b); nothing built in DEMO)

**What Hyp documents** (official pages, cached copies):

| Fact | Quote (≤ 25 words) | URL |
|---|---|---|
| A refund is a new transaction | "a **refund creates a brand-new transaction** in the system that credits the customer's card." | https://developers.hyp.co.il/pay/common-use-cases/refunds |
| Partial refunds are allowed, bounded | "refund the **entire amount or just a portion of it**" … "you can't refund more than the original transaction's value." | same |
| Method | "To make a refund, send a GET request to `https://pay.hyp.co.il/p/`" (parameters `action=zikoyAPI`, `Masof`, `PassP`, `TransId`, `Amount`) | same |
| Only after transmission | "The original transaction must have been transmitted and settled." | https://developers.hyp.co.il/pay/reference/actions (`action=zikoyAPI`) |
| `zPass` is ambiguous | The payout table says `zPass` is "A secondary password specifically for payouts and refunds." The `zikoyAPI` parameter table does not list it. | https://developers.hyp.co.il/pay/reference/actions |
| Cancel deadline | "You can cancel a transaction up until 22:00 Israel time on the same business day it was made." | https://developers.hyp.co.il/pay/common-use-cases/cancellations |
| After transmission, no cancel | "If the transaction **has already been transmitted**, you can't cancel it anymore." | same |
| Cancel result | "the system returns `CCode=0` and `ReversalStatus=777`"; `CCode=920` "either because it was already transmitted or it doesn't exist" | same |
| Codes | `33` = "Amount exceeds the original transaction value." `902` = wrong `PassP`. | https://developers.hyp.co.il/pay/reference/actions |
| **Not documented** | • A transaction or refund lookup.<br>• Whether Hyp enforces the **cumulative** bound over several partial refunds.<br>• `zikoyAPI` on a not-yet-transmitted transaction, or on installments.<br>• Business-day and transmission times.<br>• POST support for these actions. | Questions Q-R1..Q-R6 |

**Design:**

| Topic | Design | Why |
|---|---|---|
| **Who (tenant scope)** | • **The store owner only** = the protected admin of **that** store: `user_roles.is_protected AND role='admin' AND NOT is_blocked` for the host tenant.<br>• **Not** `staff_can` / `store_staff_role`, because they make every platform admin `owner`.<br>• **Managers:** no, unless the owner grants a named per-manager right later (`payments.refund`, with a per-refund cap), on the hospitality `staff_grants` pattern.<br>• **Hospitality Business Admin:** no, because migration 188 excludes it from `billing.manage`/`ownership`, and a refund is a money operation.<br>• **Cashier, warehouse, agent:** never.<br>• **Platform admins:** **no** refunds on a store terminal (the store's money, requirement 1/3); support acts through the owner. | Separation; insider risk |
| **Who (platform scope)** | Platform admins holding a new named permission (e.g. `platform.payments.refund`; no tiers exist today). **Dual control:** a second, different platform admin approves every platform refund. | NURIEL's money; no tiers today |
| **Step-up** | A fresh proof **bound to the action**: either re-entering the password (verified server-side), or an email OTP whose HMAC covers `(purpose='refund', refund_request_id, amount_minor)`. Reuse the login-code primitives: HMAC with a server secret, 10-min TTL, 5 tries (`src/lib/login-code.functions.ts:3-16,20`), but with a **dedicated secret and no fallback** (that file falls back to `SUPABASE_SERVICE_ROLE_KEY` at `:42`). A token's age is not proof: tokens refresh and live in localStorage. | Stolen tokens (MX-14) |
| **Dual control above a threshold** | • **Tenant:** above an owner-set amount (default ₪1,000, or any refund > 50 % of the day's takings), a **15-minute cooling delay** with an email to the owner containing a cancel link. A second approver is optional when the store has one.<br>• **Platform:** always two people. | Small stores have one person |
| **Idempotency** | • Table `payment_refunds(id, scope, tenant_id, attempt_id, amount_minor, kind cancel/refund, state, idem_key, requested_by, approved_by, hyp_txn_id, ccode, …)`.<br>• `UNIQUE(attempt_id, idem_key)`.<br>• **At most one in-flight refund per paid attempt** (partial unique index).<br>• `UNIQUE(provider, terminal, hyp_txn_id)`.<br>• States: `requested → approved → sending → succeeded | failed | unknown`.<br>• `sending` is committed **before** the HTTP call. | Exactly once |
| **Partial-refund bounds** | • Under `FOR UPDATE` of the paid attempt: `amount > 0`, integer agorot, and `Σ(succeeded + sending + unknown) + new ≤ captured amount`. `unknown` counts as spent until resolved.<br>• Our own cumulative bound, whatever Hyp enforces (Q-R2). | Hyp's cumulative behaviour is undocumented |
| **Original transaction only** | • Input = `(attempt_id, amount, reason)` only. `TransId` comes from the paid attempt row, never from the client.<br>• `action=soft` payouts (they can credit **any** card with a token + `zPass`) are **permanently out of scope** without separate approval. | No redirect of funds |
| **Cancel vs refund** | • Same business day and before a safety margin (21:30 Israel time): `CancelTrans`, full amount only. It has no `Amount` parameter.<br>• **Only a definitive `CCode=920`** allows the automatic switch to `zikoyAPI` for the full amount.<br>• **A timeout, HTML or 5xx → `unknown`:** no retry and no switch, then manual reconciliation in the portal. The risk is a double credit if the cancel actually succeeded.<br>• **Same-day partial** → queued for the next business day, or manual (`zikoyAPI` needs a transmitted transaction).<br>• Installment transactions → manual until Hyp answers (Q-R4). | Hyp's same-day window; no lookup |
| **CSRF / origin** | POST server function behind `createCsrfMiddleware` (`src/start.ts:25-27`). The host tenant must equal the attempt's tenant. Platform refunds run on `isPlatformRequest()` only. | — |
| **Rate limits (DB-backed)** | Per store: ≤ 10 refunds/hour and ≤ an owner-set ₪ per day. Per attempt: ≤ 5 partial refunds. Per actor: ≤ 20/day. Not the in-memory limiter (`src/lib/rate-limit.server.ts:12-37`, per process). | MX-12 |
| **Audit** | • Append-only refund events written **in the same transaction** as each state change: actor, step-up method, approver, amounts, reason, `CCode`, the new Hyp `Id`. No secrets, no URLs.<br>• **An email to the store owner on every refund, including his own,** detects token theft.<br>• Platform scope: `platform_audit_log` through a DEFINER function, not the best-effort `recordPlatformAudit` (`src/lib/platform-files.server.ts:36-59`). | MX-11 |
| **Error handling** | `CCode` → fixed Hebrew text (33 "the amount is higher than the transaction"; 902 "terminal credentials"; 920 "already transmitted"). Never forward Hyp's body. A fresh `Error` with no `cause` (MX-08). | MX-08/15 |
| **Log redaction** | The documented calls put `PassP` in the **query string**, so: never log or throw the URL; use one redactor (`PassP`, `KEY`, `zPass`, `Masof`→last 2); use POST if Hyp confirms it (Q-R5). Proxy and nginx logs must not see outbound URLs (outbound goes direct over TLS). | Credentials in URLs |
| **Ledger / reporting** | **Tenant:** a refund is a payment event against the attempt, and the order shows "refunded ₪x of ₪y".<br>**Platform:** `billing.ledger` has no refund kind. `credit` reduces what is owed and `reversal` corrects errors (`billing_agreements.sql:148-149,180-185`), so add a `refund` kind linked to the payment row, with `Σ ≤ payment` (migration, (b)). | Requirement 4 |
| **Must stay manual until Hyp confirms** | • every `unknown` outcome;<br>• same-day partial refunds;<br>• installment transactions;<br>• duplicate-charge cases (`needs_review`);<br>• anything requiring `zPass` (Q-R1);<br>• anything while Hyp's invoicing module is on (credit documents are issued automatically, §4).<br>**Until then: refunds only in the Hyp portal; the order screen shows a "refund in Hyp portal" checklist and records the outcome manually (audited).** | — |
| **DEMO** | • (a) capability `refund:false, cancel:false` and NEW-NEG-U1.<br>• (b) after Hyp answers Q-R1..Q-R6: a separate DEMO-2b with an API refund probe **on a test terminal only**, with owner approval.<br>• (c) any refund call now. | Requirement 8 |

## 4. SmartBee boundary (future; nothing connected now)

**A finding first: Hyp Pay already contains an invoicing provider, and it is on by default.**

| Fact | Quote | URL |
|---|---|---|
| On by default | "Invoicing is enabled on your terminal by default." | https://developers.hyp.co.il/pay/invoicing/basic-invoicing |
| Automatic for every transaction | "Hyp Pay is designed to issue an invoice **automatically** for every successful transaction, including refunds, cancellations, and payouts." | same |
| Not emailed unless asked | "By default, Hyp Pay won't send the invoice to the customer automatically unless you explicitly tell it to." | same |
| Visible in the return | MoreData field `Hesh`: "The invoice number, if an invoice was generated." | https://developers.hyp.co.il/pay/reference/actions (MoreData table) |
| How to switch it off per terminal; behaviour on test terminals | **Not documented** (Q-S3) | — |

**Consequence.** If SmartBee becomes the document provider and Hyp Invoice stays on, every payment and refund gets **two** tax documents. This conflicts with requirements 6/7 and creates a tax-compliance risk.
- (a) In DEMO: send no invoicing parameters (NEW-NEG-U2), and **observe** whether documents are created on the test terminals (NEW-D-INV).
- (b) Before any live terminal: owner decision D-5 (switch Hyp Invoice off on all terminals vs keep it), confirmed with Hyp.

**Boundary design (class (b) unless noted):**

| Topic | Rule |
|---|---|
| **No dependency now (a)** | No SmartBee code, env names, tables or calls (NEW-NEG-U3). Settlement, return and refund code have **no** hook that waits on invoicing. |
| **Integration point (b)** | A **derived (pull) outbox**: a worker selects financial facts that have no document yet. The facts are the paid attempts of either scope, succeeded refunds, and `billing.ledger` provider payments. It writes `invoice_documents(fact_type, fact_id UNIQUE, provider, provider_doc_id UNIQUE, state, attempts, last_error_code)`. Settlement writes **nothing** for invoicing, so adding SmartBee later changes no payment code and no invoicing failure can roll back a payment. (A same-transaction outbox insert is the alternative, but it couples the transactions.) |
| **Failure isolation** | • The worker runs in its own process or job, with timeouts, exponential backoff, a dead-letter state and alerts.<br>• **A payment is never conditional on a document.**<br>• A document is never issued for a fact that is not `paid`/`succeeded`.<br>• A refund produces a credit document linked to the original document. |
| **Idempotency** | One document per fact (`UNIQUE(fact_type, fact_id)`). The provider-side idempotency key = the fact id, if SmartBee supports one (unknown: ask SmartBee later; no assumption here). |
| **Data minimization: may send** | • Document type;<br>• NURIEL's document/entry number;<br>• date;<br>• amount, VAT rate, net and VAT (from our DB);<br>• currency ILS;<br>• payment-method category ("credit card") and number of installments;<br>• payer name or business name;<br>• business number (B2B, when the law requires it; Hyp's own docs note it for documents over 5,000 ILS: `EZ.customer_crn`, https://developers.hyp.co.il/pay/invoicing/basic-invoicing);<br>• delivery email;<br>• line descriptions. |
| **Never send** | • Card number, CVV, expiry, BIN (`bincard`), tokens, `UID`;<br>• `Sign`, the raw return, `KEY`/`PassP`/`zPass`, terminal number;<br>• the Israeli ID (`UserId`) unless an accountant confirms it is legally required;<br>• IP addresses, internal notes, other customers' data.<br>Last 4 digits only if the owner and accountant decide a receipt needs them. |
| **Credentials** | • A separate secret class: table `invoicing_accounts`, its own HKDF label (`v1|<env>|invoicing|<scope>`), its own admin permission, and never in the payment account tables.<br>• **Scopes mirror payments:** NURIEL's own account issues platform documents to store owners. Each store's documents to its customers would use the store's own account. Never cross.<br>• Per-environment: DEMO uses a SmartBee sandbox, or nothing. |
| **Platform vs tenant** | Platform documents are NURIEL's: the seller profile in `billing.settings` (`billing_agreements.sql:43-55`). Store documents belong to the store (its own VAT settings). Never issue a store's document from NURIEL's account. |
| **No in-house invoicing (requirement 7)** | NURIEL keeps financial facts (attempts, ledger), not tax documents. It shows "document pending / issued by <provider> #n" only. |

## 5. Platform-purchase security (store owners paying NURIEL's terminal)

### 5.1 What exists today (verified)

| Item | Fact | Evidence |
|---|---|---|
| **Platform billing is manual** | `billing.add_entry` hard-codes `confirmation='manual'` | `20261114100000_billing_agreements.sql:867` |
| | Add-on "purchase" = a **request**: the add-on is set to `pending`, and a platform admin activates it after collecting payment | `src/lib/addons.functions.ts:69-73`; live `addon_purchase` inserts `tenant_addons.status='pending'` + `billing_history.payment_status='due'` |
| | AI activation requires the admin to confirm payment | `src/platform/ai/admin.server.ts:59-61` |
| **Ledger: append-only** | `billing.guard` raises on DELETE/TRUNCATE (`:211-213`) and on UPDATE of the ledger (`:231-232`). Triggers `guard` + `no_truncate` (`:254-267`); live `tgenabled='O'` | migration 189 |
| **Ledger: provider rows gated** | `confirmation`/`source='provider'` only when the GUC `billing.provider_write='on'` (`:222-227`). `CHECK (confirmation <> 'provider' OR provider_ref IS NOT NULL)` (`:190`) | migration 189 + live `pg_constraint` |
| **Ledger: shape** | • `amount > 0 AND ≤ 1,000,000` (`:154`);<br>• `currency='ILS'` (`:160`);<br>• `method` only on payment/reversal (`:191`);<br>• `reverses_id UNIQUE` + `(kind='reversal') = (reverses_id IS NOT NULL)` (`:181,185`);<br>• no FK to tenants, so records survive deletion (`:30`) | live `pg_constraint` (all present) |
| **Ledger: grants** | No direct access; `service_role` SELECT only (`:270-279`; live `has_table_privilege`: `anon`/`authenticated` none, `service_role` SELECT only) | — |
| **Gaps for provider payments** | • **No UNIQUE on `provider_ref`** (live `pg_indexes`: only `entry_no`, `legacy_ref`, `reverses_id`, `pkey`), so the same Hyp transaction could be booked twice.<br>• **No `refund` kind.**<br>• The GUC gate stops *callers*, not *functions*: any future DEFINER function can set it. | — |
| **Two record systems** | Subscriptions/setup use `billing.ledger`. Add-ons use the legacy `public.billing_history` + `tenant_addons` (`platform_approve_addon` marks `billing_history` paid). | live defs |
| **Owner gate (DB)** | `billing.owner_tenant()` = `current_tenant_id()` + `staff_can('billing.manage')` (ecommerce) / `hospitality.can('billing.manage')` (`:661-679`). Server: `ownerRpc` on the store host only (`src/platform/billing/billing.server.ts:50-55`). | — |
| **Platform gate** | DB `billing.require_platform_admin()` (`:652-658`). Server `platformRpc` requires `isPlatformHost()` (`billing.server.ts:57-62`). **But** the legacy add-on and billing server functions (`src/lib/addons.functions.ts:114-218`, `src/lib/billing.functions.ts:101-150`) have **no** host binding (MX-14 class). | — |
| **Add-on DB guards** | • Trigger `tenant_addons_owner_only` → `require_store_owner_billing()` (`staff_can('billing.manage')`).<br>• `tenant_addons_activation_guard`: only a platform admin **or `auth.uid() IS NULL`** (`service_role`) may set `active`.<br>• `platform_approve_addon` locks the row `FOR UPDATE` and requires `status='pending'`. | live triggers/defs |
| **Prices** | `platform_plans` / `platform_addons`: `anon`/`authenticated` SELECT only (live `has_table_privilege`). `addon_purchase` re-quotes in the DB and refuses when `abs(_expected - amount) > 0.01` (live def). | — |

### 5.2 Threats and controls

| Threat | Control | Class | Test |
|---|---|---|---|
| **Price tampering** | • `platform_attempt_open` takes only an item reference: an open `billing.ledger` charge, a renewal quote, or a pending add-on request. It computes the amount in the DB (agreement/catalog/`addon_quote_for`) and snapshots it in integer agorot.<br>• The client may send the displayed amount only to detect a change.<br>• Settle requires Hyp `Amount` = the attempt amount = the item's **current** outstanding amount. If the admin recorded a manual payment meanwhile → `needs_review` (duplicate). | (a) | NEW-PLAT-S1 |
| **Paying, or activating, another tenant's item** | • The tenant comes from `billing.owner_tenant()` (host + membership), never from input. The item must belong to that tenant.<br>• Settle activates only `attempt.tenant_id`'s item (from the attempt row, never from the return).<br>• Multi-store owners: the item must belong to the **host's** store. | (a) | NEW-PLAT-S2 |
| **Who may pay** | Store owner only (`billing.manage`). Managers, hospitality Business Admin and staff are refused (migration 188 excludes Business Admin from `billing.manage`). A platform admin passes `owner_tenant()` everywhere (`store_staff_role` = owner, `current_tenant_id` honours his header): allow it, but log `actor_is_platform_admin=true` (D-7). | (a) | NEW-PLAT-S2 |
| **Double activation** | • A single internal routine `activate_paid_item(item, attempt)` is used by **both** the manual `platform_approve_addon` / `platform_billing_renew` path and `platform_attempt_mark_paid`. It runs under `FOR UPDATE` and accepts only `pending` → `active` once.<br>• Manual approval refuses an item with a `redirected`/`returned`/`paid` attempt.<br>• A second genuine payment → `needs_review` + the refund runbook.<br>• Renewal reuses `_expected_renewal` (`billing_agreements.sql:1135-1138`) snapshotted in the attempt. | (a) if purchases are in DEMO | NEW-PLAT-C1 |
| **Duplicate ledger booking** | • Partial unique index on `billing.ledger(provider_ref) WHERE confirmation='provider'` (`provider_ref = 'max:<terminal>:<Id>'`), plus `UNIQUE(provider, terminal, provider_txn_id)` on platform attempts.<br>• `billing.provider_write` is set **only** inside `platform_attempt_mark_paid` (catalog test). | (a) | NEW-PLAT-S3 |
| **Cross-terminal self-payment** | T3/NEW-D-XTERM. Until passed and confirmed by Hyp: activation stays `needs_review` + a portal check. | (a) test | NEW-D-XTERM |
| **Locked or expired store cannot renew** | Start runs from `/admin` (allowed on locked stores, `src/lib/blocked-pages.ts:30-31`) through `/_serverFn` (passes `storeGate`, `src/server.ts:81`). The return is on the platform host (`storeGate` skipped, `:72`). No `requireStoreOpen` on platform start; whether NURIEL takes payments on Shabbat is D-8. | (a) | NEW-PLAT-E1 |
| **After the return: open redirect** | The platform return 303s to `originForTenant(attempt.tenant) + '/admin?tab=billing'` built from the DB, or to a neutral platform result page. Never a parameter. | (a) | U12 (both paths) |
| **The store owner sees too much** | • Owner view = `billing.summary(_, false)`: it already hides `reference`, `internal_note`, `recorded_by_email`, `legacy_ref`, and reversal rows (`:620-635`). `provider_ref` is not exposed at all.<br>• For attempts: show the status, amount, item and date. Never the platform terminal, the raw return, `ACode` or `Sign`.<br>• Showing the Hyp `Id` to the payer is D-7 (default: platform admins only). | (a) | NEW-PLAT-E2 |
| **Platform-host surface** | The public GET return on `PLATFORM_ADMIN_HOST` is handled in `src/server.ts` before the app (no admin SSR). GET only, size caps, DB rate limit, `no-store`, `no-referrer`. nginx logs that location without the query. **Not** on the portal tenant `nuriel-app2` (`src/lib/portal.ts:9`), because that is a tenant. | (a) | NEW-SCOPE-E1, X9 |
| **Store-side side effects** | The platform settle sends no store emails and touches no store order. NURIEL's own notification goes to platform admins. | (a) | NEW-SCOPE-S2 |
| **DEMO scope** | Start with **one** item type (D-4). Recommendation: add-on purchase (it already has a pending state and an approval path) or a ledger `charge`. Not renewals of `trial` stores. | — | — |

## 6. Secrets handling for DEMO

### 6.1 Where things live

| Secret | DEMO-1 (CI/local) | DEMO-2 (non-production instance) | Never |
|---|---|---|---|
| `PAYMENTS_SECRETS_KEY` | A random value generated **per run**, at run time. Not added as a fixed value to `e2e/scripts/app-up.sh`, which already holds fixed E2E secrets (MX-19) | Generated **on the DEMO host** (≥ 32 chars, e.g. 64 hex). Kept only in that stack's server-side env file. Forwarded through the explicit `docker-compose.yml` list (the env-forwarding test enforces it). **Different from production** | git, committed env files, CI secrets, chat or agent sessions, tickets, screenshots, logs |
| Hyp test terminal: `Masof`/`KEY`/`PassP`, for **each** test terminal (platform + store A + store B) | **None.** Fake canaries only; the mock accepts anything | Typed by the owner (or a named platform admin) into the **write-only** admin screen of the DEMO instance: platform terminal on the DEMO platform host, store terminals in the store's MAX tab. Encrypted at once (G-4) and stored only in that DB. Audited without values (SR-21) | Same list. Also never via SQL by a developer, and never in the Hyp portal screenshots used as evidence |
| Hyp portal logins | — | Owner only | Anywhere in NURIEL |
| `zPass` | — | **Not requested** | — |
| SmartBee keys | — | **None** (no dependency) | — |

Rules:
- **Test credentials are secrets.** With them anyone can sign pages, run VERIFY and (if allowed) cancel on our test terminal.
- **After DEMO:** wipe the ciphertext (disable + clear) before the staging stack is removed. Ask Hyp to rotate a test `PassP` if it ever appeared anywhere outside the admin form.
- **The CI workflow states it holds no secrets** (`.github/workflows/tests.yml:1-6`). Keep it that way: no GitHub secret for Hyp, not even for the test terminal.

### 6.2 Leak scans: exactly what to look for

**Canary set (per run):**
- the master secret;
- fake `KEY` and `PassP`;
- the fake terminal numbers (10 digits);
- a fake `Sign`;
- a sentinel customer email and phone.

Each scan must also find a deliberately planted canary in a fixture (positive control).

| Surface | When | Search for | Pass |
|---|---|---|---|
| **Client bundle** `.output/public/**` (X1, extended) | After every CI build and every DEMO build | • Every canary.<br>• Literals: `PassP`, `zPass`, `APISign`, `What=VERIFY`, `What=SIGN`, `zikoyAPI`, `CancelTrans`, `PAYMENTS_SECRETS_KEY`, `PAYMENTS_ENV`, `payment_provider_accounts`, `platform_payment_accounts`, `payment_terminal_registry`, `api_key_enc`, `api_password_enc`.<br>• Regex `(KEY|PassP)=[^&"'\s]`.<br>• Any **new** `*.server-*.js` chunk compared with the current baseline of 17 (MX-09) | 0 hits; the chunk list is unchanged |
| **Server logs**: the E2E server log (X2) and DEMO-2 `docker logs` (json-file driver) | After E2E; after each DEMO-2 session | • Canaries.<br>• `(KEY|PassP|zPass)=` followed by anything but the redaction mask.<br>• `Sign=[0-9A-Fa-f]{20,}`, `signature=`.<br>• Any `pay.hyp.co.il/p/?` URL.<br>• A line with both `CCode=` and `Order=` (raw return).<br>• `UserId=\d`, `L4digit=`, `Tmonth=`, `Tyear=`, `bincard=`, `cell=`.<br>• Luhn-valid 13–19-digit runs.<br>• The run's full 10-digit terminal numbers (only the last 2 may appear) | 0 (DEMO-2: the owner reports counts only, NEW-LEAK-D1) |
| **nginx access logs** (DEMO-2) | After DEMO-2 | • Requests to `/payments/return/max` and `/payments/platform-return/max` that carry a query (`?Id=` / `CCode=`) | 0 |
| **Database** (X3/E10, extended) | End of E2E; end of DEMO-2 | Every text/jsonb column of:<br>• the `payment_*` tables;<br>• `billing.*` (incl. `billing.platform_payment_*`, `ledger.description/reference/internal_note`);<br>• `platform_audit_log`, `payment_events`;<br>• the email/notification logs.<br>Look for:<br>• canaries; `PassP`, `KEY=`, `zPass`, `Sign=`, `signature=`; Luhn-valid 13–19-digit runs; JSON keys `Tmonth|Tyear|bincard|UserId|cell`;<br>• ciphertext columns that do not match the `v<kid>:` format;<br>• terminal numbers outside the `terminal_number` columns | 0 |
| **Browser** (E10) | E2E | • `localStorage`, `sessionStorage`, cookies, page HTML and `/_serverFn` bodies: canaries, `PassP`, `KEY`, `Sign` | 0 |
| **CI artifacts** (NEW-LEAK-X2) | Before upload: `playwright-report`, `test-results` are uploaded on failure (`tests.yml:113-121`) | Canaries | 0; otherwise fail and do not upload |
| **Git** (U18/X10, extended) | Every PR; before any push of payments code; history scan once before DEMO-2 | • 10-digit numbers starting `00100` other than declared fakes.<br>• `(KEY|PassP|zPass)=` with a non-placeholder value.<br>• Luhn-valid 13–19-digit numbers outside declared fixtures.<br>• High-entropy strings (≥ 20 chars) within 40 characters of `masof|terminal|passp|zpass|api.?key|secret|מסוף|סיסמ`.<br>• Added `.env*` (other than examples), `*.pem`, `*.key`.<br>• The 28 pattern kinds of 08 §5.1.<br>• Docs and evidence: no test-card rows, no sample terminal numbers | 0 new hits |
| **Excluded file** | Owner | `docs/seo-engine/ISTORES-COMPARISON.md:36` (MX-20). Not read by me | Owner confirms |

## 7. MX carry-over classification

**Classes:**
- **DEMO-blocking** = must be in place before DEMO-2 (and tested in DEMO-1);
- **Prod-blocking** = may be absent in DEMO, but must be built and verified before any live terminal;
- **Later** = not needed for MAX go-live, or belongs to the Grow retirement.

| ID | Class | One line |
|---|---|---|
| MX-01 amount drift | **DEMO-blocking** (MAX part); Grow/Bit part **Later** (decision 6) | The freeze trigger + settle against the current `order_amount_due` are part of the settle gate that DEMO-2 exercises (SR-08, S3). |
| MX-02 test payment → real order paid | **DEMO-blocking** | `mode` on accounts and attempts + G-1..G-6 + allow-list are the DEMO guard itself. The production policy for test accounts is decision D-6. |
| MX-03 no provider confirmation / non-unique txn | **DEMO-blocking** | VERIFY before settle and `UNIQUE(provider, terminal, txn)` in **both** scopes. |
| MX-04 superseded pages settle / double charge | **DEMO-blocking** | Attempt reuse, current-attempt-only and duplicate → `needs_review` are tested in D12/C4. |
| MX-05 `storeGate` and the rest window block the return | **DEMO-blocking** | Tenant return before `storeGate`. Platform return on the platform host (`storeGate` returns early, `src/server.ts:72`). NEW-PLAT-E1 covers locked stores paying renewals. |
| MX-06 PII/`Sign` to GA4, Meta, nginx, cacheable 308 | 303/no-store/no-308 hop: **DEMO-blocking**; marketing lists + nginx log format: **Prod-blocking** (verified in DEMO-2) | The server-side part protects VERIFY's raw query (R3). The rest is low-harm on a basic-auth staging instance. |
| MX-07 misleading "paid online" staff email | MAX: **DEMO-blocking**; Grow: **Later** (Grow retirement) | MAX emails only from settle, gated on `paid` (SR-25). |
| MX-08 stack/cause to browser; unredacted logs | **DEMO-blocking** for payment functions; global middleware **Later** | DEMO-2 handles real **test** credentials, which must not reach the browser or logs. |
| MX-09 `client.files` replaces `**/*.server.*` | **DEMO-blocking** | Re-verified: `vite.config.ts:28-31`; `pick = (user, fallback) => user ? [...user] : [...fallback]` (`…/import-protection-plugin/plugin.js:780,784`); default `["**/*.server.*"]` (`…/import-protection/defaults.js:17`). Payment code goes under `**/server/**`, or the default is restored + X1. |
| MX-10 Grow crypto without HKDF/AAD; AI fallback | MAX crypto: **DEMO-blocking** (G-4, K1); Grow/AI: **Later** | Re-verified the AI fallback (`src/platform/ai/secrets.server.ts:65-75`). Same pattern in login codes (`src/lib/login-code.functions.ts:42`). |
| MX-11 best-effort audit; DELETE allowed | Payment config audit in the same transaction: **DEMO-blocking**; DELETE block on `platform_audit_log`: **Prod-blocking** | **Correction to 08:** there is **no** cascade (live: no FK on `platform_audit_log`; the independent review L4 agrees). The rest holds: `recordPlatformAudit` swallows errors (`src/lib/platform-files.server.ts:36-59`); `service_role` has DELETE (live `has_table_privilege`); the trigger blocks UPDATE only. |
| MX-12 in-memory rate limits | DB VERIFY cap per attempt: **DEMO-blocking**; DB IP limits: **Prod-blocking** | Re-verified `src/lib/rate-limit.server.ts:10-37` (a per-process `Map`). |
| MX-13 order UUID as bearer capability | **Prod-blocking** (built in DEMO, verified in DEMO-2) | Platform purchases are authenticated (owner), so this applies to the tenant guest flow only. |
| MX-14 platform-admin functions without host binding | New platform-terminal functions: **DEMO-blocking** (T7); existing add-on/legacy billing functions that MAX settles: **Prod-blocking**; Grow functions: **Later** | `src/platform/billing` already binds (`billing.server.ts:57-62`); `src/lib/addons.functions.ts` and `src/lib/billing.functions.ts` do not. |
| MX-15 provider error text exposed | **DEMO-blocking** | Fixed `CCode` → Hebrew text (X5). Cheap. |
| MX-16 CSP `form-action 'self'`, `payment=()` | **DEMO-blocking constraint** (no change) | The jump to Hyp is a GET `location.assign` from the **store** host, for both scopes. |
| MX-17 old Hyp code anti-patterns | **DEMO-blocking review rule** | No plaintext credentials, nothing in `site_settings`, no credentials in logged URLs. |
| MX-18 CSRF OK | **DEMO-blocking (keep + test)** | Re-verified `src/start.ts:25-27,32` and `createCsrfMiddleware.js:16-35` (Sec-Fetch-Site → Origin → Referer; none → refused). |
| MX-19 fixed E2E secrets; partial default-secret check | Payments part: **DEMO-blocking** (G-11, per-run canaries); deploy-check extension: **Prod-blocking** | — |
| MX-20 `ISTORES-COMPARISON.md:36` unassessed | **Prod-blocking** (owner check before any live terminal) | If it holds real MAX credentials, rotate them with MAX first. It does not block test-terminal work. |

## 8. Open risks and owner decisions

### 8.1 Owner decisions

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| D-1 | Which non-production instance runs DEMO-2 | The separate stack of `docs/hospitality/staging-plan.md` (own DB and secrets, basic auth, email catcher, no production data). Status unknown: approve it or build it | DEMO-2 |
| D-2 | Test terminals | Ask Hyp for **3** test terminals (platform, store A, store B), with written confirmation that they are test-environment terminals. The default is one per environment | DEMO-2, NEW-D-XTERM |
| D-3 | NURIEL's own store vs the platform terminal | Two different terminals. If NURIEL's store (the default tenant) sells online, it gets a **store** terminal; the platform terminal is never a tenant terminal (registry) | Design |
| D-4 | Which platform purchase goes into DEMO first | One item type: an add-on request or a `billing.ledger` charge. Renewals later | Scope |
| D-5 | Hyp's built-in invoicing | Before any live terminal: switch it off on every terminal if SmartBee will issue documents (confirm with Hyp). In DEMO: observe only | Prod |
| D-6 | Test accounts in production | Refuse (G-3). Smoke tests stay in DEMO | Prod |
| D-7 | Platform admin paying as a store owner; showing the Hyp `Id` to the payer | Allow and log; the `Id` is for platform admins only | Design |
| D-8 | Platform payments on Shabbat/holidays | The owner's policy. Default: the store's rest window does not apply | Design |
| D-9 | Who edits the platform terminal | DEMO: all platform admins + host binding + step-up. Before production: a named list (new small permission table, migration needs approval) | Prod |
| D-10 | Refund policy (future) | Store owner only. No platform-admin refunds on store terminals. Tenant cooling delay above ₪1,000 (proposal). Platform: always two admins | Phase after DEMO |
| D-11 | Platform return host | `PLATFORM_ADMIN_HOST`, exact path `/payments/platform-return/max`. Alternative: a dedicated public billing host. Never the portal tenant | DEMO-2 |
| D-12 | Key material | One `PAYMENTS_SECRETS_KEY` per environment + HKDF scope/mode/env labels (K1) | DEMO-1 |
| D-13 | DEMO amount cap | ₪50 (G-6) | DEMO-1 |

### 8.2 Open risks

| # | Risk | Severity now | Handling |
|---|---|---|---|
| R-S1 | **VERIFY may not be bound to the terminal** (T3: merchant self-payment against platform or other-store attempts) | High until tested | NEW-D-XTERM + Q-S5. Until then platform activation = `needs_review` + a portal check |
| R-S2 | **Duplicate tax documents** (Hyp Invoice is on by default + SmartBee later) | Medium (legal) | D-5, Q-S3, NEW-D-INV |
| R-S3 | **Platform-admin "godMode" in every store** used for money moves | High if refunds are built on `staff_can` | §3 "Who": an explicit protected-owner check |
| R-S4 | **Credentials in GET URLs** (documented VERIFY, refund, cancel) | Medium | No URL logging or throwing; Q7 / Q-R5 (POST) |
| R-S5 | **Unknown refund/cancel outcome**, with no documented lookup | Medium | `unknown` state; manual only (Q-R6) |
| R-S6 | **Ledger gaps:** no unique `provider_ref`, no `refund` kind | Medium | Migration (needs approval) before live platform payments |
| R-S7 | **Two record systems for add-ons** (`billing_history` vs `billing.ledger`) | Medium | One activation routine (§5); decide which record is authoritative for provider payments |
| R-S8 | **Paid but never returned, in the platform scope.** A locked store whose owner paid but whose browser never returned **stays locked** | Medium (customer impact) | A reconciliation queue for platform admins (SR-33 for the platform), a "payment pending verification" state, daily portal check |
| R-S9 | **Legacy platform functions without host binding** (`src/lib/addons.functions.ts`, `src/lib/billing.functions.ts`) | Low–Medium | MX-14 plan; at least for the functions that MAX settles |
| R-S10 | **DEMO env + DB compromise exposes every test terminal** | Low (test only) | Per-environment secret; wipe after DEMO; rotate at Hyp if exposed |

### 8.3 New questions for Hyp

These come in addition to Q1–Q10 of the main report §1.6. All are **not documented** on developers.hyp.co.il as read in the cached copies.

| # | Question | Blocks |
|---|---|---|
| Q-S1 | If a **real** card is typed into a **test** terminal's page, can it ever be charged? | DEMO-2 safety statement |
| Q-S2 | Is there an API-visible test/live indicator? Is "always start with `00100`" exact for every test terminal? | G-5 strength |
| Q-S3 | How is Hyp Invoice switched off per terminal? Do test terminals issue documents? Are credit documents issued for `zikoyAPI`/`CancelTrans`? | D-5 |
| Q-S4 | Can API actions be disabled per terminal (`CancelTrans`, `zikoyAPI`, `soft`, `getToken`, `payRequest`)? | Blast radius |
| Q-S5 | Does VERIFY with terminal A's `KEY`/`PassP` ever return `CCode=0` for a transaction of terminal B (same `Order`/`Amount`)? Is `Sign` keyed per terminal? | R-S1 |
| Q-S6 | Three test terminals in one test environment? | D-2 |
| Q-R1 | Is `zPass` required for `zikoyAPI`? | Refunds |
| Q-R2 | Is the "not more than the original" bound cumulative over several partial refunds? | Refunds |
| Q-R3 | `zikoyAPI` on a not-yet-transmitted transaction: error or success? Can a same-day partial refund be done? | Refunds |
| Q-R4 | How are installment transactions cancelled or refunded (fully, partially)? | Refunds |
| Q-R5 | Do `zikoyAPI`/`CancelTrans` accept POST? | R-S4 |
| Q-R6 | How are "business day" and transmission time defined (Shabbat, holidays)? Is there any way to confirm a refund/cancel whose response was lost? | R-S5 |

## 9. Claims verified directly

### 9.1 Code (read at file:line in this worktree)

| Claim | Evidence |
|---|---|
| CSRF covers server functions only, and refuses requests without origin headers | `src/start.ts:25-27,32`; `node_modules/@tanstack/start-client-core/dist/esm/createCsrfMiddleware.js:16-35` |
| `storeGate`:<br>• returns early on the platform host;<br>• blocks `/platform` on store hosts;<br>• a locked store still passes `SUSPENDED_ALLOWED_PATHS` and `/_serverFn`;<br>• every host is resolved to a tenant | `src/server.ts:71-89` (`:72`, `:74-76`, `:81`); resolution `:181`; gate `:222-226`; `src/lib/blocked-pages.ts:30-31` |
| `isPlatformRequest()` is an exact host compare; `currentSite()` is `null` on the platform host | `src/integrations/supabase/tenant.server.ts:232-235`; `src/platform/tenancy/current-site.server.ts:6-13` |
| Rate limiter is an in-memory, per-process `Map` | `src/lib/rate-limit.server.ts:10-37` |
| License HKDF/AAD model; its `v1:` is a format version, not a key id | `src/lib/license-crypto.server.ts:20-67` |
| AI secret falls back to the service-role key; so do login codes | `src/platform/ai/secrets.server.ts:65-75`; `src/lib/login-code.functions.ts:42` |
| Platform audit is best-effort | `src/lib/platform-files.server.ts:36-59` |
| MX-09 override | `vite.config.ts:28-31`; `node_modules/@tanstack/start-plugin-core/dist/esm/vite/import-protection-plugin/plugin.js:780,784`; `…/import-protection/defaults.js:17` |
| Billing server wrappers:<br>• owner calls on the store host;<br>• platform calls require the platform host | `src/platform/billing/billing.server.ts:50-62`; `src/platform/billing/billing.functions.ts:41-155` |
| Legacy add-on and billing platform functions: auth only, no host binding | `src/lib/addons.functions.ts:114-218`; `src/lib/billing.functions.ts:101-150` |
| Add-on purchase = a pending request | `src/lib/addons.functions.ts:69-107` |
| AI admin pattern: host + session + admin check, then `service_role` functions | `src/platform/ai/admin.server.ts:45-61` |
| Business Admin is hospitality-only and excluded from `billing.manage`/`ownership` | `supabase/migrations/20261113100000_hosp_business_admin.sql:2-8,53-81` |
| Billing schema, ledger, guards, grants, owner/platform gates, `add_entry` = manual | `supabase/migrations/20261114100000_billing_agreements.sql:35-38,142-192,206-279,652-679,834-872,1057-1133,1340-1359` |
| Store permissions list: there is no refund permission | `src/lib/permissions.ts:19-35` |
| Staff orders are forced offline | `supabase/migrations/20261019360000_remove_hyp.sql:67-69` |
| `NODE_ENV=production` in the image and in compose | `Dockerfile:41`; `docker-compose.yml:31` |
| Explicit env forwarding; `TEST_ONLY` hooks | `tests/unit/env-forwarding.test.ts:1-3,14-20` |
| CI: no secrets; artifacts uploaded on failure | `.github/workflows/tests.yml:1-6,113-121` |
| Logs use the json-file driver | `docker-compose.yml:102-105` |
| `/admin` is excluded from marketing tags | `src/lib/marketing.ts:197-198` |
| Feature-flag cache: 15 s, fails closed | `src/platform/feature-flags/flags.server.ts:5-29` |
| The portal is a tenant | `src/lib/portal.ts:9` |
| 06b one-table terminal uniqueness and prefix CHECK | `docs/payment-gateways/evidence/06b-proposed-ddl.sql.txt:47-49,57-59` |

### 9.2 Database: read-only `SELECT`s on the local `shop_test`

| What was read | Result |
|---|---|
| `pg_get_functiondef` of `is_platform_admin`, `is_admin`, `is_super_admin`, `store_staff_role`, `staff_can`, `is_staff` | Platform admin = **owner in every store**; "super admin" = store admin; managers get everything but `billing.manage`/`staff.managers` |
| `\d public.platform_admins` | Only `user_id`, `created_at`: no tiers |
| `current_tenant_id()` | A platform admin picks any tenant by header; with no header it falls back to the default store |
| `tenant_for_host()` | Falls back to the default store |
| `platform_reserved_slugs()` | Includes `admin`, `platform`, `nuriel`, `staging` |
| `billing.ledger`: `pg_constraint` + `pg_indexes` | All the constraints cited in §5 exist; **no unique `provider_ref`** |
| `billing` tables: `has_table_privilege` | `anon`/`authenticated`: none; `service_role`: SELECT only |
| Ledger triggers | `guard` and `no_truncate` enabled |
| `pg_get_functiondef` of `addon_purchase`, `platform_approve_addon`, `require_store_owner_billing`, `tenant_addons_activation_guard` + their triggers | Guards as described in §5 |
| `pg_proc.proacl` | `ai_admin_*` → postgres + `service_role` only; add-on/platform functions → `authenticated` |
| `platform_audit_log` | No FK (so no cascade: correction to 08 MX-11); UPDATE trigger only; `service_role` has DELETE |
| `pg_default_acl` | New `public` tables, functions and sequences get ALL for `anon`/`authenticated`. Hence the recommendation to put platform-scope objects in the API-closed `billing` schema |

### 9.3 Hyp: official pages, read from the session's cached copies

The pages read:
- `testing-environments`;
- `prerequisites-and-initial-setup`;
- `creating-a-payment-page`;
- `transaction-validation`;
- `refunds`;
- `cancellations`;
- `reference/actions` (`zikoyAPI`, `CancelTrans`, payout/`zPass`, MoreData table incl. `Hesh`);
- `invoicing/basic-invoicing`;
- `advanced-features/3ds`.

All are under https://developers.hyp.co.il/pay/. The quotes in §1b, §3 and §4 were matched against those copies; secrets in the examples were masked while reading.

**Live re-fetch failed:** the `developers.hyp.co.il` DNS lookup is not allowed in this session.

### 9.4 Not verified

- Any Hyp behaviour: no request was sent.
- Whether staging exists.
- The production nginx, Coolify or GoTrue configuration.
- SmartBee (out of scope by instruction).
- The excluded files.
- The JWT claim set for step-up: I did not decode session tokens.
- Test files and the DDL were not executed: all tests named here are designs.

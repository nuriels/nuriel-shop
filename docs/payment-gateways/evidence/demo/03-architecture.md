# 03 - Architecture and multi-tenant separation (DEMO stage, MAX/Hyp)

Status: COMPLETE (all sections filled). Role: architecture and multi-tenant separation agent.
Repository: (repo root) (branch `payments/max-hyp`, code = 910b1f9). Research only: no repository file was changed, no request was sent to any Hyp payment/API host, only read-only SELECTs on the local `shop_test` DB.

Legend used everywhere: **(a)** = built and tested in DEMO now; **(b)** = designed now, built later; **(c)** = out of scope.
Placeholders: `<PLATFORM_ADMIN_HOST>`, `<slug>.<TENANT_BASE_DOMAIN>`, `<demo-...>` stand for host names (env var names are real, values are never shown). Terminal numbers are written `00100…` (the documented test prefix) or `<terminal>`.

**Summary (details and evidence below):**
1. Two scopes with nothing shared except pure protocol code: separate terminals, tables, secret readers, root keys (HKDF label + AAD per scope), return routes and hosts, settle functions, books, audit, flags and alerts. The existing host split (`/platform/*` is 403 on store hosts) and the ledger's `billing.provider_write` guard give two structural fences for free; U17 + SQL + E2E tests lock the rest.
2. DEMO platform purchase: the store owner pays the **open subscription balance** of `billing.ledger` on the platform test terminal; `platform_attempt_mark_paid` writes one `confirmation='provider'`, `source='provider'` payment row; nothing is renewed or unlocked automatically; add-ons, AI packages and upgrade requests stay manual.
3. DEMO = DEMO-M (local/CI, Hyp mock) then DEMO-H (a separate small VPS against Hyp's test environment, 3 test terminals). Hyp's endpoint is the same for test and live, so the guard is two matching markers (app `PAYMENTS_ENV` + DB marker) plus mode and the documented `00100` prefix.
4. New finding: Hyp Pay's built-in invoicing is **on by default** and issues documents for every successful transaction including refunds; it must be switched off (or confirmed off) on every NURIEL terminal to honour "no invoices" and keep SmartBee possible later.
5. Refunds (order screen), the SmartBee document port and token-based renewals are designed with states, idempotency and the Hyp questions that must be answered first; none is built in DEMO.

---

## 1. Scope separation (platform vs tenant)

### 1.1 The two merchant scopes

| | **PLATFORM scope** (NURIEL's own terminal) | **TENANT scope** (one terminal per store) |
|---|---|---|
| Seller of record | NURIEL | the store (each store is its own merchant; no marketplace, no pass-through) |
| Payer | the store owner (`billing.manage` permission, same rule as today's billing: `billing.owner_tenant()` checks `staff_can('billing.manage')` / `hospitality.can('billing.manage')`, verified with `pg_get_functiondef`) | the store's end customer (logged-in non-staff, or guest) |
| What is paid | open balances in NURIEL's books: subscription, setup fee, other (later: add-ons, AI packages) | orders (`orders.payment_method='online'`) |
| Books | `billing.ledger` (append-only; `confirmation='provider'`, `source='provider'`, `provider_ref`) | `orders` + `payment_attempts` (+ `payment_events`, later `payment_refunds`) |
| Where the payment starts | store host, admin panel "המנוי שלי" (`MyBillingCard`, rendered by `src/components/billing/BillingPanel.tsx:143`) | store host, `/checkout` → `/checkout/pay/$orderId` |
| Where Hyp returns the browser | `https://<PLATFORM_ADMIN_HOST>/platform/payments/return/max` | `https://<slug>.<TENANT_BASE_DOMAIN>/payments/return/max` (Phase A decision 4: stable platform subdomain) |
| Settle function (only writer of "paid") | `platform_attempt_mark_paid` (writes one `billing.ledger` row) | `max_attempt_mark_paid` (marks the order paid) |
| Hyp terminal | NURIEL's platform terminal (DEMO: a `00100…` test terminal) | the store's own terminal (DEMO: one `00100…` test terminal per demo store) |

Why two terminals even for NURIEL's own store: the default tenant (`kobi`, id `…0001`, `is_default=true`, ecommerce; SQL below) is NURIEL's own shop. Its end-customer orders belong to the TENANT scope and use the shop's terminal; NURIEL's subscription income uses the PLATFORM terminal. Hyp allows several terminals per business: "A Hyp representative will: 1. Register one or more terminal numbers for you." (https://developers.hyp.co.il/pay/getting-started/prerequisites-and-initial-setup).

### 1.2 Picture

```
                         one codebase, one Node process, one Postgres
   ┌─────────────── PLATFORM scope ───────────────┐   ┌──────────────── TENANT scope ────────────────┐
   │ store owner @ store host /admin?tab=billing  │   │ customer @ store host /checkout/pay/:orderId │
   │   └─ myBillingPayStart (serverFn, CSRF)      │   │   └─ startOnlinePayment (serverFn, CSRF)     │
   │ src/platform/billing/pay.server.ts           │   │ src/lib/online-payments.server.ts            │
   │ src/platform/payments/platform/*             │   │ src/platform/payments/tenant/*               │
   │   key: PLATFORM_TERMINAL_SECRETS_KEY         │   │   key: PAYMENTS_SECRETS_KEY                  │
   │   HKDF info "…/platform", AAD "platform:…"   │   │   HKDF info "…/tenant", AAD "tenant:<id>:…"  │
   │ DB: platform terminal + platform attempts    │   │ DB: payment_provider_accounts, payment_*     │
   │     platform_attempt_mark_paid ──► billing.  │   │     max_attempt_mark_paid ──► orders (paid)  │
   │                                     ledger   │   │                                              │
   │ return: <PLATFORM_ADMIN_HOST>/platform/      │   │ return: <slug>.<base>/payments/return/max    │
   │         payments/return/max                  │   │         (store hosts only)                   │
   │ flag: platform_terminal_payments             │   │ flag: max_payments + account.enabled         │
   └──────────────────────┬───────────────────────┘   └───────────────────────┬──────────────────────┘
                          │  shared ONLY: pure, stateless, credential-free code │
                          └──► provider.ts · max/protocol.ts · http.server.ts ◄─┘
                               crypto primitives (no key material) · UI labels · Hyp mock (tests)
   Hyp Pay: same endpoint for both (documented constant https://pay.hyp.co.il/p/); separation = different terminals.
```

### 1.3 Separation at every layer

| Layer | PLATFORM scope | TENANT scope | How the boundary is enforced |
|---|---|---|---|
| Hyp terminal | exactly one platform terminal per mode | exactly one terminal per store; one terminal may belong to one store only (Phase A `UNIQUE(provider, terminal)`) | DB: a terminal number may be registered in **one scope only** (cross-table uniqueness, e.g. a shared non-secret terminal registry or triggers; DB agent decides). Test S-SEP-1 |
| Credential storage | its own table in a closed, non-API schema (the DB agent proposes a dedicated `payments` schema; `billing` is the existing example of the pattern: it revokes everything from `anon`/`authenticated`, `supabase/migrations/20261114100000_billing_agreements.sql:35-38`) | `payment_provider_accounts` (Phase A 6.3) | Separate tables, separate DEFINER secret readers (`platform_terminal_secrets(_attempt,_purpose)` vs `max_account_secrets(_tenant,_attempt,_purpose)`); each refuses ids of the other scope. S-SEP-3 |
| Key derivation | root secret `PLATFORM_TERMINAL_SECRETS_KEY`; HKDF-SHA256 info `nuriel/payments/v1/<env>/platform`; AAD `<env>:platform:max:<mode>:<account>:<field>:<key_version>` | root secret `PAYMENTS_SECRETS_KEY` (Phase A decision 3); HKDF info `nuriel/payments/v1/<env>/tenant`; AAD `<env>:tenant:<tenant_id>:max:<mode>:<account>:<field>:<key_version>` | A ciphertext copied across scopes or across environments (`<env>` = `PAYMENTS_ENV`) fails to decrypt (wrong key and wrong AAD); each environment also has its own root values. U10-SEP. Two roots also give independent rotation and custody (decision O-4) |
| Provider adapter instance | built per call with platform credentials, dropped after the call | built per call with that store's credentials | No module-level adapter or credential cache; `createMaxAdapter(ctx)` is a factory. U17-B8 |
| Server functions | store-owner side `src/platform/billing/pay.functions.ts` (`myBillingPayOptions/Start/Status`, user token via the existing `ownerRpc`, `src/platform/billing/billing.server.ts:50`); platform-admin side `src/platform/payments/platform/terminal.functions.ts` (requires the platform host, like `platformRpc`, `billing.server.ts:58-59`) | `src/lib/online-payments.functions.ts` (customer), `src/lib/online-payment-settings.functions.ts` (store owner), `src/platform/payments/tenant/admin.functions.ts` (platform admin, platform host only) | Different files, different RPC names; U17-B2/B3/B4 forbid cross-imports and cross-references |
| Routes, hosts, return URLs | `/platform/payments/return/max` on `<PLATFORM_ADMIN_HOST>` (must stay reachable by store owners' browsers; the repo's nginx template has no allow-list or basic auth on the app vhost, `deploy/nginx/nuriel-shop.nuri1.fit.conf`; if the admin host is ever restricted, the platform return needs its own public path). `storeGate` already answers 403 for `/platform/*` on every store host (`src/server.ts:71-75`), and the router sends `/platform` on store hosts to `/forbidden` (`src/routes/__root.tsx:119-122`) | `/payments/return/max` on store hosts; handler refuses `isPlatformRequest()` (`src/integrations/supabase/tenant.server.ts:232-235`) and unknown hosts | Each terminal has its own portal success URL ("specify the URL of the success page on your website…", prerequisites page above), so each scope's returns arrive only at its own route. Lookup by `Order` only in that scope's attempt table → a foreign reference is "not found", no VERIFY. E-SEP-1..4 |
| Tenant context on the server | platform host requests still carry a tenant in `AsyncLocalStorage`: `tenant_for_host` falls back to the default tenant for any unknown host, including the admin host (SQL below). Platform-scope code must **never** use `currentTenantId()`, `supabaseAdmin` or `current_tenant_id()`-based service calls; it uses the payer tenant stored on the attempt | uses the host tenant (`currentTenantId()`, fails closed: `tenant.server.ts:216-220`) and explicit `_tenant` in every DB function | U17-B5 bans `currentTenantId(`/`supabaseAdmin`/`client.server` in platform-scope files |
| Admin screens / permissions | platform admin only: new `/platform/payments` page, "NURIEL platform terminal" card (write-only `KEY`/`PassP`, masked terminal, mode, test connection, success URL to paste, Hyp-portal checklist). Store owner sees only a "pay online" button and the status of **their own** attempts; never the terminal | platform admin: "MAX" tab per store in `CustomerFile` (Phase A 4.7); store owner: status + installment options, no secrets | Separate components and server functions; audit action names `platform_terminal_*` vs `tenant_terminal_*` |
| DB tables | platform attempts / returns / events (no `order_id`; `tenant_id` = payer; `category`; `ledger_entry_id`) | `payment_attempts` (FK `(tenant_id, order_id)`), `payment_returns`, `payment_events` | No FK, view or function joins the two attempt tables. S-SEP-2 static scan of function bodies |
| Settle and books | `platform_attempt_mark_paid` is the **only** function that sets `billing.provider_write` (the existing ledger guard refuses provider rows otherwise, verified below); it never touches `orders` | `max_attempt_mark_paid` is the only writer of `payment_status='paid'` for `online` orders; it never touches `billing.*` | S-SEP-4: `pg_proc` scan: exactly one function body contains `billing.provider_write`; the tenant settle body contains no `billing.`; the platform settle body contains no `public.orders` |
| Audit | platform-terminal config changes + platform payment events (own append-only stream; `platform_audit_log` via `billing.audit()` is the existing platform writer) | `payment_config_audit` + `payment_events` (Phase A) | distinct tables or at least a NOT NULL `scope` + distinct action namespaces; written inside the same DB transaction as the change |
| Flags / kill switches | `platform_terminal_payments` (new attempts; returns of redirected attempts are still verified) | `max_payments` (Phase A) + `payment_provider_accounts.enabled` per store | independent rows in `platform_feature_flags` (key rule `^[a-z][a-z0-9_]{2,63}$`, verified with `\d`). Names avoid the `platform_payments_` substring that `scripts/db-tests/remove-hyp.test.sql:60-63` forbids in public function bodies |
| Monitoring / alerts | platform admin only (review list on `/platform/payments`, alert on `needs_review` or overpayment); log prefix `[pay:platform]` | store admins' bell + platform overview counts (Phase A); log prefix `[pay:tenant]` | separate counters and "last verified payment" per scope |
| References (`Order`) | random reference stored only in the platform attempt table | random reference stored only in `payment_attempts` | independent namespaces; an optional 1-char scope prefix only if Hyp confirms `Order` length/charset (Phase A question 8) |
| Tokens (b) | platform subscriptions only | per-store saved cards only | never `tOwner` across scopes: "a two-terminal setup only works when both terminals use the same business ID" (https://developers.hyp.co.il/pay/advanced-features/recurring-payments) is exactly NURIEL's platform terminal + NURIEL's own shop terminal, so it must be forbidden by design |

### 1.4 What may be shared and what never

| May be shared (pure, stateless, holds no secret, no DB) | Must never be shared |
|---|---|
| `src/platform/payments/provider.ts` (types, `Money` in agorot), `registry.ts` | root secrets, derived keys, AAD domain |
| `src/platform/payments/max/protocol.ts`: SIGN request building, SIGN response validation, return parsing (raw, reserved/duplicate keys), VERIFY request building, `CCode` classification, status mapping | credential tables and their DEFINER readers |
| `src/platform/payments/max/config.ts` (field specs) | attempt / return / event tables and their state-machine functions |
| `src/platform/payments/http.server.ts` (POST, timeout, size cap, HTML detection, redaction; endpoint constant) | settle functions and the books they write |
| `src/platform/payments/crypto.server.ts` (AES-256-GCM/HKDF primitives taking a key as an argument) | return routes, hosts, success URLs |
| `src/platform/payments/env.server.ts` (environment guard, §3.4) | server functions, orchestrators, jobs |
| UI labels and the fixed Hebrew error map | admin screens and permission checks |
| the Hyp mock server (tests only; emulates several terminals) | audit streams, alerts, flags |
| | terminal numbers, tokens, references |

**Anti-pattern to avoid (the removed Hyp code did this):** one `payment_intents` table for both scopes with a `scope` column, one `hyp_credentials(_scope, _tenant)` RPC through `supabaseAdminUnscoped`, and one return handler that found the scope from the row (`git show 9bbc37c^:src/server/services/payments.ts:38-55,343-393`). It also marked an intent failed on an unverified decline (`:352-358`), so a forged decline could freeze a payment. Commit `c137c91` ("Platform terminal (platform_settings) for subscriptions and add-ons") shows the platform terminal existed before and was removed in Part 28 (`supabase/migrations/20261019360000_remove_hyp.sql:1-12`).

### 1.5 Enforcement by tests (extends U17 `tests/architecture/max-boundaries.test.ts`)

Built on the existing scanner of `tests/architecture/boundaries.test.ts` (it already stops `src/platform/**` from importing `src/lib/**`: `:141-142`). New rules:

| Rule | Assertion |
|---|---|
| U17-B1 shared code is pure | `provider.ts`, `registry.ts`, `max/protocol.ts`, `max/config.ts` import nothing outside that set; no `process.env`, `fetch(`, `supabase`, `.server` import |
| U17-B2 tenant side does not reach platform side | `src/lib/online-payments*`, `src/routes/payments.return.$provider.ts`, `src/platform/payments/tenant/**` do not import `src/platform/payments/platform/**` or `src/platform/billing/**` |
| U17-B3 platform side does not reach tenant side | `src/platform/payments/platform/**`, `src/platform/billing/pay*`, `src/routes/platform_.payments_.return.$provider.ts` do not import `src/platform/payments/tenant/**` or `src/lib/online-payments*` |
| U17-B4 one caller per settle / secret function | the string `max_attempt_mark_paid` appears only in the tenant orchestrator; `platform_attempt_mark_paid` only in the platform orchestrator; `max_account_secrets` only in `tenant/credentials.server.ts`; `platform_terminal_secrets` only in `platform/credentials.server.ts` |
| U17-B5 no tenant context in platform scope | platform-scope files contain no `currentTenantId(`, `maybeCurrentTenant(`, `supabaseAdmin`, `client.server` import. The payer is resolved only inside the DB: `platform_attempt_open` runs with the owner's own token through the existing `ownerRpc` (`x-tenant-id` + `billing.owner_tenant()`, membership-checked), exactly like `my_billing_summary`; every later step is service-role with an explicit attempt id |
| U17-B6 one reader per root secret | `PAYMENTS_SECRETS_KEY` only in `tenant/keys.server.ts`; `PLATFORM_TERMINAL_SECRETS_KEY` only in `platform/keys.server.ts`; no `VITE_*` payment variable |
| U17-B7 Grow isolation | no payments file imports `src/lib/grow*` or `src/lib/platform-grow.functions`; no Grow file imports payments (GROW-RETIREMENT-PLAN §4) |
| U17-B8 no shared state | no module-level `let`/`Map` holding credentials or adapters in payments files (adapter is a factory) |
| U17-B9 host assertions present | the tenant return route calls the `isPlatformRequest()` refusal; the platform return route path starts with `/platform/` |
| U17-B10 (Phase A, kept) | GET-only API routes, no `rejectUnauthorized`, no `===` on signature/token names |
| SQL S-SEP-1..4 | terminal in one scope only; no cross-scope join; secret readers refuse foreign ids; `billing.provider_write` set only by `platform_attempt_mark_paid`; tenant settle body has no `billing.`, platform settle body has no `public.orders` |
| E2E E-SEP-1..4 (mock) | platform return path on a store host → 403 and no DB write; tenant return on the platform host → refused, no VERIFY; a platform reference sent to the tenant route (and vice versa) → not found, the mock records **no** VERIFY; every VERIFY the mock records used the terminal of the attempt's own scope |

---

## 2. Platform purchases on the existing billing domain

### 2.1 What exists today (verified)

| Object | Book | How it is paid today | Evidence |
|---|---|---|---|
| Agreement price, setup fee, renewal / subscription charges, credits | **`billing.ledger`** (migration 189, in production since `773ad14`: `docs/billing/deploy-runbook.md:5`) | manual: the platform admin records a `payment` (`platform_billing_record_entry`, `platform_billing_renew`). `billing.add_entry` hard-codes `confirmation='manual'` | `pg_get_functiondef('billing.add_entry')` |
| Upgrade request (`billing.upgrade_requests`) | no money; "אין חיוב אוטומטי והחבילה הפעילה לא משתנה עד שמנהל הפלטפורמה מאשר" | the admin decides a price; the difference can be recorded as a charge | `20261114100000_billing_agreements.sql:16-17` |
| Add-on (`tenant_addons` + `public.billing_history`) | **legacy** `billing_history` | `addon_purchase` inserts a `due` row and a `pending` add-on; `platform_approve_addon` activates it and marks the row paid | `pg_get_functiondef('public.addon_purchase')`, `…('public.platform_approve_addon')` |
| AI package (`ai_subscriptions`, `ai_subscription_periods`) | own tables (price in agorot), not the ledger | platform admin only: `ai_admin_activate(…, _payment_confirmed)` | `pg_get_functiondef('public.ai_admin_activate')` |
| Legacy "extra admin" request (`public.upgrade_requests`) | none | admin pastes an external `https://` payment link (`platform_send_upgrade_link`) | `\d public.upgrade_requests` |
| Hospitality plans | `billing.ledger` too (engine-agnostic; `MyBillingCard` is also used at `src/engines/hospitality/management/dashboard/Dashboard.tsx:183`) | manual | `billing.ledger.engine` CHECK |

The two books run in parallel and are not synchronised: "שני המנגנונים פעילים במקביל. הישן לא כבוי ולא שונה." (`docs/billing/billing-history-mapping.md:7-9`). The new ledger "records only; the subscription changes only in a separate explicit action" (`:15`).

### 2.2 The ledger was built for this (verified with SQL)

- `confirmation` CHECK `IN ('manual','provider')`; `source` CHECK includes `'provider'`; `ledger_check5`: `confirmation <> 'provider' OR provider_ref IS NOT NULL`; `provider_ref` ≤ 200 chars; `method` ∈ `bank_transfer, bit, credit_card, cash, check, other` and only on `payment`/`reversal`; `currency='ILS'`; `amount > 0 AND ≤ 1000000`; `kind='reversal'` iff `reverses_id` (UNIQUE: one reversal per row). Source: `\d+ billing.ledger`.
- The trigger `billing.guard()` refuses UPDATE/DELETE/TRUNCATE and refuses any `confirmation='provider'` or `source='provider'` INSERT unless the transaction set `billing.provider_write='on'` ("אישור ספק תשלומים לא נרשם ידנית"): `20261114100000_billing_agreements.sql:221-227` and `pg_get_functiondef('billing.guard')`. This is the hook for `platform_attempt_mark_paid` (same idea as `kobi.payment_update` for orders).
- No unique index on `provider_ref` (only `entry_no`, `legacy_ref`, `reverses_id` are unique). Idempotency must come from the platform attempt row (`UNIQUE(provider, terminal, provider_txn_id)`, one ledger row per attempt); a partial unique index on `provider_ref` is optional (DB agent, part of the approved migration).
- Balances are per category, not per charge: `billing.summary` sums `charge − credit − payment` for `subscription`, `setup` (agreement setup fee + extra setup charges), `other` (`pg_get_functiondef('billing.summary')`). A payment row needs exactly one category.
- The UI already has the provider label: `confirmationLabel('provider')` = "אושר על ידי ספק התשלומים" (`src/platform/billing/logic.ts:63-65`), and a negative balance shows as "זכות" (`logic.ts:109-112`).

### 2.3 Decision per object

| Object | Pay through platform terminal? | Why |
|---|---|---|
| **Open ledger balance of one category** (subscription / setup / other) | **(a) yes, `subscription` in DEMO**; setup/other (b) | books = `billing.ledger`; provider columns and guard already exist; no activation needed; works for both engines |
| Upgrade request | (c) not directly | no price until the admin approves; after approval the recorded difference charge is an open balance → payable as above |
| Add-on | (b) later | legacy book (`billing_history`), automatic activation, and `remove-hyp.test.sql:227-239` asserts the manual add-on flow (pending + due) stays. Needs a decision to move add-on charges into the ledger first |
| Hospitality plan / subscription | (b) later | same ledger path as above (the ledger is engine-agnostic), but the DEMO is limited to ecommerce owners (O-9) |
| AI package | (b) later | admin-activated with `_payment_confirmed`; no owner purchase flow and no ledger rows today |
| Legacy external payment links | (c) | replaced by the platform terminal later; untouched now |

### 2.4 Recommended DEMO purchase: "pay the open subscription balance"

Flow (all on the DEMO instance, platform TEST terminal):

```
platform admin (demo) records a subscription charge  ── existing manual UI (BillingAdminCard → platform_billing_record_entry)
store owner @ <slug>.<demo-base>/admin?tab=billing   ── MyBillingCard shows "יתרה לתשלום" + [תשלום מקוון] (only if available)
 └ POST myBillingPayStart({category:'subscription', expected:<balance shown>})   serverFn, CSRF, owner token (ownerRpc)
     DB platform_attempt_open: payer = billing.owner_tenant(); env guard; flag; amount = current subscription
        balance (same formula as billing.summary); refuse if ≠ expected (like addon_purchase's _expected check);
        one open attempt per (tenant, category); random reference; TTL 30 min
     service role: platform_terminal_secrets(attempt,'sign') → decrypt (platform key) → SIGN
        (Order=reference, Amount, Coin=1, Sign=True, MoreData=True, PageLang=HEB, hideBtns=True; no SendHesh)
 └ location.assign(https://pay.hyp.co.il/p/?<signed string>)       test card from Hyp's official page
Hyp → browser → https://<PLATFORM_ADMIN_HOST>/platform/payments/return/max?Id=…&CCode=…&…   (platform host only)
     record return (platform tables only) → VERIFY with the platform terminal → platform_attempt_mark_paid:
        FOR UPDATE; return CCode=0; VERIFY CCode=0; amount = attempt amount; currency; terminal snapshot;
        txn id unused; env/mode; set billing.provider_write='on'; INSERT billing.ledger(kind=payment,
        category=subscription, method=credit_card, confirmation=provider, source=provider,
        provider_ref='max:<Hyp Id>', reference=<attempt ref>, description='תשלום מקוון'); attempt → paid
 └ 303 → <start origin>/admin?tab=billing&pay=<reference>   no-store, no-referrer
     start origin = the host the owner started from, saved on the attempt and re-validated as one of that
     tenant's hosts (the removed code did this: git show 9bbc37c^:src/server/services/payments.ts:257-287);
     fallback slugOriginForTenant (tenant.server.ts:332). Sessions are per origin, so returning to the
     start host keeps the owner logged in. MyBillingCard polls myBillingPayStatus(reference).
```

- **Activation in DEMO: none.** Paying a balance does not renew or unlock anything; renewal stays the admin's explicit `platform_billing_renew` (with "record payment" off, since the provider row exists). This matches the ledger's "records only" rule and keeps entitlement and lock logic (`storeLockReason`, `tenant.server.ts`) out of the DEMO. Auto-renew on payment is (b).
- **Overpayment** (the admin recorded a manual payment while the shopper was paying): the provider row is still written (money was received; the books must show it), the balance becomes "זכות", and the platform admin gets an alert. No automatic refund.
- **Inconsistent verified return** (amount ≠ attempt, reused txn id): attempt → `needs_review`, **no** ledger row; listed for the platform admin. Resolution flow (b).
- **VAT snapshot:** same rules as a manual payment (`billing.add_entry` computes `vat_business_type`, rate and net/VAT parts). The seller type defaults to "עוסק פטור" (`billing.settings.seller_business_type DEFAULT 'exempt'`, `20261114100000_billing_agreements.sql:48`), and that was the state checked at the production deploy (`docs/billing/deploy-runbook.md:42`); today's production value is not known to me.
- **Engines:** DEMO = ecommerce store owners only; the hospitality dashboard shows no pay button yet (b).

### 2.5 UI changes, without breaking manual billing

| File | DEMO change (a) | Unchanged |
|---|---|---|
| `src/platform/billing/ui/MyBillingCard.tsx` | "תשלום מקוון" button next to the subscription balance when `myBillingPayOptions()` says available; DEMO badge; result banner from `?pay=<ref>`; the line "אין כאן סליקה: תשלום מופיע אחרי שצוות Nuriel רשם שהוא התקבל." (`:240`) becomes conditional | entries list (`parts.tsx`), upgrade section, every number (still from `billing.summary`) |
| `src/platform/billing/ui/PayOnlineButton.tsx` (new) | starts the attempt, `location.assign(url)` | — |
| `src/components/billing/BillingPanel.tsx` | none (it renders `MyBillingCard` at `:143`) | legacy history table |
| `src/components/billing/AddonsStorePanel.tsx` | none in DEMO | manual add-on flow (asserted by `remove-hyp.test.sql:233-239`) |
| `src/platform/billing/ui/BillingAdminCard.tsx` | none required (provider rows already render with their confirmation label); optional filter "provider" | manual record / reverse / renew |
| `src/routes/platform_.payments.tsx` + `PlatformTerminalCard.tsx` (new) | platform terminal settings, test connection, success URL to copy, review list | — |

Constraints from existing tests: `store_billing()` and `addons_store()` must not gain a `payments_ready` key (`remove-hyp.test.sql:227-232`), so availability comes from a new function; the removed names `addon_checkout_start`, `plan_checkout_start`, `plan_quote`, `plan_quote_for`, `platform_payments_ready`, `platform_payment_settings`… must not return (`:50-59`).

---

## 3. DEMO environment: options, recommendation, environment guard

### 3.1 Refined definition of "DEMO"

1. **NURIEL side:** a non-production deployment with its own app, Postgres/Supabase stack, secrets, host names and email catcher. Nothing is copied between DEMO and production in either direction (no dump/restore, no shared `.env`, no shared backups).
2. **Hyp side:** only Hyp **test terminals** ("These terminals are easy to spot because their numbers always start with `00100`.", https://developers.hyp.co.il/pay/getting-started/testing-environments) and the published test cards (cited by URL, never copied). The endpoint is the same as production ("The URL stays the same (`https://pay.hyp.co.il/p/`), but it will only process real transactions when you use your production credentials.", same page), so **the endpoint cannot be the guard: the terminal and the mode are** (§3.4).
3. **Two sub-stages:** **DEMO-M** = local machine and CI against the Hyp mock (zero Hyp traffic); **DEMO-H** = the demo deployment against Hyp's real test environment, each run approved by the owner.
4. **Not testable in DEMO (documented production-only):** "3DS is only available on production terminals." (https://developers.hyp.co.il/pay/advanced-features/3ds); wallets and bit: "the full payment workflow only works in production" (https://developers.hyp.co.il/pay/common-use-cases/digital-wallets). They stay off (Phase A decision 7).

### 3.2 Hyp constraints that decide where DEMO-H can run

| Constraint | Source (quote) | Consequence |
|---|---|---|
| Return (success) URL is a portal setting per terminal account | "specify the URL of the success page on your website that will be displayed to the user after a transaction completes." / "select **לינק מותאם אישית** … under **עסקה שהצליחה** … and enter your success page URL" (https://developers.hyp.co.il/pay/getting-started/prerequisites-and-initial-setup) | each test terminal points at exactly one host; the host must be stable for the whole DEMO |
| No per-request return URL | evidence 01 §1 row "Success / error URL": "per-request URL not found" | platform and each demo store need **their own** test terminal |
| One terminal per environment by default | "By default, you receive one terminal and one Hyp Portal account per environment." (prerequisites page) | ask Hyp for **3 test terminals**: platform, demo store A, demo store B (store B proves store-to-store isolation) |
| Whether the portal accepts `http://`, `localhost` or a non-public host as success URL | not documented | a developer-machine run with Hyp's real test environment is uncertain; ask Hyp |
| Hyp never calls us (no webhook / notify for Hyp Pay) | evidence 01 §4: "Server-to-server notify / webhook / IPN for Hyp Pay … not found" | no inbound firewall rule or Hyp IP allow-list (IPs are not documented either); only **outbound** HTTPS from the server |
| TLS for API calls | "We require **TLS 1.2 or higher** for all connections." / "Any API calls made over plain HTTP will be automatically rejected." (https://developers.hyp.co.il/pay/getting-started/authentication-security) | outbound TLS 1.2+ to `pay.hyp.co.il:443` |
| Backend-only credentials | "**Only call Hyp APIs from your backend**." (same page) | the server that holds the test `KEY`/`PassP` is the demo server, never a browser |
| Built-in invoicing is ON by default | "Invoicing is enabled on your terminal by default." … "Hyp Pay is designed to issue an invoice **automatically** for every successful transaction, including refunds, cancellations, and payouts." (https://developers.hyp.co.il/pay/invoicing/basic-invoicing) | conflicts with "no invoices" and with a future SmartBee; **ask Hyp to disable the invoicing module on every NURIEL terminal** (test and later production), or confirm test terminals issue no tax documents. Never send `SendHesh`/`EZ.*` (Phase A §3.5 already) and ignore `Hesh`/`HeshASM` |

### 3.3 Options compared

| | A. Developer machine + browser | B. This cloud container | C1. Demo stack on the production server (existing `docs/hospitality/staging-plan.md`) | **C2. Demo stack on a separate small VPS** |
|---|---|---|---|---|
| Hyp return URL | `http://<slug>.shop.localhost:<port>/…` (the E2E harness already uses `*.shop.localhost`, evidence 07 line 129); portal acceptance **not documented**; terminal bound to one person's machine | no public host at all | stable HTTPS host names (`stg`, `<slug>.stg`, proposal in the staging plan) | stable HTTPS host names on the VPS (same pattern) |
| Network to Hyp | outbound from the laptop | goes through this session's proxy; **forbidden now** by the research rules, and wrong for real credentials later | outbound from the production machine | outbound from the VPS |
| HTTPS | none (loopback) | n/a | Let's Encrypt; fixed list of 3 hosts (staging plan §3 recommends a fixed list to start) | same |
| Data isolation | full (local DB) | full but ephemeral | own stack and volumes, but **same machine, Docker daemon and reverse proxy** ("nothing shared with Production except the Docker daemon, the machine and the reverse proxy", staging plan §1) | full |
| Cost | none | none | none extra; RAM risk ("roughly 2–3 GB RAM … If the server has less than ~4 GB free, use a small separate VPS instead", staging plan §4) | one small VPS (~4 GB RAM) + 3 DNS records + certificates |
| Touches production? | no | no | **yes**: new nginx vhosts + reload on the production proxy, shared resources → needs explicit approval under rule 9 | **no** |
| Good for | DEMO-M (mock) development | DEMO-M in CI-like runs only | DEMO-H if the owner accepts the shared machine | **DEMO-H (recommended)** |

**Recommendation.** DEMO-M on developer machines and CI (mock, `*.shop.localhost` hosts, `PLATFORM_ADMIN_HOST` local); **DEMO-H on a separate small VPS** built with the existing self-host recipe (`deploy/setup-selfhost.sh` with its own `PROJECT`/ports/domains, as the staging plan describes; I did not open that script), with: basic auth on all demo hosts (staging plan §3; browsers normally re-send cached basic-auth credentials to the same origin on a top-level redirect, to be verified in D6; if not, exempt only the two return paths, which carry no authority), `X-Robots-Tag: noindex`, the Resend-compatible email catcher (`e2e/scripts/mock-services.mjs`, staging plan §2), nginx `access_log off` for both return paths (Phase A finding 6), and NetFree coverage checked for the demo names (staging plan §3). The VPS never receives production data or secrets.

### 3.4 Environment guard

```
Key 1  app marker   PAYMENTS_ENV ∈ {demo, production}   non-secret env (new; must be added to docker-compose.yml
                    and .env.example, see tests/unit/env-forwarding.test.ts:35-50). Absent or other value ⇒ payments OFF.
Key 2  DB marker    singleton "payments environment" value ∈ {demo, production}, default NULL ⇒ payments OFF.
                    Set by an explicit, audited operator call on that DB only; never by a migration; never by a copy.
Rule   Key 1 = Key 2, else refuse every account save and attempt open, and alert "environment mismatch"
       (catches a demo app pointed at a production DB and the reverse). A return that arrives during a
       mismatch is recorded but NOT settled (needs_review): settling into the wrong DB is worse than waiting.
DEMO        mode must be 'test' AND terminal LIKE '00100%'  → 'live' or a non-00100 terminal is refused at
            account save, attempt open and settle (both scopes).
PRODUCTION  mode must be 'live' AND terminal NOT LIKE '00100%' → 'test' refused (replaces the Phase A
            test-user allow-list in production; decision O-5).
Mock hook   MAX_PAY_TEST_URL (Phase A name) honoured only when it is http://127.0.0.1|localhost AND
            PLATFORM_ADMIN_HOST is localhost/*.localhost (copy src/platform/ai/router.server.ts:22-34);
            listed in TEST_ONLY (tests/unit/env-forwarding.test.ts:15-20), so docker-compose can never forward it.
UI          "סביבת DEMO — אין חיוב אמיתי" banner on /checkout/pay/*, the MyBillingCard pay button and both
            admin terminal screens; TEST badge on every attempt and on DEMO ledger rows' description.
```

Where each key is checked: `src/platform/payments/env.server.ts` (app, both scopes) and the DB functions `*_account_save`, `*_attempt_open`, `*_attempt_mark_paid` of **both** scopes (DB agent). The `00100` rule follows the documented prefix; in DEMO it is an allow-list (fail closed: a test terminal without the prefix is refused and reported to Hyp), in production a deny-list (Phase A §6.3). Live gate flags (`max_payments_live`, `platform_terminal_live`) are (b): not needed while the environment refuses live.

## 4. Store checkout DEMO flow (tenant scope) + files

Consistent with Phase A §4.3/§6, with three updates: (1) the tenant code is one of two scopes and imports nothing of the platform scope; (2) Grow is hidden by the separate retirement step and is never reused (GROW-RETIREMENT-PLAN §3.2, §4); (3) the `place_order`/`place_guest_order` patch is anchored on the Bit line, which the live DB shows in both functions (`CASE WHEN _details ->> 'payment_method' = 'bit' THEN 'bit'`, SQL in §9) and which `remove-hyp.test.sql:89-92` requires to stay.

### 4.1 Minimal end-to-end path (DEMO-M first, then DEMO-H)

```
 customer (non-staff; staff orders are forced offline: remove_hyp.sql:67-69)
  1 /checkout ─ an `online` payment option, shown only if getOnlinePaymentOptions().available
  2 place_order (RPC, logged-in) | placeGuestOrder (serverFn, guest)  payment_method='online'
      DB orders_default_payment: max_payments_active(tenant) + env guard → online / awaiting / due 2h; stock held
  3 /checkout/pay/$orderId → startOnlinePayment({orderId[, guestToken]})   serverFn: CSRF, store open, rate limit
      max_attempt_open(_tenant=currentTenantId(), _order, _uid)   amount from order_amount_due, reference, TTL
      max_account_secrets(_tenant,_attempt,'sign') → tenant key → MAX adapter SIGN → max_attempt_signed
      ← {url}; page does location.assign(url)   (CSP form-action 'self' forbids a form POST: Phase A 4.1)
  4 Hyp hosted page (store's 00100… test terminal; official test card)
  5 Hyp → 302 → https://<slug>.<base>/payments/return/max?Id&CCode&Amount&ACode&Order&Fild1-3&Sign[&MoreData…]
      route: refuse platform host/unknown host; parse raw (no re-encode); max_attempt_record_return(_host_tenant,…)
  6 VERIFY with that store's terminal (raw params, original order) → CCode must be exactly 0
  7 max_attempt_mark_paid(…) one transaction: amount = attempt = current amount due, currency, txn unused,
      env/mode, order still awaiting → order paid  (else needs_review; a failed VERIFY changes nothing)
  8 303 → <validated start origin>/checkout/pay/$orderId (no-store, no-referrer; same start-origin rule as
      §2.4, so a shopper who started on a custom domain lands back there) → order emails (online branch)
  9 job (every 5 min, existing timer): expire attempts, re-VERIFY pending returns, purge encrypted raw returns
```

DEMO sub-steps: **D4a** logged-in customers; **D4b** guests with a one-time capability token (Phase A decision 11). Installments: single payment in DEMO (`Tash` not sent above 1); Phase A sandbox scenario SB18 (3 installments) is run once in DEMO-H before any store may enable them (Phase A decision 12). Naming: Phase A §7.3 numbers its sandbox scenarios D1–D18; here they are called **SB1–SB18** so they do not clash with the build steps D0–D9 of §7.

### 4.2 Existing files that change (tenant scope)

| File | Change | Note |
|---|---|---|
| `src/lib/checkout.ts:157` | add `"online"` to `PaymentMethodChoice` | type today: `"offline" \| "bit" \| "grow"` |
| `src/lib/checkout.functions.ts:51` | map `online` in `cleanPayload`; guest `online` skips emails at order time | Grow branch untouched (hidden by its own switch) |
| `src/routes/checkout.tsx:236-243,336-349,783,816-870,911-920,1465-1560,1662-1688` | load options, new radio, navigate to `/checkout/pay/$orderId` | no Grow code reused; `getGrowAvailability` returns "unavailable" once Grow stage 1 lands |
| `src/lib/bit-payments.ts`, `src/lib/orders.ts` | `online` label/type; attempt status via a server function, not new `orders` columns (decision 2: details live on the attempt) | |
| `src/components/OrderManagementPanel.tsx:783` | render `OnlinePaymentInfo` next to `GrowPaymentInfo` | Grow history stays visible |
| `src/lib/order-email-data.server.ts`, `src/lib/order-emails.server.ts:82-98`, `src/server/services/notifications.ts` | `online` branch, only when `payment.status==='paid'` | avoids the MX-07 pattern |
| `src/server/services/payment-expiry.ts:14-29` | also call the tenant jobs | platform jobs are started separately (§6.3) |
| `src/lib/blocked-pages.ts:30` | add `payments` to `SUSPENDED_ALLOWED_PATHS` | returns still land on a locked store |
| `src/platform/analytics/gtm.ts:91-92`, `src/lib/marketing.ts:197` | add `/checkout/pay/:id` and `/payments/return/*` to `PERSONAL_PATHS` / `NO_MARKETING_PATHS` | PII and `Sign` never reach GA/Pixel |
| `src/components/platform/CustomerFile.tsx:185-187` | "MAX" tab for the **store's** terminal (Grow tab hidden by Grow stage 1) | platform admin, platform host |
| `src/routes/admin.tsx:490` | `OnlinePaymentSettingsCard` (status, installments) next to `OfflinePaymentMethodsCard` | store owner, no secrets |
| `docker-compose.yml`, `.env.example` | `PAYMENTS_SECRETS_KEY`, `PLATFORM_TERMINAL_SECRETS_KEY`, `PAYMENTS_ENV` (names only; values generated on the demo box) | `.env.example` not opened by me |
| `tests/unit/env-forwarding.test.ts:15-20` | add `MAX_PAY_TEST_URL` to `TEST_ONLY` | |
| `e2e/scripts/mock-services.mjs`, `e2e/scripts/app-up.sh` | Hyp mock (3 fake terminals: platform, store A, store B) | testing agent owns the details |
| DEMO nginx vhost (demo VPS only) | `access_log off` for `/payments/return/` and `/platform/payments/return/` | production `deploy/nginx/*` unchanged in DEMO |

### 4.3 New files (tenant scope)

`src/lib/online-payments.ts`, `src/lib/online-payments.functions.ts`, `src/lib/online-payments.server.ts`, `src/lib/online-payment-settings.functions.ts`, `src/lib/online-payment-jobs.server.ts`, `src/routes/payments.return.$provider.ts`, `src/routes/checkout_.pay.$orderId.tsx`, `src/components/checkout/OnlinePaymentPage.tsx` (modelled on `GrowPaymentPage.tsx`, not importing it), `src/components/orders/OnlinePaymentInfo.tsx`, `src/components/payments/OnlinePaymentSettingsCard.tsx`, `src/components/platform/MaxPaymentsTab.tsx`, plus the scope folder `src/platform/payments/tenant/` (§6). Migration and rollback files: DB agent (local and demo DB only; production only with explicit approval).

### 4.4 Explicitly not in the DEMO tenant flow

Grow (any reuse), iframe, wallets, bit-in-Hyp, J5/Postpone, tokens, refunds/cancels (§5.2 is design only), payment links, a notify route (not documented for Hyp Pay), hospitality guest payments, installments above 1 for real use.

## 5. Future extension points (designed now, built later)

### 5.1 Revenue, purchases, receipts, refunds across both scopes (b)

**Recommendation: separate books and separate reports, one shared vocabulary; no combined revenue view.**

| | Platform scope | Tenant scope |
|---|---|---|
| Book of record | `billing.ledger` (charges, payments manual/provider, credits, reversals; VAT parts per row) | `orders` + `payment_attempts` (+ `payment_refunds` later) |
| Reports | platform admin: revenue per period / tenant / category, provider vs manual, open balances (`billing.summary`), legacy gap (`billing.legacy_gap`) | store owner: existing `store_analytics` counts revenue on `payment_status='paid'` for any method (evidence 05 §1 table, `20261019340000_store_analytics.sql:57,79,91`), so `online` orders count with no change |
| Platform admin's view of stores | — | **operational only**: attempts by status, `needs_review`, last verified payment per store; **no money totals across stores** |
| Reconciliation | daily check against the platform terminal's Hyp portal (Hyp Pay documents no transaction-list API; `payRequest LIST` covers payment links only: evidence 02 §0 item 2) | same per store terminal; "redirected, never returned" list (Phase A R1) |

Why not one view: the seller of record differs (NURIEL vs each store). A combined total would present stores' money as NURIEL's turnover, mix two VAT/document regimes and two permission models. Receipts: today the platform admin uploads PDFs to `platform_documents` (kinds `invoice`/`receipt`/`agreement`/`other`, platform-admin read only: `\d public.platform_documents`); that manual path stays; automation goes through the document port (§5.3).

### 5.2 Refund from the order screen, without the Hyp portal (b)

```
 OrderManagementPanel → [החזר כספי] (owner only in v1)
  → refundOnlinePayment({orderId, amount, reason})            serverFn: CSRF, rate limit, re-auth
  → DB: lock attempt; status paid; amount ≤ original − (succeeded + in-flight); one in-flight refund per
        attempt; idempotency key; row 'requested'; audit                       (same transaction)
  → choose: full amount AND same business day before 22:00 Israel time → CancelTrans, else zikoyAPI
  → row 'submitted' (written BEFORE the call)  → call Hyp with that store's terminal (purpose 'refund')
       CancelTrans  CCode=0 & ReversalStatus=777 → 'succeeded';  920 → new zikoyAPI submission
       zikoyAPI     CCode=0 (new Id)            → 'succeeded';  33 / 901 / 902 → 'failed'
       timeout / HTML / network                 → 'needs_review'  — NEVER auto-retried
  → succeeded: order payment_status 'refunded' | 'partially_refunded' (new CHECK values; migration),
               event, email, document-outbox row (§5.3)
 states: requested → submitted → succeeded | failed | needs_review → resolved_manually
```

| Our operation | Hyp action (documented) | When | Parameters | Success | Notes |
|---|---|---|---|---|---|
| Cancel (full) | `CancelTrans` | "until 22:00 Israel time on the same business day it was made" (https://developers.hyp.co.il/pay/common-use-cases/cancellations) | `Masof`, `PassP`, `TransId` | "`CCode=0` and `ReversalStatus=777`" | `920` = already transmitted or not found; no amount parameter → full only; "you won't be charged the credit card company's commission" |
| Refund (full or partial) | `zikoyAPI` | after settlement | `Masof`, `PassP`, `TransId`, `Amount` | `CCode=0` + new `Id` | "a **refund creates a brand-new transaction**"; "you can choose to refund the **entire amount or just a portion of it**"; `33` = more than the original (https://developers.hyp.co.il/pay/common-use-cases/refunds) |

Why no automatic retry: no idempotency is documented for these actions (evidence 01 Q16, evidence 02 (f): "Retries / idempotency — not documented"), so a timed-out refund may already have happened; the row goes to `needs_review` and is checked in the portal.

**Confirm with Hyp before building:** (1) is `zPass` required for `zikoyAPI` (it appears only in the payout table: evidence 01 §5); (2) is `KEY` required on `CancelTrans`/`zikoyAPI` (not listed); (3) does the terminal need a refund permission, e.g. the acquirer "refund without CVV" the plugin vendor mentions (vendor text only, evidence 01 §9); (4) is "try `CancelTrans`, on `920` use `zikoyAPI`" the intended way to learn whether a deal was transmitted; (5) duplicate protection; (6) cumulative cap for several partial refunds, installment deals, weekend/holiday cutoff; (7) will refunds/cancels issue documents automatically ("including refunds, cancellations, and payouts", basic-invoicing page) and how to switch that off; (8) same behaviour on test terminals; (9) POST support (secrets out of URLs).

**Platform scope refunds (b):** same engine with the platform terminal. Ledger representation: a full refund/cancel = `reversal` of the provider payment row (exists; `reverses_id` UNIQUE); a partial refund needs a new ledger kind (e.g. `refund`) — a CHECK change on `billing.ledger` in an approved migration. Do not overload `credit`, which lowers the amount due, not the amount paid.

### 5.3 Document-provider port for a future SmartBee (b, zero dependency now)

```ts
// src/platform/documents/provider.ts  (pure types; nothing imports a SmartBee SDK)
type DocScope = "platform" | "tenant";
type DocKind  = "receipt" | "tax_invoice_receipt" | "credit_note";
interface DocumentRequest {
  scope: DocScope; tenantId: string;                       // platform: payer tenant; tenant: the store
  source: { kind: "ledger_payment" | "order_payment" | "refund"; id: string };
  idempotencyKey: string;                                   // `${scope}:${source.kind}:${source.id}`
  seller: SellerSnapshot; buyer: BuyerSnapshot;             // platform buyer = tenant_billing_profile
  lines: Line[]; totals: { net: number; vat: number; gross: number; vatRate: number };  // from the ledger/order snapshot
  payment: { method: "credit_card"; providerTxnId: string; last4?: string; installments?: number };
  issuedOn: string; kind: DocKind;                          // from the seller's VAT status snapshot (rules: accountant)
}
interface DocumentProvider {
  code: "none" | "smartbee";
  issue(ctx: DocContext, req: DocumentRequest):
    Promise<{ status: "issued"; providerDocId: string; number?: string; url?: string }
          | { status: "skipped" } | { status: "failed"; retryable: boolean }>;
}
```

- **Default `none`** provider (`src/platform/documents/registry.ts`): returns `skipped`, no network, no package, no env var. Not wired in DEMO at all.
- **Trigger (b):** a transactional outbox per scope, written in the same transaction as `paid` / `refund succeeded`, `UNIQUE(idempotency_key)`; a job with `SKIP LOCKED`, back-off, `needs_review` after N tries; the provider's document id is stored back. A document failure never blocks or reverses a payment.
- **Separation:** NURIEL's own SmartBee account for the platform scope; each store's own account for the tenant scope (stores are the sellers of their orders) — same rule as terminals.
- **Backfill:** DEMO creates no outbox, but ledger rows and payment events keep what a later backfill needs (ids, amounts, VAT snapshot).
- **One issuer per terminal:** Hyp's built-in invoicing is on by default (§3.2). Before go-live the owner picks exactly one issuer per terminal: Hyp Invoice, SmartBee via this port, or manual uploads. Never two.
- SmartBee facts (API, idempotency, document types): **not researched and not used**; only its name comes from the owner.

### 5.4 Recurring subscriptions via tokens (b)

| Model (documented) | Verdict | Reason |
|---|---|---|
| Hyp-managed `HK=True` / `freq` / `HKStatus` | reject | evidence 02 §1.6: "**The result of each automatic HK charge: not documented** (no notification, no API)" → cannot become a provider-confirmed ledger row |
| Merchant-managed: first hosted payment → `getToken` → later `soft` with `Token=True`, `CC`, `Tmonth`, `Tyear`, `UserId` | **use, platform scope first** | synchronous `CCode`; "Your terminal must have tokenization permissions." (https://developers.hyp.co.il/pay/reference/actions#action-gettoken) |

Design: explicit opt-in before the first payment (Hyp Pay documents no consent checkbox: ask Hyp); token, `Tmonth`, `Tyear` encrypted with the **platform** key domain; `UserId` only if the terminal requires it ("If your terminal doesn't require one, use `000000000`", evidence 01 §5); a platform job posts the renewal charge in `billing.ledger`, opens a token attempt in the platform attempt table and settles it through the same `platform_attempt_mark_paid`; dunning retries; on final failure the existing expiry/lock (`storeLockReason`) applies; the owner can delete the saved card. Never `tOwner` between NURIEL's platform terminal and NURIEL's shop terminal (§1.3). Saving end-customer cards in the tenant scope: (c) for now.

## 6. Module layout and boundaries (DEMO)

### 6.1 Layout (all new unless marked "changed")

```
src/platform/payments/                       platform layer, provider-neutral        scope
├─ provider.ts           types, Capabilities, Money (agorot)                        shared (pure)
├─ registry.ts           PROVIDERS = { max }                                         shared (pure)
├─ env.server.ts         PAYMENTS_ENV, endpoint constant, mock-override guard        shared (no secret)
├─ http.server.ts        POST form, timeout, size cap, HTML check, redacting log     shared (stateless)
├─ crypto.server.ts      AES-256-GCM + HKDF primitives; key is an argument           shared (no key)
├─ max/protocol.ts       SIGN/VERIFY builders, parsers, CCode classes, mapStatus     shared (pure)
├─ max/config.ts         secret / public / grant / option field specs                shared (pure)
├─ max/adapter.server.ts createMaxAdapter(ctx) → PaymentProvider, one per call       shared factory
├─ tenant/               ── TENANT scope pieces that live in the platform layer
│  ├─ keys.server.ts            PAYMENTS_SECRETS_KEY → HKDF "nuriel/payments/v1/<env>/tenant"; AAD
│  ├─ credentials.server.ts     max_account_secrets(_tenant,_attempt,_purpose) → decrypt for one call
│  ├─ db.server.ts              service-role RPC helper, `_tenant` mandatory (pattern flags.server.ts:18-22)
│  └─ admin.functions.ts/.server.ts   platform admin configures STORE terminals (platform host only)
└─ platform/             ── PLATFORM scope
   ├─ keys.server.ts            PLATFORM_TERMINAL_SECRETS_KEY → HKDF "nuriel/payments/v1/<env>/platform"; AAD
   ├─ credentials.server.ts     platform_terminal_secrets(_attempt,_purpose)
   ├─ db.server.ts              service-role RPC helper; never reads a tenant from request context
   └─ terminal.functions.ts/.server.ts  platform admin configures the PLATFORM terminal (platform host only)
src/platform/billing/                        existing platform domain                PLATFORM
├─ pay.functions.ts      myBillingPayOptions / myBillingPayStart / myBillingPayStatus (owner, store host)
├─ pay.server.ts         orchestrator: open (ownerRpc) → SIGN → redirected; return → VERIFY → platform_attempt_mark_paid
├─ pay-jobs.server.ts    expire platform attempts, re-VERIFY, purge encrypted raw returns
└─ ui/PayOnlineButton.tsx; ui/MyBillingCard.tsx (changed)
src/lib/                                     ecommerce layer                         TENANT
└─ online-payments.ts · online-payments.functions.ts · online-payments.server.ts ·
   online-payment-settings.functions.ts · online-payment-jobs.server.ts
src/routes/
├─ payments.return.$provider.ts              GET, store hosts only                   TENANT
├─ checkout_.pay.$orderId.tsx                pay page                                TENANT
├─ platform_.payments.tsx                    platform terminal + read-only overview  PLATFORM (admin)
└─ platform_.payments_.return.$provider.ts    GET, platform host only                 PLATFORM
src/components/  checkout/OnlinePaymentPage.tsx · orders/OnlinePaymentInfo.tsx ·
                 payments/OnlinePaymentSettingsCard.tsx · platform/MaxPaymentsTab.tsx      TENANT
                 platform/PlatformTerminalCard.tsx                                          PLATFORM
src/server.ts (changed, entry): start platform pay-jobs beside the existing payment-expiry timer (src/server.ts:49)
tests/architecture/max-boundaries.test.ts (U17 + §1.5 rules) · e2e mock · SQL tests       both
src/platform/documents/  (b) not in DEMO
```

Route file names: `platform_.payments_.return.$provider.ts` is un-nested (trailing `_`, as `src/routes/admin_.inventory_.labels.tsx` does) so the return handler never sits under the `/platform/payments` page route.

Phase A names that move: `src/platform/payments/secrets.server.ts` → `crypto.server.ts` + two `keys.server.ts`; `db.server.ts` → one per scope; `admin.*` → `tenant/admin.*` plus the new `platform/terminal.*`.

### 6.2 Who may import whom (enforced by U17 + the existing layer test)

| from ↓ / to → | shared payments | payments/tenant | payments/platform | platform/billing | lib/online-payments* | Grow files |
|---|---|---|---|---|---|---|
| shared payments | within the set only | ✗ | ✗ | ✗ | ✗ (layer rule) | ✗ |
| payments/tenant | ✓ | ✓ | ✗ | ✗ | ✗ (layer rule) | ✗ |
| payments/platform | ✓ | ✗ | ✓ | ✓ | ✗ (layer rule) | ✗ |
| platform/billing/pay* | ✓ | ✗ | ✓ | ✓ | ✗ (layer rule) | ✗ |
| lib/online-payments* | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |
| routes/payments.return | via lib only | ✗ | ✗ | ✗ | ✓ | ✗ |
| routes/platform_.payments_.return | via billing only | ✗ | ✗ | ✓ | ✗ | ✗ |
| Grow files | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |

"layer rule" = already enforced: the platform layer may import only platform modules and listed adapters (`tests/architecture/boundaries.test.ts:141-142`).

### 6.3 Flags and switches in DEMO

| Switch | Scope | Default | DEMO DB | Stops |
|---|---|---|---|---|
| `PAYMENTS_ENV` + DB marker | both | absent / NULL = off | `demo` / `demo` | everything (§3.4) |
| `max_payments` (platform_feature_flags) | tenant | off | on | new tenant attempts |
| `payment_provider_accounts.enabled` | one store | off | on for demo stores A, B | new attempts of that store |
| `platform_terminal_payments` (platform_feature_flags) | platform | off | on | new platform attempts |
| platform terminal account `enabled` | platform | off | on | same |
| (b) `max_payments_live`, `platform_terminal_live` | go-live gates | off | unused (env refuses live) | — |
| `GROW_ENABLED` (Grow plan, code constant) | Grow only | false after Grow stage 1 | false | MAX never reads it |

In every scope, switching off stops **new** attempts only; returns of already-redirected attempts are still verified and settled (money may have been taken; Phase A 4.8).

---

## 7. Step plan (D0…D9) with exit criteria

Every step: no production deploy, no production migration, no live terminal, no real card. Each step ends with a short report and the owner's go-ahead.

| Step | What | Exit criteria |
|---|---|---|
| **D0** Approvals and requests (no code) | owner decides §8; Hyp asked for 3 test terminals (platform, store A, store B) with portal accounts, plus the open questions (Phase A 1.6 Q1–Q10; new: success-URL format rules, invoicing module off, later the refund questions of §5.2) | written approvals; Hyp request sent; nothing built |
| **D1** Shared protocol, keys, env guard (unit only) | §6.1 shared files + both `keys.server.ts` + `env.server.ts` | Phase A U1–U11 green; cross-scope ciphertext fails to decrypt; env-guard matrix (app × DB marker × mode × `00100`) unit-tested; U17-B1/B6/B7/B8; U18 green; no DB, no route |
| **D2** Hyp mock and harness | mock with 3 fake terminals and per-terminal success URLs; `MAX_PAY_TEST_URL` loopback-only; `TEST_ONLY` updated | mock self-tests; `env-forwarding.test.ts` green; the existing E2E suite unchanged |
| **D3** Database, local and CI only | one migration + rollback (DB agent): tenant objects (06b fixed: `online`, Bit anchor, Phase A §6.3 gaps), platform objects (separate tables, closed schema per the DB agent), environment marker, flags seeded off | `run.sh` 3 passes; rollback check and guards; `remove-hyp`, `grow-payments`, `billing-agreements` tests unchanged and green; new S1–S9, S-SEP-1..4, S-ENV; concurrency C1–C8 plus platform cases; engine-guard count and db-classification updated |
| **D4** Tenant scope against the mock (DEMO-M) | D4a logged-in customer, D4b guest token; store-terminal tab; owner status card; jobs | E1–E11 green with `retries: 0`; E-SEP-1/2; leak scans (bundle, server log, DB) = 0; R1–R4: Grow, Bit, phone, POS unchanged |
| **D5** Platform scope against the mock (DEMO-M) | platform terminal page, `MyBillingCard` button, platform return route, ledger provider row, review list | E-PLAT-1 pay subscription balance → exactly one provider row, balance 0; E-PLAT-2 overpayment → "זכות" + alert; E-PLAT-3 tampered amount → no row, `needs_review`; E-SEP-3/4; manual billing flows and their SQL tests unchanged; U17-B2..B5/B9 green |
| **D6** Demo deployment, no Hyp yet | separate VPS (O-1): stack, migrations, payments migration, `PAYMENTS_ENV=demo` + DB marker, secrets generated on the box, 3 certificates, basic auth, email catcher, `access_log off` on both return paths; seed stores A/B, owners, non-staff customers, platform admin, an agreement and a subscription charge for store A | env guard proven on the box: live mode refused, non-`00100` terminal refused, marker mismatch refused; the mock override is ignored (host is not `*.localhost`); production untouched |
| **D7** DEMO-H, tenant scope (manual, each run approved) | platform admin types store A's test credentials in the demo UI (never chat, git or CI); Hyp portal checklist: signature verification on, success URL = store A demo return, no error URL, invoicing off/confirmed, wallets off; then store B | Phase A sandbox scenarios SB1–SB18 as applicable (SB13 becomes "live refused by env"); evidence = parameter names, `CCode`s, lengths, hashes only; SB6 tamper result recorded (risk R2); SB17 leak search = 0; Phase A §7.3 stop rules honoured |
| **D8** DEMO-H, platform scope (manual) | platform admin enters the platform test terminal; success URL = platform demo return; store A owner pays the subscription balance with an official test card; cross-scope checks with real terminals | one provider ledger row with the expected amount, `method='credit_card'`, `confirmation='provider'`, `provider_ref`; balance 0; nothing renewed or unlocked; no document issued (checked in the portal); a platform return replayed on a store route and a store return on the platform route are both rejected without VERIFY |
| **D9** Independent review and DEMO report | reviewer who did not write the code: threat model, code, DB, evidence | no open High; DEMO report with the go-live decisions; production still untouched |

**Out of scope for DEMO (c):** production deploy or migration; live terminals; real cards or charges; refunds/cancels (designed §5.2 only); any invoice or receipt (no in-house invoicing; SmartBee not connected; Hyp invoicing not used); recurring/tokens; J5/Postpone; iframe; wallets and bit via Hyp; 3DS (production-only); payment links; a notify/webhook route; Hyp Enterprise; hospitality payments (both scopes); online add-on, AI-package or upgrade-request purchases; automatic renewal or activation; any Grow change beyond the separate retirement plan; combined cross-scope revenue reports.

---

## 8. Decisions for the owner

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| O-1 | Where DEMO-H runs | a **separate small VPS** (zero contact with production); alternative: the same-server staging plan, which adds vhosts to the production proxy and shares the machine | D6 |
| O-2 | Hyp test terminals | ask Hyp for **3**: platform, demo store A, demo store B (one terminal per environment is Hyp's default). Minimum 2 (platform + store A); the third proves store-to-store isolation with real terminals | D7, D8 |
| O-3 | The DEMO platform purchase | **pay the open subscription balance** in `billing.ledger`; no automatic renewal or unlock | D5 |
| O-4 | Encryption roots | **two** env secrets (`PAYMENTS_SECRETS_KEY` for store terminals, `PLATFORM_TERMINAL_SECRETS_KEY` for NURIEL's terminal), each with its own HKDF label and AAD; alternative: one root + two HKDF labels | D1 |
| O-5 | Test mode | exists **only in DEMO**; production refuses test terminals (replaces Phase A decision 13's test-user allow-list in production) | D1, D3 |
| O-6 | Return hosts | platform scope: `<PLATFORM_ADMIN_HOST>/platform/payments/return/max`; tenant scope: the store's platform subdomain (Phase A decision 4) | D4, D5 |
| O-7 | Hyp's built-in invoicing (on by default) | ask Hyp to **switch it off** on all NURIEL terminals; choose the receipt issuer (Hyp Invoice, SmartBee via the port, or manual) before go-live, one per terminal | D7, go-live |
| O-8 | Who may pay platform purchases | the store owner only (`billing.manage`), as for viewing billing today | D5 |
| O-9 | Engines in DEMO | ecommerce only; hospitality owners get the button later | D5 |
| O-10 | Reporting | separate books and reports per scope; the platform admin sees only operational data about store payments | (b) |
| O-11 | DB naming | reserve `platform_*` names for the platform scope; rename 06b's `platform_max_*` (admin acting on store terminals) to e.g. `max_tenant_*`; keep every name clear of the `remove-hyp` patterns (DB agent) | D3 |
| O-12 | Grow | land Grow stage 1 (hide) before D4 to avoid merge conflicts in `checkout.tsx` and `CustomerFile.tsx`; not a technical dependency | D4 |

Phase A decisions 1–12 and 14–15 stay as they are; decision 13 changes per O-5.

---

## 9. Claims verified directly

**SQL on the local `shop_test` DB (read-only SELECT / `\d` / `pg_get_functiondef`):**
- `\d+ billing.ledger`: CHECKs on `confirmation`, `source` (incl. `provider`), `confirmation <> 'provider' OR provider_ref IS NOT NULL`, `method` list and `method` only on payment/reversal, `currency='ILS'`, amount range, `kind='reversal'` ⇔ `reverses_id`; unique only on `id`, `entry_no`, `legacy_ref`, `reverses_id`; trigger `guard`; RLS on, no policy.
- `billing.guard()`: provider rows need `billing.provider_write='on'`; ledger UPDATE/DELETE/TRUNCATE refused.
- `billing.add_entry()`: inserts `confirmation='manual'` always. `billing.summary()`: balances per category. `billing.owner_tenant()` / `my_billing_summary()`: payer = `current_tenant_id()` + `staff_can('billing.manage')` or `hospitality.can('billing.manage')`.
- `addon_purchase`, `platform_approve_addon`, `platform_mark_billing_paid`: add-ons live in `billing_history` + `tenant_addons` (pending → active by the admin). `ai_admin_activate`: requires `_payment_confirmed`. `platform_send_upgrade_link`: manual external `https://` link.
- `\d` of `billing_history`, `tenant_addons`, `public.upgrade_requests`, `platform_addons`, `ai_packages`, `ai_subscriptions`, `platform_documents`, `platform_feature_flags` (key pattern; current keys contain no payments flag).
- `tenant_for_host()`: falls back to the default tenant; `tenants`: default = `kobi`, `…0001`, ecommerce (105 tenants in the test DB).
- live `place_order` / `place_guest_order`: both contain `CASE WHEN _details ->> 'payment_method' = 'bit' THEN 'bit'` followed by the Grow line.
- live `store_analytics`: counts `payment_status = 'paid'`.

**Code and docs read with line numbers:** `src/server.ts:49,71-75`; `src/integrations/supabase/tenant.server.ts:216-220,232-235,332`; `src/routes/__root.tsx:119-122`; `src/lib/host-mode.ts:36`; `src/platform/billing/billing.server.ts:50,58-59`; `src/platform/billing/logic.ts:63-65,109-112`; `src/platform/billing/ui/MyBillingCard.tsx:240`; `src/components/billing/BillingPanel.tsx:143`; `tests/architecture/boundaries.test.ts:141-142`; `tests/unit/env-forwarding.test.ts:15-20,35-50`; `src/platform/ai/router.server.ts:22-34`; `scripts/db-tests/remove-hyp.test.sql:50-63,85-92,227-239`; `supabase/migrations/20261114100000_billing_agreements.sql:16-17,35-38,48,221-227`; `supabase/migrations/20261019360000_remove_hyp.sql:1-12,67-69`; `docs/hospitality/staging-plan.md` §1–§4 (status "proposal — nothing done on the server"); `docs/billing/billing-history-mapping.md:7-15`; `docs/billing/deploy-runbook.md:5,42`; `git show 9bbc37c^:src/server/services/payments.ts:38-55,343-393`; `git log` of `c137c91`/`9bbc37c` (read-only git).

**Hyp docs (saved copies of the official pages, re-read for this report):** prerequisites-and-initial-setup (success URL per account; one terminal per environment; "one or more terminal numbers"), testing-environments (`00100` prefix; same URL), basic-invoicing (invoicing on by default, automatic also for refunds and cancellations), refunds, cancellations. Other Hyp facts are cited from evidence 01/02 with their URLs.

**Not verified (open):** whether Hyp's portal accepts `http://`/`localhost` success URLs; whether browsers re-send basic-auth on Hyp's redirect (D6); whether the router's root `beforeLoad` runs for server-handler routes on the platform host (proved or disproved by E-SEP-1/2 in D4/D5); every Hyp question listed in §5.2 and Phase A 1.6.

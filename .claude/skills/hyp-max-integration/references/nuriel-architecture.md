# NURIEL architecture for MAX / Hyp payments

Everything named here exists in the repository (branch `payments/max-hyp`). If a name is not here and not in
the code, it does not exist — do not create a parallel one. The binding decisions are in
`docs/payment-gateways/DEMO-IMPLEMENTATION-CONTRACT.md` §7; the plan is `docs/payment-gateways/MAX-DEMO-PLAN.md`.

## 1. Two separate scopes

| | Store ("tenant") scope | Platform scope |
| --- | --- | --- |
| Who is paid | the store, by its shoppers | NURIEL, by store owners (subscriptions, charges) |
| Terminal | the store's own terminal | NURIEL's terminal |
| Tables | `payments.tenant_*` | `payments.platform_*` |
| DB API | `public.max_*` | `public.platform_attempt*`, `platform_card_*`, `platform_terminal_*`, `platform_stepup_*` |
| Server code | `src/platform/payments/server/tenant/*` | `src/platform/payments/server/platform/*` |
| Root key (environment variable name) | `PAYMENTS_SECRETS_KEY` | `PLATFORM_TERMINAL_SECRETS_KEY` |
| Return route | `src/routes/payments.return.$provider.ts` (store host) | `src/routes/platform_.payments_.return.$provider.ts` (platform host) |
| Server functions | `src/lib/online-payments*.functions.ts` | `src/platform/billing/pay*.functions.ts` |

The two scopes never import each other and never call each other's DB functions
(`tests/architecture/max-boundaries.test.ts`, rules U17-B2 / B3). A store reference is "unknown" on the
platform route and the reverse. In the production pilot the platform scope is off at every entry point.

Shared, scope-free code: `provider.ts`, `registry.ts`, `redact.ts`, `max/protocol.ts`, `max/messages.ts`,
`server/http.ts`, `server/env.ts`, `server/crypto.ts`, `server/db.ts`.

## 2. Store flow, step by step (who owns what)

| Step | Code | DB function | What it guarantees |
| --- | --- | --- | --- |
| Is card payment offered? | `server/tenant/checkout.ts`, `src/lib/online-payments.server.ts` | `max_payments_active(_tenant, _actor)` | the database decides; the UI only shows the answer |
| Open an attempt | `server/tenant/checkout.ts` | `max_attempt_open` | order belongs to the caller, is pending / awaiting / online, amount from the order (never from the client), one live attempt per order, refused while the order is busy or held |
| Read the terminal's credentials | `server/tenant/credentials.ts` | `max_attempt_secrets` | tokens of *that attempt's* terminal and mode; a VERIFY lease so two servers never verify the same attempt at once |
| SIGN | `max/protocol.ts` → `server/http.ts` | `max_attempt_signed` | fixed parameter order; echo validated; attempt moves to `redirected` |
| Redirect | `src/routes/checkout_.pay.$orderId.tsx` | — | the browser gets only Hyp's signed string |
| Return | `server/tenant/return.ts` | `max_attempt_record_return`, `max_return_keep` | host's store must equal the attempt's store; unsigned returns refused; payload hash recorded; raw return sealed for a later VERIFY; **the order is held from this moment** |
| VERIFY + settle | `server/tenant/return.ts` | `max_attempt_mark_paid` | the only place that marks an order paid online |
| Retry / expire / purge | `server/tenant/jobs.ts`, `src/server/services/payment-expiry.ts` | `max_attempts_pending_verify`, `max_attempts_expire`, `platform_payment_returns_purge` | unverified returns retried; then parked for a person; raw returns deleted within 2 hours |
| Alerts | `server/tenant/alerts.ts` | `max_review_alerts_claim` | one alert per review reason, claimed with `FOR UPDATE SKIP LOCKED` |
| Staff actions | `server/tenant/staff.ts`, `src/lib/online-payments-staff.functions.ts` | `max_attempt_cancel`, `max_review_resolve`, `max_order_payment_status` | review resolved with an explicit outcome (`not_charged` / `charged`) |
| Terminal administration | `server/tenant/admin.ts`, `server/tenant/owner.ts` | `platform_store_terminal_save`, `platform_store_terminal_verified`, `max_account_status`, `max_store_settings_save` | see §4 |

The platform flow mirrors this with `platform_*` functions; terminal changes there also need an e-mailed
step-up code (`server/stepup.ts`, purpose literal `platform_terminal_change`).

## 3. Separation of stores, terminals and keys

- **One account per store and provider** (`payments.tenant_accounts`), one platform account per provider.
- **One terminal number = one scope and one store.** `payments.terminal_registry` refuses a number already
  bound elsewhere — for another store or for the platform, in any order.
- **Credentials are sealed per owner.** `server/crypto.ts` (AES-256-GCM) binds every token to its scope, owner
  (store id, or the fixed platform account id), field, mode and key id as authenticated data; a token copied
  to another store, scope, field or mode does not open. The database stores only tokens (a CHECK on the token
  shape, `key_id` column) and never sees a clear value.
- **The attempt pins its terminal.** SIGN, VERIFY and settlement use the terminal number and mode stored on
  the attempt; changing a store's terminal while an attempt is in flight needs `force` and parks those
  attempts (`credentials_changed`).
- **The request's store must match.** The return route resolves the store from the host and refuses a return
  whose attempt belongs to another store (`wrong_host`). Note `tenant_for_host` falls back to the default
  store for unknown hosts — tests always use a non-default store as the main actor so this cannot hide a bug.
- **No client-side terminal data.** No server function returns `KEY`, `PassP` or a full terminal number;
  status reads give at most a short hint. In the owner-decided model the store owner gets only "on / off".

## 4. Who may configure a terminal

Owner decision 2026-11-28 (implementation tracked in contract §7.2):

- The platform admin enters a store's terminal in platform management, under that store
  (`platform_store_terminal_save`). The store owner neither sees nor edits terminal number or keys.
- Which stores may use online payment at all is decided in the database by store id (the pilot allow-list),
  written only by a person with SQL — no API role and no function writes it.
- Stores outside the list: "הסליקה בקרוב" in checkout and admin; server and database both refuse.
- Currently one store is allowed (the one served at `nuriel-shop.nuri1.fit`), with a test terminal only.

## 5. Double charges, late returns, unverified payments

These are database rules; the application cannot bypass them. Change them only in migration 208 with SQL tests.

- **Idempotent settle.** `max_attempt_mark_paid` is keyed by attempt reference + payload hash; an exact replay
  changes nothing and skips VERIFY. Amount, currency, installments, terminal and transaction id are checked in
  SQL against the attempt.
- **One live attempt per order**, and no new attempt while an earlier one is *busy* (`payments.tenant_order_busy`
  / `payments.platform_target_busy`): returned and not yet verified, in an unresolved review, or
  failed / expired / cancelled with a late return nobody verified.
- **Hold at the first return.** Recording a signed return clears the order's `payment_due_at`, so
  `expire_unpaid_orders` (unchanged) cannot cancel it or free its stock, whatever the application does. The
  hold ends only by: paid; a VERIFY-confirmed decline (`payments.release_order`); or a person's decision.
- **Unverified ≠ declined.** A timeout, an HTML answer, a non-zero VERIFY: nothing changes, the tick retries;
  the 6th failed try or 90 minutes parks the attempt (`needs_review`, `verify_exhausted`).
- **Second charge.** A different approved return for a concluded attempt is verified with that attempt's
  terminal and recorded as `duplicate_charge` (kept in `extra_txn_ids`), never swallowed.
- **Money that may have moved without a plain approval** — return codes `10`, `600`, `700`, `800`, a standing
  order (`HKId`), a multi-transaction (`MULTI`), a document number (`Hesh`) — goes to review, never "failed".
- **A person's decision is per attempt and is not proof about the future.** `not_charged` releases the order;
  `charged` keeps it held for manual handling. A later return or charge on that attempt reopens the review
  and alerts again; an answer on one attempt never changes another attempt's decision (contract §7.1b).
- **Every held order must have an alert and a handling route** — invariant checked at the end of the SQL suite.

## 6. DEMO, pilot and production

Two independent markers must agree before anything happens:

| | Application | Database |
| --- | --- | --- |
| Marker | `PAYMENTS_ENV` (`server/env.ts`) | `payments.environment.name`, set by a person with SQL |
| Check | `paymentsEnv()`, `paymentsReady(scope)` | `payments.app_env_ok(_app_environment)` in every money function |

- Unset or unknown marker → payments off, everything else in the site unchanged.
- `demo`: test terminals only (`00100…`), mode `test`, ₪50 cap; refused on the production platform host; a
  database once marked `demo` never becomes production.
- `production`: live terminals only; accepted only on the production platform host (`PRODUCTION_PLATFORM_HOST`).
- `pilot` (contract §7.2, when merged): production site + test terminals + the per-store allow-list + platform
  scope off. Do not assume it exists in a branch without checking `PaymentsEnv` in `server/env.ts`.
- The mock endpoint (`MAX_PAY_TEST_URL`) is honoured only for a loopback URL **and** a `*.localhost` platform
  host; the server prints one line at start (`paymentsStartupLine()`) with codes only, never a value.
- `PAYMENTS_JOBS=off` stops the periodic work (tests, emergencies). With it off nothing is retried, parked or
  alerted — never leave it off on a server that takes payments.

## 7. Security, logs and RLS

- **Schema `payments`**: no role has USAGE; every table has RLS enabled and all privileges revoked from
  `PUBLIC`, `anon`, `authenticated` and `service_role`. Nothing reads or writes these tables directly.
- **API = `SECURITY DEFINER` functions in `public`** with `search_path = ''`, executable by `service_role`
  only. The two exceptions an `authenticated` user may call are owner reads (`platform_card_my_options`,
  `platform_card_my_payments`); they authorise the caller inside the function.
- **Every function takes the store explicitly** and checks it; the server calls them through
  `server/db.ts` (`paymentsRpc`), whose allow-list regex is the only door.
- **Guards as triggers**: environment transitions, account mode / terminal rules, attempt state machine
  (`attempts_guard`), the lock on a paid online order's lines and total (`order_items_a_payment_lock`).
- **Audit**: `tenant_config_audit`, `platform_config_audit` record who changed what by field name only.
- **Logs**: only through `server/tenant/log.ts` / `server/platform/log.ts`, which pass everything through
  `redactPaymentText`. Log codes and short ids; never a request URL, a return query, a credential, a card
  detail or a customer field. Lines that need a person start with `ALERT`.
- **Browser**: return routes are GET-only and answer `303` + `no-store` + `no-referrer`; payment pages reach
  server code only by dynamic import inside a handler; no secret-bearing module is in the client bundle.
- **Scans** (`scripts/security/`): `scan-secrets.mjs` modes `bundle`, `logs`, `artifacts`, `repo`;
  `scan-db.mjs` for the database; canaries from the E2E mock prove that a leaked fake credential would be
  caught. Fake values that tracked files may contain are declared in `declared-fakes.json`.

## 8. Things that look tempting and are wrong

- Marking an order paid from the return route, a staff action or a script. Only the settle function does it.
- Treating a non-zero VERIFY as "declined" and releasing the order.
- Re-serialising Hyp's signed string or the payer's return (order and encoding are part of the signature).
- Reading "the store's current terminal" at VERIFY time instead of the attempt's terminal.
- A new Hyp action (`soft`, refunds, tokens …), an error URL in the portal, or an iframe.
- Returning terminal data to the store owner's browser "for convenience".
- A second sender of review notifications (only the alert claim rings).
- Editing `expire_unpaid_orders`, Bit / Grow / POS code, or anything under `deploy/` for a payment fix.

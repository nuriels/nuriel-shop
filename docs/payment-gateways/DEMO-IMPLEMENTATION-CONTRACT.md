# MAX/Hyp DEMO — implementation contract (D1–D5)

Status: binding for the DEMO implementation (2026-11-28). Source of truth for module boundaries, function
signatures, names and file ownership. Based on `MAX-DEMO-PLAN.md` v2 (approved decisions ה-1…ה-8) and
`evidence/demo/*`. Any deviation must be written in the implementer's report and in this file.

## 0. Approved scope and hard limits

- Owner approved: D1–D5; migration 208 applied to the **local** test DB and **CI** only.
- Not approved (never do): requests to any Hyp payment/API host (`pay.hyp.co.il`); a DEMO server; any
  production change, deploy or migration; real cards or charges; refunds/cancellations, invoices, SmartBee,
  tokens/recurring; 3DS (do not implement or configure; leave a clean extension point only, no SMS mechanism);
  changes to `platform/crawl-parity`; deleting Grow code; changing historical data.
- Never open or print `.env` files, `deploy/setup-selfhost.sh`, `docs/seo-engine/ISTORES-COMPARISON.md`, the
  Yaad Sarig plugin sources. `.env.example` may be **appended** to (names + comments, no values) without reading it.
- No new npm packages. No secrets, card numbers, sample terminal numbers or published test cards in git.
- Gender-neutral Hebrew in UI text.

## 1. Approved decisions (plan v2 §10)

| # | Decision |
| --- | --- |
| ה-1 | Separate DEMO server later (not now) |
| ה-2 | Three test terminals: platform, store A, store B (mock has the same three + one "live-shaped") |
| ה-3 | Platform DEMO purchase = pay one open `billing.ledger` **charge** (`target_kind='ledger_charge'` only). No add-on path, no activation |
| ה-4 | No test mode in production. Remove the test-user allow-list (`payments.test_users`, `platform_payment_tester_*`, `test_access='allow_list'`). Production: `live` only, `00100…` refused. DEMO: `test` only, `00100…` required |
| ה-5 | Two root secrets per environment: `PAYMENTS_SECRETS_KEY` (stores) and `PLATFORM_TERMINAL_SECRETS_KEY` (NURIEL) |
| ה-6 | No Hyp documents: never send invoice params; a returned `Hesh`/`HeshASM` (non-empty and not `0`) → `needs_review` reason `document_issued` |
| ה-7 | CI changes per plan §7.8 |
| ה-8 | Only the store owner (protected, unblocked admin of that store; never a platform admin) pays the platform |

## 2. Names

| Thing | Name |
| --- | --- |
| Scopes | `platform`, `tenant` |
| Modes | `test`, `live` |
| Provider id | `max` |
| Order payment method | `online` |
| App environment marker | env `PAYMENTS_ENV` ∈ {`demo`,`production`}; DB `payments.environment.name` |
| Root secrets | `PAYMENTS_SECRETS_KEY` (tenant), `PLATFORM_TERMINAL_SECRETS_KEY` (platform). ≥ 32 chars, different from each other and from other app secrets, no fallback |
| Payment jobs switch | `PAYMENTS_JOBS` ∈ {`on` (default), `off`}: forwarded by compose (operational kill switch); E2E sets `off` and triggers jobs from the test |
| Scan canaries | E2E writes the run's fake secrets (one per line) to `e2e/test-results/hyp-canaries.txt`; scanners take `--canaries <file>` |
| Test-only hook | `MAX_PAY_TEST_URL` (mock base URL). Honoured only for `http://127.0.0.1…`/`http://localhost…` **and** `PLATFORM_ADMIN_HOST` = `localhost` or `*.localhost`. Listed in `TEST_ONLY` of `tests/unit/env-forwarding.test.ts`, never in `docker-compose.yml` |
| Production platform host (code constant) | `nuriel.nuri1.fit` — `PAYMENTS_ENV=production` is refused unless `PLATFORM_ADMIN_HOST` equals it |
| Hyp endpoint (code constant) | `https://pay.hyp.co.il/p/` |
| Feature flags (`platform_feature_flags`) | `max_payments` (tenant scope), `platform_terminal_payments` (platform scope) |
| Tenant return route | `GET /payments/return/max` — store hosts only (refuses `isPlatformRequest()`) |
| Platform return route | `GET /platform/payments/return/max` — platform host only (`/platform/*` is already 403 on store hosts) |
| Naming bans | public function bodies/names must not match `remove-hyp.test.sql:63` regex `(hyp_|payment_intent|tenant_payment_secrets|platform_settings|card_payments_|card_clearing|platform_payments_|checkout_payment_request|payment_token)`; no new `my_billing_*`/`platform_billing_*` functions (`billing-agreements.test.sql:116-121` pins exactly 14); no `payments_ready` key in `store_billing()`/`addons_store()`; check every other name-pattern assertion in `scripts/db-tests/*.sql` |

## 3. File layout and ownership

Secret-touching code lives under a `server/` folder: Vite import protection only covers `**/server/**`
(`vite.config.ts`, finding MX-09). Owners write only their files; the lead integrates.

| Path | Owner (wave) | Content |
| --- | --- | --- |
| `src/platform/payments/provider.ts` | protocol (1) | shared types (pure) |
| `src/platform/payments/registry.ts` | protocol (1) | `PROVIDERS = { max }` (pure) |
| `src/platform/payments/max/protocol.ts` | protocol (1) | SIGN/VERIFY builders and parsers (pure, no secrets, no I/O) |
| `src/platform/payments/max/messages.ts` | protocol (1) | fixed Hebrew text per outcome / `CCode` class |
| `src/platform/payments/redact.ts` | protocol (1) | the single redactor for payment log lines |
| `src/platform/payments/server/http.ts` | protocol (1) | Hyp HTTP client (timeout, size cap, HTML detection, no URL logging) |
| `src/platform/payments/server/env.ts` | security (1) | environment guard, endpoint, mock-override guard, key sanity |
| `src/platform/payments/server/crypto.ts` | security (1) | AES-256-GCM + HKDF primitives (key passed in) |
| `src/platform/payments/server/tenant-keys.ts` | security (1) | tenant root key, HKDF label, AAD |
| `src/platform/payments/server/platform-keys.ts` | security (1) | platform root key, HKDF label, AAD, step-up key |
| `src/platform/payments/server/stepup.ts` | security (1) | action-bound email OTP for editing the platform terminal |
| `scripts/security/*` | security (1) | bundle / log / DB / repo / artifact scanners with positive controls |
| `supabase/migrations/2026112810xxxx_online_payments_foundation.sql` (+ rollback) | db (1) | migration 208 |
| `scripts/db-tests/online-payments*.test.sql`, `scripts/db-tests/online-payments-concurrency.sh`, rollback guard/check lines, `db-classification` regeneration | db (1) | DB tests |
| `e2e/scripts/mock-hyp.mjs` (+ hook in `mock-services.mjs`), `e2e/scripts/app-up.sh`, `.github/workflows/tests.yml`, `tests/unit/env-forwarding.test.ts`, `docker-compose.yml` (names), `.env.example` (append names) | testing (1) | mock + CI |
| `tests/architecture/max-boundaries.test.ts` | architecture (1) | U17 rules |
| `src/platform/payments/server/tenant/*`, `src/lib/online-payments*`, tenant routes/components, checkout changes, `src/server/services/payment-expiry.ts` | architecture (2) | D4 |
| `src/platform/payments/server/platform/*`, `src/platform/billing/pay*`, platform routes/components, `MyBillingCard.tsx` | architecture (2) | D5 |
| `src/integrations/supabase/types.ts` additions for the new RPCs | architecture (1/2) | typed RPCs |
| `e2e/tests/payments-*.spec.ts` | testing (3) | E2E |

## 4. TypeScript contracts (wave 1 implements; wave 2 consumes exactly these)

```ts
// src/platform/payments/provider.ts
export type PaymentScope = "platform" | "tenant";
export type PaymentMode = "test" | "live";
export type ProviderId = "max";
export type MinorAmount = number;                 // integer agorot, > 0
export interface MaxCredentials { masof: string; key: string; passp: string }   // never logged
export interface SignInput {
  amountMinor: MinorAmount; order: string;        // order = attempt reference (32 hex)
  moreData: boolean;                              // DEMO: true
  client?: { firstName?: string; lastName?: string; email?: string; cell?: string };
}
export type ReturnFlag = "document" | "hk" | "multi";

// src/platform/payments/max/protocol.ts (pure)
export function buildSignParams(creds: MaxCredentials, input: SignInput): [string, string][];
export function encodeParams(pairs: [string, string][]): string;          // application/x-www-form-urlencoded
export type SignResult = { ok: true; payUrl: string; echo: Record<string, string> }
                       | { ok: false; code: "html" | "ccode" | "no_signature" | "no_action_pay" | "secret_echo" | "mismatch" | "malformed"; ccode?: string };
export function validateSignResponse(body: string, sent: { masof: string; amountMinor: number; order: string; moreData: boolean }, endpoint: string): SignResult;
export type ParsedReturn = {
  ok: true; raw: string;                         // query string exactly as received (no leading "?")
  pairs: [string, string][];                     // original order
  ccode: string | null; id: string | null; order: string | null; amountMinor: number | null;
  coin: string | null; payments: number | null; acode: string | null; brand: string | null; last4: string | null;
  flags: ReturnFlag[];                           // document (Hesh/HeshASM non-empty and not "0"), hk (HKId), multi (MULTI)
} | { ok: false; reason: "empty" | "too_long" | "duplicate_key" | "reserved_key" | "malformed" };
export function parseReturnQuery(raw: string): ParsedReturn;              // rejects duplicate keys and KEY/PassP/action/What
export function buildVerifyQuery(creds: MaxCredentials, rawReturn: string): string; // action,What,Masof,KEY,PassP + raw return unchanged
export type VerifyResult = { verified: boolean; ccode: string | null; html: boolean };
export function classifyVerifyResponse(body: string): VerifyResult;       // verified only if CCode is exactly "0"
export type ReturnOutcome = "approved" | "hold" | "declined";            // hold = 600/700/800
export function classifyReturnCcode(ccode: string | null): ReturnOutcome;
export function decimalToMinor(v: string): number | null;                 // "10", "10.5", "10.00" → 1000/1050/1000; else null
export function minorToDecimal(v: number): string;                        // 1050 → "10.50"

// src/platform/payments/server/http.ts
export type HypHttpResult = { ok: true; status: number; body: string; html: boolean }
                          | { ok: false; error: "timeout" | "network" | "too_large" };
export function hypRequest(endpoint: string, query: string, opts?: { method?: "GET" | "POST"; timeoutMs?: number; maxBytes?: number }): Promise<HypHttpResult>;
//  endpoint = hypEndpoint() from env.ts, passed in by the caller (no import between the two modules);
//  never logs/throws the URL or body; no retry inside (the caller decides)

// src/platform/payments/redact.ts
export function redactPaymentText(s: string): string;  // masks KEY, PassP, zPass, Sign/signature, Masof→last 2, card-like fields

// src/platform/payments/server/env.ts
export type PaymentsEnv = "demo" | "production";
export const PRODUCTION_PLATFORM_HOST = "nuriel.nuri1.fit";
export const HYP_ENDPOINT = "https://pay.hyp.co.il/p/";
export function paymentsEnv(): PaymentsEnv | null;     // null = payments off (missing/invalid, or production on a non-production host)
export function hypEndpoint(): string;                 // HYP_ENDPOINT unless the guarded MAX_PAY_TEST_URL applies
export function paymentsReady(scope: PaymentScope): { ok: true; env: PaymentsEnv } | { ok: false; reason: string };
//  checks env + the scope's root secret (length ≥ 32, the two roots differ, not equal to other known secrets, no fallback)

// src/platform/payments/server/crypto.ts
export function hkdfKey(root: string, info: string): Buffer;               // HKDF-SHA256, salt "nuriel-payments", 32 bytes
export function seal(key: Buffer, plaintext: string, aad: string, kid: string): string;  // "v1:<kid>:<b64url iv>:<b64url tag>:<b64url ct>"
export function open(key: Buffer, token: string, aad: string): string;     // throws a fixed Error on any failure

// src/platform/payments/server/tenant-keys.ts / platform-keys.ts
export function tenantSecretCipher(env: PaymentsEnv, mode: PaymentMode): { kid: string; seal(field: string, value: string, ctx: { tenantId: string; accountId: string }): string; open(field: string, token: string, ctx: { tenantId: string; accountId: string }): string };
export function platformSecretCipher(env: PaymentsEnv, mode: PaymentMode): { kid: string; seal(field: string, value: string, ctx: { accountId: string }): string; open(field: string, token: string, ctx: { accountId: string }): string };
//  HKDF info: "nuriel/payments/v1/<env>/<scope>/<mode>"; AAD: "<env>|<scope>|<tenant or 'platform'>|max|<mode>|<accountId>|<field>|<kid>"
export function stepupKey(env: PaymentsEnv): Buffer;   // HKDF(PLATFORM_TERMINAL_SECRETS_KEY, "nuriel/payments/v1/<env>/platform/stepup")

// src/platform/payments/server/stepup.ts (pure helpers + a service that receives its DB caller)
export function stepupPurposeHash(actorId: string, purpose: "platform_terminal_save", payload: unknown): string;
export function stepupCodeHmac(key: Buffer, challengeSeed: string, code: string): string;
export type StepupRpc = (fn: "platform_stepup_issue" | "platform_stepup_consume", args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export function createStepupService(rpc: StepupRpc, key: Buffer): {
  issue(actorId: string, purposeHash: string): Promise<{ challengeId: string; code: string; expiresAt: string }>; // 6 digits; DB keeps only the HMAC
  consume(actorId: string, challengeId: string, purposeHash: string, code: string): Promise<{ ok: boolean; reason?: string }>;
};
```

## 5. DB API of migration 208 (wave 1 implements; wave 2 calls exactly these)

Base: `evidence/demo/04b-proposed-ddl-demo.sql.txt` with the deltas of plan §5.4. All are `SECURITY DEFINER`,
`SET search_path = ''`, `EXECUTE` for `service_role` only, unless marked **auth** (then `authenticated` too;
those never take `_actor`). Every function that takes `_actor` must never be granted to `authenticated`.

| Function | Change vs 04b |
| --- | --- |
| `max_payments_active(_tenant uuid, _actor uuid DEFAULT NULL) → boolean` | — |
| `max_order_access_issue(_tenant uuid, _order uuid, _token_sha256 text) → boolean` | — |
| `max_attempt_open(_tenant uuid, _order uuid, _customer uuid, _guest_token_sha256 text, _app_environment text) → jsonb` | test cap ₪50 |
| `max_attempt_secrets(_tenant uuid, _attempt uuid, _purpose text) → jsonb` | — |
| `max_attempt_signed(_tenant uuid, _attempt uuid, _ok boolean, _code text) → jsonb` | — |
| `max_attempt_record_return(_host_tenant uuid, _reference text, _payload_sha256 text, _ccode text, _txn_id text, _amount_minor bigint, _installments integer) → jsonb` | — |
| `max_attempt_mark_paid(_tenant uuid, _reference text, _payload_sha256 text, _verify_ccode text, _ccode text, _terminal text, _txn_id text, _amount_minor bigint, _currency text, _installments integer, _approval_code text, _card_brand text, _card_last4 text, _return_flags text[], _app_environment text) → jsonb` | **+ `_return_flags`**; 600/700/800/`hk`/`multi` → `needs_review` `unexpected_hold`; `document` → `needs_review` `document_issued` |
| `max_attempts_expire() → integer` | — |
| `max_attempt_cancel(_actor uuid, _tenant uuid, _order uuid) → integer` | — |
| `max_review_resolve(_actor uuid, _tenant uuid, _attempt uuid, _note text) → boolean` | — |
| `max_order_payment_status(_tenant uuid, _order uuid, _viewer uuid, _guest_token_sha256 text) → jsonb` | — |
| `max_account_status(_actor uuid, _tenant uuid) → jsonb` | terminal hint = last 2 digits |
| `max_store_settings_save(_actor uuid, _tenant uuid, _max_installments integer, _min_installments_amount_minor bigint, _allowed_methods text[], _allowed_brands text[]) → jsonb` | DEMO: `_max_installments` must be 1 |
| `max_unreturned_attempts(_actor uuid, _tenant uuid, _limit integer DEFAULT 50) → jsonb` | **new** (redirected, never returned) |
| `platform_store_terminal_save(_actor uuid, _tenant uuid, _patch jsonb, _app_environment text) → jsonb` | production rule (decision ה-4) |
| `platform_store_terminal_verified(_actor uuid, _tenant uuid, _ok boolean, _code text) → jsonb` | — |
| `platform_store_terminal_check_secrets(_actor uuid, _tenant uuid) → jsonb` | — |
| `platform_attempt_open(_actor uuid, _tenant uuid, _target_kind text, _target_id uuid, _return_origin text, _app_environment text) → jsonb` | **+ `_return_origin`** (validated against the tenant's hosts); `ledger_charge` only; test cap |
| `platform_attempt_secrets(_attempt uuid, _purpose text) → jsonb` | — |
| `platform_attempt_signed(_attempt uuid, _ok boolean, _code text) → jsonb` | — |
| `platform_attempt_record_return(_reference text, _payload_sha256 text, _ccode text, _txn_id text, _amount_minor bigint, _installments integer) → jsonb` | — |
| `platform_attempt_mark_paid(_reference text, _payload_sha256 text, _verify_ccode text, _ccode text, _terminal text, _txn_id text, _amount_minor bigint, _currency text, _installments integer, _approval_code text, _card_brand text, _card_last4 text, _return_flags text[], _app_environment text) → jsonb` | **+ `_return_flags`** (as tenant) |
| `platform_attempts_expire() → integer` | — |
| `platform_card_payment_resolve(_actor uuid, _attempt uuid, _note text) → boolean` | — |
| `platform_card_payments(_actor uuid, _tenant uuid DEFAULT NULL, _limit integer DEFAULT 100) → jsonb` | — |
| `platform_unreturned_attempts(_actor uuid, _limit integer DEFAULT 50) → jsonb` | **new** |
| `platform_card_my_payments() → jsonb` **auth** | renamed from `my_billing_card_payments` |
| `platform_card_my_options() → jsonb` **auth** | renamed from `my_billing_card_options` |
| `platform_terminal_save(_actor uuid, _patch jsonb, _app_environment text) → jsonb` | renamed from `platform_billing_terminal_save`; the app requires a consumed step-up challenge first |
| `platform_terminal_verified(_actor uuid, _ok boolean, _code text) → jsonb` | renamed |
| `platform_terminal_check_secrets(_actor uuid) → jsonb` | renamed |
| `platform_terminal_status(_actor uuid) → jsonb` | renamed |
| `platform_stepup_issue(_actor uuid, _purpose_hash text, _code_hmac text) → jsonb` | **new**: `{challenge_id, expires_at}`; 10 min; platform admins only |
| `platform_stepup_consume(_actor uuid, _challenge uuid, _purpose_hash text, _code_hmac text) → jsonb` | **new**: `{ok, reason}`; ≤ 5 tries; single use |
| `platform_payment_unknown_return(_scope text, _host text, _payload_sha256 text) → boolean` | **new** (L1): records a return with no matching attempt; no PII |
| `max_return_keep/max_return_get/platform_return_keep/platform_return_get/platform_payment_returns_purge` | decision 14; **inside the same single transaction** |
| `platform_payment_tester_set`, `platform_payment_testers` | **removed** (ה-4) |

Other DDL deltas (plan §5.4): no `demo → production` switch ever; paid online order: total and lines locked
for everyone (staff included) until a refund path exists; terminal hint = last 2 digits; test amount cap
₪50 in both attempt tables; no `addon_request` target; `payments.test_users` and `test_access='allow_list'`
removed; production accounts: `live` only and `00100…` refused; one `BEGIN … COMMIT`.

## 6. Test IDs

Use the `DM-*` IDs of plan Appendix D in test names (e.g. `it("DM-PAY-7: …")`), so the final report can map
every DEMO-blocking control to a test that actually ran.

## 7. Recorded deviations and lead decisions (during implementation)

Each line below is binding from the commit that records it. Wave-2 code follows these, not the older text above.

| # | Where | Decision | Why |
| --- | --- | --- | --- |
| X-1 | `parseReturnQuery` | `Masof` is a reserved return name too (`reserved_key`) | `buildVerifyQuery` sends its own `Masof`; a second one in the raw return would make VERIFY ambiguous. No documented redirect carries it. Fail closed |
| X-2 | `classifyVerifyResponse` | verified only when the **whole body** is `CCode=0` (one trailing CR/LF allowed) | evidence 01 §1.5: anything else, extra keys included, is not verified |
| X-3 | `validateSignResponse` | the echoed `Amount` is compared as agorot; any echoed parameter we never send that changes the page (installments, J5, recurring, invoice, e-mail…) is a `mismatch` | within "echo mismatch", stated for clarity |
| X-4 | `classifyReturnCcode` + both DB `mark_paid` functions | CCode **`10`** ("Partial approval", Shva) joins 600/700/800: `hold` → `needs_review` `unexpected_hold`, never `failed`, never paid | money may have moved; a decline would release the order while the customer was charged |
| X-5 | additions (no signature changed) | `Capabilities.hostedPage`, `isProviderId`, `MaxProtocolInputError`, `SIGN_PARAM_ORDER`, `RETURN_MAX_LENGTH`, `HYP_HTTP_DEFAULTS`, the messages API; the redactor also masks Fild1–3, street, city, zip, UID, terminal_number | protocol agent report |
| X-6 | `server/env.ts` | new export `paymentsStartupLine()` — one fixed line `[payments] env=… endpoint=… tenant=… platform=…`, codes only, never a value; logged once at server start (wave 2 wires it) | lets the DEMO server prove the env guard on the built image (`deploy/demo/demo-check.sh --proofs`) |
| X-7 | imports | `max/protocol.ts` and `redact.ts` contain `PassP` / `APISign` literals: import them **only from server code** (`**/server/**`); `messages.ts` and `registry.ts` are client-safe | the bundle scan (DM-SEC-1) must stay at zero |
| X-8 | encryption context | `accountId` = tenant id (store terminal), `PLATFORM_ACCOUNT_ID = "platform"` (NURIEL's terminal), attempt id (encrypted raw returns). The DB returns no account row id; one tenant account per (tenant, provider), one platform account per provider | one DB call per save; a token copied to another store, scope, field, mode, env or attempt fails to open |
| X-9 | token storage | the DB keeps each token's kid in `key_id text` (8 lowercase hex) and checks `^v1:[0-9a-f]{8}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]+$` with kid = key_id; save patch key `key_id` | matches `crypto.ts` exactly |
| X-10 | return handlers (both scopes) | VERIFY is skipped only for an **exact replay** (same payload hash). A different approved return for a concluded attempt is verified with that attempt's terminal and settled → the DB marks `duplicate_charge` (needs_review + alert) | M06: a second charge must surface, not be swallowed |
| X-11 | return handlers (both scopes) | a return without a non-empty `Sign` is refused before any VERIFY (`returnHasSignature`) | U3: no VERIFY for a return Hyp could not have signed |
| X-12 | DEMO notice | no site-wide bar; `DemoBanner` is an inline note rendered only inside the online-payment surfaces when the server reports `demo` | CI run 210: a global sticky bar changed every existing page (screenshots, axe region, phone menu) |
| X-13 | DB API additions | `max_attempts_pending_verify(_limit)`, `platform_attempts_pending_verify(_limit)`; platform record_return / mark_paid return `return_origin` (validated: origin only, https except `localhost`/`*.localhost`, same tenant); `max_order_payment_status` adds `attempt_id` + `review_reason` for staff / platform admins | architecture agent's design questions Q3–Q5 |

### 7.1 Fix round 3 (second independent review R2-1…R2-11 and N1–N3 of the first)

Binding like the lines above. The findings are in `evidence/demo/` (review notes) and in the release notes.

| # | Where | Decision | Why |
| --- | --- | --- | --- |
| X-14 | DB `max_attempt_record_return`, `max_attempt_mark_paid`, new `payments.release_order` | **The order is held in the DB at the first recorded signed return** (`payments.hold_order`: `payment_due_at := NULL`), whatever the application does afterwards. No "+2 hours" extension any more. The hold ends only by: a paid result; a **VERIFY-confirmed** decline (`CCode=0` from VERIFY and a non-hold return code) → `payments.release_order`; or a person's review decision (X-16). `release_order` sets `payment_due_at := LEAST(now() + 2 hours, created_at + 24 hours)` and only when the order is still `pending`/`awaiting`/`online` and not busy (X-15). A cap already in the past means the order expires at the next tick | R2-2 HIGH: `expire_unpaid_orders` ran while the payment jobs were off / not ready and cancelled an order whose return was never verified. The database now refuses that by itself; `expire_unpaid_orders` stays byte-identical |
| X-15 | DB new `payments.tenant_order_busy(_order)`, used by `max_attempt_open` and `release_order` | busy = an attempt of the order is `returned`; or `needs_review` and unresolved; or `failed`/`expired`/`cancelled` with `returned_at` set, an unverified return and no resolved review. `max_attempt_open` refuses a busy order (the same rule as `platform_target_busy`) | R2-1: a second store payment was possible while a late return of an earlier attempt was unverified → two charges |
| X-16 | DB `max_review_resolve(_actor, _tenant, _attempt, _note, _outcome)` (the 4-argument form is dropped), new column `tenant_attempts.review_outcome` | `_outcome` is `'not_charged'` or `'charged'`. It is **required** when the attempt's order is still `pending`/`awaiting` (held); otherwise it may be NULL. `not_charged` → the review is resolved and the order is released (`release_order`): it can be paid again or expires normally. `charged` → the review is resolved and the order **stays held**: never expired, never payable online again; the store handles it by hand (cancel + refund in the Hyp portal). A VERIFY that Hyp rejected is still "unverified" (we cannot tell a forged return from stale credentials until Hyp answers Q7) | R2-3 / N2: one forged return pinned an order for ever. R2-8 / N3: resolving a review left the order stuck. Now a person's decision always ends the hold; the alert of X-17 makes sure a person sees it |
| X-17 | DB new columns `tenant_attempts.review_alerted_at`, `platform_attempts.review_alerted_at`; new `max_review_alerts_claim(_limit)` and `platform_attempt_review_alerts_claim(_limit)` (service_role only) | every attempt that gets a `review_reason` — by a settle result, by the sweep, by the purge, by a credentials change — is alerted **exactly once per reason** (a reason that changes, e.g. `amount_mismatch` → `duplicate_charge`, re-arms the alert): the claim function returns the rows whose `review_alerted_at` is NULL and stamps them (`FOR UPDATE SKIP LOCKED`). The application calls the claim after every handled return and in every tick, and sends the store bell + e-mail (store) or the platform e-mail (platform) + one `ALERT` log line per claimed row. No other code path rings for a review | R2-7: parking by the sweep / purge produced no bell, e-mail or ALERT. N1: the bell rang on every 5-minute retry |
| X-18 | `platform/return.ts` | a platform return is **recorded first** (`platform_attempt_record_return`), then readiness is checked; not ready → no VERIFY, one `ALERT`, the charge stays not payable (`platform_target_busy`) and the sweep parks it | R2-4: the return was dropped when payments were not ready and the owner could pay the same charge again |
| X-19 | `payment-expiry.ts`, `tenant/jobs.ts`, `platform/jobs.ts` | tick order: `expire_unpaid_orders` first and independent of the payment jobs. `PAYMENTS_JOBS=off` stops every online-payment job. Jobs on but payments **not ready** → no VERIFY, but the DB-only steps still run: expiry / parking sweep, purge, alert claim. A settle result `unverified` writes an `ALERT` line | R2-9: Bit / Grow expiry waited behind up to 20 VERIFY calls. R2-2: nothing parked or alerted when payments were not ready |
| X-20 | `platform/terminal.ts` step-up intent; `platform/credentials.ts`; `tenant/credentials.ts` | the step-up purpose hash also covers a keyed commitment (HMAC with the step-up key) of each secret value being set; platform VERIFY gets the same terminal-prefix tripwire as the tenant side; the tenant `_card_brand` is lower-cased before the DB call | R2-6, R2-10 |
| X-21 | `scripts/db-tests/*` | the socket directory and the migration log path come from the environment (`KOBI_PGSOCKET`, default `/tmp/pg`; the log path gets the port in its name) | R2-11: parallel runs collided |

Accepted and documented, not changed: R2-5 (the DB `store_origin` slug rule follows `tenant_for_host`, which
ignores the base domain; the application allow-list `storeOriginOf` is the guard) — LOW, go-live item.
Open with Hyp (request draft, question 7): what VERIFY answers for an authentic **declined** transaction and for a
signature mismatch (S1), and which fields `Sign` covers (S2).

### 7.2 Production pilot (owner decision 2026-11-28: DEMO payments on the live site, one store only)

The owner approved running the MAX/Hyp integration on the production site with a Hyp **test** terminal, in the
owner's own store only. Everything above assumed a separate DEMO server and refuses this on purpose (`demo` is
refused on the production host; a production database refuses test terminals; a database marked `demo` can never
become production). The pilot is therefore a third, explicit state — not a relaxation of the two others.

| # | Where | Decision |
| --- | --- | --- |
| P-1 | DB `payments.environment` | new value **`pilot`** + `pilot_since`. Set by a person with SQL, like `demo` (no API role, no function writes it). `NULL → pilot` only on a database that never held a live terminal or a live payment and was never `demo`. `pilot → NULL` allowed (switch off; rows stay). `pilot → production`, `pilot ↔ demo`: refused in this release (go-live gets its own approved change). The rollback guard of 208 also stops once `pilot_since` is set |
| P-2 | DB new `payments.pilot_stores (tenant_id PK, added_at, note)` | the allow-list, by store id. Written only by a person with SQL (no grant, no API function). In `pilot`, a store **not** in the list cannot save a terminal account, is never "active" (`max_payments_active` false) and cannot open an attempt — refused in the database, not only hidden. A recorded attempt of a store that left the list still records its return and settles (no new payment) |
| P-3 | DB guards | `pilot` accepts **test** accounts only: mode `test`, terminal `00100…`, the ₪50 cap; `live` is refused exactly as in `demo`. One terminal belongs to one store (`terminal_registry`, unchanged) |
| P-4 | DB `max_payments_active(_tenant, _actor)`, `max_attempt_open` | in `pilot`, card payment exists only for **testers**: a signed-in user who has a staff role in that store (owner / admin / agent). Guests and ordinary customers: not offered, and refused by the database. A real customer of the live store can never reach the test terminal and "pay" without money moving |
| P-5 | DB platform functions, `paymentsReady('platform')` | the platform scope is **off** in `pilot`: saving the platform terminal, opening a platform attempt and `payable` are refused / false in the database; the application reports the platform side not ready (`pilot`) and its screens show "בקרוב" |
| P-6 | server only | in `pilot` the terminal number, KEY and PassP come **only from server environment variables** (`MAX_PILOT_TENANT_ID`, `MAX_PILOT_TERMINAL`, `MAX_PILOT_API_KEY`, `MAX_PILOT_PASSP`). At start the server provisions the store's account through a service-role DB function that exists only for this (`max_pilot_terminal_provision`): the two secrets are sealed with the tenant root key exactly as the admin save does, and stored as tokens. Every browser path that saves or clears a terminal is refused in `pilot` (server and DB). Nothing is logged but codes and short ids; the redactor masks the four names |
| P-7 | `server/env.ts` | `PAYMENTS_ENV=pilot` is accepted only on the production platform host, or on a `*.localhost` platform host (tests, with the loopback mock). `demo` stays refused on the production host; `production` unchanged. The endpoint in `pilot` on the production host is Hyp's; mode allowed: `test` only; the terminal-prefix tripwire requires `00100…`. Startup line: `env=pilot` |
| P-8 | stores outside the list | checkout: no card option. Store admin: the online-payment screen shows "הסליקה בקרוב" and no input; the server functions refuse. Same for every store while the database is unmarked |
| P-9 | switch off | removing `PAYMENTS_ENV` (application) or setting the marker to NULL (database) turns everything off at once; existing Bit / Grow / POS / manual flows do not depend on either |
| P-10 | out of scope | 3DS, refunds, recurring charges, tokens, invoices, SmartBee: no code path, unchanged |

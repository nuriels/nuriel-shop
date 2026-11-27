# MAX / Hyp Pay provider: security review (threat model, audit of existing code, secret scan)

> **Lead's note (added when this report was filed):** the brief told this agent that section 4 of `docs/seo-engine/ISTORES-COMPARISON.md` holds MAX/iStores terminal credentials. That pointer was wrong: section 4 of that file is "problems by severity" (SEO). One line of the file (line 36) contains a credential-like word; it was not displayed or assessed. See MX-20 and the main report §8.3.


**Scope.** Repo `(repo root)`, branch `payments/max-hyp`, HEAD `910b1f9`, clean tree. Everything was read-only: I changed no repo file, no git state, no DB, and made no call to Hyp or Grow.

**What I executed:**
- `git`/`grep` scans.
- A redacting Python scanner (the agent's redacting scanner (kept outside the repo)) over every git object and over the ignored files.
- A local `node` run of the repo's own `seroval` (MX-08).
- An inspection of the git-ignored build in `.output/`.

**Everything else is (code-reading).**

**Evidence from others:**
- MX-01 is confirmed by the lead's rolled-back probe (`evidence/04-probe-amount-drift.txt`).
- The CSRF scope matches the testing agent's report (`evidence/07-testing-plan.md:25`).
- I used the entity names of `evidence/05-architecture.md` (`payment_provider_accounts`, `payment_attempts`, `payment_returns`, `payment_attempt_settle`, `startOnlinePayment`, return `GET /payments/return/max`, result `/checkout/pay/:orderId`).

**What I did not print:** any secret value, terminal number or test card. `docs/seo-engine/ISTORES-COMPARISON.md` was excluded from every scan.

---

## 1. Verdict

1. **Blockers for MAX (they exist today in the Grow path):**
   - **MX-01 (High).** The order amount can change after payment starts, and again after it is paid.
   - **MX-02 (High).** A test-mode payment can mark a real order paid. Hyp publishes its test cards.
2. **Medium:**
   - **MX-03.** No provider confirmation and no unique transaction id (S-2 is still open).
   - **MX-04.** Superseded pages can still settle, and a second charge is labelled "paid late".
   - **MX-05.** `storeGate` and the rest window would block a store-host return. Hyp Pay has no notification, so the payment would be lost.
   - **MX-06.** The return URL's PII and `Sign` would reach the store's GA4 and Meta Pixel, the nginx access log, and a publicly cacheable 308.
   - **MX-07.** The staff email says "paid online" for an unpaid Grow order, and a customer can trigger it.
3. **Secret scan verdict: no real secret found.** This covers:
   - the tracked files;
   - the history of all 59 refs (505 commits including the reflog, the stash, and 94 unreachable blobs);
   - the in-repo logs and ignored files;
   - the client bundle.

   Every hit is a fixture, a placeholder, a public-by-design key, or a false positive. **One exception was not assessed:** `ISTORES-COMPARISON.md` (MX-20). It is in HEAD and on a pushed branch.

---

## 2. Findings

| ID | Sev | Evidence | Impact | Recommendation | Status |
|---|---|---|---|---|---|
| MX-01 | **High** | **What allows it:**<br>• The RLS policy `"order items insert"` lets a customer insert lines into their own `pending` order whatever its payment state (`supabase/migrations/20260928090000_order_integrity.sql:151-157`).<br>• No item trigger checks the payment state (`20261019120000_shipping_digital_variants.sql:654-847`), and the total is recomputed (`:244-255`).<br>• `grow_mark_paid` compares only `p.amount` (`20261019520000_grow_payments.sql:243`) and leaves `orders.status='pending'`.<br>**The lead's probe** (role `authenticated`, BEGIN…ROLLBACK):<br>• awaiting 100→300;<br>• paid 300→400, and the order stays `paid` (`probe-amount-drift.txt:67-84`). | A logged-in customer pays the small amount, before or after adding lines through PostgREST. The order shows "paid" with a bigger total and reserved stock, and staff ship unpaid goods.<br>A settle-time re-check alone misses lines added **after** payment. | **Make architecture decision D10 mandatory:**<br>• A trigger rejects INSERT, UPDATE and DELETE on `order_items`, and changes to total, shipping, coupon or discount, on online orders in `awaiting` or `paid`, outside the DEFINER path that settles or cancels.<br>• Settle also requires Hyp `Amount` = attempt amount = the current `order_amount_due`, in integer agorot.<br>• Show "paid amount" next to "total". | Open (confirmed) |
| MX-02 | **High** for MAX; Medium for Grow today | **Grow:**<br>• The webhook tries `_sandbox=false` and then `true` (`src/lib/grow-webhook.server.ts:37-56`).<br>• A process takes the store's current mode (`src/lib/grow-payments.functions.ts:105`).<br>• `grow_mark_paid` has no test-or-live check at order level (`…grow_payments.sql:213-274`), and nothing marks such an order (`docs/audit/GROW-VERIFICATION.md` §4).<br>**Hyp:** one URL for test and live, and the test cards are public (Hyp docs research §6). | A store that is enabled while its terminal is in test mode lets anyone "pay" with a public test card and receive a real order marked paid. | • An explicit `mode` on both the account and the attempt.<br>• Test mode is never offered on the public checkout; only platform admins or designated test users see it.<br>• Settle refuses to set a live order `paid` from a test attempt (it goes to `needs_review` or `test_paid`).<br>• A badge in the admin, and an alert when an enabled store is in test mode. | Open |
| MX-03 | Medium | **This is S-2:**<br>• No provider confirmation happens before `grow_mark_paid`. The hash of `processToken` is the only authenticator (`grow-webhook.server.ts:35-49`; `docs/audit/SECURITY-FINDINGS.md:42-54`; `GROW-VERIFICATION.md` §3).<br>• `transaction_id` is not unique (`…grow_payments.sql:66`; the only indexes are at `:70-74`).<br>• `orders.grow_transaction_id` is not unique. | One provider transaction can be bound to several processes. A leaked token allows a forged webhook. | **MAX:**<br>• APISign `What=VERIFY` before settle. It is the only documented server-side check.<br>• `UNIQUE(provider, terminal, provider_txn_id)`.<br>**Grow:** keep "do not enable for more stores". | Open (Grow: depends on the vendor) |
| MX-04 | Medium | • `grow_mark_paid` refuses only `p.status IN ('paid','paid_late')` (`…grow_payments.sql:236`). So `superseded`, `failed` and `amount_mismatch` processes can still settle.<br>• Every `startGrowPayment` creates a new live provider page (`grow-payments.functions.ts:79-106`; auto-start plus the retry button, `GrowPaymentPage.tsx:46-55`).<br>• A second successful payment on a paid order becomes `paid_late`, and the bell says "paid after it was cancelled or expired" (`grow-webhook.server.ts:76-85,148-150`). | • A double charge, with a misleading alert.<br>• Combined with MX-01, an older and cheaper page can settle the order. | **MAX:**<br>• A repeated click reuses the live attempt and its URL.<br>• Only the order's current attempt can settle.<br>• A second authentic payment goes to `needs_review` (duplicate), rings the bell, and follows the refund runbook (CancelTrans the same day). | Open |
| MX-05 | Medium (MAX) | • `storeGate` returns 403 on suspended or expired stores for every path except `SUSPENDED_ALLOWED_PATHS` and `/_serverFn` (`src/server.ts:71-89`; `src/lib/blocked-pages.ts:30-31`).<br>• The Shabbat window blocks `requireStoreOpen` (`src/lib/rest-window.middleware.ts:10-26`).<br>• The removed Hyp code handled its return before the lock (`git show 9bbc37c^:src/server.ts`).<br>• Hyp Pay documents no notification, so the return is the only way to settle. | A store locks, or the rest window starts, between SIGN and the return. The customer is charged, the return is blocked, and the order expires and releases its stock. | • Route `/payments/return/max` before `storeGate`, without the rest window, with a standalone result page.<br>• **Start** stays blocked while the store is locked or closed. | Open (design requirement) |
| MX-06 | Medium | **Tracking scripts run on checkout pages:**<br>• `/checkout/*` is not in `NO_MARKETING_PATHS` (`src/lib/marketing.ts:197-198`).<br>• After consent, the store's GA4 `gtag('config')` and Meta `fbq('track','PageView')` are injected (`marketing.ts:169-190`; `TrackingConsent.tsx:111-112`). Both send the full `document.location`.<br>• Only the GTM push is cleaned (`src/platform/analytics/gtm.ts:91-120`).<br>**Logs and caches:**<br>• nginx keeps the default access log, which includes the query (no `access_log`/`log_format` in `deploy/nginx/nuriel-shop.nuri1.fit.conf`).<br>• A trailing-slash URL gets a `public, max-age=86400` 308 that copies the query (`src/lib/url-normalize.ts:12-30`; `src/server.ts:154-155`).<br>**What Hyp's redirect carries:** `Id, CCode, Amount, ACode, Order, Fild1-3` (name and email in the example) and `Sign`. With MoreData it also carries `UserId, cell, L4digit`. | • Israeli ID, phone, email, last 4 digits and Hyp ids go to Google and Meta, to the access logs, and possibly to shared caches.<br>• Already today, the order-UUID capability of `/checkout/grow/<id>` reaches GA and Meta. | • The return is server-only and never renders. It answers with a 303 to a query-less URL, with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.<br>• Keep the return path out of the normalizer: either put it under `/api/` or add it to `SKIP`.<br>• Add `/checkout/pay` and the return path to `NO_MARKETING_PATHS` and `PERSONAL_PATHS`.<br>• In nginx, give the return `location` either `access_log off` or a log format without the query.<br>• Never send `UserId`. Use MoreData only if a field we need requires it. | Open |
| MX-07 | Medium | • The staff email's Grow branch always prints "💳 שולם אונליין (Grow) … התשלום התקבל", without checking `payment.status` (`src/lib/order-emails.server.ts:82-97`).<br>• The only gate is `payment_status === 'awaiting'` (`src/lib/order-email-data.server.ts:104`).<br>• The order's owner can call `sendOrderEmails` (`src/lib/email.functions.ts:10-44`; limited to 5 per order per 10 minutes, `order-email-limit.server.ts:9-13`).<br>• The customer email is gated on `paid` (`src/server/services/notifications.ts:396`). | A customer lets a Grow order expire, or be rejected, and then triggers a staff email that says it was paid online. | • Gate every online-payment email branch on `payment_status === 'paid'`.<br>• `sendOrderEmails` refuses online orders that are not paid.<br>• MAX emails are sent only by settle. | Partly fixed (awaiting is gated) |
| MX-08 | Low | **Errors reach the browser with their stack and cause:**<br>• Server-function errors are serialized with `stack` and every own property, including `cause` (`node_modules/@tanstack/start-server-core/dist/esm/server-functions-handler.js:89-113`).<br>• seroval 1.7.2 uses `features: 127`, which includes ErrorPrototypeStack (`node_modules/seroval/dist/index.js:358,1194`).<br>• **Verified** with `NODE_ENV=production`: `has_stack=true`, `has_cause=true`.<br>**Logs are not redacted:**<br>• The `console.error` wrapper expands the cause chain up to 8000 characters, with no redaction (`src/lib/error-capture.ts:16-33,56`).<br>• Logs go to the docker json-file driver (`docker-compose.yml:102-106`).<br>• There is no central redactor; only the AI module has `redactSensitive` (`src/platform/ai/logic.ts:448-469`). | Any MAX error that carries a Hyp URL (Hyp authenticates in the query string) or a Hyp response reaches both the browser and the logs. | • No URL that carries credentials: use a POST body and confirm it in the sandbox.<br>• Every MAX function catches all errors and throws a fresh `Error(fixed text)` with no `cause`.<br>• One `redactPaymentLog()` for every payment log line.<br>• Optionally, a global function middleware that drops `stack` and `cause`. | Open |
| MX-09 | Low | • `vite.config.ts:28-31` sets `client.files: ["**/server/**"]`. That **replaces** the default `**/*.server.*` (`…/import-protection-plugin/plugin.js:780-784`; `…/import-protection/defaults.js:17`).<br>• The worktree's build (`.output/public/assets`, git-ignored, dated 2026-11-27 12:22, commit not verified) ships 17 `*.server-*.js` chunks. Examples are `client.server-*.js` (the service-role client constructor), `env.server-*.js` and `rate-limit.server-*.js`.<br>• On the client `process.env` becomes `{}`, so no values ship. | The `.server.ts` naming convention is not enforced. A MAX `*.server.ts` outside a `server/` folder (for example `src/platform/payments/…`) would ship its code to the browser. | • Add `"**/*.server.*"` back to `client.files` and fix the importers it flags.<br>• Put code that touches credentials under `**/server/**`.<br>• CI fails on any `*.server-*` chunk, or on `PassP`, `APISign` or a MAX env name, in `.output/public`. | Open (verified on the build artifact) |
| MX-10 | Low | • **Grow:** the key is `sha256(GROW_SECRETS_KEY)` with no HKDF, no AAD, and a `v1:` prefix with no key id (`src/lib/grow-crypto.server.ts:12-27`).<br>• **AI:** it falls back to `SUPABASE_SERVICE_ROLE_KEY` (`src/platform/ai/secrets.server.ts:65-75`).<br>• **Good model:** the license helper, with HKDF per purpose, an AAD of tenant + delivery, and a version (`src/lib/license-crypto.server.ts:35-67`). | • A ciphertext copied to another tenant or field still decrypts.<br>• Rotating the master key means re-entering every value.<br>• Secrets are coupled. | **MAX:**<br>• A dedicated env secret of at least 32 characters, with no fallback.<br>• An HKDF label.<br>• AAD = tenant + provider + mode + account + field.<br>• A key-id prefix, and decryption with both keys during a rotation. | Open (Grow); requirement (MAX) |
| MX-11 | Low | • `recordPlatformAudit` swallows failures (`src/lib/platform-files.server.ts:36-58`).<br>• `platform_audit_log` blocks UPDATE only. A DELETE by service_role is allowed, and `ON DELETE CASCADE` on the tenant applies (`20261019510000_platform_customer_files.sql:102-109,171-175`). | • A credential change can commit with no audit row.<br>• The payment audit trail is lost when a tenant is deleted. | • One DEFINER function writes the change and its audit row in the same transaction (fail closed).<br>• Block DELETE.<br>• Keep payment records when a tenant is deleted (SET NULL plus a snapshot). | Open |
| MX-12 | Low | • Ecommerce rate limits live in memory, per process, and reset on restart (`src/lib/rate-limit.server.ts:12-37`).<br>• They are keyed by a trusted IP (`src/platform/security/client-ip.ts:42-48`).<br>• A DB-backed limiter exists only in hospitality (`hospitality.rate_check`; `src/engines/hospitality/security/rate-limit.server.ts`). | • The limits weaken after a restart or with several processes.<br>• We could be used to send VERIFY floods to Hyp. | • Atomic per-attempt and per-return counters in the DB.<br>• Port `rate_check` for the IP limits. | Open |
| MX-13 | Low | • The order UUID is the bearer key to `/checkout/grow/<id>` (`grow-payments.functions.ts:10`).<br>• `startGrowPayment` checks no ownership and pre-fills name, phone and email on the provider page (`:31-91`). | A leaked UUID (see MX-06) shows the shopper's PII on the provider page. | **MAX:**<br>• A random attempt or result token of at least 128 bits, stored hashed.<br>• Pre-fill as little as possible.<br>• The status shows no PII. | Open (by design) |
| MX-14 | Low | • The platform-admin Grow functions check only `is_platform_admin` (`src/lib/platform-grow.functions.ts:36-43,58-62,94-117,198-202`).<br>• They have no `isPlatformRequest()` binding.<br>• Tokens sit in each origin's localStorage, and store owners control the scripts on their storefronts. | A platform-admin token captured on a store origin could change any store's credentials. | MAX credential functions:<br>• require `isPlatformRequest()` (PLATFORM_ADMIN_HOST);<br>• require a recent re-authentication. | Open (defense in depth) |
| MX-15 | Info | Provider error text reaches:<br>• shoppers (`src/lib/grow.server.ts:98-106,155` → `GrowPaymentPage.tsx:52-53`);<br>• admins (`platform-grow.functions.ts:227-229`). | Internal provider messages are exposed. | • Map Hyp `CCode` values to fixed Hebrew messages.<br>• Log the code only. | Open |
| MX-16 | Info | CSP `form-action 'self'` and `Permissions-Policy: payment=()` (`src/lib/security-headers.ts:20-28`). | A form POST to Hyp, or an iframe with wallets, would be blocked. | • Navigate the top-level page with `location.assign` to a server-validated `https://pay.hyp.co.il/p/?…`.<br>• If an iframe is ever used, add `frame-src https://pay.hyp.co.il` and a payment permission scoped to it. | Constraint |
| MX-17 | Info | **The removed Hyp code:**<br>• VERIFY sent KEY and PassP in a GET query (`git show 9bbc37c^:src/server/services/hyp.ts:161-172,318-337`).<br>• It logged up to 200 characters of Hyp's responses (`:186,:209`).<br>• It stored plaintext secrets with a last-4 hint (`20261019190000_hyp_payments.sql:114-117,187-202,244-249`).<br>• It put the terminal in the public `site_settings` (`:173-184`). | Anti-patterns, if that code is brought back. | Reuse only its rejection of duplicate parameters and its unique transaction id. | Removed in `9bbc37c` |
| MX-18 | Info (OK) | **Server functions:**<br>• `createCsrfMiddleware` is filtered to `serverFn` (`src/start.ts:25-27,32`). It requires `Sec-Fetch-Site: same-origin`, then falls back to Origin or Referer, and otherwise returns 403 (`…/createCsrfMiddleware.js:16-35`).<br>• nginx requires `x-tsr-serverfn: true` (`deploy/nginx/nuriel-shop.nuri1.fit.conf:14-17`).<br>• Auth is a Bearer token from localStorage, not a cookie (`auth-attacher.ts:6-13`; `auth-middleware.ts:54-66`).<br>**API routes** (`src/routes/api.*`) are outside the CSRF filter. They rely on Bearer tokens or their own verification. | — | • Start, settings and test stay POST server functions.<br>• The return is a cross-site GET whose only effect is a settle gated by VERIFY. | OK |
| MX-19 | Info | • Fixed E2E app secrets in a tracked script (`e2e/scripts/app-up.sh:23-26`; commits `4e8fb94`, `fc6fb68`).<br>• `deploy/check-default-secrets.sh` checks only the Supabase stack `.env`.<br>• Production generates its keys randomly (`deploy/setup-selfhost.sh:117-127`). | If E2E values were reused in production, stored credentials would be protected by a public key. | • Extend the check to the app `.env` and refuse the E2E values.<br>• The MAX secret is generated by `setup-selfhost.sh`. | Open (low) |
| MX-20 | Needs a decision | `docs/seo-engine/ISTORES-COMPARISON.md`:<br>• excluded from every scan, as instructed (the brief says section 4 holds MAX/iStores terminal credentials);<br>• in HEAD;<br>• in commits `f077fa8`, `6e1c7da` and `910b1f9`, which are on a pushed `origin/*` branch. | If they are real, those credentials are exposed to everyone with access to the repository, and in its history. | The owner should:<br>• confirm whether they are real;<br>• if so, rotate them with MAX and remove them from HEAD;<br>• decide on a history rewrite;<br>• never use them in code or tests. | Not assessed |

---

## 3. Threat model (STRIDE per entry point)

**Entry points:**
- **EP1.** `startOnlinePayment`: POST server function on the store host. It opens the attempt, sends SIGN and returns the Hyp URL.
- **EP2.** `GET /payments/return/max`: the cross-site redirect from Hyp. It records the return, sends VERIFY, settles, and answers 303.
- **EP3.** `/checkout/pay/:orderId` plus `getOnlinePaymentStatus`: read-only polling.
- **EP4.** A notify route. **Not built**: Hyp Pay documents none.
- **EP5.** Platform-admin credential screens.
- **EP6.** `testPaymentConnection`.
- **EP7.** Store-owner settings and order views.
- **EP8.** The DB layer and jobs.
- **EP9.** Cross-cutting: logs, the bundle, the repo, dependencies.

| # | EP | STRIDE | Threat | Control | Enforced at |
|---|---|---|---|---|---|
| 1 | EP1 | S/E | Host spoofing, or another store's order id, used to start a payment | The order is loaded through the scoped `supabaseAdmin` with the host's tenant. `payment_attempt_open(_tenant)` checks `orders.tenant_id` again. Credentials come only from the attempt's tenant. | Server function and DEFINER function |
| 2 | EP1 | T | The client changes the amount, currency or installments | Input is `orderId` only. `Amount` = `order_amount_due` in integer agorot; `Coin=1`; `Tash` ≤ the account's maximum. SIGN is built on the server. | Adapter and DB |
| 3 | EP1/EP8 | T | Lines added to the order after the attempt exists, or after it is paid (MX-01) | A trigger freezes items and totals while the order is `awaiting` or `paid`. Settle compares against the current amount due. | DB trigger and settle |
| 4 | EP1 | I | KEY or PassP reach the browser | Only `https://pay.hyp.co.il/p/?<signed>` is returned. The signed string must not be HTML and must hold no KEY or PassP. Secrets are decrypted in memory, at call time. | Adapter; unit tests; bundle check |
| 5 | EP1 | I | Secrets or Hyp text inside errors (MX-08) | Errors are fixed messages with no `cause`. Calls use a POST body. | Server functions |
| 6 | EP1 | R/D | A double click opens two Hyp pages and the customer pays twice | One live attempt per order (partial unique index). The URL is reused within its TTL. At least 5 s between attempts and at most 10 per order. A duplicate payment goes to `needs_review`. | DB and settle |
| 7 | EP1 | D | A SIGN flood gets our terminal throttled or blocked | Limits per IP, per order and per tenant, kept in the DB. `requireStoreOpen` and the lock check apply. | Server and DB |
| 8 | EP1 | E | CSRF from another site starts a payment | POST server function behind the CSRF middleware and the nginx header gate; no ambient authority. | `src/start.ts`, nginx |
| 9 | EP1 | T | Open redirect | The only external target is the Hyp URL built on the server, with a fixed origin and path. | Adapter |
| 10 | EP1 | E | A test terminal used for real shoppers (MX-02) | Test mode is not offered on the public checkout. The attempt records the mode. | Server and DB |
| 11 | EP1 | I | PII sent to Hyp beyond what is needed | Only the required fields; never `UserId`; MoreData only if needed. | Adapter |
| 12 | EP2 | S | Forged return | VERIFY with the attempt's own terminal credentials. The redirect `CCode` must be exactly "0", and the VERIFY response must be URL-encoded with `CCode` "0"; the HTTP status is ignored. An unknown `Order` triggers no VERIFY. | Server and adapter |
| 13 | EP2 | T | `Amount`, `Order`, `Coin`, `Masof` or `Payments` changed | Exact comparison with the attempt and with the current amount due. A mismatch goes to `needs_review`. | `payment_attempt_settle` |
| 14 | EP2 | R | Replay of a genuine redirect to the same order, another order or another store | `UNIQUE(provider, terminal, txn_id)`; dedupe by digest; an already-paid attempt gives an idempotent 303; the host's tenant must equal the attempt's tenant; VERIFY runs with the attempt's terminal. | DB and settle |
| 15 | EP2 | T | Parameter pollution or a huge query | Duplicate keys rejected (case-insensitive); at most 4 KB and 40 parameters; the raw query is forwarded in its original order. | Parser |
| 16 | EP2 | I | PII and `Sign` reach GA4, Meta, access logs or caches (MX-06) | Server-only 303 with `no-store`; no normalizer hop; marketing and personal path lists; nginx logs without the query. | Server, nginx, UI |
| 17 | EP2 | D | The return is blocked by the lock, the rest window or the normalizer (MX-05) | Handled before `storeGate`; exempt from the rest window; GET only (405 otherwise). | `src/server.ts` |
| 18 | EP2 | E | A victim's browser is pushed through a crafted return (CSRF by design) | No cookies or session are used. The only effect is a settle of the named attempt, gated by VERIFY. | Design |
| 19 | EP2/EP3 | D | VERIFY amplification against Hyp | At most 10 VERIFY calls per attempt, an IP limit, and one VERIFY in flight per return (lease). | DB counters |
| 20 | EP2/EP8 | T | Races: two returns at once, the return and the job, or the return and a poll | Settle locks the attempt and then the order with FOR UPDATE, in one transaction, and returns idempotent results. | Settle |
| 21 | EP2 | T | Open redirect after the return | `Location` is a relative path built from the attempt. Parameters such as `next` are ignored. | Server |
| 22 | EP2 | I | Card data stored | Whitelist of fields; never `bincard`, `Tmonth`, `Tyear`, `UID` or `Token`; brand and last 4 only. | Parser and DB columns |
| 23 | EP2 | T | Payment after expiry, or on a superseded attempt | `paid_late` or `needs_review` and a bell; the order is never reopened silently. | Settle |
| 24 | EP3 | I | The status page or capability leaks PII | The response holds the order number, state and amount only. Random token. Rate limited. | Server function |
| 25 | EP4 | S/T/R | Notify route, if Hyp ever adds one | The same parser, VERIFY and settle; idempotent with the return; size cap; IP allow-list only if documented. | Not built |
| 26 | EP5 | E | A store owner or non-admin writes credentials | `is_platform_admin` in the server function **and** in the DEFINER function; only on PLATFORM_ADMIN_HOST (MX-14). | Server and DB |
| 27 | EP5 | I | Secrets read back | Write-only. The response holds configured, enabled, mode, the last 2 digits of the terminal, `updated_at` and `updated_by`. The ciphertext is never selected. | Server function |
| 28 | EP5/EP8 | T | Ciphertext swapped between tenants or fields | AAD binds tenant, provider, mode, account and field (MX-10). One terminal belongs to one store (`UNIQUE`). | Crypto and DB |
| 29 | EP5 | R | Changes with no audit (MX-11) | The change and its audit row in one transaction; DELETE blocked; no values recorded. | DEFINER function |
| 30 | EP5 | T | Rotation breaks in-flight VERIFY | Credentials are versioned: pending → tested → active. Attempts pin `cred_version`. The old version is kept for at most 24 h for in-flight returns, then wiped. Master-key rotation with key ids. | DB and crypto |
| 31 | EP5 | D/E | Revocation | Disabling stops new attempts at once (cache invalidation). Returns already in flight are still verified, or go to `needs_review`. Values are wiped when the terminal closes. | Server and DB |
| 32 | EP5 | T | Confusion between test and live | Changing the mode requires no pending attempt and is audited. A badge shows the mode. The "starts with `00100`" rule is only a warning, because the docs contradict it. | UI and DB |
| 33 | EP5/EP6 | S | SSRF | No configurable URL: the endpoint is a constant, the success URL lives in the Hyp portal, and we only display it. A test override exists only under `NODE_ENV=test`. | Adapter |
| 34 | EP6 | D/I | The test action used as an oracle for credential validity, or leaking text | Platform admin only; at most 10 per tenant per hour; audited; SIGN only (no charge); nothing persisted or redirected; the response is only ok or the class of CCode. | Server function |
| 35 | EP7 | E | A store owner marks an online order paid, or edits items | `orders_payment_guard` covers the new columns; there is no manual approval for online orders; MX-01 trigger. | DB |
| 36 | EP7 | I | MAX config in the world-readable `site_settings` | Never there; a dedicated table that only service_role can read. | Migration |
| 37 | EP8 | E | DEFINER functions misused | EXECUTE only for service_role; an explicit `_tenant`; never `current_tenant_id()` (it falls back to the default tenant); a fixed `search_path`; the `kobi.payment_update` bypass only inside settle. | Migration and catalog tests |
| 38 | EP8 | I | A raw return stored in the clear | Encrypted with AAD = attempt id; kept 7 days at most; RLS on and no grants to anon or authenticated. | DB |
| 39 | EP9 | — | Supply chain | No new npm package (only `node:crypto`, `fetch`, `URLSearchParams`); `--frozen-lockfile` (`.github/workflows/tests.yml:35,97`; `Dockerfile:15-16`); no community Hyp SDK. | CI |
| 40 | EP9 | I | Secrets in the repo, the bundle or the logs | CI scan of the diff; fake keys generated at run time; the bundle guard (MX-09); one redactor (MX-08); TLS verification on, HTTPS only, 15 s timeout. | CI and code |

---

## 4. Security requirements checklist

Each requirement is testable. **Test types:** U = unit, S = SQL, C = concurrency, E = E2E, B = build or CI, M = manual Hyp sandbox.

| ID | Requirement | Test and pass criterion |
|---|---|---|
| SR-01 | **No card data.**<br>• No input or column for PAN, CVV, expiry, BIN or token.<br>• The return parser keeps only the whitelist `Id, CCode, Amount, ACode, Order, Payments, Brand, L4digit, Coin`.<br>• The raw return is encrypted and expires. | **U:** a redirect carrying `bincard, Tmonth, Tyear, UserId, cell` persists none of them.<br>**S:** no such columns exist. |
| SR-02 | **KEY and PassP never leave the server.** The signed string is checked: not HTML, has `signature`, has no `KEY` or `PassP`. | **U:** HTML responses and responses that echo KEY are rejected.<br>**B:** `.output/public` contains no `PassP`, no `APISign` and no MAX env name. |
| SR-03 | **No credentials in URLs, errors or logs.**<br>• SIGN and VERIFY use a POST body (confirm with **M**).<br>• Errors are fixed messages with no `cause`. | **U**, with a mocked `fetch`:<br>• the URL has no KEY or PassP;<br>• the serialized error has no secret and no Hyp body. |
| SR-04 | **One redactor** for every payment log and event: KEY, PassP, `Masof` (except the last 2 digits), `Sign`/`signature`, `UserId`, `cell`, email, `Fild1-3`, names, address, `L4digit`. | **U:** the redactor.<br>**E:** the captured logs contain none of the seeded values. |
| SR-05 | **The return never renders.**<br>• 303 to a query-less URL, with `no-store` and `no-referrer`.<br>• GET only (405 otherwise).<br>• No 308 normalizer hop.<br>• At most 4 KB and 40 parameters; duplicate keys (case-insensitive) rejected. | **U.**<br>**E:** the final URL has no query, and the trailing-slash variant never yields a cacheable 308. |
| SR-06 | **Out of analytics and logs.** The return and result paths are in `NO_MARKETING_PATHS` and `PERSONAL_PATHS`; nginx logs that location without the query. | **E:** with consent granted, no request to googletagmanager or facebook carries the return parameters or the order id.<br>**B:** nginx config lint. |
| SR-07 | **The amount comes from the DB.** `order_amount_due` at attempt creation, stored in integer agorot with ILS, `Coin=1`, `Tash` ≤ the maximum. | **U** and **S.** |
| SR-08 | **The order is frozen while it is payable or paid.** Items, total, shipping, coupon and discount cannot change, by customers or staff, outside settle or cancel. | **S:** the lead's probe inverted. Both inserts fail and the total does not change. |
| SR-09 | **The settle gate.** Every check must pass; otherwise the attempt goes to `needs_review`, `declined` or `transient`, and **never** to `paid`:<br>• the redirect `CCode` is "0";<br>• the VERIFY response is URL-encoded and its `CCode` is "0";<br>• `Order` is an attempt of the host's tenant, and that attempt is the current one;<br>• `Amount` = the attempt amount = the current amount due;<br>• `Coin` is absent or 1;<br>• an echoed `Masof` equals the attempt's terminal;<br>• `Id` matches `^\d{1,20}$`;<br>• the mode is compatible;<br>• `Payments` ≤ the maximum. | **S/U:** table-driven, with one negative case for each condition. |
| SR-10 | **Exactly once.** `payment_attempt_settle`:<br>• is DEFINER, executable by service_role only;<br>• takes an explicit `_tenant`;<br>• locks with FOR UPDATE: the attempt first, then the order.<br>`UNIQUE(provider, terminal, txn_id)` backs it. | **C:**<br>• 10 identical settles in parallel → exactly 1 paid;<br>• a second `Id` for the same order → `needs_review`. |
| SR-11 | **One live attempt per order.**<br>• The URL is reused within its TTL.<br>• At least 5 s between attempts, at most 10 per order.<br>• A payment on a superseded attempt → `needs_review` and a bell. | **S.**<br>**E:** double click. |
| SR-12 | **Tenant binding.**<br>• The return is looked up by host tenant and ref; a mismatch writes an event and makes no VERIFY.<br>• One terminal belongs to one store. | **E/S:** store A's ref on store B's host → not found, and no outbound call. |
| SR-13 | **The return is always reachable:** before `storeGate`, not blocked by the rest window. Start stays blocked while the store is locked or closed. | **E:** with a locked store and the Shabbat window active, the return verifies and start is refused. |
| SR-14 | **No open redirect.** Only the Hyp URL goes out. `Location` is a relative path built from the attempt. | **U:** `?next=https://evil` is ignored. |
| SR-15 | **CSRF.** Start, settings and test are POST server functions; the return has no other side effect. | **E:** a cross-site or missing origin → 403, nothing written, no SIGN. |
| SR-16 | **Limits in the DB:**<br>• start: 20 per IP per 15 min, at most 10 per order;<br>• return: 60 per IP per 10 min, at most 10 VERIFY per attempt, with a lease;<br>• status: 240 per IP per 15 min;<br>• test: 10 per tenant per hour;<br>• save: 20 per admin per hour. | **S/U:** the counters. |
| SR-17 | **Encryption:**<br>• AES-256-GCM, with a 16-byte tag enforced;<br>• HKDF from a dedicated secret of at least 32 characters, with no fallback;<br>• AAD = tenant, provider, mode, account, field;<br>• a key-id prefix. | **U:** a ciphertext copied to another tenant or field fails; a wrong key id fails; a tampered tag fails. |
| SR-18 | **Storage.** The new tables have RLS on and no grants to anon or authenticated, and nothing goes in `site_settings`. The DEFINER functions are executable by service_role only. | **S:** a catalog test (extend `db-classification`). |
| SR-19 | **Write-only admin.** A read returns only configured, enabled, mode, the last 2 digits of the terminal, `updated_at` and `updated_by`. | **U.**<br>**E:** the shape of the network response. |
| SR-20 | **Privileges.** Only a platform admin can act, checked both in the server function and in the DB, and only on PLATFORM_ADMIN_HOST. A store owner has read-only status. | **E:** a store admin is refused, and so is a platform admin calling from a store host. |
| SR-21 | **The audit fails closed.**<br>• It is written in the same transaction and records the actor, tenant, action, the **names** of the changed fields, and mode/enabled before and after.<br>• DELETE is blocked.<br>• It survives the deletion of the tenant. | **S:** a forced failure of the audit insert rolls back the change, and DELETE is refused. |
| SR-22 | **Rotation and revocation.**<br>• Pending → tested → active.<br>• Attempts pin `cred_version`, and an old version lives at most 24 h.<br>• Disabling blocks new attempts at once, and in-flight returns still settle or go to `needs_review`. | **S/U/E.** |
| SR-23 | **Test and live.**<br>• Test mode never appears on the public checkout.<br>• Settle refuses a live order paid from a test attempt.<br>• A badge appears in the admin and in emails. | **S/E:** a forced test attempt on a live order is not paid. |
| SR-24 | **Late or duplicate payment** → `paid_late` or `needs_review`, with a bell to that store's admins. The order is never reopened silently. | **S.** |
| SR-25 | **Emails are gated on `paid`.** MAX emails come only from settle, and `sendOrderEmails` refuses online orders that are not paid. | **U.** |
| SR-26 | **Minimal PII.**<br>• SIGN sends only the required customer fields, and never `UserId`.<br>• MoreData only if needed; then the raw return is encrypted and kept at most 7 days. | **U:** a snapshot of the SIGN parameters. |
| SR-27 | **Result capability:** a random token of at least 128 bits, stored hashed (or the owner's auth). The status holds no PII. | **U.** |
| SR-28 | **Transport:**<br>• HTTPS only, with default TLS verification (no `rejectUnauthorized`, no `NODE_TLS_REJECT_UNAUTHORIZED`);<br>• a 15 s timeout;<br>• the parsed `CCode` decides, not the HTTP status. | **U** plus an architecture test. |
| SR-29 | **A fixed endpoint:** the constant `https://pay.hyp.co.il/p/`. An override exists only under `NODE_ENV=test`, listed as TEST_ONLY in `env-forwarding.test.ts`. | **U.** |
| SR-30 | **No new npm package,** and no Hyp SDK. | **B:** the diff of `package.json` and `bun.lock` is empty. |
| SR-31 | **No real credentials** in code, tests or docs; tests generate fake keys at run time. | **B:** a secret-pattern scan of the diff. |
| SR-32 | **Bundle guard (MX-09).** | **B:** the build fails on any `*.server-*` chunk or MAX module in `.output/public`. |
| SR-33 | **Reconciliation list** for staff: attempts `redirected` with no return, `needs_review` and `paid_late`, with the Hyp `Order` ref. | **S:** a test of the view. |
| SR-34 | **A notify route,** only if Hyp documents one: the same path, idempotent with the return. | **C:** a return and a notify at the same time → one paid. |

---

## 5. Secret scan: method and results (redacted)

### 5.1 Method

**The tool:**
- the agent's redacting scanner (kept outside the repo), run with `python3 -I`. It redacts by construction: it stores no matched value and reports kind, path, line, an opaque per-run value id, a class (placeholder, fixture or "LOOKS REAL") and length, charset and entropy. Triage used masked context only.
- `heb2.py` adds Hebrew and English labelled assignments ("מסוף", "סיסמה", "מפתח", terminal, password, PassP, Masof, page_code) restricted to literal values.
- Cross-check: `git log --all --reflog -G<regex>`, printing counts and commit ids only.

**Coverage:**
- **Git:** every object from `git rev-list --all --reflog --objects`. That is 59 refs (26 heads, 32 remotes, 1 stash) and 505 commits.
- **Unreachable objects:** `git fsck --unreachable --no-reflogs` (94 blobs, 31 commits).
- **What was scanned:** 5,555 text blobs. Skipped: 159 binary blobs and 4 GIFs over 4 MB. Excluded: 3 blobs of `ISTORES-COMPARISON.md`.
- **Working tree:** the tracked files (which equal the HEAD blobs).
- **Ignored and untracked:** 829 text files:
  - `.cache/`, `.claude/`;
  - `docs/audit/interim/rls-perf/*.log` (24 logs);
  - `e2e/.auth/`, `e2e/.supabase/`, `e2e/.env.e2e`, `e2e/.dns-fixtures.json`, `e2e/preview/out/`, `e2e/test-results/`;
  - `scripts/db-tests/.run-hosp.sh`, `scripts/db-tests/.rollback-hosp.sh`;
  - `skills-lock.json`.
- **Build output:** `.output/`, 1,056 text files.
- **Not scanned:** `node_modules`.

**Patterns (28 kinds):**
- private keys (PEM, OpenSSH, PGP);
- JWTs, decoded for `role` and `iss` only;
- Supabase `sb_secret_` and `sb_publishable_`;
- Anthropic, OpenAI, Google API and OAuth keys, and service-account JSON;
- AWS, GitHub, Slack (tokens and webhooks), Stripe, Resend, SendGrid, Twilio, Telegram, npm, age secret keys, HF/Groq/xAI;
- URL userinfo (DB URLs);
- the Hyp query values `Masof=`/`PassP=`/`KEY=`/`zPass=`, and their assignments (`hyp_api_*`, terminal_*);
- Grow `pageCode`/`userId`/`apiKey` hex literals;
- MAX `max_*key|secret|token|password`;
- `.env`-style `*SECRET|*TOKEN|*_KEY|…=` assignments;
- generic secret assignments;
- high-entropy tokens near secret words;
- in HEAD, high-entropy tokens of 40+ characters anywhere.

**Sensitive file names ever added** (git log `--diff-filter=A`): only `.env.example` and `deploy/.env.production.example`. No `.env`, keys, dumps or credential files, and no tracked `*.log`.

### 5.2 Results

| Location | Kind | Commits | In HEAD | Classification |
|---|---|---|---|---|
| (none) | Private keys; JWTs of any role; `sb_secret_`; JWT secrets; AWS, GitHub, Slack, Stripe, SendGrid, Twilio, Telegram, npm and age keys; Grow pageCode, userId and apiKey literals; Hyp `Masof=`, `PassP=` and `KEY=` values; MAX keys; DB URLs with real passwords | 0 commits each (`-G` cross-check) | — | **None found** |
| `tests/unit/ai-logic.test.ts`, `tests/unit/ai-security.test.ts`, `scripts/db-tests/ai-assistant.test.sql`, `scripts/ai-staging-check.ts` | Anthropic-format keys | `f729211`, `6dd034b` | yes | Format fixtures and placeholders (fake) |
| `e2e/scripts/app-up.sh:23-26`; older versions in 4 unreachable blobs | `GROW_SECRETS_KEY`, `LOGIN_CODE_SECRET` and `LICENSE_KEYS_SECRET` for E2E only, plus a dummy `RESEND_API_KEY` | `4e8fb94`, `fc6fb68` | yes | Test fixture for the local mock stack (MX-19) |
| `tests/unit/deploy-websites-efrat.test.ts:88,184` | `SUPABASE_SERVICE_ROLE_KEY=` fixture next to `db.example.test` | `bd07313`, `5b2daed` | yes | Fixture |
| `tests/unit/preview-guard.test.ts:9,21,47` | Postgres URLs with common placeholder passwords | `238995e` | yes | Fixture |
| `e2e/tests/*.spec.ts` (about 60 files), `e2e/fixtures/data.mjs`, `e2e/scripts/seed.mjs`, `e2e/preview/guide.spec.ts` | Passwords of locally seeded E2E users | many | yes | Fixtures |
| `.env.example`, `deploy/.env.production.example` | Secret variables | — | yes | All 9 empty / placeholders |
| `src/integrations/supabase/types.ts` (120), `supabase/migrations/20261019190000_hyp_payments.sql` (8), `scripts/audit/prod-migration-fingerprint.sql` (27); 64-hex server-function ids in `.output/server`; URL path segments in `docs/websites/*.json` | Pattern hits | — | — | False positives (type names, SQL identifiers, md5 fingerprints) |
| `e2e/.auth/{customer-a,owner-a,owner-a-platform,platform}.json` (git-ignored, never committed) | 4 session JWTs (role `authenticated`, issued by the local Supabase at `127.0.0.1:54321`) | — | not tracked | Local test sessions |
| `e2e/.supabase/supabase/config.toml` (ignored) | Local stack config values | — | not tracked | Placeholders and fixtures |
| `docs/audit/interim/rls-perf/*.log`, `e2e/preview/out`, `e2e/test-results` (ignored logs) | Secrets / PII | — | not tracked | No secrets. Only seed contacts (`perf.local`, `x.com`) and binary noise |
| `.output/public` (client bundle) | 1 JWT | — | build | The well-known Supabase CLI **demo anon** key (`iss=supabase-demo`): public by design. Secret env **names** appear in shipped server chunks; no values (MX-09) |
| `docs/seo-engine/ISTORES-COMPARISON.md` | — | `f077fa8`, `6e1c7da`, `910b1f9` (pushed) | yes | **Excluded by instruction**, not assessed (MX-20) |

**Other checks:**
- **`VITE_*` / `import.meta.env`:** only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (`src/integrations/supabase/client.ts:88-95`; `Dockerfile:24-27`; `docker-compose.yml:23-24`), both public by design. `import.meta.env` is not used anywhere else.
- **Server functions that return secrets:** none.
  - `getGrowSettings` selects `api_key_enc` only to return a boolean (`platform-grow.functions.ts:65-78`).
  - The Resend key is never returned; the admin gets only a last-4 hint (`src/server/services/notifications.ts:69-71`).
  - The AI key is decrypted on the server only.
- **console/logger:** no payment code prints request parameters, headers, webhook payloads or credentials. The Grow logs print error messages only. The known PII log is PRV-16 (`src/lib/email.server.ts:311`, the Resend error body). The risk is structural (MX-08): stack and cause go to the browser, and nothing is redacted.

---

## 6. Corrections to the lead's §6 draft

1. **"Callback מזויף (1) Sign / HMAC, constant time":** Hyp Pay documents no signature algorithm, and local HMAC appears only in the WooCommerce plugin.
   - Authenticity = APISign `What=VERIFY` only. This agrees with the lead's note 3.
   - Constant-time comparison applies to our own tokens and digests only.
2. **"הודעת שרת-לשרת של Hyp, או בדיקת העסקה מול Hyp":** neither exists in Hyp Pay; both are Enterprise-only.
   - Phase 1 is return-only.
   - A payment whose browser never returns is unrecoverable automatically, so add reconciliation (SR-33) as an open risk.
3. **"שינוי סכום":** a settle-time check does not cover lines added **after** payment (probe: 300→400 while paid). Add the freeze (SR-08).
4. **"הצפת נקודות החזרה … הגבלת הקצב הקיימת במסד":** the ecommerce limiter lives in memory, per process. The DB limiter exists only in hospitality (MX-12).
5. **"סודות במסד … כמו המנגנון הקיים":** the Grow helper has no HKDF, AAD or key id. Use the license pattern (MX-10) and an audit in the same transaction (MX-11).
6. **"מצב בדיקות מול אמת":** add two controls:
   - test mode is never on the public checkout, because Hyp publishes its test cards;
   - the DB refuses such an order (MX-02).
7. **"יומנים":** add four items:
   - the nginx access log;
   - GA4 and Pixel on `/checkout`;
   - the cacheable 308;
   - server-function errors that are serialized with their stack and cause (MX-06, MX-08).
8. **"חנות אחת … של אחרת":** add two items:
   - the return must bypass `storeGate` and the rest window (MX-05);
   - one terminal belongs to one store.
9. **§7.2:** add tests for duplicate keys in the return and for a trailing-slash success URL.

---

## 7. Open risks and things not verified

1. **A payment whose browser never returns.** Hyp Pay has neither a notification nor a lookup, so the customer is charged and the order expires. This needs manual reconciliation (SR-33) and an owner decision.
2. **What VERIFY and `Sign` actually cover is undocumented** (Hyp Q4/Q5). The cross-terminal replay defense assumes `Sign` is bound to the terminal. Our own binding (SR-09/SR-12) limits the damage.
3. **Encoding.** VERIFY needs the raw parameters in their original order, and WHATWG URL parsing can re-encode non-ASCII. Forward the raw substring, and test it in the sandbox (M).
4. **POST for VERIFY is unconfirmed.** If only GET works, the credentials sit in a URL; keep it out of every log and error (SR-03).
5. **The test-terminal rule** ("starts with `00100`") contradicts the docs' own examples. The mode must be explicit, never inferred.
6. **F18:** order creation has no idempotency, so two orders can each be paid. Attempt uniqueness does not cover this.
7. **No refund module.** Duplicate charges are handled by hand in the Hyp portal. Whether `zPass` is required is ambiguous.
8. **MX-14 is platform-wide:** an admin token could be stolen on a store origin. **MX-12:** limits live in memory.
9. **Not executed by me:**
   - any DB query (MX-01 rests on the lead's probe);
   - E2E tests and a build. The `.output` artifact is not tied to HEAD.
   - live nginx, Coolify or Traefik configs;
   - GoTrue and Kong in production;
   - any Hyp sandbox call.

   The other findings are (code-reading), except MX-08 (local library run) and MX-09 (the build artifact).

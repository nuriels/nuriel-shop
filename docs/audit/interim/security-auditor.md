# Security auditor — interim report (2026-11-17)

Branch `audit/platform-review-2026-11`, read-only. Static review plus catalog queries against the local DB
(`supabase_db_nuriel-e2e`). Prior rounds (`docs/security/remediation-2026-11.md`, `docs/maintenance/night-2026-11-13.md`)
were read first. Nothing listed there as fixed or as an open decision is reported again here.

**DB caveat:** the local DB has 196 of 199 migrations (`supabase_migrations.schema_migrations`, max `20261116120000`; there is
no `public._migrations_applied`). Migrations 197 (`bp_site_address`), 198 (`bp_owner_invites`) and 199 (`site_tracking_ga4`)
are not applied locally, so I read them by hand. Every catalog result below describes the state with 196 migrations.

## Summary

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| 1 | Medium | Logged-in customers can call `place_order` or `INSERT orders` directly through PostgREST with no rate limit. This gives an unlimited coupon-code oracle, stock reservation (inventory DoS) and staff-notification spam | VERIFIED (static + catalog) |
| 2 | Medium | Grow webhook marks an order paid on `processToken` + `processId` alone. There is no server-to-server confirmation before `grow_mark_paid` | SUSPECTED |
| 3 | Low | Owner-invite accounts are created with `email_confirm: true` and an email the invitee typed but never proved. This contradicts the code comment and allows pre-hijacking through GoTrue identity auto-linking | SUSPECTED |
| 4 | Low | Squatting a custom domain: any site or store admin can claim an *unverified* `custom_domain`, which blocks the real owner from connecting it | VERIFIED (static + catalog) |
| 5 | Info | The HMAC key for the BP owner-verify code falls back to `SUPABASE_SERVICE_ROLE_KEY` (key reuse) | VERIFIED (static) |
| 6 | Info | `anon` / `authenticated` hold TRUNCATE (and full DML) grants on 20–25 RLS tables. Not reachable through PostgREST, but a defense-in-depth gap | VERIFIED (catalog) |

Counts: Critical 0 · High 0 · Medium 2 · Low 2 · Info 2.

## What I checked and found clean

- **RLS:** every table (`relkind r/p`) in `public`, `hospitality`, `business_profile`, `billing` and `e2e` has `relrowsecurity = true`
  (0 rows). The unapplied migrations 197 and 198 enable RLS on their new tables and revoke them from anon/authenticated.
- **Views:** there are no views or materialized views in the app schemas (0 rows), so no view can bypass RLS.
- **SECURITY DEFINER:** 866 of 1071 functions are SECURITY DEFINER. Every one has a pinned `search_path` (0 without). No app schema
  grants CREATE to anon or authenticated. The new BP and GA4 functions use `search_path = ''`.
- **Anon-executable definer functions (94):** these are trigger functions, public read helpers, token-based guest RPCs (`_token`)
  and `quote` / `quote_type`. Those two reject a promo code from the `anon` / `authenticated` roles (SEC-L4 still in place).
  The `request_booking*` functions are not exposed to anon or authenticated.
- **Write policies:** no PERMISSIVE INSERT/UPDATE/ALL policy is open to anon or public. The non-staff write policies are limited to
  self-owned rows (`customer_carts`, `customer_profiles`, `staff_notifications`, `user_roles` self-register as a pending customer).
  On `user_roles` self-update, `protect_privileged_columns` freezes role, approval, block and email, and the RESTRICTIVE
  `tenant_isolation` blocks moving a row to another tenant.
- **Policies with `USING true`:** these cover only catalog-style public data (categories, banners, plans, `site_settings`). The
  `site_settings` columns readable by anon hold nothing secret. Tracking IDs are protected by DB CHECKs
  (`site_settings_tracking_check`, `site_settings_google_verification_check`, GA4 `^G-[A-Z0-9]{4,16}$`).
- **`platform_*` RPCs:** every authenticated-executable definer function calls `require_platform_admin` / `is_platform_admin`. The
  two that do not do it directly (`platform_create_tenant`, `platform_bp_open_site`) do it through `platform_slug_problem`. The
  invite, review and billing RPCs check the admin in the DB, and billing also requires the panel host
  (`src/platform/billing/billing.server.ts:62`).
- **Hospitality staff RPCs:** all go through `_staff_tenant(perm)` / `_manage_tenant(perm)`. Spot-checked: `approve_booking`,
  `support_file`, `picking_*`, `transfer_*`.
- **Tenant derivation:** `current_tenant_id()` accepts a client `x-tenant-id` only for (a) a member of that tenant, (b) a platform
  admin, or (c) an anonymous or zero-membership user, who gets only public/RLS-anon access. `hospitality.request_tenant()`
  accepts only an active hospitality tenant. On the server, the tenant comes from the Host header (`requestHost`, Nginx overwrites
  `X-Forwarded-Host $host`, see `deploy/nginx/*.conf`), and `supabaseAdmin` is tenant-stamped. `engineGuard` returns 404 for
  cross-engine server functions.
- **Owner-invite flow (migration 198, new):** 32-byte token, only its SHA-256 stored, kept in the URL fragment and POSTed. Expiry
  1–168 h. Single use under `FOR UPDATE` plus an advisory lock. Bound to the site. Only a brand-new account with no roles and not a
  platform admin can redeem. Rate-limited per IP and per token. The 6-digit verify code is stored only as an HMAC, valid 10 minutes,
  5 attempts. Every failure is audited.
- **BP address / custom domain (migration 197, new):** `bp_custom_domain_record_check` is service_role only, and the server runs it
  after `studio_site('settings.owner')` (`src/engines/business-profile/api/address.functions.ts:179`). Verification needs the TXT
  record and the CNAME/A record. `tenant_for_host` routes only domains whose `custom_domain_verified_at` is set.
- **Price, VAT, coupons:** `place_order` / `place_guest_order` take prices from `snapshot_order_item_product` (client
  `unit_price` is ignored for non-staff). `orders_vat_from_settings` overwrites `vat_rate` / `prices_include_vat` (client
  `_vat_rate` is ignored). Gifts are added only through `apply_order_gifts`. Hospitality quote and booking prices are computed in
  the DB. `grow_mark_paid` checks `|sum − amount| ≤ 0.01`, status code 2, and pays only once.
- **SSRF:** iCal and remote images go through `src/server/services/image-fetch.ts`, which uses its own DNS lookup with
  pinned-address connect, a full private/reserved IPv4 and IPv6 blocklist, and per-hop redirect checks (max 4). Logo download uses
  `redirect: "error"` and raster sniffing.
- **Uploads:** `bp-media` is limited to webp, avif and woff2 at 8 MB, and the server re-encodes every upload with sharp (SVG
  rejected). Hospitality buckets have MIME and size limits. The three private buckets without limits are already a known item (#7).
- **Stored XSS:** agreement signature SVG is rebuilt on the server from path data only (`src/lib/agreement.functions.ts:117`).
  `service_agreements` has no write policy for anon or authenticated. BP document links are allow-listed (`schema.ts:39`).
- **CSRF:** `createCsrfMiddleware` is applied to all server functions (`src/start.ts:25`). The GET server functions (62) are
  read-only. `/api/admin/*` requires a Bearer token (no cookie auth). The guest-area cookie is `httpOnly`, `secure`,
  `SameSite=Lax`.
- **Headers:** HSTS, nosniff, XFO, frame-ancestors, base-uri, object-src and form-action are present (SEC-M1). A full script CSP is
  known future work.
- **Rate limits present:** password login, login code, reset, invite, inquiry (BP: honeypot plus 8 per 10 min per IP plus a DB
  limit), hospitality booking (PoW CAPTCHA plus guard), guest-area code, coupon check, guest order, license download, Grow webhook.
- **Open redirects:** none found. Every `location.assign` target is a URL the server built.
- **Webhooks:** the unsubscribe one-click endpoint uses a UUID token scoped to the tenant, and the license download uses a POST
  token with atomic consume.

---

### [MEDIUM] Direct `place_order` / orders INSERT: no rate limit, so an unlimited coupon oracle, stock reservation and notification flood

- **Severity:** Medium
- **File:line:** `src/routes/checkout.tsx:842` (the browser calls `supabase.rpc("place_order")` directly, with no server function in
  between). DB objects: `public.place_order`, `public.orders_apply_coupon`, policy `orders insert by customer or staff`.
- **Proof:**
  - `has_function_privilege('authenticated','public.place_order(text,jsonb,numeric,boolean,jsonb)','EXECUTE')` returns `t`.
    `has_column_privilege('authenticated','public.orders','coupon_code','INSERT')` returns `t`. The INSERT policy WITH CHECK is
    `customer_id = auth.uid() OR is_admin(...)`.
  - `place_order` copies `_details->>'coupon_code'` into the INSERT, and trigger `orders_apply_coupon` looks up the code with
    `RAISE EXCEPTION '%', problem`. The messages tell the cases apart: "not found or inactive", "not yet valid", "expired" and
    "used up" (`coupon_problem`). A valid code creates the order.
  - Neither `place_order` nor any orders trigger has a time or rate check (I grepped the bodies for `interval` and `rate`: none).
    The rate-limited path, `checkCoupon` at 20 per 10 min (`src/lib/marketing.functions.ts:59`, `check_coupon` service-only),
    is easy to bypass.
  - `order_items_stock_sync` reserves stock on insert, and `notify_new_order` writes `staff_notifications` for each order.
- **Exploit scenario:** an attacker registers one customer account (`registerCustomer`) and then scripts
  `POST /rest/v1/rpc/place_order` with the anon key, their JWT and the store's `x-tenant-id`. Each call tries a coupon code (for
  example a dictionary of `WELCOME10`, `VIP20` and so on) and gets a clear yes or no. Alternatively the attacker places hundreds of
  "offline" pending orders that hold all the stock.
- **Impact:** discount abuse through coupon enumeration (this bypasses the protection the platform deliberately added for
  ecommerce and, as SEC-L4, for hospitality). Inventory denial of service: stock stays reserved until staff cancel. Spam in the
  admin notifications and order list.
- **Suggested fix:** move logged-in checkout behind a server function with `allowAction` (as `placeGuestOrder` does), then
  `REVOKE EXECUTE ON place_order FROM authenticated` and drop the customer branch of the orders INSERT policy. Alternatively add a
  DB-side limit per `auth.uid()`, both for orders per hour and for failed coupon attempts. Return one generic coupon error to
  non-staff callers.
- **Status:** VERIFIED (catalog grants, policy and function bodies). Not executed: the DB is read-only.

### [MEDIUM] Grow webhook trusts `processToken` without a server-side status lookup

- **Severity:** Medium (if the token can reach the client), otherwise Low (hardening)
- **File:line:** `src/lib/grow-webhook.server.ts:24-45`, `public.grow_mark_paid` (catalog), `src/routes/api.webhooks.grow.ts:16`
- **Proof:** the webhook is unauthenticated (only rate-limited at 300 per 10 min per IP). `grow_mark_paid` accepts the request if
  `sha256(processToken)` matches the stored hash, `statusCode = '2'` and `sum` matches the amount. It then sets
  `payment_status = 'paid'` and triggers the order emails. `approveGrowTransaction` runs only *after* that, and its result is not
  checked. Nothing calls Grow's `getPaymentProcessInfo` or `getTransactionInfo` to confirm. `processId` and `processToken` are
  both returned by `createPaymentProcess` (`src/lib/grow.server.ts:152-160`). Only the `url` goes to the browser
  (`grow-payments.functions.ts:111`).
- **Exploit scenario:** if Grow's hosted page or its success redirect exposes `processId` / `processToken` to the payer (query
  string, page JS or postMessage; I could not check this offline), the payer can POST a forged `statusCode=2` with the right sum
  and get an order marked paid without paying.
- **Impact:** fake "paid" orders, so goods are shipped without payment.
- **Suggested fix:** before `grow_mark_paid`, confirm on the server with Grow (`getTransactionInfo` with the API key, or
  `approveTransaction` returning success) that the transaction exists, is paid and has the same sum. Alternatively record the
  webhook as "claimed paid" and flip it to paid only after confirmation. Also bind the request to `transactionId` uniqueness.
- **Status:** SUSPECTED. Whether the token can reach the client depends on how Grow behaves, which I did not verify.

### [LOW] Owner-invite account: email marked confirmed in GoTrue though never proved

- **Severity:** Low
- **File:line:** `src/platform/auth/accounts.server.ts:66-72` (`email_confirm: true`), compared with the header comment in
  `src/engines/business-profile/api/owner-invite.functions.ts:5` ("המייל לא מסומן כמאומת", "the email is not marked as verified").
- **Proof:** `inviteRedeem` takes any email the invite holder types and creates the account with `email_confirm: true`, so GoTrue
  sets `email_confirmed_at`. The platform's own "trusted" flag (`app_metadata.platform`) is set correctly only after the code,
  but GoTrue itself treats the email as verified.
- **Exploit scenario:** whoever holds the invite link (the owner, or anyone who saw the WhatsApp message) enters
  `victim@gmail.com` and a password they choose. Later the victim signs in with Google anywhere on the platform. If GoTrue
  automatic identity linking is on (the default links identities to an existing user with the same *confirmed* email), the
  victim's Google identity joins the attacker's account. That account becomes "trusted" (`providers ? 'google'` in
  `_platform_account_id`), so email-based role linking (SEC-H1) attaches the victim's future roles to an account whose password the
  attacker knows.
- **Impact:** account pre-hijacking. This is the same class as the documented residual risk for `registerCustomer`, but it is a
  new entry point, and the code comment claims the opposite.
- **Suggested fix:** create the account with `email_confirm: false`, or with a placeholder, and set it confirmed only in
  `bp_owner_email_code_verify`. Alternatively send the owner code before the account is created. Fix the comment either way.
- **Status:** SUSPECTED. The code path is verified. I did not check the identity-linking behavior of the GoTrue version in
  production.

### [LOW] Unverified custom domain blocks the real owner (domain squatting)

- **Severity:** Low
- **File:line:** `supabase/migrations/20261117090000_bp_site_address.sql:373-378` (`bp_custom_domain_set` rejects a domain that is
  already any other tenant's `custom_domain`) and the catalog index
  `tenants_custom_domain_key UNIQUE (custom_domain) WHERE custom_domain IS NOT NULL`. That index ignores verification, so it also
  covers ecommerce stores.
- **Proof:** `pg_get_indexdef` on `public.tenants` shows the unique index with no `custom_domain_verified_at` condition. The BP
  setter checks `t.custom_domain = _d` with no verification condition either.
- **Exploit scenario:** a competitor with a Nuriel store or site saves `www.victim.co.il` as its custom domain and never verifies
  it. When the victim tries to connect that domain, they get "הדומיין הזה כבר מחובר לאתר אחר במערכת" ("this domain is already
  connected to another site"), and this lasts indefinitely.
- **Impact:** denial of service on onboarding (support burden). No traffic is hijacked, because routing needs verification.
- **Suggested fix:** let the unique constraint apply only to verified domains (partial index on `custom_domain_verified_at IS NOT
  NULL`), and let a verified claim evict pending claims. Alternatively expire pending claims after N days.
- **Status:** VERIFIED (static + catalog).

### [INFO] HMAC key for the verify code falls back to the service-role key

- **File:line:** `src/engines/business-profile/api/owner-invite.functions.ts:63-67`
- **Detail:** `BUSINESS_PROFILE_SECRET || LOGIN_CODE_SECRET || SUPABASE_SERVICE_ROLE_KEY`. Reusing the service key as an HMAC key
  ties two secrets together, so rotating one affects the other, and a leaked HMAC key would mean a leaked DB key. It is derived
  through `createHmac(...)` first, which keeps the risk low.
- **Suggested fix:** require `BUSINESS_PROFILE_SECRET` or `LOGIN_CODE_SECRET` and fail closed. `setup-selfhost.sh` already
  generates `LOGIN_CODE_SECRET`.
- **Status:** VERIFIED (static).

### [INFO] Broad table grants to API roles (TRUNCATE etc.)

- **Proof:** `information_schema.role_table_grants` shows TRUNCATE for `anon` on 20 tables and for `authenticated` on 25 tables in
  the app schemas (for example `public.service_agreements` gets full DML plus TRUNCATE for both roles). RLS blocks DML, but RLS
  does **not** apply to TRUNCATE. PostgREST and pg_graphql do not expose TRUNCATE, so this is not exploitable today.
- **Suggested fix:** `REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public, hospitality FROM anon, authenticated;`
  and revoke DML from tables that have no write policy.
- **Status:** VERIFIED (catalog).

---

## Not covered / limits

- I did not go through all 400+ older server functions line by line again. The night-2026-11-13 scan covered them. I spot-checked
  `orders.functions.ts`, `checkout.functions.ts`, `auth.functions.ts` and the hospitality public and guest-area functions, and
  read all the new code since `e394df5` (business-profile API, billing, GTM/GA4, address, invite).
- I could not verify Grow's hosted-page behavior or production GoTrue/Kong settings, because I had no network access.
- Logging: `email.server.ts:311` logs the Resend error body, and `auth.functions.ts` logs a username that was not found.
  These are minor PII leaks already covered by PRV-16.

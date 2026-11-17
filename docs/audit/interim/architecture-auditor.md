# Architecture audit (interim) - Nuriel platform

Branch `audit/platform-review-2026-11`, worktree `/home/user/nuriel-stage2`, 2026-11-17. Read-only audit: static scripts over `src/`, `tests/`, `e2e/`, `scripts/`, catalog queries on the local test DB, and reading. No file other than this report was touched. The worktree has no `.git`, so no history was used.

**Caveat on the local DB.** `supabase_db_nuriel-e2e` has all 199 migrations' objects, but `schema_migrations` records only 196 (see B7). Catalog results describe the DB as built, not production. Size-dependent claims (index/RLS cost) are marked SUSPECTED because the local DB is empty.

## Summary

| ID | Sev | Title | Status |
|---|---|---|---|
| A1 | Medium | Ecommerce-only server functions are registered as "platform" and run on every site type (incl. an anonymous mail-sending one) | VERIFIED |
| A2 | Low | Hospitality logic and raw `hospitality`-schema access live in shared `src/lib/portal*`; bypasses the engine kill switch | VERIFIED (impact SUSPECTED) |
| A3 | Low | Boundary test blind spots (schema-level coupling, one big "ecommerce" bucket, hand-kept lint list, engine enums) | VERIFIED |
| A4 | Info | Platform host (`site === null`) allows every ecommerce-owned server function | VERIFIED |
| D1 | Low | 6 dead server functions (still live RPC endpoints) and a dead 391-line importer behind one | VERIFIED |
| D2 | Low | 21 unreferenced shadcn files keep 17 npm deps alive; stale `schema.sql`, `marketing/` | VERIFIED |
| D3 | Low | 5 unused deps incl. `xlsx` (2 High advisories) + a questionable direct pin | VERIFIED |
| D4 | Low | Duplicate implementations (rate limiters, escapeHtml x6, money formatters, slug regex, recipients, PostgREST helpers, support/billing stacks) | VERIFIED |
| B1 | Medium | RLS: 3 BP policies call `current_tenant_id()` per row; `is_admin(auth.uid())` per row on orders | VERIFIED / perf SUSPECTED |
| B2 | Medium | `order_items.product_id` (+ ~40 other non-audit FKs) have no supporting index | VERIFIED |
| B3 | Low | 11 redundant single-column indexes, 1 duplicate unique index (`user_roles`), `orders` has 19 indexes | VERIFIED |
| B4 | Low | 8 tenant tables with no `tenant_id`-leading index | VERIFIED |
| B5 | Low | 14 of 125 money/quantity columns lack a CHECK (VAT snapshot columns on `orders`) | VERIFIED |
| B6 | Info | Orphan backup table `price_tier_backup`; 4 RPCs with no caller | VERIFIED |
| B7 | Low | Migration drift: function in DB that no migration defines; last 3 migrations not recorded | VERIFIED (prod SUSPECTED) |
| B8 | Medium | 9 rollbacks `DROP TABLE` business/legal data with no data guard | VERIFIED |
| B9 | Info | Migration hygiene result: rollback gap is intentional; ordering clean; one unguarded destructive early migration | VERIFIED |
| C1 | Medium | Container healthcheck depends on DB + default tenant; Dockerfile comment says it is static | VERIFIED |
| C2 | Medium | 8 env vars read by code are never forwarded by `docker-compose.yml`; docs tell operators to set one | VERIFIED |
| C3 | Low | No central env validation; 79 raw `process.env[...]` reads in 40 files | VERIFIED |
| C4 | Low | CI gaps: no push trigger except `hospitality/**`, Docker build never run, no dependency audit, hand-kept strict-lint list | VERIFIED |
| C5 | Low | Container hardening: no resource limits / read-only / cap_drop, floating base tags | VERIFIED |
| C6 | Info | Deploy scripts: 2 without `-e`, one-off release scripts with hard-coded lists; `X-Real-IP` trust assumes Nginx | VERIFIED / SUSPECTED |
| E1 | Low | Docs drift: 8 spots checked, 8 stale | VERIFIED |

Totals (24 findings): 0 High, 6 Medium (A1, B1, B2, B8, C1, C2), 14 Low, 4 Info. Top three by impact: A1, C1, B8.

---

## 1. Engine boundaries

### [MEDIUM] A1 - Ecommerce-only server functions registered as "platform" run on every site type
- **Severity:** Medium
- **File:line:** `src/platform/engines/shared-functions.ts:9-26` (the list), `src/platform/engines/engine-guard.ts:26` (`owner === "platform"` returns allow); functions at `src/lib/site-forms.functions.ts:153,179`, `src/lib/email.functions.ts:10,119`, `src/lib/marketing-consent.functions.ts:108`
- **Proof:** `LEGACY_SHARED_SERVER_FN_FILES` is whole-file. These files contain order/checkout logic: `submitCancellationRequest` (calls `public.cancellation_request_submit`, which reads `public.orders`), `getCancellationCaptcha`, `sendOrderEmails`, `downloadOrderDocument`, `requestCheckoutMarketingConsent`. `decideServerFnAccess` returns `allow` for `owner === "platform"` before looking at the site, so a Hospitality or Websites site (engine on or off) serves them. `submitCancellationRequest` has no auth middleware (`site-forms.functions.ts:179-200`): after a captcha and an in-memory 5/15min IP limit it inserts into `cancellation_requests` (classified ecommerce) and emails a customer-supplied address (`confirmCancellationToCustomer`, line ~250).
- **Impact:** The dispatcher guarantee ("store functions never run on a Hospitality site", `src/engines/hospitality/README.md`) is false for these. Public, unauthenticated, mail-sending endpoint exposed on tenants that have no shop. Writes ecommerce rows for non-ecommerce tenants.
- **Suggested fix:** Split the shared files: keep generic parts (contact message, attachment link) in the shared list; move order/cancellation/checkout-consent functions to ecommerce-owned files (non-listed). The test at `boundaries.test.ts:433` only checks the file exists and has `createServerFn`; add a per-function allow-list or a rule that shared files may not reference `orders`/`order_`/`checkout`.
- **Effort:** M. **Status:** VERIFIED.

### [LOW] A2 - Hospitality logic in the shared legacy layer bypasses the engine switch
- **File:line:** `src/lib/portal.functions.ts:614-625` (`hospitalityRpc`, `Content-Profile: hospitality`), `:678-700` (`getPortalZimmerPlans/Offer`), `:755` (`openPortalZimmer`); `src/lib/portal-landing.server.ts:33-48`
- **Proof:** `portal.functions.ts` is in the shared (platform-owned) list. `openPortalZimmer` creates a hospitality tenant and has no reference to `HOSPITALITY_ENGINE` or a flag (`grep -n "HOSPITALITY_ENGINE\|featureEnabled" src/lib/portal.functions.ts` returns nothing). The coupling is by PostgREST schema header, not by `import`, so `boundaries.test.ts` cannot see it.
- **Impact:** The env kill switch (`HOSPITALITY_ENGINE`) does not stop portal-driven creation of hospitality tenants. Hospitality schema knowledge exists in two more places than the engine's own `server/rpc.server.ts`.
- **Suggested fix:** Move the Zimmer portal functions into the Hospitality engine (`api/`) and let the portal call them through the engine contract (`Engine.provision`, noted as future in `contract.ts:53`). Until then, gate `openPortalZimmer` on the engine switch.
- **Effort:** M. **Status:** VERIFIED (exploitability SUSPECTED; new tenants start closed).

### [LOW] A3 - What the boundary test cannot catch
- **File:line:** `tests/architecture/boundaries.test.ts:53-64` (`layerOf`), `.github/workflows/tests.yml:39`
- **Proof / details:**
  1. `layerOf` returns `"ecommerce"` for everything not platform/hospitality/BP/app/entry (`:63`). All of `src/lib`, `src/components`, `src/hooks`, `src/server`, `src/integrations` is one layer, so engine-specific code in it (A1, A2) is invisible. Only `import` edges are checked; schema, RPC-name and table coupling are not.
  2. Engine enumerations are inconsistent: `SITE_TYPES` has 3 (`contract.ts:6`) but `src/platform/billing/types.ts:4` (`Engine = "ecommerce" | "hospitality"`), `billing.{agreements,upgrade_requests,ledger}.engine CHECK (engine IN ('ecommerce','hospitality'))` (`20261114100000_billing_agreements.sql:65,115,147`) and `src/platform/ai/types.ts:14` have 2. A `business_profile` tenant cannot get a billing agreement. `src/platform/ai/admin.server.ts:145` coerces any non-hospitality type to `"ecommerce"` (harmless today: `ai_admin_list` already filters, verified in catalog).
  3. The strict-lint step (`tests.yml:39`) is a hand-kept file list; 14 route adapters are missing from it (`manage.documents/packages/reports/setup/support/support_.$ticketId`, `stay.account/brand.$asset/docs.$docSlug/packages.$packageSlug`, `studio.inbox/settings`, `studio_.invite`, `platform_.websites_.$tenantId`). The vitest boundary test still covers them, so this is Low.
- **Suggested fix:** Add a test that scans non-engine files for `Content-Profile`/`hospitality.`/`bp_` string use; derive the lint list by glob (`src/routes/{manage,stay,studio,bp-site}*`) instead of enumerating.
- **Effort:** S. **Status:** VERIFIED.

### [INFO] A4 - `site === null` allows all ecommerce-owned functions
- **File:line:** `src/platform/engines/engine-guard.ts:27`
- **Proof:** `if (!site) return owner === "ecommerce" || platformAdmin ? "allow" : "not_found"`. On `PLATFORM_ADMIN_HOST`, `currentSite()` returns null (`current-site.server.ts:9`), so every store function is callable there, not just the platform-admin ones; the DB resolves tenant via the default-tenant fallback in `current_tenant_id()`. Documented as "as today"; auth still applies.
- **Fix:** none now. When the platform panel is split from the store code, mark platform-admin functions explicitly.
- **Status:** VERIFIED.

**Checked and clean (boundaries):**
- Transitive import closure from Hospitality (44 ecommerce-layer files) and Websites (42): all enter only through the 11 listed platform adapters (`platform/ui`, `tenancy/*`, `auth/*`, `email/send`, `media/*`, `pdf/hebrew`); no path reaches another engine or `src/app`.
- DB level: no Hospitality function touches ecommerce tables or `business_profile`; no BP function touches `hospitality`; only `user_roles_owner_guard`, `platform_billing_renew`, `site_tracking_*` (platform functions) reference `hospitality.*`.
- Edge gates (`hospitality/edge/gate.ts`, `business-profile/edge/gate.ts`) are allow-lists; engine route layouts carry `beforeLoad` site-type guards (`hospitalitySiteOnly`, `businessSiteOnly`, `bp-site.tsx:9`), including the `_`-escaped routes (`manage_.login`, `manage_.preview`, `studio_.*`). `/platform/*` is blocked on store hosts (`server.ts` `storeGate`).
- All 1,052 `src` files resolve; every `src/routes/*` file is in `routeTree.gen.ts`; server-fn files are in `src/lib` (about 50), `src/platform` (2), `src/engines/*` (38); none in routes/components/hooks/server; the ownership counts in the test (31 Hospitality, 7 BP) match disk.

---

## 2. Dead code and duplication

Method: import graph over `src` + `tests`/`e2e`/`scripts` consumers, rooted at `routeTree.gen.ts`, `router.tsx`, `start.ts`, `server.ts` and every route file (script: scratchpad `graph.mjs`); dynamic imports and `import.meta.glob` are followed. Result: 1,052 files, 21 unreachable, all in `src/components/ui`. Candidates were then checked for any name mention in `src`, `tests`, `e2e`, `scripts`.

### [LOW] D1 - Dead server functions
- **File:line:** `src/lib/product-import.functions.ts:54` `importProductsBatch`; `src/lib/support.functions.ts:64` `getSupportUnreadCount`; `src/engines/business-profile/api/studio.functions.ts:119` `studioVersion`; `src/engines/hospitality/api/emails.functions.ts:34` `hospitalityDashboard`; `src/engines/hospitality/api/guest-area.functions.ts:199` `hospitalityGuestAreaSetPaymentMethod`; `src/engines/hospitality/api/website.functions.ts:487` `hospitalitySiteSetPaymentMethod`
- **Proof:** the name occurs once in the repo (its own declaration); no UI, test, e2e or docs reference. `importProductsBatch` is the only caller of `importCsvBatch` (`src/server/services/csv-import.ts`, 391 lines) and of most of `src/lib/csv-import.ts`'s 13 unused exports (superseded by `beginProductImport`/`applyProductImportBatch`, same file `:217,268`). The two payment-method setters have DB functions (`guest_area_set_payment_method`, `guest_set_payment_method`) and no UI: either the feature is unfinished or removed.
- **Impact:** Each is a callable RPC endpoint with no test or UI exercising it (SUSPECTED: TanStack registers every `createServerFn` in a bundled module). Dead attack surface and maintenance.
- **Fix:** delete, or wire the UI. Remove `csv-import` service chain with `importProductsBatch`. 22 more exported helpers/constants are fully dead (full list in the scratchpad `dead-exports.mjs` output; e.g. `shownAsSoldOut`, `prorateAddon`, `toVisualRtlLines`, `getBrowserSession`, `warrantyActive`, `loadLabelSize`).
- **Effort:** S. **Status:** VERIFIED.

### [LOW] D2 - Unreferenced UI primitives, stale files
- **File:line:** `src/components/ui/{accordion,alert,aspect-ratio,avatar,breadcrumb,calendar,carousel,collapsible,context-menu,drawer,form,hover-card,menubar,navigation-menu,pagination,resizable,scroll-area,sidebar,toggle-group,toggle,tooltip}.tsx`
- **Proof:** zero importers outside each other. They are the only users of 17 dependencies: `@radix-ui/react-{accordion,aspect-ratio,avatar,collapsible,context-menu,hover-card,menubar,navigation-menu,scroll-area,toggle,toggle-group,tooltip}`, `embla-carousel-react`, `react-day-picker`, `react-hook-form`, `react-resizable-panels`, `vaul`.
- Also: `schema.sql` (10 KB, "Multi-store inventory management schema", creates `stores`/`store_inventory` that migration `20260907120000` drops; referenced only by `.dockerignore`); `marketing/banner-3d` (23 MB, no references).
- **Fix:** delete the files and the dependencies (not bundled today, so no runtime saving; install weight and audit noise only).
- **Effort:** S. **Status:** VERIFIED.

### [LOW] D3 - Unused dependencies
- **File:line:** `package.json:35` (`@hookform/resolvers`), `:71` (`date-fns`), `:74` (`html5-qrcode`), `:83` (`react-image-crop`), `:93` (`xlsx`), `:67` (`@tanstack/router-plugin`)
- **Proof:** no import/require in `src`, `scripts`, `e2e`, `tests`, vite/vitest/eslint config. `xlsx` appears only as a MIME-map key (`src/lib/site-forms.ts:37,87`). `bun-audit.txt:60-63`: `xlsx@0.18.5` carries 2 High advisories (prototype pollution, ReDoS), and it is a direct dependency, so it appears in every audit. `date-fns` is also a transitive dep of `react-day-picker`. `@tanstack/router-plugin` is pinned directly but `@tanstack/start-plugin-core` already depends on the identical version (`bun.lock:488`): possibly an intentional pin (SUSPECTED), confirm before removing. `canvas` (devDep) is used only by the manual script `scripts/label-visual-check.ts` (keep, but note the native build).
- **Fix:** remove the five; this clears the `xlsx` advisories for free.
- **Effort:** S. **Status:** VERIFIED.

### [LOW] D4 - Duplicate implementations
- **Rate limiters (two):** `src/lib/rate-limit.server.ts:1-55` (per-process Map, reset on restart; used by Ecommerce, platform AI, and the Websites engine: `business-profile/api/inquiries.functions.ts:74,219`, `owner-invite.functions.ts`) vs `src/engines/hospitality/security/rate-limit.server.ts` (DB-backed `rate_check`, shared across servers, HMAC keys). `src/platform/security/rate-limit.server.ts:2` just re-exports the weak one. The public Websites form and owner-invite endpoints therefore get the weaker limiter although a shared one exists; the better one cannot be used by BP without an engine-to-engine import. SUSPECTED impact (single container today); fix is to promote the DB limiter to `src/platform`. Effort M.
- **Email:** one transport only (Resend via `sendEmail`, `src/lib/email.server.ts:206`; `platform/email/send.server.ts` wraps it). Not duplicated. But "who gets platform alerts" is copied 5 times: `src/lib/addons.server.ts:21`, `src/lib/support.server.ts:53`, `src/lib/portal-notify.server.ts:45`, `src/engines/hospitality/server/support.server.ts:137`, `src/platform/ai/renewals.server.ts:81`.
- **`escapeHtml` x6:** `lib/email.server.ts:336`, `lib/rich-text.ts:76`, `lib/stock-count.ts:149`, `lib/url-import.ts:46`, `lib/blocked-pages.ts:33`, `platform/branding/credit.ts:23`.
- **Money formatters:** about 15 local `money`/`formatMoney`/`formatIls` (`lib/catalog.ts:312`, `lib/stock-count.ts:137`, `lib/dashboard.ts:132`, `platform/billing/logic.ts:69`, `lib/pdf/document.server.ts:93`, and 9 inside Hospitality: `management/lib/format.ts:57`, `pricing/model.ts:15`, `bookings/ProofsCard.tsx:31`, `PaymentsCard.tsx:28`, `ReportsPage.tsx:248`, `CalendarPage.tsx:1418`, `outbox/templates.ts:73`, `website/lib/format.ts:13`, `PlatformHospitalityPage.tsx:523`).
- **Slug regex x5:** `lib/portal.ts:16`, `lib/platform.functions.ts:39`, `bp/api/address.functions.ts:8`, `bp/api/platform-admin.functions.ts:18`, `hospitality/validation/platform-admin.ts:9` (this one caps at 40 chars, the others 63) plus 3 DB functions (`platform_slug_problem`, `tenant_slug_problem`, `bp_slug_check`).
- **Hand-rolled PostgREST RPC clients:** 11 near-identical `fetch(.../rest/v1/rpc/${fn})` helpers (`hospitality/server/rpc.server.ts:27,54` plus `contracts.server.ts:38,382`, `support.server.ts:146`, `video-check.server.ts:24`, `channels/import.server.ts:17`, `channels/feed.server.ts:12`, `website/seo.server.ts:38`, `security/rate-limit.server.ts:75`, `outbox/worker.server.ts:89`, and the two portal files in A2). Some exist because gate code cannot import `server/` (documented), the rest are copies.
- **Two billing stacks:** legacy `src/lib/billing.functions.ts` (`getStoreBilling`, `platformExtendTrial`, `platformRecordPayment`, `platformSavePricing`, `saveBillingProfile`) and `src/platform/billing/*` (migration 189). All still called from UI, so live, but both write subscription state.
- **Two support-ticket stacks:** `public.support_tickets/messages` (`src/lib/support.functions.ts`) and `hospitality.support_*` (`hospitality/api/support.functions.ts`, `server/support.server.ts`).
- **Status:** VERIFIED. **Effort:** S per item, M for rate limiter/billing.

---

## 3. Database (local catalog; migrations 1-199)

### [MEDIUM] B1 - RLS policies evaluate helper functions per row
- **File:line:** SQL: `business_profile.{inquiries,inquiry_notes,inquiry_settings}` policy `tenant_isolation`; `public.upgrade_requests` "store admin or platform admin read"; `public.orders`/`order_items` policies. Source: `supabase/migrations/20261116120000_bp_inquiries.sql`.
- **Proof:**
  ```
  SELECT ... pg_policy: business_profile.inquiries / tenant_isolation: (tenant_id = current_tenant_id())
  ```
  109 other policies use `(SELECT current_tenant_id())` (InitPlan, evaluated once); these 4 call it bare. `current_tenant_id()` is `plpgsql STABLE SECURITY DEFINER` (JSON header parse, `EXISTS`/`count(*)` over `user_roles`, fallback lookup in `tenants`): not inlinable, so it runs per row. Separately, 8 policies call `is_admin(auth.uid())` bare and `orders select` uses `can_view_order(customer_id, agent_id)` (SECDEF -> `is_admin` -> `is_super_admin` -> `EXISTS user_roles ... current_tenant_id()`): about 4 nested calls and 2-3 sub-queries per candidate order row for any RLS-bound (non-service) read.
- **Impact:** SUSPECTED CPU cost growing linearly with rows read through the user-JWT client (inquiry lists, order lists). Newest code (Websites) is the one that regressed from the convention.
- **Fix:** `tenant_id = (SELECT current_tenant_id())` in the 4 policies; wrap `(SELECT is_admin(auth.uid()))` or add `staff` fast-path in `can_view_order`.
- **Effort:** S. **Status:** VERIFIED (structure) / SUSPECTED (cost).

### [MEDIUM] B2 - Foreign keys without a supporting index
- **Proof (catalog): 85 FKs have no index whose leading columns match (ignoring a leading `tenant_id`); 32 of them point at `auth.users` (audit columns), leaving about 40 that matter. The list below omits audit columns:**
  - `public.order_items (tenant_id, product_id) -> global_products ON DELETE RESTRICT`: `order_items` has indexes on `(order_id)`, `(tenant_id)`, partial `variant_id`, partial `(order_id, promotion_id)` - none on `product_id`. Every product delete/merge checks the largest table with a scan.
  - Also: `order_items.promotion`, `product_variants.product_id` (has `(product_id, sort_order)` - OK), `location_transfer_lines.product_id`, `abandoned_carts.recovered_order_id`, `contact_messages.order_id`, `cart_promotions.gift_product_id/category`, `license_deliveries.{guide,installer,receipt}_file_id`, `license_download_links.file_id`, `hospitality.client_contracts.guest_id`, `hospitality.arrival_info.unit_id`, `hospitality.units.category_id`, `hospitality.packages.policy_id`, `hospitality.support_attachments.ticket_id`, `hospitality.subscriptions.plan_code`, `billing.ledger.{agreement,upgrade_request}_id`, `billing.upgrade_requests.agreement_id`, `business_profile.site_versions.template/based_on`, `business_profile.sites.live_version_id`, plus 15 `-> auth.users` audit columns.
- **Impact:** SUSPECTED (empty DB): slow deletes/merges and joins on `order_items`; lock amplification on parent deletes.
- **Fix:** `CREATE INDEX CONCURRENTLY order_items_product_idx ON order_items (tenant_id, product_id)`, then the hot ones above (`abandoned_carts.recovered_order_id`, license file FKs). Leave audit-user FKs unindexed.
- **Effort:** S. **Status:** VERIFIED.

### [LOW] B3 - Redundant and duplicate indexes
- **Proof:** 11 indexes are a strict prefix of another index on the same table (19 index pairs): `orders_tenant_id_idx`, `user_roles_tenant_id_idx`, `categories_tenant_id_idx`, `customer_profiles_tenant_id_idx`, `global_products_tenant_id_idx`, `location_transfers_tenant_id_idx`, `stock_counts_tenant_id_idx`, `product_variants_tenant_idx`, `cart_promotions_tenant_idx`, `product_duplicate_dismissals_tenant_idx`, `stock_count_lines_count_idx`. `public.user_roles` has both `user_roles_pkey (tenant_id,user_id)` and `UNIQUE user_roles_tenant_user_key (tenant_id,user_id)` (identical). `orders` carries 19 indexes (write amplification on the hottest table).
- **Fix:** drop the prefix indexes; keep the unique only if an FK targets it (check `pg_constraint.conindid` first). **Effort:** S. **Status:** VERIFIED.

### [LOW] B4 - Tenant tables with no `tenant_id`-leading index
- **Proof:** `order_delivery_events`, `order_courier_links`, `public.support_messages`, `hospitality.support_attachments`, `ai_subscription_periods`, `ai_subscription_events`, `business_profile.inquiry_notes`, `platform_admin_handoffs`. RLS adds `tenant_id = ...` to every user-JWT query; they rely on another index plus a filter. Fine at current size, matters only if per-tenant listings grow. **Fix:** add when volume appears. **Effort:** S. **Status:** VERIFIED.

### [LOW] B5 - Money/quantity columns without CHECK
- **Proof:** of 125 numeric/integer columns matching money/quantity names, 111 have a CHECK. Missing: `orders.vat_rate` (NOT NULL, no range), `orders.{gross,net,vat}_amount`, `orders.coupon_discount_value`, `order_items.picked_qty`, `stock_count_lines.{applied_quantity,reserved_open}`, `product_merges.stock_{before,after}`, `hospitality.bookings.nights`, `billing.upgrade_requests.list_price_monthly`, `order_courier_links.opened_count`, `price_tier_backup.price_tier`. Mitigation: `orders_vat_snapshot_guard` trigger; all money is `numeric` (no float/money types), all timestamps `timestamptz`, no table without a PK, no nullable `tenant_id` except by design (`tenant_ssl`, platform logs). **Fix:** `CHECK (vat_rate BETWEEN 0 AND 100)`, non-negative on amounts/qty. **Effort:** S. **Status:** VERIFIED.

### [INFO] B6 - Orphans
- `public.price_tier_backup`: created and filled by `20261001090000_catalog_home_upgrades.sql:53-62`, never read (no function body, no code, not in `types.ts`). Drop after retention decision.
- Functions with no caller anywhere (code, other functions, triggers, policies, deploy scripts): `public.platform_billing_pending_count()`, `public.platform_bp_set_media_quota` (docs only), `hospitality._dashboard_nights`, `hospitality.admin_plans`. Others that looked dead are used dynamically or by ops (`request_booking_*_with_documents` via `${fn}_with_documents`, `website.functions.ts:83`; `ssl_agent_report`/`custom_domain_report` by `deploy/ssl/store-certs.sh`; `notify_admins_system` by `deploy/backup-daily.sh`).
- No table is orphaned otherwise; all 20 tables without `tenant_id` are legitimately global (plans, flags, templates, platform settings, `site_requests`).

### [LOW] B7 - Migration drift in the local DB
- **Proof:** `bp_owner_email_mark_verified(_tenant uuid, _user_id uuid)` (SECURITY DEFINER, grants `service_role` only) exists in the DB but appears in no migration, no rollback (`supabase/rollbacks/20261117100000_bp_owner_invites.down.sql:15-24` drops 5 sibling functions but not this one), no code, and is the only function missing from `docs/architecture/db-classification.md`. `schema_migrations` stops at `20261116120000`, yet objects of the last three migrations (`bp_address_state`, `bp_invite_*`, `save_my_ga4`) exist: applied out of band. Inference: `20261117100000_bp_owner_invites.sql` was edited after it was applied.
- **Impact:** if any shared environment ran the earlier draft, it keeps this function and rollback cannot remove it. Not exploitable (no anon/authenticated grant). Release scripts track `_migrations_applied` by filename, so an edited file is never re-applied.
- **Fix:** `DROP FUNCTION IF EXISTS public.bp_owner_email_mark_verified(uuid,uuid)` in the next migration (and add to the rollback); a CI check that diffs the catalog after `run.sh` against a snapshot would catch edit-in-place. **Effort:** S. **Status:** VERIFIED here / SUSPECTED for staging and prod.

### [MEDIUM] B8 - Rollbacks that drop data tables without a guard
- **File:line:** `supabase/rollbacks/20261102150000_hosp_site_design`, `20261102160000_hosp_room_types`, `20261102170000_hosp_payments.down.sql:12`, `20261102180000_hosp_channels.down.sql:20-21`, `20261103090000_hosp_security`, `20261105140000_hosp_payment_instructions`, `20261107100000_lic_digital_licenses.down.sql:9-12`, `20261110210000_hosp_consent.down.sql:8`, `20261019570000_announcement_coupon_email`
- **Proof:** 36 rollbacks contain `DROP TABLE/SCHEMA`; 27 have a `RAISE EXCEPTION` data-presence guard (the Websites ones do, e.g. `20261116120000_bp_inquiries.down.sql:14`); these 9 only carry a comment ("back up first", `lic_digital_licenses.down.sql:3`). They drop payments, channel calendars, `consent_records` (consent evidence), `license_audit` (append-only audit log).
- **Impact:** `release-next.sh:92-98` and `release-websites.sh:121` print the exact `psql < <migration>.down.sql` command for the operator ("DB rollback only with explicit approval, newest first"); nothing in the SQL stops that command from deleting real bookings, consents or audit rows if run after go-live.
- **Fix:** add the same `IF EXISTS (SELECT 1 FROM ...) THEN RAISE EXCEPTION` pattern; the rollback test script can assert it for every `DROP TABLE`. **Effort:** S. **Status:** VERIFIED.

### [INFO] B9 - Migration hygiene results
- 199 migrations, 88 rollbacks. **116 migrations have no rollback: intentional.** `tests/architecture/migrations.test.ts:12` sets `BASELINE = "20261101090000"`; only migrations from that stamp (83) need `*.down.sql`, and all 83 have one, none orphaned, `rollback-check.sh` lists `M1..M83` in order. 5 pre-baseline rollbacks exist (harmless).
- Timestamps: 14 digits, unique, sorted; some pre-baseline stamps use a fake time (`20261019560000`, sequence hack). The newest is `20261118100000` (tomorrow): a hotfix migration stamped today would sort before it, and the test (`migrations.test.ts:36-40`) only requires "newer than migration 7", not "newer than the newest applied".
- Destructive statements: none unguarded outside `20260907120000_b2b_beverage_platform.sql:10-15,186,195` (`DROP TABLE ... CASCADE` on orders/order_items, `DELETE FROM global_products/categories`). Safe only because deploy tooling records applied files in `public._migrations_applied` (`setup-selfhost.sh:441-455`, `release-*.sh`); a fresh DB build wipes nothing. No `TRUNCATE`, no unguarded `DROP COLUMN`.
- Other checks clean: RLS on in all 4 schemas (0 tables without it); every `SECURITY DEFINER` function sets `search_path` (0 without); no views; naming consistent (`created_at` 118x, `tenant_id` everywhere; minor: `window_ends`, `current_period_end`, `actor` vs `actor_id`).

---

## 4. Config and infra

### [MEDIUM] C1 - Healthcheck is not static; the comment says it is
- **File:line:** `Dockerfile:51-54`, `docker-compose.yml:75`, `src/server.ts:40,159`
- **Proof:** Dockerfile comment: "static file - does not depend on SSR or Supabase". `/robots.txt` is in `FEED_PATHS` and excluded from the static fast path (`server.ts:159`), so the probe `GET http://127.0.0.1:3000/robots.txt` runs `resolveTenant("127.0.0.1")` (RPC `tenant_for_host`, 15 s cache, `tenant.server.ts:35,65`), falls back to the default tenant (`tenant_for_host` last branch), then `siteTypeOf` and `renderFeed` (more DB calls). No default tenant, a DB blip, or a slow DB (5 s timeout) turns the container unhealthy.
- **Impact:** a DB or Supabase restart escalates to an app restart/removal from routing under Coolify/Traefik.
- **Fix:** add a real liveness route that does no I/O (`/healthz` returning 200 before tenant resolution in `server.ts`, like the static-path branch) and point both healthchecks at it.
- **Effort:** S. **Status:** VERIFIED (code path); behaviour on Coolify SUSPECTED.

### [MEDIUM] C2 - Env vars the code reads but compose never passes
- **File:line:** `docker-compose.yml:30-73` (explicit `environment:` list, no `env_file`); readers: `SUPPORT_NOTIFY_EMAIL` (`lib/addons.server.ts:21`, `lib/support.server.ts:53`, `lib/portal-notify.server.ts:45`, `hospitality/server/support.server.ts:137`, `platform/ai/renewals.server.ts:81`), `BUSINESS_PROFILE_SECRET` (`bp/api/owner-invite.functions.ts:61`, `bp/inquiries/service.server.ts:46`), `CUSTOM_DOMAIN_CNAME_TARGET` (`lib/custom-domain-dns.server.ts:86`), `IMPORT_IMAGE_ALLOW_HOSTS` (`server/services/image-fetch.ts:157`), `AI_RENEWAL_JOB` (`ai/renewals.server.ts:186`), `RESEND_API_URL`, `GROW_SANDBOX_URL`, `SITEMAP_TTL_MS`.
- **Proof:** `setup-selfhost.sh:232-239` writes an override that adds only `container_name` and `ports`. So these variables, even if present in the server `.env`, never reach the process. `docs/hospitality/release-g-deploy.md:70` presents `SUPPORT_NOTIFY_EMAIL` as an operator setting. `BUSINESS_PROFILE_SECRET` is in no doc, `.env.example` or compose (falls back to `LOGIN_CODE_SECRET`, then the service-role key). `.env.example` also lacks `BUSINESS_PROFILE_ENGINE` although compose and `release-websites.sh` use it.
- **Impact:** silent misconfiguration; alert routing, DNS-verification target and secret separation cannot be configured as documented.
- **Fix:** add the 8 vars to compose (`${VAR:-}`) and `.env.example`, or switch to `env_file: .env`. Add a test that every `process.env[...]` name in `src` appears in compose.
- **Effort:** S. **Status:** VERIFIED.

### [LOW] C3 - No central environment validation
- **Proof:** 79 raw `process.env["X"]` reads in 40 files; no schema, no startup check. Misconfiguration surfaces per request as `throw new Error("תקלת הגדרות בשרת")` (e.g. `hospitality/security/secret.server.ts:14`). Secrets fall back in chains (`HOSPITALITY_SECRET -> LOGIN_CODE_SECRET -> SUPABASE_SERVICE_ROLE_KEY`; same for BP), compose defaults every secret to empty (`docker-compose.yml:38-73`). Only `SUPABASE_URL`/`PUBLISHABLE`/`SERVICE_ROLE` are `:?` required.
- **Fix:** one `src/platform/env.server.ts` parsed at boot (fail fast for required, warn for optional, min-length for secrets), called from `server.ts`. See also the security auditor's INFO on the HMAC fallback. **Effort:** M. **Status:** VERIFIED.

### [LOW] C4 - CI gaps
- **File:line:** `.github/workflows/tests.yml:9-13,35-51,40-42`
- **Proof:** triggers are `push: hospitality/**`, `pull_request`, manual. A push to the default/deploy branch or to branches like `websites/**` or this audit branch runs nothing unless a PR exists. The Docker image (what production runs) is never built in CI (header says so, line 5); the Dockerfile uses `oven/bun:1` while CI pins bun 1.4.4. `bun audit` is not run (`docs/audit/interim/bun-audit.txt` shows 8+ High). Third-party actions use major tags, not SHAs. Whole-repo lint is `continue-on-error`; the strict list (line 39) is hand-maintained (A3).
- **Fix:** add `push: branches: [main]`; add a `docker build` job (with the two placeholder build args); add `bun audit --audit-level high` (non-blocking at first); pin bun in the Dockerfile. **Effort:** S. **Status:** VERIFIED.

### [LOW] C5 - Container hardening
- **Proof:** good: multi-stage, `USER node` (`Dockerfile:48`), `--frozen-lockfile`, `init: true`, healthcheck, log rotation, secrets not baked (`.dockerignore` excludes `.env*`, `tests`, `e2e`, `deploy`, `supabase`). Missing: `mem_limit`/`cpus` (jspdf/sharp/PDF paths can balloon), `read_only: true` + tmpfs, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`; `node:22-slim` and `oven/bun:1` not pinned by version/digest; `docker-compose.yml` runs one replica while three in-process jobs start at import (`server.ts:47-51`) and the in-memory limiter is per process (D4): scale-out needs a note or a leader guard. Build context still includes `docs/` and `marketing/` (23 MB; `.dockerignore` excludes only `*.md`).
- **Effort:** S. **Status:** VERIFIED.

### [INFO] C6 - Deploy scripts
- `deploy/check-default-secrets.sh:13` (`set -uo pipefail`, no `-e`) and `deploy/staging/infra-check.sh:11` (`set -u`) are the only scripts without strict mode (intentional for check scripts, verify). `release-next.sh:28-29` and `release-websites.sh:33-34` hard-code `NEW_MIGRATIONS`/`EXPECTED_BEFORE` per release, so older scripts are dead once shipped (release-next covers 189-192, already in prod); `20261118100000_site_tracking_ga4` is in neither. `deploy/DEPLOY.md:22` contains a server IP.
- `src/platform/security/client-ip.ts:3` trusts `X-Real-IP` because "Nginx overwrites it" (`deploy/nginx/*.conf:24,39`), but `docker-compose.yml:6-14` targets Coolify/Traefik. If production ever runs behind Traefik without an equivalent overwrite, a client-supplied `X-Real-IP` would defeat all IP limits. SUSPECTED, unverified.
- Nginx template: `/_serverFn/` header check present (`:16-17`); no body-size or timeout issues found.

---

## 5. Docs drift (spot check, 8 documents)

### [LOW] E1 - Documents that no longer match the code
| Doc | Claim | Reality (proof) |
|---|---|---|
| `Dockerfile:51` | healthcheck is a static file independent of SSR/DB | see C1 |
| `README.md:5,50-57` | single B2B drinks portal; "all tables include `tenant_id`"; migrations run by hand in SQL Editor | 3 engines + platform panel; 20 tables have no `tenant_id` (catalog); deploy is `deploy/release-*.sh` with `_migrations_applied` |
| `deploy/DEPLOY.md:28,32,43` | nginx templates at `deploy/nginx-*.conf`; put `RESEND_API_KEY` in `.env.production` | files are `deploy/nginx/*.conf`; compose has no `env_file`, `setup-selfhost.sh:232` writes `.env`; `.env.production.example:1` also stale |
| `docs/testing.md:15` | `test:db:rollback` covers migrations 1-10 | `rollback-check.sh` has `M1..M83` (83 entries) |
| `docs/hospitality/migrations.md:3-4` | log of all Hospitality migrations; "applied only locally and in CI until deployment is approved" | documents 28 of 56 `_hosp_` migrations (stops at `20261103120000`); migrations 1-198 are deployed (`release-websites.sh:29`) |
| `src/engines/hospitality/README.md:29,35` | gate: "every page -> 404 (the website renderer arrives in Stage 4)"; `api/` has 5 files | gate serves ical, `/stay`, `/manage`, sitemap (`edge/gate.ts`); `api/` has 28 files |
| `docs/hospitality/architecture.md:20-40` | two engines; 6 platform adapters | 3 engines (BP absent from the document); 13 adapters in `boundaries.test.ts:91-133` |
| `.env.example` | complete env list | missing `BUSINESS_PROFILE_ENGINE`, `BUSINESS_PROFILE_SECRET` (C2) |

`docs/architecture/db-classification.md` is accurate against the repo (94 tables, counts add to 509 functions); the single difference is B7's stray function. `CI header "28 known formatting errors"` (`tests.yml:40`, `docs/testing.md`) could not be re-verified (a scoped ESLint run returned no findings) - SUSPECTED stale.
- **Fix:** refresh the three architecture docs, regenerate nothing by hand where a script exists, add `BUSINESS_PROFILE_*` to `.env.example`. **Effort:** S-M. **Status:** VERIFIED.

---

## What was checked and found clean
- Boundary test suite scope and the ESLint mirror (`boundaries.test.ts`, 561 lines): consistent with disk; transitive engine isolation holds (see A-section).
- Route gating by engine/flag: allow-list gates, route `beforeLoad` guards, `/platform` on store hosts blocked.
- Server-fn ownership: 7 BP + 31 Hospitality files exactly as the test pins; `LEGACY_SHARED_SERVER_FN_FILES` all exist (but see A1 for content).
- Single email transport (Resend); `sendBusinessEmail` adds an idempotency key.
- DB: RLS enabled on all 161 tables in the 4 schemas, all `SECURITY DEFINER` have `search_path`, no float money, no tz-less timestamps, every table has a PK, all `tenant_id` columns have an FK except the intentional ledger/audit tables (`billing.*`, `billing_history`, `platform_audit_log` - "no FK so the record survives tenant deletion", `20261114100000_billing_agreements.sql:61`).
- Tenant-isolation policy coverage: 112 RESTRICTIVE `tenant_isolation` policies; the 29 tenant tables without one have no `anon`/`authenticated` privileges (5 have a read-only platform-admin policy: `platform_agreement_acceptances`, `platform_audit_log`, `platform_documents`, `platform_email_log`, `upgrade_requests`).
- No tables for engines referenced across schemas; `tenants` host-lookup columns are all uniquely indexed.
- `tests.yml` has `contents: read`, no secrets, ephemeral DB; `.gitignore` excludes `.env*`, `e2e/.auth`, `e2e/.supabase`.

## Method notes
Scripts (scratchpad, not in repo): `graph.mjs` (import graph, unreachable files, unused exports), `dead-exports.mjs`, `deps.mjs`/`deps2.mjs` (dependency usage by live vs dead files), `trans.mjs` (transitive engine reach). SQL used only `SELECT` on catalogs. No tests were run (vitest/ESLint would write caches); the boundary test was read and its rules re-derived by script instead.

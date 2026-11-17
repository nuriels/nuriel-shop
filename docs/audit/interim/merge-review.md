# Merge review: origin/main -> audit/platform-review-2026-11

- Analysed HEAD: `7b101e763ee4e39d43277df40f4e7661d7d28283` (commit "Audit: merge plan numbers (303 commits, 1367 files)", 2026-11-17 06:38). `origin/main` = `4f7daa3dddce37f3d4542bfa974778202d7a506c` (merge-base = origin/main, so a fast-forward is possible).
- Method: read-only git plumbing only. `git fetch origin` run once at the start (no ref moved). Scratch in /tmp/merge-review/. No tracked file touched.
- Note: the lead's working tree has UNCOMMITTED edits (docs/architecture/db-classification.md, scripts/db-classification.mjs, scripts/db-tests/db-classification.test.sql, scripts/db-tests/rollback-check.sh). They are not part of 7b101e7 and were NOT analysed.
- Commit list: `docs/audit/COMMITS-main-to-audit.txt` (304 commits, oldest first + trailer line).
- Discrepancy: the merge plan says "303 commits"; `git rev-list --count origin/main..7b101e7` = **304** (298 non-merge + 6 merge). 1367 files / +260,835 / -1,594 match the plan exactly.

## 1. Commits grouped by lineage

Method: every commit in `origin/main..HEAD` is assigned to the SMALLEST remote branch tip that contains it (`git rev-list origin/main..origin/<b>` per branch, ties by lineage order). Lineage (checked with `git merge-base --is-ancestor` and merge-bases):
`stage-0 -> stage-1 -> stage-2 (170 commits shared with seo; seo forked at 6dd034b) -> seo (80ddb09) -> ecommerce/{import-sync, product-duplicates} -> ecommerce/store-release (merge of both) -> documents (merges seo, d9c85a8) -> signing-mobile (merges store-release, 538f336) -> hospitality/release (trial merges of signing-mobile + maintenance) -> release/next (= billing/agreements, same tip 31ccb4c) -> websites/engine -> hospitality/tracking-settings -> audit/platform-review-2026-11`.
Every other active branch is fully contained in `hospitality/tracking-settings` (`git rev-list --count origin/hospitality/tracking-settings..origin/<b>` = 0 for all 14 checked).

| Group (first branch that contains it) | Commits | What it is |
|---|---:|---|
| hospitality/stage-0 | 1 | Test baseline: unit (Vitest), E2E (Playwright), CI, db-tests, "no app changes" |
| hospitality/stage-1 | 21 | Hospitality plans (docs) + migrations 1-6 + engine layer (registry, dispatcher, engineGuard); incl. add/remove skill pair |
| hospitality/stage-2 (shared base of seo) | 153 | 122 Hospitality (stages 2a-2k, 3-5, D, E1-E5, F, G-K, A1-A7, plans, deploy docs) + 10 landing page + 9 NURIEL AI + 4 Portal (store/zimmer opening) + 4 digital-license + 3 security remediation 2026-11-03 + 1 SEO stage 0 |
| hospitality/seo | 7 | SEO stages 0-4 + runbooks (f50d81b is patch-identical to cea407a in stage-2) |
| ecommerce/import-sync | 5 | Product import that matches existing products (migration 64) |
| ecommerce/product-duplicates | 2 | Duplicate-products manager (migration 65) |
| ecommerce/store-release | 4 | Integration merge (1011a89), image pre-check fix, deployed runbook (10.11) |
| hospitality/documents | 6 | Merge of seo (d9c85a8), standalone documents (migration 70, incl. WIP commit 33d66b9), GA4 events behind consent |
| hospitality/signing-mobile | 12 | Merge of store-release (538f336), Zimmer release runbooks, owner-guide video, phone signing flow |
| maintenance/email-auth-security | 24 | Email/auth/security fixes, migrations 71 (187) and 72 (188), night reports |
| hospitality/release | 8 | Two trial merges, role-matrix tests, one-command deploy script for release/next |
| release/next (= billing/agreements) | 22 | Close-3 report, Billing & Agreements (189-190), VAT by dealer type (191), GTM (192), deploy script, merge 8dbb662 |
| websites/engine | 19 | Websites / business_profile engine (migrations 77-82 = 193-198), Efrat pilot |
| hospitality/tracking-settings | 7 | GA4/Tag Manager IDs in settings (migration 199) + deploy records |
| audit/platform-review-2026-11 | 13 | 9 audit fixes (B-1..B-7, C-2, D-1, CI) + 4 report commits |
| **Total** | **304** | 298 non-merge + 6 merges (d9c85a8, 1011a89, 538f336, e55dacb, 4355950, 8dbb662) |

Commands: `git log --reverse origin/main..HEAD`, per-branch `git rev-list`, attribution script in /tmp/merge-review/ (assign.tsv).

### Commits that look unrelated / need attention (none is a secret, `.env`, dump or lockfile-only churn)

| sha | Why flagged | Verdict |
|---|---|---|
| fb7c7ca + e2d2293 | Add then remove `.claude/skills/hospitality-expert/*` + `skills-lock.json` (715 lines, outside normal dirs) | Net zero: `git ls-tree` shows 0 `.claude/` paths at HEAD and on main |
| 33d66b9 | Subject "WIP: standalone documents - the app (paused for an urgent store fix; not for the server)" | Superseded by 9c02f1d and later; feature complete in final tree, but the WIP commit stays in history |
| ad3a2fe, 1ebba27, be62922, fab4a94, f2e8bf7, 5ea24e3 (+ docs a47d6b5, 6c8d4bd, 92bf062, 249b80f) | "Landing page (nuriel-app2)": platform portal landing, not an engine; 16 webp/png + 1.27 MB logo PNG; rewrites `PlatformLanding.tsx` (+80/-358), `routes/index.tsx` (portal-only SSR), `feeds.server.ts` (portal-only llms.txt) | Intentional but different product area bundled in the stage-2 line |
| 7ec7a26 (+ 53bac87, b24caf1, 9f99b62) | Digital license module (Office/Windows keys), 8,100 lines, migration 54, flag off | Intentional separate feature (one-store pilot) |
| f729211 (+ 8 AI commits) | NURIEL AI assistant, 10,398 lines, migration 61, adds `@anthropic-ai/sdk` | Intentional separate feature |
| 0a62e32 | One 15,520-line commit bundling 4 migrations (hero video, events, contracts, customer details) | Intentional, hard to review |
| 19ab7e8, 657dbd0, 84b1393 | Security remediation 2026-11-03: modifies EXISTING Ecommerce code + migrations 45-53 | Related (security) but changes existing behaviour, see sec. 2/3 |
| cea407a vs f50d81b | Same patch twice (`git patch-id` duplicate; 298 non-merge commits, 1 duplicate pair) | Harmless; same blob after merge d9c85a8 |
| 2504227, ad3a2fe, 955c8a2, 8eeb422, bd07313 | 11-28 binary files each (fonts, landing images, Websites screenshots) | Media only, see sec. 8 |

Generated files touched (normal, tracked on main): `src/routeTree.gen.ts` (32 commits, +1,394/-0), `src/integrations/supabase/types.ts`, `docs/architecture/db-classification.md`.
Lockfile check: per commit, `bun.lock` never changes without `package.json` (0 hits); 4 commits change package.json without bun.lock (9beaefa, a4e0d2f, 238995e, 6dd034b; script/dev entries, not verified line by line).

## 2. Summary of changes origin/main -> HEAD

`git diff --shortstat origin/main HEAD`: **1367 files changed, +260,835 / -1,594**. `--name-status`: A=1270, M=97, **D=0, R=0** (nothing deleted or moved from main).

| Top-level dir | files | A | M | ins | del |
|---|---:|---:|---:|---:|---:|
| src | 644 | 572 | 72 | 113,339 | 1,420 |
| supabase | 166 | 166 | 0 | 42,681 | 0 |
| docs | 159 | 159 | 0 | 29,409 | 0 |
| scripts | 116 | 104 | 12 | 28,566 | 55 |
| tests | 110 | 110 | 0 | 20,603 | 0 |
| e2e | 91 | 91 | 0 | 23,340 | 0 |
| public | 60 | 60 | 0 | 905 | 0 |
| deploy | 10 | 5 | 5 | 1,404 | 50 |
| root files | 10 | 2 | 8 | 433 | 69 |
| .github | 1 | 1 | 0 | 155 | 0 |

Second level (the dirs you named):

| Path | files | A | M | ins | del |
|---|---:|---:|---:|---:|---:|
| src/engines/hospitality | 335 | 335 | 0 | 69,936 | 0 |
| src/engines/business-profile | 65 | 65 | 0 | 14,359 | 0 |
| src/engines/ecommerce | 1 | 1 | 0 | 13 | 0 |
| src/platform (all modules) | 56 | 56 | 0 | 8,581 | 0 |
| src/lib | 54 | 22 | 32 | 7,560 | 257 |
| src/components | 47 | 23 | 24 | 9,730 | 1,053 |
| src/routes | 74 | 65 | 9 | 1,258 | 36 |
| src/app (new) / src/integrations / src/server | 5 / 2 / 1 | 5 / 0 / 0 | 0 / 2 / 1 | 125 / 135 / 152 | 0 / 0 / 23 |
| supabase/migrations | 83 | 83 | 0 | 34,246 | 0 |
| supabase/rollbacks | 83 | 83 | 0 | 8,435 | 0 |
| scripts/db-tests | 83 | 74 | 9 | 24,137 | 30 |
| tests/unit (tests/fixtures 16 and tests/architecture 3 are separate rows) | 91 | 91 | 0 | 19,898 | 0 |
| e2e/tests | 79 | 79 | 0 | 21,845 | 0 |
| docs/hospitality / docs/websites / docs/audit / docs/billing | 58 / 67 / 12 / 6 | all A | 0 | 12,445 / 11,367 / 1,567 / 1,076 | 0 |
| deploy | 10 | 5 | 5 | 1,404 | 50 |

Per engine/area (path + file-name classifier, includes its tests/docs/migrations; /tmp/merge-review/engine_agg.txt):

| Area | files | A | M | ins | del |
|---|---:|---:|---:|---:|---:|
| Hospitality | 687 | 687 | 0 | 154,196 | 0 |
| Websites (business_profile) | 179 | 179 | 0 | 37,649 | 0 |
| Shared app code (src/components, lib, routes, server, integrations) | 160 | 91 | 69 | 10,897 | 1,099 |
| DB other (security/platform/tracking migrations + tests) | 52 | 43 | 9 | 9,407 | 30 |
| Ecommerce additions (import sync, duplicates) | 23 | 20 | 3 | 8,684 | 321 |
| Billing / VAT | 31 | 31 | 0 | 8,583 | 0 |
| Digital licenses | 23 | 23 | 0 | 8,339 | 0 |
| NURIEL AI | 23 | 23 | 0 | 8,068 | 0 |
| Platform layer (src/platform, tests/architecture) | 38 | 38 | 0 | 2,643 | 0 |
| Infra/config/root (deploy, .github, root files) | 21 | 8 | 13 | 1,992 | 119 |
| Landing page (portal) | 23 | 23 | 0 | 320 | 0 |
| Audit docs / other tests+scripts | 12 / 95 | 12 / 92 | 0 / 3 | 1,567 / 8,490 | 0 / 25 |

Note: the Ecommerce engine directory is only a registration stub (`src/engines/ecommerce/engine.ts`, 13 lines). All Ecommerce code stays where it was (src/components, src/lib, src/routes); nothing was moved.

### Pre-existing main files MODIFIED (not added): 72 under src/ (`git diff --diff-filter=M --name-only origin/main HEAD -- src`)

Legend: **[E]** = Ecommerce checkout / orders / payments / products path (user must confirm behaviour preserved).

Checkout, orders, pricing, payment, order documents/emails **[E]**:
| File | +/- | What changed |
|---|---|---|
| src/routes/checkout.tsx | +13/-18 | VAT base now = products + deposit + shipping - discount (matches DB `order_gross`); marketing opt-in recorded after order via double opt-in (SEC-H5) instead of saving an abandoned cart |
| src/components/checkout/CheckoutSummary.tsx | +28/-30 | Totals block re-ordered (VAT lines after delivery); grand total = `vat.gross` (deposit inside VAT base) |
| src/components/OrderCartDrawer.tsx | +22/-18 | Same VAT/deposit rule; `vatPriceNotice` replaces `vatTotalCaption` |
| src/lib/vat.ts | +72/-2 | Added `parseVatProfile`, `vatPriceNotice`, `orderVatBreakdown` (existing exports kept) |
| src/lib/order-email-data.server.ts | +12/-4 | Order e-mail uses DB-computed net/vat/gross (migration 191) with fallback |
| src/lib/documents.server.ts | +26/-8 | Order/agreement documents: store identity/time/VAT changes |
| src/lib/pdf/document.server.ts | +18/-4 | PDFs print Israel time (audit B-6) |
| src/lib/grow-webhook.server.ts, src/routes/api.webhooks.grow.ts | +13/-2, +7/-4 | Payment webhook answers 500 (not 200) when marking order paid fails (audit B-1) |
| src/lib/email.server.ts, src/lib/email.functions.ts | +58/-30, +6/-0 | Resend 429 retry, send outcome field, `temp_password` mail kind retired; `sendOrderEmails` rate-limited per order/user (audit B-7) |
| src/lib/coupon-showcase.functions.ts | +35/-61 | Logic moved to new `coupon-showcase.server.ts`; coupon e-mail now needs double opt-in |
| src/components/SiteSettingsPanel.tsx | +17/-109 | VAT/business-type UI moved to new owner-only `VatSettingsCard` (managers lose VAT editing) |
| src/lib/site.ts, EmailSettingsPanel.tsx | +28/-10, +22/-11 | Settings plumbing |

Products / catalog **[E]**:
| File | +/- | What changed |
|---|---|---|
| src/components/products/ProductImportDialog.tsx | +525/-298 | Substantial rewrite for matching import (check, choose, import, report, undo) |
| src/server/services/csv-import.ts | +152/-23 | `runImport` split into `localizeImages` + sync flow; duplicate checks now scoped by tenant |
| src/lib/product-import.functions.ts | +323/-0 | Additions only (STORE-2 server functions) |
| src/components/AdminProductsPanel.tsx | +13/-0 | Adds Duplicates dialog button |
| src/lib/image.ts | +22/-4 | SVG uploads refused, raster allow-list (SEC-H4) |
| src/lib/store-icons.server.ts, feeds.server.ts | +25/-4, +13/-0 | Logo path hardening; portal-only llms.txt branch (stores unchanged) |
| src/integrations/supabase/types.ts | +69/-0 | Generated types for new functions |

Marketing / consent (storefront popup, account, checkout): src/lib/marketing-consent.server.ts +159/-8, marketing-consent.functions.ts +79/-3, marketing-consent.ts +14, marketing.ts +14/-4, marketing.functions.ts +8/-10, crm.functions.ts +25, components/marketing/TrackingConsent.tsx +54/-7, MarketingPanel.tsx +10/-1, account/MarketingConsentCard.tsx +22/-1. (Double opt-in + GTM consent gate.)

Accounts / staff / auth / security: components/AdminUsersPanel.tsx +133/-110, ChangeRoleDialog +4/-1, CreateCustomerDialog +2/-8, CreateStaffAccountDialog +2/-8, EditUserDialog +6/-1, PasswordSetupFields +7/-25, AccountNotice +4/-1, StaffNotificationsBell +1/-3, ColorsInput +7/-1; lib/admin.functions +18/-15, agreement.functions +8/-2, handoff.functions +4/-2, password.functions +4/-7, reset-link.server +7/-45, login-code.functions +1, rate-limit.server +10/-6, host-mode +3; routes/admin-handoff +13/-2, routes/admin.tsx +14/-3; integrations/supabase/tenant.server.ts +66; lib/store-switcher.functions +18/-3.

Platform panel / portal / billing UI: components/portal/PortalOnboarding.tsx +1093/-57, portal/PlatformLanding.tsx +80/-358, platform/PlatformShell +33/-5, platform/CustomerFile +7, platform/SubscriptionDialogs +9, billing/BillingPanel +4; lib/portal.functions +429/-18, portal.ts +205, platform.functions +18/-4, platform.server +15/-1; routes/platform.tsx +14/-2, platform_.plans +3/-2, platform_.upgrades +4; routes/index.tsx +33/-3 (portal-only SSR; other stores keep `ssr:"data-only"`).

App-wide plumbing (affects EVERY request, including Ecommerce): `src/server.ts` +89/-50 (all responses wrapped by `withSecurityHeaders`, request router moved into `route()`, engine workers + AI renewal job started, `/_serverFn` always tenant-bound), `src/start.ts` +3/-1 (**`engineGuard` added to every server function**), `src/router.tsx` +4, `src/routes/__root.tsx` +50/-2 (non-ecommerce site types get their own shell; ecommerce path unchanged), `src/routeTree.gen.ts` +1,394/-0.

Other modified (non-src) files, 25: `.dockerignore`, `.env.example` (+31, empty placeholders), `.gitignore`, `bun.lock`, `docker-compose.yml` (+25), `eslint.config.js` (+184/-13: boundary rules ADDED, ignores widened, no rule turned off), `package.json` (vitest/playwright/axe added, `xlsx` removed, dompurify 3.4.18, sharp ^0.35.5), `vite.config.ts`, deploy/{backup-daily.sh +105/-13, backup-install.sh +73/-28, setup-selfhost.sh +119/-6, gen-keys.mjs, ssl/store-certs.sh}, scripts/{excel-check.ts, label-visual-check.ts, watermark-check.ts}, 9 files in scripts/db-tests (sec. 7).

## 3. New migrations (83): `git diff --diff-filter=A --name-only origin/main HEAD -- supabase/migrations`

- `git diff --diff-filter=MDR --name-only origin/main HEAD -- supabase/migrations` = **empty** (0 files): no migration that exists on main was modified, deleted or renamed. `supabase/config.toml` and every other supabase file also unchanged.
- All 83 new timestamps (20261101090000 .. 20261118100000) are greater than main's last (20261019600000); 199 timestamps total, 199 unique, sorted. Note the last one is dated 2026-11-18 (tomorrow).
- Rollbacks: **83/83** have `supabase/rollbacks/<same timestamp+name>.down.sql` (`comm` of basenames: no migration without rollback, no orphan rollback). Main's 111 older migrations have none (pre-existing; main had 5 rollbacks).
- `#` = ordinal among the 83 new files (docs/commits use it up to 70); `G` = global ordinal = # + 116 (docs use 187..199 from 71 on). Header comments in files 66-69 carry stale labels ("migration 62-65") from before a rebase and file 70 refers to "migration 64"; label-only, no functional effect.
- Impact: **ADD** = new objects only; **ALTER** = ALTER TABLE on a main table, UPDATE of existing rows, CREATE OR REPLACE of a main function/policy/trigger, trigger/policy added on a main table, grant changes on existing objects; **DROP\*** = drops an object that existed on main (replace/tighten; no table, column or row data dropped).
- Classification from regex scan of top-level SQL + DO blocks (function bodies excluded) against objects created by main's 116 migrations, then read by hand for every ALTER/DROP row (/tmp/merge-review/migscan3.py). Dynamic `EXECUTE format` DDL was also checked: only #2 touches main tables dynamically.

Totals: **ADD 66, ALTER 14, DROP\* 3.**

| # | G | File | Purpose | RB | Impact |
|--:|--:|---|---|:-:|---|
| 1 | 117 | 20261101090000_platform_products_flags | `tenants.site_type` (default 'ecommerce'), product roles, feature flags; existing trigger `tenants_seed_settings` re-created with `WHEN site_type='ecommerce'`; new immutability trigger on tenants, role guard on user_roles | Y | **ALTER** |
| 2 | 118 | 20261101100000_ecommerce_engine_guard | 2 guard triggers on each of 40 existing Ecommerce tables (incl. orders, order_items, global_products, coupons) + 2 RESTRICTIVE policies on storage.objects (product-images) + 5 seed rows | Y | **ALTER** |
| 3 | 119 | 20261101110000_hosp_schema | hospitality schema, roles, RLS, `hosp-media` bucket + 4 policies on storage.objects | Y | ADD |
| 4 | 120 | 20261101120000_hosp_booking | booking engine (btree_gist, tables, functions) | Y | ADD |
| 5 | 121 | 20261101130000_hosp_billing_admin | plans, subscriptions, unit limit, admin stats | Y | ADD |
| 6 | 122 | 20261101140000_hosp_coupon_release | release coupon usage when a booking ends unapproved | Y | ADD |
| 7 | 123 | 20261101150000_hosp_management_foundation | management flag, manager seats; **redefines `user_roles_admin_seat_guard`** + new trigger on user_roles | Y | **ALTER** |
| 8 | 124 | 20261101160000_hosp_settings_team | settings, team, audit log; new trigger `hospitality_admin_row_guard` on user_roles | Y | **ALTER** |
| 9 | 125 | 20261101170000_hosp_site_identity | site identity for page meta | Y | ADD |
| 10 | 126 | 20261101180000_hosp_catalog | properties and units DB layer | Y | ADD |
| 11 | 127 | 20261101190000_hosp_details | unit/property detail columns | Y | ADD |
| 12 | 128 | 20261101200000_hosp_media | photos and galleries | Y | ADD |
| 13 | 129 | 20261101210000_hosp_pricing | price / rate-rule / cancellation-policy management | Y | ADD |
| 14 | 130 | 20261101220000_hosp_calendar | calendar board + blocks | Y | ADD |
| 15 | 131 | 20261102090000_hosp_platform_open | open a hospitality business from the platform panel | Y | ADD |
| 16 | 132 | 20261102100000_hosp_bookings_staff | bookings list/card for staff | Y | ADD |
| 17 | 133 | 20261102110000_hosp_guests | guests and privacy | Y | ADD |
| 18 | 134 | 20261102120000_hosp_emails_dashboard | e-mail status/resend, dashboard | Y | ADD |
| 19 | 135 | 20261102130000_hosp_public_site | public site read API (anon) | Y | ADD |
| 20 | 136 | 20261102140000_hosp_site_switches | public-site switches in platform panel | Y | ADD |
| 21 | 137 | 20261102150000_hosp_site_design | site draft/versions + themes | Y | ADD |
| 22 | 138 | 20261102160000_hosp_room_types | hotel room types | Y | ADD |
| 23 | 139 | 20261102170000_hosp_payments | payments ledger infrastructure | Y | ADD |
| 24 | 140 | 20261102180000_hosp_channels | iCal channel sync (Airbnb/Booking) | Y | ADD |
| 25 | 141 | 20261103090000_hosp_security | shared rate counters, CAPTCHA token store | Y | ADD |
| 26 | 142 | 20261103100000_hosp_site_theme | theme chosen at business creation | Y | ADD |
| 27 | 143 | 20261103110000_hosp_channel_alerts | external-date conflict alerts | Y | ADD |
| 28 | 144 | 20261103120000_hosp_phone_payments | phone payments on the ledger | Y | ADD |
| 29 | 145 | 20261104090000_portal_business_details | business details at store opening from the gate (new function) | Y | ADD |
| 30 | 146 | 20261104100000_hosp_plans_pricing | zimmer plans: prices, setup fee, limits | Y | ADD |
| 31 | 147 | 20261104110000_hosp_site_requests | zimmer site requests from the gate | Y | ADD |
| 32 | 148 | 20261105090000_hosp_dashboard | owner dashboard + finance permission | Y | ADD |
| 33 | 149 | 20261105100000_hosp_support | separate hospitality support system + `hosp-support` bucket | Y | ADD |
| 34 | 150 | 20261105110000_hosp_reports | reports and export | Y | ADD |
| 35 | 151 | 20261105120000_hosp_setup_guide | onboarding guide | Y | ADD |
| 36 | 152 | 20261105130000_hosp_rate_check | rate counter no longer burns quota on refused attempts | Y | ADD |
| 37 | 153 | 20261105140000_hosp_payment_instructions | guest payment instructions | Y | ADD |
| 38 | 154 | 20261105150000_hosp_unit_photos_public | unit photos on public site | Y | ADD |
| 39 | 155 | 20261105160000_hosp_confirm_link | personal link in "booking confirmed" mail | Y | ADD |
| 40 | 156 | 20261105170000_hosp_portal_open | self-open zimmer from the gate, 30-day trial | Y | ADD |
| 41 | 157 | 20261105180000_hosp_unit_size | unit size (m2) | Y | ADD |
| 42 | 158 | 20261105190000_hosp_logo_brand | logo kept apart from photos | Y | ADD |
| 43 | 159 | 20261105200000_hosp_open_dates | dates open for booking (default closed) | Y | ADD |
| 44 | 160 | 20261105210000_hosp_booking_groups | several rooms in one request | Y | ADD |
| 45 | 161 | 20261106120000_hosp_sec_c1_guest_claim | SEC-C1 guest booking claim needs ownership proof (drops its own earlier function) | Y | ADD |
| 46 | 162 | 20261106130000_sec_h1_trusted_account | SEC-H1: **`UPDATE auth.users` backfill (app_metadata.platform=true)**; **redefines `platform_link_store_admin`, `portal_create_store`, `store_link_existing_account`, `consume_login_code`** | Y | **ALTER** |
| 47 | 163 | 20261106140000_sec_h4_bucket_mime | SEC-H4: raster-only MIME allow-list + 50 MB on EXISTING buckets `product-images`, `branding` (upsert) | Y | **ALTER** |
| 48 | 164 | 20261106150000_sec_h5_double_opt_in | SEC-H5 double opt-in: new columns/CHECKs/index on `marketing_consents`+`_events`; **redefines `marketing_set_consent`, DROPs old 5-arg signature** | Y | **DROP\*** |
| 49 | 165 | 20261106160000_sec_m3_online_hold_guard | cap on online holds (DoS) | Y | ADD |
| 50 | 166 | 20261106170000_sec_m5_keep_platform_records | store delete keeps billing_history/audit rows: **DROPs 2 FKs**, adds `store_label`, **redefines `platform_delete_tenant`** | Y | **DROP\*** |
| 51 | 167 | 20261106180000_sec_p3_low_findings | **DROP POLICY "anyone can request reset"** (password_reset_requests), revoke `resolve_login_email` | Y | **DROP\*** |
| 52 | 168 | 20261106190000_sec_p3_helpers_quote_email | **redefines `order_coupon_verify`** (own order only); revokes execute on `product_serial_gap`, `staff_display_name`, `can_pick`, `is_warehouse`; new trigger `user_roles_auth_email`; hosp quote code server-only | Y | **ALTER** |
| 53 | 169 | 20261106200000_sec_prv_guest_privacy | strip manage links from sent group mails | Y | ADD |
| 54 | 170 | 20261107100000_lic_digital_licenses | digital licenses (4 tables, `license-files` bucket, flag off) | Y | ADD |
| 55 | 171 | 20261108100000_hosp_bank_transfer | 7-day bank-transfer rule + proofs | Y | ADD |
| 56 | 172 | 20261108110000_hosp_guest_area | guest "my bookings" area, e-mail-code sign-in | Y | ADD |
| 57 | 173 | 20261108120000_hosp_shabbat | Shabbat-observant badge | Y | ADD |
| 58 | 174 | 20261108130000_hosp_platform_separation | **redefines `platform_list_tenants()`**: platform "stores" list shows online stores only | Y | **ALTER** |
| 59 | 175 | 20261108140000_hosp_packages | packages and special packages | Y | ADD |
| 60 | 176 | 20261109100000_hosp_site_documents | site documents/policies, accessibility statement | Y | ADD |
| 61 | 177 | 20261110100000_ai_assistant | NURIEL AI assistant (9 tables, 24 functions) | Y | ADD |
| 62 | 178 | 20261110200000_hosp_unit_seo | SEO title/description per unit | Y | ADD |
| 63 | 179 | 20261110210000_hosp_consent | cookie-consent mechanism (off) | Y | ADD |
| 64 | 180 | 20261110220000_product_import_sync | STORE-2 import that matches existing products (3 tables, 17 functions; `import_products` untouched) | Y | ADD |
| 65 | 181 | 20261110230000_product_duplicates | duplicate detection, "not a duplicate", atomic merge + restore log | Y | ADD |
| 66 | 182 | 20261111100000_hosp_hero_video_verified | hero video <= 15 s measured by server | Y | ADD |
| 67 | 183 | 20261111110000_hosp_events | pool-compound events | Y | ADD |
| 68 | 184 | 20261111120000_hosp_client_contracts | e-signature contract templates + `hosp-contracts` bucket | Y | ADD |
| 69 | 185 | 20261111130000_hosp_customer_details | correct customer details on booking/event | Y | ADD |
| 70 | 186 | 20261111140000_hosp_standalone_documents | standalone documents for signing | Y | ADD |
| 71 | 187 | 20261112100000_store_owner_guard_unblock | **redefines `user_roles_owner_guard`**: blocked manager unblocked only by the owner (Ecommerce staff) | Y | **ALTER** |
| 72 | 188 | 20261113100000_hosp_business_admin | Business Admin role; **redefines `user_roles_owner_guard` again**, new staff_grants permission | Y | **ALTER** |
| 73 | 189 | 20261114100000_billing_agreements | `billing` schema: agreements, ledger, upgrade requests | Y | ADD |
| 74 | 190 | 20261114110000_billing_owner_access | financial data owner-only: **re-creates 2 main RLS policies** ("store admin reads subscription", "...billing history"), **redefines `store_billing()`**, new append-only trigger `billing_history_guard` on existing `billing_history` | Y | **ALTER** |
| 75 | 191 | 20261115090000_vat_settings | VAT by dealer type: **3 STORED generated columns on `orders` (table rewrite)**, 2 cols on `site_settings`, trigger `orders_vat_snapshot_guard`, **redefines `site_settings_vat_by_business_type`, `orders_vat_from_settings`** | Y | **ALTER** |
| 76 | 192 | 20261115100000_site_tag_manager | GTM per site (new table) | Y | ADD |
| 77 | 193 | 20261116090000_bp_engine | business_profile engine; `tenants.site_type` CHECK widened (constraint from #1) | Y | **ALTER** |
| 78 | 194 | 20261116100000_bp_media | media library + `bp-media` bucket + policies | Y | ADD |
| 79 | 195 | 20261116110000_bp_site_fonts | site fonts in media, Classic template (updates own bucket) | Y | ADD |
| 80 | 196 | 20261116120000_bp_inquiries | customer inquiries | Y | ADD |
| 81 | 197 | 20261117090000_bp_site_address | **redefines `tenant_slug_problem`, `ssl_agent_targets`, `custom_domain_targets`** (store domains / SSL agent) | Y | **ALTER** |
| 82 | 198 | 20261117100000_bp_owner_invites | owner invite link | Y | ADD |
| 83 | 199 | 20261118100000_site_tracking_ga4 | `ga4_measurement_id` column on #76's table | Y | ADD |

Main objects redefined (these change behaviour of existing features):
- Functions (16 distinct): `user_roles_admin_seat_guard` (#7), `platform_link_store_admin`, `portal_create_store`, `store_link_existing_account`, `consume_login_code` (#46), `marketing_set_consent` (#48, old signature dropped), `platform_delete_tenant` (#50), `order_coupon_verify` (#52), `platform_list_tenants` (#58), `user_roles_owner_guard` (#71, #72), `store_billing` (#74), `site_settings_vat_by_business_type`, `orders_vat_from_settings` (#75), `tenant_slug_problem`, `ssl_agent_targets`, `custom_domain_targets` (#81).
- Policies: re-created "store admin reads subscription" / "store admin reads billing history" (#74, narrower: owner only); dropped "anyone can request reset" (#51).
- Triggers: re-created `tenants_seed_settings` (#1); NEW on existing tables: tenants (1), user_roles (4: #1, #7, #8, #52), billing_history (#74), orders (#75), 40 Ecommerce tables x2 (#2).
- Schema/data: `tenants.site_type` + CHECK (#1, #77); `orders` +3 generated cols (#75; already applied in production 15.11 per runbook); `marketing_consents`/`_events` +cols (#48); `billing_history.store_label` and 2 FKs removed (#50); `UPDATE auth.users` backfill (#46); existing buckets product-images/branding limited (#47).
- Grants: REVOKEs on `resolve_login_email`, `product_serial_gap`, `staff_display_name`, `can_pick`, `is_warehouse` (#51, #52).
- 9 new migrations were amended in later commits within the branch (e.g. 20261114100000_billing_agreements by 10e0ca8/bc6960a, 20261110100000_ai_assistant by 58a47dc/6dd034b, 20261110220000_product_import_sync by cc79c8f). Dates show each amendment precedes the pinned deploy commit in the runbooks, but whether production applied an earlier version could NOT be determined read-only.

## 4. Engines / modules changed (added / modified / deleted files)

Deleted anywhere: 0. Modified only in shared/pre-existing code.

| Module | A | M | D |
|---|---:|---:|---:|
| src/engines/hospitality (management 135, website 67, api 28, types 27, validation 25, server 12, security 10, contracts 7, outbox 4, documents 4, platform-admin 3, channels 3, media 2, ai 1) | 335 | 0 | 0 |
| src/engines/business-profile (studio 19, site 15, api 7, document 4, inquiries 4, data 4, platform-admin 3, edge 3, templates 2, root 4) | 65 | 0 | 0 |
| src/engines/ecommerce (engine.ts registration stub) | 1 | 0 | 0 |
| src/platform/ai 13, billing 9, analytics 7, engines 6, auth 5, tenancy 4, branding 2, media 2, security 2, supabase 2, email 1, feature-flags 1, pdf 1, ui 1 | 56 | 0 | 0 |
| src/app (site-router, site-shell, site-head, site-routes, engines) | 5 | 0 | 0 |
| src/lib (+ lib/ai 2) | 22 | 32 | 0 |
| src/components (portal 10A/2M, licenses 7A, products 3A/1M, platform 1A/3M, settings 1A, ai 1A, 13 root files M, marketing 2M, checkout 1M, account 1M, billing 1M) | 23 | 24 | 0 |
| src/routes | 65 | 9 | 0 |
| src/integrations, src/server, src root (server.ts, start.ts, router.tsx, routeTree.gen.ts) | 0 | 7 | 0 |
| supabase/migrations + rollbacks | 166 | 0 | 0 |
| scripts (db-tests 74A/9M, websites 14, preview 7, seo 3, billing 2, hospitality 1, others) | 104 | 12 | 0 |
| tests (unit 91, fixtures 16, architecture 3) | 110 | 0 | 0 |
| e2e | 91 | 0 | 0 |
| docs | 159 | 0 | 0 |
| deploy, .github, public, root files | 68 | 13 | 0 |

## 5. Preservation check (remote branches, stale worktrees, stash)

`git rev-list --count HEAD..origin/<b>` and `git merge-base --is-ancestor origin/<b> HEAD`:

| Remote branch | HEAD..branch | Ahead of main | In HEAD? |
|---|---:|---:|---|
| audit/platform-review-2026-11 | 0 | 304 | yes (is HEAD) |
| billing/agreements | 0 | 265 | yes |
| claude/dazzling-goldberg-ndjxc4, claude/funny-edison-ww9exu, claude/multi-tenant-part2 | 0 | 0 | yes (ancestors of main) |
| ecommerce/import-sync | 0 | 182 | yes |
| ecommerce/product-duplicates | 0 | 179 | yes |
| **ecommerce/store-identity** | **2** | 2 | **NO** |
| ecommerce/store-release | 0 | 188 | yes |
| hospitality/documents, release, seo, signing-mobile | 0 | 188 / 243 / 177 / 211 | yes |
| hospitality/stage-0, stage-1, stage-2 | 0 | 1 / 22 / 175 | yes |
| hospitality/tracking-settings | 0 | 291 | yes |
| maintenance/email-auth-security | 0 | 230 | yes |
| release/next | 0 | 265 | yes |
| websites/engine | 0 | 284 | yes |

`git cherry -v HEAD origin/ecommerce/store-identity` (both `+`, i.e. patch not in HEAD):
- `fc6fb68` "Tests: Ecommerce test infrastructure (from hospitality/stage-2, no app change)" (39 files, +1,505): **stale older copy of test infra.** Of its 39 files, 26 are byte-identical in HEAD (unit tests, specs, screenshots, playwright config) and 13 exist in HEAD in a newer form (tests.yml, .gitignore, bun.lock, docs/testing.md, 5 e2e scripts, auth-regression and platform specs, package.json, tsconfig.test.json). Nothing in it is missing from HEAD.
- `888731a` "StoreIdentity: one source for every store's name (SEO, Schema, titles, feeds)": **real functionality absent from HEAD.** 42 files: adds `src/lib/store-identity.ts` (75), `tests/unit/store-identity.test.ts`, `e2e/tests/seo-identity.spec.ts` (286), `docs/store-identity.md`; edits 36 other src files (titles/OG, WebSite/Organization schema, llms.txt, emails, documents, checkout.tsx, index.tsx, feeds.server.ts...). No migration, no data change. It is deliberately excluded and documented in MAIN-MERGE-PLAN.md.
- `git merge-tree --write-tree --name-only HEAD origin/ecommerce/store-identity`: exit 1, **13 conflicts, all from the stale fc6fb68**: `.github/workflows/tests.yml`, `.gitignore`, `bun.lock`, `docs/testing.md`, `e2e/scripts/{app-up.sh, mock-services.mjs, seed.mjs, seed.sql, supabase-up.sh}`, `e2e/tests/{auth-regression, platform}.spec.ts`, `package.json`, `tsconfig.test.json`. The 13 overlapping src files auto-merge (incl. checkout.tsx, index.tsx, feeds.server.ts, documents.server.ts, email.server.ts).
- Simulated cherry-pick of 888731a alone (`git merge-tree --write-tree --merge-base=888731a^ HEAD 888731a`): **exit 0, clean** (also clean onto origin/main). This supports the plan's "cherry-pick 888731a only". Semantic correctness of the auto-merged files (several are files this branch also modified, e.g. checkout.tsx, documents.server.ts, order-email-data.server.ts, email.server.ts) was NOT tested.

Local worktrees (`git -C <p> status --short`, `git log origin/<branch>..HEAD`, `merge-base --is-ancestor <HEAD> audit-HEAD`):

| Worktree | Branch @ sha | status | unpushed | contained in audit HEAD |
|---|---|---|---:|---|
| /home/user/nuriel-shop | hospitality/seo @ 80ddb09 | clean | 0 | yes |
| /home/user/nuriel-before | detached @ 6dd034b | clean | n/a | yes |
| /home/user/nuriel-dups | ecommerce/product-duplicates @ 5586da4 | clean | 0 | yes |
| /home/user/nuriel-import | ecommerce/store-release @ 61afaf1 (not import-sync) | clean | 0 | yes |

They hold git-ignored local files only (not in git): nuriel-shop has `.claude/`, `screens-2c2/`, `skills-lock.json`, `e2e/.env.e2e`, `e2e/.auth`, `e2e/.supabase`, reports, `.output`, `node_modules`; the others `.output`, `node_modules`, `e2e/.env.e2e`, `e2e/.auth`, `e2e/.supabase`. Removing those worktrees would lose these local files.
Local branches: all 18 local branches have 0 commits that are not on some origin branch (`git rev-list <b> --not --remotes=origin`), so nothing is local-only. Local `hospitality/release` is behind origin by 37, `release/next` by 20, `signing-mobile` by 1. No tags exist.
Stash: `stash@{0}` (87922d2, 2026-11-01, "On hospitality/stage-2: E4 support WIP (untested, not for the server)", base 2e53763 in HEAD). Contains only 2 UNTRACKED files: `supabase/migrations/20261104120000_hosp_support.sql` (179 lines) + rollback. It is an earlier, different design for E4 (extends `public.support_*` tickets for zimmer); HEAD has the committed redesign `20261105100000_hosp_support.sql` (823 lines, separate hospitality schema; 780 added/136 removed vs the stash). Not in any branch; superseded design, not a missing feature.

## 6. Was anything left out?

Checks run, all against HEAD `7b101e7`:
1. Patch-ids: every remote branch except store-identity has 0 commits outside HEAD (sec. 5). The only patch not in HEAD: 888731a (functionality) and fc6fb68 (stale infra).
2. Files only on a remote tip (`git diff --name-status --diff-filter=A HEAD origin/<b>`, limited to src/supabase/tests/e2e/docs/scripts/deploy/public/.github/package.json): 0 for all branches except: store-identity (4 files, all from 888731a), `claude/dazzling-goldberg-ndjxc4` + `claude/funny-edison-ww9exu` (6 old files each: `public/robots.txt`, `src/lib/lovable-error-reporting.ts`, `deploy/nginx-kobi.nuri1.fit.conf`, `src/assets/logo.jpeg.asset.json`, `src/integrations/supabase/{cron-auth,previewAuthStorage}.ts`; all 6 verified ABSENT on origin/main too, so they were removed before main and are not caused by this merge), and `ecommerce/import-sync` (`docs/ecommerce/import-sync-deploy.md`).
3. `import-sync-deploy.md` was deleted on purpose by bbb0153 (store-release runbook, `docs/ecommerce/store-release-deploy.md`, supersedes it); the file stays readable in history at eeaa37e.
4. Migrations: 199 unique timestamps, no duplicates, ordered, all new > main's last; no sequence gaps (names are timestamps). Only label inconsistencies: files 66-69 headers say "62-65" and #70 cites "64".
5. Docs referencing SHAs: 137 resolvable commit-like tokens in docs/ (excluding interim); the only ones NOT ancestors of HEAD are 888731a and fc6fb68 (documented in the plan). 97 tokens do not resolve but are content hashes in JSON data (`docs/websites/faithful/efrat-source.json`, `content-map.json`, seo baseline) and one Elementor form id (`119b3b0`), not git refs. Branch names cited in docs all exist as remote branches or are paths (`hospitality/management`, `hospitality/api`, `websites/preview`... are directories/spec names).
6. Stash: superseded design, see sec. 5.
7. Production check from runbooks: eccd001, bd7771f, 773ad14, cd58c1d, 61afaf1, 538f336, 80ddb09, c01a7ff are all ancestors of HEAD.
8. Remote refs other than branches/tags: not checked (no `ls-remote`, network disallowed).

Conclusion: **nothing is left out except `ecommerce/store-identity` 888731a (real feature, deliberately excluded) and the abandoned E4 stash design.** Open risk, not a omission: amended-after-add migrations (sec. 3 last bullet).

## 7. Websites / Hospitality / Ecommerce test integrity

`git diff --diff-filter=D --name-only origin/main HEAD` = **empty**: no test (or any) file deleted. main has NO unit tests and NO E2E tests: its only tests are 28 `scripts/db-tests/*.test.sql` (+4 helper files = 32). All 32 are still present.

Test files at HEAD vs main (`git ls-tree`, filename classifier; /tmp/merge-review/test_matrix.txt):

| Suite | main | HEAD | Ecommerce+shared | Hospitality | Websites | Billing/VAT | NURIEL AI | Licenses | Tracking | Platform/arch |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| tests/unit (*.test.ts) | 0 | 90 | 21 | 48 | 8 | 3 | 3 | 1 | 2 | 4 |
| tests/architecture | 0 | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| scripts/db-tests (*.test.sql) | 28 | 96 | 35 | 44 | 6 | 3 | 1 | 1 | 2 | 4 |
| e2e/tests (*.spec.ts) | 0 | 69 | 19 | 36 | 7 | 2 | 1 | 1 | 2 | 1 |
| e2e/preview | 0 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Modified test files (9, all under scripts/db-tests; `git diff --diff-filter=M`): line counts and assertion counts (`SELECT tests.check|run|server` + `pg_temp.expect_error`) before -> after:

| File | lines | assertions | note |
|---|---|---|---|
| addon-approval.test.sql | 113 -> 116 | 25 -> 25 | +3 lines: `session_replication_role` wrap for billing_history guard (#74) |
| marketing-consent.test.sql | 90 -> 221 | 24 -> 54 | rewritten for double opt-in (#48): **7 old titles replaced/renamed** (e.g. "register opt-in -> subscribed + welcome due + token"), 37 new ones; behaviour change, not a deletion |
| platform-extend-trial.test.sql | 49 -> 52 | 11 -> 11 | same wrap |
| remove-hyp.test.sql | 268 -> 271 | 43 -> 43 | same wrap |
| serials.test.sql | 503 -> 515 | 146 -> 149 | + SEC-L3 order_coupon_verify tests |
| staff-roles.test.sql | 344 -> 380 | 100 -> 112 | 1 line reformatted (assertion kept) |
| run.sh / supabase-stubs.sql / test-helpers.sql | +2 / +14 / +16 | n/a | reporting + stubs, additive |

- No modified test file lost >20% of its lines (all grew). **No file's assertion count decreased.** Titles removed/renamed: only the 7 in marketing-consent (replaced by stronger double-opt-in tests). TS/JS `it(`/`test(` check: no TS/JS test existed on main, so none can have been weakened.
- Skips: 185 `test.skip(...)`/`test.fixme(...)` call sites in tests/e2e, all conditional (device/project/env guards); 0 `.only`, 0 `.todo`, 0 unconditional skips. Pre-existing main DB tests were adapted to new triggers (billing_history append-only), not relaxed.
- Lint config is stricter, not weaker (`eslint.config.js`: boundary rules added; only the server-only restriction was rewritten).
- Reported numbers in docs (E2E 327-365 passed, DB 3195 x3, unit 1140) were NOT re-run by me (read-only task).

## 8. Hygiene checks

| Check | Command | Result |
|---|---|---|
| Conflict markers | `git grep -n -I -E '^(<{7}( \|$)\|>{7}( \|$)\|={7}$)' HEAD` | **none** |
| `.env` / dump / key files tracked | `git ls-tree -r --name-only HEAD \| grep -iE '\.env\|\.pem\|\.key\|\.dump\|\.bak\|\.sqlite\|\.tar\|\.zip\|\.gz\|id_rsa'` | only `.env.example` and `deploy/.env.production.example` (both on main; empty placeholders); root `schema.sql` is on main |
| Added files > 5 MB | `git ls-tree -r -l` on added paths | **0** (max 1.27 MB); whole history range: no blob > 1.3 MB; total of added files 24.4 MB (11.5 MB media) |
| Secret patterns in the diff | regex for private keys, AKIA, sk_live, sk-ant, xox, ghp_, JWT | only fake test stubs (`sk-ant-api03-...` in AI unit/db tests) |
| Lockfile churn | per-commit `bun.lock` vs `package.json` | none without package.json |
| Binary files added | numstat '-' | 124 (fonts, landing/brand images, docs screenshots, test video fixtures) |

Largest 10 added blobs (HEAD tree):

| Size | Path |
|---:|---|
| 1.22 MB | public/brand/nuriel-computers-logo-original.png |
| 0.69 MB | docs/websites/faithful/scan/old-mobile-390-full.jpg |
| 0.68 MB | docs/websites/faithful/shots/faithful-desktop-1440.jpg |
| 0.59 MB | docs/websites/faithful/scan/old-desktop-1440-full.jpg |
| 0.58 MB | docs/websites/faithful/shots/compare-mobile-390.jpg |
| 0.58 MB | docs/websites/preview/efrat-mobile.jpg |
| 0.48 MB | docs/websites/faithful/scan/compare-mobile-old-vs-stage2.jpg |
| 0.41 MB | docs/websites/faithful/shots/compare-desktop-1440.jpg |
| 0.34 MB | docs/websites/faithful/shots/faithful-mobile-390.jpg |
| 0.31 MB | docs/websites/faithful/scan/compare-desktop-old-vs-stage2.jpg |

## Items the user should explicitly accept before merging (existing-main behaviour changes)

1. Ecommerce checkout/cart: VAT is computed on products + deposit + shipping - discount (matches DB), totals layout reordered, new price notice text (src/routes/checkout.tsx, CheckoutSummary.tsx, OrderCartDrawer.tsx, vat.ts; migration 191 changes `orders` (3 generated columns, snapshot trigger)).
2. Marketing consent: double opt-in replaces immediate subscription everywhere (checkout, popup, account); old `marketing_set_consent` signature dropped (#48); 7 old DB tests replaced.
3. `engineGuard` on every server function, `withSecurityHeaders` on every response, new triggers on all 40 Ecommerce tables, `user_roles`, `tenants`, `orders`, `billing_history` (#1, #2, #7, #8, #52, #74, #75).
4. Owner-only finance/VAT: store managers lose billing/VAT visibility and VAT editing (#74, SiteSettingsPanel/VatSettingsCard); owner guard rules for staff (#71, #72).
5. Storage: product-images/branding now reject SVG/non-raster (#47, image.ts); store logo path hardening.
6. Payment webhook returns 500 on internal failure (Grow retries) (audit B-1); order PDFs/e-mails print Israel time (B-6); sendOrderEmails rate-limited (B-7).
7. Deploy scripts changed (backup-daily.sh, backup-install.sh, setup-selfhost.sh, docker-compose.yml, .env.example).
8. Not merged: `ecommerce/store-identity` 888731a (cherry-pick later, per plan).

## Addendum: HEAD moved while this review ran (7b101e7 -> c0615dd, 305 commits)

Sections 1-8 and the commit counts above describe `7b101e7` (304 commits). Before finishing, `git rev-parse HEAD` returned **`c0615dd378272fd4bcf2856d77e0f11ab6fae0db`** (+1 commit). `docs/audit/COMMITS-main-to-audit.txt` was regenerated for c0615dd (305 commits + trailer). Delta analysed with `git diff 7b101e7 c0615dd` (9 files, +711/-9):

- `c0615dd` "R-1: place_order is guarded in the database (migration 200): coupon grants and an order rate guard" (audit finding S-1). New files: `supabase/migrations/20261118110000_order_guard.sql` (209 lines), `supabase/rollbacks/20261118110000_order_guard.down.sql` (123), `scripts/db-tests/order-guard.test.sql` (197), `scripts/db-tests/order-guard-concurrency.sh` (134); edits to `.github/workflows/tests.yml` (+2: runs the concurrency test), db-classification doc/script/test (generated, coupon_grants added), `rollback-check.sh` (+37). No `src/` change.
- **Migration 200 = 84th new migration, G=200, rollback present, impact class ALTER.** New table `coupon_grants` (closed, RLS). **Redefines two functions that exist on main: `check_coupon` (grant unchanged: service_role only, as on main) and `orders_apply_coupon` (trigger function on orders).** Adds a new BEFORE INSERT trigger `orders_a_rate_guard` on the existing `orders` table.
- **Behaviour change for existing Ecommerce checkout:** a signed-in customer (not staff, not guest, not server) now needs a short-lived (2 h) server-issued coupon grant to apply a coupon, and is capped at 30 orders per 10 min and 300 per 24 h per business. The server function `checkCoupon` already passes `_customer` (src/lib/marketing.functions.ts:77), so the normal flow is meant to be unchanged; I did NOT verify this end to end. Add this to the "accept explicitly" list (item 3).
- Still true at c0615dd: `git diff --diff-filter=MDR --name-only origin/main c0615dd -- supabase/migrations` = 0 files; no deletions vs main; migrations 200 timestamp (20261118110000) > all others, unique. Counts in sections 2-4 (files/insertions) and migration totals (ADD 66 / ALTER 14 / DROP* 3) exclude this commit; with it: 84 migrations, ADD 66 / ALTER 15 / DROP* 3, and +9 files in the overall diff.
- The lead's working tree also holds further UNCOMMITTED edits at the time of the last check (`scripts/db-tests/grow-payments.test.sql`, `src/lib/grow-webhook.server.ts`, `tests/unit/grow-paid-late-alert.test.ts`, `docs/audit/interim/rls-perf/`); not analysed. Re-run this review on the final HEAD before merging.

# Hospitality — Stage 1 plan (backend foundation)

Status: **proposal, awaiting approval.** Nothing in this document is implemented.
Branch: `hospitality/stage-1` (based on `hospitality/stage-0`). No merge to `main`,
no production deployment, no production credentials.

Design inputs: the existing repository (source of truth), the Stage 0 test baseline,
and domain concepts learned from Kamra PMS (AGPL-3.0 — concepts only, **no code or
text copied**).

---

## 0. Principles

1. Ecommerce behaviour is unchanged. Every existing tenant is, and stays, `ecommerce`.
2. Hospitality is off by default at three independent layers: environment
   (`HOSPITALITY_ENGINE`), server (function middleware + edge gate) and database
   (RLS + RPC checks on feature flags).
3. Correctness lives in PostgreSQL: tenant isolation (RLS), double-booking
   prevention (`EXCLUDE`), reservation state machine (trigger), pricing (RPC).
4. Additive migrations only. No existing table, policy, function or constraint is
   modified, except the documented trigger function `tenants_seed_settings`
   (Ecommerce branch kept byte-identical and tested).
5. Every new policy, trigger and RPC has SQL tests; the full Stage 0 suite must stay green.

---

## 1. Server function routing (resolves the `/_serverFn/*` concern)

### Facts verified in this codebase
- All 44 server-function files (133 functions) are served from one endpoint,
  `/_serverFn/<sha256 id>`. The id is opaque — the URL cannot identify the engine.
- TanStack Start passes `serverFnMeta` to **global function middleware**
  (`createStart({ functionMiddleware })` in `src/start.ts`, which already registers
  `attachSupabaseAuth`). `serverFnMeta.filename` is the source path
  (e.g. `src/lib/crm.functions.ts`) and **is present in production builds**
  (verified in `.output/server/_ssr/*.mjs`).

### Design
1. **Engine manifest** — `src/platform/engines/manifest.ts` (pure, no imports):
   - `src/engines/hospitality/**` → `hospitality`
   - an explicit list of shared files → `shared` (auth, login codes, password,
     store switcher, support, handoff, custom domain, marketing consent,
     site forms/contact, owner agreement, email settings, notifications)
   - `platform*.functions.ts`, `portal.functions.ts` → `platform`
     (already restricted to the platform host by existing checks)
   - every other file → `ecommerce` (**default = today's behaviour**)
2. **Global function middleware** `engineGuard` (added to `functionMiddleware`
   after `attachSupabaseAuth`). On the server, for each call:

   | function engine | tenant `site_type` | result |
   |---|---|---|
   | `ecommerce` | `ecommerce` | **pass (unchanged)** |
   | `ecommerce` | `hospitality` | 404 |
   | `hospitality` | `hospitality` + engine on + `hospitality_backend_enabled` | pass |
   | `hospitality` | anything else | 404 |
   | `shared` / `platform` | any | pass (existing checks apply) |
   | unknown / missing filename | `hospitality` host | 404 (fail closed) |

   For Ecommerce tenants the guard is a constant-time branch on an
   already-resolved tenant (no DB call) — no behaviour or latency change.
3. **Hospitality server functions** live in
   `src/engines/hospitality/server/*.functions.ts` and additionally use a
   per-function middleware `requireHospFlag(flag)` (e.g. `hospitality_booking_enabled`).
4. **Unit test enforcing the manifest**: scans `src/**` for `createServerFn` and fails
   if a file is not classified explicitly — a new file must be consciously assigned.
5. **Edge gate** (`src/server.ts`, inside the existing `storeGate`), only for
   `siteType === 'hospitality'`: page requests → 404 unless
   `hospitality_frontend_enabled`; `robots.txt` → `Disallow: /`; `sitemap.xml`,
   `llms.txt`, Ecommerce API routes (`/api/admin/*`) → 404. Ecommerce hosts are not
   touched by any new branch.

REST routes are not used for Hospitality in Stage 1 (server functions match the
codebase). REST is reserved for future webhooks / iCal.

---

## 2. Complete Ecommerce isolation (audit + strategy)

### 2.1 Audit (local DB built from all 116 migrations)
- **70 public tables.** Classification:
  - **Ecommerce (40):** abandoned_carts, cancellation_requests, cart_promotions,
    categories, coupon_email_sends, coupons, customer_carts, customer_emails,
    customer_invites, customer_profiles, global_products, grow_payment_processes,
    home_banner_slides, location_transfer_lines, location_transfers,
    order_courier_links, order_delivery_events, order_items, order_number_counters,
    orders, pages, pending_products, picking_events, price_tier_backup,
    product_categories, product_drafts, product_locations, product_relations,
    product_reviews, product_serials, product_stickers, product_variants,
    service_agreements, shared_carts, shipping_methods, stock_count_lines,
    stock_counts, tenant_addons, tenant_subscriptions, user_custom_prices
    (`grow_payment_processes` is keyed to `orders`; `tenant_subscriptions` /
    `tenant_addons` are the Ecommerce billing model).
  - **Shared tenant infrastructure (20):** tenants, user_roles, site_settings,
    email_settings, tenant_email_secrets, login_codes, password_reset_requests,
    password_reset_tokens, staff_notifications, contact_messages, support_tickets,
    support_messages, marketing_consents, marketing_consent_events,
    notification_logs, tenant_ssl, tenant_billing_profile, billing_history,
    upgrade_requests, tenant_grow_credentials.
  - **Platform admin (10):** platform_addons, platform_admin_handoffs, platform_admins,
    platform_agreement_acceptances, platform_agreement_versions, platform_audit_log,
    platform_documents, platform_email_log, platform_plans, platform_pricing_settings.
- **350 public functions** (291 SECURITY DEFINER); 113 executable by `anon`,
  247 by `authenticated`.
- **44 server-function files / 133 functions**, 4 API routes.
- **52 browser files** call Supabase directly (`.from` / `.rpc` / `.storage`):
  51 tables, 115 RPCs — these bypass our server, so server-side checks alone are
  not enough.

### 2.2 Strategy (defence in depth)
| Layer | Mechanism | Effect on Ecommerce tenants |
|---|---|---|
| Edge | `storeGate` rules (§1.5) | none (branch only for hospitality) |
| Server functions | `engineGuard` + manifest (§1) | constant-time pass |
| **DB writes** | **statement-level** `AFTER INSERT OR UPDATE` triggers with transition tables on all 40 Ecommerce tables: reject if any written row belongs to a non-`ecommerce` tenant. Catches PostgREST, SECURITY DEFINER RPCs and `service_role`. One query per statement, not per row. | one indexed query per write statement |
| DB reads | No change to existing RLS. A hospitality tenant **cannot own Ecommerce rows** (write guard), so Ecommerce reads/RPCs on a hospitality site return empty. | none |
| Roles | trigger on `user_roles`: a hospitality tenant accepts only `role = 'admin'` (no customer/agent/cashier/warehouse). | none |
| Storage | new RESTRICTIVE policy on `storage.objects`: bucket `product-images` writable only when the current tenant is `ecommerce`. `branding` stays shared. Existing policies untouched. | none |
| Reverse direction | every `hosp_*` row must belong to a `hospitality` tenant (insert trigger + RLS on `current_site_type()`). | n/a |

Tests: for every one of the 40 tables, an insert for an Ecommerce tenant succeeds
and for a Hospitality tenant fails (generated from the classification list, so a new
Ecommerce table without a guard fails the coverage test, like the Stage 0 RLS test).

---

## 3. Feature flags

- `platform_feature_flags(key PK, enabled bool default false, description, updated_at, updated_by)`
- `tenant_feature_flags(tenant_id, key, enabled bool default false, PK(tenant_id,key))`
- keys: `hospitality_backend_enabled`, `hospitality_frontend_enabled`,
  `hospitality_onboarding_enabled`, `hospitality_themes_enabled`,
  `hospitality_booking_enabled` — seeded **false**.
- `hosp_flag(key, tenant)` = platform AND tenant AND tenant is `hospitality`.
- Writable only via `platform_set_flag(...)` (platform admin, audited in
  `platform_audit_log`). No grants to anon/authenticated on the tables.
- Server: flags loaded with the tenant (existing 15 s cache), never sent to the browser.
- Env kill-switch `HOSPITALITY_ENGINE=on` (unset in production): when off, all
  hospitality functions and pages are 404 regardless of DB flags.

---

## 4. Final database schema (new tables, all `hosp_`)

All tables: `tenant_id uuid NOT NULL` FK → tenants, composite FKs `(tenant_id, id)`,
`created_at`, `updated_at`, RLS enabled, RESTRICTIVE `tenant_isolation` +
RESTRICTIVE `hosp_backend_enabled`, no `anon` grants.

**Business data**
- `hosp_settings` (PK tenant_id): booking_mode `request|instant`, hold_minutes
  (default 30), checkin_time, checkout_time, weekend_nights int[] (default `{4,5}` =
  Thu, Fri), currency `ILS`, timezone `Asia/Jerusalem`, contact phone / email /
  whatsapp, guest_retention_months (nullable, see §7).
- `hosp_properties`: name, slug (unique per tenant), description, address, city,
  lat, lng, status `draft|published`, seo_title, seo_description.
- `hosp_units`: property_id, kind `individual|whole_property`, name, slug,
  base_occupancy, max_guests, max_adults, child_age_limit, bedrooms, bathrooms,
  base_price, extra_adult_price, extra_child_price, min_nights, price_floor,
  price_ceiling, status, sort.
- `hosp_unit_members` (§6).
- `hosp_unit_beds`: unit_id, bed_type, count.
- `hosp_amenities`: key, label, icon, category. `hosp_unit_amenities`:
  property_id | unit_id (exactly one), amenity_id.
- `hosp_media`: property_id | unit_id, kind `image|video`, storage_path, alt,
  width, height, is_cover (unique per owner), sort.

**Pricing**
- `hosp_rate_rules`: scope `property|unit` (+ id), kind `weekday|weekend|season`,
  date range (seasons), days_of_week mask, nightly_price | adjustment
  (`absolute|percent|amount`), min_nights, priority, active.
- `hosp_holidays`: date range, label, applies to all / listed units, price or adjustment, min_nights.
- `hosp_promotions`: units, date range, percent|fixed, min_nights, code (nullable), active.
- `hosp_policies` (1 per tenant, optional per unit): cancellation_tiers jsonb
  `[{days_before, charge_pct}]`, payment_mode `on_arrival|deposit_percent|full`,
  deposit_percent, house_rules.

**Bookings & availability**
- `hosp_guests`: full_name, email, phone, notes, erased_at, erase_reason.
- `hosp_bookings`: booking_number (per-tenant sequence), unit_id, guest_id,
  check_in, check_out, nights (generated), adults, children, status (§5),
  hold_expires_at, source `website|owner|phone|ical`, idempotency_key
  (unique per tenant), currency, total, payment_status
  `none|pending|partial|paid|refunded`, policy_snapshot jsonb (cancellation tiers +
  payment terms at booking time), special_requests, requires_refund bool.
- `hosp_booking_nights`: booking_id, night date, rate, rule_applied — the locked rate;
  `sum(rate) = total` enforced by the RPC.
- `hosp_booking_events`: booking_id, from_status, to_status, actor, note — append-only
  (UPDATE/DELETE revoked + trigger).
- `hosp_blocks`: unit_id, date range, reason `owner|maintenance|other`, note, released_at.
- `hosp_unit_occupancy` (internal, §5–6): physical unit_id, nights daterange,
  booking_id | block_id, **EXCLUDE** `(tenant_id =, unit_id =, nights &&)`.

**Reviews**
- `hosp_reviews`: kind `review|testimonial`, booking_id (required for `review`),
  is_verified (true only via RPC after checked_out), rating 1–5, title, body,
  author_display, status `pending|published|hidden`, owner_reply, replied_at.
- `hosp_review_reports`: review_id, reason, status.

**Billing (separate from Ecommerce)**
- `hosp_plans`: plan_type, title, monthly_price, limits jsonb (`max_units`,
  `storage_mb`, `max_users`, `premium_themes`), is_published (default false).
  Placeholder rows only, **unpublished, no public prices**.
- `hosp_subscriptions` (PK tenant_id): plan_type, status, trial_ends_at,
  current_period_end — mirrors `tenant_subscriptions` shape.
- `hosp_entitlement(tenant, key)`; `max_units` enforced by trigger.

**Website content & themes — designed now, created in Stage 3** (§8).

---

## 5. Booking lifecycle

### Statuses and transitions (enforced by trigger; missing edge = forbidden)
```
requested        → confirmed | pending_payment | declined | cancelled | expired
pending_payment  → confirmed | cancelled | expired
confirmed        → checked_in | cancelled | no_show
checked_in       → checked_out
expired          → confirmed   (only via payment-confirmation revival, §5.3)
declined, cancelled, no_show, checked_out: terminal
```
Inventory-holding ("live") statuses: `pending_payment` (while not expired),
`confirmed`, `checked_in`. `requested` holds nothing; accept re-runs every check.

### 5.1 Occupancy and the exclusion constraint
- A trigger on `hosp_bookings` / `hosp_blocks` maintains `hosp_unit_occupancy`:
  entering a live status inserts rows (fanned out for whole-property units, §6);
  leaving it deletes them. All within the same transaction.
- `EXCLUDE USING gist (tenant_id WITH =, unit_id WITH =, nights WITH &&)` with
  half-open ranges `[check_in, check_out)` — same-day checkout/check-in is allowed.
- Any concurrent insert that would overlap fails with `exclusion_violation`; the
  RPC maps it to a clean "dates no longer available" error.

### 5.2 Hold expiration (robust)
- `pending_payment` requires `hold_expires_at` (CHECK). Set from DB `now()` +
  `hosp_settings.hold_minutes` — never from the client.
- **Lazy expiry in the critical path** — `hosp_create_booking`,
  `hosp_accept_request` and `hosp_confirm_booking` first run
  `hosp_expire_holds_for(unit_ids, range)`: `UPDATE … SET status='expired' WHERE
  status='pending_payment' AND hold_expires_at <= now() AND <overlap>`. This
  deletes the stale occupancy rows **in the same transaction, before** inserting
  the new booking. Therefore a delayed or stopped scheduled job can never leave an
  expired hold blocking a new reservation.
- **Reads** (quote, availability) treat a hold as free when
  `hold_expires_at <= now()` (pure predicate, no writes).
- **Scheduled sweep** `hosp_expire_holds()` — idempotent
  (`WHERE status='pending_payment' AND hold_expires_at <= now()`), batched with
  `FOR UPDATE SKIP LOCKED`, writes exactly one `expired` event per booking.
  Runs from the existing server interval pattern (`payment-expiry`), only when the
  engine is on. It is housekeeping, not a correctness requirement.
- Concurrency: two transactions expiring the same hold serialise on the row lock;
  the second matches 0 rows (idempotent). The subsequent inserts race on the
  exclusion constraint — exactly one wins.

### 5.3 Confirmation, quote and payments
- `hosp_quote(unit, check_in, check_out, adults, children, promo?)` — read-only,
  SECURITY DEFINER: validates dates, capacity, min nights (max over applicable
  rules), availability; per-night rate = promotion > holiday > unit season >
  property season > weekend > weekday > base; occupancy extras; floor/ceiling
  guard. Returns nights + total.
- `hosp_create_booking(...)` — ignores any client price; recomputes the quote,
  writes `hosp_booking_nights`, snapshots policy, creates/reuses the guest,
  status `requested` (request mode) or `confirmed` / `pending_payment` (instant,
  by payment mode). Idempotent on `idempotency_key`. Requires
  `hospitality_booking_enabled`.
- `hosp_accept_request` / `hosp_decline_request` / `hosp_cancel_booking`
  (computes the fee from the snapshot) / `hosp_mark_checked_in|out|no_show`.
- `hosp_confirm_payment(booking)` (future payment rail): if the hold is still
  valid → `confirmed`. If expired → tries to revive (re-insert occupancy); on
  conflict the booking stays `expired`, `requires_refund = true`, event logged.
- Payments: Stage 1 stores `payment_status` only. Online deposits come later via a
  dedicated `hosp_payments` table on the existing Grow integration
  (`grow_payment_processes` is order-specific and is not reused).

---

## 6. Whole-property model

- `hosp_units.kind`: `individual` (a physical unit) or `whole_property`
  (sellable bundle).
- `hosp_unit_members(tenant_id, parent_unit_id, member_unit_id)`, PK
  `(parent_unit_id, member_unit_id)`. Trigger checks: parent is
  `whole_property`, member is `individual`, same tenant and property, no nesting.
- Occupancy is always stored per **physical** unit:
  - booking/block on an individual unit → 1 row;
  - booking/block on a whole property → 1 row per member.
- Therefore the single exclusion constraint gives both rules:
  - whole booking blocks every member;
  - a whole booking is rejected if any member is already occupied.
- A whole property with no members cannot be published or booked.
  Membership cannot change while the parent or a member has future live bookings
  (trigger) — avoids silently unprotected dates.

### Concurrency test scenarios (two real sessions; `scripts/db-tests/concurrency/`)
1. T1 books whole compound, T2 books member A, same dates, interleaved commits →
   exactly one succeeds, the other gets `exclusion_violation`.
2. T1 books member A, T2 books member B (no overlap between members) → both succeed;
   a third whole-compound booking then fails.
3. Two whole-compound bookings for overlapping dates → one wins.
4. Adjacent stays (A: 1–3, B: 3–5) → both succeed (half-open ranges).
5. Expired hold on member A + a new whole-compound booking → lazy expiry frees A,
   booking succeeds; the late sweep afterwards is a no-op.
6. Two concurrent bookings racing against the same expired hold → one wins, the
   hold gets exactly one `expired` event.
7. Accepting a request after the dates were sold → refused, request unchanged.
8. Retried `hosp_create_booking` with the same idempotency key (sequential and
   concurrent) → one booking.
9. Owner block on member A vs pending whole booking → one wins.
10. Price change after booking → existing `hosp_booking_nights` unchanged.

Runner: a small bash script using two `psql` connections with explicit
`BEGIN … pg_sleep … COMMIT` ordering (local Postgres 16, same as `run.sh`).

---

## 7. Guest privacy

- **Configurable retention**: `hosp_settings.guest_retention_months` is **NULL by
  default (no automatic erasure)**; the owner (or platform policy later) sets it within
  a bounded range (e.g. 6–120) in settings. No hard-coded period.
- **Export** — `hosp_export_guest(guest_id)` (owner/manager, audited): JSON of guest
  fields, bookings, nights, events, consents.
- **Erasure = anonymisation** — `hosp_anonymize_guest(guest_id, reason)`:
  name → `"Guest <short id>"`, email/phone/notes → NULL, booking
  `special_requests` and free-text event notes scrubbed, `erased_at` set. Blocked
  while the guest has a live or future booking.
- **Records preserved**: bookings, nights, amounts, dates, statuses, payment status
  and events (without personal text) remain for accounting / legal retention.
- **Retention job** `hosp_apply_retention()` — idempotent, anonymises guests whose
  last stay ended more than N months ago and who have no future booking, only for
  tenants with a configured period.
- **Marketing consent** — separate from booking; reuses the shared
  `marketing_consents` table and existing unsubscribe flow; never pre-checked.
- **Identity documents** — not collected or stored. No ID columns; no private bucket
  in Stage 1.
- Guest tables: staff-only RLS, no anon access; platform admins have no direct table
  access (support goes through audited RPCs).

---

## 8. Themes & section editor readiness (no editor in Stage 1)

Logical separation (each a separate set of tables, created in the stage that needs it):

| Concern | Tables | Stage |
|---|---|---|
| Business & settings | `hosp_settings`, `hosp_policies` | 1 |
| Property / unit data | `hosp_properties`, `hosp_units`, beds, amenities, `hosp_media` | 1 |
| Pricing | rate rules, holidays, promotions | 1 |
| Bookings & availability | bookings, nights, events, guests, blocks, occupancy | 1 |
| Website content | `hosp_site_pages`, `hosp_site_sections` (type, order, hidden, `content jsonb` validated per section type, references to `hosp_media` ids — never URLs) | 3 |
| Theme configuration | `hosp_site_theme` (theme_key, tokens jsonb: colours, fonts from an approved list, button / card / gallery styles) | 3 |
| Versioning | `hosp_site_versions` (draft / published snapshots of pages + sections + theme; publish = new version; restore = copy) | 3 |

Rules: themes read business data and content but never store it; switching theme only
changes `hosp_site_theme.theme_key`; content and SEO fields are theme-independent;
media is referenced by id so theme and layout changes never touch files.

---

## 9. RLS and permissions

- `current_site_type()` — site type of `current_tenant_id()` (STABLE, used as an
  initplan).
- `hosp_can(permission)` built on the existing `store_staff_role()`: owner and manager
  → all hospitality permissions; other staff roles → none (hospitality tenants only
  accept `admin` members). `staff_can()` / `permissions.ts` unchanged.
- Per table: RESTRICTIVE `tenant_isolation`, RESTRICTIVE `hosp_backend_enabled`
  (`hosp_flag(...)`), PERMISSIVE staff policies by `hosp_can`. Bookings, nights,
  events and occupancy: SELECT for staff only; writes only via RPCs (no
  INSERT/UPDATE/DELETE grants).
- Public reads (Stage 6+) will use dedicated SECURITY DEFINER RPCs returning
  published data only.
- Storage: new bucket `hosp-media` (public read), write path
  `<tenant_id>/…` by staff with `hosp_can('media')` and the backend flag.

---

## 10. Migrations (exact list; each additive, idempotent, with a rollback)

| # | File | Contents |
|---|---|---|
| 1 | `20261101090000_hosp_platform_core.sql` | `tenants.site_type` (+ immutability trigger), `current_site_type()`, feature-flag tables + `hosp_flag()` + `platform_set_flag()`, `tenants_seed_settings` branch (Ecommerce path byte-identical), `user_roles` role restriction for hospitality tenants |
| 2 | `20261101100000_ecommerce_engine_guard.sql` | statement-level write guards on the 40 Ecommerce tables, RESTRICTIVE storage policy for `product-images` |
| 3 | `20261101110000_hosp_schema.sql` | business, property/unit, media, pricing, policy, review tables; `hosp_can`; RLS; grants; `hosp-media` bucket + policies |
| 4 | `20261101120000_hosp_booking.sql` | `btree_gist`; members, guests, bookings, nights, events, blocks, occupancy + EXCLUDE; state-machine trigger; quote / create / accept / decline / cancel / confirm / check-in/out RPCs; lazy + scheduled hold expiry; idempotency |
| 5 | `20261101130000_hosp_billing_privacy_admin.sql` | `hosp_plans`, `hosp_subscriptions`, `hosp_entitlement` + unit-limit trigger; privacy RPCs (export, anonymise, retention); `platform_overview()`, `platform_list_hosp_tenants()`, `platform_create_hosp_tenant()` |

Each has `supabase/rollbacks/<name>.down.sql`. Timestamps will be renumbered if
`main` gains later migrations before merge. Migrations run only locally and in CI.

---

## 11. Server / API architecture

```
src/platform/engines/manifest.ts        engine classification (pure)
src/platform/engines/engine-guard.ts     global function middleware
src/engines/hospitality/types/           domain types
src/engines/hospitality/services/        validation (zod), pure helpers
src/engines/hospitality/server/          *.functions.ts (owner CRUD, quote, booking ops)
```
Changed existing files (minimal):
- `src/start.ts` — add `engineGuard` to `functionMiddleware`.
- `src/server.ts` — hospitality-only branch in `storeGate`.
- `src/integrations/supabase/tenant.server.ts` — select `site_type` + flags;
  `siteType` defaults to `ecommerce` if the column is missing.
- `src/lib/feeds.server.ts` — robots for hospitality hosts only.
- `src/integrations/supabase/types.ts` — appended types.
- `e2e/scripts/seed.sql` — one disposable hospitality tenant (flags off by default).

Not changed: Ecommerce routes, components and business logic, `permissions.ts`,
`subscription.ts`, `platform.functions.ts`, onboarding, Dockerfile, deployment.

---

## 12. Tests

- **SQL** (`scripts/db-tests/`): site_type default + immutability; flag matrix;
  seed-trigger equivalence for Ecommerce; write guard per Ecommerce table (generated);
  storage guard; RLS per `hosp_` table (cross-tenant, anon, flag off, wrong site
  type); state-machine transitions (all allowed / forbidden edges); quote rule
  priority, min nights, occupancy extras, floor/ceiling; idempotency; rate lock;
  cancellation fee from snapshot; hold expiry (lazy, sweep idempotency); whole
  property; privacy (export, anonymise, blocked while active, retention job);
  entitlements; platform RPCs admin-only.
- **Concurrency** (`scripts/db-tests/concurrency/`): the 10 scenarios in §6.
- **Vitest**: manifest classification covers every server-function file;
  `engineGuard` decision table; hospitality validators.
- **E2E**: existing 33 tests unchanged + gate tests (Ecommerce host unaffected;
  hospitality host with flags off → pages / server functions / feeds closed;
  flags on locally → owner functions work, cross-tenant denied).
- **CI**: the existing workflow; concurrency script added to the `db` job.

---

## 13. Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Global `engineGuard` misclassifies an Ecommerce function | default classification = `ecommerce`; Ecommerce tenants always pass; full E2E + unit test of the manifest | remove the middleware line in `start.ts` |
| Write-guard triggers slow bulk Ecommerce writes | statement-level, one indexed query per statement; benchmark a 5,000-row product import before/after | `DROP TRIGGER` (rollback file 2) |
| Seed-trigger change alters new-store setup | Ecommerce branch byte-identical; SQL equivalence test | restore previous function body (rollback file 1) |
| `btree_gist` unavailable | standard Supabase extension; checked first in migration 4 | migration aborts cleanly (transactional) |
| Server deployed before migration | `site_type` falls back to `ecommerce`; flags read as off | n/a |
| Parallel changes on `main` | merge `main` into the branch (no rebase) and rerun all tests before review | — |
| Lovable regenerates `types.ts` | only appended types; regenerated file is compatible | re-append |

Rollback order: 5 → 4 → 3 → 2 → 1. All Hospitality objects are new, so dropping them
cannot affect Ecommerce data.

---

## 14. Implementation sequence (report after each step)

1a migration 1 + tests · 1b migration 2 + guard tests · 1c migration 3 + RLS tests ·
1d migration 4 + booking/concurrency tests · 1e migration 5 + tests ·
1f server (manifest, engineGuard, edge gate, tenant fields, hospitality functions) +
Vitest · 1g E2E gate tests, docs, full suite, CI, completion report.

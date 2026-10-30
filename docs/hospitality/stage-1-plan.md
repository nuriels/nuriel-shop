# Hospitality — Stage 1 plan (backend foundation)

Status: **final proposal, awaiting approval.** Nothing in this document is implemented.
Database decision: dedicated `hospitality` schema (§3). Visual reference for the future
guest site: Nofei Dorit mockup (kept outside the repository).
Branch: `hospitality/stage-1` (based on `hospitality/stage-0`). No merge to `main`,
no production deployment, no production credentials.

Design inputs: the existing repository (source of truth), the Stage 0 test baseline,
and domain concepts learned from Kamra PMS (AGPL-3.0 — concepts only, **no code or
text copied**).

---

## 0. Principles

1. **Two independently separable products.** Ecommerce and Hospitality are separate
   engines with their own code, database objects, migrations, tests and configuration.
   Neither contains the other's business logic; both depend only on the shared platform.
2. Ecommerce behaviour is unchanged. Every existing tenant is, and stays, `ecommerce`.
   No mass refactor of existing Ecommerce code in Stage 1.
3. Hospitality is off by default at three independent layers: environment
   (`HOSPITALITY_ENGINE`), server (dispatcher + engine guard) and database
   (RLS + RPC checks on feature flags).
4. Correctness lives in PostgreSQL: tenant isolation (RLS), double-booking prevention
   (`EXCLUDE`), reservation state machine (trigger), pricing (RPC).
5. Additive migrations only. The only touch to an existing object is a `WHEN`
   condition on the existing tenant-seed trigger (function body unchanged, §11).
6. Every new policy, trigger and RPC has tests; the full Stage 0 suite stays green.

---

## 1. Engine architecture

### 1.1 Layers and dependency rules

```
                 ┌──────────────────────────────┐
                 │  Composition root (src/app)  │  the ONLY code that knows both engines
                 └──────┬─────────────────┬─────┘
                        │ registers       │ registers
          ┌─────────────▼──────┐   ┌──────▼──────────────┐
          │  Ecommerce engine  │   │  Hospitality engine │
          │ (legacy src/lib,   │   │ src/engines/        │
          │  src/components,   │   │   hospitality/      │
          │  src/routes …)     │   │                     │
          └─────────┬──────────┘   └──────────┬──────────┘
                    │      only through contracts / adapters
                    └──────────┬───────────────┘
                     ┌─────────▼──────────┐
                     │  Shared platform   │  no product-specific business logic
                     │  src/platform/     │
                     └────────────────────┘
```

Allowed: `ecommerce → platform`, `hospitality → platform`, `app → *`.
Forbidden: `ecommerce ↔ hospitality`, `platform → ecommerce | hospitality`.

Enforcement (implemented in step 1f, no new dependencies):
- ESLint `no-restricted-imports` overrides per folder
  (`src/engines/hospitality/**` may not import `src/lib/**` business modules,
  `src/components/**` except `src/components/ui/**`, or any other engine;
  `src/platform/**` may not import any engine or `src/lib/**` business module).
- A Vitest architecture test that parses imports and fails on any forbidden edge —
  also covers dynamic imports and relative paths ESLint patterns could miss.

### 1.2 Shared platform — what it owns (and what it must not)
The platform owns tenancy, authentication/session, membership and roles, permissions
primitives, domains, storage primitives, billing primitives, notifications/email
transport, feature flags, the engine registry and platform administration shell.
It must not contain product rules (catalog, orders, bookings, pricing, plans' feature
semantics, etc.).

**Existing legacy couplings (documented, not refactored in Stage 1):**
| Existing code | Coupling | Stage 1 handling |
|---|---|---|
| `src/integrations/supabase/tenant.server.ts` | tenant resolution embeds the Ecommerce subscription (`tenant_subscriptions`, `subscription.ts`) | add only a product-neutral `siteType`; Hospitality never reads the embedded Ecommerce subscription |
| `src/server.ts` `storeGate` | suspend/expiry lock uses the Ecommerce subscription | Hospitality lock decided by the Hospitality engine through the dispatcher |
| `tenants_seed_settings` trigger | seeds Ecommerce rows (shipping, Ecommerce trial) on the platform `tenants` table | restricted to `site_type='ecommerce'` with a `WHEN` clause; Hospitality provisions itself explicitly |
| `site_settings` | shared branding/legal/SEO plus some Ecommerce-only columns | Hospitality uses only the generic columns through a platform adapter |
| `src/lib/email.server.ts`, `image.ts`, `rate-limit.server.ts` | generic infrastructure living in `src/lib` | wrapped by `src/platform/*` adapters; Hospitality imports the adapters, never `src/lib` |

These are moved into `src/platform` gradually and mechanically in later stages.

### 1.3 Engine contract (platform-defined interface)

```ts
// src/platform/engines/contract.ts (types only)
interface EngineDescriptor {
  key: "ecommerce" | "hospitality";
  ownsServerFn(filename: string): boolean;   // server-function ownership
  enabledFor(tenant: TenantContext): boolean; // env + flags + site type
  gate(request: GateRequest): GateDecision;   // edge decisions for its own tenants
  admin?: EngineAdminProvider;                // super-admin stats/sections
}
```
- `src/engines/hospitality/engine.ts` implements it with Hospitality code.
- `src/engines/ecommerce/engine.ts` is a **thin adapter** declaring the legacy
  Ecommerce files/behaviour (no Ecommerce logic moves in Stage 1).
- `src/app/engines.ts` (composition root) registers both. The platform dispatcher only
  iterates the registry — it never imports an engine.

---

## 2. Server functions and routing

### Facts verified in this codebase
- 44 server-function files (133 functions) share one endpoint
  `/_serverFn/<sha256 id>` — the id cannot identify the engine.
- TanStack Start passes `serverFnMeta.filename` (source path, e.g.
  `src/lib/crm.functions.ts`) to **global function middleware**, and it is present in
  production builds (verified in `.output/server/_ssr/*.mjs`). `src/start.ts` already
  registers global function middleware (`attachSupabaseAuth`).

### Design
1. **Ownership** comes from engine descriptors, not a central list of business files:
   - Hospitality: everything under `src/engines/hospitality/**`.
   - Platform: files under `src/platform/**` plus the documented legacy shared files
     (auth, login codes, password, store switcher, support, handoff, custom domain,
     marketing consent, site forms, owner agreement, email settings, notifications,
     `platform*`, `portal`) — listed in `src/platform/engines/shared-functions.ts`.
   - Ecommerce: every other legacy file (**default = today's behaviour**).
2. **Platform dispatcher** = global function middleware `engineGuard`
   (`src/platform/engines/engine-guard.ts`): resolves the tenant (existing request
   context), finds the owning engine via the registry, and allows the call only if
   `owner === platform` or `owner === tenant.siteType && owner.enabledFor(tenant)`;
   otherwise 404. Missing/unknown filename on a non-Ecommerce tenant → 404 (fail closed).
   For Ecommerce tenants it is a constant-time check — no DB call, no behaviour change.
3. Hospitality functions add per-function `requireHospFlag(flag)` middleware from
   their own engine (e.g. `hospitality_booking_enabled`).
4. **Edge**: `src/server.ts` `storeGate` calls `registry.engineFor(tenant).gate()`
   for non-Ecommerce tenants only. The Hospitality gate: pages → 404 unless
   `hospitality_frontend_enabled`; `robots.txt` → `Disallow: /`; `sitemap.xml`,
   `llms.txt`, Ecommerce API routes → 404. Ecommerce hosts follow the existing code path.
5. Unit test: every `createServerFn` file has exactly one owner; dispatcher decision table.

---

## 3. Database separation — `hosp_` prefix vs dedicated schema

| Concern | A. `public.hosp_*` tables | B. dedicated schema `hospitality.*` |
|---|---|---|
| Supabase / PostgREST | works with no config change | schema must be added to the API's exposed schemas (`[api] schemas` locally; `PGRST_DB_SCHEMAS` / dashboard setting in production) and `GRANT USAGE` to `anon`, `authenticated`, `service_role`; clients use `supabase.schema('hospitality')` |
| RLS | identical mechanics | identical mechanics; cross-schema FKs to `public.tenants` and calls to `public.current_tenant_id()` work normally |
| Engine kill-switch | per-table policies only | additionally `REVOKE USAGE ON SCHEMA hospitality` disables the whole engine at once |
| Generated types | mixed into the shared `types.ts` (Lovable-managed) | generated separately into `src/engines/hospitality/types/database.ts` — no shared file |
| Migrations | same folder, prefix convention | same folder; every object schema-qualified; `search_path` set explicitly in DEFINER functions |
| Backups / restore | whole DB dump; selective restore by table list | `pg_dump -n hospitality` gives a self-contained engine dump |
| Access control audit | by naming convention | by schema — `\dn+`, default privileges per schema |
| Future extraction | must list tables by prefix; risk of missed objects | move the schema (plus the documented platform contract) — clean boundary |
| Risk | lowest operational risk now | one production configuration step **before the Hospitality API goes live** (not needed while flags are off); Stage 0 RLS coverage test extended to the new schema |

**Decision: B — dedicated `hospitality` schema** (approved direction, verified below).
Tables are written as `hospitality.<name>`.

### 3.1 Verification against our self-hosted Supabase (prototype, local only)
Production (per `deploy/DEPLOY.md`, `deploy/setup-selfhost.sh`) is the official
Supabase Docker stack, compose project `kobi` (`kobi-rest` = PostgREST, Kong on
`127.0.0.1:8300`), secrets in `/root/kobi-supabase/docker/.env`, migrations applied
with `psql`. A prototype schema (table + RLS + grants + RPC) was tested on the
disposable local Supabase CLI stack (same images) and then dropped. Production was not
touched.

| Check | Result |
|---|---|
| Schema not exposed | PostgREST rejects it (`PGRST106 Invalid schema`) — this is production's state today, so Hospitality is unreachable through the API until deliberately exposed |
| Exposure | `PGRST_DB_SCHEMAS` (prod: `docker/.env`; local: `[api] schemas` in `config.toml`) + PostgREST restart/reload |
| supabase-js | `client.schema('hospitality').from(...)` / `.rpc(...)` work with the user JWT and `x-tenant-id` |
| RLS | owner A sees only A's rows; cross-tenant read returns `[]`; cross-tenant insert → `42501 … tenant_isolation`; anon without grant → `42501 permission denied` |
| Cross-schema references | FK to `public.tenants`, calls to `public.current_tenant_id()` / `public.is_admin()` work |
| Generated types | `supabase gen types typescript --schema hospitality` produces Hospitality-only types (no Ecommerce tables) |
| Backup / extraction | `pg_dump -n hospitality` produces a self-contained dump; its only external references are FKs to `public.tenants` (the documented platform contract) |
| Rollback | `DROP SCHEMA hospitality CASCADE` removes everything; Ecommerce data untouched |
| **Critical finding** | if a schema listed in `PGRST_DB_SCHEMAS` does **not exist**, PostgREST cannot load its schema cache and **the whole API returns 503 (Ecommerce included)** |

### 3.2 Rules derived from the verification
1. **Order at go-live:** run the Hospitality migrations first, then add `hospitality`
   to `PGRST_DB_SCHEMAS` and reload PostgREST. Never the reverse.
2. **Rollbacks never drop the schema itself**: the down-migrations drop Hospitality
   objects and revoke grants but keep an empty `hospitality` schema, so an exposed
   configuration can never point to a missing schema. Dropping the schema requires
   removing it from `PGRST_DB_SCHEMAS` first (documented runbook).
3. Until go-live, production keeps `PGRST_DB_SCHEMAS` unchanged; the server-side
   Hospitality code is also behind `HOSPITALITY_ENGINE` and the DB flags.
4. Local/CI: `e2e/scripts/supabase-up.sh` adds `hospitality` to the generated
   (gitignored) local `config.toml` after the migrations exist; the SQL runner
   (`run.sh`) needs no change beyond including the Hospitality test folder.
5. SECURITY DEFINER functions in `hospitality` use `SET search_path = ''` and fully
   qualified names.
6. Production configuration change needed **only when Hospitality goes live**: one
   line in `/root/kobi-supabase/docker/.env` (`PGRST_DB_SCHEMAS=…,hospitality`) and a
   restart of `kobi-rest`. Storage (`hosp-media` bucket) and Auth need no configuration.

Ecommerce stays in `public` (no move in Stage 1). Platform objects stay in `public`
and are prefixed `platform_` where new.

---

## 4. Complete Ecommerce isolation

### 4.1 Audit (local DB built from all 116 migrations)
- **70 public tables**, explicitly classified:
  - **Ecommerce engine (40):** abandoned_carts, cancellation_requests, cart_promotions,
    categories, coupon_email_sends, coupons, customer_carts, customer_emails,
    customer_invites, customer_profiles, global_products, grow_payment_processes,
    home_banner_slides, location_transfer_lines, location_transfers,
    order_courier_links, order_delivery_events, order_items, order_number_counters,
    orders, pages, pending_products, picking_events, price_tier_backup,
    product_categories, product_drafts, product_locations, product_relations,
    product_reviews, product_serials, product_stickers, product_variants,
    service_agreements, shared_carts, shipping_methods, stock_count_lines,
    stock_counts, tenant_addons, tenant_subscriptions, user_custom_prices.
  - **Shared platform (20):** tenants, user_roles, site_settings, email_settings,
    tenant_email_secrets, login_codes, password_reset_requests,
    password_reset_tokens, staff_notifications, contact_messages, support_tickets,
    support_messages, marketing_consents, marketing_consent_events,
    notification_logs, tenant_ssl, tenant_billing_profile, billing_history,
    upgrade_requests, tenant_grow_credentials.
  - **Platform admin (10):** platform_addons, platform_admin_handoffs, platform_admins,
    platform_agreement_acceptances, platform_agreement_versions, platform_audit_log,
    platform_documents, platform_email_log, platform_plans, platform_pricing_settings.
- **350 public functions** (291 SECURITY DEFINER; 113 executable by `anon`, 247 by
  `authenticated`). Classification is generated into
  `docs/architecture/db-classification.md` in step 1a (each function → engine /
  platform), and a test fails if a new public function is unclassified.
- **44 server-function files / 133 functions**, 4 API routes.
- **52 browser files** call Supabase directly (51 tables, 115 RPCs), so server checks
  alone are not enough — the DB layer is required.

### 4.2 Protection strategy
| Layer | Mechanism | Effect on Ecommerce tenants |
|---|---|---|
| Edge | engine `gate()` for non-Ecommerce tenants (§2) | none |
| Server functions | dispatcher `engineGuard` (§2) | constant-time pass |
| DB writes | **statement-level** `AFTER INSERT` and `AFTER UPDATE OF tenant_id` triggers with transition tables on all 40 Ecommerce tables: reject rows whose tenant is not `ecommerce`. Covers PostgREST, SECURITY DEFINER RPCs, `service_role`. | see §4.3 |
| DB reads | no change to existing RLS: a non-Ecommerce tenant cannot own Ecommerce rows, so Ecommerce reads/RPCs return nothing for it | none |
| Roles | generic platform rule: `platform_product_roles(product, role)`; a trigger on `user_roles` allows only roles registered for the tenant's product (Ecommerce registers admin/agent/customer/warehouse/cashier; Hospitality registers admin) | none (all existing roles registered) |
| Storage | new RESTRICTIVE policy: bucket `product-images` writable only for `ecommerce` tenants; `branding` stays shared; existing policies untouched | none |
| Reverse | Hospitality objects accept only `hospitality` tenants (RLS + insert check) | n/a |

### 4.3 Write-guard performance (measured)
Prototype on the local Postgres 16 test DB (inside a rolled-back transaction),
statement-level guard on `global_products`, 3 runs each:

| Operation | without guard | with guard |
|---|---|---|
| 5,000-row bulk INSERT (1 statement) | 1656 / 1967 / 2021 ms | 1836 / 1922 / 2045 ms |
| 1,000 single-row INSERTs | 494 / 601 / 645 ms | 531 / 550 / 715 ms |

Differences are within run-to-run noise (the insert path is dominated by existing
Ecommerce triggers and indexes). The UPDATE guard fires only on `UPDATE OF
tenant_id`, which Ecommerce code never performs, so normal updates have zero added
cost. (A first prototype guarding every UPDATE was rejected: its cost scales with
updated rows.) The step 1b report repeats the benchmark on the final triggers.

---

## 5. Feature flags (platform capability, product-neutral)

- `platform_feature_flags(key PK, enabled default false, description, updated_at, updated_by)`
- `tenant_feature_flags(tenant_id, key, enabled default false)`
- `platform_feature_enabled(key, tenant)` = platform AND tenant (generic).
- Writable only via `platform_set_flag(...)` (platform admin, audited).
- Hospitality registers its keys (`hospitality_backend_enabled`,
  `hospitality_frontend_enabled`, `hospitality_onboarding_enabled`,
  `hospitality_themes_enabled`, `hospitality_booking_enabled`, all false) in its own
  migration and wraps them in `hospitality.flag(key)` (adds "tenant is hospitality").
- Server: flags loaded with the tenant (existing 15 s cache), never sent to the browser.
- Env kill-switch `HOSPITALITY_ENGINE=on` (unset in production) read by
  `src/engines/hospitality/config.ts`.

---

## 6. Hospitality database schema (`hospitality.*`)

All tables: `tenant_id uuid NOT NULL` → `public.tenants`, composite `(tenant_id, id)`
FKs, `created_at`, `updated_at`, RLS on, RESTRICTIVE `tenant_isolation`, RESTRICTIVE
`backend_enabled` (`hospitality.flag('hospitality_backend_enabled')`), no `anon` grants.

**Business:** `settings` (PK tenant_id: booking_mode `request|instant`, hold_minutes
default 30, checkin/checkout time, weekend_nights default `{4,5}`, currency `ILS`,
timezone `Asia/Jerusalem`, contact phone/email/WhatsApp, guest_retention_months
nullable), `policies` (cancellation_tiers jsonb, payment_mode
`on_arrival|deposit_percent|full`, deposit_percent, house_rules).

**Property / unit:** `properties` (name, slug, description, address, city, lat, lng,
status, seo_title, seo_description), `units` (property_id, kind
`individual|whole_property`, name, slug, base_occupancy, max_guests, max_adults,
child_age_limit, bedrooms, bathrooms, base_price, extra_adult_price,
extra_child_price, min_nights, price_floor, price_ceiling, status, sort),
`unit_members`, `unit_beds`, `amenities`, `unit_amenities`, `media` (property|unit,
image|video, storage_path, alt, width, height, is_cover, sort).

**Pricing:** `rate_rules` (scope property|unit, kind weekday|weekend|season, date
range, days_of_week, price/adjustment, min_nights, priority, active), `holidays`,
`promotions`.

**Bookings & availability:** `guests` (full_name, email, phone, notes, erased_at,
erase_reason), `bookings` (booking_number per tenant, unit_id, guest_id, check_in,
check_out, nights, adults, children, status, hold_expires_at, source, idempotency_key
unique per tenant, currency, total, payment_status, policy_snapshot jsonb,
special_requests, requires_refund), `booking_nights` (locked per-night rate),
`booking_events` (append-only), `blocks` (reason owner|maintenance|other, released_at),
`unit_occupancy` (internal; physical unit, `daterange`, EXCLUDE).

**Reviews:** `reviews` (kind review|testimonial, booking_id required for review,
is_verified set only by RPC after checkout, rating, body, status, owner_reply),
`review_reports`.

**Billing (Hospitality-owned):** `plans` (limits jsonb, is_published default false —
placeholders only, no public prices), `subscriptions` (PK tenant_id),
`entitlement(key)`; `max_units` enforced by trigger. Charges, when approved later, go
through a Hospitality payments table on the shared Grow adapter.

---

## 7. Booking lifecycle

```
requested        → confirmed | pending_payment | declined | cancelled | expired
pending_payment  → confirmed | cancelled | expired
confirmed        → checked_in | cancelled | no_show
checked_in       → checked_out
expired          → confirmed   (payment-confirmation revival only)
declined, cancelled, no_show, checked_out: terminal
```
Live (inventory-holding) statuses: `pending_payment` (unexpired), `confirmed`,
`checked_in`. `requested` holds nothing; accept re-runs every check.

- **Occupancy & exclusion:** triggers keep `unit_occupancy` in sync (fan-out for whole
  properties); `EXCLUDE USING gist (tenant_id =, unit_id =, nights &&)` on half-open
  ranges; overlap → clean "dates no longer available" error.
- **Hold expiry:** `hold_expires_at` required for `pending_payment`, set from DB
  `now()` + `settings.hold_minutes`. `create_booking`, `accept_request` and
  `confirm_booking` first expire stale holds on the affected units/dates **in the same
  transaction** (lazy expiry), so a delayed sweep can never block a new booking.
  Quotes/availability treat expired holds as free (read-only predicate). The scheduled
  `expire_holds()` sweep is idempotent (`FOR UPDATE SKIP LOCKED`, one `expired` event).
  Concurrent expiry of the same hold serialises on the row lock; inserts race on the
  exclusion constraint.
- **Quote** (`quote(...)`, read-only): dates, capacity, min nights (max of applicable
  rules), availability; per night: promotion > holiday > unit season > property
  season > weekend > weekday > base; occupancy extras; floor/ceiling guard.
- **Create** (`create_booking(...)`): ignores client prices, recomputes, writes
  `booking_nights`, snapshots policy, idempotent on `idempotency_key`; requires
  `hospitality_booking_enabled`.
- **Transitions:** `accept_request`, `decline_request`, `cancel_booking` (fee from
  snapshot), `mark_checked_in|checked_out|no_show`, `confirm_payment` (revive expired
  hold if dates free, else `requires_refund`).

---

## 8. Whole-property model

- `units.kind`: `individual` (physical) or `whole_property` (bundle);
  `unit_members(parent_unit_id, member_unit_id)` — parent whole, member individual,
  same tenant and property, no nesting.
- Occupancy is stored per physical unit (whole booking/block → one row per member), so
  one exclusion constraint enforces: whole booking blocks all members, and a whole
  booking fails if any member is occupied.
- A whole property without members cannot be published/booked; membership cannot
  change while future live bookings exist.

**Concurrency tests** (two real sessions, `scripts/db-tests/hospitality/concurrency/`):
(1) whole vs member same dates → one wins; (2) member A + member B succeed, then whole
fails; (3) two overlapping whole bookings → one wins; (4) adjacent stays both succeed;
(5) expired hold on a member + new whole booking → succeeds, late sweep is a no-op;
(6) two bookings racing an expired hold → one wins, one `expired` event; (7) accept
after dates sold → refused; (8) idempotent retry (sequential and concurrent) → one
booking; (9) owner block vs pending whole booking → one wins; (10) price change after
booking → locked nights unchanged.

---

## 9. Guest privacy

- Retention `settings.guest_retention_months`: **NULL by default (no automatic
  erasure)**, configurable within a bounded range; nothing hard-coded.
- `export_guest(guest_id)` (owner/manager, audited) — JSON of guest, bookings, nights,
  events, consents.
- `anonymize_guest(guest_id, reason)` — name → `Guest <short id>`, contacts/notes
  NULL, booking `special_requests` and free-text event notes scrubbed; blocked while a
  live or future booking exists.
- Bookings, nights, amounts, dates, statuses, payment status and events (without
  personal text) are preserved for accounting/legal retention.
- `apply_retention()` — idempotent, only tenants with a configured period.
- Marketing consent: separate; uses the shared `marketing_consents` through the
  platform notifications adapter; never pre-checked.
- No identity documents collected or stored; no private bucket in Stage 1.

---

## 10. Themes & section editor readiness (created in Stage 3)

| Concern | Tables | Stage |
|---|---|---|
| Business & settings | `settings`, `policies` | 1 |
| Property / unit data | properties, units, beds, amenities, media | 1 |
| Pricing | rate_rules, holidays, promotions | 1 |
| Bookings & availability | bookings, nights, events, guests, blocks, occupancy | 1 |
| Website content | `site_pages`, `site_sections` (type, order, hidden, `content jsonb` validated per section type, media referenced by id) | 3 |
| Theme configuration | `site_theme` (theme_key, tokens jsonb from approved fonts/colours/styles) | 3 |
| Versioning | `site_versions` (draft/published snapshots; publish = new version; restore = copy) | 3 |

Switching theme changes only `site_theme.theme_key`; content, SEO and media are
theme-independent.

---

## 11. Migrations (exact list, ownership by prefix)

All in `supabase/migrations/` (single folder required by the tooling), owned by prefix:
`*_platform_*`, `*_ecommerce_*`, `*_hosp_*`. Each has a rollback in
`supabase/rollbacks/`. Timestamps are renumbered if `main` gains later migrations.

| # | File | Owner | Contents |
|---|---|---|---|
| 1 | `20261101090000_platform_products_flags.sql` | platform | `tenants.site_type` (default `ecommerce`, immutable), `current_site_type()`, `platform_product_roles` + `user_roles` role trigger, feature-flag tables + `platform_feature_enabled()` + `platform_set_flag()`, `platform_seed_tenant_shared()` (site_settings/email_settings rows), `WHEN (NEW.site_type = 'ecommerce')` on the existing seed trigger (function body unchanged) |
| 2 | `20261101100000_ecommerce_engine_guard.sql` | ecommerce | registers Ecommerce roles; statement-level write guards on the 40 Ecommerce tables; `product-images` RESTRICTIVE storage policy |
| 3 | `20261101110000_hosp_schema.sql` | hospitality | schema `hospitality` + grants, flag keys, `flag()`, `can()`, business/property/unit/media/pricing/policy/review tables, RLS, `hosp-media` bucket + policies, `admin_create_site()` (platform admin; creates the tenant and provisions it explicitly — no trigger on platform tables) |
| 4 | `20261101120000_hosp_booking.sql` | hospitality | `btree_gist`, members, guests, bookings, nights, events, blocks, occupancy + EXCLUDE, state machine, quote/create/transition RPCs, lazy + scheduled hold expiry, idempotency |
| 5 | `20261101130000_hosp_billing_privacy_admin.sql` | hospitality | plans, subscriptions, entitlements, unit limit, privacy RPCs, retention, Hospitality admin stats/list functions (platform-admin gated) |

No platform migration references Hospitality or Ecommerce objects; no Ecommerce
migration references Hospitality; Hospitality references only platform objects
(`tenants`, `user_roles`, `current_tenant_id()`, `is_platform_admin()`,
`store_staff_role()`, flags, `platform_product_roles`). The super-admin overview is
composed in the application layer from each engine's admin provider, so no database
function spans engines.

---

## 12. Server / API architecture and folder structure

```
src/
  app/
    engines.ts                     composition root: registers engine descriptors
  platform/                        shared, product-neutral (Stage 1 creates what it uses)
    engines/       contract.ts, registry.ts, engine-guard.ts, shared-functions.ts
    tenancy/       site-type.ts (reads siteType from the existing tenant context)
    feature-flags/ flags.server.ts
    permissions/   membership-role.server.ts
    notifications/ email.ts (adapter over src/lib/email.server.ts)
    storage/       media.ts (adapter over existing storage helpers)
    auth/ users/ tenant-membership/ domains/ billing/   ← later stages, as code is moved
  engines/
    ecommerce/
      engine.ts                    thin descriptor over legacy code (no moves in Stage 1)
    hospitality/
      engine.ts                    descriptor (ownership, enabledFor, gate, admin)
      config.ts                    HOSPITALITY_ENGINE, constants
      types/       database.ts (generated for schema `hospitality`), domain.ts
      validation/  zod schemas per module
      properties/  units/  availability/  bookings/  pricing/
      guests/  reviews/  billing/   each: service.server.ts (+ pure helpers)
      website-editor/              (Stage 3)
      server/      *.functions.ts  createServerFn handlers (API contracts)
      contracts/   request/response types of the server functions
      tests/       Vitest unit tests for the engine
      README.md    dependencies on the shared platform (the extraction contract)
scripts/db-tests/hospitality/      SQL + concurrency tests for the engine
docs/hospitality/                  this plan, migration notes
```

Changed existing files (each minimal):
- `src/start.ts` — register `engineGuard` (platform) in `functionMiddleware`.
- `src/server.ts` — call `registry.engineFor(tenant).gate()` for non-Ecommerce tenants.
- `src/integrations/supabase/tenant.server.ts` — select `site_type` + flags; `siteType`
  defaults to `ecommerce` if the column is missing.
- `src/lib/feeds.server.ts` — unchanged (Hospitality robots handled by its gate).
- `eslint.config.js` — dependency-rule overrides.
- `vitest.config.ts` — include `src/engines/**/tests`.
- `scripts/db-tests/run.sh` — also run `hospitality/*.test.sql`.
- `e2e/scripts/supabase-up.sh` — expose schema `hospitality` locally (option B);
  `e2e/scripts/seed.sql` — one disposable Hospitality tenant (flags off).

Not changed: Ecommerce routes, components, business logic, `permissions.ts`,
`subscription.ts`, `platform.functions.ts`, onboarding, shared `types.ts` (option B),
Dockerfile, deployment.

### Hospitality extraction readiness
Own domain models, services, validation, server-function contracts, migrations
(`*_hosp_*`), DB schema, tests and config. Its only external dependencies are the
platform contracts listed in `src/engines/hospitality/README.md` and §11 — no
Ecommerce module. The architecture test proves it on every CI run.

---

## 13. RLS and permissions

- `current_site_type()` (platform, STABLE, used as an initplan).
- `hospitality.can(permission)` built on the platform `store_staff_role()`:
  owner/manager → all; other roles cannot exist on Hospitality tenants.
- Per table: RESTRICTIVE `tenant_isolation` + `backend_enabled`; PERMISSIVE staff
  policies by `can()`. Bookings/nights/events/occupancy: SELECT for staff only, writes
  only via RPCs. Public reads (Stage 6+) through DEFINER RPCs on published data only.
- Storage `hosp-media`: public read, write to `<tenant_id>/…` by staff with
  `can('media')` and the backend flag.

---

## 14. Tests

- **SQL**: site_type default/immutability; product-role rule; flag matrix; seed-trigger
  equivalence for Ecommerce; write guard per Ecommerce table (generated from the
  classification) incl. `UPDATE OF tenant_id`; storage guard; RLS per Hospitality table
  (cross-tenant, anon, flag off, wrong product); state machine; quote rules; idempotency;
  rate lock; cancellation fee; hold expiry; whole property; privacy; entitlements; admin
  functions gated; classification coverage (tables + functions); schema coverage
  extension of the Stage 0 RLS test.
- **Concurrency**: the 10 scenarios in §8.
- **Vitest**: architecture (dependency rules), server-function ownership, dispatcher
  decision table, Hospitality validators/pricing helpers.
- **E2E**: existing 33 unchanged + gate tests (Ecommerce host unaffected; Hospitality
  host with flags off fully closed; flags on locally → owner functions work,
  cross-tenant denied).
- **Benchmark**: write-guard timing repeated on final triggers (step 1b report).

---

## 15. Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Dispatcher misclassifies an Ecommerce function | Ecommerce = default owner; Ecommerce tenants always pass; full E2E + ownership test | remove the middleware line in `start.ts` |
| Write guards slow Ecommerce writes | statement-level; UPDATE only `OF tenant_id`; measured (§4.3) | rollback file 2 |
| Seed trigger `WHEN` clause | function body unchanged; equivalence test | rollback file 1 restores the trigger |
| Exposed schema missing → whole API 503 (verified) | migrations before exposure; down-migrations keep an empty schema; runbook in §3.2 | remove from `PGRST_DB_SCHEMAS` before any schema drop |
| Schema exposure is a production config step | needed only at Hospitality go-live; one line + `kobi-rest` restart | revert the line |
| `btree_gist` unavailable | standard Supabase extension; checked first | migration 4 aborts transactionally |
| Server deployed before migrations | `siteType` falls back to `ecommerce`; flags read as off | n/a |
| Parallel changes on `main` | merge `main` into the branch (no rebase) and rerun all tests | — |

Rollback order 5 → 1. Hospitality objects are new (own schema), so dropping them
cannot affect Ecommerce data.

---

## 16. Implementation sequence (report after each step)

1a migration 1 + platform tests + DB classification doc · 1b migration 2 + guard tests
+ benchmark · 1c migration 3 + RLS tests · 1d migration 4 + booking/concurrency tests ·
1e migration 5 + tests · 1f platform engines (contract, registry, dispatcher),
Hospitality engine modules/server functions, tenant fields, ESLint + architecture test,
Vitest · 1g E2E gate tests, docs, full suite, CI, completion report.

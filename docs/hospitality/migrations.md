# Hospitality — migration log

Each migration: owner (by file prefix), what it does, rollback, tests, effect on Ecommerce.
Migrations are applied only locally and in CI until a deployment is explicitly approved
(see the installation runbook outline in `stage-1-plan.md` §A11).

## 20261101090000_platform_products_flags.sql — Stage 1a (platform)

| | |
|---|---|
| Adds | `tenants.site_type` (`ecommerce` default, CHECK, immutable via trigger); `current_site_type()`; `platform_product_roles` + trigger `user_roles_product_role_guard` (only for products that registered roles); `platform_feature_flags`, `tenant_feature_flags` (RLS on, no API grants), `platform_feature_enabled()`, `platform_set_flag()` (platform admin only, audited in `platform_audit_log`); `platform_seed_tenant_shared()` (service role only) |
| Changes | trigger `tenants_seed_settings` now has `WHEN (NEW.site_type = 'ecommerce')`; **function body unchanged** (md5 checked by a test) |
| Ecommerce | no behaviour change: every existing and new store is `ecommerce`, seeded exactly as before; no roles registered for Ecommerce, so the role rule is inactive for stores; all flags off; no API access to the new tables |
| Rollback | `supabase/rollbacks/20261101090000_platform_products_flags.down.sql` — restores the trigger without `WHEN`, drops the new objects; refuses to run while a non-ecommerce tenant exists |
| Tests | `scripts/db-tests/platform-products-flags.test.sql` (SQL, 3 passes), `scripts/db-tests/rollback-check.sh` (rollback + re-apply on a separate DB), `scripts/db-tests/db-classification.test.sql` (coverage), full E2E on the local Supabase |
| Production | nothing to configure; no new environment variables |

## 20261101100000_ecommerce_engine_guard.sql — Stage 1b (ecommerce)

| | |
|---|---|
| Adds | Ecommerce roles registered in `platform_product_roles` (exactly the five roles the `user_roles` CHECK allows: admin, agent, customer, warehouse, cashier); on each of the 40 Ecommerce tables: `ecommerce_rows_guard` (statement-level `AFTER INSERT` with a transition table — one check per statement) and `ecommerce_row_move_guard` (row-level `BEFORE UPDATE OF tenant_id` with `WHEN (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id)` — never fires on ordinary updates); two RESTRICTIVE policies on `storage.objects` (insert/update to `product-images` refused when the site is `hospitality`; unknown site behaves as before) |
| Why row-level for updates | PostgreSQL does not allow transition tables on triggers with a column list (`UPDATE OF tenant_id`) — verified; the `WHEN` clause keeps the cost at zero for ordinary updates |
| Ecommerce | no behaviour change: every role still allowed; inserts, updates and moves between stores unchanged; existing storage policies untouched |
| Effect | no write path (PostgREST, SECURITY DEFINER functions, `service_role`, owner) can create or move Ecommerce rows into a non-Ecommerce tenant |
| Performance (local, 3 runs, with / without) | 5,000-row bulk insert 2068/1964/2182 vs 1968/2174/2323 ms (noise); 5,000-row ordinary update 221/267/264 vs 266/198/220 ms (noise); 1,000 single-row inserts 638/635/686 vs 517/597/636 ms (≈0.05–0.1 ms per insert statement) |
| Rollback | `supabase/rollbacks/20261101100000_ecommerce_engine_guard.down.sql` — removes triggers, functions, storage policies and the Ecommerce role registration; data untouched |
| Tests | `scripts/db-tests/ecommerce-engine-guard.test.sql`, `rollback-check.sh` (both migrations, reverse order, then re-apply), classification regenerated (357 functions), full E2E on local Supabase |
| Production | nothing to configure |

## 20261101110000_hosp_schema.sql — Stage 1c (hospitality)

| | |
|---|---|
| Adds | schema `hospitality` (USAGE for anon/authenticated/service_role; default `EXECUTE` revoked from PUBLIC for new functions); Hospitality role registration (`hospitality` → `admin` only); the five Hospitality flag keys (all off, re-run never resets them); `hospitality.flag(key)` (current site, Hospitality keys and sites only), `flag_for(key, site)` (service role only), `permissions()`, `can(permission)`, `request_tenant()`; tables 1–11 (`settings`, `policies`, `properties`, `units`, `unit_members`, `unit_beds`, `amenities`, `unit_amenities`, `media`, `rate_rules`, `promotions`); `hosp-media` bucket (public read, 50 MB, image/video types) with four staff policies; `hospitality.admin_create_site()` |
| Roles | Hospitality sites accept only `admin` in `user_roles` (the first admin is the protected owner, others are managers — the existing owner logic); `customer`, `agent`, `cashier`, `warehouse` are refused by the existing 1a trigger for every writer, including the store sign-up policy. Ecommerce role registration and permission functions are unchanged (body hashes checked by a test) |
| Permissions | `can()` = known Hospitality permission **and** the request site is `hospitality` **and** `store_staff_role()` is `owner` (all 10) or `manager` (all except `staff.managers`, `billing.manage`). Guests, customers, members of other sites, Ecommerce staff, blocked admins and unknown/Ecommerce permission names → false |
| RLS (every table) | RESTRICTIVE `tenant_isolation` (`tenant_id = current_tenant_id()`), RESTRICTIVE `backend_enabled` (`flag('hospitality_backend_enabled')`), one PERMISSIVE `staff` policy (`can(<table permission>)`); no anon grant; `settings` is SELECT/UPDATE only for staff (created by `admin_create_site`, removed only with the site); `tenant_guard` trigger: rows belong to a Hospitality site and never move between sites (also for `service_role` and DEFINER functions) |
| Data rules | composite `(tenant_id, id)` foreign keys everywhere; whole-property members from the same property, no nesting; one cover per owner; files only under `<site id>/` (no `..`); demo media need a licence reference; policy tiers ordered, percentages 0–100, fixed ≥ 0, deposit-based fees need a deposit; policy `version` bumps on any rule change; exactly one default policy per site (first is default, switching moves the mark, the default cannot be unset, archived or deleted directly) |
| `admin_create_site` | platform admin only (existing `platform_slug_problem` check); creates the `hospitality` tenant (Ecommerce seed does not run), `platform_seed_tenant_shared()`, `hospitality.settings`, a starting "גמישה" policy the owner edits; audited (`site_created`); flags stay off; the owner is attached separately, as for stores |
| Ecommerce | no behaviour change: nothing added to `public` (classification unchanged: 73 tables, 357 functions); store roles, permissions, seed, storage policies unchanged; full E2E unchanged |
| Rollback | `supabase/rollbacks/20261101110000_hosp_schema.down.sql` — refuses while a Hospitality site or a `hosp-media` file exists, or while objects of a later migration remain; drops tables, functions, bucket and policies, unregisters roles and flag keys; **keeps the empty schema** (an exposed but missing schema makes the whole API return 503). Newer Supabase Storage blocks direct deletes from storage tables (`storage.protect_delete`); the rollback sets `storage.allow_delete_query` for its own transaction only, after checking the bucket is empty |
| Verified on the real local Supabase | rollback → store API 200, `hospitality.units` 404 `PGRST205` (not 503); re-apply → 401 `42501` for anon again |
| Site deletion | the existing `platform_delete_tenant()` deletes a Hospitality site: it clears the shared `public` rows and the tenant; Hospitality tables cascade |
| Tests | `scripts/db-tests/hospitality-schema.test.sql` (181 assertions: structure, roles, permission matrix, cross-product, RLS isolation, flags, `request_tenant`, data rules, storage), RLS coverage extended to the `hospitality` schema (`tenant-isolation-coverage.test.sql`), `rollback-check.sh` (M3 → M2 → M1, refusals, re-apply), `e2e/tests/hospitality-api.spec.ts` (real PostgREST / Storage / GoTrue tokens) |
| Production | nothing to configure in this stage. At go-live (separately approved): apply the migration, **then** add `hospitality` to `PGRST_DB_SCHEMAS` and restart `kobi-rest` (runbook §A11) |

## 20261101120000_hosp_booking.sql — Stage 1d (hospitality)

| | |
|---|---|
| Adds | `btree_gist`; tables 12–18: `guests`, `bookings`, `booking_nights`, `booking_events`, `blocks`, `unit_occupancy`, `notifications` (outbox); `settings.last_booking_number`; `settings.guest_retention_months` becomes optional (NULL = never delete, as planned) |
| Double booking | `unit_occupancy` holds one row per physical unit × night range `[check_in, check_out)` for every inventory-holding booking or block; a whole-property booking also holds each member unit. `EXCLUDE USING gist (tenant_id =, unit_id =, nights &&)` is the final authority — it also refuses rows written around the functions (tested with raw inserts in parallel sessions) |
| Consistency | triggers keep occupancy in step with the status (held: pending_approval, pending_payment, confirmed, cancel_requested, checked_in) and write a history row for every status change; deferred constraint triggers check at commit that the nights cover the stay, add up to the price, and the occupancy matches the status — a transaction that would leave a partial booking is refused as a whole |
| State machine | `bookings_before_write`: only the transitions of plan A5; new bookings start as pending_approval / pending_payment / confirmed; `revision` +1 on every change (stale-screen check); `hold_expires_at` required exactly for pending statuses |
| Serialization | every inventory-changing function takes a per-site advisory lock (clear errors, no deadlocks); the database constraint stays the authority even without it |
| Pricing | per night: holiday > unit season > property / global season > weekend > weekday > base (then scope, priority); extra adults / children; floor / ceiling; minimum nights = max of the applicable rules; automatic promotions and coupon codes (usage limit under a row lock) |
| Policies | resolved: manual choice → season / holiday rule with a policy → unit policy → default; snapshot with the rules, version and an **absolute schedule** (deadline at the check-in time in the business time zone, DST-safe); the guest accepts the hash of the exact snapshot shown; fee = the period at the **time of the guest's request** (DB clock), frozen in `cancellation_outcome`; owner may only reduce / waive with a reason (recorded with the actor); refunds are only calculated (`refund_due`) |
| Guest functions (anon / authenticated, `request_tenant()`) | `quote`, `request_booking` (idempotency key, per-contact advisory lock, open-request cap, lazy expiry, policy acceptance with IP / user agent), `get_booking_by_token` (token stored as SHA-256, valid until 30 days after check-out), `cancellation_quote`, `request_cancellation`; logged in: `my_bookings`, `claim_guest_bookings` (verified account email only, this site only) |
| Owner functions (`can('bookings')` / `can('guests')`, backend flag) | `create_manual_booking` (default confirmed, terms-explained confirmation, manual price), `approve_booking` (also an expired request if its dates are free), `decline_booking`, `modify_booking` (revision required, same policy rules re-applied), `cancel_booking`, `approve_cancellation`, `decline_cancellation`, `set_stay_status` (checked_in / checked_out / no_show), `export_guest`, `anonymize_guest` |
| System (service_role) | `expire_holds` (sweep + one reminder at 50 %, `SKIP LOCKED`, idempotent), `confirm_payment` (status only), `claim_notifications` (`SKIP LOCKED`, crashed-worker recovery), `mark_notification` (sent / failed with backoff 1, 5, 30, 120, 720 min / dead after 5; token removed after sending), `apply_retention` (only where a period is set) |
| Outbox | rows written in the same transaction as the change; unique `dedupe_key`; owner recipients = notification emails → contact email → site owner email → the owner's account email; nothing is sent in this stage |
| Access | guests have no table access and no membership; staff read bookings / nights / events / occupancy / outbox / guests (RLS) and write only through the functions (blocks: insert / release under RLS); the booking counter column is not writable by staff |
| Ecommerce | no change: nothing added to `public` (classification unchanged), store roles / permissions / data untouched; full E2E unchanged |
| Rollback | `supabase/rollbacks/20261101120000_hosp_booking.down.sql` — refuses while bookings, guests, blocks or outbox rows exist; drops functions (row-type users first), tables, trigger / normaliser functions; restores the Stage 1c settings (no counter, retention 36 NOT NULL, table-level update); keeps `btree_gist` |
| Verified on the real local Supabase | rollback → store API 200, Stage 1c tables still 401 for anon, booking RPCs 404; re-apply → booking RPCs answer again |
| Tests | `scripts/db-tests/hospitality-booking.test.sql` (210 assertions), `scripts/db-tests/hospitality/concurrency/run.sh` (22 checks with real parallel sessions), `rollback-check.sh` (M4 → M3 → M2 → M1, refusals, re-apply), `e2e/tests/hospitality-api.spec.ts` (booking through PostgREST, 5 parallel guests, manage link, approval, cancellation) |
| Production | nothing to configure in this stage. At go-live: `btree_gist` is part of the Supabase image; the sweep / outbox worker schedule comes with Stage 2 |

## 20261101130000_hosp_billing_admin.sql — Stage 1e (hospitality)

| | |
|---|---|
| Adds | `plans` (platform catalogue, no `tenant_id`, no API access; four unpublished placeholders — trial 20 units / 14 days, basic 5, pro 20, enterprise unlimited — **no prices** until approved, Stage 11); `subscriptions` (one per Hospitality site: plan, status trialing / active / past_due / canceled / expired, trial end, period end, extra units); `policy_versions` (append-only history of every policy version) |
| Separation | nothing references `tenant_subscriptions`, `tenant_addons`, `platform_plans` or Grow; Ecommerce plan / seat / feature functions unchanged (body hashes tested); a Hospitality site gets no Ecommerce subscription row |
| Entitlements | `entitlements(site)`: plan, status, active, unit limit (+ extra units), units used, features. Active = site not suspended and: trialing before the trial end / active before the period end (or none) / past_due within 7 days after the period end. A site without a subscription row behaves as the trial from its opening day. New sites get the trial automatically (trigger on the site settings row) |
| Unit limit | trigger on `units` (insert, activation, bundle → unit): counts active units that are not whole-property bundles, under a per-site advisory lock (5 parallel inserts with one place left → exactly one). Inactive subscription → no new units. Downgrading below the usage keeps existing units and blocks new ones |
| Inactive subscription | no new guest requests (`_public_tenant` checks it); existing bookings, manage links and owner actions continue |
| Functions | owner / manager: `my_entitlements()` (read-only); platform admin only: `admin_plans()`, `admin_set_subscription()` (audited in `platform_audit_log` with the previous state), `admin_site_stats()`, `admin_overview()` — counts, sums and plan data only, no guest names, emails or phones (tested) |
| Policy history and booking terms | see `stage-1-plan.md` §A12.1 — every version recorded; the accepted terms of a booking cannot be changed by anyone (trigger) |
| Owner recipients | `_owner_emails` replaced: the owner-account fallback only applies when there is no notification / contact / opening email, and only to this site's protected, unblocked owner with a verified, active account email (§A12.3) |
| Rollback | `supabase/rollbacks/20261101130000_hosp_billing_admin.down.sql` — refuses while a subscription was changed by the platform or a policy has history beyond version 1; drops the tables, triggers and functions; restores the Stage 1d `_public_tenant` and `_owner_emails` |
| Tests | `scripts/db-tests/hospitality-billing.test.sql` (83 assertions), concurrency scenarios 18–20 (same-site lock waits, other site not blocked, unit limit under parallel inserts), `rollback-check.sh` (M5 → M1, refusals, re-apply), RLS coverage for tables without `tenant_id`, API E2E (owner plan, platform-only statistics) |
| Production | nothing to configure; plan values and prices are placeholders until approved |

## 20261101140000_hosp_coupon_release.sql — approved coupon rule (hospitality)

| | |
|---|---|
| Adds | `bookings.promotion_released_at` (+ CHECK: only on declined / expired / cancelled); trigger `bookings_coupon_usage` (BEFORE UPDATE OF status, after the state-machine trigger) |
| Rule | release one use when a booking ends before confirmation (`pending_approval` / `pending_payment` → `declined` / `expired` / `cancelled`); keep it after confirmation; an expired request re-approved by the owner consumes the use again only if the coupon has room (else the approval is refused); every release / re-consumption is a history event |
| Exactly once | the release happens in the status-changing transaction, guarded by `promotion_released_at` and the one-way state machine; `used_count` never goes below 0 or above the limit (constraints) |
| Rollback | `supabase/rollbacks/20261101140000_hosp_coupon_release.down.sql` — drops the trigger, function, constraint and column (back to "counted at creation, never released"); released counts and history stay |
| Tests | `hospitality-billing.test.sql` §9 (decline, expiry with a second sweep, withdrawal, confirmed-then-cancelled, re-approval, re-approval with the coupon used up, bounds); concurrency 21 (two sweeps + a lazy expiry at once) and 22 (decline racing the sweep); `rollback-check.sh` |

## 20261101150000_hosp_management_foundation.sql — Stage 2a (hospitality)

| | |
|---|---|
| Flag | `hospitality_management_enabled` (off): the owner management area, independent of `hospitality_frontend_enabled` (public website) |
| Manager seats | `plans.max_managers` (trial 3 · basic 2 · pro 5 · enterprise unlimited — approved values, set only when the column is added), `subscriptions.extra_managers` (0–100, platform admin via `admin_set_extra_managers`, audited). Trigger `hospitality_admin_seat_guard` on `public.user_roles` (Hospitality sites only): a new `admin` row / change to `admin` / move into the site beyond the limit is refused in the database, under the same per-site lock as Ecommerce (`admin_seats:<site>`); the owner counts as a seat; platform admins are exempt (as actor and as seat); an inactive subscription blocks additions; a downgrade removes nobody. `entitlements()` adds `max_managers`, `extra_managers`, `managers_used` |
| Ecommerce | `public.user_roles_admin_seat_guard` keeps its exact body plus one early return for non-Ecommerce sites (tested: body still uses `tenant_admin_limit`, stores keep the Ecommerce limit and message, Ecommerce seat tests unchanged) |
| Outbox | staff lose direct `SELECT` on `notifications` (the payload holds the guest manage-link token until the email is sent); `staff_email_status(booking)` returns status, attempts, masked recipient — no payload, no token, no provider error text |
| Guest privacy | new owner-only permission `guests.privacy`; `export_guest` / `anonymize_guest` require it (managers keep reading guests for daily work) |
| Management context | `management_context()`: role, permission map, flags, site, business name / timezone, entitlements (owner: full; manager: active + units only), setup checklist (business details, active unit, real photo, price, reviewed policy). Refused for anyone but this site's owner / managers, and when the database or management flag is off |
| Rollback | `supabase/rollbacks/20261101150000_hosp_management_foundation.down.sql` — refuses while extra manager seats are assigned; restores the original Ecommerce guard body, the migration 3/4/5 functions, staff outbox read; drops the trigger, columns, functions and the flag |
| Tests | `scripts/db-tests/hospitality-management.test.sql` (63 assertions), concurrency 23 (5 parallel managers, one seat left → exactly one), `rollback-check.sh` (M7 first, refusal, exact restore, re-apply), Stage 1 assertions updated for the approved rules (11 permissions, outbox through the safe function) |
| Production | nothing to configure; the management area also needs `HOSPITALITY_ENGINE=on`, which is not set in production |

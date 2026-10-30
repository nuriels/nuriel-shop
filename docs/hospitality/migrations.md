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

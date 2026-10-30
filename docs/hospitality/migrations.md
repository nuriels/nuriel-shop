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

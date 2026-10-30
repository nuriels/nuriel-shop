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

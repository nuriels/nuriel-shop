-- ============================================================
-- Hospitality — the platform panel keeps online stores and hospitality sites apart
-- (20261108130000_hosp_platform_separation.sql, migration 58)
--   • the stores list (platform_list_tenants) has only online stores; hospitality sites are in their own area;
--   • the store billing actions refuse a hospitality site (no store subscription, guarded store tables);
--   • the hospitality site list carries the plan screen's fields (paid-period end, manager seats), and the
--     plan screen's save keeps a given end date, takes a status and extra seats; the plan's limits follow.
-- ============================================================
\set OWNER_P '''a0000000-0000-0000-0000-000000058a01'''

CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.platform_err(_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.as_platform(_sql);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN SQLERRM;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.site_row(_id uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT x FROM jsonb_array_elements(pg_temp.as_platform('SELECT hospitality.admin_sites()')) x WHERE x ->> 'id' = _id::text;
$f$;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000058a01', 'm58.owner@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m58-sep', 'צימרי ההפרדה', 'm58.owner@test.local')$$) ->> 'id' AS sp \gset

-- run as the platform admin (the function checks it)
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', false) IS NOT NULL AS ok \gset
SELECT tests.check('panel (58): as the platform admin — the default store is listed, the hospitality site is not',
  format($$SELECT EXISTS (SELECT 1 FROM public.platform_list_tenants() l WHERE l.is_default)
             AND NOT EXISTS (SELECT 1 FROM public.platform_list_tenants() l WHERE l.id = %L::uuid)
             AND (SELECT count(*) FROM public.platform_list_tenants())
               = (SELECT count(*) FROM public.tenants WHERE site_type = 'ecommerce')$$, :'sp'));
SELECT set_config('request.jwt.claim.sub', '', false) IS NOT NULL AS ok \gset
SELECT tests.check('panel (58): the store billing actions refuse a hospitality site (it has no store subscription)',
  format($$SELECT pg_temp.platform_err(format('SELECT public.platform_extend_trial(%%L, 30)', %1$L)) LIKE '%%לא נמצאה%%'
             AND pg_temp.platform_err(format('SELECT public.platform_record_payment(%%L, %%L, 400)', %1$L, 'premium')) LIKE '%%לא נמצאה%%'
             AND NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE tenant_id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM public.billing_history WHERE tenant_id = %1$L)$$, :'sp'));

SELECT tests.check('plan screen (58): the site row has the paid-period end and the manager seats',
  format($$SELECT r ? 'current_period_end' AND (r ->> 'extra_managers')::int = 0 AND r ? 'managers_limit'
             AND r ->> 'plan' = 'trial'
            FROM pg_temp.site_row(%L) r$$, :'sp'));
-- "give Nofi Dorit Premium": premium, active until a date, 2 extra manager seats
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_subscription(%L, 'premium', 'active', NULL, '2027-06-30T23:59:59Z', 0, 'בדיקה')$$, :'sp')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_extra_managers(%L, 2)$$, :'sp')) IS NOT NULL AS ok \gset
SELECT tests.check('plan screen (58): premium until 30.6.2027 with 2 extra seats — the row shows it, the limits follow (owner + 5 + 2)',
  format($$SELECT r ->> 'plan' = 'premium' AND r ->> 'subscription_status' = 'active'
             AND (r ->> 'subscription_active')::boolean
             AND left(r ->> 'current_period_end', 10) = '2027-06-30'
             AND (r ->> 'extra_managers')::int = 2 AND (r ->> 'managers_limit')::int = 8
             AND r ->> 'units_limit' IS NULL
             AND (hospitality.entitlements(%1$L) -> 'features' ->> 'channels')::boolean
            FROM pg_temp.site_row(%1$L) r$$, :'sp'));
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_subscription(%L, 'basic', 'past_due', NULL, '2027-06-30T23:59:59Z', 1, 'בדיקה')$$, :'sp')) IS NOT NULL AS ok \gset
SELECT tests.check('plan screen (58): basic, past due, 1 extra unit — the end date stays, channels close, 3 + 1 units',
  format($$SELECT r ->> 'plan' = 'basic' AND r ->> 'subscription_status' = 'past_due'
             AND left(r ->> 'current_period_end', 10) = '2027-06-30'
             AND (r ->> 'units_limit')::int = 4 AND (r ->> 'extra_units')::int = 1
             AND NOT (hospitality.entitlements(%1$L) -> 'features' ->> 'channels')::boolean
            FROM pg_temp.site_row(%1$L) r$$, :'sp'));

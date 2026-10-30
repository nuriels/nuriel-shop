-- ============================================================
-- Hospitality: plans, subscriptions, unit limit, platform statistics, policy history,
-- booking-terms immutability, owner email fallback, coupon usage rule
-- (Hospitality Stage 1e — 20261101130000_hosp_billing_admin.sql)
-- Unit-limit and booking-lock concurrency: scripts/db-tests/hospitality/concurrency/run.sh
-- ============================================================
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set ECOM_OWNER '''a0000000-0000-0000-0000-0000000000a1'''
\set OWNER_P '''a0000000-0000-0000-0000-0000000003a1'''
\set MANAGER_P '''a0000000-0000-0000-0000-0000000003a2'''
\set OWNER_Q '''a0000000-0000-0000-0000-0000000003b1'''
\set GUEST '''a0000000-0000-0000-0000-0000000003c1'''

CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$ SELECT current_date + _n $$;
CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', CASE WHEN _site IS NULL THEN '' ELSE json_build_object('x-tenant-id', _site)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), true);
  EXECUTE 'SET LOCAL ROLE ' || CASE WHEN _uid IS NULL THEN 'anon' ELSE 'authenticated' END;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.req(_site text, _unit uuid, _in date, _out date, _email text, _key text,
                                       _code text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE q jsonb;
BEGIN
  q := pg_temp.call(_site, NULL, format('SELECT hospitality.quote(%L, %L, %L, 2, 0, %L)', _unit, _in, _out, _code));
  RETURN pg_temp.call(_site, NULL, format(
    'SELECT hospitality.request_booking(_unit_id => %L, _check_in => %L, _check_out => %L, _full_name => %L,
       _email => %L, _phone => %L, _idempotency_key => %L, _policy_accepted => true, _policy_hash => %L, _promo_code => %L)',
    _unit, _in, _out, 'אורח', _email, '05' || lpad((abs(hashtext(_email)) % 100000000)::text, 8, '0'), _key,
    q ->> 'policy_hash', _code));
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(_name text, _sql text, _pattern text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE err text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  RESET ROLE;
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, err IS NOT NULL AND err ILIKE '%' || _pattern || '%', COALESCE('ERROR: ' || err, 'no error'));
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.after(_name text, _action text, _check text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE r jsonb; v boolean; err text;
BEGIN
  BEGIN
    EXECUTE _action INTO r;
    EXECUTE _check INTO v USING r;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, err IS NULL AND COALESCE(v, false),
          COALESCE('ERROR: ' || err, 'value=' || COALESCE(v::text, 'null') || ' result=' || left(COALESCE(r::text, 'null'), 300)));
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-0000000003a1', 'owner.p@test.local', now()),
  ('a0000000-0000-0000-0000-0000000003a2', 'manager.p@test.local', now()),
  ('a0000000-0000-0000-0000-0000000003b1', 'owner.q@test.local', now()),
  ('a0000000-0000-0000-0000-0000000003c1', 'guest.p@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE he_ecom AS
SELECT (SELECT count(*) FROM public.tenant_subscriptions) AS subs,
       (SELECT md5(string_agg(t::text, ',' ORDER BY t.tenant_id)) FROM public.tenant_subscriptions t) AS subs_hash;

SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('he1e-p', 'אירוח P', 'owner.p@test.local'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('he1e-q', 'אירוח Q'))$$) IS NOT NULL AS ok \gset
SELECT id AS sp FROM public.tenants WHERE slug = 'he1e-p' \gset
SELECT id AS sq FROM public.tenants WHERE slug = 'he1e-q' \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES (:'sp', :OWNER_P, 'owner.p@test.local', 'owner_p_1e', 'admin', true);
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES (:'sp', :MANAGER_P, 'manager.p@test.local', 'manager_p_1e', 'admin', true);
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES (:'sq', :OWNER_Q, 'owner.q@test.local', 'owner_q_1e', 'admin', true);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(public.platform_set_flag('hospitality_backend_enabled', true)
   AND public.platform_set_flag('hospitality_booking_enabled', true)
   AND public.platform_set_flag('hospitality_backend_enabled', true, %1$L) AND public.platform_set_flag('hospitality_booking_enabled', true, %1$L)
   AND public.platform_set_flag('hospitality_backend_enabled', true, %2$L) AND public.platform_set_flag('hospitality_booking_enabled', true, %2$L))$$,
   :'sp', :'sq')) IS NOT NULL AS ok \gset
INSERT INTO hospitality.properties (id, tenant_id, name, slug, status) VALUES
  ('71e20000-0000-0000-0000-0000000000a1', :'sp', 'מתחם P', 'p', 'active'),
  ('71e20000-0000-0000-0000-0000000000b1', :'sq', 'מתחם Q', 'q', 'active');
INSERT INTO hospitality.units (id, tenant_id, property_id, name, slug, base_price) VALUES
  ('71e30000-0000-0000-0000-0000000000a1', :'sp', '71e20000-0000-0000-0000-0000000000a1', 'צימר 1', 'z1', 500),
  ('71e30000-0000-0000-0000-0000000000a2', :'sp', '71e20000-0000-0000-0000-0000000000a1', 'צימר 2', 'z2', 500),
  ('71e30000-0000-0000-0000-0000000000b1', :'sq', '71e20000-0000-0000-0000-0000000000b1', 'צימר Q', 'zq', 500);
\set U1 '''71e30000-0000-0000-0000-0000000000a1'''
\set U2 '''71e30000-0000-0000-0000-0000000000a2'''
\set UQ '''71e30000-0000-0000-0000-0000000000b1'''

-- ============================================================
-- 1. Structure and separation from Ecommerce billing
-- ============================================================
SELECT tests.check('structure: plans, subscriptions and policy_versions exist in the hospitality schema',
  $$SELECT count(*) = 3 FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relkind = 'r'
     AND relname IN ('plans', 'subscriptions', 'policy_versions')$$);
SELECT tests.check('structure: the plan catalogue has no API access at all (read through functions only)',
  $$SELECT NOT bool_or(has_table_privilege(r, 'hospitality.plans', p))
      FROM unnest(ARRAY['anon', 'authenticated']) r, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p$$);
SELECT tests.check('structure: staff can only read subscriptions and policy history (no writes)',
  $$SELECT has_table_privilege('authenticated', 'hospitality.subscriptions', 'SELECT')
       AND has_table_privilege('authenticated', 'hospitality.policy_versions', 'SELECT')
       AND NOT bool_or(has_table_privilege('authenticated', 'hospitality.' || t, p))
      FROM unnest(ARRAY['subscriptions', 'policy_versions']) t, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) p$$);
SELECT tests.check('structure: placeholder plans are unpublished and have no prices (prices need approval)',
  $$SELECT count(*) = 4 AND bool_and(NOT is_published AND price_monthly IS NULL) FROM hospitality.plans$$);
SELECT tests.check('separation: no Hospitality object references Ecommerce billing tables',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.connamespace = 'hospitality'::regnamespace
                         AND c.confrelid IN ('public.tenant_subscriptions'::regclass, 'public.tenant_addons'::regclass))
       AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace
                         AND (p.prosrc LIKE '%tenant_subscriptions%' OR p.prosrc LIKE '%tenant_addons%'
                              OR p.prosrc LIKE '%platform_plans%' OR p.prosrc LIKE '%grow%'))$$);
SELECT tests.check('separation: Ecommerce plan / seat / feature functions are unchanged',
  $$SELECT count(*) = 3 AND bool_and(md5(prosrc) = CASE proname
        WHEN 'tenant_admin_limit' THEN 'fbe79c16f4ee6603c1875413be57fde4' WHEN 'plan_admin_limit' THEN 'fa8acc6ae1b63d0c8d91b64b4995f0db' WHEN 'tenant_features' THEN '22a05ce8fca78bf0396b2ab9e8338ae0' END)
      FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('tenant_admin_limit', 'plan_admin_limit', 'tenant_features')$$);
SELECT tests.check('separation: a Hospitality site gets no Ecommerce subscription row',
  format($$SELECT NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE tenant_id IN (%L, %L))$$, :'sp', :'sq'));

-- ============================================================
-- 2. Subscriptions and states
-- ============================================================
SELECT tests.check('subscription: a new site starts on the 14-day trial',
  format($$SELECT plan_code = 'trial' AND status = 'trialing'
             AND trial_ends_at BETWEEN now() + interval '14 days' - interval '1 minute' AND now() + interval '14 days' + interval '1 minute'
          FROM hospitality.subscriptions WHERE tenant_id = %L$$, :'sp'));
SELECT tests.check('entitlements: trial is active with the trial unit limit and current usage',
  format($$SELECT e ->> 'plan' = 'trial' AND (e ->> 'active')::boolean AND (e ->> 'max_units')::integer = 20
             AND (e ->> 'units_used')::integer = 2 AND NOT (e ->> 'implicit')::boolean
          FROM (SELECT hospitality.entitlements(%L) AS e) x$$, :'sp'));
INSERT INTO public.tenants (id, slug, name, site_type, created_at) VALUES
  ('71e10000-0000-0000-0000-0000000000d1', 'he1e-raw', 'בלי מנוי', 'hospitality', now() - interval '30 days');
SELECT tests.check('entitlements: a site without a subscription row behaves as the trial from its opening day (expired after 14 days)',
  $$SELECT (e ->> 'implicit')::boolean AND e ->> 'plan' = 'trial' AND NOT (e ->> 'active')::boolean
      FROM (SELECT hospitality.entitlements('71e10000-0000-0000-0000-0000000000d1') AS e) x$$);
SELECT tests.check('entitlements: not defined for an Ecommerce store',
  $$SELECT hospitality.entitlements('70000000-0000-0000-0000-00000000000a') IS NULL$$);

CREATE TEMP TABLE he_states (status text, trial_ends interval, period_end interval, active boolean);
INSERT INTO he_states VALUES
  ('trialing', interval '1 day', NULL, true), ('trialing', interval '-1 second', NULL, false),
  ('active', NULL, NULL, true), ('active', NULL, interval '10 days', true), ('active', NULL, interval '-1 second', false),
  ('past_due', NULL, interval '-3 days', true), ('past_due', NULL, interval '-8 days', false),
  ('canceled', NULL, NULL, false), ('expired', NULL, NULL, false);
DO $t$
DECLARE r record; e jsonb; _bad text := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  FOR r IN SELECT * FROM he_states LOOP
    e := hospitality.admin_set_subscription('71e10000-0000-0000-0000-0000000000d1', 'basic', r.status,
           now() + r.trial_ends, now() + r.period_end);
    IF (e ->> 'active')::boolean IS DISTINCT FROM r.active THEN
      _bad := _bad || r.status || ' ' || COALESCE(r.trial_ends::text, r.period_end::text, '') || '; ';
    END IF;
  END LOOP;
  INSERT INTO tests.results (name, ok, detail)
  VALUES ('subscription states: trialing / active / past_due (7-day grace) / canceled / expired give the expected access',
          _bad = '', COALESCE(NULLIF(_bad, ''), 'ok'));
END $t$;
UPDATE public.tenants SET status = 'suspended', status_changed_at = now() WHERE id = :'sq';
SELECT tests.check('subscription: a suspended site is never active',
  format($$SELECT NOT (hospitality.entitlements(%L) ->> 'active')::boolean$$, :'sq'));
UPDATE public.tenants SET status = 'active', status_changed_at = now() WHERE id = :'sq';

-- ============================================================
-- 3. Permissions
-- ============================================================
SELECT pg_temp.expect_error('admin: a site owner cannot change their own subscription',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.admin_set_subscription(%%L, %%L, %%L)', %L::uuid, 'enterprise', 'active'))$$,
         :'sp', :OWNER_P, :'sp'),
  'רק מנהל הפלטפורמה');
SELECT pg_temp.expect_error('admin: anon cannot call it',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.admin_set_subscription(%%L, %%L, %%L)', %L::uuid, 'enterprise', 'active'))$$,
         :'sp', :'sp'),
  'permission denied');
SELECT pg_temp.expect_error('admin: an Ecommerce store cannot get a Hospitality subscription',
  $$SELECT pg_temp.as_platform('SELECT hospitality.admin_set_subscription(''70000000-0000-0000-0000-00000000000a'', ''pro'', ''active'')')$$,
  'אתר האירוח לא נמצא');
SELECT pg_temp.expect_error('admin: an unknown plan is refused',
  format($$SELECT pg_temp.as_platform(format('SELECT hospitality.admin_set_subscription(%%L, %%L, %%L)', %L::uuid, 'gold', 'active'))$$, :'sp'),
  'חבילה לא מוכרת');
SELECT pg_temp.expect_error('admin: a trial needs an end date',
  format($$SELECT pg_temp.as_platform(format('SELECT hospitality.admin_set_subscription(%%L, %%L, %%L)', %L::uuid, 'trial', 'trialing'))$$, :'sp'),
  'תאריך סיום');
SELECT pg_temp.after('admin: the platform admin moves a site to the basic plan — audited with the previous state',
  format($$SELECT pg_temp.as_platform(format('SELECT hospitality.admin_set_subscription(%%L, %%L, %%L)', %L::uuid, 'basic', 'active'))$$, :'sp'),
  format($$SELECT $1 ->> 'plan' = 'basic' AND ($1 ->> 'max_units')::integer = 5
             AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'hosp_subscription_set'
                           AND details -> 'previous' ->> 'plan' = 'trial' AND details ->> 'plan' = 'basic'
                           AND actor_id = 'a0000000-0000-0000-0000-0000000000f0')$$, :'sp'));
SELECT tests.check('owner: sees the plan and usage of their own site',
  format($$SELECT (pg_temp.call(%L, %L, 'SELECT hospitality.my_entitlements()') ->> 'plan') = 'basic'$$, :'sp', :OWNER_P));
SELECT tests.check('owner: the manager sees it too (read-only)',
  format($$SELECT (pg_temp.call(%L, %L, 'SELECT hospitality.my_entitlements()') ->> 'units_used')::integer = 2$$, :'sp', :MANAGER_P));
SELECT pg_temp.expect_error('owner: a guest cannot read a site''s plan',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.my_entitlements()')$$, :'sp', :GUEST), 'אין הרשאה');
SELECT pg_temp.expect_error('owner: another site''s owner cannot read it',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.my_entitlements()')$$, :'sp', :OWNER_Q), 'אין הרשאה');
SELECT tests.check('isolation: an owner reads only their own subscription row',
  format($$SELECT (pg_temp.call(%L, %L, 'SELECT jsonb_agg(tenant_id) FROM hospitality.subscriptions')) = jsonb_build_array(%L::uuid)$$,
         :'sp', :OWNER_P, :'sp'));
SELECT pg_temp.expect_error('isolation: an owner cannot edit the subscription directly',
  format($$SELECT pg_temp.call(%L, %L, 'UPDATE hospitality.subscriptions SET plan_code = ''enterprise'' RETURNING to_jsonb(1)')$$, :'sp', :OWNER_P),
  'permission denied');

-- ============================================================
-- 4. Unit limit (basic plan: 5 units)
-- ============================================================
INSERT INTO hospitality.units (tenant_id, property_id, name, slug) VALUES
  (:'sp', '71e20000-0000-0000-0000-0000000000a1', 'צימר 3', 'z3'),
  (:'sp', '71e20000-0000-0000-0000-0000000000a1', 'צימר 4', 'z4'),
  (:'sp', '71e20000-0000-0000-0000-0000000000a1', 'צימר 5', 'z5');
SELECT pg_temp.expect_error('limit: the sixth unit is refused on the basic plan',
  format($$INSERT INTO hospitality.units (tenant_id, property_id, name, slug) VALUES (%L, '71e20000-0000-0000-0000-0000000000a1', 'צימר 6', 'z6')$$, :'sp'),
  'מגבלת היחידות בחבילה (5)');
SELECT pg_temp.expect_error('limit: … also through the owner''s API (RLS insert)',
  format($$SELECT pg_temp.call(%L, %L, format('INSERT INTO hospitality.units (tenant_id, property_id, name, slug) VALUES (%%L, %%L, %%L, %%L) RETURNING to_jsonb(id)',
            %L::uuid, '71e20000-0000-0000-0000-0000000000a1', 'צימר 6', 'z6'))$$, :'sp', :OWNER_P, :'sp'),
  'מגבלת היחידות');
INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug) VALUES
  (:'sp', '71e20000-0000-0000-0000-0000000000a1', 'whole_property', 'כל המתחם', 'all');
INSERT INTO hospitality.units (tenant_id, property_id, name, slug, is_active) VALUES
  (:'sp', '71e20000-0000-0000-0000-0000000000a1', 'צימר כבוי', 'off', false);
SELECT tests.check('limit: a whole-property bundle and an inactive unit do not count',
  format($$SELECT (hospitality.entitlements(%L) ->> 'units_used')::integer = 5$$, :'sp'));
SELECT pg_temp.expect_error('limit: activating an inactive unit at the limit is refused',
  $$UPDATE hospitality.units SET is_active = true WHERE slug = 'off' AND tenant_id = (SELECT id FROM public.tenants WHERE slug = 'he1e-p')$$,
  'מגבלת היחידות');
SELECT pg_temp.expect_error('limit: turning the bundle into a regular unit at the limit is refused',
  $$UPDATE hospitality.units SET kind = 'unit' WHERE slug = 'all' AND tenant_id = (SELECT id FROM public.tenants WHERE slug = 'he1e-p')$$,
  'מגבלת היחידות');
SELECT tests.check('limit: editing an existing unit at the limit still works',
  format($$WITH x AS (UPDATE hospitality.units SET name = 'צימר 1 חדש' WHERE id = %L RETURNING 1) SELECT count(*) = 1 FROM x$$, :U1));
SELECT tests.check('limit: deactivating a unit frees a place',
  $$WITH x AS (UPDATE hospitality.units SET is_active = false WHERE slug = 'z5'
                AND tenant_id = (SELECT id FROM public.tenants WHERE slug = 'he1e-p') RETURNING 1) SELECT count(*) = 1 FROM x$$);
SELECT tests.check('limit: … and the freed place can be used',
  $$WITH x AS (UPDATE hospitality.units SET is_active = true WHERE slug = 'off'
                AND tenant_id = (SELECT id FROM public.tenants WHERE slug = 'he1e-p') RETURNING 1) SELECT count(*) = 1 FROM x$$);
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_subscription(%L, 'basic', 'active', NULL, NULL, 2)$$, :'sp')) IS NOT NULL AS ok \gset
SELECT tests.check('limit: extra units raise the limit (5 + 2)',
  format($$WITH x AS (INSERT INTO hospitality.units (tenant_id, property_id, name, slug)
                    VALUES (%L, '71e20000-0000-0000-0000-0000000000a1', 'צימר 6', 'z6'),
                           (%L, '71e20000-0000-0000-0000-0000000000a1', 'צימר 7', 'z7') RETURNING 1)
          SELECT (hospitality.entitlements(%L) ->> 'max_units')::integer = 7 AND (SELECT count(*) FROM x) = 2$$, :'sp', :'sp', :'sp'));
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_subscription(%L, 'basic', 'active')$$, :'sp')) IS NOT NULL AS ok \gset
SELECT tests.check('limit: downgrading below the usage keeps the existing units …',
  format($$SELECT (e ->> 'units_used')::integer = 7 AND (e ->> 'max_units')::integer = 5
             AND (SELECT count(*) FROM hospitality.units WHERE tenant_id = %L AND is_active AND kind <> 'whole_property') = 7
          FROM (SELECT hospitality.entitlements(%L) AS e) x$$, :'sp', :'sp'));
SELECT pg_temp.expect_error('limit: … but no unit can be added until usage is under the limit',
  format($$INSERT INTO hospitality.units (tenant_id, property_id, name, slug) VALUES (%L, '71e20000-0000-0000-0000-0000000000a1', 'צימר 8', 'z8')$$, :'sp'),
  'מגבלת היחידות');
SELECT tests.check('limit: another site is not affected by this site''s usage',
  format($$WITH x AS (INSERT INTO hospitality.units (tenant_id, property_id, name, slug)
           VALUES (%L, '71e20000-0000-0000-0000-0000000000b1', 'צימר Q2', 'zq2') RETURNING 1) SELECT count(*) = 1 FROM x$$, :'sq'));
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_subscription(%L, 'enterprise', 'active')$$, :'sp')) IS NOT NULL AS ok \gset
SELECT tests.check('limit: the enterprise plan has no unit limit',
  format($$WITH y AS (INSERT INTO hospitality.units (tenant_id, property_id, name, slug)
                     VALUES (%L, '71e20000-0000-0000-0000-0000000000a1', 'צימר 8', 'z8') RETURNING 1)
          SELECT (hospitality.entitlements(%L) ->> 'max_units') IS NULL AND (SELECT count(*) FROM y) = 1$$, :'sp', :'sp'));

-- ============================================================
-- 5. An inactive subscription stops new bookings and units, nothing else
-- ============================================================
SELECT pg_temp.req(:'sp', :U1, pg_temp.d(40), pg_temp.d(42), 'before.lapse@example.com', 'he-key-0001') AS rb \gset
SELECT (:'rb'::jsonb) ->> 'booking_id' AS b1, (:'rb'::jsonb) ->> 'manage_token' AS t1 \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_subscription(%L, 'basic', 'expired')$$, :'sp')) IS NOT NULL AS ok \gset
SELECT pg_temp.expect_error('inactive: guests cannot request bookings',
  format($$SELECT pg_temp.req(%L, %L, pg_temp.d(50), pg_temp.d(52), 'after.lapse@example.com', 'he-key-0002')$$, :'sp', :U2),
  'אינן פעילות');
SELECT tests.check('inactive: the guest''s manage link still works',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', %L)) ->> 'id' = %L$$, :'sp', :'t1', :'b1'));
SELECT tests.check('inactive: the owner can still answer existing requests',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.approve_booking(%%L)', %L::uuid)) ->> 'status' = 'confirmed'$$,
         :'sp', :OWNER_P, :'b1'));
SELECT pg_temp.expect_error('inactive: no unit can be added',
  format($$INSERT INTO hospitality.units (tenant_id, property_id, name, slug) VALUES (%L, '71e20000-0000-0000-0000-0000000000a1', 'צימר 9', 'z9')$$, :'sp'),
  'החבילה של האתר לא פעילה');
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_subscription(%L, 'enterprise', 'active')$$, :'sp')) IS NOT NULL AS ok \gset
SELECT tests.check('inactive: reactivating the subscription reopens bookings',
  format($$SELECT (pg_temp.req(%L, %L, pg_temp.d(50), pg_temp.d(52), 'after.lapse@example.com', 'he-key-0002') ->> 'status') = 'pending_approval'$$,
         :'sp', :U2));

-- ============================================================
-- 6. Platform statistics: admin only, no guest personal data
-- ============================================================
SELECT pg_temp.expect_error('stats: a site owner cannot read platform statistics',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT to_jsonb(count(*)) FROM hospitality.admin_site_stats()')$$, :'sp', :OWNER_P),
  'רק מנהל הפלטפורמה');
SELECT pg_temp.expect_error('stats: an Ecommerce owner cannot read them',
  format($$SELECT pg_temp.call(NULL, %L, 'SELECT hospitality.admin_overview()')$$, :ECOM_OWNER), 'רק מנהל הפלטפורמה');
SELECT pg_temp.expect_error('stats: anon cannot call them',
  $$SELECT pg_temp.call(NULL, NULL, 'SELECT hospitality.admin_overview()')$$, 'permission denied');
SELECT pg_temp.expect_error('stats: the plan catalogue is platform-only too',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.admin_plans()')$$, :'sp', :OWNER_P), 'רק מנהל הפלטפורמה');
SELECT tests.check('stats: the platform admin sees every Hospitality site with plan, usage and booking counts',
  format($$SELECT s.plan = 'enterprise' AND s.subscription_active AND s.units_active = 8 AND s.bookings_upcoming = 1
             AND s.bookings_pending = 1 AND s.guests = 2 AND s.revenue_30d > 0 AND s.backend_enabled AND s.booking_enabled
          FROM pg_temp.as_platform('SELECT jsonb_agg(to_jsonb(x)) FROM hospitality.admin_site_stats() x') j,
               jsonb_to_recordset(j) AS s(tenant_id uuid, plan text, subscription_active boolean, units_active integer,
                 bookings_upcoming integer, bookings_pending integer, guests integer, revenue_30d numeric,
                 backend_enabled boolean, booking_enabled boolean)
         WHERE s.tenant_id = %L$$, :'sp'));
SELECT tests.check('stats: only Hospitality sites are listed (no Ecommerce stores)',
  $$SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.as_platform('SELECT jsonb_agg(to_jsonb(x)) FROM hospitality.admin_site_stats() x')) e
                        JOIN public.tenants t ON t.id = (e ->> 'tenant_id')::uuid WHERE t.site_type <> 'hospitality')$$);
SELECT tests.check('stats: no guest name, email or phone appears in the statistics',
  $$SELECT NOT EXISTS (
      SELECT 1 FROM hospitality.guests g,
             (SELECT pg_temp.as_platform('SELECT jsonb_agg(to_jsonb(x)) FROM hospitality.admin_site_stats() x')::text
                     || pg_temp.as_platform('SELECT hospitality.admin_overview()')::text AS out) o
       WHERE o.out LIKE '%' || g.email_normalized || '%' OR o.out LIKE '%' || g.phone_normalized || '%'
          OR o.out LIKE '%' || g.full_name || '%')$$);
SELECT tests.check('stats: the statistics columns are counts and plan data only',
  $$SELECT array_agg(column_name::text ORDER BY column_name::text) <@ ARRAY['tenant_id', 'slug', 'name', 'tenant_status', 'plan',
      'subscription_status', 'subscription_active', 'trial_ends_at', 'units_active', 'units_limit', 'properties',
      'bookings_pending', 'bookings_upcoming', 'bookings_created_30d', 'nights_next_30d', 'revenue_30d', 'currency',
      'guests', 'last_booking_at', 'backend_enabled', 'booking_enabled']
      FROM (SELECT unnest(proargnames[1:]) AS column_name FROM pg_proc WHERE proname = 'admin_site_stats'
              AND pronamespace = 'hospitality'::regnamespace) x$$);
SELECT tests.check('stats: the overview adds up the per-site figures',
  $$SELECT (o ->> 'sites')::integer >= 2 AND (o ->> 'units_active')::integer >= 9 AND o ? 'sites_by_plan'
      FROM (SELECT pg_temp.as_platform('SELECT hospitality.admin_overview()') AS o) x$$);

-- ============================================================
-- 7. Policy versions and the terms accepted in a booking
-- ============================================================
SELECT tests.check('policy history: the starting policy of every site is recorded as version 1',
  format($$SELECT count(*) = 1 AND bool_and(version = 1 AND is_default) FROM hospitality.policy_versions WHERE tenant_id = %L$$, :'sp'));
CREATE TEMP TABLE he_terms AS
SELECT id, policy_snapshot, policy_acceptance, hospitality._hash(policy_snapshot) AS h
  FROM hospitality.bookings WHERE tenant_id = :'sp';
SELECT pg_temp.call(:'sp', NULL, format('SELECT hospitality.cancellation_quote(%L)', :'t1')) AS fee_before \gset
SELECT pg_temp.call(:'sp', :OWNER_P, $$WITH x AS (UPDATE hospitality.policies
   SET free_cancel_days = 30, fee_tiers = '[{"from_days": 30, "fee": "full"}]', auto_cancel = 'never' WHERE is_default RETURNING 1)
   SELECT to_jsonb(count(*)) FROM x$$) IS NOT NULL AS ok \gset
SELECT tests.check('policy history: editing the rules records version 2 with the actor',
  format($$SELECT count(*) = 2 AND max(version) = 2
             AND (SELECT changed_by = %L AND rules -> 'fee_tiers' -> 0 ->> 'fee' = 'full' FROM hospitality.policy_versions
                   WHERE tenant_id = %L AND version = 2)
          FROM hospitality.policy_versions WHERE tenant_id = %L$$, :OWNER_P, :'sp', :'sp'));
SELECT tests.check('policy edit: every existing booking keeps the exact snapshot (byte-identical hash) and acceptance',
  $$SELECT bool_and(hospitality._hash(b.policy_snapshot) = t.h AND b.policy_acceptance = t.policy_acceptance)
      FROM he_terms t JOIN hospitality.bookings b ON b.id = t.id$$);
SELECT tests.check('policy edit: … and the same cancellation fee as before the edit',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.cancellation_quote(%%L)', %L)) ->> 'fee' = %L::jsonb ->> 'fee'$$,
         :'sp', :'t1', :'fee_before'));
SELECT tests.check('policy history: each booking''s snapshot rules equal the recorded version they reference',
  $$SELECT bool_and(v.rules = b.policy_snapshot -> 'rules')
      FROM hospitality.bookings b
      JOIN hospitality.policy_versions v ON v.policy_id = (b.policy_snapshot ->> 'policy_id')::uuid
                                        AND v.version = (b.policy_snapshot ->> 'version')::integer$$);
SELECT tests.check('policy edit: a new quote uses the new version',
  format($$SELECT (pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(60), pg_temp.d(61)))
                   -> 'policy' ->> 'version')::integer = 2$$, :'sp', :U1));
-- several policies and the default
INSERT INTO hospitality.policies (id, tenant_id, name, free_cancel_days, fee_tiers) VALUES
  ('71e50000-0000-0000-0000-000000000001', :'sp', 'קיץ', 2, '[{"from_days": 2, "fee": "percent_total", "value": 30}]');
SELECT tests.check('policies: a second policy is recorded (version 1, not default) and quotes still use the default',
  format($$SELECT (SELECT NOT is_default FROM hospitality.policy_versions WHERE policy_id = '71e50000-0000-0000-0000-000000000001' AND version = 1)
             AND (pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(60), pg_temp.d(61)))
                   -> 'policy' ->> 'name') <> 'קיץ'$$, :'sp', :U1));
UPDATE hospitality.policies SET is_default = true WHERE id = '71e50000-0000-0000-0000-000000000001';
SELECT tests.check('policies: after switching the default, new quotes use it; old bookings keep theirs',
  format($$SELECT (pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(60), pg_temp.d(61)))
                   -> 'policy' ->> 'name') = 'קיץ'
             AND (SELECT bool_and(hospitality._hash(b.policy_snapshot) = t.h) FROM he_terms t JOIN hospitality.bookings b ON b.id = t.id)
             AND (SELECT count(*) FROM hospitality.policies WHERE tenant_id = %L AND is_default) = 1$$, :'sp', :U1, :'sp'));
-- the accepted terms of a booking cannot change, by anyone
SELECT pg_temp.expect_error('terms: the rules in a booking snapshot cannot be changed',
  format($$UPDATE hospitality.bookings SET policy_snapshot = jsonb_set(policy_snapshot, '{rules,auto_cancel}', '"always"') WHERE id = %L$$, :'b1'),
  'לא ניתנים לשינוי');
SELECT pg_temp.expect_error('terms: the policy version in a booking cannot be changed',
  format($$UPDATE hospitality.bookings SET policy_snapshot = jsonb_set(policy_snapshot, '{version}', '2') WHERE id = %L$$, :'b1'),
  'לא ניתנים לשינוי');
SELECT pg_temp.expect_error('terms: the guest''s acceptance cannot be rewritten',
  format($$UPDATE hospitality.bookings SET policy_acceptance = policy_acceptance || '{"snapshot_hash": "x"}' WHERE id = %L$$, :'b1'),
  'לא ניתנים לשינוי');
SELECT pg_temp.expect_error('terms: a booking cannot be moved to another policy',
  format($$UPDATE hospitality.bookings SET policy_id = '71e50000-0000-0000-0000-000000000001' WHERE id = %L$$, :'b1'),
  'לא ניתנים לשינוי');
SELECT tests.check('terms: only IP and browser may be removed (privacy)',
  format($$WITH x AS (UPDATE hospitality.bookings SET policy_acceptance = policy_acceptance - 'ip' - 'user_agent'
                      WHERE id = %L RETURNING 1) SELECT count(*) = 1 FROM x$$, :'b1'));
SELECT pg_temp.expect_error('policy history: versions cannot be edited',
  format($$UPDATE hospitality.policy_versions SET rules = '{}' WHERE tenant_id = %L$$, :'sp'), 'לא ניתנת לשינוי');
SELECT pg_temp.expect_error('policy history: versions cannot be deleted',
  format($$DELETE FROM hospitality.policy_versions WHERE tenant_id = %L$$, :'sp'), 'לא ניתנת לשינוי');
SELECT tests.check('policy history: the owner reads the history of their own site only',
  format($$SELECT (pg_temp.call(%L, %L, 'SELECT to_jsonb(count(*)) FROM hospitality.policy_versions'))::integer
                  = (SELECT count(*) FROM hospitality.policy_versions WHERE tenant_id = %L)
             AND (pg_temp.call(%L, %L, 'SELECT to_jsonb(count(*)) FROM hospitality.policy_versions'))::integer
                  = (SELECT count(*) FROM hospitality.policy_versions WHERE tenant_id = %L)$$,
         :'sp', :OWNER_P, :'sp', :'sq', :OWNER_Q, :'sq'));

-- ============================================================
-- 8. Owner email recipients (exact fallback rule)
-- ============================================================
UPDATE hospitality.settings SET contact_email = NULL WHERE tenant_id = :'sp';
SELECT tests.check('owner email: 3rd choice — the owner email set when the site was opened',
  format($$SELECT hospitality._owner_emails(%L) = ARRAY['owner.p@test.local']$$, :'sp'));
UPDATE hospitality.settings SET contact_email = 'office.p@test.local' WHERE tenant_id = :'sp';
SELECT tests.check('owner email: 2nd choice — the business contact email',
  format($$SELECT hospitality._owner_emails(%L) = ARRAY['office.p@test.local']$$, :'sp'));
UPDATE hospitality.settings SET notification_emails = ARRAY['desk.p@test.local', 'night.p@test.local'] WHERE tenant_id = :'sp';
SELECT tests.check('owner email: 1st choice — the notification recipients the business set',
  format($$SELECT ARRAY(SELECT unnest(hospitality._owner_emails(%L)) ORDER BY 1) = ARRAY['desk.p@test.local', 'night.p@test.local']$$, :'sp'));
SELECT tests.check('owner email: 4th choice — only when none of the above exist: the owner''s verified account email',
  format($$SELECT hospitality._owner_emails(%L) = ARRAY['owner.q@test.local']$$, :'sq'));
UPDATE auth.users SET email = 'owner.q.new@test.local' WHERE id = :OWNER_Q;
SELECT tests.check('owner email: the fallback follows the account''s current email',
  format($$SELECT hospitality._owner_emails(%L) = ARRAY['owner.q.new@test.local']$$, :'sq'));
UPDATE auth.users SET email_confirmed_at = NULL WHERE id = :OWNER_Q;
SELECT tests.check('owner email: an unverified account email is never used',
  format($$SELECT hospitality._owner_emails(%L) = '{}'::text[]$$, :'sq'));
UPDATE auth.users SET email_confirmed_at = now(), banned_until = now() + interval '1 day' WHERE id = :OWNER_Q;
SELECT tests.check('owner email: a banned account is never used',
  format($$SELECT hospitality._owner_emails(%L) = '{}'::text[]$$, :'sq'));
UPDATE auth.users SET banned_until = NULL WHERE id = :OWNER_Q;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  (:'sq', :MANAGER_P, 'manager.p@test.local', 'manager_p_q', 'admin', true);
SELECT tests.check('owner email: a manager (not the owner) of the site is never used',
  format($$SELECT NOT ('manager.p@test.local' = ANY (hospitality._owner_emails(%L)))$$, :'sq'));
-- the platform refuses to block a site's main owner; simulate that state directly (triggers off for one statement)
SET session_replication_role = replica;
UPDATE public.user_roles SET is_blocked = true WHERE tenant_id = :'sq' AND user_id = :OWNER_Q;
SET session_replication_role = DEFAULT;
SELECT tests.check('owner email: a blocked owner is never used',
  format($$SELECT hospitality._owner_emails(%L) = '{}'::text[]$$, :'sq'));
SET session_replication_role = replica;
UPDATE public.user_roles SET is_blocked = false WHERE tenant_id = :'sq' AND user_id = :OWNER_Q;
SET session_replication_role = DEFAULT;
SELECT tests.check('owner email: the platform admin and owners of other sites are never used',
  format($$SELECT NOT (ARRAY['platform@test.local', 'owner.p@test.local', 'owner.a@test.local'] && hospitality._owner_emails(%L))$$, :'sq'));
SELECT tests.check('owner email: an Ecommerce store has no Hospitality recipients',
  $$SELECT hospitality._owner_emails('70000000-0000-0000-0000-00000000000a') IS NULL$$);
SELECT tests.check('owner email: nothing is sent — rows are only queued in the outbox',
  $$SELECT NOT EXISTS (SELECT 1 FROM hospitality.notifications WHERE status <> 'queued')$$);

-- ============================================================
-- 9. Coupon usage — the current rule, pinned (see docs/hospitality/migrations.md)
-- ============================================================
INSERT INTO hospitality.promotions (tenant_id, name, code, discount_kind, value, usage_limit) VALUES
  (:'sp', 'קופון', 'ONCE', 'fixed', 50, 3);
SELECT pg_temp.req(:'sp', :U2, pg_temp.d(70), pg_temp.d(72), 'he.coupon1@example.com', 'he-cpn-0001', 'ONCE') ->> 'booking_id' AS bc1 \gset
SELECT pg_temp.req(:'sp', :U2, pg_temp.d(73), pg_temp.d(75), 'he.coupon2@example.com', 'he-cpn-0002', 'ONCE') ->> 'booking_id' AS bc2 \gset
SELECT pg_temp.call(:'sp', :OWNER_P, format('SELECT hospitality.decline_booking(%L)', :'bc1')) IS NOT NULL AS ok \gset
UPDATE hospitality.bookings SET hold_expires_at = now() - interval '1 second' WHERE id = :'bc2';
SELECT (hospitality.expire_holds() ->> 'expired')::integer AS expired \gset
SELECT tests.check('coupon (current rule): a use is counted when the request is made, and is NOT released when the request is declined or expires',
  format($$SELECT (SELECT used_count FROM hospitality.promotions WHERE tenant_id = %L AND code = 'ONCE') = 2
             AND (SELECT array_agg(status ORDER BY status) FROM hospitality.bookings WHERE id IN (%L, %L)) = ARRAY['declined', 'expired']$$,
         :'sp', :'bc1', :'bc2'));

-- ============================================================
-- 10. Ecommerce unchanged
-- ============================================================
SELECT tests.check('ecommerce: no new object in the public schema',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                         AND proname IN ('entitlements', 'admin_site_stats', 'admin_overview', 'admin_set_subscription', 'my_entitlements'))
       AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace
                         AND relname IN ('plans', 'subscriptions', 'policy_versions'))$$);
SELECT tests.check('ecommerce: store subscriptions are untouched by everything above',
  $$SELECT (SELECT count(*) FROM public.tenant_subscriptions) = subs
       AND (SELECT md5(string_agg(t::text, ',' ORDER BY t.tenant_id)) FROM public.tenant_subscriptions t) = subs_hash
      FROM he_ecom$$);

-- leave the platform flags as the migrations left them (other test files check the defaults)
SELECT pg_temp.as_platform($$SELECT to_jsonb(public.platform_set_flag('hospitality_backend_enabled', false)
                                    AND public.platform_set_flag('hospitality_booking_enabled', false))$$) IS NOT NULL AS ok \gset
UPDATE auth.users SET email = 'owner.q@test.local' WHERE id = :OWNER_Q;
DROP TABLE he_ecom;
DROP TABLE he_states;
DROP TABLE he_terms;

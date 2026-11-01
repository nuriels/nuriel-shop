-- ============================================================
-- Hospitality: prices, rate rules and cancellation policies (Stage 2f — 20261101210000_hosp_pricing.sql)
--   • no direct staff writes to rate_rules / policies; functions DEFINER, never anon
--   • unit prices (base, extra adult / child, minimum nights, floor / ceiling, policy) with the
--     revision; the server quote uses them at once
--   • rules: weekend, season (percent), holiday with its own policy, minimum nights; validation
--   • policies: create, edit with the version ("updated in the meantime"), history, default,
--     archive (units fall back to the default), live example = the booking engine's schedule
--   • outsiders refused; isolation; Ecommerce data unchanged
-- ============================================================
\set OWNER_A '''a0000000-0000-0000-0000-0000000009a1'''
\set MGR_A '''a0000000-0000-0000-0000-0000000009a2'''
\set OWNER_B '''a0000000-0000-0000-0000-0000000009b1'''
\set GUEST '''a0000000-0000-0000-0000-0000000009c1'''
\set SHOP_OWNER '''a0000000-0000-0000-0000-0000000009e1'''
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set SHOP '''72f00000-0000-0000-0000-0000000000e1'''

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
CREATE OR REPLACE FUNCTION pg_temp.expect_error(_name text, _sql text, _pattern text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE err text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
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
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
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
CREATE OR REPLACE FUNCTION pg_temp.add_role(_site uuid, _uid uuid, _name text, _role text DEFAULT 'admin') RETURNS jsonb LANGUAGE sql AS $f$
  INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
  VALUES (_site, _uid, _name || '@test.local', _name, _role, true) RETURNING to_jsonb(true);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.ecommerce_hash() RETURNS text LANGUAGE sql AS $f$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(ur::text, ',' ORDER BY ur.tenant_id, ur.user_id) FROM public.user_roles ur
       JOIN public.tenants t ON t.id = ur.tenant_id WHERE t.site_type = 'ecommerce'),
    (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s
       JOIN public.tenants t ON t.id = s.tenant_id WHERE t.site_type = 'ecommerce'),
    (SELECT string_agg(x::text, ',' ORDER BY x.tenant_id) FROM public.tenant_subscriptions x)));
$f$;
-- a hospitality call as somebody, on a site — returns the function's jsonb
CREATE OR REPLACE FUNCTION pg_temp.h(_site text, _uid uuid, _call text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, 'SELECT to_jsonb(hospitality.' || _call || ')');
$f$;
CREATE OR REPLACE FUNCTION pg_temp.h_sql(_site text, _uid uuid, _call text) RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT pg_temp.h(%L, %L, %L)', _site, _uid, _call);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.rev(_unit uuid) RETURNS integer LANGUAGE sql AS $f$
  SELECT revision FROM hospitality.units WHERE id = _unit;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.prev(_property uuid) RETURNS integer LANGUAGE sql AS $f$
  SELECT revision FROM hospitality.properties WHERE id = _property;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.last_audit(_site uuid, _action text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT to_jsonb(a) FROM hospitality.audit_log a WHERE tenant_id = _site AND action = _action ORDER BY id DESC LIMIT 1;
$f$;
-- the first date >= current_date + _n with the given weekday (0 = Sunday)
CREATE OR REPLACE FUNCTION pg_temp.dow(_n integer, _dow integer) RETURNS date LANGUAGE sql AS $$
  SELECT current_date + _n + ((_dow - extract(dow FROM current_date + _n)::integer + 7) % 7) $$;
CREATE OR REPLACE FUNCTION pg_temp.q(_site text, _uid uuid, _unit uuid, _in date, _out date, _a integer DEFAULT 2, _c integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, format('SELECT hospitality.quote(%L, %L, %L, %s, %s)', _unit, _in, _out, _a, _c));
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-0000000009a1', 'c2f.owner.a@test.local', now()),
  ('a0000000-0000-0000-0000-0000000009a2', 'c2f.mgr.a@test.local', now()),
  ('a0000000-0000-0000-0000-0000000009b1', 'c2f.owner.b@test.local', now()),
  ('a0000000-0000-0000-0000-0000000009c1', 'c2f.guest@test.local', now()),
  ('a0000000-0000-0000-0000-0000000009e1', 'c2f.shop.owner@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('c2f-a', 'אירוח מחירים A'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('c2f-b', 'אירוח מחירים B'))$$) IS NOT NULL AS ok \gset
SELECT id AS sa FROM public.tenants WHERE slug = 'c2f-a' \gset
SELECT id AS sb FROM public.tenants WHERE slug = 'c2f-b' \gset
SELECT pg_temp.add_role(:'sa', :OWNER_A, 'c2f_owner_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sa', :MGR_A, 'c2f_mgr_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sb', :OWNER_B, 'c2f_owner_b') IS NOT NULL AS ok \gset
UPDATE public.user_roles SET is_protected = true WHERE user_id IN (:OWNER_A, :OWNER_B);
INSERT INTO public.tenants (id, slug, name) VALUES (:SHOP, 'c2f-shop', 'חנות 2f');
SELECT pg_temp.add_role(:SHOP, :SHOP_OWNER, 'c2f_shop_owner') IS NOT NULL AS ok \gset
UPDATE public.user_roles SET is_protected = true WHERE user_id = :SHOP_OWNER;
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_booking_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_booking_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'sa', :'sb')) IS NOT NULL AS ok \gset
CREATE TEMP TABLE c2f_before AS SELECT pg_temp.ecommerce_hash() AS h;
SELECT pg_temp.h(:'sa', :OWNER_A, $$property_create('{"name": "חוות הזית", "property_type": "zimmer_complex", "status": "active"}')$$) ->> 'id' AS pa \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_create(%L, '{"name": "צימר הזית", "unit_type": "zimmer", "capacity": 4}')$$, :'pa')) ->> 'id' AS u1 \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_create(%L, '{"name": "צימר האלון", "unit_type": "zimmer", "capacity": 4}')$$, :'pa')) ->> 'id' AS u2 \gset
SELECT id AS pol_default FROM hospitality.policies WHERE tenant_id = :'sa' AND is_default \gset
-- a Sunday-to-Monday night is a weekday night (weekend = Thu / Fri nights by default)
SELECT pg_temp.dow(20, 0) AS sun \gset
SELECT pg_temp.dow(20, 4) AS thu \gset

-- ============================================================
-- 1. structure
-- ============================================================
SELECT tests.check('pricing: no direct INSERT / UPDATE / DELETE on rate_rules and policies; SELECT kept',
  $$SELECT bool_and(NOT has_table_privilege('authenticated', t, 'INSERT') AND NOT has_table_privilege('authenticated', t, 'UPDATE')
                    AND NOT has_table_privilege('authenticated', t, 'DELETE') AND has_table_privilege('authenticated', t, 'SELECT'))
      FROM unnest(ARRAY['hospitality.rate_rules', 'hospitality.policies']) t$$);
SELECT tests.check('pricing: every function is SECURITY DEFINER, authenticated only (never anon)',
  $$SELECT bool_and(p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
      FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace
       AND p.proname IN ('pricing_view', 'unit_prices_set', 'rate_rule_save', 'rate_rule_delete', 'policy_save',
                         'policy_set_default', 'policy_archive', 'policy_history', 'policy_preview', 'price_preview')
    HAVING count(*) = 10$$);

-- ============================================================
-- 2. unit prices
-- ============================================================
SELECT pg_temp.after('prices: the manager sets base price, extras, minimum nights — the quote uses them at once',
  pg_temp.h_sql(:'sa', :MGR_A, format($$unit_prices_set(%L, '{"base_price": 650, "extra_adult_price": 120, "extra_child_price": 60, "min_nights": 2}', %s)$$,
    :'u1', (SELECT revision FROM hospitality.units WHERE id = :'u1'))),
  format($$SELECT (pg_temp.q(%1$L, %2$L, %3$L, %4$L::date, %4$L::date + 2, 3, 1) ->> 'subtotal')::numeric = 2 * (650 + 120 + 60)
             AND (pg_temp.q(%1$L, %2$L, %3$L, %4$L::date, %4$L::date + 2) ->> 'min_nights')::integer = 2
             AND (SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = %1$L AND action = 'pricing.unit_prices') = 1$$,
         :'sa', :OWNER_A, :'u1', :'sun'));
SELECT pg_temp.expect_error('prices: a stale revision is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_prices_set(%L, '{"base_price": 1}', 1)$$, :'u1')), 'עודכנה בינתיים');
SELECT pg_temp.expect_error('prices: a negative price is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_prices_set(%L, '{"base_price": -5}', %s)$$, :'u1', (SELECT revision FROM hospitality.units WHERE id = :'u1'))), 'מחיר ללילה');
SELECT pg_temp.expect_error('prices: three decimals are refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_prices_set(%L, '{"base_price": 10.555}', %s)$$, :'u1', (SELECT revision FROM hospitality.units WHERE id = :'u1'))), 'שתי ספרות');
SELECT pg_temp.expect_error('prices: floor above ceiling is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_prices_set(%L, '{"price_floor": 900, "price_ceiling": 500}', %s)$$, :'u1', (SELECT revision FROM hospitality.units WHERE id = :'u1'))), 'המינימלי');
SELECT pg_temp.expect_error('prices: minimum nights 0 is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_prices_set(%L, '{"min_nights": 0}', %s)$$, :'u1', (SELECT revision FROM hospitality.units WHERE id = :'u1'))), 'מינימום לילות');
SELECT pg_temp.expect_error('prices: another site''s policy is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_prices_set(%L, %L, %s)$$, :'u1',
    jsonb_build_object('policy_id', (SELECT id FROM hospitality.policies WHERE tenant_id = :'sb' LIMIT 1)),
    (SELECT revision FROM hospitality.units WHERE id = :'u1'))), 'מדיניות הביטול לא נמצאה');
SELECT pg_temp.expect_error('prices: unknown fields are refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_prices_set(%L, '{"capacity": 9}', %s)$$, :'u1', (SELECT revision FROM hospitality.units WHERE id = :'u1'))), 'שדה לא מוכר');
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_prices_set(%L, '{"base_price": 500}', %s)$$, :'u2', (SELECT revision FROM hospitality.units WHERE id = :'u2'))) IS NOT NULL AS ok \gset

-- ============================================================
-- 3. rate rules
-- ============================================================
SELECT pg_temp.h(:'sa', :MGR_A, $$rate_rule_save(NULL, '{"name": "סוף שבוע", "kind": "weekend", "value": 900}')$$) ->> 'id' AS r_weekend \gset
SELECT tests.check('rules: a weekend price for every unit — Thursday night costs the weekend price, Sunday the base',
  format($$SELECT (pg_temp.q(%1$L, %2$L, %3$L, %4$L::date, %4$L::date + 1) ->> 'subtotal')::numeric = 900
             AND (pg_temp.q(%1$L, %2$L, %3$L, %5$L::date, %5$L::date + 1) ->> 'subtotal')::numeric = 500$$,
         :'sa', :OWNER_A, :'u2', :'thu', :'sun'));
SELECT pg_temp.h(:'sa', :OWNER_A, format($$rate_rule_save(NULL, %L)$$, jsonb_build_object(
  'name', 'קיץ', 'kind', 'season', 'scope', jsonb_build_object('unit_id', :'u2'), 'date_from', :'sun', 'date_to', (:'sun'::date + 1),
  'price_mode', 'percent', 'value', 20, 'min_nights', 3))) ->> 'id' AS r_season \gset
SELECT tests.check('rules: a unit season (+20%) beats the weekend and the base; its minimum nights apply to guests',
  format($$SELECT (pg_temp.q(%1$L, %2$L, %3$L, %4$L::date, %4$L::date + 1) ->> 'subtotal')::numeric = 600
             AND (pg_temp.q(%1$L, %2$L, %3$L, %4$L::date, %4$L::date + 1) ->> 'min_nights')::integer = 3$$,
         :'sa', :OWNER_A, :'u2', :'sun'));
SELECT pg_temp.expect_error('rules: a guest cannot book fewer nights than the season minimum',
  format($$SELECT pg_temp.q(%L, NULL, %L, %L::date, %L::date + 1)$$, :'sa', :'u2', :'sun', :'sun'), 'לפחות 3 לילות');
SELECT pg_temp.h(:'sa', :OWNER_A, $$policy_save(NULL, '{"name": "חגים", "free_cancel_days": 30, "fee_tiers": [{"from_days": 30, "fee": "full"}]}', NULL)$$) ->> 'id' AS pol_holiday \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$rate_rule_save(NULL, %L)$$, jsonb_build_object(
  'name', 'פסח', 'kind', 'holiday', 'date_from', (:'thu'::date + 14), 'date_to', (:'thu'::date + 16),
  'price_mode', 'fixed', 'value', 1500, 'policy_id', :'pol_holiday', 'priority', 10))) ->> 'id' AS r_holiday \gset
SELECT tests.check('rules: a holiday has its own price and its own cancellation policy in the quote',
  format($$SELECT (q ->> 'subtotal')::numeric = 3000 AND q -> 'policy' ->> 'name' = 'חגים'
           FROM pg_temp.q(%L, %L, %L, %L::date + 14, %L::date + 16) q$$, :'sa', :OWNER_A, :'u1', :'thu', :'thu'));
SELECT pg_temp.expect_error('rules: a season needs dates',
  pg_temp.h_sql(:'sa', :OWNER_A, $$rate_rule_save(NULL, '{"name": "x", "kind": "season", "value": 10}')$$), 'לבחור תאריכים');
SELECT pg_temp.expect_error('rules: "to" must be after "from"',
  pg_temp.h_sql(:'sa', :OWNER_A, $$rate_rule_save(NULL, '{"name": "x", "kind": "season", "value": 10, "date_from": "2027-05-10", "date_to": "2027-05-10"}')$$), 'חייב להיות אחרי');
SELECT pg_temp.expect_error('rules: one rule covers at most a year',
  pg_temp.h_sql(:'sa', :OWNER_A, $$rate_rule_save(NULL, '{"name": "x", "kind": "season", "value": 10, "date_from": "2027-01-01", "date_to": "2028-06-01"}')$$), 'עד שנה');
SELECT pg_temp.expect_error('rules: a percent change outside -90..500 is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, $$rate_rule_save(NULL, '{"name": "x", "kind": "weekend", "price_mode": "percent", "value": 900}')$$), 'באחוזים');
SELECT pg_temp.expect_error('rules: a special policy only for a season / holiday',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$rate_rule_save(NULL, %L)$$, jsonb_build_object('name', 'x', 'kind', 'weekend', 'value', 1, 'policy_id', :'pol_holiday'))), 'רק לעונה או לחג');
SELECT pg_temp.expect_error('rules: another site''s unit is refused',
  pg_temp.h_sql(:'sb', :OWNER_B, format($$rate_rule_save(NULL, %L)$$, jsonb_build_object('name', 'x', 'kind', 'weekend', 'value', 1, 'scope', jsonb_build_object('unit_id', :'u1')))), 'היחידה לא נמצאה');
SELECT pg_temp.after('rules: switching a rule off — the weekend price stops applying',
  pg_temp.h_sql(:'sa', :MGR_A, format($$rate_rule_save(%L, '{"is_active": false}')$$, :'r_weekend')),
  format($$SELECT (pg_temp.q(%L, %L, %L, %L::date, %L::date + 1) ->> 'subtotal')::numeric = 500$$, :'sa', :OWNER_A, :'u2', :'thu', :'thu'));
SELECT pg_temp.after('rules: delete; logged',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$rate_rule_delete(%L)$$, :'r_weekend')),
  format($$SELECT NOT EXISTS (SELECT 1 FROM hospitality.rate_rules WHERE id = %L)
             AND (SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = %L AND action LIKE 'pricing.rule_%%') = 5$$, :'r_weekend', :'sa'));

-- ============================================================
-- 4. cancellation policies
-- ============================================================
SELECT pg_temp.h(:'sa', :OWNER_A, $$policy_save(NULL, '{"name": "קפדנית", "free_cancel_days": 14, "fee_tiers": [{"from_days": 14, "fee": "percent_total", "value": 50}, {"from_days": 7, "fee": "full"}], "guest_text": "ביטול עד 14 יום — ללא עלות"}', NULL)$$) AS strict_json \gset
SELECT (:'strict_json'::jsonb) ->> 'id' AS pol_strict \gset
SELECT tests.check('policy: created, version 1, not the default; recorded in the history',
  format($$SELECT p.version = 1 AND NOT p.is_default
             AND (SELECT count(*) FROM hospitality.policy_versions v WHERE v.policy_id = p.id) = 1
           FROM hospitality.policies p WHERE p.id = %L$$, :'pol_strict'));
SELECT pg_temp.after('policy: an edit with the loaded version bumps the version; history has both',
  pg_temp.h_sql(:'sa', :MGR_A, format($$policy_save(%L, '{"free_cancel_days": 21, "fee_tiers": [{"from_days": 21, "fee": "percent_total", "value": 50}, {"from_days": 7, "fee": "full"}]}', 1)$$, :'pol_strict')),
  format($$SELECT ($1 ->> 'version')::integer = 2
             AND jsonb_array_length(pg_temp.h(%L, %L, format('policy_history(%%L)', %L))) = 2$$, :'sa', :OWNER_A, :'pol_strict'));
SELECT pg_temp.expect_error('policy: a stale version is refused ("updated in the meantime")',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$policy_save(%L, '{"free_cancel_days": 3}', 1)$$, :'pol_strict')), 'עודכנה בינתיים');
SELECT pg_temp.expect_error('policy: tiers out of order are refused (the existing database rule)',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$policy_save(%L, '{"fee_tiers": [{"from_days": 3, "fee": "full"}, {"from_days": 10, "fee": "full"}]}', 2)$$, :'pol_strict')), 'מסודרות');
SELECT pg_temp.expect_error('policy: a deposit over 100% is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, $$policy_save(NULL, '{"name": "x", "deposit_kind": "percent", "deposit_value": 120}', NULL)$$), 'עד 100');
SELECT pg_temp.expect_error('policy: house rules are not part of the policy (2d)',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$policy_save(%L, '{"house_rules": "x"}', 2)$$, :'pol_strict')), 'שדה לא מוכר');
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_prices_set(%L, %L, %s)$$, :'u2', jsonb_build_object('policy_id', :'pol_strict'),
                                         (SELECT revision FROM hospitality.units WHERE id = :'u2'))) IS NOT NULL AS ok \gset
SELECT tests.check('policy: a unit with its own policy quotes with it',
  format($$SELECT pg_temp.q(%L, %L, %L, %L::date + 7, %L::date + 8) -> 'policy' ->> 'name' = 'קפדנית'$$, :'sa', :OWNER_A, :'u2', :'sun', :'sun'));
SELECT pg_temp.after('policy: the live example is the booking engine''s own schedule',
  format($$SELECT pg_temp.h(%L, %L, format('policy_preview(%%L, 1000, %%L)', (SELECT hospitality._policy_rules(p) FROM hospitality.policies p WHERE p.id = %L), %L::date + 30))$$,
         :'sa', :MGR_A, :'pol_strict', :'sun'),
  format($$SELECT $1 -> 'schedule' -> 'periods' = (SELECT hospitality.policy_schedule(hospitality._policy_rules(p), %L::date + 30, s.timezone, s.check_in_time, 1000, 0) -> 'periods'
                                                       FROM hospitality.policies p, hospitality.settings s WHERE p.id = %L AND s.tenant_id = %L)
             AND jsonb_array_length($1 -> 'schedule' -> 'periods') = 3 AND ($1 -> 'schedule' -> 'periods' -> 0 ->> 'fee')::numeric = 0
             AND ($1 -> 'schedule' -> 'periods' -> 2 ->> 'fee')::numeric = 1000$$, :'sun', :'pol_strict', :'sa'));
SELECT pg_temp.expect_error('policy: the default cannot be archived',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$policy_archive(%L)$$, :'pol_default')), 'ברירת המחדל');
SELECT pg_temp.after('policy: another one becomes the default — exactly one default',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$policy_set_default(%L)$$, :'pol_strict')),
  format($$SELECT (SELECT count(*) FROM hospitality.policies WHERE tenant_id = %L AND is_default) = 1
             AND (SELECT is_default FROM hospitality.policies WHERE id = %L)$$, :'sa', :'pol_strict'));
SELECT pg_temp.after('policy: archiving the holiday policy — rules lose it; existing bookings keep their snapshot',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$policy_archive(%L)$$, :'pol_holiday')),
  format($$SELECT (SELECT is_archived FROM hospitality.policies WHERE id = %L)
             AND (SELECT policy_id IS NULL FROM hospitality.rate_rules WHERE id = %L)$$, :'pol_holiday', :'r_holiday'));
SELECT pg_temp.expect_error('policy: an archived policy is not edited',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$policy_save(%L, '{"name": "x"}', 1)$$, :'pol_holiday')), 'בארכיון');

-- ============================================================
-- 5. reading, outsiders, isolation
-- ============================================================
SELECT pg_temp.after('view: units with prices, rules and policies; the manager may edit policies too',
  pg_temp.h_sql(:'sa', :MGR_A, 'pricing_view()'),
  $$SELECT jsonb_array_length($1 -> 'units') = 2 AND jsonb_array_length($1 -> 'rules') = 2
       AND jsonb_array_length($1 -> 'policies') = 3 AND ($1 ->> 'can_policies')::boolean AND $1 ->> 'currency' = 'ILS'
       AND NOT ($1 -> 'policies' -> 0 -> 'rules' ? 'house_rules')$$);
SELECT pg_temp.expect_error('outsiders: site B''s owner cannot read A''s prices through A',
  pg_temp.h_sql(:'sa', :OWNER_B, 'pricing_view()'), 'אין הרשאה');
SELECT pg_temp.expect_error('outsiders: through its own site, B does not find A''s unit',
  pg_temp.h_sql(:'sb', :OWNER_B, format($$unit_prices_set(%L, '{"base_price": 1}', 1)$$, :'u1')), 'היחידה לא נמצאה');
SELECT pg_temp.expect_error('outsiders: B does not find A''s rule',
  pg_temp.h_sql(:'sb', :OWNER_B, format($$rate_rule_delete(%L)$$, :'r_season')), 'הכלל לא נמצא');
SELECT pg_temp.expect_error('outsiders: B does not find A''s policy',
  pg_temp.h_sql(:'sb', :OWNER_B, format($$policy_set_default(%L)$$, :'pol_default')), 'לא נמצאה');
SELECT pg_temp.after('preview: staff price preview = the booking engine''s quote (also while bookings are closed)',
  pg_temp.h_sql(:'sa', :MGR_A, format($$price_preview(%L, %L::date, %L::date + 2, 3, 0)$$, :'u1', :'sun', :'sun')),
  format($$SELECT $1 -> 'nights' = pg_temp.q(%L, %L, %L, %L::date, %L::date + 2, 3, 0) -> 'nights'$$, :'sa', :OWNER_A, :'u1', :'sun', :'sun'));
SELECT pg_temp.expect_error('outsiders: B cannot preview A''s unit (through A: no permission)',
  pg_temp.h_sql(:'sa', :OWNER_B, format($$price_preview(%L, current_date + 5, current_date + 6, 2, 0)$$, :'u1')), 'אין הרשאה');
SELECT pg_temp.expect_error('outsiders: B cannot preview A''s unit (through B: not found)',
  pg_temp.h_sql(:'sb', :OWNER_B, format($$price_preview(%L, current_date + 5, current_date + 6, 2, 0)$$, :'u1')), 'היחידה לא נמצאה');
SELECT pg_temp.expect_error('outsiders: a signed-in guest cannot read prices',
  pg_temp.h_sql(:'sa', :GUEST, 'pricing_view()'), 'אין הרשאה');
SELECT pg_temp.expect_error('outsiders: anonymous callers cannot change prices',
  pg_temp.h_sql(:'sa', NULL, format($$unit_prices_set(%L, '{"base_price": 1}', 1)$$, :'u1')), 'permission denied');
SELECT pg_temp.expect_error('outsiders: a store owner cannot use the pricing functions',
  pg_temp.h_sql(:SHOP, :SHOP_OWNER, 'pricing_view()'), 'אין הרשאה');
SELECT pg_temp.expect_error('direct write: staff cannot change rate rules directly',
  format($$SELECT pg_temp.call(%L, %L, 'UPDATE hospitality.rate_rules SET value = 1 RETURNING to_jsonb(true)')$$, :'sa', :OWNER_A),
  'permission denied');
SELECT tests.check('isolation: site B''s policies and prices untouched',
  format($$SELECT (SELECT count(*) FROM hospitality.policies WHERE tenant_id = %1$L) = 1
             AND NOT EXISTS (SELECT 1 FROM hospitality.rate_rules WHERE tenant_id = %1$L)$$, :'sb'));
SELECT tests.check('ecommerce: store data unchanged',
  $$SELECT pg_temp.ecommerce_hash() = (SELECT h FROM c2f_before)$$);

-- ---------- cleanup ----------
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_delete_tenant(%1$L, 'c2f-a'), public.platform_delete_tenant(%2$L, 'c2f-b')])$$, :'sa', :'sb')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_management_enabled', false),
                                    public.platform_set_flag('hospitality_booking_enabled', false)])$$) IS NOT NULL AS ok \gset
DROP TABLE c2f_before;

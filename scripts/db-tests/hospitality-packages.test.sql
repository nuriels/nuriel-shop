-- ============================================================
-- Hospitality — packages (stage A item 7, migration 59 — 20261108140000_hosp_packages.sql)
--   • structure: the table closed to the API roles (RLS, restrictive, tenant guard); who may call what;
--   • staff (catalog): create (hidden until shown), validation, images only from this business's galleries
--     (not the logo), show / hide, a stale revision, delete only without bookings, the action log; a visitor
--     and another business refused;
--   • the site: only shown packages of an active unit, not after their period; the images filtered;
--   • quote: the package's price and nights (not the rates, not the unit's minimum nights), the deposit on
--     the package price, up to the package's guests, its period, open dates, a past date;
--   • request: a booking on the unit with the package (snapshot, the price split over the nights), the
--     emails with the package name, the same request again, changed terms;
--   • no double booking: the same package again, a regular booking over a package, a package over a
--     regular booking — refused; the quote says "not available";
--   • the staff booking page and the guest's page show the package.
-- (The test harness opens units created by tests — tests.open_new_units.)
-- ============================================================
\set OWNER59 '''a0000000-0000-0000-0000-000000059a01'''
\set OTHER59 '''a0000000-0000-0000-0000-000000059a02'''

CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$ SELECT current_date + _n $$;
CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site, 'user-agent', 'db-test',
                                                          'x-forwarded-for', '203.0.113.59')::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), true);
  EXECUTE 'SET LOCAL ROLE ' || CASE WHEN _uid IS NULL THEN 'anon' ELSE 'authenticated' END;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.err_of(_site text, _uid uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.call(_site, _uid, _sql);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN SQLERRM;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.srv(_site text, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site, 'user-agent', 'db-test',
                                                          'x-forwarded-for', '203.0.113.59')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE service_role;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.srv_err(_site text, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.srv(_site, _sql);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  RETURN SQLERRM;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
-- package_save with the fields the screen sends (named — the order of the optional ones does not matter)
CREATE OR REPLACE FUNCTION pg_temp.save_sql(_id text, _unit text, _name text, _nights integer, _price numeric,
                                            _guests integer, _extra text DEFAULT '') RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT hospitality.package_save(_id => %L, _unit_id => %L, _kind => %L, _name => %L, _nights => %s,
                   _price => %s, _max_guests => %s%s)',
                _id, _unit, 'special', _name, _nights, _price, _guests, CASE WHEN _extra = '' THEN '' ELSE ', ' || _extra END);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.quote_sql(_pkg text, _in date, _adults integer DEFAULT 2, _children integer DEFAULT 0)
RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT hospitality.package_quote(%L, %L, %s, %s)', _pkg, _in, _adults, _children);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.req_sql(_pkg text, _in date, _email text, _key text, _hash text,
                                           _adults integer DEFAULT 2) RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT hospitality.request_booking_package(_package_id => %L, _check_in => %L, _full_name => %L,
                   _email => %L, _phone => %L, _idempotency_key => %L, _policy_accepted => true, _policy_hash => %L,
                   _adults => %s)',
                _pkg, _in, 'כלה מאושרת', _email, '0542630459', _key, _hash, _adults);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.mails(_site uuid, _event text) RETURNS bigint LANGUAGE sql AS $f$
  SELECT count(*) FROM hospitality.notifications WHERE tenant_id = _site AND event = _event;
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000059a01', 'm59.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000059a02', 'm59.other@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE m59_flags AS
  SELECT key, enabled FROM public.platform_feature_flags WHERE key LIKE 'hospitality%';
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m59-packages', 'נופי החבילות', 'm59.owner@test.local')$$) ->> 'id' AS st \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm59.owner@test.local')$$, :'st')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m59-other', 'אתר שכן', 'm59.other@test.local')$$) ->> 'id' AS so \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm59.other@test.local')$$, :'so')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_frontend_enabled', true),
       public.platform_set_flag('hospitality_booking_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_frontend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_booking_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L),
       public.platform_set_flag('hospitality_frontend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_booking_enabled', true, %2$L)])$$, :'st', :'so')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER59,
  $q$SELECT hospitality.property_create('{"name": "נופי החבילות", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS sp \gset
SELECT pg_temp.call(:'st', :OWNER59, format($q$SELECT hospitality.unit_create(%L, '{"name": "סוויטת VIP", "unit_type": "suite", "capacity": 4}')$q$, :'sp')) ->> 'id' AS uv \gset
SELECT pg_temp.call(:'st', :OWNER59, format($q$SELECT hospitality.unit_create(%L, '{"name": "צימר הגפן", "unit_type": "suite", "capacity": 2}')$q$, :'sp')) ->> 'id' AS ug \gset
SELECT pg_temp.call(:'so', :OTHER59,
  $q$SELECT hospitality.property_create('{"name": "אתר שכן", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS op \gset
SELECT pg_temp.call(:'so', :OTHER59, format($q$SELECT hospitality.unit_create(%L, '{"name": "יחידה שכנה", "unit_type": "suite", "capacity": 4}')$q$, :'op')) ->> 'id' AS uo \gset
-- the rates say 500 a night, and at least 3 nights — the package sets its own price and nights
UPDATE hospitality.units SET base_price = 500 WHERE tenant_id = :'st';
UPDATE hospitality.units SET min_nights = 3 WHERE id = :'uv';
INSERT INTO hospitality.media (id, tenant_id, owner_kind, unit_id, kind, storage_path) VALUES
  ('00000000-0000-4000-8059-000000000001', :'st', 'unit', :'uv', 'image', :'st' || '/00000000-0000-4000-8059-000000000001.webp'),
  ('00000000-0000-4000-8059-000000000002', :'st', 'unit', :'uv', 'image', :'st' || '/00000000-0000-4000-8059-000000000002.webp'),
  ('00000000-0000-4000-8059-000000000004', :'so', 'unit', :'uo', 'image', :'so' || '/00000000-0000-4000-8059-000000000004.webp');
INSERT INTO hospitality.media (id, tenant_id, owner_kind, kind, storage_path) VALUES
  ('00000000-0000-4000-8059-000000000003', :'st', 'brand', 'image', :'st' || '/00000000-0000-4000-8059-000000000003.webp');
-- the package's own cancellation policy: half the price as a deposit
INSERT INTO hospitality.policies (tenant_id, name, deposit_kind, deposit_value, free_cancel_days)
VALUES (:'st', 'חבילות — מקדמה 50%', 'percent', 50, 30) RETURNING id AS pol \gset

-- ============================================================
-- 1. Structure
-- ============================================================
SELECT tests.check('structure: the packages table — RLS with the two restrictive policies, the tenant guard, no access for the API roles',
  $$SELECT c.relrowsecurity
       AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND NOT p.polpermissive
             AND p.polname IN ('tenant_isolation', 'backend_enabled')) = 2
       AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polpermissive)
       AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'tenant_guard')
       AND NOT bool_or(has_table_privilege(r, c.oid, p))
     FROM pg_class c, unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
          unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
    WHERE c.oid = 'hospitality.packages'::regclass
    GROUP BY c.oid, c.relrowsecurity$$);
SELECT tests.check('structure: the site list for everyone; quote and request for the app server only; the management functions for staff only',
  $$SELECT has_function_privilege('anon', 'hospitality.public_packages()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.package_quote(uuid, date, integer, integer)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.package_quote(uuid, date, integer, integer)', 'EXECUTE')
       AND has_function_privilege('service_role', 'hospitality.package_quote(uuid, date, integer, integer)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.request_booking_package(uuid, date, text, text, text, text, boolean, text, integer, integer, text, boolean, text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.request_booking_package(uuid, date, text, text, text, text, boolean, text, integer, integer, text, boolean, text)', 'EXECUTE')
       AND has_function_privilege('service_role', 'hospitality.request_booking_package(uuid, date, text, text, text, text, boolean, text, integer, integer, text, boolean, text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.packages_view()', 'EXECUTE')
       AND has_function_privilege('authenticated', 'hospitality.packages_view()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.package_delete(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._package_quote(uuid, uuid, date, integer, integer)', 'EXECUTE')$$);
SELECT tests.check('structure: every booking so far is a regular booking (no package, no snapshot)',
  $$SELECT NOT EXISTS (SELECT 1 FROM hospitality.bookings WHERE package_id IS NOT NULL OR package_snapshot IS NOT NULL)$$);

-- ============================================================
-- 2. Staff: create, validate, show / hide
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER59, pg_temp.save_sql(NULL, :'uv', 'חבילת כלה – שני לילות ב-VIP', 2, 2400, 2,
  format('_description => %L, _terms => %L, _policy_id => %L, _media_ids => ARRAY[%L, %L]::uuid[]',
         'שני לילות בסוויטה עם עיצוב חדר, בקבוק יין וארוחת בוקר', 'לא כולל ארוחות ערב. לא ניתן לשלב עם מבצעים אחרים.',
         :'pol', '00000000-0000-4000-8059-000000000002', '00000000-0000-4000-8059-000000000001'))) AS p1 \gset
SELECT (:'p1'::jsonb) ->> 'id' AS pk, ((:'p1'::jsonb) ->> 'revision')::integer AS pk_rev \gset
SELECT tests.check('staff: a new package — hidden until shown, its slug from the name, the images in the order chosen, the action log',
  format($$SELECT (%1$L::jsonb ->> 'is_active')::boolean = false
             AND %1$L::jsonb ->> 'slug' = 'חבילת-כלה-שני-לילות-ב-vip'
             AND %1$L::jsonb ->> 'kind' = 'special' AND (%1$L::jsonb ->> 'nights')::integer = 2
             AND (%1$L::jsonb ->> 'price')::numeric = 2400 AND %1$L::jsonb ->> 'unit_name' = 'סוויטת VIP'
             AND %1$L::jsonb -> 'media_ids' = '["00000000-0000-4000-8059-000000000002", "00000000-0000-4000-8059-000000000001"]'::jsonb
             AND %1$L::jsonb -> 'policy' IS NOT NULL
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %2$L AND a.action = 'packages.created'
                            AND a.target_label = 'חבילת כלה – שני לילות ב-VIP')$$,
         :'p1', :'st'));
SELECT tests.check('staff: refused — a short name, 0 / 15 nights, no price, more guests than the unit holds, a period shorter than the nights, a bad kind',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, 'א', 2, 100, 2)) LIKE 'שם החבילה%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, 'חבילה', 0, 100, 2)) LIKE 'מספר הלילות%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, 'חבילה', 15, 100, 2)) LIKE 'מספר הלילות%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, 'חבילה', 2, 0, 2)) LIKE 'מחיר החבילה%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, 'חבילה', 2, 100, 5)) LIKE 'מספר האורחים בחבילה%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, 'חבילה', 3, 100, 2,
                   format('_stay_from => %%L, _stay_to => %%L', pg_temp.d(10), pg_temp.d(12)))) LIKE 'התקופה של החבילה%%'
             AND pg_temp.err_of(%1$L, %2$L, replace(pg_temp.save_sql(NULL, %3$L, 'חבילה', 2, 100, 2), '''special''', '''vip''')) LIKE 'סוג החבילה%%'$$,
         :'st', :OWNER59, :'uv'));
SELECT tests.check('staff: images only from this business''s galleries — not the logo, not another business''s photo, not twice',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, 'חבילה', 2, 100, 2,
                   '_media_ids => ARRAY[''00000000-0000-4000-8059-000000000003'']::uuid[]')) LIKE 'אפשר לבחור רק תמונות%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, 'חבילה', 2, 100, 2,
                   '_media_ids => ARRAY[''00000000-0000-4000-8059-000000000004'']::uuid[]')) LIKE 'אפשר לבחור רק תמונות%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, 'חבילה', 2, 100, 2,
                   '_media_ids => ARRAY[''00000000-0000-4000-8059-000000000001'', ''00000000-0000-4000-8059-000000000001'']::uuid[]')) LIKE 'כל תמונה%%'$$,
         :'st', :OWNER59, :'uv'));
SELECT tests.check('staff: another business''s unit, a visitor and another business''s owner — refused; that owner does not see the package',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, 'חבילה', 2, 100, 2)) LIKE 'היחידה לא נמצאה%%'
             AND pg_temp.err_of(%1$L, NULL, 'SELECT hospitality.packages_view()') IS NOT NULL
             AND pg_temp.err_of(%1$L, %4$L, 'SELECT hospitality.packages_view()') IS NOT NULL
             AND jsonb_array_length(pg_temp.call(%5$L, %4$L, 'SELECT hospitality.packages_view()') -> 'packages') = 0
             AND pg_temp.err_of(%5$L, %4$L, format('SELECT hospitality.package_set_active(%%L, true)', %6$L)) LIKE 'החבילה לא נמצאה%%'$$,
         :'st', :OWNER59, :'uo', :OTHER59, :'so', :'pk'));
SELECT tests.check('site: a hidden package is not on the site',
  format($$SELECT pg_temp.call(%L, NULL, 'SELECT hospitality.public_packages()') = '[]'::jsonb$$, :'st'));
SELECT pg_temp.call(:'st', :OWNER59, format('SELECT hospitality.package_set_active(%L, true)', :'pk')) ->> 'revision' AS pk_rev2 \gset
SELECT tests.check('staff: shown — on the site with its price, nights, guests, terms, the unit and the two images; the action log',
  format($$SELECT jsonb_array_length(l) = 1 AND l -> 0 ->> 'id' = %2$L AND (l -> 0 ->> 'price')::numeric = 2400
             AND (l -> 0 ->> 'nights')::integer = 2 AND (l -> 0 ->> 'max_guests')::integer = 2
             AND l -> 0 ->> 'unit_id' = %3$L AND jsonb_array_length(l -> 0 -> 'media_ids') = 2
             AND l -> 0 ->> 'terms' LIKE 'לא כולל ארוחות ערב%%'
             AND NOT (l -> 0) ? 'is_active' AND NOT (l -> 0) ? 'bookings_count'
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %4$L AND a.action = 'packages.shown')
           FROM pg_temp.call(%1$L, NULL, 'SELECT hospitality.public_packages()') l$$,
         :'st', :'pk', :'uv', :'st'));
SELECT tests.check('staff: a stale revision is refused (someone else saved in between)',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(%3$L, %4$L, 'חבילת כלה – שני לילות ב-VIP', 2, 2400, 2,
                   format('_expected_revision => %%s', %5$s))) LIKE 'החבילה השתנתה בינתיים%%'$$,
         :'st', :OWNER59, :'pk', :'uv', :'pk_rev'));
SELECT tests.check('site: another business''s address does not show this package',
  format($$SELECT pg_temp.call(%L, NULL, 'SELECT hospitality.public_packages()') = '[]'::jsonb$$, :'so'));

-- ============================================================
-- 3. Quote
-- ============================================================
SELECT pg_temp.srv(:'st', pg_temp.quote_sql(:'pk', pg_temp.d(20))) AS q1 \gset
SELECT tests.check('quote: the package price (not 2 × 500 from the rates), 2 nights from the arrival — though the unit asks for 3 — and half as a deposit by the package''s policy',
  format($$SELECT (%1$L::jsonb ->> 'available')::boolean
             AND (%1$L::jsonb ->> 'total')::numeric = 2400 AND (%1$L::jsonb ->> 'subtotal')::numeric = 2400
             AND (%1$L::jsonb ->> 'discount')::numeric = 0
             AND (%1$L::jsonb ->> 'nights_count')::integer = 2
             AND (%1$L::jsonb ->> 'check_out')::date = %2$L::date
             AND (%1$L::jsonb ->> 'deposit_amount')::numeric = 1200
             AND %1$L::jsonb -> 'policy' ->> 'name' = 'חבילות — מקדמה 50%%'
             AND %1$L::jsonb -> 'package' ->> 'name' = 'חבילת כלה – שני לילות ב-VIP'
             AND NOT %1$L::jsonb ? 'nights' AND length(%1$L::jsonb ->> 'policy_hash') = 64$$,
         :'q1', pg_temp.d(22)));
SELECT tests.check('quote: refused — more guests than the package, a past date, a visitor straight through the API',
  format($$SELECT pg_temp.srv_err(%1$L, pg_temp.quote_sql(%2$L, pg_temp.d(20), 3)) LIKE 'החבילה מיועדת לעד 2 אורחים%%'
             AND pg_temp.srv_err(%1$L, pg_temp.quote_sql(%2$L, pg_temp.d(-1))) LIKE 'אי אפשר להזמין לתאריך שעבר%%'
             AND pg_temp.err_of(%1$L, NULL, pg_temp.quote_sql(%2$L, pg_temp.d(20))) IS NOT NULL$$,
         :'st', :'pk'));
UPDATE hospitality.units SET open_until = current_date + 40 WHERE id = :'uv';
SELECT tests.check('quote: after the dates the owner opened — not available',
  format($$SELECT NOT (pg_temp.srv(%1$L, pg_temp.quote_sql(%2$L, pg_temp.d(45))) ->> 'available')::boolean
             AND (pg_temp.srv(%1$L, pg_temp.quote_sql(%2$L, pg_temp.d(30))) ->> 'available')::boolean$$,
         :'st', :'pk'));
UPDATE hospitality.units SET open_until = current_date + 730 WHERE id = :'uv';

-- ============================================================
-- 4. Request
-- ============================================================
SELECT pg_temp.srv(:'st', pg_temp.req_sql(:'pk', pg_temp.d(20), 'bride@example.com', 'm59-pkg-one',
                                          (:'q1'::jsonb) ->> 'policy_hash')) AS r1 \gset
SELECT (:'r1'::jsonb) ->> 'booking_id' AS b1, (:'r1'::jsonb) ->> 'manage_token' AS t1 \gset
SELECT tests.check('request: a booking on the VIP suite for the 2 nights, waiting for approval, at the package price split over the nights — with the package as the guest saw it',
  format($$SELECT b.status = 'pending_approval' AND b.unit_id = %2$L AND b.check_in = %3$L::date AND b.check_out = %4$L::date
             AND b.total = 2400 AND b.subtotal = 2400 AND b.discount = 0 AND b.price_manual AND b.promotion_id IS NULL
             AND b.deposit_amount = 1200 AND b.package_id = %5$L
             AND b.package_snapshot ->> 'name' = 'חבילת כלה – שני לילות ב-VIP'
             AND (b.package_snapshot ->> 'price')::numeric = 2400 AND (b.package_snapshot ->> 'nights')::integer = 2
             AND b.package_snapshot ->> 'terms' LIKE 'לא כולל ארוחות ערב%%'
             AND b.policy_acceptance ->> 'package_id' = %5$L
             AND (SELECT count(*) = 2 AND sum(n.price) = 2400 FROM hospitality.booking_nights n WHERE n.booking_id = b.id)
           FROM hospitality.bookings b WHERE b.id = %1$L$$,
         :'b1', :'uv', pg_temp.d(20), pg_temp.d(22), :'pk'));
SELECT tests.check('request: one email to the business and one to the guest — both with the package name',
  format($$SELECT pg_temp.mails(%1$L, 'new_request') = 1 AND pg_temp.mails(%1$L, 'request_received') = 1
             AND (SELECT bool_and(n.payload ->> 'package_name' = 'חבילת כלה – שני לילות ב-VIP')
                    FROM hospitality.notifications n WHERE n.tenant_id = %1$L AND n.booking_id = %2$L)$$,
         :'st', :'b1'));
SELECT tests.check('request: the same request again — the same booking, no new link and no new emails',
  format($$SELECT r ->> 'booking_id' = %2$L AND (r ->> 'duplicate')::boolean AND r ->> 'manage_token' IS NULL
             AND pg_temp.mails(%1$L, 'new_request') = 1
           FROM pg_temp.srv(%1$L, pg_temp.req_sql(%3$L, pg_temp.d(20), 'bride@example.com', 'm59-pkg-one', %4$L)) r$$,
         :'st', :'b1', :'pk', (:'q1'::jsonb) ->> 'policy_hash'));

-- ============================================================
-- 5. No double booking of the unit
-- ============================================================
SELECT tests.check('double booking: the same package on overlapping nights — refused, nothing created; the quote says not available',
  format($$SELECT pg_temp.srv_err(%1$L, pg_temp.req_sql(%2$L, pg_temp.d(21), 'other.bride@example.com', 'm59-pkg-two',
                     pg_temp.srv(%1$L, pg_temp.quote_sql(%2$L, pg_temp.d(21))) ->> 'policy_hash')) LIKE 'התאריכים המבוקשים כבר לא פנויים%%'
             AND NOT (pg_temp.srv(%1$L, pg_temp.quote_sql(%2$L, pg_temp.d(21))) ->> 'available')::boolean
             AND (SELECT count(*) FROM hospitality.bookings WHERE tenant_id = %1$L AND package_id = %2$L) = 1$$,
         :'st', :'pk'));
SELECT tests.check('double booking: a regular booking of the VIP suite over the package nights — refused (the same occupancy)',
  format($$SELECT pg_temp.srv_err(%1$L, format('SELECT hospitality.request_booking(_unit_id => %%L, _check_in => %%L, _check_out => %%L,
                     _full_name => %%L, _email => %%L, _phone => %%L, _idempotency_key => %%L, _policy_accepted => true,
                     _policy_hash => %%L)', %2$L, %3$L, %4$L, 'אורח רגיל', 'regular@example.com', '0542630460', 'm59-regular-x',
                     pg_temp.call(%1$L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %2$L, %3$L, %4$L)) ->> 'policy_hash'))
                   LIKE 'התאריכים המבוקשים כבר לא פנויים%%'
             AND NOT (pg_temp.call(%1$L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %2$L, %3$L, %4$L)) ->> 'available')::boolean$$,
         :'st', :'uv', pg_temp.d(19), pg_temp.d(22)));
-- a regular booking first — then the package on the same nights
SELECT pg_temp.srv(:'st', format('SELECT hospitality.request_booking(_unit_id => %L, _check_in => %L, _check_out => %L,
         _full_name => %L, _email => %L, _phone => %L, _idempotency_key => %L, _policy_accepted => true, _policy_hash => %L)',
         :'uv', pg_temp.d(50), pg_temp.d(53), 'אורח רגיל', 'regular@example.com', '0542630460', 'm59-regular-one',
         pg_temp.call(:'st', NULL, format('SELECT hospitality.quote(%L, %L, %L)', :'uv', pg_temp.d(50), pg_temp.d(53))) ->> 'policy_hash')) ->> 'booking_id' AS breg \gset
SELECT tests.check('double booking: the package over a regular booking of the unit — not available and refused',
  format($$SELECT NOT (pg_temp.srv(%1$L, pg_temp.quote_sql(%2$L, pg_temp.d(52))) ->> 'available')::boolean
             AND pg_temp.srv_err(%1$L, pg_temp.req_sql(%2$L, pg_temp.d(52), 'late.bride@example.com', 'm59-pkg-three',
                     pg_temp.srv(%1$L, pg_temp.quote_sql(%2$L, pg_temp.d(52))) ->> 'policy_hash')) LIKE 'התאריכים המבוקשים כבר לא פנויים%%'
             AND %3$L IS NOT NULL$$,
         :'st', :'pk', :'breg'));
SELECT tests.check('double booking: the other unit is not affected — a regular booking of it on the package nights is fine',
  format($$SELECT (pg_temp.call(%1$L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %2$L, %3$L, %4$L)) ->> 'available')::boolean$$,
         :'st', :'ug', pg_temp.d(20), pg_temp.d(22)));

-- ============================================================
-- 6. Changed terms, the period, a hidden package
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER59, pg_temp.save_sql(:'pk', :'uv', 'חבילת כלה – שני לילות ב-VIP', 2, 2600, 2,
  format('_terms => %L, _policy_id => %L, _media_ids => ARRAY[%L]::uuid[], _stay_from => %L, _stay_to => %L',
         'לא כולל ארוחות ערב.', :'pol', '00000000-0000-4000-8059-000000000001', pg_temp.d(60), pg_temp.d(90)))) AS p2 \gset
SELECT tests.check('terms: after the owner raised the price — a request with the terms seen before is refused; the action log has the change',
  format($$SELECT pg_temp.srv_err(%1$L, pg_temp.req_sql(%2$L, pg_temp.d(70), 'slow.bride@example.com', 'm59-pkg-four', %3$L))
                   LIKE 'תנאי ההזמנה השתנו%%'
             AND (pg_temp.srv(%1$L, pg_temp.quote_sql(%2$L, pg_temp.d(70))) ->> 'total')::numeric = 2600
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %1$L AND a.action = 'packages.updated'
                            AND a.changes -> 'price' = '{"from": 2400, "to": 2600}'::jsonb)$$,
         :'st', :'pk', (:'q1'::jsonb) ->> 'policy_hash'));
SELECT tests.check('period: from day 60 to day 90 — an arrival before it, or a stay past its end, is refused; inside it is fine',
  format($$SELECT pg_temp.srv_err(%1$L, pg_temp.quote_sql(%2$L, pg_temp.d(59))) LIKE 'החבילה זמינה לשהייה%%'
             AND pg_temp.srv_err(%1$L, pg_temp.quote_sql(%2$L, pg_temp.d(89))) LIKE 'החבילה זמינה לשהייה%%'
             AND (pg_temp.srv(%1$L, pg_temp.quote_sql(%2$L, pg_temp.d(88))) ->> 'available')::boolean$$,
         :'st', :'pk'));
UPDATE hospitality.packages SET stay_from = current_date - 30, stay_to = current_date + 1 WHERE id = :'pk';
SELECT tests.check('site: a package whose period is over (no arrival left) is no longer on the site',
  format($$SELECT pg_temp.call(%L, NULL, 'SELECT hospitality.public_packages()') = '[]'::jsonb$$, :'st'));
UPDATE hospitality.packages SET stay_from = NULL, stay_to = NULL WHERE id = :'pk';
SELECT pg_temp.call(:'st', :OWNER59, format('SELECT hospitality.package_set_active(%L, false)', :'pk')) IS NOT NULL AS ok \gset
SELECT tests.check('hidden: off the site, and it cannot be quoted or requested',
  format($$SELECT pg_temp.call(%1$L, NULL, 'SELECT hospitality.public_packages()') = '[]'::jsonb
             AND pg_temp.srv_err(%1$L, pg_temp.quote_sql(%2$L, pg_temp.d(30))) LIKE 'החבילה לא נמצאה%%'
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %1$L AND a.action = 'packages.hidden')$$,
         :'st', :'pk'));
SELECT tests.check('another business''s address: the package is not found there',
  format($$SELECT pg_temp.srv_err(%1$L, pg_temp.quote_sql(%2$L, pg_temp.d(30))) LIKE 'החבילה לא נמצאה%%'$$, :'so', :'pk'));

-- ============================================================
-- 7. The staff booking page, the guest's page, delete
-- ============================================================
SELECT tests.check('the booking page (staff): the package — name, nights, price and terms as booked',
  format($$SELECT d -> 'package' ->> 'name' = 'חבילת כלה – שני לילות ב-VIP' AND (d -> 'package' ->> 'price')::numeric = 2400
             AND (d -> 'package' ->> 'nights')::integer = 2 AND d -> 'package' ->> 'terms' LIKE 'לא כולל ארוחות ערב%%'
           FROM pg_temp.call(%1$L, %2$L, format('SELECT hospitality.staff_booking_detail(%%L)', %3$L)) d$$,
         :'st', :OWNER59, :'b1'));
SELECT tests.check('the booking page (staff): a regular booking has no package',
  format($$SELECT d ? 'package' AND d -> 'package' = 'null'::jsonb
           FROM pg_temp.call(%1$L, %2$L, format('SELECT hospitality.staff_booking_detail(%%L)', %3$L)) d$$,
         :'st', :OWNER59, :'breg'));
SELECT tests.check('the guest''s page (secret link): the package name',
  format($$SELECT pg_temp.call(%1$L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', %2$L)) ->> 'package_name'
                  = 'חבילת כלה – שני לילות ב-VIP'$$,
         :'st', :'t1'));
SELECT tests.check('delete: a package with bookings is refused (hide it instead); the bookings keep the package',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format('SELECT to_jsonb(hospitality.package_delete(%%L))', %3$L)) LIKE 'לחבילה הזו יש הזמנות%%'
             AND EXISTS (SELECT 1 FROM hospitality.packages WHERE id = %3$L)$$,
         :'st', :OWNER59, :'pk'));
SELECT pg_temp.call(:'st', :OWNER59, pg_temp.save_sql(NULL, :'ug', 'חבילת סוף שבוע', 2, 1500, 2)) ->> 'id' AS pk2 \gset
SELECT pg_temp.call(:'st', :OWNER59, format('SELECT to_jsonb(hospitality.package_delete(%L))', :'pk2')) AS del \gset
SELECT tests.check('delete: a package without bookings is deleted; the action log has it',
  format($$SELECT %1$L::jsonb = 'true'::jsonb AND NOT EXISTS (SELECT 1 FROM hospitality.packages WHERE id = %2$L)
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %3$L AND a.action = 'packages.deleted'
                            AND a.target_label = 'חבילת סוף שבוע')$$,
         :'del', :'pk2', :'st'));

-- ---------- cleanup ----------
UPDATE public.platform_feature_flags f SET enabled = m.enabled FROM m59_flags m WHERE f.key = m.key;
DROP TABLE m59_flags;

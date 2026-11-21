-- ============================================================
-- Hospitality — add-on rooms for a package (migration 202 — 20261121100000_hosp_package_addon_rooms.sql)
--   The bridal package (docs/hospitality/bridal-package-spec.md, section 4): a "special" package on the VIP unit,
--   2 nights, 4,000; a companion / family room can be added for a fixed price a night, only when it is free.
--   • structure: who may call what; the new columns and their check;
--   • staff (catalog): save the add-on rooms with the package, validation (the package's own unit, "the whole
--     property", another business's unit, twice, the price, how many), an old app without the parameter keeps them,
--     an empty list clears them, the action log; another business refused;
--   • the site: the add-on rooms on the public package — only active units; the free rooms for the package's dates
--     (a booked room, a room closed for those dates — not listed); a unit's minimum nights do not apply;
--   • quote: no rooms = exactly the package's quote (same hash); with rooms — the total computed in the database,
--     the package's policy for every room (the deposit of each booking from its own total), one hash;
--   • request: the package and the rooms in one transaction (one group, the package price, 1,200 a night, the
--     snapshot "role": "addon"), one email to the business and one to the guest; the same request again; changed
--     terms; a room taken in between — nothing is saved; the package taken — nothing is saved;
--   • approve the whole group at once; the staff page, the guest's page, the package's counts; another business.
-- (The test harness opens units created by tests — tests.open_new_units.)
-- ============================================================
\set OWNER202 '''a0000000-0000-0000-0000-000000202a01'''
\set OTHER202 '''a0000000-0000-0000-0000-000000202a02'''

CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$ SELECT current_date + _n $$;
CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site, 'user-agent', 'db-test',
                                                          'x-forwarded-for', '203.0.113.202')::text, true);
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
                                                          'x-forwarded-for', '203.0.113.202')::text, true);
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
-- package_save as the screen sends it (named), with the add-on rooms as jsonb (or without — as the old app)
CREATE OR REPLACE FUNCTION pg_temp.save_sql(_id text, _unit text, _extra text DEFAULT '') RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT hospitality.package_save(_id => %L, _unit_id => %L, _kind => %L, _name => %L, _nights => 2,
                   _price => 4000, _max_guests => 2%s)',
                _id, _unit, 'special', 'חבילת כלה – VIP', CASE WHEN _extra = '' THEN '' ELSE ', ' || _extra END);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.addons(_units text[], _price text, _max integer) RETURNS text LANGUAGE sql AS $f$
  SELECT format('_addons => %L::jsonb',
                jsonb_build_object('unit_ids', to_jsonb(_units), 'nightly_price', _price::jsonb, 'max', _max));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.rooms(_units text[], _adults integer DEFAULT 2) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('unit_id', u, 'adults', _adults, 'children', 0)), '[]'::jsonb)
    FROM unnest(_units) u;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.rq_sql(_pkg text, _in date, _rooms jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT hospitality.package_rooms_quote(%L, %L, 2, 0, %L::jsonb)', _pkg, _in, _rooms);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.req_sql(_pkg text, _in date, _rooms jsonb, _email text, _key text, _hash text)
RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT hospitality.request_booking_package_with_rooms(_package_id => %L, _check_in => %L,
                   _rooms => %L::jsonb, _full_name => %L, _email => %L, _phone => %L, _idempotency_key => %L,
                   _policy_accepted => true, _policy_hash => %L)',
                _pkg, _in, _rooms, 'כלה מאושרת', _email,
                '05' || lpad((abs(hashtext(_email)) % 100000000)::text, 8, '0'), _key, _hash);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.mails(_site uuid, _event text) RETURNS bigint LANGUAGE sql AS $f$
  SELECT count(*) FROM hospitality.notifications WHERE tenant_id = _site AND event = _event;
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000202a01', 'm202.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000202a02', 'm202.other@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE m202_flags AS
  SELECT key, enabled FROM public.platform_feature_flags WHERE key LIKE 'hospitality%';
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m202-addons', 'נופי הכלה', 'm202.owner@test.local')$$) ->> 'id' AS st \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm202.owner@test.local')$$, :'st')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m202-other', 'אתר שכן', 'm202.other@test.local')$$) ->> 'id' AS so \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm202.other@test.local')$$, :'so')) IS NOT NULL AS ok \gset
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
SELECT pg_temp.call(:'st', :OWNER202,
  $q$SELECT hospitality.property_create('{"name": "נופי הכלה", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS sp \gset
SELECT pg_temp.call(:'st', :OWNER202, format($q$SELECT hospitality.unit_create(%L, '{"name": "גן עדן VIP", "unit_type": "suite", "capacity": 2}')$q$, :'sp')) ->> 'id' AS uv \gset
SELECT pg_temp.call(:'st', :OWNER202, format($q$SELECT hospitality.unit_create(%L, '{"name": "אדיר", "unit_type": "suite", "capacity": 5}')$q$, :'sp')) ->> 'id' AS ua \gset
SELECT pg_temp.call(:'st', :OWNER202, format($q$SELECT hospitality.unit_create(%L, '{"name": "מוריה", "unit_type": "suite", "capacity": 4}')$q$, :'sp')) ->> 'id' AS um \gset
SELECT pg_temp.call(:'st', :OWNER202, format($q$SELECT hospitality.unit_create(%L, '{"name": "כל המתחם", "unit_type": "suite", "capacity": 11}')$q$, :'sp')) ->> 'id' AS uw \gset
SELECT pg_temp.call(:'so', :OTHER202,
  $q$SELECT hospitality.property_create('{"name": "אתר שכן", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS op \gset
SELECT pg_temp.call(:'so', :OTHER202, format($q$SELECT hospitality.unit_create(%L, '{"name": "יחידה שכנה", "unit_type": "suite", "capacity": 4}')$q$, :'op')) ->> 'id' AS uo \gset
-- the rates: 500 a night, at least 3 nights (the package and its rooms set their own price and nights)
UPDATE hospitality.units SET base_price = 500, min_nights = 3 WHERE tenant_id = :'st';
UPDATE hospitality.units SET kind = 'whole_property' WHERE id = :'uw';
-- the package's own policy: half of each booking as a deposit
INSERT INTO hospitality.policies (tenant_id, name, deposit_kind, deposit_value, free_cancel_days)
VALUES (:'st', 'חבילת כלה — מקדמה 50%', 'percent', 50, 30) RETURNING id AS pol \gset

-- ============================================================
-- 1. Structure
-- ============================================================
SELECT tests.check('structure: the add-on columns with their check (up to 8, not the package''s unit, price iff rooms, 1..N)',
  $$SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'packages'
             AND column_name IN ('addon_unit_ids', 'addon_nightly_price', 'addon_max')) = 3
       AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'hospitality.packages'::regclass AND conname = 'packages_addons_check')$$);
SELECT tests.check('structure: the room quotes and the request — the app server only; package_save — staff (one version only)',
  $$SELECT NOT has_function_privilege('anon', 'hospitality.package_addons_quote(uuid, date)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.package_addons_quote(uuid, date)', 'EXECUTE')
       AND has_function_privilege('service_role', 'hospitality.package_addons_quote(uuid, date)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.package_rooms_quote(uuid, date, integer, integer, jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.package_rooms_quote(uuid, date, integer, integer, jsonb)', 'EXECUTE')
       AND has_function_privilege('service_role', 'hospitality.package_rooms_quote(uuid, date, integer, integer, jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.request_booking_package_with_rooms(uuid, date, jsonb, text, text, text, text, boolean, text, integer, integer, text, boolean, text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.request_booking_package_with_rooms(uuid, date, jsonb, text, text, text, text, boolean, text, integer, integer, text, boolean, text)', 'EXECUTE')
       AND has_function_privilege('service_role', 'hospitality.request_booking_package_with_rooms(uuid, date, jsonb, text, text, text, text, boolean, text, integer, integer, text, boolean, text)', 'EXECUTE')
       AND has_function_privilege('service_role', 'hospitality.request_booking_package_with_rooms_with_documents(jsonb, uuid, date, jsonb, text, text, text, text, boolean, text, integer, integer, text, boolean, text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.request_booking_package_with_rooms_with_documents(jsonb, uuid, date, jsonb, text, text, text, text, boolean, text, integer, integer, text, boolean, text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._package_rooms_quote(uuid, uuid, date, integer, integer, jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.package_save(uuid, uuid, text, text, integer, numeric, integer, text, text, date, date, uuid, uuid[], integer, jsonb)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'hospitality.package_save(uuid, uuid, text, text, integer, numeric, integer, text, text, date, date, uuid, uuid[], integer, jsonb)', 'EXECUTE')
       AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'hospitality'::regnamespace AND proname = 'package_save') = 1$$);

-- ============================================================
-- 2. Staff: save the add-on rooms with the package
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER202, pg_temp.save_sql(NULL, :'uv',
  format('_policy_id => %L, ', :'pol') || pg_temp.addons(ARRAY[:'ua', :'um'], '1200', 2))) AS p1 \gset
SELECT (:'p1'::jsonb) ->> 'id' AS pk, ((:'p1'::jsonb) ->> 'revision')::integer AS pk_rev \gset
SELECT tests.check('staff: a new package with two add-on rooms at 1,200 a night, up to 2 — saved and returned; the action log',
  format($$SELECT %1$L::jsonb -> 'addons' = jsonb_build_object('unit_ids', jsonb_build_array(%2$L, %3$L),
                                                                'nightly_price', 1200, 'max', 2)
             AND (SELECT p.addon_unit_ids = ARRAY[%2$L, %3$L]::uuid[] AND p.addon_nightly_price = 1200 AND p.addon_max = 2
                    FROM hospitality.packages p WHERE p.id = %4$L)
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %5$L AND a.action = 'packages.created'
                            AND (a.changes ->> 'addon_rooms')::integer = 2)$$,
         :'p1', :'ua', :'um', :'pk', :'st'));
SELECT tests.check('staff: refused — the package''s own unit, "the whole property", another business''s unit, twice, no price, a bad price, 0 / more than chosen, not a list',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, pg_temp.addons(ARRAY[%3$L], '1200', 1))) LIKE 'היחידה של החבילה לא יכולה%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, pg_temp.addons(ARRAY[%4$L], '1200', 1))) LIKE 'אפשר להוסיף כחדר נוסף רק%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, pg_temp.addons(ARRAY[%5$L], '1200', 1))) LIKE 'אפשר להוסיף כחדר נוסף רק%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, pg_temp.addons(ARRAY[%6$L, %6$L], '1200', 1))) LIKE 'כל חדר נוסף — פעם אחת%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, pg_temp.addons(ARRAY[%6$L], 'null', 1))) LIKE 'נא לקבוע מחיר ללילה%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, pg_temp.addons(ARRAY[%6$L], '0', 1))) LIKE 'המחיר ללילה לחדר נוסף לא תקין%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, pg_temp.addons(ARRAY[%6$L], '12.345', 1))) LIKE 'המחיר ללילה לחדר נוסף לא תקין%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, pg_temp.addons(ARRAY[%6$L], '1200', 0))) LIKE 'מספר החדרים הנוספים%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, pg_temp.addons(ARRAY[%6$L], '1200', 2))) LIKE 'מספר החדרים הנוספים%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(NULL, %3$L, '_addons => ''{"unit_ids": "x"}''::jsonb')) LIKE 'פרטי החדרים הנוספים לא תקינים%%'$$,
         :'st', :OWNER202, :'uv', :'uw', :'uo', :'ua'));
SELECT tests.check('staff: another business cannot save a package of this business (not found)',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(%3$L, %4$L, pg_temp.addons(ARRAY[%5$L], '1200', 1))) IS NOT NULL
             AND (SELECT p.addon_max = 2 FROM hospitality.packages p WHERE p.id = %3$L)$$,
         :'so', :OTHER202, :'pk', :'uv', :'ua'));
-- the old app (no _addons): a change in the package keeps the add-on rooms
SELECT pg_temp.call(:'st', :OWNER202, pg_temp.save_sql(:'pk', :'uv',
  format('_policy_id => %L, _description => %L, _expected_revision => %s', :'pol', 'שני לילות להתארגנות כלה', :'pk_rev'))) AS p2 \gset
SELECT tests.check('staff: saving without the add-on rooms (the app before this release) keeps them; the revision goes up',
  format($$SELECT (%1$L::jsonb ->> 'revision')::integer = %2$s + 1 AND %1$L::jsonb ->> 'description' = 'שני לילות להתארגנות כלה'
             AND (%1$L::jsonb -> 'addons' ->> 'max')::integer = 2 AND jsonb_array_length(%1$L::jsonb -> 'addons' -> 'unit_ids') = 2$$,
         :'p2', :'pk_rev'));
SELECT tests.check('staff: the package list (packages_view) has the add-on rooms and, for each unit, its kind',
  format($$SELECT (v -> 'packages' -> 0 -> 'addons' ->> 'nightly_price')::numeric = 1200
             AND (SELECT bool_and(u ? 'kind' AND u ? 'typed') FROM jsonb_array_elements(v -> 'units') u)
             AND (SELECT u ->> 'kind' FROM jsonb_array_elements(v -> 'units') u WHERE u ->> 'id' = %3$L) = 'whole_property'
           FROM pg_temp.call(%1$L, %2$L, 'SELECT hospitality.packages_view()') v$$,
         :'st', :OWNER202, :'uw'));
SELECT pg_temp.call(:'st', :OWNER202, format('SELECT hospitality.package_set_active(%L, true)', :'pk')) IS NOT NULL AS ok \gset

-- ============================================================
-- 3. The site: the public package and the free rooms
-- ============================================================
SELECT tests.check('the site: the public package shows the add-on rooms (price a night, up to 2)',
  format($$SELECT (p -> 0 -> 'addons' ->> 'nightly_price')::numeric = 1200 AND (p -> 0 -> 'addons' ->> 'max')::integer = 2
             AND p -> 0 -> 'addons' -> 'unit_ids' = jsonb_build_array(%2$L, %3$L)
           FROM pg_temp.call(%1$L, NULL, 'SELECT hospitality.public_packages()') p$$,
         :'st', :'ua', :'um'));
SELECT pg_temp.srv(:'st', format('SELECT hospitality.package_addons_quote(%L, %L)', :'pk', pg_temp.d(20))) AS aq \gset
SELECT tests.check('the site: both rooms free for the 2 nights — 2,400 each (1,200 × 2), although each unit asks for 3 nights at least',
  format($$SELECT (%1$L::jsonb ->> 'nights')::integer = 2 AND %1$L::jsonb ->> 'check_out' = %2$L
             AND jsonb_array_length(%1$L::jsonb -> 'units') = 2 AND (%1$L::jsonb ->> 'max')::integer = 2
             AND (SELECT bool_and((u ->> 'total')::numeric = 2400 AND (u ->> 'nightly_price')::numeric = 1200)
                    FROM jsonb_array_elements(%1$L::jsonb -> 'units') u)
             AND NOT %1$L::jsonb::text LIKE '%%policy%%'$$,
         :'aq', pg_temp.d(22)));
-- Moria closed for booking from day 25 on
UPDATE hospitality.units SET open_until = current_date + 24 WHERE id = :'um';
SELECT tests.check('the site: a room closed for those dates is not offered; the package itself stays available',
  format($$SELECT jsonb_array_length(q -> 'units') = 1 AND q -> 'units' -> 0 ->> 'unit_id' = %3$L
             AND (q ->> 'max')::integer = 1
             AND (pg_temp.srv(%1$L, format('SELECT hospitality.package_quote(%%L, %%L)', %2$L, pg_temp.d(30))) ->> 'available')::boolean
           FROM pg_temp.srv(%1$L, format('SELECT hospitality.package_addons_quote(%%L, %%L)', %2$L, pg_temp.d(30))) q$$,
         :'st', :'pk', :'ua'));
UPDATE hospitality.units SET open_until = current_date + 730 WHERE id = :'um';
SELECT tests.check('the site: another business''s address — the package is not found there',
  format($$SELECT pg_temp.srv_err(%1$L, format('SELECT hospitality.package_addons_quote(%%L, %%L)', %2$L, pg_temp.d(20))) LIKE 'החבילה לא נמצאה%%'
             AND pg_temp.srv_err(%1$L, pg_temp.rq_sql(%2$L, pg_temp.d(20), pg_temp.rooms(ARRAY[%3$L]))) LIKE 'החבילה לא נמצאה%%'$$,
         :'so', :'pk', :'ua'));

-- ============================================================
-- 4. Quote
-- ============================================================
SELECT pg_temp.srv(:'st', pg_temp.rq_sql(:'pk', pg_temp.d(20), '[]'::jsonb)) AS q0 \gset
SELECT pg_temp.srv(:'st', pg_temp.rq_sql(:'pk', pg_temp.d(20), pg_temp.rooms(ARRAY[:'ua'], 4))) AS q1 \gset
SELECT pg_temp.srv(:'st', pg_temp.rq_sql(:'pk', pg_temp.d(20), pg_temp.rooms(ARRAY[:'ua', :'um']))) AS q2 \gset
SELECT tests.check('quote: no rooms = exactly the package''s quote (the same total and the same hash)',
  format($$SELECT (%1$L::jsonb ->> 'grand_total')::numeric = 4000 AND (%1$L::jsonb ->> 'rooms_total')::numeric = 0
             AND %1$L::jsonb ->> 'policy_hash'
                 = pg_temp.srv(%2$L, format('SELECT hospitality.package_quote(%%L, %%L)', %3$L, pg_temp.d(20))) ->> 'policy_hash'$$,
         :'q0', :'st', :'pk'));
SELECT tests.check('quote: + one room = 6,400; + two rooms = 8,800 — computed in the database; the package stays 4,000',
  format($$SELECT (%1$L::jsonb ->> 'grand_total')::numeric = 6400 AND (%1$L::jsonb ->> 'total')::numeric = 4000
             AND (%1$L::jsonb ->> 'rooms_total')::numeric = 2400 AND (%1$L::jsonb ->> 'available')::boolean
             AND (%1$L::jsonb -> 'rooms' -> 0 ->> 'adults')::integer = 4
             AND (%2$L::jsonb ->> 'grand_total')::numeric = 8800 AND jsonb_array_length(%2$L::jsonb -> 'rooms') = 2$$,
         :'q1', :'q2'));
SELECT tests.check('quote: every room in the package''s policy, the deposit from its own total (50%% of 2,400 = 1,200); one hash for everything',
  format($$SELECT %1$L::jsonb -> 'rooms' -> 0 -> 'policy' ->> 'policy_id' = %2$L
             AND (%1$L::jsonb -> 'rooms' -> 0 ->> 'deposit_amount')::numeric = 1200
             AND (%1$L::jsonb ->> 'deposit_amount')::numeric = 2000
             AND %1$L::jsonb ->> 'policy_hash' <> %3$L::jsonb ->> 'policy_hash'
             AND %1$L::jsonb ->> 'policy_hash' <> %4$L::jsonb ->> 'policy_hash'$$,
         :'q1', :'pol', :'q0', :'q2'));
SELECT tests.check('quote: refused — a room not in the package, "the whole property", twice, more than allowed, too many guests, not a list',
  format($$SELECT pg_temp.srv_err(%1$L, pg_temp.rq_sql(%2$L, pg_temp.d(20), pg_temp.rooms(ARRAY[%3$L]))) LIKE 'החדר הנוסף לא זמין בחבילה הזו%%'
             AND pg_temp.srv_err(%1$L, pg_temp.rq_sql(%2$L, pg_temp.d(20), pg_temp.rooms(ARRAY[%4$L]))) LIKE 'החדר הנוסף לא זמין בחבילה הזו%%'
             AND pg_temp.srv_err(%1$L, pg_temp.rq_sql(%2$L, pg_temp.d(20), pg_temp.rooms(ARRAY[%5$L, %5$L]))) LIKE 'כל חדר נוסף — פעם אחת%%'
             AND pg_temp.srv_err(%1$L, pg_temp.rq_sql(%2$L, pg_temp.d(20), pg_temp.rooms(ARRAY[%5$L], 9))) LIKE 'מספר האורחים לא מתאים%%'
             AND pg_temp.srv_err(%1$L, pg_temp.rq_sql(%2$L, pg_temp.d(20), '{"unit_id": 1}'::jsonb)) LIKE 'בחירת החדרים הנוספים לא תקינה%%'$$,
         :'st', :'pk', :'uv', :'uw', :'ua'));

-- ============================================================
-- 5. Request: the package and a room — together or nothing
-- ============================================================
SELECT pg_temp.srv(:'st', pg_temp.req_sql(:'pk', pg_temp.d(20), pg_temp.rooms(ARRAY[:'ua'], 4), 'bride@example.com',
                                          'm202-bride-one', (:'q1'::jsonb) ->> 'policy_hash')) AS r1 \gset
SELECT (:'r1'::jsonb) ->> 'group_id' AS g1, (:'r1'::jsonb) -> 'bookings' -> 0 ->> 'booking_id' AS b1,
       (:'r1'::jsonb) -> 'bookings' -> 1 ->> 'booking_id' AS b2,
       (:'r1'::jsonb) -> 'bookings' -> 1 ->> 'manage_token' AS t2 \gset
SELECT tests.check('request: two bookings in one group, waiting for approval — the VIP at 4,000 and Adir at 2,400 (1,200 × 2), the same 2 nights',
  format($$SELECT (SELECT count(*) FROM hospitality.bookings b WHERE b.group_id = %1$L) = 2
             AND (SELECT b.unit_id = %4$L AND b.total = 4000 AND b.price_manual AND b.status = 'pending_approval'
                         AND b.check_in = %6$L::date AND b.check_out = %7$L::date AND b.deposit_amount = 2000
                         AND b.package_id = %8$L AND NOT b.package_snapshot ? 'role' AND b.reminder_due_at IS NOT NULL
                    FROM hospitality.bookings b WHERE b.id = %2$L)
             AND (SELECT b.unit_id = %5$L AND b.total = 2400 AND b.price_manual AND b.status = 'pending_approval'
                         AND b.check_in = %6$L::date AND b.check_out = %7$L::date AND b.adults = 4 AND b.deposit_amount = 1200
                         AND b.package_id = %8$L AND b.package_snapshot ->> 'role' = 'addon'
                         AND (b.package_snapshot ->> 'addon_nightly_price')::numeric = 1200 AND b.reminder_due_at IS NULL
                         AND b.policy_snapshot ->> 'policy_id' = %9$L
                         AND (SELECT count(*) = 2 AND sum(n.price) = 2400 FROM hospitality.booking_nights n WHERE n.booking_id = b.id)
                    FROM hospitality.bookings b WHERE b.id = %3$L)
             AND (%10$L::jsonb ->> 'total')::numeric = 6400$$,
         :'g1', :'b1', :'b2', :'uv', :'ua', pg_temp.d(20), pg_temp.d(22), :'pk', :'pol', :'r1'));
SELECT tests.check('request: the evidence on both bookings — the same accepted hash, the group, the role',
  format($$SELECT (SELECT bool_and(b.policy_acceptance ->> 'snapshot_hash' = %2$L AND b.policy_acceptance ->> 'group_id' = %3$L)
                     FROM hospitality.bookings b WHERE b.group_id = %3$L)
             AND (SELECT b.policy_acceptance ->> 'role' FROM hospitality.bookings b WHERE b.id = %1$L) = 'addon'
             AND (SELECT count(*) FROM hospitality.booking_events e WHERE e.kind = 'policy_accepted'
                     AND e.booking_id IN (SELECT id FROM hospitality.bookings WHERE group_id = %3$L)) = 2$$,
         :'b2', (:'q1'::jsonb) ->> 'policy_hash', :'g1'));
SELECT tests.check('request: one email to the business and one to the guest — both rooms, the package name, a link per booking',
  format($$SELECT pg_temp.mails(%1$L, 'new_group_request') = 1 AND pg_temp.mails(%1$L, 'group_request_received') = 1
             AND pg_temp.mails(%1$L, 'new_request') = 0 AND pg_temp.mails(%1$L, 'request_received') = 0
             AND (SELECT n.payload ->> 'package_name' = 'חבילת כלה – VIP' AND jsonb_array_length(n.payload -> 'rooms') = 2
                         AND (n.payload ->> 'total')::numeric = 6400
                         AND (SELECT bool_and(length(r ->> 'manage_token') = 64) FROM jsonb_array_elements(n.payload -> 'rooms') r)
                    FROM hospitality.notifications n WHERE n.tenant_id = %1$L AND n.event = 'group_request_received')
             AND (SELECT NOT (n.payload::text LIKE '%%manage_token%%')
                    FROM hospitality.notifications n WHERE n.tenant_id = %1$L AND n.event = 'new_group_request')$$,
         :'st'));
SELECT tests.check('request: the same request again — the same bookings, duplicate, no links, no new emails',
  format($$SELECT r ->> 'group_id' = %2$L AND (r ->> 'duplicate')::boolean
             AND (SELECT bool_and(b ->> 'manage_token' IS NULL) FROM jsonb_array_elements(r -> 'bookings') b)
             AND pg_temp.mails(%1$L, 'group_request_received') = 1
           FROM pg_temp.srv(%1$L, pg_temp.req_sql(%3$L, pg_temp.d(20), pg_temp.rooms(ARRAY[%4$L], 4), 'bride@example.com',
                                                  'm202-bride-one', %5$L)) r$$,
         :'st', :'g1', :'pk', :'ua', (:'q1'::jsonb) ->> 'policy_hash'));
SELECT tests.check('request: the package''s quote hash is not enough for a request with a room (the terms of the room were not accepted)',
  format($$SELECT pg_temp.srv_err(%1$L, pg_temp.req_sql(%2$L, pg_temp.d(40), pg_temp.rooms(ARRAY[%3$L]), 'other.bride@example.com',
                     'm202-bride-hash', pg_temp.srv(%1$L, pg_temp.rq_sql(%2$L, pg_temp.d(40), '[]'::jsonb)) ->> 'policy_hash'))
                  LIKE 'תנאי ההזמנה השתנו%%'
             AND NOT EXISTS (SELECT 1 FROM hospitality.bookings WHERE idempotency_key LIKE 'm202-bride-hash%%')$$,
         :'st', :'pk', :'ua'));
-- Adir taken by a regular guest for day 45 (after the bride saw it free)
SELECT pg_temp.srv(:'st', pg_temp.rq_sql(:'pk', pg_temp.d(44), pg_temp.rooms(ARRAY[:'ua']))) AS q44 \gset
SELECT pg_temp.srv(:'st', format('SELECT hospitality.request_booking(_unit_id => %L, _check_in => %L, _check_out => %L,
         _full_name => %L, _email => %L, _phone => %L, _idempotency_key => %L, _policy_accepted => true, _policy_hash => %L)',
         :'ua', pg_temp.d(45), pg_temp.d(48), 'אורח רגיל', 'regular@example.com', '0542630203', 'm202-regular-adir',
         pg_temp.call(:'st', NULL, format('SELECT hospitality.quote(%L, %L, %L)', :'ua', pg_temp.d(45), pg_temp.d(48))) ->> 'policy_hash')) ->> 'booking_id' AS breg \gset
SELECT tests.check('request: the room was taken in between — refused with its name, and nothing is saved (not even the package)',
  format($$SELECT pg_temp.srv_err(%1$L, pg_temp.req_sql(%2$L, pg_temp.d(44), pg_temp.rooms(ARRAY[%3$L]), 'late.bride@example.com',
                     'm202-bride-late', %4$L)) LIKE 'החדר הנוסף אדיר כבר לא פנוי%%'
             AND NOT EXISTS (SELECT 1 FROM hospitality.bookings WHERE idempotency_key LIKE 'm202-bride-late%%')
             AND (pg_temp.srv(%1$L, format('SELECT hospitality.package_quote(%%L, %%L)', %2$L, pg_temp.d(44))) ->> 'available')::boolean
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
                   pg_temp.srv(%1$L, format('SELECT hospitality.package_addons_quote(%%L, %%L)', %2$L, pg_temp.d(44))) -> 'units') u
                   WHERE u ->> 'unit_id' = %3$L)$$,
         :'st', :'pk', :'ua', (:'q44'::jsonb) ->> 'policy_hash'));
SELECT tests.check('request: the package''s nights are taken — refused, nothing saved; the room alone stays free',
  format($$SELECT pg_temp.srv_err(%1$L, pg_temp.req_sql(%2$L, pg_temp.d(21), pg_temp.rooms(ARRAY[%3$L]), 'second.bride@example.com',
                     'm202-bride-two', pg_temp.srv(%1$L, pg_temp.rq_sql(%2$L, pg_temp.d(21), pg_temp.rooms(ARRAY[%3$L]))) ->> 'policy_hash'))
                  LIKE 'התאריכים המבוקשים כבר לא פנויים%%'
             AND NOT EXISTS (SELECT 1 FROM hospitality.bookings WHERE idempotency_key LIKE 'm202-bride-two%%')$$,
         :'st', :'pk', :'um'));
SELECT pg_temp.srv(:'st', pg_temp.req_sql(:'pk', pg_temp.d(60), '[]'::jsonb, 'plain.bride@example.com', 'm202-bride-plain',
         pg_temp.srv(:'st', pg_temp.rq_sql(:'pk', pg_temp.d(60), '[]'::jsonb)) ->> 'policy_hash')) AS rp \gset
SELECT tests.check('request: no rooms — the package''s request as before (one booking, no group, the regular emails)',
  format($$SELECT %1$L::jsonb ? 'booking_id' AND NOT %1$L::jsonb ? 'group_id'
             AND (SELECT b.group_id IS NULL AND b.total = 4000 AND NOT b.package_snapshot ? 'role'
                    FROM hospitality.bookings b WHERE b.id = (%1$L::jsonb ->> 'booking_id')::uuid)
             AND (SELECT count(*) FROM hospitality.notifications n WHERE n.booking_id = (%1$L::jsonb ->> 'booking_id')::uuid
                     AND n.event IN ('new_request', 'request_received')) = 2$$,
         :'rp'));
SELECT tests.check('request: with the site documents wrapper (no documents shown) — the same group request',
  format($$SELECT r ? 'group_id' AND jsonb_array_length(r -> 'bookings') = 2
           FROM pg_temp.srv(%1$L, format('SELECT hospitality.request_booking_package_with_rooms_with_documents(_documents => %%L::jsonb,
                  _package_id => %%L, _check_in => %%L, _rooms => %%L::jsonb, _full_name => %%L, _email => %%L, _phone => %%L,
                  _idempotency_key => %%L, _policy_accepted => true, _policy_hash => %%L)',
                  '[]', %2$L, pg_temp.d(80), pg_temp.rooms(ARRAY[%3$L]), 'כלה עם מסמכים', 'docs.bride@example.com', '0542630204',
                  'm202-bride-docs', pg_temp.srv(%1$L, pg_temp.rq_sql(%2$L, pg_temp.d(80), pg_temp.rooms(ARRAY[%3$L]))) ->> 'policy_hash')) r$$,
         :'st', :'pk', :'um'));

-- ============================================================
-- 6. Approve, the staff page, the guest's page, the counts
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER202, format('SELECT hospitality.booking_group_decide(%L, true)', :'b2')) AS dec \gset
SELECT tests.check('approve: the whole group at once (from the room''s page) — both confirmed, one email to the guest',
  format($$SELECT (%1$L::jsonb ->> 'decided')::integer = 2
             AND (SELECT bool_and(b.status = 'confirmed') FROM hospitality.bookings b WHERE b.group_id = %2$L)
             AND pg_temp.mails(%3$L, 'group_booking_confirmed') = 1
             AND NOT EXISTS (SELECT 1 FROM hospitality.notifications n WHERE n.tenant_id = %3$L AND n.recipient_kind = 'guest'
                                AND n.event = 'booking_confirmed' AND n.booking_id IN (%4$L, %5$L))$$,
         :'dec', :'g1', :'st', :'b1', :'b2'));
SELECT tests.check('the staff booking page of the room: the package as booked, with the role "addon"; the group has both',
  format($$SELECT d -> 'package' ->> 'role' = 'addon' AND d -> 'package' ->> 'name' = 'חבילת כלה – VIP'
             AND jsonb_array_length(pg_temp.call(%1$L, %2$L, format('SELECT hospitality.booking_group(%%L)', %3$L)) -> 'bookings') = 2
           FROM pg_temp.call(%1$L, %2$L, format('SELECT hospitality.staff_booking_detail(%%L)', %3$L)) d$$,
         :'st', :OWNER202, :'b2'));
SELECT tests.check('the guest''s page of the room (its own link): the package name and the role "addon"',
  format($$SELECT v ->> 'package_name' = 'חבילת כלה – VIP' AND v ->> 'package_role' = 'addon'
           FROM pg_temp.call(%1$L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', %2$L)) v$$,
         :'st', :'t2'));
SELECT tests.check('the package (staff): bookings of the package itself counted apart from the add-on rooms',
  format($$SELECT (p ->> 'bookings_count')::integer = 3 AND (p ->> 'addon_bookings_count')::integer = 2
           FROM jsonb_array_elements(pg_temp.call(%1$L, %2$L, 'SELECT hospitality.packages_view()') -> 'packages') p
          WHERE p ->> 'id' = %3$L$$,
         :'st', :OWNER202, :'pk'));
SELECT hospitality._enqueue(b, 'booking_details', 'guest', '{}'::jsonb, true) AS enq FROM hospitality.bookings b WHERE b.id = :'b2' \gset
SELECT tests.check('the emails of a single room booking carry "package_role": "addon"; the package''s own booking does not',
  format($$SELECT (SELECT n.payload ->> 'package_role' FROM hospitality.notifications n
                   WHERE n.booking_id = %1$L AND n.event = 'booking_details') = 'addon'
             AND (SELECT NOT n.payload ? 'package_role' FROM hospitality.notifications n
                   WHERE n.booking_id = %2$L AND n.event = 'group_request_received')$$,
         :'b2', :'b1'));
SELECT pg_temp.call(:'st', :OWNER202, pg_temp.save_sql(:'pk', :'uv',
  format('_policy_id => %L, ', :'pol') || pg_temp.addons(ARRAY[]::text[], 'null', 0))) AS p3 \gset
SELECT tests.check('clear: an empty list removes the add-on rooms (price and max back to empty); the site no longer offers them',
  format($$SELECT %1$L::jsonb -> 'addons' = 'null'::jsonb
             AND (SELECT x.addon_unit_ids = '{}' AND x.addon_nightly_price IS NULL AND x.addon_max = 0
                    FROM hospitality.packages x WHERE x.id = %3$L)
             AND jsonb_array_length(pg_temp.srv(%2$L, format('SELECT hospitality.package_addons_quote(%%L, %%L)', %3$L, pg_temp.d(100))) -> 'units') = 0
             AND pg_temp.srv_err(%2$L, pg_temp.rq_sql(%3$L, pg_temp.d(100), pg_temp.rooms(ARRAY[%4$L]))) LIKE 'לחבילה הזו אין חדרים נוספים%%'$$,
         :'p3', :'st', :'pk', :'ua'));

-- ---------- cleanup ----------
UPDATE public.platform_feature_flags f SET enabled = m.enabled FROM m202_flags m WHERE f.key = m.key;
DROP TABLE m202_flags;

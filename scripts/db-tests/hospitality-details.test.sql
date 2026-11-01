-- ============================================================
-- Hospitality: unit and property details (Hospitality Stage 2d — 20261101190000_hosp_details.sql)
--   • structure: new columns, the private arrival-info table without any direct access, direct
--     writes to beds / amenities revoked, functions DEFINER and never anon (except the guest one)
--   • beds, toilets, max adults / children, private amenities on the unit page (unit_update);
--     location, parking, guest info, house rules, shared amenities (property_update)
--   • the amenity catalogue: presets (idempotent), custom amenities, edit / remove
--   • private arrival info: staff only, value-free audit, revision; the guest only with a valid
--     link, a confirmed booking and inside the window; never in a public function
--   • the booking engine: max adults / children in quote, request, manual booking and modify;
--     the house-rules snapshot on every new booking, unchanged afterwards
--   • outsiders refused everywhere; site isolation; Ecommerce data unchanged
-- ============================================================
\set OWNER_A '''a0000000-0000-0000-0000-0000000007a1'''
\set MGR_A '''a0000000-0000-0000-0000-0000000007a2'''
\set OWNER_B '''a0000000-0000-0000-0000-0000000007b1'''
\set GUEST '''a0000000-0000-0000-0000-0000000007c1'''
\set SHOP_OWNER '''a0000000-0000-0000-0000-0000000007e1'''
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set SHOP '''72d00000-0000-0000-0000-0000000000e1'''

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
-- the application server's call (service role): since migration 25 (D1) the only way a booking
-- request reaches the database — after the anti-bot check and the shared rate limit in the app
CREATE OR REPLACE FUNCTION pg_temp.srv(_site text, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site, 'user-agent', 'db-test',
                                                          'x-forwarded-for', '203.0.113.7')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE service_role;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  RETURN r;
END $f$;
-- a site request (quote first, then the request with the quote's policy hash) — an anonymous visitor, sent by the app server
CREATE OR REPLACE FUNCTION pg_temp.req(_site text, _unit uuid, _in date, _out date, _email text, _phone text, _key text,
                                       _adults integer DEFAULT 2, _children integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE q jsonb;
BEGIN
  q := pg_temp.call(_site, NULL, format('SELECT hospitality.quote(%L, %L, %L, %s, %s)', _unit, _in, _out, _adults, _children));
  RETURN pg_temp.srv(_site, format(
    'SELECT hospitality.request_booking(_unit_id => %L, _check_in => %L, _check_out => %L, _full_name => %L,
       _email => %L, _phone => %L, _idempotency_key => %L, _policy_accepted => true, _policy_hash => %L,
       _adults => %s, _children => %s)',
    _unit, _in, _out, 'אורח בדיקה', _email, _phone, _key, q ->> 'policy_hash', _adults, _children));
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.manual(_site text, _uid uuid, _unit uuid, _in date, _out date,
                                          _adults integer DEFAULT 2, _children integer DEFAULT 0,
                                          _status text DEFAULT 'confirmed') RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, format(
    'SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L, _check_out => %L, _full_name => %L,
       _phone => %L, _terms_explained => true, _adults => %s, _children => %s, _status => %L)',
    _unit, _in, _out, 'אורח טלפוני', '0541234567', _adults, _children, _status));
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-0000000007a1', 'c2d.owner.a@test.local', now()),
  ('a0000000-0000-0000-0000-0000000007a2', 'c2d.mgr.a@test.local', now()),
  ('a0000000-0000-0000-0000-0000000007b1', 'c2d.owner.b@test.local', now()),
  ('a0000000-0000-0000-0000-0000000007c1', 'c2d.guest@test.local', now()),
  ('a0000000-0000-0000-0000-0000000007e1', 'c2d.shop.owner@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('c2d-a', 'אירוח פרטים A'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('c2d-b', 'אירוח פרטים B'))$$) IS NOT NULL AS ok \gset
SELECT id AS sa FROM public.tenants WHERE slug = 'c2d-a' \gset
SELECT id AS sb FROM public.tenants WHERE slug = 'c2d-b' \gset
SELECT pg_temp.add_role(:'sa', :OWNER_A, 'c2d_owner_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sa', :MGR_A, 'c2d_mgr_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sb', :OWNER_B, 'c2d_owner_b') IS NOT NULL AS ok \gset
UPDATE public.user_roles SET is_protected = true WHERE user_id IN (:OWNER_A, :OWNER_B);
INSERT INTO public.tenants (id, slug, name) VALUES (:SHOP, 'c2d-shop', 'חנות 2d');
SELECT pg_temp.add_role(:SHOP, :SHOP_OWNER, 'c2d_shop_owner') IS NOT NULL AS ok \gset
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
CREATE TEMP TABLE c2d_before AS SELECT pg_temp.ecommerce_hash() AS h;

SELECT pg_temp.h(:'sa', :OWNER_A, $$property_create('{"name": "חוות הזית", "property_type": "zimmer_complex", "status": "active"}')$$) ->> 'id' AS pa \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_create(%L, '{"name": "צימר הזית", "unit_type": "zimmer", "capacity": 4}')$$, :'pa')) ->> 'id' AS u1 \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_create(%L, '{"name": "צימר האלון", "unit_type": "zimmer", "capacity": 6}')$$, :'pa')) ->> 'id' AS u2 \gset
SELECT pg_temp.h(:'sb', :OWNER_B, $$property_create('{"name": "מתחם של B", "property_type": "villa"}')$$) ->> 'id' AS pb \gset
SELECT pg_temp.h(:'sb', :OWNER_B, format($$unit_create(%L, '{"name": "וילה B", "unit_type": "villa"}')$$, :'pb')) ->> 'id' AS ub \gset

-- ============================================================
-- 1. structure
-- ============================================================
SELECT tests.check('details: new unit columns with neutral defaults (existing rows unchanged)',
  format($$SELECT u.separate_toilets = 0 AND u.max_adults IS NULL AND u.max_children IS NULL
           FROM hospitality.units u WHERE u.id = %L$$, :'u1'));
SELECT tests.check('details: new property columns empty by default; bookings.house_rules_snapshot exists',
  format($$SELECT p.parking IS NULL AND p.guest_info IS NULL AND p.rules_custom = '{}' AND p.quiet_from IS NULL
             AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality'
                          AND table_name = 'bookings' AND column_name = 'house_rules_snapshot')
           FROM hospitality.properties p WHERE p.id = %L$$, :'pa'));
SELECT tests.check('details: arrival_info — RLS on, no privilege for anon / authenticated / service_role, no permissive policy',
  $$SELECT c.relrowsecurity
       AND NOT has_table_privilege('anon', 'hospitality.arrival_info', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'hospitality.arrival_info', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'hospitality.arrival_info', 'INSERT')
       AND NOT has_table_privilege('service_role', 'hospitality.arrival_info', 'SELECT')
       AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polpermissive)
       AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND NOT p.polpermissive) = 2
      FROM pg_class c WHERE c.oid = 'hospitality.arrival_info'::regclass$$);
SELECT tests.check('details: no direct INSERT / UPDATE / DELETE on beds and amenities any more; SELECT kept',
  $$SELECT bool_and(NOT has_table_privilege('authenticated', t, 'INSERT') AND NOT has_table_privilege('authenticated', t, 'UPDATE')
                    AND NOT has_table_privilege('authenticated', t, 'DELETE') AND has_table_privilege('authenticated', t, 'SELECT'))
      FROM unnest(ARRAY['hospitality.unit_beds', 'hospitality.amenities', 'hospitality.unit_amenities']) t$$);
SELECT tests.check('details: new staff functions are SECURITY DEFINER, callable by authenticated, never by anon',
  $$SELECT bool_and(p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
      FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace
       AND p.proname IN ('amenity_add_preset', 'amenity_create', 'amenity_update', 'amenity_delete',
                         'arrival_info_view', 'arrival_info_set')
    HAVING count(*) = 6$$);
SELECT tests.check('details: internal helpers are not callable by API roles',
  $$SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
      FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace
       AND p.proname IN ('_rules_items_ok', '_amenity_categories', '_amenity_icons', '_beds_json', '_amenity_links_json',
                         '_cv_beds', '_cv_amenities', '_set_beds', '_set_amenities', '_house_rules_json', '_cv_time',
                         '_unit_parts_guard', '_property_apply', '_amenity_fields', '_arrival_tenant', '_arrival_json',
                         'bookings_house_rules')
    HAVING count(*) = 17$$);
SELECT tests.check('details: private arrival info is read by no anonymous-callable function except the guest one',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_proc p
                        WHERE p.pronamespace = 'hospitality'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE')
                          AND p.prosrc ILIKE '%arrival_info%' AND p.proname <> 'guest_arrival_info')
       AND NOT EXISTS (SELECT 1 FROM pg_proc p
                        WHERE p.pronamespace = 'hospitality'::regnamespace
                          AND p.proname IN ('_snapshot', '_guest_view', '_policy_rules', 'catalog_view', '_unit_json')
                          AND p.prosrc ILIKE '%arrival_info%')$$);
SELECT tests.check('details: presets — 15 items (no parking), unique codes, every icon and category from the fixed lists',
  $$SELECT jsonb_array_length(hospitality.amenity_presets()) = 15
       AND (SELECT count(DISTINCT x ->> 'code') FROM jsonb_array_elements(hospitality.amenity_presets()) x) = 15
       AND (SELECT bool_and((x ->> 'icon') = ANY (hospitality._amenity_icons())
                            AND (x ->> 'category') = ANY (hospitality._amenity_categories())
                            AND char_length(x ->> 'name') <= 60 AND (x ->> 'code') ~ '^[a-z][a-z_]{1,29}$')
              FROM jsonb_array_elements(hospitality.amenity_presets()) x)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(hospitality.amenity_presets()) x WHERE x ->> 'name' LIKE '%חניה%')$$);

-- ============================================================
-- 2. the amenity catalogue
-- ============================================================
SELECT pg_temp.h(:'sa', :OWNER_A, $$amenity_add_preset('jacuzzi')$$) ->> 'id' AS am_jac \gset
SELECT pg_temp.h(:'sa', :MGR_A, $$amenity_add_preset('wifi')$$) ->> 'id' AS am_wifi \gset
SELECT pg_temp.h(:'sa', :OWNER_A, $$amenity_add_preset('pool')$$) ->> 'id' AS am_pool \gset
SELECT tests.check('amenities: a preset is added once (owner, manager), with its name, icon and group; audit row',
  format($$SELECT (pg_temp.h(%1$L, %2$L, 'amenity_add_preset(''jacuzzi'')') ->> 'id') = %3$L
             AND NOT (pg_temp.h(%1$L, %2$L, 'amenity_add_preset(''jacuzzi'')') ->> 'created')::boolean
             AND (SELECT count(*) FROM hospitality.amenities WHERE tenant_id = %1$L AND preset_code = 'jacuzzi') = 1
             AND (SELECT name = 'ג׳קוזי' AND icon = 'bath' AND category = 'pool_spa' FROM hospitality.amenities WHERE id = %3$L)
             AND (SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = %1$L AND action = 'catalog.amenity_added') = 3$$,
         :'sa', :MGR_A, :'am_jac'));
SELECT pg_temp.expect_error('amenities: an unknown preset code is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, $$amenity_add_preset('helipad')$$), 'המתקן לא ברשימה');
SELECT pg_temp.h(:'sa', :MGR_A, $$amenity_create('{"name": "סאונה יבשה", "category": "pool_spa", "icon": "flame"}')$$) ->> 'id' AS am_sauna \gset
SELECT tests.check('amenities: a custom amenity (manager) — name, group and icon from the fixed list',
  format($$SELECT name = 'סאונה יבשה' AND category = 'pool_spa' AND icon = 'flame' AND preset_code IS NULL
           FROM hospitality.amenities WHERE id = %L$$, :'am_sauna'));
SELECT pg_temp.expect_error('amenities: the same name twice is refused (any case)',
  pg_temp.h_sql(:'sa', :OWNER_A, $$amenity_create('{"name": "סאונה יבשה"}')$$), 'כבר יש מתקן בשם הזה');
SELECT pg_temp.expect_error('amenities: an icon outside the fixed list is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, $$amenity_create('{"name": "משהו", "icon": "skull"}')$$), 'אייקון');
SELECT pg_temp.expect_error('amenities: a group outside the fixed list is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, $$amenity_create('{"name": "משהו", "category": "rooftop"}')$$), 'קבוצה');
SELECT pg_temp.expect_error('amenities: a name longer than 60 is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$amenity_create('{"name": "%s"}')$$, repeat('א', 61))), 'ארוך מדי');
SELECT pg_temp.after('amenities: a custom amenity can be renamed',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$amenity_update(%L, '{"name": "סאונה"}')$$, :'am_sauna')),
  format($$SELECT (SELECT name FROM hospitality.amenities WHERE id = %L) = 'סאונה'$$, :'am_sauna'));
SELECT pg_temp.expect_error('amenities: a preset is not editable',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$amenity_update(%L, '{"name": "ג׳קוזי חם"}')$$, :'am_jac')), 'מתקן מהרשימה לא משנים');
SELECT pg_temp.expect_error('amenities: another site''s amenity is not found (no existence leak)',
  pg_temp.h_sql(:'sb', :OWNER_B, format($$amenity_update(%L, '{"name": "x"}')$$, :'am_sauna')), 'המתקן לא נמצא');

-- ============================================================
-- 3. the unit: beds, rooms, guests, private amenities
-- ============================================================
SELECT pg_temp.rev(:'u1') AS r1 \gset
SELECT pg_temp.after('unit: the manager saves beds per room, toilets, max adults / children and private amenities at once',
  pg_temp.h_sql(:'sa', :MGR_A, format($$unit_update(%L, %L, %s)$$, :'u1', jsonb_build_object(
    'separate_toilets', 1, 'max_adults', 2, 'max_children', 2,
    'beds', jsonb_build_array(jsonb_build_object('bed_type', 'king', 'quantity', 1, 'room_label', 'חדר הורים'),
                              jsonb_build_object('bed_type', 'single', 'quantity', 2, 'room_label', 'חדר ילדים'),
                              jsonb_build_object('bed_type', 'crib', 'quantity', 1)),
    'amenities', jsonb_build_array(jsonb_build_object('amenity_id', :'am_jac', 'note', 'ג׳קוזי מחומם'),
                                   jsonb_build_object('amenity_id', :'am_wifi'))), :r1)),
  format($$SELECT ($1 ->> 'revision')::integer = %2$s + 1
             AND (SELECT separate_toilets = 1 AND max_adults = 2 AND max_children = 2 FROM hospitality.units WHERE id = %1$L)
             AND (SELECT string_agg(bed_type || ':' || quantity || ':' || COALESCE(room_label, '-'), ',' ORDER BY sort_order)
                    FROM hospitality.unit_beds WHERE unit_id = %1$L) = 'king:1:חדר הורים,single:2:חדר ילדים,crib:1:-'
             AND (SELECT count(*) FROM hospitality.unit_amenities WHERE unit_id = %1$L AND property_id IS NULL) = 2
             AND (SELECT note FROM hospitality.unit_amenities WHERE unit_id = %1$L AND amenity_id = %3$L) = 'ג׳קוזי מחומם'$$,
         :'u1', :r1, :'am_jac'));
SELECT tests.check('unit: the action log names the beds (count from / to) and the added amenities',
  format($$SELECT (a -> 'changes' -> 'beds' ->> 'to')::integer = 4 AND (a -> 'changes' -> 'beds' ->> 'from')::integer = 0
             AND a -> 'changes' -> 'amenities' -> 'added' ? 'Wi-Fi'
             AND a -> 'changes' ? 'max_adults' AND a -> 'changes' ? 'separate_toilets'
             AND a ->> 'actor_role' = 'manager' AND a ->> 'target_label' = 'צימר הזית'
           FROM pg_temp.last_audit(%L, 'catalog.unit_updated') a$$, :'sa'));
SELECT pg_temp.after('unit: catalog_view returns the beds, amenities and the new fields (and the catalogue, presets, times)',
  pg_temp.h_sql(:'sa', :MGR_A, 'catalog_view()'),
  format($$SELECT (SELECT u FROM jsonb_array_elements($1 -> 'properties' -> 0 -> 'units') u WHERE u ->> 'id' = %L) @>
                  '{"separate_toilets": 1, "max_adults": 2, "max_children": 2}'
             AND jsonb_array_length((SELECT u -> 'beds' FROM jsonb_array_elements($1 -> 'properties' -> 0 -> 'units') u WHERE u ->> 'id' = %1$L)) = 3
             AND jsonb_array_length($1 -> 'amenities') = 4 AND jsonb_array_length($1 -> 'amenity_presets') = 15
             AND $1 ->> 'check_in_time' = '15:00'$$, :'u1'));
SELECT pg_temp.after('unit: saving the same beds and amenities again changes nothing (same revision, no log row)',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_update(%L, %L, %s)$$, :'u1', jsonb_build_object(
    'beds', jsonb_build_array(jsonb_build_object('bed_type', 'king', 'quantity', 1, 'room_label', 'חדר הורים'),
                              jsonb_build_object('bed_type', 'single', 'quantity', 2, 'room_label', 'חדר ילדים'),
                              jsonb_build_object('bed_type', 'crib', 'quantity', 1))), :r1 + 1)),
  format($$SELECT ($1 ->> 'revision')::integer = %s$$, :r1 + 1));
SELECT pg_temp.expect_error('unit: a stale revision is refused ("updated in the meantime") — beds are not overwritten',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_update(%L, '{"beds": []}', %s)$$, :'u1', :r1)), 'עודכנה בינתיים');
SELECT pg_temp.expect_error('unit: an unknown bed type is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_update(%L, '{"beds": [{"bed_type": "waterbed", "quantity": 1}]}', %s)$$, :'u1', :r1 + 1)), 'סוג המיטה');
SELECT pg_temp.expect_error('unit: 0 beds in a row is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_update(%L, '{"beds": [{"bed_type": "double", "quantity": 0}]}', %s)$$, :'u1', :r1 + 1)), 'מספר המיטות בשורה');
SELECT pg_temp.expect_error('unit: more than 30 bed rows is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_update(%L, %L, %s)$$, :'u1',
    jsonb_build_object('beds', (SELECT jsonb_agg(jsonb_build_object('bed_type', 'single', 'quantity', 1)) FROM generate_series(1, 31))), :r1 + 1)),
  'עד 30 שורות');
SELECT pg_temp.expect_error('unit: a room label over 60 characters is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_update(%L, %L, %s)$$, :'u1',
    jsonb_build_object('beds', jsonb_build_array(jsonb_build_object('bed_type', 'single', 'quantity', 1, 'room_label', repeat('א', 61)))), :r1 + 1)),
  'שם החדר');
SELECT pg_temp.expect_error('unit: max adults above the maximum guests is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_update(%L, '{"max_adults": 5}', %s)$$, :'u1', :r1 + 1)), 'מקסימום המבוגרים');
SELECT pg_temp.expect_error('unit: lowering the maximum guests under max children is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_update(%L, '{"capacity": 1, "base_occupancy": 1}', %s)$$, :'u1', :r1 + 1)), 'מקסימום');
SELECT pg_temp.expect_error('unit: separate toilets above 50 are refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_update(%L, '{"separate_toilets": 51}', %s)$$, :'u1', :r1 + 1)), 'שירותים נפרדים');
SELECT pg_temp.expect_error('unit: an amenity of another site is refused',
  pg_temp.h_sql(:'sb', :OWNER_B, format($$unit_update(%L, %L, %s)$$, :'ub',
    jsonb_build_object('amenities', jsonb_build_array(jsonb_build_object('amenity_id', :'am_jac'))), pg_temp.rev(:'ub'))),
  'המתקן לא נמצא');
SELECT pg_temp.expect_error('unit: the same amenity twice is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_update(%L, %L, %s)$$, :'u1',
    jsonb_build_object('amenities', jsonb_build_array(jsonb_build_object('amenity_id', :'am_wifi'), jsonb_build_object('amenity_id', :'am_wifi'))), :r1 + 1)),
  'פעמיים');
SELECT pg_temp.expect_error('unit: an amenity note over 120 characters is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_update(%L, %L, %s)$$, :'u1',
    jsonb_build_object('amenities', jsonb_build_array(jsonb_build_object('amenity_id', :'am_wifi', 'note', repeat('א', 121)))), :r1 + 1)),
  'הערה למתקן');
SELECT pg_temp.after('unit: clearing max adults / children (null = only the total applies)',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_update(%L, '{"max_adults": null}', %s)$$, :'u2', pg_temp.rev(:'u2'))),
  format($$SELECT (SELECT max_adults IS NULL FROM hospitality.units WHERE id = %L)$$, :'u2'));
SELECT pg_temp.expect_error('unit: a store owner cannot change units (no hospitality site)',
  pg_temp.h_sql(:SHOP, :SHOP_OWNER, format($$unit_update(%L, '{"separate_toilets": 2}', %s)$$, :'u1', :r1 + 1)), 'אין הרשאה');
SELECT pg_temp.expect_error('unit: site B''s owner cannot change site A''s unit through site A',
  pg_temp.h_sql(:'sa', :OWNER_B, format($$unit_update(%L, '{"separate_toilets": 2}', %s)$$, :'u1', :r1 + 1)), 'אין הרשאה');
SELECT pg_temp.expect_error('unit: through its own site, site B''s owner does not find A''s unit',
  pg_temp.h_sql(:'sb', :OWNER_B, format($$unit_update(%L, '{"separate_toilets": 2}', %s)$$, :'u1', :r1 + 1)), 'היחידה לא נמצאה');
SELECT pg_temp.expect_error('unit: a signed-in guest cannot change units',
  pg_temp.h_sql(:'sa', :GUEST, format($$unit_update(%L, '{"separate_toilets": 2}', %s)$$, :'u1', :r1 + 1)), 'אין הרשאה');
SELECT pg_temp.expect_error('direct write: staff cannot insert beds directly any more',
  format($$SELECT pg_temp.call(%L, %L, format('INSERT INTO hospitality.unit_beds (tenant_id, unit_id, bed_type) VALUES (%%L, %%L, ''double'') RETURNING to_jsonb(true)', %L, %L))$$,
         :'sa', :OWNER_A, :'sa', :'u1'),
  'permission denied');
SELECT pg_temp.expect_error('direct write: staff cannot change amenities directly any more',
  format($$SELECT pg_temp.call(%L, %L, 'UPDATE hospitality.amenities SET name = ''x'' RETURNING to_jsonb(true)')$$, :'sa', :OWNER_A),
  'permission denied');
SELECT pg_temp.expect_error('direct write: staff cannot delete amenity links directly any more',
  format($$SELECT pg_temp.call(%L, %L, 'DELETE FROM hospitality.unit_amenities RETURNING to_jsonb(true)')$$, :'sa', :OWNER_A),
  'permission denied');

-- whole property: beds and amenities live in the units and on the property
SELECT pg_temp.h(:'sa', :OWNER_A, format($$whole_property_set(%L, true, ARRAY[%L, %L]::uuid[])$$, :'pa', :'u1', :'u2')) IS NOT NULL AS ok \gset
SELECT id AS uw FROM hospitality.units WHERE property_id = :'pa' AND kind = 'whole_property' \gset
SELECT pg_temp.expect_error('unit: "the whole property" takes no beds of its own',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$unit_update(%L, '{"beds": [{"bed_type": "double", "quantity": 1}]}', %s)$$, :'uw', pg_temp.rev(:'uw'))),
  'נקבעים בכל יחידה');

-- ============================================================
-- 4. the property: location, parking, guest info, house rules, shared amenities
-- ============================================================
SELECT pg_temp.prev(:'pa') AS pr \gset
SELECT pg_temp.after('property: the manager saves location, parking, guest info, house rules and shared amenities',
  pg_temp.h_sql(:'sa', :MGR_A, format($$property_update(%L, %L, %s)$$, :'pa', jsonb_build_object(
    'location', jsonb_build_object('lat', 32.7940231, 'lng', 35.5312),
    'parking', 'paid', 'parking_type', 'shared', 'parking_spaces', 6, 'parking_fee_note', '30 ₪ ללילה',
    'parking_instructions', 'החניה מול השער הירוק',
    'guest_info', 'מכולת במרחק 5 דקות הליכה',
    'rules_smoking', 'outside', 'rules_pets', 'on_request', 'rules_pets_note', 'כלבים קטנים בלבד',
    'rules_events', 'no', 'quiet_from', '22:00', 'quiet_to', '08:00',
    'rules_custom', jsonb_build_array('  לא להזיז רהיטים  ', '', 'לכבות מזגן ביציאה'),
    'amenities', jsonb_build_array(jsonb_build_object('amenity_id', :'am_pool', 'note', 'פתוחה מאי–ספטמבר'))), :pr)),
  format($$SELECT (SELECT latitude = 32.794023 AND longitude = 35.5312 AND parking = 'paid' AND parking_type = 'shared'
                      AND parking_spaces = 6 AND parking_fee_note = '30 ₪ ללילה' AND rules_smoking = 'outside'
                      AND quiet_from = '22:00' AND quiet_to = '08:00'
                      AND rules_custom = ARRAY['לא להזיז רהיטים', 'לכבות מזגן ביציאה']
                    FROM hospitality.properties WHERE id = %1$L)
             AND (SELECT count(*) FROM hospitality.unit_amenities WHERE property_id = %1$L AND unit_id IS NULL) = 1$$, :'pa'));
SELECT tests.check('property: the action log says what changed — free text and location only as "changed"',
  format($$SELECT a -> 'changes' -> 'guest_info' = '{"changed": true}' AND a -> 'changes' -> 'location' = '{"changed": true}'
             AND a -> 'changes' -> 'parking' -> 'to' = '"paid"' AND a -> 'changes' -> 'amenities' -> 'added' ? 'בריכה'
             AND a::text NOT LIKE '%%מכולת%%' AND a::text NOT LIKE '%%32.79%%'
           FROM pg_temp.last_audit(%L, 'catalog.property_updated') a$$, :'sa'));
SELECT pg_temp.after('property: "no parking" clears the type, spaces and price (one consistent state)',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$property_update(%L, '{"parking": "none"}', %s)$$, :'pa', :pr + 1)),
  format($$SELECT (SELECT parking = 'none' AND parking_type IS NULL AND parking_spaces IS NULL AND parking_fee_note IS NULL
                          AND parking_instructions = 'החניה מול השער הירוק'
                     FROM hospitality.properties WHERE id = %L)$$, :'pa'));
SELECT pg_temp.expect_error('property: free / paid parking needs private or shared',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$property_update(%L, '{"parking": "free"}', %s)$$, :'pa', :pr + 2)), 'סוג החניה');
SELECT pg_temp.expect_error('property: quiet hours need both ends',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$property_update(%L, '{"quiet_to": null}', %s)$$, :'pa', :pr + 2)), 'שעות שקט');
SELECT pg_temp.expect_error('property: a quiet-hours time must look like 22:00',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$property_update(%L, '{"quiet_from": "10pm"}', %s)$$, :'pa', :pr + 2)), '22:00');
SELECT pg_temp.expect_error('property: coordinates out of range are refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$property_update(%L, '{"location": {"lat": 95, "lng": 35}}', %s)$$, :'pa', :pr + 2)), 'מחוץ לטווח');
SELECT pg_temp.expect_error('property: a location must be {lat, lng} numbers',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$property_update(%L, '{"location": "https://maps.google.com/?q=1,2"}', %s)$$, :'pa', :pr + 2)), 'המיקום');
SELECT pg_temp.expect_error('property: guest info over 4,000 characters is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$property_update(%L, %L, %s)$$, :'pa', jsonb_build_object('guest_info', repeat('א', 4001)), :pr + 2)), 'ארוך מדי');
SELECT pg_temp.expect_error('property: more than 20 own rules are refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$property_update(%L, %L, %s)$$, :'pa',
    jsonb_build_object('rules_custom', (SELECT jsonb_agg('כלל ' || i) FROM generate_series(1, 21) i)), :pr + 2)), 'עד 20');
SELECT pg_temp.expect_error('property: a rule over 200 characters is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$property_update(%L, %L, %s)$$, :'pa',
    jsonb_build_object('rules_custom', jsonb_build_array(repeat('א', 201))), :pr + 2)), '200');
SELECT pg_temp.expect_error('property: an unknown smoking choice is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$property_update(%L, '{"rules_smoking": "sometimes"}', %s)$$, :'pa', :pr + 2)), 'עישון');
SELECT pg_temp.after('property: removing the location (null)',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$property_update(%L, '{"location": null}', %s)$$, :'pa', :pr + 2)),
  format($$SELECT (SELECT latitude IS NULL AND longitude IS NULL FROM hospitality.properties WHERE id = %L)$$, :'pa'));
SELECT pg_temp.h(:'sa', :OWNER_A, format($$property_update(%L, '{"location": {"lat": 32.79, "lng": 35.53}}', %s)$$, :'pa', :pr + 3)) IS NOT NULL AS ok \gset
SELECT pg_temp.after('property: created with details in one call (owner)',
  pg_temp.h_sql(:'sa', :OWNER_A, $$property_create('{"name": "בקתות הגליל", "property_type": "zimmer", "parking": "free", "parking_type": "private", "rules_pets": "allowed"}')$$),
  $$SELECT (SELECT parking = 'free' AND parking_type = 'private' AND rules_pets = 'allowed' FROM hospitality.properties WHERE id = ($1 ->> 'id')::uuid)$$);
SELECT pg_temp.expect_error('property: site B''s owner cannot change site A''s property',
  pg_temp.h_sql(:'sb', :OWNER_B, format($$property_update(%L, '{"guest_info": "x"}', %s)$$, :'pa', pg_temp.prev(:'pa'))), 'המתחם לא נמצא');
SELECT pg_temp.expect_error('property: anonymous callers cannot change properties',
  pg_temp.h_sql(:'sa', NULL, format($$property_update(%L, '{"guest_info": "x"}', %s)$$, :'pa', pg_temp.prev(:'pa'))), 'permission denied');

-- removing an amenity from the catalogue takes it off every unit / property, which get a new revision
SELECT pg_temp.rev(:'u1') AS r_before_rm \gset
SELECT pg_temp.prev(:'pa') AS p_before_rm \gset
SELECT pg_temp.after('amenities: removing one from the catalogue removes it everywhere; the unit gets a new revision',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$amenity_delete(%L)$$, :'am_wifi')),
  format($$SELECT ($1 ->> 'units')::integer = 1
             AND NOT EXISTS (SELECT 1 FROM hospitality.unit_amenities WHERE amenity_id = %L)
             AND pg_temp.rev(%L) = %s + 1 AND pg_temp.prev(%L) = %s$$, :'am_wifi', :'u1', :r_before_rm, :'pa', :p_before_rm));

-- ============================================================
-- 5. private arrival info (staff)
-- ============================================================
SELECT pg_temp.after('arrival: the manager saves the property''s gate code and Wi-Fi (revision 1)',
  pg_temp.h_sql(:'sa', :MGR_A, format($$arrival_info_set(%L, NULL, '{"gate_code": "4321#", "wifi_name": "Zayit", "wifi_password": "olive-2026"}', NULL)$$, :'pa')),
  $$SELECT ($1 ->> 'revision')::integer = 1$$);
SELECT pg_temp.after('arrival: the owner saves a door code for one zimmer',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$arrival_info_set(%L, %L, '{"entry_code": "1111"}', NULL)$$, :'pa', :'u1')),
  $$SELECT ($1 ->> 'revision')::integer = 1$$);
SELECT tests.check('arrival: the action log names the fields — never the values',
  format($$SELECT (SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = %1$L AND action = 'catalog.arrival_info_updated') = 2
             AND NOT EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id = %1$L
                              AND (changes::text LIKE '%%4321%%' OR changes::text LIKE '%%olive%%' OR changes::text LIKE '%%1111%%'
                                   OR changes::text LIKE '%%Zayit%%'))
             AND (pg_temp.last_audit(%1$L, 'catalog.arrival_info_updated') -> 'changes' -> 'fields') = '["entry_code"]'
             AND (pg_temp.last_audit(%1$L, 'catalog.arrival_info_updated') ->> 'target_label') = 'צימר הזית'$$, :'sa'));
SELECT pg_temp.after('arrival: staff see the property values and each unit''s',
  pg_temp.h_sql(:'sa', :MGR_A, format($$arrival_info_view(%L)$$, :'pa')),
  format($$SELECT $1 -> 'property' ->> 'gate_code' = '4321#' AND ($1 ->> 'can_edit')::boolean
             AND (SELECT u -> 'info' ->> 'entry_code' FROM jsonb_array_elements($1 -> 'units') u WHERE u ->> 'unit_id' = %L) = '1111'
             AND (SELECT u -> 'info' FROM jsonb_array_elements($1 -> 'units') u WHERE u ->> 'unit_id' = %L) = 'null'
             AND jsonb_array_length($1 -> 'units') = 2$$, :'u1', :'u2'));
SELECT pg_temp.expect_error('arrival: a stale revision is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$arrival_info_set(%L, NULL, '{"gate_code": "9999"}', NULL)$$, :'pa')), 'עודכנו בינתיים');
SELECT pg_temp.expect_error('arrival: a value over the limit is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$arrival_info_set(%L, NULL, %L, 1)$$, :'pa', jsonb_build_object('wifi_password', repeat('x', 101)))), 'ארוך מדי');
SELECT pg_temp.expect_error('arrival: a unit of another property is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$arrival_info_set(%L, %L, '{"entry_code": "1"}', NULL)$$, :'pa', :'uw')), 'היחידה לא נמצאה');
SELECT pg_temp.expect_error('arrival: site B''s owner cannot read A''s codes through A',
  pg_temp.h_sql(:'sa', :OWNER_B, format($$arrival_info_view(%L)$$, :'pa')), 'אין הרשאה');
SELECT pg_temp.expect_error('arrival: through its own site, B does not find A''s property',
  pg_temp.h_sql(:'sb', :OWNER_B, format($$arrival_info_view(%L)$$, :'pa')), 'המתחם לא נמצא');
SELECT pg_temp.expect_error('arrival: a signed-in guest cannot read the staff view',
  pg_temp.h_sql(:'sa', :GUEST, format($$arrival_info_view(%L)$$, :'pa')), 'אין הרשאה');
SELECT pg_temp.expect_error('arrival: anonymous callers cannot read the staff view',
  pg_temp.h_sql(:'sa', NULL, format($$arrival_info_view(%L)$$, :'pa')), 'permission denied');
SELECT pg_temp.expect_error('arrival: a store owner cannot read it',
  pg_temp.h_sql(:SHOP, :SHOP_OWNER, format($$arrival_info_view(%L)$$, :'pa')), 'אין הרשאה');
SELECT pg_temp.expect_error('arrival: staff cannot read the table directly',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT to_jsonb(count(*)) FROM hospitality.arrival_info')$$, :'sa', :OWNER_A),
  'permission denied');
SELECT pg_temp.h(:'sa', :OWNER_A, format($$arrival_info_set(%L, %L, '{"entry_code": "2222"}', NULL)$$, :'pa', :'u2')) IS NOT NULL AS ok \gset
SELECT pg_temp.after('arrival: emptying every value removes the row',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$arrival_info_set(%L, %L, '{"entry_code": null}', 1)$$, :'pa', :'u2')),
  format($$SELECT $1 -> 'revision' = 'null' AND NOT EXISTS (SELECT 1 FROM hospitality.arrival_info WHERE unit_id = %L)$$, :'u2'));

-- ============================================================
-- 6. the booking engine: guest limits and the house-rules snapshot
-- ============================================================
-- u1: capacity 4, max adults 2, max children 2
SELECT pg_temp.expect_error('limits: a staff quote with 3 adults is refused (max adults 2)',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.quote(%%L, %%L, %%L, 3, 0)', %L::uuid, pg_temp.d(30), pg_temp.d(32)))$$,
         :'sa', :OWNER_A, :'u1'),
  'עד 2 מבוגרים');
SELECT pg_temp.expect_error('limits: a site visitor''s quote with 3 children is refused (max children 2)',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L, 1, 3)', %L::uuid, pg_temp.d(30), pg_temp.d(32)))$$,
         :'sa', :'u1'),
  'עד 2 ילדים');
SELECT tests.check('limits: 2 adults + 2 children fit (total 4)',
  format($$SELECT (pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L, 2, 2)', %L::uuid, pg_temp.d(30), pg_temp.d(32))) ->> 'available')::boolean$$,
         :'sa', :'u1'));
SELECT pg_temp.expect_error('limits: a site request with 3 adults is refused',
  format($$SELECT pg_temp.req(%L, %L, pg_temp.d(30), pg_temp.d(32), 'lim@example.com', '0541110000', 'key-2d-lim-01', 3, 0)$$, :'sa', :'u1'),
  'עד 2 מבוגרים');
SELECT pg_temp.expect_error('limits: a manual booking with 3 children is refused',
  format($$SELECT pg_temp.manual(%L, %L, %L, pg_temp.d(30), pg_temp.d(32), 1, 3)$$, :'sa', :OWNER_A, :'u1'),
  'עד 2 ילדים');
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_update(%L, '{"max_children": 0}', %s)$$, :'u2', pg_temp.rev(:'u2'))) IS NOT NULL AS ok \gset
SELECT pg_temp.expect_error('limits: max children 0 → "not suitable for children"',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.quote(%%L, %%L, %%L, 2, 1)', %L::uuid, pg_temp.d(30), pg_temp.d(32)))$$,
         :'sa', :OWNER_A, :'u2'),
  'לא מתאימה לילדים');

-- a booking takes the house rules that apply now
SELECT pg_temp.manual(:'sa', :OWNER_A, :'u1', pg_temp.d(1), pg_temp.d(2)) AS bk_json \gset
SELECT (:'bk_json'::jsonb) ->> 'booking_id' AS bk, (:'bk_json'::jsonb) ->> 'manage_token' AS bk_token \gset
SELECT tests.check('snapshot: a new manual booking stores the house rules (incl. check-in / out times)',
  format($$SELECT b.house_rules_snapshot @> '{"smoking": "outside", "pets": "on_request", "events": "no", "quiet_from": "22:00",
                                              "quiet_to": "08:00", "check_in_time": "15:00", "check_out_time": "11:00"}'
             AND b.house_rules_snapshot -> 'custom' = '["לא להזיז רהיטים", "לכבות מזגן ביציאה"]'
           FROM hospitality.bookings b WHERE b.id = %L$$, :'bk'));
SELECT pg_temp.req(:'sa', :'u1', pg_temp.d(40), pg_temp.d(42), 'rules@example.com', '0541112222', 'key-2d-rules-01') ->> 'booking_id' AS bs \gset
SELECT tests.check('snapshot: a site request stores the house rules too',
  format($$SELECT house_rules_snapshot ->> 'smoking' = 'outside' FROM hospitality.bookings WHERE id = %L$$, :'bs'));
SELECT pg_temp.h(:'sa', :OWNER_A, format($$property_update(%L, '{"rules_smoking": "forbidden", "rules_custom": []}', %s)$$, :'pa', pg_temp.prev(:'pa'))) IS NOT NULL AS ok \gset
SELECT tests.check('snapshot: changing the rules later does not change existing bookings',
  format($$SELECT bool_and(house_rules_snapshot ->> 'smoking' = 'outside') FROM hospitality.bookings WHERE id IN (%L, %L)$$, :'bk', :'bs'));
SELECT pg_temp.after('snapshot: a modified booking keeps its original rules; the guest limits apply on modify',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.modify_booking(%%L, %%s, %%L, %%L)', %L::uuid,
           (SELECT revision FROM hospitality.bookings WHERE id = %L), pg_temp.d(1), pg_temp.d(3)))$$, :'sa', :OWNER_A, :'bk', :'bk'),
  format($$SELECT (SELECT house_rules_snapshot ->> 'smoking' = 'outside' AND check_out = pg_temp.d(3) FROM hospitality.bookings WHERE id = %L)$$, :'bk'));
SELECT pg_temp.expect_error('limits: modifying a booking to 3 adults is refused',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.modify_booking(%%L, %%s, %%L, %%L, NULL, 3, 0)', %L::uuid,
           (SELECT revision FROM hospitality.bookings WHERE id = %L), pg_temp.d(1), pg_temp.d(3)))$$, :'sa', :OWNER_A, :'bk', :'bk'),
  'עד 2 מבוגרים');
SELECT tests.check('snapshot: even a direct update cannot change it',
  format($$WITH x AS (UPDATE hospitality.bookings SET house_rules_snapshot = '{}' WHERE id = %1$L RETURNING 1)
           SELECT (SELECT count(*) FROM x) = 1$$, :'bk'));
SELECT tests.check('snapshot: … it is still the original',
  format($$SELECT house_rules_snapshot ->> 'smoking' = 'outside' FROM hospitality.bookings WHERE id = %L$$, :'bk'));

-- ============================================================
-- 7. private arrival info for the guest
-- ============================================================
SELECT pg_temp.after('guest: a confirmed booking within 48 hours of check-in gets the property and its own unit''s values',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.guest_arrival_info(%%L)', %L))$$, :'sa', :'bk_token'),
  $$SELECT ($1 ->> 'available')::boolean AND $1 -> 'property' ->> 'gate_code' = '4321#'
       AND $1 -> 'property' ->> 'wifi_password' = 'olive-2026' AND NOT ($1 -> 'property' ? 'revision')
       AND jsonb_array_length($1 -> 'units') = 1 AND $1 -> 'units' -> 0 -> 'info' ->> 'entry_code' = '1111'$$);
SELECT pg_temp.manual(:'sa', :OWNER_A, :'u2', pg_temp.d(20), pg_temp.d(22)) ->> 'manage_token' AS far_token \gset
SELECT pg_temp.after('guest: too early (more than 48 hours before check-in) — no values, only when',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.guest_arrival_info(%%L)', %L))$$, :'sa', :'far_token'),
  $$SELECT NOT ($1 ->> 'available')::boolean AND $1 ->> 'reason' = 'too_early' AND $1 ? 'available_from'
       AND NOT ($1 ? 'property') AND $1::text NOT LIKE '%4321%'$$);
SELECT pg_temp.manual(:'sa', :OWNER_A, :'u2', pg_temp.d(1), pg_temp.d(2), 2, 0, 'pending_approval') ->> 'manage_token' AS pending_token \gset
SELECT pg_temp.after('guest: a booking that is not confirmed gets nothing',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.guest_arrival_info(%%L)', %L))$$, :'sa', :'pending_token'),
  $$SELECT NOT ($1 ->> 'available')::boolean AND $1 ->> 'reason' = 'not_confirmed' AND $1::text NOT LIKE '%4321%'$$);
SELECT pg_temp.expect_error('guest: a wrong link gets "not found"',
  format($$SELECT pg_temp.call(%L, NULL, %L)$$, :'sa', format('SELECT hospitality.guest_arrival_info(%L)', repeat('a', 64))),
  'ההזמנה לא נמצאה');
SELECT pg_temp.expect_error('guest: the link of site A does not work on site B',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.guest_arrival_info(%%L)', %L))$$, :'sb', :'bk_token'),
  'ההזמנה לא נמצאה');
SELECT pg_temp.expect_error('guest: a signed-in stranger cannot read a booking by id',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.guest_arrival_info(NULL, %%L)', %L))$$, :'sa', :GUEST, :'bk'),
  'ההזמנה לא נמצאה');
SELECT pg_temp.h(:'sa', :OWNER_A, format($$cancel_booking(%L, 'בדיקה', NULL, NULL, %s)$$, :'bk',
                                         (SELECT revision FROM hospitality.bookings WHERE id = :'bk'))) IS NOT NULL AS ok \gset
SELECT pg_temp.after('guest: after cancellation the link shows nothing',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.guest_arrival_info(%%L)', %L))$$, :'sa', :'bk_token'),
  $$SELECT NOT ($1 ->> 'available')::boolean AND $1::text NOT LIKE '%4321%'$$);

-- ============================================================
-- 8. isolation and Ecommerce
-- ============================================================
SELECT pg_temp.after('isolation: site B''s view has none of A''s amenities',
  pg_temp.h_sql(:'sb', :OWNER_B, 'catalog_view()'),
  $$SELECT jsonb_array_length($1 -> 'amenities') = 0$$);
SELECT tests.check('isolation: every 2d log row of A is in A''s log',
  format($$SELECT NOT EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id <> %L
                                AND action IN ('catalog.amenity_added', 'catalog.arrival_info_updated')
                                AND target_label IN ('צימר הזית', 'חוות הזית', 'ג׳קוזי', 'סאונה יבשה'))$$, :'sa'));
SELECT tests.check('ecommerce: store data unchanged',
  $$SELECT pg_temp.ecommerce_hash() = (SELECT h FROM c2d_before)$$);

-- ---------- cleanup ----------
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_delete_tenant(%1$L, 'c2d-a'), public.platform_delete_tenant(%2$L, 'c2d-b')])$$, :'sa', :'sb')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_management_enabled', false),
                                    public.platform_set_flag('hospitality_booking_enabled', false)])$$) IS NOT NULL AS ok \gset
DROP TABLE c2d_before;

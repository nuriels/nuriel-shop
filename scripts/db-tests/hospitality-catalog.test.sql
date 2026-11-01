-- ============================================================
-- Hospitality: properties and units (Hospitality Stage 2c.1 — 20261101180000_hosp_catalog.sql)
--   • permissions: owner / manager / platform admin; outsiders (other site's owner, guest, store
--     owner, anonymous) refused; owner-only archive and delete (catalog.owner)
--   • no direct writes to properties / units / unit_members — only the functions
--   • validation in Hebrew, generated slugs, revision ("updated in the meantime"), audit
--   • plan unit limit, activate / deactivate, archive, delete only without history
--   • "the whole property": members rules, future bookings / blocks freeze its members
--   • reorder; the view; site isolation; Ecommerce data unchanged
-- Parallel cases: scripts/db-tests/hospitality/concurrency/run.sh (scenarios 27–32)
-- ============================================================
\set OWNER_A '''a0000000-0000-0000-0000-0000000006a1'''
\set MGR_A '''a0000000-0000-0000-0000-0000000006a2'''
\set OWNER_B '''a0000000-0000-0000-0000-0000000006b1'''
\set GUEST '''a0000000-0000-0000-0000-0000000006c1'''
\set SHOP_OWNER '''a0000000-0000-0000-0000-0000000006e1'''
\set OWNER_OFF '''a0000000-0000-0000-0000-0000000006f1'''
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set SHOP '''72c00000-0000-0000-0000-0000000000e1'''

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
-- a catalog call as somebody, on a site — returns the function's jsonb
CREATE OR REPLACE FUNCTION pg_temp.cat(_site text, _uid uuid, _call text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, 'SELECT to_jsonb(hospitality.' || _call || ')');
$f$;
CREATE OR REPLACE FUNCTION pg_temp.cat_sql(_site text, _uid uuid, _call text) RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT pg_temp.cat(%L, %L, %L)', _site, _uid, _call);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.audit_count(_site uuid, _action text) RETURNS bigint LANGUAGE sql AS $f$
  SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = _site AND action = _action;
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-0000000006a1', 'c2c.owner.a@test.local', now()),
  ('a0000000-0000-0000-0000-0000000006a2', 'c2c.mgr.a@test.local', now()),
  ('a0000000-0000-0000-0000-0000000006b1', 'c2c.owner.b@test.local', now()),
  ('a0000000-0000-0000-0000-0000000006c1', 'c2c.guest@test.local', now()),
  ('a0000000-0000-0000-0000-0000000006e1', 'c2c.shop.owner@test.local', now()),
  ('a0000000-0000-0000-0000-0000000006f1', 'c2c.owner.off@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('c2c-a', 'אירוח קטלוג A'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('c2c-b', 'אירוח קטלוג B'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('c2c-off', 'אירוח בלי ניהול'))$$) IS NOT NULL AS ok \gset
SELECT id AS sa FROM public.tenants WHERE slug = 'c2c-a' \gset
SELECT id AS sb FROM public.tenants WHERE slug = 'c2c-b' \gset
SELECT id AS so FROM public.tenants WHERE slug = 'c2c-off' \gset
SELECT pg_temp.add_role(:'sa', :OWNER_A, 'c2c_owner_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sa', :MGR_A, 'c2c_mgr_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sb', :OWNER_B, 'c2c_owner_b') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'so', :OWNER_OFF, 'c2c_owner_off') IS NOT NULL AS ok \gset
UPDATE public.user_roles SET is_protected = true WHERE user_id IN (:OWNER_A, :OWNER_B, :OWNER_OFF);
INSERT INTO public.tenants (id, slug, name) VALUES (:SHOP, 'c2c-shop', 'חנות 2c');
SELECT pg_temp.add_role(:SHOP, :SHOP_OWNER, 'c2c_shop_owner') IS NOT NULL AS ok \gset
UPDATE public.user_roles SET is_protected = true WHERE user_id = :SHOP_OWNER;
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %3$L)])$$, :'sa', :'sb', :'so')) IS NOT NULL AS ok \gset
-- the Ecommerce state after the fixtures (incl. the store above) — nothing below may change it
CREATE TEMP TABLE c2c_before AS SELECT pg_temp.ecommerce_hash() AS h;

-- ============================================================
-- 1. structure
-- ============================================================
SELECT tests.check('catalog: catalog.owner is the owner''s only (13 permissions here; 14 since reports.finance, stage F3)',
  $$SELECT cardinality(hospitality.permissions()) >= 13 AND 'catalog.owner' = ANY (hospitality.permissions())$$);
SELECT tests.check('catalog: manager can(catalog) and not can(catalog.owner); owner and platform admin can both',
  format($$SELECT pg_temp.call(%1$L, %2$L, 'SELECT to_jsonb(ARRAY[hospitality.can(''catalog''), hospitality.can(''catalog.owner'')])') = '[true, false]'
           AND pg_temp.call(%1$L, %3$L, 'SELECT to_jsonb(ARRAY[hospitality.can(''catalog''), hospitality.can(''catalog.owner'')])') = '[true, true]'
           AND pg_temp.call(%1$L, %4$L, 'SELECT to_jsonb(ARRAY[hospitality.can(''catalog''), hospitality.can(''catalog.owner'')])') = '[true, true]'$$,
         :'sa', :MGR_A, :OWNER_A, :PLATFORM));
SELECT tests.check('catalog: no direct INSERT / UPDATE / DELETE for authenticated on properties, units, unit_members; SELECT kept',
  $$SELECT bool_and(NOT has_table_privilege('authenticated', t, 'INSERT') AND NOT has_table_privilege('authenticated', t, 'UPDATE')
                    AND NOT has_table_privilege('authenticated', t, 'DELETE') AND has_table_privilege('authenticated', t, 'SELECT'))
      FROM unnest(ARRAY['hospitality.properties', 'hospitality.units', 'hospitality.unit_members']) t$$);
SELECT tests.check('catalog: beds and amenities — read with RLS; writes only through the 2d functions (migration 11)',
  $$SELECT has_table_privilege('authenticated', 'hospitality.unit_beds', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'hospitality.unit_beds', 'INSERT')
       AND NOT has_table_privilege('authenticated', 'hospitality.amenities', 'UPDATE')$$);
SELECT tests.check('catalog: every catalog function is SECURITY DEFINER, callable by authenticated, never by anon / PUBLIC',
  $$SELECT bool_and(p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
      FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace
       AND p.proname IN ('catalog_view', 'property_create', 'property_update', 'property_archive', 'property_delete',
                         'unit_create', 'unit_update', 'unit_set_active', 'unit_delete', 'whole_property_set', 'catalog_reorder')
    HAVING count(*) = 11$$);
SELECT tests.check('catalog: internal helpers are not callable by API roles',
  $$SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
      FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace
       AND p.proname IN ('_cv_text', '_cv_int', '_cv_choice', '_catalog_tenant', '_inventory_lock', '_catalog_slug',
                         '_unit_has_history', '_unit_has_future', '_unit_json', '_unit_in_active_whole', '_unit_apply')
    HAVING count(*) = 11$$);
SELECT tests.check('catalog: type columns with their lists, revision on both tables',
  $$SELECT (SELECT count(*) FROM pg_constraint WHERE conname IN ('properties_property_type_check', 'units_unit_type_check')) = 2
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'units' AND column_name = 'revision')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'properties' AND column_name = 'revision')$$);

-- ============================================================
-- 2. properties
-- ============================================================
SELECT pg_temp.cat(:'sa', :OWNER_A, $$property_create('{"name": "מתחם הגפן", "property_type": "zimmer_complex", "address": "רמות 1"}')$$) ->> 'id' AS pa \gset
SELECT tests.check('property: the owner creates one — Hebrew slug, draft, revision 1, audit row',
  format($$SELECT p.slug = 'מתחם-הגפן' AND p.status = 'draft' AND p.revision = 1 AND p.property_type = 'zimmer_complex'
             AND pg_temp.audit_count(%L, 'catalog.property_created') = 1
           FROM hospitality.properties p WHERE p.id = %L$$, :'sa', :'pa'));
SELECT pg_temp.cat(:'sa', :MGR_A, $$property_create('{"name": "מתחם הגפן", "property_type": "villa", "status": "active"}')$$) ->> 'id' AS pa2 \gset
SELECT tests.check('property: a manager creates one too; the same name gets a unique slug',
  format($$SELECT slug = 'מתחם-הגפן-2' AND status = 'active' FROM hospitality.properties WHERE id = %L$$, :'pa2'));
SELECT tests.check('property: the action log names the manager as the actor',
  format($$SELECT actor_role = 'manager' FROM hospitality.audit_log WHERE tenant_id = %L AND action = 'catalog.property_created'
           ORDER BY id DESC LIMIT 1$$, :'sa'));
SELECT pg_temp.expect_error('property: the name is required (Hebrew message)',
  pg_temp.cat_sql(:'sa', :OWNER_A, $$property_create('{"property_type": "villa"}')$$), 'יש למלא את שם המתחם');
SELECT pg_temp.expect_error('property: the type must come from the list',
  pg_temp.cat_sql(:'sa', :OWNER_A, $$property_create('{"name": "x", "property_type": "castle"}')$$), 'סוג המקום — יש לבחור מהרשימה');
SELECT pg_temp.expect_error('property: it cannot be created archived',
  pg_temp.cat_sql(:'sa', :OWNER_A, $$property_create('{"name": "x", "property_type": "villa", "status": "archived"}')$$), 'מצב המתחם — יש לבחור מהרשימה');
SELECT pg_temp.expect_error('property: unknown fields are refused (no slug / tenant / sort order from the client)',
  pg_temp.cat_sql(:'sa', :OWNER_A, $$property_create('{"name": "x", "property_type": "villa", "slug": "mine"}')$$), 'שדה לא מוכר: slug');
SELECT pg_temp.expect_error('property: a too long name is refused',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('property_create(%L)', jsonb_build_object('name', repeat('א', 121), 'property_type', 'villa'))), 'ארוך מדי (עד 120 תווים)');
SELECT pg_temp.after('property: update — name and status; revision 2; the log keeps from / to',
  pg_temp.cat_sql(:'sa', :MGR_A, format('property_update(%L, ''{"name": "מתחם הגפן הגדול", "status": "active"}'', 1)', :'pa')),
  format($$SELECT ($1 ->> 'revision')::int = 2
             AND (SELECT changes -> 'name' ->> 'to' = 'מתחם הגפן הגדול' AND changes -> 'status' ->> 'from' = 'draft'
                    FROM hospitality.audit_log WHERE tenant_id = %L AND action = 'catalog.property_updated' ORDER BY id DESC LIMIT 1)$$, :'sa'));
SELECT pg_temp.expect_error('property: a save from an old revision is refused (updated in the meantime)',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('property_update(%L, ''{"address": "x"}'', 1)', :'pa')), 'המתחם עודכן בינתיים');
SELECT pg_temp.after('property: an unchanged value does not change the revision or the log',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('property_update(%L, ''{"name": "מתחם הגפן הגדול"}'', 2)', :'pa')),
  format($$SELECT ($1 ->> 'revision')::int = 2 AND pg_temp.audit_count(%L, 'catalog.property_updated') = 1$$, :'sa'));
SELECT pg_temp.after('property: the description is logged as "changed", never its text',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('property_update(%L, ''{"description": "טקסט ארוך ופרטי"}'', 2)', :'pa')),
  format($$SELECT NOT EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id = %L AND changes::text LIKE '%%ופרטי%%')$$, :'sa'));

-- ============================================================
-- 3. outsiders and switched-off areas
-- ============================================================
SELECT pg_temp.expect_error('outsiders: the owner of site B cannot see A''s property (not found — no leak)',
  pg_temp.cat_sql(:'sb', :OWNER_B, format('property_update(%L, ''{"name": "x"}'', 3)', :'pa')), 'המתחם לא נמצא');
SELECT pg_temp.expect_error('outsiders: the owner of site B with A''s header is refused',
  pg_temp.cat_sql(:'sa', :OWNER_B, 'catalog_view()'), 'אין הרשאה');
SELECT pg_temp.expect_error('outsiders: a signed-in guest is refused',
  pg_temp.cat_sql(:'sa', :GUEST, 'property_create(''{"name": "x", "property_type": "villa"}'')'), 'אין הרשאה');
SELECT pg_temp.expect_error('outsiders: a store owner on the store is refused',
  pg_temp.cat_sql(:SHOP, :SHOP_OWNER, 'catalog_view()'), 'אין הרשאה');
SELECT pg_temp.expect_error('outsiders: a store owner with the Hospitality site header is refused',
  pg_temp.cat_sql(:'sa', :SHOP_OWNER, 'unit_create(' || quote_literal(:'pa') || ', ''{"name": "x", "unit_type": "zimmer"}'')'), 'אין הרשאה');
SELECT pg_temp.expect_error('outsiders: anonymous cannot call any catalog function',
  pg_temp.cat_sql(:'sa', NULL, 'catalog_view()'), 'permission denied');
SELECT pg_temp.expect_error('switched off: without the management flag the functions are closed',
  pg_temp.cat_sql(:'so', :OWNER_OFF, 'property_create(''{"name": "x", "property_type": "villa"}'')'), 'אזור הניהול אינו פעיל');
SELECT pg_temp.expect_error('switched off: also the view',
  pg_temp.cat_sql(:'so', :OWNER_OFF, 'catalog_view()'), 'אזור הניהול אינו פעיל');

-- ============================================================
-- 4. units
-- ============================================================
SELECT pg_temp.cat(:'sa', :MGR_A, format('unit_create(%L, ''{"name": "צימר הגפן", "unit_type": "zimmer"}'')', :'pa')) ->> 'id' AS u1 \gset
SELECT tests.check('unit: a manager adds one — defaults (2 guests, 2 included, child to 12, 1+1 rooms), active, slug, log',
  format($$SELECT u.kind = 'unit' AND u.unit_type = 'zimmer' AND u.capacity = 2 AND u.base_occupancy = 2 AND u.child_age_limit = 12
             AND u.bedrooms = 1 AND u.bathrooms = 1 AND u.is_active AND u.slug = 'צימר-הגפן' AND u.revision = 1
             AND pg_temp.audit_count(%L, 'catalog.unit_created') = 1
           FROM hospitality.units u WHERE u.id = %L$$, :'sa', :'u1'));
SELECT pg_temp.cat(:'sa', :OWNER_A, format('unit_create(%L, ''{"name": "חדר 1", "unit_type": "room", "kind": "room", "capacity": 1}'')', :'pa')) ->> 'id' AS u2 \gset
SELECT tests.check('unit: one guest only → one included (not the default 2)',
  format($$SELECT kind = 'room' AND capacity = 1 AND base_occupancy = 1 FROM hospitality.units WHERE id = %L$$, :'u2'));
SELECT pg_temp.cat(:'sa', :OWNER_A, format('unit_create(%L, ''{"name": "סוויטה", "unit_type": "suite", "capacity": 6, "base_occupancy": 4, "bedrooms": 2, "bathrooms": 2, "child_age_limit": 10, "description": "נוף לכנרת"}'')', :'pa')) ->> 'id' AS u3 \gset
SELECT tests.check('unit: every field is saved',
  format($$SELECT capacity = 6 AND base_occupancy = 4 AND bedrooms = 2 AND bathrooms = 2 AND child_age_limit = 10
             AND description = 'נוף לכנרת' FROM hospitality.units WHERE id = %L$$, :'u3'));
SELECT pg_temp.expect_error('unit: the type is required',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_create(%L, ''{"name": "x"}'')', :'pa')), 'סוג היחידה — יש לבחור מהרשימה');
SELECT pg_temp.expect_error('unit: the name is required',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_create(%L, ''{"unit_type": "zimmer"}'')', :'pa')), 'יש למלא את שם היחידה');
SELECT pg_temp.expect_error('unit: more included guests than the maximum is refused',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_create(%L, ''{"name": "x", "unit_type": "zimmer", "capacity": 2, "base_occupancy": 3}'')', :'pa')),
  'לא יכול להיות גדול ממספר האורחים המרבי');
SELECT pg_temp.expect_error('unit: 0 guests is refused',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_create(%L, ''{"name": "x", "unit_type": "zimmer", "capacity": 0}'')', :'pa')),
  'מספר האורחים המרבי חייב להיות מספר שלם בין 1 ל-100');
SELECT pg_temp.expect_error('unit: a fraction is refused',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_create(%L, ''{"name": "x", "unit_type": "zimmer", "capacity": 2.5}'')', :'pa')),
  'חייב להיות מספר שלם');
SELECT pg_temp.expect_error('unit: a number as text is refused',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_create(%L, ''{"name": "x", "unit_type": "zimmer", "capacity": "4"}'')', :'pa')),
  'חייב להיות מספר שלם');
SELECT pg_temp.expect_error('unit: "the whole property" cannot be created as a unit',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_create(%L, ''{"name": "x", "unit_type": "other", "kind": "whole_property"}'')', :'pa')),
  'השכרת המתחם כולו');
SELECT pg_temp.expect_error('unit: prices are not set here (2f) — unknown field',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_create(%L, ''{"name": "x", "unit_type": "zimmer", "base_price": 1}'')', :'pa')),
  'שדה לא מוכר: base_price');
SELECT pg_temp.expect_error('unit: into another site''s property → not found',
  pg_temp.cat_sql(:'sb', :OWNER_B, format('unit_create(%L, ''{"name": "x", "unit_type": "zimmer"}'')', :'pa')), 'המתחם לא נמצא');
SELECT pg_temp.after('unit: update — capacity and kind (unit → room); revision 2; the log has from / to',
  pg_temp.cat_sql(:'sa', :MGR_A, format('unit_update(%L, ''{"capacity": 4, "kind": "room"}'', 1)', :'u1')),
  format($$SELECT ($1 ->> 'revision')::int = 2
             AND (SELECT changes -> 'capacity' ->> 'to' = '4' AND changes -> 'kind' ->> 'to' = 'room'
                    FROM hospitality.audit_log WHERE tenant_id = %L AND action = 'catalog.unit_updated' ORDER BY id DESC LIMIT 1)$$, :'sa'));
SELECT pg_temp.expect_error('unit: a save from an old revision is refused',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_update(%L, ''{"capacity": 3}'', 1)', :'u1')), 'היחידה עודכנה בינתיים');
SELECT pg_temp.expect_error('unit: lowering the maximum under the included guests is refused',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_update(%L, ''{"capacity": 3}'', 1)', :'u3')), 'לא יכול להיות גדול ממספר האורחים המרבי');
SELECT pg_temp.expect_error('unit: cannot become "the whole property" by an update',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_update(%L, ''{"kind": "whole_property"}'', 2)', :'u1')), 'השכרת המתחם כולו');
SELECT pg_temp.expect_error('unit: the owner of site B cannot update it (not found)',
  pg_temp.cat_sql(:'sb', :OWNER_B, format('unit_update(%L, ''{"capacity": 3}'', 2)', :'u1')), 'היחידה לא נמצאה');

-- ============================================================
-- 5. direct writes (as through PostgREST) are refused; reads keep RLS
-- ============================================================
SELECT pg_temp.expect_error('direct: the owner cannot insert a unit',
  format($$SELECT pg_temp.call(%L, %L, format('INSERT INTO hospitality.units (tenant_id, property_id, name, slug) VALUES (%%L, %%L, ''x'', ''x'') RETURNING to_jsonb(id)', %L::uuid, %L::uuid))$$,
         :'sa', :OWNER_A, :'sa', :'pa'), 'permission denied');
SELECT pg_temp.expect_error('direct: the owner cannot update a unit',
  format($$SELECT pg_temp.call(%L, %L, 'UPDATE hospitality.units SET capacity = 9 RETURNING to_jsonb(id)')$$, :'sa', :OWNER_A), 'permission denied');
SELECT pg_temp.expect_error('direct: the owner cannot delete a property',
  format($$SELECT pg_temp.call(%L, %L, 'DELETE FROM hospitality.properties RETURNING to_jsonb(id)')$$, :'sa', :OWNER_A), 'permission denied');
SELECT pg_temp.expect_error('direct: a manager cannot add members to "the whole property"',
  format($$SELECT pg_temp.call(%L, %L, format('INSERT INTO hospitality.unit_members (tenant_id, parent_unit_id, member_unit_id) VALUES (%%L, %%L, %%L) RETURNING to_jsonb(true)', %L::uuid, %L::uuid, %L::uuid))$$,
         :'sa', :MGR_A, :'sa', :'u1', :'u2'), 'permission denied');
SELECT tests.check('direct: reads still work for staff and stay per site',
  format($$SELECT (pg_temp.call(%1$L, %2$L, 'SELECT to_jsonb(count(*)) FROM hospitality.units'))::int = 3
             AND (pg_temp.call(%3$L, %4$L, 'SELECT to_jsonb(count(*)) FROM hospitality.units'))::int = 0
             AND (pg_temp.call(%1$L, %4$L, 'SELECT to_jsonb(count(*)) FROM hospitality.units'))::int = 0$$,
         :'sa', :MGR_A, :'sb', :OWNER_B));

-- ============================================================
-- 6. "the whole property"
-- ============================================================
SELECT pg_temp.expect_error('whole: at least two units',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('whole_property_set(%L, true, ARRAY[%L]::uuid[])', :'pa', :'u1')), 'לפחות שתי יחידות פעילות');
SELECT pg_temp.cat(:'sa', :OWNER_A, format('unit_create(%L, ''{"name": "צימר בווילה", "unit_type": "zimmer"}'')', :'pa2')) ->> 'id' AS ux \gset
SELECT pg_temp.expect_error('whole: a unit of another property is refused',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('whole_property_set(%L, true, ARRAY[%L, %L]::uuid[])', :'pa', :'u1', :'ux')), 'לפחות שתי יחידות פעילות');
SELECT pg_temp.cat(:'sa', :MGR_A, format('whole_property_set(%L, true, ARRAY[%L, %L, %L]::uuid[])', :'pa', :'u1', :'u2', :'u1')) ->> 'id' AS uw \gset
SELECT tests.check('whole: created with the chosen units (duplicates ignored); capacity is their sum; not counted in the plan',
  format($$SELECT w.kind = 'whole_property' AND w.is_active AND w.capacity = 5 AND w.name = 'כל המתחם — מתחם הגפן הגדול'
             AND (SELECT array_agg(member_unit_id ORDER BY member_unit_id) FROM hospitality.unit_members WHERE parent_unit_id = w.id)
                 = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[%L, %L]::uuid[]) x)
             AND hospitality._units_used(%L) = 4
           FROM hospitality.units w WHERE w.id = %L$$, :'u1', :'u2', :'sa', :'uw'));
SELECT pg_temp.expect_error('whole: a member of the active whole cannot be switched off',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_set_active(%L, false)', :'u2')), 'כלולה ב"כל המתחם" הפעיל');
SELECT pg_temp.expect_error('whole: a member cannot be deleted',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_delete(%L)', :'u2')), 'כלולה ב"כל המתחם"');
SELECT pg_temp.after('whole: members can change while nothing is booked',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('whole_property_set(%L, true, ARRAY[%L, %L]::uuid[])', :'pa', :'u1', :'u3')),
  format($$SELECT (SELECT array_agg(member_unit_id ORDER BY member_unit_id) FROM hospitality.unit_members WHERE parent_unit_id = %L)
                = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[%L, %L]::uuid[]) x)$$, :'uw', :'u1', :'u3'));
-- a future block on the whole property (the owner, through the calendar function — migration 14)
SELECT pg_temp.cat(:'sa', :OWNER_A, format('block_create(%L, current_date + 30, current_date + 32, %L)', :'uw', 'חתונה')) ->> 'id' AS blk \gset
SELECT pg_temp.expect_error('whole: with a future block / booking its units are frozen',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('whole_property_set(%L, true, ARRAY[%L, %L]::uuid[])', :'pa', :'u1', :'u2')),
  'יש הזמנות או חסימות עתידיות ל"כל המתחם"');
SELECT pg_temp.after('whole: switching it off keeps its block; then its units can be switched off',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('whole_property_set(%L, false, NULL)', :'pa')),
  format($$SELECT NOT (SELECT is_active FROM hospitality.units WHERE id = %L)
             AND EXISTS (SELECT 1 FROM hospitality.blocks WHERE unit_id = %L)
             AND (pg_temp.cat(%L, %L, format('unit_set_active(%%L, false)', %L::uuid)) ->> 'id') IS NOT NULL$$,
         :'uw', :'uw', :'sa', :OWNER_A, :'u3'));
SELECT pg_temp.expect_error('whole: cannot be switched on again with an inactive unit',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_set_active(%L, true)', :'uw')), 'לפחות שתי יחידות פעילות');

-- ============================================================
-- 7. activate / deactivate and the plan limit (trial: 20 units)
-- ============================================================
SELECT pg_temp.after('limit: units up to the plan limit through unit_create',
  format($$SELECT to_jsonb(count(pg_temp.cat(%L, %L, format('unit_create(%%L, %%L)', %L::uuid,
             jsonb_build_object('name', 'יחידה ' || g, 'unit_type', 'apartment'))))) FROM generate_series(1, 20 - hospitality._units_used(%L)) g$$,
         :'sa', :OWNER_A, :'pa2', :'sa'),
  format($$SELECT hospitality._units_used(%L) = 20$$, :'sa'));
SELECT pg_temp.expect_error('limit: the next unit is refused with the plan message',
  pg_temp.cat_sql(:'sa', :MGR_A, format('unit_create(%L, ''{"name": "עוד אחת", "unit_type": "zimmer"}'')', :'pa2')), 'מגבלת היחידות בחבילה (20)');
SELECT pg_temp.expect_error('limit: switching an inactive unit back on is refused too',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_set_active(%L, true)', :'u3')), 'מגבלת היחידות בחבילה (20)');
SELECT pg_temp.after('limit: switching one off frees a place (deactivation keeps it, logged)',
  pg_temp.cat_sql(:'sa', :MGR_A, format('unit_set_active(%L, false)', :'ux')),
  format($$SELECT hospitality._units_used(%L) = 19 AND pg_temp.audit_count(%L, 'catalog.unit_deactivated') >= 2$$, :'sa', :'sa'));
SELECT pg_temp.after('limit: … and the place can be used again',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_set_active(%L, true)', :'u3')),
  format($$SELECT hospitality._units_used(%L) = 20$$, :'sa'));

-- ============================================================
-- 8. delete, archive (owner only)
-- ============================================================
SELECT pg_temp.expect_error('delete: a manager cannot delete a unit',
  pg_temp.cat_sql(:'sa', :MGR_A, format('unit_delete(%L)', :'ux')), 'רק בעל העסק יכול למחוק יחידה');
SELECT pg_temp.expect_error('delete: a unit with a block / booking is not deleted (deactivate instead)',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_delete(%L)', :'uw')), 'אפשר להשבית אותה במקום למחוק');
SELECT pg_temp.after('delete: the owner deletes a never-booked unit (logged)',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_delete(%L)', :'ux')),
  format($$SELECT NOT EXISTS (SELECT 1 FROM hospitality.units WHERE id = %L) AND pg_temp.audit_count(%L, 'catalog.unit_deleted') = 1$$, :'ux', :'sa'));
SELECT pg_temp.expect_error('archive: a manager cannot archive a property',
  pg_temp.cat_sql(:'sa', :MGR_A, format('property_archive(%L)', :'pa')), 'רק בעל העסק יכול להעביר מתחם לארכיון');
SELECT pg_temp.expect_error('archive: refused while the property has a future block / booking',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('property_archive(%L)', :'pa')), 'הזמנות או חסימות עתידיות');
SELECT pg_temp.expect_error('delete: a property with booked / blocked units is not deleted (archive instead)',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('property_delete(%L)', :'pa')), 'אפשר להעביר אותו לארכיון');
UPDATE hospitality.blocks SET released_at = now() WHERE id = :'blk';
DELETE FROM hospitality.unit_occupancy WHERE block_id = :'blk';
SELECT pg_temp.after('archive: the owner archives — its units are switched off and free plan places',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('property_archive(%L)', :'pa')),
  format($$SELECT (SELECT status FROM hospitality.properties WHERE id = %L) = 'archived'
             AND NOT EXISTS (SELECT 1 FROM hospitality.units WHERE property_id = %L AND is_active)
             AND hospitality._units_used(%L) = 17$$, :'pa', :'pa', :'sa'));
SELECT pg_temp.expect_error('archive: no new unit in an archived property',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_create(%L, ''{"name": "x", "unit_type": "zimmer"}'')', :'pa')), 'המתחם בארכיון');
SELECT pg_temp.expect_error('archive: a unit of an archived property is not switched on',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('unit_set_active(%L, true)', :'u1')), 'המתחם בארכיון');
SELECT pg_temp.expect_error('archive: a manager cannot change an archived property',
  pg_temp.cat_sql(:'sa', :MGR_A, format('property_update(%L, ''{"status": "active"}'', %s)', :'pa',
    (SELECT revision FROM hospitality.properties WHERE id = :'pa'))), 'רק בעל העסק יכול לשנות מתחם שבארכיון');
SELECT pg_temp.after('archive: the owner brings it back (units stay off until switched on)',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('property_update(%L, ''{"status": "active"}'', %s)', :'pa',
    (SELECT revision FROM hospitality.properties WHERE id = :'pa'))),
  format($$SELECT (SELECT status FROM hospitality.properties WHERE id = %L) = 'active'
             AND NOT EXISTS (SELECT 1 FROM hospitality.units WHERE property_id = %L AND is_active)$$, :'pa', :'pa'));
SELECT pg_temp.cat(:'sa', :OWNER_A, $$property_create('{"name": "מתחם ריק", "property_type": "other"}')$$) ->> 'id' AS pe \gset
SELECT pg_temp.expect_error('delete: a manager cannot delete a property',
  pg_temp.cat_sql(:'sa', :MGR_A, format('property_delete(%L)', :'pe')), 'רק בעל העסק יכול למחוק מתחם');
SELECT pg_temp.after('delete: the owner deletes an empty property (logged)',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('property_delete(%L)', :'pe')),
  format($$SELECT NOT EXISTS (SELECT 1 FROM hospitality.properties WHERE id = %L) AND pg_temp.audit_count(%L, 'catalog.property_deleted') = 1$$, :'pe', :'sa'));

-- ============================================================
-- 9. order and view
-- ============================================================
SELECT pg_temp.after('reorder: properties in one call',
  pg_temp.cat_sql(:'sa', :MGR_A, format('catalog_reorder(''properties'', ARRAY[%L, %L]::uuid[])', :'pa2', :'pa')),
  format($$SELECT (SELECT sort_order FROM hospitality.properties WHERE id = %L) = 0
             AND (SELECT sort_order FROM hospitality.properties WHERE id = %L) = 1$$, :'pa2', :'pa'));
SELECT pg_temp.after('reorder: units of one property',
  pg_temp.cat_sql(:'sa', :MGR_A, format('catalog_reorder(''units'', ARRAY[%L, %L, %L]::uuid[])', :'u3', :'u2', :'u1')),
  format($$SELECT (SELECT array_agg(id ORDER BY sort_order) FROM hospitality.units WHERE id IN (%L, %L, %L)) = ARRAY[%L, %L, %L]::uuid[]$$,
         :'u1', :'u2', :'u3', :'u3', :'u2', :'u1'));
SELECT pg_temp.after('reorder: a partial list (e.g. a unit added meanwhile is missing) puts the rest after it — every place once',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('catalog_reorder(''units'', ARRAY[%L]::uuid[])', :'u2')),
  format($$SELECT (SELECT array_agg(id ORDER BY sort_order) FROM hospitality.units WHERE property_id = %L AND kind <> 'whole_property')
                = ARRAY[%L, %L, %L]::uuid[]
             AND (SELECT count(*) = count(DISTINCT sort_order) FROM hospitality.units WHERE property_id = %L AND kind <> 'whole_property')$$,
         :'pa', :'u2', :'u3', :'u1', :'pa'));
SELECT pg_temp.expect_error('reorder: units of two properties at once are refused',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('catalog_reorder(''units'', ARRAY[%L, (SELECT id FROM hospitality.units WHERE property_id = %L LIMIT 1)]::uuid[])', :'u1', :'pa2')),
  'יחידות של מתחם אחד');
SELECT pg_temp.expect_error('reorder: the whole-property unit is not in the list',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('catalog_reorder(''units'', ARRAY[%L, %L]::uuid[])', :'u1', :'uw')), 'יחידה לא נמצאה');
SELECT pg_temp.expect_error('reorder: another site''s ids → not found',
  pg_temp.cat_sql(:'sb', :OWNER_B, format('catalog_reorder(''properties'', ARRAY[%L]::uuid[])', :'pa')), 'מתחם לא נמצא');
SELECT pg_temp.expect_error('reorder: duplicates are refused',
  pg_temp.cat_sql(:'sa', :OWNER_A, format('catalog_reorder(''properties'', ARRAY[%L, %L]::uuid[])', :'pa', :'pa')), 'רשימת הסדר לא תקינה');
SELECT pg_temp.after('view: the manager sees everything of the site, no owner actions; whole-property members and history',
  pg_temp.cat_sql(:'sa', :MGR_A, 'catalog_view()'),
  format($$SELECT NOT ($1 ->> 'can_owner')::boolean AND jsonb_array_length($1 -> 'properties') = 2
             AND ($1 -> 'properties' -> 0 ->> 'id') = %L
             AND ($1 -> 'limits' ->> 'units_used')::int = hospitality._units_used(%L)
             AND EXISTS (SELECT 1 FROM jsonb_array_elements($1 -> 'properties' -> 1 -> 'units') u
                          WHERE u ->> 'kind' = 'whole_property' AND jsonb_array_length(u -> 'member_ids') = 2
                            AND (u ->> 'has_history')::boolean)
             AND (SELECT u ->> 'kind' FROM jsonb_array_elements($1 -> 'properties' -> 1 -> 'units') WITH ORDINALITY AS x(u, n) ORDER BY n DESC LIMIT 1) = 'whole_property'$$,
         :'pa2', :'sa'));
SELECT pg_temp.after('view: the owner may do owner actions',
  pg_temp.cat_sql(:'sa', :OWNER_A, 'catalog_view()'), $$SELECT ($1 ->> 'can_owner')::boolean$$);
SELECT pg_temp.after('view: site B sees only its own (nothing of A)',
  pg_temp.cat_sql(:'sb', :OWNER_B, 'catalog_view()'), $$SELECT jsonb_array_length($1 -> 'properties') = 0$$);
SELECT pg_temp.after('view: the platform admin acts as the owner (existing rule)',
  pg_temp.cat_sql(:'sa', :PLATFORM, 'catalog_view()'), $$SELECT ($1 ->> 'can_owner')::boolean AND jsonb_array_length($1 -> 'properties') = 2$$);

-- ============================================================
-- 10. the log and Ecommerce
-- ============================================================
SELECT tests.check('log: every catalog action of site A is in its own log only',
  format($$SELECT NOT EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id <> %L AND action LIKE 'catalog.%%'
                                AND target_label LIKE '%%הגפן%%')
             AND (SELECT count(DISTINCT action) FROM hospitality.audit_log WHERE tenant_id = %L AND action LIKE 'catalog.%%') >= 11$$, :'sa', :'sa'));
SELECT tests.check('ecommerce: store data unchanged',
  $$SELECT pg_temp.ecommerce_hash() = (SELECT h FROM c2c_before)$$);
SELECT tests.check('ecommerce: no Hospitality catalog row belongs to a store',
  $$SELECT NOT EXISTS (SELECT 1 FROM hospitality.properties p JOIN public.tenants t ON t.id = p.tenant_id WHERE t.site_type <> 'hospitality')$$);

-- ---------- cleanup ----------
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_delete_tenant(%1$L, 'c2c-a'), public.platform_delete_tenant(%2$L, 'c2c-b'),
       public.platform_delete_tenant(%3$L, 'c2c-off')])$$, :'sa', :'sb', :'so')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_management_enabled', false)])$$) IS NOT NULL AS ok \gset
DROP TABLE c2c_before;

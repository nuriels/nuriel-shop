-- ============================================================
-- Hospitality: כותרת ותיאור לגוגל לכל יחידה (20261110200000_hosp_unit_seo.sql)
--   • מבנה: שתי פונקציות DEFINER לצוות בלבד (לא anon), בלי טבלאות חדשות, העמודות כמו קודם
--   • קריאה ושמירה: שורה אחת בלי תגיות, ריק = ברירת המחדל, גרסה (HS409), שמירה בלי שינוי לא
--     מעלה גרסה, אורך מקסימלי, מנהל עם הרשאת catalog, היומן בלי הטקסט עצמו
--   • האתר הציבורי מקבל את הערכים (_site_payload); עסק אחר, משתמש זר ואורח אנונימי — נדחים;
--     נתוני ה-Ecommerce לא השתנו
-- ============================================================
\set OWNER_A '''a0000000-0000-0000-0000-00000009e0a1'''
\set MGR_A '''a0000000-0000-0000-0000-00000009e0a2'''
\set OWNER_B '''a0000000-0000-0000-0000-00000009e0b1'''
\set STRANGER '''a0000000-0000-0000-0000-00000009e0c1'''

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
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.add_role(_site uuid, _uid uuid, _name text) RETURNS jsonb LANGUAGE sql AS $f$
  INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
  VALUES (_site, _uid, _name || '@test.local', _name, 'admin', true) RETURNING to_jsonb(true);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.h(_site text, _uid uuid, _call text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, 'SELECT to_jsonb(hospitality.' || _call || ')');
$f$;
CREATE OR REPLACE FUNCTION pg_temp.ecommerce_hash() RETURNS text LANGUAGE sql AS $f$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s
       JOIN public.tenants t ON t.id = s.tenant_id WHERE t.site_type = 'ecommerce'),
    (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM public.tenants t WHERE t.site_type = 'ecommerce')));
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-00000009e0a1', 'useo.owner.a@test.local', now()),
  ('a0000000-0000-0000-0000-00000009e0a2', 'useo.mgr.a@test.local', now()),
  ('a0000000-0000-0000-0000-00000009e0b1', 'useo.owner.b@test.local', now()),
  ('a0000000-0000-0000-0000-00000009e0c1', 'useo.stranger@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE useo_ecommerce_before AS SELECT pg_temp.ecommerce_hash() AS h;
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('useo-a', 'אירוח SEO A'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('useo-b', 'אירוח SEO B'))$$) IS NOT NULL AS ok \gset
SELECT id AS sa FROM public.tenants WHERE slug = 'useo-a' \gset
SELECT id AS sb FROM public.tenants WHERE slug = 'useo-b' \gset
SELECT pg_temp.add_role(:'sa', :OWNER_A, 'useo_owner_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sa', :MGR_A, 'useo_mgr_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sb', :OWNER_B, 'useo_owner_b') IS NOT NULL AS ok \gset
UPDATE public.user_roles SET is_protected = true WHERE user_id IN (:OWNER_A, :OWNER_B);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'sa', :'sb')) IS NOT NULL AS ok \gset
SELECT pg_temp.h(:'sa', :OWNER_A, $$property_create('{"name": "מתחם SEO", "property_type": "zimmer_complex", "status": "active"}')$$) ->> 'id' AS pa \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_create(%L, '{"name": "צימר הגפן", "unit_type": "zimmer", "capacity": 4}')$$, :'pa')) ->> 'id' AS u1 \gset
SELECT pg_temp.h(:'sb', :OWNER_B, $$property_create('{"name": "מתחם B", "property_type": "villa"}')$$) ->> 'id' AS pb \gset
SELECT pg_temp.h(:'sb', :OWNER_B, format($$unit_create(%L, '{"name": "וילה B", "unit_type": "villa"}')$$, :'pb')) ->> 'id' AS ub \gset
SELECT revision AS r0 FROM hospitality.units WHERE id = :'u1' \gset

-- ============================================================
-- 1. structure
-- ============================================================
SELECT tests.check('unit seo: both functions are SECURITY DEFINER, for staff (authenticated), never anon',
  $$SELECT bool_and(p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
      FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace AND p.proname IN ('unit_seo_get', 'unit_seo_set')
    HAVING count(*) = 2$$);
SELECT tests.check('unit seo: the unit columns are as before (120 / 320 characters), no new table',
  $$SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'units'
             AND column_name IN ('seo_title', 'seo_description')) = 2
       AND to_regclass('hospitality.unit_seo') IS NULL$$);

-- ============================================================
-- 2. read and save
-- ============================================================
SELECT tests.check('unit seo: a new unit has no Google title or description, and the read returns its revision',
  format($$SELECT r ->> 'seo_title' IS NULL AND r ->> 'seo_description' IS NULL AND (r ->> 'revision')::int = %s
           FROM pg_temp.h(%L, %L, %L) r$$, :r0, :'sa', :OWNER_A, format('unit_seo_get(%L)', :'u1')));
-- each save runs in its own statement, and is checked in the next one (a sub-select in the same
-- statement would read the row before the save)
SELECT (pg_temp.h(:'sa', :OWNER_A, format('unit_seo_set(%L, %L, %L, %s)', :'u1',
         E'  צימר הגפן\nבגליל <העליון>  ', E'צימר זוגי\tעם ג׳קוזי ונוף לכנרת', :r0)) ->> 'revision')::int AS r1 \gset
SELECT tests.check('unit seo: the owner saves — one line, no tag signs, trimmed; the revision goes up by one',
  format($$SELECT %s = %s + 1
             AND (SELECT seo_title = 'צימר הגפן בגליל העליון' AND seo_description = 'צימר זוגי עם ג׳קוזי ונוף לכנרת'
                    FROM hospitality.units WHERE id = %L)$$, :r1, :r0, :'u1'));
SELECT tests.check('unit seo: the log says what changed, without the text itself',
  format($$SELECT a.changes -> 'seo_title' ->> 'changed' = 'true' AND a.changes -> 'seo_description' ->> 'changed' = 'true'
             AND a.changes::text NOT LIKE '%%הגפן בגליל%%' AND a.target_label = 'צימר הגפן'
           FROM hospitality.audit_log a WHERE a.tenant_id = %L AND a.action = 'catalog.unit_updated'
           ORDER BY a.id DESC LIMIT 1$$, :'sa'));
SELECT count(*) AS log_before FROM hospitality.audit_log WHERE tenant_id = :'sa' \gset
SELECT (pg_temp.h(:'sa', :OWNER_A, format('unit_seo_set(%L, %L, %L, %s)', :'u1',
         'צימר הגפן בגליל העליון', 'צימר זוגי עם ג׳קוזי ונוף לכנרת', :r1)) ->> 'revision')::int AS r1b \gset
SELECT tests.check('unit seo: saving the same values again changes nothing (same revision, no new log row)',
  format($$SELECT %s = %s AND (SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = %L) = %s$$,
         :r1b, :r1, :'sa', :log_before));
SELECT pg_temp.expect_error('unit seo: a stale revision is refused (HS409, somebody saved in between)',
  format('SELECT pg_temp.h(%L, %L, %L)', :'sa', :OWNER_A, format('unit_seo_set(%L, %L, %L, %s)', :'u1', 'x', 'y', :r0)),
  'עודכנה בינתיים');
SELECT pg_temp.expect_error('unit seo: a title over 120 characters is refused',
  format('SELECT pg_temp.h(%L, %L, %L)', :'sa', :OWNER_A,
         format('unit_seo_set(%L, %L, NULL, %s)', :'u1', repeat('א', 121), :r0 + 1)),
  '120');
SELECT (pg_temp.h(:'sa', :MGR_A, format('unit_seo_set(%L, %L, %L, %s)', :'u1', '  ', '', :r0 + 1)) ->> 'revision')::int AS r2 \gset
SELECT tests.check('unit seo: a manager with the catalog permission saves too; empty text = back to the default (NULL)',
  format($$SELECT %s = %s + 2
             AND (SELECT seo_title IS NULL AND seo_description IS NULL FROM hospitality.units WHERE id = %L)$$,
         :r2, :r0, :'u1'));
SELECT (pg_temp.h(:'sa', :OWNER_A, format('unit_seo_set(%L, %L, %L, %s)', :'u1', 'כותרת לגוגל', 'תיאור לגוגל', :r0 + 2)) ->> 'revision')::int AS r3 \gset
SELECT tests.check('unit seo: the public site payload carries the saved values',
  format($$SELECT %s = %s + 3
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(hospitality._site_payload(%L) -> 'units') u
                          WHERE u ->> 'id' = %L AND u ->> 'seo_title' = 'כותרת לגוגל' AND u ->> 'seo_description' = 'תיאור לגוגל')$$,
         :r3, :r0, :'sa', :'u1'));

-- ============================================================
-- 3. outsiders and isolation
-- ============================================================
SELECT pg_temp.expect_error('unit seo: another business cannot read the unit',
  format('SELECT pg_temp.h(%L, %L, %L)', :'sb', :OWNER_B, format('unit_seo_get(%L)', :'u1')), 'לא נמצאה');
SELECT pg_temp.expect_error('unit seo: another business cannot save the unit',
  format('SELECT pg_temp.h(%L, %L, %L)', :'sb', :OWNER_B, format('unit_seo_set(%L, %L, NULL, %s)', :'u1', 'x', :r0 + 3)),
  'לא נמצאה');
SELECT pg_temp.expect_error('unit seo: an owner of B naming site A is refused (not staff there)',
  format('SELECT pg_temp.h(%L, %L, %L)', :'sa', :OWNER_B, format('unit_seo_set(%L, %L, NULL, %s)', :'u1', 'x', :r0 + 3)),
  '');
SELECT pg_temp.expect_error('unit seo: a signed-in stranger is refused',
  format('SELECT pg_temp.h(%L, %L, %L)', :'sa', :STRANGER, format('unit_seo_get(%L)', :'u1')), '');
SELECT pg_temp.expect_error('unit seo: an anonymous visitor cannot call it',
  format('SELECT pg_temp.h(%L, NULL, %L)', :'sa', format('unit_seo_get(%L)', :'u1')), 'permission denied');
SELECT tests.check('unit seo: the unit of B is untouched, and A keeps the last saved values',
  format($$SELECT (SELECT seo_title IS NULL FROM hospitality.units WHERE id = %L)
             AND (SELECT seo_title = 'כותרת לגוגל' FROM hospitality.units WHERE id = %L)$$, :'ub', :'u1'));
SELECT tests.check('unit seo: Ecommerce stores and their settings unchanged',
  $$SELECT h = pg_temp.ecommerce_hash() FROM useo_ecommerce_before$$);

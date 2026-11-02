-- ============================================================
-- Hospitality — unit size (migration 41 — 20261105180000_hosp_unit_size.sql)
--   • the column: optional, 5–5,000 m²;
--   • unit_create / unit_update (the staff, through the catalog permission): set, change, clear,
--     refused out of range or not a number — and nothing else changes; the change is in the action log;
--   • the management view (_unit_json) and the public site (_site_payload) carry it.
-- ============================================================
\set OWNER41 '''a0000000-0000-0000-0000-000000041a01'''

CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site)::text, true);
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
  ('a0000000-0000-0000-0000-000000041a01', 'm41.owner@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE m41_flags AS
  SELECT key, enabled FROM public.platform_feature_flags
   WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled');
UPDATE public.platform_feature_flags SET enabled = true
 WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled');
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m41-size', 'צימר הגודל', 'm41.owner@test.local')$$) ->> 'id' AS st \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm41.owner@test.local')$$, :'st')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER41,
  $q$SELECT hospitality.property_create('{"name": "מתחם הגודל", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS sp \gset

-- ============================================================
-- 1. The column
-- ============================================================
SELECT tests.check('unit size: an optional small number, 5 to 5,000 m² (check in the table too)',
  $$SELECT a.atttypid = 'smallint'::regtype AND NOT a.attnotnull
       AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'hospitality.units'::regclass
                    AND c.conname = 'units_size_sqm_check')
      FROM pg_attribute a WHERE a.attrelid = 'hospitality.units'::regclass AND a.attname = 'size_sqm'$$);

-- ============================================================
-- 2. Create, change, clear
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER41, format($q$SELECT hospitality.unit_create(%L,
  '{"name": "יחידת גן עדן", "unit_type": "suite", "capacity": 2, "size_sqm": 34}')$q$, :'sp')) ->> 'id' AS su \gset
SELECT tests.check('create: the size is saved and shown in the management view',
  format($$SELECT u.size_sqm = 34 AND (hospitality._unit_json(u) ->> 'size_sqm')::integer = 34
            FROM hospitality.units u WHERE u.id = %L$$, :'su'));
SELECT pg_temp.call(:'st', :OWNER41, format($q$SELECT hospitality.unit_create(%L,
  '{"name": "יחידת אדיר", "unit_type": "suite"}')$q$, :'sp')) ->> 'id' AS su2 \gset
SELECT tests.check('create: without a size — empty (not required)',
  format($$SELECT u.size_sqm IS NULL AND hospitality._unit_json(u) -> 'size_sqm' = 'null'::jsonb
            FROM hospitality.units u WHERE u.id = %L$$, :'su2'));

SELECT revision AS rv FROM hospitality.units WHERE id = :'su' \gset
SELECT pg_temp.call(:'st', :OWNER41, format($q$SELECT hospitality.unit_update(%L, '{"size_sqm": 31}', %s)$q$, :'su', :'rv')) IS NOT NULL AS ok \gset
SELECT tests.check('update: the size changes (new revision), nothing else does, and the action log has from / to',
  format($$SELECT u.size_sqm = 31 AND u.revision = %2$s + 1 AND u.name = 'יחידת גן עדן' AND u.capacity = 2
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a
                          WHERE a.tenant_id = u.tenant_id AND a.action = 'catalog.unit_updated'
                            AND (a.changes -> 'size_sqm' ->> 'from')::integer = 34
                            AND (a.changes -> 'size_sqm' ->> 'to')::integer = 31)
            FROM hospitality.units u WHERE u.id = %1$L$$, :'su', :'rv'));

SELECT revision AS rv FROM hospitality.units WHERE id = :'su' \gset
SELECT pg_temp.call(:'st', :OWNER41, format($q$SELECT hospitality.unit_update(%L, '{"size_sqm": null}', %s)$q$, :'su', :'rv')) IS NOT NULL AS ok \gset
SELECT tests.check('update: null clears the size',
  format($$SELECT size_sqm IS NULL FROM hospitality.units WHERE id = %L$$, :'su'));

SELECT revision AS rv FROM hospitality.units WHERE id = :'su' \gset
SELECT tests.check('update: out of range or not a number — refused with the field name, nothing saved',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.unit_update(%%L, ''{"size_sqm": 3}'', %%s)', %3$L, %4$s)) LIKE '%%גודל היחידה%%'
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.unit_update(%%L, ''{"size_sqm": 6000}'', %%s)', %3$L, %4$s)) LIKE '%%גודל היחידה%%'
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.unit_update(%%L, ''{"size_sqm": "גדול"}'', %%s)', %3$L, %4$s)) LIKE '%%גודל היחידה%%'
             AND (SELECT size_sqm IS NULL AND revision = %4$s FROM hospitality.units WHERE id = %3$L)$$,
         :'st', :OWNER41, :'su', :'rv'));

SELECT pg_temp.call(:'st', :OWNER41, format($q$SELECT hospitality.unit_update(%L, '{"size_sqm": 34}', %s)$q$, :'su', :'rv')) IS NOT NULL AS ok \gset

-- ============================================================
-- 3. The public site
-- ============================================================
SELECT tests.check('public site: the unit carries its size; a unit without one — null',
  format($$SELECT (SELECT (x ->> 'size_sqm')::integer = 34 FROM jsonb_array_elements(p -> 'units') x WHERE x ->> 'id' = %2$L)
             AND (SELECT x -> 'size_sqm' = 'null'::jsonb FROM jsonb_array_elements(p -> 'units') x WHERE x ->> 'id' = %3$L)
            FROM (SELECT hospitality._site_payload(%1$L) AS p) s$$, :'st', :'su', :'su2'));

-- ---------- cleanup ----------
UPDATE public.platform_feature_flags f SET enabled = m.enabled FROM m41_flags m WHERE f.key = m.key;
DROP TABLE m41_flags;

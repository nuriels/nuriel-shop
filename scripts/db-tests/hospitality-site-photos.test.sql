-- ============================================================
-- Hospitality — the owner's photos on the public site (20261105150000_hosp_unit_photos_public.sql, migration 38)
--   • a unit's photos appear under that unit (cover first, in order) — on the public site and in the
--     editor's preview; a unit inside a property is the normal case (every unit on the site has one);
--   • a unit without photos gets none — not the property's and not another unit's;
--   • property photos stay on the property, the site gallery stays the gallery;
--   • never another business's photos, never an inactive unit;
--   • the helper stays internal (no grant to guests or users).
-- ============================================================
\set OWNER_P '''a0000000-0000-0000-0000-000000038a01'''
\set OWNER_X '''a0000000-0000-0000-0000-000000038a03'''
\set PP '''73800000-0000-0000-0000-0000000000f1'''
\set P1 '''73800000-0000-0000-0000-0000000000a1'''
\set P2 '''73800000-0000-0000-0000-0000000000a2'''
\set P3 '''73800000-0000-0000-0000-0000000000a3'''
\set XP '''73800000-0000-0000-0000-0000000000f2'''
\set X1 '''73800000-0000-0000-0000-0000000000b1'''
\set M_COVER '''73800000-0000-0000-0000-0000000000c1'''
\set M_SECOND '''73800000-0000-0000-0000-0000000000c2'''
\set M_PROP '''73800000-0000-0000-0000-0000000000c3'''
\set M_SITE '''73800000-0000-0000-0000-0000000000c4'''
\set M_OFF '''73800000-0000-0000-0000-0000000000c5'''
\set M_OTHER '''73800000-0000-0000-0000-0000000000c6'''

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
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.refused(_sql text) RETURNS boolean LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE _sql;
  RETURN false;
EXCEPTION WHEN check_violation THEN
  RETURN true;
END $f$;
-- the site as a guest sees it
CREATE OR REPLACE FUNCTION pg_temp.site(_site text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, NULL, 'SELECT hospitality.public_site()');
$f$;
-- the ids of one unit's photos, in the order the site shows them
CREATE OR REPLACE FUNCTION pg_temp.unit_media(_payload jsonb, _unit uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT COALESCE((SELECT jsonb_agg(m -> 'id' ORDER BY o)
                     FROM jsonb_array_elements(_payload -> 'units') u,
                          jsonb_array_elements(u -> 'media') WITH ORDINALITY x(m, o)
                    WHERE u ->> 'id' = _unit::text), '[]'::jsonb);
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000038a01', 'm38.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000038a03', 'm38.other@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m38-photos', 'צימרי התמונות', 'm38.owner@test.local')$$) ->> 'id' AS sp \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m38-other', 'עסק אחר 38', 'm38.other@test.local')$$) ->> 'id' AS sx \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name) VALUES
  (:'sp', :OWNER_P, 'm38.owner@test.local', 'm38_owner', 'admin', true, 'נועה'),
  (:'sx', :OWNER_X, 'm38.other@test.local', 'm38_other', 'admin', true, NULL);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
     public.platform_set_flag('hospitality_backend_enabled', true),
     public.platform_set_flag('hospitality_management_enabled', true),
     public.platform_set_flag('hospitality_frontend_enabled', true),
     public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
     public.platform_set_flag('hospitality_management_enabled', true, %1$L),
     public.platform_set_flag('hospitality_frontend_enabled', true, %1$L),
     public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
     public.platform_set_flag('hospitality_management_enabled', true, %2$L),
     public.platform_set_flag('hospitality_frontend_enabled', true, %2$L)])$$, :'sp', :'sx')) IS NOT NULL AS ok \gset
INSERT INTO hospitality.properties (id, tenant_id, name, slug, status) VALUES
  (:PP, :'sp', 'מתחם התמונות', 'm38-p', 'active'),
  (:XP, :'sx', 'מתחם אחר', 'm38-x', 'active');
-- P1 — with photos; P2 — without; P3 — inactive, with a photo; X1 — another business, with a photo
INSERT INTO hospitality.units (id, tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price, sort_order, is_active) VALUES
  (:P1, :'sp', :PP, 'unit', 'צימר האלה', 'm38-p1', 4, 2, 750, 1, true),
  (:P2, :'sp', :PP, 'unit', 'צימר האלון', 'm38-p2', 4, 2, 650, 2, true),
  (:P3, :'sp', :PP, 'unit', 'צימר סגור', 'm38-p3', 4, 2, 650, 3, false),
  (:X1, :'sx', :XP, 'unit', 'יחידה זרה', 'm38-x1', 4, 2, 500, 1, true);
-- the second photo was added first (sort 1) and the cover later — the cover still comes first
INSERT INTO hospitality.media (id, tenant_id, owner_kind, property_id, unit_id, kind, storage_path, is_cover, sort_order, alt) VALUES
  (:M_SECOND, :'sp', 'unit', NULL, :P1, 'image', :'sp' || '/p1-second.webp', false, 1, 'המרפסת'),
  (:M_COVER, :'sp', 'unit', NULL, :P1, 'image', :'sp' || '/p1-cover.webp', true, 2, 'הג׳קוזי'),
  (:M_PROP, :'sp', 'property', :PP, NULL, 'image', :'sp' || '/property.webp', true, 1, NULL),
  (:M_SITE, :'sp', 'site', NULL, NULL, 'image', :'sp' || '/gallery.webp', false, 1, NULL),
  (:M_OFF, :'sp', 'unit', NULL, :P3, 'image', :'sp' || '/p3.webp', true, 1, NULL),
  (:M_OTHER, :'sx', 'unit', NULL, :X1, 'image', :'sx' || '/x1.webp', true, 1, NULL);

SELECT pg_temp.site(:'sp') AS payload \gset

-- ============================================================
-- 1. A unit's photos on the public site
-- ============================================================
SELECT tests.check('site photos (38): a unit''s photos appear under that unit — cover first, then by order',
  format($$SELECT pg_temp.unit_media(%L::jsonb, %L) = jsonb_build_array(%L, %L)$$,
         :'payload', :P1, trim(both '''' from :M_COVER), trim(both '''' from :M_SECOND)));
SELECT tests.check('site photos: the photo carries what the page needs (path, kind, alt, cover)',
  format($$SELECT m ->> 'path' = %L AND m ->> 'kind' = 'image' AND m ->> 'alt' = 'הג׳קוזי' AND (m ->> 'is_cover')::boolean
             FROM jsonb_array_elements(%L::jsonb -> 'units') u, jsonb_array_elements(u -> 'media') m
            WHERE m ->> 'id' = %L$$,
         :'sp' || '/p1-cover.webp', :'payload', trim(both '''' from :M_COVER)));
SELECT tests.check('site photos: a unit without photos gets none — not the property''s, not another unit''s',
  format($$SELECT pg_temp.unit_media(%L::jsonb, %L) = '[]'::jsonb$$, :'payload', :P2));
SELECT tests.check('site photos: property photos stay on the property; the gallery stays the gallery',
  format($$SELECT (SELECT jsonb_agg(m -> 'id') FROM jsonb_array_elements(%1$L::jsonb -> 'properties') p,
                          jsonb_array_elements(p -> 'media') m) = jsonb_build_array(%2$L)
             AND (SELECT jsonb_agg(m -> 'id') FROM jsonb_array_elements(%1$L::jsonb -> 'gallery') m) = jsonb_build_array(%3$L)$$,
         :'payload', trim(both '''' from :M_PROP), trim(both '''' from :M_SITE)));

-- ============================================================
-- 2. Only what belongs on this site
-- ============================================================
SELECT tests.check('site photos: an inactive unit is not on the site, and neither are its photos',
  format($$SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb -> 'units') u WHERE u ->> 'id' = %2$L)
             AND position(%3$L IN %1$L) = 0$$,
         :'payload', trim(both '''' from :P3), trim(both '''' from :M_OFF)));
SELECT tests.check('site photos: never another business''s photos — and the other business sees only its own',
  format($$SELECT position(%1$L IN %2$L) = 0
             AND pg_temp.unit_media(pg_temp.site(%3$L), %4$L) = jsonb_build_array(%1$L)
             AND position(%5$L IN pg_temp.site(%3$L)::text) = 0$$,
         trim(both '''' from :M_OTHER), :'payload', :'sx', :X1, trim(both '''' from :M_COVER)));
SELECT tests.check('site photos: the editor''s preview (staff) shows the same unit photos',
  format($$SELECT pg_temp.unit_media(pg_temp.call(%L, %L, 'SELECT hospitality.site_preview()'), %L)
                  = jsonb_build_array(%L, %L)$$,
         :'sp', :OWNER_P, :P1, trim(both '''' from :M_COVER), trim(both '''' from :M_SECOND)));

-- ============================================================
-- 3. The table rule the site relies on, and the helper stays internal
-- ============================================================
SELECT tests.check('site photos: a unit photo that names a property is refused by the table (so the unit alone identifies it)',
  format($$SELECT pg_temp.refused(format('INSERT INTO hospitality.media (tenant_id, owner_kind, property_id, unit_id, kind, storage_path)
                                          VALUES (%%L, ''unit'', %%L, %%L, ''image'', %%L)', %L, %L, %L, %L))$$,
         :'sp', :PP, :P2, :'sp' || '/bad.webp'));
SELECT tests.check('site photos: the helper is internal — no guest or user may call it',
  $$SELECT NOT has_function_privilege('anon', 'hospitality._public_media(uuid,text,uuid,uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._public_media(uuid,text,uuid,uuid)', 'EXECUTE')$$);

-- ---------- cleanup: the platform-wide switches back off (other test files expect them off) ----------
SELECT pg_temp.as_platform($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_management_enabled', false),
                                    public.platform_set_flag('hospitality_frontend_enabled', false)])$$) IS NOT NULL AS ok \gset

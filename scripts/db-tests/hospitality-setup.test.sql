-- ============================================================
-- Hospitality — setup guide (20261105120000_hosp_setup_guide.sql, migration 35)
--   • who may read / save it (settings permission, management area on), isolation between businesses,
--     no direct table access;
--   • every step follows the data (details, contact, units, photos, prices, template, site, SEO, logo,
--     booking settings, policy, payments) and the five milestones;
--   • resume from the same point (current_step), confirm / skip only where they make sense, audit;
--   • never a draft as published: "published" only with a published version; draft changes apart;
--   • management_context: the dashboard checklist gains 'site' (ready to publish) and keeps 'policy'.
-- ============================================================
\set OWNER_G '''a0000000-0000-0000-0000-000000035a01'''
\set MGR_G '''a0000000-0000-0000-0000-000000035a02'''
\set OWNER_X '''a0000000-0000-0000-0000-000000035a03'''
\set STRANGER '''a0000000-0000-0000-0000-000000035a04'''
\set GP '''73500000-0000-0000-0000-0000000000f1'''
\set G1 '''73500000-0000-0000-0000-0000000000a1'''
\set G2 '''73500000-0000-0000-0000-0000000000a2'''

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
CREATE OR REPLACE FUNCTION pg_temp.guide(_site text, _uid uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, 'SELECT hospitality.setup_guide()');
$f$;
CREATE OR REPLACE FUNCTION pg_temp.save(_site text, _uid uuid, _step text, _action text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, format('SELECT hospitality.setup_save(%L, %L)', _step, _action));
$f$;
-- the done flags of all 13 steps, in order (for compact checks)
CREATE OR REPLACE FUNCTION pg_temp.done(_g jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT string_agg(k || '=' || CASE WHEN (_g -> 'steps' -> k ->> 'done')::boolean THEN '1' ELSE '0' END, ' ' ORDER BY o)
    FROM unnest(ARRAY['details', 'contact', 'units', 'photos', 'prices', 'booking', 'policy', 'payments',
                      'template', 'logo', 'site', 'seo', 'publish']) WITH ORDINALITY AS x(k, o);
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000035a01', 'm35.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000035a02', 'm35.manager@test.local', now()),
  ('a0000000-0000-0000-0000-000000035a03', 'm35.other@test.local', now()),
  ('a0000000-0000-0000-0000-000000035a04', 'm35.stranger@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m35-guide', 'צימרי ההקמה', 'm35.owner@test.local')$$) ->> 'id' AS sg \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m35-other', 'עסק אחר 35', 'm35.other@test.local')$$) ->> 'id' AS sx \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name) VALUES
  (:'sg', :OWNER_G, 'm35.owner@test.local', 'm35_owner', 'admin', true, 'גלית'),
  (:'sg', :MGR_G, 'm35.manager@test.local', 'm35_manager', 'admin', true, 'דני'),
  (:'sx', :OWNER_X, 'm35.other@test.local', 'm35_other', 'admin', true, NULL);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
     public.platform_set_flag('hospitality_backend_enabled', true),
     public.platform_set_flag('hospitality_management_enabled', true),
     public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
     public.platform_set_flag('hospitality_management_enabled', true, %1$L),
     public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
     public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'sg', :'sx')) IS NOT NULL AS ok \gset

-- ============================================================
-- 1. Access
-- ============================================================
SELECT tests.check('setup: the table has RLS, no direct grants, restrictive isolation + backend policies and the tenant guard',
  $$SELECT c.relrowsecurity
       AND NOT has_table_privilege('authenticated', 'hospitality.setup_state', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'hospitality.setup_state', 'INSERT')
       AND NOT has_table_privilege('anon', 'hospitality.setup_state', 'SELECT')
       AND NOT has_table_privilege('service_role', 'hospitality.setup_state', 'SELECT')
       AND (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'hospitality' AND p.tablename = 'setup_state'
              AND p.permissive = 'RESTRICTIVE' AND p.policyname IN ('tenant_isolation', 'backend_enabled')) = 2
       AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'tenant_guard')
      FROM pg_class c WHERE c.oid = 'hospitality.setup_state'::regclass$$);
SELECT tests.run('setup: guests (anon) cannot read the guide', 'SELECT hospitality.setup_guide()', NULL, 'permission denied');
SELECT tests.run('setup: guests (anon) cannot save', $$SELECT hospitality.setup_save('units', 'visit')$$, NULL, 'permission denied');
SELECT tests.check('setup: the owner of another business and a signed-in stranger are refused',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.setup_guide()') LIKE '%%אין הרשאה%%'
             AND pg_temp.err_of(%1$L, %3$L, 'SELECT hospitality.setup_guide()') LIKE '%%אין הרשאה%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.setup_save(''units'', ''visit'')') LIKE '%%אין הרשאה%%'$$,
         :'sg', :OWNER_X, :STRANGER));
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(public.platform_set_flag('hospitality_management_enabled', false, %L))$$, :'sg')) IS NOT NULL AS ok \gset
SELECT tests.check('setup: management area off for the business → refused',
  format($$SELECT pg_temp.err_of(%L, %L, 'SELECT hospitality.setup_guide()') LIKE '%%אזור הניהול אינו פעיל%%'$$, :'sg', :OWNER_G));
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(public.platform_set_flag('hospitality_management_enabled', true, %L))$$, :'sg')) IS NOT NULL AS ok \gset

-- ============================================================
-- 2. A new business: what opening already filled in, nothing else, nothing published
-- ============================================================
SELECT pg_temp.guide(:'sg', :OWNER_G) AS g0 \gset
SELECT tests.check('setup: a new business — name and contact from opening; every other step open; nothing published',
  format($$SELECT pg_temp.done(%1$L::jsonb) = 'details=1 contact=1 units=0 photos=0 prices=0 booking=0 policy=0 payments=0 template=0 logo=0 site=0 seo=0 publish=0'
             AND %1$L::jsonb -> 'milestones' = '{"business": true, "units": false, "photos": false, "prices": false, "site": false}'::jsonb
             AND %1$L::jsonb -> 'state' ->> 'current_step' IS NULL
             AND NOT (%1$L::jsonb -> 'steps' -> 'publish' ->> 'published')::boolean
             AND NOT (%1$L::jsonb -> 'steps' -> 'publish' ->> 'ready')::boolean$$, :'g0'));
SELECT tests.check('setup: a manager (settings permission) reads the same guide',
  format($$SELECT pg_temp.done(pg_temp.guide(%L, %L)) = pg_temp.done(%L::jsonb)$$, :'sg', :MGR_G, :'g0'));
SELECT tests.check('setup: no personal details in the guide (no emails / phones / names of people)',
  format($$SELECT %1$L::text !~ '@' AND %1$L::text !~ '[0-9]{7,}'$$, :'g0'));

-- ============================================================
-- 3. Resume from the same point; confirm / skip
-- ============================================================
SELECT pg_temp.save(:'sg', :OWNER_G, 'prices', 'visit') IS NOT NULL AS ok \gset
SELECT tests.check('setup: visit remembers the step — the next reading (also by the manager) resumes there',
  format($$SELECT pg_temp.guide(%1$L, %2$L) -> 'state' ->> 'current_step' = 'prices'
             AND pg_temp.guide(%1$L, %3$L) -> 'state' ->> 'current_step' = 'prices'$$, :'sg', :OWNER_G, :MGR_G));
SELECT tests.check('setup: confirm booking settings → done; unconfirm → open again (the step stays current)',
  format($$SELECT (pg_temp.save(%1$L, %2$L, 'booking', 'confirm') -> 'steps' -> 'booking' ->> 'done')::boolean
             AND NOT (pg_temp.save(%1$L, %2$L, 'booking', 'unconfirm') -> 'steps' -> 'booking' ->> 'done')::boolean
             AND pg_temp.guide(%1$L, %2$L) -> 'state' ->> 'current_step' = 'booking'$$, :'sg', :OWNER_G));
SELECT tests.check('setup: skip logo and SEO → done as skipped; unskip → open again',
  format($$SELECT (pg_temp.save(%1$L, %2$L, 'logo', 'skip') -> 'steps' -> 'logo' ->> 'skipped')::boolean
             AND (pg_temp.save(%1$L, %2$L, 'seo', 'skip') -> 'steps' -> 'seo' ->> 'done')::boolean
             AND NOT (pg_temp.save(%1$L, %2$L, 'logo', 'unskip') -> 'steps' -> 'logo' ->> 'done')::boolean
             AND pg_temp.guide(%1$L, %2$L) -> 'state' -> 'skipped' = '["seo"]'::jsonb$$, :'sg', :OWNER_G));
SELECT tests.check('setup: validation — unknown step / action; confirm and skip only where they fit',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.setup_save(''nope'', ''visit'')') LIKE '%%צעד לא מוכר%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.setup_save(''units'', ''done'')') LIKE '%%פעולה לא מוכרת%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.setup_save(''units'', ''confirm'')') LIKE '%%במסך שלו%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.setup_save(''publish'', ''skip'')') LIKE '%%לדלג%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.setup_save(NULL, ''visit'')') LIKE '%%צעד לא מוכר%%'$$,
         :'sg', :OWNER_G));
SELECT tests.check('setup: confirm / skip go to the business action log; visits do not',
  format($$SELECT (SELECT count(*) FROM hospitality.audit_log a WHERE a.tenant_id = %1$L AND a.action LIKE 'setup.%%') = 5
             AND (SELECT count(*) FROM hospitality.audit_log a WHERE a.tenant_id = %1$L AND a.action = 'setup.visit') = 0
             AND (SELECT count(*) FROM hospitality.audit_log a WHERE a.tenant_id = %1$L AND a.action = 'setup.skip') = 2$$, :'sg'));
SELECT tests.check('setup: isolation — the other business is untouched (its own empty state)',
  format($$SELECT pg_temp.guide(%1$L, %2$L) -> 'state' = '{"current_step": null, "confirmed": [], "skipped": [], "updated_at": null}'::jsonb
             AND (SELECT count(*) FROM hospitality.setup_state s WHERE s.tenant_id = %1$L) = 0$$, :'sx', :OWNER_X));

-- ============================================================
-- 4. Steps follow the data
-- ============================================================
UPDATE hospitality.settings SET check_in_time = '16:00' WHERE tenant_id = :'sg';
SELECT tests.check('setup: booking settings changed in the settings screen count as reviewed',
  format($$SELECT (pg_temp.guide(%L, %L) -> 'steps' -> 'booking' ->> 'done')::boolean$$, :'sg', :OWNER_G));
INSERT INTO hospitality.properties (id, tenant_id, name, slug, status) VALUES (:GP, :'sg', 'מתחם ההקמה', 'm35-p', 'active');
INSERT INTO hospitality.units (id, tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price) VALUES
  (:G1, :'sg', :GP, 'unit', 'צימר הגפן', 'm35-g1', 4, 2, 0),
  (:G2, :'sg', :GP, 'unit', 'צימר הזית', 'm35-g2', 4, 2, 0);
SELECT tests.check('setup: units added (2 active) — prices and photos still open',
  format($$SELECT (g -> 'steps' -> 'units' ->> 'active')::int = 2 AND (g -> 'steps' -> 'units' ->> 'done')::boolean
             AND NOT (g -> 'steps' -> 'prices' ->> 'done')::boolean AND NOT (g -> 'steps' -> 'photos' ->> 'done')::boolean
             AND (g -> 'steps' -> 'photos' ->> 'units_without')::int = 2
             AND g -> 'milestones' = '{"business": true, "units": true, "photos": false, "prices": false, "site": false}'::jsonb
            FROM pg_temp.guide(%L, %L) g$$, :'sg', :OWNER_G));
UPDATE hospitality.units SET base_price = 600 WHERE id = :G1;
INSERT INTO hospitality.media (tenant_id, owner_kind, kind, storage_path, unit_id)
VALUES (:'sg', 'unit', 'image', :'sg' || '/g1.webp', :G1);
-- a demo picture does not count
INSERT INTO hospitality.media (tenant_id, owner_kind, kind, storage_path, is_demo, licence_ref)
VALUES (:'sg', 'site', 'image', :'sg' || '/demo.webp', true, 'unsplash:test');
SELECT tests.check('setup: a price and a real photo → prices / photos done (1 of 2 priced, the demo picture not counted)',
  format($$SELECT (g -> 'steps' -> 'prices' ->> 'priced')::int = 1 AND (g -> 'steps' -> 'photos' ->> 'count')::int = 1
             AND (g -> 'steps' -> 'photos' ->> 'units_without')::int = 1
             AND (g -> 'milestones' ->> 'prices')::boolean AND (g -> 'milestones' ->> 'photos')::boolean
            FROM pg_temp.guide(%L, %L) g$$, :'sg', :OWNER_G));
SELECT tests.check('setup: ready to publish needs a design — without one, not ready (even with a bookable unit)',
  format($$SELECT (g ->> 'bookable_units')::int = 1 AND NOT (g -> 'milestones' ->> 'site')::boolean
             AND NOT (g -> 'steps' -> 'template' ->> 'done')::boolean
            FROM pg_temp.guide(%L, %L) g$$, :'sg', :OWNER_G));

-- the business picks a design in the editor (first save = the draft)
SELECT pg_temp.call(:'sg', :OWNER_G,
  $$SELECT hospitality.site_draft_save(0, 'nature', '{"v": 1, "theme": "nature", "colors": {}, "sections": []}'::jsonb)$$) IS NOT NULL AS ok \gset
SELECT tests.check('setup: a draft → template done and the site ready to publish — but NOT published (a draft is never shown as published)',
  format($$SELECT (g -> 'steps' -> 'template' ->> 'theme') = 'nature' AND (g -> 'milestones' ->> 'site')::boolean
             AND (g -> 'steps' -> 'publish' ->> 'ready')::boolean
             AND NOT (g -> 'steps' -> 'publish' ->> 'published')::boolean
             AND NOT (g -> 'steps' -> 'publish' ->> 'done')::boolean
             AND (g -> 'steps' -> 'publish' ->> 'unpublished')::boolean
             AND g -> 'steps' -> 'publish' -> 'version' = 'null'::jsonb
             AND NOT (g -> 'steps' -> 'site' ->> 'done')::boolean
            FROM pg_temp.guide(%L, %L) g$$, :'sg', :OWNER_G));
SELECT tests.check('setup: management_context — the checklist gains "site" (ready) and keeps "policy"',
  format($$SELECT c -> 'checklist' = '{"business": true, "units": true, "photos": true, "prices": true, "policy": false, "site": true}'::jsonb
            FROM pg_temp.call(%L, %L, 'SELECT hospitality.management_context()') c$$, :'sg', :OWNER_G));
-- the business edits the draft: SEO title and a logo
SELECT pg_temp.call(:'sg', :OWNER_G, format(
  $$SELECT hospitality.site_draft_save(1, 'nature', '{"v": 1, "theme": "nature", "colors": {}, "sections": [], "logo": "%s", "seo": {"title": "צימרים בגליל"}}'::jsonb)$$,
  '73500000-0000-0000-0000-0000000000d1')) IS NOT NULL AS ok \gset
SELECT tests.check('setup: the draft was worked on → site details, SEO (now with a title, not only skipped) and logo done',
  format($$SELECT (g -> 'steps' -> 'site' ->> 'done')::boolean AND (g -> 'steps' -> 'seo' ->> 'has')::boolean
             AND (g -> 'steps' -> 'logo' ->> 'has')::boolean AND (g -> 'steps' -> 'logo' ->> 'done')::boolean
             AND NOT (g -> 'steps' -> 'publish' ->> 'published')::boolean
            FROM pg_temp.guide(%L, %L) g$$, :'sg', :OWNER_G));
SELECT pg_temp.call(:'sg', :OWNER_G, $$SELECT hospitality.site_publish(2, 'גרסה ראשונה')$$) IS NOT NULL AS ok \gset
SELECT tests.check('setup: published → publish done, version 1, no unpublished changes',
  format($$SELECT (g -> 'steps' -> 'publish' ->> 'published')::boolean AND (g -> 'steps' -> 'publish' ->> 'done')::boolean
             AND (g -> 'steps' -> 'publish' ->> 'version')::int = 1
             AND NOT (g -> 'steps' -> 'publish' ->> 'unpublished')::boolean
             AND g -> 'steps' -> 'publish' ->> 'published_at' IS NOT NULL
            FROM pg_temp.guide(%L, %L) g$$, :'sg', :OWNER_G));
-- (the guide reads the draft first: what goes live next — so the logo and the title stay in it)
SELECT pg_temp.call(:'sg', :OWNER_G, format(
  $$SELECT hospitality.site_draft_save(2, 'modern', '{"v": 1, "theme": "modern", "colors": {}, "sections": [], "logo": "%s", "seo": {"title": "צימרים בגליל"}}'::jsonb)$$,
  '73500000-0000-0000-0000-0000000000d1')) IS NOT NULL AS ok \gset
SELECT tests.check('setup: a later draft change → "unpublished changes", the published version stays 1 (and its theme is what guests see)',
  format($$SELECT (g -> 'steps' -> 'publish' ->> 'unpublished')::boolean
             AND (g -> 'steps' -> 'publish' ->> 'version')::int = 1
             AND (g -> 'steps' -> 'publish' ->> 'published')::boolean
             AND (SELECT v.theme FROM hospitality.site_versions v WHERE v.tenant_id = %1$L AND v.kind = 'published') = 'nature'
            FROM pg_temp.guide(%1$L, %2$L) g$$, :'sg', :OWNER_G));
SELECT tests.check('setup: site open / bookings open are the platform''s switches (both still closed here)',
  format($$SELECT NOT (g -> 'steps' -> 'publish' ->> 'site_open')::boolean AND NOT (g -> 'steps' -> 'publish' ->> 'booking_open')::boolean
            FROM pg_temp.guide(%L, %L) g$$, :'sg', :OWNER_G));

-- the policy: a deposit and an edit
UPDATE hospitality.policies SET deposit_kind = 'percent', deposit_value = 30 WHERE tenant_id = :'sg' AND is_default;
SELECT tests.check('setup: a deposit in the default policy → payments done; editing the policy → policy reviewed',
  format($$SELECT (g -> 'steps' -> 'payments' ->> 'done')::boolean AND g -> 'steps' -> 'payments' ->> 'deposit_kind' = 'percent'
             AND (g -> 'steps' -> 'payments' ->> 'deposit_value')::numeric = 30
             AND (g -> 'steps' -> 'policy' ->> 'reviewed')::boolean AND (g -> 'steps' -> 'policy' ->> 'done')::boolean
            FROM pg_temp.guide(%L, %L) g$$, :'sg', :OWNER_G));
SELECT tests.check('setup: everything done now (13 of 13)',
  format($$SELECT pg_temp.done(pg_temp.guide(%L, %L)) = 'details=1 contact=1 units=1 photos=1 prices=1 booking=1 policy=1 payments=1 template=1 logo=1 site=1 seo=1 publish=1'$$,
         :'sg', :OWNER_G));

-- not bookable any more: the property back to draft
UPDATE hospitality.properties SET status = 'draft' WHERE id = :GP;
SELECT tests.check('setup: no bookable unit (property in draft) → not ready to publish; the published version is still published',
  format($$SELECT NOT (g -> 'milestones' ->> 'site')::boolean AND (g ->> 'bookable_units')::int = 0
             AND (g -> 'steps' -> 'publish' ->> 'published')::boolean
             AND NOT (c -> 'checklist' ->> 'site')::boolean
            FROM pg_temp.guide(%1$L, %2$L) g, pg_temp.call(%1$L, %2$L, 'SELECT hospitality.management_context()') c$$,
         :'sg', :OWNER_G));
UPDATE hospitality.properties SET status = 'active' WHERE id = :GP;

-- ---------- cleanup: the platform-wide switches back off (other test files expect them off) ----------
SELECT pg_temp.as_platform($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_management_enabled', false)])$$) IS NOT NULL AS ok \gset

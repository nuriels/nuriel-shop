-- ============================================================
-- NURIEL AI SEO ENGINE (20261122100000_seo_engine.sql + 20261122110000_hosp_seo_engine.sql)
--   • closed tables (RLS, no direct privileges); server functions — service_role only; staff — signed in only
--   • honesty: numbers only from Google (Search Console / its CSV); template / AI ideas never carry numbers
--   • automation queue: a new business / unit / package / image / product → ONE queued job per type (deduplicated);
--     claim with SKIP LOCKED; a crashed job goes back to the queue
--   • proposals (both engines): nothing applied without approval; approve applies only if the field did not change
--     since (else stale); later; restore only while the field holds the approved text; auto-apply only when the
--     owner turned it on, only into EMPTY fields, never site texts
--   • packages: Google title / description only — price, description, terms, policy untouched
--   • isolation: another business, a stranger, a guest, a store agent — refused; the platform overview has numbers only
-- ============================================================
\set OWNER_A '''a0000000-0000-0000-0000-00000005e0a1'''
\set MGR_A '''a0000000-0000-0000-0000-00000005e0a2'''
\set OWNER_B '''a0000000-0000-0000-0000-00000005e0b1'''
\set STRANGER '''a0000000-0000-0000-0000-00000005e0c1'''
\set STORE_A '''70000000-0000-0000-0000-00000000000a'''
\set STORE_B '''70000000-0000-0000-0000-00000000000b'''
\set S_OWNER '''a0000000-0000-0000-0000-0000000000a1'''
\set S_AGENT '''a0000000-0000-0000-0000-0000000000a2'''
\set S_ADMIN_B '''a0000000-0000-0000-0000-0000000000b1'''
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''

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
CREATE OR REPLACE FUNCTION pg_temp.srv(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  EXECUTE _sql INTO r;
  RESET ROLE;
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.add_role(_site uuid, _uid uuid, _name text) RETURNS jsonb LANGUAGE sql AS $f$
  INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
  VALUES (_site, _uid, _name || '@test.local', _name, 'admin', true) RETURNING to_jsonb(true);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.h(_site text, _uid uuid, _call text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, 'SELECT to_jsonb(hospitality.' || _call || ')');
$f$;
-- a hospitality run + its proposals, as the app server does it
CREATE OR REPLACE FUNCTION pg_temp.hrun(_site uuid, _scope text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT (pg_temp.srv(format($q$SELECT to_jsonb(hospitality.seo_run_start(%L, NULL, 'template', %L))$q$, _site, _scope)) #>> '{}')::uuid;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.hadd(_site uuid, _run uuid, _items jsonb, _only_empty boolean) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.srv(format('SELECT hospitality.seo_proposals_add(%L, %L, %L, %L)', _site, _run, _items, _only_empty));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.hfin(_site uuid, _run uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.srv(format('SELECT hospitality.seo_run_finish(%L, %L, true)', _site, _run));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.hpid(_site uuid, _kind text, _target uuid, _field text, _status text DEFAULT 'pending')
RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM hospitality.seo_proposals WHERE tenant_id = _site AND target_kind = _kind
     AND target_id IS NOT DISTINCT FROM _target AND field = _field AND status = _status ORDER BY created_at DESC LIMIT 1;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.sadd(_site uuid, _items jsonb, _only_empty boolean) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.srv(format('SELECT public.store_seo_proposals_add(%L, %L, %L)', _site, _items, _only_empty));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.spid(_site uuid, _target uuid, _field text, _status text DEFAULT 'pending')
RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.store_seo_proposals WHERE tenant_id = _site AND target_id IS NOT DISTINCT FROM _target
     AND field = _field AND status = _status ORDER BY created_at DESC LIMIT 1;
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-00000005e0a1', 'se.owner.a@test.local', now()),
  ('a0000000-0000-0000-0000-00000005e0a2', 'se.mgr.a@test.local', now()),
  ('a0000000-0000-0000-0000-00000005e0b1', 'se.owner.b@test.local', now()),
  ('a0000000-0000-0000-0000-00000005e0c1', 'se.stranger@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('se-a', 'מנוע SEO A'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('se-b', 'מנוע SEO B'))$$) IS NOT NULL AS ok \gset
SELECT id AS sa FROM public.tenants WHERE slug = 'se-a' \gset
SELECT id AS sb FROM public.tenants WHERE slug = 'se-b' \gset

SELECT tests.check('seo engine: a new business gets its SEO settings (every auto switch OFF, weekly audit on) and ONE initial scan, 15 minutes later',
  format($$SELECT EXISTS (SELECT 1 FROM public.seo_settings s WHERE s.tenant_id = %1$L AND s.weekly_audit
                            AND s.auto_apply = '{"alt": false, "meta": false, "keywords": false}'::jsonb)
           AND (SELECT count(*) FROM public.seo_jobs j WHERE j.tenant_id = %1$L AND j.kind = 'initial'
                  AND j.status = 'queued' AND j.run_after > now() + interval '14 minutes') = 1$$, :'sa'));

SELECT pg_temp.add_role(:'sa', :OWNER_A, 'se_owner_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sa', :MGR_A, 'se_mgr_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sb', :OWNER_B, 'se_owner_b') IS NOT NULL AS ok \gset
UPDATE public.user_roles SET is_protected = true WHERE user_id IN (:OWNER_A, :OWNER_B);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'sa', :'sb')) IS NOT NULL AS ok \gset
SELECT pg_temp.h(:'sa', :OWNER_A, $$property_create('{"name": "מתחם המנוע", "property_type": "zimmer_complex", "status": "active"}')$$) ->> 'id' AS pa \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_create(%L, '{"name": "צימר גפן", "unit_type": "zimmer", "capacity": 2}')$$, :'pa')) ->> 'id' AS u1 \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_create(%L, '{"name": "צימר תאנה", "unit_type": "zimmer", "capacity": 4}')$$, :'pa')) ->> 'id' AS u2 \gset
SELECT pg_temp.h(:'sb', :OWNER_B, $$property_create('{"name": "מתחם B", "property_type": "villa"}')$$) ->> 'id' AS pb \gset
SELECT pg_temp.h(:'sb', :OWNER_B, format($$unit_create(%L, '{"name": "וילה B", "unit_type": "villa"}')$$, :'pb')) ->> 'id' AS ub \gset

SELECT tests.check('seo engine: two new units → ONE queued "new units" job for the business (deduplicated), none for the other business''s type',
  format($$SELECT (SELECT count(*) FROM public.seo_jobs WHERE tenant_id = %1$L AND kind = 'entity' AND entity_type = 'unit'
                    AND status = 'queued') = 1
           AND (SELECT count(*) FROM public.seo_jobs WHERE tenant_id = %1$L AND kind = 'entity' AND entity_type = 'package') = 0$$, :'sa'));

SELECT pg_temp.call(:'sa', :OWNER_A, format($q$SELECT hospitality.package_save(_id => NULL, _unit_id => %L, _kind => 'special',
  _name => 'חבילת כלה – בדיקה', _nights => 2, _price => 4000, _max_guests => 2,
  _description => 'תיאור שבעל העסק כתב', _terms => 'תנאים שבעל העסק כתב')$q$, :'u1')) ->> 'id' AS pkg \gset
SELECT pg_temp.call(:'sa', :OWNER_A, format($q$SELECT hospitality.media_add('site', NULL, %L)$q$,
  jsonb_build_object('kind', 'image', 'storage_path', :'sa' || '/' || gen_random_uuid() || '.webp', 'size_bytes', 900))) ->> 'id' AS img \gset
SELECT pg_temp.call(:'sa', :OWNER_A, format($q$SELECT hospitality.media_add('site', NULL, %L)$q$,
  jsonb_build_object('kind', 'image', 'storage_path', :'sa' || '/' || gen_random_uuid() || '.webp', 'size_bytes', 900))) ->> 'id' AS img2 \gset
SELECT tests.check('seo engine: a new package and new images → one "package" job and one "media" job',
  format($$SELECT (SELECT count(*) FROM public.seo_jobs WHERE tenant_id = %1$L AND entity_type = 'package' AND status = 'queued') = 1
           AND (SELECT count(*) FROM public.seo_jobs WHERE tenant_id = %1$L AND entity_type = 'media' AND status = 'queued') = 1$$, :'sa'));

-- the site draft: hero + about, the owner wrote nothing for Google yet
SELECT pg_temp.call(:'sa', :OWNER_A, $q$SELECT hospitality.site_draft_save(0, 'luxury',
  '{"v": 1, "theme": "luxury", "sections": [{"id": "hero", "type": "hero", "hidden": false, "content": {"title": "ברוכים הבאים"}}]}'::jsonb)$q$) IS NOT NULL AS ok \gset
-- unit 2 — the owner already wrote its Google title
SELECT (pg_temp.h(:'sa', :OWNER_A, format('unit_seo_get(%L)', :'u2')) ->> 'revision')::int AS u2r \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format('unit_seo_set(%L, %L, NULL, %s)', :'u2', 'כותרת שהעסק כתב', :u2r)) IS NOT NULL AS ok \gset

-- ============================================================
-- 1. Structure and privileges
-- ============================================================
SELECT tests.check('seo engine: the 7 new tables are closed — RLS on, no direct privilege for anon / authenticated / service_role',
  $$SELECT bool_and(c.relrowsecurity
                    AND NOT has_table_privilege('anon', c.oid, 'SELECT')
                    AND NOT has_table_privilege('authenticated', c.oid, 'SELECT')
                    AND NOT has_table_privilege('authenticated', c.oid, 'INSERT')
                    AND NOT has_table_privilege('service_role', c.oid, 'SELECT'))
      FROM pg_class c WHERE c.oid IN ('public.seo_settings'::regclass, 'public.seo_audits'::regclass,
        'public.seo_keyword_ideas'::regclass, 'public.seo_gsc_connections'::regclass, 'public.seo_gsc_snapshots'::regclass,
        'public.seo_jobs'::regclass, 'public.store_seo_proposals'::regclass)$$);
SELECT tests.check('seo engine: server functions (queue, audits, ideas, tokens, proposals add) — service_role only',
  $$SELECT bool_and(NOT has_function_privilege('anon', f, 'EXECUTE') AND NOT has_function_privilege('authenticated', f, 'EXECUTE')
                    AND has_function_privilege('service_role', f, 'EXECUTE'))
      FROM unnest(ARRAY['public.seo_jobs_claim(integer)', 'public.seo_job_finish(bigint,text,jsonb,text)',
                        'public.seo_audit_save(uuid,text,jsonb,uuid)', 'public.seo_keyword_ideas_add(uuid,jsonb)',
                        'public.seo_gsc_connection_get(uuid)', 'public.seo_gsc_connection_save(uuid,text,text,uuid)',
                        'public.store_seo_proposals_add(uuid,jsonb,boolean)', 'public.store_seo_snapshot(uuid,boolean,integer)',
                        'public.seo_tenant_basics(uuid)']::regprocedure[]) f$$);
SELECT tests.check('seo engine: staff functions — signed-in users only (the function checks the role), never a guest',
  $$SELECT bool_and(NOT has_function_privilege('anon', f, 'EXECUTE') AND has_function_privilege('authenticated', f, 'EXECUTE'))
      FROM unnest(ARRAY['public.seo_center()', 'public.store_seo_proposal_decide(uuid,text,text)',
                        'public.store_seo_proposal_revert(uuid)', 'public.seo_settings_save(jsonb)',
                        'public.seo_platform_overview()', 'hospitality.seo_proposal_revert(uuid)',
                        'hospitality.package_seo_set(uuid,text,text,integer)']::regprocedure[]) f$$);
SELECT tests.check('seo engine: internal helpers are callable by no API role',
  $$SELECT bool_and(NOT has_function_privilege('authenticated', f, 'EXECUTE') AND NOT has_function_privilege('anon', f, 'EXECUTE'))
      FROM unnest(ARRAY['hospitality._seo_apply(uuid,text,uuid,text,text)', 'hospitality._seo_auto_write(uuid,text,uuid,text,text)',
                        'public._store_seo_write(uuid,text,uuid,text,text)', 'public._seo_enqueue(uuid,text,text,interval)']::regprocedure[]) f$$);

-- ============================================================
-- 2. Honesty: numbers only from Google
-- ============================================================
SELECT pg_temp.expect_error('seo engine: the database refuses numbers on a template / AI keyword idea (CHECK)',
  format($$INSERT INTO public.seo_keyword_ideas (tenant_id, phrase, kind, intent, source, metrics)
           VALUES (%L, 'צימר עם בריכה', 'primary', 'commercial', 'ai', '{"volume": 5400}')$$, :'sa'), 'seo_keyword_ideas_honesty');
SELECT pg_temp.srv(format($q$SELECT public.seo_keyword_ideas_add(%L, %L::jsonb)$q$, :'sa', jsonb_build_array(
  jsonb_build_object('phrase', 'צימר בישעי', 'kind', 'local', 'intent', 'local', 'source', 'template', 'reason', 'סוג העסק + המקום',
                     'metrics', jsonb_build_object('impressions', 999)),
  jsonb_build_object('phrase', 'נופי דורית', 'kind', 'brand', 'intent', 'navigational', 'source', 'gsc',
                     'metrics', jsonb_build_object('impressions', 1500, 'clicks', 120, 'position', 1.4)),
  jsonb_build_object('phrase', 'ביטוי פסול', 'kind', 'invented', 'intent', 'local', 'source', 'template')))) IS NOT NULL AS ok \gset
SELECT pg_temp.srv(format($q$SELECT public.seo_keyword_ideas_add(%L, %L::jsonb)$q$, :'sa', jsonb_build_array(
  jsonb_build_object('phrase', 'נופי דורית', 'kind', 'brand', 'intent', 'navigational', 'source', 'ai')))) IS NOT NULL AS ok \gset
SELECT tests.check('seo engine: a template idea is stored WITHOUT the numbers it came with; Google''s numbers stay and are never overwritten by an AI idea; an unknown kind is skipped',
  format($$SELECT (SELECT metrics IS NULL AND source = 'template' FROM public.seo_keyword_ideas WHERE tenant_id = %1$L AND phrase = 'צימר בישעי')
           AND (SELECT metrics ->> 'impressions' = '1500' AND source = 'gsc' FROM public.seo_keyword_ideas WHERE tenant_id = %1$L AND phrase = 'נופי דורית')
           AND NOT EXISTS (SELECT 1 FROM public.seo_keyword_ideas WHERE tenant_id = %1$L AND phrase = 'ביטוי פסול')$$, :'sa'));

-- ============================================================
-- 3. The queue: claim, finish, crashed jobs
-- ============================================================
UPDATE public.seo_jobs SET run_after = now() - interval '1 minute' WHERE tenant_id = :'sa' AND status = 'queued';
CREATE TEMP TABLE se_claimed AS SELECT * FROM public.seo_jobs_claim(50) WHERE tenant_id = :'sa';
SELECT tests.check('seo engine: due jobs are claimed once (running, attempt 1, locked 15 minutes); a second claim does not get them again',
  format($$SELECT (SELECT count(*) FROM se_claimed) >= 4
           AND (SELECT bool_and(status = 'running' AND attempts = 1 AND locked_until > now() + interval '14 minutes') FROM se_claimed)
           AND NOT EXISTS (SELECT 1 FROM public.seo_jobs_claim(50) c WHERE c.tenant_id = %L)$$, :'sa'));
SELECT public.seo_job_finish(id, 'done', '{"ok": true}'::jsonb, NULL) FROM se_claimed WHERE entity_type = 'unit';
UPDATE public.seo_jobs SET locked_until = now() - interval '1 minute' WHERE tenant_id = :'sa' AND entity_type = 'media' AND status = 'running';
SELECT count(*) AS n FROM public.seo_jobs_claim(0) \gset
SELECT tests.check('seo engine: a finished job is done; a job whose instance crashed (lock expired) is claimed again (attempt 2)',
  format($$SELECT (SELECT status FROM public.seo_jobs WHERE tenant_id = %1$L AND entity_type = 'unit' ORDER BY id DESC LIMIT 1) = 'done'
           AND (SELECT status = 'running' AND attempts = 2 FROM public.seo_jobs WHERE tenant_id = %1$L AND entity_type = 'media'
                 ORDER BY id DESC LIMIT 1)$$, :'sa'));
UPDATE public.seo_jobs SET status = 'done', locked_until = NULL WHERE tenant_id IN (:'sa', :'sb') AND status = 'running';

-- ============================================================
-- 4. Packages: the Google title / description only
-- ============================================================
SELECT (pg_temp.call(:'sa', :OWNER_A, 'SELECT hospitality.packages_view()') #>> '{packages,0,revision}')::int AS pr0 \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format('package_seo_set(%L, %L, NULL, %s)', :'pkg', E'חבילת כלה <b>VIP</b>\nבנופים', :pr0)) ->> 'revision' AS pr1 \gset
SELECT tests.check('seo engine: package_seo_set — one clean line (no tags / line breaks), revision +1; price, nights, description, terms, policy untouched',
  format($$SELECT p.seo_title = 'חבילת כלה bVIP/b בנופים' AND p.revision = %2$s AND p.price = 4000 AND p.nights = 2
             AND p.description = 'תיאור שבעל העסק כתב' AND p.terms = 'תנאים שבעל העסק כתב' AND p.policy_id IS NULL
             AND p.seo_description IS NULL
      FROM hospitality.packages p WHERE p.id = %1$L$$, :'pkg', :pr1));
SELECT pg_temp.expect_error('seo engine: package_seo_set with an old revision → refused (someone changed it meanwhile)',
  format($$SELECT pg_temp.h(%L, %L, %L)$$, :'sa', :OWNER_A, format('package_seo_set(%L, NULL, NULL, %s)', :'pkg', :pr0)), 'עודכנה בינתיים');
SELECT pg_temp.expect_error('seo engine: package_seo_set — over 120 characters refused',
  format($$SELECT pg_temp.h(%L, %L, %L)$$, :'sa', :OWNER_A,
         format('package_seo_set(%L, %L, NULL, %s)', :'pkg', repeat('א', 121), :pr1)), 'עד 120');
SELECT pg_temp.expect_error('seo engine: package_seo_set by the owner of another business → not found',
  format($$SELECT pg_temp.h(%L, %L, %L)$$, :'sb', :OWNER_B, format('package_seo_set(%L, NULL, NULL, %s)', :'pkg', :pr1)), 'לא נמצאה');
SELECT pg_temp.h(:'sa', :OWNER_A, format('package_seo_set(%L, NULL, NULL, %s)', :'pkg', :pr1)) IS NOT NULL AS ok \gset
SELECT tests.check('seo engine: the public package JSON (site pages) carries the Google title / description fields (the page head)',
  format($$SELECT hospitality._package_json(p.tenant_id, p, false) ?& ARRAY['seo_title', 'seo_description']
      FROM hospitality.packages p WHERE p.id = %L$$, :'pkg'));
SELECT tests.check('seo engine: the management package view carries seo_title / seo_description',
  format($$SELECT (pg_temp.call(%L, %L, 'SELECT hospitality.packages_view()') #> '{packages,0}') ?& ARRAY['seo_title', 'seo_description']$$, :'sa', :OWNER_A));

-- ============================================================
-- 5. Hospitality proposals: package target, reason, later, approve, restore
-- ============================================================
SELECT pg_temp.hrun(:'sa', 'request') AS run1 \gset
SELECT pg_temp.hadd(:'sa', :'run1', jsonb_build_array(
  jsonb_build_object('target_kind', 'package', 'target_id', :'pkg', 'field', 'seo_title', 'text', 'חבילת כלה VIP בנופי דורית',
                     'reason', 'כותרת קצרה עם שם החבילה — מה שאנשים מחפשים'),
  jsonb_build_object('target_kind', 'package', 'target_id', :'pkg', 'field', 'description', 'text', 'תיאור חדש שה-AI כתב'),
  jsonb_build_object('target_kind', 'package', 'target_id', :'ub', 'field', 'seo_title', 'text', 'חבילה של עסק אחר'),
  jsonb_build_object('target_kind', 'unit', 'target_id', :'u1', 'field', 'seo_title', 'text', 'צימר גפן — זוגי'),
  jsonb_build_object('target_kind', 'site', 'field', 'seo_title', 'text', 'מנוע SEO A — צימרים'),
  jsonb_build_object('target_kind', 'media', 'target_id', :'img', 'field', 'alt', 'text', 'נוף מהמרפסת')), false) AS add1 \gset
SELECT tests.check('seo engine: proposals enter as PENDING only — the package''s own description is never a target, another business''s item is skipped, the reason is kept',
  format($$SELECT (%3$L::jsonb ->> 'added')::int = 4 AND (%3$L::jsonb ->> 'skipped')::int = 2 AND NOT (%3$L::jsonb ? 'applied')
           AND (SELECT reason FROM hospitality.seo_proposals WHERE id = pg_temp.hpid(%1$L, 'package', %2$L, 'seo_title'))
               = 'כותרת קצרה עם שם החבילה — מה שאנשים מחפשים'
           AND (SELECT seo_title IS NULL AND description = 'תיאור שבעל העסק כתב' FROM hospitality.packages WHERE id = %2$L)$$,
         :'sa', :'pkg', :'add1'));
SELECT pg_temp.hfin(:'sa', :'run1') IS NOT NULL AS ok \gset
SELECT pg_temp.hpid(:'sa', 'package', :'pkg', 'seo_title') AS pp \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format('seo_proposal_decide(%L, %L)', :'pp', 'later')) ->> 'status' AS st \gset
SELECT tests.check('seo engine: "later" keeps the proposal open (not applied, no decision time)',
  format($$SELECT %2$L = 'later' AND (SELECT status = 'later' AND decided_at IS NULL FROM hospitality.seo_proposals WHERE id = %1$L)
           AND (SELECT seo_title IS NULL FROM hospitality.packages WHERE id = %3$L)$$, :'pp', :'st', :'pkg'));
SELECT pg_temp.hrun(:'sa', 'auto') AS run2 \gset
SELECT pg_temp.hadd(:'sa', :'run2', jsonb_build_array(
  jsonb_build_object('target_kind', 'package', 'target_id', :'pkg', 'field', 'seo_title', 'text', 'נוסח אוטומטי אחר')), true) AS add2 \gset
SELECT pg_temp.hfin(:'sa', :'run2') IS NOT NULL AS ok \gset
SELECT tests.check('seo engine: an automatic run never replaces a proposal the owner saved for later',
  format($$SELECT (%2$L::jsonb ->> 'added')::int = 0 AND (SELECT status FROM hospitality.seo_proposals WHERE id = %1$L) = 'later'$$,
         :'pp', :'add2'));
SELECT (pg_temp.call(:'sa', :OWNER_A, 'SELECT hospitality.packages_view()') #>> '{packages,0,revision}')::int AS pr2 \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format('seo_proposal_decide(%L, %L, %L)', :'pp', 'approve', 'חבילת כלה VIP – נופי דורית')) ->> 'status' AS st \gset
SELECT tests.check('seo engine: approving a saved proposal (edited first) writes ONLY the package''s Google title; price / description / terms unchanged; logged',
  format($$SELECT %2$L = 'approved'
           AND (SELECT p.seo_title = 'חבילת כלה VIP – נופי דורית' AND p.price = 4000 AND p.description = 'תיאור שבעל העסק כתב'
                       AND p.terms = 'תנאים שבעל העסק כתב' AND p.revision = %4$s + 1
                  FROM hospitality.packages p WHERE p.id = %3$L)
           AND (SELECT status = 'approved' AND applied = 'חבילת כלה VIP – נופי דורית' AND decided_by IS NOT NULL
                  FROM hospitality.seo_proposals WHERE id = %1$L)
           AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %5$L AND a.action = 'seo.proposal_approved')$$,
         :'pp', :'st', :'pkg', :pr2, :'sa'));
SELECT pg_temp.expect_error('seo engine: a decided proposal cannot be decided again',
  format($$SELECT pg_temp.h(%L, %L, %L)$$, :'sa', :OWNER_A, format('seo_proposal_decide(%L, ''reject'')', :'pp')), 'כבר טופלה');
SELECT pg_temp.expect_error('seo engine: the owner of another business cannot restore it',
  format($$SELECT pg_temp.h(%L, %L, %L)$$, :'sb', :OWNER_B, format('seo_proposal_revert(%L)', :'pp')), 'לא נמצאה');
SELECT pg_temp.expect_error('seo engine: a guest cannot list proposals',
  format($$SELECT pg_temp.call(%L, NULL, 'SELECT hospitality.seo_proposals()')$$, :'sa'), 'permission denied');
SELECT pg_temp.h(:'sa', :OWNER_A, format('seo_proposal_revert(%L)', :'pp')) ->> 'status' AS st \gset
SELECT tests.check('seo engine: restore → the package''s Google title is back to before (empty), the proposal is "reverted", logged',
  format($$SELECT %2$L = 'reverted' AND (SELECT seo_title IS NULL AND price = 4000 FROM hospitality.packages WHERE id = %3$L)
           AND (SELECT status = 'reverted' AND reverted_at IS NOT NULL AND reverted_by IS NOT NULL FROM hospitality.seo_proposals WHERE id = %1$L)
           AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %4$L AND a.action = 'seo.proposal_reverted')$$,
         :'pp', :'st', :'pkg', :'sa'));
SELECT pg_temp.expect_error('seo engine: a restored proposal cannot be restored again',
  format($$SELECT pg_temp.h(%L, %L, %L)$$, :'sa', :OWNER_A, format('seo_proposal_revert(%L)', :'pp')), 'רק הצעה שאושרה');

-- restore refused when the field changed after the approval
SELECT pg_temp.hpid(:'sa', 'unit', :'u1', 'seo_title') AS pu \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format('seo_proposal_decide(%L, %L)', :'pu', 'approve')) ->> 'status' AS st \gset
SELECT (pg_temp.h(:'sa', :OWNER_A, format('unit_seo_get(%L)', :'u1')) ->> 'revision')::int AS u1r \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format('unit_seo_set(%L, %L, NULL, %s)', :'u1', 'כותרת שבעל העסק שינה אחר כך', :u1r)) IS NOT NULL AS ok \gset
SELECT pg_temp.expect_error('seo engine: restore refused after the owner changed the field — a later change is never overwritten',
  format($$SELECT pg_temp.h(%L, %L, %L)$$, :'sa', :OWNER_A, format('seo_proposal_revert(%L)', :'pu')), 'השתנה מאז האישור');
SELECT tests.check('seo engine: … and the owner''s newer text is still there',
  format($$SELECT seo_title = 'כותרת שבעל העסק שינה אחר כך' FROM hospitality.units WHERE id = %L$$, :'u1'));

-- site field: approve then restore to "empty" — the key is removed, the rest of the draft is intact (never wiped)
SELECT pg_temp.hpid(:'sa', 'site', NULL, 'seo_title') AS ps \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format('seo_proposal_decide(%L, %L)', :'ps', 'approve')) ->> 'status' AS st \gset
SELECT tests.check('seo engine: a site text is approved into the DRAFT only (the published site changes on "publish")',
  format($$SELECT %2$L = 'approved' AND (SELECT document #>> '{seo,title}' FROM hospitality.site_versions
                                            WHERE tenant_id = %1$L AND kind = 'draft') = 'מנוע SEO A — צימרים'$$, :'sa', :'st'));
SELECT pg_temp.h(:'sa', :OWNER_A, format('seo_proposal_revert(%L)', :'ps')) ->> 'status' AS st \gset
SELECT tests.check('seo engine: restoring a site text to empty removes only that key — the draft keeps its sections',
  format($$SELECT %2$L = 'reverted' AND d.document IS NOT NULL AND NOT (d.document -> 'seo' ? 'title')
             AND d.document #>> '{sections,0,content,title}' = 'ברוכים הבאים'
      FROM hospitality.site_versions d WHERE d.tenant_id = %1$L AND d.kind = 'draft'$$, :'sa', :'st'));

-- stale: the field changed between the proposal and the approval
SELECT pg_temp.hrun(:'sa', 'request') AS run3 \gset
SELECT pg_temp.hadd(:'sa', :'run3', jsonb_build_array(
  jsonb_build_object('target_kind', 'unit', 'target_id', :'u2', 'field', 'seo_description', 'text', 'צימר תאנה למשפחות')), false) IS NOT NULL AS ok \gset
SELECT pg_temp.hfin(:'sa', :'run3') IS NOT NULL AS ok \gset
SELECT (pg_temp.h(:'sa', :OWNER_A, format('unit_seo_get(%L)', :'u2')) ->> 'revision')::int AS u2r \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format('unit_seo_set(%L, %L, %L, %s)', :'u2', 'כותרת שהעסק כתב', 'תיאור שהעסק כתב בינתיים', :u2r)) IS NOT NULL AS ok \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format('seo_proposal_decide(%L, %L)', pg_temp.hpid(:'sa', 'unit', :'u2', 'seo_description'), 'approve')) ->> 'status' AS st \gset
SELECT tests.check('seo engine: approving after the owner changed the field → "stale", the owner''s text stays',
  format($$SELECT %2$L = 'stale' AND (SELECT seo_description FROM hospitality.units WHERE id = %1$L) = 'תיאור שהעסק כתב בינתיים'$$, :'u2', :'st'));

-- ============================================================
-- 6. Hospitality auto-apply: only when the owner turned it on, only empty fields, never site texts
-- ============================================================
SELECT pg_temp.expect_error('seo engine: a guest cannot change the SEO settings',
  format($$SELECT pg_temp.call(%L, NULL, 'SELECT public.seo_settings_save(''{"meta": true}'')')$$, :'sa'), 'permission denied');
SELECT pg_temp.expect_error('seo engine: a stranger cannot change the SEO settings of a business',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT public.seo_settings_save(''{"meta": true}'')')$$, :'sa', :STRANGER), 'אין הרשאה');
SELECT pg_temp.expect_error('seo engine: an unknown setting is refused',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT public.seo_settings_save(''{"publish_everything": true}'')')$$, :'sa', :OWNER_A), 'שדה לא מוכר');
SELECT pg_temp.call(:'sa', :OWNER_A, $q$SELECT public.seo_settings_save('{"meta": true, "alt": true}')$q$) IS NOT NULL AS ok \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_create(%L, '{"name": "צימר רימון", "unit_type": "zimmer", "capacity": 2}')$$, :'pa')) ->> 'id' AS u3 \gset
SELECT pg_temp.hrun(:'sa', 'auto') AS run4 \gset
SELECT pg_temp.hadd(:'sa', :'run4', jsonb_build_array(
  jsonb_build_object('target_kind', 'unit', 'target_id', :'u3', 'field', 'seo_title', 'text', 'צימר רימון — זוגי'),
  jsonb_build_object('target_kind', 'unit', 'target_id', :'u2', 'field', 'seo_title', 'text', 'נוסח אחר לכותרת שהעסק כתב'),
  jsonb_build_object('target_kind', 'media', 'target_id', :'img2', 'field', 'alt', 'text', 'בריכה מחוממת בערב'),
  jsonb_build_object('target_kind', 'site', 'field', 'seo_description', 'text', 'תיאור אתר אוטומטי')), false) AS add4 \gset
SELECT pg_temp.hfin(:'sa', :'run4') IS NOT NULL AS ok \gset
SELECT tests.check('seo engine: with "meta" + "alt" ON: an EMPTY unit title and an EMPTY image alt are filled (auto, approved, logged); the owner''s own title is NOT touched (pending); a site text stays pending',
  format($$SELECT (%5$L::jsonb ->> 'applied')::int = 2
           AND (SELECT seo_title FROM hospitality.units WHERE id = %1$L) = 'צימר רימון — זוגי'
           AND (SELECT alt FROM hospitality.media WHERE id = %3$L) = 'בריכה מחוממת בערב'
           AND (SELECT seo_title FROM hospitality.units WHERE id = %2$L) = 'כותרת שהעסק כתב'
           AND (SELECT status = 'approved' AND auto_applied AND decided_by IS NULL FROM hospitality.seo_proposals
                 WHERE id = pg_temp.hpid(%4$L, 'unit', %1$L, 'seo_title', 'approved'))
           AND pg_temp.hpid(%4$L, 'unit', %2$L, 'seo_title') IS NOT NULL
           AND pg_temp.hpid(%4$L, 'site', NULL, 'seo_description') IS NOT NULL
           AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %4$L AND a.action = 'catalog.unit_updated'
                         AND a.changes ->> 'auto' = 'true')$$,
         :'u3', :'u2', :'img2', :'sa', :'add4'));
SELECT pg_temp.h(:'sa', :OWNER_A, format('seo_proposal_revert(%L)', pg_temp.hpid(:'sa', 'unit', :'u3', 'seo_title', 'approved'))) ->> 'status' AS st \gset
SELECT tests.check('seo engine: an auto-filled text can be restored (the unit title is empty again)',
  format($$SELECT %2$L = 'reverted' AND (SELECT seo_title IS NULL FROM hospitality.units WHERE id = %1$L)$$, :'u3', :'st'));
SELECT tests.check('seo engine: the other business is unaffected — no auto switch, nothing filled',
  format($$SELECT (SELECT auto_apply = '{"alt": false, "meta": false, "keywords": false}'::jsonb FROM public.seo_settings WHERE tenant_id = %1$L)
           AND NOT EXISTS (SELECT 1 FROM hospitality.seo_proposals WHERE tenant_id = %1$L)$$, :'sb'));
SELECT tests.check('seo engine: the list shows reason, saved-for-later, restored and auto marks; the other business sees none of it',
  format($$SELECT (SELECT bool_or(e ->> 'status' = 'reverted') AND bool_or((e ->> 'auto_applied')::boolean) AND bool_or(e ? 'reason')
                     FROM jsonb_array_elements(pg_temp.call(%1$L, %2$L, 'SELECT hospitality.seo_proposals()') -> 'proposals') e)
           AND jsonb_array_length(pg_temp.call(%3$L, %4$L, 'SELECT hospitality.seo_proposals()') -> 'proposals') = 0$$,
         :'sa', :OWNER_A, :'sb', :OWNER_B));

-- ============================================================
-- 7. Ecommerce proposals
-- ============================================================
INSERT INTO public.categories (tenant_id, name)
SELECT x.t, x.n FROM (VALUES (:STORE_A::uuid, 'מטבח'), (:STORE_B::uuid, 'כללי')) x(t, n)
 WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.tenant_id = x.t AND c.name = x.n);
INSERT INTO public.global_products (tenant_id, sku, name, category, description, created_by)
VALUES (:STORE_A, '99520001', 'כוס קרמיקה בעבודת יד', 'מטבח', 'כוס קרמיקה 350 מ"ל', :S_OWNER),
       (:STORE_A, '99520002', 'קערת הגשה', 'מטבח', NULL, :S_OWNER),
       (:STORE_B, '99520003', 'מוצר של חנות B', 'כללי', NULL, :S_ADMIN_B);
SELECT id AS g1 FROM public.global_products WHERE sku = '99520001' \gset
SELECT id AS g2 FROM public.global_products WHERE sku = '99520002' \gset
SELECT id AS g3 FROM public.global_products WHERE sku = '99520003' \gset
UPDATE public.global_products SET seo_description = 'תיאור שבעל החנות כתב' WHERE id = :'g2';
-- the store's name in the snapshot = the name the store shows (business name → site title → tenant name):
-- most stores never fill the business name, and the templates make nothing without a name
CREATE TEMP TABLE seo_ss_name AS SELECT tenant_id, business_name, site_title FROM public.site_settings WHERE tenant_id = :STORE_A;
UPDATE public.site_settings SET business_name = 'כלי בית א', site_title = 'כותרת האתר' WHERE tenant_id = :STORE_A;
SELECT tests.check('seo engine (store): the snapshot names the store by its business name when there is one',
  format($$SELECT pg_temp.srv(format('SELECT public.store_seo_snapshot(%%L)', %1$L)) #>> '{store,name}' = 'כלי בית א'
           AND pg_temp.call(%1$L, %2$L, 'SELECT public.seo_center()') ->> 'business_name' = 'כלי בית א'$$, :STORE_A, :S_OWNER));
UPDATE public.site_settings SET business_name = '  ', site_title = 'כלי בית של א' WHERE tenant_id = :STORE_A;
SELECT tests.check('seo engine (store): no business name → the snapshot names the store by its site title (as the storefront does)',
  format($$SELECT pg_temp.srv(format('SELECT public.store_seo_snapshot(%%L)', %1$L)) #>> '{store,name}' = 'כלי בית של א'
           AND pg_temp.call(%1$L, %2$L, 'SELECT public.seo_center()') ->> 'business_name' = 'כלי בית של א'$$, :STORE_A, :S_OWNER));
UPDATE public.site_settings SET business_name = '', site_title = ' ' WHERE tenant_id = :STORE_A;
SELECT tests.check('seo engine (store): no business name and no site title → the tenant''s name; the products are still there',
  format($$SELECT (x #>> '{store,name}') = (SELECT name FROM public.tenants WHERE id = %1$L)
           AND jsonb_array_length(x -> 'products') >= 2
      FROM (SELECT pg_temp.srv(format('SELECT public.store_seo_snapshot(%%L)', %1$L)) AS x) y$$, :STORE_A));
UPDATE public.site_settings s SET business_name = o.business_name, site_title = o.site_title
  FROM seo_ss_name o WHERE s.tenant_id = o.tenant_id;
DROP TABLE seo_ss_name;
SELECT tests.check('seo engine: new products → ONE queued "new products" job per store',
  format($$SELECT (SELECT count(*) FROM public.seo_jobs WHERE tenant_id = %L AND entity_type = 'product' AND status = 'queued') = 1$$, :STORE_A));
SELECT pg_temp.sadd(:STORE_A, jsonb_build_array(
  jsonb_build_object('target_kind', 'product', 'target_id', :'g1', 'field', 'seo_title', 'text', 'כוס קרמיקה בעבודת יד | מטבח', 'reason', 'שם המוצר + הקטגוריה'),
  jsonb_build_object('target_kind', 'product', 'target_id', :'g2', 'field', 'seo_description', 'text', 'נוסח אחר'),
  jsonb_build_object('target_kind', 'product', 'target_id', :'g3', 'field', 'seo_title', 'text', 'מוצר של חנות אחרת'),
  jsonb_build_object('target_kind', 'product', 'target_id', :'g1', 'field', 'seo_title', 'text', 'כוס <script>')), true) AS sadd1 \gset
SELECT tests.check('seo engine (store): only empty fields of THIS store get a pending proposal; another store''s product, an owner''s text and markup are skipped; nothing written',
  format($$SELECT (%1$L::jsonb ->> 'added')::int = 1 AND (%1$L::jsonb ->> 'skipped')::int = 3 AND (%1$L::jsonb ->> 'auto_applied')::int = 0
           AND (SELECT seo_title IS NULL FROM public.global_products WHERE id = %2$L)$$, :'sadd1', :'g1'));
SELECT pg_temp.expect_error('seo engine (store): a store agent cannot open the SEO center',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT public.store_seo_proposals()')$$, :STORE_A, :S_AGENT), 'אין הרשאה');
SELECT tests.check('seo engine (store): the store admin sees the proposal with its reason and the current (empty) value; store B''s admin sees none',
  format($$SELECT (SELECT bool_or(e ->> 'reason' = 'שם המוצר + הקטגוריה' AND e ->> 'current' = '')
                     FROM jsonb_array_elements(pg_temp.call(%1$L, %2$L, 'SELECT public.store_seo_proposals()') -> 'proposals') e)
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.call(%3$L, %4$L, 'SELECT public.store_seo_proposals()') -> 'proposals') e
                            WHERE e ->> 'target_id' = %5$L)$$,
         :STORE_A, :S_OWNER, :STORE_B, :S_ADMIN_B, :'g1'));
SELECT pg_temp.spid(:STORE_A, :'g1', 'seo_title') AS sp1 \gset
SELECT pg_temp.expect_error('seo engine (store): store B''s admin cannot decide store A''s proposal',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :STORE_B, :S_ADMIN_B, format('SELECT public.store_seo_proposal_decide(%L, ''approve'')', :'sp1')), 'לא נמצאה');
SELECT pg_temp.call(:STORE_A, :S_OWNER, format($q$SELECT public.store_seo_proposal_decide(%L, 'later')$q$, :'sp1')) ->> 'status' AS st \gset
SELECT pg_temp.call(:STORE_A, :S_OWNER, format($q$SELECT public.store_seo_proposal_decide(%L, 'approve')$q$, :'sp1')) ->> 'status' AS st2 \gset
SELECT tests.check('seo engine (store): later → approve writes the product''s Google title; logged in the platform log',
  format($$SELECT %2$L = 'later' AND %3$L = 'approved'
           AND (SELECT seo_title FROM public.global_products WHERE id = %1$L) = 'כוס קרמיקה בעבודת יד | מטבח'
           AND EXISTS (SELECT 1 FROM public.platform_audit_log l WHERE l.action = 'seo.proposal_approved'
                         AND l.details ->> 'target_id' = %1$L)$$, :'g1', :'st', :'st2'));
SELECT pg_temp.call(:STORE_A, :S_OWNER, format($q$SELECT public.store_seo_proposal_revert(%L)$q$, :'sp1')) ->> 'status' AS st \gset
SELECT tests.check('seo engine (store): restore → the product''s Google title is empty again',
  format($$SELECT %2$L = 'reverted' AND (SELECT seo_title IS NULL FROM public.global_products WHERE id = %1$L)$$, :'g1', :'st'));
-- stale
SELECT pg_temp.sadd(:STORE_A, jsonb_build_array(
  jsonb_build_object('target_kind', 'product', 'target_id', :'g1', 'field', 'seo_description', 'text', 'כוס קרמיקה איכותית לקפה ותה')), false) IS NOT NULL AS ok \gset
UPDATE public.global_products SET seo_description = 'בעל החנות כתב בינתיים' WHERE id = :'g1';
SELECT pg_temp.call(:STORE_A, :S_OWNER, format($q$SELECT public.store_seo_proposal_decide(%L, 'approve')$q$,
  pg_temp.spid(:STORE_A, :'g1', 'seo_description'))) ->> 'status' AS st \gset
SELECT tests.check('seo engine (store): approving after the owner changed the field → "stale", the owner''s text stays',
  format($$SELECT %2$L = 'stale' AND (SELECT seo_description FROM public.global_products WHERE id = %1$L) = 'בעל החנות כתב בינתיים'$$, :'g1', :'st'));
-- auto-apply (store): only empty fields
SELECT pg_temp.call(:STORE_A, :S_OWNER, $q$SELECT public.seo_settings_save('{"meta": true}')$q$) IS NOT NULL AS ok \gset
SELECT pg_temp.sadd(:STORE_A, jsonb_build_array(
  jsonb_build_object('target_kind', 'product', 'target_id', :'g2', 'field', 'seo_title', 'text', 'קערת הגשה | מטבח'),
  jsonb_build_object('target_kind', 'product', 'target_id', :'g1', 'field', 'seo_description', 'text', 'נוסח חלופי לטקסט של בעל החנות')), false) AS sadd2 \gset
SELECT tests.check('seo engine (store): with "meta" ON an EMPTY title is filled automatically; the owner''s description is NOT overwritten (stays a pending proposal)',
  format($$SELECT (%3$L::jsonb ->> 'auto_applied')::int = 1
           AND (SELECT seo_title FROM public.global_products WHERE id = %2$L) = 'קערת הגשה | מטבח'
           AND (SELECT seo_description FROM public.global_products WHERE id = %1$L) = 'בעל החנות כתב בינתיים'
           AND pg_temp.spid(%4$L, %1$L, 'seo_description') IS NOT NULL$$, :'g1', :'g2', :'sadd2', :STORE_A));
SELECT pg_temp.call(:STORE_A, :S_OWNER, $q$SELECT public.seo_settings_save('{"meta": false}')$q$) IS NOT NULL AS ok \gset

-- ============================================================
-- 8. The SEO center, requests, the platform overview
-- ============================================================
SELECT pg_temp.expect_error('seo engine: a guest cannot open the SEO center',
  format($$SELECT pg_temp.call(%L, NULL, 'SELECT public.seo_center()')$$, :'sa'), 'permission denied');
SELECT pg_temp.expect_error('seo engine: a signed-in stranger cannot open another business''s SEO center',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT public.seo_center()')$$, :'sa', :STRANGER), 'אין הרשאה');
SELECT tests.check('seo engine: the SEO center (hospitality owner): its settings, its ideas with Google numbers only on Google rows, open proposals count',
  format($$SELECT c ->> 'site_type' = 'hospitality' AND (c #>> '{settings,auto_apply,meta}')::boolean
             AND (c ->> 'pending_proposals')::int >= 2
             AND (SELECT bool_and((k ->> 'metrics' IS NULL) OR k ->> 'source' IN ('gsc', 'import')) FROM jsonb_array_elements(c -> 'keywords') k)
      FROM (SELECT pg_temp.call(%L, %L, 'SELECT public.seo_center()') AS c) x$$, :'sa', :OWNER_A));
-- the owner's own phrases: an idea without numbers, chosen at once; a phrase Google already reported keeps its numbers
SELECT pg_temp.call(:'sa', :OWNER_A, $q$SELECT public.seo_keyword_idea_add('  צימר לכלה   ליד בית שמש ', 'local', 'local')$q$) AS kw1 \gset
SELECT pg_temp.call(:'sa', :OWNER_A, $q$SELECT public.seo_keyword_idea_add('נופי דורית', 'brand', 'navigational')$q$) AS kw2 \gset
SELECT tests.check('seo engine: the owner adds a phrase of their own — stored as the owner''s, chosen, WITHOUT numbers; a phrase with Google''s numbers keeps them and its source',
  format($$SELECT (%1$L::jsonb ->> 'source') = 'owner' AND (%1$L::jsonb ->> 'status') = 'adopted'
           AND (SELECT metrics IS NULL AND source = 'owner' AND status = 'adopted' AND kind = 'local'
                  FROM public.seo_keyword_ideas WHERE tenant_id = %3$L AND phrase = 'צימר לכלה ליד בית שמש')
           AND (%2$L::jsonb ->> 'source') = 'gsc' AND (%2$L::jsonb ->> 'status') = 'adopted'
           AND (SELECT metrics ->> 'impressions' = '1500' FROM public.seo_keyword_ideas WHERE tenant_id = %3$L AND phrase = 'נופי דורית')$$,
         :'kw1', :'kw2', :'sa'));
SELECT pg_temp.expect_error('seo engine: the database refuses numbers on an owner''s phrase too (CHECK)',
  format($$UPDATE public.seo_keyword_ideas SET metrics = '{"volume": 900}' WHERE tenant_id = %L AND phrase = 'צימר לכלה ליד בית שמש'$$, :'sa'),
  'seo_keyword_ideas_honesty');
SELECT pg_temp.expect_error('seo engine: an owner''s phrase must be 2–80 characters, without tags',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT public.seo_keyword_idea_add(''<b>x</b>'', ''primary'', ''commercial'')')$$, :'sa', :OWNER_A), 'ביטוי לא תקין');
SELECT pg_temp.expect_error('seo engine: an owner''s phrase needs a known kind',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT public.seo_keyword_idea_add(''צימר זוגי'', ''invented'', ''commercial'')')$$, :'sa', :OWNER_A), 'בקשה לא תקינה');
SELECT pg_temp.expect_error('seo engine: a guest cannot add phrases',
  format($$SELECT pg_temp.call(%L, NULL, 'SELECT public.seo_keyword_idea_add(''צימר זוגי'', ''primary'', ''commercial'')')$$, :'sa'), 'permission denied');
SELECT pg_temp.expect_error('seo engine: a signed-in stranger cannot add phrases to another business',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT public.seo_keyword_idea_add(''צימר זוגי'', ''primary'', ''commercial'')')$$, :'sa', :STRANGER), 'אין הרשאה');
SELECT pg_temp.expect_error('seo engine: a store agent cannot add phrases',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT public.seo_keyword_idea_add(''מוצר חדש'', ''primary'', ''commercial'')')$$, :STORE_A, :S_AGENT), 'אין הרשאה');
CREATE TEMP TABLE seo_hs_name AS SELECT tenant_id, business_name FROM hospitality.settings WHERE tenant_id = :'sa';
UPDATE hospitality.settings SET business_name = 'מנוע SEO A חוויה בכפר' WHERE tenant_id = :'sa';
SELECT tests.check('seo engine: the SEO center names the business as it shows itself (its own settings, not the tenant row) and shows the owner''s phrase without numbers',
  format($$SELECT c ->> 'business_name' = 'מנוע SEO A חוויה בכפר'
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(c -> 'keywords') k
                          WHERE k ->> 'phrase' = 'צימר לכלה ליד בית שמש' AND k ->> 'source' = 'owner' AND k -> 'metrics' = 'null'::jsonb)
      FROM (SELECT pg_temp.call(%1$L, %2$L, 'SELECT public.seo_center()') AS c) x$$, :'sa', :OWNER_A));
UPDATE hospitality.settings SET business_name = ''  WHERE tenant_id = :'sa';
SELECT tests.check('seo engine: a business without a name in its settings is named by its tenant row',
  format($$SELECT pg_temp.call(%1$L, %2$L, 'SELECT public.seo_center()') ->> 'business_name' = (SELECT name FROM public.tenants WHERE id = %1$L)$$,
         :'sa', :OWNER_A));
UPDATE hospitality.settings h SET business_name = o.business_name FROM seo_hs_name o WHERE h.tenant_id = o.tenant_id;
DROP TABLE seo_hs_name;
SELECT tests.check('seo engine: the Analytics check — nothing saved yet: GA4 not set up',
  format($$SELECT coalesce((pg_temp.call(%L, %L, 'SELECT public.seo_center()') #>> '{analytics,ga4}')::boolean, false) = false$$, :'sa', :OWNER_A));
INSERT INTO public.site_tracking (tenant_id, ga4_measurement_id) VALUES (:'sa', 'G-SEOTEST12')
  ON CONFLICT (tenant_id) DO UPDATE SET ga4_measurement_id = EXCLUDED.ga4_measurement_id;
SELECT tests.check('seo engine: the Analytics check — GA4 set up shows as set up (only a yes / no — never the ID)',
  format($$SELECT (c #>> '{analytics,ga4}')::boolean AND NOT (c #>> '{analytics,gtm}')::boolean AND c::text NOT LIKE '%%G-SEOTEST12%%'
      FROM (SELECT pg_temp.call(%L, %L, 'SELECT public.seo_center()') AS c) x$$, :'sa', :OWNER_A));
DELETE FROM public.site_tracking WHERE tenant_id = :'sa';
SELECT pg_temp.call(:'sa', :OWNER_A, $q$SELECT public.seo_request('audit')$q$) ->> 'queued' AS q1 \gset
SELECT pg_temp.call(:'sa', :OWNER_A, $q$SELECT public.seo_request('audit')$q$) ->> 'already' AS q2 \gset
SELECT tests.check('seo engine: "check now" queues ONE audit — a second click while it waits does not queue another',
  format($$SELECT %1$L::boolean AND %2$L::boolean
           AND (SELECT count(*) FROM public.seo_jobs WHERE tenant_id = %3$L AND kind = 'audit' AND status = 'queued') = 1$$,
         :'q1', :'q2', :'sa'));
SELECT pg_temp.expect_error('seo engine: the platform overview is for platform admins only',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT public.seo_platform_overview()')$$, :'sa', :OWNER_A), 'אין הרשאה');
SELECT tests.check('seo engine: the platform overview — numbers per business (score, open proposals, queue); no proposal texts, no customer data',
  format($$SELECT (SELECT (e ->> 'pending')::int >= 2 FROM jsonb_array_elements(o) e WHERE e ->> 'tenant_id' = %1$L)
             AND o::text NOT LIKE '%%צימר תאנה למשפחות%%' AND o::text NOT LIKE '%%נוסח%%'
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(o) e WHERE e ?| ARRAY['proposals', 'email', 'phone', 'owner_email'])
      FROM (SELECT pg_temp.as_platform('SELECT public.seo_platform_overview()') AS o) x$$, :'sa'));
SELECT pg_temp.as_platform(format($q$SELECT public.seo_platform_request(%L, 'initial')$q$, :'sb')) ->> 'already' AS q3 \gset
SELECT tests.check('seo engine: the platform admin starts the initial run of one business now (pilot): the waiting job is moved up, not doubled; logged',
  format($$SELECT %1$L::boolean
           AND (SELECT count(*) FROM public.seo_jobs WHERE tenant_id = %2$L AND kind = 'initial' AND status = 'queued'
                  AND run_after <= now()) = 1
           AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %2$L AND action = 'seo.platform_request')$$,
         :'q3', :'sb'));

-- ============================================================
-- 9. Search Console: tokens server-only, owner-only CSV / disconnect, platform connection fallback
-- ============================================================
SELECT pg_temp.srv(format($q$SELECT to_jsonb(public.seo_gsc_connection_save(NULL, 'sc-domain:nuri1.test', %L, NULL))$q$,
  'v1.encrypted-platform-token-xxxxxxxxxxxxxxxx')) IS NULL AS ok \gset
SELECT pg_temp.srv(format($q$SELECT to_jsonb(public.seo_gsc_connection_save(%L, 'https://se-a.nuri1.test/', %L, %L))$q$,
  :'sa', 'v1.encrypted-tenant-token-xxxxxxxxxxxxxxxxxx', :OWNER_A)) IS NULL AS ok \gset
SELECT tests.check('seo engine: a business gets its own Search Console connection; a business without one falls back to the platform''s domain property',
  format($$SELECT pg_temp.srv(format('SELECT public.seo_gsc_connection_get(%%L)', %1$L)) ->> 'property' = 'https://se-a.nuri1.test/'
           AND pg_temp.srv(format('SELECT public.seo_gsc_connection_get(%%L)', %2$L)) ->> 'property' = 'sc-domain:nuri1.test'$$, :'sa', :'sb'));
SELECT tests.check('seo engine: the SEO center never returns the (encrypted) token',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT public.seo_center()')::text NOT LIKE '%%encrypted-tenant-token%%'$$, :'sa', :OWNER_A));
SELECT pg_temp.expect_error('seo engine: a CSV import with future dates is refused',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT public.seo_gsc_csv_import(''query'', current_date, current_date + 3, ''[{"key": "x"}]'', ''{}'')')$$,
         :'sa', :OWNER_A), 'לא תקינים');
SELECT pg_temp.call(:'sa', :OWNER_A, $q$SELECT to_jsonb(public.seo_gsc_csv_import('query', current_date - 28, current_date - 1,
  '[{"key": "נופי דורית", "clicks": 120, "impressions": 1500, "ctr": 0.08, "position": 1.4}]', '{"clicks": 120}'))$q$) IS NOT NULL AS ok \gset
SELECT tests.check('seo engine: the owner imports a Search Console CSV (Google''s numbers) — stored as a csv snapshot, logged',
  format($$SELECT EXISTS (SELECT 1 FROM public.seo_gsc_snapshots WHERE tenant_id = %1$L AND source = 'csv' AND dimension = 'query')
           AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %1$L AND action = 'seo.gsc_csv_imported')$$, :'sa'));
SELECT pg_temp.expect_error('seo engine: a manager (not the owner) cannot disconnect Search Console',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT to_jsonb(public.seo_gsc_disconnect())')$$, :'sa', :MGR_A), 'רק בעל העסק');
SELECT pg_temp.call(:'sa', :OWNER_A, $q$SELECT to_jsonb(public.seo_gsc_disconnect())$q$) IS NULL AS ok \gset
SELECT tests.check('seo engine: the owner disconnects — the token is deleted (not kept), the platform connection stays',
  format($$SELECT NOT EXISTS (SELECT 1 FROM public.seo_gsc_connections WHERE tenant_id = %L)
           AND EXISTS (SELECT 1 FROM public.seo_gsc_connections WHERE tenant_id IS NULL)$$, :'sa'));

-- ---------- cleanup of what other files may count ----------
DELETE FROM public.seo_gsc_connections;
DELETE FROM public.global_products WHERE sku IN ('99520001', '99520002', '99520003');

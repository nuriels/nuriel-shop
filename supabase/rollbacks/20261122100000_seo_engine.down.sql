-- ============================================================
-- Rollback: 20261122100000_seo_engine.sql — NURIEL AI SEO ENGINE core (migration 203)
--   • order: migration 204 (20261122110000_hosp_seo_engine) must be rolled back first — stops otherwise.
--   • guard: stops (nothing changes) while the owners' work or decisions would be lost:
--       – a category has a Google title / description;
--       – an Ecommerce SEO proposal was approved or restored (the history the "restore" button needs);
--       – a business connected Search Console, or imported a Search Console CSV;
--       – a keyword idea was adopted, or a business changed its SEO settings (an auto switch on / weekly audit off).
--     Machine-made rows (audits, queued jobs, open template / AI proposals, new keyword ideas, API snapshots) go.
--   • texts already approved stay where they are (site_settings / global_products) — they are the store's data.
--   • afterwards the schema is identical to the one before the migration (scripts/db-tests/rollback-check.sh).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
DECLARE
  _n bigint;
BEGIN
  IF to_regprocedure('hospitality.seo_proposal_revert(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback stopped: roll back 20261122110000_hosp_seo_engine (migration 204) first — nothing changed';
  END IF;
  IF to_regclass('public.store_seo_proposals') IS NULL THEN
    RETURN;  -- already rolled back
  END IF;
  EXECUTE 'SELECT count(*) FROM public.categories c WHERE c.seo_title IS NOT NULL OR c.seo_description IS NOT NULL' INTO _n;
  IF _n > 0 THEN
    RAISE EXCEPTION 'rollback stopped: % categories have a Google title / description — nothing changed', _n;
  END IF;
  SELECT count(*) INTO _n FROM public.store_seo_proposals p WHERE p.status IN ('approved', 'reverted');
  IF _n > 0 THEN
    RAISE EXCEPTION 'rollback stopped: % store SEO proposals were approved or restored (their history) — nothing changed', _n;
  END IF;
  SELECT count(*) INTO _n FROM public.seo_gsc_connections;
  IF _n > 0 THEN
    RAISE EXCEPTION 'rollback stopped: % Search Console connections exist — disconnect them first; nothing changed', _n;
  END IF;
  SELECT count(*) INTO _n FROM public.seo_gsc_snapshots s WHERE s.source = 'csv';
  IF _n > 0 THEN
    RAISE EXCEPTION 'rollback stopped: % Search Console CSV imports by owners — nothing changed', _n;
  END IF;
  SELECT count(*) INTO _n FROM public.seo_keyword_ideas k WHERE k.status = 'adopted';
  IF _n > 0 THEN
    RAISE EXCEPTION 'rollback stopped: % keyword ideas were adopted by owners — nothing changed', _n;
  END IF;
  SELECT count(*) INTO _n FROM public.seo_settings s
   WHERE NOT s.weekly_audit OR s.auto_apply <> '{"alt": false, "meta": false, "keywords": false}'::jsonb;
  IF _n > 0 THEN
    RAISE EXCEPTION 'rollback stopped: % businesses changed their SEO settings — nothing changed', _n;
  END IF;
END $$;

DROP TRIGGER IF EXISTS seo_on_tenant ON public.tenants;
DROP TRIGGER IF EXISTS seo_on_product ON public.global_products;
DROP TRIGGER IF EXISTS seo_on_category ON public.categories;

DROP FUNCTION IF EXISTS public.store_seo_snapshot(uuid, boolean, integer);
DROP FUNCTION IF EXISTS public.store_seo_proposal_revert(uuid);
DROP FUNCTION IF EXISTS public.store_seo_proposal_decide(uuid, text, text);
DROP FUNCTION IF EXISTS public.store_seo_proposals();
DROP FUNCTION IF EXISTS public.store_seo_proposals_add(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public._store_seo_audit(uuid, text, public.store_seo_proposals);
DROP FUNCTION IF EXISTS public._store_seo_write(uuid, text, uuid, text, text);
DROP FUNCTION IF EXISTS public._store_seo_current(uuid, text, uuid, text);
DROP FUNCTION IF EXISTS public._store_seo_clean(text, text);
DROP FUNCTION IF EXISTS public._store_seo_max(text);
DROP FUNCTION IF EXISTS public.seo_request(text);
DROP FUNCTION IF EXISTS public.seo_mark_initial_done(uuid);
DROP FUNCTION IF EXISTS public.seo_tenant_basics(uuid);
DROP FUNCTION IF EXISTS public.seo_platform_request(uuid, text);
DROP FUNCTION IF EXISTS public.seo_platform_overview();
DROP FUNCTION IF EXISTS public.seo_center();
DROP FUNCTION IF EXISTS public.seo_keyword_idea_set(uuid, text);
DROP FUNCTION IF EXISTS public.seo_settings_save(jsonb);
DROP FUNCTION IF EXISTS public.seo_gsc_can_connect();
DROP FUNCTION IF EXISTS public.seo_gsc_disconnect();
DROP FUNCTION IF EXISTS public.seo_gsc_csv_import(text, date, date, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.seo_gsc_snapshot_save(uuid, text, date, date, text, jsonb, jsonb, uuid);
DROP FUNCTION IF EXISTS public.seo_gsc_connection_status(uuid, text, text, boolean);
DROP FUNCTION IF EXISTS public.seo_gsc_connection_get(uuid);
DROP FUNCTION IF EXISTS public.seo_gsc_connection_save(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.seo_keyword_ideas_add(uuid, jsonb);
DROP FUNCTION IF EXISTS public.seo_audit_save(uuid, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.seo_jobs_enqueue_periodic();
DROP FUNCTION IF EXISTS public.seo_job_finish(bigint, text, jsonb, text);
DROP FUNCTION IF EXISTS public.seo_jobs_claim(integer);
DROP FUNCTION IF EXISTS public._seo_on_entity();
DROP FUNCTION IF EXISTS public._seo_on_tenant();
DROP FUNCTION IF EXISTS public._seo_enqueue(uuid, text, text, interval);
DROP FUNCTION IF EXISTS public._seo_tenant();
DROP FUNCTION IF EXISTS public.seo_can_manage();

DROP TABLE IF EXISTS public.store_seo_proposals;
DROP TABLE IF EXISTS public.seo_jobs;
DROP TABLE IF EXISTS public.seo_gsc_snapshots;
DROP TABLE IF EXISTS public.seo_gsc_connections;
DROP TABLE IF EXISTS public.seo_keyword_ideas;
DROP TABLE IF EXISTS public.seo_audits;
DROP TABLE IF EXISTS public.seo_settings;

ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_seo_check;
ALTER TABLE public.categories DROP COLUMN IF EXISTS seo_title, DROP COLUMN IF EXISTS seo_description;

NOTIFY pgrst, 'reload schema';
COMMIT;

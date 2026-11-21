-- NURIEL AI SEO ENGINE release — checks right after migrations 203 + 204 (read-only). ONE line; every value must be
-- t, and the last one 204:
--   rls · no_direct_access · functions_ok · settings_off · nothing_queued · new_fields_empty · honesty_rule · migrations
-- Run: docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA < checks-after.sql
SELECT
  -- the new tables: row level security on every one of them
  (SELECT count(*) FROM pg_class
    WHERE oid IN ('public.seo_settings'::regclass, 'public.seo_audits'::regclass, 'public.seo_keyword_ideas'::regclass,
                  'public.seo_gsc_connections'::regclass, 'public.seo_gsc_snapshots'::regclass, 'public.seo_jobs'::regclass,
                  'public.store_seo_proposals'::regclass)
      AND relrowsecurity) = 7 AS rls,
  -- no direct access from the browser roles (everything goes through checked functions)
  NOT has_table_privilege('anon', 'public.seo_jobs', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.seo_keyword_ideas', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.seo_gsc_connections', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.store_seo_proposals', 'UPDATE') AS no_direct_access,
  -- owners call the SEO center; only the app server calls the worker / Search Console functions
  has_function_privilege('authenticated', 'public.seo_center()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.seo_center()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.seo_jobs_claim(integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.seo_gsc_connection_get(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'hospitality.seo_proposal_revert(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'hospitality.seo_proposal_revert(uuid)', 'EXECUTE') AS functions_ok,
  -- every business has its SEO settings, every automatic switch OFF
  (SELECT count(*) FROM public.seo_settings) = (SELECT count(*) FROM public.tenants)
    AND NOT EXISTS (SELECT 1 FROM public.seo_settings WHERE auto_apply <> '{"alt": false, "meta": false, "keywords": false}'::jsonb)
    AS settings_off,
  -- the migrations queued, checked and proposed nothing for the existing businesses
  (SELECT count(*) FROM public.seo_jobs) = 0 AND (SELECT count(*) FROM public.seo_audits) = 0
    AND (SELECT count(*) FROM public.seo_keyword_ideas) = 0 AND (SELECT count(*) FROM public.store_seo_proposals) = 0
    AS nothing_queued,
  -- the new Google fields of packages / categories start empty
  NOT EXISTS (SELECT 1 FROM hospitality.packages WHERE seo_title IS NOT NULL OR seo_description IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.categories WHERE seo_title IS NOT NULL OR seo_description IS NOT NULL)
    AS new_fields_empty,
  -- the honesty rule (numbers only from Google) is enforced by the database
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seo_keyword_ideas_honesty') AS honesty_rule,
  (SELECT count(*) FROM public._migrations_applied) AS migrations;

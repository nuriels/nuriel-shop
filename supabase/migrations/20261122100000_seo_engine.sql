-- ============================================================
-- NURIEL AI SEO ENGINE — migration 203: the platform core (both engines) + Ecommerce proposals + automation queue
--
--   Reuses what exists — no parallel systems:
--   • AI: the existing NURIEL AI tables / quota / budget / usage log (nothing here talks to a model);
--   • Hospitality keeps its own proposals (hospitality.seo_proposals, migration 201) — migration 204 extends them;
--   • Ecommerce gets the same proposal model (store_seo_proposals) over its existing SEO columns
--     (site_settings.seo_*, global_products.seo_*) + new category SEO columns;
--   • permissions: the existing staff checks (hospitality.can('settings'), public.is_admin(), store owner) and,
--     for Search Console, the existing owner check of Google settings (public.site_tracking_can_edit()).
--
--   New, platform-wide (tenant-isolated, closed tables — access only through the functions below):
--   • seo_settings      — per business: auto-apply switches (all OFF by default), weekly audit;
--   • seo_audits        — technical audit results (score = a checklist score, not a ranking prediction);
--   • seo_keyword_ideas — keyword ideas; the honesty rule is a CHECK: only Search Console / import rows may
--                         carry numbers (template / AI ideas never have volumes);
--   • seo_gsc_connections / seo_gsc_snapshots — Search Console by the owner's own consent (read-only scope);
--                         the refresh token is stored encrypted by the app; a NULL tenant row is the platform's
--                         own connection (platform admin only), usable for businesses on the platform domain;
--   • seo_jobs          — the automation queue: new business / product / category (+ units / packages / images in 204)
--                         → one queued job per business and kind (deduplicated); the app worker claims them.
--
--   No change to existing data. Triggers only add queue rows and can never block creating a business/product.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 0. Who may use the SEO center of the current business
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seo_can_manage() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_tenant_id() IS NULL THEN
    RETURN false;
  END IF;
  IF public.current_site_type() = 'hospitality' THEN
    RETURN COALESCE(hospitality.can('settings'), false);
  ELSIF public.current_site_type() = 'ecommerce' THEN
    RETURN COALESCE(public.is_admin(auth.uid()), false);
  END IF;
  RETURN COALESCE(public.store_staff_role(auth.uid()) = 'owner', false);
END $$;
REVOKE ALL ON FUNCTION public.seo_can_manage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seo_can_manage() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._seo_tenant() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := public.current_tenant_id();
BEGIN
  IF _t IS NULL OR NOT public.seo_can_manage() THEN
    RAISE EXCEPTION 'אין הרשאה לפעולה הזו' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN _t;
END $$;
REVOKE ALL ON FUNCTION public._seo_tenant() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 1. Tables
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seo_settings (
  tenant_id       uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  auto_apply      jsonb NOT NULL DEFAULT '{"alt": false, "meta": false, "keywords": false}'::jsonb
                  CHECK (jsonb_typeof(auto_apply) = 'object'),
  weekly_audit    boolean NOT NULL DEFAULT true,
  initial_done_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seo_audits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  source         text NOT NULL CHECK (source IN ('manual', 'auto', 'scheduled')),
  origin         text NOT NULL CHECK (char_length(origin) BETWEEN 8 AND 300),
  score          smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  counts         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counts) = 'object'),
  pages_audited  integer NOT NULL DEFAULT 0 CHECK (pages_audited BETWEEN 0 AND 500),
  sitemap_urls   integer NOT NULL DEFAULT 0 CHECK (sitemap_urls >= 0),
  robots_status  smallint NOT NULL DEFAULT 0,
  sitemap_status smallint NOT NULL DEFAULT 0,
  pages          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(pages) = 'array'),
  issues         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(issues) = 'array'),
  created_by     uuid,
  started_at     timestamptz NOT NULL,
  finished_at    timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (pg_column_size(pages) + pg_column_size(issues) <= 1048576)
);
CREATE INDEX IF NOT EXISTS seo_audits_tenant_idx ON public.seo_audits (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.seo_keyword_ideas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  phrase     text NOT NULL CHECK (char_length(phrase) BETWEEN 2 AND 80),
  kind       text NOT NULL CHECK (kind IN ('brand', 'primary', 'local', 'service', 'product', 'long_tail', 'question',
                                           'transactional')),
  intent     text NOT NULL CHECK (intent IN ('navigational', 'informational', 'commercial', 'transactional', 'local')),
  source     text NOT NULL CHECK (source IN ('template', 'ai', 'gsc', 'import')),
  reason     text CHECK (reason IS NULL OR char_length(reason) <= 300),
  status     text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'adopted', 'dismissed')),
  -- the honesty rule, enforced by the database: numbers only from Google (Search Console API / its CSV export)
  metrics    jsonb CONSTRAINT seo_keyword_ideas_honesty
             CHECK (metrics IS NULL OR (jsonb_typeof(metrics) = 'object' AND source IN ('gsc', 'import'))),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phrase)
);

CREATE TABLE IF NOT EXISTS public.seo_gsc_connections (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = the platform's own connection (a domain property covering the platform's subdomains)
  tenant_id               uuid REFERENCES public.tenants (id) ON DELETE CASCADE,
  property                text NOT NULL CHECK (char_length(property) BETWEEN 8 AND 300
                                               AND (property ~ '^https?://' OR property ~ '^sc-domain:')),
  refresh_token_encrypted text NOT NULL CHECK (char_length(refresh_token_encrypted) BETWEEN 20 AND 4000),
  status                  text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'revoked')),
  connected_by            uuid,
  connected_at            timestamptz NOT NULL DEFAULT now(),
  last_sync_at            timestamptz,
  last_error              text CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS seo_gsc_one_per_tenant ON public.seo_gsc_connections (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS seo_gsc_one_platform ON public.seo_gsc_connections ((true)) WHERE tenant_id IS NULL;

CREATE TABLE IF NOT EXISTS public.seo_gsc_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  dimension    text NOT NULL CHECK (dimension IN ('query', 'page')),
  period_start date NOT NULL,
  period_end   date NOT NULL,
  source       text NOT NULL CHECK (source IN ('api', 'csv')),
  rows         jsonb NOT NULL CHECK (jsonb_typeof(rows) = 'array' AND jsonb_array_length(rows) <= 5000),
  totals       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(totals) = 'object'),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start AND period_end - period_start <= 500)
);
CREATE INDEX IF NOT EXISTS seo_gsc_snapshots_tenant_idx
  ON public.seo_gsc_snapshots (tenant_id, dimension, period_end DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.seo_jobs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('initial', 'entity', 'audit', 'gsc_sync')),
  entity_type  text CHECK (entity_type IS NULL OR entity_type IN ('store', 'product', 'category', 'unit', 'package', 'media')),
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'skipped')),
  attempts     smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  run_after    timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  result       jsonb,
  last_error   text CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- one open job per business + kind + entity type: a 500-row import queues ONE "new products" job, not 500
CREATE UNIQUE INDEX IF NOT EXISTS seo_jobs_one_open
  ON public.seo_jobs (tenant_id, kind, COALESCE(entity_type, '')) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS seo_jobs_due ON public.seo_jobs (run_after) WHERE status = 'queued';

-- Ecommerce proposals — the same model as hospitality.seo_proposals (pending → approved / rejected / stale…)
CREATE TABLE IF NOT EXISTS public.store_seo_proposals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (target_kind IN ('store', 'product', 'category')),
  target_id   uuid,
  field       text NOT NULL CHECK (field IN ('seo_title', 'seo_description', 'seo_keywords')),
  proposed    text NOT NULL CHECK (char_length(proposed) BETWEEN 1 AND 500),
  base        text NOT NULL DEFAULT '',
  reason      text CHECK (reason IS NULL OR char_length(reason) <= 300),
  source      text NOT NULL CHECK (source IN ('template', 'ai', 'gsc')),
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'later', 'approved', 'rejected', 'superseded', 'stale', 'reverted')),
  applied     text,
  decided_by  uuid,
  decided_at  timestamptz,
  reverted_by uuid,
  reverted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((target_kind = 'store') = (target_id IS NULL)),
  CHECK (target_kind <> 'category' OR field IN ('seo_title', 'seo_description'))
);
CREATE UNIQUE INDEX IF NOT EXISTS store_seo_one_open
  ON public.store_seo_proposals (tenant_id, target_kind, COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid), field)
  WHERE status IN ('pending', 'later');
CREATE INDEX IF NOT EXISTS store_seo_proposals_tenant_idx ON public.store_seo_proposals (tenant_id, created_at DESC);

-- category SEO (the storefront used a template only; the template stays the fallback)
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS seo_title text;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS seo_description text;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_seo_check;
ALTER TABLE public.categories ADD CONSTRAINT categories_seo_check CHECK (
  (seo_title IS NULL OR char_length(seo_title) BETWEEN 1 AND 120)
  AND (seo_description IS NULL OR char_length(seo_description) BETWEEN 1 AND 320));

-- closed tables: RLS on, tenant isolation, no direct grants (functions only)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['seo_settings', 'seo_audits', 'seo_keyword_ideas', 'seo_gsc_connections', 'seo_gsc_snapshots',
                           'seo_jobs', 'store_seo_proposals'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON public.%I AS RESTRICTIVE USING (tenant_id = public.current_tenant_id())', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.seo_jobs_id_seq FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Automation: the queue and the triggers that feed it
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._seo_enqueue(_tenant uuid, _kind text, _entity_type text, _delay interval)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.seo_jobs (tenant_id, kind, entity_type, run_after)
  VALUES (_tenant, _kind, _entity_type, now() + COALESCE(_delay, interval '0'))
  ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public._seo_enqueue(uuid, text, text, interval) FROM PUBLIC, anon, authenticated;

-- a new business: settings row + an initial scan 15 minutes later (time to add a logo / first products)
CREATE OR REPLACE FUNCTION public._seo_on_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    INSERT INTO public.seo_settings (tenant_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    PERFORM public._seo_enqueue(NEW.id, 'initial', 'store', interval '15 minutes');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'seo: could not queue the initial scan for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS seo_on_tenant ON public.tenants;
CREATE TRIGGER seo_on_tenant AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION public._seo_on_tenant();

-- a new product / category: one "new items" job per business and type, 10 minutes later (imports settle first)
CREATE OR REPLACE FUNCTION public._seo_on_entity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    IF NEW.tenant_id IS NOT NULL THEN
      PERFORM public._seo_enqueue(NEW.tenant_id, 'entity', TG_ARGV[0], interval '10 minutes');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'seo: could not queue % proposals: %', TG_ARGV[0], SQLERRM;
  END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS seo_on_product ON public.global_products;
CREATE TRIGGER seo_on_product AFTER INSERT ON public.global_products FOR EACH ROW EXECUTE FUNCTION public._seo_on_entity('product');
DROP TRIGGER IF EXISTS seo_on_category ON public.categories;
CREATE TRIGGER seo_on_category AFTER INSERT ON public.categories FOR EACH ROW EXECUTE FUNCTION public._seo_on_entity('category');

-- existing businesses get their settings row (no scan is queued for them — the owner starts it, or the weekly run)
INSERT INTO public.seo_settings (tenant_id) SELECT t.id FROM public.tenants t ON CONFLICT DO NOTHING;

-- the worker (service_role): claim due jobs (SKIP LOCKED — safe with several app instances), finish them,
-- and queue the periodic work (weekly audit, daily Search Console sync)
CREATE OR REPLACE FUNCTION public.seo_jobs_claim(_limit integer DEFAULT 5) RETURNS SETOF public.seo_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- a job stuck "running" past its lock (a crashed instance) goes back to the queue, at most 3 attempts
  UPDATE public.seo_jobs SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
                             last_error = COALESCE(last_error, 'interrupted'), updated_at = now()
   WHERE status = 'running' AND locked_until < now();
  RETURN QUERY
  UPDATE public.seo_jobs j
     SET status = 'running', attempts = j.attempts + 1, locked_until = now() + interval '15 minutes', updated_at = now()
   WHERE j.id IN (SELECT x.id FROM public.seo_jobs x
                   WHERE x.status = 'queued' AND x.run_after <= now()
                   ORDER BY x.run_after, x.id
                   LIMIT LEAST(GREATEST(COALESCE(_limit, 5), 1), 50)
                   FOR UPDATE SKIP LOCKED)
  RETURNING j.*;
END $$;

CREATE OR REPLACE FUNCTION public.seo_job_finish(_id bigint, _status text, _result jsonb DEFAULT NULL, _error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _status NOT IN ('done', 'failed', 'skipped', 'queued') THEN
    RAISE EXCEPTION 'bad job status' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.seo_jobs
     SET status = _status, result = _result, last_error = left(_error, 300), locked_until = NULL, updated_at = now(),
         run_after = CASE WHEN _status = 'queued' THEN now() + interval '30 minutes' ELSE run_after END
   WHERE id = _id;
  -- keep the queue small: finished jobs older than 30 days go
  DELETE FROM public.seo_jobs WHERE status IN ('done', 'skipped', 'failed') AND updated_at < now() - interval '30 days';
END $$;

CREATE OR REPLACE FUNCTION public.seo_jobs_enqueue_periodic() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _audits integer := 0;
  _syncs integer := 0;
BEGIN
  WITH due AS (
    SELECT s.tenant_id FROM public.seo_settings s JOIN public.tenants t ON t.id = s.tenant_id
     WHERE s.weekly_audit AND t.status = 'active'
       AND COALESCE((SELECT max(a.created_at) FROM public.seo_audits a WHERE a.tenant_id = s.tenant_id), '-infinity')
           < now() - interval '7 days'
     LIMIT 200)
  INSERT INTO public.seo_jobs (tenant_id, kind) SELECT tenant_id, 'audit' FROM due ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _audits = ROW_COUNT;
  WITH due AS (
    SELECT c.tenant_id FROM public.seo_gsc_connections c JOIN public.tenants t ON t.id = c.tenant_id
     WHERE c.tenant_id IS NOT NULL AND c.status = 'connected' AND t.status = 'active'
       AND (c.last_sync_at IS NULL OR c.last_sync_at < now() - interval '23 hours')
     LIMIT 200)
  INSERT INTO public.seo_jobs (tenant_id, kind) SELECT tenant_id, 'gsc_sync' FROM due ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _syncs = ROW_COUNT;
  RETURN jsonb_build_object('audits', _audits, 'syncs', _syncs);
END $$;

-- ------------------------------------------------------------
-- 3. Audits and keyword ideas (written by the server, read by the SEO center)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seo_audit_save(_tenant uuid, _source text, _result jsonb, _actor uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _id uuid;
BEGIN
  IF _tenant IS NULL OR _result IS NULL OR jsonb_typeof(_result) <> 'object' THEN
    RAISE EXCEPTION 'bad audit' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.seo_audits (tenant_id, source, origin, score, counts, pages_audited, sitemap_urls, robots_status,
                                 sitemap_status, pages, issues, created_by, started_at, finished_at)
  VALUES (_tenant, _source, _result ->> 'origin', (_result ->> 'score')::smallint, COALESCE(_result -> 'counts', '{}'),
          COALESCE((_result ->> 'pagesAudited')::integer, 0), COALESCE((_result ->> 'sitemapUrls')::integer, 0),
          COALESCE((_result ->> 'robotsStatus')::smallint, 0), COALESCE((_result ->> 'sitemapStatus')::smallint, 0),
          COALESCE(_result -> 'pages', '[]'), COALESCE(_result -> 'issues', '[]'), _actor,
          COALESCE((_result ->> 'startedAt')::timestamptz, now()), COALESCE((_result ->> 'finishedAt')::timestamptz, now()))
  RETURNING id INTO _id;
  -- history: the last 20 audits per business
  DELETE FROM public.seo_audits a WHERE a.tenant_id = _tenant AND a.id NOT IN (
    SELECT x.id FROM public.seo_audits x WHERE x.tenant_id = _tenant ORDER BY x.created_at DESC LIMIT 20);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.seo_keyword_ideas_add(_tenant uuid, _items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _i jsonb;
  _added integer := 0;
  _phrase text;
  _src text;
  _n integer;
BEGIN
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) > 300 THEN
    RAISE EXCEPTION 'bad keyword ideas' USING ERRCODE = 'check_violation';
  END IF;
  FOR _i IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _phrase := lower(btrim(regexp_replace(COALESCE(_i ->> 'phrase', ''), '\s+', ' ', 'g')));
    _src := _i ->> 'source';
    CONTINUE WHEN char_length(_phrase) NOT BETWEEN 2 AND 80 OR _src IS NULL OR _src NOT IN ('template', 'ai', 'gsc', 'import')
               OR _phrase ~ '[<>]'
               OR COALESCE(_i ->> 'kind', '') NOT IN ('brand', 'primary', 'local', 'service', 'product', 'long_tail',
                                                     'question', 'transactional')
               OR COALESCE(_i ->> 'intent', '') NOT IN ('navigational', 'informational', 'commercial', 'transactional', 'local');
    INSERT INTO public.seo_keyword_ideas (tenant_id, phrase, kind, intent, source, reason, metrics)
    VALUES (_tenant, _phrase, _i ->> 'kind', _i ->> 'intent', _src, left(_i ->> 'reason', 300),
            CASE WHEN _src IN ('gsc', 'import') AND jsonb_typeof(_i -> 'metrics') = 'object' THEN _i -> 'metrics' END)
    ON CONFLICT (tenant_id, phrase) DO UPDATE
      -- Google's numbers refresh an existing idea; a template / AI idea never overwrites real numbers
      SET metrics = CASE WHEN EXCLUDED.metrics IS NOT NULL THEN EXCLUDED.metrics ELSE public.seo_keyword_ideas.metrics END,
          source = CASE WHEN EXCLUDED.metrics IS NOT NULL THEN EXCLUDED.source ELSE public.seo_keyword_ideas.source END,
          updated_at = now()
      WHERE EXCLUDED.metrics IS NOT NULL;
    GET DIAGNOSTICS _n = ROW_COUNT;
    _added := _added + _n;
  END LOOP;
  -- at most 500 ideas per business: drop the oldest dismissed, then the oldest new template ideas
  DELETE FROM public.seo_keyword_ideas k WHERE k.id IN (
    SELECT x.id FROM public.seo_keyword_ideas x WHERE x.tenant_id = _tenant AND x.status <> 'adopted'
     ORDER BY (x.status = 'dismissed') DESC, (x.metrics IS NULL) DESC, x.created_at
     LIMIT GREATEST((SELECT count(*) FROM public.seo_keyword_ideas y WHERE y.tenant_id = _tenant) - 500, 0));
  RETURN jsonb_build_object('added', _added);
END $$;

-- ------------------------------------------------------------
-- 4. Search Console storage (tokens arrive already encrypted by the app)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seo_gsc_connection_save(_tenant uuid, _property text, _token text, _actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _tenant IS NULL THEN
    DELETE FROM public.seo_gsc_connections WHERE tenant_id IS NULL;
  ELSE
    DELETE FROM public.seo_gsc_connections WHERE tenant_id = _tenant;
  END IF;
  INSERT INTO public.seo_gsc_connections (tenant_id, property, refresh_token_encrypted, connected_by)
  VALUES (_tenant, _property, _token, _actor);
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant, _actor, 'seo.gsc_connected', jsonb_build_object('property', _property));
END $$;

CREATE OR REPLACE FUNCTION public.seo_gsc_connection_get(_tenant uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  -- the business's own connection, else the platform connection (the app checks that it covers the host)
  SELECT to_jsonb(x) FROM (
    SELECT c.id, c.tenant_id, c.property, c.refresh_token_encrypted AS token, c.status
      FROM public.seo_gsc_connections c
     WHERE (c.tenant_id = _tenant OR c.tenant_id IS NULL) AND c.status <> 'revoked'
     ORDER BY (c.tenant_id IS NULL) LIMIT 1) x;
$$;

CREATE OR REPLACE FUNCTION public.seo_gsc_connection_status(_id uuid, _status text, _error text, _synced boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.seo_gsc_connections
     SET status = _status, last_error = left(_error, 300), updated_at = now(),
         last_sync_at = CASE WHEN _synced THEN now() ELSE last_sync_at END
   WHERE id = _id;
END $$;

CREATE OR REPLACE FUNCTION public.seo_gsc_snapshot_save(_tenant uuid, _dimension text, _start date, _end date,
                                                        _source text, _rows jsonb, _totals jsonb, _actor uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _id uuid;
BEGIN
  INSERT INTO public.seo_gsc_snapshots (tenant_id, dimension, period_start, period_end, source, rows, totals, created_by)
  VALUES (_tenant, _dimension, _start, _end, _source, _rows, COALESCE(_totals, '{}'), _actor)
  RETURNING id INTO _id;
  -- the last 12 snapshots per business and dimension (enough for "this period vs the previous one" and a trend)
  DELETE FROM public.seo_gsc_snapshots s WHERE s.tenant_id = _tenant AND s.dimension = _dimension AND s.id NOT IN (
    SELECT x.id FROM public.seo_gsc_snapshots x WHERE x.tenant_id = _tenant AND x.dimension = _dimension
     ORDER BY x.period_end DESC, x.created_at DESC LIMIT 12);
  RETURN _id;
END $$;

-- staff: a Search Console CSV export (Google's own numbers, imported by hand)
CREATE OR REPLACE FUNCTION public.seo_gsc_csv_import(_dimension text, _start date, _end date, _rows jsonb, _totals jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := public._seo_tenant();
BEGIN
  IF _dimension NOT IN ('query', 'page') OR _start IS NULL OR _end IS NULL OR _end < _start OR _end > current_date
     OR _rows IS NULL OR jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'הקובץ או התאריכים לא תקינים' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_t, auth.uid(), 'seo.gsc_csv_imported',
          jsonb_build_object('dimension', _dimension, 'rows', jsonb_array_length(_rows), 'from', _start, 'to', _end));
  RETURN public.seo_gsc_snapshot_save(_t, _dimension, _start, _end, 'csv', _rows, _totals, auth.uid());
END $$;

-- owner: disconnect Search Console (the token is wiped, not kept)
CREATE OR REPLACE FUNCTION public.seo_gsc_disconnect() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := public.current_tenant_id();
BEGIN
  IF _t IS NULL OR NOT public.site_tracking_can_edit() THEN
    RAISE EXCEPTION 'רק בעל העסק יכול לנתק את Search Console' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM public.seo_gsc_connections WHERE tenant_id = _t;
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_t, auth.uid(), 'seo.gsc_disconnected', '{}'::jsonb);
END $$;

-- owner: may this user connect Search Console (the same owner check as the Google settings)
CREATE OR REPLACE FUNCTION public.seo_gsc_can_connect() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.current_tenant_id() IS NOT NULL AND COALESCE(public.site_tracking_can_edit(), false);
$$;

-- ------------------------------------------------------------
-- 5. Settings and the SEO center
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seo_settings_save(_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := public._seo_tenant();
  _k text;
  _v jsonb;
  s public.seo_settings;
BEGIN
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object' THEN
    RAISE EXCEPTION 'אין שינויים לשמירה' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.seo_settings (tenant_id) VALUES (_t) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM public.seo_settings x WHERE x.tenant_id = _t FOR UPDATE;
  FOR _k, _v IN SELECT * FROM jsonb_each(_patch) LOOP
    IF _k IN ('alt', 'meta', 'keywords') AND jsonb_typeof(_v) = 'boolean' THEN
      s.auto_apply := s.auto_apply || jsonb_build_object(_k, _v);
    ELSIF _k = 'weekly_audit' AND jsonb_typeof(_v) = 'boolean' THEN
      s.weekly_audit := _v::text::boolean;
    ELSE
      RAISE EXCEPTION 'שדה לא מוכר: %', left(_k, 40) USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  UPDATE public.seo_settings x SET auto_apply = s.auto_apply, weekly_audit = s.weekly_audit, updated_at = now()
   WHERE x.tenant_id = _t;
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_t, auth.uid(), 'seo.settings_saved', _patch);
  RETURN jsonb_build_object('auto_apply', s.auto_apply, 'weekly_audit', s.weekly_audit);
END $$;

CREATE OR REPLACE FUNCTION public.seo_keyword_idea_set(_id uuid, _status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := public._seo_tenant();
  k public.seo_keyword_ideas;
BEGIN
  IF _status NOT IN ('new', 'adopted', 'dismissed') THEN
    RAISE EXCEPTION 'מצב לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.seo_keyword_ideas x SET status = _status, updated_at = now()
   WHERE x.tenant_id = _t AND x.id = _id RETURNING * INTO k;
  IF k.id IS NULL THEN
    RAISE EXCEPTION 'הביטוי לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object('id', k.id, 'phrase', k.phrase, 'status', k.status);
END $$;

-- one round trip for the whole SEO center (proposal lists stay engine-specific: store_seo_proposals() /
-- hospitality.seo_proposals())
CREATE OR REPLACE FUNCTION public.seo_center() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := public._seo_tenant();
  s public.seo_settings;
  a public.seo_audits;
  c public.seo_gsc_connections;
  _pending integer;
BEGIN
  SELECT * INTO s FROM public.seo_settings x WHERE x.tenant_id = _t;
  SELECT * INTO a FROM public.seo_audits x WHERE x.tenant_id = _t ORDER BY x.created_at DESC LIMIT 1;
  SELECT * INTO c FROM public.seo_gsc_connections x WHERE x.tenant_id = _t;
  IF public.current_site_type() = 'ecommerce' THEN
    SELECT count(*) INTO _pending FROM public.store_seo_proposals p WHERE p.tenant_id = _t AND p.status IN ('pending', 'later');
  ELSIF public.current_site_type() = 'hospitality' THEN
    SELECT count(*) INTO _pending FROM hospitality.seo_proposals p WHERE p.tenant_id = _t AND p.status IN ('pending', 'later');
  ELSE
    _pending := 0;
  END IF;
  RETURN jsonb_build_object(
    'site_type', public.current_site_type(),
    'can_connect_gsc', COALESCE(public.site_tracking_can_edit(), false),
    'settings', jsonb_build_object(
      'auto_apply', COALESCE(s.auto_apply, '{"alt": false, "meta": false, "keywords": false}'::jsonb),
      'weekly_audit', COALESCE(s.weekly_audit, true),
      'initial_done_at', s.initial_done_at),
    'pending_proposals', _pending,
    'audit', CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', a.id, 'source', a.source, 'origin', a.origin, 'score', a.score, 'counts', a.counts,
      'pages_audited', a.pages_audited, 'sitemap_urls', a.sitemap_urls, 'robots_status', a.robots_status,
      'sitemap_status', a.sitemap_status, 'pages', a.pages, 'issues', a.issues, 'finished_at', a.finished_at) END,
    'audits', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'score', x.score, 'counts', x.counts,
                                                            'finished_at', x.finished_at, 'source', x.source)
                                          ORDER BY x.created_at DESC)
                          FROM (SELECT * FROM public.seo_audits y WHERE y.tenant_id = _t ORDER BY y.created_at DESC LIMIT 12) x),
                       '[]'::jsonb),
    'keywords', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'phrase', k.phrase, 'kind', k.kind,
                                                              'intent', k.intent, 'source', k.source, 'reason', k.reason,
                                                              'status', k.status, 'metrics', k.metrics)
                                            ORDER BY (k.status = 'adopted') DESC, (k.metrics IS NOT NULL) DESC,
                                                     COALESCE((k.metrics ->> 'impressions')::numeric, 0) DESC, k.created_at)
                            FROM public.seo_keyword_ideas k WHERE k.tenant_id = _t AND k.status <> 'dismissed'),
                         '[]'::jsonb),
    'gsc', jsonb_build_object(
      'connected', c.id IS NOT NULL AND c.status <> 'revoked',
      'property', c.property, 'status', c.status, 'last_sync_at', c.last_sync_at, 'last_error', c.last_error,
      'platform_connection', EXISTS (SELECT 1 FROM public.seo_gsc_connections p WHERE p.tenant_id IS NULL AND p.status = 'connected'),
      'snapshots', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'dimension', x.dimension,
                                                                 'period_start', x.period_start, 'period_end', x.period_end,
                                                                 'source', x.source, 'rows', x.rows, 'totals', x.totals,
                                                                 'created_at', x.created_at)
                                               ORDER BY x.period_end DESC, x.created_at DESC)
                               FROM (SELECT * FROM public.seo_gsc_snapshots y WHERE y.tenant_id = _t
                                      ORDER BY y.period_end DESC, y.created_at DESC LIMIT 4) x),
                            '[]'::jsonb)));
END $$;

-- the platform admin's overview: numbers per business only — no proposal texts, no customer data
CREATE OR REPLACE FUNCTION public.seo_platform_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'tenant_id', t.id, 'slug', t.slug, 'name', t.name, 'site_type', t.site_type, 'status', t.status,
      'score', a.score, 'audited_at', a.finished_at, 'critical', COALESCE((a.counts ->> 'critical')::integer, 0),
      'high', COALESCE((a.counts ->> 'high')::integer, 0),
      'pending', CASE t.site_type
                   WHEN 'ecommerce' THEN (SELECT count(*) FROM public.store_seo_proposals p
                                           WHERE p.tenant_id = t.id AND p.status IN ('pending', 'later'))
                   WHEN 'hospitality' THEN (SELECT count(*) FROM hospitality.seo_proposals p
                                             WHERE p.tenant_id = t.id AND p.status IN ('pending', 'later'))
                   ELSE 0 END,
      'gsc', EXISTS (SELECT 1 FROM public.seo_gsc_connections c WHERE c.tenant_id = t.id AND c.status = 'connected'),
      'ideas', (SELECT count(*) FROM public.seo_keyword_ideas k WHERE k.tenant_id = t.id AND k.status <> 'dismissed'),
      'queued', (SELECT count(*) FROM public.seo_jobs j WHERE j.tenant_id = t.id AND j.status IN ('queued', 'running')))
      ORDER BY t.site_type, a.score NULLS FIRST, t.name)
      FROM public.tenants t
      LEFT JOIN LATERAL (SELECT x.score, x.finished_at, x.counts FROM public.seo_audits x WHERE x.tenant_id = t.id
                          ORDER BY x.created_at DESC LIMIT 1) a ON true
     WHERE t.status <> 'deleted'), '[]'::jsonb);
END $$;

-- platform admin: queue an audit / an initial proposals run for one business (pilot, controlled rollout)
CREATE OR REPLACE FUNCTION public.seo_platform_request(_tenant uuid, _kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _new boolean;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _kind NOT IN ('audit', 'initial', 'gsc_sync') OR NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant) THEN
    RAISE EXCEPTION 'בקשה לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  -- already waiting (e.g. the initial scan 15 minutes after the business opened) → it runs now instead of later
  INSERT INTO public.seo_jobs (tenant_id, kind, entity_type)
  VALUES (_tenant, _kind, CASE WHEN _kind = 'initial' THEN 'store' END)
  ON CONFLICT (tenant_id, kind, (COALESCE(entity_type, ''))) WHERE status IN ('queued', 'running')
  DO UPDATE SET run_after = LEAST(public.seo_jobs.run_after, now()), updated_at = now()
  RETURNING (xmax = 0) INTO _new;
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant, auth.uid(), 'seo.platform_request', jsonb_build_object('kind', _kind, 'queued', _new));
  RETURN jsonb_build_object('queued', _new, 'already', NOT _new);
END $$;

-- the worker needs the business basics to audit it (its own public host only) — service_role
CREATE OR REPLACE FUNCTION public.seo_tenant_basics(_tenant uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'site_type', t.site_type, 'status', t.status,
                            'domain', t.domain, 'custom_domain', t.custom_domain,
                            'custom_domain_status', t.custom_domain_status,
                            'settings', (SELECT to_jsonb(s) FROM public.seo_settings s WHERE s.tenant_id = t.id))
    FROM public.tenants t WHERE t.id = _tenant;
$$;

CREATE OR REPLACE FUNCTION public.seo_mark_initial_done(_tenant uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.seo_settings (tenant_id, initial_done_at) VALUES (_tenant, now())
  ON CONFLICT (tenant_id) DO UPDATE SET initial_done_at = COALESCE(public.seo_settings.initial_done_at, now()), updated_at = now();
$$;

-- staff: start an audit / a proposals run now (queued for the worker — the request itself stays fast)
CREATE OR REPLACE FUNCTION public.seo_request(_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := public._seo_tenant();
  _new boolean;
BEGIN
  IF _kind NOT IN ('audit', 'initial') THEN
    RAISE EXCEPTION 'בקשה לא מוכרת' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.seo_jobs (tenant_id, kind, entity_type)
  VALUES (_t, _kind, CASE WHEN _kind = 'initial' THEN 'store' END)
  ON CONFLICT (tenant_id, kind, (COALESCE(entity_type, ''))) WHERE status IN ('queued', 'running')
  DO UPDATE SET run_after = LEAST(public.seo_jobs.run_after, now()), updated_at = now()
  RETURNING (xmax = 0) INTO _new;
  RETURN jsonb_build_object('queued', _new, 'already', NOT _new);
END $$;

-- ------------------------------------------------------------
-- 6. Ecommerce proposals (same rules as Hospitality: approve applies only if the field did not change since)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._store_seo_max(_field text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE _field WHEN 'seo_title' THEN 120 WHEN 'seo_description' THEN 320 WHEN 'seo_keywords' THEN 500 END;
$$;

CREATE OR REPLACE FUNCTION public._store_seo_clean(_field text, _v text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  _c text := btrim(regexp_replace(COALESCE(_v, ''), '\s+', ' ', 'g'));
BEGIN
  IF _field = 'seo_keywords' THEN
    _c := COALESCE(public.normalize_seo_keywords(_c), '');
  END IF;
  IF _c = '' OR _c ~ '[<>]' OR char_length(_c) > public._store_seo_max(_field) THEN
    RETURN NULL;
  END IF;
  RETURN _c;
END $$;

-- NULL = the target does not exist (any more); '' = an empty field
CREATE OR REPLACE FUNCTION public._store_seo_current(_t uuid, _kind text, _target uuid, _field text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v text;
  _found boolean;
BEGIN
  IF _kind = 'store' THEN
    SELECT CASE _field WHEN 'seo_title' THEN s.seo_title WHEN 'seo_description' THEN s.seo_description
                       WHEN 'seo_keywords' THEN s.seo_keywords END, true
      INTO v, _found FROM public.site_settings s WHERE s.tenant_id = _t LIMIT 1;
  ELSIF _kind = 'product' THEN
    SELECT CASE _field WHEN 'seo_title' THEN p.seo_title WHEN 'seo_description' THEN p.seo_description
                       WHEN 'seo_keywords' THEN p.seo_keywords END, true
      INTO v, _found FROM public.global_products p WHERE p.tenant_id = _t AND p.id = _target;
  ELSIF _kind = 'category' THEN
    SELECT CASE _field WHEN 'seo_title' THEN c.seo_title WHEN 'seo_description' THEN c.seo_description END, true
      INTO v, _found FROM public.categories c WHERE c.tenant_id = _t AND c.id = _target;
  END IF;
  IF NOT COALESCE(_found, false) THEN
    RETURN NULL;
  END IF;
  RETURN COALESCE(v, '');
END $$;

CREATE OR REPLACE FUNCTION public._store_seo_write(_t uuid, _kind text, _target uuid, _field text, _v text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _kind = 'store' THEN
    EXECUTE format('UPDATE public.site_settings SET %I = $1 WHERE tenant_id = $2', _field) USING COALESCE(_v, ''), _t;
  ELSIF _kind = 'product' THEN
    EXECUTE format('UPDATE public.global_products SET %I = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3', _field)
      USING NULLIF(_v, ''), _t, _target;
  ELSIF _kind = 'category' THEN
    EXECUTE format('UPDATE public.categories SET %I = $1 WHERE tenant_id = $2 AND id = $3', _field)
      USING NULLIF(_v, ''), _t, _target;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._store_seo_audit(_t uuid, _action text, p public.store_seo_proposals) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_t, auth.uid(), _action, jsonb_build_object('proposal', p.id, 'target', p.target_kind, 'target_id', p.target_id,
                                                      'field', p.field, 'source', p.source));
$$;

-- the server adds proposals (templates / AI); _only_empty: only fields that are empty today
CREATE OR REPLACE FUNCTION public.store_seo_proposals_add(_tenant uuid, _items jsonb, _only_empty boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _i jsonb;
  _kind text;
  _target uuid;
  _field text;
  _text text;
  _cur text;
  _src text;
  _added integer := 0;
  _auto integer := 0;
  _skipped integer := 0;
  _auto_apply jsonb;
  p public.store_seo_proposals;
BEGIN
  IF _tenant IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant AND t.site_type = 'ecommerce') THEN
    RAISE EXCEPTION 'not a store' USING ERRCODE = 'check_violation';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) > 300 THEN
    RAISE EXCEPTION 'bad proposals' USING ERRCODE = 'check_violation';
  END IF;
  SELECT s.auto_apply INTO _auto_apply FROM public.seo_settings s WHERE s.tenant_id = _tenant;
  FOR _i IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _kind := _i ->> 'target_kind';
    _field := _i ->> 'field';
    _src := COALESCE(_i ->> 'source', 'template');
    BEGIN
      _target := NULLIF(_i ->> 'target_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END;
    IF _kind NOT IN ('store', 'product', 'category') OR _field NOT IN ('seo_title', 'seo_description', 'seo_keywords')
       OR (_kind = 'category' AND _field = 'seo_keywords') OR ((_kind = 'store') <> (_target IS NULL))
       OR _src NOT IN ('template', 'ai', 'gsc') THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;
    _text := public._store_seo_clean(_field, _i ->> 'text');
    _cur := public._store_seo_current(_tenant, _kind, _target, _field);
    IF _text IS NULL OR _cur IS NULL OR _text = _cur OR (_only_empty AND _cur <> '') THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM public.store_seo_proposals x WHERE x.tenant_id = _tenant AND x.status IN ('pending', 'later')) >= 500 THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;
    UPDATE public.store_seo_proposals x SET status = 'superseded', decided_at = now()
     WHERE x.tenant_id = _tenant AND x.target_kind = _kind AND x.target_id IS NOT DISTINCT FROM _target AND x.field = _field
       AND x.status IN ('pending', 'later');
    INSERT INTO public.store_seo_proposals (tenant_id, target_kind, target_id, field, proposed, base, reason, source)
    VALUES (_tenant, _kind, _target, _field, _text, _cur, left(_i ->> 'reason', 300), _src)
    RETURNING * INTO p;
    _added := _added + 1;
    -- auto-apply only when the owner turned it on for this kind of field (all OFF by default), and only into an
    -- EMPTY field — never over text the owner wrote
    IF _cur = '' AND ((_field IN ('seo_title', 'seo_description') AND COALESCE((_auto_apply ->> 'meta')::boolean, false))
       OR (_field = 'seo_keywords' AND COALESCE((_auto_apply ->> 'keywords')::boolean, false))) THEN
      PERFORM public._store_seo_write(_tenant, _kind, _target, _field, _text);
      UPDATE public.store_seo_proposals x SET status = 'approved', applied = _text, decided_at = now() WHERE x.id = p.id;
      INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
      VALUES (_tenant, NULL, 'seo.proposal_auto_applied',
              jsonb_build_object('proposal', p.id, 'target', _kind, 'target_id', _target, 'field', _field));
      _auto := _auto + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('added', _added, 'auto_applied', _auto, 'skipped', _skipped);
END $$;

-- staff: the list (open + decided in the last 60 days), with the current value and a label for every target
CREATE OR REPLACE FUNCTION public.store_seo_proposals() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := public._seo_tenant();
BEGIN
  IF public.current_site_type() <> 'ecommerce' THEN
    RAISE EXCEPTION 'לא חנות' USING ERRCODE = 'feature_not_supported';
  END IF;
  RETURN jsonb_build_object(
    'store_name', (SELECT s.business_name FROM public.site_settings s WHERE s.tenant_id = _t LIMIT 1),
    'proposals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'target_kind', p.target_kind, 'target_id', p.target_id, 'field', p.field,
        'proposed', p.proposed, 'base', p.base, 'reason', p.reason, 'source', p.source, 'status', p.status,
        'applied', p.applied, 'created_at', p.created_at, 'decided_at', p.decided_at, 'reverted_at', p.reverted_at,
        'current', public._store_seo_current(_t, p.target_kind, p.target_id, p.field),
        'label', CASE p.target_kind
                   WHEN 'product' THEN (SELECT g.name FROM public.global_products g WHERE g.tenant_id = _t AND g.id = p.target_id)
                   WHEN 'category' THEN (SELECT c.name FROM public.categories c WHERE c.tenant_id = _t AND c.id = p.target_id)
                   ELSE NULL END,
        'path', CASE p.target_kind
                  WHEN 'product' THEN '/product/' || p.target_id::text
                  WHEN 'category' THEN '/?category=' || (SELECT c.name FROM public.categories c WHERE c.tenant_id = _t AND c.id = p.target_id)
                  ELSE '/' END)
        ORDER BY (p.status IN ('pending', 'later')) DESC, p.created_at DESC)
        FROM (SELECT * FROM public.store_seo_proposals x
               WHERE x.tenant_id = _t
                 AND (x.status IN ('pending', 'later') OR x.decided_at > now() - interval '60 days' OR x.reverted_at > now() - interval '60 days')
               ORDER BY x.created_at DESC LIMIT 600) p), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.store_seo_proposal_decide(_id uuid, _action text, _text text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := public._seo_tenant();
  p public.store_seo_proposals;
  _final text;
  _cur text;
BEGIN
  IF _action NOT IN ('approve', 'reject', 'later') THEN
    RAISE EXCEPTION 'פעולה לא מוכרת' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM public.store_seo_proposals x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'ההצעה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF p.status NOT IN ('pending', 'later') THEN
    RAISE EXCEPTION 'ההצעה כבר טופלה — מרעננים' USING ERRCODE = 'HS409';
  END IF;
  IF _action = 'reject' THEN
    UPDATE public.store_seo_proposals x SET status = 'rejected', decided_by = auth.uid(), decided_at = now() WHERE x.id = p.id;
    PERFORM public._store_seo_audit(_t, 'seo.proposal_rejected', p);
    RETURN jsonb_build_object('id', p.id, 'status', 'rejected');
  END IF;
  IF _action = 'later' THEN
    UPDATE public.store_seo_proposals x SET status = 'later' WHERE x.id = p.id;
    RETURN jsonb_build_object('id', p.id, 'status', 'later');
  END IF;
  _final := public._store_seo_clean(p.field, COALESCE(NULLIF(btrim(COALESCE(_text, '')), ''), p.proposed));
  IF _final IS NULL THEN
    RAISE EXCEPTION 'הטקסט ריק, ארוך מדי או מכיל תווים לא מורשים (עד % תווים)', public._store_seo_max(p.field)
      USING ERRCODE = 'check_violation';
  END IF;
  _cur := public._store_seo_current(_t, p.target_kind, p.target_id, p.field);
  -- the field changed since the proposal was made (or the item is gone): never overwrite the owner's newer text
  IF _cur IS DISTINCT FROM p.base THEN
    UPDATE public.store_seo_proposals x SET status = 'stale', decided_by = auth.uid(), decided_at = now() WHERE x.id = p.id;
    RETURN jsonb_build_object('id', p.id, 'status', 'stale');
  END IF;
  PERFORM public._store_seo_write(_t, p.target_kind, p.target_id, p.field, _final);
  UPDATE public.store_seo_proposals x SET status = 'approved', applied = _final, decided_by = auth.uid(), decided_at = now()
   WHERE x.id = p.id;
  PERFORM public._store_seo_audit(_t, 'seo.proposal_approved', p);
  RETURN jsonb_build_object('id', p.id, 'status', 'approved', 'applied', _final);
END $$;

-- staff: undo an approved proposal — only if the field still holds what was applied (else: it changed since)
CREATE OR REPLACE FUNCTION public.store_seo_proposal_revert(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := public._seo_tenant();
  p public.store_seo_proposals;
  _cur text;
BEGIN
  SELECT * INTO p FROM public.store_seo_proposals x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  IF p.id IS NULL OR p.status <> 'approved' THEN
    RAISE EXCEPTION 'אפשר לשחזר רק הצעה שאושרה' USING ERRCODE = 'check_violation';
  END IF;
  _cur := public._store_seo_current(_t, p.target_kind, p.target_id, p.field);
  IF _cur IS DISTINCT FROM p.applied THEN
    RAISE EXCEPTION 'השדה השתנה מאז האישור — אי אפשר לשחזר אוטומטית' USING ERRCODE = 'HS409';
  END IF;
  PERFORM public._store_seo_write(_t, p.target_kind, p.target_id, p.field, p.base);
  UPDATE public.store_seo_proposals x SET status = 'reverted', reverted_by = auth.uid(), reverted_at = now() WHERE x.id = p.id;
  PERFORM public._store_seo_audit(_t, 'seo.proposal_reverted', p);
  RETURN jsonb_build_object('id', p.id, 'status', 'reverted', 'restored', p.base);
END $$;

-- the worker: what a store looks like for SEO (no prices, no customers) — the server builds templates / AI from it
CREATE OR REPLACE FUNCTION public.store_seo_snapshot(_tenant uuid, _only_missing boolean DEFAULT true, _limit integer DEFAULT 60)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'store', (SELECT jsonb_build_object('name', s.business_name, 'seo_title', s.seo_title,
                                        'seo_description', s.seo_description, 'seo_keywords', s.seo_keywords)
                FROM public.site_settings s WHERE s.tenant_id = _tenant LIMIT 1),
    'categories', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'parent', c.parent_name,
                                                                'seo_title', c.seo_title, 'seo_description', c.seo_description,
                                                                'products', (SELECT count(*) FROM public.global_products g
                                                                              WHERE g.tenant_id = _tenant AND g.category = c.name
                                                                                AND NOT COALESCE(g.is_hidden, false)))
                                             ORDER BY c.sort_order, c.name)
                              FROM public.categories c WHERE c.tenant_id = _tenant
                                AND (NOT _only_missing OR c.seo_title IS NULL OR c.seo_description IS NULL)), '[]'::jsonb),
    'products', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
                            SELECT g.id, g.name, g.category, left(g.description, 1200) AS description, g.seo_title,
                                   g.seo_description, g.seo_keywords, g.created_at
                              FROM public.global_products g
                             WHERE g.tenant_id = _tenant AND NOT COALESCE(g.is_hidden, false)
                               AND (NOT _only_missing OR g.seo_title IS NULL OR g.seo_description IS NULL)
                               AND NOT EXISTS (SELECT 1 FROM public.store_seo_proposals p
                                                WHERE p.tenant_id = _tenant AND p.target_kind = 'product' AND p.target_id = g.id
                                                  AND p.status IN ('pending', 'later', 'rejected'))
                             ORDER BY g.created_at DESC LIMIT LEAST(GREATEST(COALESCE(_limit, 60), 1), 200)) x), '[]'::jsonb));
$$;

-- ------------------------------------------------------------
-- 7. Grants
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.seo_jobs_claim(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seo_job_finish(bigint, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seo_jobs_enqueue_periodic() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seo_audit_save(uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seo_keyword_ideas_add(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seo_gsc_connection_save(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seo_gsc_connection_get(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seo_gsc_connection_status(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seo_gsc_snapshot_save(uuid, text, date, date, text, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seo_tenant_basics(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seo_mark_initial_done(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_seo_proposals_add(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_seo_snapshot(uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._store_seo_current(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._store_seo_write(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._store_seo_audit(uuid, text, public.store_seo_proposals) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._store_seo_clean(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._store_seo_max(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._seo_on_tenant() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._seo_on_entity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seo_jobs_claim(integer), public.seo_job_finish(bigint, text, jsonb, text),
  public.seo_jobs_enqueue_periodic(), public.seo_audit_save(uuid, text, jsonb, uuid),
  public.seo_keyword_ideas_add(uuid, jsonb), public.seo_gsc_connection_save(uuid, text, text, uuid),
  public.seo_gsc_connection_get(uuid), public.seo_gsc_connection_status(uuid, text, text, boolean),
  public.seo_gsc_snapshot_save(uuid, text, date, date, text, jsonb, jsonb, uuid), public.seo_tenant_basics(uuid),
  public.seo_mark_initial_done(uuid), public.store_seo_proposals_add(uuid, jsonb, boolean),
  public.store_seo_snapshot(uuid, boolean, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.seo_center(), public.seo_settings_save(jsonb), public.seo_keyword_idea_set(uuid, text),
  public.seo_gsc_csv_import(text, date, date, jsonb, jsonb), public.seo_gsc_disconnect(), public.seo_gsc_can_connect(),
  public.seo_request(text), public.seo_platform_overview(), public.seo_platform_request(uuid, text),
  public.store_seo_proposals(), public.store_seo_proposal_decide(uuid, text, text), public.store_seo_proposal_revert(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seo_center(), public.seo_settings_save(jsonb), public.seo_keyword_idea_set(uuid, text),
  public.seo_gsc_csv_import(text, date, date, jsonb, jsonb), public.seo_gsc_disconnect(), public.seo_gsc_can_connect(),
  public.seo_request(text), public.seo_platform_overview(), public.seo_platform_request(uuid, text),
  public.store_seo_proposals(), public.store_seo_proposal_decide(uuid, text, text), public.store_seo_proposal_revert(uuid)
  TO authenticated, service_role;

COMMIT;

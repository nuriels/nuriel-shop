-- ============================================================
-- NURIEL AI SEO ENGINE — migration 204: Hospitality on the engine (extends migration 201's proposals)
--
--   • packages get a Google title / description (seo_title / seo_description; empty → the page keeps today's
--     fallback). package_seo_set — catalog permission, revision check, the business's action log (as
--     unit_seo_set). The package's own name, description, terms, prices and policy are never touched.
--   • seo_proposals:
--       – reason       — why it is proposed (shown to the owner next to the proposal);
--       – 'later'      — saved for later: still open (one open proposal per field), not applied, and an
--                        automatic run never replaces it;
--       – 'reverted'   — restored to the value before the approval (seo_proposal_revert) — only while the field
--                        still holds the approved text: a later change is never overwritten;
--       – 'package'    — the Google title / description of a package (never its description or terms);
--       – auto_applied — filled without a click: ONLY when the owner turned that switch on in the SEO center
--                        (public.seo_settings.auto_apply, all OFF by default) and ONLY into an EMPTY field —
--                        image alt (switch "alt"), unit / package Google title + description (switch "meta").
--                        Site texts are never automatic. Logged in the business's action log, revertable.
--   • seo_runs.scope 'auto' — runs the automation starts (new unit / package / images, weekly).
--   • automation: a new unit / package / image → one queued job per business and type (public.seo_jobs, 203).
--
--   Existing data unchanged: constraints only widen, every existing row stays valid.
--   Rollback: supabase/rollbacks/20261122110000_hosp_seo_engine.down.sql
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. Packages: the Google result of the package page
-- ------------------------------------------------------------
ALTER TABLE hospitality.packages ADD COLUMN IF NOT EXISTS seo_title text;
ALTER TABLE hospitality.packages ADD COLUMN IF NOT EXISTS seo_description text;
ALTER TABLE hospitality.packages DROP CONSTRAINT IF EXISTS packages_seo_check;
ALTER TABLE hospitality.packages ADD CONSTRAINT packages_seo_check CHECK (
  (seo_title IS NULL OR char_length(seo_title) BETWEEN 1 AND 120)
  AND (seo_description IS NULL OR char_length(seo_description) BETWEEN 1 AND 320));

-- like unit_seo_set: one line each, no control characters or < >; empty → NULL (the page's fallback)
CREATE OR REPLACE FUNCTION hospitality.package_seo_set(_id uuid, _seo_title text, _seo_description text,
                                                       _expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
  p hospitality.packages;
  _title text := NULLIF(btrim(regexp_replace(regexp_replace(COALESCE(_seo_title, ''), '[[:cntrl:]]+', ' ', 'g'),
                                             '[<>]', '', 'g')), '');
  _desc text := NULLIF(btrim(regexp_replace(regexp_replace(COALESCE(_seo_description, ''), '[[:cntrl:]]+', ' ', 'g'),
                                            '[<>]', '', 'g')), '');
  _diff jsonb := '{}'::jsonb;
  _rev integer;
BEGIN
  IF char_length(_title) > 120 OR char_length(_desc) > 320 THEN
    RAISE EXCEPTION 'כותרת לגוגל עד 120 תווים ותיאור עד 320' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM hospitality.packages x WHERE x.tenant_id = _t AND x.id = _id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'החבילה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _expected_revision IS DISTINCT FROM p.revision THEN
    RAISE EXCEPTION 'החבילה עודכנה בינתיים — מרעננים' USING ERRCODE = 'HS409';
  END IF;
  IF _title IS DISTINCT FROM p.seo_title THEN
    _diff := _diff || jsonb_build_object('seo_title', jsonb_build_object('changed', true));
  END IF;
  IF _desc IS DISTINCT FROM p.seo_description THEN
    _diff := _diff || jsonb_build_object('seo_description', jsonb_build_object('changed', true));
  END IF;
  IF _diff = '{}'::jsonb THEN
    RETURN jsonb_build_object('id', p.id, 'revision', p.revision);
  END IF;
  UPDATE hospitality.packages x
     SET seo_title = _title, seo_description = _desc, revision = x.revision + 1, updated_at = now()
   WHERE x.tenant_id = _t AND x.id = _id
  RETURNING x.revision INTO _rev;
  PERFORM hospitality._audit(_t, 'packages.updated', p.name, _diff);
  RETURN jsonb_build_object('id', p.id, 'revision', _rev);
END $$;
REVOKE ALL ON FUNCTION hospitality.package_seo_set(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.package_seo_set(uuid, text, text, integer) TO authenticated, service_role;

-- the package as the site / management see it: + its Google title and description (public anyway — the page head)
CREATE OR REPLACE FUNCTION hospitality._package_json(_t uuid, p hospitality.packages, _staff boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'kind', p.kind, 'name', p.name, 'description', p.description, 'terms', p.terms,
    'nights', p.nights, 'price', p.price, 'max_guests', p.max_guests, 'stay_from', p.stay_from, 'stay_to', p.stay_to,
    'unit_id', p.unit_id, 'media_ids', to_jsonb(hospitality._package_media(_t, p.media_ids)),
    'sort_order', p.sort_order, 'seo_title', p.seo_title, 'seo_description', p.seo_description,
    'policy', CASE WHEN p.policy_id IS NULL OR NOT EXISTS (
                     SELECT 1 FROM hospitality.policies x WHERE x.tenant_id = _t AND x.id = p.policy_id AND NOT x.is_archived)
                   THEN NULL ELSE hospitality._public_policy(_t, p.policy_id) END,
    'addons', hospitality._package_addons_json(_t, p, _staff))
  || CASE WHEN _staff THEN jsonb_build_object(
       'is_active', p.is_active, 'policy_id', p.policy_id, 'revision', p.revision,
       'unit_name', (SELECT u.name FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = p.unit_id),
       'bookings_count', (SELECT count(*) FROM hospitality.bookings b
                           WHERE b.tenant_id = _t AND b.package_id = p.id
                             AND COALESCE(b.package_snapshot ->> 'role', '') <> 'addon'),
       'addon_bookings_count', (SELECT count(*) FROM hospitality.bookings b
                                 WHERE b.tenant_id = _t AND b.package_id = p.id AND b.package_snapshot ->> 'role' = 'addon'),
       'updated_at', hospitality._ts(p.updated_at))
     ELSE '{}'::jsonb END;
$$;

-- ------------------------------------------------------------
-- 2. Proposals: reason, later, reverted, package, auto
-- ------------------------------------------------------------
ALTER TABLE hospitality.seo_proposals ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE hospitality.seo_proposals ADD COLUMN IF NOT EXISTS auto_applied boolean NOT NULL DEFAULT false;
ALTER TABLE hospitality.seo_proposals ADD COLUMN IF NOT EXISTS reverted_at timestamptz;
ALTER TABLE hospitality.seo_proposals ADD COLUMN IF NOT EXISTS reverted_by uuid;

-- the same constraint names as migration 201 (so the rollback restores them exactly), widened
ALTER TABLE hospitality.seo_proposals
  DROP CONSTRAINT IF EXISTS seo_proposals_status_check,
  DROP CONSTRAINT IF EXISTS seo_proposals_target_kind_check,
  DROP CONSTRAINT IF EXISTS seo_proposals_check1,
  DROP CONSTRAINT IF EXISTS seo_proposals_check2,
  DROP CONSTRAINT IF EXISTS seo_proposals_check3,
  DROP CONSTRAINT IF EXISTS seo_proposals_reason_check,
  DROP CONSTRAINT IF EXISTS seo_proposals_reverted_check;
ALTER TABLE hospitality.seo_proposals
  ADD CONSTRAINT seo_proposals_status_check
    CHECK (status IN ('pending', 'later', 'approved', 'rejected', 'superseded', 'stale', 'reverted')),
  ADD CONSTRAINT seo_proposals_target_kind_check CHECK (target_kind IN ('site', 'unit', 'media', 'package')),
  ADD CONSTRAINT seo_proposals_check1 CHECK (
       (target_kind = 'site' AND field IN ('seo_title', 'seo_description', 'hero_title', 'about_title', 'about_body'))
    OR (target_kind = 'unit' AND field IN ('seo_title', 'seo_description', 'description'))
    OR (target_kind = 'media' AND field = 'alt')
    OR (target_kind = 'package' AND field IN ('seo_title', 'seo_description'))),
  ADD CONSTRAINT seo_proposals_check2 CHECK ((status IN ('approved', 'reverted')) = (applied IS NOT NULL)),
  ADD CONSTRAINT seo_proposals_check3 CHECK ((status IN ('pending', 'later')) = (decided_at IS NULL)),
  ADD CONSTRAINT seo_proposals_reason_check CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 300),
  ADD CONSTRAINT seo_proposals_reverted_check CHECK ((status = 'reverted') = (reverted_at IS NOT NULL));
-- a CHECK under an unexpected name would still refuse the new states: stop here (nothing changes) instead
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.conrelid = 'hospitality.seo_proposals'::regclass AND c.contype = 'c'
                AND c.conname NOT IN ('seo_proposals_status_check', 'seo_proposals_target_kind_check',
                                      'seo_proposals_check', 'seo_proposals_check1', 'seo_proposals_check2',
                                      'seo_proposals_check3', 'seo_proposals_reason_check', 'seo_proposals_reverted_check',
                                      'seo_proposals_proposed_check', 'seo_proposals_base_check',
                                      'seo_proposals_source_check', 'seo_proposals_applied_check')) THEN
    RAISE EXCEPTION 'unexpected CHECK constraint on hospitality.seo_proposals — migration stopped, nothing changed';
  END IF;
END $$;
-- one OPEN proposal per field (pending or saved for later)
DROP INDEX IF EXISTS hospitality.seo_proposals_one_pending;
CREATE UNIQUE INDEX seo_proposals_one_pending ON hospitality.seo_proposals
  (tenant_id, target_kind, COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid), field)
  WHERE status IN ('pending', 'later');

ALTER TABLE hospitality.seo_runs DROP CONSTRAINT IF EXISTS seo_runs_scope_check;
ALTER TABLE hospitality.seo_runs ADD CONSTRAINT seo_runs_scope_check CHECK (scope IN ('initial', 'request', 'auto'));

-- ------------------------------------------------------------
-- 3. Helpers
-- ------------------------------------------------------------
-- the current value of a field (NULL — empty). A target of another business → error
CREATE OR REPLACE FUNCTION hospitality._seo_current(_t uuid, _kind text, _target uuid, _field text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  d record;
  _i integer;
  _v text;
BEGIN
  IF _kind = 'site' THEN
    d := hospitality._seo_doc(_t);
    IF _field = 'seo_title' THEN _v := d.doc #>> '{seo,title}';
    ELSIF _field = 'seo_description' THEN _v := d.doc #>> '{seo,description}';
    ELSE
      _i := hospitality._seo_section(d.doc, CASE WHEN _field = 'hero_title' THEN 'hero' ELSE 'about' END);
      IF _i >= 0 THEN
        _v := d.doc -> 'sections' -> _i -> 'content' ->> CASE WHEN _field = 'about_body' THEN 'body' ELSE 'title' END;
      END IF;
    END IF;
  ELSIF _kind = 'unit' THEN
    SELECT CASE _field WHEN 'seo_title' THEN u.seo_title WHEN 'seo_description' THEN u.seo_description
                       ELSE u.description END
      INTO _v FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = _target;
    IF NOT FOUND THEN RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found'; END IF;
  ELSIF _kind = 'package' THEN
    SELECT CASE _field WHEN 'seo_title' THEN k.seo_title WHEN 'seo_description' THEN k.seo_description END
      INTO _v FROM hospitality.packages k WHERE k.tenant_id = _t AND k.id = _target;
    IF NOT FOUND THEN RAISE EXCEPTION 'החבילה לא נמצאה' USING ERRCODE = 'no_data_found'; END IF;
  ELSIF _kind = 'media' THEN
    SELECT m.alt INTO _v FROM hospitality.media m WHERE m.tenant_id = _t AND m.id = _target AND m.kind = 'image';
    IF NOT FOUND THEN RAISE EXCEPTION 'התמונה לא נמצאה' USING ERRCODE = 'no_data_found'; END IF;
  ELSE
    RAISE EXCEPTION 'יעד לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULLIF(btrim(COALESCE(_v, '')), '');
END $$;

-- write a field by the staff member, through the existing function of that field (its permission, revision check
-- and action log): the site draft (still needs "publish"), unit_seo_set / unit_update, package_seo_set,
-- media_update. NULL clears the field (a restore to "empty" — the site keeps its fallback)
CREATE OR REPLACE FUNCTION hospitality._seo_apply(_t uuid, _kind text, _target uuid, _field text, _value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u hospitality.units;
  k hospitality.packages;
  d record;
  _doc jsonb;
  _i integer;
  _type text;
  _key text;
BEGIN
  IF _kind = 'unit' THEN
    SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _target;
    IF u.id IS NULL THEN RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found'; END IF;
    IF _field = 'description' THEN
      PERFORM hospitality.unit_update(_target, jsonb_build_object('description', _value), u.revision);
    ELSE
      PERFORM hospitality.unit_seo_set(_target,
                CASE WHEN _field = 'seo_title' THEN _value ELSE u.seo_title END,
                CASE WHEN _field = 'seo_description' THEN _value ELSE u.seo_description END,
                u.revision);
    END IF;
  ELSIF _kind = 'package' THEN
    SELECT * INTO k FROM hospitality.packages x WHERE x.tenant_id = _t AND x.id = _target;
    IF k.id IS NULL THEN RAISE EXCEPTION 'החבילה לא נמצאה' USING ERRCODE = 'no_data_found'; END IF;
    PERFORM hospitality.package_seo_set(_target,
              CASE WHEN _field = 'seo_title' THEN _value ELSE k.seo_title END,
              CASE WHEN _field = 'seo_description' THEN _value ELSE k.seo_description END,
              k.revision);
  ELSIF _kind = 'media' THEN
    PERFORM hospitality.media_update(_target, _value);
  ELSIF _kind = 'site' THEN
    d := hospitality._seo_doc(_t);
    IF d.doc IS NULL THEN
      RAISE EXCEPTION 'האתר עוד לא עוצב — פותחים את העורך קודם' USING ERRCODE = 'no_data_found';
    END IF;
    _doc := d.doc;
    IF _field IN ('seo_title', 'seo_description') THEN
      _key := CASE WHEN _field = 'seo_title' THEN 'title' ELSE 'description' END;
      IF _value IS NULL THEN
        _doc := _doc #- ARRAY['seo', _key];
      ELSE
        IF jsonb_typeof(_doc -> 'seo') IS DISTINCT FROM 'object' THEN _doc := jsonb_set(_doc, '{seo}', '{}'::jsonb, true); END IF;
        _doc := jsonb_set(_doc, ARRAY['seo', _key], to_jsonb(_value), true);
      END IF;
    ELSE
      _type := CASE WHEN _field = 'hero_title' THEN 'hero' ELSE 'about' END;
      _key := CASE WHEN _field = 'about_body' THEN 'body' ELSE 'title' END;
      _i := hospitality._seo_section(_doc, _type);
      IF _value IS NULL THEN
        IF _i >= 0 THEN _doc := _doc #- ARRAY['sections', _i::text, 'content', _key]; END IF;
      ELSE
        IF jsonb_typeof(_doc -> 'sections') IS DISTINCT FROM 'array' THEN
          _doc := jsonb_set(_doc, '{sections}', '[]'::jsonb, true);
        END IF;
        IF _i < 0 THEN
          _doc := jsonb_set(_doc, '{sections}', (_doc -> 'sections') ||
                    jsonb_build_array(jsonb_build_object('id', _type, 'type', _type, 'hidden', false, 'content', '{}'::jsonb)));
          _i := jsonb_array_length(_doc -> 'sections') - 1;
        END IF;
        IF jsonb_typeof(_doc -> 'sections' -> _i -> 'content') IS DISTINCT FROM 'object' THEN
          _doc := jsonb_set(_doc, ARRAY['sections', _i::text, 'content'], '{}'::jsonb, true);
        END IF;
        _doc := jsonb_set(_doc, ARRAY['sections', _i::text, 'content', _key], to_jsonb(_value), true);
      END IF;
    END IF;
    -- the draft only: the live site changes on "publish"
    PERFORM hospitality.site_draft_save(d.revision, d.theme, _doc);
  ELSE
    RAISE EXCEPTION 'יעד לא תקין' USING ERRCODE = 'check_violation';
  END IF;
END $$;
REVOKE ALL ON FUNCTION hospitality._seo_apply(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- automatic fill (the server's run, no staff member): only an EMPTY field, only image alt / unit or package Google
-- title + description — written directly (no staff session), with the same action-log entry. true = written
CREATE OR REPLACE FUNCTION hospitality._seo_auto_write(_t uuid, _kind text, _target uuid, _field text, _v text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _n integer := 0;
  _name text;
BEGIN
  IF _v IS NULL THEN
    RETURN false;
  END IF;
  IF _kind = 'media' AND _field = 'alt' AND char_length(_v) <= 250 THEN
    UPDATE hospitality.media x SET alt = _v
     WHERE x.tenant_id = _t AND x.id = _target AND x.kind = 'image' AND NULLIF(btrim(COALESCE(x.alt, '')), '') IS NULL;
    GET DIAGNOSTICS _n = ROW_COUNT;
    IF _n = 1 THEN
      PERFORM hospitality._audit(_t, 'media.alt_updated', NULL,
                jsonb_build_object('alt', jsonb_build_object('changed', true), 'auto', true));
    END IF;
  ELSIF _kind = 'unit' AND _field IN ('seo_title', 'seo_description')
        AND char_length(_v) <= (CASE WHEN _field = 'seo_title' THEN 120 ELSE 320 END) THEN
    UPDATE hospitality.units x
       SET seo_title = CASE WHEN _field = 'seo_title' THEN _v ELSE x.seo_title END,
           seo_description = CASE WHEN _field = 'seo_description' THEN _v ELSE x.seo_description END,
           revision = x.revision + 1
     WHERE x.tenant_id = _t AND x.id = _target
       AND NULLIF(btrim(COALESCE(CASE WHEN _field = 'seo_title' THEN x.seo_title ELSE x.seo_description END, '')), '') IS NULL
    RETURNING x.name INTO _name;
    GET DIAGNOSTICS _n = ROW_COUNT;
    IF _n = 1 THEN
      PERFORM hospitality._audit(_t, 'catalog.unit_updated', _name,
                jsonb_build_object(_field, jsonb_build_object('changed', true), 'auto', true));
    END IF;
  ELSIF _kind = 'package' AND _field IN ('seo_title', 'seo_description')
        AND char_length(_v) <= (CASE WHEN _field = 'seo_title' THEN 120 ELSE 320 END) THEN
    UPDATE hospitality.packages x
       SET seo_title = CASE WHEN _field = 'seo_title' THEN _v ELSE x.seo_title END,
           seo_description = CASE WHEN _field = 'seo_description' THEN _v ELSE x.seo_description END,
           revision = x.revision + 1, updated_at = now()
     WHERE x.tenant_id = _t AND x.id = _target
       AND NULLIF(btrim(COALESCE(CASE WHEN _field = 'seo_title' THEN x.seo_title ELSE x.seo_description END, '')), '') IS NULL
    RETURNING x.name INTO _name;
    GET DIAGNOSTICS _n = ROW_COUNT;
    IF _n = 1 THEN
      PERFORM hospitality._audit(_t, 'packages.updated', _name,
                jsonb_build_object(_field, jsonb_build_object('changed', true), 'auto', true));
    END IF;
  END IF;
  RETURN _n = 1;
END $$;
REVOKE ALL ON FUNCTION hospitality._seo_auto_write(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. The app server (service_role): runs and proposals
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.seo_run_start(_tenant uuid, _actor uuid, _kind text, _scope text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._seo_server_tenant(_tenant);
  _id uuid;
BEGIN
  IF _kind NOT IN ('template', 'ai') OR _scope NOT IN ('initial', 'request', 'auto') THEN
    RAISE EXCEPTION 'סוג הפקה לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-seo-run:' || _t || ':' || _kind, 0));
  UPDATE hospitality.seo_runs x SET status = 'failed', finished_at = now()
   WHERE x.tenant_id = _t AND x.kind = _kind AND x.status = 'running' AND x.created_at < now() - interval '15 minutes';
  INSERT INTO hospitality.seo_runs (tenant_id, kind, scope, created_by)
  VALUES (_t, _kind, _scope, _actor)
  ON CONFLICT DO NOTHING
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- the proposals of a run. _items: [{target_kind, target_id, field, text, reason?}]. _only_empty — empty fields only
-- (the automatic runs). A target of another business / unknown field / empty, long or identical text → skipped.
-- A proposal the owner saved for later is never replaced by an automatic run. With the owner's auto switch on,
-- an empty image alt / unit or package Google field is filled at once (approved, auto_applied — revertable)
CREATE OR REPLACE FUNCTION hospitality.seo_proposals_add(_tenant uuid, _run uuid, _items jsonb, _only_empty boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._seo_server_tenant(_tenant);
  r hospitality.seo_runs;
  it jsonb;
  _kind text;
  _target uuid;
  _field text;
  _text text;
  _reason text;
  _base text;
  _auto jsonb;
  _apply boolean;
  _added integer := 0;
  _skipped integer := 0;
  _applied integer := 0;
BEGIN
  SELECT * INTO r FROM hospitality.seo_runs x WHERE x.tenant_id = _t AND x.id = _run AND x.status = 'running';
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'ההפקה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) > 300 THEN
    RAISE EXCEPTION 'רשימת ההצעות לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  -- the owner's switches (SEO center); none → nothing is automatic
  SELECT s.auto_apply INTO _auto FROM public.seo_settings s WHERE s.tenant_id = _t;
  FOR it IN SELECT e FROM jsonb_array_elements(_items) AS x(e) LOOP
    _kind := it ->> 'target_kind';
    _field := it ->> 'field';
    _target := NULL;
    IF jsonb_typeof(it -> 'target_id') = 'string'
       AND (it ->> 'target_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      _target := (it ->> 'target_id')::uuid;
    END IF;
    _text := hospitality._seo_clean(_field, it ->> 'text');
    _reason := NULLIF(btrim(left(hospitality._seo_clean('alt', it ->> 'reason'), 300)), '');
    IF _kind IS NULL OR _field IS NULL OR _text IS NULL
       OR NOT ((_kind = 'site' AND _target IS NULL AND _field IN ('seo_title', 'seo_description', 'hero_title', 'about_title', 'about_body'))
            OR (_kind = 'unit' AND _target IS NOT NULL AND _field IN ('seo_title', 'seo_description', 'description'))
            OR (_kind = 'package' AND _target IS NOT NULL AND _field IN ('seo_title', 'seo_description'))
            OR (_kind = 'media' AND _target IS NOT NULL AND _field = 'alt'))
       OR char_length(_text) > hospitality._seo_max(_kind, _field) THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;
    BEGIN
      _base := hospitality._seo_current(_t, _kind, _target, _field);
    EXCEPTION WHEN no_data_found THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END;
    IF (_only_empty AND _base IS NOT NULL) OR _text IS NOT DISTINCT FROM _base THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;
    -- saved for later by the owner: an automatic run leaves it alone
    IF _only_empty AND EXISTS (SELECT 1 FROM hospitality.seo_proposals p
                                WHERE p.tenant_id = _t AND p.status = 'later' AND p.target_kind = _kind
                                  AND p.target_id IS NOT DISTINCT FROM _target AND p.field = _field) THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;
    -- a limit per business: up to 500 open proposals
    IF (SELECT count(*) FROM hospitality.seo_proposals p WHERE p.tenant_id = _t AND p.status IN ('pending', 'later')) >= 500 THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;
    UPDATE hospitality.seo_proposals p SET status = 'superseded', decided_at = now()
     WHERE p.tenant_id = _t AND p.status IN ('pending', 'later') AND p.target_kind = _kind
       AND p.target_id IS NOT DISTINCT FROM _target AND p.field = _field;
    _apply := _base IS NULL AND (
         (_kind = 'media' AND _field = 'alt' AND COALESCE(_auto -> 'alt', 'false'::jsonb) = 'true'::jsonb)
      OR (_kind IN ('unit', 'package') AND _field IN ('seo_title', 'seo_description')
          AND COALESCE(_auto -> 'meta', 'false'::jsonb) = 'true'::jsonb));
    IF _apply THEN
      _apply := hospitality._seo_auto_write(_t, _kind, _target, _field, _text);
    END IF;
    INSERT INTO hospitality.seo_proposals (tenant_id, run_id, target_kind, target_id, field, proposed, base, source,
                                           reason, status, applied, decided_at, auto_applied)
    VALUES (_t, _run, _kind, _target, _field, _text, _base, r.kind, _reason,
            CASE WHEN _apply THEN 'approved' ELSE 'pending' END, CASE WHEN _apply THEN _text END,
            CASE WHEN _apply THEN now() END, _apply);
    _added := _added + 1;
    IF _apply THEN _applied := _applied + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('added', _added, 'skipped', _skipped, 'applied', _applied);
END $$;

-- ------------------------------------------------------------
-- 5. Staff (settings permission): the list, decide (+ later), restore
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.seo_proposals()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
BEGIN
  RETURN jsonb_build_object(
    'proposals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'target_kind', p.target_kind, 'target_id', p.target_id, 'field', p.field,
               'proposed', p.proposed, 'base', p.base, 'source', p.source, 'status', p.status,
               'reason', p.reason, 'auto_applied', p.auto_applied,
               'applied', p.applied, 'created_at', hospitality._ts(p.created_at),
               'decided_at', hospitality._ts(p.decided_at), 'reverted_at', hospitality._ts(p.reverted_at),
               'target_label', CASE p.target_kind
                                 WHEN 'unit' THEN (SELECT u.name FROM hospitality.units u
                                                    WHERE u.tenant_id = _t AND u.id = p.target_id)
                                 WHEN 'package' THEN (SELECT k.name FROM hospitality.packages k
                                                       WHERE k.tenant_id = _t AND k.id = p.target_id)
                                 ELSE NULL END,
               -- the value now: open → if it changed since, approving will not apply; approved → restorable only
               -- while the field still holds the approved text
               'current', CASE WHEN p.status IN ('pending', 'later', 'approved')
                               THEN hospitality._seo_current(_t, p.target_kind, p.target_id, p.field) END)
             ORDER BY (p.status = 'pending') DESC, (p.status = 'later') DESC, p.created_at DESC, p.target_kind, p.field)
        FROM (SELECT * FROM hospitality.seo_proposals x
               WHERE x.tenant_id = _t
                 AND (x.status IN ('pending', 'later') OR x.decided_at > now() - interval '90 days'
                      OR x.reverted_at > now() - interval '90 days')
                 -- a target that was deleted (unit / package / image) — not shown
                 AND (x.target_kind = 'site'
                   OR (x.target_kind = 'unit' AND EXISTS (SELECT 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = x.target_id))
                   OR (x.target_kind = 'package' AND EXISTS (SELECT 1 FROM hospitality.packages k WHERE k.tenant_id = _t AND k.id = x.target_id))
                   OR (x.target_kind = 'media' AND EXISTS (SELECT 1 FROM hospitality.media m WHERE m.tenant_id = _t AND m.id = x.target_id
                                                             AND m.kind = 'image')))
               ORDER BY (x.status IN ('pending', 'later')) DESC, x.created_at DESC LIMIT 600) p), '[]'::jsonb),
    'runs', jsonb_build_object(
      'template_initial', EXISTS (SELECT 1 FROM hospitality.seo_runs x WHERE x.tenant_id = _t AND x.kind = 'template'
                                    AND x.scope = 'initial' AND x.status <> 'failed'),
      'ai_initial', EXISTS (SELECT 1 FROM hospitality.seo_runs x WHERE x.tenant_id = _t AND x.kind = 'ai'
                              AND x.scope = 'initial' AND x.status <> 'failed')));
END $$;

-- approve (optionally edited) / reject / save for later. Approve applies only if the field is still what it was when
-- the proposal was made (otherwise 'stale' — nothing is overwritten), through the field's own function
CREATE OR REPLACE FUNCTION hospitality.seo_proposal_decide(_id uuid, _action text, _text text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  p hospitality.seo_proposals;
  _final text;
  _cur text;
  _label text;
BEGIN
  IF _action IS NULL OR _action NOT IN ('approve', 'reject', 'later') THEN
    RAISE EXCEPTION 'פעולה לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM hospitality.seo_proposals x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'ההצעה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF p.status NOT IN ('pending', 'later') THEN
    RAISE EXCEPTION 'ההצעה כבר טופלה' USING ERRCODE = 'HS409';
  END IF;
  _label := CASE p.target_kind
              WHEN 'unit' THEN (SELECT x.name FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = p.target_id)
              WHEN 'package' THEN (SELECT x.name FROM hospitality.packages x WHERE x.tenant_id = _t AND x.id = p.target_id)
              WHEN 'media' THEN 'תמונה' ELSE 'האתר' END;

  IF _action = 'later' THEN
    IF p.status = 'pending' THEN
      UPDATE hospitality.seo_proposals x SET status = 'later' WHERE x.id = p.id;
      PERFORM hospitality._audit(_t, 'seo.proposal_later', _label, jsonb_build_object('field', p.field));
    END IF;
    RETURN jsonb_build_object('status', 'later');
  END IF;

  IF _action = 'reject' THEN
    UPDATE hospitality.seo_proposals x SET status = 'rejected', decided_at = now(), decided_by = auth.uid()
     WHERE x.id = p.id;
    PERFORM hospitality._audit(_t, 'seo.proposal_rejected', _label, jsonb_build_object('field', p.field));
    RETURN jsonb_build_object('status', 'rejected');
  END IF;

  _final := COALESCE(hospitality._seo_clean(p.field, _text), p.proposed);
  IF char_length(_final) > hospitality._seo_max(p.target_kind, p.field) THEN
    RAISE EXCEPTION 'הטקסט ארוך מדי — עד % תווים', hospitality._seo_max(p.target_kind, p.field)
      USING ERRCODE = 'check_violation';
  END IF;

  -- no overwrite: the field must be what it was when the proposal was made
  _cur := hospitality._seo_current(_t, p.target_kind, p.target_id, p.field);
  IF _cur IS DISTINCT FROM p.base THEN
    UPDATE hospitality.seo_proposals x SET status = 'stale', decided_at = now(), decided_by = auth.uid()
     WHERE x.id = p.id;
    RETURN jsonb_build_object('status', 'stale');
  END IF;

  PERFORM hospitality._seo_apply(_t, p.target_kind, p.target_id, p.field, _final);

  UPDATE hospitality.seo_proposals x
     SET status = 'approved', applied = _final, decided_at = now(), decided_by = auth.uid()
   WHERE x.id = p.id;
  PERFORM hospitality._audit(_t, 'seo.proposal_approved', _label,
            jsonb_build_object('field', p.field, 'source', p.source, 'edited', _final IS DISTINCT FROM p.proposed));
  RETURN jsonb_build_object('status', 'approved');
END $$;

-- restore: back to the value before the approval — only while the field still holds the approved text and no later
-- approval of the same field exists (restore that one first). Through the field's own function, like approving
CREATE OR REPLACE FUNCTION hospitality.seo_proposal_revert(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  p hospitality.seo_proposals;
  _cur text;
  _label text;
BEGIN
  SELECT * INTO p FROM hospitality.seo_proposals x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'ההצעה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF p.status <> 'approved' THEN
    RAISE EXCEPTION 'אפשר לשחזר רק הצעה שאושרה' USING ERRCODE = 'HS409';
  END IF;
  IF EXISTS (SELECT 1 FROM hospitality.seo_proposals x
              WHERE x.tenant_id = _t AND x.status = 'approved' AND x.id <> p.id AND x.target_kind = p.target_kind
                AND x.target_id IS NOT DISTINCT FROM p.target_id AND x.field = p.field AND x.decided_at > p.decided_at) THEN
    RAISE EXCEPTION 'יש אישור מאוחר יותר לאותו שדה — משחזרים אותו קודם' USING ERRCODE = 'HS409';
  END IF;
  _cur := hospitality._seo_current(_t, p.target_kind, p.target_id, p.field);
  IF _cur IS DISTINCT FROM p.applied THEN
    RAISE EXCEPTION 'השדה השתנה מאז האישור — לא שוחזר, כדי לא לדרוס את השינוי' USING ERRCODE = 'HS409';
  END IF;
  PERFORM hospitality._seo_apply(_t, p.target_kind, p.target_id, p.field, p.base);
  UPDATE hospitality.seo_proposals x SET status = 'reverted', reverted_at = now(), reverted_by = auth.uid()
   WHERE x.id = p.id;
  _label := CASE p.target_kind
              WHEN 'unit' THEN (SELECT x.name FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = p.target_id)
              WHEN 'package' THEN (SELECT x.name FROM hospitality.packages x WHERE x.tenant_id = _t AND x.id = p.target_id)
              WHEN 'media' THEN 'תמונה' ELSE 'האתר' END;
  PERFORM hospitality._audit(_t, 'seo.proposal_reverted', _label,
            jsonb_build_object('field', p.field, 'auto', p.auto_applied));
  RETURN jsonb_build_object('status', 'reverted');
END $$;
REVOKE ALL ON FUNCTION hospitality.seo_proposal_revert(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.seo_proposal_revert(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 6. Automation: a new unit / package / image → one queued job per business and type (migration 203's queue;
--    the trigger can never block the insert — errors become a warning)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS seo_on_unit ON hospitality.units;
CREATE TRIGGER seo_on_unit AFTER INSERT ON hospitality.units
  FOR EACH ROW EXECUTE FUNCTION public._seo_on_entity('unit');
DROP TRIGGER IF EXISTS seo_on_package ON hospitality.packages;
CREATE TRIGGER seo_on_package AFTER INSERT ON hospitality.packages
  FOR EACH ROW EXECUTE FUNCTION public._seo_on_entity('package');
DROP TRIGGER IF EXISTS seo_on_media ON hospitality.media;
CREATE TRIGGER seo_on_media AFTER INSERT ON hospitality.media
  FOR EACH ROW WHEN (NEW.kind = 'image') EXECUTE FUNCTION public._seo_on_entity('media');

NOTIFY pgrst, 'reload schema';
COMMIT;

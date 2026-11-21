-- ============================================================
-- Rollback: 20261122110000_hosp_seo_engine.sql — Hospitality on the SEO engine (migration 204)
--   • guard: stops (nothing changes) while the owner's work would be lost — a package has a Google title /
--     description, a proposal targets a package, or a proposal was restored (its history).
--   • lossless conversions: proposals saved for later go back to "pending" (still open, the old screen shows them);
--     automatic runs become "request" runs; auto-filled proposals stay "approved" (only the auto mark goes —
--     the filled texts stay where they are).
--   • drops the new functions, triggers and columns; the proposal constraints, the one-open-proposal index, the
--     run scopes and the six changed functions go back to migrations 201 / 202 word for word.
--   • afterwards the schema is identical to the one before the migration (scripts/db-tests/rollback-check.sh).
--   Roll this back BEFORE 20261122100000_seo_engine (migration 203).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
DECLARE
  _n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'hospitality' AND table_name = 'packages' AND column_name = 'seo_title') THEN
    EXECUTE 'SELECT count(*) FROM hospitality.packages p WHERE p.seo_title IS NOT NULL OR p.seo_description IS NOT NULL'
      INTO _n;
    IF _n > 0 THEN
      RAISE EXCEPTION 'rollback stopped: % packages have a Google title / description — nothing changed', _n;
    END IF;
  END IF;
  SELECT count(*) INTO _n FROM hospitality.seo_proposals p WHERE p.target_kind = 'package' OR p.status = 'reverted';
  IF _n > 0 THEN
    RAISE EXCEPTION 'rollback stopped: % SEO proposals target a package or were restored — nothing changed', _n;
  END IF;
END $$;

DROP TRIGGER IF EXISTS seo_on_unit ON hospitality.units;
DROP TRIGGER IF EXISTS seo_on_package ON hospitality.packages;
DROP TRIGGER IF EXISTS seo_on_media ON hospitality.media;
DROP FUNCTION IF EXISTS hospitality.seo_proposal_revert(uuid);
DROP FUNCTION IF EXISTS hospitality._seo_apply(uuid, text, uuid, text, text);
DROP FUNCTION IF EXISTS hospitality._seo_auto_write(uuid, text, uuid, text, text);
DROP FUNCTION IF EXISTS hospitality.package_seo_set(uuid, text, text, integer);

-- migrations 201 / 202, word for word
CREATE OR REPLACE FUNCTION hospitality.seo_run_start(_tenant uuid, _actor uuid, _kind text, _scope text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _t uuid := hospitality._seo_server_tenant(_tenant);
  _id uuid;
BEGIN
  IF _kind NOT IN ('template', 'ai') OR _scope NOT IN ('initial', 'request') THEN
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
END $function$
;
CREATE OR REPLACE FUNCTION hospitality._seo_current(_t uuid, _kind text, _target uuid, _field text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  ELSIF _kind = 'media' THEN
    SELECT m.alt INTO _v FROM hospitality.media m WHERE m.tenant_id = _t AND m.id = _target AND m.kind = 'image';
    IF NOT FOUND THEN RAISE EXCEPTION 'התמונה לא נמצאה' USING ERRCODE = 'no_data_found'; END IF;
  ELSE
    RAISE EXCEPTION 'יעד לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULLIF(btrim(COALESCE(_v, '')), '');
END $function$

;
CREATE OR REPLACE FUNCTION hospitality.seo_proposals_add(_tenant uuid, _run uuid, _items jsonb, _only_empty boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _t uuid := hospitality._seo_server_tenant(_tenant);
  r hospitality.seo_runs;
  it jsonb;
  _kind text;
  _target uuid;
  _field text;
  _text text;
  _base text;
  _added integer := 0;
  _skipped integer := 0;
BEGIN
  SELECT * INTO r FROM hospitality.seo_runs x WHERE x.tenant_id = _t AND x.id = _run AND x.status = 'running';
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'ההפקה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) > 300 THEN
    RAISE EXCEPTION 'רשימת ההצעות לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  FOR it IN SELECT e FROM jsonb_array_elements(_items) AS x(e) LOOP
    _kind := it ->> 'target_kind';
    _field := it ->> 'field';
    _target := NULL;
    IF jsonb_typeof(it -> 'target_id') = 'string'
       AND (it ->> 'target_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      _target := (it ->> 'target_id')::uuid;
    END IF;
    _text := hospitality._seo_clean(_field, it ->> 'text');
    IF _kind IS NULL OR _field IS NULL OR _text IS NULL
       OR NOT ((_kind = 'site' AND _target IS NULL AND _field IN ('seo_title', 'seo_description', 'hero_title', 'about_title', 'about_body'))
            OR (_kind = 'unit' AND _target IS NOT NULL AND _field IN ('seo_title', 'seo_description', 'description'))
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
    -- גבול לעסק: עד 500 הצעות ממתינות
    IF (SELECT count(*) FROM hospitality.seo_proposals p WHERE p.tenant_id = _t AND p.status = 'pending') >= 500 THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;
    UPDATE hospitality.seo_proposals p SET status = 'superseded', decided_at = now()
     WHERE p.tenant_id = _t AND p.status = 'pending' AND p.target_kind = _kind
       AND p.target_id IS NOT DISTINCT FROM _target AND p.field = _field;
    INSERT INTO hospitality.seo_proposals (tenant_id, run_id, target_kind, target_id, field, proposed, base, source)
    VALUES (_t, _run, _kind, _target, _field, _text, _base, r.kind);
    _added := _added + 1;
  END LOOP;
  RETURN jsonb_build_object('added', _added, 'skipped', _skipped);
END $function$

;
CREATE OR REPLACE FUNCTION hospitality.seo_proposals()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
BEGIN
  RETURN jsonb_build_object(
    'proposals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'target_kind', p.target_kind, 'target_id', p.target_id, 'field', p.field,
               'proposed', p.proposed, 'base', p.base, 'source', p.source, 'status', p.status,
               'applied', p.applied, 'created_at', hospitality._ts(p.created_at),
               'decided_at', hospitality._ts(p.decided_at),
               'target_label', CASE p.target_kind WHEN 'unit' THEN (SELECT u.name FROM hospitality.units u
                                                                     WHERE u.tenant_id = _t AND u.id = p.target_id)
                                                  ELSE NULL END,
               -- הערך עכשיו: אם השתנה מאז ההפקה, ההצעה לא תוחל
               'current', CASE WHEN p.status = 'pending' THEN hospitality._seo_current(_t, p.target_kind, p.target_id, p.field) END)
             ORDER BY (p.status = 'pending') DESC, p.created_at DESC, p.target_kind, p.field)
        FROM (SELECT * FROM hospitality.seo_proposals x
               WHERE x.tenant_id = _t
                 AND (x.status = 'pending' OR x.decided_at > now() - interval '30 days')
                 -- יעד שנמחק (יחידה / תמונה) — לא מוצג
                 AND (x.target_kind = 'site'
                   OR (x.target_kind = 'unit' AND EXISTS (SELECT 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = x.target_id))
                   OR (x.target_kind = 'media' AND EXISTS (SELECT 1 FROM hospitality.media m WHERE m.tenant_id = _t AND m.id = x.target_id)))
               ORDER BY (x.status = 'pending') DESC, x.created_at DESC LIMIT 600) p), '[]'::jsonb),
    'runs', jsonb_build_object(
      'template_initial', EXISTS (SELECT 1 FROM hospitality.seo_runs x WHERE x.tenant_id = _t AND x.kind = 'template'
                                    AND x.scope = 'initial' AND x.status <> 'failed'),
      'ai_initial', EXISTS (SELECT 1 FROM hospitality.seo_runs x WHERE x.tenant_id = _t AND x.kind = 'ai'
                              AND x.scope = 'initial' AND x.status <> 'failed')));
END $function$

;
CREATE OR REPLACE FUNCTION hospitality.seo_proposal_decide(_id uuid, _action text, _text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  p hospitality.seo_proposals;
  _final text;
  _cur text;
  u hospitality.units;
  d record;
  _doc jsonb;
  _i integer;
  _type text;
  _key text;
  _label text;
BEGIN
  IF _action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'פעולה לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM hospitality.seo_proposals x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'ההצעה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF p.status <> 'pending' THEN
    RAISE EXCEPTION 'ההצעה כבר טופלה' USING ERRCODE = 'HS409';
  END IF;
  _label := CASE p.target_kind WHEN 'unit' THEN (SELECT x.name FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = p.target_id)
                               WHEN 'media' THEN 'תמונה' ELSE 'האתר' END;

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

  -- אין דריסה: השדה חייב להיות כמו ברגע ההפקה
  _cur := hospitality._seo_current(_t, p.target_kind, p.target_id, p.field);
  IF _cur IS DISTINCT FROM p.base THEN
    UPDATE hospitality.seo_proposals x SET status = 'stale', decided_at = now(), decided_by = auth.uid()
     WHERE x.id = p.id;
    RETURN jsonb_build_object('status', 'stale');
  END IF;

  -- השמירה — דרך הפונקציה הקיימת של אותו שדה (הרשאה, גרסה, יומן)
  IF p.target_kind = 'unit' THEN
    SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = p.target_id;
    IF p.field = 'description' THEN
      PERFORM hospitality.unit_update(p.target_id, jsonb_build_object('description', _final), u.revision);
    ELSE
      PERFORM hospitality.unit_seo_set(p.target_id,
                CASE WHEN p.field = 'seo_title' THEN _final ELSE u.seo_title END,
                CASE WHEN p.field = 'seo_description' THEN _final ELSE u.seo_description END,
                u.revision);
    END IF;
  ELSIF p.target_kind = 'media' THEN
    PERFORM hospitality.media_update(p.target_id, _final);
  ELSE
    d := hospitality._seo_doc(_t);
    IF d.doc IS NULL THEN
      RAISE EXCEPTION 'האתר עוד לא עוצב — פותחים את העורך קודם' USING ERRCODE = 'no_data_found';
    END IF;
    _doc := d.doc;
    IF p.field IN ('seo_title', 'seo_description') THEN
      IF jsonb_typeof(_doc -> 'seo') IS DISTINCT FROM 'object' THEN _doc := jsonb_set(_doc, '{seo}', '{}'::jsonb, true); END IF;
      _doc := jsonb_set(_doc, ARRAY['seo', CASE WHEN p.field = 'seo_title' THEN 'title' ELSE 'description' END],
                        to_jsonb(_final), true);
    ELSE
      _type := CASE WHEN p.field = 'hero_title' THEN 'hero' ELSE 'about' END;
      _key := CASE WHEN p.field = 'about_body' THEN 'body' ELSE 'title' END;
      IF jsonb_typeof(_doc -> 'sections') IS DISTINCT FROM 'array' THEN
        _doc := jsonb_set(_doc, '{sections}', '[]'::jsonb, true);
      END IF;
      _i := hospitality._seo_section(_doc, _type);
      IF _i < 0 THEN
        _doc := jsonb_set(_doc, '{sections}', (_doc -> 'sections') ||
                  jsonb_build_array(jsonb_build_object('id', _type, 'type', _type, 'hidden', false, 'content', '{}'::jsonb)));
        _i := jsonb_array_length(_doc -> 'sections') - 1;
      END IF;
      IF jsonb_typeof(_doc -> 'sections' -> _i -> 'content') IS DISTINCT FROM 'object' THEN
        _doc := jsonb_set(_doc, ARRAY['sections', _i::text, 'content'], '{}'::jsonb, true);
      END IF;
      _doc := jsonb_set(_doc, ARRAY['sections', _i::text, 'content', _key], to_jsonb(_final), true);
    END IF;
    -- לטיוטה בלבד: האתר משתנה רק ב"פרסום"
    PERFORM hospitality.site_draft_save(d.revision, d.theme, _doc);
  END IF;

  UPDATE hospitality.seo_proposals x
     SET status = 'approved', applied = _final, decided_at = now(), decided_by = auth.uid()
   WHERE x.id = p.id;
  PERFORM hospitality._audit(_t, 'seo.proposal_approved', _label,
            jsonb_build_object('field', p.field, 'source', p.source, 'edited', _final IS DISTINCT FROM p.proposed));
  RETURN jsonb_build_object('status', 'approved');
END $function$

;
CREATE OR REPLACE FUNCTION hospitality._package_json(_t uuid, p hospitality.packages, _staff boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'kind', p.kind, 'name', p.name, 'description', p.description, 'terms', p.terms,
    'nights', p.nights, 'price', p.price, 'max_guests', p.max_guests, 'stay_from', p.stay_from, 'stay_to', p.stay_to,
    'unit_id', p.unit_id, 'media_ids', to_jsonb(hospitality._package_media(_t, p.media_ids)),
    'sort_order', p.sort_order,
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
$function$

;


-- the data: lossless conversions (see above)
UPDATE hospitality.seo_proposals SET status = 'pending' WHERE status = 'later';
UPDATE hospitality.seo_runs SET scope = 'request' WHERE scope = 'auto';

ALTER TABLE hospitality.seo_proposals
  DROP CONSTRAINT IF EXISTS seo_proposals_reason_check,
  DROP CONSTRAINT IF EXISTS seo_proposals_reverted_check,
  DROP CONSTRAINT IF EXISTS seo_proposals_status_check,
  DROP CONSTRAINT IF EXISTS seo_proposals_target_kind_check,
  DROP CONSTRAINT IF EXISTS seo_proposals_check1,
  DROP CONSTRAINT IF EXISTS seo_proposals_check2,
  DROP CONSTRAINT IF EXISTS seo_proposals_check3;
DROP INDEX IF EXISTS hospitality.seo_proposals_one_pending;
ALTER TABLE hospitality.seo_proposals
  DROP COLUMN IF EXISTS reason,
  DROP COLUMN IF EXISTS auto_applied,
  DROP COLUMN IF EXISTS reverted_at,
  DROP COLUMN IF EXISTS reverted_by;
ALTER TABLE hospitality.seo_proposals
  ADD CONSTRAINT seo_proposals_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'superseded', 'stale')),
  ADD CONSTRAINT seo_proposals_target_kind_check CHECK (target_kind IN ('site', 'unit', 'media')),
  ADD CONSTRAINT seo_proposals_check1 CHECK (
       (target_kind = 'site' AND field IN ('seo_title', 'seo_description', 'hero_title', 'about_title', 'about_body'))
    OR (target_kind = 'unit' AND field IN ('seo_title', 'seo_description', 'description'))
    OR (target_kind = 'media' AND field = 'alt')),
  ADD CONSTRAINT seo_proposals_check2 CHECK ((status = 'approved') = (applied IS NOT NULL)),
  ADD CONSTRAINT seo_proposals_check3 CHECK ((status = 'pending') = (decided_at IS NULL));
CREATE UNIQUE INDEX seo_proposals_one_pending ON hospitality.seo_proposals
  (tenant_id, target_kind, COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid), field)
  WHERE status = 'pending';

ALTER TABLE hospitality.seo_runs DROP CONSTRAINT IF EXISTS seo_runs_scope_check;
ALTER TABLE hospitality.seo_runs ADD CONSTRAINT seo_runs_scope_check CHECK (scope IN ('initial', 'request'));

ALTER TABLE hospitality.packages DROP CONSTRAINT IF EXISTS packages_seo_check;
ALTER TABLE hospitality.packages DROP COLUMN IF EXISTS seo_title, DROP COLUMN IF EXISTS seo_description;

NOTIFY pgrst, 'reload schema';
COMMIT;

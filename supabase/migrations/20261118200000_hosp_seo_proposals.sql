-- ============================================================
-- Hospitality — הצעות SEO (גוגל) שממתינות לאישור של העסק
--
-- הפרדה מוחלטת בין הצעה לבין תוכן: הצעה (מתבנית חינמית או מ-NURIEL AI) נשמרת כאן בלבד. שום דבר לא נכנס
-- לאתר, לטיוטת האתר, ליחידה או לתמונה עד שבעל העסק / מנהל מאשר אותה במפורש.
--
--   • seo_runs — כל הפקה (תבנית / AI, ראשונית / לפי בקשה). הפקה ראשונית — פעם אחת לעסק לכל סוג (אינדקס
--     ייחודי; ריצה שנתקעה יותר מ-15 דקות או שנכשלה לא חוסמת ניסיון חוזר)
--   • seo_proposals — ההצעה: יעד (האתר / יחידה / תמונה), שדה, הטקסט המוצע, והערך שהיה בשדה ברגע ההפקה
--     (base). מצב: pending / approved / rejected / superseded (הוחלפה בהצעה חדשה לאותו שדה) / stale (השדה
--     השתנה מאז — לא הוחל)
--   • seo_proposals_add / seo_run_start / seo_run_finish — שרת האפליקציה בלבד (service_role), עם העסק שהשרת
--     זיהה מהכתובת ומהטוקן. הערך הנוכחי (base) מחושב כאן במסד, לא מהאפליקציה. בהפקה האוטומטית (_only_empty)
--     — רק לשדות ריקים: אף פעם לא לשדה שהעסק כתב
--   • seo_proposals() / seo_proposal_decide() — לצוות עם הרשאת settings, אזור הניהול פעיל. אישור עובר רק אם
--     הערך הנוכחי עדיין זהה ל-base (אחרת stale — לא נדרס כלום), ונשמר דרך הפונקציה הקיימת של אותו שדה:
--     site_draft_save (טיוטה — עדיין צריך "פרסום"), unit_seo_set, unit_update, media_update — עם ההרשאות,
--     בדיקת הגרסה והיומן שלהן. האישור / הדחייה — ביומן הפעולות של העסק
--
-- בלי שינוי בטבלה או בפונקציה קיימת. Rollback: supabase/rollbacks/20261118200000_hosp_seo_proposals.down.sql
-- (נעצר כשיש הצעות שמורות).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. הטבלאות
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.seo_runs (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- template: תבנית חינמית בלי AI; ai: NURIEL AI (בתוך המכסות והתקציב הקיימים)
  kind        text NOT NULL CHECK (kind IN ('template', 'ai')),
  -- initial: ההפקה האוטומטית הראשונה (פעם אחת לעסק); request: לפי בקשה
  scope       text NOT NULL CHECK (scope IN ('initial', 'request')),
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  added       integer NOT NULL DEFAULT 0 CHECK (added >= 0),
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (tenant_id, id)
);
-- הפקה ראשונית אחת לעסק לכל סוג (גם בקריאות מקבילות). ריצה שנכשלה לא נספרת
CREATE UNIQUE INDEX IF NOT EXISTS seo_runs_one_initial ON hospitality.seo_runs (tenant_id, kind)
  WHERE scope = 'initial' AND status <> 'failed';
COMMENT ON TABLE hospitality.seo_runs IS
  'Hospitality: הפקות של הצעות SEO (תבנית / AI); הראשונית — פעם אחת לעסק לכל סוג. רק דרך פונקציות';

CREATE TABLE IF NOT EXISTS hospitality.seo_proposals (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id      uuid NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('site', 'unit', 'media')),
  -- היחידה / התמונה; לאתר — NULL
  target_id   uuid,
  field       text NOT NULL,
  proposed    text NOT NULL CHECK (char_length(proposed) BETWEEN 1 AND 5000),
  -- הערך שהיה בשדה ברגע ההפקה (NULL — ריק / ברירת המחדל של האתר)
  base        text CHECK (base IS NULL OR char_length(base) <= 5000),
  source      text NOT NULL CHECK (source IN ('template', 'ai')),
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected', 'superseded', 'stale')),
  -- הטקסט שנשמר בפועל (אחרי עריכה של העסק)
  applied     text CHECK (applied IS NULL OR char_length(applied) <= 5000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  decided_by  uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES hospitality.seo_runs (tenant_id, id) ON DELETE CASCADE,
  CHECK ((target_kind = 'site') = (target_id IS NULL)),
  CHECK ((target_kind = 'site' AND field IN ('seo_title', 'seo_description', 'hero_title', 'about_title', 'about_body'))
      OR (target_kind = 'unit' AND field IN ('seo_title', 'seo_description', 'description'))
      OR (target_kind = 'media' AND field = 'alt')),
  CHECK ((status = 'approved') = (applied IS NOT NULL)),
  CHECK ((status = 'pending') = (decided_at IS NULL))
);
-- הצעה ממתינה אחת לכל שדה: הצעה חדשה מחליפה את הקודמת (superseded)
CREATE UNIQUE INDEX IF NOT EXISTS seo_proposals_one_pending ON hospitality.seo_proposals
  (tenant_id, target_kind, COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid), field)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS seo_proposals_recent ON hospitality.seo_proposals (tenant_id, created_at DESC);
COMMENT ON TABLE hospitality.seo_proposals IS
  'Hospitality: הצעות SEO שממתינות לאישור — לא מוצגות באתר עד אישור מפורש. רק דרך פונקציות';

DO $$
DECLARE
  _tbl text;
BEGIN
  FOREACH _tbl IN ARRAY ARRAY['seo_runs', 'seo_proposals'] LOOP
    EXECUTE format('ALTER TABLE hospitality.%I ENABLE ROW LEVEL SECURITY', _tbl);
    EXECUTE format('REVOKE ALL ON hospitality.%I FROM PUBLIC, anon, authenticated, service_role', _tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON hospitality.%I', _tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON hospitality.%I AS RESTRICTIVE
                      USING (tenant_id = (SELECT public.current_tenant_id()))
                      WITH CHECK (tenant_id = (SELECT public.current_tenant_id()))', _tbl);
    EXECUTE format('DROP POLICY IF EXISTS backend_enabled ON hospitality.%I', _tbl);
    EXECUTE format('CREATE POLICY backend_enabled ON hospitality.%I AS RESTRICTIVE
                      USING ((SELECT hospitality.flag(''hospitality_backend_enabled'')))
                      WITH CHECK ((SELECT hospitality.flag(''hospitality_backend_enabled'')))', _tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS tenant_guard ON hospitality.%I', _tbl);
    EXECUTE format('CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE OF tenant_id ON hospitality.%I
                      FOR EACH ROW EXECUTE FUNCTION hospitality.tenant_guard()', _tbl);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 2. עזרים
-- ------------------------------------------------------------
-- טקסט של הצעה: שורה אחת לכותרות / תיאורים / alt, פסקאות רק בתוכן; בלי תווי בקרה ובלי < >; ריק → NULL
CREATE OR REPLACE FUNCTION hospitality._seo_clean(_field text, _v text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NULLIF(btrim(
    CASE WHEN _field IN ('about_body', 'description')
         THEN regexp_replace(regexp_replace(regexp_replace(COALESCE(_v, ''), E'\r\n?', E'\n', 'g'),
                                            E'[\\x01-\\x09\\x0B-\\x1F\\x7F]', ' ', 'g'), '[<>]', '', 'g')
         ELSE regexp_replace(regexp_replace(COALESCE(_v, ''), '[[:cntrl:]]+', ' ', 'g'), '[<>]', '', 'g')
    END), '');
$$;
REVOKE ALL ON FUNCTION hospitality._seo_clean(text, text) FROM PUBLIC, anon, authenticated;

-- האורך המרבי לכל שדה (כמו בעורך / בפונקציות הקיימות, ובכותרות — ההמלצה לתוצאות החיפוש)
CREATE OR REPLACE FUNCTION hospitality._seo_max(_kind text, _field text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN _field = 'seo_title' THEN 70
    WHEN _field = 'seo_description' THEN 200
    WHEN _field IN ('hero_title', 'about_title') THEN 120
    WHEN _field = 'about_body' THEN 4000
    WHEN _field = 'description' THEN 5000
    WHEN _field = 'alt' THEN 250
  END;
$$;
REVOKE ALL ON FUNCTION hospitality._seo_max(text, text) FROM PUBLIC, anon, authenticated;

-- מסמך האתר שהעורך רואה: הטיוטה, ואם אין — הגרסה המפורסמת האחרונה
CREATE OR REPLACE FUNCTION hospitality._seo_doc(_t uuid, OUT doc jsonb, OUT theme text, OUT revision integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  SELECT x.document, x.theme, x.revision INTO doc, theme, revision
    FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'draft';
  IF doc IS NULL THEN
    SELECT x.document, x.theme INTO doc, theme
      FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'published'
     ORDER BY x.version DESC LIMIT 1;
    revision := 0;
  END IF;
END $$;
REVOKE ALL ON FUNCTION hospitality._seo_doc(uuid) FROM PUBLIC, anon, authenticated;

-- מקום המקטע (hero / about) במסמך; -1 — אין
CREATE OR REPLACE FUNCTION hospitality._seo_section(_doc jsonb, _type text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE((SELECT (e.ord - 1)::integer
                     FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_doc -> 'sections') = 'array'
                                                    THEN _doc -> 'sections' ELSE '[]'::jsonb END)
                          WITH ORDINALITY AS e(s, ord)
                    WHERE e.s ->> 'type' = _type ORDER BY e.ord LIMIT 1), -1);
$$;
REVOKE ALL ON FUNCTION hospitality._seo_section(jsonb, text) FROM PUBLIC, anon, authenticated;

-- הערך הנוכחי של שדה (NULL — ריק). יעד שלא שייך לעסק → שגיאה
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
  ELSIF _kind = 'media' THEN
    SELECT m.alt INTO _v FROM hospitality.media m WHERE m.tenant_id = _t AND m.id = _target AND m.kind = 'image';
    IF NOT FOUND THEN RAISE EXCEPTION 'התמונה לא נמצאה' USING ERRCODE = 'no_data_found'; END IF;
  ELSE
    RAISE EXCEPTION 'יעד לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULLIF(btrim(COALESCE(_v, '')), '');
END $$;
REVOKE ALL ON FUNCTION hospitality._seo_current(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;

-- העסק לשרת האפליקציה: רק אתר אירוח קיים
CREATE OR REPLACE FUNCTION hospitality._seo_server_tenant(_tenant uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _tenant IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant AND t.site_type = 'hospitality') THEN
    RAISE EXCEPTION 'אתר האירוח לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN _tenant;
END $$;
REVOKE ALL ON FUNCTION hospitality._seo_server_tenant(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. שרת האפליקציה (service_role): הפקה
-- ------------------------------------------------------------
-- תחילת הפקה. ראשונית שכבר רצה / רצה עכשיו → NULL (לא מפיקים שוב). ריצה ראשונית שנתקעה מעל 15 דקות — נכשלה
CREATE OR REPLACE FUNCTION hospitality.seo_run_start(_tenant uuid, _actor uuid, _kind text, _scope text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
END $$;
REVOKE ALL ON FUNCTION hospitality.seo_run_start(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.seo_run_start(uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION hospitality.seo_run_finish(_tenant uuid, _run uuid, _ok boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._seo_server_tenant(_tenant);
  r hospitality.seo_runs;
BEGIN
  UPDATE hospitality.seo_runs x
     SET status = CASE WHEN _ok THEN 'done' ELSE 'failed' END, finished_at = now(),
         added = (SELECT count(*) FROM hospitality.seo_proposals p WHERE p.tenant_id = _t AND p.run_id = _run)
   WHERE x.tenant_id = _t AND x.id = _run AND x.status = 'running'
  RETURNING * INTO r;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'ההפקה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF r.added > 0 THEN
    PERFORM hospitality._audit(_t, 'seo.suggestions_created', NULL,
              jsonb_build_object('source', r.kind, 'scope', r.scope, 'count', r.added));
  END IF;
  RETURN jsonb_build_object('status', r.status, 'added', r.added);
END $$;
REVOKE ALL ON FUNCTION hospitality.seo_run_finish(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.seo_run_finish(uuid, uuid, boolean) TO service_role;

-- ההצעות של הפקה. _items: [{target_kind, target_id, field, text}]. _only_empty — רק לשדות ריקים (ההפקה
-- האוטומטית). יעד שלא שייך לעסק / שדה לא מוכר / טקסט ריק או ארוך / זהה לקיים — לא נכנס (נספר כ-skipped)
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
END $$;
REVOKE ALL ON FUNCTION hospitality.seo_proposals_add(uuid, uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.seo_proposals_add(uuid, uuid, jsonb, boolean) TO service_role;

-- מה כבר רץ (לשרת: האם להפעיל את ההפקה הראשונית)
CREATE OR REPLACE FUNCTION hospitality.seo_runs_state(_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._seo_server_tenant(_tenant);
BEGIN
  RETURN jsonb_build_object(
    'template_initial', EXISTS (SELECT 1 FROM hospitality.seo_runs x WHERE x.tenant_id = _t AND x.kind = 'template'
                                  AND x.scope = 'initial' AND x.status <> 'failed'),
    'ai_initial', EXISTS (SELECT 1 FROM hospitality.seo_runs x WHERE x.tenant_id = _t AND x.kind = 'ai'
                            AND x.scope = 'initial' AND x.status <> 'failed'));
END $$;
REVOKE ALL ON FUNCTION hospitality.seo_runs_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.seo_runs_state(uuid) TO service_role;

-- ------------------------------------------------------------
-- 4. הצוות: רשימה והחלטה
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
END $$;
REVOKE ALL ON FUNCTION hospitality.seo_proposals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.seo_proposals() TO authenticated, service_role;

-- אישור (approve, עם עריכה אופציונלית ב-_text) או דחייה (reject). מחזיר {status}: approved / rejected / stale
CREATE OR REPLACE FUNCTION hospitality.seo_proposal_decide(_id uuid, _action text, _text text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
END $$;
REVOKE ALL ON FUNCTION hospitality.seo_proposal_decide(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.seo_proposal_decide(uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

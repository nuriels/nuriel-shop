-- ============================================================
-- Hospitality Stage 5a — עיצוב האתר: מסמך האתר (טיוטה + גרסאות מפורסמות) וערכות עיצוב
--
--   • site_versions — לכל עסק טיוטה אחת (נשמרת אוטומטית, עם revision) וגרסאות מפורסמות
--     שלא משתנות (1, 2, 3…). המסמך (JSON): ערכת העיצוב, צבעים, סדר המקטעים, מקטעים מוסתרים
--     ותוכן המקטעים. נתוני העסק (יחידות, מחירים, זמינות) לא מועתקים למסמך — המקטעים מפנים אליהם;
--   • site_editor() / site_draft_save / site_publish / site_restore — לצוות עם הרשאת settings
--     (בעלים ומנהלים), אזור הניהול פעיל; פרסום ושחזור — ביומן הפעולות;
--   • site_preview() — לצוות: נתוני האתר + הטיוטה, גם כשהאתר עוד סגור לגולשים (תצוגה מקדימה);
--   • public_site() — מחזיר גם את הגרסה המפורסמת האחרונה ('design'); הנתונים עצמם —
--     _site_payload (אותה קריאה לאתר ולתצוגה המקדימה).
-- המסמך נבדק גם בשרת האפליקציה וגם בזמן ההצגה (normalizeDesign) — כאן רק גבולות בסיסיים.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS hospitality.site_versions (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('draft', 'published')),
  -- טיוטה: 0; גרסה מפורסמת: 1, 2, 3…
  version     integer NOT NULL CHECK (version >= 0),
  theme       text NOT NULL CHECK (theme ~ '^[a-z][a-z0-9_-]{1,30}$'),
  document    jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND pg_column_size(document) <= 262144),
  -- טיוטה: נעילה אופטימית לשמירה האוטומטית; גרסה מפורסמת: 1
  revision    integer NOT NULL DEFAULT 1,
  -- טיוטה: מאיזו גרסה מפורסמת התחילה (null — לפני הפרסום הראשון)
  based_on    integer,
  note        text CHECK (note IS NULL OR char_length(note) <= 120),
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, kind, version),
  CHECK ((kind = 'draft') = (version = 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS site_versions_one_draft ON hospitality.site_versions (tenant_id) WHERE kind = 'draft';
COMMENT ON TABLE hospitality.site_versions IS
  'Hospitality: מסמך האתר — טיוטה אחת וגרסאות מפורסמות (לא משתנות); רק דרך פונקציות';
ALTER TABLE hospitality.site_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hospitality.site_versions FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS tenant_isolation ON hospitality.site_versions;
CREATE POLICY tenant_isolation ON hospitality.site_versions AS RESTRICTIVE
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS backend_enabled ON hospitality.site_versions;
CREATE POLICY backend_enabled ON hospitality.site_versions AS RESTRICTIVE
  USING ((SELECT hospitality.flag('hospitality_backend_enabled')))
  WITH CHECK ((SELECT hospitality.flag('hospitality_backend_enabled')));
DROP TRIGGER IF EXISTS tenant_guard ON hospitality.site_versions;
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE OF tenant_id ON hospitality.site_versions
  FOR EACH ROW EXECUTE FUNCTION hospitality.tenant_guard();

-- גרסה מפורסמת לא משתנה (השחזור מעתיק אותה לטיוטה)
CREATE OR REPLACE FUNCTION hospitality.site_versions_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.kind = 'published' THEN
    RAISE EXCEPTION 'גרסה מפורסמת לא משתנה' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'טיוטה לא הופכת לגרסה — מפרסמים' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
-- פונקציית טריגר — לא נקראת מה-API
REVOKE ALL ON FUNCTION hospitality.site_versions_immutable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS site_versions_immutable ON hospitality.site_versions;
CREATE TRIGGER site_versions_immutable BEFORE UPDATE ON hospitality.site_versions
  FOR EACH ROW EXECUTE FUNCTION hospitality.site_versions_immutable();

-- ------------------------------------------------------------
-- נתוני האתר (משותף לאתר הציבורי ולתצוגה המקדימה)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._site_payload(_t uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s hospitality.settings;
  _name text;
BEGIN
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  SELECT COALESCE(NULLIF(btrim(s.business_name), ''), t.name) INTO _name FROM public.tenants t WHERE t.id = _t;
  RETURN jsonb_build_object(
    'business', jsonb_build_object(
      'name', _name, 'phone', s.contact_phone, 'whatsapp', s.whatsapp_phone, 'email', s.contact_email,
      'address', s.address, 'check_in_time', to_char(s.check_in_time, 'HH24:MI'),
      'check_out_time', to_char(s.check_out_time, 'HH24:MI'), 'currency', s.currency, 'timezone', s.timezone,
      'booking_mode', s.booking_mode, 'approval_hours', round(COALESCE(s.approval_window_minutes, 720) / 60.0)),
    'today', (now() AT TIME ZONE COALESCE(s.timezone, 'Asia/Jerusalem'))::date,
    -- אפשר לשלוח בקשה מהאתר: דגל ההזמנות + מנוי פעיל
    'booking_open', hospitality.flag_for('hospitality_booking_enabled', _t)
                    AND COALESCE((hospitality.entitlements(_t) ->> 'active')::boolean, false),
    'gallery', hospitality._public_media(_t, 'site', NULL, NULL),
    'policy', hospitality._public_policy(_t, NULL),
    'properties', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'slug', p.slug, 'name', p.name, 'property_type', p.property_type,
               'description', p.description, 'address', p.address,
               'location', CASE WHEN p.latitude IS NULL THEN NULL
                                ELSE jsonb_build_object('lat', p.latitude, 'lng', p.longitude) END,
               'parking', p.parking, 'parking_type', p.parking_type, 'parking_spaces', p.parking_spaces,
               'parking_fee_note', p.parking_fee_note, 'parking_instructions', p.parking_instructions,
               'guest_info', p.guest_info,
               'rules', jsonb_build_object('smoking', p.rules_smoking, 'pets', p.rules_pets,
                                           'pets_note', p.rules_pets_note, 'events', p.rules_events,
                                           'quiet_from', to_char(p.quiet_from, 'HH24:MI'),
                                           'quiet_to', to_char(p.quiet_to, 'HH24:MI'), 'custom', p.rules_custom),
               'amenities', hospitality._public_amenities(_t, p.id, NULL),
               'media', hospitality._public_media(_t, 'property', p.id, NULL)) ORDER BY p.sort_order, p.created_at)
        FROM hospitality.properties p
       WHERE p.tenant_id = _t AND p.status = 'active'
         AND EXISTS (SELECT 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.property_id = p.id AND u.is_active)), '[]'::jsonb),
    'units', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', u.id, 'slug', u.slug, 'name', u.name, 'property_id', u.property_id,
               'kind', u.kind, 'unit_type', u.unit_type, 'description', u.description,
               'capacity', u.capacity, 'base_occupancy', u.base_occupancy,
               'max_adults', u.max_adults, 'max_children', u.max_children, 'child_age_limit', u.child_age_limit,
               'seo_title', u.seo_title, 'seo_description', u.seo_description,
               'bedrooms', u.bedrooms, 'bathrooms', u.bathrooms, 'separate_toilets', u.separate_toilets,
               'base_price', u.base_price, 'min_nights', u.min_nights,
               'policy', CASE WHEN u.policy_id IS NULL THEN NULL ELSE hospitality._public_policy(_t, u.policy_id) END,
               'member_ids', (SELECT jsonb_agg(m.member_unit_id) FROM hospitality.unit_members m
                               WHERE m.tenant_id = _t AND m.parent_unit_id = u.id),
               'beds', COALESCE((SELECT jsonb_agg(jsonb_build_object('bed_type', b.bed_type, 'quantity', b.quantity,
                                                                     'room_label', b.room_label) ORDER BY b.sort_order)
                                   FROM hospitality.unit_beds b WHERE b.tenant_id = _t AND b.unit_id = u.id), '[]'::jsonb),
               'amenities', hospitality._public_amenities(_t, NULL, u.id),
               'media', hospitality._public_media(_t, 'unit', u.property_id, u.id)) ORDER BY p.sort_order, u.sort_order, u.created_at)
        FROM hospitality.units u
        JOIN hospitality.properties p ON p.tenant_id = u.tenant_id AND p.id = u.property_id
       WHERE u.tenant_id = _t AND u.is_active AND p.status = 'active'), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality._site_payload(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._site_design(_t uuid, _draft boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('kind', v.kind, 'version', v.version, 'revision', v.revision, 'theme', v.theme,
                            'document', v.document, 'updated_at', hospitality._ts(v.updated_at))
    FROM hospitality.site_versions v
   WHERE v.tenant_id = _t AND (v.kind = 'published' OR (_draft AND v.kind = 'draft'))
   ORDER BY (v.kind = 'draft') DESC, v.version DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION hospitality._site_design(uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.public_site()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_site_tenant();
BEGIN
  RETURN hospitality._site_payload(_t) || jsonb_build_object('design', hospitality._site_design(_t, false));
END $$;

-- תצוגה מקדימה לצוות: הנתונים + הטיוטה (או הגרסה המפורסמת), גם כשהאתר סגור לגולשים
CREATE OR REPLACE FUNCTION hospitality.site_preview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
BEGIN
  RETURN hospitality._site_payload(_t) || jsonb_build_object('design', hospitality._site_design(_t, true));
END $$;
REVOKE ALL ON FUNCTION hospitality.site_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.site_preview() TO authenticated, service_role;

-- ------------------------------------------------------------
-- העורך
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.site_editor()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  d hospitality.site_versions;
  p hospitality.site_versions;
BEGIN
  SELECT * INTO d FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'draft';
  SELECT * INTO p FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'published'
   ORDER BY x.version DESC LIMIT 1;
  RETURN jsonb_build_object(
    'draft', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
               'revision', d.revision, 'theme', d.theme, 'document', d.document, 'based_on', d.based_on,
               'updated_at', hospitality._ts(d.updated_at)) END,
    'published', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
               'version', p.version, 'theme', p.theme, 'document', p.document,
               'published_at', hospitality._ts(p.created_at)) END,
    -- שינויים שעוד לא פורסמו: יש טיוטה, והיא שונה מהגרסה האחרונה
    'unpublished', d.id IS NOT NULL AND (p.id IS NULL OR d.document IS DISTINCT FROM p.document OR d.theme <> p.theme),
    'site_open', hospitality.flag_for('hospitality_frontend_enabled', _t),
    'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object('version', v.version, 'theme', v.theme,
                            'note', v.note, 'published_at', hospitality._ts(v.created_at)) ORDER BY v.version DESC)
                            FROM (SELECT * FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'published'
                                   ORDER BY x.version DESC LIMIT 30) v), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.site_editor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.site_editor() TO authenticated, service_role;

-- שמירת הטיוטה (אוטומטית). _revision = הגרסה שהעורך מכיר (0 — עוד אין טיוטה)
CREATE OR REPLACE FUNCTION hospitality.site_draft_save(_revision integer, _theme text, _document jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  d hospitality.site_versions;
BEGIN
  IF _document IS NULL OR jsonb_typeof(_document) <> 'object' THEN
    RAISE EXCEPTION 'מסמך האתר לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF pg_column_size(_document) > 262144 THEN
    RAISE EXCEPTION 'מסמך האתר גדול מדי' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO d FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'draft' FOR UPDATE;
  IF d.id IS NULL THEN
    IF COALESCE(_revision, 0) <> 0 THEN
      RAISE EXCEPTION 'העיצוב השתנה ממקום אחר — טענו את העורך מחדש' USING ERRCODE = 'serialization_failure';
    END IF;
    INSERT INTO hospitality.site_versions (tenant_id, kind, version, theme, document, revision, based_on, created_by)
    VALUES (_t, 'draft', 0, _theme, _document, 1,
            (SELECT max(x.version) FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'published'),
            auth.uid())
    RETURNING * INTO d;
  ELSE
    IF d.revision IS DISTINCT FROM _revision THEN
      RAISE EXCEPTION 'העיצוב השתנה ממקום אחר — טענו את העורך מחדש' USING ERRCODE = 'serialization_failure';
    END IF;
    UPDATE hospitality.site_versions x
       SET theme = _theme, document = _document, revision = x.revision + 1, updated_at = now()
     WHERE x.id = d.id
    RETURNING * INTO d;
  END IF;
  RETURN jsonb_build_object('revision', d.revision, 'updated_at', hospitality._ts(d.updated_at));
END $$;
REVOKE ALL ON FUNCTION hospitality.site_draft_save(integer, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.site_draft_save(integer, text, jsonb) TO authenticated, service_role;

-- פרסום: הטיוטה (בגרסה שהעורך מכיר) → גרסה מפורסמת חדשה
CREATE OR REPLACE FUNCTION hospitality.site_publish(_revision integer, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  d hospitality.site_versions;
  _v integer;
  _n text := NULLIF(btrim(COALESCE(_note, '')), '');
BEGIN
  IF _n IS NOT NULL AND char_length(_n) > 120 THEN
    RAISE EXCEPTION 'ההערה ארוכה מדי (עד 120 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO d FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'draft' FOR UPDATE;
  IF d.id IS NULL THEN
    RAISE EXCEPTION 'אין טיוטה לפרסום' USING ERRCODE = 'no_data_found';
  END IF;
  IF d.revision IS DISTINCT FROM _revision THEN
    RAISE EXCEPTION 'העיצוב השתנה ממקום אחר — טענו את העורך מחדש' USING ERRCODE = 'serialization_failure';
  END IF;
  -- גרסה אחת בכל פעם לכל עסק
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-site-publish:' || _t, 0));
  SELECT COALESCE(max(x.version), 0) + 1 INTO _v FROM hospitality.site_versions x
   WHERE x.tenant_id = _t AND x.kind = 'published';
  INSERT INTO hospitality.site_versions (tenant_id, kind, version, theme, document, revision, note, created_by)
  VALUES (_t, 'published', _v, d.theme, d.document, 1, _n, auth.uid());
  UPDATE hospitality.site_versions x SET based_on = _v WHERE x.id = d.id;
  PERFORM hospitality._audit(_t, 'site.published', 'גרסה ' || _v, jsonb_build_object('theme', d.theme));
  RETURN jsonb_build_object('version', _v);
END $$;
REVOKE ALL ON FUNCTION hospitality.site_publish(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.site_publish(integer, text) TO authenticated, service_role;

-- שחזור: גרסה מפורסמת → הטיוטה (מפרסמים אחר כך כרגיל)
CREATE OR REPLACE FUNCTION hospitality.site_restore(_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  p hospitality.site_versions;
  d hospitality.site_versions;
BEGIN
  SELECT * INTO p FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'published' AND x.version = _version;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'הגרסה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO d FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'draft' FOR UPDATE;
  IF d.id IS NULL THEN
    INSERT INTO hospitality.site_versions (tenant_id, kind, version, theme, document, revision, based_on, created_by)
    VALUES (_t, 'draft', 0, p.theme, p.document, 1, p.version, auth.uid())
    RETURNING * INTO d;
  ELSE
    UPDATE hospitality.site_versions x
       SET theme = p.theme, document = p.document, revision = x.revision + 1, based_on = p.version, updated_at = now()
     WHERE x.id = d.id
    RETURNING * INTO d;
  END IF;
  PERFORM hospitality._audit(_t, 'site.restored', 'גרסה ' || p.version, '{}'::jsonb);
  RETURN jsonb_build_object('revision', d.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.site_restore(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.site_restore(integer) TO authenticated, service_role;

COMMIT;

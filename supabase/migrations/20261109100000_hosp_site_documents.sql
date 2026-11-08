-- ============================================================
-- Hospitality — מסמכים ומדיניות האתר, הצהרת נגישות והסדרי נגישות במתחם (מיגרציה 60)
--
-- תשתית ראשונית — לא אישור משפטי ולא תעודת עמידה בתקן. כל מסמך מסומן בניהול כמסמך שדורש בדיקה של
-- עורך דין (ובהצהרת הנגישות — של מורשה נגישות), עד שבעל העסק מסמן שנבדק.
--
--   • site_documents — לכל אתר (עסק) בנפרד, שמונה מסמכים: תקנון שימוש באתר, תנאי הזמנה, מדיניות
--     ביטולים והחזרים, פרטיות, תשלומים והעברות בנקאיות, תנאי השכרה לאירועים, כללי המקום, הצהרת
--     נגישות. טיוטה (תבנית עם משתנים — נשמרת כפי שבעל העסק ערך) + הגרסה שמוצגת באתר;
--   • site_document_versions — כל פרסום = גרסה חדשה וקבועה: הטקסט המלא כפי שהוצג באתר (המשתנים כבר
--     ממולאים), hash, מתי ומי פרסם. גרסה שפורסמה לא משתנה (טריגר) — רק סימון "נבדק על ידי";
--   • booking_document_acceptances — בהזמנה באתר: אילו גרסאות האורח אישר, מתי ובאיזו הזמנה, וסוג
--     העסקה (הזמנה באתר = עסקת מכר מרחוק; אירוח / אירוע). נשמר באותה טרנזקציה של ההזמנה
--     (request_booking*_with_documents — יחידה, כמה חדרים, חבילה, סוג חדר), ואם מסמך עודכן בזמן שהאורח מילא את הבקשה — הבקשה נדחית
--     והאורח מאשר שוב את הגרסה העדכנית (כמו מדיניות הביטול, שכבר נשמרת עם ההזמנה);
--   • property_accessibility — הסדרי הנגישות הפיזיים בכל מתחם: רק מה שבעל המתחם מסר ואישר (אין
--     מילוי אוטומטי ואין ברירת מחדל "נגיש"); בלי אישור — אין רשומה;
--   • site_legal_profile — פרטים למסמכים שאין בהגדרות העסק: שם העוסק / החברה ומספר הזיהוי שלו,
--     איש קשר לפניות נגישות, ורכז נגישות — רק כשבעל העסק מסמן שהוא חייב במינוי;
--   • לאתר (anon): public_site_documents() — המסמכים שמוצגים (לפוטר ולטופס ההזמנה),
--     public_site_document(kind) — מסמך אחד;
--   • לצוות: site_documents_view / site_document_save / site_document_publish / site_document_unpublish
--     / site_document_review / site_legal_profile_save (settings); property_accessibility_save
--     (catalog); staff_booking_documents (bookings). כל שינוי נרשם ביומן הפעולות.
-- בלי שינוי בנתונים קיימים ובלי שינוי בפונקציות קיימות: טבלאות חדשות ריקות ופונקציות חדשות בלבד.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. הטבלאות
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.site_documents (
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('site_terms', 'booking_terms', 'cancellation', 'privacy',
                                                  'payments', 'event_terms', 'house_rules', 'accessibility')),
  draft_title       text NOT NULL CHECK (char_length(btrim(draft_title)) BETWEEN 2 AND 120),
  draft_body        text NOT NULL CHECK (char_length(draft_body) <= 60000),
  -- הגרסה שמוצגת באתר (NULL — המסמך לא מוצג)
  published_version integer CHECK (published_version IS NULL OR published_version > 0),
  revision          integer NOT NULL DEFAULT 1,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  PRIMARY KEY (tenant_id, kind)
);
COMMENT ON TABLE hospitality.site_documents IS
  'Hospitality (מיגרציה 60): מסמכי האתר — טיוטה לכל מסמך + הגרסה שמוצגת. לכל עסק בנפרד. רק דרך פונקציות';

CREATE TABLE IF NOT EXISTS hospitality.site_document_versions (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  version      integer NOT NULL CHECK (version BETWEEN 1 AND 100000),
  title        text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 120),
  body         text NOT NULL CHECK (char_length(body) BETWEEN 20 AND 60000),
  body_hash    text NOT NULL CHECK (body_hash ~ '^[0-9a-f]{64}$'),
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid,
  -- סימון של בעל העסק: הגרסה נבדקה על ידי עורך דין / מורשה נגישות (שם ותאריך — כפי שנמסרו)
  review_kind  text CHECK (review_kind IN ('lawyer', 'accessibility')),
  reviewed_by  text CHECK (reviewed_by IS NULL OR char_length(btrim(reviewed_by)) BETWEEN 2 AND 120),
  reviewed_on  date,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, kind, version),
  CHECK ((review_kind IS NULL) = (reviewed_by IS NULL) AND (reviewed_by IS NULL) = (reviewed_on IS NULL)),
  FOREIGN KEY (tenant_id, kind) REFERENCES hospitality.site_documents (tenant_id, kind) ON DELETE CASCADE
);
COMMENT ON TABLE hospitality.site_document_versions IS
  'Hospitality (מיגרציה 60): כל גרסה שפורסמה — הטקסט המלא כפי שהוצג באתר, קבוע (רק סימון הבדיקה משתנה)';

CREATE TABLE IF NOT EXISTS hospitality.booking_document_acceptances (
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  booking_id  uuid NOT NULL,
  kind        text NOT NULL,
  version_id  uuid NOT NULL,
  version     integer NOT NULL,
  body_hash   text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  -- הזמנה באתר = עסקת מכר מרחוק (חוק הגנת הצרכן, סעיף 14ג); השירות — אירוח או השכרה לאירוע
  sale_type   text NOT NULL DEFAULT 'distance' CHECK (sale_type IN ('distance')),
  service     text NOT NULL DEFAULT 'accommodation' CHECK (service IN ('accommodation', 'event')),
  PRIMARY KEY (booking_id, kind),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES hospitality.bookings (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, version_id) REFERENCES hospitality.site_document_versions (tenant_id, id)
);
COMMENT ON TABLE hospitality.booking_document_acceptances IS
  'Hospitality (מיגרציה 60): אילו גרסאות של מסמכי האתר האורח אישר בהזמנה, מתי, וסוג העסקה';
CREATE INDEX IF NOT EXISTS booking_document_acceptances_version_idx
  ON hospitality.booking_document_acceptances (tenant_id, version_id);

CREATE TABLE IF NOT EXISTS hospitality.property_accessibility (
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  property_id   uuid NOT NULL,
  -- { parking | entrance | step_free | unit | restroom | grab_bars | passages : { answer: yes|partial|no, details } }
  -- רק מה שבעל המתחם ענה; פריט שלא נענה — לא קיים (לא "לא")
  items         jsonb NOT NULL DEFAULT '{}'::jsonb
                CHECK (jsonb_typeof(items) = 'object' AND pg_column_size(items) <= 8192),
  additional    text CHECK (additional IS NULL OR char_length(additional) <= 2000),
  contact_name  text CHECK (contact_name IS NULL OR char_length(contact_name) <= 80),
  contact_phone text CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 30),
  contact_email text CHECK (contact_email IS NULL OR char_length(contact_email) <= 254),
  confirmed_at  timestamptz NOT NULL DEFAULT now(),
  confirmed_by  uuid,
  revision      integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, property_id),
  FOREIGN KEY (tenant_id, property_id) REFERENCES hospitality.properties (tenant_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE hospitality.property_accessibility IS
  'Hospitality (מיגרציה 60): הסדרי הנגישות הפיזיים במתחם — רק מה שבעל המתחם מסר ואישר';

CREATE TABLE IF NOT EXISTS hospitality.site_legal_profile (
  tenant_id            uuid NOT NULL PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  legal_name           text CHECK (legal_name IS NULL OR char_length(legal_name) <= 120),
  registration_id      text CHECK (registration_id IS NULL OR char_length(registration_id) <= 30),
  legal_address        text CHECK (legal_address IS NULL OR char_length(legal_address) <= 200),
  a11y_contact_name    text CHECK (a11y_contact_name IS NULL OR char_length(a11y_contact_name) <= 80),
  a11y_contact_phone   text CHECK (a11y_contact_phone IS NULL OR char_length(a11y_contact_phone) <= 30),
  a11y_contact_email   text CHECK (a11y_contact_email IS NULL OR char_length(a11y_contact_email) <= 254),
  -- רכז נגישות: חובה רק לעסק שמעסיק 25 עובדים או יותר (חוק השוויון, סעיף 19מב) — בעל העסק מסמן
  coordinator_required boolean NOT NULL DEFAULT false,
  coordinator_name     text CHECK (coordinator_name IS NULL OR char_length(coordinator_name) <= 80),
  coordinator_phone    text CHECK (coordinator_phone IS NULL OR char_length(coordinator_phone) <= 30),
  coordinator_email    text CHECK (coordinator_email IS NULL OR char_length(coordinator_email) <= 254),
  revision             integer NOT NULL DEFAULT 1,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE hospitality.site_legal_profile IS
  'Hospitality (מיגרציה 60): פרטים למסמכי האתר שאין בהגדרות העסק (עוסק, איש קשר לנגישות, רכז נגישות)';

-- סגורות לתפקידי ה-API: RLS מגביל (העסק הנוכחי + הדגל), שומר העסק, ורק דרך הפונקציות
DO $$
DECLARE _tbl text;
BEGIN
  FOREACH _tbl IN ARRAY ARRAY['site_documents', 'site_document_versions', 'booking_document_acceptances',
                              'property_accessibility', 'site_legal_profile'] LOOP
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

-- גרסה שפורסמה לא משתנה: רק סימון הבדיקה (עורך דין / מורשה נגישות)
CREATE OR REPLACE FUNCTION hospitality._document_version_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.body_hash IS DISTINCT FROM OLD.body_hash OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.published_by IS DISTINCT FROM OLD.published_by THEN
    RAISE EXCEPTION 'גרסה שפורסמה של מסמך לא משתנה — מפרסמים גרסה חדשה' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality._document_version_frozen() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS frozen ON hospitality.site_document_versions;
CREATE TRIGGER frozen BEFORE UPDATE ON hospitality.site_document_versions
  FOR EACH ROW EXECUTE FUNCTION hospitality._document_version_frozen();

-- ------------------------------------------------------------
-- 2. עזרים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._document_kind(_kind text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF _kind IS NULL OR _kind NOT IN ('site_terms', 'booking_terms', 'cancellation', 'privacy',
                                    'payments', 'event_terms', 'house_rules', 'accessibility') THEN
    RAISE EXCEPTION 'סוג המסמך לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  RETURN _kind;
END $$;
REVOKE ALL ON FUNCTION hospitality._document_kind(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._text_hash(_s text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(_s, 'UTF8')), 'hex');
$$;
REVOKE ALL ON FUNCTION hospitality._text_hash(text) FROM PUBLIC, anon, authenticated;

-- הקלט של שדה טקסט קצר: רווחים מסביב, ריק = NULL, אורך מרבי
CREATE OR REPLACE FUNCTION hospitality._short_text(_s text, _max integer, _label text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE _v text := NULLIF(btrim(COALESCE(_s, '')), '');
BEGIN
  IF _v IS NOT NULL AND char_length(_v) > _max THEN
    RAISE EXCEPTION '% — עד % תווים', _label, _max USING ERRCODE = 'check_violation';
  END IF;
  RETURN _v;
END $$;
REVOKE ALL ON FUNCTION hospitality._short_text(text, integer, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._email_or_null(_s text, _label text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE _v text := NULLIF(lower(btrim(COALESCE(_s, ''))), '');
BEGIN
  IF _v IS NOT NULL AND (char_length(_v) > 254 OR _v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION '% — כתובת אימייל לא תקינה', _label USING ERRCODE = 'check_violation';
  END IF;
  RETURN _v;
END $$;
REVOKE ALL ON FUNCTION hospitality._email_or_null(text, text) FROM PUBLIC, anon, authenticated;

-- הסדרי הנגישות: רק הפריטים המוכרים, תשובה yes / partial / no, פירוט קצר
CREATE OR REPLACE FUNCTION hospitality._accessibility_items(_items jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  _out jsonb := '{}'::jsonb;
  _k text;
  _v jsonb;
  _answer text;
  _details text;
BEGIN
  IF _items IS NULL THEN RETURN _out; END IF;
  IF jsonb_typeof(_items) <> 'object' THEN
    RAISE EXCEPTION 'הסדרי הנגישות — מבנה לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  FOR _k, _v IN SELECT * FROM jsonb_each(_items) LOOP
    IF _k NOT IN ('parking', 'entrance', 'step_free', 'unit', 'restroom', 'grab_bars', 'passages') THEN
      RAISE EXCEPTION 'פריט לא מוכר בהסדרי הנגישות' USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(_v) <> 'object' THEN
      RAISE EXCEPTION 'הסדרי הנגישות — מבנה לא תקין' USING ERRCODE = 'check_violation';
    END IF;
    _answer := _v ->> 'answer';
    IF _answer IS NULL THEN CONTINUE; END IF;  -- לא נענה — לא נשמר
    IF _answer NOT IN ('yes', 'partial', 'no') THEN
      RAISE EXCEPTION 'תשובה לא תקינה בהסדרי הנגישות' USING ERRCODE = 'check_violation';
    END IF;
    _details := NULLIF(btrim(COALESCE(_v ->> 'details', '')), '');
    IF _details IS NOT NULL AND char_length(_details) > 300 THEN
      RAISE EXCEPTION 'פירוט בהסדרי הנגישות — עד 300 תווים לפריט' USING ERRCODE = 'check_violation';
    END IF;
    _out := _out || jsonb_build_object(_k, jsonb_strip_nulls(jsonb_build_object('answer', _answer, 'details', _details)));
  END LOOP;
  RETURN _out;
END $$;
REVOKE ALL ON FUNCTION hospitality._accessibility_items(jsonb) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. לצוות — המסמכים (settings)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.site_documents_view()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
BEGIN
  RETURN jsonb_build_object(
    'business', (SELECT jsonb_build_object(
                          'name', COALESCE(NULLIF(btrim(s.business_name), ''), tn.name), 'phone', s.contact_phone,
                          'email', s.contact_email, 'whatsapp', s.whatsapp_phone, 'address', s.address,
                          'check_in_time', to_char(s.check_in_time, 'HH24:MI'),
                          'check_out_time', to_char(s.check_out_time, 'HH24:MI'), 'currency', s.currency,
                          'slug', tn.slug)
                   FROM hospitality.settings s JOIN public.tenants tn ON tn.id = s.tenant_id
                  WHERE s.tenant_id = _t),
    'profile', (SELECT to_jsonb(p) - 'tenant_id' - 'updated_at' FROM hospitality.site_legal_profile p WHERE p.tenant_id = _t),
    'payments', (SELECT jsonb_build_object('bank', ps.bank_enabled, 'bit', ps.bit_enabled, 'phone', ps.phone_enabled)
                   FROM hospitality.payment_settings ps WHERE ps.tenant_id = _t),
    'policy', (SELECT hospitality._public_policy(_t, x.id) FROM hospitality.policies x
                WHERE x.tenant_id = _t AND x.is_default AND NOT x.is_archived ORDER BY x.created_at LIMIT 1),
    'properties', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                     'id', pr.id, 'name', pr.name, 'address', pr.address,
                                     'rules', jsonb_build_object('smoking', pr.rules_smoking, 'pets', pr.rules_pets,
                                                                 'pets_note', pr.rules_pets_note, 'events', pr.rules_events,
                                                                 'quiet_from', to_char(pr.quiet_from, 'HH24:MI'),
                                                                 'quiet_to', to_char(pr.quiet_to, 'HH24:MI'),
                                                                 'custom', pr.rules_custom),
                                     'accessibility', (SELECT jsonb_build_object(
                                                         'items', a.items, 'additional', a.additional,
                                                         'contact_name', a.contact_name, 'contact_phone', a.contact_phone,
                                                         'contact_email', a.contact_email,
                                                         'confirmed_at', hospitality._ts(a.confirmed_at))
                                                         FROM hospitality.property_accessibility a
                                                        WHERE a.tenant_id = _t AND a.property_id = pr.id))
                                   ORDER BY pr.sort_order, pr.created_at)
                              FROM hospitality.properties pr WHERE pr.tenant_id = _t AND pr.status <> 'archived'),
                           '[]'::jsonb),
    'documents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                    'kind', d.kind, 'draft_title', d.draft_title, 'draft_body', d.draft_body,
                                    'revision', d.revision, 'updated_at', hospitality._ts(d.updated_at),
                                    'published_version', d.published_version) ORDER BY d.kind)
                             FROM hospitality.site_documents d WHERE d.tenant_id = _t), '[]'::jsonb),
    -- הגרסאות: הטקסט המלא רק של הגרסה האחרונה של כל מסמך (להשוואה ולתצוגה); השאר — רשימה
    'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                   'kind', v.kind, 'version', v.version, 'title', v.title,
                                   'body', CASE WHEN v.version = (SELECT max(w.version) FROM hospitality.site_document_versions w
                                                                    WHERE w.tenant_id = _t AND w.kind = v.kind)
                                                THEN v.body END,
                                   'body_hash', v.body_hash, 'published_at', hospitality._ts(v.published_at),
                                   'review_kind', v.review_kind, 'reviewed_by', v.reviewed_by, 'reviewed_on', v.reviewed_on,
                                   'acceptances', (SELECT count(*) FROM hospitality.booking_document_acceptances x
                                                    WHERE x.tenant_id = _t AND x.version_id = v.id))
                                 ORDER BY v.kind, v.version DESC)
                            FROM hospitality.site_document_versions v WHERE v.tenant_id = _t), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.site_documents_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.site_documents_view() TO authenticated, service_role;

-- שמירת טיוטה (התבנית כפי שנערכה, עם המשתנים). חדשה — בלי גרסה צפויה; קיימת — עם הגרסה שהמסך מכיר.
CREATE OR REPLACE FUNCTION hospitality.site_document_save(
  _kind text, _title text, _body text, _expected_revision integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  _k text := hospitality._document_kind(_kind);
  _ti text := btrim(COALESCE(_title, ''));
  d hospitality.site_documents;
BEGIN
  IF char_length(_ti) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'כותרת המסמך — בין 2 ל-120 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF _body IS NULL OR char_length(_body) > 60000 THEN
    RAISE EXCEPTION 'המסמך ארוך מדי (עד 60,000 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO d FROM hospitality.site_documents x WHERE x.tenant_id = _t AND x.kind = _k FOR UPDATE;
  IF d.kind IS NULL THEN
    INSERT INTO hospitality.site_documents (tenant_id, kind, draft_title, draft_body, updated_by)
    VALUES (_t, _k, _ti, _body, auth.uid()) RETURNING * INTO d;
  ELSE
    IF _expected_revision IS NOT NULL AND d.revision <> _expected_revision THEN
      RAISE EXCEPTION 'המסמך השתנה בינתיים — רעננו ונסו שוב' USING ERRCODE = 'serialization_failure';
    END IF;
    UPDATE hospitality.site_documents x
       SET draft_title = _ti, draft_body = _body, revision = x.revision + 1, updated_at = now(), updated_by = auth.uid()
     WHERE x.tenant_id = _t AND x.kind = _k RETURNING * INTO d;
  END IF;
  PERFORM hospitality._audit(_t, 'documents.saved', d.draft_title, jsonb_build_object('kind', d.kind));
  RETURN jsonb_build_object('kind', d.kind, 'revision', d.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.site_document_save(text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.site_document_save(text, text, text, integer) TO authenticated, service_role;

-- פרסום: הטקסט המלא (המשתנים ממולאים — שרת האתר ממלא אותם מהטיוטה) נשמר כגרסה חדשה וקבועה, והיא
-- שמוצגת באתר. רק טיוטה שמורה (באותה גרסה), ובלי פרטים שעוד לא הושלמו.
CREATE OR REPLACE FUNCTION hospitality.site_document_publish(
  _kind text, _title text, _body text, _expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  _k text := hospitality._document_kind(_kind);
  _ti text := btrim(COALESCE(_title, ''));
  _b text := btrim(COALESCE(_body, ''));
  d hospitality.site_documents;
  v hospitality.site_document_versions;
BEGIN
  SELECT * INTO d FROM hospitality.site_documents x WHERE x.tenant_id = _t AND x.kind = _k FOR UPDATE;
  IF d.kind IS NULL THEN
    RAISE EXCEPTION 'שמרו את המסמך לפני הפרסום' USING ERRCODE = 'no_data_found';
  END IF;
  IF _expected_revision IS NULL OR d.revision <> _expected_revision THEN
    RAISE EXCEPTION 'המסמך השתנה בינתיים — רעננו ונסו שוב' USING ERRCODE = 'serialization_failure';
  END IF;
  IF char_length(_ti) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'כותרת המסמך — בין 2 ל-120 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(_b) NOT BETWEEN 20 AND 60000 THEN
    RAISE EXCEPTION 'המסמך קצר מדי או ארוך מדי לפרסום' USING ERRCODE = 'check_violation';
  END IF;
  -- משתנה שלא מולא ({{...}}) או פרט להשלמה ([[...]]) — לא מתפרסם
  IF _b ~ '\{\{|\}\}|\[\[|\]\]' THEN
    RAISE EXCEPTION 'במסמך יש פרטים שעוד לא הושלמו — השלימו אותם לפני הפרסום' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO hospitality.site_document_versions (tenant_id, kind, version, title, body, body_hash, published_by)
  VALUES (_t, _k, COALESCE((SELECT max(x.version) FROM hospitality.site_document_versions x
                             WHERE x.tenant_id = _t AND x.kind = _k), 0) + 1,
          _ti, _b, hospitality._text_hash(_b), auth.uid())
  RETURNING * INTO v;
  UPDATE hospitality.site_documents x SET published_version = v.version WHERE x.tenant_id = _t AND x.kind = _k;
  PERFORM hospitality._audit(_t, 'documents.published', v.title, jsonb_build_object('kind', v.kind, 'version', v.version));
  RETURN jsonb_build_object('kind', v.kind, 'version', v.version, 'published_at', hospitality._ts(v.published_at),
                            'body_hash', v.body_hash);
END $$;
REVOKE ALL ON FUNCTION hospitality.site_document_publish(text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.site_document_publish(text, text, text, integer) TO authenticated, service_role;

-- הסרה מהאתר (הגרסאות והאישורים של אורחים נשמרים)
CREATE OR REPLACE FUNCTION hospitality.site_document_unpublish(_kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  _k text := hospitality._document_kind(_kind);
  d hospitality.site_documents;
BEGIN
  UPDATE hospitality.site_documents x SET published_version = NULL, updated_at = now(), updated_by = auth.uid()
   WHERE x.tenant_id = _t AND x.kind = _k AND x.published_version IS NOT NULL RETURNING * INTO d;
  IF d.kind IS NULL THEN
    RAISE EXCEPTION 'המסמך לא מוצג באתר' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM hospitality._audit(_t, 'documents.unpublished', d.draft_title, jsonb_build_object('kind', d.kind));
  RETURN jsonb_build_object('kind', d.kind);
END $$;
REVOKE ALL ON FUNCTION hospitality.site_document_unpublish(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.site_document_unpublish(text) TO authenticated, service_role;

-- סימון שהגרסה נבדקה (עורך דין / מורשה נגישות) — שם ותאריך כפי שבעל העסק מסר; NULL — ביטול הסימון
CREATE OR REPLACE FUNCTION hospitality.site_document_review(
  _kind text, _version integer, _review_kind text, _reviewed_by text DEFAULT NULL, _reviewed_on date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  _k text := hospitality._document_kind(_kind);
  _by text := NULLIF(btrim(COALESCE(_reviewed_by, '')), '');
  v hospitality.site_document_versions;
BEGIN
  IF _review_kind IS NOT NULL AND _review_kind NOT IN ('lawyer', 'accessibility') THEN
    RAISE EXCEPTION 'סוג הבדיקה לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _review_kind IS NOT NULL AND (_by IS NULL OR char_length(_by) NOT BETWEEN 2 AND 120 OR _reviewed_on IS NULL
                                   OR _reviewed_on > current_date) THEN
    RAISE EXCEPTION 'מי בדק ומתי — שם ותאריך (לא בעתיד)' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.site_document_versions x
     SET review_kind = _review_kind,
         reviewed_by = CASE WHEN _review_kind IS NULL THEN NULL ELSE _by END,
         reviewed_on = CASE WHEN _review_kind IS NULL THEN NULL ELSE _reviewed_on END
   WHERE x.tenant_id = _t AND x.kind = _k AND x.version = _version RETURNING * INTO v;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'הגרסה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM hospitality._audit(_t, CASE WHEN _review_kind IS NULL THEN 'documents.review_cleared' ELSE 'documents.reviewed' END,
                             v.title, jsonb_strip_nulls(jsonb_build_object('kind', v.kind, 'version', v.version,
                                                                           'review', _review_kind)));
  RETURN jsonb_build_object('kind', v.kind, 'version', v.version, 'review_kind', v.review_kind);
END $$;
REVOKE ALL ON FUNCTION hospitality.site_document_review(text, integer, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.site_document_review(text, integer, text, text, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.site_legal_profile_save(_profile jsonb, _expected_revision integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  p hospitality.site_legal_profile;
  _req boolean;
BEGIN
  IF _profile IS NULL OR jsonb_typeof(_profile) <> 'object' THEN
    RAISE EXCEPTION 'פרטי העסק למסמכים — מבנה לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  _req := COALESCE((_profile ->> 'coordinator_required')::boolean, false);
  SELECT * INTO p FROM hospitality.site_legal_profile x WHERE x.tenant_id = _t FOR UPDATE;
  IF p.tenant_id IS NOT NULL AND _expected_revision IS NOT NULL AND p.revision <> _expected_revision THEN
    RAISE EXCEPTION 'הפרטים השתנו בינתיים — רעננו ונסו שוב' USING ERRCODE = 'serialization_failure';
  END IF;
  INSERT INTO hospitality.site_legal_profile AS x (
    tenant_id, legal_name, registration_id, legal_address, a11y_contact_name, a11y_contact_phone, a11y_contact_email,
    coordinator_required, coordinator_name, coordinator_phone, coordinator_email)
  VALUES (_t,
          hospitality._short_text(_profile ->> 'legal_name', 120, 'שם העוסק / החברה'),
          hospitality._short_text(_profile ->> 'registration_id', 30, 'מספר עוסק / ח.פ'),
          hospitality._short_text(_profile ->> 'legal_address', 200, 'כתובת העוסק'),
          hospitality._short_text(_profile ->> 'a11y_contact_name', 80, 'איש הקשר לנגישות'),
          hospitality._short_text(_profile ->> 'a11y_contact_phone', 30, 'הטלפון לפניות נגישות'),
          hospitality._email_or_null(_profile ->> 'a11y_contact_email', 'האימייל לפניות נגישות'),
          _req,
          CASE WHEN _req THEN hospitality._short_text(_profile ->> 'coordinator_name', 80, 'שם רכז הנגישות') END,
          CASE WHEN _req THEN hospitality._short_text(_profile ->> 'coordinator_phone', 30, 'הטלפון של רכז הנגישות') END,
          CASE WHEN _req THEN hospitality._email_or_null(_profile ->> 'coordinator_email', 'האימייל של רכז הנגישות') END)
  ON CONFLICT (tenant_id) DO UPDATE
     SET legal_name = EXCLUDED.legal_name, registration_id = EXCLUDED.registration_id,
         legal_address = EXCLUDED.legal_address, a11y_contact_name = EXCLUDED.a11y_contact_name,
         a11y_contact_phone = EXCLUDED.a11y_contact_phone, a11y_contact_email = EXCLUDED.a11y_contact_email,
         coordinator_required = EXCLUDED.coordinator_required, coordinator_name = EXCLUDED.coordinator_name,
         coordinator_phone = EXCLUDED.coordinator_phone, coordinator_email = EXCLUDED.coordinator_email,
         revision = x.revision + 1, updated_at = now()
  RETURNING * INTO p;
  PERFORM hospitality._audit(_t, 'documents.profile_saved', COALESCE(p.legal_name, ''), '{}'::jsonb);
  RETURN jsonb_build_object('revision', p.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.site_legal_profile_save(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.site_legal_profile_save(jsonb, integer) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. הסדרי הנגישות במתחם (catalog) — רק מה שבעל המתחם מסר, ורק עם אישור שלו
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.property_accessibility_save(
  _property_id uuid, _items jsonb, _confirmed boolean, _additional text DEFAULT NULL,
  _contact_name text DEFAULT NULL, _contact_phone text DEFAULT NULL, _contact_email text DEFAULT NULL,
  _expected_revision integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
  _it jsonb := hospitality._accessibility_items(_items);
  pr hospitality.properties;
  a hospitality.property_accessibility;
BEGIN
  IF _confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'יש לאשר שהמידע נמסר על ידי המתחם ושהוא נכון' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO pr FROM hospitality.properties x WHERE x.tenant_id = _t AND x.id = _property_id;
  IF pr.id IS NULL THEN
    RAISE EXCEPTION 'המתחם לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO a FROM hospitality.property_accessibility x WHERE x.tenant_id = _t AND x.property_id = pr.id FOR UPDATE;
  IF a.property_id IS NOT NULL AND _expected_revision IS NOT NULL AND a.revision <> _expected_revision THEN
    RAISE EXCEPTION 'הפרטים השתנו בינתיים — רעננו ונסו שוב' USING ERRCODE = 'serialization_failure';
  END IF;
  INSERT INTO hospitality.property_accessibility AS x (
    tenant_id, property_id, items, additional, contact_name, contact_phone, contact_email, confirmed_by)
  VALUES (_t, pr.id, _it,
          hospitality._short_text(_additional, 2000, 'התאמות נוספות'),
          hospitality._short_text(_contact_name, 80, 'איש הקשר'),
          hospitality._short_text(_contact_phone, 30, 'הטלפון'),
          hospitality._email_or_null(_contact_email, 'האימייל'),
          auth.uid())
  ON CONFLICT (tenant_id, property_id) DO UPDATE
     SET items = EXCLUDED.items, additional = EXCLUDED.additional, contact_name = EXCLUDED.contact_name,
         contact_phone = EXCLUDED.contact_phone, contact_email = EXCLUDED.contact_email,
         confirmed_at = now(), confirmed_by = auth.uid(), revision = x.revision + 1
  RETURNING * INTO a;
  PERFORM hospitality._audit(_t, 'accessibility.confirmed', pr.name,
                             jsonb_build_object('answered', (SELECT count(*) FROM jsonb_object_keys(a.items))));
  RETURN jsonb_build_object('property_id', a.property_id, 'revision', a.revision,
                            'confirmed_at', hospitality._ts(a.confirmed_at), 'items', a.items);
END $$;
REVOKE ALL ON FUNCTION hospitality.property_accessibility_save(uuid, jsonb, boolean, text, text, text, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.property_accessibility_save(uuid, jsonb, boolean, text, text, text, text, integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.property_accessibility_view(_property_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hospitality.properties x WHERE x.tenant_id = _t AND x.id = _property_id) THEN
    RAISE EXCEPTION 'המתחם לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN (SELECT jsonb_build_object('items', a.items, 'additional', a.additional, 'contact_name', a.contact_name,
                                    'contact_phone', a.contact_phone, 'contact_email', a.contact_email,
                                    'confirmed_at', hospitality._ts(a.confirmed_at), 'revision', a.revision)
            FROM hospitality.property_accessibility a WHERE a.tenant_id = _t AND a.property_id = _property_id);
END $$;
REVOKE ALL ON FUNCTION hospitality.property_accessibility_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.property_accessibility_view(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. לאתר — המסמכים שמוצגים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.public_site_documents()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_site_tenant();
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', v.kind, 'title', v.title, 'version', v.version,
                                                        'published_at', hospitality._ts(v.published_at))
                                    ORDER BY v.kind)
                     FROM hospitality.site_documents d
                     JOIN hospitality.site_document_versions v
                       ON v.tenant_id = d.tenant_id AND v.kind = d.kind AND v.version = d.published_version
                    WHERE d.tenant_id = _t), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION hospitality.public_site_documents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.public_site_documents() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.public_site_document(_kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_site_tenant();
BEGIN
  RETURN (SELECT jsonb_build_object('kind', v.kind, 'title', v.title, 'version', v.version, 'body', v.body,
                                    'published_at', hospitality._ts(v.published_at))
            FROM hospitality.site_documents d
            JOIN hospitality.site_document_versions v
              ON v.tenant_id = d.tenant_id AND v.kind = d.kind AND v.version = d.published_version
           WHERE d.tenant_id = _t AND d.kind = _kind);
END $$;
REVOKE ALL ON FUNCTION hospitality.public_site_document(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.public_site_document(text) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 6. ההזמנה באתר — אישור המסמכים באותה טרנזקציה של ההזמנה
-- ------------------------------------------------------------
-- המסמכים שהאורח צריך לאשר בהזמנה (מה שמוצג מהם באתר) — בדיוק בגרסה שמוצגת עכשיו.
-- _documents: [{kind, version}] — מה שהטופס הציג. חסר / גרסה ישנה → הבקשה נדחית (לרענן ולאשר שוב).
CREATE OR REPLACE FUNCTION hospitality._documents_for_booking(_t uuid, _documents jsonb, _service text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _kinds text[] := CASE WHEN _service = 'event'
                        THEN ARRAY['event_terms', 'cancellation', 'payments', 'house_rules', 'site_terms', 'privacy']
                        ELSE ARRAY['booking_terms', 'cancellation', 'payments', 'house_rules', 'site_terms', 'privacy'] END;
  _out jsonb := '[]'::jsonb;
  r record;
  _shown integer;
BEGIN
  IF _documents IS NOT NULL AND jsonb_typeof(_documents) <> 'array' THEN
    RAISE EXCEPTION 'רשימת המסמכים לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  FOR r IN SELECT v.id, v.kind, v.version, v.body_hash
             FROM hospitality.site_documents d
             JOIN hospitality.site_document_versions v
               ON v.tenant_id = d.tenant_id AND v.kind = d.kind AND v.version = d.published_version
            WHERE d.tenant_id = _t AND d.kind = ANY (_kinds) LOOP
    SELECT (e ->> 'version')::integer INTO _shown
      FROM jsonb_array_elements(COALESCE(_documents, '[]'::jsonb)) e
     WHERE e ->> 'kind' = r.kind AND (e ->> 'version') ~ '^[0-9]{1,6}$'
     LIMIT 1;
    IF _shown IS DISTINCT FROM r.version THEN
      RAISE EXCEPTION 'מסמכי האתר עודכנו בזמן שמילאתם את הבקשה — רעננו את העמוד ואשרו שוב'
        USING ERRCODE = 'check_violation';
    END IF;
    _out := _out || jsonb_build_array(jsonb_build_object('kind', r.kind, 'version_id', r.id, 'version', r.version,
                                                         'body_hash', r.body_hash));
  END LOOP;
  RETURN _out;
END $$;
REVOKE ALL ON FUNCTION hospitality._documents_for_booking(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._documents_accept(_t uuid, _bookings uuid[], _docs jsonb, _service text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _b uuid;
  _n integer;
BEGIN
  IF _docs IS NULL OR jsonb_array_length(_docs) = 0 THEN RETURN; END IF;
  FOREACH _b IN ARRAY COALESCE(_bookings, '{}'::uuid[]) LOOP
    INSERT INTO hospitality.booking_document_acceptances (tenant_id, booking_id, kind, version_id, version, body_hash,
                                                          sale_type, service)
    SELECT _t, _b, e ->> 'kind', (e ->> 'version_id')::uuid, (e ->> 'version')::integer, e ->> 'body_hash',
           'distance', _service
      FROM jsonb_array_elements(_docs) e
    ON CONFLICT (booking_id, kind) DO NOTHING;
    GET DIAGNOSTICS _n = ROW_COUNT;
    -- בבקשה חוזרת (אותו מפתח) — כבר נרשם; אחרת: שורה ביומן ההזמנה
    IF _n > 0 THEN
      INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes)
      VALUES (_t, _b, 'documents_accepted', 'guest', auth.uid(),
              jsonb_build_object('documents', (SELECT jsonb_agg(jsonb_build_object('kind', e ->> 'kind',
                                                                                    'version', (e ->> 'version')::integer))
                                                 FROM jsonb_array_elements(_docs) e),
                                 'sale_type', 'distance', 'service', _service));
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION hospitality._documents_accept(uuid, uuid[], jsonb, text) FROM PUBLIC, anon, authenticated;

-- העטיפות: אותם פרמטרים כמו הבקשות הקיימות + _documents. הבקשה עצמה — הפונקציה הקיימת, בלי שינוי.
CREATE OR REPLACE FUNCTION hospitality.request_booking_with_documents(
  _documents jsonb, _unit_id uuid, _check_in date, _check_out date, _full_name text, _email text, _phone text,
  _idempotency_key text, _policy_accepted boolean, _policy_hash text, _adults integer DEFAULT 2,
  _children integer DEFAULT 0, _special_requests text DEFAULT NULL, _promo_code text DEFAULT NULL,
  _marketing_consent boolean DEFAULT false, _language text DEFAULT 'he')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(true);
  _docs jsonb := hospitality._documents_for_booking(_t, _documents, 'accommodation');
  _r jsonb;
BEGIN
  _r := hospitality.request_booking(_unit_id, _check_in, _check_out, _full_name, _email, _phone, _idempotency_key,
                                    _policy_accepted, _policy_hash, _adults, _children, _special_requests, _promo_code,
                                    _marketing_consent, _language);
  PERFORM hospitality._documents_accept(_t, ARRAY[(_r ->> 'booking_id')::uuid], _docs, 'accommodation');
  RETURN _r;
END $$;
REVOKE ALL ON FUNCTION hospitality.request_booking_with_documents(jsonb, uuid, date, date, text, text, text, text, boolean,
                                                                  text, integer, integer, text, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.request_booking_with_documents(jsonb, uuid, date, date, text, text, text, text,
                                                                     boolean, text, integer, integer, text, text, boolean,
                                                                     text) TO service_role;

CREATE OR REPLACE FUNCTION hospitality.request_booking_group_with_documents(
  _documents jsonb, _rooms jsonb, _check_in date, _check_out date, _full_name text, _email text, _phone text,
  _idempotency_key text, _policy_accepted boolean, _special_requests text DEFAULT NULL,
  _marketing_consent boolean DEFAULT false, _language text DEFAULT 'he')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(true);
  _docs jsonb := hospitality._documents_for_booking(_t, _documents, 'accommodation');
  _r jsonb;
BEGIN
  _r := hospitality.request_booking_group(_rooms, _check_in, _check_out, _full_name, _email, _phone, _idempotency_key,
                                          _policy_accepted, _special_requests, _marketing_consent, _language);
  PERFORM hospitality._documents_accept(
    _t, (SELECT array_agg(b.id ORDER BY b.created_at, b.id) FROM hospitality.bookings b
          WHERE b.tenant_id = _t AND b.group_id = (_r ->> 'group_id')::uuid), _docs, 'accommodation');
  RETURN _r;
END $$;
REVOKE ALL ON FUNCTION hospitality.request_booking_group_with_documents(jsonb, jsonb, date, date, text, text, text, text,
                                                                        boolean, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.request_booking_group_with_documents(jsonb, jsonb, date, date, text, text, text,
                                                                           text, boolean, text, boolean, text)
  TO service_role;

CREATE OR REPLACE FUNCTION hospitality.request_booking_package_with_documents(
  _documents jsonb, _package_id uuid, _check_in date, _full_name text, _email text, _phone text,
  _idempotency_key text, _policy_accepted boolean, _policy_hash text, _adults integer DEFAULT 2,
  _children integer DEFAULT 0, _special_requests text DEFAULT NULL, _marketing_consent boolean DEFAULT false,
  _language text DEFAULT 'he')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(true);
  _docs jsonb := hospitality._documents_for_booking(_t, _documents, 'accommodation');
  _r jsonb;
BEGIN
  _r := hospitality.request_booking_package(_package_id, _check_in, _full_name, _email, _phone, _idempotency_key,
                                            _policy_accepted, _policy_hash, _adults, _children, _special_requests,
                                            _marketing_consent, _language);
  PERFORM hospitality._documents_accept(_t, ARRAY[(_r ->> 'booking_id')::uuid], _docs, 'accommodation');
  RETURN _r;
END $$;
REVOKE ALL ON FUNCTION hospitality.request_booking_package_with_documents(jsonb, uuid, date, text, text, text, text,
                                                                          boolean, text, integer, integer, text, boolean,
                                                                          text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.request_booking_package_with_documents(jsonb, uuid, date, text, text, text, text,
                                                                             boolean, text, integer, integer, text,
                                                                             boolean, text) TO service_role;

-- סוג חדר (מלון): המסד בוחר חדר פנוי מהסוג — אותה הזמנה רגילה
CREATE OR REPLACE FUNCTION hospitality.request_booking_type_with_documents(
  _documents jsonb, _category_id uuid, _check_in date, _check_out date, _full_name text, _email text, _phone text,
  _idempotency_key text, _policy_accepted boolean, _policy_hash text, _adults integer DEFAULT 2,
  _children integer DEFAULT 0, _special_requests text DEFAULT NULL, _promo_code text DEFAULT NULL,
  _marketing_consent boolean DEFAULT false, _language text DEFAULT 'he', _preferred_unit uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(true);
  _docs jsonb := hospitality._documents_for_booking(_t, _documents, 'accommodation');
  _r jsonb;
BEGIN
  _r := hospitality.request_booking_type(_category_id, _check_in, _check_out, _full_name, _email, _phone,
                                         _idempotency_key, _policy_accepted, _policy_hash, _adults, _children,
                                         _special_requests, _promo_code, _marketing_consent, _language, _preferred_unit);
  PERFORM hospitality._documents_accept(_t, ARRAY[(_r ->> 'booking_id')::uuid], _docs, 'accommodation');
  RETURN _r;
END $$;
REVOKE ALL ON FUNCTION hospitality.request_booking_type_with_documents(jsonb, uuid, date, date, text, text, text, text,
                                                                       boolean, text, integer, integer, text, text,
                                                                       boolean, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.request_booking_type_with_documents(jsonb, uuid, date, date, text, text, text, text,
                                                                          boolean, text, integer, integer, text, text,
                                                                          boolean, text, uuid) TO service_role;

-- לצוות: אילו מסמכים האורח אישר בהזמנה (bookings)
CREATE OR REPLACE FUNCTION hospitality.staff_booking_documents(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.id = _booking_id) THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', x.kind, 'title', v.title, 'version', x.version,
                                                        'accepted_at', hospitality._ts(x.accepted_at),
                                                        'body_hash', x.body_hash, 'sale_type', x.sale_type,
                                                        'service', x.service)
                                    ORDER BY x.kind)
                     FROM hospitality.booking_document_acceptances x
                     JOIN hospitality.site_document_versions v ON v.tenant_id = x.tenant_id AND v.id = x.version_id
                    WHERE x.tenant_id = _t AND x.booking_id = _booking_id), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION hospitality.staff_booking_documents(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.staff_booking_documents(uuid) TO authenticated, service_role;

COMMIT;

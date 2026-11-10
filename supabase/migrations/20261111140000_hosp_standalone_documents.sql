-- ============================================================
-- Hospitality — מסמכים עצמאיים לחתימה (בהמשך לחוזים — 20261111120000_hosp_client_contracts, "מיגרציה 64")
--
-- עד עכשיו חוזה נשלח רק מתוך הזמנת לינה (חוזה אירוח) או אירוע (חוזה מתחם הבריכה). עכשיו גם בלי הזמנה:
--   • origin 'standalone' — מסמך שנוצר ב"מסמכי לקוחות" בלי הזמנה / אירוע: חוזה אירוח לטווח קצר, חוזה
--     אירוע, או מסמך מדיניות של העסק (kind 'policy' — אחד ממסמכי האתר שפורסמו: תקנון, מדיניות ביטול,
--     תנאי הזמנה, תשלומים, תנאי אירועים, כללי המקום, פרטיות — בגרסה שפורסמה, כלשונו, עם אישור הלקוח);
--   • שתי דרכים (fill_mode):
--       'business' (א') — בעל העסק בוחר לקוח קיים או כותב לקוח חדש (נוצר כרטיס לקוח), ממלא את פרטי
--                         המסמך, והשרת שולח קישור אישי במייל (כמו בחוזה של הזמנה);
--       'customer' (ב') — בעל העסק יוצר קישור (הפרטים העסקיים — שלו), ומעביר אותו ללקוח בעצמו (וואטסאפ /
--                         הודעה) או במייל; הלקוח ממלא רק את הפרטים שלו (שם, אימייל, טלפון — ובחוזה גם
--                         ת"ז וכתובת) וחותם באצבע / בעכבר. הקישור מוצג לצוות פעם אחת, ונשמרת רק הטביעה שלו;
--   • הכול נשאר כמו בחוזים: קישור חד-פעמי עם תפוגה (14 יום), לאתר של העסק בלבד; חתימה פעם אחת (נעילה);
--     הנוסח החתום עם SHA-256 וחותמת זמן; PDF פרטי; עותק במייל; שליחה חוזרת של עותק לא משנה את המסמך;
--     חוזה חתום לא משתנה ולא נמחק (הטריגר — עכשיו גם המקור והדרך);
--   • התראה לבעל העסק בכל חתימה (גם בחוזים של הזמנות ואירועים): מייל (תור המיילים, document_signed) וסימון
--     "לא נצפה" באזור הניהול (staff_seen_at) — עד שמישהו מהצוות פותח את "מסמכים חתומים";
--   • "מסמכים חתומים": חיפוש לפי לקוח / אימייל / טלפון / מספר / שם המסמך, סוג, מקור ותאריך החתימה;
--   • פרטיות: מחיקת פרטי לקוח מוחקת גם מסמכים עצמאיים שלא נחתמו (לפי הכרטיס או האימייל); הייצוא כולל
--     גם מסמכים עצמאיים לפי האימייל. חתומים — נשמרים כמו שנחתמו (ראיה).
-- לא משתנה: החוזים של הזמנות ואירועים (אותו נוסח, אותן בדיקות, אותו פלט — רק שדות נוספים בתשובות).
-- הפעלה: אותו דגל hospitality_contracts_enabled (כבוי עד אישור משפטי) — גם למסמכי המדיניות.
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261111140000_hosp_standalone_documents.down.sql
-- (מסרב כשיש מסמכים עצמאיים / מסמכי מדיניות — רשומות שאסור לאבד)
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. המבנה: סוג "מסמך מדיניות", מקור, דרך המילוי, "נצפה"
-- ------------------------------------------------------------
ALTER TABLE hospitality.client_contracts ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'linked';
ALTER TABLE hospitality.client_contracts ADD COLUMN IF NOT EXISTS fill_mode text NOT NULL DEFAULT 'business';
ALTER TABLE hospitality.client_contracts ADD COLUMN IF NOT EXISTS staff_seen_at timestamptz;
ALTER TABLE hospitality.client_contracts DROP CONSTRAINT IF EXISTS client_contracts_origin_check;
ALTER TABLE hospitality.client_contracts ADD CONSTRAINT client_contracts_origin_check
  CHECK (origin IN ('linked', 'standalone'));
ALTER TABLE hospitality.client_contracts DROP CONSTRAINT IF EXISTS client_contracts_fill_mode_check;
ALTER TABLE hospitality.client_contracts ADD CONSTRAINT client_contracts_fill_mode_check
  CHECK (fill_mode IN ('business', 'customer'));
ALTER TABLE hospitality.client_contracts DROP CONSTRAINT IF EXISTS client_contracts_kind_check;
ALTER TABLE hospitality.client_contracts ADD CONSTRAINT client_contracts_kind_check
  CHECK (kind IN ('hosting', 'pool_event', 'policy'));
-- הקישור: עצמאי — בלי הזמנה ובלי אירוע; מקושר — כמו קודם (לינה ↔ אירוח, אירוע ↔ מתחם הבריכה);
-- מסמך מדיניות — רק עצמאי
ALTER TABLE hospitality.client_contracts DROP CONSTRAINT IF EXISTS client_contracts_check;
ALTER TABLE hospitality.client_contracts DROP CONSTRAINT IF EXISTS client_contracts_link_check;
ALTER TABLE hospitality.client_contracts ADD CONSTRAINT client_contracts_link_check
  CHECK (CASE WHEN origin = 'standalone' THEN booking_id IS NULL AND event_id IS NULL
              WHEN kind = 'hosting' THEN booking_id IS NOT NULL AND event_id IS NULL
              WHEN kind = 'pool_event' THEN event_id IS NOT NULL AND booking_id IS NULL
              ELSE false END);
-- הלקוח ממלא (ב'): השם והאימייל יכולים להיות ריקים עד החתימה (הלקוח כותב אותם); בכל מקרה אחר — חובה.
-- "הלקוח ממלא" — רק במסמך עצמאי
ALTER TABLE hospitality.client_contracts ALTER COLUMN signer_name DROP NOT NULL;
ALTER TABLE hospitality.client_contracts ALTER COLUMN signer_email DROP NOT NULL;
ALTER TABLE hospitality.client_contracts DROP CONSTRAINT IF EXISTS client_contracts_fill_check;
ALTER TABLE hospitality.client_contracts ADD CONSTRAINT client_contracts_fill_check
  CHECK ((fill_mode = 'business' OR origin = 'standalone')
         AND ((signer_name IS NOT NULL AND signer_email IS NOT NULL) OR (fill_mode = 'customer' AND signed_at IS NULL)));
CREATE INDEX IF NOT EXISTS client_contracts_signed_idx ON hospitality.client_contracts (tenant_id, signed_at DESC)
  WHERE signed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_contracts_unseen_idx ON hospitality.client_contracts (tenant_id)
  WHERE signed_at IS NOT NULL AND staff_seen_at IS NULL;

ALTER TABLE hospitality.contract_templates DROP CONSTRAINT IF EXISTS contract_templates_key_check;
ALTER TABLE hospitality.contract_templates ADD CONSTRAINT contract_templates_key_check
  CHECK (key IN ('hosting', 'pool_event', 'policy'));

-- חוזה חתום לא משתנה — כמו במיגרציה 64, ועכשיו גם המקור ודרך המילוי
CREATE OR REPLACE FUNCTION hospitality.client_contracts_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.signed_at IS NOT NULL AND pg_catalog.pg_trigger_depth() = 1 THEN
      RAISE EXCEPTION 'חוזה חתום לא נמחק' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.signed_at IS NOT NULL THEN
    IF (NEW.kind, NEW.template_version, NEW.booking_id, NEW.event_id, NEW.signer_name, NEW.signer_email,
        NEW.signer_phone, NEW.data, NEW.customer_fields, NEW.signed_at, NEW.signed_body, NEW.signed_body_sha256,
        NEW.signature, NEW.signer_ip, NEW.signer_user_agent, NEW.number, NEW.supersedes_id, NEW.created_at,
        NEW.origin, NEW.fill_mode)
       IS DISTINCT FROM
       (OLD.kind, OLD.template_version, OLD.booking_id, OLD.event_id, OLD.signer_name, OLD.signer_email,
        OLD.signer_phone, OLD.data, OLD.customer_fields, OLD.signed_at, OLD.signed_body, OLD.signed_body_sha256,
        OLD.signature, OLD.signer_ip, OLD.signer_user_agent, OLD.number, OLD.supersedes_id, OLD.created_at,
        OLD.origin, OLD.fill_mode)
       OR (OLD.pdf_path IS NOT NULL AND (NEW.pdf_path, NEW.pdf_sha256, NEW.pdf_size)
                                        IS DISTINCT FROM (OLD.pdf_path, OLD.pdf_sha256, OLD.pdf_size))
       OR NOT (NEW.status = OLD.status OR (OLD.status = 'signed' AND NEW.status = 'superseded')) THEN
      RAISE EXCEPTION 'חוזה חתום לא משתנה — אפשר להפיק חוזה מתוקן לחתימה מחדש' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.client_contracts_guard() FROM PUBLIC, anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 2. התבנית של מסמך מדיניות: המסמך שפורסם באתר כלשונו, פרטי הלקוח, האישור והחתימה
-- ------------------------------------------------------------
-- {{document_lines}} בשורה משלה — הטקסט של הגרסה שפורסמה (מ-site_document_versions), כשורות נוסח
INSERT INTO hospitality.contract_templates (key, version, title, source, body) VALUES
('policy', 1, 'אישור מסמך מדיניות ותנאים', 'מסמכי האתר של העסק (מיגרציה 60) — אישור קריאה והסכמה בחתימה אלקטרונית', $tpl$# {{document_title}}
^ {{business_line}}

נחתם ביום: {{signing_date}}

**פרטי הלקוח/ה:**
- שם מלא: {{signer_name}}
- טלפון: {{signer_phone}}
- אימייל: {{signer_email}}

> להלן "{{document_title}}" של {{business_name}} — כלשונו, כפי שפורסם באתר העסק (גרסה {{document_version}} מיום {{document_published}}).

{{document_lines}}

## אישור הלקוח/ה
אני מאשר/ת שקראתי את "{{document_title}}" של {{business_name}} במלואו, הבנתי את תוכנו ואני מסכים/ה לתנאיו.

[[signatures]]$tpl$)
ON CONFLICT (key, version) DO NOTHING;

-- ------------------------------------------------------------
-- 3. עזרים
-- ------------------------------------------------------------
-- הטקסט של מסמך אתר (מיגרציה 60: "## " כותרת, "- " פריט, כל שורה אחרת — פסקה) → שורות בנוסח החוזה.
-- פסקה שהייתה נקראת כסימון של החוזה ("# ", "^ ", "> ", "**…**" …) מסומנת "\ " — תמיד פסקה, כלשונה.
-- {{ }} / [[ ]] לא שורדים (_contract_value), כך שהמסמך לא יכול "לפתוח" שדה או אזור חתימה
CREATE OR REPLACE FUNCTION hospitality._policy_lines(_body text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(string_agg(
           CASE WHEN x.l LIKE '## %' THEN '## ' || COALESCE(hospitality._contract_value(substr(x.l, 4)), '')
                WHEN x.l LIKE '- %' THEN '- ' || COALESCE(hospitality._contract_value(substr(x.l, 3)), '')
                WHEN hospitality._contract_value(x.l) ~ '^(#+ |\^ |> |- |\\ )'
                     OR hospitality._contract_value(x.l) ~ '^\*\*.+\*\*$'
                  THEN '\ ' || hospitality._contract_value(x.l)
                ELSE hospitality._contract_value(x.l) END,
           E'\n\n' ORDER BY x.i), '')
    FROM (SELECT regexp_replace(u.l, '^\s+|\s+$', '', 'g') AS l, u.i
            FROM unnest(string_to_array(replace(replace(COALESCE(_body, ''), E'\r\n', E'\n'), E'\r', E'\n'), E'\n'))
                 WITH ORDINALITY u(l, i)) x
   WHERE x.l <> '';
$$;
REVOKE ALL ON FUNCTION hospitality._policy_lines(text) FROM PUBLIC, anon, authenticated;

-- שם המסמך: בחוזה — שם התבנית; במסמך מדיניות — שם המסמך שפורסם ("תקנון האתר")
CREATE OR REPLACE FUNCTION hospitality._contract_doc_title(_kind text, _version integer, _data jsonb)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN _kind = 'policy' THEN COALESCE(NULLIF(_data ->> 'document_title', ''), t.title) ELSE t.title END
    FROM hospitality.contract_templates t WHERE t.key = _kind AND t.version = _version;
$$;
REVOKE ALL ON FUNCTION hospitality._contract_doc_title(text, integer, jsonb) FROM PUBLIC, anon, authenticated;

-- הנוסח — כמו במיגרציה 64, ובנוסף: במסמך מדיניות — הטקסט של הגרסה שפורסמה; ובדרך ב' — השם, האימייל
-- והטלפון שהלקוח כתב בחתימה. בחוזים של הזמנות / אירועים הפלט זהה (אין בהם את השדות האלה)
CREATE OR REPLACE FUNCTION hospitality._contract_body(_kind text, _version integer, _data jsonb, _fields jsonb,
                                                      _signed_on text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT hospitality._contract_render(
           CASE WHEN _kind = 'policy'
                THEN replace(t.body, '{{document_lines}}', COALESCE((
                       SELECT NULLIF(hospitality._policy_lines(v.body), '') FROM hospitality.site_document_versions v
                        WHERE v.id::text = _data ->> 'document_version_id' AND v.kind = _data ->> 'document_kind'),
                       '________'))
                ELSE t.body END,
           _data || jsonb_build_object(
             'signing_date', _signed_on,
             'signer_id_number', _fields ->> 'id_number',
             'signer_address', _fields ->> 'address')
                 || jsonb_strip_nulls(jsonb_build_object('signer_name', _fields ->> 'full_name',
                                                         'signer_email', _fields ->> 'email',
                                                         'signer_phone', _fields ->> 'phone'))
                 -- מסמך מדיניות חתום בלי טלפון — "—" (לא שדה ריק)
                 || CASE WHEN _kind = 'policy' AND _signed_on IS NOT NULL
                              AND COALESCE(_fields ->> 'phone', _data ->> 'signer_phone') IS NULL
                         THEN jsonb_build_object('signer_phone', '—') ELSE '{}'::jsonb END
                 || CASE WHEN _data ->> 'deposit_method' IS NULL AND _fields ->> 'deposit_method' IS NOT NULL
                         THEN jsonb_build_object('deposit_method', hospitality._contract_choices(
                                ARRAY['מזומן', 'צ''ק ביטחון', 'כרטיס אשראי (תפיסת מסגרת)'],
                                ARRAY[hospitality._deposit_method_label(_fields ->> 'deposit_method')]))
                         WHEN _data ->> 'deposit_method' IS NULL
                         THEN jsonb_build_object('deposit_method', hospitality._contract_choices(
                                ARRAY['מזומן', 'צ''ק ביטחון', 'כרטיס אשראי (תפיסת מסגרת)'], ARRAY[]::text[]))
                         ELSE '{}'::jsonb END)
    FROM hospitality.contract_templates t WHERE t.key = _kind AND t.version = _version;
$$;
REVOKE ALL ON FUNCTION hospitality._contract_body(text, integer, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;

-- סוג ודרך תקינים למסמך עצמאי
CREATE OR REPLACE FUNCTION hospitality._standalone_check(_kind text, _fill_mode text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF _kind IS NULL OR _kind NOT IN ('hosting', 'pool_event', 'policy') THEN
    RAISE EXCEPTION 'סוג המסמך לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  IF _fill_mode IS NULL OR _fill_mode NOT IN ('business', 'customer') THEN
    RAISE EXCEPTION 'דרך המילוי לא מוכרת' USING ERRCODE = 'check_violation';
  END IF;
END $$;
REVOKE ALL ON FUNCTION hospitality._standalone_check(text, text) FROM PUBLIC, anon, authenticated;

-- האם מותר לשלוח: הדגל (אישור משפטי) לכל מסמך; תנאי העסק שאושרו — לחוזים (במסמך מדיניות אין בהם שימוש)
CREATE OR REPLACE FUNCTION hospitality._documents_gate(_t uuid, _kind text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT hospitality.flag_for('hospitality_contracts_enabled', _t) THEN
    RAISE EXCEPTION 'החוזים ממתינים לאישור משפטי — אפשר לצפות בתצוגה מקדימה בלבד, בלי שליחה ללקוחות'
      USING ERRCODE = 'feature_not_supported';
  END IF;
  IF _kind IN ('hosting', 'pool_event') AND (hospitality._terms(_t)).confirmed_at IS NULL THEN
    RAISE EXCEPTION 'בעל העסק צריך לאשר את "תנאים ופרטי החוזה" לפני שליחת חוזה ראשון' USING ERRCODE = 'check_violation';
  END IF;
END $$;
REVOKE ALL ON FUNCTION hospitality._documents_gate(uuid, text) FROM PUBLIC, anon, authenticated;

-- הלקוח במסמך עצמאי: כרטיס קיים / פרטים שהצוות כתב (הכתוב גובר על הכרטיס). בדרך א' — שם ואימייל חובה
-- (לשם נשלח הקישור); בדרך ב' — הכול רשות (מילוי מוקדם; הלקוח משלים ומתקן בחתימה)
CREATE OR REPLACE FUNCTION hospitality._standalone_signer(_t uuid, _fill_mode text, _guest uuid, _signer jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g hospitality.guests;
  _name text;
  _email text;
  _raw text;
  _phone text;
BEGIN
  IF _guest IS NOT NULL THEN
    SELECT * INTO g FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = _guest AND x.anonymized_at IS NULL;
    IF g.id IS NULL THEN
      RAISE EXCEPTION 'הלקוח לא נמצא' USING ERRCODE = 'no_data_found';
    END IF;
    _name := g.full_name;
    _email := g.email_normalized;
    _phone := g.phone;
  END IF;
  IF _signer IS NOT NULL AND jsonb_typeof(_signer) = 'object' THEN
    _name := COALESCE(hospitality._contract_value(hospitality._cv_text(_signer -> 'full_name', 'שם הלקוח', 120, false)), _name);
    _raw := hospitality._cv_text(_signer -> 'email', 'אימייל', 254, false);
    IF _raw IS NOT NULL THEN
      IF hospitality.normalize_email(_raw) IS NULL THEN
        RAISE EXCEPTION 'כתובת האימייל לא תקינה' USING ERRCODE = 'check_violation';
      END IF;
      _email := hospitality.normalize_email(_raw);
    END IF;
    _phone := COALESCE(hospitality._cv_text(_signer -> 'phone', 'טלפון', 30, false), _phone);
  ELSIF _signer IS NOT NULL AND jsonb_typeof(_signer) <> 'null' THEN
    RAISE EXCEPTION 'פרטי הלקוח לא תקינים' USING ERRCODE = 'check_violation';
  END IF;
  IF _name IS NOT NULL AND char_length(_name) < 2 THEN
    RAISE EXCEPTION 'נא למלא את שם הלקוח' USING ERRCODE = 'check_violation';
  END IF;
  IF _phone IS NOT NULL AND hospitality.normalize_phone(_phone) IS NULL THEN
    RAISE EXCEPTION 'מספר הטלפון לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _fill_mode = 'business' THEN
    IF _name IS NULL THEN
      RAISE EXCEPTION 'נא למלא את שם הלקוח' USING ERRCODE = 'check_violation';
    END IF;
    IF _email IS NULL THEN
      RAISE EXCEPTION 'לשליחת המסמך צריך אימייל תקין של הלקוח' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN jsonb_build_object('guest_id', g.id, 'full_name', _name, 'email', _email, 'phone', _phone);
END $$;
REVOKE ALL ON FUNCTION hospitality._standalone_signer(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- הערכים למסמך עצמאי (מחרוזות — כפי שיופיעו), מהפרטים שהצוות מילא (_input) ומפרטי העסק. אותם מפתחות
-- כמו בחוזה של הזמנה / אירוע, כדי שהנוסח, הודעת הבריכה וה-PDF יהיו זהים. _input המנורמל נשמר ב-'input' —
-- כדי לחשב שוב ולבדוק שהמסמך לא התיישן (_contract_stale). חסר / לא תקין — שגיאה בעברית
CREATE OR REPLACE FUNCTION hospitality._contract_data_standalone(_t uuid, _kind text, _input jsonb, _signer jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s hospitality.settings;
  r hospitality.business_terms := hospitality._terms(_t);
  lp hospitality.site_legal_profile;
  dv hospitality.site_document_versions;
  _i jsonb := COALESCE(_input, '{}'::jsonb);
  _tz text;
  _tax text;
  _address text;
  _base jsonb;
  _d jsonb;
  k text;
  _doc text;
  _names text[];
  _chosen text[];
  _lines jsonb;
  _whole boolean := false;
  _in date;
  _out date;
  _price numeric;
  _event_fee numeric;
  _method text;
  _date date;
  _start time;
  _end time;
  _pool_from time;
  _pool_to time;
  _pool_start time;
  _pool_end time;
  _type text;
  _other text;
  _participants integer;
  _deposit numeric;
  _late numeric;
BEGIN
  IF jsonb_typeof(_i) <> 'object' THEN
    RAISE EXCEPTION 'פרטי המסמך לא תקינים' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  IF NULLIF(btrim(COALESCE(s.business_name, '')), '') IS NULL OR NULLIF(btrim(COALESCE(s.contact_phone, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(s.contact_email, '')), '') IS NULL THEN
    RAISE EXCEPTION 'חסרים פרטי העסק למסמך (שם, טלפון, מייל) — השלימו ב"הגדרות העסק"' USING ERRCODE = 'check_violation';
  END IF;
  _tz := COALESCE(s.timezone, 'Asia/Jerusalem');
  _address := NULLIF(btrim(COALESCE(s.address, '')), '');
  _base := jsonb_build_object(
    'business_name', s.business_name, 'business_phone', s.contact_phone, 'business_email', s.contact_email,
    'compound_address', _address,
    'signer_name', _signer ->> 'full_name', 'signer_phone', _signer ->> 'phone', 'signer_email', _signer ->> 'email');

  -- מסמך מדיניות: הגרסה שמפורסמת עכשיו באתר (לא הצהרת הנגישות — היא לא הסכם)
  IF _kind = 'policy' THEN
    FOR k IN SELECT jsonb_object_keys(_i) LOOP
      IF k <> 'document_kind' THEN
        RAISE EXCEPTION 'שדה לא מוכר: %', k USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    _doc := hospitality._cv_choice(_i -> 'document_kind', 'המסמך',
              ARRAY['site_terms', 'booking_terms', 'cancellation', 'privacy', 'payments', 'event_terms', 'house_rules']);
    SELECT v.* INTO dv FROM hospitality.site_documents d
      JOIN hospitality.site_document_versions v ON v.tenant_id = d.tenant_id AND v.kind = d.kind AND v.version = d.published_version
     WHERE d.tenant_id = _t AND d.kind = _doc;
    IF dv.id IS NULL THEN
      RAISE EXCEPTION 'המסמך הזה לא מפורסם באתר — פרסמו אותו ב"מסמכי האתר" ואז שלחו אותו לחתימה'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN _base || jsonb_build_object(
      'business_line', s.business_name || COALESCE(' • ' || _address, ''),
      'document_kind', _doc, 'document_version_id', dv.id, 'document_version', dv.version::text,
      'document_title', dv.title, 'document_hash', dv.body_hash,
      'document_published', to_char(dv.published_at AT TIME ZONE _tz, 'DD.MM.YYYY'),
      'input', jsonb_build_object('document_kind', _doc));
  END IF;

  -- חוזה (אירוח / אירוע): צד א' — כמו בחוזה של הזמנה (_contract_data)
  SELECT * INTO lp FROM hospitality.site_legal_profile x WHERE x.tenant_id = _t;
  _tax := COALESCE(r.business_tax_id, NULLIF(regexp_replace(COALESCE(lp.registration_id, ''), '[^0-9]', '', 'g'), ''));
  IF r.representative_name IS NULL OR _tax IS NULL THEN
    RAISE EXCEPTION 'חסרים פרטי צד א'' לחוזה: שם הנציג המורשה ומספר העוסק — השלימו ב"תנאים ופרטי החוזה"'
      USING ERRCODE = 'check_violation';
  END IF;
  _names := ARRAY(SELECT x ->> 'name' FROM jsonb_array_elements(r.unit_lines) WITH ORDINALITY u(x, i) ORDER BY i);
  _d := _base || jsonb_build_object(
    'representative_name', r.representative_name, 'business_tax_id', _tax,
    'facilities', r.facilities, 'facilities_definite', r.facilities_definite,
    'max_event_guests', r.max_event_guests::text, 'max_lodging_guests', r.max_lodging_guests::text,
    'deposit_amount', hospitality._money_text(r.deposit_amount),
    'free_cancellation_days', r.free_cancellation_days::text,
    'pool_open_time', to_char(r.pool_open_time, 'HH24:MI'), 'pool_close_time', to_char(r.pool_close_time, 'HH24:MI'));

  IF _kind = 'pool_event' THEN
    FOR k IN SELECT jsonb_object_keys(_i) LOOP
      IF k NOT IN ('event_date', 'start_time', 'end_time', 'event_type', 'event_type_other', 'participants', 'price',
                   'deposit_amount', 'late_fee', 'pool_start_time', 'pool_end_time') THEN
        RAISE EXCEPTION 'שדה לא מוכר: %', k USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    _type := hospitality._cv_choice(_i -> 'event_type', 'סוג האירוע',
               ARRAY['bridal_shower', 'bar_mitzvah', 'birthday', 'private_party', 'family_event', 'other']);
    _other := CASE WHEN _type = 'other'
                   THEN hospitality._contract_value(hospitality._cv_text(_i -> 'event_type_other', 'סוג האירוע (אחר)', 80, true)) END;
    _date := hospitality._cv_date(_i -> 'event_date', 'תאריך האירוע');
    _start := hospitality._cv_time(_i -> 'start_time', 'שעת ההתחלה');
    _end := hospitality._cv_time(_i -> 'end_time', 'שעת הסיום');
    IF _date IS NULL OR _start IS NULL OR _end IS NULL THEN
      RAISE EXCEPTION 'יש למלא תאריך, שעת התחלה ושעת סיום' USING ERRCODE = 'check_violation';
    END IF;
    IF _date NOT BETWEEN current_date - 365 AND current_date + 1100 THEN
      RAISE EXCEPTION 'תאריך האירוע רחוק מדי' USING ERRCODE = 'check_violation';
    END IF;
    IF _end = _start THEN
      RAISE EXCEPTION 'שעת הסיום צריכה להיות אחרי שעת ההתחלה' USING ERRCODE = 'check_violation';
    END IF;
    -- השימוש בבריכה — כמו באירוע: בתוך שעות האירוע ושעות הבריכה; לא נשלח — כל החלון המותר
    SELECT a.allowed_from, a.allowed_to INTO _pool_from, _pool_to
      FROM hospitality._event_pool_allowed(_t, _start, _end) a;
    IF _i ? 'pool_start_time' OR _i ? 'pool_end_time' THEN
      _pool_start := hospitality._cv_time(_i -> 'pool_start_time', 'תחילת השימוש בבריכה');
      _pool_end := hospitality._cv_time(_i -> 'pool_end_time', 'סוף השימוש בבריכה');
      IF (_pool_start IS NULL) <> (_pool_end IS NULL) THEN
        RAISE EXCEPTION 'השימוש בבריכה — יש למלא גם שעת התחלה וגם שעת סיום, או לבחור "בלי שימוש בבריכה"'
          USING ERRCODE = 'check_violation';
      END IF;
      IF _pool_start IS NOT NULL AND _pool_from IS NULL THEN
        RAISE EXCEPTION 'האירוע כולו מחוץ לשעות הבריכה (%–%) — אין בו שימוש בבריכה',
          to_char(r.pool_open_time, 'HH24:MI'), to_char(r.pool_close_time, 'HH24:MI') USING ERRCODE = 'check_violation';
      END IF;
      IF _pool_start IS NOT NULL AND (_pool_start < _pool_from OR _pool_end > _pool_to OR _pool_end <= _pool_start) THEN
        RAISE EXCEPTION 'השימוש בבריכה באירוע הזה — רק בין % ל-% (בתוך שעות האירוע ושעות הבריכה %–%)',
          to_char(_pool_from, 'HH24:MI'), to_char(_pool_to, 'HH24:MI'),
          to_char(r.pool_open_time, 'HH24:MI'), to_char(r.pool_close_time, 'HH24:MI') USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      _pool_start := _pool_from;
      _pool_end := _pool_to;
    END IF;
    _participants := hospitality._cv_int(_i -> 'participants', 'מספר המשתתפים', 1, 1000);
    IF _participants > r.max_event_guests THEN
      RAISE EXCEPTION 'עד % משתתפים באירוע (לפי החוזה) — אי אפשר יותר', r.max_event_guests USING ERRCODE = 'check_violation';
    END IF;
    _price := hospitality._cv_money(_i -> 'price', 'המחיר', 0, 1000000, false);
    _deposit := COALESCE(hospitality._cv_money(_i -> 'deposit_amount', 'הפיקדון', 0, 100000, true), r.deposit_amount);
    _late := COALESCE(hospitality._cv_money(_i -> 'late_fee', 'דמי האיחור לשעה', 0, 10000, true), r.event_late_fee_per_hour);
    RETURN _d || jsonb_build_object(
      'units_count_text', CASE WHEN cardinality(_names) = 0 THEN 'הצימרים'
                               WHEN cardinality(_names) = 1 THEN 'הצימר'
                               ELSE cardinality(_names) || ' הצימרים' END,
      'event_purpose', hospitality._event_type_label(_type, _other),
      'event_date', to_char(_date, 'DD.MM.YYYY'),
      'start_time', to_char(_start, 'HH24:MI'), 'end_time', to_char(_end, 'HH24:MI'),
      'pool_start_time', to_char(_pool_start, 'HH24:MI'), 'pool_end_time', to_char(_pool_end, 'HH24:MI'),
      'event_late_fee', hospitality._money_text(_late),
      'price', hospitality._money_text(_price),
      'deposit_amount', hospitality._money_text(_deposit),
      'service_date', _date::text, 'event_type', _type, 'participants', _participants::text,
      'input', jsonb_build_object('event_date', _date, 'start_time', to_char(_start, 'HH24:MI'),
                                  'end_time', to_char(_end, 'HH24:MI'), 'event_type', _type, 'event_type_other', _other,
                                  'participants', _participants, 'price', _price, 'deposit_amount', _deposit,
                                  'late_fee', _late, 'pool_start_time', to_char(_pool_start, 'HH24:MI'),
                                  'pool_end_time', to_char(_pool_end, 'HH24:MI')));
  END IF;

  IF _kind <> 'hosting' THEN
    RAISE EXCEPTION 'סוג המסמך לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  -- חוזה אירוח לטווח קצר: תאריכים, היחידות (מתוך "תנאים ופרטי החוזה") או כל המתחם, המחיר
  FOR k IN SELECT jsonb_object_keys(_i) LOOP
    IF k NOT IN ('check_in', 'check_out', 'units', 'whole', 'price', 'event_fee', 'deposit_method') THEN
      RAISE EXCEPTION 'שדה לא מוכר: %', k USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  _in := hospitality._cv_date(_i -> 'check_in', 'תאריך הכניסה');
  _out := hospitality._cv_date(_i -> 'check_out', 'תאריך היציאה');
  IF _in IS NULL OR _out IS NULL THEN
    RAISE EXCEPTION 'יש למלא תאריך כניסה ותאריך יציאה' USING ERRCODE = 'check_violation';
  END IF;
  IF _out <= _in THEN
    RAISE EXCEPTION 'תאריך היציאה צריך להיות אחרי תאריך הכניסה' USING ERRCODE = 'check_violation';
  END IF;
  IF _out - _in > 60 THEN
    RAISE EXCEPTION 'עד 60 לילות במסמך אחד' USING ERRCODE = 'check_violation';
  END IF;
  IF _in NOT BETWEEN current_date - 365 AND current_date + 1100 THEN
    RAISE EXCEPTION 'תאריך הכניסה רחוק מדי' USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(_names) = 0 THEN
    RAISE EXCEPTION 'הגדירו את יחידות האירוח לחוזה (סעיף 1) ב"תנאים ופרטי החוזה"' USING ERRCODE = 'check_violation';
  END IF;
  IF _i ? 'whole' AND jsonb_typeof(_i -> 'whole') NOT IN ('boolean', 'null') THEN
    RAISE EXCEPTION 'בחירת היחידות לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  _whole := COALESCE((_i ->> 'whole')::boolean, false);
  IF NOT _whole THEN
    IF jsonb_typeof(_i -> 'units') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'בחרו את היחידות שבחוזה (או "כל המתחם")' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(_i -> 'units') x WHERE jsonb_typeof(x) <> 'string') THEN
      RAISE EXCEPTION 'בחירת היחידות לא תקינה' USING ERRCODE = 'check_violation';
    END IF;
    _chosen := ARRAY(SELECT DISTINCT x #>> '{}' FROM jsonb_array_elements(_i -> 'units') x ORDER BY 1);
    IF cardinality(_chosen) = 0 THEN
      RAISE EXCEPTION 'בחרו את היחידות שבחוזה (או "כל המתחם")' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(_chosen) c WHERE NOT (c = ANY (_names))) THEN
      RAISE EXCEPTION 'בחרו יחידות מהרשימה שב"תנאים ופרטי החוזה"' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  _price := hospitality._cv_money(_i -> 'price', 'המחיר', 0, 1000000, false);
  _event_fee := hospitality._cv_money(_i -> 'event_fee', 'התשלום הנוסף לאירוע', 0, 1000000, true);
  IF _i ? 'deposit_method' AND jsonb_typeof(_i -> 'deposit_method') <> 'null' THEN
    _method := hospitality._cv_choice(_i -> 'deposit_method', 'אמצעי הפיקדון', ARRAY['cash', 'check', 'card']);
  END IF;
  _lines := COALESCE((SELECT jsonb_agg('צימר ' || (x ->> 'name') || ': ' || (x ->> 'description') || '.' ORDER BY i)
                        FROM jsonb_array_elements(r.unit_lines) WITH ORDINALITY u(x, i)), '[]'::jsonb);
  RETURN _d || jsonb_build_object(
    'units_recital', CASE WHEN cardinality(_names) = 1 THEN 'צימר אחד (' || hospitality._quoted_list(_names) || ')'
                          ELSE cardinality(_names) || ' צימרים (' || hospitality._quoted_list(_names) || ')' END,
    'unit_lines', _lines,
    'units_selected', hospitality._contract_choices(_names || ARRAY['כל המתחם'],
                        CASE WHEN _whole THEN ARRAY['כל המתחם'] ELSE _chosen END),
    'nights', (_out - _in)::text,
    'check_in_date', to_char(_in, 'DD.MM.YYYY'), 'check_out_date', to_char(_out, 'DD.MM.YYYY'),
    'check_in_time', to_char(COALESCE(s.check_in_time, '14:00'::time), 'HH24:MI'),
    'check_out_time', to_char(COALESCE(s.check_out_time, '11:00'::time), 'HH24:MI'),
    'lodging_late_fee', hospitality._money_text(r.lodging_late_fee_per_hour),
    'price', hospitality._money_text(_price),
    'event_fee', hospitality._money_text(_event_fee),
    'deposit_method_chosen', _method,
    'deposit_method', CASE WHEN _method IS NOT NULL
                           THEN hospitality._contract_choices(ARRAY['מזומן', 'צ''ק ביטחון', 'כרטיס אשראי (תפיסת מסגרת)'],
                                                              ARRAY[hospitality._deposit_method_label(_method)]) END,
    'service_date', _in::text, 'service_end', _out::text,
    'options', jsonb_strip_nulls(jsonb_build_object('deposit_method', _method, 'event_fee', _event_fee)),
    'input', jsonb_build_object('check_in', _in, 'check_out', _out, 'whole', _whole,
                                'units', to_jsonb(COALESCE(_chosen, ARRAY[]::text[])), 'price', _price,
                                'event_fee', _event_fee, 'deposit_method', _method));
END $$;
REVOKE ALL ON FUNCTION hospitality._contract_data_standalone(uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- חוזה פתוח שכבר לא מתאים — כמו במיגרציה 64; ומסמך עצמאי: מחשבים שוב מהפרטים שנשמרו ('input') מול
-- פרטי העסק / התנאים / גרסת המסמך שמפורסמת עכשיו. 'unavailable' — כבר אי אפשר (חסר פרט, המסמך לא מפורסם)
CREATE OR REPLACE FUNCTION hospitality._contract_stale(c hospitality.client_contracts)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _now jsonb;
  _who jsonb;
BEGIN
  IF c.id IS NULL OR c.signed_at IS NOT NULL OR c.status NOT IN ('draft', 'sent', 'viewed') THEN
    RETURN NULL;
  END IF;
  _who := jsonb_build_object('full_name', c.data ->> 'signer_name', 'email', c.data ->> 'signer_email',
                             'phone', c.data ->> 'signer_phone');
  IF c.origin = 'standalone' THEN
    BEGIN
      _now := hospitality._contract_data_standalone(c.tenant_id, c.kind, COALESCE(c.data -> 'input', '{}'::jsonb), _who);
    EXCEPTION WHEN OTHERS THEN
      RETURN 'unavailable';
    END;
    -- מסמך מדיניות: אותה גרסה ואותם פרטי עסק (בלי לחשב את כל הטקסט)
    IF c.kind = 'policy' THEN
      IF (_now ->> 'document_version_id', _now ->> 'business_line', _now ->> 'business_name')
           IS DISTINCT FROM (c.data ->> 'document_version_id', c.data ->> 'business_line', c.data ->> 'business_name') THEN
        RETURN 'changed';
      END IF;
      RETURN NULL;
    END IF;
  ELSE
    BEGIN
      _now := hospitality._contract_data(c.tenant_id, c.kind, c.booking_id, c.event_id, _who,
                COALESCE(c.data -> 'options', '{}'::jsonb));
    EXCEPTION WHEN OTHERS THEN
      RETURN 'unavailable';
    END;
  END IF;
  IF hospitality._contract_body(c.kind, c.template_version, _now, '{}'::jsonb, NULL)
       IS DISTINCT FROM hospitality._contract_body(c.kind, c.template_version, c.data, '{}'::jsonb, NULL)
     OR (_now ->> 'pool_start_time', _now ->> 'pool_end_time')
       IS DISTINCT FROM (c.data ->> 'pool_start_time', c.data ->> 'pool_end_time') THEN
    RETURN 'changed';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION hospitality._contract_stale(hospitality.client_contracts) FROM PUBLIC, anon, authenticated;

-- שורה ברשימה / בכרטיס לצוות — כמו במיגרציה 64, ובנוסף: המקור, דרך המילוי, שם המסמך, "נצפה"
CREATE OR REPLACE FUNCTION hospitality._contract_json(c hospitality.client_contracts)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'number', c.number, 'kind', c.kind, 'template_version', c.template_version,
    'title', hospitality._contract_doc_title(c.kind, c.template_version, c.data),
    'origin', c.origin, 'fill_mode', c.fill_mode,
    'document_kind', c.data ->> 'document_kind', 'document_version', c.data ->> 'document_version',
    'document_hash', c.data ->> 'document_hash',
    'booking_id', c.booking_id, 'event_id', c.event_id, 'guest_id', c.guest_id,
    'booking_type', CASE c.kind WHEN 'hosting' THEN 'hosting' WHEN 'pool_event' THEN 'event' END,
    'link_number', COALESCE(c.data ->> 'booking_number', c.data ->> 'event_number'),
    'event_type', c.data ->> 'event_type', 'event_purpose', c.data ->> 'event_purpose',
    'service_date', c.data ->> 'service_date', 'service_end', c.data ->> 'service_end',
    'signer_name', c.signer_name, 'signer_email', c.signer_email, 'signer_phone', c.signer_phone,
    'status', hospitality._contract_state(c), 'stored_status', c.status,
    'sent_at', hospitality._ts(c.sent_at), 'last_sent_at', hospitality._ts(c.last_sent_at), 'send_count', c.send_count,
    'send_error', c.send_error, 'viewed_at', hospitality._ts(c.viewed_at),
    'link_expires_at', hospitality._ts(c.token_expires_at),
    'signed_at', hospitality._ts(c.signed_at), 'has_pdf', c.pdf_path IS NOT NULL, 'pdf_sha256', c.pdf_sha256,
    'signed_body_sha256', c.signed_body_sha256,
    'copy_sent_at', hospitality._ts(c.copy_sent_at), 'copy_error', c.copy_error,
    'supersedes_id', c.supersedes_id, 'superseded_by_id', c.superseded_by_id, 'cancel_reason', c.cancel_reason,
    'stale', hospitality._contract_stale(c), 'pool', hospitality._contract_pool(c),
    'unseen', c.signed_at IS NOT NULL AND c.staff_seen_at IS NULL,
    'created_at', hospitality._ts(c.created_at));
$$;
REVOKE ALL ON FUNCTION hospitality._contract_json(hospitality.client_contracts) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. הצוות (הרשאת contracts)
-- ------------------------------------------------------------
-- מצב — כמו במיגרציה 64, ובנוסף: מסמכי האתר שאפשר לשלוח לחתימה (שפורסמו), וכמה חתימות עוד לא נצפו
CREATE OR REPLACE FUNCTION hospitality.contracts_view()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
BEGIN
  RETURN jsonb_build_object(
    'enabled', hospitality.flag_for('hospitality_contracts_enabled', _t),
    'terms', hospitality._terms_json(hospitality._terms(_t)),
    'templates', (SELECT jsonb_agg(jsonb_build_object('kind', t.key, 'version', t.version, 'title', t.title,
                                                      'body_hash', t.body_hash) ORDER BY t.key DESC)
                    FROM (SELECT DISTINCT ON (x.key) x.* FROM hospitality.contract_templates x
                           WHERE x.key IN ('hosting', 'pool_event') ORDER BY x.key, x.version DESC) t),
    'counts', (SELECT jsonb_build_object(
                 'all', count(*), 'signed', count(*) FILTER (WHERE c.status = 'signed'),
                 'waiting', count(*) FILTER (WHERE hospitality._contract_state(c) IN ('sent', 'viewed')),
                 'draft', count(*) FILTER (WHERE c.status = 'draft'),
                 'standalone', count(*) FILTER (WHERE c.origin = 'standalone'),
                 'unseen', count(*) FILTER (WHERE c.signed_at IS NOT NULL AND c.staff_seen_at IS NULL))
                 FROM hospitality.client_contracts c WHERE c.tenant_id = _t),
    'can_confirm_terms', hospitality.can('settings.owner'),
    'documents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('kind', d.kind, 'title', v.title, 'version', v.version,
                                          'published_at', hospitality._ts(v.published_at))
                       ORDER BY array_position(ARRAY['booking_terms', 'cancellation', 'house_rules', 'payments',
                                                     'event_terms', 'site_terms', 'privacy'], d.kind))
        FROM hospitality.site_documents d
        JOIN hospitality.site_document_versions v ON v.tenant_id = d.tenant_id AND v.kind = d.kind
                                                 AND v.version = d.published_version
       WHERE d.tenant_id = _t AND d.kind <> 'accessibility'), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.contracts_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.contracts_view() TO authenticated, service_role;

-- תצוגה מקדימה של מסמך עצמאי (בלי לשמור) — הנוסח המלא כמו שהלקוח יראה
CREATE OR REPLACE FUNCTION hospitality.contract_standalone_preview(_kind text, _fill_mode text DEFAULT 'business',
                                                                   _guest_id uuid DEFAULT NULL,
                                                                   _signer jsonb DEFAULT NULL,
                                                                   _input jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  _who jsonb;
  _data jsonb;
  _v integer;
BEGIN
  PERFORM hospitality._standalone_check(_kind, _fill_mode);
  _who := hospitality._standalone_signer(_t, _fill_mode, _guest_id, _signer);
  _data := hospitality._contract_data_standalone(_t, _kind, _input, _who);
  SELECT max(t.version) INTO _v FROM hospitality.contract_templates t WHERE t.key = _kind;
  RETURN jsonb_build_object(
    'kind', _kind, 'fill_mode', _fill_mode, 'origin', 'standalone', 'template_version', _v,
    'title', hospitality._contract_doc_title(_kind, _v, _data),
    'signer', _who, 'data', _data - 'input',
    'body', hospitality._contract_body(_kind, _v, _data, '{}'::jsonb, NULL),
    'can_send', hospitality.flag_for('hospitality_contracts_enabled', _t)
                AND (_kind = 'policy' OR (hospitality._terms(_t)).confirmed_at IS NOT NULL),
    'legal_pending', NOT hospitality.flag_for('hospitality_contracts_enabled', _t),
    'terms_confirmed', (hospitality._terms(_t)).confirmed_at IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_standalone_preview(text, text, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.contract_standalone_preview(text, text, uuid, jsonb, jsonb) TO authenticated, service_role;

-- יצירת מסמך עצמאי (טיוטה). דרך א' — לקוח חדש: כרטיס לקוח (קיים לפי האימייל, או חדש)
CREATE OR REPLACE FUNCTION hospitality.contract_standalone_create(_kind text, _fill_mode text DEFAULT 'business',
                                                                  _guest_id uuid DEFAULT NULL,
                                                                  _signer jsonb DEFAULT NULL,
                                                                  _input jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  _who jsonb;
  _data jsonb;
  _v integer;
  _g uuid;
  _new boolean := false;
  c hospitality.client_contracts;
BEGIN
  PERFORM hospitality._standalone_check(_kind, _fill_mode);
  PERFORM hospitality._documents_gate(_t, _kind);
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-contracts:' || _t, 0));
  _who := hospitality._standalone_signer(_t, _fill_mode, _guest_id, _signer);
  _data := hospitality._contract_data_standalone(_t, _kind, _input, _who);
  _g := (_who ->> 'guest_id')::uuid;
  IF _g IS NULL AND _fill_mode = 'business' THEN
    SELECT g.id INTO _g FROM hospitality.guests g
     WHERE g.tenant_id = _t AND g.anonymized_at IS NULL AND g.email_normalized = _who ->> 'email'
     ORDER BY g.created_at LIMIT 1;
    IF _g IS NULL THEN
      INSERT INTO hospitality.guests (tenant_id, full_name, email, phone)
      VALUES (_t, _who ->> 'full_name', _who ->> 'email', _who ->> 'phone')
      RETURNING id INTO _g;
      _new := true;
    END IF;
  END IF;
  SELECT max(t.version) INTO _v FROM hospitality.contract_templates t WHERE t.key = _kind;
  INSERT INTO hospitality.client_contracts (tenant_id, number, kind, template_version, origin, fill_mode, guest_id,
                                            signer_name, signer_email, signer_phone, data, created_by)
  VALUES (_t, (SELECT COALESCE(max(x.number), 1000) + 1 FROM hospitality.client_contracts x WHERE x.tenant_id = _t),
          _kind, _v, 'standalone', _fill_mode, _g, _who ->> 'full_name', _who ->> 'email', _who ->> 'phone',
          _data, auth.uid())
  RETURNING * INTO c;
  PERFORM hospitality._contract_log(_t, c.id, 'created', 'staff', auth.uid(), NULL,
    jsonb_strip_nulls(jsonb_build_object('kind', _kind, 'template_version', _v, 'origin', 'standalone',
                                         'fill_mode', _fill_mode, 'document', _data ->> 'document_kind',
                                         'document_version', _data ->> 'document_version',
                                         'document_hash', _data ->> 'document_hash', 'new_customer', _new)));
  PERFORM hospitality._audit(_t, 'contracts.created', 'מסמך #' || c.number,
    jsonb_strip_nulls(jsonb_build_object('kind', _kind, 'origin', 'standalone', 'fill_mode', _fill_mode,
                                         'email', hospitality.mask_email(c.signer_email), 'new_customer', _new)));
  RETURN hospitality._contract_json(c);
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_standalone_create(text, text, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.contract_standalone_create(text, text, uuid, jsonb, jsonb) TO authenticated, service_role;

-- לפני שליחה במייל (גם שליחה חוזרת) — כמו במיגרציה 64; השער לפי סוג המסמך, וההודעות גם למסמך עצמאי
CREATE OR REPLACE FUNCTION hospitality.contract_send_prepare(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  c hospitality.client_contracts;
BEGIN
  SELECT * INTO c FROM hospitality.client_contracts x WHERE x.tenant_id = _t AND x.id = _id;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'החוזה לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM hospitality._documents_gate(_t, c.kind);
  IF c.status NOT IN ('draft', 'sent', 'viewed') THEN
    RAISE EXCEPTION 'אפשר לשלוח רק חוזה שעוד לא נחתם' USING ERRCODE = 'check_violation';
  END IF;
  CASE hospitality._contract_stale(c)
    WHEN 'changed' THEN
      IF c.origin = 'standalone' THEN
        RAISE EXCEPTION 'פרטי העסק / התנאים / גרסת המסמך השתנו מאז שהמסמך נוצר — צרו מסמך חדש'
          USING ERRCODE = 'check_violation';
      END IF;
      RAISE EXCEPTION 'פרטי ההזמנה / האירוע השתנו מאז שהחוזה נוצר — שלחו חוזה מעודכן (במסך "שליחת חוזה")'
        USING ERRCODE = 'check_violation';
    WHEN 'unavailable' THEN
      IF c.origin = 'standalone' THEN
        RAISE EXCEPTION 'אי אפשר לשלוח את המסמך הזה (חסרים פרטים, או שהמסמך כבר לא מפורסם באתר) — צרו מסמך חדש'
          USING ERRCODE = 'check_violation';
      END IF;
      RAISE EXCEPTION 'ההזמנה / האירוע בוטלו (או שחסרים פרטים לחוזה) — אי אפשר לשלוח את החוזה הזה'
        USING ERRCODE = 'check_violation';
    ELSE NULL;
  END CASE;
  IF c.signer_email IS NULL THEN
    RAISE EXCEPTION 'אין אימייל ללקוח — העתיקו את הקישור ושלחו אותו ללקוח בעצמכם' USING ERRCODE = 'check_violation';
  END IF;
  RETURN hospitality._contract_json(c) || jsonb_build_object('tenant_id', _t, 'actor_id', auth.uid(),
                                                             'business_name', c.data ->> 'business_name',
                                                             'business_email', c.data ->> 'business_email',
                                                             'business_phone', c.data ->> 'business_phone');
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_send_prepare(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.contract_send_prepare(uuid) TO authenticated, service_role;

-- דרך ב': לפני יצירת קישור להעתקה — רק מסמך עצמאי שהלקוח ממלא, פתוח ותקף
CREATE OR REPLACE FUNCTION hospitality.contract_link_prepare(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  c hospitality.client_contracts;
BEGIN
  SELECT * INTO c FROM hospitality.client_contracts x WHERE x.tenant_id = _t AND x.id = _id;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'המסמך לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.origin <> 'standalone' OR c.fill_mode <> 'customer' THEN
    RAISE EXCEPTION 'קישור להעתקה — רק במסמך שהלקוח ממלא בעצמו' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._documents_gate(_t, c.kind);
  IF c.status NOT IN ('draft', 'sent', 'viewed') THEN
    RAISE EXCEPTION 'אפשר ליצור קישור רק למסמך שעוד לא נחתם' USING ERRCODE = 'check_violation';
  END IF;
  IF hospitality._contract_stale(c) IS NOT NULL THEN
    RAISE EXCEPTION 'פרטי העסק / התנאים / גרסת המסמך השתנו מאז שהמסמך נוצר — צרו מסמך חדש'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN hospitality._contract_json(c) || jsonb_build_object('tenant_id', _t, 'actor_id', auth.uid());
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_link_prepare(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.contract_link_prepare(uuid) TO authenticated, service_role;

-- הארכיון — כמו במיגרציה 64, ועכשיו גם מסמכי מדיניות (וחיפוש לפי שם המסמך)
CREATE OR REPLACE FUNCTION hospitality.staff_contracts(_q text DEFAULT NULL, _kind text DEFAULT NULL,
                                                       _status text DEFAULT NULL, _event_type text DEFAULT NULL,
                                                       _from date DEFAULT NULL, _to date DEFAULT NULL,
                                                       _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  _s text := NULLIF(btrim(COALESCE(_q, '')), '');
  -- טלפון / מספר — רק כשמחפשים מספר ("054-6800002", "#1002"), לא ספרות בתוך שם או אימייל
  _digits text := CASE WHEN COALESCE(_q, '') ~ '^[-0-9 ()+#.]+$'
                       THEN NULLIF(regexp_replace(COALESCE(_q, ''), '[^0-9]', '', 'g'), '') END;
  _rows jsonb;
  _total integer;
BEGIN
  IF _kind IS NOT NULL AND _kind NOT IN ('hosting', 'pool_event', 'policy') THEN
    RAISE EXCEPTION 'סוג החוזה לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  IF _status IS NOT NULL AND _status NOT IN ('draft', 'sent', 'viewed', 'signed', 'superseded', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'מצב לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  WITH hits AS (
    SELECT c.id, c.created_at FROM hospitality.client_contracts c
     WHERE c.tenant_id = _t
       AND (_kind IS NULL OR c.kind = _kind)
       AND (_status IS NULL OR hospitality._contract_state(c) = _status)
       AND (_event_type IS NULL OR c.data ->> 'event_type' = _event_type)
       AND (_from IS NULL OR (c.data ->> 'service_date')::date >= _from)
       AND (_to IS NULL OR (c.data ->> 'service_date')::date <= _to)
       AND (_s IS NULL OR c.signer_name ILIKE '%' || _s || '%' OR c.signer_email_normalized LIKE '%' || lower(_s) || '%'
            OR c.data ->> 'document_title' ILIKE '%' || _s || '%'
            OR (_digits IS NOT NULL AND (regexp_replace(COALESCE(c.signer_phone, ''), '[^0-9]', '', 'g') LIKE '%' || _digits || '%'
                                         OR c.number::text = _digits
                                         OR c.data ->> 'booking_number' = _digits OR c.data ->> 'event_number' = _digits)))
  ), page AS (
    SELECT h.id FROM hits h ORDER BY h.created_at DESC, h.id
     LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200) OFFSET GREATEST(COALESCE(_offset, 0), 0)
  )
  SELECT (SELECT count(*)::integer FROM hits),
         COALESCE((SELECT jsonb_agg(hospitality._contract_json(c) ORDER BY c.created_at DESC, c.id)
                     FROM hospitality.client_contracts c WHERE c.tenant_id = _t AND c.id IN (SELECT id FROM page)), '[]'::jsonb)
    INTO _total, _rows;
  RETURN jsonb_build_object('rows', _rows, 'total', _total);
END $$;
REVOKE ALL ON FUNCTION hospitality.staff_contracts(text, text, text, text, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.staff_contracts(text, text, text, text, date, date, integer, integer) TO authenticated, service_role;

-- "מסמכים חתומים": כל מה שנחתם (גם שהוחלף אחר כך בחוזה מתוקן), לפי תאריך החתימה (אזור הזמן של העסק).
-- חיפוש: שם / אימייל / טלפון / מספר המסמך / מספר ההזמנה או האירוע / שם המסמך; סינון: סוג, מקור, תאריכים
CREATE OR REPLACE FUNCTION hospitality.staff_signed_documents(_q text DEFAULT NULL, _kind text DEFAULT NULL,
                                                              _origin text DEFAULT NULL, _from date DEFAULT NULL,
                                                              _to date DEFAULT NULL, _limit integer DEFAULT 50,
                                                              _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  _tz text;
  _s text := NULLIF(btrim(COALESCE(_q, '')), '');
  -- טלפון / מספר — רק כשמחפשים מספר ("054-6800002", "#1002"), לא ספרות בתוך שם או אימייל
  _digits text := CASE WHEN COALESCE(_q, '') ~ '^[-0-9 ()+#.]+$'
                       THEN NULLIF(regexp_replace(COALESCE(_q, ''), '[^0-9]', '', 'g'), '') END;
  _rows jsonb;
  _total integer;
BEGIN
  IF _kind IS NOT NULL AND _kind NOT IN ('hosting', 'pool_event', 'policy') THEN
    RAISE EXCEPTION 'סוג המסמך לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  IF _origin IS NOT NULL AND _origin NOT IN ('linked', 'standalone') THEN
    RAISE EXCEPTION 'מקור לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  IF _from IS NOT NULL AND _to IS NOT NULL AND _to < _from THEN
    RAISE EXCEPTION 'טווח התאריכים לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(s.timezone, 'Asia/Jerusalem') INTO _tz FROM hospitality.settings s WHERE s.tenant_id = _t;
  _tz := COALESCE(_tz, 'Asia/Jerusalem');
  WITH hits AS (
    SELECT c.id, c.signed_at FROM hospitality.client_contracts c
     WHERE c.tenant_id = _t AND c.signed_at IS NOT NULL
       AND (_kind IS NULL OR c.kind = _kind)
       AND (_origin IS NULL OR c.origin = _origin)
       AND (_from IS NULL OR (c.signed_at AT TIME ZONE _tz)::date >= _from)
       AND (_to IS NULL OR (c.signed_at AT TIME ZONE _tz)::date <= _to)
       AND (_s IS NULL OR c.signer_name ILIKE '%' || _s || '%' OR c.signer_email_normalized LIKE '%' || lower(_s) || '%'
            OR c.data ->> 'document_title' ILIKE '%' || _s || '%'
            OR (_digits IS NOT NULL AND (regexp_replace(COALESCE(c.signer_phone, ''), '[^0-9]', '', 'g') LIKE '%' || _digits || '%'
                                         OR c.number::text = _digits
                                         OR c.data ->> 'booking_number' = _digits OR c.data ->> 'event_number' = _digits)))
  ), page AS (
    SELECT h.id FROM hits h ORDER BY h.signed_at DESC, h.id
     LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200) OFFSET GREATEST(COALESCE(_offset, 0), 0)
  )
  SELECT (SELECT count(*)::integer FROM hits),
         COALESCE((SELECT jsonb_agg(hospitality._contract_json(c) ORDER BY c.signed_at DESC, c.id)
                     FROM hospitality.client_contracts c WHERE c.tenant_id = _t AND c.id IN (SELECT id FROM page)), '[]'::jsonb)
    INTO _total, _rows;
  RETURN jsonb_build_object(
    'rows', _rows, 'total', _total,
    'unseen', (SELECT count(*)::integer FROM hospitality.client_contracts c
                WHERE c.tenant_id = _t AND c.signed_at IS NOT NULL AND c.staff_seen_at IS NULL));
END $$;
REVOKE ALL ON FUNCTION hospitality.staff_signed_documents(text, text, text, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.staff_signed_documents(text, text, text, date, date, integer, integer) TO authenticated, service_role;

-- ההתראה באזור הניהול: כמה חתימות עוד לא נצפו (לתג בניווט), וסימון "נצפה" (כשהצוות פותח את "מסמכים חתומים")
CREATE OR REPLACE FUNCTION hospitality.contracts_unseen()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
BEGIN
  RETURN jsonb_build_object('unseen', (SELECT count(*)::integer FROM hospitality.client_contracts c
                                        WHERE c.tenant_id = _t AND c.signed_at IS NOT NULL AND c.staff_seen_at IS NULL));
END $$;
REVOKE ALL ON FUNCTION hospitality.contracts_unseen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.contracts_unseen() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.contracts_mark_seen(_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  _n integer;
BEGIN
  IF _ids IS NOT NULL AND cardinality(_ids) > 200 THEN
    RAISE EXCEPTION 'יותר מדי מסמכים בבת אחת' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.client_contracts c SET staff_seen_at = now()
   WHERE c.tenant_id = _t AND c.signed_at IS NOT NULL AND c.staff_seen_at IS NULL
     AND (_ids IS NULL OR c.id = ANY (_ids));
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('seen', _n);
END $$;
REVOKE ALL ON FUNCTION hospitality.contracts_mark_seen(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.contracts_mark_seen(uuid[]) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. השרת בלבד: דרך ב' — הקישור נוצר והועבר לצוות (להעתקה), בלי מייל
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.contract_link_shared(_tenant uuid, _id uuid, _actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c hospitality.client_contracts;
BEGIN
  UPDATE hospitality.client_contracts x
     SET status = CASE WHEN x.status = 'draft' THEN 'sent' ELSE x.status END,
         sent_at = COALESCE(x.sent_at, now()), last_sent_at = now(), send_count = x.send_count + 1,
         send_error = NULL, updated_at = now()
   WHERE x.tenant_id = _tenant AND x.id = _id AND x.origin = 'standalone' AND x.fill_mode = 'customer'
     AND x.status IN ('draft', 'sent', 'viewed') AND x.token_hash IS NOT NULL AND x.token_expires_at > now()
  RETURNING * INTO c;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'הקישור לא נוצר — נסו שוב' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._contract_log(_tenant, c.id, 'link_created', 'staff', _actor, NULL,
                                    jsonb_build_object('expires_at', hospitality._ts(c.token_expires_at), 'count', c.send_count));
  PERFORM hospitality._audit(_tenant, 'contracts.link_created', 'מסמך #' || c.number, '{}'::jsonb);
  RETURN hospitality._contract_json(c);
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_link_shared(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.contract_link_shared(uuid, uuid, uuid) TO service_role;

-- ------------------------------------------------------------
-- 6. הלקוח (דרך השרת — מפתח השירות, עם טביעת הקישור): פתיחה וחתימה
-- ------------------------------------------------------------
-- כמו במיגרציה 64; ההודעות על מסמך שהתיישן — גם למסמך עצמאי
CREATE OR REPLACE FUNCTION hospitality._contract_by_token(_token_hash text, _lock boolean)
RETURNS hospitality.client_contracts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality.request_tenant();
  c hospitality.client_contracts;
BEGIN
  IF _t IS NULL OR NOT hospitality.flag_for('hospitality_backend_enabled', _t)
     OR NOT hospitality.flag_for('hospitality_contracts_enabled', _t) THEN
    RAISE EXCEPTION 'החתימה על חוזים אינה זמינה באתר הזה' USING ERRCODE = 'feature_not_supported';
  END IF;
  IF COALESCE(_token_hash, '') ~ '^[0-9a-f]{64}$' THEN
    IF _lock THEN
      SELECT * INTO c FROM hospitality.client_contracts x WHERE x.tenant_id = _t AND x.token_hash = _token_hash FOR UPDATE;
    ELSE
      SELECT * INTO c FROM hospitality.client_contracts x WHERE x.tenant_id = _t AND x.token_hash = _token_hash;
    END IF;
  END IF;
  -- טיוטה עם קישור: המייל יצא, והתוצאה עוד לא נרשמה (רגע בין השליחה לרישום) — כמו "נשלח"
  IF c.id IS NULL OR c.status NOT IN ('draft', 'sent', 'viewed') THEN
    RAISE EXCEPTION 'הקישור לחתימה לא תקין או שכבר שומש — אם צריך, בקשו מהעסק לשלוח שוב' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.token_expires_at <= now() THEN
    RAISE EXCEPTION 'הקישור לחתימה פג תוקף — בקשו מהעסק לשלוח קישור חדש' USING ERRCODE = 'no_data_found';
  END IF;
  -- לא חותמים על פרטים שכבר לא נכונים
  CASE hospitality._contract_stale(c)
    WHEN 'changed' THEN
      IF c.origin = 'standalone' THEN
        RAISE EXCEPTION 'פרטי המסמך השתנו מאז שנשלח, ולכן אי אפשר לחתום עליו — העסק ישלח לכם מסמך מעודכן'
          USING ERRCODE = 'no_data_found';
      END IF;
      RAISE EXCEPTION 'פרטי ההזמנה / האירוע השתנו מאז שנשלח ההסכם, ולכן אי אפשר לחתום עליו — העסק ישלח לכם הסכם מעודכן'
        USING ERRCODE = 'no_data_found';
    WHEN 'unavailable' THEN
      IF c.origin = 'standalone' THEN
        RAISE EXCEPTION 'המסמך כבר לא בתוקף — לפרטים פנו לעסק' USING ERRCODE = 'no_data_found';
      END IF;
      RAISE EXCEPTION 'ההסכם כבר לא בתוקף (ההזמנה / האירוע בוטלו או השתנו) — לפרטים פנו לעסק'
        USING ERRCODE = 'no_data_found';
    ELSE NULL;
  END CASE;
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION hospitality._contract_by_token(text, boolean) FROM PUBLIC, anon, authenticated;

-- הפתיחה — כמו במיגרציה 64, ובנוסף: שם המסמך, המקור, דרך המילוי, ואילו פרטים הלקוח ממלא
CREATE OR REPLACE FUNCTION hospitality.contract_open(_token_hash text, _ip text DEFAULT NULL, _user_agent text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c hospitality.client_contracts := hospitality._contract_by_token(_token_hash, true);
BEGIN
  IF c.viewed_at IS NULL THEN
    UPDATE hospitality.client_contracts x SET status = 'viewed', viewed_at = now(), updated_at = now()
     WHERE x.id = c.id RETURNING * INTO c;
    PERFORM hospitality._contract_log(c.tenant_id, c.id, 'viewed', 'customer', NULL, _ip,
                                      jsonb_build_object('user_agent', left(_user_agent, 200)));
  END IF;
  RETURN jsonb_build_object(
    'number', c.number, 'kind', c.kind, 'title', hospitality._contract_doc_title(c.kind, c.template_version, c.data),
    'origin', c.origin, 'fill_mode', c.fill_mode,
    'business_name', c.data ->> 'business_name', 'business_phone', c.data ->> 'business_phone',
    'business_email', c.data ->> 'business_email',
    'signer_name', c.signer_name, 'signer_phone', c.signer_phone, 'signer_email', c.signer_email,
    'body', hospitality._contract_body(c.kind, c.template_version, c.data, '{}'::jsonb, NULL),
    'needs_deposit_method', c.kind = 'hosting' AND c.data ->> 'deposit_method' IS NULL,
    -- דרך ב': הלקוח כותב את השם, האימייל (חובה) והטלפון; בחוזה (לא במסמך מדיניות) — גם ת"ז וכתובת
    'needs_identity', c.fill_mode = 'customer',
    'needs_id_address', c.kind <> 'policy',
    'pool', hospitality._contract_pool(c),
    'id_label', CASE WHEN c.kind = 'pool_event' THEN 'תעודת זהות / ח.פ' ELSE 'תעודת זהות' END,
    'expires_at', hospitality._ts(c.token_expires_at));
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_open(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.contract_open(text, text, text) TO service_role;

-- החתימה — כמו במיגרציה 64 (פעם אחת, "קראתי ואני מסכים/ה", חתימה אמיתית, הנוסח עם טביעה), ובנוסף:
--   • דרך ב' — השם והאימייל (חובה) והטלפון שהלקוח כתב: בנוסח החתום ובפרטי החותם (לשם יישלח העותק);
--   • מסמך מדיניות — בלי ת"ז וכתובת (אישור קריאה והסכמה);
--   • התראה לבעל העסק: מייל (document_signed — לכתובות ההתראות של העסק) ו"לא נצפה" באזור הניהול
CREATE OR REPLACE FUNCTION hospitality.contract_sign(_token_hash text, _fields jsonb, _signature jsonb, _agreed boolean,
                                                     _ip text DEFAULT NULL, _user_agent text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c hospitality.client_contracts := hospitality._contract_by_token(_token_hash, true);
  _id_number text;
  _address text;
  _method text;
  _name text;
  _email text;
  _phone text;
  _f jsonb;
  _sig jsonb;
  _body text;
  _tz text;
  _old uuid;
  _owner text;
BEGIN
  IF _agreed IS NOT TRUE THEN
    RAISE EXCEPTION 'יש לאשר שקראתם את כל סעיפי ההסכם ושאתם מסכימים להם' USING ERRCODE = 'check_violation';
  END IF;
  IF _fields IS NULL OR jsonb_typeof(_fields) <> 'object' THEN
    RAISE EXCEPTION 'חסרים פרטים' USING ERRCODE = 'check_violation';
  END IF;
  IF c.fill_mode = 'customer' THEN
    _name := hospitality._contract_value(hospitality._cv_text(_fields -> 'full_name', 'השם המלא', 120, true));
    IF char_length(_name) < 2 THEN
      RAISE EXCEPTION 'נא למלא שם מלא' USING ERRCODE = 'check_violation';
    END IF;
    _email := hospitality.normalize_email(hospitality._cv_text(_fields -> 'email', 'האימייל', 254, true));
    IF _email IS NULL THEN
      RAISE EXCEPTION 'כתובת האימייל לא תקינה' USING ERRCODE = 'check_violation';
    END IF;
    _phone := hospitality._cv_text(_fields -> 'phone', 'הטלפון', 30, false);
    IF _phone IS NOT NULL AND hospitality.normalize_phone(_phone) IS NULL THEN
      RAISE EXCEPTION 'מספר הטלפון לא תקין' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF c.kind <> 'policy' THEN
    _id_number := regexp_replace(COALESCE(_fields ->> 'id_number', ''), '[^0-9]', '', 'g');
    IF NOT hospitality._il_id_ok(_id_number) THEN
      RAISE EXCEPTION 'מספר תעודת הזהות / ח.פ לא תקין' USING ERRCODE = 'check_violation';
    END IF;
    _address := hospitality._contract_value(hospitality._cv_text(_fields -> 'address', 'כתובת המגורים', 200, true));
    IF char_length(_address) < 4 THEN
      RAISE EXCEPTION 'נא למלא כתובת מגורים מלאה' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF c.kind = 'hosting' AND c.data ->> 'deposit_method' IS NULL THEN
    _method := hospitality._cv_choice(_fields -> 'deposit_method', 'אמצעי הפיקדון', ARRAY['cash', 'check', 'card']);
  END IF;
  IF _signature IS NULL OR jsonb_typeof(_signature) <> 'object' THEN
    RAISE EXCEPTION 'חסרה חתימה' USING ERRCODE = 'check_violation';
  END IF;
  IF _signature ->> 'kind' = 'drawn' THEN
    _sig := jsonb_build_object('kind', 'drawn', 'paths', hospitality._signature_paths(_signature -> 'paths', false));
  ELSIF _signature ->> 'kind' = 'typed' THEN
    _sig := jsonb_build_object('kind', 'typed', 'name',
                               hospitality._contract_value(hospitality._cv_text(_signature -> 'name', 'החתימה בהקלדה', 80, true)));
    IF char_length(_sig ->> 'name') < 2 THEN
      RAISE EXCEPTION 'כתבו את השם המלא כחתימה' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'חסרה חתימה' USING ERRCODE = 'check_violation';
  END IF;
  _f := CASE WHEN c.kind <> 'policy' THEN jsonb_build_object('id_number', lpad(_id_number, 9, '0'), 'address', _address)
             ELSE '{}'::jsonb END
        || CASE WHEN _method IS NOT NULL THEN jsonb_build_object('deposit_method', _method) ELSE '{}'::jsonb END
        || CASE WHEN c.fill_mode = 'customer'
                THEN jsonb_strip_nulls(jsonb_build_object('full_name', _name, 'email', _email, 'phone', _phone))
                ELSE '{}'::jsonb END;
  SELECT COALESCE(s.timezone, 'Asia/Jerusalem') INTO _tz FROM hospitality.settings s WHERE s.tenant_id = c.tenant_id;
  _body := hospitality._contract_body(c.kind, c.template_version, c.data, _f,
                                      to_char(now() AT TIME ZONE COALESCE(_tz, 'Asia/Jerusalem'), 'DD.MM.YYYY'));
  -- חוזה מתוקן: החוזה החתום שבתוקף לאותה הזמנה / לאותו אירוע "הוחלף" — לפני שהחדש מסומן חתום (חתום
  -- אחד בתוקף). גם כשבדרך הוחלפה טיוטה מתוקנת שלא נחתמה (A חתום → B מתוקן → C במקום B): C מחליף את A
  IF c.supersedes_id IS NOT NULL THEN
    FOR _old IN
      UPDATE hospitality.client_contracts x SET status = 'superseded', superseded_by_id = c.id, updated_at = now()
       WHERE x.tenant_id = c.tenant_id AND x.id <> c.id AND x.status = 'signed'
         AND ((c.booking_id IS NOT NULL AND x.booking_id = ANY (hospitality._contract_booking_ids(c.tenant_id, c.booking_id)))
              OR (c.event_id IS NOT NULL AND x.event_id = c.event_id))
      RETURNING x.id
    LOOP
      PERFORM hospitality._contract_log(c.tenant_id, _old, 'superseded', 'system', NULL, NULL,
                                        jsonb_build_object('by', c.id, 'by_number', c.number));
    END LOOP;
  END IF;
  UPDATE hospitality.client_contracts x
     SET status = 'signed', signed_at = now(), customer_fields = _f, signature = _sig, signed_body = _body,
         signed_body_sha256 = hospitality._text_hash(_body),
         signer_name = CASE WHEN c.fill_mode = 'customer' THEN _name ELSE x.signer_name END,
         signer_email = CASE WHEN c.fill_mode = 'customer' THEN _email ELSE x.signer_email END,
         signer_phone = CASE WHEN c.fill_mode = 'customer' THEN _phone ELSE x.signer_phone END,
         signer_ip = left(_ip, 64), signer_user_agent = left(_user_agent, 400), token_hash = NULL, updated_at = now()
   WHERE x.id = c.id
  RETURNING * INTO c;
  PERFORM hospitality._contract_log(c.tenant_id, c.id, 'signed', 'customer', NULL, _ip,
    jsonb_build_object('signature', _sig ->> 'kind', 'body_sha256', c.signed_body_sha256, 'user_agent', left(_user_agent, 200)));
  PERFORM hospitality._audit(c.tenant_id, 'contracts.signed', 'חוזה #' || c.number,
                             jsonb_build_object('kind', c.kind, 'signature', _sig ->> 'kind', 'origin', c.origin));
  -- ההתראה לבעל העסק (מייל) — פעם אחת לכל מסמך ולכל כתובת
  FOREACH _owner IN ARRAY COALESCE(hospitality._owner_emails(c.tenant_id), '{}') LOOP
    INSERT INTO hospitality.notifications (tenant_id, booking_id, event, recipient_kind, recipient_email, dedupe_key, payload)
    VALUES (c.tenant_id, NULL, 'document_signed', 'owner', _owner, 'document-signed:' || c.id || ':' || _owner,
            jsonb_build_object('contract_id', c.id, 'contract_number', c.number, 'kind', c.kind, 'origin', c.origin,
                               'title', hospitality._contract_doc_title(c.kind, c.template_version, c.data),
                               'signer_name', c.signer_name, 'signed_at', hospitality._ts(c.signed_at),
                               'link_number', COALESCE(c.data ->> 'booking_number', c.data ->> 'event_number')))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;
  RETURN jsonb_build_object('tenant_id', c.tenant_id, 'id', c.id, 'number', c.number, 'kind', c.kind);
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_sign(text, jsonb, jsonb, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.contract_sign(text, jsonb, jsonb, boolean, text, text) TO service_role;

-- ------------------------------------------------------------
-- 7. האזור האישי ("המסמכים שלי") — כמו במיגרציה 64, עם שם המסמך
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.guest_area_documents(_session_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  _e text := hospitality._guest_area_email(_t, _session_hash);
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
                     'id', c.id, 'number', c.number, 'kind', c.kind,
                     'title', hospitality._contract_doc_title(c.kind, c.template_version, c.data),
                     'signed_at', hospitality._ts(c.signed_at), 'status', c.status,
                     'service_date', c.data ->> 'service_date', 'event_purpose', c.data ->> 'event_purpose',
                     'has_pdf', c.pdf_path IS NOT NULL) ORDER BY c.signed_at DESC)
                     FROM hospitality.client_contracts c
                    WHERE c.tenant_id = _t AND c.signer_email_normalized = _e AND c.signed_at IS NOT NULL), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_area_documents(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.guest_area_documents(text) TO service_role;

-- ------------------------------------------------------------
-- 8. פרטיות: מחיקת פרטי לקוח והייצוא — גם המסמכים העצמאיים
-- ------------------------------------------------------------
-- כמו במיגרציה 64; ובנוסף — מסמכים שלא נחתמו בלי כרטיס (עצמאיים, דרך ב') לפי האימייל של הלקוח
CREATE OR REPLACE FUNCTION hospitality._anonymize_guest(_tenant_id uuid, _guest_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _email text := (SELECT g.email_normalized FROM hospitality.guests g WHERE g.tenant_id = _tenant_id AND g.id = _guest_id);
BEGIN
  IF EXISTS (SELECT 1 FROM hospitality.bookings b WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id
                AND hospitality._holding(b.status)) THEN
    RAISE EXCEPTION 'לאורח יש הזמנה פעילה או עתידית — אי אפשר למחוק את פרטיו עכשיו' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM hospitality.events e WHERE e.tenant_id = _tenant_id AND e.guest_id = _guest_id
                AND e.status IN ('pending', 'confirmed') AND e.ends_at > now()) THEN
    RAISE EXCEPTION 'ללקוח יש אירוע פעיל או עתידי — אי אפשר למחוק את פרטיו עכשיו' USING ERRCODE = 'check_violation';
  END IF;
  -- החוזים שלא נחתמו — לפני שמשנים את ההזמנות (כדי למצוא את כולם: לפי הכרטיס, ההזמנות, האירועים, והאימייל)
  DELETE FROM hospitality.client_contracts c
   WHERE c.tenant_id = _tenant_id AND c.signed_at IS NULL
     AND (c.guest_id = _guest_id
          OR c.booking_id IN (SELECT b.id FROM hospitality.bookings b WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id)
          OR c.event_id IN (SELECT e.id FROM hospitality.events e WHERE e.tenant_id = _tenant_id AND e.guest_id = _guest_id)
          OR (c.origin = 'standalone' AND c.guest_id IS NULL AND _email IS NOT NULL AND c.signer_email_normalized = _email));
  UPDATE hospitality.guests g
     SET full_name = 'אורח שנמחק', email = NULL, phone = NULL, notes = NULL, user_id = NULL,
         marketing_consent = false, anonymized_at = now()
   WHERE g.tenant_id = _tenant_id AND g.id = _guest_id AND g.anonymized_at IS NULL;
  UPDATE hospitality.bookings b
     -- PRV-6: גם ההערות של הצוות וסיבת הביטול שהאורח כתב (טקסט חופשי — יכול להכיל מידע רגיש)
     SET special_requests = NULL, notes = NULL, cancellation_reason = NULL,
         policy_acceptance = b.policy_acceptance - 'ip' - 'user_agent',
         manage_token_hash = NULL, manage_token2_hash = NULL, manage_token_expires_at = NULL
   WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id;
  UPDATE hospitality.events e
     SET internal_notes = NULL, cancel_reason = NULL, updated_at = now()
   WHERE e.tenant_id = _tenant_id AND e.guest_id = _guest_id
     AND (e.internal_notes IS NOT NULL OR e.cancel_reason IS NOT NULL);
  UPDATE hospitality.notifications n
     SET payload = '{}'::jsonb,
         recipient_email = CASE WHEN n.recipient_kind = 'guest' THEN 'anonymized@invalid.invalid' ELSE n.recipient_email END,
         status = CASE WHEN n.status IN ('queued', 'failed', 'sending') THEN 'dead' ELSE n.status END,
         last_error = CASE WHEN n.status IN ('queued', 'failed', 'sending') THEN 'guest anonymized' ELSE n.last_error END,
         updated_at = now()
   WHERE n.tenant_id = _tenant_id
     AND n.booking_id IN (SELECT b.id FROM hospitality.bookings b WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id);
END $$;
REVOKE ALL ON FUNCTION hospitality._anonymize_guest(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- הייצוא לבקשת הלקוח — כמו במיגרציה 64; החוזים — גם עצמאיים לפי האימייל של הלקוח (ושם המסמך והמקור)
CREATE OR REPLACE FUNCTION hospitality.export_guest(_guest_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('guests.privacy');
  g hospitality.guests;
BEGIN
  SELECT * INTO g FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = _guest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'האורח לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object(
    'guest', jsonb_build_object('full_name', g.full_name, 'email', g.email, 'phone', g.phone, 'notes', g.notes,
                                'marketing_consent', g.marketing_consent, 'created_at', hospitality._ts(g.created_at),
                                'anonymized_at', hospitality._ts(g.anonymized_at)),
    'bookings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'number', b.number, 'status', b.status, 'check_in', b.check_in, 'check_out', b.check_out,
                  'adults', b.adults, 'children', b.children, 'total', b.total, 'currency', b.currency,
                  'special_requests', b.special_requests, 'policy_acceptance', b.policy_acceptance,
                  'created_at', hospitality._ts(b.created_at),
                  'notes', b.notes, 'cancellation_reason', b.cancellation_reason,
                  'events', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                              'kind', e.kind, 'from_status', e.from_status, 'to_status', e.to_status,
                              'note', e.note, 'created_at', hospitality._ts(e.created_at)) ORDER BY e.created_at, e.id)
                            FROM hospitality.booking_events e WHERE e.tenant_id = _t AND e.booking_id = b.id), '[]'::jsonb),
                  'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                              'kind', p.kind, 'method', p.method, 'amount', p.amount, 'currency', p.currency,
                              'paid_at', p.paid_at, 'status', p.status, 'note', p.note,
                              'created_at', hospitality._ts(p.created_at)) ORDER BY p.created_at)
                            FROM hospitality.payments p WHERE p.tenant_id = _t AND p.booking_id = b.id), '[]'::jsonb)
                  ) ORDER BY b.check_in)
                FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.guest_id = g.id), '[]'::jsonb),
    -- מיגרציה 63: האירועים במתחם
    'pool_events', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'number', e.number, 'status', e.status, 'event_type', e.event_type, 'event_date', e.event_date,
                  'start_time', to_char(e.start_time, 'HH24:MI'), 'end_time', to_char(e.end_time, 'HH24:MI'),
                  'participants', e.participants, 'price', e.price, 'amount_paid', e.amount_paid,
                  'refund_amount', e.refund_amount, 'deposit_status', e.deposit_status,
                  'internal_notes', e.internal_notes, 'cancel_reason', e.cancel_reason,
                  'created_at', hospitality._ts(e.created_at)) ORDER BY e.starts_at)
                FROM hospitality.events e WHERE e.tenant_id = _t AND e.guest_id = g.id), '[]'::jsonb),
    -- החוזים והמסמכים (של הכרטיס, ההזמנות והאירועים שלו — ומסמכים עצמאיים לפי האימייל)
    'contracts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'number', c.number, 'kind', c.kind, 'template_version', c.template_version, 'status', c.status,
                  'title', hospitality._contract_doc_title(c.kind, c.template_version, c.data), 'origin', c.origin,
                  'signer_name', c.signer_name, 'signer_email', c.signer_email, 'signer_phone', c.signer_phone,
                  'sent_at', hospitality._ts(c.sent_at), 'signed_at', hospitality._ts(c.signed_at),
                  'customer_fields', c.customer_fields, 'signer_ip', c.signer_ip,
                  'signed_body_sha256', c.signed_body_sha256, 'has_pdf', c.pdf_path IS NOT NULL) ORDER BY c.created_at)
                FROM hospitality.client_contracts c
               WHERE c.tenant_id = _t
                 AND (c.guest_id = g.id
                      OR c.booking_id IN (SELECT b.id FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.guest_id = g.id)
                      OR c.event_id IN (SELECT e.id FROM hospitality.events e WHERE e.tenant_id = _t AND e.guest_id = g.id)
                      OR (c.origin = 'standalone' AND g.email_normalized IS NOT NULL
                          AND c.signer_email_normalized = g.email_normalized))),
              '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.export_guest(uuid) FROM PUBLIC, anon;

COMMIT;

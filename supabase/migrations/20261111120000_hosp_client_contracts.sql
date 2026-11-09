-- ============================================================
-- Hospitality — מסמכי לקוחות: חוזים לחתימה אלקטרונית (מיגרציה 64)
--
-- שני החוזים (המקור: החוזים של נופי דורית) הם תבניות לכל עסק צימרים, עם פרטי העסק מהחשבון:
--   • hosting@1 — "הסכם הזמנת אירוח ושכירות לטווח קצר" — לכל הזמנת לינה;
--   • pool_event@1 — "הסכם שכירות והזמנת אירוח - מתחם הבריכה לאירועים" — לכל אירוע (מיגרציה 63).
-- הנוסח נשמר כפי שהוא (contract_templates — לא משתנה); השדות הריקים בחוזים ("____") הם שדות דינמיים:
-- פרטי העסק, הלקוח, התאריכים, המחיר, הפיקדון. ההתאמה היחידה למבנה הדיגיטלי: תיבת "פרטי כרטיס האשראי"
-- בחוזה האירועים — הכותרת ונוסח ההרשאה נשארים, ופרטי הכרטיס עצמם נמסרים לעסק ישירות (לא נאספים
-- ולא נשמרים במערכת — PCI-DSS). מסומן לאישור בעל הפלטפורמה ובדיקה משפטית.
--
-- שמירה מפני טעות: סוג החוזה נקבע לפי מה שמקושר אליו — הזמנה → אירוח, אירוע → מתחם הבריכה (CHECK).
-- שמירה מפני שינוי בדיעבד: חוזה חתום לא משתנה (טריגר) — רק "הוחלף" (כשנחתם חוזה מתוקן), שליחת עותק,
-- ורישום ה-PDF פעם אחת. הנוסח החתום נשמר עם טביעת SHA-256, וגם ה-PDF.
-- הקישור לחתימה: אישי (רק טביעת SHA-256 שלו במסד), מוגבל בזמן (14 יום), לאתר של העסק בלבד, ומת
-- אחרי החתימה. השרת יוצר אותו ושולח אותו — הצוות לא רואה אותו (רק הלקוח במייל).
-- שליחה שנכשלה לא מסמנת "נשלח". חתימה כפולה — אחת בלבד (נעילה + הקישור מתבטל).
-- גישה: הרשאה חדשה contracts — לבעלים תמיד; למנהל רק אם הבעלים נתן לו (כמו נתונים כספיים).
-- הפעלה: הדגל hospitality_contracts_enabled (פלטפורמה + עסק) — כבוי עד אישור משפטי. בלעדיו: תצוגה
-- מקדימה בלבד, בלי שליחה ובלי חתימה. ובעל העסק מאשר את תנאי העסק (מיגרציה 63) לפני שליחה ראשונה.
-- קבצים: דלי פרטי hosp-contracts (בלי מדיניות — רק השרת); הורדה רק בקישור קצר-מועד מהשרת.
-- Rollback: supabase/rollbacks/20261111120000_hosp_client_contracts.down.sql (מסרב כשיש חוזים)
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 0. הדגל (כבוי) והרשאת contracts
-- ------------------------------------------------------------
INSERT INTO public.platform_feature_flags (key, enabled, description) VALUES
  ('hospitality_contracts_enabled', false,
   'Hospitality: חוזים לחתימה אלקטרונית (מסמכי לקוחות) — להפעיל רק אחרי אישור משפטי של נוסח החוזים')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE hospitality.staff_grants DROP CONSTRAINT IF EXISTS staff_grants_permission_check;
ALTER TABLE hospitality.staff_grants ADD CONSTRAINT staff_grants_permission_check
  CHECK (permission IN ('reports.finance', 'contracts'));

-- כמו במיגרציה 32, ועוד contracts
CREATE OR REPLACE FUNCTION hospitality.permissions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY['settings', 'policies', 'catalog', 'media', 'pricing', 'bookings', 'guests',
               'reports', 'staff.managers', 'billing.manage', 'guests.privacy', 'settings.owner',
               'catalog.owner', 'reports.finance', 'contracts']::text[];
$$;
REVOKE ALL ON FUNCTION hospitality.permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.permissions() TO authenticated, service_role;

-- כמו במיגרציה 32; contracts — כמו reports.finance: לבעלים תמיד, למנהל רק אם ניתנה לו במפורש
CREATE OR REPLACE FUNCTION hospitality.can(_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    _permission = ANY (hospitality.permissions())
    AND public.current_site_type() = 'hospitality'
    AND CASE public.store_staff_role(auth.uid())
          WHEN 'owner' THEN true
          WHEN 'manager' THEN CASE
            -- נתונים כספיים וחוזי לקוחות: רק מנהל שהבעלים נתן לו במפורש
            WHEN _permission IN ('reports.finance', 'contracts') THEN EXISTS (
              SELECT 1 FROM hospitality.staff_grants g
               WHERE g.tenant_id = public.current_tenant_id() AND g.user_id = auth.uid()
                 AND g.permission = _permission)
            ELSE _permission NOT IN ('staff.managers', 'billing.manage', 'guests.privacy',
                                     'settings.owner', 'catalog.owner')
          END
          ELSE false
        END,
    false);
$$;
REVOKE ALL ON FUNCTION hospitality.can(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.can(text) TO authenticated, service_role;

-- הצוות: כמו במיגרציה 32 + contracts (לבעלים תמיד; למנהל — אם ניתנה לו הרשאה)
CREATE OR REPLACE FUNCTION hospitality.team_members()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('staff.managers');
  _e jsonb := hospitality.entitlements(_t);
BEGIN
  RETURN jsonb_build_object(
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', ur.user_id,
               'role', CASE WHEN ur.is_protected THEN 'owner' ELSE 'manager' END,
               'display_name', ur.display_name, 'username', ur.username, 'email', lower(u.email),
               'is_blocked', ur.is_blocked, 'added_at', hospitality._ts(ur.created_at),
               'last_sign_in_at', hospitality._ts(u.last_sign_in_at),
               'finance', ur.is_protected OR EXISTS (
                 SELECT 1 FROM hospitality.staff_grants g
                  WHERE g.tenant_id = _t AND g.user_id = ur.user_id AND g.permission = 'reports.finance'),
               'contracts', ur.is_protected OR EXISTS (
                 SELECT 1 FROM hospitality.staff_grants g
                  WHERE g.tenant_id = _t AND g.user_id = ur.user_id AND g.permission = 'contracts'))
             ORDER BY ur.is_protected DESC, ur.created_at, ur.user_id)
        FROM public.user_roles ur
        JOIN auth.users u ON u.id = ur.user_id
       WHERE ur.tenant_id = _t AND ur.role = 'admin' AND NOT public.is_platform_admin(ur.user_id)), '[]'::jsonb),
    'seats', jsonb_build_object('used', _e -> 'managers_used', 'limit', _e -> 'max_managers', 'active', _e -> 'active'));
END $$;
REVOKE ALL ON FUNCTION hospitality.team_members() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.team_members() TO authenticated, service_role;

-- הבעלים נותן / מבטל למנהל גישה למסמכי הלקוחות (שליחה, ארכיון, הורדה)
CREATE OR REPLACE FUNCTION hospitality.team_set_contracts(_user_id uuid, _enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('staff.managers');
  r public.user_roles;
  _label text;
BEGIN
  IF _user_id IS NULL OR _enabled IS NULL THEN
    RAISE EXCEPTION 'חסרים פרטים' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO r FROM public.user_roles ur
   WHERE ur.tenant_id = _t AND ur.user_id = _user_id AND ur.role = 'admin'
     AND NOT public.is_platform_admin(ur.user_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המנהל לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF r.is_protected THEN
    RAISE EXCEPTION 'לבעלים יש תמיד גישה למסמכי הלקוחות' USING ERRCODE = 'check_violation';
  END IF;
  _label := COALESCE(NULLIF(btrim(r.display_name), ''), hospitality.mask_email(r.email), 'מנהל');
  IF _enabled THEN
    INSERT INTO hospitality.staff_grants (tenant_id, user_id, permission, granted_by)
    VALUES (_t, _user_id, 'contracts', auth.uid())
    ON CONFLICT (tenant_id, user_id, permission) DO NOTHING;
    IF FOUND THEN
      PERFORM hospitality._audit(_t, 'team.contracts_granted', _label, '{}'::jsonb);
    END IF;
  ELSE
    DELETE FROM hospitality.staff_grants g
     WHERE g.tenant_id = _t AND g.user_id = _user_id AND g.permission = 'contracts';
    IF FOUND THEN
      PERFORM hospitality._audit(_t, 'team.contracts_revoked', _label, '{}'::jsonb);
    END IF;
  END IF;
  RETURN hospitality.team_members();
END $$;
REVOKE ALL ON FUNCTION hospitality.team_set_contracts(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.team_set_contracts(uuid, boolean) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 1. התבניות (לכל הפלטפורמה; לא משתנות — גרסה חדשה = שורה חדשה)
-- ------------------------------------------------------------
-- סימון: "# " כותרת · "^ " שורת משנה · "## " סעיף · "- " נקודה · "**…**" שורה מודגשת · "> " תיבה ·
-- "[[signatures]]" אזור החתימות · {{שדה}} — שדה דינמי (ריק → "________") · {{unit_lines}} בשורה
-- משלה — רשימת היחידות (שורה לכל יחידה)
CREATE TABLE IF NOT EXISTS hospitality.contract_templates (
  key        text NOT NULL CHECK (key IN ('hosting', 'pool_event')),
  version    integer NOT NULL CHECK (version >= 1),
  title      text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 160),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 100 AND 60000),
  body_hash  text GENERATED ALWAYS AS (hospitality._text_hash(body)) STORED,
  source     text NOT NULL CHECK (char_length(source) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, version)
);
COMMENT ON TABLE hospitality.contract_templates IS
  'Hospitality (מיגרציה 64): נוסחי החוזים (מקור: החוזים של נופי דורית) — לא משתנים; רק דרך פונקציות';
ALTER TABLE hospitality.contract_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hospitality.contract_templates FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.contract_templates_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'נוסח חוזה לא משתנה — גרסה חדשה נוספת כשורה חדשה' USING ERRCODE = 'insufficient_privilege';
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_templates_frozen() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS contract_templates_frozen ON hospitality.contract_templates;
CREATE TRIGGER contract_templates_frozen BEFORE UPDATE OR DELETE ON hospitality.contract_templates
FOR EACH ROW EXECUTE FUNCTION hospitality.contract_templates_frozen();

INSERT INTO hospitality.contract_templates (key, version, title, source, body) VALUES
('hosting', 1, 'הסכם הזמנת אירוח ושכירות לטווח קצר', 'החוזה "הסכם הזמנת אירוח ושכירות לטווח קצר" של נופי דורית חוויה בכפר', $tpl$# הסכם הזמנת אירוח ושכירות לטווח קצר
^ {{business_name}} • {{compound_address}}

שנערך ונחתם ביום: {{signing_date}}

## בין:
**צד א' (המשכיר):**
- שם העסק: {{business_name}}
- נציג מורשה: {{representative_name}}
- עוסק מורשה: {{business_tax_id}}
- כתובת המתחם: {{compound_address}}
- טלפון: {{business_phone}}
- מייל: {{business_email}}

## לבין:
**צד ב' (השוכר / המזמין):**
- שם מלא: {{signer_name}}
- תעודת זהות: {{signer_id_number}}
- כתובת מגורים: {{signer_address}}
- טלפון נייד: {{signer_phone}}

הואיל והמשכיר הינו הבעלים והמפעיל של מתחם הנופש "{{business_name}}" ב{{compound_address}}, הכולל {{units_recital}}, בריכת שחייה משותפת, {{facilities}} (להלן: "המושכר" או "המתחם");

והואיל והשוכר מעוניין לשכור את המושכר (או חלק ממנו כפי שיפורט להלן) למטרת נופש, אירוח או אירוע מותר, לתקופה קצרה וקצובה ובתנאים המפורטים בהסכם זה;

והואיל ובמתחם מותקנות מצלמות אבטחה בשטחים הציבוריים לשמירה על הביטחון והרכוש, והשוכר נותן לכך את הסכמתו המלאה;

לפיכך הוסכם והותנה בין הצדדים כדלקמן:

## 1. פירוט יחידות האירוח ומכסת אורחים
{{unit_lines}}
- תכולת המתחם המלאה: האירוח ללינה במתחם כולו מוגבל לעד {{max_lodging_guests}} אורחים לכל היותר (אלא אם סוכם אחרת בכתב עבור מסיבה/אירוע).
- הצימר/ים המוזמנים במסגרת הסכם זה: {{units_selected}}

## 2. תקופת השכירות ושעות פעילות
- השכירות הינה למספר לילות: {{nights}} החל מתאריך: {{check_in_date}} ועד לתאריך: {{check_out_date}}.
- שעת כניסה (Check-in): החל מהשעה {{check_in_time}}.
- שעת יציאה (Check-out): עד השעה {{check_out_time}} בבוקר.
- איחור בפינוי שלא אושר מראש ובכתב יגרור חיוב של {{lodging_late_fee}} ₪ לכל שעת איחור.

## 3. תמורה, תנאי תשלום ומדיניות ביטולים
- סך התמורה המוסכמת עבור האירוח הינה בסך של {{price}} ₪.
- מדיניות ביטולים: ביטול הזמנה עד {{free_cancellation_days}} יום לפני מועד האירוח יזכה את השוכר בהחזר כספי מלא. ביטול בפרק זמן קצר מ-{{free_cancellation_days}} יום יחויב בדמי ביטול בהתאם למדיניות המקום וחוק הגנת הצרכן.

## 4. אירועים ומסיבות במתחם
- קיומן של מסיבות או אירועים במתחם מותר בתיאום מראש בלבד מול הנהלת המתחם.
- אירוע או מסיבה מוגבלים לעד {{max_event_guests}} אורחים לכל היותר בשטח המתחם.
- קיומו של אירוע/מסיבה כרוך בתשלום נוסף בסך של {{event_fee}} ₪ אשר ישולם מראש.

## 5. כללי התנהגות, עישון ובעלי חיים
- חל איסור מוחלט על עישון בתוך הצימרים! העישון מותר אך ורק מחוץ לצימרים, בשטחי החצר הפתוחים.
- חל איסור מוחלט על הכנסת בעלי חיים מכל סוג שהוא למתחם הצימרים והחצר.
- השוכר ואורחיו מתחייבים לשמור על שלמות ותקינות מתקני המתחם: {{facilities_definite}}. השימוש במתקנים אלו (ובפרט בטרמפולינה) באחריות השוכר בלבד.

## 6. פיקדון וערבות לנזקים
לשם הבטחת קיום תנאי החוזה ושמירה על שלמות המושכר, נדרש השוכר להפקיד פיקדון או ערבות לנזקים בסך קבוע של {{deposit_amount}} ₪. הפיקדון יימסר באמצעות {{deposit_method}}. הפיקדון יוחזר במלואו לאחר פינוי המתחם ובדיקתו, במידה ולא נגרמו נזקים.

## 7. מגבלות רעש וחוקי המדינה
השוכר מתחייב להקפיד על חוקי מניעת הרעש של משטרת ישראל והרשות המקומית. חל איסור על הפעלת מערכות הגברה ורמקולים מוגברים בחצר הפתוחה. במקרה של הפרת החוק והגעת רשויות החוק, השוכר יישא במלוא גובה הקנס והמשכיר יהיה רשאי להפסיק את האירוח באופן מיידי ללא החזר כספי.

## 8. הנחיות בטיחות ואחריות בלעדית בבריכת השחייה המשותפת
- שעות פעילות הבריכה: הבריכה זמינה לשימוש בין השעות {{pool_open_time}} בבוקר ועד {{pool_close_time}} בערב בלבד. חל איסור מוחלט על כניסה למים מחוץ לשעות אלו.
- מובהר ומודגש בזאת כי אין שירותי מציל בבריכת השחייה. השימוש בבריכה הינו באחריותם המלאה והבלעדית של השוכר ואורחיו.
- חל איסור גמור על כניסת ילדים מתחת לגיל 12 למתחם הבריכה ללא ליווי ופיקוח צמוד, פעיל ורציף של הורה או מבוגר אחראי מטעמם.
- חל איסור מוחלט על הכנסת כלי זכוכית, בקבוקים או כוסות שבירות לשטח הבריכה והחצר הסמוכה לה.
- השוכר פוטר את המשכיר פטור מלא מכל אחריות בגין כל פציעה, תאונה או נזק גוף שיגרמו בתוך הבריכה או בסביבתה במהלך תקופת השכירות.

[[signatures]]$tpl$),
('pool_event', 1, 'הסכם שכירות והזמנת אירוח - מתחם הבריכה לאירועים', 'החוזה "הסכם שכירות והזמנת אירוח - מתחם הבריכה לאירועים" של נופי דורית חוויה בכפר', $tpl$# הסכם שכירות והזמנת אירוח - מתחם הבריכה לאירועים
^ {{business_name}} • {{compound_address}}

שנערך ונחתם ביום: {{signing_date}}

## בין:
**צד א' (המשכיר):**
- שם העסק: {{business_name}}
- נציג מורשה: {{representative_name}}
- עוסק מורשה: {{business_tax_id}}
- כתובת המתחם: {{compound_address}}
- טלפון: {{business_phone}}
- מייל: {{business_email}}

## לבין:
**צד ב' (השוכר / המזמין):**
- שם מלא / חברה: {{signer_name}}
- תעודת זהות / ח.פ: {{signer_id_number}}
- כתובת מגורים: {{signer_address}}
- טלפון נייד: {{signer_phone}}

הואיל והמשכיר הינו הבעלים והמפעיל של מתחם הנופש והאירועים "{{business_name}}" ב{{compound_address}}, ומעמיד להשכרה את מתחם הבריכה החיצוני, כולל {{facilities}} (להלן: "מתחם הבריכה");

והואיל והשוכר מעוניין לשכור את מתחם הבריכה בלבד לצורך קיום אירוע/מסיבה מוגדרים מראש, ללא לינה ביחידות הצימרים, לתקופה קצובה ובתנאים המפורטים בהסכם זה להלן;

והואיל ובמתחם מותקנות מצלמות אבטחה בשטחים הציבוריים לשמירה על הסדר, הביטחון והרכוש, והשוכר נותן לכך את הסכמתו המלאה;

לפיכך הוסכם והותנה בין הצדדים כדלקמן:

## 1. מהות ההזמנה, היקף האורחים ומטרת האירוע
- השכירות הינה עבור שימוש מוגדר במתחם הבריכה החיצוני והמתקנים הנלווים בלבד.
- הסכם זה אינו כולל שימוש או כניסה לתוך {{units_count_text}} שבמתחם, ואלו יישארו סגורים או לשימוש נפרד, אלא אם הוסכם אחרת מראש ובכתב.
- מהות האירוע (לדוגמה: יום הולדת / ערב חברה / מסיבה): {{event_purpose}}.
- מכסת אורחים מקסימלית: כמות המשתתפים באירוע מוגבלת לעד {{max_event_guests}} אורחים לכל היותר. חל איסור מוחלט על הכנסת אורחים מעבר למכסה זו.

## 2. מועד האירוח ושעות פעילות
- האירוע יתקיים בתאריך: {{event_date}} בין השעות: {{start_time}} ועד השעה: {{end_time}}.
- שעות פעילות הבריכה המותרות הן בין {{pool_open_time}} ל-{{pool_close_time}} בלבד. חל איסור מוחלט על שהייה במים מחוץ לשעות אלו.
- השוכר מתחייב לפנות את המתחם מאורחים ומציוד אישי בדיוק בשעת הסיום שנקבעה. כל שעת איחור בפינוי תגרור חיוב מוסכם של {{event_late_fee}} ₪.

## 3. תמורה, תנאי תשלום ומדיניות ביטולים
- סך התמורה המוסכמת עבור השכרת מתחם הבריכה לאירוע הינה בסך של {{price}} ₪.
- מדיניות ביטולים: ביטול הזמנה עד {{free_cancellation_days}} יום לפני מועד האירוע יזכה את השוכר בהחזר כספי מלא. ביטול בפרק זמן קצר מ-{{free_cancellation_days}} יום יחויב בדמי ביטול מלאים בהתאם למדיניות העסק.

## 4. פיקדון וערבות לנזקים
לשם הבטחת שמירת שלמות המתחם, ניקיונו ועמידה בתנאי החוזה, יפקיד השוכר במעמד חתימת הסכם זה פיקדון או ערבות לנזקים בסך קבוע של {{deposit_amount}} ₪. הפיקדון יובטח באמצעות מילוי פרטי כרטיס האשראי בתחתית חוזה זה. המשכיר יהיה רשאי לבצע תפיסת מסגרת אשראי או לחייב את הכרטיס בגין נזקים מוכחים, אובדן ציוד, או איחור חריג בפינוי המתחם.

## 5. כללי התנהגות, עישון, בעלי חיים ומתקנים
- חל איסור מוחלט על הכנסת בעלי חיים מכל סוג שהוא לשטח המתחם והבריכה.
- העישון מותר בשטחי החצר הפתוחים בלבד, תוך הקפדה על השלכת בדלים לפח.
- השוכר אחראי לשמירה על שלמות ותקינות כלל מתקני החצר המועמדים לרשותו: {{facilities_definite}}. השימוש במתקנים אלו (ובפרט בטרמפולינה) הינו באחריות השוכר ואורחיו בלבד.
- השוכר מתחייב להחזיר את המתחם במצב סביר ונקי מאשפה. כל האשפה מהאירוע תרוכז ותפונה לפחים החיצוניים בסיום.

## 6. מגבלות רעש, חוקי הגברה ומשטרה
- השוכר מתחייב להישמע לחוקי מניעת הרעש של משטרת ישראל והרשות המקומית. חל איסור מוחלט על הפעלת מערכות הגברה חיצוניות, רמקולים מוגברים עצמאיים או קריוקי בשטח החצר הפתוחה.
- מוזיקה תושמע אך ורק דרך מערכת השמע המקומית של המתחם (אם קיימת) ובווליום סביר שאינו מפריע לסביבה, או בהתאם להנחיות המפורשות של המשכיר.
- במקרה של הגעת רשויות החוק או הפיקוח עקב רעש חריג, השוכר יישא במלוא גובה הקנס והמשכיר יהיה רשאי להפסיק את האירוע לאלתר ללא כל החזר כספי.

## 7. הנחיות בטיחות ואחריות בלעדית בבריכת השחייה
- מובהר ומודגש בזאת כי אין שירותי מציל בבריכת השחייה! השימוש בבריכה הינו באחריותם המלאה והבלעדית של השוכר ואורחיו בלבד.
- השוכר מצהיר כי הוא נושא באחריות שילוחית וחוקית מלאה לשלומם ובריאותם של כלל המוזמנים מטעמו ומחויב למנות מבוגר אחראי שיפקח על הנעשה בבריכה לאורך כל האירוע.
- חל איסור גמור על כניסת ילדים מתחת לגיל 12 למתחם הבריכה ללא ליווי ופיקוח צמוד, פעיל ורציף של הורה או מבוגר אחראי מטעמם.
- חל איסור מוחלט על הכנסת כלי זכוכית, בקבוקים שבירים או כוסות זכוכית לשטח הבריכה והרחבה הסמוכה לה (יש להשתמש בכלים חד-פעמיים או קשיחים שאינם שבירים).
- השוכר פוטר את המשכיר ({{business_name}} / {{representative_name}}) פטור מלא ומוחלט מכל אחריות (אזרחית או פלילית) בגין כל פציעה, תאונה, טביעה או נזק גוף שיגרמו בתוך הבריכה או בשטח המתחם במהלך האירוע, וישמש כשיפוי מלא למשכיר מפני כל תביעת צד ג'.

## פרטי כרטיס אשראי לביטחון ופיקדון (חובה)
השוכר מאשר בזאת למשכיר להחזיק בפרטים אלו כערבון לקיום תנאי החוזה ולחייבם במקרה של נזק מוכח או הפרת סעיף הפיקדון.
> פרטי הכרטיס — שם בעל הכרטיס, מספר הכרטיס, תוקף (חודש/שנה), 3 הספרות בגב הכרטיס (CVV) ותעודת הזהות של בעל הכרטיס — נמסרים לעסק ישירות (בטלפון או במסוף התשלום), ואינם נאספים ואינם נשמרים במערכת החתימה הדיגיטלית.

[[signatures]]$tpl$)
ON CONFLICT (key, version) DO NOTHING;

-- ------------------------------------------------------------
-- 2. החוזים, ההיסטוריה שלהם והדלי
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.client_contracts (
  id                 uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  number             integer NOT NULL CHECK (number > 1000),
  kind               text NOT NULL CHECK (kind IN ('hosting', 'pool_event')),
  template_version   integer NOT NULL,
  booking_id         uuid,
  event_id           uuid,
  guest_id           uuid,
  -- החותם (צד ב') כפי שהעסק שלח; הלקוח משלים בחתימה את מה שחסר (ת"ז, כתובת)
  signer_name        text NOT NULL CHECK (char_length(signer_name) BETWEEN 2 AND 120),
  signer_email       text NOT NULL CHECK (char_length(signer_email) <= 254),
  signer_email_normalized text GENERATED ALWAYS AS (hospitality.normalize_email(signer_email)) STORED,
  signer_phone       text CHECK (signer_phone IS NULL OR char_length(signer_phone) <= 30),
  -- כל הערכים לחוזה (פרטי העסק, ההזמנה / האירוע, המחיר, התנאים) — נקבעו ביום השליחה
  data               jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND pg_column_size(data) <= 32768),
  -- מה שהלקוח מילא בחתימה (ת"ז / ח"פ, כתובת, אמצעי הפיקדון אם העסק לא קבע)
  customer_fields    jsonb CHECK (customer_fields IS NULL OR (jsonb_typeof(customer_fields) = 'object'
                                                              AND pg_column_size(customer_fields) <= 4096)),
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'sent', 'viewed', 'signed', 'superseded', 'cancelled')),
  token_hash         text CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'),
  token_expires_at   timestamptz,
  sent_at            timestamptz,
  last_sent_at       timestamptz,
  send_count         integer NOT NULL DEFAULT 0 CHECK (send_count >= 0),
  send_error         text CHECK (send_error IS NULL OR char_length(send_error) <= 300),
  viewed_at          timestamptz,
  signed_at          timestamptz,
  signed_body        text CHECK (signed_body IS NULL OR char_length(signed_body) <= 80000),
  signed_body_sha256 text CHECK (signed_body_sha256 IS NULL OR signed_body_sha256 ~ '^[0-9a-f]{64}$'),
  -- {"kind": "drawn", "paths": [...]} או {"kind": "typed", "name": "…"}
  signature          jsonb CHECK (signature IS NULL OR (jsonb_typeof(signature) = 'object'
                                                        AND pg_column_size(signature) <= 65536)),
  signer_ip          text CHECK (signer_ip IS NULL OR char_length(signer_ip) <= 64),
  signer_user_agent  text CHECK (signer_user_agent IS NULL OR char_length(signer_user_agent) <= 400),
  pdf_path           text CHECK (pdf_path IS NULL OR pdf_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'),
  pdf_sha256         text CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_size           integer CHECK (pdf_size IS NULL OR pdf_size BETWEEN 1 AND 20000000),
  copy_sent_at       timestamptz,
  copy_error         text CHECK (copy_error IS NULL OR char_length(copy_error) <= 300),
  copy_count         integer NOT NULL DEFAULT 0 CHECK (copy_count >= 0),
  supersedes_id      uuid,
  superseded_by_id   uuid,
  cancel_reason      text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 300),
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  -- החוזה הנכון לסוג ההזמנה: לינה — אירוח, אירוע — מתחם הבריכה. אף פעם לא הפוך
  CHECK (CASE kind WHEN 'hosting' THEN booking_id IS NOT NULL AND event_id IS NULL
                   ELSE event_id IS NOT NULL AND booking_id IS NULL END),
  -- נחתם → יש זמן חתימה; הוחלף — לפני החתימה או אחריה; כל השאר — עוד לא נחתם
  CHECK (CASE status WHEN 'signed' THEN signed_at IS NOT NULL WHEN 'superseded' THEN true ELSE signed_at IS NULL END),
  CHECK (signed_at IS NULL OR (signed_body IS NOT NULL AND signed_body_sha256 IS NOT NULL AND signature IS NOT NULL
                               AND customer_fields IS NOT NULL AND token_hash IS NULL)),
  CHECK (token_hash IS NULL OR token_expires_at IS NOT NULL),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES hospitality.bookings (tenant_id, id),
  FOREIGN KEY (tenant_id, event_id) REFERENCES hospitality.events (tenant_id, id),
  FOREIGN KEY (tenant_id, guest_id) REFERENCES hospitality.guests (tenant_id, id) ON DELETE SET NULL (guest_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS client_contracts_token ON hospitality.client_contracts (token_hash) WHERE token_hash IS NOT NULL;
-- חוזה פתוח אחד לכל הזמנה / אירוע (שליחה נוספת — "שליחה חוזרת" או "חוזה מתוקן"), וחתום אחד בתוקף
CREATE UNIQUE INDEX IF NOT EXISTS client_contracts_open_booking ON hospitality.client_contracts (tenant_id, booking_id)
  WHERE booking_id IS NOT NULL AND status IN ('draft', 'sent', 'viewed');
CREATE UNIQUE INDEX IF NOT EXISTS client_contracts_open_event ON hospitality.client_contracts (tenant_id, event_id)
  WHERE event_id IS NOT NULL AND status IN ('draft', 'sent', 'viewed');
CREATE UNIQUE INDEX IF NOT EXISTS client_contracts_signed_booking ON hospitality.client_contracts (tenant_id, booking_id)
  WHERE booking_id IS NOT NULL AND status = 'signed';
CREATE UNIQUE INDEX IF NOT EXISTS client_contracts_signed_event ON hospitality.client_contracts (tenant_id, event_id)
  WHERE event_id IS NOT NULL AND status = 'signed';
CREATE INDEX IF NOT EXISTS client_contracts_email_idx ON hospitality.client_contracts (tenant_id, signer_email_normalized);
COMMENT ON TABLE hospitality.client_contracts IS
  'Hospitality (מיגרציה 64): חוזים ללקוחות — טיוטה, נשלח, נצפה, נחתם (לא משתנה), הוחלף, בוטל; רק דרך פונקציות';

CREATE TABLE IF NOT EXISTS hospitality.client_contract_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL,
  action      text NOT NULL CHECK (action ~ '^[a-z_]{3,40}$'),
  actor_kind  text NOT NULL CHECK (actor_kind IN ('staff', 'customer', 'system')),
  actor_id    uuid,
  ip          text CHECK (ip IS NULL OR char_length(ip) <= 64),
  details     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(details) <= 4096),
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, contract_id) REFERENCES hospitality.client_contracts (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS client_contract_log_idx ON hospitality.client_contract_log (tenant_id, contract_id, id);
COMMENT ON TABLE hospitality.client_contract_log IS 'Hospitality (מיגרציה 64): היסטוריית החוזה (רק הוספה)';

CREATE OR REPLACE FUNCTION hospitality.client_contract_log_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR pg_catalog.pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'היסטוריית החוזה לא ניתנת לשינוי' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION hospitality.client_contract_log_append_only() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS client_contract_log_append_only ON hospitality.client_contract_log;
CREATE TRIGGER client_contract_log_append_only BEFORE UPDATE OR DELETE ON hospitality.client_contract_log
FOR EACH ROW EXECUTE FUNCTION hospitality.client_contract_log_append_only();

-- חוזה חתום לא משתנה: מותר רק "הוחלף" (ומי החליף), עותק שנשלח, ורישום ה-PDF פעם אחת. ולא נמחק
-- (רק כחלק ממחיקת האתר כולו)
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
        NEW.signature, NEW.signer_ip, NEW.signer_user_agent, NEW.number, NEW.supersedes_id, NEW.created_at)
       IS DISTINCT FROM
       (OLD.kind, OLD.template_version, OLD.booking_id, OLD.event_id, OLD.signer_name, OLD.signer_email,
        OLD.signer_phone, OLD.data, OLD.customer_fields, OLD.signed_at, OLD.signed_body, OLD.signed_body_sha256,
        OLD.signature, OLD.signer_ip, OLD.signer_user_agent, OLD.number, OLD.supersedes_id, OLD.created_at)
       OR (OLD.pdf_path IS NOT NULL AND (NEW.pdf_path, NEW.pdf_sha256, NEW.pdf_size)
                                        IS DISTINCT FROM (OLD.pdf_path, OLD.pdf_sha256, OLD.pdf_size))
       OR NOT (NEW.status = OLD.status OR (OLD.status = 'signed' AND NEW.status = 'superseded')) THEN
      RAISE EXCEPTION 'חוזה חתום לא משתנה — אפשר להפיק חוזה מתוקן לחתימה מחדש' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.client_contracts_guard() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS client_contracts_guard ON hospitality.client_contracts;
CREATE TRIGGER client_contracts_guard BEFORE UPDATE OR DELETE ON hospitality.client_contracts
FOR EACH ROW EXECUTE FUNCTION hospitality.client_contracts_guard();

DO $$
DECLARE _tbl text;
BEGIN
  FOREACH _tbl IN ARRAY ARRAY['client_contracts', 'client_contract_log'] LOOP
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

-- הדלי הפרטי: PDF בלבד, בלי שום מדיניות Storage — רק מפתח השירות (השרת) קורא וכותב
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('hosp-contracts', 'hosp-contracts', false, 10485760, ARRAY['application/pdf'])
    ON CONFLICT (id) DO UPDATE
      SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. עזרים: ת"ז, סכומים, נוסח, הערכים לחוזה
-- ------------------------------------------------------------
-- תעודת זהות / ח"פ ישראלי: עד 9 ספרות (משלימים אפסים משמאל) + ספרת ביקורת
CREATE OR REPLACE FUNCTION hospitality._il_id_ok(_id text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  d text := lpad(COALESCE(_id, ''), 9, '0');
  s integer := 0;
  x integer;
BEGIN
  IF COALESCE(_id, '') !~ '^[0-9]{5,9}$' THEN
    RETURN false;
  END IF;
  FOR i IN 1..9 LOOP
    x := substr(d, i, 1)::integer * CASE WHEN i % 2 = 1 THEN 1 ELSE 2 END;
    s := s + CASE WHEN x > 9 THEN x - 9 ELSE x END;
  END LOOP;
  RETURN s % 10 = 0;
END $$;
REVOKE ALL ON FUNCTION hospitality._il_id_ok(text) FROM PUBLIC, anon, authenticated;

-- "3,500" / "3,500.50"
CREATE OR REPLACE FUNCTION hospitality._money_text(_n numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN _n IS NULL THEN NULL
              WHEN _n = trunc(_n) THEN to_char(_n, 'FM999,999,999,990')
              ELSE to_char(_n, 'FM999,999,999,990.00') END;
$$;
REVOKE ALL ON FUNCTION hospitality._money_text(numeric) FROM PUBLIC, anon, authenticated;

-- ערך לחוזה: שורה אחת, בלי סימוני המבנה ({{ }}, [[ ]}) — כך ערך לא "פותח" סעיף חדש
CREATE OR REPLACE FUNCTION hospitality._contract_value(_v text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NULLIF(btrim(replace(replace(replace(replace(regexp_replace(COALESCE(_v, ''), '\s+', ' ', 'g'),
                '{{', '{'), '}}', '}'), '[[', '['), ']]', ']')), '');
$$;
REVOKE ALL ON FUNCTION hospitality._contract_value(text) FROM PUBLIC, anon, authenticated;

-- הנוסח עם הערכים: {{שדה}} → הערך (ריק → "________"); {{unit_lines}} בשורה משלה → שורה לכל יחידה
CREATE OR REPLACE FUNCTION hospitality._contract_render(_body text, _vars jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  _out text := _body;
  k text;
  v jsonb;
  _lines text;
BEGIN
  SELECT string_agg('- ' || hospitality._contract_value(x #>> '{}'), E'\n' ORDER BY i) INTO _lines
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_vars -> 'unit_lines') = 'array' THEN _vars -> 'unit_lines'
                                   ELSE '[]'::jsonb END) WITH ORDINALITY e(x, i)
   WHERE hospitality._contract_value(x #>> '{}') IS NOT NULL;
  _out := regexp_replace(_out, '(^|\n)\{\{unit_lines\}\}(\n|$)', '\1' || COALESCE(_lines, '- ________') || '\2');
  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(_vars) e WHERE e.key <> 'unit_lines' LOOP
    _out := replace(_out, '{{' || k || '}}', COALESCE(hospitality._contract_value(v #>> '{}'), '________'));
  END LOOP;
  RETURN regexp_replace(_out, '\{\{[a-z_]+\}\}', '________', 'g');
END $$;
REVOKE ALL ON FUNCTION hospitality._contract_render(text, jsonb) FROM PUBLIC, anon, authenticated;

-- אפשרויות סימון ("☒ מזומן / ☐ צ'ק ביטחון / …")
CREATE OR REPLACE FUNCTION hospitality._contract_choices(_options text[], _chosen text[])
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT string_agg(CASE WHEN o = ANY (COALESCE(_chosen, ARRAY[]::text[])) THEN '☒ ' ELSE '☐ ' END || o, ' / ' ORDER BY i)
    FROM unnest(_options) WITH ORDINALITY u(o, i);
$$;
REVOKE ALL ON FUNCTION hospitality._contract_choices(text[], text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._deposit_method_label(_m text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE _m WHEN 'cash' THEN 'מזומן' WHEN 'check' THEN 'צ''ק ביטחון'
                 WHEN 'card' THEN 'כרטיס אשראי (תפיסת מסגרת)' END;
$$;
REVOKE ALL ON FUNCTION hospitality._deposit_method_label(text) FROM PUBLIC, anon, authenticated;

-- ("אדיר", "מוריה" ו"גן עדן")
CREATE OR REPLACE FUNCTION hospitality._quoted_list(_names text[])
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN cardinality(_names) = 0 THEN NULL
              WHEN cardinality(_names) = 1 THEN '"' || _names[1] || '"'
              ELSE array_to_string((SELECT array_agg('"' || n || '"' ORDER BY i)
                                      FROM unnest(_names[1:cardinality(_names) - 1]) WITH ORDINALITY u(n, i)), ', ')
                   || ' ו"' || _names[cardinality(_names)] || '"' END;
$$;
REVOKE ALL ON FUNCTION hospitality._quoted_list(text[]) FROM PUBLIC, anon, authenticated;

-- הערכים לחוזה ביום השליחה (מחרוזות — כפי שיופיעו): פרטי העסק, החותם, ההזמנה / האירוע, התנאים.
-- חסר פרט שהחוזה חייב (כתובת, טלפון, מייל, נציג, עוסק, יחידות לחוזה אירוח) — שגיאה בעברית
CREATE OR REPLACE FUNCTION hospitality._contract_data(_t uuid, _kind text, _booking uuid, _event uuid,
                                                      _signer jsonb, _options jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s hospitality.settings;
  r hospitality.business_terms := hospitality._terms(_t);
  lp hospitality.site_legal_profile;
  e hospitality.events;
  b hospitality.bookings;
  _d jsonb;
  _address text;
  _tax text;
  _lines jsonb;
  _names text[];
  _booked uuid[];
  _whole boolean := false;
  _total numeric;
  _in date;
  _out date;
  _method text := NULLIF(_options ->> 'deposit_method', '');
  _event_fee numeric;
BEGIN
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  SELECT * INTO lp FROM hospitality.site_legal_profile x WHERE x.tenant_id = _t;
  _tax := COALESCE(r.business_tax_id, NULLIF(regexp_replace(COALESCE(lp.registration_id, ''), '[^0-9]', '', 'g'), ''));
  IF NULLIF(btrim(COALESCE(s.business_name, '')), '') IS NULL OR NULLIF(btrim(COALESCE(s.contact_phone, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(s.contact_email, '')), '') IS NULL THEN
    RAISE EXCEPTION 'חסרים פרטי העסק לחוזה (שם, טלפון, מייל) — השלימו ב"הגדרות העסק"' USING ERRCODE = 'check_violation';
  END IF;
  IF r.representative_name IS NULL OR _tax IS NULL THEN
    RAISE EXCEPTION 'חסרים פרטי צד א'' לחוזה: שם הנציג המורשה ומספר העוסק — השלימו ב"תנאים ופרטי החוזה"'
      USING ERRCODE = 'check_violation';
  END IF;
  IF _method IS NOT NULL AND _method NOT IN ('cash', 'check', 'card') THEN
    RAISE EXCEPTION 'אמצעי הפיקדון לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  IF _options ? 'event_fee' AND jsonb_typeof(_options -> 'event_fee') <> 'null' THEN
    _event_fee := hospitality._cv_money(_options -> 'event_fee', 'התשלום הנוסף לאירוע', 0, 1000000, false);
  END IF;
  _names := ARRAY(SELECT x ->> 'name' FROM jsonb_array_elements(r.unit_lines) WITH ORDINALITY u(x, i) ORDER BY i);
  _lines := COALESCE((SELECT jsonb_agg('צימר ' || (x ->> 'name') || ': ' || (x ->> 'description') || '.' ORDER BY i)
                        FROM jsonb_array_elements(r.unit_lines) WITH ORDINALITY u(x, i)), '[]'::jsonb);
  _d := jsonb_build_object(
    'business_name', s.business_name, 'representative_name', r.representative_name, 'business_tax_id', _tax,
    'business_phone', s.contact_phone, 'business_email', s.contact_email,
    'signer_name', _signer ->> 'full_name', 'signer_phone', _signer ->> 'phone', 'signer_email', _signer ->> 'email',
    'facilities', r.facilities, 'facilities_definite', r.facilities_definite,
    'max_event_guests', r.max_event_guests::text, 'max_lodging_guests', r.max_lodging_guests::text,
    'deposit_amount', hospitality._money_text(r.deposit_amount),
    'free_cancellation_days', r.free_cancellation_days::text,
    'pool_open_time', to_char(r.pool_open_time, 'HH24:MI'), 'pool_close_time', to_char(r.pool_close_time, 'HH24:MI'),
    -- מה שהעסק בחר בשליחה — כדי שאפשר יהיה לחשב שוב את הנוסח ולבדוק שלא השתנה (_contract_stale)
    'options', jsonb_strip_nulls(jsonb_build_object('deposit_method', _method, 'event_fee', _event_fee)));

  IF _kind = 'pool_event' THEN
    SELECT * INTO e FROM hospitality.events x WHERE x.tenant_id = _t AND x.id = _event;
    IF e.id IS NULL THEN
      RAISE EXCEPTION 'האירוע לא נמצא' USING ERRCODE = 'no_data_found';
    END IF;
    IF e.status = 'cancelled' THEN
      RAISE EXCEPTION 'האירוע בוטל — אין לו חוזה' USING ERRCODE = 'check_violation';
    END IF;
    SELECT NULLIF(btrim(COALESCE(p.address, '')), '') INTO _address FROM hospitality.properties p
     WHERE p.tenant_id = _t AND p.id = e.property_id;
    _address := COALESCE(_address, NULLIF(btrim(COALESCE(s.address, '')), ''));
    RETURN _d || jsonb_build_object(
      'compound_address', _address,
      'units_count_text', CASE WHEN cardinality(_names) = 0 THEN 'הצימרים'
                               WHEN cardinality(_names) = 1 THEN 'הצימר'
                               ELSE cardinality(_names) || ' הצימרים' END,
      'event_purpose', hospitality._event_type_label(e.event_type, e.event_type_other),
      'event_date', to_char(e.event_date, 'DD.MM.YYYY'),
      'start_time', to_char(e.start_time, 'HH24:MI'), 'end_time', to_char(e.end_time, 'HH24:MI'),
      -- השימוש בבריכה באירוע (נפרד משעות האירוע) — להודעה ללקוח לפני החתימה, במייל וב-PDF; ריק = בלי בריכה
      'pool_start_time', to_char(e.pool_start_time, 'HH24:MI'), 'pool_end_time', to_char(e.pool_end_time, 'HH24:MI'),
      'event_late_fee', hospitality._money_text(e.late_fee_per_hour),
      'price', hospitality._money_text(e.price),
      'deposit_amount', hospitality._money_text(e.deposit_amount),
      'event_number', e.number::text, 'service_date', e.event_date::text,
      'event_type', e.event_type, 'participants', e.participants::text);
  END IF;

  -- אירוח: ההזמנה (ואם היא חלק מקבוצת חדרים — כל הקבוצה)
  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.id = _booking;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF hospitality._booking_state(b) IN ('declined', 'cancelled', 'expired', 'no_show') THEN
    RAISE EXCEPTION 'ההזמנה בוטלה / נדחתה — אין לה חוזה' USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(_names) = 0 THEN
    RAISE EXCEPTION 'הגדירו את יחידות האירוח לחוזה (סעיף 1) ב"תנאים ופרטי החוזה"' USING ERRCODE = 'check_violation';
  END IF;
  SELECT array_agg(x.unit_id), sum(x.total), min(x.check_in), max(x.check_out)
    INTO _booked, _total, _in, _out
    FROM hospitality.bookings x
   WHERE x.tenant_id = _t
     AND (x.id = b.id OR (b.group_id IS NOT NULL AND x.group_id = b.group_id
                          AND hospitality._booking_state(x) NOT IN ('declined', 'cancelled', 'expired', 'no_show')));
  _whole := EXISTS (SELECT 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = ANY (_booked)
                       AND u.kind = 'whole_property');
  SELECT NULLIF(btrim(COALESCE(p.address, '')), '') INTO _address
    FROM hospitality.units u JOIN hospitality.properties p ON p.tenant_id = u.tenant_id AND p.id = u.property_id
   WHERE u.tenant_id = _t AND u.id = b.unit_id;
  _address := COALESCE(_address, NULLIF(btrim(COALESCE(s.address, '')), ''));
  RETURN _d || jsonb_build_object(
    'compound_address', _address,
    'units_recital', CASE WHEN cardinality(_names) = 1 THEN 'צימר אחד (' || hospitality._quoted_list(_names) || ')'
                          ELSE cardinality(_names) || ' צימרים (' || hospitality._quoted_list(_names) || ')' END,
    'unit_lines', _lines,
    'units_selected', hospitality._contract_choices(_names || ARRAY['כל המתחם'],
                        CASE WHEN _whole THEN ARRAY['כל המתחם']
                             ELSE ARRAY(SELECT x ->> 'name' FROM jsonb_array_elements(r.unit_lines) x
                                         WHERE (x ->> 'unit_id')::uuid = ANY (_booked)) END),
    'nights', (_out - _in)::text,
    'check_in_date', to_char(_in, 'DD.MM.YYYY'), 'check_out_date', to_char(_out, 'DD.MM.YYYY'),
    'check_in_time', to_char(COALESCE(s.check_in_time, '14:00'::time), 'HH24:MI'),
    'check_out_time', to_char(COALESCE(s.check_out_time, '11:00'::time), 'HH24:MI'),
    'lodging_late_fee', hospitality._money_text(r.lodging_late_fee_per_hour),
    'price', hospitality._money_text(_total),
    'event_fee', hospitality._money_text(_event_fee),
    'deposit_method_chosen', _method,
    'deposit_method', CASE WHEN _method IS NOT NULL
                           THEN hospitality._contract_choices(ARRAY['מזומן', 'צ''ק ביטחון', 'כרטיס אשראי (תפיסת מסגרת)'],
                                                              ARRAY[hospitality._deposit_method_label(_method)]) END,
    'booking_number', b.number::text, 'service_date', _in::text, 'service_end', _out::text);
END $$;
REVOKE ALL ON FUNCTION hospitality._contract_data(uuid, text, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- הנוסח של חוזה (לתצוגה / לחתימה): התבנית עם הערכים; _fields — מה שהלקוח מילא; _signed_on — יום החתימה
CREATE OR REPLACE FUNCTION hospitality._contract_body(_kind text, _version integer, _data jsonb, _fields jsonb,
                                                      _signed_on text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT hospitality._contract_render(t.body,
           _data || jsonb_build_object(
             'signing_date', _signed_on,
             'signer_id_number', _fields ->> 'id_number',
             'signer_address', _fields ->> 'address')
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

CREATE OR REPLACE FUNCTION hospitality._contract_log(_t uuid, _id uuid, _action text, _actor_kind text, _actor uuid,
                                                     _ip text, _details jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO hospitality.client_contract_log (tenant_id, contract_id, action, actor_kind, actor_id, ip, details)
  VALUES (_t, _id, _action, _actor_kind, _actor, left(_ip, 64), COALESCE(_details, '{}'::jsonb));
$$;
REVOKE ALL ON FUNCTION hospitality._contract_log(uuid, uuid, text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- מצב לתצוגה: "פג תוקף" — קישור שעבר זמנו (נשלח / נצפה)
CREATE OR REPLACE FUNCTION hospitality._contract_state(c hospitality.client_contracts)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN c.status IN ('sent', 'viewed') AND (c.token_hash IS NULL OR c.token_expires_at <= now())
              THEN 'expired' ELSE c.status END;
$$;
REVOKE ALL ON FUNCTION hospitality._contract_state(hospitality.client_contracts) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._contract_title(_kind text, _version integer)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.title FROM hospitality.contract_templates t WHERE t.key = _kind AND t.version = _version;
$$;
REVOKE ALL ON FUNCTION hospitality._contract_title(text, integer) FROM PUBLIC, anon, authenticated;

-- חוזה פתוח שכבר לא מתאים למה שבמערכת — לא חותמים עליו, שולחים חוזה מעודכן:
--   'unavailable' — ההזמנה / האירוע בוטלו (או שחסרים פרטים שבלעדיהם אין חוזה);
--   'changed'     — הנוסח שהיה נשלח היום שונה ממה שנשלח (תאריכים, שעות, מחיר, יחידות, פרטי העסק / התנאים),
--                   או שהשתנה השימוש בבריכה באירוע.
-- NULL — מתאים (או שהחוזה כבר נחתם / בוטל — אז הוא לא משתנה בכל מקרה)
CREATE OR REPLACE FUNCTION hospitality._contract_stale(c hospitality.client_contracts)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _now jsonb;
BEGIN
  IF c.id IS NULL OR c.signed_at IS NOT NULL OR c.status NOT IN ('draft', 'sent', 'viewed') THEN
    RETURN NULL;
  END IF;
  BEGIN
    _now := hospitality._contract_data(c.tenant_id, c.kind, c.booking_id, c.event_id,
              jsonb_build_object('full_name', c.data ->> 'signer_name', 'email', c.data ->> 'signer_email',
                                 'phone', c.data ->> 'signer_phone'),
              COALESCE(c.data -> 'options', '{}'::jsonb));
  EXCEPTION WHEN OTHERS THEN
    RETURN 'unavailable';
  END;
  IF hospitality._contract_body(c.kind, c.template_version, _now, '{}'::jsonb, NULL)
       IS DISTINCT FROM hospitality._contract_body(c.kind, c.template_version, c.data, '{}'::jsonb, NULL)
     OR (_now ->> 'pool_start_time', _now ->> 'pool_end_time')
       IS DISTINCT FROM (c.data ->> 'pool_start_time', c.data ->> 'pool_end_time') THEN
    RETURN 'changed';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION hospitality._contract_stale(hospitality.client_contracts) FROM PUBLIC, anon, authenticated;

-- הודעת שעות הבריכה ללקוח (מה שנשלח — מהצילום של החוזה): שעות הבריכה, ובאירוע — השימוש בבריכה בו
CREATE OR REPLACE FUNCTION hospitality._contract_pool(c hospitality.client_contracts)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'open', c.data ->> 'pool_open_time', 'close', c.data ->> 'pool_close_time',
    'event_start', c.data ->> 'start_time', 'event_end', c.data ->> 'end_time',
    'start', c.data ->> 'pool_start_time', 'end', c.data ->> 'pool_end_time',
    'window_known', c.kind = 'pool_event' AND c.data ? 'pool_start_time');
$$;
REVOKE ALL ON FUNCTION hospitality._contract_pool(hospitality.client_contracts) FROM PUBLIC, anon, authenticated;

-- שורה ברשימה / בכרטיס לצוות (בלי הנוסח)
CREATE OR REPLACE FUNCTION hospitality._contract_json(c hospitality.client_contracts)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'number', c.number, 'kind', c.kind, 'template_version', c.template_version,
    'title', hospitality._contract_title(c.kind, c.template_version),
    'booking_id', c.booking_id, 'event_id', c.event_id, 'guest_id', c.guest_id,
    'booking_type', CASE c.kind WHEN 'hosting' THEN 'hosting' ELSE 'event' END,
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
    'created_at', hospitality._ts(c.created_at));
$$;
REVOKE ALL ON FUNCTION hospitality._contract_json(hospitality.client_contracts) FROM PUBLIC, anon, authenticated;

-- האם מותר לשלוח: הדגל (אישור משפטי) ותנאי העסק שאושרו
CREATE OR REPLACE FUNCTION hospitality._contracts_gate(_t uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT hospitality.flag_for('hospitality_contracts_enabled', _t) THEN
    RAISE EXCEPTION 'החוזים ממתינים לאישור משפטי — אפשר לצפות בתצוגה מקדימה בלבד, בלי שליחה ללקוחות'
      USING ERRCODE = 'feature_not_supported';
  END IF;
  IF (hospitality._terms(_t)).confirmed_at IS NULL THEN
    RAISE EXCEPTION 'בעל העסק צריך לאשר את "תנאים ופרטי החוזה" לפני שליחת חוזה ראשון' USING ERRCODE = 'check_violation';
  END IF;
END $$;
REVOKE ALL ON FUNCTION hospitality._contracts_gate(uuid) FROM PUBLIC, anon, authenticated;

-- החותם: לקוח קיים (כרטיס) / ידני, ברירת מחדל — הלקוח של ההזמנה / האירוע. אימייל חובה (שם נשלח החוזה)
CREATE OR REPLACE FUNCTION hospitality._contract_signer(_t uuid, _kind text, _booking uuid, _event uuid,
                                                        _guest uuid, _signer jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g hospitality.guests;
  _id uuid := _guest;
  _name text;
  _email text;
  _raw text;
  _phone text;
BEGIN
  IF _id IS NULL AND (_signer IS NULL OR jsonb_typeof(_signer) <> 'object' OR _signer = '{}'::jsonb) THEN
    SELECT CASE WHEN _kind = 'hosting' THEN (SELECT b.guest_id FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.id = _booking)
                ELSE (SELECT e.guest_id FROM hospitality.events e WHERE e.tenant_id = _t AND e.id = _event) END INTO _id;
  END IF;
  IF _id IS NOT NULL THEN
    SELECT * INTO g FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = _id AND x.anonymized_at IS NULL;
    IF g.id IS NULL THEN
      RAISE EXCEPTION 'הלקוח לא נמצא' USING ERRCODE = 'no_data_found';
    END IF;
    _name := g.full_name;
    _email := g.email_normalized;
    _phone := g.phone;
  END IF;
  -- פרטים שהצוות כתב (לקוח חדש / תיקון) גוברים על הכרטיס
  IF _signer IS NOT NULL AND jsonb_typeof(_signer) = 'object' THEN
    _name := COALESCE(hospitality._cv_text(_signer -> 'full_name', 'שם הלקוח', 120, false), _name);
    _raw := hospitality._cv_text(_signer -> 'email', 'אימייל', 254, false);
    IF _raw IS NOT NULL THEN
      IF hospitality.normalize_email(_raw) IS NULL THEN
        RAISE EXCEPTION 'כתובת האימייל לא תקינה' USING ERRCODE = 'check_violation';
      END IF;
      _email := hospitality.normalize_email(_raw);
    END IF;
    _phone := COALESCE(hospitality._cv_text(_signer -> 'phone', 'טלפון', 30, false), _phone);
  END IF;
  IF _name IS NULL OR char_length(_name) < 2 THEN
    RAISE EXCEPTION 'נא למלא את שם הלקוח' USING ERRCODE = 'check_violation';
  END IF;
  IF _email IS NULL THEN
    RAISE EXCEPTION 'לשליחת החוזה צריך אימייל תקין של הלקוח' USING ERRCODE = 'check_violation';
  END IF;
  IF _phone IS NOT NULL AND hospitality.normalize_phone(_phone) IS NULL THEN
    RAISE EXCEPTION 'מספר הטלפון לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  RETURN jsonb_build_object('guest_id', _id, 'full_name', _name, 'email', _email, 'phone', _phone);
END $$;
REVOKE ALL ON FUNCTION hospitality._contract_signer(uuid, text, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ההזמנות שחוזה אירוח אחד מכסה: ההזמנה, ואם היא חלק מקבוצת חדרים (בקשה אחת לכמה יחידות) — כל
-- הקבוצה. חוזה פתוח / חתום אחד לכל הקבוצה, לא אחד לכל חדר
CREATE OR REPLACE FUNCTION hospitality._contract_booking_ids(_t uuid, _booking uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN _booking IS NULL THEN ARRAY[]::uuid[] ELSE COALESCE((
    SELECT array_agg(x.id ORDER BY x.number)
      FROM hospitality.bookings b
      JOIN hospitality.bookings x ON x.tenant_id = b.tenant_id
                                 AND (x.id = b.id OR (b.group_id IS NOT NULL AND x.group_id = b.group_id))
     WHERE b.tenant_id = _t AND b.id = _booking), ARRAY[_booking]) END;
$$;
REVOKE ALL ON FUNCTION hospitality._contract_booking_ids(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- סוג החוזה והקישור: תמיד תואמים (הזמנה ↔ אירוח, אירוע ↔ מתחם הבריכה)
CREATE OR REPLACE FUNCTION hospitality._contract_link(_kind text, _booking uuid, _event uuid)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF _kind NOT IN ('hosting', 'pool_event') THEN
    RAISE EXCEPTION 'סוג החוזה לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  IF _kind = 'hosting' AND (_booking IS NULL OR _event IS NOT NULL) THEN
    RAISE EXCEPTION 'חוזה אירוח — רק להזמנת לינה (בחרו הזמנה)' USING ERRCODE = 'check_violation';
  END IF;
  IF _kind = 'pool_event' AND (_event IS NULL OR _booking IS NOT NULL) THEN
    RAISE EXCEPTION 'חוזה מתחם הבריכה — רק לאירוע (בחרו אירוע)' USING ERRCODE = 'check_violation';
  END IF;
END $$;
REVOKE ALL ON FUNCTION hospitality._contract_link(text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. הצוות (הרשאת contracts): מצב, תצוגה מקדימה, יצירה, ביטול, תיקון, ארכיון, קובץ
-- ------------------------------------------------------------
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
                    FROM (SELECT DISTINCT ON (x.key) x.* FROM hospitality.contract_templates x ORDER BY x.key, x.version DESC) t),
    'counts', (SELECT jsonb_build_object(
                 'all', count(*), 'signed', count(*) FILTER (WHERE c.status = 'signed'),
                 'waiting', count(*) FILTER (WHERE hospitality._contract_state(c) IN ('sent', 'viewed')),
                 'draft', count(*) FILTER (WHERE c.status = 'draft'))
                 FROM hospitality.client_contracts c WHERE c.tenant_id = _t),
    'can_confirm_terms', hospitality.can('settings.owner'));
END $$;
REVOKE ALL ON FUNCTION hospitality.contracts_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.contracts_view() TO authenticated, service_role;

-- תצוגה מקדימה (בלי לשמור): הנוסח המלא עם הערכים, כמו שהלקוח יראה (השדות שהלקוח ימלא — ריקים)
CREATE OR REPLACE FUNCTION hospitality.contract_preview(_kind text, _booking_id uuid, _event_id uuid,
                                                        _guest_id uuid DEFAULT NULL, _signer jsonb DEFAULT NULL,
                                                        _options jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  _who jsonb;
  _data jsonb;
  _v integer;
BEGIN
  PERFORM hospitality._contract_link(_kind, _booking_id, _event_id);
  _who := hospitality._contract_signer(_t, _kind, _booking_id, _event_id, _guest_id, _signer);
  _data := hospitality._contract_data(_t, _kind, _booking_id, _event_id, _who, COALESCE(_options, '{}'::jsonb));
  SELECT max(t.version) INTO _v FROM hospitality.contract_templates t WHERE t.key = _kind;
  RETURN jsonb_build_object(
    'kind', _kind, 'template_version', _v, 'title', hospitality._contract_title(_kind, _v),
    'signer', _who, 'data', _data,
    'body', hospitality._contract_body(_kind, _v, _data, '{}'::jsonb, NULL),
    'can_send', hospitality.flag_for('hospitality_contracts_enabled', _t) AND (hospitality._terms(_t)).confirmed_at IS NOT NULL,
    'legal_pending', NOT hospitality.flag_for('hospitality_contracts_enabled', _t),
    'terms_confirmed', (hospitality._terms(_t)).confirmed_at IS NOT NULL,
    'open_contract', (SELECT hospitality._contract_json(c) FROM hospitality.client_contracts c
                       WHERE c.tenant_id = _t AND c.status IN ('draft', 'sent', 'viewed')
                         AND (c.booking_id = ANY (hospitality._contract_booking_ids(_t, _booking_id))
                              OR c.event_id = _event_id) LIMIT 1));
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_preview(text, uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.contract_preview(text, uuid, uuid, uuid, jsonb, jsonb) TO authenticated, service_role;

-- יצירה (טיוטה) — לפני השליחה. _supersedes: חוזה מתוקן במקום חוזה קודם של אותה הזמנה / אירוע
CREATE OR REPLACE FUNCTION hospitality.contract_create(_kind text, _booking_id uuid, _event_id uuid,
                                                       _guest_id uuid DEFAULT NULL, _signer jsonb DEFAULT NULL,
                                                       _options jsonb DEFAULT '{}', _supersedes uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  _who jsonb;
  _data jsonb;
  _v integer;
  o hospitality.client_contracts;
  c hospitality.client_contracts;
  _ids uuid[];
BEGIN
  PERFORM hospitality._contract_link(_kind, _booking_id, _event_id);
  PERFORM hospitality._contracts_gate(_t);
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-contracts:' || _t, 0));
  _ids := hospitality._contract_booking_ids(_t, _booking_id);
  IF _supersedes IS NOT NULL THEN
    SELECT * INTO o FROM hospitality.client_contracts x WHERE x.tenant_id = _t AND x.id = _supersedes FOR UPDATE;
    IF o.id IS NULL OR o.kind <> _kind
       OR (_kind = 'hosting' AND (o.booking_id IS NULL OR NOT (o.booking_id = ANY (_ids))))
       OR (_kind = 'pool_event' AND o.event_id IS DISTINCT FROM _event_id) THEN
      RAISE EXCEPTION 'החוזה הקודם לא נמצא (או שהוא של הזמנה אחרת)' USING ERRCODE = 'no_data_found';
    END IF;
    IF o.status IN ('superseded', 'cancelled') THEN
      RAISE EXCEPTION 'החוזה הקודם כבר הוחלף / בוטל' USING ERRCODE = 'check_violation';
    END IF;
    -- חוזה פתוח אחר (לא זה שמוחלף) — קודם שולחים / מבטלים / מחליפים אותו
    IF EXISTS (SELECT 1 FROM hospitality.client_contracts x WHERE x.tenant_id = _t AND x.id <> o.id
                 AND x.status IN ('draft', 'sent', 'viewed') AND (x.booking_id = ANY (_ids) OR x.event_id = _event_id)) THEN
      RAISE EXCEPTION 'כבר יש חוזה פתוח להזמנה / לאירוע הזה — שלחו אותו שוב, בטלו אותו או החליפו אותו'
        USING ERRCODE = 'unique_violation';
    END IF;
    -- חוזה שעוד לא נחתם — מוחלף מיד (הקישור שלו מת); חתום — נשאר בתוקף עד שהמתוקן נחתם
    IF o.signed_at IS NULL THEN
      UPDATE hospitality.client_contracts x SET status = 'superseded', token_hash = NULL, updated_at = now()
       WHERE x.id = o.id;
      PERFORM hospitality._contract_log(_t, o.id, 'superseded', 'staff', auth.uid(), NULL, '{}'::jsonb);
    END IF;
  ELSIF EXISTS (SELECT 1 FROM hospitality.client_contracts x WHERE x.tenant_id = _t
                  AND x.status IN ('draft', 'sent', 'viewed') AND (x.booking_id = ANY (_ids) OR x.event_id = _event_id)) THEN
    RAISE EXCEPTION 'כבר יש חוזה פתוח להזמנה / לאירוע הזה — שלחו אותו שוב או בטלו אותו' USING ERRCODE = 'unique_violation';
  ELSIF EXISTS (SELECT 1 FROM hospitality.client_contracts x WHERE x.tenant_id = _t AND x.status = 'signed'
                  AND (x.booking_id = ANY (_ids) OR x.event_id = _event_id)) THEN
    RAISE EXCEPTION 'כבר יש חוזה חתום להזמנה / לאירוע הזה — אפשר להפיק חוזה מתוקן' USING ERRCODE = 'unique_violation';
  END IF;
  _who := hospitality._contract_signer(_t, _kind, _booking_id, _event_id, _guest_id, _signer);
  _data := hospitality._contract_data(_t, _kind, _booking_id, _event_id, _who, COALESCE(_options, '{}'::jsonb));
  SELECT max(t.version) INTO _v FROM hospitality.contract_templates t WHERE t.key = _kind;
  INSERT INTO hospitality.client_contracts (tenant_id, number, kind, template_version, booking_id, event_id, guest_id,
                                            signer_name, signer_email, signer_phone, data, supersedes_id, created_by)
  VALUES (_t, (SELECT COALESCE(max(x.number), 1000) + 1 FROM hospitality.client_contracts x WHERE x.tenant_id = _t),
          _kind, _v, _booking_id, _event_id, (_who ->> 'guest_id')::uuid, _who ->> 'full_name', _who ->> 'email',
          _who ->> 'phone', _data, _supersedes, auth.uid())
  RETURNING * INTO c;
  -- הקודם שלא נחתם הוחלף כבר למעלה — עכשיו ידוע במה
  IF o.id IS NOT NULL AND o.signed_at IS NULL THEN
    UPDATE hospitality.client_contracts x SET superseded_by_id = c.id WHERE x.id = o.id;
  END IF;
  PERFORM hospitality._contract_log(_t, c.id, 'created', 'staff', auth.uid(), NULL,
    jsonb_build_object('kind', _kind, 'template_version', _v, 'supersedes', _supersedes));
  PERFORM hospitality._audit(_t, CASE WHEN _supersedes IS NULL THEN 'contracts.created' ELSE 'contracts.corrected' END,
    'חוזה #' || c.number, jsonb_build_object('kind', _kind, 'link', COALESCE(_data ->> 'booking_number', _data ->> 'event_number'),
                                            'email', hospitality.mask_email(c.signer_email)));
  RETURN hospitality._contract_json(c);
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_create(text, uuid, uuid, uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.contract_create(text, uuid, uuid, uuid, jsonb, jsonb, uuid) TO authenticated, service_role;

-- לפני שליחה (גם שליחה חוזרת): הצוות מורשה, החוזה פתוח — מחזיר למי ומה לשלוח. השרת יוצר קישור ושולח
CREATE OR REPLACE FUNCTION hospitality.contract_send_prepare(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  c hospitality.client_contracts;
BEGIN
  PERFORM hospitality._contracts_gate(_t);
  SELECT * INTO c FROM hospitality.client_contracts x WHERE x.tenant_id = _t AND x.id = _id;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'החוזה לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.status NOT IN ('draft', 'sent', 'viewed') THEN
    RAISE EXCEPTION 'אפשר לשלוח רק חוזה שעוד לא נחתם' USING ERRCODE = 'check_violation';
  END IF;
  CASE hospitality._contract_stale(c)
    WHEN 'changed' THEN
      RAISE EXCEPTION 'פרטי ההזמנה / האירוע השתנו מאז שהחוזה נוצר — שלחו חוזה מעודכן (במסך "שליחת חוזה")'
        USING ERRCODE = 'check_violation';
    WHEN 'unavailable' THEN
      RAISE EXCEPTION 'ההזמנה / האירוע בוטלו (או שחסרים פרטים לחוזה) — אי אפשר לשלוח את החוזה הזה'
        USING ERRCODE = 'check_violation';
    ELSE NULL;
  END CASE;
  RETURN hospitality._contract_json(c) || jsonb_build_object('tenant_id', _t, 'actor_id', auth.uid(),
                                                             'business_name', c.data ->> 'business_name',
                                                             'business_email', c.data ->> 'business_email',
                                                             'business_phone', c.data ->> 'business_phone');
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_send_prepare(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.contract_send_prepare(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.contract_cancel(_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  c hospitality.client_contracts;
  _r text := NULLIF(btrim(COALESCE(_reason, '')), '');
BEGIN
  IF char_length(_r) > 300 THEN
    RAISE EXCEPTION 'הסיבה ארוכה מדי (עד 300 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO c FROM hospitality.client_contracts x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'החוזה לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.status NOT IN ('draft', 'sent', 'viewed') THEN
    RAISE EXCEPTION 'חוזה חתום לא מבטלים — אפשר להפיק חוזה מתוקן' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.client_contracts x SET status = 'cancelled', token_hash = NULL, cancel_reason = _r, updated_at = now()
   WHERE x.id = c.id RETURNING * INTO c;
  PERFORM hospitality._contract_log(_t, c.id, 'cancelled', 'staff', auth.uid(), NULL, jsonb_build_object('reason', _r));
  PERFORM hospitality._audit(_t, 'contracts.cancelled', 'חוזה #' || c.number, '{}'::jsonb);
  RETURN hospitality._contract_json(c);
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_cancel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.contract_cancel(uuid, text) TO authenticated, service_role;

-- הארכיון: חיפוש (שם / טלפון / אימייל / מספר) וסינון (סוג חוזה, סוג אירוע, מצב, תאריכי השירות)
CREATE OR REPLACE FUNCTION hospitality.staff_contracts(_q text DEFAULT NULL, _kind text DEFAULT NULL,
                                                       _status text DEFAULT NULL, _event_type text DEFAULT NULL,
                                                       _from date DEFAULT NULL, _to date DEFAULT NULL,
                                                       _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  _s text := NULLIF(btrim(COALESCE(_q, '')), '');
  _digits text := NULLIF(regexp_replace(COALESCE(_q, ''), '[^0-9]', '', 'g'), '');
  _rows jsonb;
  _total integer;
BEGIN
  IF _kind IS NOT NULL AND _kind NOT IN ('hosting', 'pool_event') THEN
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

CREATE OR REPLACE FUNCTION hospitality.staff_contract_detail(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  c hospitality.client_contracts;
BEGIN
  SELECT * INTO c FROM hospitality.client_contracts x WHERE x.tenant_id = _t AND x.id = _id;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'החוזה לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN hospitality._contract_json(c) || jsonb_build_object(
    'body', COALESCE(c.signed_body, hospitality._contract_body(c.kind, c.template_version, c.data, '{}'::jsonb, NULL)),
    'customer_fields', CASE WHEN c.customer_fields IS NULL THEN NULL
                            ELSE c.customer_fields - 'id_number' || jsonb_build_object(
                              'id_number_masked', '•••••' || right(c.customer_fields ->> 'id_number', 4)) END,
    'signature_kind', c.signature ->> 'kind',
    'signer_ip', c.signer_ip,
    'log', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'action', l.action, 'actor_kind', l.actor_kind,
                                                         'details', l.details, 'at', hospitality._ts(l.created_at))
                                      ORDER BY l.id DESC)
                       FROM hospitality.client_contract_log l WHERE l.tenant_id = _t AND l.contract_id = c.id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.staff_contract_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.staff_contract_detail(uuid) TO authenticated, service_role;

-- החוזים של הזמנה / אירוע (בעמוד ההזמנה ובעמוד האירוע)
CREATE OR REPLACE FUNCTION hospitality.staff_contracts_for(_booking_id uuid, _event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(hospitality._contract_json(c) ORDER BY c.created_at DESC)
                     FROM hospitality.client_contracts c
                    WHERE c.tenant_id = _t
                      AND ((_booking_id IS NOT NULL AND c.booking_id = ANY (hospitality._contract_booking_ids(_t, _booking_id)))
                           OR (_event_id IS NOT NULL AND c.event_id = _event_id))), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION hospitality.staff_contracts_for(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.staff_contracts_for(uuid, uuid) TO authenticated, service_role;

-- הורדה / צפייה ב-PDF חתום (הצוות): הנתיב בדלי הפרטי — השרת יוצר קישור קצר-מועד. ביומן
CREATE OR REPLACE FUNCTION hospitality.contract_file_request(_id uuid, _purpose text DEFAULT 'view')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  c hospitality.client_contracts;
BEGIN
  IF _purpose NOT IN ('view', 'download') THEN
    RAISE EXCEPTION 'פעולה לא מוכרת' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO c FROM hospitality.client_contracts x WHERE x.tenant_id = _t AND x.id = _id;
  IF c.id IS NULL OR c.pdf_path IS NULL THEN
    RAISE EXCEPTION 'אין עדיין קובץ חתום לחוזה הזה' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM hospitality._contract_log(_t, c.id, 'staff_' || _purpose, 'staff', auth.uid(), NULL, '{}'::jsonb);
  PERFORM hospitality._audit(_t, CASE WHEN _purpose = 'download' THEN 'contracts.file_download' ELSE 'contracts.file_view' END,
                             'חוזה #' || c.number, '{}'::jsonb);
  RETURN jsonb_build_object('path', c.pdf_path, 'number', c.number, 'sha256', c.pdf_sha256);
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_file_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.contract_file_request(uuid, text) TO authenticated, service_role;

-- שליחת עותק חתום שוב (הצוות): מותר רק לחוזה חתום עם קובץ — השרת שולח ורושם
CREATE OR REPLACE FUNCTION hospitality.contract_copy_prepare(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  c hospitality.client_contracts;
BEGIN
  SELECT * INTO c FROM hospitality.client_contracts x WHERE x.tenant_id = _t AND x.id = _id;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'החוזה לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.signed_at IS NULL OR c.pdf_path IS NULL THEN
    RAISE EXCEPTION 'אפשר לשלוח עותק רק של חוזה שנחתם' USING ERRCODE = 'check_violation';
  END IF;
  RETURN hospitality._contract_json(c) || jsonb_build_object('tenant_id', _t, 'actor_id', auth.uid(), 'path', c.pdf_path,
                                                             'business_name', c.data ->> 'business_name',
                                                             'business_email', c.data ->> 'business_email');
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_copy_prepare(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.contract_copy_prepare(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. השרת בלבד (מפתח השירות): הקישור, תוצאת השליחה, הקובץ, העותק
-- ------------------------------------------------------------
-- קישור חדש (טביעה בלבד) — כל קישור קודם מת
CREATE OR REPLACE FUNCTION hospitality.contract_issue_link(_tenant uuid, _id uuid, _token_hash text, _actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c hospitality.client_contracts;
BEGIN
  IF COALESCE(_token_hash, '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'הקישור לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.client_contracts x SET token_hash = _token_hash, token_expires_at = now() + interval '14 days',
         updated_at = now()
   WHERE x.tenant_id = _tenant AND x.id = _id AND x.status IN ('draft', 'sent', 'viewed')
  RETURNING * INTO c;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'אפשר לשלוח רק חוזה שעוד לא נחתם' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._contract_log(_tenant, c.id, 'link_issued', 'staff', _actor, NULL,
                                    jsonb_build_object('expires_at', hospitality._ts(c.token_expires_at)));
  RETURN jsonb_build_object('expires_at', hospitality._ts(c.token_expires_at));
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_issue_link(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.contract_issue_link(uuid, uuid, text, uuid) TO service_role;

-- תוצאת שליחת המייל: הצליח — "נשלח"; נכשל — המצב לא משתנה, הקישור מבוטל, השגיאה נרשמת
CREATE OR REPLACE FUNCTION hospitality.contract_send_result(_tenant uuid, _id uuid, _ok boolean, _error text, _actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c hospitality.client_contracts;
BEGIN
  SELECT * INTO c FROM hospitality.client_contracts x WHERE x.tenant_id = _tenant AND x.id = _id FOR UPDATE;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'החוזה לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.status NOT IN ('draft', 'sent', 'viewed') THEN
    RETURN hospitality._contract_json(c);
  END IF;
  IF _ok THEN
    UPDATE hospitality.client_contracts x
       SET status = CASE WHEN x.status = 'draft' THEN 'sent' ELSE x.status END,
           sent_at = COALESCE(x.sent_at, now()), last_sent_at = now(), send_count = x.send_count + 1,
           send_error = NULL, updated_at = now()
     WHERE x.id = c.id RETURNING * INTO c;
    PERFORM hospitality._contract_log(_tenant, c.id, 'sent', 'staff', _actor, NULL,
                                      jsonb_build_object('to', hospitality.mask_email(c.signer_email), 'count', c.send_count));
    PERFORM hospitality._audit(_tenant, 'contracts.sent', 'חוזה #' || c.number,
                               jsonb_build_object('to', hospitality.mask_email(c.signer_email)));
  ELSE
    UPDATE hospitality.client_contracts x SET token_hash = NULL, send_error = left(COALESCE(_error, 'השליחה נכשלה'), 300),
           updated_at = now()
     WHERE x.id = c.id RETURNING * INTO c;
    PERFORM hospitality._contract_log(_tenant, c.id, 'send_failed', 'staff', _actor, NULL,
                                      jsonb_build_object('error', left(COALESCE(_error, ''), 200)));
    PERFORM hospitality._audit(_tenant, 'contracts.send_failed', 'חוזה #' || c.number, '{}'::jsonb);
  END IF;
  RETURN hospitality._contract_json(c);
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_send_result(uuid, uuid, boolean, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.contract_send_result(uuid, uuid, boolean, text, uuid) TO service_role;

-- ה-PDF החתום נשמר בדלי — נרשם פעם אחת (הנתיב והטביעה), אחר כך לא משתנה
CREATE OR REPLACE FUNCTION hospitality.contract_pdf_stored(_tenant uuid, _id uuid, _path text, _sha256 text, _size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c hospitality.client_contracts;
BEGIN
  IF _path IS DISTINCT FROM (_tenant::text || '/' || _id::text || '.pdf') THEN
    RAISE EXCEPTION 'נתיב הקובץ לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.client_contracts x SET pdf_path = _path, pdf_sha256 = _sha256, pdf_size = _size, updated_at = now()
   WHERE x.tenant_id = _tenant AND x.id = _id AND x.signed_at IS NOT NULL AND x.pdf_path IS NULL
  RETURNING * INTO c;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'הקובץ כבר נשמר, או שהחוזה לא נחתם' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._contract_log(_tenant, c.id, 'pdf_stored', 'system', NULL, NULL,
                                    jsonb_build_object('sha256', _sha256, 'size', _size));
  RETURN hospitality._contract_json(c);
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_pdf_stored(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.contract_pdf_stored(uuid, uuid, text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION hospitality.contract_copy_result(_tenant uuid, _id uuid, _ok boolean, _error text, _actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c hospitality.client_contracts;
BEGIN
  UPDATE hospitality.client_contracts x
     SET copy_sent_at = CASE WHEN _ok THEN now() ELSE x.copy_sent_at END,
         copy_error = CASE WHEN _ok THEN NULL ELSE left(COALESCE(_error, 'השליחה נכשלה'), 300) END,
         copy_count = x.copy_count + CASE WHEN _ok THEN 1 ELSE 0 END, updated_at = now()
   WHERE x.tenant_id = _tenant AND x.id = _id AND x.signed_at IS NOT NULL
  RETURNING * INTO c;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'החוזה לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM hospitality._contract_log(_tenant, c.id, CASE WHEN _ok THEN 'copy_sent' ELSE 'copy_failed' END,
                                    CASE WHEN _actor IS NULL THEN 'system' ELSE 'staff' END, _actor, NULL,
                                    jsonb_build_object('to', hospitality.mask_email(c.signer_email),
                                                       'error', CASE WHEN _ok THEN NULL ELSE left(_error, 200) END));
  RETURN hospitality._contract_json(c);
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_copy_result(uuid, uuid, boolean, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.contract_copy_result(uuid, uuid, boolean, text, uuid) TO service_role;

-- חוזים חתומים שעוד אין להם PDF / עותק שנשלח (תקלה אחרי החתימה) — הבדיקה ברקע משלימה
CREATE OR REPLACE FUNCTION hospitality.contracts_pending_work(_limit integer DEFAULT 5)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('tenant_id', c.tenant_id, 'id', c.id, 'needs_pdf', c.pdf_path IS NULL,
                                               'needs_copy', c.copy_sent_at IS NULL)), '[]'::jsonb)
    FROM (SELECT * FROM hospitality.client_contracts x
           WHERE x.status = 'signed' AND (x.pdf_path IS NULL OR (x.copy_sent_at IS NULL AND x.copy_count = 0))
             AND x.signed_at < now() - interval '2 minutes' AND x.signed_at > now() - interval '7 days'
           ORDER BY x.signed_at LIMIT LEAST(GREATEST(COALESCE(_limit, 5), 1), 20)) c;
$$;
REVOKE ALL ON FUNCTION hospitality.contracts_pending_work(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.contracts_pending_work(integer) TO service_role;

-- כל מה שצריך כדי להפיק את ה-PDF של חוזה חתום (השרת — גם בהשלמה ברקע)
CREATE OR REPLACE FUNCTION hospitality.contract_for_pdf(_tenant uuid, _id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c hospitality.client_contracts;
BEGIN
  SELECT * INTO c FROM hospitality.client_contracts x WHERE x.tenant_id = _tenant AND x.id = _id AND x.signed_at IS NOT NULL;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'החוזה לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN hospitality._contract_json(c) || jsonb_build_object(
    'tenant_id', c.tenant_id, 'body', c.signed_body, 'signature', c.signature, 'signer_ip', c.signer_ip,
    'signer_user_agent', c.signer_user_agent, 'business_name', c.data ->> 'business_name',
    'business_email', c.data ->> 'business_email', 'business_phone', c.data ->> 'business_phone',
    'representative_name', c.data ->> 'representative_name',
    'representative_signature', (hospitality._terms(c.tenant_id)).representative_signature,
    'signed_at_local', to_char(c.signed_at AT TIME ZONE COALESCE((SELECT s.timezone FROM hospitality.settings s
                                                                   WHERE s.tenant_id = c.tenant_id), 'Asia/Jerusalem'),
                               'DD.MM.YYYY HH24:MI'),
    'pdf_path', c.pdf_path);
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_for_pdf(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.contract_for_pdf(uuid, uuid) TO service_role;

-- ------------------------------------------------------------
-- 6. הלקוח (דרך השרת — מפתח השירות, עם טביעת הקישור): פתיחה וחתימה
-- ------------------------------------------------------------
-- האתר של הבקשה (x-tenant-id) — הקישור עובד רק באתר של העסק ששלח אותו
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
  -- לא חותמים על פרטים שכבר לא נכונים: ההזמנה / האירוע בוטלו או השתנו מאז שנשלח ההסכם
  CASE hospitality._contract_stale(c)
    WHEN 'changed' THEN
      RAISE EXCEPTION 'פרטי ההזמנה / האירוע השתנו מאז שנשלח ההסכם, ולכן אי אפשר לחתום עליו — העסק ישלח לכם הסכם מעודכן'
        USING ERRCODE = 'no_data_found';
    WHEN 'unavailable' THEN
      RAISE EXCEPTION 'ההסכם כבר לא בתוקף (ההזמנה / האירוע בוטלו או השתנו) — לפרטים פנו לעסק'
        USING ERRCODE = 'no_data_found';
    ELSE NULL;
  END CASE;
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION hospitality._contract_by_token(text, boolean) FROM PUBLIC, anon, authenticated;

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
    'number', c.number, 'kind', c.kind, 'title', hospitality._contract_title(c.kind, c.template_version),
    'business_name', c.data ->> 'business_name', 'business_phone', c.data ->> 'business_phone',
    'business_email', c.data ->> 'business_email',
    'signer_name', c.signer_name, 'signer_phone', c.signer_phone, 'signer_email', c.signer_email,
    'body', hospitality._contract_body(c.kind, c.template_version, c.data, '{}'::jsonb, NULL),
    'needs_deposit_method', c.kind = 'hosting' AND c.data ->> 'deposit_method' IS NULL,
    'pool', hospitality._contract_pool(c),
    'id_label', CASE WHEN c.kind = 'pool_event' THEN 'תעודת זהות / ח.פ' ELSE 'תעודת זהות' END,
    'expires_at', hospitality._ts(c.token_expires_at));
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_open(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.contract_open(text, text, text) TO service_role;

-- החתימה: פעם אחת (נעילה; הקישור מתבטל), אחרי "קראתי ואני מסכים/ה", עם הפרטים שהלקוח מילא והחתימה.
-- הנוסח החתום נשמר עם טביעה; חוזה מתוקן שנחתם — הקודם "הוחלף" (ונשאר בארכיון)
CREATE OR REPLACE FUNCTION hospitality.contract_sign(_token_hash text, _fields jsonb, _signature jsonb, _agreed boolean,
                                                     _ip text DEFAULT NULL, _user_agent text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c hospitality.client_contracts := hospitality._contract_by_token(_token_hash, true);
  _id_number text;
  _address text;
  _method text;
  _f jsonb;
  _sig jsonb;
  _body text;
  _tz text;
  _old uuid;
BEGIN
  IF _agreed IS NOT TRUE THEN
    RAISE EXCEPTION 'יש לאשר שקראתם את כל סעיפי ההסכם ושאתם מסכימים להם' USING ERRCODE = 'check_violation';
  END IF;
  IF _fields IS NULL OR jsonb_typeof(_fields) <> 'object' THEN
    RAISE EXCEPTION 'חסרים פרטים' USING ERRCODE = 'check_violation';
  END IF;
  _id_number := regexp_replace(COALESCE(_fields ->> 'id_number', ''), '[^0-9]', '', 'g');
  IF NOT hospitality._il_id_ok(_id_number) THEN
    RAISE EXCEPTION 'מספר תעודת הזהות / ח.פ לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  _address := hospitality._contract_value(hospitality._cv_text(_fields -> 'address', 'כתובת המגורים', 200, true));
  IF char_length(_address) < 4 THEN
    RAISE EXCEPTION 'נא למלא כתובת מגורים מלאה' USING ERRCODE = 'check_violation';
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
  _f := jsonb_build_object('id_number', lpad(_id_number, 9, '0'), 'address', _address)
        || CASE WHEN _method IS NOT NULL THEN jsonb_build_object('deposit_method', _method) ELSE '{}'::jsonb END;
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
         signer_ip = left(_ip, 64), signer_user_agent = left(_user_agent, 400), token_hash = NULL, updated_at = now()
   WHERE x.id = c.id
  RETURNING * INTO c;
  PERFORM hospitality._contract_log(c.tenant_id, c.id, 'signed', 'customer', NULL, _ip,
    jsonb_build_object('signature', _sig ->> 'kind', 'body_sha256', c.signed_body_sha256, 'user_agent', left(_user_agent, 200)));
  PERFORM hospitality._audit(c.tenant_id, 'contracts.signed', 'חוזה #' || c.number,
                             jsonb_build_object('kind', c.kind, 'signature', _sig ->> 'kind'));
  RETURN jsonb_build_object('tenant_id', c.tenant_id, 'id', c.id, 'number', c.number);
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_sign(text, jsonb, jsonb, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.contract_sign(text, jsonb, jsonb, boolean, text, text) TO service_role;

-- ------------------------------------------------------------
-- 7. האזור האישי ("המסמכים שלי"): רק החוזים החתומים של הכתובת המחוברת, באתר הזה
-- ------------------------------------------------------------
-- הכניסה ל"ההזמנות שלי": גם לקוח שיש לו באתר הזה הסכם חתום (למשל אירוע בלי לינה) מקבל קוד כניסה —
-- כדי לראות את המסמכים שלו. כמו במיגרציה 56, ועוד החוזים החתומים
CREATE OR REPLACE FUNCTION hospitality._guest_area_has_bookings(_t uuid, _email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM hospitality.guests g
                   JOIN hospitality.bookings b ON b.tenant_id = g.tenant_id AND b.guest_id = g.id
                  WHERE g.tenant_id = _t AND g.email_normalized = _email AND g.anonymized_at IS NULL)
      OR EXISTS (SELECT 1 FROM hospitality.client_contracts c
                  WHERE c.tenant_id = _t AND c.signer_email_normalized = _email AND c.signed_at IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION hospitality._guest_area_has_bookings(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.guest_area_documents(_session_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  _e text := hospitality._guest_area_email(_t, _session_hash);
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
                     'id', c.id, 'number', c.number, 'kind', c.kind,
                     'title', hospitality._contract_title(c.kind, c.template_version),
                     'signed_at', hospitality._ts(c.signed_at), 'status', c.status,
                     'service_date', c.data ->> 'service_date', 'event_purpose', c.data ->> 'event_purpose',
                     'has_pdf', c.pdf_path IS NOT NULL) ORDER BY c.signed_at DESC)
                     FROM hospitality.client_contracts c
                    WHERE c.tenant_id = _t AND c.signer_email_normalized = _e AND c.signed_at IS NOT NULL), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_area_documents(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.guest_area_documents(text) TO service_role;

CREATE OR REPLACE FUNCTION hospitality.guest_area_document_file(_session_hash text, _id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  _e text := hospitality._guest_area_email(_t, _session_hash);
  c hospitality.client_contracts;
BEGIN
  SELECT * INTO c FROM hospitality.client_contracts x
   WHERE x.tenant_id = _t AND x.id = _id AND x.signer_email_normalized = _e AND x.signed_at IS NOT NULL;
  IF c.id IS NULL OR c.pdf_path IS NULL THEN
    RAISE EXCEPTION 'המסמך לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM hospitality._contract_log(_t, c.id, 'customer_download', 'customer', NULL, NULL, '{}'::jsonb);
  RETURN jsonb_build_object('path', c.pdf_path, 'number', c.number);
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_area_document_file(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.guest_area_document_file(text, uuid) TO service_role;

-- ------------------------------------------------------------
-- 8. פרטיות: מחיקת פרטי לקוח, השמירה האוטומטית והייצוא — עכשיו גם האירועים (63) והחוזים (64)
-- ------------------------------------------------------------
-- מחיקת הפרטים (בקשת לקוח / תקופת השמירה): כמו קודם — הכרטיס, ההזמנות, המיילים — ובנוסף:
--   • אירוע פעיל / עתידי (ממתין / מאושר, עוד לא הסתיים) — כמו הזמנה פעילה: אי אפשר למחוק עכשיו;
--   • האירועים: ההערות הפנימיות וסיבת הביטול (טקסט חופשי) נמחקים — הסכומים נשארים;
--   • חוזים שלא נחתמו (טיוטה / נשלח / נפתח / בוטל / הוחלף לפני חתימה) — נמחקים לגמרי עם ההיסטוריה שלהם
--     (אין להם ערך משפטי, ויש בהם שם, אימייל, טלפון וכתובת IP של צפייה). הקישור שנשלח מת איתם;
--   • חוזים חתומים — נשמרים כמו שנחתמו (ראיה; תקופת השמירה שלהם — החלטה משפטית של בעל העסק).
CREATE OR REPLACE FUNCTION hospitality._anonymize_guest(_tenant_id uuid, _guest_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM hospitality.bookings b WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id
                AND hospitality._holding(b.status)) THEN
    RAISE EXCEPTION 'לאורח יש הזמנה פעילה או עתידית — אי אפשר למחוק את פרטיו עכשיו' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM hospitality.events e WHERE e.tenant_id = _tenant_id AND e.guest_id = _guest_id
                AND e.status IN ('pending', 'confirmed') AND e.ends_at > now()) THEN
    RAISE EXCEPTION 'ללקוח יש אירוע פעיל או עתידי — אי אפשר למחוק את פרטיו עכשיו' USING ERRCODE = 'check_violation';
  END IF;
  -- החוזים שלא נחתמו — לפני שמשנים את ההזמנות (כדי למצוא את כולם: לפי הכרטיס, ההזמנות והאירועים)
  DELETE FROM hospitality.client_contracts c
   WHERE c.tenant_id = _tenant_id AND c.signed_at IS NULL
     AND (c.guest_id = _guest_id
          OR c.booking_id IN (SELECT b.id FROM hospitality.bookings b WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id)
          OR c.event_id IN (SELECT e.id FROM hospitality.events e WHERE e.tenant_id = _tenant_id AND e.guest_id = _guest_id));
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

-- תקופת השמירה (הגדרות העסק): גם לקוח של אירוע בלבד נמחק בזמן; לקוח עם אירוע פעיל / עתידי, או שהאירוע
-- שלו הסתיים בתוך התקופה — לא (כמו בהזמנות)
CREATE OR REPLACE FUNCTION hospitality.apply_retention()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r record;
  _n integer := 0;
BEGIN
  FOR r IN
    SELECT g.tenant_id, g.id
      FROM hospitality.guests g
      JOIN hospitality.settings s ON s.tenant_id = g.tenant_id AND s.guest_retention_months IS NOT NULL
     WHERE g.anonymized_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM hospitality.bookings b WHERE b.tenant_id = g.tenant_id AND b.guest_id = g.id
                          AND (hospitality._holding(b.status)
                               OR b.check_out > (now() - make_interval(months => s.guest_retention_months))::date))
       AND NOT EXISTS (SELECT 1 FROM hospitality.events e WHERE e.tenant_id = g.tenant_id AND e.guest_id = g.id
                          AND ((e.status IN ('pending', 'confirmed') AND e.ends_at > now())
                               OR e.ends_at > now() - make_interval(months => s.guest_retention_months)))
       AND g.created_at < now() - make_interval(months => s.guest_retention_months)
  LOOP
    PERFORM hospitality._anonymize_guest(r.tenant_id, r.id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION hospitality.apply_retention() FROM PUBLIC, anon, authenticated;

-- הייצוא לבקשת הלקוח (זכות העיון): כמו קודם, ועכשיו גם האירועים שלו והחוזים (חתומים ולא חתומים —
-- המספר, הסוג, המצב, התאריכים, מה שהלקוח מילא). את ה-PDF החתום העסק מוריד מהארכיון ומעביר
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
    -- מיגרציה 64: החוזים (של הכרטיס, ההזמנות והאירועים שלו)
    'contracts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'number', c.number, 'kind', c.kind, 'template_version', c.template_version, 'status', c.status,
                  'signer_name', c.signer_name, 'signer_email', c.signer_email, 'signer_phone', c.signer_phone,
                  'sent_at', hospitality._ts(c.sent_at), 'signed_at', hospitality._ts(c.signed_at),
                  'customer_fields', c.customer_fields, 'signer_ip', c.signer_ip,
                  'signed_body_sha256', c.signed_body_sha256, 'has_pdf', c.pdf_path IS NOT NULL) ORDER BY c.created_at)
                FROM hospitality.client_contracts c
               WHERE c.tenant_id = _t
                 AND (c.guest_id = g.id
                      OR c.booking_id IN (SELECT b.id FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.guest_id = g.id)
                      OR c.event_id IN (SELECT e.id FROM hospitality.events e WHERE e.tenant_id = _t AND e.guest_id = g.id))),
              '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.export_guest(uuid) FROM PUBLIC, anon;

COMMIT;

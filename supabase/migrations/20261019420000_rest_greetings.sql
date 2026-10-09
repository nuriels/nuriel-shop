-- ============================================================
-- חלק 35ב: ברכה ותמונה לשבת ולחגים
--
-- • site_settings.shabbat_message — הברכה שהלקוחות רואים בשבת (ריק = "שבת שלום").
-- • site_settings.shabbat_image_url — תמונה לשבת (כרטיס הברכה בעמוד הבית ובקופה).
-- • בכל חג ברשימה (holidays) אפשר עכשיו גם:
--     "message"   — הברכה, למשל "חג סוכות שמח" (ריק = "חג שמח")
--     "image_url" — תמונת החג
--   הבדיקה והניקוי של הרשימה (site_settings_rest_validate) שומרים את השדות
--   החדשים — עד 120 תווים לברכה, כתובת http/https לתמונה.
-- האכיפה (אין הוספה לסל / הזמנה בשבת ובחג) — ללא שינוי (חלק 35).
--
-- ניתן להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS shabbat_message text,
  ADD COLUMN IF NOT EXISTS shabbat_image_url text;

ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_shabbat_message_check;
ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_shabbat_message_check
  CHECK (shabbat_message IS NULL OR char_length(btrim(shabbat_message)) BETWEEN 1 AND 120);
ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_shabbat_image_check;
ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_shabbat_image_check
  CHECK (shabbat_image_url IS NULL
         OR (char_length(shabbat_image_url) <= 500 AND shabbat_image_url ~ '^https?://[^[:space:]]+$'));

COMMENT ON COLUMN public.site_settings.shabbat_message IS
  'חלק 35ב: הברכה ללקוחות בשבת (ריק = "שבת שלום")';
COMMENT ON COLUMN public.site_settings.shabbat_image_url IS
  'חלק 35ב: תמונה לשבת — מוצגת בכרטיס הברכה באתר בזמן השבת';
COMMENT ON COLUMN public.site_settings.holidays IS
  'חלק 35: חגים — [{"name": "סוכות", "start": "YYYY-MM-DDTHH:MM", "end": "YYYY-MM-DDTHH:MM", "message": "חג סוכות שמח", "image_url": "https://…"}] בשעון ישראל';

-- בדיקה וניקוי של רשימת החגים — כמו בחלק 35, ובנוסף הברכה והתמונה
CREATE OR REPLACE FUNCTION public.site_settings_rest_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  e jsonb;
  v_out jsonb := '[]'::jsonb;
  v_start timestamp;
  v_end timestamp;
  v_name text;
  v_message text;
  v_image text;
BEGIN
  NEW.holidays := COALESCE(NEW.holidays, '[]'::jsonb);
  IF jsonb_typeof(NEW.holidays) <> 'array' THEN
    RAISE EXCEPTION 'רשימת החגים אינה תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(NEW.holidays) > 60 THEN
    RAISE EXCEPTION 'עד 60 חגים ברשימה — מחקו חגים שעברו' USING ERRCODE = 'check_violation';
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(NEW.holidays) LOOP
    IF jsonb_typeof(e) <> 'object'
       OR COALESCE(e ->> 'start', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'
       OR COALESCE(e ->> 'end', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$' THEN
      RAISE EXCEPTION 'תאריך או שעה לא תקינים ברשימת החגים' USING ERRCODE = 'check_violation';
    END IF;
    v_name := NULLIF(btrim(regexp_replace(COALESCE(e ->> 'name', ''), '\s+', ' ', 'g')), '');
    BEGIN
      v_start := (e ->> 'start')::timestamp;
      v_end := (e ->> 'end')::timestamp;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'תאריך לא קיים ברשימת החגים%',
        CASE WHEN v_name IS NOT NULL THEN ' ("' || v_name || '")' ELSE '' END
        USING ERRCODE = 'check_violation';
    END;
    IF char_length(v_name) > 60 THEN
      RAISE EXCEPTION 'שם החג: עד 60 תווים' USING ERRCODE = 'check_violation';
    END IF;
    -- חלק 35ב: הברכה ללקוחות ("חג סוכות שמח") ותמונת החג
    v_message := NULLIF(btrim(regexp_replace(COALESCE(e ->> 'message', ''), '\s+', ' ', 'g')), '');
    IF char_length(v_message) > 120 THEN
      RAISE EXCEPTION 'בחג "%": הברכה עד 120 תווים', COALESCE(v_name, 'ללא שם')
        USING ERRCODE = 'check_violation';
    END IF;
    v_image := NULLIF(btrim(COALESCE(e ->> 'image_url', '')), '');
    IF v_image IS NOT NULL AND (char_length(v_image) > 500 OR v_image !~ '^https?://[^[:space:]]+$') THEN
      RAISE EXCEPTION 'בחג "%": כתובת התמונה אינה תקינה', COALESCE(v_name, 'ללא שם')
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_end <= v_start THEN
      RAISE EXCEPTION 'בחג "%": שעת הסיום חייבת להיות אחרי שעת הכניסה', COALESCE(v_name, 'ללא שם')
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_end - v_start > interval '8 days' THEN
      RAISE EXCEPTION 'החג "%" ארוך מדי (עד 8 ימים ברצף)', COALESCE(v_name, 'ללא שם')
        USING ERRCODE = 'check_violation';
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'name', v_name,
      'start', to_char(v_start, 'YYYY-MM-DD"T"HH24:MI'),
      'end', to_char(v_end, 'YYYY-MM-DD"T"HH24:MI'),
      'message', v_message,
      'image_url', v_image));
  END LOOP;
  SELECT COALESCE(jsonb_agg(x ORDER BY x ->> 'start', x ->> 'end'), '[]'::jsonb)
    INTO NEW.holidays
    FROM jsonb_array_elements(v_out) AS x;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS site_settings_rest_validate ON public.site_settings;
CREATE TRIGGER site_settings_rest_validate
  BEFORE INSERT OR UPDATE OF holidays ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.site_settings_rest_validate();

NOTIFY pgrst, 'reload schema';

COMMIT;

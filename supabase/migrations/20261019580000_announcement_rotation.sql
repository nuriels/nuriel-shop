-- ============================================================
-- פס הודעות מתחלף: עד 5 הודעות, מתחלפות למעלה כל כמה שניות (או גלילה רציפה)
-- ============================================================
-- תוספות בלבד: announcement_items (רשימת ההודעות), announcement_mode, זמן החלפה.
-- הטקסט והקופון שהוגדרו קודם (announcement_text / announcement_coupon_code) עוברים
-- פעם אחת להודעה הראשונה ונשארים בעמודות הישנות (לא נמחק כלום).
-- דרך חזרה: supabase/rollbacks/20261019580000_announcement_rotation.down.sql
-- ============================================================
DO $$
DECLARE _fresh boolean;
BEGIN
  _fresh := NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'site_settings' AND column_name = 'announcement_items');

  ALTER TABLE public.site_settings
    ADD COLUMN IF NOT EXISTS announcement_items jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS announcement_mode text NOT NULL DEFAULT 'rotate',
    ADD COLUMN IF NOT EXISTS announcement_interval_seconds integer NOT NULL DEFAULT 5;

  -- מעבר חד-פעמי: הודעה ישנה (טקסט / קופון) → הודעה ראשונה ברשימה
  IF _fresh THEN
    UPDATE public.site_settings
       SET announcement_items = jsonb_build_array(jsonb_build_object(
             'id', 'legacy',
             'kind', 'text',
             'text', announcement_text,
             'coupon_code', announcement_coupon_code,
             'link_url', NULL,
             'ends_at', NULL,
             'active', true))
     WHERE announcement_text <> '' OR announcement_coupon_code IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_settings_announcement_rotation_check'
                  AND conrelid = 'public.site_settings'::regclass) THEN
    ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_announcement_rotation_check CHECK (
      announcement_mode IN ('rotate', 'marquee')
      AND announcement_interval_seconds BETWEEN 3 AND 10
      AND jsonb_typeof(announcement_items) = 'array'
      AND jsonb_array_length(announcement_items) <= 5);
  END IF;
END $$;

-- בדיקת כל הודעה: סוג, אורך טקסט, קוד קופון וקישור בטוחים (כמו בבאנרים)
CREATE OR REPLACE FUNCTION public.site_settings_announcement_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _it jsonb;
BEGIN
  FOR _it IN SELECT * FROM jsonb_array_elements(NEW.announcement_items) LOOP
    IF jsonb_typeof(_it) <> 'object' THEN
      RAISE EXCEPTION 'הודעה בפס ההודעות לא תקינה' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(_it ->> 'kind', 'text') NOT IN ('text', 'free_shipping') THEN
      RAISE EXCEPTION 'סוג הודעה לא מוכר' USING ERRCODE = 'check_violation';
    END IF;
    IF char_length(COALESCE(_it ->> 'text', '')) > 200 THEN
      RAISE EXCEPTION 'הטקסט בהודעה ארוך מדי (עד 200 תווים)' USING ERRCODE = 'check_violation';
    END IF;
    IF NULLIF(_it ->> 'coupon_code', '') IS NOT NULL
       AND (_it ->> 'coupon_code') !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' THEN
      RAISE EXCEPTION 'קוד הקופון בהודעה לא תקין' USING ERRCODE = 'check_violation';
    END IF;
    IF NULLIF(_it ->> 'link_url', '') IS NOT NULL
       AND ((_it ->> 'link_url') !~* '^(https?://[^[:space:]"''<>]+|/([^/[:space:]"''<>][^[:space:]"''<>]*)?)$'
            OR char_length(_it ->> 'link_url') > 2000) THEN
      RAISE EXCEPTION 'הקישור בהודעה: נתיב באתר (/…) או כתובת מלאה (https://…)' USING ERRCODE = 'check_violation';
    END IF;
    IF NULLIF(_it ->> 'ends_at', '') IS NOT NULL THEN
      PERFORM (_it ->> 'ends_at')::timestamptz;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.site_settings_announcement_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS site_settings_announcement_guard ON public.site_settings;
CREATE TRIGGER site_settings_announcement_guard
  BEFORE INSERT OR UPDATE OF announcement_items ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.site_settings_announcement_guard();

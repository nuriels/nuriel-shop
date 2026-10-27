-- דרך חזרה ל-20261019580000 (ידני בלבד). אחריה:
--   DELETE FROM public._migrations_applied WHERE filename = '20261019580000_announcement_rotation.sql';
-- ההודעות הרשימתיות נמחקות; הטקסט והקופון הישנים (announcement_text / announcement_coupon_code) נשארו כמות שהם.
BEGIN;
DROP TRIGGER IF EXISTS site_settings_announcement_guard ON public.site_settings;
DROP FUNCTION IF EXISTS public.site_settings_announcement_guard();
ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_announcement_rotation_check;
ALTER TABLE public.site_settings
  DROP COLUMN IF EXISTS announcement_items, DROP COLUMN IF EXISTS announcement_mode,
  DROP COLUMN IF EXISTS announcement_interval_seconds;
COMMIT;

-- דרך חזרה ל-20261019570000 (ידני בלבד). אחריה:
--   DELETE FROM public._migrations_applied WHERE filename = '20261019570000_announcement_coupon_email.sql';
-- מוחק את רישום שליחות הקופון ואת הגדרות פס ההודעות; שאר הנתונים לא נפגעים.
BEGIN;
DROP FUNCTION IF EXISTS public.coupon_email_claim(text, text);
DROP FUNCTION IF EXISTS public.coupon_email_release(text, text);
DROP TABLE IF EXISTS public.coupon_email_sends;
ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_announcement_check;
ALTER TABLE public.site_settings
  DROP COLUMN IF EXISTS announcement_enabled, DROP COLUMN IF EXISTS announcement_text,
  DROP COLUMN IF EXISTS announcement_coupon_code, DROP COLUMN IF EXISTS announcement_style;
COMMIT;

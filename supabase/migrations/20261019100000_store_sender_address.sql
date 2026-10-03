-- ============================================================
-- כתובת השולח של כל חנות — רק על דומיין המערכת (@nuri1.fit).
--
-- מפתח ה-Resend מאומת על הדומיין של המערכת בלבד, ולכן מייל מכתובת על
-- דומיין אחר נדחה. כאן החנות בוחרת רק את החלק שלפני ה-@ (למשל "electro"
-- → electro@nuri1.fit); הדומיין מצורף בשרת ואי אפשר לשנות אותו.
--   sender_local_part — ברירת מחדל "orders" → orders@nuri1.fit
--   reply_to_email    — לאן מגיעות תשובות של לקוחות (כל דומיין; ריק =
--                       אימייל העסק מהגדרות האתר)
-- sender_email הישן כבר לא בשימוש: ערך על דומיין המערכת עובר ל-
-- sender_local_part, וכתובת על דומיין אחר עוברת לכתובת למענה.
--
-- ניתן להרצה חוזרת.
-- ============================================================

ALTER TABLE public.email_settings
  ADD COLUMN IF NOT EXISTS sender_local_part TEXT NOT NULL DEFAULT 'orders',
  ADD COLUMN IF NOT EXISTS reply_to_email TEXT NOT NULL DEFAULT '';

-- העברת ערכים קיימים (פעם אחת — רק כשעדיין בברירת המחדל)
UPDATE public.email_settings
   SET sender_local_part = lower(substring(btrim(sender_email) FROM '^([A-Za-z0-9._-]+)@'))
 WHERE sender_local_part = 'orders'
   AND btrim(sender_email) ~* '^[a-z0-9._-]+@nuri1\.fit$';

UPDATE public.email_settings
   SET reply_to_email = lower(btrim(sender_email))
 WHERE reply_to_email = ''
   AND btrim(sender_email) <> ''
   AND btrim(sender_email) !~* '@nuri1\.fit$'
   AND length(btrim(sender_email)) <= 254
   AND btrim(sender_email) ~ '^[^[:space:]@<>"]+@[^[:space:]@<>"]+\.[^[:space:]@<>"]+$';

-- ערך שהועבר ואינו עומד בכללים (או שמור למערכת) — חוזר לברירת המחדל
UPDATE public.email_settings
   SET sender_local_part = 'orders'
 WHERE sender_local_part !~ '^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$'
    OR sender_local_part ~ '\.\.'
    OR sender_local_part IN ('postmaster', 'abuse', 'hostmaster', 'webmaster', 'root', 'admin',
                             'administrator', 'security', 'platform', 'noc', 'mailer-daemon');

ALTER TABLE public.email_settings DROP CONSTRAINT IF EXISTS email_settings_sender_local_part_check;
ALTER TABLE public.email_settings ADD CONSTRAINT email_settings_sender_local_part_check CHECK (
  sender_local_part ~ '^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$'
  AND sender_local_part !~ '\.\.'
  AND sender_local_part NOT IN ('postmaster', 'abuse', 'hostmaster', 'webmaster', 'root', 'admin',
                                'administrator', 'security', 'platform', 'noc', 'mailer-daemon')
);

ALTER TABLE public.email_settings DROP CONSTRAINT IF EXISTS email_settings_reply_to_email_check;
ALTER TABLE public.email_settings ADD CONSTRAINT email_settings_reply_to_email_check CHECK (
  reply_to_email = ''
  OR (length(reply_to_email) <= 254
      AND reply_to_email ~ '^[^[:space:]@<>"]+@[^[:space:]@<>"]+\.[^[:space:]@<>"]+$')
);

COMMENT ON COLUMN public.email_settings.sender_local_part IS
  'החלק שלפני ה-@ בכתובת השולח של החנות. הדומיין קבוע (דומיין המערכת המאומת ב-Resend).';
COMMENT ON COLUMN public.email_settings.reply_to_email IS
  'כתובת למענה (Reply-To) של מיילי החנות. ריק = אימייל העסק מהגדרות האתר.';
COMMENT ON COLUMN public.email_settings.sender_email IS
  'לא בשימוש — הוחלף ב-sender_local_part (שולח) וב-reply_to_email (למענה).';

NOTIFY pgrst, 'reload schema';

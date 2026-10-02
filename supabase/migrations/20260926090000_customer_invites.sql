-- ============================================================
-- הזמנות לקוחות: מנהל/סוכן מזמין לקוח לפתוח חשבון בעצמו.
--   - במייל: מזינים רק את כתובת הלקוח, והוא מקבל קישור הרשמה
--   - קישור חד-פעמי בלי מייל: ללקוח שלא זוכר את כתובת המייל שלו —
--     מעתיקים את הקישור (למשל לוואטסאפ) והוא נרשם עם כל מייל שיבחר
-- ============================================================
-- במסד נשמר רק ה-hash של הטוקן (כמו בקישורי איפוס הסיסמה), כך שגם מי
-- שקורא את הטבלה לא יכול להשתמש בהזמנה. כל הזמנה לשימוש אחד בלבד.
-- הגישה לטבלה רק דרך השרת (service role) — אין מדיניות RLS למשתמשים.
--
-- אידמפוטנטי: בטוח להרצה חוזרת.

CREATE TABLE IF NOT EXISTS public.customer_invites (
  id          UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  -- NULL = קישור פתוח, הלקוח בוחר את כתובת המייל בעצמו
  email       TEXT CHECK (email IS NULL OR email = lower(btrim(email))),
  price_tier  SMALLINT CHECK (price_tier IS NULL OR price_tier IN (1, 2, 3)),
  agent_id    UUID REFERENCES public.user_roles(user_id) ON DELETE SET NULL,
  created_by  UUID REFERENCES public.user_roles(user_id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  used_by     UUID REFERENCES public.user_roles(user_id) ON DELETE SET NULL,
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS customer_invites_created_idx
  ON public.customer_invites (created_by, created_at DESC);

ALTER TABLE public.customer_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_invites FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.customer_invites TO service_role;

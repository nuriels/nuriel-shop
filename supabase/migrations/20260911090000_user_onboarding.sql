-- ============================================================
-- הקמת משתמשים גמישה (קישור ליצירת סיסמה / סיסמה זמנית), מסך השלמת
-- פרטים בכניסה ראשונה, וחתימת העסק במיילים.
-- ============================================================

-- ============================================================
-- 1. תיקון חשוב: הטריגרים המגנים חסמו גם קריאות מהשרת
-- ============================================================
-- `auth.uid()` הוא NULL כשהפעולה מגיעה מ-service role (server functions).
-- הגרסה הקודמת התייחסה לזה כ"לא אדמין" והחזירה את העמודות לערכן הקודם,
-- כלומר עדכון תפקיד/קבוצת מחיר מתוך פאנל הניהול בוטל בשקט. מעתה
-- קריאות שרת עוברות (ההרשאה נבדקת בקוד ה-server function עצמו), והחסימה
-- חלה רק על משתמש מחובר שאינו מנהל.
CREATE OR REPLACE FUNCTION public.protect_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    NEW.role := OLD.role;
    NEW.is_approved := OLD.is_approved;
    NEW.is_blocked := OLD.is_blocked;
    NEW.email := OLD.email;
    NEW.agent_number := OLD.agent_number;
    NEW.must_change_password := OLD.must_change_password;
  END IF;
  -- is_protected אינו ניתן לשינוי מהאפליקציה בכלל, גם לא ע"י אדמין
  IF auth.uid() IS NOT NULL THEN
    NEW.is_protected := OLD.is_protected;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.protect_customer_profile_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    NEW.user_id := OLD.user_id;
    NEW.price_tier := OLD.price_tier;
    NEW.agent_id := OLD.agent_id;
    -- סימון "הפרטים הושלמו" נקבע רק ע"י מסך ההשלמה בשרת
    NEW.profile_completed := OLD.profile_completed;
  END IF;
  RETURN NEW;
END; $$;

-- ============================================================
-- 2. סיסמה זמנית: חיוב החלפה בכניסה הראשונה
-- ============================================================
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 3. פרטי עסק חלקיים בהקמה + חיוב השלמה בכניסה הראשונה
-- ============================================================
-- מנהל שמקים לקוח מכיר בדרך כלל רק את שם העסק והמייל. שאר השדות נפתחים
-- כאופציונליים, והלקוח מחויב להשלים אותם במסך חסימה בכניסה הראשונה.
ALTER TABLE public.customer_profiles
  ALTER COLUMN business_address DROP NOT NULL,
  ALTER COLUMN tax_id DROP NOT NULL,
  ALTER COLUMN contact_name DROP NOT NULL,
  ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE public.customer_profiles
  DROP CONSTRAINT IF EXISTS customer_profiles_business_address_check,
  DROP CONSTRAINT IF EXISTS customer_profiles_tax_id_check,
  DROP CONSTRAINT IF EXISTS customer_profiles_contact_name_check,
  DROP CONSTRAINT IF EXISTS customer_profiles_phone_check;

ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN NOT NULL DEFAULT false;

-- לקוחות קיימים שכבר מילאו הכל בהרשמה עצמית — לא מטרידים אותם שוב
UPDATE public.customer_profiles
SET profile_completed = true
WHERE profile_completed = false
  AND length(btrim(COALESCE(business_address, ''))) >= 2
  AND length(btrim(COALESCE(tax_id, ''))) >= 1
  AND length(btrim(COALESCE(contact_name, ''))) >= 2
  AND length(btrim(COALESCE(phone, ''))) >= 7;

-- ============================================================
-- 4. חתימת העסק במיילים
-- ============================================================
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS email_signature TEXT NOT NULL DEFAULT '';

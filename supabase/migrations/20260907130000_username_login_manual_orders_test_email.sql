-- ============================================================
-- 1. שם משתמש: כניסה באימייל *או* בשם משתמש, שינוי עצמי בהגדרות חשבון
-- ============================================================
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS username TEXT UNIQUE
    CHECK (username ~ '^[a-z0-9_.]{3,30}$');

-- שם משתמש ברירת מחדל מהחלק שלפני ה-@ באימייל, עם טיפול בהתנגשויות
CREATE OR REPLACE FUNCTION public.default_username_from_email(_email TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT left(lower(regexp_replace(split_part(_email, '@', 1), '[^a-zA-Z0-9_.]', '', 'g')), 26);
$$;

CREATE OR REPLACE FUNCTION public.assign_default_username()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE base TEXT; candidate TEXT; suffix INT := 0;
BEGIN
  IF NEW.username IS NOT NULL AND btrim(NEW.username) <> '' THEN
    NEW.username := lower(btrim(NEW.username));
    RETURN NEW;
  END IF;
  base := public.default_username_from_email(NEW.email);
  IF length(base) < 3 THEN base := rpad(base, 3, 'x'); END IF;
  candidate := base;
  WHILE EXISTS (
    SELECT 1 FROM public.user_roles WHERE username = candidate AND user_id IS DISTINCT FROM NEW.user_id
  ) LOOP
    suffix := suffix + 1;
    candidate := base || suffix::text;
  END LOOP;
  NEW.username := candidate;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS user_roles_default_username ON public.user_roles;
CREATE TRIGGER user_roles_default_username
BEFORE INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.assign_default_username();

-- גיבוי-נתונים: שורות קיימות (למשל האדמין שנוצר בהתקנה) שעדיין בלי שם משתמש
DO $$
DECLARE r RECORD; base TEXT; candidate TEXT; suffix INT;
BEGIN
  FOR r IN SELECT user_id, email FROM public.user_roles WHERE username IS NULL LOOP
    base := public.default_username_from_email(r.email);
    IF length(base) < 3 THEN base := rpad(base, 3, 'x'); END IF;
    candidate := base; suffix := 0;
    WHILE EXISTS (SELECT 1 FROM public.user_roles WHERE username = candidate AND user_id <> r.user_id) LOOP
      suffix := suffix + 1;
      candidate := base || suffix::text;
    END LOOP;
    UPDATE public.user_roles SET username = candidate WHERE user_id = r.user_id;
  END LOOP;
END $$;

ALTER TABLE public.user_roles ALTER COLUMN username SET NOT NULL;

-- התחברות באימייל או בשם משתמש: פונקציה ציבורית (anon) שמתרגמת מזהה-כניסה
-- לאימייל בפועל, בלי לחשוף שום שדה אחר. אם יש '@' — מניחים שזה כבר אימייל.
CREATE OR REPLACE FUNCTION public.resolve_login_email(_identifier TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _identifier ILIKE '%@%' THEN _identifier
    ELSE (SELECT email FROM public.user_roles WHERE username = lower(btrim(_identifier)))
  END;
$$;
REVOKE ALL ON FUNCTION public.resolve_login_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO anon, authenticated;

-- כל משתמש יכול לעדכן את שם המשתמש שלו; role/is_approved/is_blocked/email
-- מוגנים גם עבורו (הטריגר למטה) וגם עבור admin updates roles (ללא שינוי).
DROP POLICY IF EXISTS "self updates own username" ON public.user_roles;
CREATE POLICY "self updates own username" ON public.user_roles
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- הגנה בפועל על עמודות רגישות: RLS היא ברמת שורה בלבד, ולכן לקוח עם
-- הרשאת UPDATE על השורה שלו יכול טכנית לשלוח role='admin' וכו' — הטריגר
-- הזה מבטל כל שינוי כזה חזרה למצב הקודם אלא אם המבצע הוא אדמין.
CREATE OR REPLACE FUNCTION public.protect_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    NEW.role := OLD.role;
    NEW.is_approved := OLD.is_approved;
    NEW.is_blocked := OLD.is_blocked;
    NEW.email := OLD.email;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS user_roles_protect_privileged_columns ON public.user_roles;
CREATE TRIGGER user_roles_protect_privileged_columns
BEFORE UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.protect_privileged_columns();

-- ============================================================
-- 2. יצירת הזמנות ע"י מנהל/סוכן בשם לקוח (למשל הזמנה טלפונית)
-- ============================================================
-- סוכן צריך לקרוא את הקטלוג המלא (3 דרגי מחיר) כדי לבנות הזמנה ללקוח שלו —
-- לא רק את המחיר של עצמו כמו get_catalog(). לא כולל מחיר עלות (נשאר ניהולי).
DROP POLICY IF EXISTS "products readable by staff" ON public.global_products;
CREATE POLICY "products readable by staff" ON public.global_products
FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- אדמין כבר יכול היה ליצור הזמנה לכל לקוח; מוסיפים סוכן ליצירת הזמנה
-- אך ורק ללקוחות המשויכים אליו.
DROP POLICY IF EXISTS "orders insert by customer" ON public.orders;
CREATE POLICY "orders insert by customer or staff" ON public.orders
FOR INSERT TO authenticated
WITH CHECK (
  customer_id = auth.uid()
  OR public.is_admin(auth.uid())
  OR (public.is_agent(auth.uid()) AND public.is_agent_of_customer(auth.uid(), customer_id))
);

DROP POLICY IF EXISTS "order items insert" ON public.order_items;
CREATE POLICY "order items insert" ON public.order_items
FOR INSERT TO authenticated WITH CHECK (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_id
    AND (o.customer_id = auth.uid() OR public.is_admin(auth.uid()) OR o.agent_id = auth.uid())));

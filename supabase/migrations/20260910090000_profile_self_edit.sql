-- ============================================================
-- עדכון פרטי לקוח: הלקוח מעדכן את פרטי העסק שלו, והסוכן מעדכן את
-- הלקוחות המשויכים אליו — בלי לגעת בקבוצת המחיר או בשיוך הסוכן.
-- ============================================================

-- קבוצת המחיר והשיוך לסוכן נשארים בשליטת מנהל בלבד. RLS היא ברמת שורה,
-- ולכן ההגבלה הזו נאכפת בטריגר: כל ניסיון לשנות את העמודות האלה ע"י מי
-- שאינו מנהל מוחזר בשקט לערך הקודם.
CREATE OR REPLACE FUNCTION public.protect_customer_profile_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    NEW.user_id := OLD.user_id;
    NEW.price_tier := OLD.price_tier;
    NEW.agent_id := OLD.agent_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS customer_profiles_protect_columns ON public.customer_profiles;
CREATE TRIGGER customer_profiles_protect_columns
BEFORE UPDATE ON public.customer_profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_customer_profile_columns();

-- הלקוח מעדכן את הפרופיל של עצמו (כתובת, טלפון, איש קשר, שם עסק, ח.פ)
DROP POLICY IF EXISTS "customer profile self update" ON public.customer_profiles;
CREATE POLICY "customer profile self update" ON public.customer_profiles
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- סוכן מעדכן פרטי קשר של הלקוחות המשויכים אליו
DROP POLICY IF EXISTS "customer profile agent update" ON public.customer_profiles;
CREATE POLICY "customer profile agent update" ON public.customer_profiles
FOR UPDATE TO authenticated
USING (public.is_agent(auth.uid()) AND agent_id = auth.uid())
WITH CHECK (public.is_agent(auth.uid()) AND agent_id = auth.uid());

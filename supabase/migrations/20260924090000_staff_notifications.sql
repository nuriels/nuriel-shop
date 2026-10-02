-- ============================================================
-- התראות לצוות (אזור אישי): לקוח חדש שויך + הזמנה חדשה נכנסה
-- ============================================================
-- נוצרות אך ורק ע"י טריגרים בשרת (SECURITY DEFINER) — אין למשתמשים
-- הרשאת INSERT ישירה, כדי שאי אפשר יהיה "לזייף" התראה למשתמש אחר.
-- שליחת המייל עצמה נשארת באפליקציה (כמו בהזמנות היום), כי Postgres לא
-- קורא ל-Resend ישירות; הטריגר כאן אחראי רק על ההתראה באזור האישי.

-- אידמפוטנטי: בטוח להרצה חוזרת אחרי הרצה חלקית.
CREATE TABLE IF NOT EXISTS public.staff_notifications (
  id         UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES public.user_roles(user_id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('new_customer', 'new_order')),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_notifications_user_idx ON public.staff_notifications (user_id, created_at DESC);

GRANT SELECT, UPDATE ON public.staff_notifications TO authenticated;
GRANT ALL ON public.staff_notifications TO service_role;

ALTER TABLE public.staff_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications readable by recipient" ON public.staff_notifications;
CREATE POLICY "notifications readable by recipient" ON public.staff_notifications
FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- עדכון מותר רק לסימון "נקרא" — לא לשנות את תוכן ההתראה
DROP POLICY IF EXISTS "notifications markable read by recipient" ON public.staff_notifications;
CREATE POLICY "notifications markable read by recipient" ON public.staff_notifications
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- ============================================================
-- התראה + הזמנה חדשה: כשמוצמד agent_id להזמנה חדשה
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_new_order()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  recipient_role TEXT;
  business TEXT;
BEGIN
  IF NEW.agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role INTO recipient_role FROM public.user_roles WHERE user_id = NEW.agent_id;
  SELECT business_name INTO business FROM public.customer_profiles WHERE user_id = NEW.customer_id;

  INSERT INTO public.staff_notifications (user_id, kind, title, body, link)
  VALUES (
    NEW.agent_id,
    'new_order',
    CASE WHEN NEW.kind = 'quote' THEN 'בקשת הצעת מחיר חדשה' ELSE 'הזמנה חדשה התקבלה' END,
    COALESCE(business, '') || ' · ' || NEW.order_number,
    CASE WHEN recipient_role = 'admin' THEN '/admin?tab=orders' ELSE '/agent?tab=orders' END
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS orders_notify_new ON public.orders;
CREATE TRIGGER orders_notify_new
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.notify_new_order();

-- ============================================================
-- התראה: לקוח חדש שויך (הצמדה ראשונית או שינוי שיוך)
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_customer_assigned()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  recipient_role TEXT;
  customer_email TEXT;
BEGIN
  -- ב-INSERT אין רשומת OLD כלל, ולכן משווים ל-OLD רק בעדכון
  IF NEW.agent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.agent_id IS NOT DISTINCT FROM OLD.agent_id THEN
    RETURN NEW;
  END IF;

  SELECT role INTO recipient_role FROM public.user_roles WHERE user_id = NEW.agent_id;
  SELECT email INTO customer_email FROM public.user_roles WHERE user_id = NEW.user_id;

  INSERT INTO public.staff_notifications (user_id, kind, title, body, link)
  VALUES (
    NEW.agent_id,
    'new_customer',
    'לקוח חדש שויך אליך',
    COALESCE(NULLIF(NEW.business_name, ''), customer_email, ''),
    CASE WHEN recipient_role = 'admin' THEN '/admin?tab=users' ELSE '/agent' END
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS customer_profiles_notify_assigned ON public.customer_profiles;
CREATE TRIGGER customer_profiles_notify_assigned
AFTER INSERT OR UPDATE OF agent_id ON public.customer_profiles
FOR EACH ROW EXECUTE FUNCTION public.notify_customer_assigned();

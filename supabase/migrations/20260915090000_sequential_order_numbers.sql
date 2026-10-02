-- ============================================================
-- מספור הזמנות רץ: SH + שתי ספרות שנה + מונה בן 7 ספרות
-- לדוגמה: SH260000001. המונה מתאפס אוטומטית בתחילת כל שנה (SH270000001).
-- ============================================================

-- מונה נפרד לכל שנה. השורה ננעלת בזמן ההגדלה, ולכן שתי הזמנות שנשלחות
-- באותה שנייה לא יקבלו את אותו מספר.
CREATE TABLE IF NOT EXISTS public.order_number_counters (
  year       SMALLINT NOT NULL PRIMARY KEY,
  last_value BIGINT NOT NULL DEFAULT 0
);
REVOKE ALL ON public.order_number_counters FROM anon, authenticated;
GRANT ALL ON public.order_number_counters TO service_role;
ALTER TABLE public.order_number_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.next_order_number()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  current_year SMALLINT := EXTRACT(YEAR FROM now())::SMALLINT;
  next_value BIGINT;
BEGIN
  INSERT INTO public.order_number_counters (year, last_value)
  VALUES (current_year, 1)
  ON CONFLICT (year) DO UPDATE
    SET last_value = public.order_number_counters.last_value + 1
  RETURNING last_value INTO next_value;

  RETURN 'SH' || to_char(now(), 'YY') || lpad(next_value::TEXT, 7, '0');
END; $$;
REVOKE ALL ON FUNCTION public.next_order_number() FROM PUBLIC, anon, authenticated;

-- המספר נקבע תמיד במסד, גם אם הדפדפן שלח ערך משלו — כך אי אפשר "לבחור"
-- מספר הזמנה, ואין תלות בקוד הלקוח לרציפות.
CREATE OR REPLACE FUNCTION public.assign_order_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.order_number := public.next_order_number();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS orders_assign_number ON public.orders;
-- שם הטריגר מתחיל ב-"orders_a" כדי שירוץ לפני orders_enforce_kind ו-orders_stamp_agent
-- (טריגרי BEFORE באותה טבלה רצים לפי סדר אלפביתי של השם)
CREATE TRIGGER orders_assign_number
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.assign_order_number();

-- הזמנות קיימות שומרות את המספר הישן שלהן (ORD-.../QT-...).
-- כדי שהמונה של השנה הנוכחית יתחיל אחרי ההזמנות שכבר נוצרו השנה, מאתחלים
-- אותו למספר ההזמנות של השנה — רק אם עדיין אין שורה.
INSERT INTO public.order_number_counters (year, last_value)
SELECT EXTRACT(YEAR FROM now())::SMALLINT, COUNT(*)
FROM public.orders
WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now())
ON CONFLICT (year) DO NOTHING;

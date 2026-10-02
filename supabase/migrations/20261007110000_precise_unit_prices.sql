-- ============================================================
-- קובי: מחיר ליחידה בדיוק גבוה — כדי שמארז יצא בדיוק במחיר שלו (07.10.2026)
-- ============================================================
-- הבעיה: מארז של 24 ב-115 ₪ = 4.791666… ליחידה, אבל המחיר נשמר עם 2 ספרות
-- אחרי הנקודה (4.79) → 4.79 × 24 = 114.96 במקום 115.00, ותוכנת הקבלות לא תואמת.
-- עכשיו: מחירי יחידה עם 8 ספרות אחרי הנקודה (4.79166667 × 24 = 115.00000008
-- → 115.00). סכום ההזמנה (orders.total) נשאר באגורות — כמו בקבלה.
-- ערכים קיימים לא משתנים (4.79 נשאר 4.79); רק מעכשיו אפשר לשמור מדויק.
-- אידמפוטנטי: עמודה שכבר בדיוק הזה — לא נוגעים בה (בלי כתיבה מחדש של הטבלה).
-- ============================================================
DO $$
DECLARE
  col RECORD;
BEGIN
  FOR col IN
    SELECT * FROM (VALUES
      ('global_products', 'price_tier1'),
      ('global_products', 'price_tier2'),
      ('global_products', 'price_tier3'),
      ('global_products', 'sale_price'),
      ('global_products', 'cost_price'),
      ('order_items', 'unit_price'),
      ('user_custom_prices', 'custom_price')
    ) AS t(tbl, name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = col.tbl AND column_name = col.name
         AND (numeric_scale IS DISTINCT FROM 8 OR numeric_precision IS DISTINCT FROM 16)
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE NUMERIC(16,8)', col.tbl, col.name);
    END IF;
  END LOOP;
END $$;

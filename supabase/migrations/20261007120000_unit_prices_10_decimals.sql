-- ============================================================
-- קובי: מחיר ליחידה עם 10 ספרות אחרי הנקודה — כמו במחשבון (07.10.2026)
-- ============================================================
-- בקשת העסק: 115 / 24 = 4.7916666667 (10 ספרות), כמו במחשבון. ממשיך את
-- 20261007110000 (8 ספרות) — עובד גם אם זו כבר הוחלה וגם אם לא.
-- סכום ההזמנה (orders.total) נשאר באגורות. ערכים קיימים לא משתנים. אידמפוטנטי.
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
         AND (numeric_scale IS DISTINCT FROM 10 OR numeric_precision IS DISTINCT FROM 20)
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE NUMERIC(20,10)', col.tbl, col.name);
    END IF;
  END LOOP;
END $$;

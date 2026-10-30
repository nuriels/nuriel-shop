-- ============================================================
-- Rollback: 20261101100000_ecommerce_engine_guard.sql
-- מסיר את טריגרי ההגנה, את מדיניות ה-storage ואת רישום התפקידים של
-- Ecommerce (ואיתו — כלל התפקידים לפי מוצר שוב לא חל על חנויות, כמו קודם).
-- נתונים לא נמחקים ולא משתנים.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DROP POLICY IF EXISTS "product images not on hospitality sites (insert)" ON storage.objects;
DROP POLICY IF EXISTS "product images not on hospitality sites (update)" ON storage.objects;

DO $$
DECLARE
  _t text;
BEGIN
  FOR _t IN
    SELECT DISTINCT c.relname
      FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
     WHERE tg.tgname IN ('ecommerce_rows_guard', 'ecommerce_row_move_guard')
       AND c.relnamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS ecommerce_rows_guard ON public.%I', _t);
    EXECUTE format('DROP TRIGGER IF EXISTS ecommerce_row_move_guard ON public.%I', _t);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.ecommerce_rows_guard();
DROP FUNCTION IF EXISTS public.ecommerce_row_move_guard();

DELETE FROM public.platform_product_roles WHERE product = 'ecommerce';

COMMIT;

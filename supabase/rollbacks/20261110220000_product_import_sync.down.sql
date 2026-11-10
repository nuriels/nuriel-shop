-- ============================================================
-- Rollback של 20261110220000_product_import_sync.sql (מיגרציה 64 — ייבוא שמזהה מוצרים קיימים)
-- מסרב כשיש נתונים: יבואים (היסטוריית השינויים שבלעדיה אי אפשר לבטל יבוא) או מק"טים של ספקים
-- שנשמרו (בלעדיהם הייבוא הבא לא יזהה את המוצרים לפי המק"ט שלהם). קודם מייצאים (pg_dump של שלוש
-- הטבלאות) ומחליטים.
-- המוצרים עצמם לא משתנים. import_products לא השתנתה במיגרציה — אין מה להחזיר.
-- לפני ה-rollback: האפליקציה חוזרת לגרסה הקודמת (הגרסה הקודמת עובדת גם עם הטבלאות החדשות במסד).
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
DECLARE
  _n bigint;
  _tbl text;
  _what text;
BEGIN
  FOR _tbl, _what IN VALUES
      ('product_imports', 'יבואי מוצרים (ההיסטוריה לדוח ולביטול)'),
      ('product_supplier_keys', 'מק"טים של ספקים שנשמרו למוצרים') LOOP
    IF to_regclass('public.' || _tbl) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', _tbl) INTO _n;
      IF _n > 0 THEN
        RAISE EXCEPTION 'יש % שורות: % — ייצאו אותן והחליטו לפני ה-rollback', _n, _what;
      END IF;
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.product_import_undo(uuid);
DROP FUNCTION IF EXISTS public.product_imports_recent();
DROP FUNCTION IF EXISTS public.product_import_report(uuid);
DROP FUNCTION IF EXISTS public.product_import_finish(uuid, integer);
DROP FUNCTION IF EXISTS public.product_import_apply(uuid, jsonb);
DROP FUNCTION IF EXISTS public._product_import_skip(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public._product_import_update(uuid, uuid, jsonb, boolean, jsonb);
DROP FUNCTION IF EXISTS public._product_import_create(uuid, uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.product_import_begin(text, jsonb, integer);
DROP FUNCTION IF EXISTS public.product_import_missing_count(uuid[], text);
DROP FUNCTION IF EXISTS public.product_import_match(jsonb);
DROP FUNCTION IF EXISTS public._product_import_json(public.product_imports);
DROP FUNCTION IF EXISTS public._product_import_card(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public._product_import_missing_ids(uuid, uuid[], text);
DROP FUNCTION IF EXISTS public._product_import_tenant();
DROP FUNCTION IF EXISTS public._product_import_sku_key(text);
DROP FUNCTION IF EXISTS public._product_import_name_key(text);

DROP TABLE IF EXISTS public.product_import_changes;
DROP TABLE IF EXISTS public.product_imports;
DROP TABLE IF EXISTS public.product_supplier_keys;

COMMIT;

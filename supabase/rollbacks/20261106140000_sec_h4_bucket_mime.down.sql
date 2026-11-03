-- ============================================================
-- Rollback ל-SEC-H4: החזרת הדליים product-images ו-branding למצב המקורי — ללא מגבלת סוג-תוכן
-- וללא מגבלת גודל (כפי שנוצרו ב-deploy/setup-selfhost.sh). נתון בלבד (שורות storage.buckets),
-- ללא שינוי סכמה. בכוונה לא מוחקים את הדליים — בשרת הם מכילים את כל תמונות המוצרים והלוגואים.
-- ============================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    UPDATE storage.buckets
       SET file_size_limit = NULL,
           allowed_mime_types = NULL
     WHERE id IN ('product-images', 'branding');
  END IF;
END $$;

COMMIT;

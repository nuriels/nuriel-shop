-- ============================================================
-- SEC-H4: רשימת-היתר של סוגי-תוכן (MIME) בצד-השרת לדליי האחסון הציבוריים
-- ------------------------------------------------------------
-- הדליים product-images ו-branding נוצרו public בלי allowed_mime_types, ובדיקת סוג-התמונה
-- היתה בצד-הלקוח בלבד — כך בעל-חנות יכול להעלות SVG/HTML עם סקריפט, ש-storage-api מגיש
-- inline על דומיין ה-API. הגבלת allowed_mime_types ל-raster בלבד חוסמת זאת ב-storage-api
-- עצמו (בדיוק כמו hosp-media), ללא תלות בקוד הלקוח. מגבלת גודל נדיבה (50MB) לא דוחה העלאות
-- תקינות קיימות. (הורדת Studio מדומיין ה-API והוספת CSP/nosniff ל-/storage — שלב שרת, לא כאן.)
-- קבצי SVG קיימים (אם יש) נשארים מאוחסנים; חסימת ה-MIME מונעת העלאות חדשות. ניקוי חד-פעמי
-- של SVG קיימים — דרך ה-Storage API בשלב השרת (מחיקת storage.objects ב-SQL אינה מוחקת את
-- הקובץ עצמו מה-backend), ולכן מתועד ולא מבוצע כאן.
-- ============================================================
BEGIN;

-- הדליים נוצרים בהתקנה (deploy/setup-selfhost.sh, אחרי המיגרציות: INSERT … ON CONFLICT DO NOTHING
-- ואז public = true) — כאן יוצרים אותם אם חסרים (כמו hosp-media), כך שהמגבלה נשמרת גם בהתקנה
-- חדשה. בדלי קיים מעדכנים רק את המגבלות; public לא משתנה.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    -- תמונות מוצר: raster בלבד (GIF נשאר — אנימציה, ללא סקריפט)
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('product-images', 'product-images', true, 52428800,
            ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
    ON CONFLICT (id) DO UPDATE
      SET file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
    -- מיתוג: לוגו, באנרים ופוסטרים (raster) + סרטוני באנר (mp4 / webm — BANNER_ACCEPT)
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('branding', 'branding', true, 52428800,
            ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif',
                  'video/mp4', 'video/webm'])
    ON CONFLICT (id) DO UPDATE
      SET file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;

COMMIT;

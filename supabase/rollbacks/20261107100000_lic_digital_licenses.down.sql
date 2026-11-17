-- ============================================================
-- Rollback ל-20261107100000_lic_digital_licenses.sql: הסרת מודול הרישיונות הדיגיטליים.
-- שימו לב: מוחק גם את נתוני המודול (שליחות, קישורים, יומן, רשומות קבצים) — לגבות לפני.
-- הדלי הפרטי license-files והקבצים שבו נשארים באחסון (Supabase חוסם מחיקה ישירה מ-SQL);
-- למחוק דרך ה-Storage API אחרי גיבוי, אם רוצים.
-- ============================================================
BEGIN;

-- הגנת נתונים (ביקורת R-3): ה-rollback לא מוחק נתוני לקוחות בשקט. אם יש שורות — נעצר; ייצאו / גבו והחליטו
DO $$
DECLARE
  _n bigint;
  _t text;
  _w text;
  _what text;
BEGIN
  FOR _t, _w, _what IN VALUES
      ('public.license_files', 'true', 'קבצי רישיון'),
      ('public.license_deliveries', 'true', 'משלוחי רישיון ללקוחות'),
      ('public.license_download_links', 'true', 'קישורי הורדה'),
      ('public.license_audit', 'true', 'יומן ביקורת הרישיונות')
  LOOP
    IF to_regclass(_t) IS NOT NULL THEN
      BEGIN
        EXECUTE format('SELECT count(*) FROM %s WHERE %s', _t, _w) INTO _n;
      EXCEPTION WHEN undefined_column THEN
        _n := 0; -- העמודה כבר הוסרה (rollback חלקי קודם)
      END;
      IF _n > 0 THEN
        RAISE EXCEPTION 'יש % שורות: % — ייצאו אותן והחליטו לפני ה-rollback (לא מבוצע)', _n, _what;
      END IF;
    END IF;
  END LOOP;
END $$;

DROP TABLE IF EXISTS public.license_audit;
DROP TABLE IF EXISTS public.license_download_links;
DROP TABLE IF EXISTS public.license_deliveries;
DROP TABLE IF EXISTS public.license_files;

DROP FUNCTION IF EXISTS public.license_link_peek(text);
DROP FUNCTION IF EXISTS public.license_consume_download(text);
DROP FUNCTION IF EXISTS public.license_set_default_file(uuid);
DROP FUNCTION IF EXISTS public.license_check_refs();
DROP FUNCTION IF EXISTS public.license_audit_append_only();

-- הדגל (וההפעלות לחנויות — tenant_feature_flags נמחקות ב-CASCADE)
DELETE FROM public.platform_feature_flags WHERE key = 'digital_licenses';

NOTIFY pgrst, 'reload schema';

COMMIT;

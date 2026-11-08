-- ============================================================
-- Rollback של 20261109100000_hosp_site_documents.sql (מיגרציה 60 — מסמכי האתר, הצהרת הנגישות והסדרי
-- הנגישות במתחם)
-- מסרב כשיש נתונים: אישורים של אורחים להזמנות (ראיה לגרסה שהאורח אישר, מתי ובאיזו הזמנה), גרסאות
-- שפורסמו, הסדרי נגישות שבעל מתחם מסר ואישר, או פרטי עוסק למסמכים — כל אלה מידע של העסק, ומחיקה שלהם
-- היא החלטה, לא תופעת לוואי. קודם מייצאים אותם (pg_dump של הטבלאות) ומחליטים.
-- בלי פונקציה קיימת שהשתנתה: הבקשות להזמנה (request_booking / _group / _package) לא נגעו — רק העטיפות
-- החדשות נמחקות. לפני ה-rollback: האפליקציה חוזרת לגרסה בלי "מסמכים ומדיניות האתר".
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
      ('booking_document_acceptances', 'אישורים של אורחים למסמכי האתר בהזמנות'),
      ('site_document_versions', 'גרסאות שפורסמו של מסמכי האתר'),
      ('property_accessibility', 'הסדרי נגישות שבעלי מתחמים מסרו ואישרו'),
      ('site_legal_profile', 'פרטי עוסק למסמכים'),
      ('site_documents', 'טיוטות של מסמכי האתר') LOOP
    IF to_regclass('hospitality.' || _tbl) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM hospitality.%I', _tbl) INTO _n;
      IF _n > 0 THEN
        RAISE EXCEPTION 'יש % שורות: % — ייצאו אותן והחליטו לפני ה-rollback', _n, _what;
      END IF;
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS hospitality.staff_booking_documents(uuid);
DROP FUNCTION IF EXISTS hospitality.request_booking_type_with_documents(jsonb, uuid, date, date, text, text, text, text,
                                                                        boolean, text, integer, integer, text, text, boolean,
                                                                        text, uuid);
DROP FUNCTION IF EXISTS hospitality.request_booking_package_with_documents(jsonb, uuid, date, text, text, text, text,
                                                                           boolean, text, integer, integer, text, boolean,
                                                                           text);
DROP FUNCTION IF EXISTS hospitality.request_booking_group_with_documents(jsonb, jsonb, date, date, text, text, text, text,
                                                                         boolean, text, boolean, text);
DROP FUNCTION IF EXISTS hospitality.request_booking_with_documents(jsonb, uuid, date, date, text, text, text, text,
                                                                   boolean, text, integer, integer, text, text, boolean,
                                                                   text);
DROP FUNCTION IF EXISTS hospitality._documents_accept(uuid, uuid[], jsonb, text);
DROP FUNCTION IF EXISTS hospitality._documents_for_booking(uuid, jsonb, text);
DROP FUNCTION IF EXISTS hospitality.public_site_document(text);
DROP FUNCTION IF EXISTS hospitality.public_site_documents();
DROP FUNCTION IF EXISTS hospitality.property_accessibility_view(uuid);
DROP FUNCTION IF EXISTS hospitality.property_accessibility_save(uuid, jsonb, boolean, text, text, text, text, integer);
DROP FUNCTION IF EXISTS hospitality.site_legal_profile_save(jsonb, integer);
DROP FUNCTION IF EXISTS hospitality.site_document_review(text, integer, text, text, date);
DROP FUNCTION IF EXISTS hospitality.site_document_unpublish(text);
DROP FUNCTION IF EXISTS hospitality.site_document_publish(text, text, text, integer);
DROP FUNCTION IF EXISTS hospitality.site_document_save(text, text, text, integer);
DROP FUNCTION IF EXISTS hospitality.site_documents_view();
DROP FUNCTION IF EXISTS hospitality._accessibility_items(jsonb);
DROP FUNCTION IF EXISTS hospitality._email_or_null(text, text);
DROP FUNCTION IF EXISTS hospitality._short_text(text, integer, text);
DROP FUNCTION IF EXISTS hospitality._text_hash(text);
DROP FUNCTION IF EXISTS hospitality._document_kind(text);

DROP TABLE IF EXISTS hospitality.booking_document_acceptances;
DROP TABLE IF EXISTS hospitality.site_document_versions;
DROP FUNCTION IF EXISTS hospitality._document_version_frozen();
DROP TABLE IF EXISTS hospitality.site_documents;
DROP TABLE IF EXISTS hospitality.property_accessibility;
DROP TABLE IF EXISTS hospitality.site_legal_profile;

COMMIT;

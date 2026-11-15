-- ============================================================
-- Rollback של 20261114100000_billing_agreements.sql (מיגרציה 189 — שכבת החיוב: הסכמים, יומן כספי, בקשות)
-- הגנה: נעצר כשיש הסכם, שורה ביומן או בקשה — אלה רשומות כספיות של לקוחות, ו-rollback היה מוחק אותן.
-- נעצר גם אם מיגרציה 190 עוד קיימת (קודם rollback שלה — הסדר ההפוך).
-- בלי נתונים: הסכמה billing וכל מה שבה, ו-14 הפונקציות הציבוריות (my_billing_* / platform_billing_*,
-- חוץ מ-platform_billing_history הישנה), נמחקים. רשומות יומן הפלטפורמה (billing_*) נשארות.
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי "חיוב והסכמים".
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF to_regprocedure('public.billing_history_guard()') IS NOT NULL THEN
    RAISE EXCEPTION 'קודם rollback של מיגרציה 190 (20261114110000_billing_owner_access)';
  END IF;
  IF to_regclass('billing.agreements') IS NOT NULL AND (
       EXISTS (SELECT 1 FROM billing.agreements) OR EXISTS (SELECT 1 FROM billing.ledger)
       OR EXISTS (SELECT 1 FROM billing.upgrade_requests)) THEN
    RAISE EXCEPTION 'יש הסכמים, רישומים ביומן הכספי או בקשות שדרוג — rollback היה מוחק רשומות כספיות. לא מבוצע';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.my_billing_summary();
DROP FUNCTION IF EXISTS public.my_billing_request_upgrade(text, text, text);
DROP FUNCTION IF EXISTS public.my_billing_cancel_request(uuid);
DROP FUNCTION IF EXISTS public.platform_billing_card(uuid);
DROP FUNCTION IF EXISTS public.platform_billing_quote(uuid, jsonb);
DROP FUNCTION IF EXISTS public.platform_billing_save_agreement(uuid, jsonb, integer, boolean, boolean, uuid, text);
DROP FUNCTION IF EXISTS public.platform_billing_record_entry(uuid, jsonb);
DROP FUNCTION IF EXISTS public.platform_billing_reverse_entry(uuid, text);
DROP FUNCTION IF EXISTS public.platform_billing_renew(uuid, date, jsonb);
DROP FUNCTION IF EXISTS public.platform_billing_requests(text);
DROP FUNCTION IF EXISTS public.platform_billing_reject_request(uuid, text);
DROP FUNCTION IF EXISTS public.platform_billing_pending_count();
DROP FUNCTION IF EXISTS public.platform_billing_save_settings(jsonb);
DROP FUNCTION IF EXISTS public.platform_billing_legacy_overview();

DROP SCHEMA IF EXISTS billing CASCADE;

NOTIFY pgrst, 'reload schema';

COMMIT;

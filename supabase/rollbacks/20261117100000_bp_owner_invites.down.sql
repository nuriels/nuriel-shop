-- Rollback של מיגרציה 198 (bp_owner_invites) — הזמנת בעלת האתר.
-- מסרב לרוץ כשיש הזמנות: הן מתעדות איך נוצרה הבעלות ואם המייל אומת. השיוך עצמו (user_roles) נשאר בכל מקרה,
-- ויומני הפלטפורמה והאתר לא נמחקים. אחרי הריצה הסכמה זהה למצב שאחרי מיגרציה 197.
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF to_regclass('business_profile.owner_invites') IS NOT NULL
     AND EXISTS (SELECT 1 FROM business_profile.owner_invites) THEN
    RAISE EXCEPTION 'יש הזמנות לבעלות על אתרים — rollback היה מוחק את התיעוד שלהן. לא מבוצע';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.bp_invite_fail(text, uuid, text, text);
DROP FUNCTION IF EXISTS public.bp_owner_email_code_verify(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.bp_owner_email_code_issue(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.bp_owner_email_status();
DROP FUNCTION IF EXISTS public.bp_invite_redeem(text, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.bp_invite_check(text, uuid, text);
DROP FUNCTION IF EXISTS public.platform_bp_invite_state(uuid);
DROP FUNCTION IF EXISTS public.platform_bp_invite_revoke(uuid);
DROP FUNCTION IF EXISTS public.platform_bp_invite_create(uuid, text, integer);
DROP FUNCTION IF EXISTS business_profile._invite_status(business_profile.owner_invites);
DROP FUNCTION IF EXISTS business_profile._invite_log(uuid, uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS business_profile._has_owner(uuid);
DROP TABLE IF EXISTS business_profile.owner_invites;

COMMIT;

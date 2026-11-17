-- ============================================================
-- Rollback: 20261118200000_hosp_seo_proposals.sql — הצעות SEO
--   • הגנה: נעצר כשיש הצעות שמורות (ממתינות או שכבר הוחלטו) — כדי לא לאבד עבודה של עסק בלי החלטה.
--     מה שכבר אושר נשמר בשדות עצמם (טיוטת האתר / היחידה / התמונה) ונשאר שם גם אחרי ה-rollback.
--   • מוחק את שתי הטבלאות ואת הפונקציות החדשות בלבד. שום פונקציה קיימת לא השתנתה במיגרציה.
--   • אחרי ה-rollback הסכמה זהה בדיוק לזו שלפני המיגרציה.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF to_regclass('hospitality.seo_proposals') IS NOT NULL
     AND EXISTS (SELECT 1 FROM hospitality.seo_proposals) THEN
    RAISE EXCEPTION 'rollback stopped: % SEO proposals are saved (pending or decided) — nothing changed',
      (SELECT count(*) FROM hospitality.seo_proposals);
  END IF;
END $$;

DROP FUNCTION IF EXISTS hospitality.seo_proposal_decide(uuid, text, text);
DROP FUNCTION IF EXISTS hospitality.seo_proposals();
DROP FUNCTION IF EXISTS hospitality.seo_runs_state(uuid);
DROP FUNCTION IF EXISTS hospitality.seo_proposals_add(uuid, uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS hospitality.seo_run_finish(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS hospitality.seo_run_start(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS hospitality._seo_server_tenant(uuid);
DROP FUNCTION IF EXISTS hospitality._seo_current(uuid, text, uuid, text);
DROP FUNCTION IF EXISTS hospitality._seo_section(jsonb, text);
DROP FUNCTION IF EXISTS hospitality._seo_doc(uuid);
DROP FUNCTION IF EXISTS hospitality._seo_max(text, text);
DROP FUNCTION IF EXISTS hospitality._seo_clean(text, text);
DROP TABLE IF EXISTS hospitality.seo_proposals;
DROP TABLE IF EXISTS hospitality.seo_runs;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ============================================================
-- Hospitality Stage 2b — R-1: זהות האתר לכותרות העמוד (meta / og) באתרי אירוח
--
-- באתר אירוח, ה-root של האפליקציה לא קורא יותר את נתוני החנות (site_settings,
-- מנוי Ecommerce). שם העסק לכותרות (description, og:title, og:site_name) מגיע
-- מהפונקציה הזו — גם לגולש שלא מחובר (מסך הכניסה, קישור ששותף ב-WhatsApp).
--
-- hospitality.site_identity(): רק שם העסק (או שם האתר אם השם ריק) של האתר של
-- הבקשה (x-tenant-id → request_tenant: אתר אירוח פעיל בלבד), ורק כשהמסד של
-- האתר פעיל ואזור הניהול או האתר הציבורי פתוחים. שום פרט אחר (לא אימייל, טלפון,
-- כתובת או מנוי). אחרת — NULL.
--
-- Rollback: supabase/rollbacks/20261101170000_hosp_site_identity.down.sql
-- אידמפוטנטית.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE OR REPLACE FUNCTION hospitality.site_identity()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object('name', COALESCE(NULLIF(btrim(s.business_name), ''), t.name))
    FROM public.tenants t
    LEFT JOIN hospitality.settings s ON s.tenant_id = t.id
   WHERE t.id = hospitality.request_tenant()
     AND hospitality.flag_for('hospitality_backend_enabled', t.id)
     AND (hospitality.flag_for('hospitality_management_enabled', t.id)
          OR hospitality.flag_for('hospitality_frontend_enabled', t.id));
$$;
REVOKE ALL ON FUNCTION hospitality.site_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.site_identity() TO anon, authenticated, service_role;

COMMIT;

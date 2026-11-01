-- ============================================================
-- Hospitality Stage 4c — מתגי האתר הציבורי בפאנל הפלטפורמה
--
--   • admin_site_switches() — לכל אתר אירוח: האתר הציבורי (hospitality_frontend_enabled) —
--     הדגל של האתר והמצב בפועל (פלטפורמה + אתר); וברמת הפלטפורמה: האתר הציבורי וההזמנות.
--     מנהל הפלטפורמה בלבד. ההפעלה עצמה — platform_set_flag (קיים, ביומן).
-- קריאה בלבד; בלי טבלה או עמודה חדשה.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION hospitality.admin_site_switches()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM hospitality._require_platform_admin();
  RETURN jsonb_build_object(
    'platform', jsonb_build_object(
      'frontend', COALESCE((SELECT f.enabled FROM public.platform_feature_flags f WHERE f.key = 'hospitality_frontend_enabled'), false),
      'booking', COALESCE((SELECT f.enabled FROM public.platform_feature_flags f WHERE f.key = 'hospitality_booking_enabled'), false)),
    'sites', COALESCE((
      SELECT jsonb_object_agg(t.id, jsonb_build_object(
               'frontend', COALESCE((SELECT tf.enabled FROM public.tenant_feature_flags tf
                                      WHERE tf.tenant_id = t.id AND tf.key = 'hospitality_frontend_enabled'), false),
               'frontend_enabled', hospitality.flag_for('hospitality_frontend_enabled', t.id)))
        FROM public.tenants t WHERE t.site_type = 'hospitality'), '{}'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_site_switches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_site_switches() TO authenticated, service_role;

COMMIT;

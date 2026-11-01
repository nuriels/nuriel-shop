-- ============================================================
-- Hospitality — מיגרציה 26: ערכת העיצוב כבר בפתיחת העסק (שלב D2)
--
--   • admin_site_theme(_tenant_id, _theme) — מנהל הפלטפורמה בוחר ערכה (יוקרה / טבע / מודרני /
--     רומנטי) כשהוא פותח עסק: נוצרת טיוטת האתר הראשונה בערכה הזו (כל המקטעים, בלי תוכן — הכל
--     מנתוני העסק). רק לפני העיצוב הראשון: כשלעסק כבר יש טיוטה או גרסה מפורסמת — כלום לא משתנה
--     (העסק בוחר / מחליף ערכה בעורך האתר, כמו תמיד). ביומן הפלטפורמה.
-- בלי שינוי בפונקציות קיימות.
-- ============================================================
CREATE OR REPLACE FUNCTION hospitality.admin_site_theme(_tenant_id uuid, _theme text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM hospitality._require_platform_admin();
  IF _theme IS NULL OR _theme NOT IN ('luxury', 'nature', 'modern', 'romantic') THEN
    RAISE EXCEPTION 'ערכת עיצוב לא מוכרת' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant_id AND t.site_type = 'hospitality') THEN
    RAISE EXCEPTION 'האתר לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  -- עיצוב קיים (טיוטה / גרסה) — של העסק; לא נוגעים
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-site-publish:' || _tenant_id, 0));
  IF EXISTS (SELECT 1 FROM hospitality.site_versions x WHERE x.tenant_id = _tenant_id) THEN
    RETURN jsonb_build_object('status', 'kept');
  END IF;
  INSERT INTO hospitality.site_versions (tenant_id, kind, version, theme, document, revision, created_by)
  VALUES (_tenant_id, 'draft', 0, _theme,
          jsonb_build_object('v', 1, 'theme', _theme, 'colors', '{}'::jsonb, 'sections', '[]'::jsonb),
          1, auth.uid());
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant_id, auth.uid(), 'hosp_site_theme', jsonb_build_object('theme', _theme));
  RETURN jsonb_build_object('status', 'set', 'theme', _theme);
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_site_theme(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_site_theme(uuid, text) TO authenticated, service_role;

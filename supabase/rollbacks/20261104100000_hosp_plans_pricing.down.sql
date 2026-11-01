-- ============================================================
-- Rollback של 20261104100000_hosp_plans_pricing.sql (שלב E3)
--   • מסרב כשיש אתר על חבילת "פרימיום" (החבילה נמחקת) — קודם מעבירים אותו לחבילה אחרת.
--   • מוחק את האכיפה (הטריגרים), את פונקציות הפאנל / השער ואת העמודות החדשות.
--   • מחזיר את entitlements (מיגרציה 7) ואת admin_platform_flags (מיגרציה 15) כמו שהיו,
--     ואת החבילות לערכים הזמניים של מיגרציות 5 ו-7 (בלי מחירים, לא מפורסמות).
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM hospitality.subscriptions WHERE plan_code = 'premium') THEN
    RAISE EXCEPTION 'יש אתרים על חבילת "פרימיום" — קודם מעבירים אותם לחבילה אחרת';
  END IF;
END $$;

-- ---------- אכיפה ----------
DROP TRIGGER IF EXISTS media_plan_guard ON hospitality.media;
DROP TRIGGER IF EXISTS properties_plan_guard ON hospitality.properties;
DROP TRIGGER IF EXISTS promotions_plan_guard ON hospitality.promotions;
DROP TRIGGER IF EXISTS unit_categories_plan_guard ON hospitality.unit_categories;
DROP TRIGGER IF EXISTS channel_feeds_plan_guard ON hospitality.channel_feeds;
DROP TRIGGER IF EXISTS channel_calendars_plan_guard ON hospitality.channel_calendars;
DROP FUNCTION IF EXISTS hospitality.media_plan_guard();
DROP FUNCTION IF EXISTS hospitality.properties_plan_guard();
DROP FUNCTION IF EXISTS hospitality.plan_feature_guard();

-- ---------- הפאנל והשער ----------
DROP FUNCTION IF EXISTS hospitality.public_plans();
DROP FUNCTION IF EXISTS hospitality.admin_save_plan(text, jsonb);

CREATE OR REPLACE FUNCTION hospitality.admin_platform_flags()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM hospitality._require_platform_admin();
  RETURN jsonb_build_object(
    'backend', COALESCE((SELECT f.enabled FROM public.platform_feature_flags f WHERE f.key = 'hospitality_backend_enabled'), false),
    'management', COALESCE((SELECT f.enabled FROM public.platform_feature_flags f WHERE f.key = 'hospitality_management_enabled'), false),
    'booking', COALESCE((SELECT f.enabled FROM public.platform_feature_flags f WHERE f.key = 'hospitality_booking_enabled'), false),
    'plans', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'max_units', p.max_units,
                                                           'trial_days', p.trial_days) ORDER BY p.sort_order, p.code)
                         FROM hospitality.plans p), '[]'::jsonb));
END $$;
DROP FUNCTION IF EXISTS hospitality._plan_json(hospitality.plans);

-- ---------- הזכאות (מיגרציה 7) ----------
CREATE OR REPLACE FUNCTION hospitality.entitlements(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.tenants;
  s hospitality.subscriptions;
  p hospitality.plans;
  _implicit boolean := false;
  _active boolean;
  _max integer;
  _max_managers integer;
BEGIN
  SELECT * INTO t FROM public.tenants x WHERE x.id = _tenant_id AND x.site_type = 'hospitality';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO s FROM hospitality.subscriptions x WHERE x.tenant_id = _tenant_id;
  IF NOT FOUND THEN
    _implicit := true;
    SELECT * INTO p FROM hospitality.plans x WHERE x.code = 'trial';
    s.plan_code := 'trial';
    s.status := 'trialing';
    s.trial_ends_at := t.created_at + make_interval(days => p.trial_days);
    s.extra_units := 0;
    s.extra_managers := 0;
  ELSE
    SELECT * INTO p FROM hospitality.plans x WHERE x.code = s.plan_code;
  END IF;
  _active := t.status = 'active' AND CASE s.status
    WHEN 'trialing' THEN s.trial_ends_at > now()
    WHEN 'active' THEN s.current_period_end IS NULL OR s.current_period_end > now()
    WHEN 'past_due' THEN s.current_period_end IS NULL OR s.current_period_end + interval '7 days' > now()
    ELSE false END;
  _max := CASE WHEN p.max_units IS NULL THEN NULL ELSE p.max_units + s.extra_units END;
  _max_managers := CASE WHEN p.max_managers IS NULL THEN NULL ELSE p.max_managers + s.extra_managers END;
  RETURN jsonb_build_object(
    'plan', p.code, 'plan_name', p.name, 'status', s.status, 'active', _active, 'implicit', _implicit,
    'trial_ends_at', hospitality._ts(s.trial_ends_at), 'current_period_end', hospitality._ts(s.current_period_end),
    'max_units', _max, 'extra_units', s.extra_units, 'units_used', hospitality._units_used(_tenant_id),
    'max_managers', _max_managers, 'extra_managers', s.extra_managers,
    'managers_used', hospitality._managers_used(_tenant_id),
    'features', p.features);
END $$;
DROP FUNCTION IF EXISTS hospitality._plan_feature(uuid, text);
DROP FUNCTION IF EXISTS hospitality._properties_used(uuid);

-- ---------- החבילות: הערכים הזמניים של מיגרציות 5 ו-7 ----------
DELETE FROM hospitality.plans WHERE code = 'premium';
UPDATE hospitality.plans SET
  name = CASE code WHEN 'trial' THEN 'ניסיון' WHEN 'basic' THEN 'בסיסית' WHEN 'pro' THEN 'מקצועית' ELSE 'ללא הגבלה' END,
  max_units = CASE code WHEN 'trial' THEN 20 WHEN 'basic' THEN 5 WHEN 'pro' THEN 20 ELSE NULL END,
  max_managers = CASE code WHEN 'trial' THEN 3 WHEN 'basic' THEN 2 WHEN 'pro' THEN 5 ELSE NULL END,
  sort_order = CASE code WHEN 'trial' THEN 0 WHEN 'basic' THEN 10 WHEN 'pro' THEN 20 ELSE 30 END,
  features = '{}'::jsonb, price_monthly = NULL, is_published = false, updated_at = now()
WHERE code IN ('trial', 'basic', 'pro', 'enterprise');

ALTER TABLE hospitality.plans DROP COLUMN IF EXISTS max_media;
ALTER TABLE hospitality.plans DROP COLUMN IF EXISTS max_properties;
ALTER TABLE hospitality.plans DROP COLUMN IF EXISTS highlights;
ALTER TABLE hospitality.plans DROP COLUMN IF EXISTS tagline;
ALTER TABLE hospitality.plans DROP COLUMN IF EXISTS setup_fee;

NOTIFY pgrst, 'reload schema';

COMMIT;

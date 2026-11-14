-- ============================================================
-- Rollback של 20261114110000_billing_owner_access.sql (מיגרציה 190 — המידע הכספי לבעלים בלבד)
-- בלי הגנה: אין כאן נתונים — רק הרשאות, פונקציות וטריגר. אחרי ה-rollback:
--   • tenant_subscriptions / billing_history — שוב קריאה לכל מנהל בחנות (is_admin), כמו לפני 190;
--   • store_billing, hospitality.my_entitlements, hospitality.admin_set_subscription — הגרסאות הקודמות מילה במילה;
--   • hospitality.subscriptions — שוב קריאה לכל מי שיש לו settings;
--   • billing_history — בלי השומר (עריכה ומחיקה אפשריות שוב).
-- הנתונים לא משתנים. לפני ה-rollback: האפליקציה חוזרת לגרסה בלי "חיוב והסכמים" (או נשארת — היא לא תלויה ב-190).
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DROP TRIGGER IF EXISTS billing_history_guard ON public.billing_history;
DROP FUNCTION IF EXISTS public.billing_history_guard();

DROP POLICY IF EXISTS "store admin reads subscription" ON public.tenant_subscriptions;
CREATE POLICY "store admin reads subscription" ON public.tenant_subscriptions
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "store admin reads billing history" ON public.billing_history;
CREATE POLICY "store admin reads billing history" ON public.billing_history
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

-- 20261019360000_remove_hyp.sql
CREATE OR REPLACE FUNCTION public.store_billing()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לצפות במנוי' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  RETURN jsonb_build_object(
    'subscription', public.tenant_subscription_state(_tenant),
    'product_count', (SELECT count(*) FROM public.global_products WHERE tenant_id = _tenant),
    'history', public.billing_history_json(_tenant, false),
    'addons', public.tenant_addons_json(_tenant),
    'billing_profile', public.billing_profile_json(_tenant));
END $$;
REVOKE ALL ON FUNCTION public.store_billing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_billing() TO authenticated, service_role;

DROP POLICY IF EXISTS staff ON hospitality.subscriptions;
CREATE POLICY staff ON hospitality.subscriptions FOR ALL TO authenticated
  USING ((SELECT hospitality.can('settings')))
  WITH CHECK ((SELECT hospitality.can('settings')));

-- 20261101130000_hosp_billing_admin.sql
CREATE OR REPLACE FUNCTION hospitality.my_entitlements()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN hospitality.entitlements(hospitality._staff_tenant('settings'));
END $$;

-- 20261101130000_hosp_billing_admin.sql
CREATE OR REPLACE FUNCTION hospitality.admin_set_subscription(
  _tenant_id uuid, _plan text, _status text, _trial_ends_at timestamptz DEFAULT NULL,
  _current_period_end timestamptz DEFAULT NULL, _extra_units integer DEFAULT 0, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _before hospitality.subscriptions;
BEGIN
  PERFORM hospitality._require_platform_admin();
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant_id AND t.site_type = 'hospitality') THEN
    RAISE EXCEPTION 'אתר האירוח לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hospitality.plans p WHERE p.code = _plan) THEN
    RAISE EXCEPTION 'חבילה לא מוכרת: %', _plan USING ERRCODE = 'check_violation';
  END IF;
  IF _status NOT IN ('trialing', 'active', 'past_due', 'canceled', 'expired') THEN
    RAISE EXCEPTION 'סטטוס מנוי לא מוכר: %', _status USING ERRCODE = 'check_violation';
  END IF;
  IF _status = 'trialing' AND _trial_ends_at IS NULL THEN
    RAISE EXCEPTION 'לניסיון צריך תאריך סיום' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO _before FROM hospitality.subscriptions s WHERE s.tenant_id = _tenant_id FOR UPDATE;
  INSERT INTO hospitality.subscriptions (tenant_id, plan_code, status, trial_ends_at, current_period_end,
                                         extra_units, note, updated_by)
  VALUES (_tenant_id, _plan, _status, _trial_ends_at, _current_period_end, COALESCE(_extra_units, 0),
          NULLIF(btrim(_note), ''), auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE
    SET plan_code = EXCLUDED.plan_code, status = EXCLUDED.status, trial_ends_at = EXCLUDED.trial_ends_at,
        current_period_end = EXCLUDED.current_period_end, extra_units = EXCLUDED.extra_units,
        note = EXCLUDED.note, updated_by = EXCLUDED.updated_by;
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant_id, auth.uid(), 'hosp_subscription_set',
          jsonb_build_object('plan', _plan, 'status', _status, 'extra_units', COALESCE(_extra_units, 0),
                             'previous', CASE WHEN _before.tenant_id IS NULL THEN NULL
                                              ELSE jsonb_build_object('plan', _before.plan_code, 'status', _before.status,
                                                                      'extra_units', _before.extra_units) END));
  RETURN hospitality.entitlements(_tenant_id);
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

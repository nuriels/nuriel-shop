-- ============================================================
-- מיגרציה 190: המידע הכספי — לבעל העסק בלבד, וההיסטוריה הישנה מוגנת
--
-- (שלב 1 של בדיקת החיוב, ממצא 1): מנהלים, מנהל/ת עסק ועובדים לא רואים יותר מחירים, תשלומים
-- והערות פנימיות. הבעלים (ומנהל הפלטפורמה) — כמו קודם.
--   • חנות: tenant_subscriptions ו-billing_history — קריאה ישירה רק לבעלים (staff_can('billing.manage'))
--     במקום כל מנהל (is_admin). store_billing() — מנהל שאינו הבעלים מקבל את מצב המנוי (החבילה, הסטטוס
--     והימים שנותרו — צריך את זה כשהפאנל נעול), את התוספים בלי סכומים, בלי היסטוריית תשלומים ובלי פרטי
--     החיוב. owner_view מסמן למסך מה התקבל.
--   • צימר: hospitality.subscriptions (כולל note, ההערה הפנימית) — קריאה ישירה רק ל-billing.manage
--     (הבעלים) במקום settings (כל מנהל). my_entitlements() — billing.manage. מנהלים ממשיכים לקבל את
--     הזכאות המצומצמת של management_context (פעיל / מגבלת יחידות / בשימוש) — לא השתנה.
--   • admin_set_subscription: היומן שומר גם את התאריכים הקודמים (סוף ניסיון / סוף תקופה) ואם ההערה
--     השתנתה (ממצא 6). אותה פעולה בדיוק, רק יותר פרטים ביומן.
--   • billing_history (ממצא 2): שורות שנרשמו לא נערכות ולא נמחקות. מה שמותר — רק מה שהקוד הקיים עושה:
--     סימון חיוב ממתין כשולם (due → paid, paid_at, אסמכתה), מחיקת חיוב ממתין שלא שולם (דחיית תוסף),
--     ושם החנות שנמחקה (store_label, SEC-M5). כל שינוי אחר — נחסם, גם לבעל המסד.
-- אין שינוי בנתונים: אף שורה לא משתנה במיגרציה הזו.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. חנות: קריאה ישירה — הבעלים בלבד
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "store admin reads subscription" ON public.tenant_subscriptions;
CREATE POLICY "store admin reads subscription" ON public.tenant_subscriptions
  FOR SELECT TO authenticated USING (public.staff_can('billing.manage', auth.uid()));
DROP POLICY IF EXISTS "store admin reads billing history" ON public.billing_history;
CREATE POLICY "store admin reads billing history" ON public.billing_history
  FOR SELECT TO authenticated USING (public.staff_can('billing.manage', auth.uid()));

-- "המנוי שלי": הבעלים — הכול; מנהל — מצב המנוי והתוספים בלבד (בלי סכומים, תשלומים ופרטי חיוב)
CREATE OR REPLACE FUNCTION public.store_billing()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _owner boolean;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לצפות במנוי' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  _owner := public.staff_can('billing.manage', auth.uid());
  RETURN jsonb_build_object(
    'subscription', public.tenant_subscription_state(_tenant),
    'product_count', (SELECT count(*) FROM public.global_products WHERE tenant_id = _tenant),
    'history', CASE WHEN _owner THEN public.billing_history_json(_tenant, false) ELSE '[]'::jsonb END,
    'addons', CASE WHEN _owner THEN public.tenant_addons_json(_tenant)
                   ELSE COALESCE((SELECT jsonb_agg(a - 'amount') FROM jsonb_array_elements(public.tenant_addons_json(_tenant)) a),
                                 '[]'::jsonb) END,
    'billing_profile', CASE WHEN _owner THEN public.billing_profile_json(_tenant) END,
    'owner_view', _owner);
END $$;
REVOKE ALL ON FUNCTION public.store_billing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_billing() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. צימר: המנוי והזכאות המלאה — הבעלים בלבד
-- ------------------------------------------------------------
DROP POLICY IF EXISTS staff ON hospitality.subscriptions;
CREATE POLICY staff ON hospitality.subscriptions FOR ALL TO authenticated
  USING ((SELECT hospitality.can('billing.manage')))
  WITH CHECK ((SELECT hospitality.can('billing.manage')));

CREATE OR REPLACE FUNCTION hospitality.my_entitlements()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN hospitality.entitlements(hospitality._staff_tenant('billing.manage'));
END $$;

-- ------------------------------------------------------------
-- 3. צימר: שינוי מנוי — היומן שומר את התאריכים הקודמים
-- ------------------------------------------------------------
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
  -- מיגרציה 190: גם התאריכים (החדשים והקודמים), ואם ההערה הפנימית השתנתה (בלי התוכן שלה)
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant_id, auth.uid(), 'hosp_subscription_set',
          jsonb_build_object('plan', _plan, 'status', _status, 'extra_units', COALESCE(_extra_units, 0),
                             'trial_ends_at', _trial_ends_at, 'current_period_end', _current_period_end,
                             'note_changed', NULLIF(btrim(_note), '') IS DISTINCT FROM _before.note,
                             'previous', CASE WHEN _before.tenant_id IS NULL THEN NULL
                                              ELSE jsonb_build_object('plan', _before.plan_code, 'status', _before.status,
                                                                      'extra_units', _before.extra_units,
                                                                      'trial_ends_at', _before.trial_ends_at,
                                                                      'current_period_end', _before.current_period_end) END));
  RETURN hospitality.entitlements(_tenant_id);
END $$;

-- ------------------------------------------------------------
-- 4. billing_history: מה שנרשם — נשאר
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_history_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- חיוב ממתין שלא שולם (דחיית בקשת תוסף) — מותר, כמו היום. תשלום / רישום שבוצע — לא
    IF OLD.payment_status = 'due' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'היסטוריית החיוב לא נמחקת' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- סימון חיוב ממתין כשולם (תוספים): רק הסטטוס, תאריך התשלום והאסמכתה
  IF OLD.payment_status = 'due' AND NEW.payment_status = 'paid'
     AND (to_jsonb(NEW) - 'payment_status' - 'paid_at' - 'reference')
       = (to_jsonb(OLD) - 'payment_status' - 'paid_at' - 'reference') THEN
    RETURN NEW;
  END IF;
  -- החנות נמחקה: השם והכתובת שלה נשמרים בשורה (SEC-M5), פעם אחת
  IF OLD.store_label IS NULL AND NEW.store_label IS NOT NULL
     AND (to_jsonb(NEW) - 'store_label') = (to_jsonb(OLD) - 'store_label') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'היסטוריית החיוב לא נערכת' USING ERRCODE = 'insufficient_privilege';
END $$;
REVOKE ALL ON FUNCTION public.billing_history_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS billing_history_guard ON public.billing_history;
CREATE TRIGGER billing_history_guard BEFORE UPDATE OR DELETE ON public.billing_history
FOR EACH ROW EXECUTE FUNCTION public.billing_history_guard();

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- חלק 25: אוטומציות מייל (Resend)
--
-- מה כבר היה ולא נבנה מחדש: עוטף המייל המעוצב עם הלוגו ושם החנות (renderEmailHtml),
-- אישור הזמנה ללקוח אחרי שההזמנה נקלטה / התשלום עבר (sendOrderEmailsInternal — בקופה,
-- אחרי Hyp ואחרי ביט), ומייל "יצאה למשלוח" (sendShippedEmailInternal).
--
-- חדש:
-- 1. מייל "ההזמנה שלך בדרך!" כשצוות החנות שומר מספר מעקב — פעם אחת לכל מספר:
--    orders.tracking_notified_number + order_claim_tracking_email / order_release_tracking_email
--    (רק מי שמורשה לערוך את ההזמנה: מנהל החנות או הסוכן שלה).
-- 2. התראה למנהלי הפלטפורמה על בקשת שדרוג (מנהל נוסף) — פעם אחת לכל בקשה:
--    upgrade_requests.platform_notified_at + upgrade_request_claim/release_notification (service_role).
-- אידמפוטנטית.
-- ============================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tracking_notified_number TEXT;
COMMENT ON COLUMN public.orders.tracking_notified_number IS
  'מספר המעקב האחרון שנשלח עליו מייל ללקוח (מונע מייל כפול על אותו מספר)';

ALTER TABLE public.upgrade_requests ADD COLUMN IF NOT EXISTS platform_notified_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.order_claim_tracking_email(_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE o RECORD;
BEGIN
  SELECT id, agent_id, tracking_number, tracking_notified_number INTO o
    FROM public.orders
   WHERE id = _order_id AND tenant_id = public.current_tenant_id()
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ההזמנה לא נמצאה'; END IF;
  IF NOT (public.is_admin(auth.uid()) OR (o.agent_id IS NOT NULL AND o.agent_id = auth.uid())) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF o.tracking_number IS NULL OR o.tracking_notified_number IS NOT DISTINCT FROM o.tracking_number THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;
  UPDATE public.orders SET tracking_notified_number = o.tracking_number WHERE id = o.id;
  RETURN jsonb_build_object('claimed', true, 'previous', o.tracking_notified_number, 'number', o.tracking_number);
END; $$;

-- המייל נכשל → מחזירים את הסימון, כדי ששמירה הבאה תנסה שוב
CREATE OR REPLACE FUNCTION public.order_release_tracking_email(_order_id UUID, _previous TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE o RECORD;
BEGIN
  SELECT id, agent_id INTO o FROM public.orders
   WHERE id = _order_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'ההזמנה לא נמצאה'; END IF;
  IF NOT (public.is_admin(auth.uid()) OR (o.agent_id IS NOT NULL AND o.agent_id = auth.uid())) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.orders SET tracking_notified_number = _previous WHERE id = o.id;
END; $$;

REVOKE ALL ON FUNCTION public.order_claim_tracking_email(UUID), public.order_release_tracking_email(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_claim_tracking_email(UUID), public.order_release_tracking_email(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.upgrade_request_claim_notification(_request_id UUID)
RETURNS BOOLEAN LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (
    UPDATE public.upgrade_requests SET platform_notified_at = now()
     WHERE id = _request_id AND platform_notified_at IS NULL
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u);
$$;
CREATE OR REPLACE FUNCTION public.upgrade_request_release_notification(_request_id UUID)
RETURNS VOID LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.upgrade_requests SET platform_notified_at = NULL WHERE id = _request_id;
$$;
REVOKE ALL ON FUNCTION public.upgrade_request_claim_notification(UUID), public.upgrade_request_release_notification(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_request_claim_notification(UUID), public.upgrade_request_release_notification(UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';

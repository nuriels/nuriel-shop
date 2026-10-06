-- ============================================================
-- חלק 24 (המשך "חלק 23 — מונטיזציה"): מנהלים לפי חבילה + בקשות שדרוג
--
-- • החבילה ותאריך התוקף כבר קיימים (חלק 13): tenant_subscriptions.plan_type
--   ('trial' / 'basic' / 'premium'), current_period_end, trial_ends_at — לא מוסיפים
--   עמודות כפולות. נוסף רק tenant_subscriptions.extra_admins_count.
-- • מגבלת מנהלים: basic = 1 (הבעלים) · premium = 3 · trial = 3 (כמו plan_features —
--   ניסיון = פרימיום) · + extra_admins_count.
-- • טריגר על user_roles: מנהל חדש / שינוי תפקיד ל-admin מעבר למגבלה — נדחה (גם דרך
--   השרת עם service_role). מנהל פלטפורמה פטור. מנהלים קיימים לא נפגעים (גם בהורדת חבילה).
-- • upgrade_requests: pending → payment_link_sent → approved. אישור = extra_admins_count + 1,
--   פעם אחת בלבד. מנהל נוסף בתוקף לשנה מהאישור (לתצוגה; אין פקיעה אוטומטית).
-- • כתיבה רק דרך פונקציות: request_extra_admin (מנהל החנות) ·
--   platform_send_upgrade_link / platform_approve_upgrade / platform_delete_upgrade_request (מנהל פלטפורמה).
-- אידמפוטנטית.
-- ============================================================

ALTER TABLE public.tenant_subscriptions
  ADD COLUMN IF NOT EXISTS extra_admins_count INTEGER NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_subscriptions_extra_admins_range'
                   AND conrelid = 'public.tenant_subscriptions'::regclass) THEN
    ALTER TABLE public.tenant_subscriptions ADD CONSTRAINT tenant_subscriptions_extra_admins_range
      CHECK (extra_admins_count >= 0 AND extra_admins_count <= 100);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.plan_admin_limit(_plan TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _plan WHEN 'basic' THEN 1 ELSE 3 END;
$$;

CREATE OR REPLACE FUNCTION public.tenant_admin_limit(_tenant UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.plan_admin_limit(COALESCE(s.plan_type, 'trial')) + COALESCE(s.extra_admins_count, 0)
    FROM (SELECT 1) one
    LEFT JOIN public.tenant_subscriptions s ON s.tenant_id = _tenant;
$$;
REVOKE ALL ON FUNCTION public.tenant_admin_limit(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_admin_limit(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_roles_admin_seat_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  used INTEGER;
  lim INTEGER;
BEGIN
  IF NEW.role IS DISTINCT FROM 'admin' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.role = 'admin' AND OLD.tenant_id = NEW.tenant_id THEN RETURN NEW; END IF;
  IF public.is_platform_admin(auth.uid()) THEN RETURN NEW; END IF;
  -- שתי הוספות במקביל לאותה חנות — אחת אחרי השנייה
  PERFORM pg_advisory_xact_lock(hashtextextended('admin_seats:' || NEW.tenant_id::text, 0));
  SELECT count(*) INTO used FROM public.user_roles
   WHERE tenant_id = NEW.tenant_id AND role = 'admin' AND user_id <> NEW.user_id;
  lim := public.tenant_admin_limit(NEW.tenant_id);
  IF used >= lim THEN
    RAISE EXCEPTION 'הגעת למגבלת המנהלים בחבילה שלך (%). שדרג את החבילה או הוסף מנהל נוסף ב-200₪ לשנה.', lim
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.user_roles_admin_seat_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS user_roles_admin_seat_guard ON public.user_roles;
CREATE TRIGGER user_roles_admin_seat_guard
BEFORE INSERT OR UPDATE OF role, tenant_id ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.user_roles_admin_seat_guard();

CREATE TABLE IF NOT EXISTS public.upgrade_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL DEFAULT 'extra_admin' CHECK (request_type IN ('extra_admin')),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'payment_link_sent', 'approved')),
  payment_url  TEXT CHECK (payment_url IS NULL OR (payment_url ~* '^https://\S+$' AND char_length(payment_url) <= 2000)),
  requested_by UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  link_sent_at TIMESTAMPTZ,
  approved_at  TIMESTAMPTZ,
  approved_by  UUID,
  CONSTRAINT upgrade_requests_link_needs_url CHECK (status <> 'payment_link_sent' OR payment_url IS NOT NULL)
);
-- בקשה פתוחה אחת לכל סוג בכל חנות
CREATE UNIQUE INDEX IF NOT EXISTS upgrade_requests_one_open
  ON public.upgrade_requests (tenant_id, request_type) WHERE status <> 'approved';
CREATE INDEX IF NOT EXISTS upgrade_requests_tenant_idx ON public.upgrade_requests (tenant_id, created_at DESC);

ALTER TABLE public.upgrade_requests ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.upgrade_requests FROM anon, authenticated;
REVOKE SELECT ON public.upgrade_requests FROM anon;
DROP POLICY IF EXISTS "upgrade requests: store admin or platform admin read" ON public.upgrade_requests;
CREATE POLICY "upgrade requests: store admin or platform admin read" ON public.upgrade_requests
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid())
         OR (tenant_id = public.current_tenant_id() AND public.is_admin(auth.uid())));

-- מצב המנהלים של החנות הנוכחית — לניהול הצוות ול"המנוי שלי"
CREATE OR REPLACE FUNCTION public.store_admin_seats()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tid UUID := public.current_tenant_id();
  _plan TEXT;
  _extra INTEGER;
  _period_end TIMESTAMPTZ;
  _trial_end TIMESTAMPTZ;
  _used INTEGER;
  _req JSONB;
BEGIN
  IF _tid IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה';
  END IF;
  SELECT COALESCE(s.plan_type, 'trial'), COALESCE(s.extra_admins_count, 0), s.current_period_end, s.trial_ends_at
    INTO _plan, _extra, _period_end, _trial_end
    FROM (SELECT 1) one LEFT JOIN public.tenant_subscriptions s ON s.tenant_id = _tid;
  SELECT count(*) INTO _used FROM public.user_roles WHERE tenant_id = _tid AND role = 'admin';
  SELECT jsonb_build_object('id', r.id, 'status', r.status, 'payment_url', r.payment_url, 'created_at', r.created_at)
    INTO _req
    FROM public.upgrade_requests r
   WHERE r.tenant_id = _tid AND r.request_type = 'extra_admin' AND r.status <> 'approved'
   ORDER BY r.created_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'plan', _plan,
    'plan_limit', public.plan_admin_limit(_plan),
    'extra', _extra,
    'limit', public.plan_admin_limit(_plan) + _extra,
    'used', _used,
    'current_period_end', _period_end,
    'trial_ends_at', _trial_end,
    'request', _req,
    'extra_seats', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('approved_at', r.approved_at,
                                          'renews_at', r.approved_at + interval '1 year')
                       ORDER BY r.approved_at)
        FROM public.upgrade_requests r
       WHERE r.tenant_id = _tid AND r.request_type = 'extra_admin' AND r.status = 'approved'), '[]'::jsonb)
  );
END; $$;

-- מנהל החנות: "שלח בקשת שדרוג" — בקשה פתוחה אחת בלבד (לחיצה חוזרת מחזירה את הקיימת)
CREATE OR REPLACE FUNCTION public.request_extra_admin()
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tid UUID := public.current_tenant_id();
  r public.upgrade_requests;
BEGIN
  IF _tid IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לשלוח בקשת שדרוג';
  END IF;
  INSERT INTO public.upgrade_requests (tenant_id, request_type, status, requested_by)
  VALUES (_tid, 'extra_admin', 'pending', auth.uid())
  ON CONFLICT DO NOTHING
  RETURNING * INTO r;
  IF r.id IS NULL THEN
    SELECT * INTO r FROM public.upgrade_requests
     WHERE tenant_id = _tid AND request_type = 'extra_admin' AND status <> 'approved'
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object('id', r.id, 'status', r.status, 'payment_url', r.payment_url, 'created_at', r.created_at);
END; $$;

-- מנהל הפלטפורמה: כל הבקשות (פתוחות קודם)
CREATE OR REPLACE FUNCTION public.platform_upgrade_requests()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN RAISE EXCEPTION 'אין הרשאה'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', r.id, 'tenant_id', r.tenant_id, 'tenant_name', t.name, 'tenant_slug', t.slug,
             'owner_email', t.owner_email, 'request_type', r.request_type, 'status', r.status,
             'payment_url', r.payment_url, 'created_at', r.created_at, 'link_sent_at', r.link_sent_at,
             'approved_at', r.approved_at, 'plan', COALESCE(s.plan_type, 'trial'),
             'extra_admins', COALESCE(s.extra_admins_count, 0),
             'admins_used', (SELECT count(*) FROM public.user_roles u WHERE u.tenant_id = r.tenant_id AND u.role = 'admin'),
             'admin_limit', public.tenant_admin_limit(r.tenant_id))
           ORDER BY (r.status = 'approved'), r.created_at DESC)
      FROM public.upgrade_requests r
      JOIN public.tenants t ON t.id = r.tenant_id
      LEFT JOIN public.tenant_subscriptions s ON s.tenant_id = r.tenant_id), '[]'::jsonb);
END; $$;

-- מנהל הפלטפורמה: קישור תשלום ללקוח ("שלח ללקוח") — גם עדכון קישור שכבר נשלח
CREATE OR REPLACE FUNCTION public.platform_send_upgrade_link(_request_id UUID, _payment_url TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE _url TEXT := btrim(COALESCE(_payment_url, ''));
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN RAISE EXCEPTION 'אין הרשאה'; END IF;
  IF _url !~* '^https://\S+$' OR char_length(_url) > 2000 THEN
    RAISE EXCEPTION 'קישור התשלום חייב להתחיל ב-https://';
  END IF;
  UPDATE public.upgrade_requests
     SET payment_url = _url, status = 'payment_link_sent', link_sent_at = now()
   WHERE id = _request_id AND status <> 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'הבקשה לא נמצאה או שכבר אושרה'; END IF;
END; $$;

-- מנהל הפלטפורמה: "אשר שדרוג" אחרי התשלום — מנהל נוסף לחנות, פעם אחת בלבד
CREATE OR REPLACE FUNCTION public.platform_approve_upgrade(_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.upgrade_requests;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN RAISE EXCEPTION 'אין הרשאה'; END IF;
  SELECT * INTO r FROM public.upgrade_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'הבקשה לא נמצאה'; END IF;
  IF r.status = 'approved' THEN RAISE EXCEPTION 'הבקשה כבר אושרה'; END IF;
  UPDATE public.tenant_subscriptions
     SET extra_admins_count = extra_admins_count + 1
   WHERE tenant_id = r.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'לחנות אין מנוי — אי אפשר להוסיף מנהל'; END IF;
  UPDATE public.upgrade_requests
     SET status = 'approved', approved_at = now(), approved_by = auth.uid()
   WHERE id = r.id;
  RETURN jsonb_build_object('tenant_id', r.tenant_id, 'admin_limit', public.tenant_admin_limit(r.tenant_id));
END; $$;

-- מנהל הפלטפורמה: מחיקת בקשה שלא אושרה (בקשה מאושרת = היסטוריה של מנהל שנרכש)
CREATE OR REPLACE FUNCTION public.platform_delete_upgrade_request(_request_id UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN RAISE EXCEPTION 'אין הרשאה'; END IF;
  DELETE FROM public.upgrade_requests WHERE id = _request_id AND status <> 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'אפשר למחוק רק בקשה שעוד לא אושרה'; END IF;
END; $$;

REVOKE ALL ON FUNCTION public.store_admin_seats(), public.request_extra_admin(),
  public.platform_upgrade_requests(), public.platform_send_upgrade_link(UUID, TEXT),
  public.platform_approve_upgrade(UUID), public.platform_delete_upgrade_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_admin_seats(), public.request_extra_admin(),
  public.platform_upgrade_requests(), public.platform_send_upgrade_link(UUID, TEXT),
  public.platform_approve_upgrade(UUID), public.platform_delete_upgrade_request(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

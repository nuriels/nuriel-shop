-- ============================================================
-- Rollback של 20261111120000_hosp_client_contracts.sql (מיגרציה 64 — מסמכי לקוחות: חוזים לחתימה דיגיטלית)
-- הגנה: נעצר כשיש חוזים כלשהם (טיוטה / נשלח / חתום — חוזה חתום הוא רשומה שאסור לאבד) או קבצים בדלי
-- hosp-contracts, ונעצר אם מיגרציה 65 עוד קיימת (היא משתמשת בטבלת החוזים). בלי חוזים: הטבלאות
-- (התבניות, החוזים, ההיסטוריה), הדלי (ריק), הדגל hospitality_contracts_enabled (וההפעלות לעסקים —
-- ב-CASCADE), הרשאת contracts שניתנה למנהלים והפונקציות נמחקים; permissions() / can() / team_members()
-- חוזרות לגרסה של מיגרציה 32 מילה במילה, וגם ה-CHECK של staff_grants (reports.finance בלבד).
-- יומן הפעולות נשאר (contracts.* ו-team.contracts_*).
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי "מסמכי לקוחות".
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF to_regprocedure('hospitality.booking_customer_update(uuid,integer,jsonb,text,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'קודם rollback של מיגרציה 65 (20261111130000_hosp_customer_details)';
  END IF;
  IF to_regclass('hospitality.client_contracts') IS NOT NULL AND EXISTS (SELECT 1 FROM hospitality.client_contracts) THEN
    RAISE EXCEPTION 'יש חוזים במערכת (גם חתומים) — rollback היה מוחק אותם. לא מבוצע';
  END IF;
  IF to_regclass('storage.objects') IS NOT NULL AND EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'hosp-contracts') THEN
    RAISE EXCEPTION 'יש קבצים בדלי hosp-contracts — לא מבוצע';
  END IF;
END $$;

-- הפונקציות (קודם — חלקן מקבלות שורה של טבלת החוזים)
DROP FUNCTION IF EXISTS hospitality._contract_body(text,integer,jsonb,jsonb,text);
DROP FUNCTION IF EXISTS hospitality._contract_booking_ids(uuid,uuid);
DROP FUNCTION IF EXISTS hospitality._contract_by_token(text,boolean);
DROP FUNCTION IF EXISTS hospitality._contract_choices(text[],text[]);
DROP FUNCTION IF EXISTS hospitality._contract_data(uuid,text,uuid,uuid,jsonb,jsonb);
DROP FUNCTION IF EXISTS hospitality._contract_json(hospitality.client_contracts);
DROP FUNCTION IF EXISTS hospitality._contract_link(text,uuid,uuid);
DROP FUNCTION IF EXISTS hospitality._contract_log(uuid,uuid,text,text,uuid,text,jsonb);
DROP FUNCTION IF EXISTS hospitality._contract_render(text,jsonb);
DROP FUNCTION IF EXISTS hospitality._contract_signer(uuid,text,uuid,uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS hospitality._contract_state(hospitality.client_contracts);
DROP FUNCTION IF EXISTS hospitality._contract_stale(hospitality.client_contracts);
DROP FUNCTION IF EXISTS hospitality._contract_pool(hospitality.client_contracts);
DROP FUNCTION IF EXISTS hospitality._contract_title(text,integer);
DROP FUNCTION IF EXISTS hospitality._contract_value(text);
DROP FUNCTION IF EXISTS hospitality._contracts_gate(uuid);
DROP FUNCTION IF EXISTS hospitality._deposit_method_label(text);
DROP FUNCTION IF EXISTS hospitality._il_id_ok(text);
DROP FUNCTION IF EXISTS hospitality._money_text(numeric);
DROP FUNCTION IF EXISTS hospitality._quoted_list(text[]);
DROP FUNCTION IF EXISTS hospitality.contract_cancel(uuid,text);
DROP FUNCTION IF EXISTS hospitality.contract_copy_prepare(uuid);
DROP FUNCTION IF EXISTS hospitality.contract_copy_result(uuid,uuid,boolean,text,uuid);
DROP FUNCTION IF EXISTS hospitality.contract_create(text,uuid,uuid,uuid,jsonb,jsonb,uuid);
DROP FUNCTION IF EXISTS hospitality.contract_file_request(uuid,text);
DROP FUNCTION IF EXISTS hospitality.contract_for_pdf(uuid,uuid);
DROP FUNCTION IF EXISTS hospitality.contract_issue_link(uuid,uuid,text,uuid);
DROP FUNCTION IF EXISTS hospitality.contract_open(text,text,text);
DROP FUNCTION IF EXISTS hospitality.contract_pdf_stored(uuid,uuid,text,text,integer);
DROP FUNCTION IF EXISTS hospitality.contract_preview(text,uuid,uuid,uuid,jsonb,jsonb);
DROP FUNCTION IF EXISTS hospitality.contract_send_prepare(uuid);
DROP FUNCTION IF EXISTS hospitality.contract_send_result(uuid,uuid,boolean,text,uuid);
DROP FUNCTION IF EXISTS hospitality.contract_sign(text,jsonb,jsonb,boolean,text,text);
DROP FUNCTION IF EXISTS hospitality.contracts_pending_work(integer);
DROP FUNCTION IF EXISTS hospitality.contracts_view();
DROP FUNCTION IF EXISTS hospitality.guest_area_document_file(text,uuid);
DROP FUNCTION IF EXISTS hospitality.guest_area_documents(text);
DROP FUNCTION IF EXISTS hospitality.staff_contract_detail(uuid);
DROP FUNCTION IF EXISTS hospitality.staff_contracts(text,text,text,text,date,date,integer,integer);
DROP FUNCTION IF EXISTS hospitality.staff_contracts_for(uuid,uuid);
DROP FUNCTION IF EXISTS hospitality.team_set_contracts(uuid,boolean);

-- הטבלאות (עם הטריגרים, המדיניות והאינדקסים שלהן), ואז פונקציות הטריגרים
DROP TABLE IF EXISTS hospitality.client_contract_log;
DROP TABLE IF EXISTS hospitality.client_contracts;
DROP TABLE IF EXISTS hospitality.contract_templates;
DROP FUNCTION IF EXISTS hospitality.client_contract_log_append_only();
DROP FUNCTION IF EXISTS hospitality.client_contracts_guard();
DROP FUNCTION IF EXISTS hospitality.contract_templates_frozen();

-- הרשאת contracts: מה שניתן למנהלים נמחק, וה-CHECK חוזר לגרסה של מיגרציה 32
DELETE FROM hospitality.staff_grants WHERE permission = 'contracts';
ALTER TABLE hospitality.staff_grants DROP CONSTRAINT IF EXISTS staff_grants_permission_check;
ALTER TABLE hospitality.staff_grants ADD CONSTRAINT staff_grants_permission_check
  CHECK (permission IN ('reports.finance'));

-- permissions() / can() / team_members() — כמו במיגרציה 32 (20261105090000_hosp_dashboard.sql)
CREATE OR REPLACE FUNCTION hospitality.permissions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY['settings', 'policies', 'catalog', 'media', 'pricing', 'bookings', 'guests',
               'reports', 'staff.managers', 'billing.manage', 'guests.privacy', 'settings.owner',
               'catalog.owner', 'reports.finance']::text[];
$$;
REVOKE ALL ON FUNCTION hospitality.permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.permissions() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.can(_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    _permission = ANY (hospitality.permissions())
    AND public.current_site_type() = 'hospitality'
    AND CASE public.store_staff_role(auth.uid())
          WHEN 'owner' THEN true
          WHEN 'manager' THEN CASE
            -- נתונים כספיים: רק מנהל שהבעלים נתן לו במפורש
            WHEN _permission = 'reports.finance' THEN EXISTS (
              SELECT 1 FROM hospitality.staff_grants g
               WHERE g.tenant_id = public.current_tenant_id() AND g.user_id = auth.uid()
                 AND g.permission = 'reports.finance')
            ELSE _permission NOT IN ('staff.managers', 'billing.manage', 'guests.privacy',
                                     'settings.owner', 'catalog.owner')
          END
          ELSE false
        END,
    false);
$$;
REVOKE ALL ON FUNCTION hospitality.can(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.can(text) TO authenticated, service_role;

-- הצוות: כמו קודם + finance (לבעלים תמיד; למנהל — אם ניתנה לו הרשאה)
CREATE OR REPLACE FUNCTION hospitality.team_members()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('staff.managers');
  _e jsonb := hospitality.entitlements(_t);
BEGIN
  RETURN jsonb_build_object(
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', ur.user_id,
               'role', CASE WHEN ur.is_protected THEN 'owner' ELSE 'manager' END,
               'display_name', ur.display_name, 'username', ur.username, 'email', lower(u.email),
               'is_blocked', ur.is_blocked, 'added_at', hospitality._ts(ur.created_at),
               'last_sign_in_at', hospitality._ts(u.last_sign_in_at),
               'finance', ur.is_protected OR EXISTS (
                 SELECT 1 FROM hospitality.staff_grants g
                  WHERE g.tenant_id = _t AND g.user_id = ur.user_id AND g.permission = 'reports.finance'))
             ORDER BY ur.is_protected DESC, ur.created_at, ur.user_id)
        FROM public.user_roles ur
        JOIN auth.users u ON u.id = ur.user_id
       WHERE ur.tenant_id = _t AND ur.role = 'admin' AND NOT public.is_platform_admin(ur.user_id)), '[]'::jsonb),
    'seats', jsonb_build_object('used', _e -> 'managers_used', 'limit', _e -> 'max_managers', 'active', _e -> 'active'));
END $$;
REVOKE ALL ON FUNCTION hospitality.team_members() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.team_members() TO authenticated, service_role;

-- הכניסה ל"ההזמנות שלי" — כמו במיגרציה 56 (20261108110000_hosp_guest_area.sql): רק לפי הזמנות
CREATE OR REPLACE FUNCTION hospitality._guest_area_has_bookings(_t uuid, _email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM hospitality.guests g
                   JOIN hospitality.bookings b ON b.tenant_id = g.tenant_id AND b.guest_id = g.id
                  WHERE g.tenant_id = _t AND g.email_normalized = _email AND g.anonymized_at IS NULL);
$$;
REVOKE ALL ON FUNCTION hospitality._guest_area_has_bookings(uuid, text) FROM PUBLIC, anon, authenticated;

-- הדלי הפרטי (ריק — נבדק למעלה)
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    DELETE FROM storage.buckets WHERE id = 'hosp-contracts';
  END IF;
END $$;

-- הדגל (וההפעלות לעסקים — tenant_feature_flags נמחקות ב-CASCADE)
DELETE FROM public.platform_feature_flags WHERE key = 'hospitality_contracts_enabled';

-- פרטיות (סעיף 8 במיגרציה 64): מחיקת פרטי הלקוח, תקופת השמירה והייצוא — כמו לפני מיגרציה 64
-- (מיגרציה 64 החליפה אותן — חזרה לגרסה הקודמת, מילה במילה)
CREATE OR REPLACE FUNCTION hospitality._anonymize_guest(_tenant_id uuid, _guest_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM hospitality.bookings b WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id
                AND hospitality._holding(b.status)) THEN
    RAISE EXCEPTION 'לאורח יש הזמנה פעילה או עתידית — אי אפשר למחוק את פרטיו עכשיו' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.guests g
     SET full_name = 'אורח שנמחק', email = NULL, phone = NULL, notes = NULL, user_id = NULL,
         marketing_consent = false, anonymized_at = now()
   WHERE g.tenant_id = _tenant_id AND g.id = _guest_id AND g.anonymized_at IS NULL;
  UPDATE hospitality.bookings b
     -- PRV-6: גם ההערות של הצוות וסיבת הביטול שהאורח כתב (טקסט חופשי — יכול להכיל מידע רגיש)
     SET special_requests = NULL, notes = NULL, cancellation_reason = NULL,
         policy_acceptance = b.policy_acceptance - 'ip' - 'user_agent',
         manage_token_hash = NULL, manage_token2_hash = NULL, manage_token_expires_at = NULL
   WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id;
  UPDATE hospitality.notifications n
     SET payload = '{}'::jsonb,
         recipient_email = CASE WHEN n.recipient_kind = 'guest' THEN 'anonymized@invalid.invalid' ELSE n.recipient_email END,
         status = CASE WHEN n.status IN ('queued', 'failed', 'sending') THEN 'dead' ELSE n.status END,
         last_error = CASE WHEN n.status IN ('queued', 'failed', 'sending') THEN 'guest anonymized' ELSE n.last_error END,
         updated_at = now()
   WHERE n.tenant_id = _tenant_id
     AND n.booking_id IN (SELECT b.id FROM hospitality.bookings b WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id);
END $function$;

CREATE OR REPLACE FUNCTION hospitality.export_guest(_guest_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _t uuid := hospitality._staff_tenant('guests.privacy');
  g hospitality.guests;
BEGIN
  SELECT * INTO g FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = _guest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'האורח לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object(
    'guest', jsonb_build_object('full_name', g.full_name, 'email', g.email, 'phone', g.phone, 'notes', g.notes,
                                'marketing_consent', g.marketing_consent, 'created_at', hospitality._ts(g.created_at),
                                'anonymized_at', hospitality._ts(g.anonymized_at)),
    'bookings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'number', b.number, 'status', b.status, 'check_in', b.check_in, 'check_out', b.check_out,
                  'adults', b.adults, 'children', b.children, 'total', b.total, 'currency', b.currency,
                  'special_requests', b.special_requests, 'policy_acceptance', b.policy_acceptance,
                  'created_at', hospitality._ts(b.created_at),
                  -- PRV-6: כל המידע על האורח בהזמנה — ההערות, סיבת הביטול, ההיסטוריה והתשלומים
                  'notes', b.notes, 'cancellation_reason', b.cancellation_reason,
                  'events', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                              'kind', e.kind, 'from_status', e.from_status, 'to_status', e.to_status,
                              'note', e.note, 'created_at', hospitality._ts(e.created_at)) ORDER BY e.created_at, e.id)
                            FROM hospitality.booking_events e WHERE e.tenant_id = _t AND e.booking_id = b.id), '[]'::jsonb),
                  'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                              'kind', p.kind, 'method', p.method, 'amount', p.amount, 'currency', p.currency,
                              'paid_at', p.paid_at, 'status', p.status, 'note', p.note,
                              'created_at', hospitality._ts(p.created_at)) ORDER BY p.created_at)
                            FROM hospitality.payments p WHERE p.tenant_id = _t AND p.booking_id = b.id), '[]'::jsonb)
                  ) ORDER BY b.check_in)
                FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.guest_id = g.id), '[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION hospitality.apply_retention()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r record;
  _n integer := 0;
BEGIN
  FOR r IN
    SELECT g.tenant_id, g.id
      FROM hospitality.guests g
      JOIN hospitality.settings s ON s.tenant_id = g.tenant_id AND s.guest_retention_months IS NOT NULL
     WHERE g.anonymized_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM hospitality.bookings b WHERE b.tenant_id = g.tenant_id AND b.guest_id = g.id
                          AND (hospitality._holding(b.status)
                               OR b.check_out > (now() - make_interval(months => s.guest_retention_months))::date))
       AND g.created_at < now() - make_interval(months => s.guest_retention_months)
  LOOP
    PERFORM hospitality._anonymize_guest(r.tenant_id, r.id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

COMMIT;

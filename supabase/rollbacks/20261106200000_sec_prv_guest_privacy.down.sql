-- ============================================================
-- Rollback ל-20261106200000_sec_prv_guest_privacy.sql: שלוש הפונקציות חוזרות לגרסת המקור.
-- הקישורים שהוסרו ממיילים שכבר נשלחו לא חוזרים (סודות שאין סיבה לשחזר), וגם הערות שנמחקו
-- באנונימיזציה — נתונים בלבד, לא סכמה.
-- ============================================================
BEGIN;

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
                  'created_at', hospitality._ts(b.created_at)) ORDER BY b.check_in)
                FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.guest_id = g.id), '[]'::jsonb));
END $function$;

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
     SET special_requests = NULL, policy_acceptance = b.policy_acceptance - 'ip' - 'user_agent',
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

CREATE OR REPLACE FUNCTION hospitality.mark_notification(_id uuid, _ok boolean, _error text DEFAULT NULL::text, _provider_message_id text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  n hospitality.notifications;
BEGIN
  SELECT * INTO n FROM hospitality.notifications x WHERE x.id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ההודעה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF n.status <> 'sending' THEN
    RETURN n.status;
  END IF;
  IF _ok THEN
    UPDATE hospitality.notifications x
       SET status = 'sent', sent_at = now(), provider_message_id = left(_provider_message_id, 200), last_error = NULL,
           locked_until = NULL, payload = x.payload - 'manage_token', updated_at = now()
     WHERE x.id = _id RETURNING * INTO n;
  ELSIF n.attempts >= 5 THEN
    UPDATE hospitality.notifications x
       SET status = 'dead', last_error = left(COALESCE(_error, 'unknown error'), 1000), locked_until = NULL,
           payload = x.payload - 'manage_token', updated_at = now()
     WHERE x.id = _id RETURNING * INTO n;
  ELSE
    UPDATE hospitality.notifications x
       SET status = 'failed', last_error = left(COALESCE(_error, 'unknown error'), 1000), locked_until = NULL,
           next_attempt_at = now() + make_interval(mins => (ARRAY[1, 5, 30, 120, 720])[greatest(x.attempts, 1)]),
           updated_at = now()
     WHERE x.id = _id RETURNING * INTO n;
  END IF;
  RETURN n.status;
END $function$;

COMMIT;

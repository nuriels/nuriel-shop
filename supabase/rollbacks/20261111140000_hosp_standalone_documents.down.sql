-- ============================================================
-- Rollback של 20261111140000_hosp_standalone_documents.sql (מסמכים עצמאיים לחתימה)
-- הגנה: נעצר כשיש מסמך עצמאי / מסמך מדיניות / מסמך שהלקוח ממלא (חתום או לא — רשומות שאסור לאבד, והן לא
-- עומדות באילוצים של מיגרציה 64). בלעדיהם: הפונקציות החדשות נמחקות; כל פונקציה שהוחלפה חוזרת לגרסה של
-- מיגרציה 64 (20261111120000_hosp_client_contracts) מילה במילה; העמודות origin / fill_mode / staff_seen_at,
-- האילוצים והאינדקסים החדשים נמחקים; האילוצים המקוריים חוזרים (סוג החוזה, הקישור להזמנה / לאירוע, שם
-- ואימייל החותם חובה, סוגי התבניות); תבנית מסמך המדיניות נמחקת.
-- נשאר: יומן הפעולות ותור המיילים (התראות document_signed שכבר נשלחו — היסטוריה; שלא נשלחו — הגרסה הקודמת
-- של האפליקציה לא מכירה אותן ומסמנת אותן שנכשלו).
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי המסמכים העצמאיים.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM hospitality.client_contracts c
              WHERE c.origin = 'standalone' OR c.kind = 'policy' OR c.fill_mode = 'customer') THEN
    RAISE EXCEPTION 'יש מסמכים עצמאיים / מסמכי מדיניות במערכת (גם חתומים) — rollback היה מוחק אותם. לא מבוצע';
  END IF;
END $$;

-- הפונקציות החדשות
DROP FUNCTION IF EXISTS hospitality.contract_standalone_preview(text, text, uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS hospitality.contract_standalone_create(text, text, uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS hospitality.contract_link_prepare(uuid);
DROP FUNCTION IF EXISTS hospitality.contract_link_shared(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS hospitality.staff_signed_documents(text, text, text, date, date, integer, integer);
DROP FUNCTION IF EXISTS hospitality.contracts_unseen();
DROP FUNCTION IF EXISTS hospitality.contracts_mark_seen(uuid[]);
DROP FUNCTION IF EXISTS hospitality._contract_data_standalone(uuid, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS hospitality._standalone_signer(uuid, text, uuid, jsonb);
DROP FUNCTION IF EXISTS hospitality._documents_gate(uuid, text);
DROP FUNCTION IF EXISTS hospitality._standalone_check(text, text);

-- הפונקציות שהוחלפו — הגרסה של מיגרציה 64, מילה במילה
CREATE OR REPLACE FUNCTION hospitality.client_contracts_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.signed_at IS NOT NULL AND pg_catalog.pg_trigger_depth() = 1 THEN
      RAISE EXCEPTION 'חוזה חתום לא נמחק' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.signed_at IS NOT NULL THEN
    IF (NEW.kind, NEW.template_version, NEW.booking_id, NEW.event_id, NEW.signer_name, NEW.signer_email,
        NEW.signer_phone, NEW.data, NEW.customer_fields, NEW.signed_at, NEW.signed_body, NEW.signed_body_sha256,
        NEW.signature, NEW.signer_ip, NEW.signer_user_agent, NEW.number, NEW.supersedes_id, NEW.created_at)
       IS DISTINCT FROM
       (OLD.kind, OLD.template_version, OLD.booking_id, OLD.event_id, OLD.signer_name, OLD.signer_email,
        OLD.signer_phone, OLD.data, OLD.customer_fields, OLD.signed_at, OLD.signed_body, OLD.signed_body_sha256,
        OLD.signature, OLD.signer_ip, OLD.signer_user_agent, OLD.number, OLD.supersedes_id, OLD.created_at)
       OR (OLD.pdf_path IS NOT NULL AND (NEW.pdf_path, NEW.pdf_sha256, NEW.pdf_size)
                                        IS DISTINCT FROM (OLD.pdf_path, OLD.pdf_sha256, OLD.pdf_size))
       OR NOT (NEW.status = OLD.status OR (OLD.status = 'signed' AND NEW.status = 'superseded')) THEN
      RAISE EXCEPTION 'חוזה חתום לא משתנה — אפשר להפיק חוזה מתוקן לחתימה מחדש' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.client_contracts_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality._contract_body(_kind text, _version integer, _data jsonb, _fields jsonb,
                                                      _signed_on text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT hospitality._contract_render(t.body,
           _data || jsonb_build_object(
             'signing_date', _signed_on,
             'signer_id_number', _fields ->> 'id_number',
             'signer_address', _fields ->> 'address')
                 || CASE WHEN _data ->> 'deposit_method' IS NULL AND _fields ->> 'deposit_method' IS NOT NULL
                         THEN jsonb_build_object('deposit_method', hospitality._contract_choices(
                                ARRAY['מזומן', 'צ''ק ביטחון', 'כרטיס אשראי (תפיסת מסגרת)'],
                                ARRAY[hospitality._deposit_method_label(_fields ->> 'deposit_method')]))
                         WHEN _data ->> 'deposit_method' IS NULL
                         THEN jsonb_build_object('deposit_method', hospitality._contract_choices(
                                ARRAY['מזומן', 'צ''ק ביטחון', 'כרטיס אשראי (תפיסת מסגרת)'], ARRAY[]::text[]))
                         ELSE '{}'::jsonb END)
    FROM hospitality.contract_templates t WHERE t.key = _kind AND t.version = _version;
$$;
REVOKE ALL ON FUNCTION hospitality._contract_body(text, integer, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._contract_stale(c hospitality.client_contracts)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _now jsonb;
BEGIN
  IF c.id IS NULL OR c.signed_at IS NOT NULL OR c.status NOT IN ('draft', 'sent', 'viewed') THEN
    RETURN NULL;
  END IF;
  BEGIN
    _now := hospitality._contract_data(c.tenant_id, c.kind, c.booking_id, c.event_id,
              jsonb_build_object('full_name', c.data ->> 'signer_name', 'email', c.data ->> 'signer_email',
                                 'phone', c.data ->> 'signer_phone'),
              COALESCE(c.data -> 'options', '{}'::jsonb));
  EXCEPTION WHEN OTHERS THEN
    RETURN 'unavailable';
  END;
  IF hospitality._contract_body(c.kind, c.template_version, _now, '{}'::jsonb, NULL)
       IS DISTINCT FROM hospitality._contract_body(c.kind, c.template_version, c.data, '{}'::jsonb, NULL)
     OR (_now ->> 'pool_start_time', _now ->> 'pool_end_time')
       IS DISTINCT FROM (c.data ->> 'pool_start_time', c.data ->> 'pool_end_time') THEN
    RETURN 'changed';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION hospitality._contract_stale(hospitality.client_contracts) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._contract_json(c hospitality.client_contracts)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'number', c.number, 'kind', c.kind, 'template_version', c.template_version,
    'title', hospitality._contract_title(c.kind, c.template_version),
    'booking_id', c.booking_id, 'event_id', c.event_id, 'guest_id', c.guest_id,
    'booking_type', CASE c.kind WHEN 'hosting' THEN 'hosting' ELSE 'event' END,
    'link_number', COALESCE(c.data ->> 'booking_number', c.data ->> 'event_number'),
    'event_type', c.data ->> 'event_type', 'event_purpose', c.data ->> 'event_purpose',
    'service_date', c.data ->> 'service_date', 'service_end', c.data ->> 'service_end',
    'signer_name', c.signer_name, 'signer_email', c.signer_email, 'signer_phone', c.signer_phone,
    'status', hospitality._contract_state(c), 'stored_status', c.status,
    'sent_at', hospitality._ts(c.sent_at), 'last_sent_at', hospitality._ts(c.last_sent_at), 'send_count', c.send_count,
    'send_error', c.send_error, 'viewed_at', hospitality._ts(c.viewed_at),
    'link_expires_at', hospitality._ts(c.token_expires_at),
    'signed_at', hospitality._ts(c.signed_at), 'has_pdf', c.pdf_path IS NOT NULL, 'pdf_sha256', c.pdf_sha256,
    'signed_body_sha256', c.signed_body_sha256,
    'copy_sent_at', hospitality._ts(c.copy_sent_at), 'copy_error', c.copy_error,
    'supersedes_id', c.supersedes_id, 'superseded_by_id', c.superseded_by_id, 'cancel_reason', c.cancel_reason,
    'stale', hospitality._contract_stale(c), 'pool', hospitality._contract_pool(c),
    'created_at', hospitality._ts(c.created_at));
$$;
REVOKE ALL ON FUNCTION hospitality._contract_json(hospitality.client_contracts) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.contracts_view()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
BEGIN
  RETURN jsonb_build_object(
    'enabled', hospitality.flag_for('hospitality_contracts_enabled', _t),
    'terms', hospitality._terms_json(hospitality._terms(_t)),
    'templates', (SELECT jsonb_agg(jsonb_build_object('kind', t.key, 'version', t.version, 'title', t.title,
                                                      'body_hash', t.body_hash) ORDER BY t.key DESC)
                    FROM (SELECT DISTINCT ON (x.key) x.* FROM hospitality.contract_templates x ORDER BY x.key, x.version DESC) t),
    'counts', (SELECT jsonb_build_object(
                 'all', count(*), 'signed', count(*) FILTER (WHERE c.status = 'signed'),
                 'waiting', count(*) FILTER (WHERE hospitality._contract_state(c) IN ('sent', 'viewed')),
                 'draft', count(*) FILTER (WHERE c.status = 'draft'))
                 FROM hospitality.client_contracts c WHERE c.tenant_id = _t),
    'can_confirm_terms', hospitality.can('settings.owner'));
END $$;
REVOKE ALL ON FUNCTION hospitality.contracts_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.contracts_view() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.contract_send_prepare(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  c hospitality.client_contracts;
BEGIN
  PERFORM hospitality._contracts_gate(_t);
  SELECT * INTO c FROM hospitality.client_contracts x WHERE x.tenant_id = _t AND x.id = _id;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'החוזה לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.status NOT IN ('draft', 'sent', 'viewed') THEN
    RAISE EXCEPTION 'אפשר לשלוח רק חוזה שעוד לא נחתם' USING ERRCODE = 'check_violation';
  END IF;
  CASE hospitality._contract_stale(c)
    WHEN 'changed' THEN
      RAISE EXCEPTION 'פרטי ההזמנה / האירוע השתנו מאז שהחוזה נוצר — שלחו חוזה מעודכן (במסך "שליחת חוזה")'
        USING ERRCODE = 'check_violation';
    WHEN 'unavailable' THEN
      RAISE EXCEPTION 'ההזמנה / האירוע בוטלו (או שחסרים פרטים לחוזה) — אי אפשר לשלוח את החוזה הזה'
        USING ERRCODE = 'check_violation';
    ELSE NULL;
  END CASE;
  RETURN hospitality._contract_json(c) || jsonb_build_object('tenant_id', _t, 'actor_id', auth.uid(),
                                                             'business_name', c.data ->> 'business_name',
                                                             'business_email', c.data ->> 'business_email',
                                                             'business_phone', c.data ->> 'business_phone');
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_send_prepare(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.contract_send_prepare(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.staff_contracts(_q text DEFAULT NULL, _kind text DEFAULT NULL,
                                                       _status text DEFAULT NULL, _event_type text DEFAULT NULL,
                                                       _from date DEFAULT NULL, _to date DEFAULT NULL,
                                                       _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('contracts');
  _s text := NULLIF(btrim(COALESCE(_q, '')), '');
  _digits text := NULLIF(regexp_replace(COALESCE(_q, ''), '[^0-9]', '', 'g'), '');
  _rows jsonb;
  _total integer;
BEGIN
  IF _kind IS NOT NULL AND _kind NOT IN ('hosting', 'pool_event') THEN
    RAISE EXCEPTION 'סוג החוזה לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  IF _status IS NOT NULL AND _status NOT IN ('draft', 'sent', 'viewed', 'signed', 'superseded', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'מצב לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  WITH hits AS (
    SELECT c.id, c.created_at FROM hospitality.client_contracts c
     WHERE c.tenant_id = _t
       AND (_kind IS NULL OR c.kind = _kind)
       AND (_status IS NULL OR hospitality._contract_state(c) = _status)
       AND (_event_type IS NULL OR c.data ->> 'event_type' = _event_type)
       AND (_from IS NULL OR (c.data ->> 'service_date')::date >= _from)
       AND (_to IS NULL OR (c.data ->> 'service_date')::date <= _to)
       AND (_s IS NULL OR c.signer_name ILIKE '%' || _s || '%' OR c.signer_email_normalized LIKE '%' || lower(_s) || '%'
            OR (_digits IS NOT NULL AND (regexp_replace(COALESCE(c.signer_phone, ''), '[^0-9]', '', 'g') LIKE '%' || _digits || '%'
                                         OR c.number::text = _digits
                                         OR c.data ->> 'booking_number' = _digits OR c.data ->> 'event_number' = _digits)))
  ), page AS (
    SELECT h.id FROM hits h ORDER BY h.created_at DESC, h.id
     LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200) OFFSET GREATEST(COALESCE(_offset, 0), 0)
  )
  SELECT (SELECT count(*)::integer FROM hits),
         COALESCE((SELECT jsonb_agg(hospitality._contract_json(c) ORDER BY c.created_at DESC, c.id)
                     FROM hospitality.client_contracts c WHERE c.tenant_id = _t AND c.id IN (SELECT id FROM page)), '[]'::jsonb)
    INTO _total, _rows;
  RETURN jsonb_build_object('rows', _rows, 'total', _total);
END $$;
REVOKE ALL ON FUNCTION hospitality.staff_contracts(text, text, text, text, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.staff_contracts(text, text, text, text, date, date, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality._contract_by_token(_token_hash text, _lock boolean)
RETURNS hospitality.client_contracts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality.request_tenant();
  c hospitality.client_contracts;
BEGIN
  IF _t IS NULL OR NOT hospitality.flag_for('hospitality_backend_enabled', _t)
     OR NOT hospitality.flag_for('hospitality_contracts_enabled', _t) THEN
    RAISE EXCEPTION 'החתימה על חוזים אינה זמינה באתר הזה' USING ERRCODE = 'feature_not_supported';
  END IF;
  IF COALESCE(_token_hash, '') ~ '^[0-9a-f]{64}$' THEN
    IF _lock THEN
      SELECT * INTO c FROM hospitality.client_contracts x WHERE x.tenant_id = _t AND x.token_hash = _token_hash FOR UPDATE;
    ELSE
      SELECT * INTO c FROM hospitality.client_contracts x WHERE x.tenant_id = _t AND x.token_hash = _token_hash;
    END IF;
  END IF;
  -- טיוטה עם קישור: המייל יצא, והתוצאה עוד לא נרשמה (רגע בין השליחה לרישום) — כמו "נשלח"
  IF c.id IS NULL OR c.status NOT IN ('draft', 'sent', 'viewed') THEN
    RAISE EXCEPTION 'הקישור לחתימה לא תקין או שכבר שומש — אם צריך, בקשו מהעסק לשלוח שוב' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.token_expires_at <= now() THEN
    RAISE EXCEPTION 'הקישור לחתימה פג תוקף — בקשו מהעסק לשלוח קישור חדש' USING ERRCODE = 'no_data_found';
  END IF;
  -- לא חותמים על פרטים שכבר לא נכונים: ההזמנה / האירוע בוטלו או השתנו מאז שנשלח ההסכם
  CASE hospitality._contract_stale(c)
    WHEN 'changed' THEN
      RAISE EXCEPTION 'פרטי ההזמנה / האירוע השתנו מאז שנשלח ההסכם, ולכן אי אפשר לחתום עליו — העסק ישלח לכם הסכם מעודכן'
        USING ERRCODE = 'no_data_found';
    WHEN 'unavailable' THEN
      RAISE EXCEPTION 'ההסכם כבר לא בתוקף (ההזמנה / האירוע בוטלו או השתנו) — לפרטים פנו לעסק'
        USING ERRCODE = 'no_data_found';
    ELSE NULL;
  END CASE;
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION hospitality._contract_by_token(text, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.contract_open(_token_hash text, _ip text DEFAULT NULL, _user_agent text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c hospitality.client_contracts := hospitality._contract_by_token(_token_hash, true);
BEGIN
  IF c.viewed_at IS NULL THEN
    UPDATE hospitality.client_contracts x SET status = 'viewed', viewed_at = now(), updated_at = now()
     WHERE x.id = c.id RETURNING * INTO c;
    PERFORM hospitality._contract_log(c.tenant_id, c.id, 'viewed', 'customer', NULL, _ip,
                                      jsonb_build_object('user_agent', left(_user_agent, 200)));
  END IF;
  RETURN jsonb_build_object(
    'number', c.number, 'kind', c.kind, 'title', hospitality._contract_title(c.kind, c.template_version),
    'business_name', c.data ->> 'business_name', 'business_phone', c.data ->> 'business_phone',
    'business_email', c.data ->> 'business_email',
    'signer_name', c.signer_name, 'signer_phone', c.signer_phone, 'signer_email', c.signer_email,
    'body', hospitality._contract_body(c.kind, c.template_version, c.data, '{}'::jsonb, NULL),
    'needs_deposit_method', c.kind = 'hosting' AND c.data ->> 'deposit_method' IS NULL,
    'pool', hospitality._contract_pool(c),
    'id_label', CASE WHEN c.kind = 'pool_event' THEN 'תעודת זהות / ח.פ' ELSE 'תעודת זהות' END,
    'expires_at', hospitality._ts(c.token_expires_at));
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_open(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.contract_open(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION hospitality.contract_sign(_token_hash text, _fields jsonb, _signature jsonb, _agreed boolean,
                                                     _ip text DEFAULT NULL, _user_agent text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c hospitality.client_contracts := hospitality._contract_by_token(_token_hash, true);
  _id_number text;
  _address text;
  _method text;
  _f jsonb;
  _sig jsonb;
  _body text;
  _tz text;
  _old uuid;
BEGIN
  IF _agreed IS NOT TRUE THEN
    RAISE EXCEPTION 'יש לאשר שקראתם את כל סעיפי ההסכם ושאתם מסכימים להם' USING ERRCODE = 'check_violation';
  END IF;
  IF _fields IS NULL OR jsonb_typeof(_fields) <> 'object' THEN
    RAISE EXCEPTION 'חסרים פרטים' USING ERRCODE = 'check_violation';
  END IF;
  _id_number := regexp_replace(COALESCE(_fields ->> 'id_number', ''), '[^0-9]', '', 'g');
  IF NOT hospitality._il_id_ok(_id_number) THEN
    RAISE EXCEPTION 'מספר תעודת הזהות / ח.פ לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  _address := hospitality._contract_value(hospitality._cv_text(_fields -> 'address', 'כתובת המגורים', 200, true));
  IF char_length(_address) < 4 THEN
    RAISE EXCEPTION 'נא למלא כתובת מגורים מלאה' USING ERRCODE = 'check_violation';
  END IF;
  IF c.kind = 'hosting' AND c.data ->> 'deposit_method' IS NULL THEN
    _method := hospitality._cv_choice(_fields -> 'deposit_method', 'אמצעי הפיקדון', ARRAY['cash', 'check', 'card']);
  END IF;
  IF _signature IS NULL OR jsonb_typeof(_signature) <> 'object' THEN
    RAISE EXCEPTION 'חסרה חתימה' USING ERRCODE = 'check_violation';
  END IF;
  IF _signature ->> 'kind' = 'drawn' THEN
    _sig := jsonb_build_object('kind', 'drawn', 'paths', hospitality._signature_paths(_signature -> 'paths', false));
  ELSIF _signature ->> 'kind' = 'typed' THEN
    _sig := jsonb_build_object('kind', 'typed', 'name',
                               hospitality._contract_value(hospitality._cv_text(_signature -> 'name', 'החתימה בהקלדה', 80, true)));
    IF char_length(_sig ->> 'name') < 2 THEN
      RAISE EXCEPTION 'כתבו את השם המלא כחתימה' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'חסרה חתימה' USING ERRCODE = 'check_violation';
  END IF;
  _f := jsonb_build_object('id_number', lpad(_id_number, 9, '0'), 'address', _address)
        || CASE WHEN _method IS NOT NULL THEN jsonb_build_object('deposit_method', _method) ELSE '{}'::jsonb END;
  SELECT COALESCE(s.timezone, 'Asia/Jerusalem') INTO _tz FROM hospitality.settings s WHERE s.tenant_id = c.tenant_id;
  _body := hospitality._contract_body(c.kind, c.template_version, c.data, _f,
                                      to_char(now() AT TIME ZONE COALESCE(_tz, 'Asia/Jerusalem'), 'DD.MM.YYYY'));
  -- חוזה מתוקן: החוזה החתום שבתוקף לאותה הזמנה / לאותו אירוע "הוחלף" — לפני שהחדש מסומן חתום (חתום
  -- אחד בתוקף). גם כשבדרך הוחלפה טיוטה מתוקנת שלא נחתמה (A חתום → B מתוקן → C במקום B): C מחליף את A
  IF c.supersedes_id IS NOT NULL THEN
    FOR _old IN
      UPDATE hospitality.client_contracts x SET status = 'superseded', superseded_by_id = c.id, updated_at = now()
       WHERE x.tenant_id = c.tenant_id AND x.id <> c.id AND x.status = 'signed'
         AND ((c.booking_id IS NOT NULL AND x.booking_id = ANY (hospitality._contract_booking_ids(c.tenant_id, c.booking_id)))
              OR (c.event_id IS NOT NULL AND x.event_id = c.event_id))
      RETURNING x.id
    LOOP
      PERFORM hospitality._contract_log(c.tenant_id, _old, 'superseded', 'system', NULL, NULL,
                                        jsonb_build_object('by', c.id, 'by_number', c.number));
    END LOOP;
  END IF;
  UPDATE hospitality.client_contracts x
     SET status = 'signed', signed_at = now(), customer_fields = _f, signature = _sig, signed_body = _body,
         signed_body_sha256 = hospitality._text_hash(_body),
         signer_ip = left(_ip, 64), signer_user_agent = left(_user_agent, 400), token_hash = NULL, updated_at = now()
   WHERE x.id = c.id
  RETURNING * INTO c;
  PERFORM hospitality._contract_log(c.tenant_id, c.id, 'signed', 'customer', NULL, _ip,
    jsonb_build_object('signature', _sig ->> 'kind', 'body_sha256', c.signed_body_sha256, 'user_agent', left(_user_agent, 200)));
  PERFORM hospitality._audit(c.tenant_id, 'contracts.signed', 'חוזה #' || c.number,
                             jsonb_build_object('kind', c.kind, 'signature', _sig ->> 'kind'));
  RETURN jsonb_build_object('tenant_id', c.tenant_id, 'id', c.id, 'number', c.number);
END $$;
REVOKE ALL ON FUNCTION hospitality.contract_sign(text, jsonb, jsonb, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.contract_sign(text, jsonb, jsonb, boolean, text, text) TO service_role;

CREATE OR REPLACE FUNCTION hospitality.guest_area_documents(_session_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  _e text := hospitality._guest_area_email(_t, _session_hash);
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
                     'id', c.id, 'number', c.number, 'kind', c.kind,
                     'title', hospitality._contract_title(c.kind, c.template_version),
                     'signed_at', hospitality._ts(c.signed_at), 'status', c.status,
                     'service_date', c.data ->> 'service_date', 'event_purpose', c.data ->> 'event_purpose',
                     'has_pdf', c.pdf_path IS NOT NULL) ORDER BY c.signed_at DESC)
                     FROM hospitality.client_contracts c
                    WHERE c.tenant_id = _t AND c.signer_email_normalized = _e AND c.signed_at IS NOT NULL), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_area_documents(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.guest_area_documents(text) TO service_role;

CREATE OR REPLACE FUNCTION hospitality._anonymize_guest(_tenant_id uuid, _guest_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM hospitality.bookings b WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id
                AND hospitality._holding(b.status)) THEN
    RAISE EXCEPTION 'לאורח יש הזמנה פעילה או עתידית — אי אפשר למחוק את פרטיו עכשיו' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM hospitality.events e WHERE e.tenant_id = _tenant_id AND e.guest_id = _guest_id
                AND e.status IN ('pending', 'confirmed') AND e.ends_at > now()) THEN
    RAISE EXCEPTION 'ללקוח יש אירוע פעיל או עתידי — אי אפשר למחוק את פרטיו עכשיו' USING ERRCODE = 'check_violation';
  END IF;
  -- החוזים שלא נחתמו — לפני שמשנים את ההזמנות (כדי למצוא את כולם: לפי הכרטיס, ההזמנות והאירועים)
  DELETE FROM hospitality.client_contracts c
   WHERE c.tenant_id = _tenant_id AND c.signed_at IS NULL
     AND (c.guest_id = _guest_id
          OR c.booking_id IN (SELECT b.id FROM hospitality.bookings b WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id)
          OR c.event_id IN (SELECT e.id FROM hospitality.events e WHERE e.tenant_id = _tenant_id AND e.guest_id = _guest_id));
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
  UPDATE hospitality.events e
     SET internal_notes = NULL, cancel_reason = NULL, updated_at = now()
   WHERE e.tenant_id = _tenant_id AND e.guest_id = _guest_id
     AND (e.internal_notes IS NOT NULL OR e.cancel_reason IS NOT NULL);
  UPDATE hospitality.notifications n
     SET payload = '{}'::jsonb,
         recipient_email = CASE WHEN n.recipient_kind = 'guest' THEN 'anonymized@invalid.invalid' ELSE n.recipient_email END,
         status = CASE WHEN n.status IN ('queued', 'failed', 'sending') THEN 'dead' ELSE n.status END,
         last_error = CASE WHEN n.status IN ('queued', 'failed', 'sending') THEN 'guest anonymized' ELSE n.last_error END,
         updated_at = now()
   WHERE n.tenant_id = _tenant_id
     AND n.booking_id IN (SELECT b.id FROM hospitality.bookings b WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id);
END $$;
REVOKE ALL ON FUNCTION hospitality._anonymize_guest(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.export_guest(_guest_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
                FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.guest_id = g.id), '[]'::jsonb),
    -- מיגרציה 63: האירועים במתחם
    'pool_events', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'number', e.number, 'status', e.status, 'event_type', e.event_type, 'event_date', e.event_date,
                  'start_time', to_char(e.start_time, 'HH24:MI'), 'end_time', to_char(e.end_time, 'HH24:MI'),
                  'participants', e.participants, 'price', e.price, 'amount_paid', e.amount_paid,
                  'refund_amount', e.refund_amount, 'deposit_status', e.deposit_status,
                  'internal_notes', e.internal_notes, 'cancel_reason', e.cancel_reason,
                  'created_at', hospitality._ts(e.created_at)) ORDER BY e.starts_at)
                FROM hospitality.events e WHERE e.tenant_id = _t AND e.guest_id = g.id), '[]'::jsonb),
    -- מיגרציה 64: החוזים (של הכרטיס, ההזמנות והאירועים שלו)
    'contracts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'number', c.number, 'kind', c.kind, 'template_version', c.template_version, 'status', c.status,
                  'signer_name', c.signer_name, 'signer_email', c.signer_email, 'signer_phone', c.signer_phone,
                  'sent_at', hospitality._ts(c.sent_at), 'signed_at', hospitality._ts(c.signed_at),
                  'customer_fields', c.customer_fields, 'signer_ip', c.signer_ip,
                  'signed_body_sha256', c.signed_body_sha256, 'has_pdf', c.pdf_path IS NOT NULL) ORDER BY c.created_at)
                FROM hospitality.client_contracts c
               WHERE c.tenant_id = _t
                 AND (c.guest_id = g.id
                      OR c.booking_id IN (SELECT b.id FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.guest_id = g.id)
                      OR c.event_id IN (SELECT e.id FROM hospitality.events e WHERE e.tenant_id = _t AND e.guest_id = g.id))),
              '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.export_guest(uuid) FROM PUBLIC, anon;

-- אחרי שהפונקציות חזרו (אף אחת כבר לא משתמשת בהן)
DROP FUNCTION IF EXISTS hospitality._contract_doc_title(text, integer, jsonb);
DROP FUNCTION IF EXISTS hospitality._policy_lines(text);

-- המבנה: האילוצים, האינדקסים והעמודות של מיגרציה 64
DROP INDEX IF EXISTS hospitality.client_contracts_signed_idx;
DROP INDEX IF EXISTS hospitality.client_contracts_unseen_idx;
ALTER TABLE hospitality.client_contracts DROP CONSTRAINT IF EXISTS client_contracts_fill_check;
ALTER TABLE hospitality.client_contracts DROP CONSTRAINT IF EXISTS client_contracts_link_check;
ALTER TABLE hospitality.client_contracts DROP CONSTRAINT IF EXISTS client_contracts_origin_check;
ALTER TABLE hospitality.client_contracts DROP CONSTRAINT IF EXISTS client_contracts_fill_mode_check;
ALTER TABLE hospitality.client_contracts DROP COLUMN IF EXISTS origin;
ALTER TABLE hospitality.client_contracts DROP COLUMN IF EXISTS fill_mode;
ALTER TABLE hospitality.client_contracts DROP COLUMN IF EXISTS staff_seen_at;
ALTER TABLE hospitality.client_contracts ALTER COLUMN signer_name SET NOT NULL;
ALTER TABLE hospitality.client_contracts ALTER COLUMN signer_email SET NOT NULL;
ALTER TABLE hospitality.client_contracts DROP CONSTRAINT IF EXISTS client_contracts_kind_check;
ALTER TABLE hospitality.client_contracts ADD CONSTRAINT client_contracts_kind_check
  CHECK (kind IN ('hosting', 'pool_event'));
ALTER TABLE hospitality.client_contracts DROP CONSTRAINT IF EXISTS client_contracts_check;
ALTER TABLE hospitality.client_contracts ADD CONSTRAINT client_contracts_check
  CHECK (CASE kind WHEN 'hosting' THEN booking_id IS NOT NULL AND event_id IS NULL
                   ELSE event_id IS NOT NULL AND booking_id IS NULL END);

-- תבנית מסמך המדיניות (התבניות לא משתנות — הטריגר מושבת רק לרגע הזה, בתוך הטרנזקציה)
ALTER TABLE hospitality.contract_templates DISABLE TRIGGER contract_templates_frozen;
DELETE FROM hospitality.contract_templates WHERE key = 'policy';
ALTER TABLE hospitality.contract_templates ENABLE TRIGGER contract_templates_frozen;
ALTER TABLE hospitality.contract_templates DROP CONSTRAINT IF EXISTS contract_templates_key_check;
ALTER TABLE hospitality.contract_templates ADD CONSTRAINT contract_templates_key_check
  CHECK (key IN ('hosting', 'pool_event'));

COMMIT;

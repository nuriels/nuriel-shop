-- ============================================================
-- Hospitality — תשתית תשלומים (Stage 8, חלק ראשון; אושר 02/11 כ"הכנת התשתית")
--
--   • payments — יומן תשלומים לכל הזמנה: מקדמה / יתרה / מלא / החזר / אחר; אמצעי (מזומן, העברה,
--     Bit, כרטיס, צ'ק, ספק סליקה, אחר); סכום, תאריך, הערה; ספק + מזהה אצל הספק (ייחודי —
--     לרישום אידמפוטנטי מ-webhook בעתיד). שורה לא משתנה: רק ביטול (עם סיבה), נשאר בהיסטוריה;
--   • bookings.amount_paid = התשלומים פחות ההחזרים (שאינם מבוטלים) — כך חישובי הביטול הקיימים
--     (refund_due / charge_due) מתבססים על מה ששולם בפועל;
--   • לצוות (bookings): booking_payments, payment_record, payment_void — בהיסטוריית ההזמנה וביומן;
--   • לשרת בלבד: payment_provider_record — רישום מספק סליקה (idempotent לפי provider_ref).
-- בלי חיבור לספק סליקה עדיין (דורש החלטה על חשבונות הסליקה — OD-16).
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS hospitality.payments (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  booking_id   uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('deposit', 'balance', 'full', 'refund', 'other')),
  method       text NOT NULL CHECK (method IN ('cash', 'transfer', 'bit', 'card', 'check', 'provider', 'other')),
  amount       numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  currency     text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  paid_at      date NOT NULL,
  note         text CHECK (note IS NULL OR char_length(note) <= 300),
  provider     text CHECK (provider IS NULL OR provider ~ '^[a-z0-9_-]{2,30}$'),
  provider_ref text CHECK (provider_ref IS NULL OR char_length(provider_ref) BETWEEN 1 AND 200),
  status       text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'voided')),
  voided_at    timestamptz,
  void_reason  text CHECK (void_reason IS NULL OR char_length(void_reason) <= 300),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK ((status = 'voided') = (voided_at IS NOT NULL)),
  CHECK ((provider IS NULL) = (provider_ref IS NULL)),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES hospitality.bookings (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS payments_booking_idx ON hospitality.payments (tenant_id, booking_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref ON hospitality.payments (tenant_id, provider, provider_ref)
  WHERE provider_ref IS NOT NULL;
COMMENT ON TABLE hospitality.payments IS
  'Hospitality: יומן תשלומים והחזרים להזמנה — לא משתנה (רק ביטול עם סיבה); רק דרך פונקציות';
ALTER TABLE hospitality.payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hospitality.payments FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS tenant_isolation ON hospitality.payments;
CREATE POLICY tenant_isolation ON hospitality.payments AS RESTRICTIVE
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS backend_enabled ON hospitality.payments;
CREATE POLICY backend_enabled ON hospitality.payments AS RESTRICTIVE
  USING ((SELECT hospitality.flag('hospitality_backend_enabled')))
  WITH CHECK ((SELECT hospitality.flag('hospitality_backend_enabled')));
DROP TRIGGER IF EXISTS tenant_guard ON hospitality.payments;
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE OF tenant_id ON hospitality.payments
  FOR EACH ROW EXECUTE FUNCTION hospitality.tenant_guard();

-- שורת תשלום לא משתנה — רק מעבר אחד: recorded → voided (עם סיבה)
CREATE OR REPLACE FUNCTION hospitality.payments_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status <> 'recorded' OR NEW.status <> 'voided'
     OR (to_jsonb(NEW) - 'status' - 'voided_at' - 'void_reason') <> (to_jsonb(OLD) - 'status' - 'voided_at' - 'void_reason') THEN
    RAISE EXCEPTION 'תשלום שנרשם לא משתנה — אפשר רק לבטל אותו' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
-- פונקציית טריגר — לא נקראת מה-API
REVOKE ALL ON FUNCTION hospitality.payments_immutable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS payments_immutable ON hospitality.payments;
CREATE TRIGGER payments_immutable BEFORE UPDATE ON hospitality.payments
  FOR EACH ROW EXECUTE FUNCTION hospitality.payments_immutable();

-- ------------------------------------------------------------
-- amount_paid = תשלומים − החזרים (שאינם מבוטלים)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._payments_sync(_t uuid, _booking_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _paid numeric;
BEGIN
  SELECT COALESCE(sum(CASE WHEN p.kind = 'refund' THEN -p.amount ELSE p.amount END), 0) INTO _paid
    FROM hospitality.payments p
   WHERE p.tenant_id = _t AND p.booking_id = _booking_id AND p.status = 'recorded';
  _paid := greatest(_paid, 0);
  UPDATE hospitality.bookings b SET amount_paid = _paid
   WHERE b.tenant_id = _t AND b.id = _booking_id AND b.amount_paid IS DISTINCT FROM _paid;
  RETURN _paid;
END $$;
REVOKE ALL ON FUNCTION hospitality._payments_sync(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._payments_json(_t uuid, _booking_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'booking_id', b.id, 'number', b.number, 'status', b.status, 'currency', b.currency,
    'total', b.total, 'deposit_amount', b.deposit_amount, 'amount_paid', b.amount_paid,
    -- יתרה לתשלום — רק בהזמנה פעילה
    'balance_due', CASE WHEN b.status IN ('pending_payment', 'confirmed', 'cancel_requested', 'checked_in', 'checked_out')
                        THEN greatest(b.total - b.amount_paid, 0) ELSE 0 END,
    -- הזמנה שבוטלה: ההחזר שחושב בביטול, פחות מה שכבר הוחזר מאז
    'refund_due', CASE WHEN b.status IN ('cancelled', 'no_show') AND b.cancellation_outcome ? 'final_fee'
                       THEN greatest(b.amount_paid - (b.cancellation_outcome ->> 'final_fee')::numeric, 0)
                       WHEN b.status IN ('cancelled', 'declined', 'expired') AND NOT (b.cancellation_outcome ? 'final_fee')
                       THEN b.amount_paid ELSE 0 END,
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', p.id, 'kind', p.kind, 'method', p.method, 'amount', p.amount, 'currency', p.currency,
                  'paid_at', p.paid_at, 'note', p.note, 'provider', p.provider, 'status', p.status,
                  'void_reason', p.void_reason, 'voided_at', hospitality._ts(p.voided_at),
                  'created_at', hospitality._ts(p.created_at)) ORDER BY p.paid_at DESC, p.created_at DESC)
                  FROM hospitality.payments p WHERE p.tenant_id = _t AND p.booking_id = b.id), '[]'::jsonb))
    FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.id = _booking_id;
$$;
REVOKE ALL ON FUNCTION hospitality._payments_json(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- לצוות (הרשאת bookings)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.booking_payments(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  _r jsonb;
BEGIN
  _r := hospitality._payments_json(_t, _booking_id);
  IF _r IS NULL THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN _r;
END $$;
REVOKE ALL ON FUNCTION hospitality.booking_payments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.booking_payments(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality._payment_insert(_t uuid, b hospitality.bookings, _kind text, _method text,
                                                      _amount numeric, _paid_at date, _note text,
                                                      _provider text, _provider_ref text, _actor text)
RETURNS hospitality.payments LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p hospitality.payments;
  _today date := (SELECT (now() AT TIME ZONE s.timezone)::date FROM hospitality.settings s WHERE s.tenant_id = _t);
BEGIN
  IF _amount IS NULL OR _amount <= 0 OR _amount > 10000000 THEN
    RAISE EXCEPTION 'הסכום לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _paid_at IS NULL OR _paid_at > COALESCE(_today, current_date) + 1 OR _paid_at < COALESCE(_today, current_date) - 730 THEN
    RAISE EXCEPTION 'תאריך התשלום לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _kind = 'refund' AND _amount > b.amount_paid THEN
    RAISE EXCEPTION 'ההחזר גדול מהסכום ששולם (%)', b.amount_paid USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO hospitality.payments (tenant_id, booking_id, kind, method, amount, currency, paid_at, note,
                                    provider, provider_ref, created_by)
  VALUES (_t, b.id, _kind, _method, round(_amount, 2), b.currency, _paid_at, NULLIF(btrim(COALESCE(_note, '')), ''),
          _provider, _provider_ref, auth.uid())
  RETURNING * INTO p;
  PERFORM hospitality._payments_sync(_t, b.id);
  INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes)
  VALUES (_t, b.id, CASE WHEN _kind = 'refund' THEN 'refund_recorded' ELSE 'payment_recorded' END, _actor, auth.uid(),
          jsonb_build_object('kind', _kind, 'method', _method, 'amount', p.amount, 'paid_at', p.paid_at));
  RETURN p;
END $$;
REVOKE ALL ON FUNCTION hospitality._payment_insert(uuid, hospitality.bookings, text, text, numeric, date, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.payment_record(_booking_id uuid, _kind text, _method text, _amount numeric,
                                                     _paid_at date, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  b hospitality.bookings;
  p hospitality.payments;
BEGIN
  IF _kind IS NULL OR _kind NOT IN ('deposit', 'balance', 'full', 'refund', 'other') THEN
    RAISE EXCEPTION 'סוג התשלום לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _method IS NULL OR _method NOT IN ('cash', 'transfer', 'bit', 'card', 'check', 'other') THEN
    RAISE EXCEPTION 'אמצעי התשלום לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _note IS NOT NULL AND char_length(_note) > 300 THEN
    RAISE EXCEPTION 'ההערה ארוכה מדי (עד 300 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.id = _booking_id FOR UPDATE;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _kind <> 'refund' AND b.status IN ('declined', 'expired') THEN
    RAISE EXCEPTION 'אי אפשר לרשום תשלום לבקשה שנדחתה או פגה' USING ERRCODE = 'check_violation';
  END IF;
  p := hospitality._payment_insert(_t, b, _kind, _method, _amount, _paid_at, _note, NULL, NULL, 'staff');
  PERFORM hospitality._audit(_t, CASE WHEN _kind = 'refund' THEN 'payments.refund_recorded' ELSE 'payments.recorded' END,
                             'הזמנה #' || b.number, jsonb_build_object('amount', p.amount, 'method', p.method));
  RETURN hospitality._payments_json(_t, b.id);
END $$;
REVOKE ALL ON FUNCTION hospitality.payment_record(uuid, text, text, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.payment_record(uuid, text, text, numeric, date, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.payment_void(_payment_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  _why text := NULLIF(btrim(COALESCE(_reason, '')), '');
  p hospitality.payments;
  b hospitality.bookings;
BEGIN
  IF _why IS NULL OR char_length(_why) > 300 THEN
    RAISE EXCEPTION 'יש לכתוב למה מבטלים את הרישום (עד 300 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM hospitality.payments x WHERE x.tenant_id = _t AND x.id = _payment_id FOR UPDATE;
  IF p.id IS NULL OR p.status <> 'recorded' THEN
    RAISE EXCEPTION 'התשלום לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF p.provider IS NOT NULL THEN
    RAISE EXCEPTION 'תשלום מספק הסליקה מבוטל רק דרך הספק (החזר)' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.id = p.booking_id FOR UPDATE;
  -- ביטול תשלום (לא החזר) לא יכול להשאיר החזרים גדולים מהתשלומים
  IF p.kind <> 'refund' AND b.amount_paid - p.amount < 0 THEN
    RAISE EXCEPTION 'יש החזרים שרשומים על התשלום הזה — מבטלים אותם קודם' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.payments x SET status = 'voided', voided_at = now(), void_reason = _why WHERE x.id = p.id;
  PERFORM hospitality._payments_sync(_t, p.booking_id);
  INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes)
  VALUES (_t, p.booking_id, 'payment_voided', 'staff', auth.uid(),
          jsonb_build_object('kind', p.kind, 'amount', p.amount, 'reason', _why));
  PERFORM hospitality._audit(_t, 'payments.voided', 'הזמנה #' || b.number, jsonb_build_object('amount', p.amount));
  RETURN hospitality._payments_json(_t, p.booking_id);
END $$;
REVOKE ALL ON FUNCTION hospitality.payment_void(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.payment_void(uuid, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- לשרת בלבד: רישום מספק סליקה (webhook עתידי) — אידמפוטנטי לפי (ספק, מזהה אצל הספק)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.payment_provider_record(_tenant_id uuid, _booking_id uuid, _kind text,
                                                              _amount numeric, _provider text, _provider_ref text,
                                                              _paid_at date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  b hospitality.bookings;
  p hospitality.payments;
BEGIN
  IF _provider IS NULL OR _provider !~ '^[a-z0-9_-]{2,30}$' OR _provider_ref IS NULL OR char_length(_provider_ref) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'פרטי הספק לא תקינים' USING ERRCODE = 'check_violation';
  END IF;
  IF _kind IS NULL OR _kind NOT IN ('deposit', 'balance', 'full', 'refund', 'other') THEN
    RAISE EXCEPTION 'סוג התשלום לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM hospitality.payments x
   WHERE x.tenant_id = _tenant_id AND x.provider = _provider AND x.provider_ref = _provider_ref;
  IF p.id IS NOT NULL THEN
    RETURN jsonb_build_object('id', p.id, 'duplicate', true);
  END IF;
  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _tenant_id AND x.id = _booking_id FOR UPDATE;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  p := hospitality._payment_insert(_tenant_id, b, _kind, 'provider', _amount,
                                   COALESCE(_paid_at, (now() AT TIME ZONE 'UTC')::date), NULL,
                                   _provider, _provider_ref, 'system');
  RETURN jsonb_build_object('id', p.id, 'duplicate', false);
END $$;
REVOKE ALL ON FUNCTION hospitality.payment_provider_record(uuid, uuid, text, numeric, text, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.payment_provider_record(uuid, uuid, text, numeric, text, text, date) TO service_role;

COMMIT;

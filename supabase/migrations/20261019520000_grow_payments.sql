-- ============================================================
-- חלק 43: סליקה דרך Grow (משולם) — תשתית מאחורי הקלעים
--
-- הלקוח (בעל החנות) פותח מסוף פרטי אצל Grow; מנהל הפלטפורמה מזין את פרטי
-- המסוף שלו (userId / pageCode / apiKey) בתיק הלקוח. הכסף נכנס למסוף של
-- החנות, לא אלינו. עד שמנהל הפלטפורמה מפעיל את הסליקה לחנות — שום דבר לא
-- מופיע בקופה ובניהול של החנות.
--
--   • tenant_grow_credentials — פרטי המסוף, מוצפנים באפליקציה (AES-256-GCM,
--       המפתח במשתנה סביבה בשרת). אין לאף משתמש גישה: service_role בלבד.
--   • grow_payment_processes — תהליך תשלום לכל ניסיון: processId + גיבוב של
--       processToken (לאימות ההתראה; הטוקן עצמו לא נשמר), סכום, סטטוס.
--   • orders — אמצעי תשלום 'grow' + פרטי העסקה (אסמכתא, כרטיס, תשלומים),
--       שנקבעים רק מהשרת אחרי התראה מאומתת (grow_mark_paid).
--   • grow_payments_active(tenant) — האם הסליקה פעילה בחנות.
--
-- ניתן להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. פרטי המסוף (מוצפנים) + הגדרות
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_grow_credentials (
  tenant_id        uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- מוצפנים באפליקציה (base64 של iv + tag + ciphertext); לעולם לא חוזרים לדפדפן
  user_id_enc      text NOT NULL CHECK (char_length(user_id_enc) BETWEEN 20 AND 2000),
  page_code_enc    text NOT NULL CHECK (char_length(page_code_enc) BETWEEN 20 AND 2000),
  api_key_enc      text CHECK (api_key_enc IS NULL OR char_length(api_key_enc) BETWEEN 20 AND 2000),
  -- true = סביבת הבדיקות של Grow (sandbox), false = ייצור
  sandbox          boolean NOT NULL DEFAULT false,
  -- הסליקה מוצעת בקופה רק כשמנהל הפלטפורמה הפעיל
  enabled          boolean NOT NULL DEFAULT false,
  -- מספר תשלומים מקסימלי ללקוח (1 = בלי תשלומים)
  max_payments     integer NOT NULL DEFAULT 1 CHECK (max_payments BETWEEN 1 AND 12),
  -- אמצעי תשלום מוצעים (1 אשראי, 6 ביט, 13 Apple Pay, 14 Google Pay); ריק = הכל
  transaction_types integer[] CHECK (transaction_types IS NULL
                      OR transaction_types <@ ARRAY[1, 6, 13, 14]),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid
);
COMMENT ON TABLE public.tenant_grow_credentials IS
  'חלק 43: פרטי מסוף Grow של חנות — מוצפנים; service_role בלבד';

ALTER TABLE public.tenant_grow_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_grow_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tenant_grow_credentials TO service_role;

-- ============================================================
-- 2. תהליכי תשלום
-- ============================================================
CREATE TABLE IF NOT EXISTS public.grow_payment_processes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id           uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  process_id         text NOT NULL CHECK (char_length(process_id) BETWEEN 1 AND 64),
  -- sha256 של processToken: ההתראה חייבת להביא טוקן שמתאים (רק Grow ואנחנו מכירים אותו)
  process_token_hash text NOT NULL CHECK (char_length(process_token_hash) = 64),
  amount             numeric(12, 2) NOT NULL CHECK (amount > 0),
  sandbox            boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'paid', 'paid_late', 'failed',
                                       'amount_mismatch', 'superseded')),
  asmachta           text,
  transaction_id     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  paid_at            timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS grow_processes_process_id_idx
  ON public.grow_payment_processes (process_id, sandbox);
-- תהליך ממתין אחד לכל הזמנה
CREATE UNIQUE INDEX IF NOT EXISTS grow_processes_one_pending_idx
  ON public.grow_payment_processes (order_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS grow_processes_tenant_idx
  ON public.grow_payment_processes (tenant_id, created_at DESC);

ALTER TABLE public.grow_payment_processes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grow_payment_processes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.grow_payment_processes TO service_role;

-- ============================================================
-- 3. הזמנות: אמצעי תשלום grow + פרטי עסקה
-- ============================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS grow_asmachta text,
  ADD COLUMN IF NOT EXISTS grow_transaction_id text,
  -- לתצוגה בלבד: מותג + 4 ספרות אחרונות (בלי פרטי כרטיס)
  ADD COLUMN IF NOT EXISTS grow_card text,
  ADD COLUMN IF NOT EXISTS grow_installments integer;

COMMENT ON COLUMN public.orders.grow_asmachta IS 'חלק 43: מספר אישור (אסמכתא) של Grow';

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_check CHECK (
    -- offline = תשלום טלפוני מול נציג | credit_card = ישן | bit = העברה בביט |
    -- grow = תשלום מקוון דרך Grow (אשראי / ביט / Apple Pay / Google Pay)
    payment_method IN ('offline', 'credit_card', 'bit', 'grow')
    AND payment_status IN ('not_required', 'awaiting', 'awaiting_verification', 'paid',
                           'expired', 'rejected')
    AND (payment_status <> 'paid' OR paid_at IS NOT NULL)
    AND (payment_method = 'bit' OR (bit_transaction_id IS NULL AND bit_receipt_url IS NULL))
    AND (bit_transaction_id IS NULL OR char_length(bit_transaction_id) BETWEEN 2 AND 64)
    AND (bit_receipt_url IS NULL OR char_length(bit_receipt_url) <= 300)
    AND (payment_method = 'grow' OR (grow_asmachta IS NULL AND grow_transaction_id IS NULL
                                     AND grow_card IS NULL AND grow_installments IS NULL))
    AND (grow_asmachta IS NULL OR char_length(grow_asmachta) <= 64)
    AND (grow_transaction_id IS NULL OR char_length(grow_transaction_id) <= 64)
    AND (grow_card IS NULL OR char_length(grow_card) <= 40));

-- ============================================================
-- 4. האם הסליקה פעילה בחנות (מנהל הפלטפורמה הפעיל + פרטי מסוף קיימים)
-- ============================================================
CREATE OR REPLACE FUNCTION public.grow_payments_active(_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenant_grow_credentials c
                  WHERE c.tenant_id = _tenant AND c.enabled);
$$;
REVOKE ALL ON FUNCTION public.grow_payments_active(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grow_payments_active(uuid) TO service_role;

-- ============================================================
-- 5. טריגרים: שדות הסליקה נקבעים רק מהשרת (תיקון נקודתי של ההגדרות
--    מהמסד, כמו בחלקים 18ב / 28 — נכשל בקול אם הטקסט לא נמצא)
-- ============================================================
DO $$
DECLARE
  _def text;
  _fixed text;
BEGIN
  -- 5א. הזמנה חדשה: grow רק אם הסליקה פעילה בחנות
  SELECT pg_get_functiondef('public.orders_default_payment()'::regprocedure) INTO _def;
  IF position('grow_payments_active' IN _def) = 0 THEN
    _fixed := replace(_def,
      '  NEW.payment_confirmed_by := NULL;',
      '  NEW.payment_confirmed_by := NULL;
  NEW.grow_asmachta := NULL;
  NEW.grow_transaction_id := NULL;
  NEW.grow_card := NULL;
  NEW.grow_installments := NULL;');
    IF _fixed = _def THEN
      RAISE EXCEPTION 'part 43: orders_default_payment — the reset block was not found';
    END IF;
    _def := _fixed;
    _fixed := replace(_def,
      '  -- "תשלום טלפוני מול נציג" — רק אם החנות מאפשרת',
      '  -- תשלום מקוון דרך Grow: ההזמנה נשמרת "ממתינה לתשלום" לפני המעבר לדף התשלום
  IF _requested = ''grow'' THEN
    IF NOT public.grow_payments_active(NEW.tenant_id) THEN
      RAISE EXCEPTION ''התשלום המקוון אינו זמין כרגע בחנות — בחרו אמצעי תשלום אחר''
        USING ERRCODE = ''check_violation'';
    END IF;
    NEW.payment_method := ''grow'';
    NEW.payment_status := ''awaiting'';
    NEW.payment_due_at := now() + interval ''2 hours'';
    RETURN NEW;
  END IF;

  -- "תשלום טלפוני מול נציג" — רק אם החנות מאפשרת');
    IF _fixed = _def THEN
      RAISE EXCEPTION 'part 43: orders_default_payment — the phone-payment block was not found';
    END IF;
    EXECUTE _fixed;
  END IF;

  -- 5ב. שדות העסקה לא משתנים מהדפדפן / מהצוות
  SELECT pg_get_functiondef('public.orders_payment_guard()'::regprocedure) INTO _def;
  IF position('grow_asmachta' IN _def) = 0 THEN
    _fixed := replace(_def,
      '    NEW.payment_confirmed_by := OLD.payment_confirmed_by;',
      '    NEW.payment_confirmed_by := OLD.payment_confirmed_by;
    NEW.grow_asmachta := OLD.grow_asmachta;
    NEW.grow_transaction_id := OLD.grow_transaction_id;
    NEW.grow_card := OLD.grow_card;
    NEW.grow_installments := OLD.grow_installments;');
    IF _fixed = _def THEN
      RAISE EXCEPTION 'part 43: orders_payment_guard — the reset block was not found';
    END IF;
    EXECUTE _fixed;
  END IF;

  -- 5ג. הקופה: הבקשה 'grow' מועברת להזמנה (כל ערך אחר — 'offline' כמו קודם)
  FOR _def IN
    SELECT pg_get_functiondef(f::regprocedure)
      FROM unnest(ARRAY[
        'public.place_order(text, jsonb, numeric, boolean, jsonb)',
        'public.place_guest_order(text, jsonb, jsonb)']) AS f
  LOOP
    CONTINUE WHEN position('= ''grow''' IN _def) > 0;
    _fixed := replace(_def,
      $r$CASE WHEN _details ->> 'payment_method' = 'bit' THEN 'bit' ELSE 'offline' END$r$,
      $r$CASE WHEN _details ->> 'payment_method' = 'bit' THEN 'bit'
           WHEN _details ->> 'payment_method' = 'grow' THEN 'grow'
           ELSE 'offline' END$r$);
    IF _fixed = _def THEN
      RAISE EXCEPTION 'part 43: place_order / place_guest_order — the payment mapping was not found';
    END IF;
    EXECUTE _fixed;
  END LOOP;
END $$;

-- ============================================================
-- 6. סימון "שולם" אחרי התראה מאומתת — אטומי, חד-פעמי, service_role בלבד
--    תוצאות: paid | already_paid | paid_late (ההזמנה כבר בוטלה) | not_paid |
--            amount_mismatch | bad_token | unknown
-- ============================================================
CREATE OR REPLACE FUNCTION public.grow_mark_paid(
  _process_id text, _sandbox boolean, _token_hash text, _sum numeric,
  _status_code text, _asmachta text, _transaction_id text,
  _card_brand text, _card_suffix text, _installments integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.grow_payment_processes;
  o public.orders;
  _card text;
BEGIN
  SELECT * INTO p FROM public.grow_payment_processes
   WHERE process_id = _process_id AND sandbox = _sandbox FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'unknown');
  END IF;
  -- הטוקן שההתראה הביאה חייב להתאים למה שנשמר בעת יצירת התהליך
  IF p.process_token_hash IS DISTINCT FROM _token_hash THEN
    RETURN jsonb_build_object('result', 'bad_token');
  END IF;
  IF p.status IN ('paid', 'paid_late') THEN
    RETURN jsonb_build_object('result', 'already_paid', 'order_id', p.order_id, 'tenant_id', p.tenant_id);
  END IF;
  IF _status_code IS DISTINCT FROM '2' THEN
    UPDATE public.grow_payment_processes SET status = 'failed' WHERE id = p.id AND status = 'pending';
    RETURN jsonb_build_object('result', 'not_paid', 'order_id', p.order_id, 'tenant_id', p.tenant_id);
  END IF;
  IF _sum IS NULL OR abs(_sum - p.amount) > 0.01 THEN
    UPDATE public.grow_payment_processes SET status = 'amount_mismatch' WHERE id = p.id;
    RETURN jsonb_build_object('result', 'amount_mismatch', 'order_id', p.order_id, 'tenant_id', p.tenant_id);
  END IF;

  SELECT * INTO o FROM public.orders WHERE id = p.order_id FOR UPDATE;
  _card := NULLIF(btrim(concat_ws(' ····', NULLIF(left(_card_brand, 20), ''),
                                   NULLIF(regexp_replace(COALESCE(_card_suffix, ''), '\D', '', 'g'), ''))), '');

  IF o.status = 'cancelled' OR o.payment_status NOT IN ('awaiting') THEN
    -- שולם אחרי שההזמנה בוטלה / פגה: לא פותחים אותה מחדש (המלאי כבר חזר) — מסמנים לטיפול ידני
    UPDATE public.grow_payment_processes
       SET status = 'paid_late', paid_at = now(), asmachta = left(_asmachta, 64),
           transaction_id = left(_transaction_id, 64)
     WHERE id = p.id;
    RETURN jsonb_build_object('result', 'paid_late', 'order_id', p.order_id, 'tenant_id', p.tenant_id);
  END IF;

  PERFORM set_config('kobi.payment_update', 'on', true);
  UPDATE public.orders
     SET payment_status = 'paid', paid_at = now(), payment_due_at = NULL,
         grow_asmachta = left(_asmachta, 64), grow_transaction_id = left(_transaction_id, 64),
         grow_card = left(_card, 40), grow_installments = GREATEST(COALESCE(_installments, 1), 1)
   WHERE id = o.id;
  PERFORM set_config('kobi.payment_update', 'off', true);

  UPDATE public.grow_payment_processes
     SET status = 'paid', paid_at = now(), asmachta = left(_asmachta, 64),
         transaction_id = left(_transaction_id, 64)
   WHERE id = p.id;
  RETURN jsonb_build_object('result', 'paid', 'order_id', p.order_id, 'tenant_id', p.tenant_id);
END $$;
REVOKE ALL ON FUNCTION public.grow_mark_paid(text, boolean, text, numeric, text, text, text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grow_mark_paid(text, boolean, text, numeric, text, text, text, text, text, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Rollback 208 (20261128100000_online_payments_foundation.sql): יסודות התשלום המקוון (MAX / Hyp Pay, שלב DEMO).
-- הגנה: נעצר כל עוד יש נתוני תשלום — שורה כלשהי בטבלאות הסכמה payments (מסופים, רישום מסופים, ניסיונות, אירועים,
-- יומני שינויים, הגדרות בעל החנות, אסימוני אורח, חזרות גולמיות, חזרות לא מזוהות), מסד מסומן demo / production,
-- הזמנה בתשלום מקוון (public.orders.payment_method = 'online') או רישום מאושר-ספק ביומן הכספי (billing.ledger) —
-- rollback היה מוחק רשומות תשלום או משאיר הזמנות / רישומים בלי הראיות שלהם. גם מסד שסומן פעם (demo_since, או רישום
-- environment_changed כלשהו) לא חוזר אחורה (ביקורת L5). חריג יחיד: אתגרי ה-step-up (מזהים קצרי-חיים, HMAC בלבד).
-- בלי נתונים: שלושת הטריגרים על orders / order_items נמחקים; הטקסט שהוכנס ל-orders_default_payment, place_order
-- ו-place_guest_order מוסר מילה במילה (נכשל בקול אם לא נמצא); orders_payment_check חוזר מילה במילה ל-
-- 20261019520000_grow_payments.sql:94-110; 42 פונקציות ה-API נמחקות; הסכמה payments נמחקת; שני הדגלים נמחקים;
-- ובסוף — הוכחת md5 שהגדרות ארבעת האובייקטים זהות למה שהיה לפני 208 (הסכמה זהה בדיוק למיגרציה 207).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $guard$
DECLARE
  _t text;
  _n bigint;
BEGIN
  IF to_regnamespace('payments') IS NOT NULL THEN
    FOR _t IN SELECT c.relname FROM pg_class c
               WHERE c.relnamespace = 'payments'::regnamespace AND c.relkind IN ('r', 'p')
                 AND c.relname NOT IN ('environment', 'platform_stepup_challenges')
               ORDER BY c.relname LOOP
      EXECUTE format('SELECT count(*) FROM payments.%I', _t) INTO _n;
      IF _n > 0 THEN
        RAISE EXCEPTION 'rollback stopped: יש % שורות ב-payments.% — נתוני תשלום מקוון (מסופים, ניסיונות, יומנים); rollback היה מוחק אותם. לא מבוצע',
          _n, _t;
      END IF;
    END LOOP;
    IF to_regclass('payments.environment') IS NOT NULL THEN
      -- review L5: a database that was ever marked (demo_since, or any environment_changed audit row — counted in the
      -- loop above) keeps its history: a rollback + re-apply would make an ex-DEMO database eligible for production
      SELECT count(*) INTO _n FROM payments.environment WHERE name IS NOT NULL OR demo_since IS NOT NULL;
      IF _n > 0 THEN
        RAISE EXCEPTION 'rollback stopped: יש % שורות בסימון הסביבה (payments.environment סומן demo / production, גם אם בוטל) — מסד שסומן פעם לא חוזר אחורה',
          _n;
      END IF;
    END IF;
  END IF;
  SELECT count(*) INTO _n FROM public.orders WHERE payment_method = 'online';
  IF _n > 0 THEN
    RAISE EXCEPTION 'rollback stopped: יש % שורות של הזמנות בתשלום מקוון (public.orders) — rollback היה משאיר הזמנות לא תקינות. לא מבוצע',
      _n;
  END IF;
  SELECT count(*) INTO _n FROM billing.ledger WHERE source = 'provider' OR confirmation = 'provider';
  IF _n > 0 THEN
    RAISE EXCEPTION 'rollback stopped: יש % שורות ביומן הכספי מאושרות ספק תשלומים (billing.ledger) — rollback לא מבוצע',
      _n;
  END IF;
END $guard$;

DROP TRIGGER IF EXISTS orders_online_payment_keep ON public.orders;
DROP TRIGGER IF EXISTS orders_payment_amount_lock ON public.orders;
DROP TRIGGER IF EXISTS order_items_a_payment_lock ON public.order_items;

-- the inserted text, removed exactly (the migration's §14 patches, in reverse)
DO $unpatch$
DECLARE
  _def   text;
  _fixed text;
BEGIN
  SELECT pg_get_functiondef('public.orders_default_payment()'::regprocedure) INTO _def;
  IF position('max_payments_active' IN _def) > 0 THEN
    _fixed := replace(_def,
      '  -- תשלום מקוון (MAX): ההזמנה נשמרת "ממתינה לתשלום" לפני המעבר לדף התשלום
  IF _requested = ''online'' THEN
    IF NOT public.max_payments_active(NEW.tenant_id, auth.uid()) THEN
      RAISE EXCEPTION ''התשלום המקוון בכרטיס אינו זמין כרגע בחנות — בחרו אמצעי תשלום אחר''
        USING ERRCODE = ''check_violation'';
    END IF;
    NEW.payment_method := ''online'';
    NEW.payment_status := ''awaiting'';
    NEW.payment_due_at := now() + interval ''2 hours'';
    RETURN NEW;
  END IF;

  -- "תשלום טלפוני מול נציג" — רק אם החנות מאפשרת',
      '  -- "תשלום טלפוני מול נציג" — רק אם החנות מאפשרת');
    IF _fixed = _def THEN
      RAISE EXCEPTION 'rollback: orders_default_payment — the inserted online branch was not found verbatim';
    END IF;
    EXECUTE _fixed;
  END IF;
  FOR _def IN
    SELECT pg_get_functiondef(f::regprocedure)
      FROM unnest(ARRAY['public.place_order(text, jsonb, numeric, boolean, jsonb)',
                        'public.place_guest_order(text, jsonb, jsonb)']) AS f
  LOOP
    CONTINUE WHEN position('= ''online''' IN _def) = 0;
    _fixed := replace(_def,
      $r$WHEN _details ->> 'payment_method' = 'bit' THEN 'bit'
           WHEN _details ->> 'payment_method' = 'online' THEN 'online'$r$,
      $r$WHEN _details ->> 'payment_method' = 'bit' THEN 'bit'$r$);
    IF _fixed = _def THEN
      RAISE EXCEPTION 'rollback: place_order / place_guest_order — the inserted online line was not found verbatim';
    END IF;
    EXECUTE _fixed;
  END LOOP;
END $unpatch$;

-- verbatim from 20261019520000_grow_payments.sql:94-110
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

DO $drop$
DECLARE
  _f record;
BEGIN
  FOR _f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
             WHERE p.pronamespace = 'public'::regnamespace
               AND p.proname IN (
                 'max_payments_active', 'max_order_access_issue', 'max_attempt_open', 'max_attempt_secrets',
                 'max_attempt_signed', 'max_attempt_record_return', 'max_attempt_mark_paid', 'max_attempts_expire',
                 'max_attempt_cancel', 'max_review_resolve', 'max_order_payment_status', 'max_account_status',
                 'max_store_settings_save', 'max_unreturned_attempts', 'max_attempts_pending_verify',
                 'max_return_keep', 'max_return_get',
                 'platform_store_terminal_save', 'platform_store_terminal_verified',
                 'platform_store_terminal_check_secrets', 'platform_attempt_open', 'platform_attempt_secrets',
                 'platform_attempt_signed', 'platform_attempt_record_return', 'platform_attempt_mark_paid',
                 'platform_attempts_expire', 'platform_card_payment_resolve', 'platform_card_payments',
                 'platform_unreturned_attempts', 'platform_card_my_payments', 'platform_card_my_options',
                 'platform_terminal_save', 'platform_terminal_verified', 'platform_terminal_check_secrets',
                 'platform_terminal_status', 'platform_stepup_issue', 'platform_stepup_consume',
                 'platform_attempts_pending_verify', 'platform_payment_unknown_return', 'platform_return_keep',
                 'platform_return_get',
                 'platform_payment_returns_purge') LOOP
    EXECUTE format('DROP FUNCTION %s', _f.sig);
  END LOOP;
END $drop$;

DROP SCHEMA IF EXISTS payments CASCADE;
DELETE FROM public.platform_feature_flags WHERE key IN ('max_payments', 'platform_terminal_payments');

-- proof: the four patched objects are byte-identical to their pre-208 text (the migration's §0 fingerprints)
DO $proof$
BEGIN
  IF md5(pg_get_functiondef('public.orders_default_payment()'::regprocedure)) <> '399a61c8498b9d8d40b937c51c06f8d6'
     OR md5(pg_get_functiondef('public.place_order(text, jsonb, numeric, boolean, jsonb)'::regprocedure)) <> '4b0f65ed766f47e4bd86b00392b2a8fd'
     OR md5(pg_get_functiondef('public.place_guest_order(text, jsonb, jsonb)'::regprocedure)) <> '2e0eff3b865bf32e5ceb0e99e50132ca'
     OR (SELECT md5(pg_get_constraintdef(c.oid)) FROM pg_constraint c
          WHERE c.conrelid = 'public.orders'::regclass AND c.conname = 'orders_payment_check') <> '816c22e1520ae95e394c6a5a094faaec' THEN
    RAISE EXCEPTION 'rollback post-check: the restored definitions differ from the pre-208 fingerprints';
  END IF;
  IF to_regnamespace('payments') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                  AND (p.proname LIKE 'max\_%' OR p.proname LIKE 'platform\_card\_%' OR p.proname LIKE 'platform\_terminal\_%'
                       OR p.proname LIKE 'platform\_attempt%' OR p.proname LIKE 'platform\_stepup\_%'
                       OR p.proname LIKE 'platform\_store\_terminal\_%' OR p.proname LIKE 'platform\_payment\_%'
                       OR p.proname LIKE 'platform\_return\_%' OR p.proname = 'platform_unreturned_attempts'))
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('orders_online_payment_keep', 'orders_payment_amount_lock',
                                                          'order_items_a_payment_lock')) THEN
    RAISE EXCEPTION 'rollback post-check: an object of migration 208 is still there';
  END IF;
END $proof$;

NOTIFY pgrst, 'reload schema';
COMMIT;

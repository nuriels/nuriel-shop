-- ============================================================
-- חלק 28: Hyp הוסר — אין שאריות במסד, הקופה (טלפוני / ביט / אורח) עובדת
-- כרגיל, ותשלום מנויים ותוספים לפלטפורמה — ידני.
-- ============================================================
\set OA '''a0000000-0000-0000-0000-0000000000a1'''
\set PA '''a0000000-0000-0000-0000-0000000000f0'''
\set CE '''a0000000-0000-0000-0000-0000000000e1'''
CREATE OR REPLACE FUNCTION tests.server(_name TEXT, _sql TEXT, _expect_error TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $f$
DECLARE err TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, CASE WHEN _expect_error IS NULL THEN err IS NULL ELSE COALESCE(err ILIKE '%' || _expect_error || '%', false) END,
          COALESCE('ERROR: ' || err, 'ok'));
END; $f$;

-- פרטי קופה תקינים (איסוף עצמי) עם אמצעי התשלום המבוקש
CREATE OR REPLACE FUNCTION tests.hyp_details(_payment TEXT, _email TEXT DEFAULT 'cust.e@test.local')
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'customer_name', 'לקוח תשלום', 'customer_tax_id', '123456782', 'customer_phone', '0501234567',
    'customer_email', _email,
    'billing_city', 'תל אביב', 'billing_address', 'הרצל 1', 'billing_zip', '6100001',
    'accepted_terms', true, 'shipping_method_id', '5e000000-0000-0000-0000-000000000001',
    'payment_method', _payment));
$f$;
CREATE OR REPLACE FUNCTION tests.hyp_items(_qty INTEGER DEFAULT 2) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_array(jsonb_build_object(
    'product_id', '9e000000-0000-0000-0000-000000000001', 'quantity', _qty, 'unit_price', 100));
$f$;
GRANT USAGE ON SCHEMA tests TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tests.hyp_details(TEXT, TEXT), tests.hyp_items(INTEGER) TO anon, authenticated;

-- ============================================================
-- 1. אין שאריות של Hyp
-- ============================================================
SELECT tests.check('hyp: tables payment_intents / tenant_payment_secrets / platform_settings are gone',
  $$SELECT to_regclass('public.payment_intents') IS NULL AND to_regclass('public.tenant_payment_secrets') IS NULL
           AND to_regclass('public.platform_settings') IS NULL$$);
SELECT tests.check('hyp: no hyp_* / payment_token / card_payments_enabled / card_clearing_live columns',
  $$SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND (column_name LIKE 'hyp\_%'
                               OR column_name IN ('payment_token', 'card_payments_enabled', 'card_clearing_live')))$$);
SELECT tests.check('hyp: none of the Hyp functions is left',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                        WHERE n.nspname = 'public' AND p.proname IN (
                          'hyp_credentials', 'payment_intent_lookup', 'payment_intent_complete', 'payment_intent_fail',
                          'payment_test_start', 'payment_last_test', 'order_payment_intent', 'checkout_payment_request',
                          'card_payments_active', 'card_clearing_live', 'platform_payments_ready',
                          'platform_payments_configured', 'platform_payment_settings', 'platform_save_payment_settings',
                          'store_payment_settings', 'store_save_payment_settings', 'site_settings_card_payments_guard',
                          'orders_card_payment_default', 'addon_checkout_start', 'plan_checkout_start', 'plan_quote',
                          'plan_quote_for'))$$);
SELECT tests.check('hyp: no remaining function body refers to a Hyp object',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                        WHERE n.nspname = 'public'
                          AND p.prosrc ~* '(hyp_|payment_intent|tenant_payment_secrets|platform_settings|card_payments_|card_clearing|platform_payments_|checkout_payment_request|payment_token)')$$);
SELECT tests.check('hyp: Bit / phone objects are still there (shared, not Hyp)',
  $$SELECT to_regprocedure('public.expire_unpaid_orders()') IS NOT NULL
       AND to_regprocedure('public.order_amount_due(numeric, boolean, numeric)') IS NOT NULL
       AND to_regprocedure('public.bit_payments_active(uuid)') IS NOT NULL
       AND to_regprocedure('public.bit_payment_submit(uuid, text, text)') IS NOT NULL
       AND to_regprocedure('public.bit_payment_review(uuid, boolean)') IS NOT NULL
       AND to_regprocedure('public.orders_payment_guard()') IS NOT NULL
       AND to_regclass('public.tenant_billing_profile') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                    AND table_name = 'orders' AND column_name = 'payment_due_at')$$);
SELECT tests.check('hyp: orders_default_payment replaced orders_card_payment_default, at the same spot (after assign_number, before enforce_kind)',
  $$WITH t AS (SELECT tgname, row_number() OVER (ORDER BY tgname COLLATE "C") AS n
                 FROM pg_trigger
                WHERE tgrelid = 'public.orders'::regclass AND NOT tgisinternal
                  AND tgtype & 2 = 2 AND tgtype & 4 = 4)
    SELECT (SELECT n FROM t WHERE tgname = 'orders_default_payment')
             = (SELECT n FROM t WHERE tgname = 'orders_assign_number') + 1
       AND (SELECT n FROM t WHERE tgname = 'orders_enforce_kind')
             = (SELECT n FROM t WHERE tgname = 'orders_default_payment') + 1
       AND NOT EXISTS (SELECT 1 FROM pg_trigger
                        WHERE tgname IN ('orders_card_payment_default', 'site_settings_card_payments_guard'))$$);
SELECT tests.check('hyp: credit_card stays valid in the CHECKs (old orders / billing rows)',
  $$SELECT bool_and(pg_get_constraintdef(c.oid) LIKE '%credit_card%') AND count(*) = 2
      FROM pg_constraint c
     WHERE c.conname IN ('orders_payment_check', 'billing_history_payment_method_check')$$);
SELECT tests.check('hyp: place_order / place_guest_order map the payment request inline',
  $$SELECT bool_and(pg_get_functiondef(p.oid) LIKE '%_details ->> ''payment_method'' = ''bit''%') AND count(*) = 2
      FROM pg_proc p WHERE p.proname IN ('place_order', 'place_guest_order')
       AND p.pronamespace = 'public'::regnamespace$$);

-- ============================================================
-- 2. הקופה — לקוח רשום, אורח, ביט, טלפוני
-- ============================================================
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
INSERT INTO auth.users (id, email) VALUES ('a0000000-0000-0000-0000-0000000000e1', 'cust.e@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000e1', 'cust.e@test.local', 'cust_e', 'customer', true)
ON CONFLICT DO NOTHING;
INSERT INTO public.customer_profiles (user_id, business_name, age_confirmed, profile_completed)
VALUES ('a0000000-0000-0000-0000-0000000000e1', 'לקוח תשלום', true, true) ON CONFLICT DO NOTHING;
INSERT INTO public.shipping_methods (id, tenant_id, name, kind, price, is_active)
VALUES ('5e000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', 'איסוף עצמי (בדיקה)', 'pickup', 0, true)
ON CONFLICT DO NOTHING;
INSERT INTO public.categories (tenant_id, name) VALUES ('70000000-0000-0000-0000-00000000000a', 'בדיקת תשלום') ON CONFLICT DO NOTHING;
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, stock_quantity)
VALUES ('9e000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', '93000001', 'מוצר תשלום', 'בדיקת תשלום',
        'a0000000-0000-0000-0000-0000000000a1', 100, 100) ON CONFLICT DO NOTHING;
UPDATE public.site_settings SET payment_phone_enabled = true, payment_bit_enabled = false, payment_bit_phone = NULL
 WHERE tenant_id = '70000000-0000-0000-0000-00000000000a';

SELECT tests.run('checkout: phone payment → order created (no online charge)',
  $$SELECT * FROM public.place_order('order', tests.hyp_items(), 18, true, tests.hyp_details('offline'))$$, :CE);
SELECT tests.check('checkout: phone order is pending, offline, not_required, nothing due',
  $$SELECT count(*) = 1 AND bool_and(status = 'pending' AND payment_method = 'offline'
                                     AND payment_status = 'not_required' AND payment_due_at IS NULL)
      FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1'$$);
SELECT tests.run('checkout: an old tab asking for credit_card → still created',
  $$SELECT * FROM public.place_order('order', tests.hyp_items(), 18, true, tests.hyp_details('credit_card'))$$, :CE);
SELECT tests.check('checkout: no order can become credit_card any more (→ offline)',
  $$SELECT count(*) = 2 AND bool_and(payment_method = 'offline' AND payment_status = 'not_required')
      FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1'$$);
SELECT tests.run('checkout: Bit while the store has no Bit → clear error',
  $$SELECT * FROM public.place_order('order', tests.hyp_items(), 18, true, tests.hyp_details('bit'))$$, :CE,
  'התשלום בביט אינו זמין');

UPDATE public.site_settings SET payment_bit_enabled = true, payment_bit_phone = '050-123 4567'
 WHERE tenant_id = '70000000-0000-0000-0000-00000000000a';
SELECT tests.check('settings: Bit phone normalized by the guard',
  $$SELECT payment_bit_phone = '0501234567' FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.run('checkout: Bit → order saved before the app switch',
  $$SELECT * FROM public.place_order('order', tests.hyp_items(), 18, true, tests.hyp_details('bit'))$$, :CE);
SELECT tests.check('checkout: Bit order is pending + awaiting payment for 24 hours',
  $$SELECT count(*) = 1 AND bool_and(status = 'pending' AND payment_status = 'awaiting'
           AND payment_due_at BETWEEN now() + interval '23 hours 59 minutes' AND now() + interval '24 hours 1 minute')
      FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'bit'$$);
SELECT tests.run('guard: admin cannot mark the Bit order paid by a direct update (silently kept)',
  $$UPDATE public.orders SET payment_status = 'paid', paid_at = now()
     WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'bit'$$, :OA, NULL, 1);
SELECT tests.check('guard: payment fields unchanged after the direct update',
  $$SELECT bool_and(payment_status = 'awaiting' AND paid_at IS NULL)
      FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'bit'$$);
SELECT tests.run('guard: unpaid Bit order cannot move to picking',
  $$UPDATE public.orders SET status = 'picking'
     WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'bit'$$, :OA,
  'עדיין לא שולמה בביט');
SELECT tests.server('bit: customer sends a reference → awaiting verification',
  $$SELECT public.bit_payment_submit((SELECT id FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1'
                                        AND payment_method = 'bit'), 'BIT-777', NULL)$$);
SELECT tests.run('bit: store admin approves → paid',
  $$SELECT public.bit_payment_review((SELECT id FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1'
                                        AND payment_method = 'bit'), true)$$, :OA);
SELECT tests.check('bit: paid, with the reference and who approved',
  $$SELECT bool_and(payment_status = 'paid' AND paid_at IS NOT NULL AND bit_transaction_id = 'BIT-777'
                    AND payment_confirmed_by = 'a0000000-0000-0000-0000-0000000000a1')
      FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'bit'$$);
SELECT tests.run('bit: paid order moves to picking',
  $$UPDATE public.orders SET status = 'picking'
     WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'bit'$$, :OA, NULL, 1);

-- ---------- אורח (השרת — place_guest_order) ----------
SELECT tests.server('guest: Bit order',
  $$SELECT * FROM public.place_guest_order('order', tests.hyp_items(1), tests.hyp_details('bit', 'guest.hyp@test.local'))$$);
SELECT tests.server('guest: no payment method chosen → phone',
  $$SELECT * FROM public.place_guest_order('order', tests.hyp_items(1),
                                           tests.hyp_details(NULL, 'guest.hyp@test.local'))$$);
SELECT tests.check('guest: one Bit (awaiting) + one phone (not_required)',
  $$SELECT count(*) FILTER (WHERE payment_method = 'bit' AND payment_status = 'awaiting') = 1
       AND count(*) FILTER (WHERE payment_method = 'offline' AND payment_status = 'not_required') = 1
       AND count(*) = 2
      FROM public.orders WHERE customer_id IS NULL AND customer_email = 'guest.hyp@test.local'$$);
SELECT tests.server('direct insert asking for credit_card (server) → offline',
  $$INSERT INTO public.orders (id, tenant_id, customer_id, kind, payment_method)
    VALUES ('0e000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a',
            'a0000000-0000-0000-0000-0000000000e1', 'order', 'credit_card')$$);
SELECT tests.check('direct insert: payment_method offline, not_required',
  $$SELECT payment_method = 'offline' AND payment_status = 'not_required'
      FROM public.orders WHERE id = '0e000000-0000-0000-0000-000000000001'$$);
SELECT tests.server('quote asking for Bit → no payment on the site',
  $$INSERT INTO public.orders (id, tenant_id, customer_id, kind, payment_method)
    VALUES ('0e000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000a',
            'a0000000-0000-0000-0000-0000000000e1', 'quote', 'bit')$$);
SELECT tests.check('quote: offline, not_required',
  $$SELECT payment_method = 'offline' AND payment_status = 'not_required'
      FROM public.orders WHERE id = '0e000000-0000-0000-0000-000000000002'$$);

-- ---------- ביטול הזמנת ביט שלא שולמה בזמן (המשימה של השרת) ----------
CREATE TEMP TABLE hyp_stock AS
  SELECT stock_quantity FROM public.global_products WHERE id = '9e000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  PERFORM set_config('kobi.payment_update', 'on', true);
  UPDATE public.orders SET payment_due_at = now() - interval '1 minute'
   WHERE customer_id IS NULL AND customer_email = 'guest.hyp@test.local' AND payment_method = 'bit';
  PERFORM set_config('kobi.payment_update', 'off', true);
END $$;
SELECT tests.check('expiry: expire_unpaid_orders cancels the overdue Bit order (1)',
  $$SELECT public.expire_unpaid_orders() = 1$$);
SELECT tests.check('expiry: cancelled + expired, the stock returned (+1)',
  $$SELECT o.status = 'cancelled' AND o.payment_status = 'expired'
           AND gp.stock_quantity = (SELECT stock_quantity FROM hyp_stock) + 1
      FROM public.orders o, public.global_products gp
     WHERE o.customer_id IS NULL AND o.customer_email = 'guest.hyp@test.local' AND o.payment_method = 'bit'
       AND gp.id = '9e000000-0000-0000-0000-000000000001'$$);
SELECT tests.check('expiry: a second run changes nothing (0)', $$SELECT public.expire_unpaid_orders() = 0$$);

-- ---------- הגדרות אמצעי התשלום ----------
UPDATE public.site_settings SET payment_phone_enabled = false
 WHERE tenant_id = '70000000-0000-0000-0000-00000000000a';
SELECT tests.run('checkout: phone payment turned off → clear error',
  $$SELECT * FROM public.place_order('order', tests.hyp_items(), 18, true, tests.hyp_details('offline'))$$, :CE,
  'התשלום הטלפוני מול נציג אינו זמין');
SELECT tests.server('settings: turning off both phone and Bit is blocked',
  $$UPDATE public.site_settings SET payment_bit_enabled = false
     WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$,
  'יש להשאיר לפחות אמצעי תשלום אחד');
SELECT tests.server('settings: Bit without a phone number is blocked',
  $$UPDATE public.site_settings SET payment_phone_enabled = true, payment_bit_phone = NULL
     WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$,
  'כדי להפעיל תשלום בביט');

-- ============================================================
-- 3. מנויים ותוספים לפלטפורמה — ידני
-- ============================================================
SELECT tests.run('billing: store_billing has no payments_ready (manual only)',
  $$SELECT 1 WHERE NOT (public.store_billing() ? 'payments_ready') AND public.store_billing() ? 'billing_profile'$$,
  :OA, NULL, 1);
SELECT tests.run('billing: addons_store has no payments_ready',
  $$SELECT 1 WHERE NOT (public.addons_store() ? 'payments_ready') AND jsonb_array_length(public.addons_store() -> 'addons') = 4$$,
  :OA, NULL, 1);
SELECT tests.run('billing: buying an addon works without card clearing',
  $$SELECT public.addon_purchase('google_sso', NULL)$$, :OA);
SELECT tests.check('billing: the addon is active and the charge is due (awaiting manual payment)',
  $$SELECT EXISTS (SELECT 1 FROM public.tenant_addons WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'
                     AND addon_name = 'google_sso' AND status = 'active')
       AND EXISTS (SELECT 1 FROM public.billing_history WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'
                     AND kind = 'addon' AND addon_name = 'google_sso' AND payment_status = 'due' AND amount > 0)$$);
SELECT tests.run('billing: platform admin records a bank transfer (platform_record_payment)',
  $$SELECT public.platform_record_payment('70000000-0000-0000-0000-00000000000a', 'basic', 1188, 12, 'other',
                                          'העברה בנקאית 28', 'חלק 28')$$, :PA);
SELECT tests.check('billing: the manual payment is in the history',
  $$SELECT EXISTS (SELECT 1 FROM public.billing_history WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'
                     AND kind = 'payment' AND payment_method = 'other' AND reference = 'העברה בנקאית 28')$$);
SELECT tests.run('billing: a store admin cannot record payments',
  $$SELECT public.platform_record_payment('70000000-0000-0000-0000-00000000000a', 'basic', 1, 1, 'other', NULL, NULL)$$,
  :OA, 'מנהל');

-- ============================================================
-- ניקוי
-- ============================================================
SELECT set_config('request.headers', '', false);
DELETE FROM public.orders
 WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'
   AND (customer_id = 'a0000000-0000-0000-0000-0000000000e1' OR customer_email = 'guest.hyp@test.local');
DELETE FROM public.global_products WHERE id = '9e000000-0000-0000-0000-000000000001';
DELETE FROM public.shipping_methods WHERE id = '5e000000-0000-0000-0000-000000000001';
DELETE FROM public.categories WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND name = 'בדיקת תשלום';
DELETE FROM public.billing_history
 WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'
   AND (addon_name = 'google_sso' OR reference = 'העברה בנקאית 28');
DELETE FROM public.tenant_addons WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND addon_name = 'google_sso';
UPDATE public.tenant_subscriptions SET plan_type = 'basic', status = 'active', current_period_end = now() + interval '1 year'
 WHERE tenant_id = '70000000-0000-0000-0000-00000000000a';
UPDATE public.site_settings SET payment_phone_enabled = true, payment_bit_enabled = false, payment_bit_phone = NULL
 WHERE tenant_id = '70000000-0000-0000-0000-00000000000a';
DROP TABLE IF EXISTS hyp_stock;

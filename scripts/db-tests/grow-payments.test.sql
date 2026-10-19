-- ============================================================
-- חלק 43: סליקה דרך Grow — פרטי מסוף נעולים, אמצעי תשלום grow רק כשמופעל,
-- סימון "שולם" רק אחרי התראה מאומתת (טוקן + סכום), חד-פעמי, ושדות העסקה נעולים.
-- ============================================================
\set OA '''a0000000-0000-0000-0000-0000000000a1'''
\set CE '''a0000000-0000-0000-0000-0000000000e1'''
\set TEN '''70000000-0000-0000-0000-00000000000a'''

CREATE OR REPLACE FUNCTION tests.grow_details(_payment TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'customer_name', 'לקוח גרואו', 'customer_tax_id', '123456782', 'customer_phone', '0501234567',
    'customer_email', 'cust.grow@test.local',
    'billing_city', 'תל אביב', 'billing_address', 'הרצל 1', 'billing_zip', '6100001',
    'accepted_terms', true, 'shipping_method_id', '5e000000-0000-0000-0000-000000000001',
    'payment_method', _payment));
$f$;
CREATE OR REPLACE FUNCTION tests.grow_items() RETURNS JSONB LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_array(jsonb_build_object(
    'product_id', '9e000000-0000-0000-0000-000000000001', 'quantity', 1, 'unit_price', 100));
$f$;
GRANT USAGE ON SCHEMA tests TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tests.grow_details(TEXT), tests.grow_items() TO anon, authenticated;

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


-- ---------- 1. פרטי המסוף נעולים לכולם חוץ מ-service_role ----------
SELECT tests.run('credentials: a store admin cannot read the table', $$SELECT * FROM public.tenant_grow_credentials$$, :OA, 'permission denied');
SELECT tests.run('credentials: a store admin cannot write the table',
  $$INSERT INTO public.tenant_grow_credentials (tenant_id, user_id_enc, page_code_enc) VALUES ('70000000-0000-0000-0000-00000000000a', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb')$$,
  :OA, 'permission denied');
SELECT tests.run('processes: a store admin cannot read the table', $$SELECT * FROM public.grow_payment_processes$$, :OA, 'permission denied');
SELECT tests.run('guest: cannot call grow_mark_paid',
  $$SELECT public.grow_mark_paid('1', false, 'x', 1, '2', 'a', 't', 'Visa', '1111', 1)$$, NULL, 'permission denied');
SELECT tests.run('store admin: cannot call grow_mark_paid',
  $$SELECT public.grow_mark_paid('1', false, 'x', 1, '2', 'a', 't', 'Visa', '1111', 1)$$, :OA, 'permission denied');

-- ---------- 2. כבוי כברירת מחדל ----------
SELECT tests.check('inactive by default', $$SELECT NOT public.grow_payments_active('70000000-0000-0000-0000-00000000000a')$$);
SELECT tests.run('checkout: grow is refused while the store has no Grow',
  $$SELECT * FROM public.place_order('order', tests.grow_items(), 18, true, tests.grow_details('grow'))$$, :CE,
  'התשלום המקוון אינו זמין');

-- מנהל הפלטפורמה (השרת) מזין פרטים ומפעיל
INSERT INTO public.tenant_grow_credentials (tenant_id, user_id_enc, page_code_enc, enabled, max_payments)
VALUES ('70000000-0000-0000-0000-00000000000a', 'enc-user-id-aaaaaaaaaaaa', 'enc-page-code-bbbbbbbbbb', false, 3);
SELECT tests.check('inactive while enabled = false', $$SELECT NOT public.grow_payments_active('70000000-0000-0000-0000-00000000000a')$$);
SELECT tests.check('max payments above 12 is rejected',
  $$DO $b$ BEGIN UPDATE public.tenant_grow_credentials SET max_payments = 13; RAISE EXCEPTION 'bad'; EXCEPTION WHEN check_violation THEN NULL; END $b$; SELECT true$$);
UPDATE public.tenant_grow_credentials SET enabled = true WHERE tenant_id = '70000000-0000-0000-0000-00000000000a';
SELECT tests.check('active after the platform admin enables', $$SELECT public.grow_payments_active('70000000-0000-0000-0000-00000000000a')$$);

-- ---------- 3. הזמנה ב-grow ----------
SELECT tests.run('checkout: grow order is saved before the payment page',
  $$SELECT * FROM public.place_order('order', tests.grow_items(), 18, true, tests.grow_details('grow'))$$, :CE);
SELECT tests.check('grow order is pending + awaiting for 2 hours',
  $$SELECT count(*) = 1 AND bool_and(status = 'pending' AND payment_status = 'awaiting'
           AND payment_due_at BETWEEN now() + interval '1 hour 59 minutes' AND now() + interval '2 hours 1 minute'
           AND grow_asmachta IS NULL)
      FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'grow'$$);
SELECT tests.run('guard: admin cannot mark the grow order paid by a direct update (silently kept)',
  $$UPDATE public.orders SET payment_status = 'paid', paid_at = now(), grow_asmachta = 'FAKE'
     WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'grow'$$, :OA, NULL, 1);
SELECT tests.check('guard: payment + grow fields unchanged after the direct update',
  $$SELECT bool_and(payment_status = 'awaiting' AND paid_at IS NULL AND grow_asmachta IS NULL)
      FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'grow'$$);
SELECT tests.run('guard: unpaid grow order cannot move to picking',
  $$UPDATE public.orders SET status = 'picking'
     WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'grow'$$, :OA,
  'עדיין ממתינה לתשלום');

-- תהליך תשלום לכל הזמנה (השרת)
INSERT INTO public.grow_payment_processes (tenant_id, order_id, process_id, process_token_hash, amount)
SELECT tenant_id, id, 'P-1001', encode(sha256(convert_to('secret-token-1', 'UTF8')), 'hex'), 118
  FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'grow';
SELECT tests.check('only one pending process per order',
  $$DO $b$ BEGIN
      INSERT INTO public.grow_payment_processes (tenant_id, order_id, process_id, process_token_hash, amount)
      SELECT tenant_id, order_id, 'P-1002', repeat('a', 64), 118 FROM public.grow_payment_processes WHERE process_id = 'P-1001';
      RAISE EXCEPTION 'dup';
    EXCEPTION WHEN unique_violation THEN NULL; END $b$; SELECT true$$);

-- ---------- 4. התראות ----------
SELECT set_config('tests.h', encode(sha256(convert_to('secret-token-1', 'UTF8')), 'hex'), false);
SELECT tests.check('webhook: unknown process → unknown',
  $$SELECT public.grow_mark_paid('NOPE', false, current_setting('tests.h'), 118, '2', 'A1', 'T1', 'Visa', '1111', 1) ->> 'result' = 'unknown'$$);
SELECT tests.check('webhook: sandbox flag must match',
  $$SELECT public.grow_mark_paid('P-1001', true, current_setting('tests.h'), 118, '2', 'A1', 'T1', 'Visa', '1111', 1) ->> 'result' = 'unknown'$$);
SELECT tests.check('webhook: wrong token → bad_token and the order stays unpaid',
  $$SELECT public.grow_mark_paid('P-1001', false, repeat('0', 64), 118, '2', 'A1', 'T1', 'Visa', '1111', 1) ->> 'result' = 'bad_token'
       AND (SELECT payment_status FROM public.orders WHERE payment_method = 'grow' AND customer_id = 'a0000000-0000-0000-0000-0000000000e1') = 'awaiting'$$);
SELECT tests.check('webhook: wrong amount → amount_mismatch, still unpaid',
  $$SELECT public.grow_mark_paid('P-1001', false, current_setting('tests.h'), 5, '2', 'A1', 'T1', 'Visa', '1111', 1) ->> 'result' = 'amount_mismatch'
       AND (SELECT payment_status FROM public.orders WHERE payment_method = 'grow' AND customer_id = 'a0000000-0000-0000-0000-0000000000e1') = 'awaiting'$$);
SELECT tests.check('webhook: a failed status code (1) → not_paid, still unpaid',
  $$SELECT public.grow_mark_paid('P-1001', false, current_setting('tests.h'), 118, '1', 'A1', 'T1', 'Visa', '1111', 1) ->> 'result' = 'not_paid'
       AND (SELECT payment_status FROM public.orders WHERE payment_method = 'grow' AND customer_id = 'a0000000-0000-0000-0000-0000000000e1') = 'awaiting'$$);
SELECT set_config('tests.r', public.grow_mark_paid('P-1001', false, current_setting('tests.h'), 118, '2', '0289199', '145111110', 'Mastercard', '1177', 3)::text, false);
SELECT tests.check('webhook: correct token + amount + status → paid',
  $$SELECT current_setting('tests.r')::jsonb ->> 'result' = 'paid'$$);
SELECT tests.check('order is paid with the confirmation details',
  $$SELECT bool_and(payment_status = 'paid' AND paid_at IS NOT NULL AND payment_due_at IS NULL
                    AND grow_asmachta = '0289199' AND grow_transaction_id = '145111110'
                    AND grow_card = 'Mastercard ····1177' AND grow_installments = 3)
      FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'grow'$$);
SELECT tests.check('webhook repeated → already_paid, nothing changes',
  $$SELECT public.grow_mark_paid('P-1001', false, current_setting('tests.h'), 118, '2', 'OTHER', 'T2', 'Visa', '2222', 1) ->> 'result' = 'already_paid'
       AND (SELECT grow_asmachta FROM public.orders WHERE payment_method = 'grow' AND customer_id = 'a0000000-0000-0000-0000-0000000000e1') = '0289199'$$);
SELECT tests.run('guard: grow confirmation fields cannot be edited by the admin',
  $$UPDATE public.orders SET grow_asmachta = 'EDIT', grow_card = 'EDIT'
     WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'grow'$$, :OA, NULL, 1);
SELECT tests.check('grow confirmation intact after the edit attempt',
  $$SELECT bool_and(grow_asmachta = '0289199' AND grow_card = 'Mastercard ····1177')
      FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'grow'$$);
SELECT tests.run('paid grow order moves to picking',
  $$UPDATE public.orders SET status = 'picking'
     WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'grow'$$, :OA, NULL, 1);

-- ---------- 5. שולם אחרי שההזמנה פגה / בוטלה ----------
SELECT tests.run('second grow order', $$SELECT * FROM public.place_order('order', tests.grow_items(), 18, true, tests.grow_details('grow'))$$, :CE);
INSERT INTO public.grow_payment_processes (tenant_id, order_id, process_id, process_token_hash, amount)
SELECT tenant_id, id, 'P-2001', encode(sha256(convert_to('secret-token-2', 'UTF8')), 'hex'), 118
  FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'grow' AND payment_status = 'awaiting';
SELECT set_config('kobi.payment_update', 'on', false);
UPDATE public.orders SET payment_due_at = now() - interval '1 minute'
 WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'grow' AND payment_status = 'awaiting';
SELECT set_config('kobi.payment_update', 'off', false);
SELECT public.expire_unpaid_orders();
SELECT tests.check('unpaid grow order expired → cancelled',
  $$SELECT count(*) = 1 FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'grow' AND payment_status = 'expired' AND status = 'cancelled'$$);
SELECT set_config('tests.r', public.grow_mark_paid('P-2001', false, encode(sha256(convert_to('secret-token-2', 'UTF8')), 'hex'), 118, '2', 'A9', 'T9', 'Visa', '9999', 1)::text, false);
SELECT tests.check('payment arriving after expiry → paid_late, the order is not reopened',
  $$SELECT current_setting('tests.r')::jsonb ->> 'result' = 'paid_late'
       AND (SELECT count(*) FROM public.orders WHERE payment_method = 'grow' AND payment_status = 'expired') = 1
       AND (SELECT status FROM public.grow_payment_processes WHERE process_id = 'P-2001') = 'paid_late'$$);

-- ניקוי (כדי שהבדיקות האחרות יראו את אותם נתונים כמו קודם)
DELETE FROM public.grow_payment_processes;
DELETE FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e1' AND payment_method = 'grow';
DELETE FROM public.tenant_grow_credentials;

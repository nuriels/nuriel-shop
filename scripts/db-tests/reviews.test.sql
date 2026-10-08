-- ============================================================
-- חלק 34: ביקורות לקוחות — שליחה (ממתינה לאישור), קריאה באתר (רק מאושרות),
-- אישור / הסתרה / מחיקה ע"י בעלים ומנהל בלבד, סיכומי דירוג, הגדרת החנות.
-- חנות B: b1 בעלים, b2 מנהל; כאן נוספים קופאי, מחסנאי ולקוח.
-- ============================================================
\set OA  '''a0000000-0000-0000-0000-0000000000a1'''
\set B1  '''a0000000-0000-0000-0000-0000000000b1'''
\set B2  '''a0000000-0000-0000-0000-0000000000b2'''
\set RC  '''a0000000-0000-0000-0000-0000000000f1'''
\set RW  '''a0000000-0000-0000-0000-0000000000f2'''
\set RU  '''a0000000-0000-0000-0000-0000000000f3'''
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
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);

-- ---------- נתונים ----------
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000f1', 'rev.cashier@test.local'),
  ('a0000000-0000-0000-0000-0000000000f2', 'rev.warehouse@test.local'),
  ('a0000000-0000-0000-0000-0000000000f3', 'rev.customer@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name) VALUES
  ('70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000f1', 'rev.cashier@test.local', 'rev_cashier', 'cashier', true, 'קופאית'),
  ('70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000f2', 'rev.warehouse@test.local', 'rev_warehouse', 'warehouse', true, 'מחסנאי'),
  ('70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000f3', 'rev.customer@test.local', 'rev_customer', 'customer', true, NULL)
ON CONFLICT DO NOTHING;
INSERT INTO public.customer_profiles (user_id, tenant_id, business_name, phone, city, business_address, zip_code, price_tier, age_confirmed)
VALUES ('a0000000-0000-0000-0000-0000000000f3', '70000000-0000-0000-0000-00000000000b', 'לקוח ביקורות', '0521234567', 'חיפה', 'הנמל 1', '3100001', 1, true)
ON CONFLICT DO NOTHING;
INSERT INTO public.categories (tenant_id, name) VALUES ('70000000-0000-0000-0000-00000000000b', 'בדיקת ביקורות') ON CONFLICT DO NOTHING;
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, price_tier2, stock_quantity, is_hidden) VALUES
  ('9d000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000b', '96000001', 'אוזניות ביקורת', 'בדיקת ביקורות', 'a0000000-0000-0000-0000-0000000000b1', 100, 100, 50, false),
  ('9d000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000b', '96000002', 'מוצר מוסתר', 'בדיקת ביקורות', 'a0000000-0000-0000-0000-0000000000b1', 50, 50, 50, true),
  ('9d000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-00000000000b', '96000003', 'מוצר למחיקה', 'בדיקת ביקורות', 'a0000000-0000-0000-0000-0000000000b1', 30, 30, 50, false)
ON CONFLICT DO NOTHING;
-- הלקוח קנה את האוזניות (הזמנה שנמסרה)
SELECT tests.server('setup: delivered order with the headphones for the customer',
  $$INSERT INTO public.orders (id, tenant_id, customer_id, kind, note) VALUES ('9d300000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000f3', 'order', 'rev-order');
    INSERT INTO public.order_items (tenant_id, order_id, product_id, quantity, unit_price)
    VALUES ('70000000-0000-0000-0000-00000000000b', '9d300000-0000-0000-0000-000000000001', '9d000000-0000-0000-0000-000000000001', 1, 100);
    UPDATE public.orders SET status = 'delivered' WHERE id = '9d300000-0000-0000-0000-000000000001'$$);

-- ---------- שליחה ----------
SELECT tests.check('submit: guest review saved as pending (not a verified purchase)',
  $$SELECT NOT (public.product_review_submit('9d000000-0000-0000-0000-000000000001', '  דנה   כהן ', 5, 'מוצר מעולה, ממליצה בחום!')->>'verified_purchase')::boolean$$);
SELECT tests.check('submit: stored pending, name normalized',
  $$SELECT NOT is_approved AND customer_name = 'דנה כהן' AND user_id IS NULL AND approved_at IS NULL
      FROM public.product_reviews WHERE content = 'מוצר מעולה, ממליצה בחום!'$$);
SELECT tests.check('submit: customer who bought it → verified purchase',
  $$SELECT (public.product_review_submit('9d000000-0000-0000-0000-000000000001', 'יוסי', 4, E'איכות טובה.\r\n\n\n\n\nמשלוח מהיר\t\u0001מאוד', 'a0000000-0000-0000-0000-0000000000f3')->>'verified_purchase')::boolean$$);
SELECT tests.check('submit: control chars removed, tabs → spaces, blank lines collapsed',
  $$SELECT content = E'איכות טובה.\n\nמשלוח מהיר מאוד' FROM public.product_reviews WHERE customer_name = 'יוסי'$$);
SELECT tests.server('submit: the same customer again → rejected',
  $$SELECT public.product_review_submit('9d000000-0000-0000-0000-000000000001', 'יוסי', 1, 'ניסיון שני', 'a0000000-0000-0000-0000-0000000000f3')$$,
  'כבר כתבת ביקורת');
SELECT tests.check('submit: account of another store is accepted',
  $$SELECT public.product_review_submit('9d000000-0000-0000-0000-000000000001', 'מנהל זר', 3, 'סביר בהחלט', 'a0000000-0000-0000-0000-0000000000a1') ? 'id'$$);
SELECT tests.check('submit: … and saved as a guest (no account link)',
  $$SELECT user_id IS NULL AND NOT verified_purchase FROM public.product_reviews WHERE customer_name = 'מנהל זר'$$);
SELECT tests.server('submit: the same text again today → rejected (double click)',
  $$SELECT public.product_review_submit('9d000000-0000-0000-0000-000000000001', 'דנה כהן', 5, 'מוצר מעולה, ממליצה בחום!')$$, 'כבר נשלחה');
SELECT tests.server('submit: rating 0 → rejected', $$SELECT public.product_review_submit('9d000000-0000-0000-0000-000000000001', 'דני', 0, 'לא אהבתי בכלל')$$, 'דירוג');
SELECT tests.server('submit: rating 6 → rejected', $$SELECT public.product_review_submit('9d000000-0000-0000-0000-000000000001', 'דני', 6, 'אהבתי מאוד מאוד')$$, 'דירוג');
SELECT tests.server('submit: 1-letter name → rejected', $$SELECT public.product_review_submit('9d000000-0000-0000-0000-000000000001', 'ד', 4, 'טוב מאוד')$$, 'השם');
SELECT tests.server('submit: empty text → rejected', $$SELECT public.product_review_submit('9d000000-0000-0000-0000-000000000001', 'דני', 4, '  ok  ')$$, 'כמה מילים');
SELECT tests.server('submit: link in the text → rejected', $$SELECT public.product_review_submit('9d000000-0000-0000-0000-000000000001', 'דני', 5, 'קנו ב https://spam.example זול')$$, 'קישורים');
SELECT tests.server('submit: domain in the text → rejected', $$SELECT public.product_review_submit('9d000000-0000-0000-0000-000000000001', 'דני', 5, 'מבצעים באתר cheap-deals.co.il עכשיו')$$, 'קישורים');
SELECT tests.server('submit: hidden product → not found', $$SELECT public.product_review_submit('9d000000-0000-0000-0000-000000000002', 'דני', 5, 'מוצר מוסתר טוב')$$, 'המוצר לא נמצא');
SELECT tests.server('submit: product of store A (on store B site) → not found',
  $$SELECT public.product_review_submit((SELECT id FROM public.global_products WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' LIMIT 1), 'דני', 5, 'מוצר של חנות אחרת')$$, 'המוצר לא נמצא');
SELECT tests.run('submit: anonymous cannot call the function directly',
  $$SELECT public.product_review_submit('9d000000-0000-0000-0000-000000000001', 'בוט', 5, 'ספאם ספאם ספאם')$$, NULL, 'permission denied');
SELECT tests.run('submit: a signed-in customer cannot call it directly (only through the server)',
  $$SELECT public.product_review_submit('9d000000-0000-0000-0000-000000000001', 'בוט', 5, 'ספאם ספאם ספאם', 'a0000000-0000-0000-0000-0000000000b1')$$, :RU, 'permission denied');
SELECT tests.check('notify: owner + manager got a bell notification, not the cashier',
  $$SELECT (SELECT count(*) FROM public.staff_notifications WHERE kind = 'new_review' AND user_id = 'a0000000-0000-0000-0000-0000000000b1') = 3
       AND (SELECT count(*) FROM public.staff_notifications WHERE kind = 'new_review' AND user_id = 'a0000000-0000-0000-0000-0000000000b2') = 3
       AND (SELECT count(*) FROM public.staff_notifications WHERE kind = 'new_review' AND user_id = 'a0000000-0000-0000-0000-0000000000f1') = 0
       AND (SELECT link FROM public.staff_notifications WHERE kind = 'new_review' LIMIT 1) = '/admin?tab=reviews'$$);

-- ---------- לפני אישור: לא מוצג באתר ----------
SELECT tests.run('public: nothing shown before approval (guest)', $$SELECT 1 FROM public.product_reviews_public('9d000000-0000-0000-0000-000000000001')$$, NULL, NULL, 0);
SELECT tests.run('public: summary — 0 reviews', $$SELECT 1 WHERE (public.product_review_summary('9d000000-0000-0000-0000-000000000001')->>'count')::int = 0$$, NULL, NULL, 1);
SELECT tests.run('table: anonymous cannot read the table', $$SELECT 1 FROM public.product_reviews$$, NULL, 'permission denied');
SELECT tests.run('table: a customer sees no reviews (pending included)', $$SELECT 1 FROM public.product_reviews$$, :RU, NULL, 0);
SELECT tests.run('table: cashier sees nothing', $$SELECT 1 FROM public.product_reviews$$, :RC, NULL, 0);
SELECT tests.run('table: warehouse sees nothing', $$SELECT 1 FROM public.product_reviews$$, :RW, NULL, 0);
SELECT tests.run('table: manager sees the 3 pending reviews', $$SELECT 1 FROM public.product_reviews WHERE NOT is_approved$$, :B2, NULL, 3);

-- ---------- ניהול ----------
SELECT tests.run('admin list: manager — 3 pending, oldest first',
  $$SELECT 1 FROM public.admin_product_reviews('pending') WHERE product_name = 'אוזניות ביקורת'$$, :B2, NULL, 3);
SELECT tests.run('admin list: the customer''s email is shown to the manager',
  $$SELECT 1 FROM public.admin_product_reviews('all') WHERE customer_email = 'rev.customer@test.local' AND verified_purchase$$, :B2, NULL, 1);
SELECT tests.run('admin list: cashier → no permission', $$SELECT 1 FROM public.admin_product_reviews('pending')$$, :RC, 'אין לך הרשאה');
SELECT tests.run('admin list: warehouse → no permission', $$SELECT 1 FROM public.admin_product_reviews('pending')$$, :RW, 'אין לך הרשאה');
SELECT tests.run('admin list: customer → no permission', $$SELECT 1 FROM public.admin_product_reviews('pending')$$, :RU, 'אין לך הרשאה');
SELECT tests.run('admin list: anonymous → permission denied', $$SELECT 1 FROM public.admin_product_reviews('pending')$$, NULL, 'permission denied');
SELECT tests.run('admin list: bad filter', $$SELECT 1 FROM public.admin_product_reviews('everything')$$, :B2, 'סינון לא תקין');
SELECT tests.run('moderate: cashier cannot approve',
  $$SELECT public.admin_review_moderate(ARRAY(SELECT id FROM public.product_reviews), 'approve')$$, :RC, 'אין לך הרשאה');
SELECT tests.run('moderate: warehouse cannot approve',
  $$SELECT public.admin_review_moderate(ARRAY['00000000-0000-0000-0000-000000000000'::uuid], 'approve')$$, :RW, 'אין לך הרשאה');
SELECT tests.run('moderate: the manager cannot edit a review directly (only approve / hide / delete)',
  $$UPDATE public.product_reviews SET content = 'נערך ע"י החנות'$$, :B2, 'permission denied');
SELECT tests.run('moderate: manager approves the guest review',
  $$SELECT 1 WHERE public.admin_review_moderate(ARRAY(SELECT id FROM public.product_reviews WHERE customer_name = 'דנה כהן'), 'approve') = 1$$, :B2, NULL, 1);
SELECT tests.check('moderate: approved_at + approved_by = the manager',
  $$SELECT is_approved AND approved_at IS NOT NULL AND approved_by = 'a0000000-0000-0000-0000-0000000000b2'
      FROM public.product_reviews WHERE customer_name = 'דנה כהן'$$);
SELECT tests.run('public: the approved review is shown to guests (no user id)',
  $$SELECT 1 FROM public.product_reviews_public('9d000000-0000-0000-0000-000000000001') WHERE customer_name = 'דנה כהן' AND rating = 5 AND NOT verified_purchase$$, NULL, NULL, 1);
SELECT tests.run('moderate: owner approves the rest (bulk, already-approved skipped)',
  $$SELECT 1 WHERE public.admin_review_moderate(ARRAY(SELECT id FROM public.product_reviews), 'approve') = 2$$, :B1, NULL, 1);
SELECT tests.run('public: summary — 3 reviews, average 4.0, distribution',
  $$SELECT 1 WHERE (SELECT s->>'count' = '3' AND (s->>'average')::numeric = 4.0 AND s->'distribution'->>'5' = '1'
                       AND s->'distribution'->>'4' = '1' AND s->'distribution'->>'3' = '1' AND s->'distribution'->>'1' = '0'
                       AND (s->>'enabled')::boolean
                      FROM (SELECT public.product_review_summary('9d000000-0000-0000-0000-000000000001') s) q)$$, NULL, NULL, 1);
SELECT tests.run('public: newest first, verified purchase flag',
  $$SELECT 1 FROM public.product_reviews_public('9d000000-0000-0000-0000-000000000001', 2, 0) WHERE verified_purchase$$, NULL, NULL, 1);
SELECT tests.run('public: paging (limit 2, offset 2 → 1 more)',
  $$SELECT 1 FROM public.product_reviews_public('9d000000-0000-0000-0000-000000000001', 2, 2)$$, NULL, NULL, 1);
SELECT tests.run('catalog: rating summaries for the cards',
  $$SELECT 1 FROM public.product_rating_summaries() WHERE product_id = '9d000000-0000-0000-0000-000000000001' AND review_count = 3 AND average_rating = 4.0$$, NULL, NULL, 1);
SELECT tests.run('moderate: hide one → 2 shown',
  $$SELECT 1 WHERE public.admin_review_moderate(ARRAY(SELECT id FROM public.product_reviews WHERE customer_name = 'מנהל זר'), 'hide') = 1$$, :B2, NULL, 1);
SELECT tests.check('moderate: hidden → approval cleared',
  $$SELECT NOT is_approved AND approved_at IS NULL AND approved_by IS NULL FROM public.product_reviews WHERE customer_name = 'מנהל זר'$$);
SELECT tests.run('public: 2 shown after hiding', $$SELECT 1 FROM public.product_reviews_public('9d000000-0000-0000-0000-000000000001')$$, NULL, NULL, 2);
SELECT tests.run('moderate: delete', $$SELECT 1 WHERE public.admin_review_moderate(ARRAY(SELECT id FROM public.product_reviews WHERE customer_name = 'מנהל זר'), 'delete') = 1$$, :B2, NULL, 1);
SELECT tests.check('moderate: deleted', $$SELECT NOT EXISTS (SELECT 1 FROM public.product_reviews WHERE customer_name = 'מנהל זר')$$);
SELECT tests.run('moderate: bad action', $$SELECT public.admin_review_moderate(ARRAY(SELECT id FROM public.product_reviews), 'publish')$$, :B2, 'פעולה לא תקינה');
SELECT tests.run('moderate: nothing selected', $$SELECT public.admin_review_moderate(ARRAY[]::uuid[], 'approve')$$, :B2, 'לא נבחרו');

-- ---------- חנות אחרת ----------
SELECT id AS b_review FROM public.product_reviews WHERE customer_name = 'דנה כהן' \gset
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
SELECT tests.run('other store: store A owner cannot delete a store B review (on A site)',
  format($$SELECT 1 WHERE public.admin_review_moderate(ARRAY[%L::uuid], 'delete') = 0$$, :'b_review'), :OA, NULL, 1);
SELECT tests.check('other store: store B reviews untouched', $$SELECT count(*) = 2 FROM public.product_reviews WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'$$);
SELECT tests.run('other store: B reviews not shown on store A site', $$SELECT 1 FROM public.product_reviews_public('9d000000-0000-0000-0000-000000000001')$$, NULL, NULL, 0);
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);

-- ---------- כיבוי הביקורות בחנות / מוצר שהוסתר ----------
UPDATE public.site_settings SET reviews_enabled = false WHERE tenant_id = '70000000-0000-0000-0000-00000000000b';
SELECT tests.run('disabled: nothing shown', $$SELECT 1 FROM public.product_reviews_public('9d000000-0000-0000-0000-000000000001')$$, NULL, NULL, 0);
SELECT tests.run('disabled: summary says disabled', $$SELECT 1 WHERE NOT (public.product_review_summary('9d000000-0000-0000-0000-000000000001')->>'enabled')::boolean$$, NULL, NULL, 1);
SELECT tests.server('disabled: new reviews rejected',
  $$SELECT public.product_review_submit('9d000000-0000-0000-0000-000000000001', 'דני', 5, 'מוצר טוב מאוד')$$, 'אינה פעילה');
UPDATE public.site_settings SET reviews_enabled = true WHERE tenant_id = '70000000-0000-0000-0000-00000000000b';
UPDATE public.global_products SET is_hidden = true WHERE id = '9d000000-0000-0000-0000-000000000001';
SELECT tests.run('hidden product: its reviews are not shown', $$SELECT 1 FROM public.product_reviews_public('9d000000-0000-0000-0000-000000000001')$$, NULL, NULL, 0);
UPDATE public.global_products SET is_hidden = false WHERE id = '9d000000-0000-0000-0000-000000000001';

-- ---------- מחיקת מוצר / לקוח ----------
SELECT tests.check('delete product: its reviews go with it',
  $$WITH r AS (SELECT public.product_review_submit('9d000000-0000-0000-0000-000000000003', 'רונית', 2, 'לא מה שציפיתי') x),
         d AS (DELETE FROM public.global_products WHERE id = '9d000000-0000-0000-0000-000000000003' AND EXISTS (SELECT 1 FROM r) RETURNING 1)
    SELECT count(*) = 1 FROM d$$);
SELECT tests.check('delete product: no orphan reviews', $$SELECT NOT EXISTS (SELECT 1 FROM public.product_reviews WHERE product_id = '9d000000-0000-0000-0000-000000000003')$$);
SELECT tests.server('customer leaves the store: review stays, without the account',
  $$DELETE FROM public.orders WHERE id = '9d300000-0000-0000-0000-000000000001';
    DELETE FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000f3'$$);
SELECT tests.check('customer left: review kept (user_id NULL, still verified)',
  $$SELECT user_id IS NULL AND verified_purchase AND is_approved FROM public.product_reviews WHERE customer_name = 'יוסי'$$);

-- ניקוי: חזרה למצב ה-fixtures
SELECT set_config('request.headers', '', false);
DELETE FROM public.staff_notifications WHERE kind = 'new_review';
DELETE FROM public.product_reviews WHERE tenant_id = '70000000-0000-0000-0000-00000000000b';
DELETE FROM public.global_products WHERE id IN ('9d000000-0000-0000-0000-000000000001', '9d000000-0000-0000-0000-000000000002', '9d000000-0000-0000-0000-000000000003');
DELETE FROM public.customer_profiles WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000f3';
DELETE FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'
   AND user_id IN ('a0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000f3');

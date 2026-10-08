-- ============================================================
-- חלק 33: תפקידים והרשאות לצוות החנות
--   בעלים / מנהל / קופאי / מחסנאי, staff_can, ניהול הצוות, חבילה לבעלים
--   בלבד, קופה לקופאי, מעקב "נוצר ע"י" בהזמנות, ומסך המחסנאי.
-- הבדיקות בחנות B (פרימיום: עד 3 מנהלים) — b1 בעלים, b2 מנהל.
-- ============================================================
\set P   '''a0000000-0000-0000-0000-0000000000f0'''
\set OA  '''a0000000-0000-0000-0000-0000000000a1'''
\set B1  '''a0000000-0000-0000-0000-0000000000b1'''
\set B2  '''a0000000-0000-0000-0000-0000000000b2'''
\set CA  '''a0000000-0000-0000-0000-0000000000d5'''
\set WH  '''a0000000-0000-0000-0000-0000000000d6'''
\set CU  '''a0000000-0000-0000-0000-0000000000d7'''
\set TM  '''a0000000-0000-0000-0000-0000000000d8'''
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
-- כמו tests.check, אבל "בתור" משתמש מסוים (auth.uid()) — לפונקציות שמחזירות ערך
CREATE OR REPLACE FUNCTION tests.check_as(_name TEXT, _uid TEXT, _sql TEXT) RETURNS VOID LANGUAGE plpgsql AS $f$
DECLARE v BOOLEAN; err TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid, ''), true);
    EXECUTE _sql INTO v;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, COALESCE(v, false), COALESCE('ERROR: ' || err, 'value=' || COALESCE(v::text, 'null')));
END; $f$;
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);

-- ---------- נתונים: קופאי, מחסנאי, לקוח, עובד זמני; מוצרים בחנות B ----------
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000d5', 'cashier.b@test.local'),
  ('a0000000-0000-0000-0000-0000000000d6', 'warehouse.b@test.local'),
  ('a0000000-0000-0000-0000-0000000000d7', 'customer.b@test.local'),
  ('a0000000-0000-0000-0000-0000000000d8', 'temp.b@test.local')
ON CONFLICT DO NOTHING;
SELECT tests.server('roles: the server adds a cashier, a warehouse worker, a customer and a temp agent',
  $$INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name) VALUES
      ('70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000d5', 'cashier.b@test.local', 'cashier_b', 'cashier', true, 'רונית הקופאית'),
      ('70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000d6', 'warehouse.b@test.local', 'warehouse_b', 'warehouse', true, 'משה המחסנאי'),
      ('70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000d7', 'customer.b@test.local', 'customer_b', 'customer', true, NULL),
      ('70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000d8', 'temp.b@test.local', 'temp_b', 'agent', true, 'עובד זמני')
    ON CONFLICT DO NOTHING$$);
INSERT INTO public.customer_profiles (user_id, tenant_id, business_name, phone, city, business_address, zip_code, price_tier, age_confirmed)
VALUES ('a0000000-0000-0000-0000-0000000000d7', '70000000-0000-0000-0000-00000000000b', 'לקוח חנות B', '0521112233', 'תל אביב', 'הרצל 1', '6100001', 1, true)
ON CONFLICT DO NOTHING;
INSERT INTO public.categories (tenant_id, name) VALUES ('70000000-0000-0000-0000-00000000000b', 'בדיקת צוות') ON CONFLICT DO NOTHING;
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, price_tier2, cost_price, stock_quantity, barcode)
VALUES
  ('9e000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000b', '95000001', 'מוצר צוות 1', 'בדיקת צוות', 'a0000000-0000-0000-0000-0000000000b1', 100, 90, 40, 20, '7290000000901'),
  ('9e000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000b', '95000002', 'מוצר צוות 2', 'בדיקת צוות', 'a0000000-0000-0000-0000-0000000000b1', 50, 50, 20, 20, NULL)
ON CONFLICT DO NOTHING;

-- ---------- בעלים: המנהל הראשון בחנות ----------
SELECT tests.check('owner: store B owner = b1 (first admin), b2 is a manager',
  $$SELECT (SELECT is_protected FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000b1')
       AND NOT (SELECT is_protected FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000b2')$$);
SELECT tests.check('owner: every store with admins has exactly one owner',
  $$SELECT bool_and(n = 1) FROM (
      SELECT tenant_id, count(*) FILTER (WHERE is_protected) AS n FROM public.user_roles
       WHERE role = 'admin' GROUP BY tenant_id) s$$);
SELECT tests.server('owner: first admin added to a store without admins (C) becomes the owner',
  $$INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
    VALUES ('70000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-0000000000c1', 'new1@test.local', 'new1', 'admin', true)$$);
SELECT tests.server('owner: second admin in C stays a manager',
  $$INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
    VALUES ('70000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-0000000000c2', 'new2@test.local', 'new2', 'admin', true)$$);
SELECT tests.check('owner: C → c1 owner, c2 manager',
  $$SELECT (SELECT is_protected FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-00000000000c' AND user_id = 'a0000000-0000-0000-0000-0000000000c1')
       AND NOT (SELECT is_protected FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-00000000000c' AND user_id = 'a0000000-0000-0000-0000-0000000000c2')$$);
SELECT tests.server('owner: cleanup store C (protected row removed only directly in the DB)',
  $$ALTER TABLE public.user_roles DISABLE TRIGGER user_roles_guard_protected_delete;
    DELETE FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-00000000000c';
    ALTER TABLE public.user_roles ENABLE TRIGGER user_roles_guard_protected_delete$$);

-- ---------- התפקיד ומטריצת ההרשאות ----------
SELECT tests.check_as('role: b1 = owner', :B1, $$SELECT public.store_staff_role() = 'owner'$$);
SELECT tests.check_as('role: b2 = manager', :B2, $$SELECT public.store_staff_role() = 'manager'$$);
SELECT tests.check_as('role: cashier', :CA, $$SELECT public.store_staff_role() = 'cashier'$$);
SELECT tests.check_as('role: warehouse', :WH, $$SELECT public.store_staff_role() = 'warehouse'$$);
SELECT tests.check_as('role: customer = none', :CU, $$SELECT public.store_staff_role() IS NULL$$);
SELECT tests.check_as('role: platform admin (God Mode) = owner', :P, $$SELECT public.store_staff_role() = 'owner'$$);
SELECT tests.check_as('role: owner of A has no role in B', :OA, $$SELECT public.store_staff_role() IS NULL$$);
SELECT tests.check_as('can: owner — everything', :B1,
  $$SELECT bool_and(public.staff_can(p)) FROM unnest(ARRAY['pos','products.view','inventory','orders.fulfill','admin','staff.manage','staff.managers','billing.manage']) p$$);
SELECT tests.check_as('can: manager — all but billing / managers', :B2,
  $$SELECT bool_and(public.staff_can(p)) AND NOT public.staff_can('billing.manage') AND NOT public.staff_can('staff.managers')
      FROM unnest(ARRAY['pos','products.view','inventory','orders.fulfill','admin','staff.manage']) p$$);
SELECT tests.check_as('can: cashier — POS + products only', :CA,
  $$SELECT public.staff_can('pos') AND public.staff_can('products.view')
       AND NOT public.staff_can('inventory') AND NOT public.staff_can('orders.fulfill')
       AND NOT public.staff_can('admin') AND NOT public.staff_can('staff.manage') AND NOT public.staff_can('billing.manage')$$);
SELECT tests.check_as('can: warehouse — inventory, labels, fulfillment', :WH,
  $$SELECT public.staff_can('inventory') AND public.staff_can('orders.fulfill') AND public.staff_can('products.view')
       AND NOT public.staff_can('pos') AND NOT public.staff_can('admin') AND NOT public.staff_can('staff.manage')$$);
SELECT tests.check_as('can: customer — nothing', :CU,
  $$SELECT NOT public.staff_can('pos') AND NOT public.staff_can('products.view') AND NOT public.staff_can('admin')$$);
SELECT tests.check_as('can: cashier is not "staff" outside the POS', :CA, $$SELECT NOT public.is_staff(auth.uid())$$);
SELECT tests.check_as('can: is_staff is false (not NULL) for a customer', :CU, $$SELECT public.is_staff(auth.uid()) IS FALSE$$);
SELECT tests.run('my_store_role: cashier gets staff_role', $$SELECT 1 FROM public.my_store_role() WHERE role = 'cashier' AND staff_role = 'cashier'$$, :CA, NULL, 1);
SELECT tests.run('my_store_role: owner / manager', $$SELECT 1 FROM public.my_store_role() WHERE role = 'admin' AND staff_role = 'owner'$$, :B1, NULL, 1);
SELECT tests.run('my_store_role: manager', $$SELECT 1 FROM public.my_store_role() WHERE staff_role = 'manager'$$, :B2, NULL, 1);
SELECT tests.run('my_store_role: God Mode = owner', $$SELECT 1 FROM public.my_store_role() WHERE staff_role = 'owner' AND NOT is_member$$, :P, NULL, 1);
SELECT tests.run('my_store_role: customer — no staff role', $$SELECT 1 FROM public.my_store_role() WHERE staff_role IS NULL$$, :CU, NULL, 1);

SELECT tests.run('my_stores: the cashier sees store B in the store switcher',
  $$SELECT 1 FROM public.my_stores() WHERE role = 'cashier' AND NOT is_owner$$, :CA, NULL, 1);
SELECT tests.run('my_stores: the owner is marked as owner',
  $$SELECT 1 FROM public.my_stores() WHERE role = 'admin' AND is_owner AND is_current$$, :B1, NULL, 1);

-- ---------- ניהול הצוות: שינוי תפקיד ----------
SELECT tests.run('staff: manager moves the cashier to warehouse',
  $$SELECT public.store_set_staff_role('a0000000-0000-0000-0000-0000000000d5', 'warehouse')$$, :B2, NULL, 1);
SELECT tests.check('staff: d1 is now warehouse',
  $$SELECT role = 'warehouse' FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000d5'$$);
SELECT tests.run('staff: manager moves d1 back to cashier',
  $$SELECT public.store_set_staff_role('a0000000-0000-0000-0000-0000000000d5', 'cashier')$$, :B2, NULL, 1);
SELECT tests.run('staff: manager cannot make a manager',
  $$SELECT public.store_set_staff_role('a0000000-0000-0000-0000-0000000000d8', 'manager')$$, :B2, 'רק בעל החנות');
SELECT tests.run('staff: manager cannot change the owner',
  $$SELECT public.store_set_staff_role('a0000000-0000-0000-0000-0000000000b1', 'cashier')$$, :B2, 'בעל החנות');
SELECT tests.run('staff: manager cannot change own role',
  $$SELECT public.store_set_staff_role('a0000000-0000-0000-0000-0000000000b2', 'cashier')$$, :B2, 'של עצמך');
SELECT tests.run('staff: owner cannot change own role',
  $$SELECT public.store_set_staff_role('a0000000-0000-0000-0000-0000000000b1', 'manager')$$, :B1, 'בעל החנות');
SELECT tests.run('staff: "owner" is not a role you can give',
  $$SELECT public.store_set_staff_role('a0000000-0000-0000-0000-0000000000d8', 'owner')$$, :B1, 'תפקיד לא תקין');
SELECT tests.run('staff: a customer is not moved from here',
  $$SELECT public.store_set_staff_role('a0000000-0000-0000-0000-0000000000d7', 'cashier')$$, :B1, 'חשבון של לקוח');
SELECT tests.run('staff: cashier cannot manage staff',
  $$SELECT public.store_set_staff_role('a0000000-0000-0000-0000-0000000000d6', 'cashier')$$, :CA, 'אין לך הרשאה');
SELECT tests.run('staff: warehouse cannot manage staff',
  $$SELECT public.store_set_staff_role('a0000000-0000-0000-0000-0000000000d5', 'warehouse')$$, :WH, 'אין לך הרשאה');
SELECT tests.run('staff: store A owner cannot manage store B staff (on B site)',
  $$SELECT public.store_set_staff_role('a0000000-0000-0000-0000-0000000000d5', 'warehouse')$$, :OA, 'אין לך הרשאה');
SELECT tests.run('staff: owner makes the temp worker a manager (3rd admin seat)',
  $$SELECT public.store_set_staff_role('a0000000-0000-0000-0000-0000000000d8', 'manager')$$, :B1, NULL, 1);
SELECT tests.check('staff: d4 is an admin, not protected',
  $$SELECT role = 'admin' AND NOT is_protected FROM public.user_roles
     WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000d8'$$);
SELECT tests.run('staff: 4th manager → plan seat limit',
  $$SELECT public.store_set_staff_role('a0000000-0000-0000-0000-0000000000d6', 'manager')$$, :B1, 'הגעת למגבלת המנהלים');
-- גם ישירות בטבלה (לא דרך הפונקציה) — המסד שומר
SELECT tests.run('staff: manager cannot demote another manager in the table',
  $$UPDATE public.user_roles SET role = 'cashier' WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000d8'$$, :B2, 'רק בעל החנות');
SELECT tests.run('staff: manager cannot block another manager',
  $$UPDATE public.user_roles SET is_blocked = true WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000d8'$$, :B2, 'רק בעל החנות יכול לחסום מנהל');
SELECT tests.run('staff: manager cannot remove another manager',
  $$DELETE FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000d8'$$, :B2, 'רק בעל החנות יכול להסיר מנהל');
SELECT tests.run('staff: manager can still rename a manager (not a role change)',
  $$UPDATE public.user_roles SET display_name = 'מנהל משמרת' WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000d8'$$, :B2, NULL, 1);
SELECT tests.run('staff: owner demotes the manager back to agent',
  $$SELECT public.store_set_staff_role('a0000000-0000-0000-0000-0000000000d8', 'agent')$$, :B1, NULL, 1);
SELECT tests.run('staff: manager cannot promote the cashier in the table',
  $$UPDATE public.user_roles SET role = 'admin' WHERE user_id = 'a0000000-0000-0000-0000-0000000000d5'$$, :B2, 'רק בעל החנות');
SELECT tests.run('staff: the app cannot create a second owner',
  $$UPDATE public.user_roles SET is_protected = true WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000d8'$$, :B1, NULL, 1);
SELECT tests.check('staff: d4 still not protected',
  $$SELECT NOT is_protected FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000d8'$$);
-- צירוף חשבון קיים: קופאי — מנהל יכול; מנהל — רק הבעלים
SELECT tests.run('link: manager links an existing account as a cashier',
  $$SELECT public.store_link_existing_account('new1@test.local', 'cashier', 'קופאי נוסף')$$, :B2, NULL, 1);
SELECT tests.check('link: c1 joined B as a cashier',
  $$SELECT role = 'cashier' AND NOT is_protected FROM public.user_roles
     WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000c1'$$);
SELECT tests.run('link: manager cannot link an account as a manager',
  $$SELECT public.store_link_existing_account('new2@test.local', 'admin', 'מנהל')$$, :B2, 'רק בעל החנות יכול להוסיף מנהלים');
SELECT tests.run('link: cashier cannot link accounts',
  $$SELECT public.store_link_existing_account('new2@test.local', 'cashier', 'x')$$, :CA, 'רק מנהל החנות');
DELETE FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000c1';

-- ---------- חבילה ותשלום — הבעלים בלבד ----------
SELECT tests.run('billing: manager cannot request an extra admin seat',
  $$SELECT public.request_extra_admin()$$, :B2, 'רק בעל החנות');
SELECT tests.run('billing: owner can', $$SELECT public.request_extra_admin()$$, :B1, NULL, 1);
DELETE FROM public.upgrade_requests WHERE tenant_id = '70000000-0000-0000-0000-00000000000b';
SELECT tests.run('billing: manager cannot save the billing profile',
  $$INSERT INTO public.tenant_billing_profile (business_type, company_name, tax_id, address)
    VALUES ('licensed', 'חנות B בע"מ', '000000018', 'הרצל 10 תל אביב')$$, :B2, 'רק בעל החנות');
SELECT tests.run('billing: owner saves the billing profile',
  $$INSERT INTO public.tenant_billing_profile (business_type, company_name, tax_id, address)
    VALUES ('licensed', 'חנות B בע"מ', '000000018', 'הרצל 10 תל אביב')$$, :B1, NULL, 1);
SELECT tests.run('billing: manager cannot update it either',
  $$UPDATE public.tenant_billing_profile SET company_name = 'שינוי של מנהל'$$, :B2, 'רק בעל החנות');
SELECT tests.check_as('billing: platform admin (God Mode) — allowed', :P, $$SELECT public.staff_can('billing.manage')$$);
SELECT tests.server('billing: the server (service_role) — allowed',
  $$UPDATE public.tenant_addons SET updated_at = updated_at WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'$$);
DELETE FROM public.tenant_billing_profile WHERE tenant_id = '70000000-0000-0000-0000-00000000000b';

-- ---------- קופאי: הקופה המהירה ----------
SELECT tests.run('cashier: no direct access to products (cost price stays hidden)',
  $$SELECT 1 FROM public.global_products$$, :CA, NULL, 0);
SELECT tests.run('cashier: the staff catalog (no cost column)',
  $$SELECT 1 FROM public.staff_product_catalog() WHERE id IN ('9e000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000002')$$, :CA, NULL, 2);
SELECT tests.check('catalog: no cost_price column in the staff catalog',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname = 'staff_product_catalog'
                         AND 'cost_price' = ANY (p.proargnames))$$);
SELECT tests.run('cashier: staff variants', $$SELECT 1 FROM public.staff_product_variants()$$, :CA, NULL);
SELECT tests.run('cashier: customer search', $$SELECT 1 FROM public.admin_search_customers('לקוח חנות')$$, :CA, NULL, 1);
SELECT tests.run('cashier: price for a customer',
  $$SELECT 1 WHERE public.pos_unit_price('a0000000-0000-0000-0000-0000000000d7', '9e000000-0000-0000-0000-000000000001', NULL) = 100$$, :CA, NULL, 1);
SELECT tests.run('cashier: sells 2 × product 1 in store (cash, paid)',
  $$SELECT 1 FROM public.admin_create_order(NULL,
      '[{"product_id":"9e000000-0000-0000-0000-000000000001","quantity":2}]',
      '{"customer_name":"קונה בקופה","customer_phone":"0507654321","payment_method":"cash","paid":true,"note":"staff-pos-1"}')$$,
  :CA, NULL, 1);
SELECT tests.check('cashier order: POS, delivered, paid, total 200, created by the cashier',
  $$SELECT order_source = 'pos' AND status = 'delivered' AND payment_status = 'paid' AND total = 200
           AND created_by_staff_id = 'a0000000-0000-0000-0000-0000000000d5'
           AND payment_confirmed_by = 'a0000000-0000-0000-0000-0000000000d5'
      FROM public.orders WHERE note = 'staff-pos-1'$$);
SELECT tests.check('cashier order: stock 20 → 18',
  $$SELECT stock_quantity = 18 FROM public.global_products WHERE id = '9e000000-0000-0000-0000-000000000001'$$);
SELECT tests.run('cashier: the "staff" flag ends with the POS call',
  $$SELECT 1 FROM (SELECT * FROM public.admin_create_order(NULL,
      '[{"product_id":"9e000000-0000-0000-0000-000000000002","quantity":1}]',
      '{"customer_name":"קונה שני","customer_phone":"0507654322","note":"staff-pos-2"}')) o
     WHERE COALESCE(current_setting('kobi.pos_actor', true), '') = '' AND NOT public.is_staff(auth.uid())$$,
  :CA, NULL, 1);
SELECT tests.run('cashier: cannot see orders / revenue', $$SELECT 1 FROM public.orders$$, :CA, NULL, 0);
SELECT tests.run('cashier: cannot change an order',
  $$UPDATE public.orders SET status = 'cancelled' WHERE note = 'staff-pos-1'$$, :CA, NULL, 0);
SELECT tests.run('cashier: cannot create a regular order for someone',
  $$INSERT INTO public.orders (customer_id, kind) VALUES ('a0000000-0000-0000-0000-0000000000d7', 'order')$$, :CA, 'row-level security');
SELECT tests.run('cashier: no stock counts', $$SELECT 1 FROM public.stock_counts$$, :CA, NULL, 0);
SELECT tests.run('cashier: no pending products', $$SELECT 1 FROM public.pending_products$$, :CA, NULL, 0);
SELECT tests.run('cashier: no store dashboard', $$SELECT public.store_admin_seats()$$, :CA, 'אין הרשאה');
SELECT tests.run('cashier: no fulfillment list', $$SELECT 1 FROM public.fulfillment_orders()$$, :CA, 'אין לך הרשאה');
SELECT tests.run('cashier: cannot save the label size', $$SELECT public.save_barcode_label_size(58, 40)$$, :CA, 'אין לך הרשאה');
SELECT tests.run('warehouse: no POS',
  $$SELECT 1 FROM public.admin_create_order(NULL, '[{"product_id":"9e000000-0000-0000-0000-000000000001","quantity":1}]',
      '{"customer_name":"אורח","customer_phone":"0501234567"}')$$, :WH, 'אין לך הרשאה מתאימה לקופה');
SELECT tests.run('warehouse: no customer search', $$SELECT 1 FROM public.admin_search_customers('')$$, :WH, 'אין הרשאה');
SELECT tests.run('manager: POS works, attributed to the manager',
  $$SELECT 1 FROM public.admin_create_order('a0000000-0000-0000-0000-0000000000d7',
      '[{"product_id":"9e000000-0000-0000-0000-000000000002","quantity":1}]', '{"payment_method":"later","note":"staff-pos-3"}')$$,
  :B2, NULL, 1);
SELECT tests.check('manager POS order: created_by_staff_id = b2',
  $$SELECT created_by_staff_id = 'a0000000-0000-0000-0000-0000000000b2' FROM public.orders WHERE note = 'staff-pos-3'$$);

-- ---------- "נוצר ע"י" בהזמנה רגילה ----------
SELECT tests.run('attribution: manager opens a web order for the customer',
  $$INSERT INTO public.orders (id, customer_id, kind, note) VALUES ('9e300000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000d7', 'order', 'staff-web-1')$$, :B2, NULL, 1);
SELECT tests.check('attribution: web order opened by b2',
  $$SELECT order_source = 'web' AND created_by_staff_id = 'a0000000-0000-0000-0000-0000000000b2'
      FROM public.orders WHERE note = 'staff-web-1'$$);
SELECT tests.run('attribution: customer orders for himself → nobody',
  $$INSERT INTO public.orders (customer_id, kind, note, created_by_staff_id) VALUES ('a0000000-0000-0000-0000-0000000000d7', 'order', 'staff-web-2', 'a0000000-0000-0000-0000-0000000000b2')$$,
  :CU, NULL, 1);
SELECT tests.check('attribution: a value from the browser is ignored',
  $$SELECT created_by_staff_id IS NULL AND order_source = 'web' FROM public.orders WHERE note = 'staff-web-2'$$);
SELECT tests.run('attribution: cannot be changed afterwards',
  $$UPDATE public.orders SET created_by_staff_id = 'a0000000-0000-0000-0000-0000000000b1' WHERE note = 'staff-web-1'$$, :B1, NULL, 1);
SELECT tests.check('attribution: still b2',
  $$SELECT created_by_staff_id = 'a0000000-0000-0000-0000-0000000000b2' FROM public.orders WHERE note = 'staff-web-1'$$);

-- ---------- המחסנאי: מלאי, מדבקות, סטטוס משלוח ----------
SELECT tests.run('warehouse: no direct access to products', $$SELECT 1 FROM public.global_products$$, :WH, NULL, 0);
SELECT tests.run('warehouse: staff catalog for labels', $$SELECT 1 FROM public.staff_product_catalog()$$, :WH, NULL);
SELECT tests.run('warehouse: saves the label size 58×40', $$SELECT public.save_barcode_label_size(58, 40)$$, :WH, NULL, 1);
SELECT tests.check('warehouse: label size saved in store B only',
  $$SELECT (SELECT barcode_label_width_mm = 58 FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000b')
       AND (SELECT barcode_label_width_mm = 70 FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000a')$$);
SELECT tests.run('warehouse: label size out of range', $$SELECT public.save_barcode_label_size(10, 40)$$, :WH, 'גודל המדבקה');
SELECT tests.run('warehouse: cannot change other settings',
  $$UPDATE public.site_settings SET barcode_label_width_mm = 100 WHERE id = true$$, :WH, NULL, 0);
-- הזמנה למשלוח: שתי שורות, ממתינה לשליח
SELECT tests.server('fulfillment: an order waiting for the courier',
  $$INSERT INTO public.orders (id, tenant_id, customer_id, kind, note) VALUES ('9e300000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000d7', 'order', 'staff-ship-1');
    INSERT INTO public.order_items (tenant_id, order_id, product_id, quantity, unit_price)
    SELECT '70000000-0000-0000-0000-00000000000b', id, '9e000000-0000-0000-0000-000000000001', 3, 100 FROM public.orders WHERE note = 'staff-ship-1';
    INSERT INTO public.order_items (tenant_id, order_id, product_id, quantity, unit_price)
    SELECT '70000000-0000-0000-0000-00000000000b', id, '9e000000-0000-0000-0000-000000000002', 1, 50 FROM public.orders WHERE note = 'staff-ship-1';
    UPDATE public.orders SET status = 'awaiting_courier' WHERE note = 'staff-ship-1'$$);
SELECT tests.run('warehouse: sees the order in the fulfillment list (2 lines, 4 units)',
  $$SELECT 1 FROM public.fulfillment_orders() WHERE id = '9e300000-0000-0000-0000-000000000001'
       AND status = 'awaiting_courier' AND items_count = 2 AND units_count = 4 AND customer_name = 'לקוח חנות B' AND city = 'תל אביב'$$,
  :WH, NULL, 1);
SELECT tests.check('fulfillment: no money columns in the list',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname = 'fulfillment_orders'
                         AND p.proargnames && ARRAY['total','unit_price','discount_amount','shipping_price','payment_status'])$$);
SELECT tests.run('warehouse: the delivered POS sale is not in the default list',
  $$SELECT 1 FROM public.fulfillment_orders() WHERE order_source = 'pos'$$, :WH, NULL, 0);
SELECT tests.run('warehouse: cannot update orders directly',
  $$UPDATE public.orders SET status = 'shipped' WHERE note = 'staff-ship-1'$$, :WH, NULL, 0);
SELECT tests.run('warehouse: marks shipped with a tracking number',
  $$SELECT 1 WHERE (public.fulfillment_set_status('9e300000-0000-0000-0000-000000000001', 'shipped', ' RR123IL ', 'דואר ישראל') ->> 'notify')::boolean$$,
  :WH, NULL, 1);
SELECT tests.check('fulfillment: shipped, tracking trimmed, shipped_at set, logged by the worker',
  $$SELECT o.status = 'shipped' AND o.tracking_number = 'RR123IL' AND o.shipping_provider = 'דואר ישראל' AND o.shipped_at IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.order_delivery_events e WHERE e.order_id = o.id AND e.kind = 'shipped'
                         AND e.created_by = 'a0000000-0000-0000-0000-0000000000d6')
      FROM public.orders o WHERE o.note = 'staff-ship-1'$$);
SELECT tests.run('warehouse: delivered',
  $$SELECT public.fulfillment_set_status('9e300000-0000-0000-0000-000000000001', 'delivered')$$, :WH, NULL, 1);
SELECT tests.run('warehouse: cannot cancel',
  $$SELECT public.fulfillment_set_status('9e300000-0000-0000-0000-000000000001', 'cancelled')$$, :WH, 'אי אפשר להעביר');
SELECT tests.run('warehouse: undo delivered → shipped (no new email)',
  $$SELECT 1 WHERE NOT (public.fulfillment_set_status('9e300000-0000-0000-0000-000000000001', 'shipped') ->> 'notify')::boolean$$,
  :WH, NULL, 1);
SELECT tests.run('warehouse: update only the tracking number while shipped',
  $$SELECT public.fulfillment_set_status('9e300000-0000-0000-0000-000000000001', 'shipped', 'RR999IL', NULL)$$, :WH, NULL, 1);
SELECT tests.check('fulfillment: tracking updated, provider kept',
  $$SELECT tracking_number = 'RR999IL' AND shipping_provider = 'דואר ישראל' FROM public.orders WHERE note = 'staff-ship-1'$$);
SELECT tests.run('warehouse: a new (pending) order cannot be marked shipped here',
  $$SELECT public.fulfillment_set_status('9e300000-0000-0000-0000-000000000002', 'shipped')$$, :WH, 'אי אפשר להעביר');
SELECT tests.run('warehouse: the 3 delivered POS sales appear with "include delivered"',
  $$SELECT 1 FROM public.fulfillment_orders(true) WHERE order_source = 'pos' AND status = 'delivered'$$, :WH, NULL, 3);
SELECT tests.run('warehouse: store A owner cannot use store B fulfillment (on B site)',
  $$SELECT 1 FROM public.fulfillment_orders()$$, :OA, 'אין לך הרשאה');
SELECT tests.run('customer: cannot use fulfillment',
  $$SELECT public.fulfillment_set_status('9e300000-0000-0000-0000-000000000001', 'delivered')$$, :CU, 'אין לך הרשאה');
SELECT tests.run('customer: still cannot set tracking on own order',
  $$UPDATE public.orders SET tracking_number = 'X1' WHERE note = 'staff-web-2'$$, :CU, NULL, 0);

-- ---------- עובד שעזב: ההזמנות נשארות, בלי "נוצר ע"י" ----------
SELECT tests.server('cleanup: the cashier leaves the store',
  $$DELETE FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000d5'$$);
SELECT tests.check('cashier removed: the POS order stays, creator NULL (no dangling reference)',
  $$SELECT created_by_staff_id IS NULL AND order_source = 'pos' FROM public.orders WHERE note = 'staff-pos-1'$$);

-- ניקוי: חזרה למצב ה-fixtures
SELECT set_config('request.headers', '', false);
DELETE FROM public.orders WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND note LIKE 'staff-%';
DELETE FROM public.global_products WHERE id IN ('9e000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000002');
DELETE FROM public.customer_profiles WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000d7';
DELETE FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'
   AND user_id IN ('a0000000-0000-0000-0000-0000000000d5', 'a0000000-0000-0000-0000-0000000000d6',
                   'a0000000-0000-0000-0000-0000000000d7', 'a0000000-0000-0000-0000-0000000000d8');
UPDATE public.site_settings SET barcode_label_width_mm = 70, barcode_label_height_mm = 40
 WHERE tenant_id = '70000000-0000-0000-0000-00000000000b';

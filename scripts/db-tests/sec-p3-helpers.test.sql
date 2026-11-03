-- ============================================================
-- SEC P3 (20261106190000_sec_p3_helpers_quote_email.sql) — עוזרים שחושפים מידע, ואימייל בשורת התפקיד.
-- (L4 — קוד קופון בהצעת מחיר רק דרך השרת: hospitality-booking / hospitality-open-dates;
--  order_coupon_verify: serials.)
-- ============================================================
-- L3: עוזרים שנפתחו לכל משתמש מחובר / לגולש
SELECT tests.check('SEC-L3: product_serial_gap and staff_display_name are server-only',
  $$SELECT NOT has_function_privilege('authenticated', 'public.product_serial_gap(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.product_serial_gap(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.staff_display_name(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.staff_display_name(uuid)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.product_serial_gap(uuid)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.staff_display_name(uuid)', 'EXECUTE')$$);
SELECT tests.run('SEC-L3: a signed-in customer cannot read stock through product_serial_gap',
  $$SELECT public.product_serial_gap('9f100000-0000-0000-0000-00000000000b')$$, 'a0000000-0000-0000-0000-00000000000c', 'permission denied');
SELECT tests.run('SEC-L3: … nor names / usernames of other members through staff_display_name',
  $$SELECT public.staff_display_name('a0000000-0000-0000-0000-0000000000b1')$$, 'a0000000-0000-0000-0000-00000000000c', 'permission denied');
SELECT tests.check('SEC-L3: the browser''s staff_display_names (staff only, no email) is unchanged',
  $$SELECT has_function_privilege('authenticated', 'public.staff_display_names(uuid[])', 'EXECUTE')$$);
SELECT tests.check('SEC-L3: can_pick / is_warehouse — not for visitors; signed-in (warehouse RLS) as before',
  $$SELECT NOT has_function_privilege('anon', 'public.can_pick(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.is_warehouse(uuid)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'public.can_pick(uuid)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'public.is_warehouse(uuid)', 'EXECUTE')$$);
SELECT tests.run('SEC-L3: a visitor cannot ask whether an account is a picker',
  $$SELECT public.can_pick('a0000000-0000-0000-0000-0000000000b1')$$, NULL, 'permission denied');

-- L6: שורת לקוח שהמשתמש מוסיף לעצמו (הרשמה מהדפדפן) — המייל של החשבון, לא מה שנשלח
INSERT INTO auth.users (id, email) VALUES ('a0000000-0000-0000-0000-0000000000e9', ' Real.Person@Example.com ');
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
SELECT tests.run('SEC-L6: a new account registers itself as a customer, sending someone else''s email',
  $$INSERT INTO public.user_roles (user_id, email, role, is_approved, is_blocked)
    VALUES ('a0000000-0000-0000-0000-0000000000e9', 'victim@example.com', 'customer', false, false)$$,
  'a0000000-0000-0000-0000-0000000000e9', NULL, 1);
SELECT tests.check('SEC-L6: … the row has the account''s own email (and the username comes from it)',
  $$SELECT email = 'real.person@example.com' AND username NOT LIKE 'victim%'
      FROM public.user_roles WHERE user_id = 'a0000000-0000-0000-0000-0000000000e9'$$);
SELECT tests.check('SEC-L6: … so the email cannot be squatted (no row with it)',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE email = 'victim@example.com')$$);
-- השרת / הצוות שמוסיפים חשבון אחר — כמו קודם
INSERT INTO auth.users (id, email) VALUES ('a0000000-0000-0000-0000-0000000000ea', 'staff.made@example.com');
INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved, is_blocked)
VALUES ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000ea', 'Typed.By.Staff@Example.com', 'customer', true, false);
SELECT tests.check('SEC-L6: a row the server adds keeps the given email (normalized, as before)',
  $$SELECT email = 'typed.by.staff@example.com' FROM public.user_roles WHERE user_id = 'a0000000-0000-0000-0000-0000000000ea'$$);
SELECT set_config('request.headers', '', false);

-- ניקוי
DELETE FROM public.user_roles WHERE user_id IN ('a0000000-0000-0000-0000-0000000000e9', 'a0000000-0000-0000-0000-0000000000ea');
DELETE FROM auth.users WHERE id IN ('a0000000-0000-0000-0000-0000000000e9', 'a0000000-0000-0000-0000-0000000000ea');

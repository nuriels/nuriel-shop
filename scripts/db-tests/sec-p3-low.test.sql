-- ============================================================
-- SEC P3 (20261106180000_sec_p3_low_findings.sql) — הקשחות נקודתיות
-- ============================================================
-- L2: מיפוי שם-משתמש → אימייל רק לשרת
SELECT tests.check('SEC-L2: resolve_login_email is not callable by visitors or signed-in users (server only)',
  $$SELECT NOT has_function_privilege('authenticated', 'public.resolve_login_email(text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.resolve_login_email(text)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.resolve_login_email(text)', 'EXECUTE')$$);
SELECT tests.run('SEC-L2: a signed-in customer cannot map a username to an email',
  $$SELECT public.resolve_login_email('someone')$$, 'a0000000-0000-0000-0000-00000000000c', 'permission denied');

-- L5: אף אחד לא מוסיף בקשות איפוס ישירות (הצפת מנהלים)
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
SELECT tests.run('SEC-L5: a visitor cannot add password-reset requests to a store',
  $$INSERT INTO public.password_reset_requests (tenant_id, email, status)
    VALUES ('70000000-0000-0000-0000-00000000000a', 'spam@example.com', 'new')$$, NULL, 'row-level security');
SELECT tests.run('SEC-L5: … nor a signed-in customer',
  $$INSERT INTO public.password_reset_requests (tenant_id, email, status)
    VALUES ('70000000-0000-0000-0000-00000000000a', 'spam@example.com', 'new')$$,
  'a0000000-0000-0000-0000-00000000000c', 'row-level security');
SELECT set_config('request.headers', '', false);
SELECT tests.check('SEC-L5: nothing was added',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.password_reset_requests WHERE email = 'spam@example.com')$$);
SELECT tests.check('SEC-L5: the platform admin policies (read / update / delete) are untouched',
  $$SELECT count(*) = 3 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'password_reset_requests'
       AND policyname IN ('super admin reads resets', 'super admin updates resets', 'super admin deletes resets')$$);

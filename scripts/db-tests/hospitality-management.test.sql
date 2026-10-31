-- ============================================================
-- Hospitality: management-area foundation (Hospitality Stage 2a —
-- 20261101150000_hosp_management_foundation.sql)
--   • the management flag (separate from the public-website flag)
--   • the Hospitality manager-seat rule (plans, extra seats, downgrade, inactive,
--     platform admins exempt) and the unchanged Ecommerce rule for stores
--   • the outbox is no longer readable by staff; safe email status
--   • guest export / anonymise: owner only
--   • management_context(): who may open the management area and what it returns
-- Parallel seat additions: scripts/db-tests/hospitality/concurrency/run.sh (scenario 23)
-- ============================================================
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set OWNER_M '''a0000000-0000-0000-0000-0000000004a1'''
\set MGR1 '''a0000000-0000-0000-0000-0000000004a2'''
\set MGR2 '''a0000000-0000-0000-0000-0000000004a3'''
\set MGR3 '''a0000000-0000-0000-0000-0000000004a4'''
\set MGR4 '''a0000000-0000-0000-0000-0000000004a5'''
\set MGR5 '''a0000000-0000-0000-0000-0000000004a6'''
\set MGR6 '''a0000000-0000-0000-0000-0000000004a7'''
\set MGR7 '''a0000000-0000-0000-0000-0000000004a8'''
\set BLOCKED_M '''a0000000-0000-0000-0000-0000000004a9'''
\set OWNER_N '''a0000000-0000-0000-0000-0000000004b1'''
\set MGR_N '''a0000000-0000-0000-0000-0000000004b2'''
\set GUEST_M '''a0000000-0000-0000-0000-0000000004c1'''
\set SHOP_OWNER '''a0000000-0000-0000-0000-0000000004e1'''
\set SHOP_ADM2 '''a0000000-0000-0000-0000-0000000004e2'''
\set SHOP_ADM3 '''a0000000-0000-0000-0000-0000000004e3'''
\set SHOP_ADM4 '''a0000000-0000-0000-0000-0000000004e4'''
\set SHOP '''72a00000-0000-0000-0000-0000000000e1'''

CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$ SELECT current_date + _n $$;
CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', CASE WHEN _site IS NULL THEN '' ELSE json_build_object('x-tenant-id', _site)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), true);
  EXECUTE 'SET LOCAL ROLE ' || CASE WHEN _uid IS NULL THEN 'anon' ELSE 'authenticated' END;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(_name text, _sql text, _pattern text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE err text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, err IS NOT NULL AND err ILIKE '%' || _pattern || '%', COALESCE('ERROR: ' || err, 'no error'));
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.after(_name text, _action text, _check text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE r jsonb; v boolean; err text;
BEGIN
  BEGIN
    EXECUTE _action INTO r;
    EXECUTE _check INTO v USING r;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, err IS NULL AND COALESCE(v, false),
          COALESCE('ERROR: ' || err, 'value=' || COALESCE(v::text, 'null') || ' result=' || left(COALESCE(r::text, 'null'), 300)));
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
-- a manager row (as the database owner: no platform actor)
CREATE OR REPLACE FUNCTION pg_temp.add_admin(_site uuid, _uid uuid, _name text) RETURNS jsonb LANGUAGE sql AS $f$
  INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
  VALUES (_site, _uid, _name || '@test.local', _name, 'admin', true) RETURNING to_jsonb(true);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.ctx(_site uuid, _uid uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site::text, _uid, 'SELECT hospitality.management_context()');
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-0000000004a1', 'm2a.owner.m@test.local', now()),
  ('a0000000-0000-0000-0000-0000000004a2', 'm2a.mgr1@test.local', now()),
  ('a0000000-0000-0000-0000-0000000004a3', 'm2a.mgr2@test.local', now()),
  ('a0000000-0000-0000-0000-0000000004a4', 'm2a.mgr3@test.local', now()),
  ('a0000000-0000-0000-0000-0000000004a5', 'm2a.mgr4@test.local', now()),
  ('a0000000-0000-0000-0000-0000000004a6', 'm2a.mgr5@test.local', now()),
  ('a0000000-0000-0000-0000-0000000004a7', 'm2a.mgr6@test.local', now()),
  ('a0000000-0000-0000-0000-0000000004a8', 'm2a.mgr7@test.local', now()),
  ('a0000000-0000-0000-0000-0000000004a9', 'm2a.blocked@test.local', now()),
  ('a0000000-0000-0000-0000-0000000004b1', 'm2a.owner.n@test.local', now()),
  ('a0000000-0000-0000-0000-0000000004b2', 'm2a.mgr.n@test.local', now()),
  ('a0000000-0000-0000-0000-0000000004c1', 'm2a.guest@test.local', now()),
  ('a0000000-0000-0000-0000-0000000004e1', 'm2a.shop.owner@test.local', now()),
  ('a0000000-0000-0000-0000-0000000004e2', 'm2a.shop.adm2@test.local', now()),
  ('a0000000-0000-0000-0000-0000000004e3', 'm2a.shop.adm3@test.local', now()),
  ('a0000000-0000-0000-0000-0000000004e4', 'm2a.shop.adm4@test.local', now())
ON CONFLICT DO NOTHING;

SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('h2a-m', 'אירוח M'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('h2a-n', 'אירוח N'))$$) IS NOT NULL AS ok \gset
SELECT id AS sm FROM public.tenants WHERE slug = 'h2a-m' \gset
SELECT id AS sn FROM public.tenants WHERE slug = 'h2a-n' \gset
SELECT pg_temp.add_admin(:'sm', :OWNER_M, 'm2a_owner_m') IS NOT NULL AS ok \gset
SELECT pg_temp.add_admin(:'sm', :MGR1, 'm2a_mgr1') IS NOT NULL AS ok \gset
SELECT pg_temp.add_admin(:'sn', :OWNER_N, 'm2a_owner_n') IS NOT NULL AS ok \gset
SELECT pg_temp.add_admin(:'sn', :MGR_N, 'm2a_mgr_n') IS NOT NULL AS ok \gset
-- an Ecommerce store (the store seed gives it the Ecommerce trial: 3 admins)
INSERT INTO public.tenants (id, slug, name) VALUES (:SHOP, 'h2a-shop', 'חנות 2a');
SELECT pg_temp.add_admin(:SHOP, :SHOP_OWNER, 'm2a_shop_owner') IS NOT NULL AS ok \gset
-- flags: M — database + management + booking; N — database only (management off)
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(
       public.platform_set_flag('hospitality_backend_enabled', true)
   AND public.platform_set_flag('hospitality_management_enabled', true)
   AND public.platform_set_flag('hospitality_booking_enabled', true)
   AND public.platform_set_flag('hospitality_backend_enabled', true, %1$L)
   AND public.platform_set_flag('hospitality_management_enabled', true, %1$L)
   AND public.platform_set_flag('hospitality_booking_enabled', true, %1$L)
   AND public.platform_set_flag('hospitality_backend_enabled', true, %2$L))$$, :'sm', :'sn')) IS NOT NULL AS ok \gset

-- ============================================================
-- 1. Structure
-- ============================================================
SELECT tests.check('flag: hospitality_management_enabled is registered and off by default',
  $$SELECT EXISTS (SELECT 1 FROM public.platform_feature_flags WHERE key = 'hospitality_management_enabled')
       AND NOT public.platform_feature_enabled('hospitality_management_enabled',
                 (SELECT id FROM public.tenants WHERE slug = 'h2a-n'))$$);
SELECT tests.check('flag: the management and public-website flags are independent (M: management on, website off)',
  format($$SELECT public.platform_feature_enabled('hospitality_management_enabled', %1$L)
             AND NOT public.platform_feature_enabled('hospitality_frontend_enabled', %1$L)$$, :'sm'));
SELECT tests.check('seats: approved values per plan (trial 3, basic 2, pro 5, enterprise unlimited)',
  $$SELECT (SELECT jsonb_object_agg(code, max_managers) FROM hospitality.plans
             WHERE code IN ('trial', 'basic', 'pro', 'enterprise'))
           = '{"trial": 3, "basic": 2, "pro": 5, "enterprise": null}'::jsonb$$);
SELECT tests.check('seats: the Hospitality guard is a trigger on user_roles, next to the unchanged Ecommerce guard',
  $$SELECT count(*) = 2 FROM pg_trigger WHERE tgrelid = 'public.user_roles'::regclass
     AND tgname IN ('hospitality_admin_seat_guard', 'user_roles_admin_seat_guard')$$);
SELECT tests.check('seats: the Ecommerce guard keeps its rule and only skips non-Ecommerce sites',
  $$SELECT prosrc LIKE '%tenant_admin_limit(NEW.tenant_id)%' AND prosrc LIKE '%site_type <> ''ecommerce''%'
      FROM pg_proc WHERE oid = 'public.user_roles_admin_seat_guard()'::regprocedure$$);
SELECT tests.check('outbox: staff (authenticated) have no privilege at all on the outbox table',
  $$SELECT NOT has_table_privilege('authenticated', 'hospitality.notifications', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'hospitality.notifications', 'INSERT')
       AND NOT has_table_privilege('authenticated', 'hospitality.notifications', 'UPDATE')
       AND NOT has_table_privilege('authenticated', 'hospitality.notifications', 'DELETE')$$);
SELECT tests.check('api: new staff functions are not callable by anon; helpers not callable through the API',
  $$SELECT NOT has_function_privilege('anon', 'hospitality.management_context()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.staff_email_status(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.admin_set_extra_managers(uuid, integer)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.mask_email(text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._managers_used(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.user_roles_seat_guard()', 'EXECUTE')$$);
SELECT tests.check('mask: emails are masked for display',
  $$SELECT hospitality.mask_email('dana@gmail.com') = 'd•••@gmail.com' AND hospitality.mask_email('x') IS NULL
       AND hospitality.mask_email(NULL) IS NULL$$);

-- ============================================================
-- 2. management_context(): who may open the management area
-- ============================================================
SELECT pg_temp.after('context: the owner gets role, every permission, full plan data and the checklist',
  format($$SELECT pg_temp.ctx(%L, %L)$$, :'sm', :OWNER_M),
  $$SELECT $1 ->> 'role' = 'owner'
       AND (SELECT bool_and(v::boolean) FROM jsonb_each_text($1 -> 'permissions') e(k, v))
       AND jsonb_typeof($1 -> 'permissions') = 'object' AND ($1 -> 'permissions') ? 'guests.privacy'
       AND ($1 -> 'entitlements' ->> 'max_managers')::integer = 3
       AND ($1 -> 'entitlements' ->> 'managers_used')::integer = 2
       AND $1 -> 'entitlements' ->> 'plan' = 'trial'
       AND $1 -> 'flags' = '{"management": true, "frontend": false, "booking": true}'::jsonb
       AND $1 -> 'business' ->> 'name' = 'אירוח M' AND $1 -> 'business' ->> 'timezone' = 'Asia/Jerusalem'
       AND $1 -> 'site' ->> 'slug' = 'h2a-m'
       AND $1 -> 'checklist' = '{"business": false, "units": false, "photos": false, "prices": false, "policy": false}'::jsonb$$);
SELECT pg_temp.after('context: a manager gets no team / plan / guest-privacy permission and no plan details',
  format($$SELECT pg_temp.ctx(%L, %L)$$, :'sm', :MGR1),
  $$SELECT $1 ->> 'role' = 'manager'
       AND NOT ($1 -> 'permissions' ->> 'staff.managers')::boolean
       AND NOT ($1 -> 'permissions' ->> 'billing.manage')::boolean
       AND NOT ($1 -> 'permissions' ->> 'guests.privacy')::boolean
       AND ($1 -> 'permissions' ->> 'bookings')::boolean AND ($1 -> 'permissions' ->> 'guests')::boolean
       AND NOT ($1 -> 'entitlements') ? 'plan' AND NOT ($1 -> 'entitlements') ? 'max_managers'
       AND ($1 -> 'entitlements') ? 'units_used' AND ($1 -> 'entitlements') ? 'active'$$);
SELECT pg_temp.expect_error('context: management flag off for the site → refused (site N: database on, management off)',
  format($$SELECT pg_temp.ctx(%L, %L)$$, :'sn', :OWNER_N), 'אזור הניהול אינו פעיל');
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(public.platform_set_flag('hospitality_backend_enabled', false, %L))$$, :'sm')) IS NOT NULL AS ok \gset
SELECT pg_temp.expect_error('context: database flag off for the site → refused',
  format($$SELECT pg_temp.ctx(%L, %L)$$, :'sm', :OWNER_M), 'אזור הניהול אינו פעיל');
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(public.platform_set_flag('hospitality_backend_enabled', true, %L))$$, :'sm')) IS NOT NULL AS ok \gset
SELECT pg_temp.expect_error('context: the owner of another Hospitality site → refused',
  format($$SELECT pg_temp.ctx(%L, %L)$$, :'sm', :OWNER_N), 'אין לחשבון הזה הרשאת ניהול');
SELECT pg_temp.expect_error('context: an Ecommerce store owner on the Hospitality site → refused',
  format($$SELECT pg_temp.ctx(%L, %L)$$, :'sm', :SHOP_OWNER), 'אין לחשבון הזה הרשאת ניהול');
SELECT pg_temp.expect_error('context: a signed-in guest (no membership) → refused',
  format($$SELECT pg_temp.ctx(%L, %L)$$, :'sm', :GUEST_M), 'אין לחשבון הזה הרשאת ניהול');
SELECT pg_temp.expect_error('context: anonymous → not callable',
  format($$SELECT pg_temp.ctx(%L, NULL)$$, :'sm'), 'permission denied');
SELECT pg_temp.expect_error('context: an Ecommerce store (its own owner) → refused',
  format($$SELECT pg_temp.ctx(%L, %L)$$, :SHOP, :SHOP_OWNER), 'אין לחשבון הזה הרשאת ניהול');
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(true) FROM (SELECT hospitality.admin_set_extra_managers(%L, 1)) x$$, :'sm')) IS NOT NULL AS ok \gset
SELECT pg_temp.add_admin(:'sm', :BLOCKED_M, 'm2a_blocked') IS NOT NULL AS ok \gset
UPDATE public.user_roles SET is_blocked = true WHERE tenant_id = :'sm' AND user_id = :BLOCKED_M;
SELECT pg_temp.expect_error('context: a blocked manager → refused',
  format($$SELECT pg_temp.ctx(%L, %L)$$, :'sm', :BLOCKED_M), 'אין לחשבון הזה הרשאת ניהול');
DELETE FROM public.user_roles WHERE tenant_id = :'sm' AND user_id = :BLOCKED_M;
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(true) FROM (SELECT hospitality.admin_set_extra_managers(%L, 0)) x$$, :'sm')) IS NOT NULL AS ok \gset

-- the setup checklist follows the data
UPDATE hospitality.settings SET contact_phone = '050-1234567' WHERE tenant_id = :'sm';
INSERT INTO hospitality.properties (id, tenant_id, name, slug, status)
VALUES ('72a20000-0000-0000-0000-0000000000a1', :'sm', 'מתחם M', 'm', 'active');
INSERT INTO hospitality.units (id, tenant_id, property_id, name, slug, base_price)
VALUES ('72a30000-0000-0000-0000-0000000000a1', :'sm', '72a20000-0000-0000-0000-0000000000a1', 'צימר M', 'zm', 0);
SELECT pg_temp.after('checklist: business details and a unit are done; prices, photos and policy are not yet',
  format($$SELECT pg_temp.ctx(%L, %L)$$, :'sm', :OWNER_M),
  $$SELECT $1 -> 'checklist' = '{"business": true, "units": true, "photos": false, "prices": false, "policy": false}'::jsonb$$);
UPDATE hospitality.units SET base_price = 650 WHERE id = '72a30000-0000-0000-0000-0000000000a1';
INSERT INTO hospitality.media (tenant_id, owner_kind, kind, storage_path)
VALUES (:'sm', 'site', 'image', :'sm' || '/cover.webp');
UPDATE hospitality.policies SET free_cancel_days = 10 WHERE tenant_id = :'sm' AND is_default;
SELECT pg_temp.after('checklist: all five steps done after prices, a photo and a reviewed policy',
  format($$SELECT pg_temp.ctx(%L, %L)$$, :'sm', :OWNER_M),
  $$SELECT $1 -> 'checklist' = '{"business": true, "units": true, "photos": true, "prices": true, "policy": true}'::jsonb$$);

-- ============================================================
-- 3. Email outbox: no direct read, safe status
-- ============================================================
\set UM '''72a30000-0000-0000-0000-0000000000a1'''
SELECT pg_temp.call(:'sm', NULL, format(
  $$SELECT hospitality.request_booking(_unit_id => %1$L, _check_in => %2$L, _check_out => %3$L, _full_name => 'דנה אורחת',
     _email => 'dana.guest@example.com', _phone => '0521234567', _idempotency_key => 'm2a-key-000001',
     _policy_accepted => true,
     _policy_hash => (SELECT hospitality.quote(%1$L, %2$L, %3$L, 2, 0, NULL) ->> 'policy_hash'))$$,
  :UM, pg_temp.d(30), pg_temp.d(32))) ->> 'booking_id' AS bm \gset
SELECT tests.check('outbox: the guest request queued emails, one of them with the guest manage-link token',
  format($$SELECT count(*) >= 2 AND bool_or(payload ? 'manage_token')
             FROM hospitality.notifications WHERE booking_id = %L$$, :'bm'));
SELECT pg_temp.expect_error('outbox: the owner cannot read the outbox table directly',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT to_jsonb(count(*)) FROM hospitality.notifications')$$, :'sm', :OWNER_M),
  'permission denied');
SELECT pg_temp.expect_error('outbox: a manager cannot read the outbox table directly',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT to_jsonb(array_agg(payload)) FROM hospitality.notifications')$$, :'sm', :MGR1),
  'permission denied');
SELECT pg_temp.after('outbox: the safe status has every email of the booking, masked, without payload, token or provider error',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.staff_email_status(%%L)', %L))$$, :'sm', :OWNER_M, :'bm'),
  format($$SELECT jsonb_array_length($1) = (SELECT count(*) FROM hospitality.notifications WHERE booking_id = %L)
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements($1) e
                              WHERE e ? 'payload' OR e ? 'manage_token' OR e ? 'last_error' OR e ? 'recipient_email'
                                 OR e::text LIKE '%%dana.guest@example.com%%')
             AND EXISTS (SELECT 1 FROM jsonb_array_elements($1) e
                          WHERE e ->> 'recipient' = 'd•••@example.com' AND e ->> 'status' = 'queued'
                            AND e ->> 'recipient_kind' = 'guest')$$, :'bm'));
SELECT pg_temp.after('outbox: a manager (bookings permission) may see the safe status',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.staff_email_status(%%L)', %L))$$, :'sm', :MGR1, :'bm'),
  $$SELECT jsonb_array_length($1) >= 2$$);
SELECT pg_temp.expect_error('outbox: the owner of another site cannot see this booking''s emails',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.staff_email_status(%%L)', %L))$$, :'sn', :OWNER_N, :'bm'),
  'ההזמנה לא נמצאה');
SELECT pg_temp.expect_error('outbox: a signed-in guest cannot use the staff status',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.staff_email_status(%%L)', %L))$$, :'sm', :GUEST_M, :'bm'),
  'אין הרשאה');
SELECT pg_temp.expect_error('outbox: anonymous cannot use the staff status',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.staff_email_status(%%L)', %L))$$, :'sm', :'bm'),
  'permission denied');
SELECT tests.check('outbox: the token is still removed from the payload once an email is sent (Stage 1 rule kept)',
  format($$WITH c AS (SELECT * FROM hospitality.claim_notifications(50)),
              m AS (SELECT hospitality.mark_notification(c.id, true, NULL, 'msg-' || c.id) FROM c)
           SELECT (SELECT count(*) FROM m) >= 2$$));
SELECT tests.check('outbox: after sending, no row of the booking holds the token',
  format($$SELECT NOT EXISTS (SELECT 1 FROM hospitality.notifications WHERE booking_id = %L AND payload ? 'manage_token')$$, :'bm'));

-- ============================================================
-- 4. Guest privacy: export / anonymise — owner only
-- ============================================================
SELECT guest_id AS gm FROM hospitality.bookings WHERE id = :'bm' \gset
SELECT pg_temp.expect_error('privacy: a manager cannot export a guest',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.export_guest(%%L)', %L))$$, :'sm', :MGR1, :'gm'),
  'אין הרשאה');
SELECT pg_temp.expect_error('privacy: a manager cannot anonymise a guest',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.anonymize_guest(%%L))', %L))$$, :'sm', :MGR1, :'gm'),
  'אין הרשאה');
SELECT tests.check('privacy: the refused anonymisation changed nothing',
  format($$SELECT anonymized_at IS NULL AND email IS NOT NULL FROM hospitality.guests WHERE id = %L$$, :'gm'));
SELECT pg_temp.after('privacy: the owner exports the guest',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.export_guest(%%L)', %L))$$, :'sm', :OWNER_M, :'gm'),
  $$SELECT $1 -> 'guest' ->> 'full_name' = 'דנה אורחת' AND jsonb_array_length($1 -> 'bookings') = 1$$);
SELECT pg_temp.expect_error('privacy: the owner of another site cannot export this guest',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.export_guest(%%L)', %L))$$, :'sn', :OWNER_N, :'gm'),
  'האורח לא נמצא');
-- a guest with an active booking cannot be erased (Stage 1 rule): the owner declines it first
SELECT pg_temp.call(:'sm', :OWNER_M, format($$SELECT hospitality.decline_booking(%L, 'בדיקה', NULL)$$, :'bm')) IS NOT NULL AS ok \gset
SELECT pg_temp.after('privacy: the owner anonymises the guest',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.anonymize_guest(%%L))', %L))$$, :'sm', :OWNER_M, :'gm'),
  format($$SELECT $1 = 'true'::jsonb AND (SELECT anonymized_at IS NOT NULL AND email IS NULL FROM hospitality.guests WHERE id = %L)$$, :'gm'));
SELECT pg_temp.after('privacy: a manager still reads guests for daily work (guests permission unchanged)',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT to_jsonb(count(*)) FROM hospitality.guests')$$, :'sm', :MGR1),
  $$SELECT ($1 #>> '{}')::integer >= 1$$);

-- ============================================================
-- 5. Manager seats (site M: owner + 1 manager, trial = 3)
-- ============================================================
SELECT pg_temp.after('seats: entitlements show the limit and the seats in use (the owner counts)',
  format($$SELECT hospitality.entitlements(%L)$$, :'sm'),
  $$SELECT ($1 ->> 'max_managers')::integer = 3 AND ($1 ->> 'managers_used')::integer = 2
       AND ($1 ->> 'extra_managers')::integer = 0$$);
SELECT pg_temp.after('seats: a third admin fits the trial limit',
  format($$SELECT pg_temp.add_admin(%L, %L, 'm2a_mgr2')$$, :'sm', :MGR2), $$SELECT $1 = 'true'::jsonb$$);
SELECT pg_temp.expect_error('seats: a fourth admin is refused at the trial limit (3)',
  format($$SELECT pg_temp.add_admin(%L, %L, 'm2a_mgr3')$$, :'sm', :MGR3), 'מגבלת המנהלים בחבילה (3)');
SELECT tests.check('seats: the refused admin was not added',
  format($$SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE tenant_id = %L AND user_id = %L)$$, :'sm', :MGR3));
SELECT pg_temp.expect_error('seats: only a platform admin assigns extra seats',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.admin_set_extra_managers(%%L, 5)', %L))$$, :'sm', :OWNER_M, :'sm'),
  'מנהל');
SELECT pg_temp.after('seats: the platform admin assigns one extra seat',
  format($$SELECT pg_temp.as_platform(format('SELECT hospitality.admin_set_extra_managers(%%L, 1)', %L))$$, :'sm'),
  $$SELECT ($1 ->> 'max_managers')::integer = 4 AND ($1 ->> 'extra_managers')::integer = 1$$);
SELECT tests.check('seats: the extra-seat assignment is in the platform audit log',
  format($$SELECT EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'hospitality_extra_managers')$$, :'sm'));
SELECT pg_temp.after('seats: with the extra seat a fourth admin fits',
  format($$SELECT pg_temp.add_admin(%L, %L, 'm2a_mgr3')$$, :'sm', :MGR3), $$SELECT $1 = 'true'::jsonb$$);
SELECT pg_temp.expect_error('seats: a fifth admin is refused (3 + 1)',
  format($$SELECT pg_temp.add_admin(%L, %L, 'm2a_mgr4')$$, :'sm', :MGR4), 'מגבלת המנהלים בחבילה (4)');
SELECT pg_temp.expect_error('seats: moving an admin from another site into a full site is refused too',
  format($$UPDATE public.user_roles SET tenant_id = %L WHERE tenant_id = %L AND user_id = %L$$, :'sm', :'sn', :MGR_N),
  'מגבלת המנהלים');

-- downgrade: basic (2) + 1 extra = 3 < 4 in use
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_subscription(%L, 'basic', 'active')$$, :'sm')) IS NOT NULL AS ok \gset
SELECT tests.check('seats: a downgrade keeps every existing manager (4 in use, limit 3)',
  format($$SELECT (hospitality.entitlements(%1$L) ->> 'max_managers')::integer = 3
             AND (SELECT count(*) FROM public.user_roles WHERE tenant_id = %1$L AND role = 'admin') = 4$$, :'sm'));
SELECT pg_temp.expect_error('seats: after the downgrade no admin can be added while over the limit',
  format($$SELECT pg_temp.add_admin(%L, %L, 'm2a_mgr4')$$, :'sm', :MGR4), 'מגבלת המנהלים בחבילה (3)');
DELETE FROM public.user_roles WHERE tenant_id = :'sm' AND user_id IN (:MGR2, :MGR3);
SELECT pg_temp.after('seats: once back under the limit an admin can be added again',
  format($$SELECT pg_temp.add_admin(%L, %L, 'm2a_mgr4')$$, :'sm', :MGR4), $$SELECT $1 = 'true'::jsonb$$);
SELECT pg_temp.expect_error('seats: … and the limit holds again',
  format($$SELECT pg_temp.add_admin(%L, %L, 'm2a_mgr5')$$, :'sm', :MGR5), 'מגבלת המנהלים בחבילה (3)');

-- upgrade: pro (5) + 1 = 6 — more than the Ecommerce rule (3) would ever allow on this site
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_subscription(%L, 'pro', 'active')$$, :'sm')) IS NOT NULL AS ok \gset
SELECT pg_temp.add_admin(:'sm', :MGR2, 'm2a_mgr2') IS NOT NULL AS ok \gset
SELECT pg_temp.add_admin(:'sm', :MGR3, 'm2a_mgr3') IS NOT NULL AS ok \gset
SELECT pg_temp.after('seats: the Hospitality plan decides, not the Ecommerce rule (6 admins on pro + 1)',
  format($$SELECT pg_temp.add_admin(%L, %L, 'm2a_mgr5')$$, :'sm', :MGR5),
  format($$SELECT (SELECT count(*) FROM public.user_roles WHERE tenant_id = %L AND role = 'admin') = 6$$, :'sm'));
SELECT pg_temp.expect_error('seats: the seventh admin is refused on pro + 1',
  format($$SELECT pg_temp.add_admin(%L, %L, 'm2a_mgr6')$$, :'sm', :MGR6), 'מגבלת המנהלים בחבילה (6)');

-- platform admins are exempt (as actor)
SELECT pg_temp.after('seats: a platform admin may add an admin beyond the limit',
  format($$SELECT pg_temp.as_platform(format('SELECT pg_temp.add_admin(%%L, %%L, %%L)', %L, %L, 'm2a_mgr6'))$$, :'sm', :MGR6),
  $$SELECT $1 = 'true'::jsonb$$);
SELECT tests.check('seats: platform admins are never counted as seats',
  format($$SELECT hospitality._managers_used(%1$L) = (SELECT count(*) FROM public.user_roles ur
             WHERE ur.tenant_id = %1$L AND ur.role = 'admin' AND NOT public.is_platform_admin(ur.user_id))$$, :'sm'));

-- enterprise: unlimited
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_subscription(%L, 'enterprise', 'active')$$, :'sm')) IS NOT NULL AS ok \gset
SELECT pg_temp.after('seats: enterprise is unlimited',
  format($$SELECT pg_temp.add_admin(%L, %L, 'm2a_mgr7')$$, :'sm', :MGR7),
  format($$SELECT (hospitality.entitlements(%L) ->> 'max_managers') IS NULL$$, :'sm'));

-- an inactive subscription blocks additions; nobody is removed
DELETE FROM public.user_roles WHERE tenant_id = :'sm' AND user_id = :MGR7;
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_subscription(%L, 'enterprise', 'expired')$$, :'sm')) IS NOT NULL AS ok \gset
SELECT pg_temp.expect_error('seats: an inactive subscription blocks adding admins',
  format($$SELECT pg_temp.add_admin(%L, %L, 'm2a_mgr7')$$, :'sm', :MGR7), 'המנוי של האתר אינו פעיל');
SELECT tests.check('seats: an inactive subscription removes nobody',
  format($$SELECT count(*) = 7 FROM public.user_roles WHERE tenant_id = %L AND role = 'admin'$$, :'sm'));
SELECT tests.check('seats: changing other columns of an existing admin is not a new seat',
  format($$WITH u AS (UPDATE public.user_roles SET is_approved = true WHERE tenant_id = %L AND user_id = %L RETURNING 1)
           SELECT count(*) = 1 FROM u$$, :'sm', :MGR1));

-- ============================================================
-- 6. Ecommerce stores keep the Ecommerce rule
-- ============================================================
SELECT tests.check('ecommerce: the store has the Ecommerce limit (trial = 3) and no Hospitality entitlements',
  format($$SELECT public.tenant_admin_limit(%1$L) = 3 AND hospitality.entitlements(%1$L) IS NULL$$, :SHOP));
SELECT pg_temp.add_admin(:SHOP, :SHOP_ADM2, 'm2a_shop_adm2') IS NOT NULL AS ok \gset
SELECT pg_temp.add_admin(:SHOP, :SHOP_ADM3, 'm2a_shop_adm3') IS NOT NULL AS ok \gset
SELECT pg_temp.expect_error('ecommerce: the fourth store admin is refused with the Ecommerce message',
  format($$SELECT pg_temp.add_admin(%L, %L, 'm2a_shop_adm4')$$, :SHOP, :SHOP_ADM4), 'שדרג את החבילה');
SELECT tests.check('ecommerce: no Hospitality object or row was created for the store',
  format($$SELECT NOT EXISTS (SELECT 1 FROM hospitality.subscriptions WHERE tenant_id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.settings WHERE tenant_id = %1$L)$$, :SHOP));

-- leave the platform flags as the migrations left them (other test files check the defaults)
SELECT pg_temp.as_platform($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_management_enabled', false),
                                    public.platform_set_flag('hospitality_booking_enabled', false)])$$) IS NOT NULL AS ok \gset
SELECT tests.check('cleanup: every Hospitality platform flag is off again',
  $$SELECT bool_and(NOT enabled) FROM public.platform_feature_flags WHERE key LIKE 'hospitality%'$$);

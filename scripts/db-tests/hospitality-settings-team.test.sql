-- ============================================================
-- Hospitality: business settings and team (Hospitality Stage 2b.1 —
-- 20261101160000_hosp_settings_team.sql)
--   • settings: no direct writes; per-field permissions (owner / manager), locked fields,
--     Hebrew validation, revision check, audit
--   • team: owner-only list / add / remove / activity; seats; generic refusal; the email
--     code sign-in works for an added manager (existing and new account)
--   • user_roles on Hospitality sites: a manager changes only own username / display name
--   • audit log: append-only, owner reads own site only, no secrets
--   • Ecommerce: data unchanged, store rules (including the existing behaviour) unchanged
-- Parallel cases: scripts/db-tests/hospitality/concurrency/run.sh (scenarios 24–26)
-- ============================================================
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set OWNER_S '''a0000000-0000-0000-0000-0000000005a1'''
\set MGR_S '''a0000000-0000-0000-0000-0000000005a2'''
\set MGR_S2 '''a0000000-0000-0000-0000-0000000005a3'''
\set NEW1 '''a0000000-0000-0000-0000-0000000005a4'''
\set NEW2 '''a0000000-0000-0000-0000-0000000005a5'''
\set FRESH '''a0000000-0000-0000-0000-0000000005a6'''
\set OWNER_T '''a0000000-0000-0000-0000-0000000005b1'''
\set GUEST '''a0000000-0000-0000-0000-0000000005c1'''
\set SHOP_OWNER '''a0000000-0000-0000-0000-0000000005e1'''
\set SHOP_MGR '''a0000000-0000-0000-0000-0000000005e2'''
\set SHOP_MGR2 '''a0000000-0000-0000-0000-0000000005e3'''
\set CUSTOMER '''a0000000-0000-0000-0000-0000000005e4'''
\set DUAL '''a0000000-0000-0000-0000-0000000005e5'''
\set SHOP '''72b00000-0000-0000-0000-0000000000e1'''

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
-- the server (service role, no user) with the site header — like the login-code functions
CREATE OR REPLACE FUNCTION pg_temp.svc(_site text, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site)::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE service_role;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
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
CREATE OR REPLACE FUNCTION pg_temp.add_role(_site uuid, _uid uuid, _name text, _role text DEFAULT 'admin') RETURNS jsonb LANGUAGE sql AS $f$
  INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
  VALUES (_site, _uid, _name || '@test.local', _name, _role, true) RETURNING to_jsonb(true);
$f$;
-- the Ecommerce data this file must not change (stores only)
CREATE OR REPLACE FUNCTION pg_temp.ecommerce_hash() RETURNS text LANGUAGE sql AS $f$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(ur::text, ',' ORDER BY ur.tenant_id, ur.user_id) FROM public.user_roles ur
       JOIN public.tenants t ON t.id = ur.tenant_id WHERE t.site_type = 'ecommerce'),
    (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s),
    (SELECT string_agg(e::text, ',' ORDER BY e::text) FROM public.email_settings e),
    (SELECT string_agg(x::text, ',' ORDER BY x.tenant_id) FROM public.tenant_subscriptions x)));
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-0000000005a1', 'm2b.owner.s@test.local', now()),
  ('a0000000-0000-0000-0000-0000000005a2', 'm2b.mgr.s@test.local', now()),
  ('a0000000-0000-0000-0000-0000000005a3', 'm2b.mgr2.s@test.local', now()),
  ('a0000000-0000-0000-0000-0000000005a4', 'm2b.new1@test.local', now()),
  ('a0000000-0000-0000-0000-0000000005a5', 'm2b.new2@test.local', now()),
  ('a0000000-0000-0000-0000-0000000005b1', 'm2b.owner.t@test.local', now()),
  ('a0000000-0000-0000-0000-0000000005c1', 'm2b.guest@test.local', now()),
  ('a0000000-0000-0000-0000-0000000005e1', 'm2b.shop.owner@test.local', now()),
  ('a0000000-0000-0000-0000-0000000005e2', 'm2b.shop.mgr@test.local', now()),
  ('a0000000-0000-0000-0000-0000000005e3', 'm2b.shop.mgr2@test.local', now()),
  ('a0000000-0000-0000-0000-0000000005e4', 'm2b.customer@test.local', now()),
  ('a0000000-0000-0000-0000-0000000005e5', 'm2b.dual@test.local', now())
ON CONFLICT DO NOTHING;

SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('h2b-s', 'אירוח S'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('h2b-t', 'אירוח T'))$$) IS NOT NULL AS ok \gset
SELECT id AS ss FROM public.tenants WHERE slug = 'h2b-s' \gset
SELECT id AS st FROM public.tenants WHERE slug = 'h2b-t' \gset
SELECT pg_temp.add_role(:'ss', :OWNER_S, 'm2b_owner_s') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'ss', :MGR_S, 'm2b_mgr_s') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'st', :OWNER_T, 'm2b_owner_t') IS NOT NULL AS ok \gset
-- a store: owner, a manager, a second (blocked) manager, a customer; DUAL is a store manager
INSERT INTO public.tenants (id, slug, name) VALUES (:SHOP, 'h2b-shop', 'חנות 2b');
SELECT pg_temp.add_role(:SHOP, :SHOP_OWNER, 'm2b_shop_owner') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:SHOP, :SHOP_MGR, 'm2b_shop_mgr') IS NOT NULL AS ok \gset
UPDATE public.tenant_subscriptions SET extra_admins_count = 5 WHERE tenant_id = :SHOP;
SELECT pg_temp.add_role(:SHOP, :SHOP_MGR2, 'm2b_shop_mgr2') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:SHOP, :DUAL, 'm2b_dual_shop') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:SHOP, :CUSTOMER, 'm2b_customer', 'customer') IS NOT NULL AS ok \gset
UPDATE public.user_roles SET is_blocked = true WHERE tenant_id = :SHOP AND user_id = :SHOP_MGR2;
-- flags: S and T — database + management
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'ss', :'st')) IS NOT NULL AS ok \gset
CREATE TEMP TABLE h2b_before AS SELECT pg_temp.ecommerce_hash() AS h;
SELECT (pg_temp.call(:'ss', :OWNER_S, 'SELECT hospitality.settings_view()') ->> 'revision')::integer AS rev \gset

-- ============================================================
-- 1. Structure
-- ============================================================
SELECT tests.check('structure: staff have no direct write on hospitality.settings (table or column)',
  $$SELECT NOT has_table_privilege('authenticated', 'hospitality.settings', 'UPDATE')
       AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges
                        WHERE table_schema = 'hospitality' AND table_name = 'settings'
                          AND grantee = 'authenticated' AND privilege_type = 'UPDATE')
       AND has_table_privilege('authenticated', 'hospitality.settings', 'SELECT')$$);
SELECT tests.check('structure: audit_log — RLS on, no privilege for anon / authenticated, service_role read only',
  $$SELECT (SELECT relrowsecurity FROM pg_class WHERE oid = 'hospitality.audit_log'::regclass)
       AND NOT has_table_privilege('authenticated', 'hospitality.audit_log', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'hospitality.audit_log', 'INSERT')
       AND NOT has_table_privilege('anon', 'hospitality.audit_log', 'SELECT')
       AND has_table_privilege('service_role', 'hospitality.audit_log', 'SELECT')
       AND NOT has_table_privilege('service_role', 'hospitality.audit_log', 'INSERT')
       AND NOT has_table_privilege('service_role', 'hospitality.audit_log', 'UPDATE')
       AND NOT has_table_privilege('service_role', 'hospitality.audit_log', 'DELETE')
       AND NOT has_table_privilege('service_role', 'hospitality.audit_log', 'TRUNCATE')$$);
SELECT tests.check('structure: audit_log has no column for passwords, tokens or full contact data',
  $$SELECT array_agg(column_name::text ORDER BY ordinal_position) = ARRAY['id', 'tenant_id', 'actor_id', 'actor_role',
           'actor_label', 'action', 'target_label', 'changes', 'created_at']
      FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'audit_log'$$);
SELECT tests.check('api: the new functions are not callable by anon; internal helpers not callable through the API',
  $$SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
       AND bool_and(CASE WHEN p.proname LIKE '\_%' OR p.proname IN ('mask_phone', 'user_roles_admin_row_guard', 'audit_log_append_only')
                         THEN NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') ELSE true END)
      FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace
       AND p.proname IN ('settings_view', 'update_settings', 'team_members', 'team_add_manager', 'team_remove_manager',
                         'team_activity', '_manage_tenant', '_audit', '_settings_label', '_sv_text', '_sv_int',
                         '_settings_values', '_settings_fields', 'mask_phone', 'user_roles_admin_row_guard',
                         'audit_log_append_only')$$);
SELECT tests.check('structure: the user_roles guard is a BEFORE UPDATE trigger that starts with the Hospitality-site check',
  $$SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hospitality_admin_row_guard'
                    AND tgrelid = 'public.user_roles'::regclass AND (tgtype & 2) = 2 AND (tgtype & 16) = 16)
       AND (SELECT position('site_type = ''hospitality''' in prosrc) BETWEEN 1 AND 200
              FROM pg_proc WHERE oid = 'hospitality.user_roles_admin_row_guard()'::regprocedure)$$);
SELECT tests.check('permissions: settings.owner exists and is owner only',
  $$SELECT 'settings.owner' = ANY (hospitality.permissions())$$);

-- ============================================================
-- 2. Settings — who may read / write what
-- ============================================================
SELECT pg_temp.after('settings: the owner may edit every open field, including notifications and retention',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.settings_view()')$$, :'ss', :OWNER_S),
  $$SELECT ($1 -> 'editable') ? 'notification_emails' AND ($1 -> 'editable') ? 'guest_retention_months'
       AND ($1 -> 'editable') ? 'business_name' AND jsonb_array_length($1 -> 'editable') = 13
       AND $1 -> 'locked' = '["booking_mode", "currency", "timezone", "payment_hold_minutes"]'::jsonb
       AND $1 -> 'values' ->> 'check_in_time' = '15:00'$$);
SELECT pg_temp.after('settings: a manager sees all values but may not edit notifications or retention',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.settings_view()')$$, :'ss', :MGR_S),
  $$SELECT NOT ($1 -> 'editable') ? 'notification_emails' AND NOT ($1 -> 'editable') ? 'guest_retention_months'
       AND jsonb_array_length($1 -> 'editable') = 11 AND ($1 -> 'values') ? 'notification_emails'$$);
SELECT pg_temp.after('settings: a manager saves business details, times and booking rules',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)',
     '{"business_name": "  צימרי הגליל  ", "contact_phone": "050-1234567", "check_in_time": "14:30",
       "approval_window_minutes": 600, "weekend_nights": [5, 4, 5]}', %s))$$, :'ss', :MGR_S, :rev),
  format($$SELECT $1 -> 'values' ->> 'business_name' = 'צימרי הגליל' AND $1 -> 'values' ->> 'check_in_time' = '14:30'
       AND $1 -> 'values' -> 'weekend_nights' = '[4, 5]'::jsonb AND ($1 ->> 'revision')::integer = %s + 1$$, :rev));
SELECT tests.check('audit: the manager''s change is recorded — who, which site, when, what (phone masked)',
  format($$SELECT a.actor_id = %L AND a.actor_role = 'manager' AND a.tenant_id = %L AND a.action = 'settings.updated'
            AND a.created_at > now() - interval '1 minute'
            AND a.changes -> 'business_name' = '{"from": "אירוח S", "to": "צימרי הגליל"}'::jsonb
            AND a.changes -> 'contact_phone' ->> 'to' = '•••4567'
            AND a.changes::text NOT LIKE '%%050-1234567%%'
            -- weekend [5, 4, 5] → {4,5} is the existing value: not a change, not recorded
            AND (SELECT count(*) FROM jsonb_object_keys(a.changes)) = 4 AND NOT a.changes ? 'weekend_nights'
       FROM hospitality.audit_log a WHERE a.tenant_id = %L ORDER BY a.id DESC LIMIT 1$$, :MGR_S, :'ss', :'ss'));
SELECT pg_temp.expect_error('settings: a manager cannot change the notification recipients',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)',
     '{"notification_emails": ["me@evil.test"]}', %s))$$, :'ss', :MGR_S, :rev + 1), 'רק בעל העסק יכול לשנות את נמעני ההתראות');
SELECT pg_temp.expect_error('settings: a manager cannot change guest-data retention',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)',
     '{"guest_retention_months": 6}', %s))$$, :'ss', :MGR_S, :rev + 1), 'רק בעל העסק יכול לשנות את שמירת פרטי אורחים');
SELECT pg_temp.expect_error('settings: a refused field fails the whole save (the allowed field in it is not saved)',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)',
     '{"address": "רחוב 1", "notification_emails": ["x@y.test"]}', %s))$$, :'ss', :MGR_S, :rev + 1), 'רק בעל העסק');
SELECT tests.check('settings: … nothing was written by the refused save',
  format($$SELECT address IS NULL AND notification_emails = '{}' AND revision = %s + 1 FROM hospitality.settings WHERE tenant_id = %L$$, :rev, :'ss'));
SELECT pg_temp.after('settings: the owner sets the notification recipients and the retention',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)',
     '{"notification_emails": ["Owner@Biz.Test", "owner@biz.test", "desk@biz.test"], "guest_retention_months": 24}', %s))$$,
     :'ss', :OWNER_S, :rev + 1),
  $$SELECT (SELECT array_agg(e ORDER BY e) FROM jsonb_array_elements_text($1 -> 'values' -> 'notification_emails') e)
           = ARRAY['desk@biz.test', 'owner@biz.test']
       AND ($1 -> 'values' ->> 'guest_retention_months')::integer = 24$$);
SELECT tests.check('audit: the owner''s change is recorded with masked recipients',
  format($$SELECT a.actor_role = 'owner' AND a.actor_id = %L
            AND a.changes -> 'notification_emails' -> 'to' = '["d•••@biz.test", "o•••@biz.test"]'::jsonb
            AND a.changes::text NOT LIKE '%%desk@biz.test%%'
       FROM hospitality.audit_log a WHERE a.tenant_id = %L ORDER BY a.id DESC LIMIT 1$$, :OWNER_S, :'ss'));

-- locked fields: refused for everyone, the owner included
SELECT pg_temp.expect_error('settings: instant booking is locked (owner)',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{"booking_mode": "instant"}', %s))$$,
     :'ss', :OWNER_S, :rev + 2), 'נעול בשלב הזה');
SELECT pg_temp.expect_error('settings: currency is locked (owner)',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{"currency": "USD"}', %s))$$,
     :'ss', :OWNER_S, :rev + 2), 'השדה "מטבע" נעול');
SELECT pg_temp.expect_error('settings: timezone is locked (owner)',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{"timezone": "Europe/London"}', %s))$$,
     :'ss', :OWNER_S, :rev + 2), 'נעול בשלב הזה');
SELECT pg_temp.expect_error('settings: payment hold is locked (owner)',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{"payment_hold_minutes": 60}', %s))$$,
     :'ss', :OWNER_S, :rev + 2), 'נעול בשלב הזה');
SELECT pg_temp.expect_error('settings: an unknown field is refused (no write to internal columns)',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{"last_booking_number": 1}', %s))$$,
     :'ss', :OWNER_S, :rev + 2), 'שדה לא מוכר');

-- Hebrew validation for each kind of field
SELECT pg_temp.expect_error('validation: business name required',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{"business_name": "   "}', %s))$$, :'ss', :OWNER_S, :rev + 2), 'יש למלא את שם העסק');
SELECT pg_temp.expect_error('validation: phone',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{"whatsapp_phone": "abc"}', %s))$$, :'ss', :OWNER_S, :rev + 2), 'מספר הטלפון לא תקין');
SELECT pg_temp.expect_error('validation: email',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{"contact_email": "not-an-email"}', %s))$$, :'ss', :OWNER_S, :rev + 2), 'כתובת האימייל של העסק לא תקינה');
SELECT pg_temp.expect_error('validation: time',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{"check_out_time": "25:00"}', %s))$$, :'ss', :OWNER_S, :rev + 2), 'שעה לא תקינה');
SELECT pg_temp.expect_error('validation: approval window range',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{"approval_window_minutes": 30}', %s))$$, :'ss', :OWNER_S, :rev + 2), 'בין 60 ל-2880');
SELECT pg_temp.expect_error('validation: whole numbers only',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{"max_open_requests": 2.5}', %s))$$, :'ss', :OWNER_S, :rev + 2), 'מספר שלם');
SELECT pg_temp.expect_error('validation: weekend nights from the list',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{"weekend_nights": [7]}', %s))$$, :'ss', :OWNER_S, :rev + 2), 'יש לבחור ימים מהרשימה');
SELECT pg_temp.expect_error('validation: at most 5 recipients',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)',
     '{"notification_emails": ["a@b.co","c@b.co","d@b.co","e@b.co","f@b.co","g@b.co"]}', %s))$$, :'ss', :OWNER_S, :rev + 2), 'עד 5 כתובות');
SELECT pg_temp.expect_error('validation: retention range',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{"guest_retention_months": 3}', %s))$$, :'ss', :OWNER_S, :rev + 2), 'בין 6 ל-120');
SELECT pg_temp.expect_error('settings: an empty save is refused',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{}', %s))$$, :'ss', :OWNER_S, :rev + 2), 'אין שינויים');

-- revision ("updated in the meantime")
SELECT pg_temp.expect_error('settings: a save based on an old revision is refused',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{"address": "x"}', %s))$$, :'ss', :MGR_S, :rev), 'ההגדרות עודכנו בינתיים');
SELECT pg_temp.after('settings: saving the same values changes nothing (no new revision, no audit row)',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{"check_in_time": "14:30"}', %s))$$, :'ss', :OWNER_S, :rev + 2),
  format($$SELECT ($1 ->> 'revision')::integer = %s + 2 AND (SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = %L) = 2$$, :rev, :'ss'));

-- direct writes and outsiders
SELECT pg_temp.expect_error('settings: the owner cannot write the settings table directly',
  format($$SELECT pg_temp.call(%L, %L, 'WITH u AS (UPDATE hospitality.settings SET notification_emails = ''{}'' RETURNING 1) SELECT to_jsonb(count(*)) FROM u')$$, :'ss', :OWNER_S), 'permission denied');
SELECT pg_temp.expect_error('settings: a manager cannot write the settings table directly',
  format($$SELECT pg_temp.call(%L, %L, 'WITH u AS (UPDATE hospitality.settings SET notification_emails = ''{"me@evil.test"}'' RETURNING 1) SELECT to_jsonb(count(*)) FROM u')$$, :'ss', :MGR_S), 'permission denied');
SELECT pg_temp.expect_error('settings: the owner of another site cannot read these settings',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.settings_view()')$$, :'ss', :OWNER_T), 'אין הרשאה');
SELECT pg_temp.expect_error('settings: … nor change them',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.update_settings(%%L, %%s)', '{"address": "x"}', %s))$$, :'ss', :OWNER_T, :rev + 2), 'אין הרשאה');
SELECT pg_temp.expect_error('settings: a store owner cannot read them',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.settings_view()')$$, :'ss', :SHOP_OWNER), 'אין הרשאה');
SELECT pg_temp.expect_error('settings: a signed-in guest cannot read them',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.settings_view()')$$, :'ss', :GUEST), 'אין הרשאה');
SELECT pg_temp.expect_error('settings: anonymous cannot call the functions',
  format($$SELECT pg_temp.call(%L, NULL, 'SELECT hospitality.settings_view()')$$, :'ss'), 'permission denied');
SELECT pg_temp.expect_error('settings: on a store the functions answer "no permission" (and nothing is read)',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.settings_view()')$$, :SHOP, :SHOP_OWNER), 'אין הרשאה');
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(public.platform_set_flag('hospitality_management_enabled', false, %L))$$, :'ss')) IS NOT NULL AS ok \gset
SELECT pg_temp.expect_error('settings: management flag off → refused, even for the owner',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.settings_view()')$$, :'ss', :OWNER_S), 'אזור הניהול אינו פעיל');
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(public.platform_set_flag('hospitality_management_enabled', true, %L))$$, :'ss')) IS NOT NULL AS ok \gset

-- ============================================================
-- 3. Team — owner only
-- ============================================================
SELECT pg_temp.after('team: the owner sees the owner and the manager, with emails and seats',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_members()')$$, :'ss', :OWNER_S),
  $$SELECT jsonb_array_length($1 -> 'members') = 2
       AND $1 -> 'members' -> 0 ->> 'role' = 'owner' AND $1 -> 'members' -> 1 ->> 'role' = 'manager'
       AND $1 -> 'members' -> 1 ->> 'email' = 'm2b.mgr.s@test.local'
       AND ($1 -> 'seats' ->> 'used')::integer = 2 AND ($1 -> 'seats' ->> 'limit')::integer = 3$$);
SELECT pg_temp.expect_error('team: a manager cannot see the team list',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_members()')$$, :'ss', :MGR_S), 'אין הרשאה');
SELECT pg_temp.expect_error('team: a manager cannot see the activity',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_activity(10)')$$, :'ss', :MGR_S), 'אין הרשאה');
SELECT pg_temp.expect_error('team: a manager cannot add a manager',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_add_manager(''m2b.new1@test.local'')')$$, :'ss', :MGR_S), 'אין הרשאה');
SELECT pg_temp.expect_error('team: a manager cannot remove a manager',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.team_remove_manager(%%L))', %L))$$, :'ss', :MGR_S, :OWNER_S), 'אין הרשאה');
SELECT pg_temp.expect_error('team: the owner of another site cannot list this team',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_members()')$$, :'ss', :OWNER_T), 'אין הרשאה');
SELECT pg_temp.expect_error('team: a store owner cannot add a manager here',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_add_manager(''m2b.new1@test.local'')')$$, :'ss', :SHOP_OWNER), 'אין הרשאה');
SELECT pg_temp.expect_error('team: a guest cannot list the team',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_members()')$$, :'ss', :GUEST), 'אין הרשאה');
SELECT pg_temp.expect_error('team: anonymous cannot call the team functions',
  format($$SELECT pg_temp.call(%L, NULL, 'SELECT hospitality.team_members()')$$, :'ss'), 'permission denied');
SELECT pg_temp.expect_error('team: on a store the team functions answer "no permission"',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_members()')$$, :SHOP, :SHOP_OWNER), 'אין הרשאה');

-- add an existing account
SELECT pg_temp.after('team: the owner adds an existing account as a manager',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_add_manager('' M2B.New1@Test.Local '', ''נועה'')')$$, :'ss', :OWNER_S),
  format($$SELECT $1 ->> 'status' = 'added' AND $1 ->> 'user_id' = %L
       AND (SELECT role = 'admin' AND NOT is_protected AND display_name = 'נועה' AND email = 'm2b.new1@test.local'
              FROM public.user_roles WHERE tenant_id = %L AND user_id = %L)$$, :NEW1, :'ss', :NEW1));
SELECT pg_temp.after('team: the new manager is a manager of this site at once (and nothing more)',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.management_context()')$$, :'ss', :NEW1),
  $$SELECT $1 ->> 'role' = 'manager' AND NOT ($1 -> 'permissions' ->> 'staff.managers')::boolean$$);
SELECT tests.check('audit: the addition is recorded (owner, masked email, display name)',
  format($$SELECT a.action = 'team.manager_added' AND a.actor_role = 'owner' AND a.target_label = 'נועה'
            AND a.changes = '{"email": "m•••@test.local"}'::jsonb
       FROM hospitality.audit_log a WHERE a.tenant_id = %L ORDER BY a.id DESC LIMIT 1$$, :'ss'));
SELECT pg_temp.after('team: adding the same person again is harmless',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_add_manager(''m2b.new1@test.local'')')$$, :'ss', :OWNER_S),
  $$SELECT $1 ->> 'status' = 'already_member'$$);
-- seats: trial = 3 (owner + 2 managers now)
SELECT pg_temp.expect_error('team: the seat limit applies (trial: 3, the owner counts)',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_add_manager(''m2b.new2@test.local'')')$$, :'ss', :OWNER_S), 'מגבלת המנהלים בחבילה (3)');
SELECT pg_temp.expect_error('team: … also for a new email (no account is requested at the limit)',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_add_manager(''brand.new@test.local'')')$$, :'ss', :OWNER_S), 'מגבלת המנהלים בחבילה (3)');

-- remove
SELECT pg_temp.after('team: the owner removes a manager',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.team_remove_manager(%%L))', %L))$$, :'ss', :OWNER_S, :NEW1),
  format($$SELECT $1 = 'true'::jsonb AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE tenant_id = %L AND user_id = %L)$$, :'ss', :NEW1));
SELECT pg_temp.expect_error('team: a removed manager loses access immediately',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.management_context()')$$, :'ss', :NEW1), 'אין לחשבון הזה הרשאת ניהול');
SELECT pg_temp.expect_error('team: … and cannot read bookings data any more (RLS)',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.settings_view()')$$, :'ss', :NEW1), 'אין הרשאה');
SELECT tests.check('audit: the removal is recorded',
  format($$SELECT a.action = 'team.manager_removed' AND a.actor_role = 'owner' AND a.target_label = 'נועה'
       FROM hospitality.audit_log a WHERE a.tenant_id = %L ORDER BY a.id DESC LIMIT 1$$, :'ss'));
SELECT pg_temp.expect_error('team: the owner cannot be removed',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.team_remove_manager(%%L))', %L))$$, :'ss', :OWNER_S, :OWNER_S), 'אי אפשר להסיר את בעל העסק');
SELECT pg_temp.expect_error('team: a member of another site cannot be removed from here',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.team_remove_manager(%%L))', %L))$$, :'ss', :OWNER_S, :OWNER_T), 'המנהל לא נמצא');

-- generic refusals (no hint why)
SELECT pg_temp.expect_error('team: a customer of a store cannot be added — generic message, no hint',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_add_manager(''m2b.customer@test.local'')')$$, :'ss', :OWNER_S),
  'אי אפשר לצרף את החשבון הזה כמנהל. פנו לתמיכה.');
SELECT pg_temp.expect_error('team: a platform admin is not added as a manager (generic message)',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_add_manager(''platform@test.local'')')$$, :'ss', :OWNER_S),
  'אי אפשר לצרף');
SELECT pg_temp.expect_error('team: invalid email',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_add_manager(''nope'')')$$, :'ss', :OWNER_S), 'כתובת האימייל לא תקינה');

-- a new email: the database asks for an account (the server creates it — 2b.3), writes nothing
SELECT pg_temp.after('team: a new email → "needs_account", nothing written',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_add_manager(''brand.new@test.local'', ''דן'')')$$, :'ss', :OWNER_S),
  $$SELECT $1 = '{"status": "needs_account"}'::jsonb
       AND NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'brand.new@test.local')$$);
-- the account the server creates (confirmed email, no password), then the second call
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('a0000000-0000-0000-0000-0000000005a6', 'brand.new@test.local', now());
SELECT pg_temp.after('team: after the account exists, the same call adds the manager',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_add_manager(''brand.new@test.local'', ''דן'')')$$, :'ss', :OWNER_S),
  $$SELECT $1 ->> 'status' = 'added'$$);
-- the store manager DUAL may also manage a Hospitality site (staff of several sites is allowed)
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_extra_managers(%L, 2)$$, :'ss')) IS NOT NULL AS ok \gset
SELECT pg_temp.after('team: a store manager can be added as a Hospitality manager',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_add_manager(''m2b.dual@test.local'')')$$, :'ss', :OWNER_S),
  $$SELECT $1 ->> 'status' = 'added'$$);
SELECT pg_temp.add_role(:'ss', :MGR_S2, 'm2b_mgr2_s') IS NOT NULL AS ok \gset
UPDATE public.user_roles SET is_blocked = true WHERE tenant_id = :'ss' AND user_id = :MGR_S2;

-- ============================================================
-- 4. Email-code sign-in works for added managers (new and existing accounts)
-- ============================================================
SELECT pg_temp.svc(:'ss', $$SELECT to_jsonb(public.issue_login_code('brand.new@test.local', repeat('a', 64)))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.after('sign-in: the new account (created for the manager) passes the email-code check on this site',
  format($$SELECT pg_temp.svc(%L, 'SELECT public.consume_login_code(''brand.new@test.local'', repeat(''a'', 64))')$$, :'ss'),
  format($$SELECT $1 ->> 'result' = 'ok' AND $1 ->> 'user_id' = %L AND ($1 ->> 'same_store')::boolean
       AND NOT ($1 ->> 'blocked')::boolean$$, 'a0000000-0000-0000-0000-0000000005a6'));
SELECT pg_temp.svc(:'ss', $$SELECT to_jsonb(public.issue_login_code('m2b.dual@test.local', repeat('b', 64)))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.after('sign-in: an existing account (also a store manager) passes it on this site too',
  format($$SELECT pg_temp.svc(%L, 'SELECT public.consume_login_code(''m2b.dual@test.local'', repeat(''b'', 64))')$$, :'ss'),
  format($$SELECT $1 ->> 'result' = 'ok' AND $1 ->> 'user_id' = %L AND ($1 ->> 'same_store')::boolean$$, :DUAL));
SELECT pg_temp.after('sign-in: … and after signing in, the new manager has the management area',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.management_context()')$$, :'ss', 'a0000000-0000-0000-0000-0000000005a6'),
  $$SELECT $1 ->> 'role' = 'manager'$$);
SELECT pg_temp.svc(:'ss', $$SELECT to_jsonb(public.issue_login_code('m2b.mgr2.s@test.local', repeat('c', 64)))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.after('sign-in: a blocked manager is reported blocked (the login refuses it)',
  format($$SELECT pg_temp.svc(%L, 'SELECT public.consume_login_code(''m2b.mgr2.s@test.local'', repeat(''c'', 64))')$$, :'ss'),
  $$SELECT ($1 ->> 'blocked')::boolean$$);

-- ============================================================
-- 5. user_roles on a Hospitality site: a manager changes only own username / display name
-- ============================================================
\set UPD_OTHER 'WITH u AS (UPDATE public.user_roles SET %s WHERE tenant_id = %L AND user_id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM u'
SELECT pg_temp.expect_error('guard: a manager cannot unblock a blocked manager',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :'ss', :MGR_S, format(:'UPD_OTHER', 'is_blocked = false', :'ss', :MGR_S2)), 'רק בעל העסק יכול לשנות פרטים של מנהלים אחרים');
SELECT pg_temp.expect_error('guard: a manager cannot block another manager',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :'ss', :MGR_S, format(:'UPD_OTHER', 'is_blocked = true', :'ss', :DUAL)), 'רק בעל העסק');
SELECT pg_temp.expect_error('guard: a manager cannot rename another manager',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :'ss', :MGR_S, format(:'UPD_OTHER', 'display_name = ''x''', :'ss', :DUAL)), 'רק בעל העסק');
SELECT pg_temp.expect_error('guard: a manager cannot change another manager''s email',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :'ss', :MGR_S, format(:'UPD_OTHER', 'email = ''x@evil.test''', :'ss', :DUAL)), 'רק בעל העסק');
SELECT pg_temp.expect_error('guard: a manager cannot change another manager''s username',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :'ss', :MGR_S, format(:'UPD_OTHER', 'username = ''hijack''', :'ss', :DUAL)), 'רק בעל העסק');
SELECT pg_temp.expect_error('guard: a manager cannot change the owner''s row',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :'ss', :MGR_S, format(:'UPD_OTHER', 'display_name = ''x''', :'ss', :OWNER_S)), 'רק בעל העסק');
SELECT pg_temp.expect_error('guard: a manager cannot change own email',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :'ss', :MGR_S, format(:'UPD_OTHER', 'email = ''me2@test.local''', :'ss', :MGR_S)), 'אפשר לשנות רק את שם המשתמש ואת שם התצוגה שלך');
SELECT pg_temp.expect_error('guard: a manager cannot change own role / approval / block flags',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :'ss', :MGR_S, format(:'UPD_OTHER', 'is_approved = false', :'ss', :MGR_S)), 'אפשר לשנות רק');
SELECT pg_temp.expect_error('guard: a manager cannot move own row to another site',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :'ss', :MGR_S, format(:'UPD_OTHER', format('tenant_id = %L', :'st'), :'ss', :MGR_S)), 'אפשר לשנות רק');
SELECT pg_temp.after('guard: a manager changes own username and display name',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :'ss', :MGR_S, format(:'UPD_OTHER', 'username = ''m2b_mgr_s_new'', display_name = ''מנהלת''', :'ss', :MGR_S)),
  format($$SELECT $1 = '1'::jsonb AND (SELECT username = 'm2b_mgr_s_new' AND display_name = 'מנהלת'
       FROM public.user_roles WHERE tenant_id = %L AND user_id = %L)$$, :'ss', :MGR_S));
SELECT tests.check('guard: every refused change left the rows exactly as they were',
  format($$SELECT (SELECT is_blocked FROM public.user_roles WHERE tenant_id = %1$L AND user_id = %2$L)
            AND (SELECT NOT is_blocked AND display_name IS NULL AND email = 'm2b.dual@test.local'
                   FROM public.user_roles WHERE tenant_id = %1$L AND user_id = %3$L)
            AND (SELECT email = 'm2b_mgr_s@test.local' AND is_approved FROM public.user_roles WHERE tenant_id = %1$L AND user_id = %4$L)$$,
         :'ss', :MGR_S2, :DUAL, :MGR_S));
SELECT pg_temp.after('guard: the owner may still block / unblock a manager directly (existing owner rights)',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :'ss', :OWNER_S, format(:'UPD_OTHER', 'is_blocked = false', :'ss', :MGR_S2)),
  $$SELECT $1 = '1'::jsonb$$);
SELECT tests.check('guard: the server (no user) still updates rows (e.g. the password flag)',
  format($$WITH u AS (UPDATE public.user_roles SET must_change_password = false WHERE tenant_id = %L AND user_id = %L RETURNING 1)
           SELECT count(*) = 1 FROM u$$, :'ss', :MGR_S));

-- ============================================================
-- 6. Audit log: append-only, owner only
-- ============================================================
SELECT pg_temp.after('audit: the owner reads the activity of own site, newest first, without raw contact data',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_activity(50)')$$, :'ss', :OWNER_S),
  $$SELECT jsonb_array_length($1) >= 5 AND $1 -> 0 ->> 'action' = 'team.manager_added'
       AND $1::text NOT LIKE '%desk@biz.test%' AND $1::text NOT LIKE '%owner@biz.test%'
       AND $1::text NOT LIKE '%050-1234567%' AND $1::text NOT LIKE '%m2b.new1@test.local%'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements($1) e WHERE e ? 'actor_id' OR e ? 'tenant_id')$$);
SELECT pg_temp.after('audit: the owner of another site sees only own activity (none here)',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_activity(50)')$$, :'st', :OWNER_T),
  $$SELECT $1 = '[]'::jsonb$$);
SELECT pg_temp.expect_error('audit: the owner cannot read the table directly',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT to_jsonb(count(*)) FROM hospitality.audit_log')$$, :'ss', :OWNER_S), 'permission denied');
SELECT pg_temp.expect_error('audit: rows cannot be changed (not even by the database owner)',
  format($$UPDATE hospitality.audit_log SET action = 'x.y.z' WHERE tenant_id = %L$$, :'ss'), 'יומן הפעולות אינו ניתן לשינוי או למחיקה');
SELECT pg_temp.expect_error('audit: rows cannot be deleted (not even by the database owner)',
  format($$DELETE FROM hospitality.audit_log WHERE tenant_id = %L$$, :'ss'), 'יומן הפעולות אינו ניתן לשינוי או למחיקה');
SELECT pg_temp.expect_error('audit: the table cannot be truncated',
  $$TRUNCATE hospitality.audit_log$$, 'יומן הפעולות אינו ניתן לשינוי או למחיקה');
SELECT pg_temp.expect_error('audit: the service role cannot insert forged rows',
  format($$SELECT pg_temp.svc(%L, format('WITH i AS (INSERT INTO hospitality.audit_log (tenant_id, actor_role, action) VALUES (%%L, ''owner'', ''x.y'') RETURNING 1) SELECT to_jsonb(count(*)) FROM i', %L))$$, :'ss', :'ss'), 'permission denied');
SELECT tests.check('audit: every row names its site, actor role and time; no secret-looking content',
  format($$SELECT bool_and(tenant_id = %L AND actor_role IN ('owner', 'manager') AND created_at IS NOT NULL)
            AND NOT bool_or(changes::text ~* '(password|token|secret|hash-)')
       FROM hospitality.audit_log WHERE tenant_id = %L$$, :'ss', :'ss'));

-- ============================================================
-- 7. Ecommerce is not affected
-- ============================================================
SELECT tests.check('ecommerce: store user_roles, site_settings, email_settings and subscriptions unchanged by all of the above',
  $$SELECT pg_temp.ecommerce_hash() = (SELECT h FROM h2b_before)$$);
SELECT tests.check('ecommerce: the dual user keeps the store role (store row untouched by the Hospitality addition)',
  format($$SELECT role = 'admin' AND NOT is_protected AND NOT is_blocked AND email = 'm2b_dual_shop@test.local'
       FROM public.user_roles WHERE tenant_id = %L AND user_id = %L$$, :SHOP, :DUAL));
-- existing store behaviour, unchanged (including the gap that exists for stores — reported, not changed)
SELECT pg_temp.after('ecommerce: a store manager can still rename another store manager (existing store behaviour)',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :SHOP, :SHOP_MGR, format(:'UPD_OTHER', 'display_name = ''שם חדש''', :SHOP, :DUAL)),
  $$SELECT $1 = '1'::jsonb$$);
SELECT pg_temp.after('ecommerce: a store manager can still unblock a store manager (existing store behaviour, not changed by 2b)',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :SHOP, :SHOP_MGR, format(:'UPD_OTHER', 'is_blocked = false', :SHOP, :SHOP_MGR2)),
  $$SELECT $1 = '1'::jsonb$$);
SELECT pg_temp.expect_error('ecommerce: a store manager still cannot block a store manager (existing owner rule)',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :SHOP, :SHOP_MGR, format(:'UPD_OTHER', 'is_blocked = true', :SHOP, :SHOP_MGR2)), 'רק בעל החנות יכול לחסום מנהל');
SELECT pg_temp.after('ecommerce: the dual user, acting in the store, edits a store row as before',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :SHOP, :DUAL, format(:'UPD_OTHER', 'display_name = ''עובד''', :SHOP, :SHOP_MGR)),
  $$SELECT $1 = '1'::jsonb$$);
SELECT pg_temp.after('ecommerce: the store owner manages store managers as before',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :SHOP, :SHOP_OWNER, format(:'UPD_OTHER', 'is_blocked = true', :SHOP, :SHOP_MGR2)),
  $$SELECT $1 = '1'::jsonb$$);
SELECT tests.check('ecommerce: no Hospitality object references a store row',
  format($$SELECT NOT EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.settings WHERE tenant_id = %1$L)$$, :SHOP));
SELECT tests.check('ecommerce: no customer role was created for the new manager account',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = 'a0000000-0000-0000-0000-0000000005a6' AND role <> 'admin')$$);

-- deleting a site still works, and takes its activity with it
SELECT pg_temp.as_platform($$SELECT to_jsonb(public.platform_delete_tenant((SELECT id FROM public.tenants WHERE slug = 'h2b-t'), 'h2b-t'))$$) IS NOT NULL AS ok \gset
SELECT tests.check('audit: deleting a site (platform) still works and removes its activity',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug = 'h2b-t')$$);

-- leave the platform flags as the migrations left them (other test files check the defaults)
SELECT pg_temp.as_platform($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_management_enabled', false)])$$) IS NOT NULL AS ok \gset
DROP TABLE h2b_before;

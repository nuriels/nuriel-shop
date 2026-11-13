-- ============================================================
-- Hospitality: מנהל/ת עסק (Business Admin) — מיגרציה 188 (20261113100000_hosp_business_admin.sql)
--   • רק הבעלים ממנה / מבטל; ברירת המחדל: אף אחד
--   • מנהל/ת עסק: כל ההרשאות חוץ ממנוי / תשלום (billing.manage) ובעלות (ownership)
--   • צוות: רשימה, יומן, הוספה / הסרה של מנהלים רגילים, הרשאות למנהלים רגילים — כן;
--     מינוי מנהלי עסק, הסרת מנהל/ת עסק אחר/ת, הסרת הבעלים — לא
--   • כתיבה ישירה לטבלת התפקידים נשארת חסומה (רק מתוך פונקציות הצוות)
--   • לפי עסק + חשבון: באתר אחר אותו אדם הוא מנהל רגיל / בלי גישה; חשבון שני — בלי הרשאה
-- ============================================================
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set OWNER_A '''a0000000-0000-0000-0000-0000000188a1'''
\set BA '''a0000000-0000-0000-0000-0000000188a2'''
\set M2 '''a0000000-0000-0000-0000-0000000188a3'''
\set NEW_A '''a0000000-0000-0000-0000-0000000188a4'''
\set BA2 '''a0000000-0000-0000-0000-0000000188a5'''
\set OWNER_B '''a0000000-0000-0000-0000-0000000188b1'''
\set OWNER_C '''a0000000-0000-0000-0000-0000000188c1'''

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
CREATE OR REPLACE FUNCTION pg_temp.add_role(_site uuid, _uid uuid, _name text) RETURNS jsonb LANGUAGE sql AS $f$
  INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
  VALUES (_site, _uid, _name || '@test.local', _name, 'admin', true) RETURNING to_jsonb(true);
$f$;
-- a team function with a user id (and an optional switch), as a user on a site
CREATE OR REPLACE FUNCTION pg_temp.fn(_site text, _uid uuid, _fn text, _arg uuid, _flag boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, format('SELECT to_jsonb(hospitality.%s(%L%s))', _fn, _arg,
                                          CASE WHEN _flag IS NULL THEN '' ELSE ', ' || _flag::text END));
$f$;
-- a direct statement on public.user_roles, as a user on a site
CREATE OR REPLACE FUNCTION pg_temp.dml(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, format('WITH x AS (%s RETURNING 1) SELECT to_jsonb(count(*)) FROM x', _sql));
$f$;
-- the permissions map the management area gets (management_context) for a user on a site
CREATE OR REPLACE FUNCTION pg_temp.perms(_site text, _uid uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, 'SELECT hospitality.management_context()') -> 'permissions';
$f$;

-- ---------- fixtures: A (BA is a manager), B (BA is a manager), C (BA has no role) ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-0000000188a1', 'h188.owner.a@test.local', now()),
  ('a0000000-0000-0000-0000-0000000188a2', 'h188.ba@test.local', now()),
  ('a0000000-0000-0000-0000-0000000188a3', 'h188.m2@test.local', now()),
  ('a0000000-0000-0000-0000-0000000188a4', 'h188.new@test.local', now()),
  ('a0000000-0000-0000-0000-0000000188a5', 'h188.ba.second@test.local', now()),
  ('a0000000-0000-0000-0000-0000000188b1', 'h188.owner.b@test.local', now()),
  ('a0000000-0000-0000-0000-0000000188c1', 'h188.owner.c@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('h188-a', 'אירוח A'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('h188-b', 'אירוח B'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('h188-c', 'אירוח C'))$$) IS NOT NULL AS ok \gset
SELECT id AS sa FROM public.tenants WHERE slug = 'h188-a' \gset
SELECT id AS sb FROM public.tenants WHERE slug = 'h188-b' \gset
SELECT id AS sc FROM public.tenants WHERE slug = 'h188-c' \gset
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(hospitality.admin_set_extra_managers(%L, 5))$$, :'sa')) IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sa', :OWNER_A, 'h188_owner_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sa', :BA, 'h188_ba') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sa', :M2, 'h188_m2') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sa', :BA2, 'h188_ba_second') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sb', :OWNER_B, 'h188_owner_b') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sb', :BA, 'h188_ba_in_b') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sc', :OWNER_C, 'h188_owner_c') IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %3$L),
       public.platform_set_flag('hospitality_management_enabled', true, %3$L)])$$, :'sa', :'sb', :'sc')) IS NOT NULL AS ok \gset

-- ============================================================
-- 1. Structure
-- ============================================================
SELECT tests.check('BA structure: the grant is a staff_grants value; new team function for signed-in staff; helpers internal only',
  $$SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_grants_permission_check'
                    AND pg_get_constraintdef(oid) LIKE '%business.admin%')
       AND has_function_privilege('authenticated', 'hospitality.team_set_business_admin(uuid,boolean)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.team_set_business_admin(uuid,boolean)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._is_business_admin(uuid,uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._team_op_allows(uuid,uuid)', 'EXECUTE')
       AND 'ownership' = ANY (hospitality.permissions())$$);

-- ============================================================
-- 2. Before: nobody is a business admin; a manager cannot appoint one
-- ============================================================
SELECT tests.check('BA before: a manager has no privacy / owner settings / team / ownership',
  format($$SELECT NOT (p ->> 'guests.privacy')::boolean AND NOT (p ->> 'staff.managers')::boolean
             AND NOT (p ->> 'ownership')::boolean AND NOT (p ->> 'billing.manage')::boolean
             AND (p ->> 'bookings')::boolean
          FROM pg_temp.perms(%L, %L) p$$, :'sa', :BA));
SELECT pg_temp.expect_error('BA: a regular manager cannot appoint a business admin (not even themselves)',
  format($$SELECT pg_temp.fn(%L, %L, 'team_set_business_admin', %L, true)$$,
         :'sa', :BA, :BA), 'הרשאה');
SELECT pg_temp.expect_error('BA: a regular manager cannot see the team',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_members()')$$, :'sa', :BA), 'הרשאה');

-- ============================================================
-- 3. The owner appoints BA (logged)
-- ============================================================
SELECT pg_temp.after('BA: the owner appoints a business admin; the team shows it',
  format($$SELECT pg_temp.fn(%L, %L, 'team_set_business_admin', %L, true)$$,
         :'sa', :OWNER_A, :BA),
  format($$SELECT EXISTS (SELECT 1 FROM jsonb_array_elements($1 -> 'members') m
                           WHERE m ->> 'user_id' = %L AND (m ->> 'business_admin')::boolean
                             AND (m ->> 'finance')::boolean AND (m ->> 'contracts')::boolean)
             AND EXISTS (SELECT 1 FROM jsonb_array_elements($1 -> 'members') m
                          WHERE m ->> 'user_id' = %L AND NOT (m ->> 'business_admin')::boolean)$$, :BA, :M2));
SELECT tests.check('BA: the appointment is in the activity log, by the owner',
  format($$SELECT EXISTS (SELECT 1 FROM hospitality.audit_log a
                           WHERE a.tenant_id = %L AND a.action = 'team.business_admin_granted'
                             AND a.actor_id = %L)$$, :'sa', :OWNER_A));

-- ============================================================
-- 4. What a business admin can do
-- ============================================================
SELECT tests.check('BA: every permission except billing.manage and ownership',
  format($$SELECT bool_and(CASE WHEN k IN ('billing.manage', 'ownership') THEN NOT v::boolean ELSE v::boolean END)
          FROM jsonb_each_text(pg_temp.perms(%L, %L)) AS e(k, v)$$, :'sa', :BA));
SELECT tests.check('BA: the plan / subscription details are the owner''s — BA sees only what a manager sees (active, units)',
  format($$SELECT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(
                     pg_temp.call(%1$L, %2$L, 'SELECT hospitality.management_context()') -> 'entitlements') k)
                  = ARRAY['active', 'max_units', 'units_used']
             AND (SELECT count(*) FROM jsonb_object_keys(
                     pg_temp.call(%1$L, %3$L, 'SELECT hospitality.management_context()') -> 'entitlements')) > 3$$,
         :'sa', :BA, :OWNER_A));
SELECT pg_temp.after('BA: sees the whole team with emails and last sign-in',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_members()')$$, :'sa', :BA),
  $$SELECT jsonb_array_length($1 -> 'members') = 4
       AND (SELECT bool_and(m ? 'email' AND m ? 'last_sign_in_at') FROM jsonb_array_elements($1 -> 'members') m)$$);
SELECT pg_temp.after('BA: sees the activity log',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_activity(30)')$$, :'sa', :BA),
  $$SELECT jsonb_typeof($1) = 'array' AND jsonb_array_length($1) >= 1$$);
SELECT pg_temp.after('BA: adds a manager (through the team function; logged with BA as the actor)',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_add_manager(''h188.new@test.local'', ''חדש'')')$$, :'sa', :BA),
  format($$SELECT $1 ->> 'status' = 'added'
             AND EXISTS (SELECT 1 FROM public.user_roles WHERE tenant_id = %1$L AND user_id = %2$L AND role = 'admin' AND NOT is_protected)
             AND EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id = %1$L AND action = 'team.manager_added' AND actor_id = %3$L)$$,
         :'sa', :NEW_A, :BA));
SELECT tests.check('BA: the manager BA added gets no grant (base manager permissions only)',
  format($$SELECT NOT EXISTS (SELECT 1 FROM hospitality.staff_grants WHERE tenant_id = %L AND user_id = %L)
             AND NOT (pg_temp.perms(%L, %L) ->> 'guests.privacy')::boolean$$, :'sa', :NEW_A, :'sa', :NEW_A));
SELECT pg_temp.after('BA: gives finance and documents to a regular manager',
  format($$SELECT to_jsonb(ARRAY[
             pg_temp.fn(%1$L, %2$L, 'team_set_finance', %3$L, true),
             pg_temp.fn(%1$L, %2$L, 'team_set_contracts', %3$L, true)])$$,
         :'sa', :BA, :M2),
  format($$SELECT (SELECT count(*) FROM hospitality.staff_grants WHERE tenant_id = %L AND user_id = %L
                     AND permission IN ('reports.finance', 'contracts')) = 2$$, :'sa', :M2));
SELECT pg_temp.after('BA: removes a regular manager (through the team function)',
  format($$SELECT pg_temp.fn(%L, %L, 'team_remove_manager', %L)$$,
         :'sa', :BA, :NEW_A),
  format($$SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE tenant_id = %L AND user_id = %L)$$, :'sa', :NEW_A));

-- ============================================================
-- 5. What stays the owner's
-- ============================================================
SELECT pg_temp.expect_error('BA: cannot appoint another business admin',
  format($$SELECT pg_temp.fn(%L, %L, 'team_set_business_admin', %L, true)$$,
         :'sa', :BA, :M2), 'הרשאה');
SELECT pg_temp.expect_error('BA: cannot revoke their own appointment either',
  format($$SELECT pg_temp.fn(%L, %L, 'team_set_business_admin', %L, false)$$,
         :'sa', :BA, :BA), 'הרשאה');
SELECT pg_temp.expect_error('BA: cannot remove the owner',
  format($$SELECT pg_temp.fn(%L, %L, 'team_remove_manager', %L)$$,
         :'sa', :BA, :OWNER_A), 'בעל העסק');
SELECT pg_temp.call(:'sa', :OWNER_A, format('SELECT hospitality.team_set_business_admin(%L, true)', :M2)) IS NOT NULL AS ok \gset
SELECT pg_temp.expect_error('BA: cannot remove another business admin (owner only)',
  format($$SELECT pg_temp.fn(%L, %L, 'team_remove_manager', %L)$$,
         :'sa', :BA, :M2), 'רק בעל העסק יכול להסיר מנהל/ת עסק');
SELECT pg_temp.expect_error('BA: no separate finance switch for a business admin (already has everything)',
  format($$SELECT pg_temp.fn(%L, %L, 'team_set_finance', %L, false)$$,
         :'sa', :BA, :M2), 'כבר את כל ההרשאות');
SELECT pg_temp.call(:'sa', :OWNER_A, format('SELECT hospitality.team_set_business_admin(%L, false)', :M2)) IS NOT NULL AS ok \gset

-- ============================================================
-- 6. The table directly — still closed (only through the team functions)
-- ============================================================
SELECT pg_temp.expect_error('BA: a direct delete of a manager row is refused (no team-function mark)',
  format($$SELECT pg_temp.dml(%L, %L, %L)$$, :'sa', :BA,
         format('DELETE FROM public.user_roles WHERE tenant_id = %L AND user_id = %L', :'sa', :M2)), 'רק בעל החנות');
SELECT pg_temp.expect_error('BA: a direct insert of a manager row is refused (the role guard — no team-function mark)',
  format($$SELECT pg_temp.dml(%L, %L, %L)$$, :'sa', :BA,
         format('INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved) VALUES (%L, %L, %L, %L, true)',
                :'sa', :NEW_A, 'x@test.local', 'admin')), 'רק בעל החנות');
SELECT pg_temp.expect_error('BA: a direct change to another manager''s row is refused (zimmer rule — owner only)',
  format($$SELECT pg_temp.dml(%L, %L, %L)$$, :'sa', :BA,
         format('UPDATE public.user_roles SET display_name = %L WHERE tenant_id = %L AND user_id = %L', 'x', :'sa', :M2)), 'רק בעל העסק');
SELECT tests.check('BA: M2 is still a manager after the refused direct writes',
  format($$SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE tenant_id = %L AND user_id = %L AND role = 'admin' AND display_name IS NULL)$$, :'sa', :M2));

-- ============================================================
-- 7. Per business and per account
-- ============================================================
SELECT tests.check('BA in business B (a regular manager there): regular permissions only',
  format($$SELECT NOT (p ->> 'guests.privacy')::boolean AND NOT (p ->> 'staff.managers')::boolean
             AND NOT (p ->> 'reports.finance')::boolean AND (p ->> 'bookings')::boolean
          FROM pg_temp.perms(%L, %L) p$$, :'sb', :BA));
SELECT pg_temp.expect_error('BA in business B: the team is closed',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.team_members()')$$, :'sb', :BA), 'הרשאה');
SELECT pg_temp.expect_error('BA in business B: cannot remove B''s managers',
  format($$SELECT pg_temp.fn(%L, %L, 'team_remove_manager', %L)$$,
         :'sb', :BA, :OWNER_B), 'הרשאה');
SELECT pg_temp.expect_error('BA in business C (no role there): no management access at all',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.management_context()')$$, :'sc', :BA), '');
SELECT tests.check('BA: the only business-admin grant is in business A',
  format($$SELECT array_agg(tenant_id) = ARRAY[%L::uuid] FROM hospitality.staff_grants
            WHERE user_id = %L AND permission = 'business.admin'$$, :'sa', :BA));
SELECT tests.check('BA: the same person''s second account (a manager in A) has regular permissions only',
  format($$SELECT NOT (p ->> 'guests.privacy')::boolean AND NOT (p ->> 'staff.managers')::boolean
          FROM pg_temp.perms(%L, %L) p$$, :'sa', :BA2));
SELECT pg_temp.expect_error('BA: a call that names business A while on business B''s address acts on B (tenant from the request)',
  format($$SELECT pg_temp.fn(%L, %L, 'team_set_finance', %L, true)$$,
         :'sb', :BA, :M2), '');

-- ============================================================
-- 8. Revoke — at once; removal by the owner clears the grant
-- ============================================================
SELECT pg_temp.call(:'sa', :OWNER_A, format('SELECT hospitality.team_set_business_admin(%L, false)', :BA)) IS NOT NULL AS ok \gset
SELECT tests.check('BA revoked: back to a regular manager at the next call; revocation logged',
  format($$SELECT NOT (pg_temp.perms(%1$L, %2$L) ->> 'guests.privacy')::boolean
             AND NOT (pg_temp.perms(%1$L, %2$L) ->> 'staff.managers')::boolean
             AND EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id = %1$L AND action = 'team.business_admin_revoked')$$,
         :'sa', :BA));
SELECT pg_temp.call(:'sa', :OWNER_A, format('SELECT hospitality.team_set_business_admin(%L, true)', :BA)) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'sa', :OWNER_A, format('SELECT to_jsonb(hospitality.team_remove_manager(%L))', :BA)) IS NOT NULL AS ok \gset
SELECT tests.check('BA removed by the owner: no role and no grant left in A; B untouched',
  format($$SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE tenant_id = %1$L AND user_id = %2$L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.staff_grants WHERE tenant_id = %1$L AND user_id = %2$L)
             AND EXISTS (SELECT 1 FROM public.user_roles WHERE tenant_id = %3$L AND user_id = %2$L)$$,
         :'sa', :BA, :'sb'));
SELECT pg_temp.expect_error('BA: the owner cannot "appoint" themselves (already the owner)',
  format($$SELECT pg_temp.fn(%L, %L, 'team_set_business_admin', %L, true)$$,
         :'sa', :OWNER_A, :OWNER_A), 'כבר הבעלים');

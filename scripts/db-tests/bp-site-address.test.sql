-- ============================================================
-- Nuriel Websites — the site's address and the site file (migration 197)
--   • the owner checks and changes the Nuriel subdomain: format, reserved, taken (another site / another site's
--     old address), 3 changes in 30 days; the site stays the same row; the old address redirects for a year
--   • another business, a content manager and a guest cannot read or change the address
--   • custom domain: saved as pending; only our server (service_role) records the DNS + ownership (TXT) check;
--     verified only when both pass; the www / bare form redirects only after it passes too; another site cannot
--     take the domain; removing it clears the redirect
--   • the certificate agent gets the old subdomain (no site id) and the second form of the custom domain
--   • the audit log: every draft save (which parts changed), a platform admin's actions are marked
--   • the site file in the platform panel: platform admin only; addresses, state, merged log with actors
-- ============================================================
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set A_OWNER1 '''a0000000-0000-0000-0000-0000000197a1'''
\set A_OWNER2 '''a0000000-0000-0000-0000-0000000197a2'''
\set A_MGR '''a0000000-0000-0000-0000-0000000197a3'''

CREATE OR REPLACE FUNCTION pg_temp.as_user(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
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
CREATE OR REPLACE FUNCTION pg_temp.user_err(_site text, _uid uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE e text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_user(_site, _uid, _sql);
  EXCEPTION WHEN OTHERS THEN e := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN e;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.as_service(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE service_role;
  EXECUTE _sql INTO r;
  RESET ROLE;
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.doc(_title text DEFAULT 'שלום') RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('schema', 1, 'template', 'elegant', 'locales', '["he"]'::jsonb,
           'business', jsonb_build_object('name', jsonb_build_object('he', _title)),
           'pages', jsonb_build_array(jsonb_build_object('id', 'home', 'slug', '', 'blocks', '[]'::jsonb)));
$f$;

INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data) VALUES
  (:A_OWNER1, 'addr.owner1@test.local', now(), '{"platform": "true"}'),
  (:A_OWNER2, 'addr.owner2@test.local', now(), '{"platform": "true"}'),
  (:A_MGR, 'addr.mgr@test.local', now(), '{"platform": "true"}')
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('business_profile_enabled', true),
       public.platform_set_flag('business_profile_public', true)])$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT public.platform_bp_open_site('addr-one', 'כתובת אחד', 'addr.owner1@test.local', %L)$$, pg_temp.doc())) ->> 'id' AS a1 \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT public.platform_bp_open_site('addr-two', 'כתובת שתיים', 'addr.owner2@test.local', %L)$$, pg_temp.doc())) ->> 'id' AS a2 \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved, is_protected)
VALUES (:'a1', :A_MGR, 'addr.mgr@test.local', 'admin', true, false);

-- ============================================================
-- 1. Who may call what
-- ============================================================
SELECT tests.check('bp address: the redirect table is closed to API users; the server reads it; the check result is for our server only',
  $$SELECT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.tenant_host_redirects'::regclass)
       AND (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'business_profile.domain_settings'::regclass)
       AND NOT has_table_privilege('anon', 'public.tenant_host_redirects', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'public.tenant_host_redirects', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'business_profile.domain_settings', 'SELECT')
       AND has_function_privilege('service_role', 'public.tenant_redirect_for_host(text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.tenant_redirect_for_host(text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.tenant_redirect_for_host(text)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.bp_custom_domain_record_check(uuid,text,boolean,boolean,text,boolean,text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.bp_custom_domain_record_check(uuid,text,boolean,boolean,text,boolean,text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.bp_slug_change(text,text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.platform_bp_site_file(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'business_profile._address_json(uuid)', 'EXECUTE')$$);
SELECT tests.check('bp address: a content manager, another business and a guest cannot read the address settings',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, 'SELECT public.bp_address_state()') LIKE 'אין הרשאה%%'
             AND pg_temp.user_err(%1$L, %3$L, 'SELECT public.bp_address_state()') LIKE 'אין הרשאה%%'
             AND pg_temp.user_err(%1$L, NULL, 'SELECT public.bp_address_state()') IS NOT NULL
             AND pg_temp.user_err(%1$L, %2$L, 'SELECT public.bp_slug_change(''x-new'', ''addr-one'')') LIKE 'אין הרשאה%%'
             AND pg_temp.user_err(%1$L, %3$L, 'SELECT public.bp_custom_domain_set(''example.com'', true)') LIKE 'אין הרשאה%%'$$,
         :'a1', :A_MGR, :A_OWNER2));
SELECT tests.check('bp address: the owner sees the current address and a TXT token for ownership',
  format($$SELECT (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_address_state()') ->> 'slug') = 'addr-one'
             AND (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_address_state()') ->> 'verify_token') ~ '^[0-9a-f]{32}$'$$,
         :'a1', :A_OWNER1));

-- ============================================================
-- 2. Availability
-- ============================================================
SELECT tests.check('bp address: free / same / invalid / reserved / taken',
  format($$SELECT (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_slug_check(''addr-new'')') ->> 'available')::boolean
             AND (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_slug_check(''addr-one'')') ->> 'reason') = 'same'
             AND NOT (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_slug_check(''-bad'')') ->> 'available')::boolean
             AND NOT (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_slug_check(''a--b'')') ->> 'available')::boolean
             AND NOT (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_slug_check(''ab'')') ->> 'available')::boolean
             AND (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_slug_check(''www'')') ->> 'message') LIKE '%%שמורה%%'
             AND (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_slug_check(''portal'')') ->> 'message') LIKE '%%שמורה%%'
             AND (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_slug_check(''nuriel-shop'')') ->> 'message') LIKE '%%שמורה%%'
             AND (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_slug_check(''api-x'')') ->> 'message') LIKE '%%שמורה%%'
             AND (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_slug_check(''addr-two'')') ->> 'message') = 'הכתובת הזו כבר תפוסה'$$,
         :'a1', :A_OWNER1));

-- ============================================================
-- 3. Changing the subdomain
-- ============================================================
SELECT pg_temp.as_user(:'a1', :A_OWNER1, $$SELECT public.bp_slug_change('addr-renamed', 'addr-one')$$) AS ch1 \gset
SELECT tests.check('bp address: the change keeps the same site (same id, draft, media) — only the address changes',
  format($$SELECT (%1$L::jsonb ->> 'slug') = 'addr-renamed'
             AND (SELECT slug FROM public.tenants WHERE id = %2$L) = 'addr-renamed'
             AND (SELECT count(*) FROM business_profile.site_versions WHERE tenant_id = %2$L AND state = 'draft') = 1
             AND (SELECT count(*) FROM public.tenants WHERE slug IN ('addr-one', 'addr-renamed')) = 1$$,
         :'ch1', :'a1'));
SELECT tests.check('bp address: the old address redirects to the site for a year; the new one is the site itself',
  format($$SELECT (SELECT tenant_id FROM public.tenant_redirect_for_host('addr-one.nuri1.fit')) = %1$L
             AND (SELECT kind FROM public.tenant_redirect_for_host('ADDR-ONE.nuri1.fit:443')) = 'old_slug'
             AND (SELECT count(*) FROM public.tenant_redirect_for_host('addr-renamed.nuri1.fit')) = 0
             AND (SELECT count(*) FROM public.tenant_redirect_for_host('addr-one')) = 0
             AND (SELECT expires_at BETWEEN now() + interval '364 days' AND now() + interval '366 days'
                    FROM public.tenant_host_redirects WHERE kind = 'old_slug' AND name = 'addr-one')
             AND public.tenant_for_host('addr-renamed.nuri1.fit') = %1$L$$,
         :'a1'));
SELECT tests.check('bp address: the old address cannot be taken by another site (or a new store) while it redirects',
  format($$SELECT (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_slug_check(''addr-one'')') ->> 'message') = 'הכתובת הזו כבר תפוסה'
             AND public.tenant_slug_problem('addr-one') LIKE '%%שייכת עדיין לאתר אחר%%'
             AND pg_temp.user_err(%1$L, %2$L, 'SELECT public.bp_slug_change(''addr-one'', ''addr-two'')') = 'הכתובת הזו כבר תפוסה'$$,
         :'a2', :A_OWNER2));
SELECT tests.check('bp address: the certificate agent keeps a certificate for the old subdomain (no site id — not counted as the site''s)',
  $$SELECT EXISTS (SELECT 1 FROM public.ssl_agent_targets() x
                    WHERE x.kind = 'alias' AND x.slug = 'addr-one' AND x.tenant_id IS NULL AND NOT x.is_default)
       AND NOT EXISTS (SELECT 1 FROM public.ssl_agent_targets() x WHERE x.kind = 'alias' AND x.slug = 'addr-renamed')$$);
SELECT tests.check('bp address: a stale tab (wrong current address) is refused; the same address is a no-op',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, 'SELECT public.bp_slug_change(''addr-x'', ''addr-one'')') LIKE 'כתובת האתר השתנתה%%'
             AND (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_slug_change(''addr-renamed'', ''addr-renamed'')') ->> 'slug') = 'addr-renamed'$$,
         :'a1', :A_OWNER1));
SELECT pg_temp.as_user(:'a1', :A_OWNER1, $$SELECT public.bp_slug_change('addr-one', 'addr-renamed')$$) AS ch2 \gset
SELECT tests.check('bp address: going back to its own old address works — that redirect is removed, the other one added',
  format($$SELECT (%1$L::jsonb ->> 'slug') = 'addr-one'
             AND NOT EXISTS (SELECT 1 FROM public.tenant_host_redirects WHERE kind = 'old_slug' AND name = 'addr-one')
             AND EXISTS (SELECT 1 FROM public.tenant_host_redirects WHERE kind = 'old_slug' AND name = 'addr-renamed'
                           AND tenant_id = %2$L)
             AND jsonb_array_length(%1$L::jsonb -> 'old_slugs') = 1$$,
         :'ch2', :'a1'));
SELECT pg_temp.as_user(:'a1', :A_OWNER1, $$SELECT public.bp_slug_change('addr-third', 'addr-one')$$) IS NOT NULL AS ok \gset
SELECT tests.check('bp address: at most 3 changes in 30 days; every change is in both logs (from → to)',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, 'SELECT public.bp_slug_change(''addr-fourth'', ''addr-third'')') LIKE 'אפשר לשנות את כתובת האתר עד 3 פעמים%%'
             AND (SELECT count(*) FROM business_profile.audit_log WHERE tenant_id = %1$L AND action = 'site.address_changed') = 3
             AND (SELECT details ->> 'from' || '>' || (details ->> 'to') FROM business_profile.audit_log
                   WHERE tenant_id = %1$L AND action = 'site.address_changed' ORDER BY id LIMIT 1) = 'addr-one>addr-renamed'
             AND (SELECT count(*) FROM public.platform_audit_log WHERE tenant_id = %1$L AND action = 'bp_site_address_changed') = 3$$,
         :'a1', :A_OWNER1));
SELECT pg_temp.as_user(:'a2', :PLATFORM, $$SELECT public.bp_slug_change('addr-two-b', 'addr-two')$$) AS ch3 \gset
SELECT tests.check('bp address: a platform admin can change it too (in the studio) — marked as a platform admin action',
  format($$SELECT (%1$L::jsonb ->> 'slug') = 'addr-two-b'
             AND (SELECT details ->> 'via' FROM business_profile.audit_log WHERE tenant_id = %2$L
                   AND action = 'site.address_changed' ORDER BY id DESC LIMIT 1) = 'platform_admin'$$,
         :'ch3', :'a2'));

-- ============================================================
-- 4. Custom domain
-- ============================================================
SELECT pg_temp.as_user(:'a1', :A_OWNER1, $$SELECT public.bp_custom_domain_set('www.addr-one-test.co.il', true)$$) AS cd1 \gset
SELECT tests.check('bp address: a custom domain is saved as pending — not routed until checked',
  format($$SELECT (%1$L::jsonb ->> 'custom_domain') = 'www.addr-one-test.co.il'
             AND (%1$L::jsonb ->> 'custom_domain_status') = 'pending'
             AND public.tenant_for_host('www.addr-one-test.co.il') IS DISTINCT FROM %2$L
             AND NOT EXISTS (SELECT 1 FROM public.custom_domain_targets() WHERE custom_domain = 'www.addr-one-test.co.il')$$,
         :'cd1', :'a1'));
SELECT tests.check('bp address: invalid / taken domains are refused; another site cannot take it',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, 'SELECT public.bp_custom_domain_set(''not a domain'', true)') LIKE 'הדומיין לא תקין%%'
             AND pg_temp.user_err(%3$L, %4$L, 'SELECT public.bp_custom_domain_set(''www.addr-one-test.co.il'', true)') = 'הדומיין הזה כבר מחובר לאתר אחר במערכת'$$,
         :'a1', :A_OWNER1, :'a2', :A_OWNER2));
SELECT pg_temp.as_service(format($$SELECT public.bp_custom_domain_record_check(%L, 'www.addr-one-test.co.il', false, true, 'addr-one-test.co.il', true, 'לא נמצאה רשומת TXT')$$, :'a1')) AS chk1 \gset
SELECT tests.check('bp address: DNS ok but no ownership (TXT) → not verified, the reason is shown, no redirect',
  format($$SELECT (%1$L::jsonb ->> 'custom_domain_status') = 'error'
             AND (%1$L::jsonb ->> 'custom_domain_error') = 'לא נמצאה רשומת TXT'
             AND (%1$L::jsonb ->> 'ownership_verified_at') IS NULL
             AND (%1$L::jsonb ->> 'alternate') IS NULL
             AND public.tenant_for_host('www.addr-one-test.co.il') IS DISTINCT FROM %2$L$$,
         :'chk1', :'a1'));
SELECT pg_temp.as_service(format($$SELECT public.bp_custom_domain_record_check(%L, 'www.addr-one-test.co.il', true, true, 'addr-one-test.co.il', true, 'הכול תקין')$$, :'a1')) AS chk2 \gset
SELECT tests.check('bp address: ownership + DNS ok → verified and routed; the bare form redirects; the agent gets both for certificates',
  format($$SELECT (%1$L::jsonb ->> 'custom_domain_status') = 'verified'
             AND (%1$L::jsonb ->> 'ownership_domain') = 'www.addr-one-test.co.il'
             AND (%1$L::jsonb ->> 'alternate') = 'addr-one-test.co.il'
             AND public.tenant_for_host('www.addr-one-test.co.il') = %2$L
             AND (SELECT tenant_id FROM public.tenant_redirect_for_host('addr-one-test.co.il')) = %2$L
             AND (SELECT kind FROM public.tenant_redirect_for_host('addr-one-test.co.il')) = 'custom_alternate'
             AND (SELECT count(*) FROM public.custom_domain_targets()
                   WHERE custom_domain IN ('www.addr-one-test.co.il', 'addr-one-test.co.il') AND tenant_id = %2$L) = 2$$,
         :'chk2', :'a1'));
SELECT tests.check('bp address: only the server records checks; a stale result (domain changed meanwhile) changes nothing',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_custom_domain_record_check(%%L, ''www.addr-one-test.co.il'', true, true, NULL, false, '''')', %1$L)) IS NOT NULL
             AND (pg_temp.as_service(format('SELECT public.bp_custom_domain_record_check(%%L, ''other.example.com'', false, false, NULL, false, ''x'')', %1$L)) ->> 'custom_domain_status') = 'verified'$$,
         :'a1', :A_OWNER1));
SELECT tests.check('bp address: another site cannot take the bare form either',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, 'SELECT public.bp_custom_domain_set(''addr-one-test.co.il'', true)') = 'הדומיין הזה כבר מחובר לאתר אחר במערכת'$$,
         :'a2', :A_OWNER2));
SELECT pg_temp.as_user(:'a1', :A_OWNER1, $$SELECT public.bp_custom_domain_set('www.addr-one-test.co.il', false)$$) AS cd2 \gset
SELECT tests.check('bp address: turning off the second form removes its redirect (the domain stays verified)',
  format($$SELECT (%1$L::jsonb ->> 'custom_domain_status') = 'verified' AND (%1$L::jsonb ->> 'alternate') IS NULL
             AND (SELECT count(*) FROM public.tenant_redirect_for_host('addr-one-test.co.il')) = 0$$,
         :'cd2'));
SELECT pg_temp.as_user(:'a1', :A_OWNER1, $$SELECT public.bp_custom_domain_set('', true)$$) AS cd3 \gset
SELECT tests.check('bp address: removing the domain — not routed any more, ownership cleared, logged',
  format($$SELECT (%1$L::jsonb ->> 'custom_domain') IS NULL AND (%1$L::jsonb ->> 'ownership_domain') IS NULL
             AND public.tenant_for_host('www.addr-one-test.co.il') IS DISTINCT FROM %2$L
             AND EXISTS (SELECT 1 FROM business_profile.audit_log WHERE tenant_id = %2$L AND action = 'site.custom_domain_removed')
             AND EXISTS (SELECT 1 FROM business_profile.audit_log WHERE tenant_id = %2$L AND action = 'site.custom_domain_checked'
                           AND (details ->> 'ok')::boolean)$$,
         :'cd3', :'a1'));

-- ============================================================
-- 5. The audit log: draft saves, platform admin marked
-- ============================================================
SELECT revision AS rev1 FROM business_profile.site_versions WHERE tenant_id = :'a2' AND state = 'draft' \gset
SELECT pg_temp.as_user(:'a2', :PLATFORM, format($$SELECT public.bp_draft_save(%L, %s)$$, pg_temp.doc('שינוי של המנהל'), :rev1)) AS sv1 \gset
SELECT tests.check('bp address: a draft save is in the log — which parts changed, the revision, and that a platform admin did it',
  format($$SELECT (SELECT (details -> 'changed') ? 'business' AND NOT (details -> 'changed') ? 'pages'
                         AND (details ->> 'revision')::int = (%1$L::jsonb ->> 'revision')::int
                         AND details ->> 'via' = 'platform_admin' AND actor_id = %3$L
                    FROM business_profile.audit_log WHERE tenant_id = %2$L AND action = 'draft.saved'
                   ORDER BY id DESC LIMIT 1)
             AND NOT (SELECT details::text LIKE '%%שינוי של המנהל%%' FROM business_profile.audit_log
                       WHERE tenant_id = %2$L AND action = 'draft.saved' ORDER BY id DESC LIMIT 1)$$,
         :'sv1', :'a2', :PLATFORM));
SELECT revision AS rev2 FROM business_profile.site_versions WHERE tenant_id = :'a2' AND state = 'draft' \gset
SELECT pg_temp.as_user(:'a2', :A_OWNER2, format($$SELECT public.bp_draft_save(%L, %s)$$, pg_temp.doc('שינוי של הבעלים'), :rev2)) IS NOT NULL AS ok \gset
SELECT tests.check('bp address: the owner''s save is logged without the platform admin mark',
  format($$SELECT (SELECT details ->> 'via' IS NULL AND actor_id = %2$L FROM business_profile.audit_log
                    WHERE tenant_id = %1$L AND action = 'draft.saved' ORDER BY id DESC LIMIT 1)$$,
         :'a2', :A_OWNER2));

-- ============================================================
-- 6. The site file in the platform panel
-- ============================================================
SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT public.platform_bp_site_file(%L)$$, :'a2')) AS f2 \gset
SELECT tests.check('bp address: the site file — address, old addresses, owner, draft, state and the merged log with who did what',
  format($$SELECT (%1$L::jsonb ->> 'slug') = 'addr-two-b'
             AND (%1$L::jsonb -> 'address' -> 'old_slugs' -> 0 ->> 'name') = 'addr-two'
             AND (%1$L::jsonb -> 'owner' ->> 'email') = 'addr.owner2@test.local'
             AND (%1$L::jsonb -> 'draft' ->> 'updated_by') = 'addr.owner2@test.local'
             AND (%1$L::jsonb -> 'state' ->> 'status') = 'draft'
             AND (%1$L::jsonb -> 'audit' -> 0 ->> 'action') = 'draft.saved'
             AND (%1$L::jsonb -> 'audit' -> 0 ->> 'actor') = 'addr.owner2@test.local'
             AND NOT (%1$L::jsonb -> 'audit' -> 0 ->> 'platform_admin')::boolean
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb -> 'audit') e
                          WHERE e ->> 'action' = 'draft.saved' AND (e ->> 'platform_admin')::boolean
                            AND e ->> 'actor' = 'platform@test.local')
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb -> 'audit') e
                          WHERE e ->> 'source' = 'platform' AND e ->> 'action' = 'bp_site_opened')$$,
         :'f2'));
SELECT tests.check('bp address: the site file is for the platform admin only (owner, guest: refused; a store id: nothing)',
  format($$SELECT pg_temp.user_err(NULL, %1$L, format('SELECT public.platform_bp_site_file(%%L)', %2$L)) IS NOT NULL
             AND pg_temp.user_err(NULL, NULL, format('SELECT public.platform_bp_site_file(%%L)', %2$L)) IS NOT NULL
             AND pg_temp.as_user(NULL, %3$L, format('SELECT public.platform_bp_site_file(%%L)', (SELECT id FROM public.tenants WHERE site_type = 'ecommerce' LIMIT 1))) IS NULL$$,
         :A_OWNER2, :'a2', :PLATFORM));

-- ---------- cleanup ----------
SET session_replication_role = replica;
DELETE FROM public.tenant_host_redirects WHERE tenant_id IN (:'a1', :'a2');
DELETE FROM business_profile.domain_settings WHERE tenant_id IN (:'a1', :'a2');
DELETE FROM public.user_roles WHERE tenant_id IN (:'a1', :'a2');
DELETE FROM business_profile.audit_log WHERE tenant_id IN (:'a1', :'a2');
DELETE FROM business_profile.sites WHERE tenant_id IN (:'a1', :'a2');
DELETE FROM business_profile.site_versions WHERE tenant_id IN (:'a1', :'a2');
DELETE FROM public.tenant_feature_flags WHERE tenant_id IN (:'a1', :'a2');
DELETE FROM public.site_settings WHERE tenant_id IN (:'a1', :'a2');
DELETE FROM public.email_settings WHERE tenant_id IN (:'a1', :'a2');
DELETE FROM public.platform_audit_log WHERE tenant_id IN (:'a1', :'a2');
DELETE FROM public.tenants WHERE id IN (:'a1', :'a2');
SET session_replication_role = origin;
DELETE FROM auth.users WHERE id IN (:A_OWNER1, :A_OWNER2, :A_MGR);

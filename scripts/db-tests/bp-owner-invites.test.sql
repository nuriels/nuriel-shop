-- ============================================================
-- Nuriel Websites — inviting the site owner by a one-time link (migration 198)
--   • only the platform admin creates / revokes / reads invites; the table is closed to API users
--   • only the hash is stored; one open invite per site; a new one revokes the previous; 72 hours by default
--   • the server checks a link: unknown / another site's → "invalid" (nothing revealed); expired / revoked / used /
--     the site already has an owner → that status; every failure is in the platform log (+ the site's log)
--   • redeeming: once only, only on the invite's own site, only a brand-new account (no roles anywhere), never a
--     platform admin; it grants the site owner role on THIS site only + a 2-minute owner sign-in code
--   • after redeeming no other invite can be created; the owner is not a platform admin and has no other site
--   • the email is not "verified" until the right code sent to the inbox comes back (HMAC only, 30 s between
--     codes, 5 attempts); only the server issues / checks codes; a verified account is marked trusted (SEC-H1)
-- ============================================================
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set I_NEW '''a0000000-0000-0000-0000-0000000198a1'''
\set I_NEW2 '''a0000000-0000-0000-0000-0000000198a2'''
\set I_CUSTOMER '''a0000000-0000-0000-0000-0000000198a3'''
\set I_OTHER_OWNER '''a0000000-0000-0000-0000-0000000198a4'''

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
CREATE OR REPLACE FUNCTION pg_temp.h(_s text) RETURNS text LANGUAGE sql AS $f$
  SELECT encode(sha256(convert_to(_s, 'UTF8')), 'hex');
$f$;

INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data) VALUES
  (:I_NEW, 'invite.new@test.local', now(), '{}'),
  (:I_NEW2, 'invite.new2@test.local', now(), '{}'),
  (:I_CUSTOMER, 'invite.customer@test.local', now(), '{"platform": "true"}'),
  (:I_OTHER_OWNER, 'invite.other@test.local', now(), '{"platform": "true"}')
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT to_jsonb(public.platform_set_flag('business_profile_enabled', true))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT public.platform_bp_open_site('inv-one', 'הזמנה אחד')$$) ->> 'id' AS s1 \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT public.platform_bp_open_site('inv-two', 'הזמנה שתיים', 'invite.other@test.local')$$) ->> 'id' AS s2 \gset
SELECT id AS store FROM public.tenants WHERE is_default LIMIT 1 \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved)
VALUES (:'store', :I_CUSTOMER, 'invite.customer@test.local', 'customer', true);

-- ============================================================
-- 1. Who may call what
-- ============================================================
SELECT tests.check('bp invites: the table is closed to API users (RLS on, no grants); only the hash column exists',
  $$SELECT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'business_profile.owner_invites'::regclass)
       AND NOT has_table_privilege('anon', 'business_profile.owner_invites', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'business_profile.owner_invites', 'SELECT')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'business_profile' AND table_name = 'owner_invites'
                          AND column_name IN ('token', 'code', 'link', 'url'))$$);

SELECT tests.check('bp invites: check / redeem / mark-verified are for our server only; create / revoke / state need a signed-in user',
  $$SELECT has_function_privilege('service_role', 'public.bp_invite_check(text, uuid, text)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.bp_invite_redeem(text, uuid, uuid, text, text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.bp_invite_check(text, uuid, text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.bp_invite_check(text, uuid, text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.bp_invite_redeem(text, uuid, uuid, text, text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.bp_owner_email_code_verify(uuid, uuid, text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.bp_owner_email_code_issue(uuid, uuid, text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.bp_invite_fail(text, uuid, text, text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.platform_bp_invite_create(uuid, text, integer)', 'EXECUTE')$$);

SELECT tests.check('bp invites: a site owner of another site / a store customer cannot create, revoke or read invites',
  format($$SELECT pg_temp.user_err(NULL, %L, format('SELECT public.platform_bp_invite_create(%%L, %%L)', %L, %L)) LIKE '%%מנהל הפלטפורמה%%'
            AND pg_temp.user_err(NULL, %L, format('SELECT public.platform_bp_invite_revoke(%%L)', %L)) LIKE '%%מנהל הפלטפורמה%%'
            AND pg_temp.user_err(NULL, %L, format('SELECT public.platform_bp_invite_state(%%L)', %L)) LIKE '%%מנהל הפלטפורמה%%'$$,
         :I_OTHER_OWNER, :'s1', pg_temp.h('x'),
         :I_CUSTOMER, :'s1',
         :I_OTHER_OWNER, :'s1'));

-- ============================================================
-- 2. Creating, replacing, revoking
-- ============================================================
SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT public.platform_bp_invite_create(%L, %L)$$, :'s1', pg_temp.h('tok-1'))) AS c1 \gset
SELECT tests.check('bp invites: created for 72 hours by default; only the hash is stored',
  format($$SELECT (SELECT expires_at - created_at FROM business_profile.owner_invites WHERE id = %L) = interval '72 hours'
            AND (SELECT token_hash FROM business_profile.owner_invites WHERE id = %L) = %L$$,
         (:'c1')::jsonb ->> 'id', (:'c1')::jsonb ->> 'id', pg_temp.h('tok-1')));

SELECT tests.check('bp invites: a site that already has an owner gets no invite; hours are 1–168; a malformed hash is refused',
  format($$SELECT pg_temp.user_err(NULL, %L, format('SELECT public.platform_bp_invite_create(%%L, %%L)', %L, %L)) LIKE '%%כבר יש בעלת אתר%%'
            AND pg_temp.user_err(NULL, %L, format('SELECT public.platform_bp_invite_create(%%L, %%L, 500)', %L, %L)) LIKE '%%1 עד 168%%'
            AND pg_temp.user_err(NULL, %L, format('SELECT public.platform_bp_invite_create(%%L, %%L)', %L, 'abc')) LIKE '%%לא תקין%%'$$,
         :PLATFORM, :'s2', pg_temp.h('tok-x'),
         :PLATFORM, :'s1', pg_temp.h('tok-y'),
         :PLATFORM, :'s1'));

SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT public.platform_bp_invite_create(%L, %L, 24)$$, :'s1', pg_temp.h('tok-2'))) AS c2 \gset
SELECT tests.check('bp invites: a new invite replaces the open one (revoked: replaced, logged); one open invite per site',
  format($$SELECT (SELECT revoke_reason FROM business_profile.owner_invites WHERE id = %L) = 'replaced'
            AND (SELECT count(*) FROM business_profile.owner_invites
                  WHERE tenant_id = %L AND used_at IS NULL AND revoked_at IS NULL) = 1
            AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'bp_owner_invite_revoked'
                          AND details ->> 'reason' = 'replaced' AND actor_id = %L)
            AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'bp_owner_invite_created'
                          AND (details ->> 'hours')::int = 24)$$,
         (:'c1')::jsonb ->> 'id', :'s1', :'s1', :PLATFORM, :'s1'));

SELECT pg_temp.as_service(format($$SELECT public.bp_invite_check(%L, %L)$$, pg_temp.h('tok-1'), :'s1')) ->> 'status' AS st_replaced \gset
SELECT tests.check('bp invites: the replaced link is "revoked" for the server (and the failure is logged)',
  format($$SELECT %L = 'revoked'
            AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'bp_owner_invite_failed'
                          AND details ->> 'reason' = 'revoked')$$,
         :'st_replaced', :'s1'));

SELECT pg_temp.as_service(format($$SELECT public.bp_invite_check(%L, %L, 'abcdef0123456789abcd')$$, pg_temp.h('nope'), :'s1')) AS ck_unknown \gset
SELECT pg_temp.as_service(format($$SELECT public.bp_invite_check(%L, %L)$$, pg_temp.h('tok-2'), :'s2')) AS ck_other \gset
SELECT tests.check('bp invites: an unknown link and another site''s link are both just "invalid" (logged, nothing revealed)',
  format($$SELECT %L::jsonb = '{"status": "invalid"}'::jsonb
            AND %L::jsonb = '{"status": "invalid"}'::jsonb
            AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id IS NULL AND action = 'bp_owner_invite_failed'
                          AND details ->> 'reason' = 'unknown' AND details ->> 'ip' = 'abcdef0123456789')
            AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'bp_owner_invite_failed'
                          AND details ->> 'reason' = 'wrong_site')$$,
         :'ck_unknown', :'ck_other', :'s1'));

SELECT tests.check('bp invites: a valid link shows only the business name and the expiry',
  format($$SELECT (pg_temp.as_service(format('SELECT public.bp_invite_check(%%L, %%L)', %L, %L)) - 'expires_at')
                  = '{"status": "valid", "site_name": "הזמנה אחד"}'::jsonb$$,
         pg_temp.h('tok-2'), :'s1'));

-- ============================================================
-- 3. Redeeming
-- ============================================================
SELECT pg_temp.as_service(format($$SELECT public.bp_invite_redeem(%L, %L, %L, %L)$$, pg_temp.h('tok-2'), :'s2', :I_NEW, pg_temp.h('hand-0'))) ->> 'reason' AS rd_other \gset
SELECT pg_temp.as_service(format($$SELECT public.bp_invite_redeem(%L, %L, %L, %L)$$, pg_temp.h('tok-2'), :'s1', :I_CUSTOMER, pg_temp.h('hand-1'))) ->> 'reason' AS rd_customer \gset
SELECT pg_temp.as_service(format($$SELECT public.bp_invite_redeem(%L, %L, %L, %L)$$, pg_temp.h('tok-2'), :'s1', :PLATFORM, pg_temp.h('hand-2'))) ->> 'reason' AS rd_admin \gset
SELECT tests.check('bp invites: redeeming on another site, or with a customer / a platform admin account, fails (logged) and grants nothing',
  format($$SELECT %L = 'invalid' AND %L = 'account_has_roles' AND %L = 'platform_admin_account'
            AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE tenant_id = %L)
            AND (SELECT count(*) FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'bp_owner_invite_failed'
                   AND details ->> 'stage' = 'redeem') = 3
            AND (SELECT used_at FROM business_profile.owner_invites WHERE token_hash = %L) IS NULL$$,
         :'rd_other', :'rd_customer', :'rd_admin', :'s1', :'s1', pg_temp.h('tok-2')));

SELECT pg_temp.as_service(format($$SELECT public.bp_invite_redeem(%L, %L, %L, %L, %L)$$,
       pg_temp.h('tok-2'), :'s1', :I_NEW, pg_temp.h('hand-ok'), 'abcdef0123456789abcd')) AS r1 \gset
SELECT tests.check('bp invites: a brand-new account becomes the owner of THIS site only, with a 2-minute owner sign-in code',
  format($$SELECT (%L::jsonb) @> '{"ok": true, "slug": "inv-one", "email": "invite.new@test.local"}'
            AND EXISTS (SELECT 1 FROM public.user_roles WHERE tenant_id = %L AND user_id = %L AND role = 'admin'
                          AND is_protected AND is_approved)
            AND (SELECT count(*) FROM public.user_roles WHERE user_id = %L) = 1
            AND NOT public.is_platform_admin(%L)
            AND (SELECT owner_email FROM public.tenants WHERE id = %L) = 'invite.new@test.local'
            AND EXISTS (SELECT 1 FROM public.platform_admin_handoffs WHERE token_hash = %L AND user_id = %L
                          AND tenant_id = %L AND kind = 'store_owner' AND used_at IS NULL
                          AND expires_at <= now() + interval '2 minutes')$$,
         :'r1', :'s1', :I_NEW, :I_NEW, :I_NEW, :'s1', pg_temp.h('hand-ok'), :I_NEW, :'s1'));

SELECT tests.check('bp invites: the redemption is logged in the platform log (actor = the new owner) and in the site log',
  format($$SELECT EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'bp_owner_invite_redeemed'
                          AND actor_id = %L AND actor_email = 'invite.new@test.local' AND details ->> 'ip' = 'abcdef0123456789')
            AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'bp_owner_set'
                          AND details ->> 'via' = 'invite')
            AND EXISTS (SELECT 1 FROM business_profile.audit_log WHERE tenant_id = %L AND action = 'owner_invite.redeemed'
                          AND actor_id = %L AND NOT details ? 'via')
            AND EXISTS (SELECT 1 FROM business_profile.audit_log WHERE tenant_id = %L AND action = 'site.owner_set')$$,
         :'s1', :I_NEW, :'s1', :'s1', :I_NEW, :'s1'));

SELECT tests.check('bp invites: the same link cannot be used again (another new account gets "used", nothing granted)',
  format($$SELECT pg_temp.as_service(format('SELECT public.bp_invite_redeem(%%L, %%L, %%L, %%L)', %L, %L, %L, %L)) ->> 'reason' = 'used'
            AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = %L)
            AND pg_temp.as_service(format('SELECT public.bp_invite_check(%%L, %%L)', %L, %L)) ->> 'status' = 'used'$$,
         pg_temp.h('tok-2'), :'s1', :I_NEW2, pg_temp.h('hand-3'), :I_NEW2, pg_temp.h('tok-2'), :'s1'));

SELECT tests.check('bp invites: after the owner is set no new invite can be made; the state shows the owner and the used invite',
  format($$SELECT pg_temp.user_err(NULL, %L, format('SELECT public.platform_bp_invite_create(%%L, %%L)', %L, %L)) LIKE '%%כבר יש בעלת אתר%%'
            AND (pg_temp.as_user(NULL, %L, format('SELECT public.platform_bp_invite_state(%%L)', %L))) @>
                '{"has_owner": true, "owner_email": "invite.new@test.local", "owner_via_invite": true, "open": null}'
            AND (pg_temp.as_user(NULL, %L, format('SELECT public.platform_bp_invite_state(%%L)', %L)) -> 'history' -> 0 ->> 'status') = 'used'$$,
         :PLATFORM, :'s1', pg_temp.h('tok-3'),
         :PLATFORM, :'s1', :PLATFORM, :'s1'));

-- ============================================================
-- 4. Expiry and revoke
-- ============================================================
-- (test only: remove the owner again, so new invites can be made for the same site)
SET session_replication_role = replica;
DELETE FROM public.user_roles WHERE tenant_id = :'s1' AND user_id = :I_NEW;
SET session_replication_role = origin;
SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT public.platform_bp_invite_create(%L, %L)$$, :'s1', pg_temp.h('tok-4'))) AS c4 \gset
UPDATE business_profile.owner_invites SET created_at = now() - interval '80 hours', expires_at = now() - interval '8 hours'
 WHERE id = ((:'c4')::jsonb ->> 'id')::uuid;
SELECT tests.check('bp invites: an expired link is "expired" and cannot be redeemed',
  format($$SELECT pg_temp.as_service(format('SELECT public.bp_invite_check(%%L, %%L)', %L, %L)) ->> 'status' = 'expired'
            AND pg_temp.as_service(format('SELECT public.bp_invite_redeem(%%L, %%L, %%L, %%L)', %L, %L, %L, %L)) ->> 'reason' = 'expired'
            AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = %L)$$,
         pg_temp.h('tok-4'), :'s1', pg_temp.h('tok-4'), :'s1', :I_NEW2, pg_temp.h('hand-4'), :I_NEW2));

SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT public.platform_bp_invite_create(%L, %L)$$, :'s1', pg_temp.h('tok-5'))) AS c5 \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT public.platform_bp_invite_revoke(%L)$$, :'s1')) AS rv \gset
SELECT tests.check('bp invites: revoking closes the open link (logged), and it can no longer be redeemed',
  format($$SELECT (%L::jsonb) ->> 'revoked' = '1'
            AND (SELECT revoke_reason FROM business_profile.owner_invites WHERE token_hash = %L) = 'revoked'
            AND pg_temp.as_service(format('SELECT public.bp_invite_redeem(%%L, %%L, %%L, %%L)', %L, %L, %L, %L)) ->> 'reason' = 'revoked'
            AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'bp_owner_invite_revoked'
                          AND details ->> 'reason' = 'revoked')$$,
         :'rv', pg_temp.h('tok-5'), pg_temp.h('tok-5'), :'s1', :I_NEW2, pg_temp.h('hand-5'), :'s1'));

-- ============================================================
-- 5. The email is not "verified" until a real code check
-- ============================================================
SELECT tests.check('bp invites: the redeemed email is unverified; the owner sees that only on her own site',
  format($$SELECT (pg_temp.as_user(%L, %L, 'SELECT public.bp_owner_email_status()')) @> '{"needed": true, "email": "invite.new@test.local"}'
            AND (pg_temp.as_user(%L, %L, 'SELECT public.bp_owner_email_status()')) = '{"needed": false}'::jsonb
            AND (pg_temp.as_user(%L, %L, 'SELECT public.bp_owner_email_status()')) = '{"needed": false}'::jsonb$$,
         :'s1', :I_NEW, :'s2', :I_NEW, :'s1', :I_NEW2));

SELECT pg_temp.user_err(:'s1', :I_NEW, format($$SELECT public.bp_owner_email_code_verify(%L, %L, %L)$$, :'s1', :I_NEW, pg_temp.h('123456'))) AS ev_user \gset
SELECT pg_temp.as_service(format($$SELECT public.bp_owner_email_code_issue(%L, %L, %L)$$, :'s1', :I_NEW, pg_temp.h('123456'))) AS ev_issue \gset
SELECT pg_temp.user_err(NULL, NULL, format($$SELECT pg_temp.as_service(format('SELECT public.bp_owner_email_code_issue(%%L, %%L, %%L)', %L, %L, %L))$$, :'s1', :I_NEW, pg_temp.h('654321'))) AS ev_again \gset
SELECT pg_temp.as_service(format($$SELECT public.bp_owner_email_code_verify(%L, %L, %L)$$, :'s1', :I_NEW, pg_temp.h('000000'))) AS ev_wrong \gset
SELECT pg_temp.as_service(format($$SELECT public.bp_owner_email_code_verify(%L, %L, %L)$$, :'s1', :I_NEW2, pg_temp.h('123456'))) AS ev_other_user \gset
SELECT tests.check('bp invites: a verification code is only for our server; a new one waits 30 s; a wrong code / another account does not verify',
  format($$SELECT %L LIKE '%%permission denied%%'
            AND %L::jsonb = '{"needed": true, "email": "invite.new@test.local"}'::jsonb
            AND %L LIKE '%%חצי דקה%%'
            AND %L::jsonb @> '{"result": "invalid", "left": 4}'
            AND %L::jsonb = '{"result": "none"}'::jsonb
            AND (SELECT email_verified_at FROM business_profile.owner_invites WHERE used_by = %L) IS NULL
            AND (SELECT verify_code_hash FROM business_profile.owner_invites WHERE used_by = %L) = %L$$,
         :'ev_user', :'ev_issue', :'ev_again', :'ev_wrong', :'ev_other_user', :I_NEW, :I_NEW, pg_temp.h('123456')));

SELECT pg_temp.as_service(format($$SELECT public.bp_owner_email_code_verify(%L, %L, %L)$$, :'s1', :I_NEW, pg_temp.h('123456'))) AS ev_ok \gset
SELECT tests.check('bp invites: the right code verifies the email (logged) and marks the account trusted (SEC-H1); no longer needed',
  format($$SELECT %L::jsonb = '{"result": "ok"}'::jsonb
            AND (SELECT email_verified_at FROM business_profile.owner_invites WHERE used_by = %L) IS NOT NULL
            AND (SELECT raw_app_meta_data ->> 'platform' FROM auth.users WHERE id = %L) = 'true'
            AND (pg_temp.as_user(%L, %L, 'SELECT public.bp_owner_email_status()')) ->> 'needed' = 'false'
            AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'bp_owner_email_verified')
            AND EXISTS (SELECT 1 FROM business_profile.audit_log WHERE tenant_id = %L AND action = 'owner.email_verified')$$,
         :'ev_ok', :I_NEW, :I_NEW, :'s1', :I_NEW, :'s1', :'s1'));

SELECT pg_temp.as_service(format($$SELECT to_jsonb(public.bp_invite_fail(%L, %L, 'email_exists', 'abcdef0123456789'))$$, pg_temp.h('tok-5'), :'s1')) IS NOT NULL AS ok \gset
SELECT tests.check('bp invites: a failure before redeeming (the email is already registered) is logged against the invite',
  format($$SELECT EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'bp_owner_invite_failed'
                            AND details ->> 'reason' = 'email_exists' AND details ? 'invite')$$, :'s1'));

-- ---------- cleanup ----------
SET session_replication_role = replica;
DELETE FROM public.platform_admin_handoffs WHERE tenant_id IN (:'s1', :'s2');
DELETE FROM business_profile.owner_invites WHERE tenant_id IN (:'s1', :'s2');
DELETE FROM public.user_roles WHERE tenant_id IN (:'s1', :'s2') OR user_id IN (:I_CUSTOMER);
DELETE FROM business_profile.audit_log WHERE tenant_id IN (:'s1', :'s2');
DELETE FROM business_profile.sites WHERE tenant_id IN (:'s1', :'s2');
DELETE FROM business_profile.site_versions WHERE tenant_id IN (:'s1', :'s2');
DELETE FROM business_profile.domain_settings WHERE tenant_id IN (:'s1', :'s2');
DELETE FROM public.tenant_feature_flags WHERE tenant_id IN (:'s1', :'s2');
DELETE FROM public.site_settings WHERE tenant_id IN (:'s1', :'s2');
DELETE FROM public.email_settings WHERE tenant_id IN (:'s1', :'s2');
DELETE FROM public.platform_audit_log WHERE tenant_id IN (:'s1', :'s2')
   OR (tenant_id IS NULL AND action = 'bp_owner_invite_failed');
DELETE FROM public.tenants WHERE id IN (:'s1', :'s2');
SET session_replication_role = origin;
DELETE FROM auth.users WHERE id IN (:I_NEW, :I_NEW2, :I_CUSTOMER, :I_OTHER_OWNER);

-- ============================================================
-- Billing & Agreements (migration 189): the shared platform financial layer — stores and zimmer sites
--   • agreements in versions (list price vs agreed price, cycle, setup fee, commitment, VAT), the old
--     version is kept; the list price never changes for one customer
--   • the append-only ledger: charges, payments (partial), credits, reversals; VAT stored per row
--   • mid-period change: the renewal date is kept, the prorated difference is only a proposal until
--     the platform admin records it; renewal from the end of the current period (paid time kept)
--   • upgrade requests: no charge and no plan change before approval
--   • access: the owner of the business only (never managers / business admin / staff, never another
--     business), no internal notes for the owner; platform functions for the platform admin only;
--     no direct table access for any API user
-- ============================================================
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set E_OWNER '''b1890000-0000-0000-0000-0000000000e1'''
\set E_MGR '''b1890000-0000-0000-0000-0000000000e2'''
\set E2_OWNER '''b1890000-0000-0000-0000-0000000000e3'''
\set H_OWNER '''b1890000-0000-0000-0000-0000000000d1'''
\set H_BA '''b1890000-0000-0000-0000-0000000000d2'''
\set H_MGR '''b1890000-0000-0000-0000-0000000000d3'''
\set E_SITE '''b1890000-0000-0000-0000-00000000aaa1'''
\set E2_SITE '''b1890000-0000-0000-0000-00000000aaa2'''

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
CREATE OR REPLACE FUNCTION pg_temp.err(_site text, _uid uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE e text;
BEGIN
  BEGIN
    PERFORM pg_temp.call(_site, _uid, _sql);
  EXCEPTION WHEN OTHERS THEN e := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN e;
END $f$;
-- the platform admin, signed in on the platform panel (no site)
CREATE OR REPLACE FUNCTION pg_temp.plat(_sql text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(NULL, 'a0000000-0000-0000-0000-0000000000f0', _sql);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.plat_err(_sql text) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.err(NULL, 'a0000000-0000-0000-0000-0000000000f0', _sql);
$f$;
-- the error of a statement run as the database owner (append-only guards)
CREATE OR REPLACE FUNCTION pg_temp.db_err(_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE e text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN e := SQLERRM;
  END;
  RETURN e;
END $f$;

-- ---------- fixtures: store E (owner + manager), store E2 (another owner), zimmer H (owner, business admin, manager) ----------
SELECT count(*) AS legacy_rows_before FROM public.billing_history \gset
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('b1890000-0000-0000-0000-0000000000e1', 'bil.e.owner@test.local', now()),
  ('b1890000-0000-0000-0000-0000000000e2', 'bil.e.mgr@test.local', now()),
  ('b1890000-0000-0000-0000-0000000000e3', 'bil.e2.owner@test.local', now()),
  ('b1890000-0000-0000-0000-0000000000d1', 'bil.h.owner@test.local', now()),
  ('b1890000-0000-0000-0000-0000000000d2', 'bil.h.ba@test.local', now()),
  ('b1890000-0000-0000-0000-0000000000d3', 'bil.h.mgr@test.local', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.tenants (id, slug, name, owner_email) VALUES
  ('b1890000-0000-0000-0000-00000000aaa1', 'bil-store-e', 'חנות חיוב E', 'bil.e.owner@test.local'),
  ('b1890000-0000-0000-0000-00000000aaa2', 'bil-store-e2', 'חנות חיוב E2', 'bil.e2.owner@test.local');
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected) VALUES
  ('b1890000-0000-0000-0000-00000000aaa1', 'b1890000-0000-0000-0000-0000000000e1', 'bil.e.owner@test.local', 'bil_e_owner', 'admin', true, true),
  ('b1890000-0000-0000-0000-00000000aaa1', 'b1890000-0000-0000-0000-0000000000e2', 'bil.e.mgr@test.local', 'bil_e_mgr', 'admin', true, false),
  ('b1890000-0000-0000-0000-00000000aaa2', 'b1890000-0000-0000-0000-0000000000e3', 'bil.e2.owner@test.local', 'bil_e2_owner', 'admin', true, true);
SELECT pg_temp.plat($$SELECT to_jsonb(hospitality.admin_create_site('bil-zimmer-h', 'צימר חיוב H'))$$) IS NOT NULL AS ok \gset
SELECT id AS hs FROM public.tenants WHERE slug = 'bil-zimmer-h' \gset
SELECT pg_temp.plat(format($$SELECT to_jsonb(hospitality.admin_set_extra_managers(%L, 5))$$, :'hs')) IS NOT NULL AS ok \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected) VALUES
  (:'hs', 'b1890000-0000-0000-0000-0000000000d1', 'bil.h.owner@test.local', 'bil_h_owner', 'admin', true, true),
  (:'hs', 'b1890000-0000-0000-0000-0000000000d2', 'bil.h.ba@test.local', 'bil_h_ba', 'admin', true, false),
  (:'hs', 'b1890000-0000-0000-0000-0000000000d3', 'bil.h.mgr@test.local', 'bil_h_mgr', 'admin', true, false);
SELECT pg_temp.plat(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L)])$$, :'hs')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'hs', :H_OWNER, format('SELECT hospitality.team_set_business_admin(%L, true)', :H_BA)) IS NOT NULL AS ok \gset

SELECT tests.check('billing fixtures: roles as expected (store owner / manager, zimmer owner / business admin / manager)',
  format($$SELECT pg_temp.call(%1$L, %2$L, 'SELECT to_jsonb(public.store_staff_role())') = '"owner"'
             AND pg_temp.call(%1$L, %3$L, 'SELECT to_jsonb(public.store_staff_role())') = '"manager"'
             AND pg_temp.call(%4$L, %5$L, $q$SELECT to_jsonb(hospitality.can('billing.manage'))$q$) = 'true'
             AND pg_temp.call(%4$L, %6$L, $q$SELECT to_jsonb(hospitality.can('staff.managers'))$q$) = 'true'
             AND pg_temp.call(%4$L, %6$L, $q$SELECT to_jsonb(hospitality.can('billing.manage'))$q$) = 'false'$$,
         :E_SITE, :E_OWNER, :E_MGR, :'hs', :H_OWNER, :H_BA));

-- ============================================================
-- 1. No direct access for any API user; functions for signed-in users only
-- ============================================================
SELECT tests.check('billing access: the billing schema is closed to anon and authenticated (no USAGE, no table grant)',
  $$SELECT NOT has_schema_privilege('anon', 'billing', 'USAGE') AND NOT has_schema_privilege('authenticated', 'billing', 'USAGE')
       AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'billing'::regnamespace AND c.relkind = 'r'
                        AND (has_table_privilege('authenticated', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'SELECT')
                             OR has_table_privilege('authenticated', c.oid, 'INSERT') OR has_table_privilege('authenticated', c.oid, 'UPDATE')
                             OR has_table_privilege('authenticated', c.oid, 'DELETE')))
       AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'billing'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity)
       AND NOT has_table_privilege('service_role', 'billing.ledger', 'INSERT')
       AND NOT has_table_privilege('service_role', 'billing.ledger', 'UPDATE')$$);
SELECT tests.check('billing access: internal billing functions run for nobody; public ones for signed-in users, never anon',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'billing'::regnamespace
                        AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE')))
       AND (SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
              FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
               AND (p.proname LIKE 'my\_billing\_%' OR p.proname LIKE 'platform\_billing\_%') AND p.proname <> 'platform_billing_history')
       AND (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND (p.proname LIKE 'my\_billing\_%' OR (p.proname LIKE 'platform\_billing\_%' AND p.proname <> 'platform_billing_history'))) = 14$$);
SELECT tests.check('billing access: a signed-in owner reading the ledger directly is refused',
  format($$SELECT pg_temp.err(%L, %L, 'SELECT to_jsonb(count(*)) FROM billing.ledger') LIKE '%%permission denied%%'$$,
         :E_SITE, :E_OWNER));
SELECT tests.check('billing access: anon cannot call the owner summary or the platform card',
  format($$SELECT pg_temp.err(%1$L, NULL, 'SELECT public.my_billing_summary()') LIKE '%%permission denied%%'
             AND pg_temp.err(NULL, NULL, format('SELECT public.platform_billing_card(%%L)', %1$L)) LIKE '%%permission denied%%'$$,
         :E_SITE));

-- ============================================================
-- 2. Owner only — managers, the business admin, other businesses: no
-- ============================================================
SELECT tests.check('billing owner: the store owner reads the summary of the store (no agreement yet: by the price list, trial)',
  format($$SELECT (s -> 'agreement') = 'null' AND s ->> 'engine' = 'ecommerce' AND s -> 'subscription' ->> 'renewal_kind' = 'trial'
             AND (s -> 'renewal' ->> 'days_left')::int BETWEEN 13 AND 14 AND s -> 'entries' = '[]'
             AND (s -> 'total' ->> 'paid')::numeric = 0
           FROM (SELECT pg_temp.call(%L, %L, 'SELECT public.my_billing_summary()') AS s) x$$, :E_SITE, :E_OWNER));
SELECT tests.check('billing owner: a store manager is refused',
  format($$SELECT pg_temp.err(%L, %L, 'SELECT public.my_billing_summary()') LIKE '%%רק בעל העסק%%'$$, :E_SITE, :E_MGR));
SELECT tests.check('billing owner: the zimmer owner reads; the business admin and a regular manager are refused',
  format($$SELECT pg_temp.call(%1$L, %2$L, 'SELECT public.my_billing_summary()') ->> 'engine' = 'hospitality'
             AND pg_temp.err(%1$L, %3$L, 'SELECT public.my_billing_summary()') LIKE '%%רק בעל העסק%%'
             AND pg_temp.err(%1$L, %4$L, 'SELECT public.my_billing_summary()') LIKE '%%רק בעל העסק%%'$$,
         :'hs', :H_OWNER, :H_BA, :H_MGR));
SELECT tests.check('billing owner: the owner of another business is refused on this business (store → store, zimmer → store, store → zimmer)',
  format($$SELECT pg_temp.err(%1$L, %2$L, 'SELECT public.my_billing_summary()') LIKE '%%רק בעל העסק%%'
             AND pg_temp.err(%1$L, %3$L, 'SELECT public.my_billing_summary()') LIKE '%%רק בעל העסק%%'
             AND pg_temp.err(%4$L, %5$L, 'SELECT public.my_billing_summary()') LIKE '%%רק בעל העסק%%'$$,
         :E_SITE, :E2_OWNER, :H_OWNER, :'hs', :E_OWNER));
SELECT tests.check('billing owner: owners, managers and the business admin cannot call any platform billing function',
  format($$SELECT bool_and(pg_temp.err(site, uid, sql) LIKE '%%רק מנהל הפלטפורמה%%')
             FROM (VALUES (%1$L, %2$L::uuid), (%1$L, %3$L::uuid), (%4$L, %5$L::uuid), (%4$L, %6$L::uuid)) AS w(site, uid),
                  unnest(ARRAY[format('SELECT public.platform_billing_card(%%L)', %1$L),
                               format('SELECT public.platform_billing_save_agreement(%%L, %%L, 0)', %1$L, '{"plan":"basic"}'),
                               format('SELECT public.platform_billing_record_entry(%%L, %%L)', %1$L, '{"kind":"payment","amount":1,"method":"cash"}'),
                               format('SELECT public.platform_billing_renew(%%L, NULL)', %1$L),
                               'SELECT public.platform_billing_requests()',
                               'SELECT to_jsonb(public.platform_billing_pending_count())',
                               'SELECT public.platform_billing_legacy_overview()',
                               $q$SELECT public.platform_billing_save_settings('{"seller_business_type":"authorized","seller_prices_include_vat":true}')$q$]) AS sql$$,
         :E_SITE, :E_OWNER, :E_MGR, :'hs', :H_OWNER, :H_BA));

-- ============================================================
-- 2b. VAT follows the seller (Nuriel): exempt by default — no VAT in any agreement or charge
-- ============================================================
SELECT tests.check('billing VAT exempt: by default Nuriel is an exempt dealer — rate 0, no "included", no override; the owner sees it too',
  format($$SELECT c -> 'vat' ->> 'business_type' = 'exempt' AND (c -> 'vat' ->> 'rate')::numeric = 0
             AND c -> 'vat' ->> 'default_mode' = 'exempt' AND (c -> 'vat' ->> 'allow_vat_rate_override')::boolean = false
             AND o -> 'vat' ->> 'business_type' = 'exempt' AND NOT (o -> 'vat' ? 'allow_vat_rate_override')
           FROM (SELECT pg_temp.plat(format('SELECT public.platform_billing_card(%%L)', %1$L)) AS c,
                        pg_temp.call(%1$L, %2$L, 'SELECT public.my_billing_summary()') AS o) x$$, :E_SITE, :E_OWNER));
SELECT tests.check('billing VAT exempt: an agreement "+VAT" / "includes VAT" or with a VAT rate is refused; no row was written',
  format($$SELECT pg_temp.plat_err(format('SELECT public.platform_billing_quote(%%L, %%L)', %1$L, '{"plan":"premium","vat_mode":"excluded"}'))
                  LIKE '%%עוסק פטור%%'
             AND pg_temp.plat_err(format('SELECT public.platform_billing_quote(%%L, %%L)', %1$L, '{"plan":"premium","vat_mode":"included"}'))
                  LIKE '%%עוסק פטור%%'
             AND pg_temp.plat_err(format('SELECT public.platform_billing_quote(%%L, %%L)', %1$L, '{"plan":"premium","vat_rate":18}'))
                  LIKE '%%עוסק פטור%%'
             AND NOT EXISTS (SELECT 1 FROM billing.agreements) AND NOT EXISTS (SELECT 1 FROM billing.ledger)$$, :E_SITE));
SELECT tests.check('billing VAT exempt: the price of an exempt agreement is final — 700 net = 700 total, VAT 0',
  format($$SELECT (q ->> 'vat_rate')::numeric = 0 AND (q ->> 'new_cycle_price')::numeric = 700
             AND billing.price_parts(700, 'exempt', 18) = '{"net": 700, "vat": 0, "gross": 700, "rate": 0, "mode": "exempt"}'::jsonb
           FROM (SELECT pg_temp.plat(format('SELECT public.platform_billing_quote(%%L, %%L)', %L, '{"plan":"premium"}')) AS q) x$$,
         :E_SITE));
SELECT tests.check('billing VAT exempt: even the database owner cannot store an exempt row with VAT (agreement or ledger)',
  format($$SELECT pg_temp.db_err(format($q$INSERT INTO billing.ledger (tenant_id, tenant_label, engine, kind, category, amount,
             vat_business_type, vat_rate, vat_amount, net_amount, occurred_on)
             VALUES (%%L, 'x', 'ecommerce', 'charge', 'other', 118, 'exempt', 18, 18, 100, current_date)$q$, %1$L)) LIKE '%%check constraint%%'
           AND pg_temp.db_err(format($q$INSERT INTO billing.agreements (tenant_id, tenant_label, engine, version, plan_code,
             billing_cycle, vat_business_type, vat_mode, vat_rate, effective_on)
             VALUES (%%L, 'x', 'ecommerce', 1, 'basic', 'monthly', 'exempt', 'excluded', 18, current_date)$q$, %1$L)) LIKE '%%check constraint%%'$$,
         :E_SITE));
SELECT tests.check('billing VAT settings: an authorized seller must say whether prices include VAT; a bad type is refused',
  $$SELECT pg_temp.plat_err($q$SELECT public.platform_billing_save_settings('{"seller_business_type":"authorized"}')$q$) LIKE '%כוללים מע"מ%'
       AND pg_temp.plat_err($q$SELECT public.platform_billing_save_settings('{"seller_business_type":"company"}')$q$) LIKE '%פטור או מורשה%'$$);
-- from here on: Nuriel as an authorized dealer, prices before VAT (the checks below use VAT 18%)
SELECT pg_temp.plat($q$SELECT public.platform_billing_save_settings('{"seller_business_type":"authorized","seller_prices_include_vat":false}')$q$) AS vat_auth \gset
SELECT tests.check('billing VAT authorized: the central rate (18%), "+VAT" by default, no override; audited',
  format($$SELECT %L::jsonb ->> 'business_type' = 'authorized' AND (%1$L::jsonb ->> 'rate')::numeric = 18
             AND %1$L::jsonb ->> 'default_mode' = 'excluded' AND (%1$L::jsonb ->> 'allow_vat_rate_override')::boolean = false
             AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE action = 'billing_settings_saved'
                           AND details ->> 'seller_business_type' = 'authorized' AND details -> 'previous' ->> 'seller_business_type' = 'exempt')$$,
         :'vat_auth'));

-- ============================================================
-- 3. Store E: full price (no special price), cross-engine plan refused, concurrency
-- ============================================================
SELECT tests.check('billing store: a zimmer-only plan is refused for a store (engine catalog)',
  format($$SELECT pg_temp.plat_err(format('SELECT public.platform_billing_save_agreement(%%L, %%L, 0)', %L, '{"plan":"pro"}'))
                  LIKE '%%לא קיימת במחירון של החנויות%%'$$, :E_SITE));
SELECT pg_temp.plat(format($$SELECT public.platform_billing_save_agreement(%L,
  '{"plan":"premium","billing_cycle":"monthly","vat_mode":"excluded","vat_rate":18,"setup_fee":0,
    "terms":"תנאי E גלויים","internal_note":"סוד-פנימי-E"}', 0, true, true)$$, :E_SITE)) AS e_v1 \gset
SELECT tests.check('billing store full price: v1 at the list price (700 + 18% VAT = 826), no special price; in trial the plan is not switched',
  format($$SELECT (c -> 'agreement' ->> 'version')::int = 1 AND c -> 'agreement' ->> 'reason' = 'initial'
             AND (c -> 'agreement' -> 'cycle_price' ->> 'net')::numeric = 700
             AND (c -> 'agreement' -> 'cycle_price' ->> 'vat')::numeric = 126
             AND (c -> 'agreement' -> 'cycle_price' ->> 'gross')::numeric = 826
             AND (c -> 'agreement' ->> 'special_price')::boolean = false
             AND %2$L::jsonb -> 'plan' ->> 'reason' = 'trial'
             AND (SELECT plan_type FROM public.tenant_subscriptions WHERE tenant_id = %1$L) = 'trial'
             AND c -> 'entries' = '[]'
           FROM (SELECT %2$L::jsonb -> 'card' AS c) x$$, :E_SITE, :'e_v1'));
SELECT tests.check('billing store: a stale expected version is refused (two admins at once)',
  format($$SELECT pg_temp.plat_err(format('SELECT public.platform_billing_save_agreement(%%L, %%L, 0)', %L, '{"plan":"basic"}'))
                  LIKE '%%השתנה בינתיים%%'$$, :E_SITE));
SELECT tests.check('billing store: the owner sees the terms but never the internal note, the reference or who recorded',
  format($$SELECT s -> 'agreement' ->> 'terms' = 'תנאי E גלויים'
             AND position('סוד-פנימי-E' IN s::text) = 0 AND NOT (s -> 'agreement' ? 'internal_note')
             AND NOT (s ? 'history')
           FROM (SELECT pg_temp.call(%L, %L, 'SELECT public.my_billing_summary()') AS s) x$$, :E_SITE, :E_OWNER));
SELECT tests.check('billing store: the platform card has the internal note',
  format($$SELECT pg_temp.plat(format('SELECT public.platform_billing_card(%%L)', %L)) -> 'agreement' ->> 'internal_note' = 'סוד-פנימי-E'$$,
         :E_SITE));

-- ============================================================
-- 4. Store E: renewal from the trial — the trial days are kept, the agreed plan enters, charge + payment
-- ============================================================
SELECT (billing.engine_state(:E_SITE) ->> 'renewal_on') AS e_trial_end, (SELECT trial_ends_at FROM public.tenant_subscriptions WHERE tenant_id = :E_SITE) AS e_trial_ts \gset
SELECT tests.check('billing store renewal: refused without the expected renewal date (double click / stale screen)',
  format($$SELECT pg_temp.plat_err(format('SELECT public.platform_billing_renew(%%L, %%L)', %L, (current_date + 400)::text))
                  LIKE '%%השתנה בינתיים%%'$$, :E_SITE));
SELECT pg_temp.plat(format($$SELECT public.platform_billing_renew(%L, %L,
  '{"record_payment":true,"method":"bank_transfer","reference":"אסמכתה-123"}')$$, :E_SITE, :'e_trial_end')) AS e_r1 \gset
SELECT tests.check('billing store renewal: premium + active, the period runs from the end of the trial (+1 month); charge 826 and payment 826, balance 0',
  format($$SELECT s.plan_type = 'premium' AND s.status = 'active' AND s.current_period_end = %2$L::timestamptz + interval '1 month'
             AND (c -> 'subscription_money' ->> 'due')::numeric = 826 AND (c -> 'subscription_money' ->> 'paid')::numeric = 826
             AND (c -> 'subscription_money' ->> 'balance')::numeric = 0 AND (c -> 'total' ->> 'paid')::numeric = 826
             AND (SELECT count(*) FROM billing.ledger l WHERE l.tenant_id = %1$L AND l.source = 'renewal') = 2
             AND (SELECT bool_and(l.vat_rate = 18 AND l.net_amount + l.vat_amount = l.amount AND l.confirmation = 'manual')
                    FROM billing.ledger l WHERE l.tenant_id = %1$L)
           FROM public.tenant_subscriptions s, (SELECT %3$L::jsonb AS c) x WHERE s.tenant_id = %1$L$$,
         :E_SITE, :'e_trial_ts', :'e_r1'));
SELECT tests.check('billing store renewal: renewing again with the old date is refused (no double period)',
  format($$SELECT pg_temp.plat_err(format('SELECT public.platform_billing_renew(%%L, %%L)', %L, %L)) LIKE '%%השתנה בינתיים%%'$$,
         :E_SITE, :'e_trial_end'));
SELECT tests.check('billing store: the owner sees the payment as received manually, without the reference',
  format($$SELECT (SELECT bool_and(e ->> 'confirmation' = 'manual' AND NOT (e ? 'reference') AND NOT (e ? 'recorded_by_email'))
                     FROM jsonb_array_elements(s -> 'entries') e)
             AND position('אסמכתה-123' IN s::text) = 0 AND jsonb_array_length(s -> 'entries') = 2
           FROM (SELECT pg_temp.call(%L, %L, 'SELECT public.my_billing_summary()') AS s) x$$, :E_SITE, :E_OWNER));

-- ============================================================
-- 5. Store E: yearly agreement — the renewal date stays, the next renewal is one year, partial payment, reversal
-- ============================================================
SELECT (billing.engine_state(:E_SITE) ->> 'renewal_on') AS e_end1, (SELECT current_period_end FROM public.tenant_subscriptions WHERE tenant_id = :E_SITE) AS e_end1_ts \gset
SELECT pg_temp.plat(format($$SELECT public.platform_billing_quote(%L,
  '{"plan":"premium","billing_cycle":"yearly","agreed_yearly":7000,"vat_mode":"included","vat_rate":18}')$$, :E_SITE)) AS e_q2 \gset
SELECT pg_temp.plat(format($$SELECT public.platform_billing_save_agreement(%L,
  '{"plan":"premium","billing_cycle":"yearly","agreed_yearly":7000,"vat_mode":"included","vat_rate":18}', 1, true, false)$$, :E_SITE)) AS e_v2 \gset
SELECT tests.check('billing store yearly: the quote is only a proposal (nothing recorded), the renewal date is unchanged, v1 is kept',
  format($$SELECT %2$L::jsonb ->> 'renewal_on' = %3$L AND %4$L::jsonb -> 'entry_id' = 'null'
             AND (SELECT current_period_end FROM public.tenant_subscriptions WHERE tenant_id = %1$L) = %5$L::timestamptz
             AND (SELECT count(*) FROM billing.ledger WHERE tenant_id = %1$L) = 2
             AND (SELECT count(*) FROM billing.agreements WHERE tenant_id = %1$L) = 2
             AND (SELECT superseded_at IS NOT NULL FROM billing.agreements WHERE tenant_id = %1$L AND version = 1)
             AND jsonb_array_length(%4$L::jsonb -> 'card' -> 'history') = 2$$,
         :E_SITE, :'e_q2', :'e_end1', :'e_v2', :'e_end1_ts'));
SELECT tests.check('billing store yearly: the expected renewal amount is the agreed yearly price (7000, VAT included: 5932.20 + 1067.80)',
  format($$SELECT (s -> 'renewal' -> 'expected' ->> 'gross')::numeric = 7000 AND (s -> 'renewal' -> 'expected' ->> 'vat')::numeric = 1067.80
             AND s -> 'renewal' ->> 'cycle' = 'yearly' AND s -> 'renewal' ->> 'basis' = 'agreement'
             AND (s -> 'renewal' ->> 'days_left')::int = (s -> 'subscription' ->> 'renewal_on')::date - billing.today()
           FROM (SELECT pg_temp.call(%L, %L, 'SELECT public.my_billing_summary()') AS s) x$$, :E_SITE, :E_OWNER));
SELECT pg_temp.plat(format('SELECT public.platform_billing_renew(%L, %L)', :E_SITE, :'e_end1')) AS e_r2 \gset
SELECT pg_temp.plat(format($$SELECT public.platform_billing_record_entry(%L,
  '{"kind":"payment","category":"subscription","amount":3000,"method":"credit_card","occurred_on":"%s","description":"תשלום חלקי"}')$$,
  :E_SITE, current_date)) AS e_p \gset
SELECT tests.check('billing store yearly renewal + partial payment: +1 year from the end of the paid month; due 7826, paid 3826, balance 4000',
  format($$SELECT (SELECT current_period_end FROM public.tenant_subscriptions WHERE tenant_id = %1$L) = %2$L::timestamptz + interval '1 year'
             AND (c -> 'subscription_money' ->> 'due')::numeric = 7826 AND (c -> 'subscription_money' ->> 'paid')::numeric = 3826
             AND (c -> 'subscription_money' ->> 'balance')::numeric = 4000
           FROM (SELECT %3$L::jsonb AS c) x$$, :E_SITE, :'e_end1_ts', :'e_p'));
SELECT id AS e_partial FROM billing.ledger WHERE tenant_id = :E_SITE AND kind = 'payment' AND amount = 3000 \gset
SELECT tests.check('billing reversal: a reason is required',
  format($$SELECT pg_temp.plat_err(format('SELECT public.platform_billing_reverse_entry(%%L, %%L)', %L, '')) LIKE '%%סיבת הביטול%%'$$,
         :'e_partial'));
SELECT pg_temp.plat(format('SELECT public.platform_billing_reverse_entry(%L, %L)', :'e_partial', 'נרשם בטעות')) AS e_rev \gset
SELECT tests.check('billing reversal: the payment is cancelled by a new row — the original stays, marked reversed; balance back to 7000',
  format($$SELECT (c -> 'subscription_money' ->> 'balance')::numeric = 7000 AND (c -> 'total' ->> 'paid')::numeric = 826
             AND EXISTS (SELECT 1 FROM billing.ledger WHERE id = %1$L)
             AND EXISTS (SELECT 1 FROM billing.ledger WHERE reverses_id = %1$L AND kind = 'reversal' AND amount = 3000)
             AND (SELECT (e ->> 'reversed')::boolean FROM jsonb_array_elements(c -> 'entries') e WHERE e ->> 'id' = %1$L)
           FROM (SELECT %2$L::jsonb AS c) x$$, :'e_partial', :'e_rev'));
SELECT tests.check('billing reversal: the same row cannot be reversed twice, and a reversal row cannot be reversed',
  format($$SELECT pg_temp.plat_err(format('SELECT public.platform_billing_reverse_entry(%%L, %%L)', %1$L, 'שוב')) LIKE '%%כבר בוטל%%'
             AND pg_temp.plat_err(format('SELECT public.platform_billing_reverse_entry(%%L, %%L)',
                   (SELECT id FROM billing.ledger WHERE reverses_id = %1$L), 'ביטול של ביטול')) LIKE '%%שורת ביטול%%'$$,
         :'e_partial'));
SELECT tests.check('billing owner view: reversal rows are not listed for the owner; the reversed payment is shown as reversed',
  format($$SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s -> 'entries') e WHERE e ->> 'kind' = 'reversal')
             AND (SELECT (e ->> 'reversed')::boolean FROM jsonb_array_elements(s -> 'entries') e WHERE e ->> 'id' = %3$L)
           FROM (SELECT pg_temp.call(%1$L, %2$L, 'SELECT public.my_billing_summary()') AS s) x$$, :E_SITE, :E_OWNER, :'e_partial'));
SELECT tests.check('billing entries: a payment needs a method, the amount must be positive',
  format($$SELECT pg_temp.plat_err(format('SELECT public.platform_billing_record_entry(%%L, %%L)', %1$L, '{"kind":"payment","amount":10}')) LIKE '%%אמצעי תשלום%%'
             AND pg_temp.plat_err(format('SELECT public.platform_billing_record_entry(%%L, %%L)', %1$L, '{"kind":"charge","amount":0}')) LIKE '%%סכום לא תקין%%'
             AND pg_temp.plat_err(format('SELECT public.platform_billing_record_entry(%%L, %%L)', %1$L, '{"kind":"charge","amount":-5}')) LIKE '%%סכום לא תקין%%'
             AND pg_temp.plat_err(format('SELECT public.platform_billing_record_entry(%%L, %%L)', %1$L, '{"kind":"reversal","amount":5}')) LIKE '%%סוג רישום%%'$$,
         :E_SITE));

-- ============================================================
-- 6. Zimmer H: mid-period upgrade request — no change before approval, renewal date kept, prorated difference
-- ============================================================
SELECT pg_temp.plat(format($$SELECT hospitality.admin_set_subscription(%L, 'basic', 'active', NULL, now() + interval '20 days', 0, 'הערה פנימית לצימר')$$, :'hs')) IS NOT NULL AS ok \gset
SELECT (SELECT current_period_end FROM hospitality.subscriptions WHERE tenant_id = :'hs') AS h_end_ts, billing.engine_state(:'hs') ->> 'renewal_on' AS h_end \gset
SELECT pg_temp.plat(format($$SELECT public.platform_billing_save_agreement(%L,
  '{"plan":"basic","billing_cycle":"monthly","vat_mode":"excluded","vat_rate":18,"setup_fee":2000,"commitment_months":12,
    "start_date":"%s","internal_note":"סוד-פנימי-H"}', 0)$$, :'hs', current_date)) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'hs', :H_OWNER, $$SELECT public.my_billing_request_upgrade('premium', 'monthly', 'רוצים יותר יחידות')$$) AS h_req \gset
SELECT tests.check('billing request: pending; the active plan and the agreement are unchanged; nothing was charged',
  format($$SELECT %2$L::jsonb ->> 'status' = 'pending' AND (%2$L::jsonb ->> 'list_price_monthly')::numeric = 400
             AND (SELECT plan_code FROM hospitality.subscriptions WHERE tenant_id = %1$L) = 'basic'
             AND (SELECT plan_code FROM billing.agreements WHERE tenant_id = %1$L AND superseded_at IS NULL) = 'basic'
             AND NOT EXISTS (SELECT 1 FROM billing.ledger WHERE tenant_id = %1$L)$$, :'hs', :'h_req'));
SELECT tests.check('billing request: a second request while one is pending is refused; the business admin and a manager cannot request',
  format($$SELECT pg_temp.err(%1$L, %2$L, $q$SELECT public.my_billing_request_upgrade('premium')$q$) LIKE '%%ממתינה%%'
             AND pg_temp.err(%1$L, %3$L, $q$SELECT public.my_billing_request_upgrade('premium')$q$) LIKE '%%רק בעל העסק%%'
             AND pg_temp.err(%1$L, %4$L, $q$SELECT public.my_billing_request_upgrade('premium')$q$) LIKE '%%רק בעל העסק%%'
             AND pg_temp.err(%1$L, %2$L, $q$SELECT public.my_billing_request_upgrade('basic')$q$) IS NOT NULL$$,
         :'hs', :H_OWNER, :H_BA, :H_MGR));
SELECT tests.check('billing request: an unpublished plan cannot be requested',
  format($$SELECT pg_temp.err(%L, %L, $q$SELECT public.my_billing_request_upgrade('pro')$q$) LIKE '%%לא זמינה%%'$$, :'hs', :H_OWNER));
SELECT tests.check('billing request: the platform admin sees it in the pending list, with the plan and the agreement',
  format($$SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.plat('SELECT public.platform_billing_requests()')) r
                            WHERE r ->> 'id' = %1$L::jsonb ->> 'id' AND r ->> 'engine' = 'hospitality'
                              AND r -> 'subscription' ->> 'plan' = 'basic' AND r -> 'agreement' ->> 'plan' = 'basic')
             AND (pg_temp.plat('SELECT to_jsonb(public.platform_billing_pending_count())'))::text::int >= 1$$, :'h_req'));
SELECT pg_temp.plat(format($$SELECT public.platform_billing_quote(%L,
  '{"plan":"premium","billing_cycle":"monthly","agreed_monthly":300,"vat_mode":"excluded","vat_rate":18,"setup_fee":2000}')$$, :'hs')) AS h_q \gset
SELECT tests.check('billing mid-period quote: days left to the kept renewal date, (354 − 236) × days left / days in the month',
  format($$SELECT q ->> 'kind' = 'charge' AND (q ->> 'days_left')::int = %2$L::date - billing.today()
             AND (q ->> 'old_cycle_price')::numeric = 236 AND (q ->> 'new_cycle_price')::numeric = 354
             AND (q ->> 'difference')::numeric
                 = round((354.0 / (q ->> 'new_cycle_days')::int - 236.0 / (q ->> 'old_cycle_days')::int) * (q ->> 'days_left')::int, 2)
             AND (q ->> 'new_cycle_days')::int BETWEEN 28 AND 31
           FROM (SELECT %1$L::jsonb AS q) x$$, :'h_q', :'h_end'));
SELECT pg_temp.plat(format($$SELECT public.platform_billing_save_agreement(%L,
  '{"plan":"premium","billing_cycle":"monthly","agreed_monthly":300,"vat_mode":"excluded","vat_rate":18,"setup_fee":2000,
    "commitment_months":12,"start_date":"%s"}', 1, true, true, %L, 'אושר — מחיר מיוחד')$$,
  :'hs', current_date, :'h_req'::jsonb ->> 'id')) AS h_v2 \gset
SELECT tests.check('billing approve: the plan switches to premium, the renewal date is unchanged, the difference is one charge, v1 kept',
  format($$SELECT (SELECT plan_code FROM hospitality.subscriptions WHERE tenant_id = %1$L) = 'premium'
             AND (SELECT current_period_end FROM hospitality.subscriptions WHERE tenant_id = %1$L) = %2$L::timestamptz
             AND (SELECT note FROM hospitality.subscriptions WHERE tenant_id = %1$L) = 'הערה פנימית לצימר'
             AND (SELECT count(*) FROM billing.agreements WHERE tenant_id = %1$L) = 2
             AND (SELECT reason FROM billing.agreements WHERE tenant_id = %1$L AND superseded_at IS NULL) = 'upgrade'
             AND (SELECT count(*) FROM billing.ledger WHERE tenant_id = %1$L) = 1
             AND (SELECT amount = (%3$L::jsonb ->> 'difference')::numeric AND kind = 'charge' AND source = 'plan_change'
                    AND period_end = %4$L::date FROM billing.ledger WHERE tenant_id = %1$L)
             AND (SELECT status = 'approved' AND agreement_id IS NOT NULL FROM billing.upgrade_requests WHERE id = (%5$L::jsonb ->> 'id')::uuid)$$,
         :'hs', :'h_end_ts', :'h_q', :'h_end', :'h_req'));
SELECT tests.check('billing approve: the owner sees the updated agreement and the approval message',
  format($$SELECT s -> 'agreement' ->> 'plan' = 'premium' AND (s -> 'agreement' ->> 'agreed_monthly')::numeric = 300
             AND (s -> 'requests' -> 0 ->> 'status') = 'approved' AND (s -> 'requests' -> 0 ->> 'decision_message') = 'אושר — מחיר מיוחד'
             AND s -> 'subscription' ->> 'plan' = 'premium' AND NOT (s ->> 'plan_mismatch')::boolean
             AND position('סוד-פנימי-H' IN s::text) = 0
           FROM (SELECT pg_temp.call(%L, %L, 'SELECT public.my_billing_summary()') AS s) x$$, :'hs', :H_OWNER));

-- ============================================================
-- 7. Zimmer H: Premium at a special price (list 400, agreed 200, VAT included) — the list price stays 400
-- ============================================================
SELECT pg_temp.plat(format($$SELECT public.platform_billing_save_agreement(%L,
  '{"plan":"premium","billing_cycle":"monthly","agreed_monthly":200,"vat_mode":"included","vat_rate":18,"setup_fee":2000,
    "commitment_months":12,"start_date":"%s"}', 2)$$, :'hs', current_date)) IS NOT NULL AS ok \gset
SELECT tests.check('billing special price: list 400 (unchanged in the price list), agreed 200 incl. VAT (169.49 + 30.51); no automatic charge',
  format($$SELECT (s ->> 'list_price_monthly')::numeric = 400 AND (s -> 'agreement' ->> 'special_price')::boolean
             AND (s -> 'agreement' -> 'monthly' ->> 'gross')::numeric = 200 AND (s -> 'agreement' -> 'monthly' ->> 'vat')::numeric = 30.51
             AND (s -> 'agreement' -> 'monthly' ->> 'net')::numeric = 169.49 AND s -> 'agreement' ->> 'vat_mode' = 'included'
             AND (SELECT price_monthly FROM hospitality.plans WHERE code = 'premium') = 400
             AND (SELECT count(*) FROM billing.ledger WHERE tenant_id = %1$L) = 1
           FROM (SELECT pg_temp.call(%1$L, %2$L, 'SELECT public.my_billing_summary()') AS s) x$$, :'hs', :H_OWNER));

-- ============================================================
-- 8. Zimmer H: setup fee paid separately, in two payments
-- ============================================================
SELECT pg_temp.plat(format($$SELECT public.platform_billing_record_entry(%L,
  '{"kind":"payment","category":"setup","amount":1000,"method":"bit","description":"מקדמה על ההקמה"}')$$, :'hs')) AS h_s1 \gset
SELECT tests.check('billing setup partial: agreed 2000 (VAT included), paid 1000, balance 1000; the subscription is separate',
  format($$SELECT (c -> 'setup' ->> 'due')::numeric = 2000 AND (c -> 'setup' ->> 'paid')::numeric = 1000
             AND (c -> 'setup' ->> 'balance')::numeric = 1000 AND (c -> 'subscription_money' ->> 'paid')::numeric = 0
           FROM (SELECT %L::jsonb AS c) x$$, :'h_s1'));
SELECT pg_temp.plat(format($$SELECT public.platform_billing_record_entry(%L,
  '{"kind":"payment","category":"setup","amount":1000,"method":"bank_transfer"}')$$, :'hs')) AS h_s2 \gset
SELECT tests.check('billing setup paid: balance 0; total paid 2000; the commitment end is the start date + 12 months',
  format($$SELECT (c -> 'setup' ->> 'balance')::numeric = 0 AND (c -> 'total' ->> 'paid')::numeric = 2000
             AND (c -> 'agreement' ->> 'commitment_ends_on')::date = (current_date + interval '12 months')::date
           FROM (SELECT %L::jsonb AS c) x$$, :'h_s2'));

-- ============================================================
-- 9. Separation: each business sees only itself; the zimmer owner never gets store data
-- ============================================================
SELECT tests.check('billing isolation: the summary of each business holds only its own rows',
  format($$SELECT (SELECT bool_and(e ->> 'id' IN (SELECT id::text FROM billing.ledger WHERE tenant_id = %1$L))
                     FROM jsonb_array_elements(pg_temp.call(%1$L, %2$L, 'SELECT public.my_billing_summary()') -> 'entries') e)
             AND (SELECT bool_and(e ->> 'id' IN (SELECT id::text FROM billing.ledger WHERE tenant_id = %3$L))
                     FROM jsonb_array_elements(pg_temp.call(%3$L, %4$L, 'SELECT public.my_billing_summary()') -> 'entries') e)
             AND pg_temp.call(%5$L, %6$L, 'SELECT public.my_billing_summary()') -> 'entries' = '[]'
             AND pg_temp.call(%5$L, %6$L, 'SELECT public.my_billing_summary()') -> 'agreement' = 'null'$$,
         :E_SITE, :E_OWNER, :'hs', :H_OWNER, :E2_SITE, :E2_OWNER));
SELECT tests.check('billing separation: the engine of every row = the site type of its business; plans come from each engine catalog',
  $$SELECT NOT EXISTS (SELECT 1 FROM billing.ledger l JOIN public.tenants t ON t.id = l.tenant_id WHERE t.site_type <> l.engine)
       AND NOT EXISTS (SELECT 1 FROM billing.agreements a JOIN public.tenants t ON t.id = a.tenant_id WHERE t.site_type <> a.engine)
       AND billing.plan_info('ecommerce', 'pro') IS NULL AND billing.plan_info('hospitality', 'pro') IS NOT NULL$$);
SELECT tests.check('billing separation: a row with the wrong engine is refused even for the database owner',
  format($$SELECT pg_temp.db_err(format($q$INSERT INTO billing.ledger (tenant_id, tenant_label, engine, kind, category, amount,
             vat_business_type, vat_rate, vat_amount, net_amount, occurred_on)
             VALUES (%%L, 'x', 'hospitality', 'charge', 'other', 1, 'exempt', 0, 0, 1, current_date)$q$, %L))
             LIKE '%%המנוע שלו שונה%%'$$, :E_SITE));

-- ============================================================
-- 10. Store E: request + reject, request + cancel
-- ============================================================
SELECT pg_temp.call(:E_SITE, :E_OWNER, $$SELECT public.my_billing_request_upgrade('basic', 'monthly', NULL)$$) AS e_req \gset
SELECT pg_temp.plat(format('SELECT public.platform_billing_reject_request(%L, %L)', :'e_req'::jsonb ->> 'id', 'נשארים בפרימיום עד סוף השנה')) IS NOT NULL AS ok \gset
SELECT tests.check('billing reject: the owner sees "rejected" with the message; the plan did not change',
  format($$SELECT s -> 'requests' -> 0 ->> 'status' = 'rejected' AND s -> 'requests' -> 0 ->> 'decision_message' = 'נשארים בפרימיום עד סוף השנה'
             AND (SELECT plan_type FROM public.tenant_subscriptions WHERE tenant_id = %1$L) = 'premium'
           FROM (SELECT pg_temp.call(%1$L, %2$L, 'SELECT public.my_billing_summary()') AS s) x$$, :E_SITE, :E_OWNER));
SELECT tests.check('billing reject: a decided request cannot be decided again (reject / approve)',
  format($$SELECT pg_temp.plat_err(format('SELECT public.platform_billing_reject_request(%%L, NULL)', %1$L)) LIKE '%%כבר טופלה%%'
             AND pg_temp.plat_err(format('SELECT public.platform_billing_save_agreement(%%L, %%L, 2, true, false, %%L)',
                   %2$L, '{"plan":"basic"}', %1$L)) LIKE '%%כבר טופלה%%'$$, :'e_req'::jsonb ->> 'id', :E_SITE));
SELECT pg_temp.call(:E_SITE, :E_OWNER, $$SELECT public.my_billing_request_upgrade('basic', 'yearly', 'אולי בשנה הבאה')$$) AS e_req2 \gset
SELECT tests.check('billing cancel: the owner cancels a pending request; another business cannot cancel it',
  format($$SELECT pg_temp.err(%3$L, %4$L, format('SELECT public.my_billing_cancel_request(%%L)', %1$L)) LIKE '%%לא נמצאה%%'
             AND pg_temp.call(%2$L, %5$L, format('SELECT public.my_billing_cancel_request(%%L)', %1$L)) ->> 'status' = 'canceled'$$,
         :'e_req2'::jsonb ->> 'id', :E_SITE, :E2_SITE, :E2_OWNER, :E_OWNER));

-- ============================================================
-- 11. Append-only, even for the database owner; provider confirmation never manual
-- ============================================================
SELECT tests.check('billing append-only: the ledger cannot be updated, deleted or truncated',
  $$SELECT pg_temp.db_err('UPDATE billing.ledger SET amount = 1') LIKE '%לא ניתן לשינוי%'
       AND pg_temp.db_err('DELETE FROM billing.ledger') LIKE '%לא נמחקות%'
       AND pg_temp.db_err('TRUNCATE billing.ledger') IS NOT NULL$$);
SELECT tests.check('billing append-only: an agreement version cannot be edited or deleted (only closed once, by a new version)',
  $$SELECT pg_temp.db_err('UPDATE billing.agreements SET agreed_monthly = 1') LIKE '%יוצרים גרסה חדשה%'
       AND pg_temp.db_err('UPDATE billing.agreements SET superseded_at = now() WHERE superseded_at IS NOT NULL') LIKE '%יוצרים גרסה חדשה%'
       AND pg_temp.db_err('DELETE FROM billing.agreements') LIKE '%לא נמחקות%'$$);
SELECT tests.check('billing append-only: a decided request cannot change again, nor be deleted',
  $$SELECT pg_temp.db_err($q$UPDATE billing.upgrade_requests SET status = 'pending', decided_at = NULL WHERE status <> 'pending'$q$) LIKE '%כבר טופלה%'
       AND pg_temp.db_err('DELETE FROM billing.upgrade_requests') LIKE '%לא נמחקות%'$$);
SELECT tests.check('billing provider: a "provider" (verified) payment cannot be recorded manually',
  format($$SELECT pg_temp.db_err(format($q$INSERT INTO billing.ledger (tenant_id, tenant_label, engine, kind, category, amount,
             vat_business_type, vat_rate, vat_amount, net_amount, occurred_on, confirmation, provider_ref, method)
             VALUES (%%L, 'x', 'ecommerce', 'payment', 'other', 1, 'exempt', 0, 0, 1, current_date, 'provider', 'tx-1', 'credit_card')$q$, %L))
             LIKE '%%לא נרשם ידנית%%'
           AND NOT EXISTS (SELECT 1 FROM billing.ledger WHERE confirmation = 'provider')$$, :E_SITE));

-- ============================================================
-- 12. VAT rate stored per row; the default changes only new agreements; audit; the old history untouched
-- ============================================================
SELECT pg_temp.plat($q$SELECT public.platform_billing_save_settings('{"seller_business_type":"authorized","seller_prices_include_vat":true}')$q$) IS NOT NULL AS ok \gset
SELECT tests.check('billing VAT: a settings change rewrites no stored agreement or ledger row; new agreements get the new default',
  format($$SELECT NOT EXISTS (SELECT 1 FROM billing.ledger WHERE tenant_id IN (%1$L, %2$L) AND (vat_rate <> 18 OR vat_business_type <> 'authorized'))
             AND NOT EXISTS (SELECT 1 FROM billing.agreements WHERE tenant_id IN (%1$L, %2$L)
                               AND (vat_rate <> 18 OR vat_business_type <> 'authorized' OR vat_mode NOT IN ('included', 'excluded')))
             AND pg_temp.plat(format('SELECT public.platform_billing_card(%%L)', %3$L)) -> 'vat' ->> 'default_mode' = 'included'
             AND (pg_temp.plat(format($q$SELECT public.platform_billing_quote(%%L, '{"plan":"basic"}')$q$, %3$L)) ->> 'vat_rate')::numeric = 18$$,
         :E_SITE, :'hs', :E2_SITE));
SELECT tests.check('billing VAT override: another rate is refused unless the settings allow it (authorized only)',
  format($$SELECT pg_temp.plat_err(format('SELECT public.platform_billing_quote(%%L, %%L)', %L, '{"plan":"basic","vat_rate":0}'))
                  LIKE '%%נקבע מרכזית (18%%%%)%%'$$, :E2_SITE));
SELECT pg_temp.plat($q$SELECT public.platform_billing_save_settings('{"seller_business_type":"authorized","seller_prices_include_vat":true,"allow_vat_rate_override":true}')$q$) IS NOT NULL AS ok \gset
SELECT tests.check('billing VAT override: allowed by the settings — a 0% agreement (e.g. a service to a foreign resident)',
  format($$SELECT (pg_temp.plat(format('SELECT public.platform_billing_quote(%%L, %%L)', %L, '{"plan":"basic","vat_rate":0}')) ->> 'vat_rate')::numeric = 0$$,
         :E2_SITE));
SELECT tests.check('billing VAT override: switching to exempt turns the override off',
  $$SELECT (pg_temp.plat($q$SELECT public.platform_billing_save_settings('{"seller_business_type":"exempt","allow_vat_rate_override":true}')$q$)
              ->> 'allow_vat_rate_override')::boolean = false$$);
SELECT pg_temp.plat($q$SELECT public.platform_billing_save_settings('{"seller_business_type":"authorized","seller_prices_include_vat":false}')$q$) IS NOT NULL AS ok \gset
SELECT tests.check('billing audit: every platform action is in the platform log (agreements, entries, renewals, reversal, plan, request, settings)',
  format($$SELECT (SELECT count(*) FROM public.platform_audit_log WHERE tenant_id = %1$L AND action = 'billing_agreement_saved') = 2
             AND (SELECT count(*) FROM public.platform_audit_log WHERE tenant_id = %1$L AND action = 'billing_renewed') = 2
             AND (SELECT count(*) FROM public.platform_audit_log WHERE tenant_id = %1$L AND action = 'billing_entry_recorded') = 1
             AND (SELECT count(*) FROM public.platform_audit_log WHERE tenant_id = %1$L AND action = 'billing_entry_reversed') = 1
             AND (SELECT count(*) FROM public.platform_audit_log WHERE tenant_id = %1$L AND action = 'billing_request_rejected') = 1
             AND (SELECT count(*) FROM public.platform_audit_log WHERE tenant_id = %2$L AND action = 'billing_plan_applied'
                    AND details ->> 'previous_plan' = 'basic' AND details ->> 'plan' = 'premium') = 1
             AND (SELECT count(*) FROM public.platform_audit_log WHERE tenant_id IS NULL AND action = 'billing_settings_saved') >= 2
             AND (SELECT bool_and(actor_id = 'a0000000-0000-0000-0000-0000000000f0') FROM public.platform_audit_log
                   WHERE action LIKE 'billing\_%%' AND tenant_id IN (%1$L, %2$L))$$, :E_SITE, :'hs'));
SELECT tests.check('billing legacy: billing_history was not touched by any of this',
  format($$SELECT count(*) = %s FROM public.billing_history WHERE id::text NOT LIKE 'b1890000-%%'$$, :legacy_rows_before));
SELECT tests.check('billing renewal: refused while the business has no agreement',
  format($$SELECT pg_temp.plat_err(format('SELECT public.platform_billing_renew(%%L, %%L)', %1$L,
                    billing.engine_state(%1$L) ->> 'renewal_on')) LIKE '%%קודם צריך לקבוע הסכם%%'$$, :E2_SITE));

-- ============================================================
-- 13. Migration 190: the existing financial data — owner only; the old history is append-only
-- ============================================================
INSERT INTO public.billing_history (id, tenant_id, kind, plan_type, amount, payment_status, note, reference) VALUES
  ('b1890000-0000-0000-0000-0000000bb001', 'b1890000-0000-0000-0000-00000000aaa1', 'payment', 'premium', 450, 'paid', 'הערה ישנה', 'ref-old'),
  ('b1890000-0000-0000-0000-0000000bb002', 'b1890000-0000-0000-0000-00000000aaa1', 'payment', 'premium', 100, 'due', NULL, NULL),
  ('b1890000-0000-0000-0000-0000000bb003', 'b1890000-0000-0000-0000-00000000aaa1', 'payment', 'premium', 50, 'due', NULL, NULL);
SELECT tests.check('190 store: direct reads of the subscription and the old payment history — the owner yes, a manager no',
  format($$SELECT (pg_temp.call(%1$L, %2$L, 'SELECT to_jsonb(count(*)) FROM public.tenant_subscriptions'))::text::int = 1
             AND (pg_temp.call(%1$L, %3$L, 'SELECT to_jsonb(count(*)) FROM public.tenant_subscriptions'))::text::int = 0
             AND (pg_temp.call(%1$L, %2$L, 'SELECT to_jsonb(count(*)) FROM public.billing_history'))::text::int = 3
             AND (pg_temp.call(%1$L, %3$L, 'SELECT to_jsonb(count(*)) FROM public.billing_history'))::text::int = 0$$,
         :E_SITE, :E_OWNER, :E_MGR));
SELECT tests.check('190 store: "my subscription" for a manager — the plan state only: no payment history, no billing profile, no add-on amounts',
  format($$SELECT m -> 'history' = '[]' AND m -> 'billing_profile' = 'null' AND NOT (m ->> 'owner_view')::boolean
             AND m -> 'subscription' ->> 'plan' = 'premium'
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(m -> 'addons') a WHERE a ? 'amount')
             AND (o ->> 'owner_view')::boolean AND jsonb_array_length(o -> 'history') = 3
             AND position('ref-old' IN m::text) = 0
           FROM (SELECT pg_temp.call(%1$L, %3$L, 'SELECT public.store_billing()') AS m,
                        pg_temp.call(%1$L, %2$L, 'SELECT public.store_billing()') AS o) x$$,
         :E_SITE, :E_OWNER, :E_MGR));
SELECT tests.check('190 zimmer: the subscription row (with the internal note) — the owner yes; the business admin and a manager no',
  format($$SELECT (pg_temp.call(%1$L, %2$L, 'SELECT to_jsonb(count(*)) FROM hospitality.subscriptions'))::text::int = 1
             AND (pg_temp.call(%1$L, %3$L, 'SELECT to_jsonb(count(*)) FROM hospitality.subscriptions'))::text::int = 0
             AND (pg_temp.call(%1$L, %4$L, 'SELECT to_jsonb(count(*)) FROM hospitality.subscriptions'))::text::int = 0
             AND pg_temp.call(%1$L, %2$L, 'SELECT hospitality.my_entitlements()') ->> 'plan' = 'premium'
             AND pg_temp.err(%1$L, %3$L, 'SELECT hospitality.my_entitlements()') LIKE '%%הרשאה%%'
             AND pg_temp.err(%1$L, %4$L, 'SELECT hospitality.my_entitlements()') LIKE '%%הרשאה%%'$$,
         :'hs', :H_OWNER, :H_BA, :H_MGR));
SELECT tests.check('190 zimmer: a manager still gets the short plan form in the management context (active / unit limit / used), not the dates',
  format($$SELECT (c ? 'units_used') AND (c ? 'active') AND NOT (c ? 'current_period_end') AND NOT (c ? 'trial_ends_at')
           FROM (SELECT pg_temp.call(%L, %L, 'SELECT hospitality.management_context()') -> 'entitlements' AS c) x$$, :'hs', :H_MGR));
SELECT pg_temp.plat(format($$SELECT hospitality.admin_set_subscription(%L, 'premium', 'active', NULL, now() + interval '40 days', 0, 'הערה חדשה')$$, :'hs')) IS NOT NULL AS ok \gset
SELECT tests.check('190 zimmer: changing the subscription logs the previous and new dates and whether the note changed (not the note)',
  format($$SELECT d -> 'previous' ->> 'current_period_end' IS NOT NULL AND d ->> 'current_period_end' IS NOT NULL
             AND (d ->> 'note_changed')::boolean AND position('הערה חדשה' IN d::text) = 0
           FROM (SELECT details AS d FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'hosp_subscription_set'
                  ORDER BY id DESC LIMIT 1) x$$, :'hs'));
SELECT tests.check('190 history: a recorded payment cannot be edited or deleted, even by the database owner',
  $$SELECT pg_temp.db_err($q$UPDATE public.billing_history SET amount = 1 WHERE id = 'b1890000-0000-0000-0000-0000000bb001'$q$) LIKE '%לא נערכת%'
       AND pg_temp.db_err($q$UPDATE public.billing_history SET note = 'x' WHERE id = 'b1890000-0000-0000-0000-0000000bb001'$q$) LIKE '%לא נערכת%'
       AND pg_temp.db_err($q$DELETE FROM public.billing_history WHERE id = 'b1890000-0000-0000-0000-0000000bb001'$q$) LIKE '%לא נמחקת%'
       AND (SELECT amount = 450 AND note = 'הערה ישנה' FROM public.billing_history WHERE id = 'b1890000-0000-0000-0000-0000000bb001')$$);
-- each action in its own statement (the order of AND terms is not guaranteed)
SELECT COALESCE(pg_temp.db_err($q$UPDATE public.billing_history SET payment_status = 'paid', paid_at = now(), reference = 'r2'
                                  WHERE id = 'b1890000-0000-0000-0000-0000000bb002'$q$), '') AS h_paid \gset
SELECT COALESCE(pg_temp.db_err($q$UPDATE public.billing_history SET payment_status = 'due', paid_at = NULL
                                  WHERE id = 'b1890000-0000-0000-0000-0000000bb002'$q$), '') AS h_unpaid \gset
SELECT COALESCE(pg_temp.db_err($q$DELETE FROM public.billing_history WHERE id = 'b1890000-0000-0000-0000-0000000bb003'$q$), '') AS h_del_due \gset
SELECT COALESCE(pg_temp.db_err($q$UPDATE public.billing_history SET store_label = 'נמחקה (x)' WHERE id = 'b1890000-0000-0000-0000-0000000bb001'$q$), '') AS h_label \gset
SELECT COALESCE(pg_temp.db_err($q$UPDATE public.billing_history SET store_label = 'שוב' WHERE id = 'b1890000-0000-0000-0000-0000000bb001'$q$), '') AS h_label2 \gset
SELECT tests.check('190 history: the existing flows still work — a pending charge marked paid, a pending charge deleted, the store label once',
  format($$SELECT %L = '' AND %L LIKE '%%לא נערכת%%' AND %L = '' AND %L = '' AND %L LIKE '%%לא נערכת%%'
             AND NOT EXISTS (SELECT 1 FROM public.billing_history WHERE id = 'b1890000-0000-0000-0000-0000000bb003')
             AND (SELECT payment_status = 'paid' AND reference = 'r2' FROM public.billing_history WHERE id = 'b1890000-0000-0000-0000-0000000bb002')$$,
         :'h_paid', :'h_unpaid', :'h_del_due', :'h_label', :'h_label2'));

-- ============================================================
-- 14. A payment copied later from the old history (legacy_import, a separate approved step): it counts in
--     "total paid" only — not against new charges, so the owner never sees a credit that does not exist
-- ============================================================
SELECT tests.check('billing legacy gap: the old "record payment" rows not in the new ledger — shown to the platform admin only (read-only)',
  format($$SELECT (c -> 'legacy_unmatched' ->> 'paid_count')::int = 2 AND (c -> 'legacy_unmatched' ->> 'paid_amount')::numeric = 550
             AND (c -> 'legacy_unmatched' ->> 'due_count')::int = 0
             AND jsonb_array_length(c -> 'legacy_unmatched' -> 'rows') = 2
             AND NOT (o ? 'legacy_unmatched')
             AND (SELECT (i ->> 'paid_amount')::numeric = 550 AND NOT (i ->> 'deleted')::boolean
                    FROM jsonb_array_elements(v -> 'items') i WHERE i ->> 'tenant_id' = %1$L)
             AND (v ->> 'businesses')::int >= 1
           FROM (SELECT pg_temp.plat(format('SELECT public.platform_billing_card(%%L)', %1$L)) AS c,
                        pg_temp.call(%1$L, %2$L, 'SELECT public.my_billing_summary()') AS o,
                        pg_temp.plat('SELECT public.platform_billing_legacy_overview()') AS v) x$$, :E_SITE, :E_OWNER));
SELECT (pg_temp.call(:E_SITE, :E_OWNER, 'SELECT public.my_billing_summary()')) AS e_before_legacy \gset
-- an old row: the dealer type was not stored then (NULL), VAT 0 — nothing is guessed
INSERT INTO billing.ledger (tenant_id, tenant_label, engine, kind, category, amount, vat_rate, vat_amount, net_amount,
                            occurred_on, method, description, source, legacy_ref)
VALUES (:E_SITE, 'x', 'ecommerce', 'payment', 'subscription', 450, 0, 0, 450, current_date - 400, 'other',
        'תשלום מההיסטוריה הקודמת', 'legacy_import', 'b1890000-0000-0000-0000-0000000bb001');
SELECT tests.check('billing legacy copy: total paid +450; the subscription due / paid / balance and the total balance unchanged',
  format($$SELECT (a -> 'total' ->> 'paid')::numeric = (b -> 'total' ->> 'paid')::numeric + 450
             AND (a ->> 'legacy_paid')::numeric = 450
             AND a -> 'subscription_money' = b -> 'subscription_money'
             AND (a -> 'total' ->> 'balance')::numeric = (b -> 'total' ->> 'balance')::numeric
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(a -> 'entries') e WHERE e ->> 'source' = 'legacy_import'
                           AND e ->> 'confirmation' = 'manual')
           FROM (SELECT pg_temp.call(%L, %L, 'SELECT public.my_billing_summary()') AS a, %L::jsonb AS b) x$$,
         :E_SITE, :E_OWNER, :'e_before_legacy'));
SELECT tests.check('billing legacy gap: a copied row leaves the warning; the old row itself is untouched',
  format($$SELECT (pg_temp.plat(format('SELECT public.platform_billing_card(%%L)', %L)) -> 'legacy_unmatched' ->> 'paid_amount')::numeric = 100
             AND (SELECT amount = 450 AND payment_status = 'paid' FROM public.billing_history WHERE id = 'b1890000-0000-0000-0000-0000000bb001')$$,
         :E_SITE));
SELECT tests.check('billing legacy copy: the same old row cannot be copied twice (legacy_ref is unique)',
  $$SELECT pg_temp.db_err($q$INSERT INTO billing.ledger (tenant_id, tenant_label, engine, kind, category, amount, vat_rate,
             vat_amount, net_amount, occurred_on, source, legacy_ref)
             VALUES ('b1890000-0000-0000-0000-00000000aaa1', 'x', 'ecommerce', 'payment', 'subscription', 450, 0, 0, 450,
                     current_date, 'legacy_import', 'b1890000-0000-0000-0000-0000000bb001')$q$) LIKE '%duplicate key%'$$);

-- ============================================================
-- 15. Request / cancel in a loop: at most 10 requests a day per business
-- ============================================================
DO $$
BEGIN
  FOR i IN 1..8 LOOP
    PERFORM pg_temp.call('b1890000-0000-0000-0000-00000000aaa2', 'b1890000-0000-0000-0000-0000000000e3',
      $q$SELECT public.my_billing_cancel_request((public.my_billing_request_upgrade('basic') ->> 'id')::uuid)$q$);
  END LOOP;
END $$;
SELECT tests.check('billing requests: after 10 in one day (request + cancel loop) the next one is refused',
  format($$SELECT (SELECT count(*) FROM billing.upgrade_requests WHERE tenant_id = %1$L) < 10
             AND pg_temp.call(%1$L, %2$L, $q$SELECT public.my_billing_cancel_request((public.my_billing_request_upgrade('basic') ->> 'id')::uuid)$q$) IS NOT NULL
             AND pg_temp.call(%1$L, %2$L, $q$SELECT public.my_billing_cancel_request((public.my_billing_request_upgrade('basic') ->> 'id')::uuid)$q$) IS NOT NULL
             AND pg_temp.err(%1$L, %2$L, $q$SELECT public.my_billing_request_upgrade('basic')$q$) LIKE '%%יותר מדי בקשות%%'$$,
         :E2_SITE, :E2_OWNER));

-- ============================================================
-- 16. Nuriel back to exempt: new charges carry no VAT even on an agreement signed as authorized;
--     the stored rows keep their snapshot; a reversal mirrors the original row
-- ============================================================
SELECT (SELECT count(*) FROM billing.ledger) AS rows_before_exempt,
       (SELECT md5(string_agg(to_jsonb(l)::text, ',' ORDER BY entry_no)) FROM billing.ledger l) AS ledger_md5,
       (SELECT md5(string_agg(to_jsonb(a)::text, ',' ORDER BY id)) FROM billing.agreements a) AS agreements_md5 \gset
SELECT pg_temp.plat($q$SELECT public.platform_billing_save_settings('{"seller_business_type":"exempt"}')$q$) IS NOT NULL AS ok \gset
SELECT tests.check('billing VAT exempt again: no stored agreement or ledger row changed',
  format($$SELECT (SELECT md5(string_agg(to_jsonb(l)::text, ',' ORDER BY entry_no)) FROM billing.ledger l) = %L
             AND (SELECT md5(string_agg(to_jsonb(a)::text, ',' ORDER BY id)) FROM billing.agreements a) = %L$$,
         :'ledger_md5', :'agreements_md5'));
SELECT pg_temp.plat_err(format('SELECT public.platform_billing_record_entry(%L, %L)', :E_SITE,
         '{"kind":"charge","category":"other","amount":118,"vat_rate":18}')) AS exempt_rate_err \gset
SELECT pg_temp.plat(format('SELECT public.platform_billing_record_entry(%L, %L)', :E_SITE,
         '{"kind":"charge","category":"other","amount":118,"description":"ב-פטור"}')) IS NOT NULL AS ok \gset
SELECT tests.check('billing VAT exempt again: a manual charge with a VAT rate is refused; without one it is stored with VAT 0',
  format($$SELECT %L LIKE '%%עוסק פטור%%'
             AND (SELECT vat_business_type = 'exempt' AND vat_rate = 0 AND vat_amount = 0 AND net_amount = 118
                    FROM billing.ledger WHERE tenant_id = %L AND description = 'ב-פטור')$$, :'exempt_rate_err', :E_SITE));
SELECT o.id AS auth_row FROM billing.ledger o
 WHERE o.tenant_id = :'hs' AND o.vat_business_type = 'authorized' AND o.vat_rate = 18 AND o.kind = 'charge'
   AND NOT EXISTS (SELECT 1 FROM billing.ledger x WHERE x.reverses_id = o.id)
 ORDER BY o.entry_no LIMIT 1 \gset
SELECT pg_temp.plat(format('SELECT public.platform_billing_reverse_entry(%L, %L)', :'auth_row', 'בדיקת ביטול')) IS NOT NULL AS ok \gset
SELECT tests.check('billing VAT exempt again: reversing an authorized row mirrors it (18%, authorized) — history is not rewritten',
  format($$SELECT r.vat_business_type = 'authorized' AND r.vat_rate = 18 AND r.vat_amount = o.vat_amount AND r.amount = o.amount
           FROM billing.ledger o JOIN billing.ledger r ON r.reverses_id = o.id WHERE o.id = %L$$, :'auth_row'));

-- ---------- cleanup: the global flags as found (later files check that they are off) ----------
SELECT pg_temp.plat($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', false),
       public.platform_set_flag('hospitality_management_enabled', false)])$$) IS NOT NULL AS ok \gset

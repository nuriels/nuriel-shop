-- ============================================================
-- VAT by dealer type (migration 191): the central rate, each store's own setting, the snapshot on every order
--   • the central rate: 18% from 2025-01-01, server side only; a new rate only from a future date (platform
--     admin), an effective rate is never edited or deleted
--   • every store holds its own dealer type — exempt (0%, locked) or authorized (central rate, prices with /
--     without VAT); only the owner changes it, through store_save_vat_settings; existing stores unchanged
--   • every new order stores the dealer type, the rate and "prices include VAT" from the server (what the
--     browser sends is overwritten), and the database derives net / VAT / total; the snapshot never changes
--   • the same rounding as order_gross (the amount charged) and calculateVat in the app
-- ============================================================
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set OA '''a0000000-0000-0000-0000-0000000000a1'''
\set B1 '''a0000000-0000-0000-0000-0000000000b1'''
\set B2 '''a0000000-0000-0000-0000-0000000000b2'''
\set SA '''70000000-0000-0000-0000-00000000000a'''
\set SB '''70000000-0000-0000-0000-00000000000b'''
\set VC '''a0000000-0000-0000-0000-0000000191c1'''

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
CREATE OR REPLACE FUNCTION pg_temp.owner_err(_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE e text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN e := SQLERRM;
  END;
  RETURN e;
END $f$;
-- a new order in store B, as a store admin (like a manual / POS order); the browser "sends" a wrong VAT
CREATE OR REPLACE FUNCTION pg_temp.new_order(_note text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  r := pg_temp.as_user('70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000b1',
    format($q$WITH x AS (INSERT INTO public.orders (customer_id, kind, note, vat_rate, prices_include_vat)
                          VALUES ('a0000000-0000-0000-0000-0000000191c1', 'order', %L, 3, true) RETURNING id)
              SELECT to_jsonb(id) FROM x$q$, _note));
  RETURN (r #>> '{}')::uuid;
END $f$;

INSERT INTO auth.users (id, email) VALUES (:VC, 'vat.customer@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES (:SB, :VC, 'vat.customer@test.local', 'vat_customer', 'customer', true) ON CONFLICT DO NOTHING;

-- ============================================================
-- 1. The central rate
-- ============================================================
SELECT tests.check('vat central: 18% from 2025-01-01 is the rate today; no API user reads or writes the table directly',
  $$SELECT public.vat_rate_on() = 18 AND public.vat_rate_on(DATE '2025-01-01') = 18
       AND (SELECT count(*) FROM public.vat_rates WHERE effective_from = DATE '2025-01-01' AND rate = 18) = 1
       AND NOT has_table_privilege('anon', 'public.vat_rates', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'public.vat_rates', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'public.vat_rates', 'INSERT')
       AND has_function_privilege('anon', 'public.store_vat_profile()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.store_save_vat_settings(text,boolean)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.tenant_vat_profile(uuid,date)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.platform_vat_rates()', 'EXECUTE')$$);
SELECT tests.check('vat central: an effective rate cannot be edited or deleted, even by the database owner',
  $$SELECT pg_temp.owner_err('UPDATE public.vat_rates SET rate = 17') LIKE '%לא נערך%'
       AND pg_temp.owner_err($q$DELETE FROM public.vat_rates WHERE effective_from = DATE '2025-01-01'$q$) LIKE '%לא נמחק%'
       AND pg_temp.owner_err('TRUNCATE public.vat_rates') IS NOT NULL
       AND public.vat_rate_on() = 18$$);
SELECT tests.check('vat central: only the platform admin schedules a rate, and only from a future date (never retroactive)',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, 'SELECT public.platform_vat_rate_schedule(19, current_date + 30)') LIKE '%%רק מנהל הפלטפורמה%%'
             AND pg_temp.user_err(NULL, %3$L, $q$SELECT public.platform_vat_rate_schedule(19, (now() AT TIME ZONE 'Asia/Jerusalem')::date)$q$)
                   LIKE '%%מתאריך עתידי%%'
             AND pg_temp.user_err(NULL, %3$L, 'SELECT public.platform_vat_rate_schedule(19, DATE ''2025-06-01'')') LIKE '%%מתאריך עתידי%%'
             AND pg_temp.user_err(NULL, %3$L, 'SELECT public.platform_vat_rate_schedule(100, current_date + 30)') LIKE '%%0 עד 99.99%%'$$,
         :SB, :B1, :PLATFORM));
SELECT pg_temp.as_user(NULL, :PLATFORM, 'SELECT public.platform_vat_rate_schedule(19, current_date + 30, ''בדיקה'')') AS sched \gset
SELECT tests.check('vat central: a scheduled rate applies from its date only; today stays 18; audited',
  format($$SELECT (%1$L::jsonb ->> 'current')::numeric = 18
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb -> 'rates') r
                          WHERE (r ->> 'rate')::numeric = 19 AND (r ->> 'scheduled')::boolean)
             AND public.vat_rate_on() = 18 AND public.vat_rate_on(current_date + 31) = 19
             AND (public.tenant_vat_profile(%2$L, current_date + 31) ->> 'vat_rate')::numeric = 19
             AND (public.tenant_vat_profile(%2$L, NULL) ->> 'vat_rate')::numeric = 18
             AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE action = 'vat_rate_scheduled'
                           AND (details ->> 'rate')::numeric = 19)
             AND pg_temp.user_err(NULL, %3$L, 'SELECT public.platform_vat_rate_schedule(20, current_date + 30)') LIKE '%%כבר נקבע%%'$$,
         :'sched', :SB, :PLATFORM));
SELECT id AS sched_id FROM public.vat_rates WHERE rate = 19 AND effective_from > current_date \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, format('SELECT public.platform_vat_rate_cancel(%s)', :sched_id)) IS NOT NULL AS ok \gset
SELECT tests.check('vat central: a scheduled rate can be canceled before its date; an effective one cannot',
  format($$SELECT NOT EXISTS (SELECT 1 FROM public.vat_rates WHERE id = %1$s)
             AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE action = 'vat_rate_canceled')
             AND pg_temp.user_err(NULL, %2$L, format('SELECT public.platform_vat_rate_cancel(%%s)',
                   (SELECT id FROM public.vat_rates WHERE effective_from = DATE '2025-01-01'))) LIKE '%%לא מבוטל%%'$$,
         :sched_id, :PLATFORM));

-- ============================================================
-- 2. Each store holds its own setting — nothing is inferred from Nuriel
-- ============================================================
SELECT tests.check('vat store: existing stores keep their own type and are not marked as confirmed by the migration',
  $$SELECT bool_and(s.vat_settings_confirmed_at IS NULL) AND bool_and(s.business_type IN ('exempt', 'authorized'))
     FROM public.site_settings s WHERE s.tenant_id IN ('70000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000b',
                                                       '70000000-0000-0000-0000-00000000000c')$$);
SELECT pg_temp.as_user(:SA, :OA, $q$SELECT public.store_save_vat_settings('exempt', NULL)$q$) AS save_a \gset
SELECT pg_temp.as_user(:SB, :B1, $q$SELECT public.store_save_vat_settings('authorized', false)$q$) AS save_b \gset
SELECT tests.check('vat store: two stores hold different settings at the same time (one exempt, one authorized)',
  format($$SELECT %3$L::jsonb ->> 'business_type' = 'exempt' AND %4$L::jsonb ->> 'business_type' = 'authorized'
             AND (SELECT business_type FROM public.site_settings WHERE tenant_id = %1$L) = 'exempt'
             AND (SELECT business_type FROM public.site_settings WHERE tenant_id = %2$L) = 'authorized'$$,
         :SA, :SB, :'save_a', :'save_b'));
SELECT tests.check('vat store: the storefront (anon) sees each store''s own profile — exempt 0%, authorized 18% before VAT',
  format($$SELECT a ->> 'business_type' = 'exempt' AND (a ->> 'vat_rate')::numeric = 0 AND (a ->> 'prices_include_vat')::boolean
             AND b ->> 'business_type' = 'authorized' AND (b ->> 'vat_rate')::numeric = 18 AND NOT (b ->> 'prices_include_vat')::boolean
             AND (b ->> 'confirmed')::boolean
           FROM (SELECT pg_temp.as_user(%L, NULL, 'SELECT public.store_vat_profile()') AS a,
                        pg_temp.as_user(%L, NULL, 'SELECT public.store_vat_profile()') AS b) x$$, :SA, :SB));
SELECT tests.check('vat store: only the owner changes it — a manager, a customer and a guest are refused',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, $q$SELECT public.store_save_vat_settings('exempt', NULL)$q$) LIKE '%%רק בעל העסק%%'
             AND pg_temp.user_err(%1$L, %3$L, $q$SELECT public.store_save_vat_settings('exempt', NULL)$q$) LIKE '%%רק בעל העסק%%'
             AND pg_temp.user_err(%1$L, NULL, $q$SELECT public.store_save_vat_settings('exempt', NULL)$q$) IS NOT NULL
             AND (SELECT business_type FROM public.site_settings WHERE tenant_id = %1$L) = 'authorized'$$,
         :SB, :B2, :VC));
SELECT tests.check('vat store: an authorized dealer must choose whether prices include VAT; an unknown type is refused',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, $q$SELECT public.store_save_vat_settings('authorized', NULL)$q$) LIKE '%%כוללים מע"מ%%'
             AND pg_temp.user_err(%1$L, %2$L, $q$SELECT public.store_save_vat_settings('company', true)$q$) LIKE '%%פטור או מורשה%%'$$,
         :SB, :B1));
SELECT tests.check('vat store: a direct settings update cannot change the type, "prices include VAT" or the confirmation (owner too)',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, $q$WITH x AS (UPDATE public.site_settings SET business_type = 'exempt' RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$)
                   LIKE '%%נשמרים במסך%%'
             AND pg_temp.user_err(%1$L, %2$L, $q$WITH x AS (UPDATE public.site_settings SET prices_include_vat = true RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$)
                   LIKE '%%נשמרים במסך%%'
             AND pg_temp.user_err(%1$L, %2$L, $q$WITH x AS (UPDATE public.site_settings SET vat_settings_confirmed_at = NULL RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$)
                   LIKE '%%נשמרים במסך%%'$$,
         :SB, :B1));
SELECT pg_temp.as_user(:SB, :B1, $q$WITH x AS (UPDATE public.site_settings SET site_title = 'חנות B', vat_rate = 5 RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$) AS upd \gset
SELECT tests.check('vat store: other settings still save; vat_rate is always derived (never what was sent) — even for the database owner',
  format($$SELECT %L::text = '1' AND (SELECT vat_rate FROM public.site_settings WHERE tenant_id = %2$L) = 18
             AND pg_temp.owner_err(format('UPDATE public.site_settings SET vat_rate = 17 WHERE tenant_id = %%L', %2$L)) IS NULL
             AND (SELECT vat_rate FROM public.site_settings WHERE tenant_id = %2$L) = 18
             AND (SELECT vat_rate FROM public.site_settings WHERE tenant_id = %3$L) = 0$$, :'upd', :SB, :SA));
SELECT tests.check('vat store: an exempt store can never charge VAT — prices are final, rate 0 (even when the owner sends "+VAT")',
  format($$SELECT (pg_temp.as_user(%1$L, %2$L, $q$SELECT public.store_save_vat_settings('exempt', false)$q$) ->> 'prices_include_vat')::boolean
             AND (SELECT vat_rate = 0 AND prices_include_vat FROM public.site_settings WHERE tenant_id = %1$L)$$, :SA, :OA));
SELECT tests.check('vat store: every change is in the platform log (type before / after)',
  format($$SELECT EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'store_vat_settings_saved'
                            AND details ->> 'business_type' = 'authorized' AND details -> 'previous' ->> 'business_type' = 'authorized'
                            AND NOT (details -> 'previous' ->> 'confirmed')::boolean)$$, :SB));

-- ============================================================
-- 3. The order snapshot — server side, frozen
-- ============================================================
SELECT pg_temp.new_order('vat-auth-ex') AS o1 \gset
UPDATE public.orders SET shipping_price = 100 WHERE id = :'o1';
SELECT tests.check('vat order: authorized + before VAT — the browser''s 3% is overwritten; 100 → VAT 18, total 118',
  format($$SELECT o.vat_business_type = 'authorized' AND o.vat_rate = 18 AND NOT o.prices_include_vat
             AND o.total = 100 AND o.net_amount = 100 AND o.vat_amount = 18 AND o.gross_amount = 118
             AND o.gross_amount = public.order_gross(o.total, o.prices_include_vat, o.vat_rate)
             AND o.gross_amount = public.order_amount_due(o.total, o.prices_include_vat, o.vat_rate)
           FROM public.orders o WHERE o.id = %L$$, :'o1'));
SELECT tests.check('vat order: the snapshot never changes after creation — not by a store admin, not by the database owner',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, format($q$WITH x AS (UPDATE public.orders SET vat_rate = 0 WHERE id = %%L RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$, %3$L))
                   LIKE '%%נשמר ברגע יצירתה%%'
             AND pg_temp.owner_err(format('UPDATE public.orders SET prices_include_vat = true WHERE id = %%L', %3$L)) LIKE '%%נשמר ברגע יצירתה%%'
             AND pg_temp.owner_err(format($q$UPDATE public.orders SET vat_business_type = 'exempt' WHERE id = %%L$q$, %3$L)) LIKE '%%נשמר ברגע יצירתה%%'
             AND pg_temp.owner_err(format('UPDATE public.orders SET gross_amount = 1 WHERE id = %%L', %3$L)) IS NOT NULL$$,
         :SB, :B1, :'o1'));
-- editing the order (a manual discount) recomputes the total; the VAT follows from the stored snapshot
UPDATE public.orders SET shipping_price = 250 WHERE id = :'o1';
SELECT tests.check('vat order: editing the amount recomputes net / VAT / total from the frozen rate (250 → 45 → 295)',
  format($$SELECT o.vat_rate = 18 AND o.total = 250 AND o.vat_amount = 45 AND o.gross_amount = 295 AND o.net_amount = 250
           FROM public.orders o WHERE o.id = %L$$, :'o1'));

SELECT pg_temp.as_user(:SB, :B1, $q$SELECT public.store_save_vat_settings('exempt', NULL)$q$) IS NOT NULL AS ok \gset
SELECT pg_temp.new_order('vat-exempt') AS o2 \gset
UPDATE public.orders SET shipping_price = 100 WHERE id = :'o2';
SELECT tests.check('vat order: after the store turns exempt — a new order has no VAT (100 = 100); the earlier order is unchanged',
  format($$SELECT n.vat_business_type = 'exempt' AND n.vat_rate = 0 AND n.prices_include_vat
             AND n.vat_amount = 0 AND n.gross_amount = 100 AND n.net_amount = 100
             AND p.vat_business_type = 'authorized' AND p.vat_rate = 18 AND p.gross_amount = 295
           FROM public.orders n, public.orders p WHERE n.id = %L AND p.id = %L$$, :'o2', :'o1'));

SELECT pg_temp.as_user(:SB, :B1, $q$SELECT public.store_save_vat_settings('authorized', true)$q$) IS NOT NULL AS ok \gset
SELECT pg_temp.new_order('vat-auth-in') AS o3 \gset
UPDATE public.orders SET shipping_price = 118 WHERE id = :'o3';
SELECT tests.check('vat order: authorized + prices include VAT — 118 stays 118 (no double VAT): 100 + 18',
  format($$SELECT o.vat_business_type = 'authorized' AND o.prices_include_vat AND o.vat_rate = 18
             AND o.gross_amount = 118 AND o.vat_amount = 18 AND o.net_amount = 100
             AND public.order_amount_due(o.total, o.prices_include_vat, o.vat_rate) = 118
           FROM public.orders o WHERE o.id = %L$$, :'o3'));

-- an order from before migration 191: its stored values are kept, the dealer type stays unknown (NULL)
SET session_replication_role = replica;
INSERT INTO public.orders (id, tenant_id, customer_id, status, kind, total, vat_rate, prices_include_vat, note, order_number)
VALUES ('a1910000-0000-0000-0000-0000000000d1', :SB, :VC, 'delivered', 'order', 200, 17, false, 'vat-old', 'SH249999999');
SET session_replication_role = origin;
SELECT tests.check('vat order: an old order keeps its own 17% (200 → 34 → 234) and no guessed dealer type',
  $$SELECT o.vat_business_type IS NULL AND o.vat_rate = 17 AND o.vat_amount = 34 AND o.gross_amount = 234 AND o.net_amount = 200
     FROM public.orders o WHERE o.id = 'a1910000-0000-0000-0000-0000000000d1'$$);

-- a scheduled rate does not touch any stored order
SELECT pg_temp.as_user(NULL, :PLATFORM, 'SELECT public.platform_vat_rate_schedule(19.5, current_date + 10)') IS NOT NULL AS ok \gset
SELECT tests.check('vat order: scheduling a future rate changes no stored order (all snapshots as they were)',
  $$SELECT (SELECT string_agg(note || ':' || vat_rate || ':' || gross_amount, ',' ORDER BY note)
              FROM public.orders WHERE note IN ('vat-auth-ex', 'vat-exempt', 'vat-auth-in', 'vat-old'))
           = 'vat-auth-ex:18.00:295.00,vat-auth-in:18.00:118.00,vat-exempt:0:100.00,vat-old:17:234.00'
       OR (SELECT string_agg(note || ':' || trim_scale(vat_rate) || ':' || trim_scale(gross_amount), ',' ORDER BY note)
              FROM public.orders WHERE note IN ('vat-auth-ex', 'vat-exempt', 'vat-auth-in', 'vat-old'))
           = 'vat-auth-ex:18:295,vat-auth-in:18:118,vat-exempt:0:100,vat-old:17:234'$$);
SELECT id AS sched2 FROM public.vat_rates WHERE rate = 19.5 \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, format('SELECT public.platform_vat_rate_cancel(%s)', :sched2)) IS NOT NULL AS ok \gset

-- ============================================================
-- 4. Rounding: the same numbers as the app (tests/unit/vat.test.ts uses this exact table)
-- ============================================================
SELECT tests.check('vat rounding: net / VAT / total for 10 cases, as calculateVat',
  $$SELECT bool_and(public.order_vat_amount(t, incl, r) = vat AND public.order_gross(t, incl, r) = gross
                    AND public.order_gross(t, incl, r) - public.order_vat_amount(t, incl, r) = net)
     FROM (VALUES
       (100::numeric, false, 18::numeric, 100::numeric, 18::numeric, 118::numeric),
       (99.99, false, 18, 99.99, 18.00, 117.99),
       (0.30, false, 18, 0.30, 0.05, 0.35),
       (1234.56, false, 17, 1234.56, 209.88, 1444.44),
       (118, true, 18, 100.00, 18.00, 118),
       (10, true, 18, 8.47, 1.53, 10),
       (0.30, true, 18, 0.25, 0.05, 0.30),
       (59.90, true, 18, 50.76, 9.14, 59.90),
       (100, false, 0, 100, 0, 100),
       (100, true, 0, 100, 0, 100)
     ) AS c(t, incl, r, net, vat, gross)$$);

-- ---------- cleanup: store A back to authorized (later files expect the fixtures as they were) ----------
UPDATE public.site_settings SET business_type = 'authorized', prices_include_vat = true, vat_settings_confirmed_at = NULL,
       vat_settings_confirmed_by = NULL WHERE tenant_id IN (:SA, :SB);

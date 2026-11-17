-- ============================================================================
-- RLS ISOLATION PROOF HARNESS  (scratch DBs only: perf_scratch / perf_scratch_b)
--
--   psql -X -q -h /tmp/pg -p 5499 -U postgres -d perf_scratch   -f isolation-check.sql > iso-orig.out
--   psql -X -q -h /tmp/pg -p 5499 -U postgres -d perf_scratch_b -f isolation-check.sql > iso-rewrite.out
--   diff iso-orig.out iso-rewrite.out        # must be EMPTY for the policy rewrite to be considered isolation-preserving
--
-- Requires the data seeded by 01-seed.sql (persona ids come from perf.personas, fixtures from the seeded rows).
-- Everything runs as a real API role (SET LOCAL ROLE anon|authenticated|service_role + the request.jwt.claims /
-- request.headers GUCs PostgREST sets).  Each probe runs in its own sub-transaction that is ALWAYS rolled back
-- (iso.probe raises after measuring), so DML "successes" leave no trace and probes do not influence each other.
--
-- Output: one line per (persona | table | op | result | verdict)
--    result  = rows=<n> fp=<8 hex of md5 of the sorted visible ids>   or   ERR <sqlstate> <normalised message>
--    verdict = LEAK   when a persona NOT listed as allowed got rows>0 from an op that must be refused / is foreign data
--              ok     otherwise
-- The fingerprint makes the comparison cover WHICH rows are visible, not just how many.
-- (03-run-isolation.sh adds the LEAK count / checksum / diff on top of this output.)
-- ============================================================================
\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = warning;
CREATE SCHEMA IF NOT EXISTS iso;
GRANT USAGE ON SCHEMA iso TO PUBLIC;

-- ---------------------------------------------------------------- probe (SECURITY INVOKER on purpose)
CREATE OR REPLACE FUNCTION iso.probe(_kind text, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n bigint := 0; fp text := '-'; msg text;
BEGIN
  BEGIN
    IF _kind = 'sel' THEN
      EXECUTE 'SELECT count(*), coalesce(md5(string_agg(id::text, '','' ORDER BY id::text)), ''-'') FROM (' || _sql || ') q(id)' INTO n, fp;
    ELSE
      EXECUTE _sql;
      GET DIAGNOSTICS n = ROW_COUNT;
    END IF;
    RAISE EXCEPTION 'iso_done';           -- always roll the sub-transaction back
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'iso_done' THEN
      RETURN 'rows=' || n || ' fp=' || left(fp, 8);
    END IF;
    msg := regexp_replace(left(SQLERRM, 90), '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', 'g');
    RETURN 'ERR ' || SQLSTATE || ' ' || msg;
  END;
END $f$;
GRANT EXECUTE ON FUNCTION iso.probe(text, text) TO PUBLIC;

-- ---------------------------------------------------------------- personas
DROP TABLE IF EXISTS iso.personas, iso.ops, iso.ops2, iso.fx;
CREATE TABLE iso.personas (ord int, k text PRIMARY KEY, dbrole text, uid uuid, hdr uuid);
INSERT INTO iso.personas
SELECT v.ord, v.k, v.dbrole,
       CASE WHEN v.pn IS NOT NULL THEN (SELECT user_id FROM perf.personas WHERE name = v.pn)
            WHEN v.k = 'nobody' THEN md5('iso-nobody')::uuid END,
       (SELECT tenant_id FROM perf.personas WHERE name = v.hn)
  FROM (VALUES
    (1,  'anon',    'anon',          NULL,             't1_admin'),
    (2,  'cA',      'authenticated', 't1_customer_a',  't1_admin'),
    (3,  'cB',      'authenticated', 't1_customer_b',  't1_admin'),
    (4,  'cAG',     'authenticated', 't1_customer_ag', 't1_admin'),
    (5,  'agent',   'authenticated', 't1_agent',       't1_admin'),
    (6,  'admin',   'authenticated', 't1_admin',       't1_admin'),
    (7,  'c2',      'authenticated', 't2_customer',    't2_admin'),
    (8,  'c2on1',   'authenticated', 't2_customer',    't1_admin'),   -- tenant-2 customer using the tenant-1 site
    (9,  'a2on1',   'authenticated', 't2_admin',       't1_admin'),   -- tenant-2 admin using the tenant-1 site
    (10, 'plat1',   'authenticated', 'platform_admin', 't1_admin'),
    (11, 'plat2',   'authenticated', 'platform_admin', 't2_admin'),
    (12, 'nobody',  'authenticated', NULL,             't1_admin'),   -- signed-in user with no membership anywhere
    (13, 'service', 'service_role',  NULL,             't1_admin')
  ) v(ord, k, dbrole, pn, hn);

-- ---------------------------------------------------------------- fixtures (looked up as superuser, BEFORE any role switch)
CREATE TABLE iso.fx (k text PRIMARY KEY, v text);
INSERT INTO iso.fx
SELECT * FROM (VALUES
 ('A',     (SELECT user_id::text FROM perf.personas WHERE name = 't1_customer_a')),
 ('B',     (SELECT user_id::text FROM perf.personas WHERE name = 't1_customer_b')),
 ('AG',    (SELECT user_id::text FROM perf.personas WHERE name = 't1_customer_ag')),
 ('AGENT', (SELECT user_id::text FROM perf.personas WHERE name = 't1_agent')),
 ('T1',    (SELECT tenant_id::text FROM perf.personas WHERE name = 't1_admin')),
 ('T2',    (SELECT tenant_id::text FROM perf.personas WHERE name = 't2_admin')),
 ('O_B',   (SELECT id::text FROM public.orders WHERE customer_id = (SELECT user_id FROM perf.personas WHERE name='t1_customer_b') AND status <> 'pending' ORDER BY created_at DESC, id LIMIT 1)),
 ('O_A',   (SELECT id::text FROM public.orders WHERE customer_id = (SELECT user_id FROM perf.personas WHERE name='t1_customer_a') AND status <> 'pending' ORDER BY created_at DESC, id LIMIT 1)),
 ('O_Ap',  (SELECT id::text FROM public.orders WHERE customer_id = (SELECT user_id FROM perf.personas WHERE name='t1_customer_a') AND status = 'pending' ORDER BY created_at DESC, id LIMIT 1)),
 ('O_AG',  (SELECT id::text FROM public.orders WHERE agent_id = (SELECT user_id FROM perf.personas WHERE name='t1_agent') AND customer_id = (SELECT user_id FROM perf.personas WHERE name='t1_customer_ag') ORDER BY created_at DESC, id LIMIT 1)),
 ('O_T2',  (SELECT id::text FROM public.orders WHERE tenant_id = (SELECT tenant_id FROM perf.personas WHERE name='t2_admin') AND customer_id IS DISTINCT FROM (SELECT user_id FROM perf.personas WHERE name='t2_customer') ORDER BY created_at DESC, id LIMIT 1)),
 ('P1',    (SELECT id::text FROM public.global_products WHERE tenant_id = (SELECT tenant_id FROM perf.personas WHERE name='t1_admin') AND sku = '00000010')),
 ('PT2',   (SELECT id::text FROM public.global_products WHERE tenant_id = (SELECT tenant_id FROM perf.personas WHERE name='t2_admin') AND sku = '00000010')),
 ('INQ1',  (SELECT id::text FROM business_profile.inquiries WHERE tenant_id = (SELECT tenant_id FROM perf.personas WHERE name='t1_admin') ORDER BY created_at, id LIMIT 1))
) x(k, v);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM iso.fx WHERE v IS NULL) THEN RAISE EXCEPTION 'iso.fx has NULL fixtures: %', (SELECT string_agg(k, ',') FROM iso.fx WHERE v IS NULL); END IF; END $$;

-- ---------------------------------------------------------------- ops   (allowed = personas that MAY get rows>0)
CREATE TABLE iso.ops (ord int, tbl text, op text, kind text, tpl text, allowed text[]);
INSERT INTO iso.ops (ord, tbl, op, kind, tpl, allowed) VALUES
-- ===== orders
(100,'orders','sel_all','sel','select id from public.orders', NULL),
(101,'orders','sel_B_orders','sel','select id from public.orders where customer_id = ''{B}''', '{cB,admin,plat1,service}'),
(102,'orders','sel_A_orders','sel','select id from public.orders where customer_id = ''{A}''', '{cA,admin,plat1,service}'),
(103,'orders','sel_T2_orders','sel','select id from public.orders where tenant_id = ''{T2}''', '{c2,plat2,service}'),
(104,'orders','sel_agent_orders','sel','select id from public.orders where agent_id = ''{AGENT}''', '{agent,cAG,admin,plat1,service}'),
(105,'orders','sel_guest_orders','sel','select id from public.orders where customer_id is null', '{admin,plat1,plat2,service}'),
(110,'orders','ins_for_B','dml','insert into public.orders (order_number, customer_id, tenant_id) values (''ISO-1'', ''{B}'', ''{T1}'')', '{cB,admin,plat1,service}'),
(111,'orders','ins_for_self','dml','insert into public.orders (order_number, customer_id, tenant_id) values (''ISO-2'', {SELF_LIT}, ''{T1}'')', NULL),
(112,'orders','ins_other_tenant','dml','insert into public.orders (order_number, customer_id, tenant_id) values (''ISO-3'', {SELF_LIT}, ''{T2}'')', '{c2,plat2,service}'),
(113,'orders','ins_for_AG_customer','dml','insert into public.orders (order_number, customer_id, tenant_id) values (''ISO-4'', ''{AG}'', ''{T1}'')', '{cAG,agent,admin,plat1,service}'),
(120,'orders','upd_B_order','dml','update public.orders set note = ''iso'' where id = ''{O_B}''', '{admin,plat1,service}'),
(121,'orders','upd_A_order','dml','update public.orders set note = ''iso'' where id = ''{O_A}''', '{admin,plat1,service}'),
(122,'orders','upd_AG_order','dml','update public.orders set note = ''iso'' where id = ''{O_AG}''', '{agent,admin,plat1,service}'),
(123,'orders','upd_T2_order','dml','update public.orders set note = ''iso'' where id = ''{O_T2}''', '{plat2,service}'),
(124,'orders','upd_steal_order','dml','update public.orders set customer_id = {SELF_LIT} where id = ''{O_B}''', '{admin,plat1,service}'),
(130,'orders','del_B_order','dml','delete from public.orders where id = ''{O_B}''', '{admin,plat1,service}'),
(131,'orders','del_A_order','dml','delete from public.orders where id = ''{O_A}''', '{admin,plat1,service}'),
(132,'orders','del_T2_order','dml','delete from public.orders where id = ''{O_T2}''', '{plat2,service}'),
-- ===== order_items
(200,'order_items','sel_all','sel','select id from public.order_items', NULL),
(201,'order_items','sel_B_items','sel','select id from public.order_items where order_id = ''{O_B}''', '{cB,admin,plat1,service}'),
(202,'order_items','sel_A_items','sel','select id from public.order_items where order_id = ''{O_A}''', '{cA,admin,plat1,service}'),
(203,'order_items','sel_T2_items','sel','select id from public.order_items where tenant_id = ''{T2}''', '{c2,plat2,service}'),
(204,'order_items','sel_AG_items','sel','select id from public.order_items where order_id = ''{O_AG}''', '{agent,cAG,admin,plat1,service}'),
(210,'order_items','ins_into_B_order','dml','insert into public.order_items (order_id, tenant_id, product_id, quantity, unit_price) values (''{O_B}'', ''{T1}'', ''{P1}'', 1, 1)', '{admin,plat1,service}'),
(211,'order_items','ins_into_A_pending','dml','insert into public.order_items (order_id, tenant_id, product_id, quantity, unit_price) values (''{O_Ap}'', ''{T1}'', ''{P1}'', 1, 1)', '{cA,admin,plat1,service}'),
(212,'order_items','ins_into_T2_order','dml','insert into public.order_items (order_id, tenant_id, product_id, quantity, unit_price) values (''{O_T2}'', ''{T2}'', ''{PT2}'', 1, 1)', '{plat2,service}'),
(213,'order_items','ins_into_AG_order','dml','insert into public.order_items (order_id, tenant_id, product_id, quantity, unit_price) values (''{O_AG}'', ''{T1}'', ''{P1}'', 1, 1)', '{agent,admin,plat1,service}'),
(220,'order_items','upd_B_items','dml','update public.order_items set quantity = 2 where order_id = ''{O_B}''', '{admin,plat1,service}'),
(221,'order_items','upd_A_items','dml','update public.order_items set quantity = 2 where order_id = ''{O_A}''', '{admin,plat1,service}'),
(222,'order_items','upd_AG_items','dml','update public.order_items set quantity = 2 where order_id = ''{O_AG}''', '{agent,admin,plat1,service}'),
(223,'order_items','upd_T2_items','dml','update public.order_items set quantity = 2 where order_id = ''{O_T2}''', '{plat2,service}'),
(230,'order_items','del_B_items','dml','delete from public.order_items where order_id = ''{O_B}''', '{admin,plat1,service}'),
(231,'order_items','del_A_items','dml','delete from public.order_items where order_id = ''{O_A}''', '{admin,plat1,service}'),
(232,'order_items','del_T2_items','dml','delete from public.order_items where order_id = ''{O_T2}''', '{plat2,service}'),
-- ===== customer_profiles
(300,'customer_profiles','sel_all','sel','select user_id from public.customer_profiles', NULL),
(301,'customer_profiles','sel_B','sel','select user_id from public.customer_profiles where user_id = ''{B}''', '{cB,admin,plat1,service}'),
(302,'customer_profiles','sel_AG','sel','select user_id from public.customer_profiles where user_id = ''{AG}''', '{cAG,agent,admin,plat1,service}'),
(303,'customer_profiles','sel_T2','sel','select user_id from public.customer_profiles where tenant_id = ''{T2}''', '{c2,plat2,service}'),
(310,'customer_profiles','ins_self','dml','insert into public.customer_profiles (user_id, business_name, tenant_id, age_confirmed) values ({SELF_LIT}, ''Iso Biz'', ''{T1}'', true)', NULL),
(311,'customer_profiles','ins_for_new_user','dml','insert into public.customer_profiles (user_id, business_name, tenant_id, age_confirmed) values (md5(''iso-new'')::uuid, ''Iso Biz'', ''{T1}'', true)', '{service}'),
(320,'customer_profiles','upd_B','dml','update public.customer_profiles set business_name = ''Iso Biz'' where user_id = ''{B}''', '{cB,admin,plat1,service}'),
(321,'customer_profiles','upd_AG','dml','update public.customer_profiles set business_name = ''Iso Biz'' where user_id = ''{AG}''', '{cAG,agent,admin,plat1,service}'),
(322,'customer_profiles','upd_T2','dml','update public.customer_profiles set business_name = ''Iso Biz'' where tenant_id = ''{T2}''', '{c2,plat2,service}'),
(323,'customer_profiles','upd_self_tier','dml','update public.customer_profiles set price_tier = 3 where user_id = {SELF_LIT}', NULL),
(330,'customer_profiles','del_B','dml','delete from public.customer_profiles where user_id = ''{B}''', '{admin,plat1,service}'),
(331,'customer_profiles','del_T2','dml','delete from public.customer_profiles where tenant_id = ''{T2}''', '{plat2,service}'),
-- ===== user_roles
(400,'user_roles','sel_all','sel','select user_id from public.user_roles', NULL),
(401,'user_roles','sel_B','sel','select user_id from public.user_roles where user_id = ''{B}''', '{cB,admin,plat1,service}'),
(402,'user_roles','sel_T2','sel','select user_id from public.user_roles where tenant_id = ''{T2}''', '{c2,plat2,service}'),
(403,'user_roles','sel_admins_T1','sel','select user_id from public.user_roles where tenant_id = ''{T1}'' and role = ''admin''', '{admin,plat1,service}'),
(404,'user_roles','sel_AG','sel','select user_id from public.user_roles where user_id = ''{AG}''', '{cAG,agent,admin,plat1,service}'),
(410,'user_roles','ins_self_admin','dml','insert into public.user_roles (tenant_id, user_id, email, username, role, is_approved) values (''{T1}'', {SELF_LIT}, ''iso@x.com'', ''iso_x1'', ''admin'', true)', '{service}'),
(411,'user_roles','ins_self_pending','dml','insert into public.user_roles (tenant_id, user_id, email, username, role, is_approved) values (''{T1}'', {SELF_LIT}, ''iso2@x.com'', ''iso_x2'', ''customer'', false)', NULL),
(412,'user_roles','ins_other_user_admin','dml','insert into public.user_roles (tenant_id, user_id, email, username, role, is_approved) values (''{T1}'', ''{B}'', ''iso3@x.com'', ''iso_x3'', ''admin'', true)', '{service}'),
(420,'user_roles','upd_B_role','dml','update public.user_roles set is_approved = false where user_id = ''{B}''', '{cB,admin,plat1,service}'),
(421,'user_roles','upd_self_role','dml','update public.user_roles set role = ''admin'' where user_id = {SELF_LIT}', NULL),
(422,'user_roles','upd_T2_role','dml','update public.user_roles set is_approved = false where tenant_id = ''{T2}''', '{c2,plat2,service}'),
(423,'user_roles','upd_self_username','dml','update public.user_roles set username = ''iso_renamed'' where user_id = {SELF_LIT}', NULL),
(430,'user_roles','del_B_role','dml','delete from public.user_roles where user_id = ''{B}''', '{admin,plat1,service}'),
(431,'user_roles','del_T2_role','dml','delete from public.user_roles where tenant_id = ''{T2}''', '{plat2,service}'),
-- ===== global_products
(500,'global_products','sel_all','sel','select id from public.global_products', '{agent,admin,plat1,plat2,service}'),
(501,'global_products','sel_T1','sel','select id from public.global_products where tenant_id = ''{T1}''', '{agent,admin,plat1,service}'),
(502,'global_products','sel_T2','sel','select id from public.global_products where tenant_id = ''{T2}''', '{plat2,service}'),
(510,'global_products','ins_T1','dml','insert into public.global_products (sku, name, category, tenant_id, created_by) values (''99999991'', ''iso'', ''cat-01'', ''{T1}'', {SELF_LIT})', '{admin,plat1,service}'),
(511,'global_products','ins_T2','dml','insert into public.global_products (sku, name, category, tenant_id, created_by) values (''99999992'', ''iso'', ''cat-01'', ''{T2}'', {SELF_LIT})', '{plat2,service}'),
(520,'global_products','upd_P1','dml','update public.global_products set price_tier1 = 1 where id = ''{P1}''', '{admin,plat1,service}'),
(521,'global_products','upd_PT2','dml','update public.global_products set price_tier1 = 1 where id = ''{PT2}''', '{plat2,service}'),
(522,'global_products','upd_all_T1','dml','update public.global_products set price_tier1 = 1 where tenant_id = ''{T1}'' and sku <= ''00000020''', '{admin,plat1,service}'),
(530,'global_products','del_P1','dml','delete from public.global_products where id = ''{P1}''', '{admin,plat1,service}'),
(531,'global_products','del_PT2','dml','delete from public.global_products where id = ''{PT2}''', '{plat2,service}'),
-- ===== Websites (business_profile) inquiry tables: closed to API roles (no grants); only service_role may SELECT
(600,'bp.inquiries','sel_all','sel','select id from business_profile.inquiries', '{service}'),
(601,'bp.inquiries','ins','dml','insert into business_profile.inquiries (tenant_id, client_key, full_name, phone) values (''{T1}'', gen_random_uuid(), ''Iso Test'', ''0501234567'')', NULL),
(602,'bp.inquiries','upd','dml','update business_profile.inquiries set status = ''done'' where tenant_id = ''{T1}''', NULL),
(603,'bp.inquiries','del','dml','delete from business_profile.inquiries where tenant_id = ''{T1}''', NULL),
(610,'bp.inquiry_notes','sel_all','sel','select id from business_profile.inquiry_notes', '{service}'),
(611,'bp.inquiry_notes','ins','dml','insert into business_profile.inquiry_notes (tenant_id, inquiry_id, body) values (''{T1}'', ''{INQ1}'', ''iso'')', NULL),
(612,'bp.inquiry_notes','upd','dml','update business_profile.inquiry_notes set body = ''iso2'' where tenant_id = ''{T1}''', NULL),
(613,'bp.inquiry_notes','del','dml','delete from business_profile.inquiry_notes where tenant_id = ''{T1}''', NULL),
(620,'bp.inquiry_settings','sel_all','sel','select tenant_id from business_profile.inquiry_settings', '{service}'),
(621,'bp.inquiry_settings','ins','dml','insert into business_profile.inquiry_settings (tenant_id) values (''{T1}'')', NULL),
(622,'bp.inquiry_settings','upd','dml','update business_profile.inquiry_settings set notify_enabled = false where tenant_id = ''{T1}''', NULL),
(623,'bp.inquiry_settings','del','dml','delete from business_profile.inquiry_settings where tenant_id = ''{T1}''', NULL);

-- ---------------------------------------------------------------- generated script (run through \gexec)
CREATE OR REPLACE FUNCTION iso.expand(_tpl text, _uid uuid) RETURNS text LANGUAGE plpgsql STABLE AS $f$
DECLARE r text := _tpl; f record;
BEGIN
  FOR f IN SELECT k, v FROM iso.fx LOOP r := replace(r, '{' || f.k || '}', f.v); END LOOP;
  r := replace(r, '{SELF_LIT}', CASE WHEN _uid IS NULL THEN 'NULL::uuid' ELSE quote_literal(_uid::text) || '::uuid' END);
  RETURN r;
END $f$;

CREATE TEMP TABLE iso_script AS
SELECT row_number() OVER (ORDER BY ord, sub) AS seq, stmt FROM (
  SELECT p.ord, 0 AS sub, 'BEGIN' AS stmt FROM iso.personas p
  UNION ALL SELECT p.ord, 1, format('SET LOCAL ROLE %I', p.dbrole) FROM iso.personas p
  UNION ALL SELECT p.ord, 2, format('SET LOCAL request.jwt.claims = %L',
        CASE WHEN p.uid IS NULL THEN json_build_object('role', p.dbrole)::text
             ELSE json_build_object('sub', p.uid, 'role', p.dbrole)::text END) FROM iso.personas p
  UNION ALL SELECT p.ord, 3, format('SET LOCAL request.headers = %L', json_build_object('x-tenant-id', p.hdr)::text) FROM iso.personas p
  UNION ALL SELECT p.ord, 100 + o.ord,
      format($q$SELECT %L || '|' || %L || '|' || %L || '|' || r.res || '|' || CASE WHEN %L::text[] IS NOT NULL AND r.res ~ '^rows=[1-9]' AND NOT (%L = ANY (%L::text[])) THEN 'LEAK' ELSE 'ok' END FROM (SELECT iso.probe(%L, %L) AS res) r$q$,
             p.k, o.tbl, o.op, o.allowed::text, p.k, o.allowed::text, o.kind, iso.expand(o.tpl, p.uid))
    FROM iso.personas p CROSS JOIN iso.ops o
  UNION ALL SELECT p.ord, 9999, 'ROLLBACK' FROM iso.personas p
) s;

\pset tuples_only on
\pset format unaligned
\pset pager off
\echo # persona|table|op|result|verdict
SELECT stmt FROM iso_script ORDER BY seq \gexec
-- ============================================================================
-- PHASE 2: the 3 Websites (business_profile) tenant_isolation policies.  API roles have NO privileges on these
-- tables (REVOKE ALL; service_role reads and bypasses RLS), so phase 1 only proves "permission denied".  To still
-- exercise the policy EXPRESSIONS (defence in depth: "if someone grants access by mistake"), this phase - inside a
-- transaction that is rolled back - grants the API roles table privileges and adds a permissive USING(true) policy,
-- so that ONLY the RESTRICTIVE tenant_isolation policy decides what is visible / writable.
-- ============================================================================
CREATE TABLE iso.ops2 (ord int, tbl text, op text, kind text, tpl text, allowed text[]);
INSERT INTO iso.ops2 (ord, tbl, op, kind, tpl, allowed)
SELECT t.n * 100 + o.ord, 'bp.' || t.tbl, o.op, o.kind, replace(replace(o.tpl, '{TBL}', 'business_profile.' || t.tbl), '{IDCOL}', t.idcol), o.allowed
  FROM (VALUES (1, 'inquiries', 'id'), (2, 'inquiry_notes', 'id'), (3, 'inquiry_settings', 'tenant_id')) t(n, tbl, idcol)
  CROSS JOIN (VALUES
    (1, 'open_sel_all', 'sel', 'select {IDCOL} from {TBL}', NULL::text[]),
    (2, 'open_sel_T1',  'sel', 'select {IDCOL} from {TBL} where tenant_id = ''{T1}''', '{anon,cA,cB,cAG,agent,admin,plat1,nobody,service}'::text[]),
    (3, 'open_sel_T2',  'sel', 'select {IDCOL} from {TBL} where tenant_id = ''{T2}''', '{c2,plat2,service}'::text[]),
    (4, 'open_upd_T1',  'dml', 'update {TBL} set tenant_id = tenant_id where tenant_id = ''{T1}''', '{anon,cA,cB,cAG,agent,admin,plat1,nobody,service}'::text[]),
    (5, 'open_upd_T2',  'dml', 'update {TBL} set tenant_id = tenant_id where tenant_id = ''{T2}''', '{c2,plat2,service}'::text[]),
    (6, 'open_del_T2',  'dml', 'delete from {TBL} where tenant_id = ''{T2}''', '{c2,plat2,service}'::text[]),
    (7, 'open_move_T1_to_T2', 'dml', 'update {TBL} set tenant_id = ''{T2}'' where tenant_id = ''{T1}''', '{service}'::text[])
  ) o(ord, op, kind, tpl, allowed);
-- inserts (table specific)
INSERT INTO iso.ops2 (ord, tbl, op, kind, tpl, allowed) VALUES
 (110, 'bp.inquiries', 'open_ins_T1', 'dml', 'insert into business_profile.inquiries (tenant_id, client_key, full_name, phone) values (''{T1}'', gen_random_uuid(), ''Iso Test'', ''0501234567'')', NULL),
 (111, 'bp.inquiries', 'open_ins_T2', 'dml', 'insert into business_profile.inquiries (tenant_id, client_key, full_name, phone) values (''{T2}'', gen_random_uuid(), ''Iso Test'', ''0501234567'')', '{c2,plat2,service}'),
 (210, 'bp.inquiry_notes', 'open_ins_T1', 'dml', 'insert into business_profile.inquiry_notes (tenant_id, inquiry_id, body) values (''{T1}'', ''{INQ1}'', ''iso'')', NULL),
 (310, 'bp.inquiry_settings', 'open_ins_T2', 'dml', 'insert into business_profile.inquiry_settings (tenant_id) values (''{T2}'')', '{c2,plat2,service}');

CREATE TEMP TABLE iso_script2 AS
SELECT row_number() OVER (ORDER BY ord, sub) AS seq, stmt FROM (
  SELECT 0 AS ord, 0 AS sub, 'BEGIN' AS stmt
  UNION ALL SELECT 0, 1, 'GRANT USAGE ON SCHEMA business_profile TO anon, authenticated'
  UNION ALL SELECT 0, 2, 'GRANT SELECT, INSERT, UPDATE, DELETE ON business_profile.inquiries, business_profile.inquiry_notes, business_profile.inquiry_settings TO anon, authenticated'
  UNION ALL SELECT 0, 3, format('CREATE POLICY iso_open ON business_profile.%I AS PERMISSIVE FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true)', t)
      FROM (VALUES ('inquiries'), ('inquiry_notes'), ('inquiry_settings')) x(t)
  UNION ALL SELECT p.ord, 0, 'RESET ROLE' FROM iso.personas p WHERE p.k <> 'service'
  UNION ALL SELECT p.ord, 1, format('SET LOCAL ROLE %I', p.dbrole) FROM iso.personas p WHERE p.k <> 'service'
  UNION ALL SELECT p.ord, 2, format('SET LOCAL request.jwt.claims = %L',
        CASE WHEN p.uid IS NULL THEN json_build_object('role', p.dbrole)::text
             ELSE json_build_object('sub', p.uid, 'role', p.dbrole)::text END) FROM iso.personas p WHERE p.k <> 'service'
  UNION ALL SELECT p.ord, 3, format('SET LOCAL request.headers = %L', json_build_object('x-tenant-id', p.hdr)::text) FROM iso.personas p WHERE p.k <> 'service'
  UNION ALL SELECT p.ord, 100 + o.ord,
      format($q$SELECT %L || '|' || %L || '|' || %L || '|' || r.res || '|' || CASE WHEN %L::text[] IS NOT NULL AND r.res ~ '^rows=[1-9]' AND NOT (%L = ANY (%L::text[])) THEN 'LEAK' ELSE 'ok' END FROM (SELECT iso.probe(%L, %L) AS res) r$q$,
             p.k, o.tbl, o.op, o.allowed::text, p.k, o.allowed::text, o.kind, iso.expand(o.tpl, p.uid))
    FROM iso.personas p CROSS JOIN iso.ops2 o WHERE p.k <> 'service'
  UNION ALL SELECT 9999, 0, 'RESET ROLE'
  UNION ALL SELECT 9999, 1, 'ROLLBACK'
) s;
\echo # phase 2: business_profile inquiry tables with API access artificially opened (rolled back)
SELECT stmt FROM iso_script2 ORDER BY seq \gexec
\echo # end

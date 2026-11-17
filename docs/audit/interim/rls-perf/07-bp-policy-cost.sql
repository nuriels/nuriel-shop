-- Cost of the 3 business_profile tenant_isolation policies (inquiries / inquiry_notes / inquiry_settings).
-- Real path: API roles have NO privileges on these tables (permission denied before RLS) and service_role bypasses
-- RLS, so the policies are never evaluated per row in production today.  Hypothetical path (defence in depth, "if a
-- grant is added by mistake"): inside a ROLLBACK transaction grant SELECT + add a permissive USING(true) policy so the
-- restrictive tenant_isolation expression alone decides, then time a full-table count as a tenant-1 customer.
--   psql -X -h /tmp/pg -p 5499 -U postgres -d perf_scratch   -f 07-bp-policy-cost.sql   (original: unwrapped current_tenant_id())
--   psql -X -h /tmp/pg -p 5499 -U postgres -d perf_scratch_b -f 07-bp-policy-cost.sql   (rewritten: (SELECT current_tenant_id()))
\set QUIET on
\pset pager off
SET jit = off;
\echo '== real path: authenticated has privileges on business_profile.inquiries?'
SELECT has_schema_privilege('authenticated', 'business_profile', 'usage') AS schema_usage,
       has_table_privilege('authenticated', 'business_profile.inquiries', 'select') AS table_select,
       pg_get_expr(polqual, polrelid) AS tenant_isolation_expr
  FROM pg_policy WHERE polrelid = 'business_profile.inquiries'::regclass;
BEGIN;
GRANT USAGE ON SCHEMA business_profile TO authenticated;
GRANT SELECT ON business_profile.inquiries, business_profile.inquiry_notes, business_profile.inquiry_settings TO authenticated;
CREATE POLICY iso_open ON business_profile.inquiries AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY iso_open ON business_profile.inquiry_notes AS PERMISSIVE FOR SELECT TO authenticated USING (true);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"838f7b0f-d921-d470-13bd-a3729d11aaaa","role":"authenticated"}';
SET LOCAL request.headers = '{"x-tenant-id":"71000000-0000-0000-0000-000000000001"}';
\echo '== hypothetical path: count(*) over inquiries as a tenant-1 customer (3 runs)'
EXPLAIN (ANALYZE, BUFFERS, TIMING) SELECT count(*) FROM business_profile.inquiries;
EXPLAIN (ANALYZE, BUFFERS, TIMING) SELECT count(*) FROM business_profile.inquiries;
EXPLAIN (ANALYZE, BUFFERS, TIMING) SELECT count(*) FROM business_profile.inquiries;
\echo '== hypothetical path: count(*) over inquiry_notes'
EXPLAIN (ANALYZE, BUFFERS, TIMING) SELECT count(*) FROM business_profile.inquiry_notes;
ROLLBACK;

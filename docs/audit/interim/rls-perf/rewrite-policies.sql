-- ============================================================================
-- EXPERIMENT ONLY (never goes into supabase/migrations): rewrite RLS policies so per-row SECURITY DEFINER
-- helper calls become once-per-statement InitPlans.  Runs in the CURRENT scratch database.
--
--   psql -v scope=core -f rewrite-policies.sql     # the 8 tables in scope of the audit (default)
--   psql -v scope=all  -f rewrite-policies.sql     # every policy in schema public (dry-run use: wrap in BEGIN/ROLLBACK)
--
-- Mechanical rules (applied to the deparsed pg_policy text, then ALTER POLICY ... USING/WITH CHECK):
--   R1  is_admin|is_staff|is_agent|is_cashier(auth.uid())     -> (SELECT is_xxx(auth.uid()))
--   R2  can_view_order(c, a)  -> ((SELECT is_admin(auth.uid())) OR c = (SELECT auth.uid())
--                                  OR (a IS NOT NULL AND a = (SELECT auth.uid())))      -- the function's own body, inlined
--   R3  any remaining bare auth.uid()                          -> (SELECT auth.uid())
--   R4  any remaining bare current_tenant_id()                 -> (SELECT current_tenant_id())
-- Row-dependent helpers (is_agent_of_customer(uid, customer_id), tenant_is_active(tenant_id), ...) are NOT touched
-- except for their auth.uid() argument (R3).  Policy names, commands, roles, PERMISSIVE/RESTRICTIVE are unchanged.
-- ============================================================================
\set ON_ERROR_STOP on
\if :{?scope}
\else
\set scope core
\endif
SELECT set_config('perf.scope', :'scope', false) \gset
CREATE SCHEMA IF NOT EXISTS perf;
DROP TABLE IF EXISTS perf.policy_rewrite_log;
CREATE TABLE perf.policy_rewrite_log (nsp text, rel text, pol text, cmd text, permissive text,
                                      before_using text, after_using text, before_check text, after_check text);

CREATE OR REPLACE FUNCTION perf.rewrite_expr(e text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE r text := e;
BEGIN
  IF r IS NULL THEN RETURN NULL; END IF;
  -- R2: can_view_order(x, y) -> inline body with InitPlan-wrapped auth.uid(); @@UID@@ shields the inner calls from R3
  r := regexp_replace(r, '\mcan_view_order\(([A-Za-z_.]+), ([A-Za-z_.]+)\)',
        '((SELECT is_admin(@@UID@@)) OR (\1 = (SELECT @@UID@@)) OR ((\2 IS NOT NULL) AND (\2 = (SELECT @@UID@@))))', 'g');
  -- R1
  r := regexp_replace(r, '\m(is_admin|is_staff|is_agent|is_cashier)\(auth\.uid\(\)\)', '(SELECT \1(@@UID@@))', 'g');
  -- R3: remaining bare auth.uid() (not already inside "( SELECT auth.uid() ...")
  r := regexp_replace(r, '(?<!SELECT )auth\.uid\(\)', '(SELECT auth.uid())', 'g');
  r := replace(r, '@@UID@@', 'auth.uid()');
  -- R4: bare current_tenant_id() (the already-wrapped form is "( SELECT current_tenant_id() AS current_tenant_id)")
  r := regexp_replace(r, '(?<!SELECT )(?<!public\.)\mcurrent_tenant_id\(\)(?! AS current_tenant_id)', '(SELECT current_tenant_id())', 'g');
  RETURN r;
END $f$;

DO $do$
DECLARE r record; nq text; nw text; stmt text; n int := 0;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname, pol.polname, pol.polcmd, pol.polpermissive,
           pg_get_expr(pol.polqual, pol.polrelid) AS q, pg_get_expr(pol.polwithcheck, pol.polrelid) AS w
      FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE (current_setting('perf.scope') = 'all' AND n.nspname = 'public')
        OR (current_setting('perf.scope') = 'core' AND (n.nspname, c.relname) IN
              (('public','orders'), ('public','order_items'), ('public','customer_profiles'), ('public','user_roles'),
               ('public','global_products'), ('business_profile','inquiries'), ('business_profile','inquiry_notes'),
               ('business_profile','inquiry_settings')))
     ORDER BY 1, 2, 3
  LOOP
    nq := perf.rewrite_expr(r.q); nw := perf.rewrite_expr(r.w);
    IF nq IS DISTINCT FROM r.q OR nw IS DISTINCT FROM r.w THEN
      stmt := format('ALTER POLICY %I ON %I.%I', r.polname, r.nspname, r.relname)
           || CASE WHEN nq IS NOT NULL THEN format(' USING (%s)', nq) ELSE '' END
           || CASE WHEN nw IS NOT NULL THEN format(' WITH CHECK (%s)', nw) ELSE '' END;
      EXECUTE stmt;
      n := n + 1;
      INSERT INTO perf.policy_rewrite_log VALUES (r.nspname, r.relname, r.polname,
        CASE r.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
        CASE WHEN r.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        r.q, (SELECT pg_get_expr(pol.polqual, pol.polrelid) FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=r.nspname AND c.relname=r.relname AND pol.polname=r.polname),
        r.w, (SELECT pg_get_expr(pol.polwithcheck, pol.polrelid) FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=r.nspname AND c.relname=r.relname AND pol.polname=r.polname));
    END IF;
  END LOOP;
  RAISE NOTICE 'rewrote % policies (scope=%)', n, current_setting('perf.scope');
END $do$;

-- Re-count of the P3 claim "89 of 160 public policies call helpers per row without the (SELECT ...) wrapper".
-- A policy counts as "unwrapped" if, after removing every "( SELECT fn(...) AS name)" InitPlan wrapper from the
-- deparsed USING / WITH CHECK text, a helper call (or auth.uid()) is still present.
\pset pager off
CREATE OR REPLACE FUNCTION pg_temp.unwrapped(e text, helpers text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(coalesce(e, ''), '\( SELECT [a-z_.]+\((?:[^()]|\([^()]*\))*\) AS [a-z_]+\)', '', 'g') ~ helpers
$$;
WITH p AS (
  SELECT n.nspname, c.relname, pol.polname, pol.polpermissive,
         coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') AS txt
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace)
SELECT nspname,
       count(*) AS policies,
       count(*) FILTER (WHERE pg_temp.unwrapped(txt, '\m(is_admin|is_staff|staff_can|can_view_order|is_agent|is_cashier|uid)\(')) AS unwrapped_p3_helpers,
       count(*) FILTER (WHERE pg_temp.unwrapped(txt, '\m(is_admin|is_staff|staff_can|can_view_order|is_agent|is_cashier|uid|current_tenant_id|is_platform_admin|store_staff_role)\(')) AS unwrapped_any_helper,
       count(*) FILTER (WHERE txt ~ '\( SELECT [a-z_.]+\(') AS has_some_wrapper
  FROM p GROUP BY ROLLUP (nspname) ORDER BY nspname NULLS LAST;
\echo -- public tables carrying unwrapped policies (count of policies)
WITH p AS (
  SELECT c.relname, coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') AS txt
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public')
SELECT relname, count(*) FROM p WHERE pg_temp.unwrapped(txt, '\m(is_admin|is_staff|staff_can|can_view_order|is_agent|is_cashier|uid)\(') GROUP BY 1 ORDER BY 2 DESC, 1;

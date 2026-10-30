-- ============================================================
-- שלב 0 (בסיס להמשך): כיסוי בידוד חנויות בכל טבלה עם tenant_id
--
-- כלל: כל טבלה ב-public עם עמודת tenant_id —
--   • RLS מופעל, וגם
--   • מדיניות RESTRICTIVE בשם tenant_isolation, או שאין ל-anon / authenticated
--     הרשאת SELECT בכלל (גישה רק דרך פונקציות / service_role).
-- חריגים מתועדים: טבלאות של פאנל הפלטפורמה שהמדיניות שלהן מוגבלת למנהל
-- הפלטפורמה (is_platform_admin), או למנהל החנות של אותה חנות בלבד.
-- הבדיקה רצה על כל טבלה חדשה אוטומטית (כולל טבלאות עתידיות).
-- ============================================================
CREATE TEMP TABLE tenant_tables AS
SELECT c.oid, c.relname AS name, c.relrowsecurity AS rls,
       EXISTS (SELECT 1 FROM pg_policies p
                WHERE p.schemaname = 'public' AND p.tablename = c.relname
                  AND p.policyname = 'tenant_isolation' AND p.permissive = 'RESTRICTIVE') AS restrictive,
       (has_table_privilege('anon', c.oid, 'SELECT')
        OR has_table_privilege('authenticated', c.oid, 'SELECT')) AS api_readable
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped);

SELECT tests.check('tenant isolation coverage: tables with tenant_id were found',
  $$SELECT count(*) >= 50 FROM tenant_tables$$);

SELECT tests.check('tenant isolation coverage: RLS is enabled on every table with tenant_id',
  $$SELECT NOT EXISTS (SELECT 1 FROM tenant_tables WHERE NOT rls)$$);

-- החריגים: כל המדיניות שלהם בודקת מנהל פלטפורמה (או מנהל של אותה חנות)
SELECT tests.check('tenant isolation coverage: platform-only exceptions are limited to platform admins',
  $$SELECT NOT EXISTS (
      SELECT 1 FROM pg_policies p
       WHERE p.schemaname = 'public'
         AND p.tablename IN ('platform_agreement_acceptances', 'platform_audit_log',
                             'platform_documents', 'platform_email_log', 'upgrade_requests')
         AND (p.qual IS NULL OR p.qual NOT LIKE 'is_platform_admin(auth.uid())%')
         AND COALESCE(p.qual, '') NOT LIKE '(is_platform_admin(auth.uid()) OR ((tenant_id = current_tenant_id())%')$$);

DO $t$
DECLARE _bad text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO _bad
    FROM tenant_tables
   WHERE api_readable AND NOT restrictive
     AND name NOT IN ('platform_agreement_acceptances', 'platform_audit_log',
                      'platform_documents', 'platform_email_log', 'upgrade_requests');
  INSERT INTO tests.results (name, ok, detail)
  VALUES ('tenant isolation coverage: every API-readable table has a RESTRICTIVE tenant_isolation policy',
          _bad IS NULL, COALESCE('missing: ' || _bad, 'ok'));
END $t$;

DROP TABLE tenant_tables;

-- ============================================================
-- Hospitality (שלב 1c): כל טבלה בסכמה hospitality — בלי חריגים:
--   • tenant_id, RLS מופעל;
--   • RESTRICTIVE tenant_isolation + RESTRICTIVE backend_enabled (דגל);
--   • אין שום הרשאה ל-anon (גישה ציבורית רק דרך פונקציות DEFINER).
-- רץ אוטומטית גם על טבלאות שיתווספו בשלבים הבאים.
-- ============================================================
CREATE TEMP TABLE hosp_tables AS
SELECT c.oid, c.relname AS name, c.relrowsecurity AS rls,
       EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS has_tenant,
       EXISTS (SELECT 1 FROM pg_policies p
                WHERE p.schemaname = 'hospitality' AND p.tablename = c.relname
                  AND p.policyname = 'tenant_isolation' AND p.permissive = 'RESTRICTIVE') AS isolation,
       EXISTS (SELECT 1 FROM pg_policies p
                WHERE p.schemaname = 'hospitality' AND p.tablename = c.relname
                  AND p.policyname = 'backend_enabled' AND p.permissive = 'RESTRICTIVE') AS flag_gate,
       (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT')
        OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE')) AS anon_access
  FROM pg_class c
 WHERE c.relnamespace = 'hospitality'::regnamespace AND c.relkind IN ('r', 'p');

SELECT tests.check('tenant isolation coverage (hospitality): tables were found',
  $$SELECT count(*) >= 11 FROM hosp_tables$$);

DO $t$
DECLARE _bad text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO _bad
    FROM hosp_tables WHERE has_tenant AND (NOT (rls AND isolation AND flag_gate) OR anon_access);
  INSERT INTO tests.results (name, ok, detail)
  VALUES ('tenant isolation coverage (hospitality): every table with tenant_id has RLS, tenant_isolation, backend_enabled and no anon access',
          _bad IS NULL, COALESCE('missing: ' || _bad, 'ok'));
  -- platform catalogues without tenant_id (e.g. plans): RLS on and no API access at all
  SELECT string_agg(name, ', ' ORDER BY name) INTO _bad
    FROM hosp_tables h
   WHERE NOT h.has_tenant
     AND (NOT h.rls OR h.anon_access
          OR has_table_privilege('authenticated', h.oid, 'SELECT') OR has_table_privilege('authenticated', h.oid, 'INSERT')
          OR has_table_privilege('authenticated', h.oid, 'UPDATE') OR has_table_privilege('authenticated', h.oid, 'DELETE'));
  INSERT INTO tests.results (name, ok, detail)
  VALUES ('tenant isolation coverage (hospitality): tables without tenant_id are closed to the API (functions only)',
          _bad IS NULL, COALESCE('open: ' || _bad, 'ok'));
END $t$;

SELECT tests.check('tenant isolation coverage (hospitality): no view in the schema bypasses RLS',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'hospitality'::regnamespace
      AND c.relkind IN ('v', 'm')
      AND NOT COALESCE('security_invoker=true' = ANY (c.reloptions), false))$$);

DROP TABLE hosp_tables;

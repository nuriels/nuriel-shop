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

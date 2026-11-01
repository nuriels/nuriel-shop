-- ============================================================
-- Rollback: 20261101210000_hosp_pricing.sql
-- חזרה למצב של מיגרציה 12: הצוות כותב שוב ישירות לכללי המחיר ולמדיניות (כמו במיגרציה 3;
-- RLS לפי pricing / policies), בלי פונקציות הניהול. אין נתונים חדשים במיגרציה הזו —
-- המחירים, הכללים, המדיניות והיסטוריית הגרסאות (שלב 1e) נשארים כמו שהם.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;


DROP FUNCTION IF EXISTS hospitality.price_preview(uuid, date, date, integer, integer);
DROP FUNCTION IF EXISTS hospitality.policy_preview(jsonb, numeric, date);
DROP FUNCTION IF EXISTS hospitality.policy_history(uuid);
DROP FUNCTION IF EXISTS hospitality.policy_archive(uuid);
DROP FUNCTION IF EXISTS hospitality.policy_set_default(uuid);
DROP FUNCTION IF EXISTS hospitality.policy_save(uuid, jsonb, integer);
DROP FUNCTION IF EXISTS hospitality.rate_rule_delete(uuid);
DROP FUNCTION IF EXISTS hospitality.rate_rule_save(uuid, jsonb);
DROP FUNCTION IF EXISTS hospitality.unit_prices_set(uuid, jsonb, integer);
DROP FUNCTION IF EXISTS hospitality.pricing_view();
DROP FUNCTION IF EXISTS hospitality._rule_json(hospitality.rate_rules);
DROP FUNCTION IF EXISTS hospitality._policy_json(hospitality.policies);
DROP FUNCTION IF EXISTS hospitality._cv_date(jsonb, text);
DROP FUNCTION IF EXISTS hospitality._cv_money(jsonb, text, numeric, numeric, boolean);


GRANT INSERT, UPDATE, DELETE ON hospitality.rate_rules TO authenticated;
GRANT INSERT, UPDATE, DELETE ON hospitality.policies TO authenticated;

COMMIT;

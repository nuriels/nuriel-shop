-- ============================================================
-- Rollback של 20261110100000_ai_assistant.sql (מיגרציה 61 — NURIEL AI ASSISTANT)
-- מסרב כשיש נתונים: חבילות שהופעלו לעסקים (תקופות, מחירים ששולמו, היסטוריה), התראות שנשלחו, יומן
-- שימוש וסיכום העלויות היומי, או מפתח API שמור — כל אלה מידע מסחרי, ומחיקה שלהם היא החלטה, לא
-- תופעת לוואי. קודם מייצאים (pg_dump של הטבלאות) ומחליטים. הרשומות ביומן הפלטפורמה
-- (platform_audit_log) לא נמחקות.
-- בלי פונקציה קיימת שהשתנתה — הכול חדש. לפני ה-rollback: האפליקציה חוזרת לגרסה בלי NURIEL AI.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
DECLARE
  _n bigint;
  _tbl text;
  _what text;
BEGIN
  FOR _tbl, _what IN VALUES
      ('ai_subscriptions', 'חבילות NURIEL AI שהופעלו לעסקים'),
      ('ai_subscription_periods', 'תקופות של חבילות NURIEL AI'),
      ('ai_subscription_events', 'היסטוריית הפעלות וחידושים'),
      ('ai_notifications', 'התראות חידוש שנשלחו'),
      ('ai_usage_log', 'יומן השימוש בעוזר'),
      ('ai_usage_daily', 'סיכום השימוש והעלויות היומי') LOOP
    IF to_regclass('public.' || _tbl) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', _tbl) INTO _n;
      IF _n > 0 THEN
        RAISE EXCEPTION 'יש % שורות: % — ייצאו אותן והחליטו לפני ה-rollback', _n, _what;
      END IF;
    END IF;
  END LOOP;
  IF to_regclass('public.ai_settings') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.ai_settings WHERE api_key_encrypted IS NOT NULL OR mode <> 'off') THEN
    RAISE EXCEPTION 'העוזר מוגדר (מפתח שמור או מצב שאינו כבוי) — כבו אותו והסירו את המפתח לפני ה-rollback';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.ai_rate_buckets_prune();
DROP FUNCTION IF EXISTS public.ai_quota_take(uuid, uuid, text, boolean);
DROP FUNCTION IF EXISTS public.ai_notifications_mark_stale();
DROP FUNCTION IF EXISTS public.ai_notification_finish(bigint, text, text);
DROP FUNCTION IF EXISTS public.ai_notification_claim(uuid, date, text, text);
DROP FUNCTION IF EXISTS public.ai_due_notifications();
DROP FUNCTION IF EXISTS public.ai_due_notifications_on(date);
DROP FUNCTION IF EXISTS public.ai_admin_usage(uuid);
DROP FUNCTION IF EXISTS public.ai_admin_save_settings(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ai_admin_history(uuid, uuid);
DROP FUNCTION IF EXISTS public.ai_admin_set_suspended(uuid, uuid, boolean, text);
DROP FUNCTION IF EXISTS public.ai_admin_renew(uuid, uuid, date, text, boolean);
DROP FUNCTION IF EXISTS public.ai_admin_renew(uuid, uuid, date, text);
DROP FUNCTION IF EXISTS public.ai_admin_activate(uuid, uuid, text, date, text, boolean);
DROP FUNCTION IF EXISTS public.ai_admin_activate(uuid, uuid, text, date, text);
DROP FUNCTION IF EXISTS public.ai_admin_list(uuid, text, text);
DROP FUNCTION IF EXISTS public.ai_audit(uuid, text, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.ai_require_platform_admin(uuid);
DROP FUNCTION IF EXISTS public.ai_entitlement(uuid);
DROP FUNCTION IF EXISTS public.ai_state_on(uuid, date);
DROP FUNCTION IF EXISTS public.ai_chain_end(uuid, date);

DROP TABLE IF EXISTS public.ai_notifications;
DROP TABLE IF EXISTS public.ai_usage_log;
DROP TABLE IF EXISTS public.ai_usage_daily;
DROP TABLE IF EXISTS public.ai_rate_buckets;
DROP TABLE IF EXISTS public.ai_settings;
DROP TABLE IF EXISTS public.ai_subscription_events;
DROP TABLE IF EXISTS public.ai_subscription_periods;
DROP TABLE IF EXISTS public.ai_subscriptions;
DROP TABLE IF EXISTS public.ai_packages;

DROP FUNCTION IF EXISTS public.ai_usage_daily_add();
DROP FUNCTION IF EXISTS public.ai_periods_guard();
DROP FUNCTION IF EXISTS public.ai_subscriptions_guard();
DROP FUNCTION IF EXISTS public.ai_period_end(date);
DROP FUNCTION IF EXISTS public.ai_today();

COMMIT;

-- ============================================================
-- הארכת ניסיון מפאנל מנהל-העל (platform_extend_trial) — רק מנהל הפלטפורמה,
-- הסטטוס מתעדכן, נרשם בהיסטוריה, בלי לשנות חבילה ובלי חיוב
-- ============================================================
\set OA '''a0000000-0000-0000-0000-0000000000a1'''
\set PA '''a0000000-0000-0000-0000-0000000000f0'''
\set TA '''70000000-0000-0000-0000-00000000000a'''

CREATE TEMP TABLE sub_backup AS SELECT * FROM public.tenant_subscriptions WHERE tenant_id = :TA;
UPDATE public.tenant_subscriptions
   SET plan_type = 'trial', status = 'trialing', trial_ends_at = now() - interval '2 days', current_period_end = NULL
 WHERE tenant_id = :TA;

SELECT tests.run('extend trial: store owner is blocked (server side)',
  $$SELECT public.platform_extend_trial('70000000-0000-0000-0000-00000000000a', 10)$$, :OA, 'רק מנהל הפלטפורמה');
SELECT tests.run('extend trial: guest is blocked',
  $$SELECT public.platform_extend_trial('70000000-0000-0000-0000-00000000000a', 10)$$, NULL, 'permission denied');
SELECT tests.run('extend trial: 0 days rejected',
  $$SELECT public.platform_extend_trial('70000000-0000-0000-0000-00000000000a', 0)$$, :PA, '1 עד 365');
SELECT tests.run('extend trial: 366 days rejected',
  $$SELECT public.platform_extend_trial('70000000-0000-0000-0000-00000000000a', 366)$$, :PA, '1 עד 365');
SELECT tests.check('extend trial: nothing changed after rejected attempts',
  $$SELECT trial_ends_at < now() FROM public.tenant_subscriptions WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);

SELECT tests.run('extend trial: platform admin extends an expired trial by 10 days',
  $$SELECT public.platform_extend_trial('70000000-0000-0000-0000-00000000000a', 10)$$, :PA);
SELECT tests.check('extend trial: expired trial → +10 days from today, store active again, plan unchanged',
  $$SELECT plan_type = 'trial' AND status = 'trialing' AND current_period_end IS NULL
       AND trial_ends_at BETWEEN now() + interval '9 days 23 hours' AND now() + interval '10 days 1 hour'
     FROM public.tenant_subscriptions WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.check('extend trial: logged in billing history with amount 0 (no charge)',
  $$SELECT EXISTS (SELECT 1 FROM public.billing_history WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'
                    AND kind = 'trial_extension' AND amount = 0 AND days = 10
                    AND recorded_by = 'a0000000-0000-0000-0000-0000000000f0')$$);
SELECT tests.run('extend trial: second extension adds to the current end',
  $$SELECT public.platform_extend_trial('70000000-0000-0000-0000-00000000000a', 5)$$, :PA);
SELECT tests.check('extend trial: now ~15 days from today',
  $$SELECT trial_ends_at BETWEEN now() + interval '14 days 23 hours' AND now() + interval '15 days 1 hour'
     FROM public.tenant_subscriptions WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.check('extend trial: no add-ons / features granted by the extension',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.tenant_addons WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'
                        AND status = 'active' AND created_at > now() - interval '1 minute')$$);

-- ניקוי
DELETE FROM public.billing_history WHERE tenant_id = :TA AND kind = 'trial_extension' AND created_at > now() - interval '5 minutes';
UPDATE public.tenant_subscriptions s
   SET plan_type = b.plan_type, status = b.status, trial_ends_at = b.trial_ends_at, current_period_end = b.current_period_end
  FROM sub_backup b WHERE s.tenant_id = b.tenant_id;
DROP TABLE sub_backup;

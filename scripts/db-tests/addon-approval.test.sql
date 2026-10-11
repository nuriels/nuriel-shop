-- ============================================================
-- חלק 38: רכישת תוסף = בקשה ממתינה; רק מנהל הפלטפורמה מאשר ומפעיל
-- (נבדק על "חיבור לזאפ" — שם התגלה הבאג)
-- ============================================================
\set OA '''a0000000-0000-0000-0000-0000000000a1'''
\set PA '''a0000000-0000-0000-0000-0000000000f0'''
\set TA '''70000000-0000-0000-0000-00000000000a'''

UPDATE public.tenant_subscriptions
   SET plan_type = 'basic', status = 'active', current_period_end = now() + interval '200 days'
 WHERE tenant_id = :TA;
CREATE TEMP TABLE IF NOT EXISTS addon_avail_backup AS SELECT addon_name, available FROM public.platform_addons;
UPDATE public.platform_addons SET available = true WHERE addon_name IN ('zapier', 'google_sso');
DELETE FROM public.tenant_addons WHERE tenant_id = :TA AND addon_name IN ('zapier', 'google_sso');

-- 1. בעל החנות "רוכש" — נוצרת בקשה, לא תוסף פעיל
SELECT tests.run('addon request: owner asks for the Zap add-on',
  $$SELECT public.addon_purchase('zapier', 250)$$, :OA);
SELECT tests.check('addon request: status is pending (not active)',
  $$SELECT status = 'pending' AND billing_id IS NOT NULL
     FROM public.tenant_addons WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND addon_name = 'zapier'$$);
SELECT tests.check('addon request: the Zap feature stays locked',
  $$SELECT NOT (public.tenant_features('70000000-0000-0000-0000-00000000000a') ->> 'zap_feed')::boolean
       AND NOT public.tenant_addon_active('70000000-0000-0000-0000-00000000000a', 'zapier')$$);
SELECT tests.check('addon request: linked charge is "due"',
  $$SELECT b.payment_status = 'due' AND b.amount = 250
     FROM public.tenant_addons a JOIN public.billing_history b ON b.id = a.billing_id
    WHERE a.tenant_id = '70000000-0000-0000-0000-00000000000a' AND a.addon_name = 'zapier'$$);
SELECT tests.run('addon request: quote shows "pending" and blocks a second request',
  $$SELECT 1 WHERE (public.addon_quote('zapier') ->> 'pending')::boolean
                AND NOT (public.addon_quote('zapier') ->> 'can_buy')::boolean$$, :OA, NULL, 1);
SELECT tests.run('addon request: second request → rejected',
  $$SELECT public.addon_purchase('zapier', 250)$$, :OA, 'הבקשה נשלחה');

-- 2. בעל החנות לא יכול להפעיל בעצמו — בשום דרך
SELECT tests.run('addon request: owner cannot update the row to active',
  $$UPDATE public.tenant_addons SET status = 'active' WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND addon_name = 'zapier'$$,
  :OA, 'permission denied');
SELECT tests.run('addon request: owner cannot insert an active add-on',
  $$INSERT INTO public.tenant_addons (tenant_id, addon_name, status) VALUES ('70000000-0000-0000-0000-00000000000a', 'zapier', 'active')$$,
  :OA, 'permission denied');
SELECT id AS zap_req FROM public.tenant_addons
 WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND addon_name = 'zapier' AND status = 'pending' \gset
SELECT tests.run('addon request: owner cannot approve',
  format($$SELECT public.platform_approve_addon(%L, NULL)$$, :'zap_req'),
  :OA, 'רק מנהל הפלטפורמה');
SELECT tests.run('addon request: owner cannot grant',
  $$SELECT public.platform_grant_addon('70000000-0000-0000-0000-00000000000a', 'zapier')$$, :OA, 'רק מנהל הפלטפורמה');
SELECT tests.run('addon request: owner cannot list platform requests',
  $$SELECT public.platform_addon_requests()$$, :OA, 'רק מנהל הפלטפורמה');
-- גם כתיבה ישירה כמשתמש עם הרשאות (למשל SECURITY DEFINER אחר) נחסמת בטריגר
SELECT tests.check('addon request: activation guard trigger exists',
  $$SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tenant_addons_activation_guard' AND NOT tgisinternal)$$);

-- 3. מנהל הפלטפורמה רואה את הבקשה
SELECT tests.run('addon request: platform admin sees the pending request',
  $$SELECT 1 WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(public.platform_addon_requests()) r
                  WHERE r ->> 'tenant_id' = '70000000-0000-0000-0000-00000000000a'
                    AND r ->> 'addon' = 'zapier' AND r ->> 'status' = 'pending'
                    AND (r ->> 'amount')::numeric = 250)$$, :PA, NULL, 1);

-- 4. "אשר תשלום והפעל תוסף" — רק אז פעיל, והחיוב שולם
SELECT tests.run('addon request: platform admin approves payment + activates',
  format($$SELECT public.platform_approve_addon(%L, 'ביט 4411')$$, :'zap_req'),
  :PA);
SELECT tests.check('addon request: now active, approved by platform admin',
  $$SELECT status = 'active' AND approved_at IS NOT NULL AND approved_by = 'a0000000-0000-0000-0000-0000000000f0'
       AND approved_reference = 'ביט 4411'
     FROM public.tenant_addons WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND addon_name = 'zapier'$$);
SELECT tests.check('addon request: Zap feature unlocked',
  $$SELECT (public.tenant_features('70000000-0000-0000-0000-00000000000a') ->> 'zap_feed')::boolean$$);
SELECT tests.check('addon request: charge marked paid with the reference',
  $$SELECT b.payment_status = 'paid' AND b.paid_at IS NOT NULL AND b.reference = 'ביט 4411'
     FROM public.tenant_addons a JOIN public.billing_history b ON b.id = a.billing_id
    WHERE a.tenant_id = '70000000-0000-0000-0000-00000000000a' AND a.addon_name = 'zapier'$$);
SELECT tests.run('addon request: approving twice → error',
  format($$SELECT public.platform_approve_addon(%L, NULL)$$, :'zap_req'),
  :PA, 'כבר טופלה');

-- 5. דחייה: הבקשה נסגרת והחיוב הממתין נמחק
SELECT tests.run('addon request: owner asks for Google SSO (monthly, prorated)',
  $$SELECT public.addon_purchase('google_sso', NULL)$$, :OA);
SELECT id AS sso_req FROM public.tenant_addons
 WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND addon_name = 'google_sso' AND status = 'pending' \gset
SELECT tests.run('addon request: platform admin rejects',
  format($$SELECT public.platform_reject_addon(%L)$$, :'sso_req'),
  :PA);
SELECT tests.check('addon request: rejected → canceled, no due charge left, feature locked',
  $$SELECT (SELECT status = 'canceled' AND ended_reason = 'rejected' FROM public.tenant_addons
             WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND addon_name = 'google_sso')
       AND NOT EXISTS (SELECT 1 FROM public.billing_history WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'
                        AND addon_name = 'google_sso' AND payment_status = 'due')
       AND NOT public.tenant_addon_active('70000000-0000-0000-0000-00000000000a', 'google_sso')$$);
SELECT tests.run('addon request: after rejection the owner can ask again',
  $$SELECT 1 WHERE (public.addon_quote('google_sso') ->> 'can_buy')::boolean$$, :OA, NULL, 1);

-- 6. "המנוי שלי" מציג את הבקשה כממתינה
SELECT tests.run('addon request: store billing lists pending requests',
  $$SELECT public.addon_purchase('google_sso', NULL)$$, :OA);
SELECT tests.run('addon request: store_billing shows pending',
  $$SELECT 1 WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(public.store_billing() -> 'addons') r
                  WHERE r ->> 'addon' = 'google_sso' AND (r ->> 'pending')::boolean AND NOT (r ->> 'active')::boolean)$$,
  :OA, NULL, 1);

-- 7. שם התוסף בקטלוג
SELECT tests.check('addon catalog: Zap add-on title is not "Zapier"',
  $$SELECT title NOT ILIKE '%zapier%' FROM public.platform_addons WHERE addon_name = 'zapier'$$);

-- ניקוי
DELETE FROM public.billing_history WHERE tenant_id = :TA AND addon_name IN ('zapier', 'google_sso');
DELETE FROM public.tenant_addons WHERE tenant_id = :TA AND addon_name IN ('zapier', 'google_sso');
UPDATE public.platform_addons p SET available = b.available FROM addon_avail_backup b WHERE b.addon_name = p.addon_name;
DROP TABLE addon_avail_backup;

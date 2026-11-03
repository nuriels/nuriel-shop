-- ============================================================
-- SEC-M5 (20261106170000_sec_m5_keep_platform_records.sql): מחיקת חנות לא מוחקת את הרשומות של
-- Nuriel עצמה — חיובים (billing_history) ויומן הפלטפורמה — ורושמת את המחיקה ביומן.
-- ============================================================
\set PA '''a0000000-0000-0000-0000-0000000000f0'''
\set DEL '''70000000-0000-0000-0000-0000000000d5'''

INSERT INTO public.tenants (id, slug, name, owner_email) VALUES (:DEL, 'm5-del', 'חנות M5', 'm5.owner@shop.test');
INSERT INTO public.billing_history (tenant_id, kind, plan_type, amount, currency, payment_status, note)
VALUES (:DEL, 'payment', 'basic', 199, 'ILS', 'paid', 'm5-invoice');
INSERT INTO public.platform_audit_log (tenant_id, actor_email, action, details)
VALUES (:DEL, 'god@m5.test', 'm5_before_delete', '{}'::jsonb);
SELECT tests.check('m5 fixture: the store has its own data, a billing record and an audit row',
  format($$SELECT EXISTS (SELECT 1 FROM public.site_settings WHERE tenant_id = %1$L)
             AND EXISTS (SELECT 1 FROM public.billing_history WHERE tenant_id = %1$L)
             AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %1$L)$$, :DEL));

SELECT tests.run('m5: the platform admin deletes the store',
  format($$SELECT public.platform_delete_tenant(%L, 'm5-del')$$, :DEL), :PA, NULL, 1);

SELECT tests.check('m5: the store and its own data are gone (the purge still works)',
  format($$SELECT NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM public.site_settings WHERE tenant_id = %1$L)$$, :DEL));
SELECT tests.check('m5: Nuriel''s billing record is kept, attributed to the deleted store (id + name and address)',
  format($$SELECT tenant_id = %L AND store_label = 'חנות M5 (m5-del)' AND amount = 199 AND note = 'm5-invoice'
      FROM public.billing_history WHERE note = 'm5-invoice'$$, :DEL));
SELECT tests.check('m5: the platform audit rows of the store are kept',
  format($$SELECT EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'm5_before_delete')$$, :DEL));
SELECT tests.check('m5: the deletion itself is in the platform audit log (who, which store, how much)',
  format($$SELECT actor_id = %L AND details ->> 'slug' = 'm5-del' AND details ->> 'name' = 'חנות M5'
             AND (details ->> 'rows')::integer > 0
      FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'tenant_deleted'$$, :PA, :DEL));
CREATE OR REPLACE FUNCTION pg_temp.audit_update_blocked() RETURNS boolean LANGUAGE plpgsql AS $f$
BEGIN
  UPDATE public.platform_audit_log SET action = 'tampered' WHERE action = 'm5_before_delete';
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END $f$;
SELECT tests.check('m5: the platform audit log is still append-only (kept rows cannot be edited)',
  $$SELECT pg_temp.audit_update_blocked()$$);

-- ניקוי
DELETE FROM public.billing_history WHERE note = 'm5-invoice';
SET session_replication_role = replica;
DELETE FROM public.platform_audit_log WHERE tenant_id = '70000000-0000-0000-0000-0000000000d5';
SET session_replication_role = origin;

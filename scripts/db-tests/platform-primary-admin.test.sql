-- ============================================================
-- מחיקת חנות עם בעלים מוגן + הגנה על מנהל-העל הראשי
-- ============================================================
\set PA '''a0000000-0000-0000-0000-0000000000f0'''
\set P2 '''a0000000-0000-0000-0000-0000000000e2'''
\set OWN '''a0000000-0000-0000-0000-0000000000e3'''
\set TD '''70000000-0000-0000-0000-0000000000ee'''

-- 1. חנות עם בעלים מוגן (המנהל הראשון בחנות הופך ל-is_protected) נמחקת במלואה
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000e2', 'second.platform@test.local'),
  ('a0000000-0000-0000-0000-0000000000e3', 'owner.del@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.tenants (id, slug, name, owner_email) VALUES (:TD, 'pf-del2', 'חנות עם בעלים', 'owner.del@test.local');
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES (:TD, :OWN, 'owner.del@test.local', 'owner_del', 'admin', true);
SELECT tests.check('delete store: its owner row is protected',
  $$SELECT is_protected FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-0000000000ee' AND user_id = 'a0000000-0000-0000-0000-0000000000e3'$$);
DO $t$
DECLARE err text;
BEGIN
  BEGIN
    DELETE FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-0000000000ee' AND user_id = 'a0000000-0000-0000-0000-0000000000e3';
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  INSERT INTO tests.results (name, ok, detail)
  VALUES ('delete store: a direct delete of the protected owner stays blocked',
          err ILIKE '%אי אפשר למחוק את המנהל הראשי%', COALESCE(err, 'no error'));
END $t$;
SELECT tests.run('delete store: platform admin deletes a store with a protected owner',
  $$SELECT public.platform_delete_tenant('70000000-0000-0000-0000-0000000000ee', 'pf-del2')$$, :PA, NULL, 1);
SELECT tests.check('delete store: the store and the owner row are gone',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = '70000000-0000-0000-0000-0000000000ee')
       AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-0000000000ee')$$);
SELECT tests.check('delete store: the protection is back after the deletion (setting is transaction-local)',
  $$SELECT COALESCE(current_setting('nuriel.deleting_tenant', true), '') = ''$$);
SELECT tests.run('delete store: a non platform admin still cannot delete',
  $$SELECT public.platform_delete_tenant('70000000-0000-0000-0000-00000000000a', 'store-a')$$,
  'a0000000-0000-0000-0000-0000000000a1', 'רק מנהל הפלטפורמה');

-- 2. מנהל-העל הראשי מוגן
INSERT INTO public.platform_admins (user_id, created_at)
VALUES (:P2, now() + interval '1 minute') ON CONFLICT DO NOTHING;
SELECT tests.check('primary: the oldest platform admin is the primary one',
  $$SELECT public.primary_platform_admin() = 'a0000000-0000-0000-0000-0000000000f0'$$);
SELECT tests.run('primary: a newly added platform admin cannot remove the primary',
  $$SELECT public.platform_remove_admin('a0000000-0000-0000-0000-0000000000f0')$$, :P2, 'אי אפשר להסיר את מנהל-העל הראשי');
SELECT tests.check('primary: the primary is still a platform admin',
  $$SELECT public.is_platform_admin('a0000000-0000-0000-0000-0000000000f0')$$);
SELECT tests.run('primary: the list marks who is primary',
  $$SELECT 1 WHERE (SELECT count(*) FROM public.platform_list_admins() WHERE is_primary) = 1
                AND (SELECT is_primary FROM public.platform_list_admins() WHERE user_id = 'a0000000-0000-0000-0000-0000000000f0')$$, :P2, NULL, 1);
SELECT tests.run('primary: the primary can remove the added admin',
  $$SELECT public.platform_remove_admin('a0000000-0000-0000-0000-0000000000e2')$$, :PA, NULL, 1);
SELECT tests.check('primary: the added admin was removed',
  $$SELECT NOT public.is_platform_admin('a0000000-0000-0000-0000-0000000000e2')$$);

-- ניקוי
DELETE FROM public.platform_admins WHERE user_id = :P2;
DELETE FROM auth.users WHERE id IN (:P2, :OWN);

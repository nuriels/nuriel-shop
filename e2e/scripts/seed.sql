-- נתוני E2E (פיקטיביים): חנות A = חנות ברירת המחדל (kobi) מהמיגרציות, חנות B
-- נפרדת, מנהל פלטפורמה, בעלים לכל חנות, לקוח מאושר בחנות A, ומוצרים.
-- המשתמשים עצמם נוצרים קודם ב-seed.mjs (Auth API).
BEGIN;
INSERT INTO public.tenants (id, slug, name, owner_email)
VALUES ('7e2e0000-0000-0000-0000-00000000000b', 'store-b', 'חנות B לבדיקה', 'owner.b@e2e.test')
ON CONFLICT (id) DO NOTHING;
UPDATE public.tenant_subscriptions SET plan_type = 'premium', status = 'active',
       trial_ends_at = NULL, current_period_end = now() + interval '1 year'
 WHERE tenant_id = '7e2e0000-0000-0000-0000-00000000000b';
UPDATE public.tenants SET owner_email = 'owner.a@e2e.test'
 WHERE id = '00000000-0000-0000-0000-000000000001';

INSERT INTO public.platform_admins (user_id) VALUES ('e2e00000-0000-0000-0000-0000000000f0')
ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  ('00000000-0000-0000-0000-000000000001', 'e2e00000-0000-0000-0000-0000000000a1', 'owner.a@e2e.test', 'owner_a', 'admin', true),
  ('00000000-0000-0000-0000-000000000001', 'e2e00000-0000-0000-0000-0000000000a3', 'customer.a@e2e.test', 'customer_a', 'customer', true),
  ('7e2e0000-0000-0000-0000-00000000000b', 'e2e00000-0000-0000-0000-0000000000b1', 'owner.b@e2e.test', 'owner_b', 'admin', true)
ON CONFLICT DO NOTHING;
INSERT INTO public.customer_profiles (tenant_id, user_id, business_name, contact_name, phone, business_address, city, price_tier, age_confirmed, profile_completed)
VALUES ('00000000-0000-0000-0000-000000000001', 'e2e00000-0000-0000-0000-0000000000a3', 'עסק בדיקה בע"מ', 'לקוח בדיקה', '0500000000', 'רחוב הבדיקה 1', 'תל אביב', 1, true, true)
ON CONFLICT DO NOTHING;

INSERT INTO public.categories (tenant_id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'יינות בדיקה'),
  ('7e2e0000-0000-0000-0000-00000000000b', 'קטגוריה של B')
ON CONFLICT DO NOTHING;
INSERT INTO public.global_products (id, tenant_id, created_by, sku, name, category, description, price_tier1, price_tier2, price_tier3, stock_quantity) VALUES
  ('e2e0a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'e2e00000-0000-0000-0000-0000000000a1', '90000001', 'יין אדום בדיקה', 'יינות בדיקה', 'תיאור מוצר בדיקה', 50, 48, 45, 100),
  ('e2e0a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'e2e00000-0000-0000-0000-0000000000a1', '90000002', 'מיץ ענבים בדיקה', 'יינות בדיקה', 'עוד מוצר', 20, 19, 18, 100),
  ('e2e0b000-0000-0000-0000-000000000001', '7e2e0000-0000-0000-0000-00000000000b', 'e2e00000-0000-0000-0000-0000000000b1', '90000101', 'מוצר סודי של חנות B', 'קטגוריה של B', 'לא אמור להופיע בחנות A', 99, 99, 99, 10)
ON CONFLICT (id) DO NOTHING;
-- llms.txt אופציונלי — מופעל רק בחנות B (בדיקת שני המצבים)
UPDATE public.site_settings SET llms_txt_enabled = true
 WHERE tenant_id = '7e2e0000-0000-0000-0000-00000000000b';
COMMIT;

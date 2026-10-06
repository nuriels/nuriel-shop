-- נתוני בדיקה (אידמפוטנטי): חנות A (basic, בעלים + סוכן), חנות B (premium, 2 מנהלים), חנות C (trial), מנהל פלטפורמה
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000f0', 'platform@test.local'),
  ('a0000000-0000-0000-0000-0000000000a1', 'owner.a@test.local'),
  ('a0000000-0000-0000-0000-0000000000a2', 'agent.a@test.local'),
  ('a0000000-0000-0000-0000-0000000000b1', 'admin1.b@test.local'),
  ('a0000000-0000-0000-0000-0000000000b2', 'admin2.b@test.local'),
  ('a0000000-0000-0000-0000-0000000000c1', 'new1@test.local'),
  ('a0000000-0000-0000-0000-0000000000c2', 'new2@test.local'),
  ('a0000000-0000-0000-0000-0000000000c3', 'new3@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.tenants (id, slug, name, owner_email) VALUES
  ('70000000-0000-0000-0000-00000000000a', 'store-a', 'חנות A', 'owner.a@test.local'),
  ('70000000-0000-0000-0000-00000000000b', 'store-b', 'חנות B', 'admin1.b@test.local'),
  ('70000000-0000-0000-0000-00000000000c', 'store-c', 'חנות C', NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.tenant_subscriptions (tenant_id, plan_type, status, trial_ends_at, current_period_end) VALUES
  ('70000000-0000-0000-0000-00000000000a', 'basic', 'active', NULL, now() + interval '1 year'),
  ('70000000-0000-0000-0000-00000000000b', 'premium', 'active', NULL, now() + interval '1 year'),
  ('70000000-0000-0000-0000-00000000000c', 'trial', 'trialing', now() + interval '14 days', NULL)
-- tenants_seed_settings כבר יוצר מנוי ניסיון לכל חנות חדשה → מעדכנים לחבילה של הבדיקה
ON CONFLICT (tenant_id) DO UPDATE SET plan_type = EXCLUDED.plan_type, status = EXCLUDED.status,
  trial_ends_at = EXCLUDED.trial_ends_at, current_period_end = EXCLUDED.current_period_end;
INSERT INTO public.platform_admins (user_id) VALUES ('a0000000-0000-0000-0000-0000000000f0') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000a1', 'owner.a@test.local', 'owner_a', 'admin', true),
  ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000a2', 'agent.a@test.local', 'agent_a', 'agent', true),
  ('70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000b1', 'admin1.b@test.local', 'admin1_b', 'admin', true),
  ('70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000b2', 'admin2.b@test.local', 'admin2_b', 'admin', true)
ON CONFLICT DO NOTHING;

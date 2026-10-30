-- ============================================================
-- Concurrency tests — data and small call wrappers (disposable DB only)
-- One Hospitality site, flags on, an owner, units per scenario.
-- ============================================================
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', 'conc.owner@test.local', now()),
  ('c0000000-0000-0000-0000-0000000000a2', 'conc.manager@test.local', now())
ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', false);
SELECT hospitality.admin_create_site('conc-site', 'בדיקות מקביליות', 'conc.owner@test.local');
SELECT public.platform_set_flag('hospitality_backend_enabled', true), public.platform_set_flag('hospitality_booking_enabled', true);
SELECT public.platform_set_flag('hospitality_backend_enabled', true, (SELECT id FROM public.tenants WHERE slug = 'conc-site')),
       public.platform_set_flag('hospitality_booking_enabled', true, (SELECT id FROM public.tenants WHERE slug = 'conc-site'));
SELECT set_config('request.jwt.claim.sub', '', false);

INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
SELECT id, 'c0000000-0000-0000-0000-0000000000a1', 'conc.owner@test.local', 'conc_owner', 'admin', true FROM public.tenants WHERE slug = 'conc-site';
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
SELECT id, 'c0000000-0000-0000-0000-0000000000a2', 'conc.manager@test.local', 'conc_manager', 'admin', true FROM public.tenants WHERE slug = 'conc-site';

INSERT INTO hospitality.properties (id, tenant_id, name, slug, status)
SELECT 'c1000000-0000-0000-0000-000000000001', id, 'מתחם', 'p', 'active' FROM public.tenants WHERE slug = 'conc-site';

-- one unit per scenario (cNN), and two whole properties with their members
INSERT INTO hospitality.units (id, tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price)
SELECT ('c2000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, t.id, 'c1000000-0000-0000-0000-000000000001',
       'unit', 'יחידה ' || n, 'u' || n, 4, 2, 500
  FROM public.tenants t, generate_series(1, 30) n WHERE t.slug = 'conc-site';
INSERT INTO hospitality.units (id, tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price)
SELECT u.id::uuid, t.id, 'c1000000-0000-0000-0000-000000000001', 'whole_property', u.name, u.slug, 8, 4, 1500
  FROM public.tenants t,
       (VALUES ('c2000000-0000-0000-0000-0000000000f1', 'כל המתחם 1', 'w1'), ('c2000000-0000-0000-0000-0000000000f2', 'כל המתחם 2', 'w2')) u(id, name, slug)
 WHERE t.slug = 'conc-site';
INSERT INTO hospitality.unit_members (tenant_id, parent_unit_id, member_unit_id)
SELECT t.id, m.p::uuid, m.c::uuid FROM public.tenants t,
       (VALUES ('c2000000-0000-0000-0000-0000000000f1', 'c2000000-0000-0000-0000-000000000021'),
               ('c2000000-0000-0000-0000-0000000000f1', 'c2000000-0000-0000-0000-000000000022'),
               ('c2000000-0000-0000-0000-0000000000f2', 'c2000000-0000-0000-0000-000000000023'),
               ('c2000000-0000-0000-0000-0000000000f2', 'c2000000-0000-0000-0000-000000000024')) m(p, c)
 WHERE t.slug = 'conc-site';

-- wrappers executed by the API roles themselves (SECURITY INVOKER): the session sets
-- the role, the x-tenant-id header and the JWT subject exactly like PostgREST does
CREATE SCHEMA IF NOT EXISTS conc;
GRANT USAGE ON SCHEMA conc TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION conc.unit(_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('c2000000-0000-0000-0000-0000000000' || lpad(_n::text, 2, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION conc.whole(_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('c2000000-0000-0000-0000-0000000000f' || _n)::uuid $$;
CREATE OR REPLACE FUNCTION conc.req(_unit uuid, _in integer, _out integer, _email text, _key text,
                                    _phone text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT hospitality.request_booking(
    _unit_id => _unit, _check_in => current_date + _in, _check_out => current_date + _out,
    _full_name => 'אורח מקבילי', _email => _email,
    _phone => COALESCE(_phone, '05' || lpad((abs(hashtext(_email)) % 100000000)::text, 8, '0')),
    _idempotency_key => _key, _policy_accepted => true,
    _policy_hash => hospitality.quote(_unit, current_date + _in, current_date + _out) ->> 'policy_hash');
$$;
CREATE OR REPLACE FUNCTION conc.manual(_unit uuid, _in integer, _out integer, _name text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT hospitality.create_manual_booking(_unit_id => _unit, _check_in => current_date + _in, _check_out => current_date + _out,
                                            _full_name => _name, _phone => '0599999999', _terms_explained => true);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA conc TO anon, authenticated, service_role;

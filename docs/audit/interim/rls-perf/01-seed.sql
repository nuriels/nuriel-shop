-- ============================================================================
-- Seed perf_scratch with representative data (set-based, deterministic).
--   psql -v scenario=A ... -f 01-seed.sql        (see 01-seed.sh for the parameter sets)
-- Required psql vars: n_cust n_prod n_orders  (main tenant T1)
--                     o_cust o_prod o_orders  (each of the other 4 tenants T2..T5)
--                     n_inq o_inq             (business_profile.inquiries rows: main / each other)
--
-- session_replication_role = replica is used ONLY around the bulk INSERTs (it suppresses ORIGIN triggers
-- and FK checks; CHECK / UNIQUE / NOT NULL still apply). Data is generated referentially consistent
-- (customers -> user_roles -> customer_profiles; order_items -> orders/products by construction).
-- Personas (admin / agent / platform admin) are inserted with triggers ON, like scripts/db-tests/fixtures.sql.
-- ============================================================================
\set ON_ERROR_STOP on
SET synchronous_commit = off;
SET maintenance_work_mem = '256MB';
SELECT setseed(0.4242);

CREATE SCHEMA IF NOT EXISTS perf;
DROP TABLE IF EXISTS perf.cfg, perf.personas;
CREATE TABLE perf.cfg (k int PRIMARY KEY, tenant_id uuid, n_cust int, n_prod int, n_orders int, n_inq int);
INSERT INTO perf.cfg
SELECT k, ('71000000-0000-0000-0000-00000000000' || k)::uuid,
       CASE WHEN k = 1 THEN :n_cust   ELSE :o_cust   END,
       CASE WHEN k = 1 THEN :n_prod   ELSE :o_prod   END,
       CASE WHEN k = 1 THEN :n_orders ELSE :o_orders END,
       CASE WHEN k = 1 THEN :n_inq    ELSE :o_inq    END
  FROM generate_series(1, 5) k;

-- ---------------------------------------------------------------- tenants + personas (triggers ON)
INSERT INTO public.tenants (id, slug, name, owner_email)
SELECT tenant_id, 'perf-t' || k, 'Perf tenant ' || k, 'owner.t' || k || '@perf.local' FROM perf.cfg;

UPDATE public.tenant_subscriptions
   SET plan_type = 'premium', status = 'active', trial_ends_at = NULL, current_period_end = now() + interval '1 year'
 WHERE tenant_id IN (SELECT tenant_id FROM perf.cfg);

INSERT INTO auth.users (id, email)
SELECT md5('t' || k || '-admin')::uuid, 'admin.t' || k || '@perf.local' FROM perf.cfg
UNION ALL SELECT md5('t' || k || '-agent')::uuid, 'agent.t' || k || '@perf.local' FROM perf.cfg
UNION ALL SELECT md5('platform-admin')::uuid, 'platform@perf.local';

INSERT INTO public.platform_admins (user_id) VALUES (md5('platform-admin')::uuid);

INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
SELECT c.tenant_id, md5('t' || c.k || '-admin')::uuid, 'admin.t' || c.k || '@perf.local', 'admin_t' || c.k, 'admin', true FROM perf.cfg c
UNION ALL
SELECT c.tenant_id, md5('t' || c.k || '-agent')::uuid, 'agent.t' || c.k || '@perf.local', 'agent_t' || c.k, 'agent', true FROM perf.cfg c;

INSERT INTO public.categories (tenant_id, name, sort_order)
SELECT c.tenant_id, 'cat-' || lpad(g::text, 2, '0'), g FROM perf.cfg c, generate_series(1, 12) g;

CREATE TABLE perf.personas (name text PRIMARY KEY, user_id uuid, tenant_id uuid);
INSERT INTO perf.personas VALUES
  ('t1_customer_a',  md5('t1-cust-1')::uuid, '71000000-0000-0000-0000-000000000001'),
  ('t1_customer_b',  md5('t1-cust-2')::uuid, '71000000-0000-0000-0000-000000000001'),
  ('t1_customer_ag', md5('t1-cust-5')::uuid, '71000000-0000-0000-0000-000000000001'),  -- customer assigned to the T1 agent
  ('t1_admin',       md5('t1-admin')::uuid,  '71000000-0000-0000-0000-000000000001'),
  ('t1_agent',       md5('t1-agent')::uuid,  '71000000-0000-0000-0000-000000000001'),
  ('t2_customer',    md5('t2-cust-1')::uuid, '71000000-0000-0000-0000-000000000002'),
  ('t2_admin',       md5('t2-admin')::uuid,  '71000000-0000-0000-0000-000000000002'),
  ('platform_admin', md5('platform-admin')::uuid, '71000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------- bulk (replica mode)
SET session_replication_role = replica;

-- customers: auth.users + user_roles + customer_profiles
INSERT INTO auth.users (id, email)
SELECT md5('t' || c.k || '-cust-' || i)::uuid, 'c' || i || '.t' || c.k || '@perf.local'
  FROM perf.cfg c, LATERAL generate_series(1, c.n_cust) i;

INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
SELECT c.tenant_id, md5('t' || c.k || '-cust-' || i)::uuid, 'c' || i || '.t' || c.k || '@perf.local',
       'c' || lpad(i::text, 5, '0'), 'customer', true
  FROM perf.cfg c, LATERAL generate_series(1, c.n_cust) i;

INSERT INTO public.customer_profiles (tenant_id, user_id, business_name, contact_name, phone, price_tier, agent_id,
                                      age_confirmed, profile_completed, city, zip_code)
SELECT c.tenant_id, md5('t' || c.k || '-cust-' || i)::uuid, 'Biz ' || lpad(i::text, 5, '0'), 'Contact ' || i,
       '0501234567', 1 + (i % 3),
       CASE WHEN i % 5 = 0 THEN md5('t' || c.k || '-agent')::uuid END,
       true, true, 'Tel Aviv', '6100000'
  FROM perf.cfg c, LATERAL generate_series(1, c.n_cust) i;

-- products (ordered by created_at so heap order ~ time order, like real inserts)
INSERT INTO public.global_products (id, tenant_id, sku, name, category, description, image_url, images, colors, barcode,
    stock_quantity, price_tier1, price_tier2, price_tier3, cost_price, sale_price, sale_starts_at, sale_ends_at,
    is_promo, is_hidden, sort_order, pack_size, variant_attributes, seo_title, seo_description, created_by, created_at,
    is_featured)
SELECT md5('t' || c.k || '-prod-' || rn)::uuid, c.tenant_id, lpad(rn::text, 8, '0'),
       'Product ' || rn || ' ' || (ARRAY['Cola','Beer','Wine','Water','Juice','Vodka','Whisky','Snack'])[1 + rn % 8],
       'cat-' || lpad((1 + rn % 12)::text, 2, '0'),
       -- ~600 chars of description (the real catalog ships this to every visitor)
       repeat('Premium product description line ' || rn || ' - ' || md5(rn::text) || '. ', 10),
       'https://cdn.perf.local/' || c.k || '/p' || rn || '.webp',
       ARRAY['https://cdn.perf.local/' || c.k || '/p' || rn || '-1.webp', 'https://cdn.perf.local/' || c.k || '/p' || rn || '-2.webp'],
       '{}'::text[],
       CASE WHEN rn % 10 < 7 THEN (700000000000 + rn)::text END,
       (random() * 300)::int, round((5 + random() * 495)::numeric, 2), round((5 + random() * 450)::numeric, 2),
       round((5 + random() * 400)::numeric, 2), round((3 + random() * 300)::numeric, 2),
       CASE WHEN rn % 10 = 0 THEN 2 END,
       CASE WHEN rn % 10 = 0 THEN now() - interval '5 days' END,
       CASE WHEN rn % 10 = 0 THEN now() + interval '20 days' END,
       rn % 10 = 0, rn % 33 = 0, CASE WHEN rn % 10 < 3 THEN rn END,
       CASE WHEN rn % 6 = 0 THEN 6 END,
       CASE WHEN rn % 7 = 0 THEN '[{"name":"size","values":["S","M","L"]}]'::jsonb ELSE '[]'::jsonb END,
       'SEO title ' || rn, 'SEO description for product ' || rn,
       md5('t' || c.k || '-admin')::uuid,
       now() - interval '3 years' * (1 - rn::float / c.n_prod),
       rn % 25 = 0
  FROM perf.cfg c, LATERAL generate_series(1, c.n_prod) rn
 ORDER BY c.k, rn;
-- sale_price must be < tier1 to be an active sale; fix up the rows we flagged
UPDATE public.global_products SET sale_price = round((price_tier1 * 0.8)::numeric, 2)
 WHERE tenant_id IN (SELECT tenant_id FROM perf.cfg) AND sale_price IS NOT NULL;

INSERT INTO public.product_categories (tenant_id, product_id, category_id)
SELECT gp.tenant_id, gp.id, cat.id
  FROM public.global_products gp JOIN public.categories cat ON cat.tenant_id = gp.tenant_id AND cat.name = gp.category
 WHERE gp.tenant_id IN (SELECT tenant_id FROM perf.cfg);

INSERT INTO public.product_variants (tenant_id, product_id, options, sku, stock_quantity, sort_order)
SELECT gp.tenant_id, gp.id, jsonb_build_object('size', sz), gp.sku || '-' || sz, (random() * 100)::int, o
  FROM public.global_products gp,
       LATERAL (VALUES ('S', 1), ('M', 2), ('L', 3)) v(sz, o)
 WHERE gp.tenant_id IN (SELECT tenant_id FROM perf.cfg) AND gp.variant_attributes <> '[]'::jsonb;

-- orders (ordered by created_at; ~5% POS walk-in guests with customer_id NULL)
INSERT INTO public.orders (id, tenant_id, order_number, customer_id, agent_id, status, total, kind, created_at, updated_at,
    customer_name, customer_tax_id, customer_phone, customer_email, billing_city, billing_address, billing_zip,
    shipping_method_name, shipping_kind, shipping_price, payment_method, payment_status, order_source,
    delivered_at, shipped_at, tracking_number, shipping_provider, note, paid_at)
SELECT gen_random_uuid(), x.tenant_id, 'ORD-' || lpad(x.i::text, 8, '0'),
       CASE WHEN x.guest THEN NULL ELSE md5('t' || x.k || '-cust-' || x.cidx)::uuid END,
       CASE WHEN NOT x.guest AND x.cidx % 5 = 0 THEN md5('t' || x.k || '-agent')::uuid END,
       x.status, x.total, 'order', x.ts, x.ts,
       CASE WHEN x.guest THEN 'Walk-in' ELSE 'Biz ' || lpad(x.cidx::text, 5, '0') END,
       CASE WHEN NOT x.guest THEN '514000000' END,
       '0501234567',
       CASE WHEN NOT x.guest THEN 'c' || x.cidx || '.t' || x.k || '@perf.local' END,
       CASE WHEN NOT x.guest THEN 'Tel Aviv' END, CASE WHEN NOT x.guest THEN 'Herzl 1' END, CASE WHEN NOT x.guest THEN '6100000' END,
       'Courier', 'delivery', 25, 'offline',
       CASE WHEN x.status = 'delivered' THEN 'paid' ELSE 'not_required' END,
       CASE WHEN x.guest THEN 'pos' ELSE 'web' END,
       CASE WHEN x.status = 'delivered' THEN x.ts + interval '3 days' END,
       CASE WHEN x.status IN ('delivered', 'shipped') THEN x.ts + interval '1 day' END,
       CASE WHEN x.status IN ('delivered', 'shipped') THEN 'TRK' || x.i END,
       CASE WHEN x.status IN ('delivered', 'shipped') THEN 'Courier Co' END,
       'perf seed order ' || x.i,
       CASE WHEN x.status = 'delivered' THEN x.ts + interval '1 day' END
  FROM (
    SELECT c.k, c.tenant_id, i,
           (i % 20 = 0) AS guest,
           1 + floor(random() * c.n_cust)::int AS cidx,
           (ARRAY['delivered','delivered','delivered','delivered','delivered','delivered','delivered','shipped','pending','cancelled'])[1 + floor(random() * 10)::int] AS status,
           round((20 + random() * 4980)::numeric, 2) AS total,
           now() - interval '3 years' * (1 - i::float / c.n_orders) AS ts
      FROM perf.cfg c, LATERAL generate_series(1, c.n_orders) i
  ) x
 ORDER BY x.k, x.i;

-- order_items: 1..5 per order (avg 3)
INSERT INTO public.order_items (order_id, tenant_id, product_id, quantity, unit_price, product_name, product_sku, created_at)
SELECT o.id, o.tenant_id, md5('t' || c.k || '-prod-' || p.rn)::uuid, 1 + floor(random() * 12)::int,
       round((5 + random() * 495)::numeric, 2), 'Product ' || p.rn, lpad(p.rn::text, 8, '0'), o.created_at
  FROM public.orders o
  JOIN perf.cfg c ON c.tenant_id = o.tenant_id
  CROSS JOIN LATERAL generate_series(1, 1 + abs(hashtext(o.id::text)) % 5) s
  CROSS JOIN LATERAL (SELECT 1 + floor(random() * c.n_prod)::int AS rn) p
 WHERE o.tenant_id IN (SELECT tenant_id FROM perf.cfg);

-- business_profile inquiries (+ notes, settings)
INSERT INTO business_profile.inquiry_settings (tenant_id) SELECT tenant_id FROM perf.cfg;
INSERT INTO business_profile.inquiries (id, tenant_id, client_key, full_name, phone, email, message, created_at)
SELECT md5('t' || c.k || '-inq-' || i)::uuid, c.tenant_id, gen_random_uuid(), 'Lead ' || i, '0501234567',
       'lead' || i || '@example.com', repeat('Please call me about item ' || i || '. ', 5),
       now() - interval '1 year' * (1 - i::float / c.n_inq)
  FROM perf.cfg c, LATERAL generate_series(1, c.n_inq) i;
INSERT INTO business_profile.inquiry_notes (tenant_id, inquiry_id, body)
SELECT c.tenant_id, md5('t' || c.k || '-inq-' || i)::uuid, 'note ' || i
  FROM perf.cfg c, LATERAL generate_series(1, c.n_inq, 4) i;

RESET session_replication_role;

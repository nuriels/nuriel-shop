-- get_catalog_exp() vs get_catalog() in the edge states: sabbath mode and suspended tenant (rolled back)
\pset tuples_only on
\pset format unaligned
SELECT 'state|persona|orig_rows|exp_rows|same_set';
\o /dev/null
BEGIN;
UPDATE public.site_settings SET is_sabbath_mode = true WHERE tenant_id = '71000000-0000-0000-0000-000000000001';
\o
SELECT 'sabbath';
\o /dev/null
SET LOCAL ROLE anon; SET LOCAL request.jwt.claims = '{"role":"anon"}'; SET LOCAL request.headers = '{"x-tenant-id":"71000000-0000-0000-0000-000000000001"}';
\o
SELECT 'sabbath|anon|' || (SELECT count(*) FROM public.get_catalog()) || '|' || (SELECT count(*) FROM public.get_catalog_exp()) || '|' ||
  ((SELECT coalesce(md5(string_agg(t::text,'|' ORDER BY (t).id)),'-') FROM public.get_catalog() t) = (SELECT coalesce(md5(string_agg(t::text,'|' ORDER BY (t).id)),'-') FROM public.get_catalog_exp() t));
\o /dev/null
RESET ROLE;
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '{"sub":"56919df8-c960-55e5-e647-a4651212d3bb","role":"authenticated"}';
\o
SELECT 'sabbath|admin|' || (SELECT count(*) FROM public.get_catalog()) || '|' || (SELECT count(*) FROM public.get_catalog_exp()) || '|' ||
  ((SELECT coalesce(md5(string_agg(t::text,'|' ORDER BY (t).id)),'-') FROM public.get_catalog() t) = (SELECT coalesce(md5(string_agg(t::text,'|' ORDER BY (t).id)),'-') FROM public.get_catalog_exp() t));
\o /dev/null
ROLLBACK;
BEGIN;
UPDATE public.tenants SET status = 'suspended' WHERE id = '71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE anon; SET LOCAL request.jwt.claims = '{"role":"anon"}'; SET LOCAL request.headers = '{"x-tenant-id":"71000000-0000-0000-0000-000000000001"}';
\o
SELECT 'suspended|anon|' || (SELECT count(*) FROM public.get_catalog()) || '|' || (SELECT count(*) FROM public.get_catalog_exp()) || '|' ||
  ((SELECT coalesce(md5(string_agg(t::text,'|' ORDER BY (t).id)),'-') FROM public.get_catalog() t) = (SELECT coalesce(md5(string_agg(t::text,'|' ORDER BY (t).id)),'-') FROM public.get_catalog_exp() t));
\o /dev/null
RESET ROLE;
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '{"sub":"56919df8-c960-55e5-e647-a4651212d3bb","role":"authenticated"}';
\o
SELECT 'suspended|admin|' || (SELECT count(*) FROM public.get_catalog()) || '|' || (SELECT count(*) FROM public.get_catalog_exp()) || '|' ||
  ((SELECT coalesce(md5(string_agg(t::text,'|' ORDER BY (t).id)),'-') FROM public.get_catalog() t) = (SELECT coalesce(md5(string_agg(t::text,'|' ORDER BY (t).id)),'-') FROM public.get_catalog_exp() t));
\o /dev/null
RESET ROLE;
SET LOCAL ROLE service_role; SET LOCAL request.headers = '{"x-tenant-id":"71000000-0000-0000-0000-000000000001"}';
\o
SELECT 'suspended|feed(service)|' || (SELECT count(*) FROM public.storefront_feed_products()) || '|' || (SELECT count(*) FROM public.storefront_feed_products_exp()) || '|' ||
  ((SELECT coalesce(md5(string_agg(t::text,'|' ORDER BY (t).id)),'-') FROM public.storefront_feed_products() t) = (SELECT coalesce(md5(string_agg(t::text,'|' ORDER BY (t).id)),'-') FROM public.storefront_feed_products_exp() t));
\o /dev/null
ROLLBACK;

#!/usr/bin/env bash
# prints the data volumes actually loaded in perf_scratch (usage: 08-volumes.sh > out/volumes-X.txt)
psql -X -h /tmp/pg -p 5499 -U postgres -d perf_scratch <<'SQL'
select 'orders' t, count(*) filter (where tenant_id='71000000-0000-0000-0000-000000000001') main_tenant, count(*) total from public.orders
union all select 'order_items', count(*) filter (where tenant_id='71000000-0000-0000-0000-000000000001'), count(*) from public.order_items
union all select 'global_products', count(*) filter (where tenant_id='71000000-0000-0000-0000-000000000001'), count(*) from public.global_products
union all select 'customer_profiles', count(*) filter (where tenant_id='71000000-0000-0000-0000-000000000001'), count(*) from public.customer_profiles
union all select 'user_roles', count(*) filter (where tenant_id='71000000-0000-0000-0000-000000000001'), count(*) from public.user_roles
union all select 'bp.inquiries', count(*) filter (where tenant_id='71000000-0000-0000-0000-000000000001'), count(*) from business_profile.inquiries
union all select 'bp.inquiry_notes', count(*) filter (where tenant_id='71000000-0000-0000-0000-000000000001'), count(*) from business_profile.inquiry_notes;
select tenant_id, count(*) orders from public.orders where tenant_id::text like '71%' group by 1 order by 1;
select relname, pg_size_pretty(pg_total_relation_size(oid)) total_with_indexes, pg_size_pretty(pg_relation_size(oid)) heap from pg_class where relnamespace='public'::regnamespace and relname in ('orders','order_items','global_products','customer_profiles','user_roles') order by 1;
select 'main-tenant orders per customer: avg ' || round(count(*)::numeric / nullif(count(distinct customer_id),0), 1) || ', customer A=' || count(*) filter (where customer_id = (select user_id from perf.personas where name='t1_customer_a')) from public.orders where tenant_id='71000000-0000-0000-0000-000000000001' and customer_id is not null;
select 'items per order (main tenant): ' || round((select count(*) from public.order_items where tenant_id='71000000-0000-0000-0000-000000000001')::numeric / (select count(*) from public.orders where tenant_id='71000000-0000-0000-0000-000000000001'), 2);
select 'agent T1 orders: ' || count(*) from public.orders where agent_id = (select user_id from perf.personas where name='t1_agent');
SQL

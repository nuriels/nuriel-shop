#!/usr/bin/env bash
# Usage: 01-seed.sh A|B   -> seeds perf_scratch (must be freshly created by 00-setup-db.sh)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
P=(psql -X -q -h /tmp/pg -p 5499 -U postgres -d perf_scratch -v ON_ERROR_STOP=1)
case "${1:?A or B}" in
  A) VARS=(-v scenario=A -v n_cust=50  -v n_prod=3000  -v n_orders=20000  -v o_cust=10 -v o_prod=300  -v o_orders=2000  -v n_inq=2000  -v o_inq=200) ;;
  B) VARS=(-v scenario=B -v n_cust=200 -v n_prod=10000 -v n_orders=150000 -v o_cust=20 -v o_prod=1000 -v o_orders=20000 -v n_inq=10000 -v o_inq=1000) ;;
esac
time "${P[@]}" "${VARS[@]}" -f "$HERE/01-seed.sql"
# steady-state emulation: VACUUM (sets visibility map / hint bits) + ANALYZE
time "${P[@]}" -c "VACUUM (ANALYZE) public.orders, public.order_items, public.global_products, public.product_categories, public.product_variants, public.customer_profiles, public.user_roles, public.categories, business_profile.inquiries, business_profile.inquiry_notes, public.tenants, public.platform_admins, public.tenant_subscriptions, public.site_settings"
"${P[@]}" -c "select 'orders' t, tenant_id, count(*) from public.orders group by 2 union all select 'order_items', tenant_id, count(*) from public.order_items group by 2 union all select 'global_products', tenant_id, count(*) from public.global_products group by 2 union all select 'customer_profiles', tenant_id, count(*) from public.customer_profiles group by 2 union all select 'inquiries', tenant_id, count(*) from business_profile.inquiries group by 2 order by 1,2"
"${P[@]}" -c "select relname, pg_size_pretty(pg_total_relation_size(oid)) total, reltuples::bigint from pg_class where relname in ('orders','order_items','global_products','customer_profiles','user_roles') and relnamespace='public'::regnamespace"

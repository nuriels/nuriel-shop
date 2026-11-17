#!/usr/bin/env bash
# Sensitivity check of the isolation harness (mutation testing). For each deliberately WRONG policy variant:
# recreate perf_scratch_b from perf_scratch, apply the correct rewrite, apply the mutant, run the harness on perf_scratch_b,
# and diff against the original-policy output (out/isolation-A/iso-orig.out). Every mutant must show up as a diff and/or LEAK.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
BASE=${1:-$HERE/out/isolation-A/iso-orig.out}
OUT=$HERE/out/mutants; mkdir -p "$OUT"
P=(psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p 5499 -U postgres)
declare -A M
M[M1_orders_select_drops_customer_arm]='ALTER POLICY "orders select" ON public.orders USING ((SELECT is_admin(auth.uid())) OR (agent_id IS NOT NULL AND agent_id = (SELECT auth.uid())))'
M[M2_orders_select_open]='ALTER POLICY "orders select" ON public.orders USING (true)'
M[M3_items_select_admin_only]='ALTER POLICY "order items select" ON public.order_items USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND (SELECT is_admin(auth.uid()))))'
M[M4_items_select_join_dropped]='ALTER POLICY "order items select" ON public.order_items USING (EXISTS (SELECT 1 FROM public.orders o WHERE (SELECT is_admin(auth.uid())) OR o.customer_id = (SELECT auth.uid())))'
M[M5_user_roles_select_drops_self]='ALTER POLICY "role readable by self staff or agent of customer" ON public.user_roles USING ((SELECT is_admin(auth.uid())) OR (is_agent(auth.uid()) AND is_agent_of_customer((SELECT auth.uid()), user_id)))'
M[M6_products_staff_select_open]='ALTER POLICY "products readable by staff" ON public.global_products USING (true)'
M[M7_profiles_select_agent_widened]='ALTER POLICY "customer profile select" ON public.customer_profiles USING ((user_id = (SELECT auth.uid())) OR (SELECT is_staff(auth.uid())))'
M[M8_orders_update_any_agent_order]='ALTER POLICY "orders update by staff" ON public.orders USING ((SELECT is_admin(auth.uid())) OR agent_id IS NOT NULL) WITH CHECK ((SELECT is_admin(auth.uid())) OR agent_id IS NOT NULL)'
M[M9_bp_inquiries_isolation_open]='ALTER POLICY tenant_isolation ON business_profile.inquiries USING (true) WITH CHECK (true)'
M[M10_products_admin_uses_is_staff]='ALTER POLICY "products managed by admin" ON public.global_products USING ((SELECT is_staff(auth.uid()))) WITH CHECK ((SELECT is_staff(auth.uid())))'
for k in $(printf '%s\n' "${!M[@]}" | sort -V); do
  "${P[@]}" -d postgres -c "DROP DATABASE IF EXISTS perf_scratch_b" -c "CREATE DATABASE perf_scratch_b TEMPLATE perf_scratch" 2>/dev/null
  "${P[@]}" -d perf_scratch_b -v scope=core -f "$HERE/rewrite-policies.sql" >/dev/null 2>&1
  "${P[@]}" -d perf_scratch_b -c "${M[$k]}" || { echo "$k: mutant failed to apply"; continue; }
  psql -X -q -h /tmp/pg -p 5499 -U postgres -d perf_scratch_b -f "$HERE/isolation-check.sql" > "$OUT/$k.out" 2> "$OUT/$k.err"
  d=$(diff "$BASE" "$OUT/$k.out" | grep -c '^[<>]'); l=$(grep -c '|LEAK$' "$OUT/$k.out")
  echo "$k: differing_lines=$d LEAK_lines=$l -> $([ "$d" -gt 0 ] || [ "$l" -gt 0 ] && echo DETECTED || echo NOT-DETECTED)"
done
# leave perf_scratch_b as the correct rewrite again
"${P[@]}" -d postgres -c "DROP DATABASE IF EXISTS perf_scratch_b" -c "CREATE DATABASE perf_scratch_b TEMPLATE perf_scratch" 2>/dev/null
"${P[@]}" -d perf_scratch_b -v scope=core -f "$HERE/rewrite-policies.sql" >/dev/null 2>&1

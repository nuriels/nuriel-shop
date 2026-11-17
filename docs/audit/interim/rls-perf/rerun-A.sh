#!/usr/bin/env bash
cd "$(dirname "$0")"
P=(psql -X -q -h /tmp/pg -p 5499 -U postgres)
./00-setup-db.sh > out/A-setup.log 2>&1
./01-seed.sh A > out/A-seed.log 2>&1
./08-volumes.sh > out/volumes-A.txt 2>&1
# pristine clone: dry-run of the rule over ALL public policies (rolled back) + count of what it would touch
"${P[@]}" -d postgres -c "DROP DATABASE IF EXISTS perf_scratch_b" -c "CREATE DATABASE perf_scratch_b TEMPLATE perf_scratch"
(echo "BEGIN;"; cat rewrite-policies.sql; echo "SELECT 'dry-run scope=all: policies rewritten = ' || count(*) || ' (public ' || count(*) filter (where nsp='public') || ', business_profile ' || count(*) filter (where nsp='business_profile') || ')' FROM perf.policy_rewrite_log;"; echo "ROLLBACK;") | "${P[@]}" -d perf_scratch_b -v scope=all -At > out/rewrite-all-dryrun.txt 2>&1
./02-make-rewrite-db.sh core > out/A-rewrite-core.log 2>&1
psql -X -At -h /tmp/pg -p 5499 -U postgres -d perf_scratch_b -c "select md5(string_agg(c.relname||'.'||pol.polname||coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),''), '|' order by c.relname, pol.polname)) from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace where (n.nspname, c.relname) in (('public','orders'),('public','order_items'),('public','customer_profiles'),('public','user_roles'),('public','global_products'),('business_profile','inquiries'),('business_profile','inquiry_notes'),('business_profile','inquiry_settings'))" > out/core-policies-md5-A.txt
psql -X -At -h /tmp/pg -p 5499 -U postgres -d perf_scratch_b -c "copy (select rel, pol, cmd, permissive, before_using, after_using, before_check, after_check from perf.policy_rewrite_log order by rel, cmd, pol) to stdout with (format csv, header)" > out/policy-rewrite-log.csv
python3 run-measure.py perf_scratch A-orig > A-orig.log 2>&1
python3 run-measure.py perf_scratch_b A-rewrite > A-rewrite.log 2>&1
./03-run-isolation.sh out/isolation-A > out/isolation-A.log 2>&1
./04-mutation-check.sh > out/mutants.log 2>&1
python3 05-loadtest.py perf_scratch A-orig 8,16 30 > A-orig-load.log 2>&1
python3 05-loadtest.py perf_scratch_b A-rewrite 8,16 30 > A-rewrite-load.log 2>&1
echo finished > rerun-A.done

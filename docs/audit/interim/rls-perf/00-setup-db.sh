#!/usr/bin/env bash
# Creates perf_scratch (ONLY that DB name) and applies stubs + all migrations, same as scripts/db-tests/run.sh `apply`.
set -euo pipefail
PGBIN=/usr/lib/postgresql/16/bin; SOCK=/tmp/pg; PORT=5499
REPO=/home/user/nuriel-stage2
P=(psql -X -q -v ON_ERROR_STOP=1 -h $SOCK -p $PORT -U postgres)
"${P[@]}" -d postgres -c "DROP DATABASE IF EXISTS perf_scratch" -c "CREATE DATABASE perf_scratch ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0"
"${P[@]}" -d perf_scratch -f $REPO/scripts/db-tests/supabase-stubs.sql >/dev/null
for f in $(ls $REPO/supabase/migrations/*.sql | sort); do
  if ! "${P[@]}" -d perf_scratch -f "$f" >/tmp/perf-migration.log 2>&1; then echo "FAILED: $f"; tail -5 /tmp/perf-migration.log; exit 1; fi
done
# DEVIATION (scratch DB only): the test stub auth.uid() reads only request.jwt.claim.sub. Real Supabase ships
# coalesce(request.jwt.claim.sub, request.jwt.claims->>'sub') (a jsonb parse per call). Use the production shape so
# per-call cost is not under-estimated. Set PERF_STUB_UID=1 to keep the stub definition instead.
if [ "${PERF_STUB_UID:-0}" != "1" ]; then
"${P[@]}" -d perf_scratch -c "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$\$"
fi
echo "applied $(ls $REPO/supabase/migrations/*.sql | wc -l) migrations to perf_scratch"

#!/usr/bin/env bash
# ============================================================
# Hospitality 3a — ביצועי הלוח (מקומי בלבד, Postgres 16 כמו run.sh):
#   אתר עם 300 יחידות (10 מתחמים) ו-~5,000 הזמנות שנוצרו דרך מנוע ההזמנות האמיתי
#   (create_manual_booking), ואז calendar() לטווח של 42 יום עבור כל היחידות — 7 פעמים,
#   החציון מול היעד (≤ 300ms). גם EXPLAIN של שאילתת ההזמנות לטווח.
# שימוש:  bash scripts/db-tests/hospitality/perf/calendar-perf.sh   (אחרי scripts/db-tests/run.sh)
# ============================================================
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../../.." && pwd)
PORT=${PGPORT:-5499}
DB=calendar_perf
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d "$DB")
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres -c "SET client_min_messages = warning" \
  -c "DROP DATABASE IF EXISTS $DB" \
  -c "CREATE DATABASE $DB ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
"${PSQL[@]}" -f "$ROOT/scripts/db-tests/supabase-stubs.sql" >/dev/null
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do "${PSQL[@]}" -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }; done

echo "seeding: 300 units, ~5,000 bookings through create_manual_booking …"
"${PSQL[@]}" <<'SQL' >/dev/null
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-0000000000f0', 'platform@perf.local', now()),
  ('a0000000-0000-0000-0000-00000000ee01', 'owner@perf.local', now()) ON CONFLICT DO NOTHING;
INSERT INTO public.platform_admins (user_id) VALUES ('a0000000-0000-0000-0000-0000000000f0') ON CONFLICT DO NOTHING;
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', false);
SELECT hospitality.admin_create_site('perf-hotel', 'מלון ביצועים');
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE public.platform_feature_flags SET enabled = true WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled');
INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
SELECT id, k, true FROM public.tenants, unnest(ARRAY['hospitality_backend_enabled', 'hospitality_management_enabled']) k
 WHERE slug = 'perf-hotel';
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
SELECT id, 'a0000000-0000-0000-0000-00000000ee01', 'owner@perf.local', 'perf_owner', 'admin', true, true
  FROM public.tenants WHERE slug = 'perf-hotel';
-- the plan limit: unlimited for this measurement
UPDATE hospitality.subscriptions SET plan_code = 'enterprise'
 WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug = 'perf-hotel');
SQL
"${PSQL[@]}" <<'SQL'
DO $$
DECLARE
  _t uuid := (SELECT id FROM public.tenants WHERE slug = 'perf-hotel');
  _p uuid;
  _u uuid;
  i integer;
  j integer;
  d integer;
  n integer := 0;
BEGIN
  -- as postgres (setup data): properties and units straight into the tables
  FOR i IN 1..10 LOOP
    INSERT INTO hospitality.properties (tenant_id, name, slug, status, property_type)
    VALUES (_t, 'בניין ' || i, 'b-' || i, 'active', 'boutique_hotel') RETURNING id INTO _p;
    FOR j IN 1..30 LOOP
      INSERT INTO hospitality.units (tenant_id, property_id, kind, unit_type, name, slug, sort_order, base_price, capacity)
      VALUES (_t, _p, 'room', 'room', 'חדר ' || i || lpad(j::text, 2, '0'), 'r-' || i || '-' || j, j, 500, 4);
    END LOOP;
  END LOOP;
END $$;
SQL
"${PSQL[@]}" -tA <<'SQL'
-- bookings through the real engine, as the owner: stays of 2–4 nights with 1–3 free nights between
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000ee01', false);
SELECT set_config('request.headers', json_build_object('x-tenant-id', (SELECT id FROM public.tenants WHERE slug = 'perf-hotel'))::text, false);
DO $$
DECLARE
  u record;
  d integer;
  len integer;
  n integer := 0;
BEGIN
  FOR u IN SELECT id, row_number() OVER (ORDER BY name) AS k FROM hospitality.units
            WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug = 'perf-hotel') LOOP
    -- the engine accepts only future stays: from today, ~100 days ahead
    d := (u.k % 3)::integer;
    WHILE d < 100 AND n < 5100 LOOP
      len := 2 + ((u.k + d) % 3)::integer;
      PERFORM hospitality.create_manual_booking(u.id, current_date + d, current_date + d + len, 'אורח ' || n,
                                                '05' || lpad((n % 100000000)::text, 8, '0'), true);
      n := n + 1;
      d := d + len + 1 + ((u.k + d) % 3)::integer;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'bookings created: %', n;
END $$;
SQL
"${PSQL[@]}" -c "ANALYZE" >/dev/null
echo "measuring calendar(today, today + 42) for all units (7 runs) …"
"${PSQL[@]}" -tA <<'SQL'
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000ee01', false);
SELECT set_config('request.headers', json_build_object('x-tenant-id', (SELECT id FROM public.tenants WHERE slug = 'perf-hotel'))::text, false);
SET ROLE authenticated;
DO $$
DECLARE
  _start timestamptz;
  _ms numeric[] := '{}';
  r jsonb;
  i integer;
BEGIN
  FOR i IN 1..7 LOOP
    _start := clock_timestamp();
    r := hospitality.calendar(current_date, current_date + 42);
    _ms := _ms || round(extract(epoch FROM clock_timestamp() - _start) * 1000, 1);
  END LOOP;
  RAISE NOTICE 'units=% bookings_in_window=% blocks=% payload_kb=%', jsonb_array_length(r -> 'units'),
    jsonb_array_length(r -> 'bookings'), jsonb_array_length(r -> 'blocks'), round(length(r::text) / 1024.0);
  RAISE NOTICE 'calendar ms (7 runs): %; median %', _ms,
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x) FROM unnest(_ms) x);
  _start := clock_timestamp();
  PERFORM hospitality.calendar_stamp(current_date, current_date + 42);
  RAISE NOTICE 'calendar_stamp ms: %', round(extract(epoch FROM clock_timestamp() - _start) * 1000, 1);
END $$;
RESET ROLE;
SQL
echo "EXPLAIN (bookings overlapping the window):"
"${PSQL[@]}" -tA -c "EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY ON) SELECT count(*) FROM hospitality.bookings b
  WHERE b.tenant_id = (SELECT id FROM public.tenants WHERE slug = 'perf-hotel') AND b.check_out > current_date AND b.check_in < current_date + 42" | sed 's/^/  /'
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null

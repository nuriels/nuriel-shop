#!/usr/bin/env bash
# (Re)creates perf_scratch_b as a copy of perf_scratch (same data) and applies the policy rewrite there.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
P=(psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p 5499 -U postgres)
"${P[@]}" -d postgres -c "DROP DATABASE IF EXISTS perf_scratch_b" -c "CREATE DATABASE perf_scratch_b TEMPLATE perf_scratch"
"${P[@]}" -d perf_scratch_b -v scope=${1:-core} -f "$HERE/rewrite-policies.sql"

#!/usr/bin/env bash
# Runs the isolation harness on perf_scratch (original policies) and perf_scratch_b (rewritten) and diffs the outputs.
# usage: 03-run-isolation.sh [outdir]   (default: out/isolation)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${1:-$HERE/out/isolation}; mkdir -p "$OUT"
P=(psql -X -q -h /tmp/pg -p 5499 -U postgres)
for pair in "perf_scratch:orig" "perf_scratch_b:rewrite"; do
  db=${pair%%:*}; tag=${pair##*:}
  s=$(date +%s)
  "${P[@]}" -d "$db" -f "$HERE/isolation-check.sql" > "$OUT/iso-$tag.out" 2> "$OUT/iso-$tag.err"
  echo "$tag ($db): $(grep -vc '^#' "$OUT/iso-$tag.out") result lines, LEAK=$(grep -c '|LEAK$' "$OUT/iso-$tag.out"), stderr lines=$(wc -l < "$OUT/iso-$tag.err"), md5=$(md5sum < "$OUT/iso-$tag.out" | cut -c1-12), $(( $(date +%s) - s )) s"
done
if diff "$OUT/iso-orig.out" "$OUT/iso-rewrite.out" > "$OUT/iso.diff"; then echo "DIFF: IDENTICAL"; else echo "DIFF: DIFFERENT ($(grep -c '^[<>]' "$OUT/iso.diff") differing lines) -> $OUT/iso.diff"; fi

#!/usr/bin/env bash
# ============================================================
# סקריפטי הבדיקה הישנים ב-scripts/*-check.ts (לפני Vitest) — בונים ומריצים
# כל אחד בנפרד. excel-check / watermark-check מדולגים: הם בודקים מודולים
# (src/lib/excel, src/lib/watermark.server) שלא קיימים בריפו — ראו
# docs/testing.md ("סקריפטים יתומים").
# ============================================================
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
cd "$ROOT"
status=0
for name in import-check url-import-check; do
  if npx -y esbuild@0.28.2 "scripts/$name.ts" --bundle --platform=node --format=esm \
      --outfile="$OUT/$name.mjs" --alias:@=./src --log-level=error \
     && node "$OUT/$name.mjs"; then
    echo "[$name] ok"
  else
    echo "[$name] FAILED"; status=1
  fi
done
echo "[excel-check] skipped — src/lib/excel does not exist (orphaned script)"
echo "[watermark-check] skipped — src/lib/watermark.server does not exist (orphaned script)"
exit $status

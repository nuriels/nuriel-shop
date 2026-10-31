#!/usr/bin/env bash
# ============================================================
# סיור מוקלט בתצוגה המקומית של Hospitality (P0): נתוני הדגמה טריים ← התהליכים
# בממשק במחשב ובטלפון ← צילומי מסך וסרטונים ב-e2e/preview/out (וגם index.html).
# דורש Supabase מקומי פעיל (bun run e2e:up או bun run hosp:preview).
# בסוף — נתוני ההדגמה נוצרים שוב, כך שהתצוגה נשארת כמו שתוכננה.
# ============================================================
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
OUT="$ROOT/e2e/preview/out"
rm -rf "$OUT"
mkdir -p "$OUT/screens" "$OUT/videos"

node scripts/preview/hospitality-demo.mjs
status=0
npx playwright test -c e2e/preview/playwright.config.ts "$@" || status=$?

# MP4 (H.264) — מתנגן בכל טלפון ובכל דפדפן; בלי ffmpeg נשארים קבצי WebM
if command -v ffmpeg >/dev/null 2>&1; then
  for f in "$OUT"/videos/*.webm; do
    [ -e "$f" ] || continue
    ffmpeg -loglevel error -y -i "$f" -c:v libx264 -pix_fmt yuv420p -crf 28 -preset veryfast \
      -movflags +faststart -an "${f%.webm}.mp4" && rm -f "$f"
  done
fi
node scripts/preview/gallery.mjs "$OUT"
node scripts/preview/hospitality-demo.mjs >/dev/null
echo "צילומי מסך וסרטונים: e2e/preview/out (index.html)"
exit "$status"

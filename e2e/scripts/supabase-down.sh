#!/usr/bin/env bash
# עצירה ומחיקה של Supabase המקומי של E2E (כולל הנתונים — הכל חד-פעמי)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
npx -y supabase@2.122.0 --workdir "$ROOT/e2e/.supabase" stop --no-backup

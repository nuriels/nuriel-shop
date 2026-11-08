#!/usr/bin/env bash
# בונה ומריץ את האפליקציה מול Supabase המקומי של E2E ומול השירותים המדומים.
# דומיינים: <slug>.shop.localhost (כל דפדפן מפנה *.localhost ל-127.0.0.1),
# פאנל הפלטפורמה: platform.shop.localhost. ה-build לא נוגע ב-Dockerfile.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
set -a
# shellcheck disable=SC1091
. "$ROOT/e2e/.env.e2e"
set +a
export TENANT_BASE_DOMAIN=shop.localhost
export PLATFORM_ADMIN_HOST=platform.shop.localhost
export PUBLIC_SITE_URL=http://kobi.shop.localhost:3100
export RESEND_API_KEY=re_e2e_mock RESEND_API_URL=http://127.0.0.1:4010
# NURIEL AI: "הדגם" המדומה של mock-services (כתובת מקומית בלבד — אחרת השרת מתעלם ממנה)
export AI_ASSISTANT_TEST_API_URL=http://127.0.0.1:4010
# התראות החידוש רצות בבדיקות רק מהכפתור בפאנל ("בדיקת התראות עכשיו") — לא מתזמן שעתי שירוץ באמצע בדיקה
export AI_RENEWAL_JOB=off
export GROW_SANDBOX_URL=http://127.0.0.1:4010/grow GROW_SECRETS_KEY=ZTJlLW9ubHktbm90LWEtcmVhbC1rZXktMDEyMzQ1Njc=
export LOGIN_CODE_SECRET=e2e-only-login-code-secret
# מודול הרישיונות: סוד הצפנת המפתחות — לבדיקות בלבד (בשרת: נוצר ב-setup-selfhost)
export LICENSE_KEYS_SECRET=e2e-only-license-keys-secret-0123456789abcdef
export SITEMAP_TTL_MS=0 PORT=3100 NODE_ENV=production
# מנוע Hospitality: מתג הסביבה פתוח רק בבדיקות (בפרודקשן לא מוגדר = כבוי);
# האתרים עדיין סגורים עד שהבדיקה מדליקה את הדגלים שלהם
export HOSPITALITY_ENGINE=on
# ייבוא תמונות מקישור (Ecommerce 18, Hospitality 2e): בבדיקות בלבד מותר השם localhost — לשרת
# התמונות המקומי של הבדיקה. כתובות IP פנימיות (127.0.0.1, 10.x, 169.254.x…) עדיין חסומות
export IMPORT_IMAGE_ALLOW_HOSTS=localhost
if [ "${E2E_SKIP_BUILD:-}" != "1" ]; then bun run build >/dev/null; fi
node "$ROOT/e2e/scripts/mock-services.mjs" &
exec node .output/server/index.mjs

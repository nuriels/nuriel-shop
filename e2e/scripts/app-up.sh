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
# NURIEL AI SEO ENGINE: העובד ברקע לא רץ בבדיקות (משימות של עסקים / מוצרים חדשים היו רצות באמצע בדיקות אחרות);
# הלוגיקה שלו בבדיקות יחידה ומסד, וה-E2E בודק את מה שבעל העסק ומנהל הפלטפורמה עושים (seo-engine.spec.ts)
export SEO_WORKER=off
export GROW_SANDBOX_URL=http://127.0.0.1:4010/grow GROW_SECRETS_KEY=ZTJlLW9ubHktbm90LWEtcmVhbC1rZXktMDEyMzQ1Njc=
export LOGIN_CODE_SECRET=e2e-only-login-code-secret
# מודול הרישיונות: סוד הצפנת המפתחות — לבדיקות בלבד (בשרת: נוצר ב-setup-selfhost)
export LICENSE_KEYS_SECRET=e2e-only-license-keys-secret-0123456789abcdef
export SITEMAP_TTL_MS=0 PORT=3100 NODE_ENV=production
# מנוע Hospitality: מתג הסביבה פתוח רק בבדיקות (בפרודקשן לא מוגדר = כבוי);
# האתרים עדיין סגורים עד שהבדיקה מדליקה את הדגלים שלהם
export HOSPITALITY_ENGINE=on
# Nuriel Websites: אותו דבר למנוע אתרי העסקים (בפרודקשן לא מוגדר = כבוי)
export BUSINESS_PROFILE_ENGINE=on
# ייבוא תמונות מקישור (Ecommerce 18, Hospitality 2e): בבדיקות בלבד מותר השם localhost — לשרת
# התמונות המקומי של הבדיקה. כתובות IP פנימיות (127.0.0.1, 10.x, 169.254.x…) עדיין חסומות
export IMPORT_IMAGE_ALLOW_HOSTS=localhost
# כתובת האתר (מיגרציה 197): תשובות DNS קבועות לבדיקות — רק לשמות בסיומת .test (הבדיקה כותבת את הקובץ),
# וכתובת שרת מטווח התיעוד (TEST-NET-3) להוראות ה-DNS. דומיינים אמיתיים — תמיד DNS אמיתי
export DNS_TEST_FIXTURES="$ROOT/e2e/.dns-fixtures.json"
export SERVER_PUBLIC_IPS=203.0.113.10
# תשלומים אונליין MAX/Hyp — DEMO (docs/payment-gateways/DEMO-IMPLEMENTATION-CONTRACT.md §2): השרת מדבר רק עם
# Hyp המדומה (e2e/scripts/mock-hyp.mjs, בתוך mock-services). demo = מסופי בדיקות (00100…) בלבד. עבודות התשלום
# ברקע כבויות — הבדיקות מפעילות אותן בעצמן. MAX_PAY_TEST_URL נלקח בחשבון רק לכתובת מקומית ופאנל *.localhost
export PAYMENTS_ENV=demo PAYMENTS_JOBS=off MAX_PAY_TEST_URL=http://127.0.0.1:4010/hyp/p/
RESULTS="$ROOT/e2e/test-results"
if [ "${E2E_APP_VARIANT:-}" = "platform-not-ready" ]; then
  # שרת שני על אותו build, מסד ושירותים מדומים — לתרחיש כשל אחד (payments-failures.spec.ts, R2-4): בלי סוד השורש
  # של הפלטפורמה, כך שצד הפלטפורמה של התשלומים "לא מוכן". צד החנות מקבל את סוד השורש של השרת הרץ (השורה הראשונה
  # בקובץ הקנריות) — לא נוצר סוד חדש ושום ערך לא מודפס. שום דבר אחר לא מופעל; הפלט מצטרף ל-server.log (שנסרק)
  PAYMENTS_SECRETS_KEY=$(head -n 1 "$RESULTS/hyp-canaries.txt")
  export PAYMENTS_SECRETS_KEY PORT="${E2E_APP_PORT:-3101}"
  unset PLATFORM_TERMINAL_SECRETS_KEY
  exec node .output/server/index.mjs >>"$RESULTS/server.log" 2>&1
fi
# שני סודות השורש — אקראיים בכל ריצה (אף פעם לא ערך קבוע בקוד), ומזהה הריצה של Hyp המדומה (ממנו נבנים KEY / PassP
# מזויפים וייחודיים). כולם "קנריות": אחרי הריצה הסריקות מחפשות אותם ביומן השרת, במסד ובקבצים שמועלים מה-CI
PAYMENTS_SECRETS_KEY=$(openssl rand -hex 32)
PLATFORM_TERMINAL_SECRETS_KEY=$(openssl rand -hex 32)
HYP_MOCK_RUN_ID=$(openssl rand -hex 6)
[ "${#PAYMENTS_SECRETS_KEY}" -eq 64 ] && [ "$PAYMENTS_SECRETS_KEY" != "$PLATFORM_TERMINAL_SECRETS_KEY" ]
export PAYMENTS_SECRETS_KEY PLATFORM_TERMINAL_SECRETS_KEY HYP_MOCK_RUN_ID
mkdir -p "$RESULTS"
(
  umask 077
  printf '%s\n' "$PAYMENTS_SECRETS_KEY" "$PLATFORM_TERMINAL_SECRETS_KEY" >"$RESULTS/hyp-canaries.txt"
  node -e 'import(process.argv[1]).then((m) => console.log(m.hypCanaries(process.env.HYP_MOCK_RUN_ID).join("\n")))' \
    "$ROOT/e2e/fixtures/hyp-fake.mjs" >>"$RESULTS/hyp-canaries.txt"
)
if [ "${E2E_SKIP_BUILD:-}" != "1" ]; then bun run build >/dev/null; fi
node "$ROOT/e2e/scripts/mock-services.mjs" &
# פלט השרת נשמר גם ב-e2e/test-results/server.log (נסרק אחרי הריצה; Playwright מתעלם מ-stdout).
# stderr ממשיך להגיע ל-Playwright כמו קודם
exec > >(tee -a "$RESULTS/server.log") 2> >(tee -a "$RESULTS/server.log" >&2)
exec node .output/server/index.mjs

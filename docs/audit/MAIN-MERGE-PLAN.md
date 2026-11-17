# תוכנית מיזוג ל-`main` — ביקורת הפלטפורמה (17.11.2026)

**לא בוצע מיזוג ולא פריסה.** המסמך הוא תוכנית. כל שלב בו שמשנה את `main`, מוחק ענפים, או נוגע בשרת — דורש אישור מפורש שלך.

## 1. המצב כפי שנמדד

| פריט                                               | ערך                                                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `origin/main`                                      | `4f7daa3dd` (30.10.2026)                                                                                                     |
| ענף הביקורת                                        | `audit/platform-review-2026-11` @ `241ed8c` (9 קומיטי תיקון + 3 קומיטי תיעוד מעל `hospitality/tracking-settings`)                                                     |
| יחס ל-`main`                                       | `main` **הוא אב קדמון** של הענף (0 קומיטים ש-`main` מקדים) ← מיזוג **fast-forward, בלי התנגשויות**                           |
| גודל הפער                                          | 299 קומיטים · 1352 קבצים · +259,217 / −1,594 שורות                                                                           |
| מיגרציות                                           | `main` 116 → ענף 199 (83 חדשות, כולן עם rollback; בדיקת `tests/architecture/migrations.test.ts`)                             |
| קומיטי התיקון מעל `hospitality/tracking-settings` | 9 (`3876b82`, `0f35ed9`, `15d2fa6`, `87f583e`, `5e4368e`, `f03232f`, `0647ba5`, `2fd08b6`, `d9cdb61`) — **אפס מיגרציות**, אפס שינוי מסד |
| מה רץ בייצור                                       | `eccd001` (ענף `hospitality/tracking-settings`), מיגרציות עד 199 — כלומר ענף הביקורת הוא ייצור + 8 קומיטי קוד בלבד           |

### ענפים פעילים — מה כלול ומה לא

כל הענפים הבאים **כלולים במלואם** ב-`hospitality/tracking-settings` (0 קומיטים שאינם בו) ולכן גם בענף הביקורת: `websites/engine`, `release/next`, `billing/agreements`, `hospitality/release`, `maintenance/email-auth-security`, `hospitality/signing-mobile`, `ecommerce/store-release`, `hospitality/documents`, `ecommerce/import-sync`, `ecommerce/product-duplicates`, `hospitality/seo`, `hospitality/stage-2`, `claude/multi-tenant-part2`.

**לא כלול — `ecommerce/store-identity` (2 קומיטים):**

- `888731a` StoreIdentity: מקור אחד לשם כל חנות (SEO, Schema, כותרות, feeds) — פונקציונליות אמיתית שחסרה.
- `fc6fb68` תשתית בדיקות Ecommerce — עותק ישן של תשתית שכבר קיימת בקו (`stage-2`).
- מיזוג הענף כמו שהוא **יתנגש** (`.github/workflows/tests.yml`, `.gitignore`, `bun.lock`, `docs/testing.md`, `e2e/scripts/*` — כולם בגלל העותק הישן). לכן: **לא למזג את הענף; להעביר (cherry-pick) רק את `888731a`.** בבדיקה בעץ זמני הוא מתיישם בלי התנגשויות (`git cherry-pick --no-commit`), אבל הוא נוגע בעשרות קבצי UI ו-SEO ולכן דורש ריצת בדיקות מלאה בנפרד.

### עבודה מקומית שלא נדחפה / שיש לשים אליה לב

- worktrees ב-`/home/user`: `nuriel-shop` (`hospitality/seo` @ `80ddb09`), `nuriel-before` (detached @ `6dd034b`), `nuriel-dups` (`ecommerce/product-duplicates`), `nuriel-import` (`ecommerce/store-release`) — כולם נקיים (בדיקת `git status`), הקומיטים שלהם כלולים ב-`origin`.
- `stash@{0}`: "E4 support WIP (untested, not for the server)" על `hospitality/stage-2` — **לא להפעיל; לא נגעתי**. מכיל עבודה ישנה לא-נבדקת; להחליט אם למחוק.

## 2. תנאים מוקדמים למיזוג

| תנאי                                                               | מצב                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI ירוק על הענף (typecheck, lint, unit, SQL, rollback, E2E, build) | ראו `FULL-PLATFORM-AUDIT.md` §תוצאות; **ה-CI הרשמי ירוץ על הדחיפה** — להמתין לו                                                                                                                                                                      |
| אין סודות/dumps/artifacts ב-Git                                    | נבדק: סריקת תבניות סודות על כל הקבצים במעקב — רק מחרוזות מדומות בבדיקות; אין `.env`/dump/מפתח במעקב. קבצים גדולים (>1MB): 6 קובצי `marketing/banner-3d/out/*` (~23MB) ו-`public/brand/*.png` — **מוצע להוציא את `marketing/**/out` מ-Git** (לא נעשה) |
| הענף לא מכיל מיגרציות חדשות                                        | ✓ — אפשר למזג בלי תיאום עם המסד                                                                                                                                                                                                                      |

## 3. הסדר המוצע (כל שלב באישור)

1. **גיבוי ל-`main` הישן — ענף, לא כוח:** `git branch main-before-2026-11-17 origin/main && git push origin main-before-2026-11-17` (שומר את `4f7daa3dd`; אין שום אובדן).
2. **PR מ-`audit/platform-review-2026-11` אל `main`** (לא נוצר — לא ביקשת). אפשרויות מיזוג:
   - _Fast-forward_ (`git merge --ff-only`, מקומי) — היסטוריה ליניארית של 299+ קומיטים; הכי נקי.
   - _Merge commit_ ב-GitHub — שומר גבול ברור "ביקורת 17.11".
   - **לא** Squash: ישבור את הקשר לענפי המקור ולתיעוד שמפנה לקומיטים (למשל `docs/hospitality/seo/deploy-*.md`).
3. **תג:** `git tag release-2026-11-17 <sha>` על `main` אחרי המיזוג (נקודת ייחוס לפריסה ולחזרה).
4. **`ecommerce/store-identity`:** ענף חדש מ-`main`, `git cherry-pick 888731a`, ריצת unit + E2E של Ecommerce, ואז PR נפרד.
5. **ניקוי ענפים (רק אחרי שתאשר רשימה מפורשת):** מועמדים למחיקה כי כלולים לגמרי ב-`main` החדש: `websites/engine`, `release/next`, `billing/agreements`, `hospitality/release`, `maintenance/email-auth-security`, `hospitality/signing-mobile`, `ecommerce/store-release`, `hospitality/documents`, `ecommerce/import-sync`, `ecommerce/product-duplicates`, `hospitality/seo`, `hospitality/stage-2`, `hospitality/stage-0`, `hospitality/stage-1`. **לא נמחק כלום בביקורת.**

## 4. פריסת הקוד לשרת (נפרד מהמיזוג; ללא מיגרציה)

הענף שונה מהייצור רק בקוד אפליקציה ובשני קבצי הגדרה: `docker-compose.yml` ו-`.env.example` (העברת 5 משתנים בערך ריק — **ללא שינוי התנהגות עד שמגדירים אותם**). אין מיגרציה, ולכן אין צעד DB ואין rollback של DB.

פקודות (אותו סדר שמוכר מהפריסות הקודמות, אחת אחת, ובאישור מפורש):

1. גיבוי image: `docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-audit` ורישום ה-commit הנוכחי.
2. `git fetch` + `git checkout` של ה-SHA של הענף (fast-forward מ-`eccd001`).
3. `docker compose build`, ואז `docker compose up -d`; בדיקת `healthy` ו-200 לשלושת האתרים.
4. אחרי הפריסה — לבדוק בבדיקת עשן: טופס פניות באתר עסק, ייצוא PDF הזמנה (תאריך), ו-webhook (לא לשלוח אמיתי).

**חזרה לאחור:** `docker tag nuriel-shop-app-app:before-audit nuriel-shop-app-app:latest && docker compose up -d` (הקוד הקודם עובד עם אותו מסד).

## 5. מה _לא_ נכנס (נשאר פתוח)

ראו `FULL-PLATFORM-AUDIT.md` §פתוח. בקצרה: `place_order` ישיר בלי הגבלת קצב (S-1), אישור תשלום Grow מול Grow (S-2), `/healthz` בלי I/O, הגנת rollback על 9 טבלאות, RLS לכל שורה (P3), באנדל הכניסה (P1), פיצול קבצי "פלטפורמה" משותפים (A1).

## 6. סיכונים ופרשנות

- **אין התנגשויות עכשיו, אבל הענפים הארוכים מתיישנים:** כל קומיט חדש ב-`hospitality/tracking-settings` אחרי הביקורת יחייב rebase/מיזוג של ענף הביקורת. לכן — להקפיא דחיפות לקו הזה בין הרגע שמאשרים לרגע המיזוג.
- **ההיסטוריה ארוכה (299 קומיטים) ומכילה `Co-Authored-By` של מודלים שונים** — תקין; לא נוגעים בהיסטוריה (אין rebase/squash).
- **מנוע Websites/Hospitality מוסתרים מאחורי דגלים** (`BUSINESS_PROFILE_ENGINE`, `HOSPITALITY_ENGINE` + דגלי פלטפורמה). מיזוג ל-`main` לא מפעיל שום דבר בשרת; רק פריסה עושה זאת.

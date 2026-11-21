# תוכנית מיזוג ל-`main` — ביקורת הפלטפורמה (17.11.2026)

> ### ✅ עדכון מצב — 21.11.2026 (המסמך נשמר כתיעוד היסטורי של מה שתוכנן לפני הפריסה)
> - **מוזג ל-`main`:** `20f49eb` — שלושת הענפים (ביקורת, SEO של Hospitality, SSR של החנות).
> - **נפרס לייצור:** 19.11.2026, 10:50 UTC — image `876ba03ebdfd` (תג `release-20f49eb`); **201** מיגרציות רשומות ב-`public._migrations_applied`.
> - **נקודת חזרה:** תג `before-audit-seo-ssr` = image `3839fed06c71`; גיבוי `before-deploy.dump` (sha256 `0fbc850a…`) + עותק Storage (1,369 קבצים) — בשרת.
> - **מה הלאה:** הגרסה הבאה (חבילת כלה עם חדר נוסף, `/sitemap`, מחיר אישי בלי הבהוב, E2E קופון) ותוכנית הפריסה שלה —
>   [`RELEASE-2026-11-21.md`](RELEASE-2026-11-21.md). גיבוי מחוץ לשרת — [`OFFSITE-BACKUP-PROPOSAL.md`](OFFSITE-BACKUP-PROPOSAL.md).

**לא בוצע מיזוג ולא פריסה.** המסמך הוא תוכנית. כל שלב בו שמשנה את `main`, מוחק ענפים, או נוגע בשרת — דורש אישור מפורש שלך.

## 1. המצב כפי שנמדד

| פריט                                               | ערך                                                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `origin/main`                                      | `4f7daa3dd` (30.10.2026)                                                                                                     |
| ענף הביקורת                                        | `audit/platform-review-2026-11` — שלב 1 (9 קומיטי תיקון) + שלב 2 (סגירת סיכונים: מיגרציה 200, rollback guards, healthz) + מסמכים; HEAD העדכני ב-`PRE-MERGE-READINESS.md` |
| יחס ל-`main`                                       | `main` **הוא אב קדמון** של הענף (0 קומיטים ש-`main` מקדים) ← מיזוג **fast-forward, בלי התנגשויות**                           |
| גודל הפער                                          | **314 קומיטים** · 1,382 קבצים · +262,131 / −1,600 (בלי קבצי הביניים של מדידת ה-RLS); 0 קבצים נמחקו |
| מיגרציות                                           | `main` 116 → ענף **200** (84 חדשות, כולן עם rollback; בדיקת `tests/architecture/migrations.test.ts`) |
| קומיטי התיקון מעל `hospitality/tracking-settings` | שלב 1: 9 קומיטים (`3876b82` … `d9cdb61`) — **אפס מיגרציות**. שלב 2: `c0615dd` (**מיגרציה 200**), `4206cee`, `4e2aca2` + מסמכים |
| מה רץ בייצור                                       | `eccd001` (ענף `hospitality/tracking-settings`), מיגרציות עד 199 — כלומר ענף הביקורת = ייצור + 8 קומיטי קוד של שלב 1 + שלב 2 (**כולל מיגרציה 200**) |

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
| הענף מכיל מיגרציה חדשה אחת מעבר לייצור (200) | המיזוג עצמו לא נוגע במסד; **הפריסה כוללת צעד DB אחד** — `PRE-MERGE-READINESS.md` §8 |

## 3. הסדר המוצע (כל שלב באישור)

1. **גיבוי ל-`main` הישן — ענף, לא כוח:** `git branch main-before-2026-11-17 origin/main && git push origin main-before-2026-11-17` (שומר את `4f7daa3dd`; אין שום אובדן).
2. **PR מ-`audit/platform-review-2026-11` אל `main`** (לא נוצר — לא ביקשת). אפשרויות מיזוג:
   - _Fast-forward_ (`git merge --ff-only`, מקומי) — היסטוריה ליניארית של 303 קומיטים; הכי נקי.
   - _Merge commit_ ב-GitHub — שומר גבול ברור "ביקורת 17.11".
   - **לא** Squash: ישבור את הקשר לענפי המקור ולתיעוד שמפנה לקומיטים (למשל `docs/hospitality/seo/deploy-*.md`).
3. **תג:** `git tag release-2026-11-17 <sha>` על `main` אחרי המיזוג (נקודת ייחוס לפריסה ולחזרה).
4. **`ecommerce/store-identity`:** ענף חדש מ-`main`, `git cherry-pick 888731a`, ריצת unit + E2E של Ecommerce, ואז PR נפרד.
5. **ניקוי ענפים (רק אחרי שתאשר רשימה מפורשת):** מועמדים למחיקה כי כלולים לגמרי ב-`main` החדש: `websites/engine`, `release/next`, `billing/agreements`, `hospitality/release`, `maintenance/email-auth-security`, `hospitality/signing-mobile`, `ecommerce/store-release`, `hospitality/documents`, `ecommerce/import-sync`, `ecommerce/product-duplicates`, `hospitality/seo`, `hospitality/stage-2`, `hospitality/stage-0`, `hospitality/stage-1`. **לא נמחק כלום בביקורת.**

## 4. פריסת הקוד לשרת (נפרד מהמיזוג)

**עודכן בשלב 2:** הענף שונה מהייצור בקוד אפליקציה, בקבצי הגדרה (`docker-compose.yml`, `.env.example`, `Dockerfile`, `deploy/release-next.sh`) **וב-מיגרציה אחת (200, `order_guard`)**. לכן הפריסה כוללת צעד DB: גיבוי → מיגרציה 200 בלבד → build + `up -d` → בדיקות `/healthz` / `/readyz` → בדיקת עשן של קופה עם קופון. **הפקודות המלאות, בדיקות האימות ותוכנית החזרה לאחור (אפליקציה ו-DB) — ב-[`PRE-MERGE-READINESS.md` §8–9](PRE-MERGE-READINESS.md).** לא בוצע דבר מזה.

## 5. מה _לא_ נכנס (נשאר פתוח)

ראו `PRE-MERGE-READINESS.md` §4. בקצרה: אימות Grow מול הספק (S-2); RLS לכל שורה (P3 — נמדד, השכתוב המוכח ממתין להחלטה); `get_catalog()` ללקוח מחובר; באנדל הכניסה (P1); עמוד מוצר שמוריד את כל הקטלוג (P2); פיצול קבצי "פלטפורמה" משותפים (A1); `ecommerce/store-identity`. **נסגרו בשלב 2:** `place_order` (S-1), healthcheck (C1), הגנת rollback (B8).

## 6. סיכונים ופרשנות

- **אין התנגשויות עכשיו, אבל הענפים הארוכים מתיישנים:** כל קומיט חדש ב-`hospitality/tracking-settings` אחרי הביקורת יחייב rebase/מיזוג של ענף הביקורת. לכן — להקפיא דחיפות לקו הזה בין הרגע שמאשרים לרגע המיזוג.
- **ההיסטוריה ארוכה (303 קומיטים) ומכילה `Co-Authored-By` של מודלים שונים** — תקין; לא נוגעים בהיסטוריה (אין rebase/squash).
- **מנוע Websites/Hospitality מוסתרים מאחורי דגלים** (`BUSINESS_PROFILE_ENGINE`, `HOSPITALITY_ENGINE` + דגלי פלטפורמה). מיזוג ל-`main` לא מפעיל שום דבר בשרת; רק פריסה עושה זאת.

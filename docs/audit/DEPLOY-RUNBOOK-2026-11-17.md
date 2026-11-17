# Runbook פריסה לייצור — ביקורת + SEO של Hospitality + SSR של החנות (nuriel-shop)

> **מצב: לא אושר ולא הורץ.** אין אישור ל-Merge, ל-Deploy או להרצת מיגרציות. המסמך מכין את הצעדים כדי שאפשר יהיה
> לבקש אישור. כל פקודה — שורה אחת, שמות מלאים, מריץ **בעל המערכת**, **פקודה אחת בכל פעם**, ומדביק את הפלט.
> שום פקודה לא מדפיסה סוד.
>
> 🔍 = קריאה בלבד · ✏️ = משנה משהו בשרת (כתוב בדיוק מה) · ⛔ = נקודת אישור שלך — לא ממשיכים בלעדיה.
>
> **`<REL>`** = ה-SHA של commit השחרור (המיזוג של שלושת הענפים). יסופק ע"י הקלוד המתאם **אחרי** שבעל המערכת יאשר את
> המיזוג (נוצר לפי [`DEPLOY-HANDOFF-2026-11-17.md`](DEPLOY-HANDOFF-2026-11-17.md) §7.2; הקוד שלו זהה בייט-לבייט לעץ שנבדק —
> ריצות CI 191/192 ובדיקות מקומיות). **לא להריץ עם `<REL>` ריק.**
>
> **מצב השרת לפני** (נמדד): הקוד על `eccd001`, **199** מיגרציות רשומות ב-`public._migrations_applied` (נבדק ב-17.11: 777/777 אובייקטים
> זהים). **מצב אחרי:** הקוד על `<REL>`, **201** מיגרציות, תג חזרה `before-audit-seo-ssr`.
>
> **נבדק מראש (בלי השרת):** פקודות ה-SQL של המיגרציות, הבדיקות שאחריהן וה-Rollback הורצו מילה במילה (רק שם הקונטיינר הוחלף) על עותק
> מקומי של סכמת הייצור ב-199 מיגרציות — כולל חזרה ל-199. ה-image נבנה ורץ ב-Docker מקומי (סעיף "Docker"). **לא נבדקו מקומית:** הבנייה
> על השרת עצמו (`docker compose build` עם ה-`.env` האמיתי), ההפעלה, והבדיקות מול הכתובות האמיתיות.

## מה נכנס לייצור

| רכיב | פירוט |
| --- | --- |
| **אפליקציה** | קוד של 3 ענפים (ביקורת, SEO של Hospitality, SSR של החנות) — **image חדש** (כולל `bun install`: `package.json`/`bun.lock` השתנו) |
| **מיגרציה #200** | `20261118110000_order_guard.sql` — `coupon_grants`, הגנת הזמנות, `check_coupon` / `orders_apply_coupon` |
| **מיגרציה #201** | `20261118200000_hosp_seo_proposals.sql` — טבלאות `hospitality.seo_runs`, `hospitality.seo_proposals` + פונקציות; **תוספת בלבד** |
| **לא נכנס** | `ecommerce/store-identity` (ראו הדוח); אין שינוי ב-nginx, בתעודות, ב-Supabase עצמו; **לא** מריצים `deploy/setup-selfhost.sh` (כותב `.env` מחדש) |

**סדר ותלויות:** מסד לפני אפליקציה: #200 ← #201 ← הפעלת האפליקציה. הקוד החדש לא דורש אובייקט מסד חדש (חוץ ממסך ה-SEO שדורש #201), והקוד הישן
עובד מול מסד 200/201 — לכן החלון הקצר שבו הגרסה הישנה רצה מול מסד חדש בטוח, וגם החזרת האפליקציה לבדה. **השבתה:** `docker compose up -d` יוצר את
קונטיינר האפליקציה מחדש — שניות עד כדקה. מומלץ בשעה שקטה.

---

## שלב 1 — בדיקות מקדימות (🔍 קריאה בלבד)

### P1 — הענף והקומיט בשרת, ושה-`<REL>` ניתן להתקדמות בלי התנגשות

```bash
cd /root/nuriel-shop-git && git branch --show-current && git log --oneline -1 && git status --short --untracked-files=no | wc -l && git fetch origin && git merge-base --is-ancestor HEAD <REL> && echo "fast-forward possible" && git log --oneline -1 <REL>
```

**תקין:** שם הענף שעליו השרת עומד; `eccd001 …`; `0` (אין שינויים מקומיים בקבצי git); `fast-forward possible`; שורת ה-commit של `<REL>`. **אחרת — עוצרים.**
(ה-`fetch` מוריד רק את רשימת הקומיטים; שום קובץ לא משתנה.)

### P2 — Docker והקונטיינרים

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | grep '^nuriel-shop-' && docker images nuriel-shop-app-app --format '{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}\t{{.Size}}' && cd /root/nuriel-shop-git && docker compose ps
```

**תקין:** כל קונטיינרי nuriel-shop ב-`Up`, האפליקציה `(healthy)`; ב-images — `latest` (נרשום את ה-ID שלו) ותגי חזרה קודמים. את עמודת הגודל צריך ל-P4.

### P3 — המיגרציות: 199 רשומות, בדיוק שתיים ממתינות, ואין בשרת מיגרציה שלא בקוד

```bash
cd /root/nuriel-shop-git && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied" && LC_ALL=C comm -23 <(git ls-tree --name-only <REL> supabase/migrations/ | xargs -n1 basename | LC_ALL=C sort) <(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort) && echo "--- in the database but not in the code (must be 0 lines):" && LC_ALL=C comm -13 <(git ls-tree --name-only <REL> supabase/migrations/ | xargs -n1 basename | LC_ALL=C sort) <(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort) | wc -l
```

**תקין:** `199`; שתי שורות בדיוק — `20261118110000_order_guard.sql` ו-`20261118200000_hosp_seo_proposals.sql`; ואז `--- …` ו-`0`. **אחרת — עוצרים.**

### P4 — מקום פנוי בדיסק

```bash
df -h / /var/lib/docker /root/backups/nuriel-shop && docker system df
```

**תקין:** לפחות 5G פנוי במחיצה של `/var/lib/docker` (הבנייה מורידה תלויות ויוצרת image חדש). פחות — עוצרים.

### P5 — משתני סביבה (שמות בלבד; בלי ערכים)

```bash
cd /root/nuriel-shop-git && ls -l .env docker-compose.override.yml /root/nuriel-shop-supabase/docker/.env && for v in SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY RESEND_API_KEY PUBLIC_SITE_URL TENANT_BASE_DOMAIN PLATFORM_ADMIN_HOST HOSPITALITY_ENGINE HOSPITALITY_SECRET LOGIN_CODE_SECRET LICENSE_KEYS_SECRET SUPPORT_NOTIFY_EMAIL BUSINESS_PROFILE_SECRET CUSTOM_DOMAIN_CNAME_TARGET IMPORT_IMAGE_ALLOW_HOSTS AI_RENEWAL_JOB; do grep -q "^$v=." .env && echo "$v: set" || echo "$v: missing/empty"; done
```

**תקין:** הקבצים קיימים (`.env` — `-rw-------`); `set` ל-`SUPABASE_*`, `RESEND_API_KEY`, `PUBLIC_SITE_URL`, `TENANT_BASE_DOMAIN`, `PLATFORM_ADMIN_HOST`, `HOSPITALITY_ENGINE`, `HOSPITALITY_SECRET`, `LICENSE_KEYS_SECRET`.
**חמשת האחרונים** (`SUPPORT_NOTIFY_EMAIL`, `BUSINESS_PROFILE_SECRET`, `CUSTOM_DOMAIN_CNAME_TARGET`, `IMPORT_IMAGE_ALLOW_HOSTS`, `AI_RENEWAL_JOB`) — `missing/empty` זה בסדר.
**אם אחד מהם `set` — מדווחים לי לפני שממשיכים:** מהגרסה החדשה `docker-compose.yml` מעביר אותם לקונטיינר (לפני כן לא הגיעו אליו), למשל `AI_RENEWAL_JOB=off` יכבה את מתזמן התראות החידוש.

### P6 — אימות 777 האובייקטים (הרצה חוזרת סמוך לפריסה)

```bash
cd /root/nuriel-shop-git && git show <REL>:scripts/audit/prod-migration-fingerprint.sql | docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' nuriel-shop-db psql -U postgres -d postgres -X -q
```

**תקין:** `applied_total = 199`, `the_nine_recorded_of_9 = 9`, הסעיף `2. MISSING or DIFFERENT` ריק, וכל 9 המיגרציות `identical = total` (56·71·29·74·135·60·92·123·137 = 777). **אחרת — עוצרים.**

### P7 — "תמונת מצב" לפני הפריסה (🔍; נשווה אחרי) — נופי דורית וספירות כלליות

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -X -q -c "SELECT t.slug, (bt.representative_signature IS NOT NULL) AS has_signature, jsonb_array_length(bt.representative_signature) AS strokes, pg_column_size(bt.representative_signature) AS bytes, left(md5(bt.representative_signature::text), 8) AS fingerprint, bt.revision, (bt.confirmed_at IS NOT NULL) AS confirmed FROM public.tenants t LEFT JOIN hospitality.business_terms bt ON bt.tenant_id = t.id WHERE t.slug ILIKE 'nofi%';" -c "SELECT c.number, c.kind, c.status, (c.pdf_path IS NOT NULL) AS pdf_stored, left(c.pdf_sha256, 12) AS pdf_sha256_prefix FROM hospitality.client_contracts c JOIN public.tenants t ON t.id = c.tenant_id WHERE t.slug ILIKE 'nofi%' AND c.signed_at IS NOT NULL ORDER BY c.signed_at;" -c "SELECT (SELECT count(*) FROM public.tenants) AS tenants, (SELECT count(*) FROM auth.users) AS users, (SELECT count(*) FROM public.orders) AS orders, (SELECT count(*) FROM public.global_products) AS products, (SELECT count(*) FROM hospitality.client_contracts) AS contracts;"
```

**ערכי הבסיס שנמדדו ב-17.11** (בדיקת חתימת בעל העסק): `nofi-dorit`: `has_signature = t`, `strokes = 1`, `bytes = 776`, `fingerprint = c109ee16`, `revision = 3`, `confirmed = t`; מסמך חתום יחיד — מס' 1002, `policy`, `pdf_stored = t`.
**שומרים את הפלט** — בשלב 6 נריץ את אותה פקודה ונשווה: החתימה, ה-`fingerprint`, ה-`revision` והמסמך החתום חייבים להיות **זהים**; הספירות — זהות או גדולות (הזמנות חדשות בינתיים).

**⛔ אישור 1 — רק אם כל שלב 1 תקין.** משלב 2 והלאה הפקודות כותבות בשרת.

---

## שלב 2 — גיבוי (✏️ כותב רק ל-`/root/backups/nuriel-shop/before-audit-seo-ssr`, ומוסיף תג ל-image; האתר לא מושפע)

### B1 — המסד, רשימת המיגרציות, גרסת האפליקציה ותג חזרה ל-image

```bash
mkdir -m 700 /root/backups/nuriel-shop/before-audit-seo-ssr && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-audit-seo-ssr/db.dump && docker exec -i nuriel-shop-db pg_restore --list < /root/backups/nuriel-shop/before-audit-seo-ssr/db.dump > /root/backups/nuriel-shop/before-audit-seo-ssr/db.toc && grep -c "TABLE DATA" /root/backups/nuriel-shop/before-audit-seo-ssr/db.toc && docker exec -i nuriel-shop-db pg_restore -f /dev/null < /root/backups/nuriel-shop/before-audit-seo-ssr/db.dump && echo "dump read to the end: ok" && ls -lh /root/backups/nuriel-shop/before-audit-seo-ssr/db.dump && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > /root/backups/nuriel-shop/before-audit-seo-ssr/applied-before.txt && wc -l < /root/backups/nuriel-shop/before-audit-seo-ssr/applied-before.txt && git -C /root/nuriel-shop-git log --oneline -1 | tee /root/backups/nuriel-shop/before-audit-seo-ssr/app-commit.txt && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-audit-seo-ssr && docker image inspect nuriel-shop-app-app:before-audit-seo-ssr --format '{{.Id}}' | tee /root/backups/nuriel-shop/before-audit-seo-ssr/image-id.txt && docker images nuriel-shop-app-app --format '{{.Tag}}'
```

**תקין:** מספר טבלאות בגיבוי; `dump read to the end: ok`; גודל הקובץ; `199`; `eccd001 …`; ה-ID של ה-image (`sha256:…`); התגים כוללים `before-audit-seo-ssr`.

### B2 — קובצי התצורה

```bash
cp -p /root/nuriel-shop-git/.env /root/backups/nuriel-shop/before-audit-seo-ssr/app.env && cp -p /root/nuriel-shop-git/docker-compose.override.yml /root/backups/nuriel-shop/before-audit-seo-ssr/app-compose.override.yml && cp -p /root/nuriel-shop-supabase/docker/.env /root/backups/nuriel-shop/before-audit-seo-ssr/supabase.env && cp -p /root/nuriel-shop-supabase/docker/docker-compose.yml /root/backups/nuriel-shop/before-audit-seo-ssr/supabase-compose.yml && chmod 600 /root/backups/nuriel-shop/before-audit-seo-ssr/app.env /root/backups/nuriel-shop/before-audit-seo-ssr/supabase.env && ls -l /root/backups/nuriel-shop/before-audit-seo-ssr
```

**תקין:** `db.dump`, `db.toc`, `applied-before.txt`, `app-commit.txt`, `image-id.txt`, `app.env`, `app-compose.override.yml`, `supabase.env`, `supabase-compose.yml`.

### B3 — הגיבוי ניתן לשחזור (✏️ מסד בדיקה נפרד `restore_check` — נוצר ונמחק; המסד החי לא נוגע)

```bash
docker exec nuriel-shop-db psql -U postgres -q -c "DROP DATABASE IF EXISTS restore_check" -c "CREATE DATABASE restore_check" && docker exec -i nuriel-shop-db pg_restore -U postgres -d restore_check --no-owner --no-privileges < /root/backups/nuriel-shop/before-audit-seo-ssr/db.dump > /dev/null 2>&1; docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public.tenants), (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.orders), (SELECT count(*) FROM public._migrations_applied), (SELECT count(*) FROM hospitality.client_contracts)" && docker exec nuriel-shop-db psql -U postgres -d restore_check -tAc "SELECT (SELECT count(*) FROM public.tenants), (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.orders), (SELECT count(*) FROM public._migrations_applied), (SELECT count(*) FROM hospitality.client_contracts)" && docker exec nuriel-shop-db psql -U postgres -q -c "DROP DATABASE restore_check" && echo "restore check: done"
```

**תקין:** שתי שורות **זהות** (חנויות | משתמשים | הזמנות | 199 | חוזים) — הראשונה מהמסד החי, השנייה מהשחזור; ואז `restore check: done`. (שגיאות על אובייקטים פנימיים של Supabase בזמן השחזור צפויות ומוסתרות.) שורות שונות — עוצרים.

---

## שלב 3 — קוד ו-image (✏️ קבצים ב-`/root/nuriel-shop-git` + image חדש; **האתר ממשיך לרוץ על הגרסה הישנה**)

### S1 — הקוד, ושמירת קובצי ה-Rollback ליד הגיבוי

```bash
cd /root/nuriel-shop-git && git merge -q --ff-only <REL> && git log --oneline -1 && mkdir -p /root/backups/nuriel-shop/before-audit-seo-ssr/rollbacks && cp supabase/rollbacks/20261118110000_order_guard.down.sql supabase/rollbacks/20261118200000_hosp_seo_proposals.down.sql /root/backups/nuriel-shop/before-audit-seo-ssr/rollbacks/ && ls /root/backups/nuriel-shop/before-audit-seo-ssr/rollbacks | wc -l
```

**תקין:** `Fast-forward`-שקט (בלי שגיאה), שורת ה-commit של `<REL>`, ו-`2` (שני קובצי ה-Rollback).

### S2 — בדיקה יבשה: בדיוק שתי מיגרציות ממתינות (🔍)

```bash
cd /root/nuriel-shop-git && ls supabase/migrations/*.sql | xargs -n1 basename | LC_ALL=C sort | LC_ALL=C comm -23 - /root/backups/nuriel-shop/before-audit-seo-ssr/applied-before.txt
```

**תקין:** שתי שורות בדיוק: `20261118110000_order_guard.sql` ו-`20261118200000_hosp_seo_proposals.sql`.

### S3 — בנייה (✏️ image חדש; האתר ממשיך לרוץ על הישן)

```bash
cd /root/nuriel-shop-git && docker compose build && docker images nuriel-shop-app-app --format '{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}\t{{.Size}}'
```

**תקין:** מסתיים בלי שגיאה (`Built`); ב-images: `latest` עם **ID חדש** (שונה מ-`image-id.txt`) ו-`before-audit-seo-ssr` עם ה-ID הישן. כמה דקות (`bun install` + build). שגיאה — עוצרים (האתר לא נפגע; ה-image הישן עדיין `before-audit-seo-ssr`; אם `latest` הוחלף חלקית — R1).

**⛔ אישור 2 — מכאן משנים את המסד ומפעילים.** מריצים **M1 ← M2 ← A1 ברצף**, בשעה שקטה.

---

## שלב 4 — מיגרציות (✏️ המסד; כל אחת בטרנזקציה משלה, נרשמת רק אם הצליחה)

### M1 — מיגרציה #200 `order_guard` + בדיקות

```bash
cd /root/nuriel-shop-git && f=20261118110000_order_guard && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT to_regclass('public.coupon_grants') IS NOT NULL, (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.coupon_grants'::regclass), (NOT has_table_privilege('anon','public.coupon_grants','SELECT') AND NOT has_table_privilege('authenticated','public.coupon_grants','SELECT')), EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'orders_a_rate_guard' AND tgrelid = 'public.orders'::regclass AND NOT tgisinternal), (SELECT provolatile = 'v' FROM pg_proc WHERE oid = 'public.check_coupon(text,numeric,uuid,text,boolean)'::regprocedure), (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "t|t|t|t|t|200" ] && echo "200 checks ok"
```

**תקין:** `…order_guard ok`; `t|t|t|t|t|200`; `200 checks ok`. (הטבלה `coupon_grants` קיימת עם RLS ובלי גישה ל-`anon`/`authenticated`; הטריגר `orders_a_rate_guard` על `orders`; `check_coupon` VOLATILE.)
**נעצר (`ON_ERROR_STOP`, או `f` בשורה, או בלי `checks ok`):** **לא ממשיכים ל-M2 / A1.** האתר עדיין על הגרסה הישנה. שולחים לי את הפלט; אם צריך לחזור — R2.

### M2 — מיגרציה #201 `hosp_seo_proposals` + בדיקות + רענון הסכמה

```bash
cd /root/nuriel-shop-git && f=20261118200000_hosp_seo_proposals && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied WHERE filename = '20261118110000_order_guard.sql'" | grep -qx 1 && echo "dependency ok: 200 applied" && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT bool_and(relrowsecurity) FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relname IN ('seo_runs','seo_proposals')), (SELECT count(*) = 6 FROM pg_proc WHERE pronamespace = 'hospitality'::regnamespace AND proname IN ('seo_run_start','seo_run_finish','seo_proposals_add','seo_runs_state','seo_proposals','seo_proposal_decide')), ((SELECT count(*) FROM hospitality.seo_proposals) + (SELECT count(*) FROM hospitality.seo_runs) = 0), (NOT has_table_privilege('anon','hospitality.seo_proposals','SELECT') AND NOT has_table_privilege('anon','hospitality.seo_runs','SELECT')), has_function_privilege('authenticated','hospitality.seo_proposals()','EXECUTE'), (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "t|t|t|t|t|201" ] && echo "201 checks ok" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
```

**תקין:** `dependency ok: 200 applied`; `…hosp_seo_proposals ok`; `t|t|t|t|t|201`; `201 checks ok`; `NOTIFY`. (שתי טבלאות חדשות וריקות עם RLS, 6 פונקציות, אין גישה ל-`anon`.)
**נעצר:** לא ממשיכים ל-A1; האתר עדיין על הגרסה הישנה (שעובדת מול מסד 200). שולחים לי את הפלט.

---

## שלב 5 — הפעלת הגרסה החדשה (✏️ יוצר את קונטיינר האפליקציה מחדש; שניות עד דקה)

### A1 — הפעלה ובדיקות בריאות

```bash
cd /root/nuriel-shop-git && docker compose up -d && sleep 60 && docker compose ps && curl -s -o /dev/null -w 'healthz: %{http_code}\n' http://127.0.0.1:3700/healthz && curl -s -w ' -> readyz: %{http_code}\n' http://127.0.0.1:3700/readyz && curl -s -o /dev/null -w 'robots: %{http_code}\n' http://127.0.0.1:3700/robots.txt && docker inspect -f 'health: {{.State.Health.Status}}' nuriel-shop-app
```

**תקין:** (מחכה דקה — זה לא תקוע) שורות ה-compose (`Recreate`/`Started`); `app` — `Up … (healthy)`; `healthz: 200`; `{"status":"ready","db":"up"} -> readyz: 200`; `robots: 200`; `health: healthy`.
**אחרת:** מדווחים לי **מיד**; אם האתר לא עולה — R1 (דקה אחת).

### A2 — הלוג אחרי ההפעלה (🔍)

```bash
docker logs --since 5m nuriel-shop-app 2>&1 | grep -c '\[storefront-seed\]'; docker logs --since 5m nuriel-shop-app 2>&1 | tail -n 15
```

**תקין:** `0` שורות `[storefront-seed]` (שגיאות ה-SSR); ב-15 השורות האחרונות — הפעלה רגילה, בלי stack trace חוזר.

---

## שלב 6 — בדיקות עשן אחרי הפריסה

### SM1 — כל האתרים עונים (🔍)

```bash
for u in https://nuriel-shop.nuri1.fit https://nuri1.nuri1.fit https://nofi-dorit.nuri1.fit https://nuriel-app2.nuri1.fit; do curl -s -L -o /dev/null -w "$u -> %{http_code} (%{time_total}s)\n" "$u/"; done
```

**תקין:** `200` לכולם. (אם `nuri1` מוגש בכתובת אחרת — מחליפים; `≥500` בכל אחד — עוצרים.)

### SM2 — SSR של החנות (🔍) — מה גוגל מקבל בלי JavaScript

```bash
UA='Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'; for h in nuriel-shop nuri1; do curl -s -A "$UA" "https://$h.nuri1.fit/" -o /tmp/ssr-$h.html -w "$h: HTTP %{http_code}, %{size_download} bytes, %{time_total}s\n"; echo "   h1: $(grep -o '<h1' /tmp/ssr-$h.html | wc -l)   price signs: $(grep -o '₪' /tmp/ssr-$h.html | wc -l)   ld+json blocks: $(grep -o 'application/ld+json' /tmp/ssr-$h.html | wc -l)"; done
```

**תקין (לכל חנות):** `HTTP 200`; **`h1: 1`**; סימני `₪` — עשרות לפחות; כמה בלוקי `ld+json`; גודל כ-150–250 KB (לפני ה-SSR: ~15 תווים בגוף, **בלי H1**). זמן < 2 שנ'.

**בידוד בין חנויות** (🔍) — מוצר של חנות אחת לא מופיע ב-HTML של השנייה:

```bash
A=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT gp.id FROM public.global_products gp JOIN public.tenants t ON t.id = gp.tenant_id WHERE t.slug = 'nuri1' AND NOT gp.is_hidden ORDER BY gp.created_at DESC LIMIT 1") && echo "nuri1 product id in nuri1 page: $(grep -c "$A" /tmp/ssr-nuri1.html); in nuriel-shop page: $(grep -c "$A" /tmp/ssr-nuriel-shop.html)"
```

**תקין:** `≥1` בעמוד של `nuri1`, ו-**`0` בעמוד של `nuriel-shop`**. (מזהה מוצר הוא UUID ייחודי לחנות — לא שם, ששתי חנויות עשויות לחלוק.) **כל ערך אחר ב-"nuriel-shop page" — עוצרים מיד ומדווחים (דליפה בין חנויות).**

**עמוד מוצר, קטגוריה ועמודי מידע** (🔍):

```bash
UA='Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'; P=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT gp.id FROM public.global_products gp JOIN public.tenants t ON t.id = gp.tenant_id WHERE t.slug = 'nuriel-shop' AND NOT gp.is_hidden ORDER BY gp.created_at DESC LIMIT 1") && for path in "/product/$P" "/about" "/terms" "/privacy" "/contact"; do curl -s -A "$UA" "https://nuriel-shop.nuri1.fit$path" -o /tmp/ssr-page.html -w "$path: HTTP %{http_code}, %{size_download} bytes" && echo ", h1: $(grep -o '<h1' /tmp/ssr-page.html | wc -l), price signs: $(grep -o '₪' /tmp/ssr-page.html | wc -l), canonical: $(grep -o 'rel="canonical"' /tmp/ssr-page.html | wc -l)"; done
```

**תקין:** `HTTP 200`, `h1: 1`, `canonical` ≥ 1 בכל עמוד; בעמוד המוצר גם `price signs` ≥ 1. (קטגוריה: `https://nuriel-shop.nuri1.fit/?category=<שם קטגוריה>` בדפדפן — H1 ומוצרי הקטגוריה.)

**דף הפלטפורמה (NURIEL APP2)** — כמו קודם: `curl -s -L -o /dev/null -w '%{http_code}\n' https://nuriel-app2.nuri1.fit/` → `200`; בדפדפן — דף הנחיתה כרגיל.

**בדפדפן (ידני, 3 דקות):** בית החנות; הוספה לסל; פתיחת הסל; **בלי שגיאות בקונסול** (F12); לקוח מחובר רואה את המחיר שלו (לא "טוענים מחירים…" לאורך זמן).

### SM3 — קופה עם קופון של לקוח מחובר (✋ ידני; אין לה בדיקת E2E)

> זו הבדיקה היחידה שאין לה כיסוי אוטומטי, והיא נוגעת בלב השינוי של מיגרציה #200. **מומלץ בחנות ובחשבון לקוח שבעל המערכת בוחר לבדיקות.**
>
> 1. התחברות כלקוח, הוספת מוצר לעגלה, **החלת קוד קופון תקף** בקופה → ההנחה מופיעה בסיכום.
> 2. **(קריאה בלבד)** ה"אישור" שהשרת הנפיק נרשם: `docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*), max(created_at) FROM public.coupon_grants WHERE expires_at > now()"` → ≥ 1 ו-`created_at` של הרגע.
> 3. **השלמת הזמנת בדיקה קטנה** (באישור בעל המערכת בלבד — זו כתיבה אמיתית): ההזמנה נוצרת **עם ההנחה**, ואין שגיאה "קופון לא תקף". אחר כך מבטלים אותה/מסמנים כבדיקה.
> 4. הזמנת **אורח** רגילה (בלי קופון) מסתיימת תקין.
> 5. **לא** בודקים את מגבלת הקצב (30 הזמנות ב-10 דקות) בייצור — זה היה יוצר הזמנות אמיתיות; היא נבדקה ב-SQL וב-concurrency (50 הזמנות מקבילות → בדיוק 30).
>
> **תקין:** ההנחה בסיכום ובהזמנה; אין "קופון לא תקף" ללקוח לגיטימי; אורח מזמין. **כישלון בשלב 1 או 3 → עוצרים ומדווחים; אם קופה לא עובדת ללקוחות — R1 מיד.**

### SM4 — נופי דורית: החתימה, תנאי העסק והמסמך החתום (🔍 + ✋)

**א. נתוני החתימה והמסמכים — זהים לפני (🔍):** מריצים שוב את הפקודה של **P7** ומשווים:

| מה | לפני (P7 / בדיקה ב-17.11) | אחרי — חייב להיות |
| --- | --- | --- |
| החתימה | `has_signature = t`, `strokes = 1`, `bytes = 776`, `fingerprint = c109ee16` | **זהה בדיוק** |
| תנאי העסק | `revision = 3`, `confirmed = t` | **זהה בדיוק** |
| מסמך חתום | מס' 1002, `policy`, `pdf_stored = t`, `pdf_sha256_prefix` כפי ב-P7 | **זהה בדיוק** |
| ספירות | tenants / users / orders / products / contracts | זהות או גדולות (הזמנות חדשות) |

**שינוי בחתימה, ב-`fingerprint`, ב-`revision` או במסמך החתום = עצירה מיידית (R1+R2) ודיווח.** (הוכח מקומית שהמיגרציות לא נוגעות בהם; זו הוכחה על הנתונים האמיתיים.)

**ב. ה-PDF החתום עצמו (✋ דפדפן + קריאה בלבד):**
1. כניסה לניהול של נופי דורית → מסך **תנאים ופרטי החוזה**: חתימת בעל העסק מוצגת כתמונה (קו אחד).
2. מסמכי הלקוחות → המסמך החתום **מס' 1002** → הורדת ה-PDF → נפתח תקין.
3. השוואת טביעת האצבע של הקובץ שהורד מול המסד (🔍): בשרת — `docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT c.pdf_sha256 FROM hospitality.client_contracts c JOIN public.tenants t ON t.id = c.tenant_id WHERE t.slug = 'nofi-dorit' AND c.number = 1002"`; במחשב שלך — `sha256sum <הקובץ שהורד>` (ב-Windows: `certutil -hashfile <קובץ> SHA256`). **שני הערכים זהים** = ה-PDF השמור לא שונה.
   (זה מסמך **מדיניות** — בעיצוב אין בו עמודת "חתימת המשכיר (צד א')"; ראו `OWNER-SIGNATURE-CHECK.md`.)

**ג. חוזה אירוח/אירוע חדש מציג את חתימת בעל העסק (אופציונלי, ✏️ כתיבה):** רק אם בעל המערכת רוצה: ליצור **טיוטת** חוזה אירוח לאורח בדיקה במסך המסמכים ולפתוח תצוגת PDF — החתימה אמורה להופיע בתיבת צד א'; אחר כך לבטל את הטיוטה. **אין בכך צורך לאישור הפריסה** (הקוד לא השתנה לעומת הייצור), ולכן אפשר לדלג.

### SM5 — מסך ה-SEO ב-Hospitality (✋ דפדפן; בלי להפיק)

ניהול נופי דורית → עורך האתר → לשונית **גוגל ושיתוף** (SEO): הרשימה/המסך נטענים **בלי שגיאה** (דורש מיגרציה #201). **לא ללחוץ על הפקת הצעה** — זו קריאה למודל שעולה כסף (NURIEL AI). **לא לשמור/לפרסם** תוכן SEO באתר נופי דורית.

### SM6 — מעקב ב-24 השעות הראשונות (🔍)

```bash
docker logs --since 24h nuriel-shop-app 2>&1 | grep -ciE 'storefront-seed|unhandled|ECONNREFUSED|readyz'; docker stats --no-stream nuriel-shop-app --format 'cpu: {{.CPUPerc}}  mem: {{.MemUsage}}'; docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public.coupon_grants WHERE expires_at > now()"
```

**תקין:** מספר קטן/0 של שגיאות; זיכרון/CPU יציבים (השוואה ל-P2); `coupon_grants` — אישורים פעילים (שעתיים) כשיש לקוחות מחוברים עם קופון. שגיאות "קופון לא תקף" חריגות מצד לקוחות = סימן לאישורים שלא נוצרים → R1.

---

## שלב 7 — Rollback (רק אם צריך; ⛔ אישור לפני כל פעולה)

**שום נתון לא אובד:** R1 לא נוגע במסד. R2 שומר קודם גיבוי מלא של המצב הנוכחי, ו-#201 עוצרת לבד אם יש הצעות SEO שמורות. **כל הפקודות הורצו מקומית על עותק סכמת הייצור.**

| תקלה | פעולה |
| --- | --- |
| האתר לא עולה / `/readyz` ≠ 200 / קופה נכשלת / דליפה בין חנויות / שגיאות SSR | **R1** (האפליקציה בלבד; דקה) |
| בעיה רק ב-SEO של Hospitality | R1 אינו נדרש; אפשר להשאיר (המסך נכשל רק אצלו). אם צריך — R2 על #201 בלבד |
| בעיה בהזמנות/קופונים אחרי #200 | R1, ואז R2 (200) |
| סטייה בחתימה/מסמך חתום של נופי דורית | R1+R2 **ומדווחים לפני כל פעולה נוספת** (לא אמור לקרות — הוכח) |

### R1 — האפליקציה בלבד (✏️; מחזיר גם את ה-SSR; **המסד נשאר 201**)

```bash
docker tag nuriel-shop-app-app:before-audit-seo-ssr nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && docker compose up -d && sleep 60 && docker compose ps && curl -s -o /dev/null -w 'robots: %{http_code}\n' http://127.0.0.1:3700/robots.txt && docker image inspect nuriel-shop-app-app:latest --format '{{.Id}}'
```

**תקין:** `app` — `Up … (healthy)`; `robots: 200`; ה-ID זהה ל-`/root/backups/nuriel-shop/before-audit-seo-ssr/image-id.txt`. ה-image הישן עולה מיד, בלי בנייה. הקוד הישן עובד מול מסד 200/201 (הוכח: `check_coupon` באותה חתימה; הוא מתעלם מטבלאות ה-SEO) — ובדיקת ה-Docker של הגרסה הישנה נופלת ל-`/robots.txt`, ולכן היא `healthy`.
(תיקיית הקוד נשארת על `<REL>`; לבנייה מחדש של הגרסה הישנה — `git -C /root/nuriel-shop-git checkout eccd001 && docker compose build`, רק אם צריך.)

### R2 — המסד: #201 ואז #200 (✏️; רק מה שרשום)

**R2.0 — גיבוי של המצב הנוכחי (✏️ קובץ חדש; המסד לא משתנה):**

```bash
docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-audit-seo-ssr/before-rollback.dump && docker exec -i nuriel-shop-db pg_restore -f /dev/null < /root/backups/nuriel-shop/before-audit-seo-ssr/before-rollback.dump && ls -lh /root/backups/nuriel-shop/before-audit-seo-ssr/before-rollback.dump && echo "safe to roll back"
```

**R2.1 — הורדת #201 ואז #200:**

```bash
for f in $(ls /root/backups/nuriel-shop/before-audit-seo-ssr/rollbacks/*.down.sql | LC_ALL=C sort -r); do name=$(basename "$f" .down.sql).sql; applied=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT EXISTS (SELECT 1 FROM public._migrations_applied WHERE filename = '$name')"); [ "$applied" = "t" ] || continue; echo "=== rollback $name"; docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$f" || { echo "STOPPED at $name"; break; }; docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '$name'"; done; docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
```

**תקין:** שורות `=== rollback …hosp_seo_proposals.sql` ואז `=== rollback …order_guard.sql`, בלי `STOPPED`; `NOTIFY`.
**אם `STOPPED at …hosp_seo_proposals` עם "SEO proposals are saved"** — זו ההגנה: יש הצעות SEO שמורות והיא עצרה בלי לשנות כלום. לא עוקפים; מדווחים לי. (#201 ו-#200 אינן תלויות זו בזו ב-SQL, ולכן אפשר — רק באישור מפורש — להריץ ידנית את `order_guard.down.sql` לבדו ולהשאיר את #201.)

**R2.2 — בדיקה (🔍):**

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied), to_regclass('public.coupon_grants') IS NULL, to_regclass('hospitality.seo_proposals') IS NULL, (SELECT left(md5(representative_signature::text), 8) FROM hospitality.business_terms bt JOIN public.tenants t ON t.id = bt.tenant_id WHERE t.slug = 'nofi-dorit')"
```

**תקין:** `199|t|t|c109ee16` (חזרנו ל-199, הטבלאות החדשות לא קיימות, חתימת נופי דורית לא השתנתה).

### R3 — חזרה מהגיבוי המלא (קיצון — **רק באישור מפורש, אחרי עצירת האפליקציה**)

שחזור `db.dump` על המסד החי הוא פעולה הרסנית (דורס כל מה שנוצר מאז הגיבוי). מבצעים רק אם R1+R2 לא הספיקו, לפי תרגיל השחזור במדריך ההתקנה, ורק אחרי שמירת `before-rollback.dump` (R2.0). לא מריצים בלי ששלחתם לי את הפלט ואישרתי.

---

## Docker image — מה נבדק ומה לא

- **נבנה ורץ מקומית** מהעץ המשולב (388MB; ה-`Dockerfile` ללא שינוי): `/healthz` 200 ו-`/readyz` 503 כשהמסד מת (והבדיקה הישנה `/robots.txt` מחזירה 500 — כלומר הישנה הייתה מורידה את הקונטיינר), `/readyz` 200 כשהמסד חי, וה-HTML של חנות עם H1, מוצרים ומחירים.
- **לא נבדק:** `docker compose build` על השרת עם ה-`.env` האמיתי; ערכי `VITE_*` אמיתיים (נבדקו ערכי דמה ציבוריים); nginx/SSL של הייצור.
- **תגים:** `latest` (חדש) · `before-audit-seo-ssr` (הקודם, = `eccd001`) · התגים הישנים נשארים. **לא מריצים `docker image prune`/`docker system prune` במהלך הפריסה.**
- **רשת בסביבת הפיתוח:** ה-sandbox מעביר HTTPS דרך proxy עם CA משלו, ולכן `bun install` בתוך build נכשל שם על `SELF_SIGNED_CERT_IN_CHAIN` — **זו מגבלה של הסביבה ההיא, לא של הקוד או ה-lockfile**; בשרת האמיתי אין proxy כזה.

---

## כל הפקודות לפי סדר הביצוע

| # | סוג | מה | תקין |
| --- | --- | --- | --- |
| P1 | 🔍 | ענף/קומיט, fast-forward | `eccd001`, `0`, `fast-forward possible` |
| P2 | 🔍 | Docker | הכול `Up`, אפליקציה `healthy` |
| P3 | 🔍 | מיגרציות | `199`, שתי ממתינות, `0` |
| P4 | 🔍 | דיסק | ≥ 5G פנוי |
| P5 | 🔍 | משתני סביבה | חמשת החדשים `missing` (או לדווח) |
| P6 | 🔍 | 777 חוזר | `777/777` |
| P7 | 🔍 | תמונת מצב (נופי דורית + ספירות) | `c109ee16`, `revision 3`, מסמך 1002 |
| ⛔ 1 | | | |
| B1 | ✏️ גיבוי | מסד + תג `before-audit-seo-ssr` + image-id | `dump read to the end: ok`, `199` |
| B2 | ✏️ גיבוי | קובצי תצורה | 9 קבצים |
| B3 | ✏️ מסד נפרד | בדיקת שחזור | שתי שורות זהות |
| S1 | ✏️ קבצים | הקוד ← `<REL>` + rollbacks | `2` |
| S2 | 🔍 | בדיקה יבשה | שתי ממתינות |
| S3 | ✏️ image | בנייה | `Built`, `latest` ב-ID חדש |
| ⛔ 2 | | | **M1 ← M2 ← A1 ברצף** |
| M1 | ✏️ מסד | #200 + בדיקות | `t|t|t|t|t|200` |
| M2 | ✏️ מסד | #201 + בדיקות + NOTIFY | `t|t|t|t|t|201` |
| A1 | ✏️ הפעלה | `compose up -d` + בריאות | `healthy`, `healthz 200`, `readyz 200` |
| A2 | 🔍 | לוג | `0` שגיאות `[storefront-seed]` |
| SM1–SM6 | 🔍/✋ | בדיקות עשן | ראו שלב 6 |

## תנאי עצירה (כל אחד = להפסיק ולדווח)

P3 לא `199`+2 ממתינות · P6 מציג סטייה · P5 — משתנה חדש `set` שלא דובר · B1/B3 נכשלו · M1/M2 `STOPPED` או `checks` לא `ok` · `/readyz` ≠ 200 אחרי A1 · אתר ≥ 500 · **חנות מציגה מוצר של חנות אחרת** · קופה של לקוח לגיטימי נכשלת · **שינוי בחתימה/ב-`fingerprint`/ב-`revision`/במסמך החתום של נופי דורית** · מישהו מבקש לדלג על שלב.

# פריסה לייצור: שחרור האבטחה (45–53) + מודול הרישיונות (54) — nuriel-shop

> **הקוד המאושר:** `7ec7a26` (ענף `hospitality/stage-2`, CI 124 ירוק). **אף פקודה כאן לא הורצה בשרת.**
> כל פקודה — שורה אחת, שמות מלאים (כמו בפריסות הקודמות: J + K, דף הנחיתה). מריצים לפי הסדר, ושולחים
> לי את הפלט אחרי כל שלב. שום פקודה לא מדפיסה סוד.
>
> 🔍 = קריאה בלבד · ✏️ = משנה משהו בשרת (כתוב בדיוק מה) · ⛔ = נקודת אישור שלך — לא ממשיכים בלעדיה.
>
> **מצב השרת לפני** (מסמך הפריסה האחרון, 3 בנובמבר): הקוד על `f2e8bf7`, 160 מיגרציות רשומות,
> אין ממתינות, תגי חזרה `before-landing` ו-`before-jk`. שלב 1 מאמת את זה — אחרת עוצרים.
>
> **מצב השרת אחרי:** הקוד על `7ec7a26`, 170 מיגרציות, תג חזרה חדש `before-sec-lic`,
> `LICENSE_KEYS_SECRET` ב-`.env`, והפיילוט פעיל לחנות אחת בלבד — נוריאל מחשבים.
>
> **נבדק מראש (בלי השרת):** כל פקודות ה-SQL וה-git כאן הורצו מילה במילה (רק שמות הקונטיינר
> והתיקיות הוחלפו) על עותק מקומי של Supabase במצב של השרת — 160 מיגרציות, טבלת
> `_migrations_applied`, חנות `nuriel-shop` — כולל ה-Rollback וחזרה קדימה. לא נבדקו מקומית:
> הבנייה (`docker compose build`), ההפעלה, והבדיקות מול הכתובות האמיתיות.

## מה נכנס

| קומיט                | מה                                               | בשרת                                |
| -------------------- | ------------------------------------------------ | ----------------------------------- |
| `92bf062`, `249b80f` | תיעוד                                            | —                                   |
| `b3dfce7`, `84b1393` | קובצי בדיקה                                      | —                                   |
| `5ea24e3`            | דף הנחיתה: הסנכרון עם Airbnb / Booking.com מוסתר | אפליקציה                            |
| `19ab7e8`, `657dbd0` | שחרור האבטחה (C1, H1–H6, M1–M5, P3, פרטיות)      | אפליקציה + מיגרציות 45–53           |
| `7ec7a26`            | מודול שליחת רישיון דיגיטלי (פיילוט)              | אפליקציה + מיגרציה 54 + משתנה סביבה |

**10 מיגרציות** — כל אחת עטופה ב-`BEGIN` / `COMMIT` (או כולה, או כלום):

| #   | קובץ                                              | מה משתנה בנתונים קיימים                                              |
| --- | ------------------------------------------------- | -------------------------------------------------------------------- |
| 45  | `20261106120000_hosp_sec_c1_guest_claim.sql`      | — (פונקציות בלבד)                                                    |
| 46  | `20261106130000_sec_h1_trusted_account.sql`       | חשבונות קיימים בלי סיסמה או עם תפקיד מסומנים "מאומתים" (S2 מציג כמה) |
| 47  | `20261106140000_sec_h4_bucket_mime.sql`           | רשימת סוגי קבצים מותרים לשני דליי התמונות (קבצים קיימים לא נוגעים)   |
| 48  | `20261106150000_sec_h5_double_opt_in.sql`         | עמודות חדשות; **מנויים קיימים נשארים מנויים**                        |
| 49  | `20261106160000_sec_m3_online_hold_guard.sql`     | —                                                                    |
| 50  | `20261106170000_sec_m5_keep_platform_records.sql` | עמודה חדשה, שני מפתחות זרים מוסרים                                   |
| 51  | `20261106180000_sec_p3_low_findings.sql`          | — (הרשאות / מדיניות)                                                 |
| 52  | `20261106190000_sec_p3_helpers_quote_email.sql`   | — (הרשאות / טריגר)                                                   |
| 53  | `20261106200000_sec_prv_guest_privacy.sql`        | קישורי ניהול נמחקים ממיילי אורחים שכבר נשלחו (S2 מציג כמה)           |
| 54  | `20261107100000_lic_digital_licenses.sql`         | 4 טבלאות חדשות, דלי פרטי, דגל — **בלי אף חנות**                      |

## סדר ותלויות — למה בסדר הזה

- **54 לא תלויה ב-45–53 במסד** — רק ב-`tenants`, `auth.users`, `current_tenant_id()`, טבלאות הדגלים
  ו-`storage.buckets`, שקיימים בשרת מזמן. **התלות היא באפליקציה:** הקוד של `7ec7a26` צריך את כל העשר.
  לכן: 45–53 ← בדיקות ← 54 ← בדיקות ← הפעלת הגרסה החדשה. L2 מוודאת אוטומטית ש-45–53 רשומות לפני 54.
- **משיכת הקוד והבנייה — כבר בשלב 3** (לפני המיגרציות): קובצי המיגרציות נמצאים רק בקומיט החדש, והבנייה
  מראש (האתר ממשיך לרוץ) מקצרת את החלון שבו הגרסה הישנה רצה מול מסד חדש.
- **החלון בין S4 ל-L2:** הגרסה הישנה מול 45–53 — עלולים להיכשל: אישור הרשמה לדיוור, קוד קופון באתר
  אירוח, "שכחתי סיסמה", שיוך הזמנה לאורח, ושמות צוות בחלק ממסכי הניהול. לכן **S4 ← L1 ← L2 ברצף**,
  בלי הפסקה (דקה–שתיים), בשעה שקטה. אם S4 נעצרת — לא ממשיכים ל-L2 (שלב 7 מסביר מה עושים).
- **לא מריצים `deploy/setup-selfhost.sh`:** הוא כותב את `.env` מחדש ומוחק משתנים שהוא לא מכיר.

---

## שלב 1 — בדיקות מקדימות (🔍 קריאה בלבד)

### P1 — הענף והקומיט

```bash
cd /root/nuriel-shop-git && git branch --show-current && git log --oneline -1 && git status --short --untracked-files=no | wc -l && git fetch origin "+refs/heads/hospitality/stage-2:refs/remotes/origin/hospitality/stage-2" && git merge-base --is-ancestor HEAD 7ec7a26 && echo "fast-forward possible" && git merge-base --is-ancestor 7ec7a26 origin/hospitality/stage-2 && echo "7ec7a26 is on origin" && git log --oneline -1 7ec7a26
```

**תקין:**

- `hospitality/stage-2`.
- `f2e8bf7 Landing page: a prominent signup button …`.
- `0` — אין שינויים מקומיים בקבצים של git.
- (שורות ה-fetch — מורידות רק את רשימת הקומיטים, שום קובץ לא משתנה. יכול להופיע שם קומיט מאוחר יותר —
  תיעוד בלבד; המיזוג ב-S1 נעוץ ב-`7ec7a26`.)
- `fast-forward possible`, `7ec7a26 is on origin`.
- `7ec7a26 Digital license sending module — pilot for one store (Office / Windows)`.

**אחרת — עוצרים.**

### P2 — Docker והקונטיינרים

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | grep '^nuriel-shop-' && docker images nuriel-shop-app-app --format '{{.Tag}}\t{{.CreatedSince}}\t{{.Size}}' && cd /root/nuriel-shop-git && docker compose ps
```

**תקין:**

- הקונטיינרים של nuriel-shop ב-`Up` (במדריך ההתקנה: 9 — db, meta, studio, kong, auth, rest, storage,
  imgproxy ו-app). ליד `nuriel-shop-app`: `(healthy)`.
- התגים: `latest`, `before-landing`, `before-jk` (ואולי ישנים יותר). את עמודת הגודל צריך ל-P4.
- ב-`docker compose ps`: השירות `app` — `Up … (healthy)`.

### P3 — המיגרציות בשרת מול הקוד החדש

```bash
cd /root/nuriel-shop-git && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied" && LC_ALL=C comm -23 <(git ls-tree --name-only 7ec7a26 supabase/migrations/ | xargs -n1 basename | LC_ALL=C sort) <(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort) && LC_ALL=C comm -13 <(git ls-tree --name-only 7ec7a26 supabase/migrations/ | xargs -n1 basename | LC_ALL=C sort) <(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort) | wc -l
```

**תקין:** `160`; עשר שורות בדיוק — 9 הקבצים `20261106…` (45–53) ו-`20261107100000_lic_digital_licenses.sql`;
ואז `0` (אין בשרת מיגרציה שלא בקוד). **אחרת — עוצרים.**

### P4 — מקום פנוי בדיסק

```bash
df -h / /var/lib/docker /root/backups/nuriel-shop && docker system df
```

**תקין:** בעמודה `Avail` של המחיצה של `/var/lib/docker` — לפחות 5G (הבנייה מורידה תלויות ויוצרת image חדש;
5G הוא מרווח זהיר, לא מדידה). בגיבוי צריך עוד כמה MB בלבד. פחות מזה — עוצרים.

### P5 — משתני הסביבה (שמות בלבד, בלי ערכים)

```bash
cd /root/nuriel-shop-git && ls -l .env docker-compose.override.yml /root/nuriel-shop-supabase/docker/.env /root/nuriel-shop-supabase/docker/docker-compose.yml && for v in SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY RESEND_API_KEY EMAIL_FROM_ADDRESS PUBLIC_SITE_URL TENANT_BASE_DOMAIN PLATFORM_ADMIN_HOST HOSPITALITY_ENGINE HOSPITALITY_SECRET LOGIN_CODE_SECRET LICENSE_KEYS_SECRET; do if grep -q "^$v=." .env; then echo "$v: set"; elif grep -q "^$v=" .env; then echo "$v: EMPTY"; else echo "$v: missing"; fi; done && docker exec nuriel-shop-app printenv | cut -d= -f1 | sort | tr '\n' ' '
```

**תקין:**

- ארבעת הקבצים קיימים (`.env` — `-rw-------`).
- `set` ליד: שלושת `SUPABASE_*`, `RESEND_API_KEY` (**חובה** — בלעדיו אף מייל לא יוצא), `PUBLIC_SITE_URL`,
  `TENANT_BASE_DOMAIN`, `PLATFORM_ADMIN_HOST`, `HOSPITALITY_ENGINE`, `HOSPITALITY_SECRET`.
- `EMAIL_FROM_ADDRESS` — `set` או `EMPTY` (ריק = `orders@<הדומיין>`). `LOGIN_CODE_SECRET` — `set` או `missing`.
- `LICENSE_KEYS_SECRET: missing` — נוצר ב-L1.
- בסוף — שמות המשתנים שהאפליקציה רואה עכשיו (בלי ערכים).

**⛔ אישור 1 — רק אם כל שלב 1 תקין.** משלב 2 והלאה הפקודות כותבות בשרת.

---

## שלב 2 — גיבוי (✏️ כותב רק ל-`/root/backups/nuriel-shop/before-sec-lic`, ומוסיף תג ל-image; האתר לא מושפע)

### B1 — המסד, רשימת המיגרציות, גרסת האפליקציה ותג חזרה

```bash
mkdir -m 700 /root/backups/nuriel-shop/before-sec-lic && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-sec-lic/db.dump && docker exec -i nuriel-shop-db pg_restore --list < /root/backups/nuriel-shop/before-sec-lic/db.dump > /root/backups/nuriel-shop/before-sec-lic/db.toc && grep -c "TABLE DATA" /root/backups/nuriel-shop/before-sec-lic/db.toc && docker exec -i nuriel-shop-db pg_restore -f /dev/null < /root/backups/nuriel-shop/before-sec-lic/db.dump && echo "dump read to the end: ok" && ls -lh /root/backups/nuriel-shop/before-sec-lic/db.dump && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > /root/backups/nuriel-shop/before-sec-lic/applied-before.txt && wc -l < /root/backups/nuriel-shop/before-sec-lic/applied-before.txt && git -C /root/nuriel-shop-git log --oneline -1 | tee /root/backups/nuriel-shop/before-sec-lic/app-commit.txt && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-sec-lic && docker images nuriel-shop-app-app --format '{{.Tag}}'
```

**תקין:** מספר טבלאות בגיבוי (ב-3 בנובמבר: 147); `dump read to the end: ok`; גודל הקובץ (ב-3 בנובמבר: 2.9M);
`160`; `f2e8bf7 …`; התגים כוללים `before-sec-lic`.

### B2 — קובצי התצורה

```bash
cp -p /root/nuriel-shop-git/.env /root/backups/nuriel-shop/before-sec-lic/app.env && cp -p /root/nuriel-shop-git/docker-compose.override.yml /root/backups/nuriel-shop/before-sec-lic/app-compose.override.yml && cp -p /root/nuriel-shop-supabase/docker/.env /root/backups/nuriel-shop/before-sec-lic/supabase.env && cp -p /root/nuriel-shop-supabase/docker/docker-compose.yml /root/backups/nuriel-shop/before-sec-lic/supabase-compose.yml && chmod 600 /root/backups/nuriel-shop/before-sec-lic/app.env /root/backups/nuriel-shop/before-sec-lic/supabase.env && ls -l /root/backups/nuriel-shop/before-sec-lic
```

**תקין:** בתיקייה: `db.dump`, `db.toc`, `applied-before.txt`, `app-commit.txt`, `app.env`,
`app-compose.override.yml`, `supabase.env`, `supabase-compose.yml`. (Nginx, התעודות וקובצי האחסון לא משתנים
בפריסה הזו — לכן לא כאן.)

### B3 — הגיבוי ניתן לשחזור (✏️ מסד בדיקה נפרד `restore_check` — נוצר ונמחק; המסד החי לא נוגע)

```bash
docker exec nuriel-shop-db psql -U postgres -q -c "DROP DATABASE IF EXISTS restore_check" -c "CREATE DATABASE restore_check" && docker exec -i nuriel-shop-db pg_restore -U postgres -d restore_check --no-owner --no-privileges < /root/backups/nuriel-shop/before-sec-lic/db.dump > /dev/null 2>&1; docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public.tenants), (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.orders), (SELECT count(*) FROM public._migrations_applied)" && docker exec nuriel-shop-db psql -U postgres -d restore_check -tAc "SELECT (SELECT count(*) FROM public.tenants), (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.orders), (SELECT count(*) FROM public._migrations_applied)" && docker exec nuriel-shop-db psql -U postgres -q -c "DROP DATABASE restore_check" && echo "restore check: done"
```

**תקין:** (שורת `NOTICE: database "restore_check" does not exist, skipping` — רגילה) ואז שתי שורות **זהות**
(חנויות | משתמשים | הזמנות | 160) — הראשונה מהמסד החי, השנייה מהשחזור; ואז `restore check: done`. (שגיאות על אובייקטים פנימיים של Supabase בזמן השחזור צפויות ומוסתרות — כמו
בתרגיל השחזור במדריך ההתקנה §1.) שורות שונות — עוצרים.

---

## שלב 3 — שחרור האבטחה (מיגרציות 45–53)

### S1 — הקוד (✏️ קבצים ב-`/root/nuriel-shop-git` בלבד; האתר ממשיך לרוץ על הגרסה הקודמת)

```bash
cd /root/nuriel-shop-git && git merge -q --ff-only 7ec7a26 && git log --oneline -1 && mkdir -p /root/backups/nuriel-shop/before-sec-lic/rollbacks && cp supabase/rollbacks/20261106*.down.sql supabase/rollbacks/20261107100000_lic_digital_licenses.down.sql /root/backups/nuriel-shop/before-sec-lic/rollbacks/ && ls /root/backups/nuriel-shop/before-sec-lic/rollbacks | wc -l
```

**תקין:** `Updating f2e8bf7..7ec7a26`, `Fast-forward`, רשימת קבצים (128 קבצים); `7ec7a26 Digital license sending
module — …`; `10` — קובצי ה-Rollback של 45–54 ליד הגיבוי.

### S2 — בדיקה יבשה: מה ממתין ומה ישתנה (🔍; כותב רק את `files.txt` לתיקיית הגיבוי)

```bash
cd /root/nuriel-shop-git && ls supabase/migrations/*.sql | xargs -n1 basename | LC_ALL=C sort > /root/backups/nuriel-shop/before-sec-lic/files.txt && LC_ALL=C comm -23 /root/backups/nuriel-shop/before-sec-lic/files.txt /root/backups/nuriel-shop/before-sec-lic/applied-before.txt && docker exec nuriel-shop-db psql -U postgres -d postgres -c "SELECT (SELECT count(*) FROM auth.users u WHERE u.deleted_at IS NULL AND COALESCE(u.raw_app_meta_data ->> 'platform', '') <> 'true' AND (u.encrypted_password IS NULL OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id))) AS h1_marked_verified, (SELECT count(*) FROM auth.users u WHERE u.deleted_at IS NULL AND COALESCE(u.raw_app_meta_data ->> 'platform', '') <> 'true' AND u.encrypted_password IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id)) AS h1_left_unverified, (SELECT count(*) FROM public.marketing_consents WHERE subscribed) AS h5_subscribers_kept, (SELECT count(*) FROM hospitality.notifications n WHERE n.status IN ('sent', 'dead') AND (n.payload ? 'manage_token' OR (jsonb_typeof(n.payload -> 'rooms') = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(n.payload -> 'rooms') r WHERE r ? 'manage_token')))) AS prv17_links_removed"
```

**תקין:**

- עשר שורות — אותן עשר כמו ב-P3.
- שורת מספרים:
  - `h1_marked_verified` — חשבונות שיסומנו "מאומתים".
  - `h1_left_unverified` — חשבונות שנרשמו בטופס בלי תפקיד. נשארים לא מאומתים עד כניסה בקוד במייל. ב-3 בנובמבר היו 0.
  - `h5_subscribers_kept` — מנויי דיוור. כולם נשארים מנויים.
  - `prv17_links_removed` — מיילי אורחים שכבר נשלחו, שקישור הניהול יימחק מהעותק השמור שלהם.

### S3 — בנייה (✏️ image חדש; האתר ממשיך לרוץ על הישן)

```bash
cd /root/nuriel-shop-git && docker compose build
```

**תקין:** מסתיים בלי שגיאה, בשורות האחרונות `Built`. כמה דקות. שגיאה — עוצרים (האתר לא נפגע; הקוד כבר על
`7ec7a26`, וזה לא משפיע על מה שרץ).

**⛔ אישור 2 — מכאן משנים את המסד.** מריצים **S4 ← L1 ← L2 ברצף**, בשעה שקטה.

### S4 — מיגרציות 45–53 ובדיקות אוטומטיות (✏️ המסד)

כל מיגרציה בטרנזקציה משלה, ונרשמת רק אם הצליחה. שגיאה — הלולאה עוצרת (`STOPPED at …`), ובדיקות התקינות
לא מודפסות כ"ok". בסוף — שורת בדיקה אחת שמכסה את כל התשע.

```bash
cd /root/nuriel-shop-git && ( for f in 20261106120000_hosp_sec_c1_guest_claim 20261106130000_sec_h1_trusted_account 20261106140000_sec_h4_bucket_mime 20261106150000_sec_h5_double_opt_in 20261106160000_sec_m3_online_hold_guard 20261106170000_sec_m5_keep_platform_records 20261106180000_sec_p3_low_findings 20261106190000_sec_p3_helpers_quote_email 20261106200000_sec_prv_guest_privacy; do docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" || { echo "STOPPED at $f"; exit 1; }; done ) && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) = 9 FROM public._migrations_applied WHERE filename LIKE '20261106%'), (to_regprocedure('hospitality.claim_guest_bookings(text)') IS NOT NULL AND to_regprocedure('hospitality.claim_guest_bookings()') IS NULL), to_regprocedure('public._platform_account_id(text)') IS NOT NULL, (SELECT allowed_mime_types IS NOT NULL FROM storage.buckets WHERE id = 'product-images'), to_regprocedure('public.marketing_confirm(text,text,text)') IS NOT NULL, to_regprocedure('hospitality._online_hold_guard(uuid,uuid[],date,date)') IS NOT NULL, (NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_history_tenant_id_fkey') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'billing_history' AND column_name = 'store_label')), (NOT has_function_privilege('authenticated', 'public.resolve_login_email(text)', 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'password_reset_requests' AND policyname = 'anyone can request reset')), (NOT has_function_privilege('authenticated', 'public.product_serial_gap(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.can_pick(uuid)', 'EXECUTE') AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'user_roles_auth_email')), NOT EXISTS (SELECT 1 FROM hospitality.notifications n WHERE n.status IN ('sent', 'dead') AND n.payload ? 'manage_token')") && echo "$row" && [ "$row" = "t|t|t|t|t|t|t|t|t|t" ] && echo "45-53 checks ok"
```

**תקין:** תשע שורות `… ok` (45 עד 53, לפי הסדר; לפני `…helpers_quote_email ok` מופיעה שורת
`NOTICE: trigger "user_roles_auth_email" … does not exist, skipping` — רגילה); `t|t|t|t|t|t|t|t|t|t`
(רישום התשע ובדיקה לכל מיגרציה, לפי הסדר 45–53); `45-53 checks ok`.

**נעצר (`STOPPED at …`, או `f` בשורה, או בלי `checks ok`):** **לא ממשיכים ל-L1 / L2.** האתר עדיין רץ
על הגרסה הקודמת. שולחים לי את הפלט; אם צריך לחזור מיד — R2.0 ואז R2.1 בשלב 7 (בלי R2.2).

---

## שלב 4 — מודול הרישיונות (מיגרציה 54)

הקוד כבר על `7ec7a26` (S1) וה-image כבר נבנה (S3) — ההסבר ב"סדר ותלויות". נשאר: הסוד, 54, והפעלה.

### L1 — `LICENSE_KEYS_SECRET` (✏️ שורה אחת ב-`/root/nuriel-shop-git/.env`; האפליקציה תקרא אותה ב-L2)

```bash
cd /root/nuriel-shop-git && grep -q '^LICENSE_KEYS_SECRET=.' .env && echo "LICENSE_KEYS_SECRET already set - not changed" || { sed -i -e '/^LICENSE_KEYS_SECRET=$/d' -e '$a\' .env && printf 'LICENSE_KEYS_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env && echo "LICENSE_KEYS_SECRET created"; }; grep -c '^LICENSE_KEYS_SECRET=' .env && awk -F= '/^LICENSE_KEYS_SECRET=/ {print "length: " length($2)}' .env && grep -cF 'LICENSE_KEYS_SECRET: ${LICENSE_KEYS_SECRET:-}' docker-compose.yml && cp -p .env /root/backups/nuriel-shop/before-sec-lic/app.env.with-license-secret && chmod 600 /root/backups/nuriel-shop/before-sec-lic/app.env.with-license-secret && ls -l .env /root/backups/nuriel-shop/before-sec-lic/app.env.with-license-secret
```

**תקין:** `LICENSE_KEYS_SECRET created`; `1`; `length: 64`; `1` (docker-compose.yml מעביר אותו לקונטיינר —
המנגנון הקיים: רק משתנים שרשומים שם מגיעים לאפליקציה); שני הקבצים `-rw-------`.

- הסוד נוצר אקראית (256 ביט) **ולא מודפס**. הוא נשמר ב-`.env` — שם גם שאר הסודות, והוא נשאר בין פריסות.
- ה-`sed` מוחק שורה ריקה `LICENSE_KEYS_SECRET=` אם יש, ומוודא ש-`.env` מסתיים בירידת שורה — כדי שהשורה החדשה
  לא תידבק למשתנה האחרון בקובץ. שאר הקובץ לא משתנה.
- **אסור להחליף או למחוק אותו**: מפתחות רישיון שנשמרים מוצפנים בו. עותק מוצפן מחוץ לשרת — L4.

### L2 — בדיקת התלויות, מיגרציה 54, בדיקות, והפעלת הגרסה החדשה (✏️ המסד + הפעלה מחדש)

```bash
cd /root/nuriel-shop-git && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied WHERE filename LIKE '20261106%'" | grep -qx 9 && echo "dependencies ok: 45-53 applied" && grep -q '^LICENSE_KEYS_SECRET=.' .env && echo "secret ok" && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261107100000_lic_digital_licenses.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261107100000_lic_digital_licenses.sql')" && echo "54 ok" && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT enabled FROM public.platform_feature_flags WHERE key = 'digital_licenses'), (SELECT count(*) FROM public.tenant_feature_flags WHERE key = 'digital_licenses'), (SELECT public FROM storage.buckets WHERE id = 'license-files'), has_table_privilege('anon', 'public.license_deliveries', 'SELECT'), has_table_privilege('authenticated', 'public.license_deliveries', 'SELECT'), (SELECT bool_and(relrowsecurity) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('license_files', 'license_deliveries', 'license_download_links', 'license_audit')), (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "t|0|f|f|f|t|170" ] && echo "54 checks ok" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'" && docker compose up -d
```

**תקין:** `dependencies ok: 45-53 applied`; `secret ok`; שלוש שורות `NOTICE: trigger "license_…" … does not
exist, skipping` (רגילות — יצירה ראשונה); `54 ok`; `t|0|f|f|f|t|170` (הדגל קיים בפלטפורמה,
**0 חנויות**, הדלי פרטי, אין גישה ל-anon / authenticated, RLS בכל ארבע הטבלאות, 170 מיגרציות);
`54 checks ok`; `NOTIFY`; ואז שורות ה-compose (`Recreate` / `Started`).

**נעצר לפני ההפעלה:** האתר עדיין על הגרסה הקודמת — שולחים לי את הפלט (שלב 7, R2.0 + R2.1).

### L3 — בדיקות אחרי ההפעלה (🔍; מחכה דקה — זה לא תקוע)

```bash
cd /root/nuriel-shop-git && sleep 60 && docker compose ps && curl -s -o /dev/null -w 'robots: %{http_code}\n' http://127.0.0.1:3700/robots.txt && docker exec nuriel-shop-app sh -c 'echo "LICENSE_KEYS_SECRET length in the app: ${#LICENSE_KEYS_SECRET}"' && docker exec nuriel-shop-app printenv HOSPITALITY_ENGINE && curl -s -X POST https://nuriel-shop.nuri1.fit/api/license-download/check -H 'Content-Type: application/json' -d '{"token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}' && echo && curl -sI https://nuriel-shop.nuri1.fit/ | grep -ciE '^(strict-transport-security|x-content-type-options|x-frame-options|content-security-policy|referrer-policy):' && curl -s https://nuriel-app2.nuri1.fit/ | grep -oi 'airbnb' | wc -l && docker logs --since 3m nuriel-shop-app 2>&1 | grep -iE "error|fatal" | tail -20
```

**תקין:**

- `app` — `Up … (healthy)`; `robots: 200`.
- `LICENSE_KEYS_SECRET length in the app: 64` — הסוד הגיע לקונטיינר (בלי להדפיס אותו).
- `on`.
- `{"state":"not_found"}` — נקודת הקצה של ההורדה עונה, ולא מגלה כלום (הפיילוט עוד כבוי בכל החנויות).
- `5` או יותר — כותרות האבטחה (M1).
- `0` — דף הנחיתה בלי Airbnb.
- לוג ריק. שורות `aborted` (דפדפן שסגר בקשה באמצע) — לא בעיה. כל שגיאה אחרת — שולחים לי.

### L4 — עותק מוצפן של הגיבוי והסודות, מחוץ לשרת (✏️ קובץ מוצפן אחד)

`openssl` מבקש סיסמה **חדשה** (פעמיים) — רק לקובץ הזה; שומרים אותה במנהל סיסמאות. ואז שוב, לבדיקה.

```bash
tar -C /root/backups/nuriel-shop -cf - before-sec-lic | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -out /root/backups/nuriel-shop/before-sec-lic.tar.enc && ls -lh /root/backups/nuriel-shop/before-sec-lic.tar.enc && openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in /root/backups/nuriel-shop/before-sec-lic.tar.enc | tar -tf - | grep -c 'app.env.with-license-secret'
```

**תקין:** גודל הקובץ (כ-3.5M); `1` — הסוד בתוך העותק המוצפן. אחר כך, **מהמחשב שלך** (לא בשרת):
`scp root@<כתובת השרת>:/root/backups/nuriel-shop/before-sec-lic.tar.enc .` — ושומרים את הקובץ מחוץ לשרת.
(מומלץ גם להתקין את הגיבוי היומי המוצפן — מדריך ההתקנה §1, "הגיבוי היומי". הוא כולל את `.env` ואת הדלי
הפרטי החדש אוטומטית.)

---

## שלב 5 — הפעלת הפיילוט (נוריאל מחשבים בלבד)

### T1 — זיהוי החנות (🔍)

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -c "SELECT t.id, t.slug, t.name, t.domain, t.custom_domain, t.is_default, s.business_name, (SELECT count(*) FROM public.user_roles r WHERE r.tenant_id = t.id AND r.role = 'admin') AS admins FROM public.tenants t LEFT JOIN public.site_settings s ON s.tenant_id = t.id WHERE t.id = public.tenant_for_host('nuriel-shop.nuri1.fit')" -c "SELECT t.slug, t.name, t.site_type, t.is_default FROM public.tenants t ORDER BY t.created_at"
```

**תקין:** בטבלה הראשונה **שורה אחת**:

- `slug` צפוי להיות `nuriel-shop`.
- השם ו-`business_name` — של נוריאל מחשבים.
- `admins` — 1 לפחות.

השאילתה מוצאת את החנות דרך `tenant_for_host` — אותה פונקציה שהאפליקציה משתמשת בה לכתובת הזו.
הטבלה השנייה — כל החנויות, להשוואה. רק הראשונה תקבל את הפיילוט.

**⛔ אישור 3:** רק אם השורה היא בוודאות נוריאל מחשבים. לא בטוח (למשל `is_default = t` עם slug אחר) — עוצרים
ושולחים לי.

### T2 — הפעלה, עם הגנה (✏️ שורה אחת ב-`tenant_feature_flags`)

מחליפים את `PASTE-THE-ID-FROM-T1` ב-id מ-T1. הפקודה בודקת שוב שה-id הוא החנות של `nuriel-shop.nuri1.fit` ושאין חנות אחרת
עם הפיילוט — אחרת עוצרת ולא משנה כלום.

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DO \$\$ DECLARE _id uuid := 'PASTE-THE-ID-FROM-T1'; BEGIN IF _id IS DISTINCT FROM public.tenant_for_host('nuriel-shop.nuri1.fit') THEN RAISE EXCEPTION 'not the store of nuriel-shop.nuri1.fit - nothing was changed'; END IF; IF EXISTS (SELECT 1 FROM public.tenant_feature_flags WHERE key = 'digital_licenses' AND enabled AND tenant_id <> _id) THEN RAISE EXCEPTION 'another store already has the pilot - nothing was changed'; END IF; INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES (_id, 'digital_licenses', true) ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true; END \$\$;" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "SELECT t.slug, t.name, f.enabled, public.platform_feature_enabled('digital_licenses', t.id) AS effective FROM public.tenant_feature_flags f JOIN public.tenants t ON t.id = f.tenant_id WHERE f.key = 'digital_licenses'" -c "SELECT count(*) AS stores_with_pilot FROM public.tenants t WHERE public.platform_feature_enabled('digital_licenses', t.id)"
```

**תקין:** `DO`; שורה אחת — `nuriel-shop | <השם> | t | t`; `stores_with_pilot = 1`. השרת מתעדכן תוך 15 שניות.

---

## שלב 6 — בדיקות אחרי הפריסה

### V1 — הממשק (בדפדפן)

- `https://nuriel-shop.nuri1.fit/admin?tab=email` (כניסה כבעל החנות) — הכרטיס **"שליחת רישיון דיגיטלי ללקוח"** ראשון בעמוד,
  **בלי** ההודעה הצהובה על `LICENSE_KEYS_SECRET`.
- חנות אחרת שאתה מנהל — באותו מסך **אין** כרטיס. (T2 כבר הראה: חנות אחת בלבד.)

### V2 — העלאת הקבצים (בדפדפן, ואז 🔍)

בכרטיס ← "קבצי ברירת מחדל" ← Office: מדריך ההתקנה (PDF) ו-`NurielOfficeInstaller.exe` — שניהם "ברירת מחדל".

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -c "SELECT f.product, f.kind, f.file_name, f.size_bytes, f.is_default FROM public.license_files f WHERE f.archived_at IS NULL ORDER BY f.created_at" -c "SELECT count(*) AS objects FROM storage.objects WHERE bucket_id = 'license-files'"
```

**תקין:** שתי שורות `office | guide | … | t` ו-`office | installer | NurielOfficeInstaller.exe | … | t`; `objects = 2`.
(אם אלה אותם קבצים ששלחת לי: `755191` ו-`7870976` בתים.)

### V3 — שליחת מייל בדיקה (בדפדפן; ⛔ אישור 4 — יוצא מייל אמיתי)

- לכתובת **שלך**, עם מפתח בדיקה בפורמט תקין ולא אמיתי: `BCDFG-HJKMN-PQRTV-WXY23-46789`.
- תצוגה מקדימה ← "שליחת הרישיון ללקוח".
- **תקין:** הכרטיס מראה "התקבל לשליחה", ותוך דקה בערך "נמסר". במייל: המפתח, ההודעה, המדריך מצורף,
  וכפתור ההורדה.
- השליחה נשארת בהיסטוריה (מוצפנת).

### V4 — קישור ההורדה (במחשב Windows)

- כפתור ההורדה במייל ← העמוד מציג את שם הקובץ ו-"3 מתוך 3" ← הורדה ← "2 מתוך 3".
- בדיקת הקובץ: `certutil -hashfile NurielOfficeInstaller.exe SHA256`
  ← `e49ce516f560f099ec46a06edbaa9f2f420ad6a1a772d393702768c4edf406bd` (אם הועלה הקובץ ששלחת לי).

### V5 — מגבלת 3 הורדות (בדפדפן, ואז 🔍)

עוד שתי הורדות מאותו עמוד ← "נוצלו כל ההורדות של הקישור".

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -c "SELECT l.download_count, l.max_downloads, l.expires_at - l.created_at AS valid_for, l.revoked_at IS NOT NULL AS revoked FROM public.license_download_links l ORDER BY l.created_at DESC LIMIT 1" -c "SELECT action, count(*) FROM public.license_audit GROUP BY action ORDER BY action"
```

**תקין:** `3 | 3 | 7 days | f`; ביומן: `download 3`, `file_uploaded 2`, `link_created 1`, `send 1`
(ואולי `status_refreshed`).

### V6 — מגבלת 7 הימים

- **בלי לשנות כלום:** `valid_for = 7 days` ב-V5. האכיפה עצמה נבדקה בבדיקות האוטומטיות.
- **לא חובה (⛔ אישור 5; ✏️ רק קישור הבדיקה שלך):** מקדמים את קישור הבדיקה 8 ימים, ואז פותחים אותו שוב ←
  "תוקף הקישור הסתיים". מחליפים את `YOUR-EMAIL` בכתובת שאליה נשלח מייל הבדיקה (באותיות קטנות).

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -c "UPDATE public.license_download_links SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = (SELECT l.id FROM public.license_download_links l JOIN public.license_deliveries d ON d.id = l.delivery_id WHERE d.customer_email = 'YOUR-EMAIL' ORDER BY l.created_at DESC LIMIT 1) RETURNING download_count, expires_at < now() AS expired"
```

**תקין:** `UPDATE 1`, `expired = t`.

### V7 — הרשאות ובידוד (🔍)

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT has_table_privilege('anon', 'public.license_deliveries', 'SELECT'), has_table_privilege('authenticated', 'public.license_deliveries', 'SELECT'), has_table_privilege('authenticated', 'public.license_download_links', 'SELECT'), has_function_privilege('anon', 'public.license_link_peek(text)', 'EXECUTE'), has_function_privilege('authenticated', 'public.license_consume_download(text)', 'EXECUTE'), (SELECT public FROM storage.buckets WHERE id = 'license-files'), (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'license%'), (SELECT count(DISTINCT tenant_id) FROM public.license_deliveries)" && cd /root/nuriel-shop-git && U=$(grep '^SUPABASE_URL=' .env | cut -d= -f2-) && K=$(grep '^SUPABASE_PUBLISHABLE_KEY=' .env | cut -d= -f2-) && P=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT storage_path FROM public.license_files ORDER BY created_at LIMIT 1") && curl -s -o /dev/null -w 'public URL: %{http_code}\n' "$U/storage/v1/object/public/license-files/$P" && curl -s -o /dev/null -w 'with the anon key: %{http_code}\n' -H "apikey: $K" -H "Authorization: Bearer $K" "$U/storage/v1/object/license-files/$P"
```

**תקין:** `f|f|f|f|f|f|0|1` (אין גישה לגולש / למשתמש מחובר, הדלי פרטי, אין מדיניות פתוחה, רק חנות אחת);
`public URL: 400`; `with the anon key: 400` — **לא 200**. (המפתח הציבורי נקרא מ-`.env` ולא מודפס.)

**בין חנויות — עם קישור הבדיקה:** מחליפים את `PASTE-TOKEN` בחלק שאחרי `#` בקישור מהמייל.

```bash
curl -s -X POST https://nuriel-shop.nuri1.fit/api/license-download/check -H 'Content-Type: application/json' -d '{"token":"PASTE-TOKEN"}' && echo && curl -s -X POST https://nuriel-app2.nuri1.fit/api/license-download/check -H 'Content-Type: application/json' -d '{"token":"PASTE-TOKEN"}' && echo
```

**תקין:** בנוריאל מחשבים — `"state":"exhausted"` (או `expired` אחרי V6); באתר אחר (השער) — `{"state":"not_found"}`.

**הרשאות צוות (לא חובה):** משתמש צוות שאינו מנהל (קופאי / מחסן) — באותו מסך אין כרטיס.

### V8 — הלוגים: אין רישיונות ואין Tokens (🔍)

```bash
docker logs --since 6h nuriel-shop-app 2>&1 | grep -cE '[A-Z0-9]{5}(-[A-Z0-9]{5}){4}'; docker logs --since 6h nuriel-shop-app 2>&1 | grep -cE 'license-download#|v1:[A-Za-z0-9+/]{40,}'; docker logs --since 6h nuriel-shop-app 2>&1 | grep -cF 'PASTE-TOKEN'; grep -hF 'PASTE-TOKEN' /var/log/nginx/*access*.log 2>/dev/null | wc -l; grep -h 'license-download' /var/log/nginx/*access*.log 2>/dev/null | tail -3
```

**תקין:**

- `0`, `0`, `0`, `0`.
- בסוף — עד 3 שורות של `/license-download` ו-`/api/license-download/…`, **בלי** ה-Token. הוא אחרי `#`, והדפדפן
  לא שולח אותו לשרת. ההורדה עצמה נשלחת ב-POST.
- אם אין אף שורה בכלל, הלוג של Nginx כנראה במקום אחר. שולחים לי את הפלט של `nginx -T 2>/dev/null | grep access_log`.

---

## שלב 7 — Rollback (רק אם צריך; ⛔ אישור לפני כל פעולה)

**שום נתון לא אובד:** R1 לא מוחק כלום. R2 שומר קודם גיבוי מלא של המצב הנוכחי (R2.0), ורק אחר כך מוריד את 45–53.
נתוני הרישיונות ו-`LICENSE_KEYS_SECRET` לא נוגעים בשום שלב.

### R1 — כיבוי המודול בלבד (✏️ שורה אחת; הכי מהיר; לכל תקלה במודול)

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -c "UPDATE public.tenant_feature_flags SET enabled = false WHERE key = 'digital_licenses'" -c "SELECT count(*) AS stores_with_pilot FROM public.tenants t WHERE public.platform_feature_enabled('digital_licenses', t.id)"
```

**תקין:** `UPDATE 1`; `stores_with_pilot = 0`. תוך 15 שניות הכרטיס נעלם וקישורי ההורדה מפסיקים לעבוד.
השליחות, הקבצים, היומן והסוד נשארים. החזרה — שוב T2.

### R2 — חזרה לגרסה הקודמת כולה (`f2e8bf7`) — רק אם הגרסה החדשה עצמה בעייתית

הגרסה הקודמת לא עובדת נכון מול 45–53 (ראו "סדר ותלויות"), לכן קודם המסד (45–53 בלבד), ואחר כך האפליקציה —
כמו בחזרה של J + K. **54 נשארת:** הטבלאות שלה לא מפריעות לגרסה הקודמת, והנתונים והסוד נשמרים.

**R2.0 — בדיקה וגיבוי של המצב הנוכחי (✏️ רק קובץ גיבוי חדש; המסד לא משתנה):**

R2.1 מוריד את מה ש-45–53 הוסיפו. רובו פונקציות, הרשאות ומדיניות, אבל שתי תוספות מכילות נתונים:

- 48: עמודות האישור הכפול לדיוור — מועד אישור, IP מגובב, דפדפן ושיטה — של מי שנרשם אחרי הפריסה.
- 50: העמודה `store_label` בהיסטוריית החיובים.

לכן קודם גיבוי מלא, `before-rollback.dump` — ממנו אפשר לשחזר כל דבר.

```bash
n=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public.billing_history b WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = b.tenant_id)) + (SELECT count(*) FROM public.platform_audit_log a WHERE a.tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = a.tenant_id))") && echo "orphan rows: $n" && [ "$n" = "0" ] && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-sec-lic/before-rollback.dump && docker exec -i nuriel-shop-db pg_restore -f /dev/null < /root/backups/nuriel-shop/before-sec-lic/before-rollback.dump && ls -lh /root/backups/nuriel-shop/before-sec-lic/before-rollback.dump && echo "safe to roll back"
```

**תקין:** `orphan rows: 0`, גודל הקובץ, ו-`safe to roll back`.

**`orphan rows` גדול מ-0 — הפקודה עוצרת לבד, בלי גיבוי.** פירוש: חנות נמחקה אחרי הפריסה, וה-Rollback של 50
היה מוחק את רשומות החיוב והיומן שלה. לא ממשיכים ל-R2.1 — שולחים לי.

**R2.1 — המסד: 53 ← 45 (✏️; רק מה שרשום — מתאים גם לעצירה באמצע S4):**

```bash
for f in $(ls /root/backups/nuriel-shop/before-sec-lic/rollbacks/20261106*.down.sql | LC_ALL=C sort -r); do name=$(basename "$f" .down.sql).sql; applied=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT EXISTS (SELECT 1 FROM public._migrations_applied WHERE filename = '$name')"); [ "$applied" = "t" ] || continue; echo "=== rollback $name"; docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$f" || { echo "STOPPED at $name"; break; }; docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '$name'"; done; docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
```

**תקין:** תשע שורות `=== rollback …` מ-`20261106200000…` עד `20261106120000…`, בלי `STOPPED` (שורות
`NOTICE: … does not exist, skipping` באמצע — רגילות); `NOTIFY`.

**R2.2 — האפליקציה (✏️; רק אם הגרסה החדשה כבר הופעלה ב-L2):**

```bash
docker tag nuriel-shop-app-app:before-sec-lic nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && docker compose up -d && sleep 60 && docker compose ps && curl -s -o /dev/null -w 'robots: %{http_code}\n' http://127.0.0.1:3700/robots.txt
```

**תקין:** שורות ה-compose; `Up … (healthy)`; `robots: 200`. ה-image של `f2e8bf7` עולה מיד, בלי בנייה.
התיקייה נשארת על `7ec7a26` (כמו בחזרות הקודמות). לבנייה מחדש של הגרסה הקודמת — `git -C /root/nuriel-shop-git checkout f2e8bf7`,
רק אם צריך.

**R2.3 — בדיקה (🔍):**

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied), (SELECT count(*) FROM public._migrations_applied WHERE filename LIKE '20261106%'), to_regclass('public.license_deliveries') IS NOT NULL, (SELECT count(*) FROM public.license_deliveries)" && grep -c '^LICENSE_KEYS_SECRET=.' /root/nuriel-shop-git/.env
```

**תקין:** `161|0|t|<מספר השליחות>` (160 + 54 — הנתונים נשמרו); `1` — הסוד נשאר.

---

## כל הפקודות לפי סדר הביצוע

| #       | סוג               | מה                        | תקין                                                       |
| ------- | ----------------- | ------------------------- | ---------------------------------------------------------- |
| P1      | 🔍                | הענף והקומיט              | `f2e8bf7`, `fast-forward possible`, `7ec7a26 is on origin` |
| P2      | 🔍                | Docker                    | הכול `Up`, האפליקציה `healthy`                             |
| P3      | 🔍                | מיגרציות                  | `160`, 10 ממתינות, `0`                                     |
| P4      | 🔍                | דיסק                      | לפחות 5G פנוי                                              |
| P5      | 🔍                | משתני סביבה               | `RESEND_API_KEY: set`, `LICENSE_KEYS_SECRET: missing`      |
| ⛔ 1    |                   |                           |                                                            |
| B1      | ✏️ גיבוי          | מסד + תג `before-sec-lic` | `dump read to the end: ok`, `160`                          |
| B2      | ✏️ גיבוי          | קובצי תצורה               | 8 קבצים                                                    |
| B3      | ✏️ מסד נפרד       | בדיקת שחזור               | שתי שורות זהות                                             |
| S1      | ✏️ קבצים          | הקוד ← `7ec7a26`          | `Fast-forward`, `10`                                       |
| S2      | 🔍                | בדיקה יבשה                | 10 ממתינות + השפעה                                         |
| S3      | ✏️ image          | בנייה                     | `Built`                                                    |
| ⛔ 2    |                   |                           | **S4 ← L1 ← L2 ברצף**                                      |
| S4      | ✏️ מסד            | 45–53 + בדיקות            | `45-53 checks ok`                                          |
| L1      | ✏️ `.env`         | הסוד                      | `length: 64`                                               |
| L2      | ✏️ מסד + הפעלה    | 54 + בדיקות + הפעלה       | `54 checks ok`, `Started`                                  |
| L3      | 🔍                | אחרי ההפעלה               | `healthy`, `64`, `not_found`, `0`                          |
| L4      | ✏️ קובץ מוצפן     | עותק מחוץ לשרת            | `1`                                                        |
| T1      | 🔍                | זיהוי החנות               | שורה אחת — נוריאל מחשבים                                   |
| ⛔ 3    |                   |                           |                                                            |
| T2      | ✏️ מסד            | הפעלת הפיילוט             | `stores_with_pilot = 1`                                    |
| V1–V2   | דפדפן + 🔍        | המודול והקבצים            | `objects = 2`                                              |
| ⛔ 4    |                   |                           |                                                            |
| V3–V5   | דפדפן + 🔍        | מייל, הורדה, 3 הורדות     | `3 \| 3 \| 7 days`                                         |
| V6      | 🔍 (⛔ 5 לא חובה) | 7 ימים                    | `expired = t`                                              |
| V7–V8   | 🔍                | הרשאות, בידוד, לוגים      | `f…\|0\|1`, `400`, `0`                                     |
| R1 / R2 | ✏️                | רק בתקלה                  | —                                                          |

**לא בפריסה הזו** (שלבי שרת נפרדים של שחרור האבטחה — `docs/security/remediation-2026-11.md` §3):
`LOGIN_CODE_SECRET` נפרד, `check-default-secrets.sh`, הגיבוי היומי המוצפן, ושינויי Nginx / Kong.

# שלב I — גודל היחידה ומה מיוחד בה בכרטיסים, וקישור הקרדיט לשער: סדר פריסה ופקודות לשרת

> **עוד לא לפרוס.** המסמך מכין את העדכון; הפריסה רק באישור שלך.
> כל פקודה — שורה אחת, שמות מלאים, בלי משתני מעטפת. שולחים פלט אחרי כל שלב.
> שום פקודה כאן לא מדפיסה סוד.
>
> **מצב השרת לפני I:** H פרוס (`df5a5cf`), 156 מיגרציות רשומות, תגי חזרה עד `before-h`.

## מה נכנס ב-I

| | מיגרציה | מה |
|---|---|---|
| ניהול | `20261105180000_hosp_unit_size.sql` (41) | שדה "גודל היחידה (מ"ר)" בעמוד היחידה — לא חובה (5–5,000) |
| האתר | (41) | בכרטיס כל יחידה: אורחים · חדרי שינה · חדרי רחצה · **גודל**, ומתחת — **מה מיוחד בה**: המתקנים מקבוצת בריכה / ספא שבעל העסק סימן — "ג׳קוזי ביחידה" (של היחידה), "בריכה במתחם" (של המתחם), עד שלושה. בעמוד היחידה — גם הגודל |
| הקרדיט | — | הקישור "האתר נבנה באמצעות Nuriel Hospitality" בתחתית כל אתר אירוח נפתח עכשיו בדף הנחיתה `https://nuriel-app2.nuri1.fit` (במקום `m.nuri1.fit`) |
| נוסח | — | "מיטה אחת" במקום "1 מיטות" בעמוד היחידה |

## תאימות

- **41 תואמת לאחור:** האפליקציה של H (`df5a5cf`) ממשיכה לעבוד מעליה — השדה החדש מופיע בתשובות
  והיא פשוט לא קוראת אותו. לכן המיגרציה קודם (IU4) והבנייה אחריה (IU6–IU7).
- **הגרסה החדשה צריכה את 41.** אם היא עולה לפני המיגרציה: הוספת יחידה חדשה נכשלת ("שדה לא מוכר"),
  ושמירת גודל ליחידה קיימת נכשלת. שאר המסכים והאתר עובדים.
- **החנויות (Ecommerce):** בלי שינוי. המיגרציה נוגעת רק בסכמת `hospitality` (עמודה אחת וחמש פונקציות
  שקיימות כבר — אותן חתימות, אותן הרשאות).
- **בלי משתני סביבה חדשים**, בלי שינוי ב-Nginx, ב-GoTrue, ב-Kong או ב-docker-compose.

(נבדק מקומית: 2352 בדיקות מסד בשלושה מעברים; rollback של 41 מחזיר את הסכמה בדיוק למצב של 40, והמחזור
41 → 1 → 41 זהה למקור; בדיקות הדפדפן של פרטי היחידה ושל ההזמנה באתר עוברות; צילום של הכרטיסים החדשים
במחשב ובטלפון.)

---

## IU0 — קודם: למה תעודת ה-SSL של כתובת חדשה לקחה הרבה זמן (קריאה בלבד)

נשמר מהפתיחה של "נופי דורית" (`nofi-dorit`) — ראו `server-followups.md`. לא משנה כלום בשרת.

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -c "SELECT t.slug, to_char(t.created_at AT TIME ZONE 'UTC', 'DD/MM HH24:MI:SS') AS opened_utc, s.status, to_char(s.checked_at AT TIME ZONE 'UTC', 'DD/MM HH24:MI:SS') AS checked_utc, left(s.last_error, 120) AS error FROM public.tenants t LEFT JOIN public.tenant_ssl s ON s.tenant_id = t.id WHERE t.created_at > now() - interval '3 days' ORDER BY t.created_at DESC LIMIT 6" && systemctl list-timers nuriel-store-certs.timer --no-pager && journalctl -u nuriel-store-certs.service --since "-24h" --utc --no-pager -o short-iso | grep -E "מנפיק|הונפקה|נכשל|✗" | tail -30
```

**מה מחפשים:** כמה זמן עבר בין `opened_utc` של `nofi-dorit` לשורות "מנפיק תעודה" ו-"✓ תעודה הונפקה";
האם הייתה "✗ ההנפקה … נכשלה"; והאם הטיימר רץ כל דקה (LAST / NEXT).

---

## עדכון I

### IU1 — גיבוי בלי השבתה

```bash
mkdir -p /root/backups/nuriel-shop/before-i && chmod 700 /root/backups/nuriel-shop/before-i && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-i/db.dump && docker exec -i nuriel-shop-db pg_restore --list < /root/backups/nuriel-shop/before-i/db.dump | grep -c "TABLE DATA" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > /root/backups/nuriel-shop/before-i/applied-before.txt && wc -l < /root/backups/nuriel-shop/before-i/applied-before.txt && git -C /root/nuriel-shop-git log --oneline -1 | tee /root/backups/nuriel-shop/before-i/app-commit.txt && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-i && docker images nuriel-shop-app-app --format '{{.Tag}}'
```

**מצופה:** מספר בסביבות 147 (טבלאות בגיבוי); `156`; `df5a5cf …`; התגים כולל `before-i`.

### IU2 — הקוד (נעוץ ב-`4da712f`)

```bash
cd /root/nuriel-shop-git && git fetch origin "+refs/heads/hospitality/stage-2:refs/remotes/origin/hospitality/stage-2" && git merge --ff-only 4da712f && git log --oneline -1 && cp -r supabase/rollbacks /root/backups/nuriel-shop/before-i/rollbacks && ls /root/backups/nuriel-shop/before-i/rollbacks | grep -c 20261105
```

**מצופה:**
- בשורת ה-fetch יכול להופיע commit מאוחר יותר (תיעוד) — בסדר: ה-merge נעוץ ב-`4da712f`.
- `Updating df5a5cf..4da712f`, `Fast-forward`;
- `4da712f Hospitality site: "מיטה אחת" instead of "1 מיטות" on the unit page`;
- `10` (קובצי ה-rollback של 32–41).

### IU3 — בדיקה יבשה: בדיוק מיגרציה אחת ממתינה

```bash
cd /root/nuriel-shop-git && ls supabase/migrations/*.sql | xargs -n1 basename | LC_ALL=C sort > /root/backups/nuriel-shop/before-i/files.txt && LC_ALL=C comm -23 /root/backups/nuriel-shop/before-i/files.txt /root/backups/nuriel-shop/before-i/applied-before.txt
```

**מצופה:** שורה אחת בדיוק: `20261105180000_hosp_unit_size.sql`. **אחרת — עוצרים.**

### IU4 — מיגרציה 41

עטופה ב-BEGIN / COMMIT: שגיאה = כלום ממנה לא נשאר, והיא לא נרשמת. **שגיאה — עוצרים ושולחים את הפלט.**

```bash
cd /root/nuriel-shop-git && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261105180000_hosp_unit_size.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261105180000_hosp_unit_size.sql')" && echo "41 ok"
```

**מצופה:** `41 ok`.

### IU5 — בדיקה ורענון ה-API

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename = '20261105180000_hosp_unit_size.sql'), (SELECT data_type FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'units' AND column_name = 'size_sqm'), (SELECT count(*) FROM pg_constraint WHERE conrelid = 'hospitality.units'::regclass AND conname = 'units_size_sqm_check'), (SELECT bool_and(prosrc LIKE '%size_sqm%') FROM pg_proc WHERE oid IN ('hospitality._unit_json(hospitality.units)'::regprocedure, 'hospitality._unit_apply(hospitality.units,jsonb,boolean)'::regprocedure, 'hospitality.unit_create(uuid,jsonb)'::regprocedure, 'hospitality.unit_update(uuid,jsonb,integer)'::regprocedure, 'hospitality._site_payload(uuid)'::regprocedure)), has_function_privilege('anon', 'hospitality.unit_update(uuid,jsonb,integer)', 'EXECUTE')" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
```

**מצופה:** `1|smallint|1|t|f`, ואחריו `NOTIFY` — המיגרציה נרשמה, העמודה והבדיקה שלה קיימות, חמש
הפונקציות כוללות את הגודל, ואורח לא מחובר עדיין לא יכול לעדכן יחידה.

(נבדק על מסד מקומי עם כל המיגרציות: בדיוק הפלט הזה.)

### IU6 — בנייה (האתר ממשיך לרוץ בזמן הבנייה)

```bash
cd /root/nuriel-shop-git && docker compose build
```

### IU7 — העלאה ובדיקות (הפקודה מחכה דקה — זה לא תקוע)

```bash
cd /root/nuriel-shop-git && docker compose up -d && sleep 60 && docker compose ps && curl -s -o /dev/null -w 'robots: %{http_code}\n' http://127.0.0.1:3700/robots.txt && curl -s -o /dev/null -w 'fonts: %{http_code} %{content_type}\n' http://127.0.0.1:3700/fonts/hosp/heebo-hebrew-wght.woff2 && docker exec nuriel-shop-app printenv HOSPITALITY_ENGINE
```

**מצופה:** `healthy`; `robots: 200`; `fonts: 200 font/woff2`; `on`.

### IU8 — לוג ובדיקה בדפדפן

```bash
docker logs --since 5m nuriel-shop-app 2>&1 | grep -iE "error|fatal" | tail -20
```

**מצופה:** ריק.

**בדפדפן:**
- **אזור הניהול** של עסק אירוח ← "יחידות" ← יחידה: השדה **"גודל היחידה (מ"ר)"** בכרטיס "חדרים ומיטות";
  שמירה של 34.
- **האתר** (אחרי פרסום): בכרטיס היחידה — "34 מ״ר", ומתחת "ג׳קוזי ביחידה" (אם סומן ג׳קוזי ביחידה)
  ו"בריכה במתחם" (אם סומנה בריכה בעמוד המתחם). בעמוד היחידה — הגודל עם אייקון סרגל.
- **הקרדיט** בתחתית האתר: לחיצה פותחת את `nuriel-app2.nuri1.fit`.
- **חנות:** הכול כרגיל.

### חזרה (I) — קודם האפליקציה, אחר כך המסד

1. **האפליקציה:**

   ```bash
   docker tag nuriel-shop-app-app:before-i nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && docker compose up -d && docker compose ps
   ```

   ה-image של H עולה מיד, בלי בנייה, ועובד מעל 41 (תואמת לאחור). **התיקייה נשארת על `4da712f`.**

2. **המסד — רק אם צריך:**

   ```bash
   docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /root/backups/nuriel-shop/before-i/rollbacks/20261105180000_hosp_unit_size.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261105180000_hosp_unit_size.sql'" && echo "41 down"
   ```

   ```bash
   docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
   ```

   **מה נמחק:** הגדלים שהוזנו ליחידות (העמודה), וחמש הפונקציות חוזרות לגרסה שלפני 41 מילה במילה.
   **מה נשאר:** כל שאר פרטי היחידות, המתקנים, ההזמנות והאתר.

   (נבדק מקומית: rollback של 41 מחזיר את הסכמה בדיוק למצב של 40.)

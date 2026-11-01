# שלב F — סדר פריסה בטוח ופקודות עדכון לשרת

> **עוד לא לפרוס.** המסמך מכין את העדכון; הפריסה רק באישור שלך.
> כל פקודה — שורה אחת, שמות מלאים, בלי משתני מעטפת. שולחים פלט אחרי כל שלב.
> שום פקודה כאן לא מדפיסה סוד (הבדיקה של `HOSPITALITY_SECRET` מדפיסה רק את האורך).

## הסדר — ולמה

1. **קודם עדכון E1–E3** (U2–U8), נעוץ ב-`2e53763` — כפי שתוכנן בנפרד. U1 (גיבוי) כבר רץ. **לא משנים
   אותו:** U2 מוריד בדיוק את `2e53763`, גם אם הענף כבר מתקדם.
2. **רק אחרי ש-E1–E3 עובד ונבדק** — עדכון F (FU1–FU8): מיגרציה אחת (32) ובנייה מחדש.

**תאימות:**
- מיגרציה 32 תואמת לאחור: הגרסה הקודמת של האפליקציה ממשיכה לעבוד מעליה. היא קוראת ל-`dashboard()`,
  והפונקציה נשארה.
  **הבדל אחד:** "הכנסות החודש" חוזר ריק למנהל בלי הרשאה כספית. בכמה הדקות שבין FU4 ל-FU7, מנהל
  שייכנס ללוח הישן יראה שם 0.
- **הגרסה החדשה של האפליקציה צריכה את מיגרציה 32.** לכן המיגרציה קודם (FU4) והבנייה אחריה (FU6–FU7).
  - **אם האפליקציה עולה לפני המיגרציה:** לוח הבקרה מציג "המידע לא נטען", ושאר המסכים עובדים.
- **בלי משתני סביבה חדשים**, בלי שינוי ב-Nginx, ב-GoTrue או ב-Kong.
- **החנויות (Ecommerce):** אין שינוי בקוד, בנתונים או בעיצוב שלהן.
  - ה-root השתנה רק בענף של אתרי המנוע.
  - קובצי הגופנים ב-`/fonts/hosp/` חדשים וסטטיים.
- **מיגרציה 32 נוגעת רק בסכמת `hospitality`:** פונקציות, טבלה חדשה ואינדקסים. מ-`public` היא רק
  קוראת.

---

## א. עדכון E1–E3 (המשך התוכנית הקיימת)

### U2 — הקוד (נעוץ ב-`2e53763`) — **זו הפקודה הבאה**

```bash
cd /root/nuriel-shop-git && git fetch origin "+refs/heads/hospitality/stage-2:refs/remotes/origin/hospitality/stage-2" && git merge --ff-only 2e53763 && git log --oneline -1 && cp -r supabase/rollbacks /root/backups/nuriel-shop/before-e1-e2-e3/rollbacks && ls /root/backups/nuriel-shop/before-e1-e2-e3/rollbacks | grep -c 20261104
```

**מצופה:**
1. **שורת ה-fetch** מסתיימת ב-`hospitality/stage-2 -> origin/hospitality/stage-2`.
   - הטווח שבה יראה `db189e6..` ואחריו ה-commit **האחרון** בענף (לא `2e53763`), כי הענף התקדם בלילה.
   - זה בסדר: ה-merge שאחריה נעוץ ב-`2e53763`.
2. `Updating db189e6..2e53763`, `Fast-forward`, ורשימת קבצים.
3. `2e53763 … Portal: choose online store or zimmer site; zimmer requests (E2)`.
4. `3`.

אם מתבקשים שם משתמש או סיסמה, לא מקלידים כלום. לוחצים Ctrl+C ומספרים לי.

### U3 — בדיקה יבשה: בדיוק 3 מיגרציות ממתינות

```bash
cd /root/nuriel-shop-git && ls supabase/migrations/*.sql | xargs -n1 basename | LC_ALL=C sort > /root/backups/nuriel-shop/before-e1-e2-e3/files.txt && LC_ALL=C comm -23 /root/backups/nuriel-shop/before-e1-e2-e3/files.txt /root/backups/nuriel-shop/before-e1-e2-e3/applied-before.txt | tee /root/backups/nuriel-shop/before-e1-e2-e3/pending.txt && wc -l < /root/backups/nuriel-shop/before-e1-e2-e3/pending.txt
```

**מצופה:** שלוש השורות `20261104090000_portal_business_details.sql`,
`20261104100000_hosp_plans_pricing.sql` ו-`20261104110000_hosp_site_requests.sql`, ואחריהן `3`.
**אם יוצא משהו אחר — עוצרים.**

### U4 — הרצת 3 המיגרציות (נעצר בשגיאה הראשונה; קובץ שנכשל לא נרשם)

```bash
cd /root/nuriel-shop-git && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261104090000_portal_business_details.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261104090000_portal_business_details.sql')" && echo "29 ok" && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261104100000_hosp_plans_pricing.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261104100000_hosp_plans_pricing.sql')" && echo "30 ok" && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261104110000_hosp_site_requests.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261104110000_hosp_site_requests.sql')" && echo "31 ok"
```

**מצופה:**
- `29 ok`, `30 ok`, `31 ok`;
- אולי שורות `NOTICE` (תקין).

### U5 — בדיקה ורענון ה-API

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename LIKE '20261104%'), (SELECT price_monthly FROM hospitality.plans WHERE code = 'basic'), (SELECT price_monthly FROM hospitality.plans WHERE code = 'premium'), to_regclass('hospitality.site_requests') IS NOT NULL" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
```

**מצופה:** `3|200.00|400.00|t`, ואחריו `NOTIFY`.

### U6 — בנייה (האתר ממשיך לרוץ בזמן הבנייה)

```bash
cd /root/nuriel-shop-git && docker compose build
```

**מצופה:** בסוף — `Built` (או `naming to … done`), בלי `ERROR`.

### U7 — העלאה ובדיקות

```bash
cd /root/nuriel-shop-git && docker compose up -d && sleep 60 && docker compose ps && curl -s -o /dev/null -w 'robots: %{http_code}\n' http://127.0.0.1:3700/robots.txt && docker exec nuriel-shop-app printenv HOSPITALITY_ENGINE && docker exec nuriel-shop-app sh -c 'printf %s "$HOSPITALITY_SECRET" | wc -c'
```

**מצופה:**
- הקונטיינר `healthy`;
- `robots: 200`;
- `on`;
- `64`.

### U8 — לוג נקי ובדיקה בדפדפן

```bash
docker logs --since 5m nuriel-shop-app 2>&1 | grep -iE "error|fatal" | tail -20
```

**מצופה:** ריק.

**בדפדפן:**
- בשער: "מה בונים?" ושלב "פרטי העסק";
- בפאנל הפלטפורמה: "חבילות ומחירים לצימרים" ו"בקשות לאתרי צימר";
- חנות קיימת: עמוד בית, מוצר, עגלה וניהול — כרגיל.

**חזרה (E1–E3):**
- **האפליקציה:** ה-image `before-e1-e2-e3`.
- **המסד:** `supabase/rollbacks` בסדר הפוך — 31, 30, 29.
  - של 31 מסרב אם יש בקשות.
  - של 30 מסרב אם יש עסק על "פרימיום".

---

## ב. עדכון F (אחרי ש-E1–E3 נבדק)

### FU1 — גיבוי בלי השבתה

```bash
mkdir -p /root/backups/nuriel-shop/before-f && chmod 700 /root/backups/nuriel-shop/before-f && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-f/db.dump && docker exec -i nuriel-shop-db pg_restore --list < /root/backups/nuriel-shop/before-f/db.dump | grep -c "TABLE DATA" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > /root/backups/nuriel-shop/before-f/applied-before.txt && wc -l < /root/backups/nuriel-shop/before-f/applied-before.txt && git -C /root/nuriel-shop-git log --oneline -1 | tee /root/backups/nuriel-shop/before-f/app-commit.txt && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-f && docker images nuriel-shop-app-app --format '{{.Tag}}'
```

**מצופה:**
1. מספר של בערך 140 ומעלה (הטבלאות בגיבוי).
2. `147` (144 + 3).
3. `2e53763 …`.
4. התגים `latest`, `pre-hospitality`, `before-e1-e2-e3`, `before-f`.

### FU2 — הקוד (נעוץ ב-`2d0b5f0`, הקוד של שלב F כולל תיקוני הנגישות; מה שאחריו בענף — מסמכים בלבד)

```bash
cd /root/nuriel-shop-git && git fetch origin "+refs/heads/hospitality/stage-2:refs/remotes/origin/hospitality/stage-2" && git merge --ff-only 2d0b5f0 && git log --oneline -1 && cp -r supabase/rollbacks /root/backups/nuriel-shop/before-f/rollbacks && ls /root/backups/nuriel-shop/before-f/rollbacks | grep -c 20261105
```

**מצופה:**
- `Updating 2e53763..2d0b5f0`, `Fast-forward`;
- `2d0b5f0 Hospitality F2b: accessibility fixes found by CI (E2E run 73)`;
- `1`.

### FU3 — בדיקה יבשה: בדיוק מיגרציה אחת ממתינה

```bash
cd /root/nuriel-shop-git && ls supabase/migrations/*.sql | xargs -n1 basename | LC_ALL=C sort > /root/backups/nuriel-shop/before-f/files.txt && LC_ALL=C comm -23 /root/backups/nuriel-shop/before-f/files.txt /root/backups/nuriel-shop/before-f/applied-before.txt
```

**מצופה:** שורה אחת בלבד — `20261105090000_hosp_dashboard.sql`. **אחרת — עוצרים.**

### FU4 — הרצת מיגרציה 32 (עטופה ב-BEGIN / COMMIT: שגיאה = כלום לא נשאר)

```bash
cd /root/nuriel-shop-git && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261105090000_hosp_dashboard.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261105090000_hosp_dashboard.sql')" && echo "32 ok"
```

**מצופה:** `32 ok`.

### FU5 — בדיקה ורענון ה-API

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename = '20261105090000_hosp_dashboard.sql'), (SELECT count(*) FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relkind = 'r'), (SELECT relrowsecurity FROM pg_class WHERE oid = 'hospitality.staff_grants'::regclass), array_length(hospitality.permissions(), 1), has_function_privilege('anon', 'hospitality.dashboard_overview(date,date)', 'EXECUTE')" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
```

**מצופה:** `1|31|t|14|f`, ואחריו `NOTIFY`.

### FU6 — בנייה

```bash
cd /root/nuriel-shop-git && docker compose build
```

### FU7 — העלאה ובדיקות (כולל הגופנים מהשרת שלנו)

```bash
cd /root/nuriel-shop-git && docker compose up -d && sleep 60 && docker compose ps && curl -s -o /dev/null -w 'robots: %{http_code}\n' http://127.0.0.1:3700/robots.txt && curl -s -o /dev/null -w 'fonts: %{http_code} %{content_type}\n' http://127.0.0.1:3700/fonts/hosp/heebo-hebrew-wght.woff2 && docker exec nuriel-shop-app printenv HOSPITALITY_ENGINE && docker exec nuriel-shop-app sh -c 'printf %s "$HOSPITALITY_SECRET" | wc -c'
```

**מצופה:**
- `healthy`;
- `robots: 200`;
- `fonts: 200 font/woff2`;
- `on`;
- `64`.

### FU8 — לוג ובדיקה בדפדפן

```bash
docker logs --since 5m nuriel-shop-app 2>&1 | grep -iE "error|fatal" | tail -20
```

**מצופה:** ריק.

**בדפדפן:**
- **`/manage` של עסק האירוח:**
  - כניסה במסך החדש;
  - לוח הבקרה עם ברכה, תקופות, כרטיסים, גרף, "דורש טיפול", לוח תפוסה ו"היום בעסק";
  - חיפוש מהיר: Ctrl+K.
- **מנהל:**
  - לא רואה הכנסות או גבייה;
  - אחרי שהבעלים מדליק לו "נתונים כספיים" במסך הצוות — רואה אותן.
- **האתר הציבורי:** הקרדיט בפוטר, בכל עמוד.
- **חנות:** הכול כרגיל.

### חזרה (F) — קודם האפליקציה, אחר כך המסד

1. **האפליקציה:**

   ```bash
   docker tag nuriel-shop-app-app:before-f nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && docker compose up -d && docker compose ps
   ```

   - **ה-image הקודם עולה מיד, בלי בנייה.**
   - **התיקייה נשארת על `2d0b5f0`.** לא בונים ממנה שוב עד שמחליטים איך ממשיכים.

2. **המסד, רק אם צריך:**

   ```bash
   docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /root/backups/nuriel-shop/before-f/rollbacks/20261105090000_hosp_dashboard.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261105090000_hosp_dashboard.sql'" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
   ```

   **מה נמחק:** רק ההרשאות הכספיות שניתנו למנהלים.

   **מה נשאר:** הזמנות, תשלומים ושאר הנתונים.

# שלב H — צימר נפתח לבד מהשער (30 ימי ניסיון): סדר פריסה בטוח ופקודות עדכון לשרת

> **בוצע בשרת — 2 בנובמבר 2026:** H (HU1–HU8, מיגרציה 40) — הקוד בשרת נעוץ ב-`df5a5cf`, 156 מיגרציות
> רשומות (HU1: 147 טבלאות בגיבוי, 155 לפני). HU5: `1|30|2|f|f|t|1|on/on|0` — המתגים הכלליים של האתרים
> ושל בקשות ההזמנה כבר דלוקים בפלטפורמה, ואף עסק קיים לא פתוח לגולשים (העדכון לא פתח אף אתר). בנייה
> 28.5 שניות, `healthy`, `robots: 200`, `fonts: 200 font/woff2`, `on`, לוג נקי. נקודת חזרה: התג
> `before-h` והגיבוי `before-h/db.dump`. **אין פקודה ממתינה מהמסמך הזה.**
>
> (המקור, לפני הפריסה:) **עוד לא לפרוס.** המסמך מכין את העדכון; הפריסה רק באישור שלך.
> כל פקודה — שורה אחת, שמות מלאים, בלי משתני מעטפת. שולחים פלט אחרי כל שלב.
> שום פקודה כאן לא מדפיסה סוד.
>
> **מצב השרת לפני H:** G פרוס (`f6bc626`), 155 מיגרציות רשומות, תגי חזרה `before-e1-e2-e3`,
> `before-f`, `before-g`.

## מה נכנס ב-H

| | מיגרציה | מה |
|---|---|---|
| השער | `20261105170000_hosp_portal_open.sql` (40) | "אתר לצימר" בשער פותח את העסק מיד: שם, כתובת (בדיקה חיה אם פנויה), טלפון, איזו חבילה אחרי הניסיון → "העסק נפתח!" → כניסה ישירה לאזור הניהול (מדריך ההקמה). במקביל הבקשה נשמרת בפאנל, ומנהלי הפלטפורמה מקבלים מייל "צימר חדש נפתח לניסיון — חזרו אליו". בעל העסק מקבל מייל עם הקישור לאזור הניהול |
| ניסיון | (40) | 30 ימי ניסיון לעסק חדש (במקום 14). עסקים שכבר פתוחים — בלי שינוי. החנויות — בלי שינוי (14) |
| פרסום | (40) | עסק שנפתח מהשער: האתר והזמנות נפתחים לגולשים ברגע שבעל העסק מפרסם — רק אם הפלטפורמה עוד לא החליטה לגבי האתר שלו (מתג שכיביתם לעסק — נשאר כבוי). מדריך ההקמה ועורך האתר אומרים "האתר ייפתח לגולשים ברגע שתפרסמו" |
| הפאנל | (40) | בכרטיס הבקשה: "נפתח לניסיון" וכתובת העסק, בלי הכפתור "פתיחת עסק מהבקשה" (שלא ייפתח עסק כפול) |

**חשוב — המתגים הכלליים בפלטפורמה:** אתר של עסק נפתח לגולשים רק כשגם המתג הכללי בפאנל דלוק
("ניהול Hospitality" → "המנוע בפלטפורמה" → "האתרים הציבוריים של העסקים" ו"בקשות הזמנה מהאתרים").
HU5 מראה את המצב שלהם בשרת; אם הם כבויים — העסקים נפתחים ומתחילים להקים, אבל האתרים לא ייפתחו
לגולשים עד שתדליקו אותם (ההחלטה שלך — HU5 מראה גם כמה עסקים ייפתחו ברגע ההדלקה).

## תאימות

- **H תלוי ב-G (מיגרציות 31, 35, 21):** מיגרציה 40 מגדירה מחדש את `_site_request_json` (31),
  `setup_guide` ו-`setup_save` (35) ו-`site_editor` (21) — אותן חתימות, עם שדה נוסף בתשובה. אם משהו
  מ-G חסר, הבדיקה היבשה (HU3) תראה יותר משורה אחת — **עוצרים.**
- **40 תואמת לאחור:** האפליקציה של G (`f6bc626`) ממשיכה לעבוד מעליה:
  - בשער היא עדיין שולחת בקשה בלבד (`site_request_submit` — בלי שינוי);
  - השדות החדשים בתשובות (`opens_on_publish`, `opened_*`) — היא פשוט לא קוראת אותם;
  - גם בה, עסק חדש מהפאנל מקבל 30 ימי ניסיון.
  - לכן המיגרציה קודם (HU4) והבנייה אחריה (HU6–HU7); בדקות שביניהן הכול ממשיך לעבוד.
- **הגרסה החדשה של האפליקציה צריכה את 40.** אם היא עולה לפני המיגרציה: "פתיחת העסק" בשער נכשלת
  ("הבקשה לא נשלחה") והטקסטים בלי מספר הימים. שאר המסכים עובדים.
- **החנויות (Ecommerce):** פתיחת חנות בשער — אותם מסכים, אותם טקסטים ואותה התנהגות (נבדק). המיגרציה
  לא משנה אף אובייקט בסכמת `public`; היא רק כותבת שורות רגילות (העסק, הבעלים, הדגלים שלו, יומן
  הפלטפורמה) — כמו פתיחת עסק מהפאנל.
- **משתני סביבה — אין חדשים.** המיילים משתמשים בקיימים (`PLATFORM_ADMIN_HOST` לקישור לפאנל,
  `SUPPORT_NOTIFY_EMAIL` אם הוגדר).
- **בלי שינוי ב-Nginx, ב-GoTrue, ב-Kong או ב-docker-compose.** כתובת חדשה של עסק מקבלת תעודת SSL
  כמו חנות חדשה (אותו מנגנון; המסך בשער מחכה לה).

(נבדק מקומית: 2345 בדיקות מסד בשלושה מעברים; rollback של 40 מחזיר את הסכמה בדיוק למצב של 39, והמחזור
40 → 1 → 40 זהה למקור; בדיקת E2E של כל הדרך — שער → פתיחה → מיילים → כניסה לניהול → פרסום → האתר
פתוח; ופתיחת חנות בשער — בלי שינוי.)

---

## עדכון H

### HU1 — גיבוי בלי השבתה

```bash
mkdir -p /root/backups/nuriel-shop/before-h && chmod 700 /root/backups/nuriel-shop/before-h && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-h/db.dump && docker exec -i nuriel-shop-db pg_restore --list < /root/backups/nuriel-shop/before-h/db.dump | grep -c "TABLE DATA" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > /root/backups/nuriel-shop/before-h/applied-before.txt && wc -l < /root/backups/nuriel-shop/before-h/applied-before.txt && git -C /root/nuriel-shop-git log --oneline -1 | tee /root/backups/nuriel-shop/before-h/app-commit.txt && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-h && docker images nuriel-shop-app-app --format '{{.Tag}}'
```

**מצופה:**
1. מספר של בערך 140 ומעלה (הטבלאות בגיבוי).
2. `155`.
3. `f6bc626 …`.
4. התגים `latest`, `pre-hospitality`, `before-e1-e2-e3`, `before-f`, `before-g`, `before-h`.

### HU2 — הקוד (נעוץ ב-`df5a5cf`)

```bash
cd /root/nuriel-shop-git && git fetch origin "+refs/heads/hospitality/stage-2:refs/remotes/origin/hospitality/stage-2" && git merge --ff-only df5a5cf && git log --oneline -1 && cp -r supabase/rollbacks /root/backups/nuriel-shop/before-h/rollbacks && ls /root/backups/nuriel-shop/before-h/rollbacks | grep -c 20261105
```

**מצופה:**
- שורת ה-fetch עשויה להראות commit מאוחר יותר (מסמכים) — בסדר: ה-merge נעוץ ב-`df5a5cf`.
- `Updating f6bc626..df5a5cf`, `Fast-forward`;
- `df5a5cf Hospitality panel: say that a portal business's switches turn on at its first publish`;
- `9` (קובצי ה-rollback של 32–40).

### HU3 — בדיקה יבשה: בדיוק מיגרציה אחת ממתינה

```bash
cd /root/nuriel-shop-git && ls supabase/migrations/*.sql | xargs -n1 basename | LC_ALL=C sort > /root/backups/nuriel-shop/before-h/files.txt && LC_ALL=C comm -23 /root/backups/nuriel-shop/before-h/files.txt /root/backups/nuriel-shop/before-h/applied-before.txt
```

**מצופה:** שורה אחת בדיוק: `20261105170000_hosp_portal_open.sql`. **אחרת — עוצרים.**

### HU4 — מיגרציה 40

עטופה ב-BEGIN / COMMIT: שגיאה = כלום ממנה לא נשאר, והיא לא נרשמת. **שגיאה — עוצרים ושולחים את הפלט.**

```bash
cd /root/nuriel-shop-git && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261105170000_hosp_portal_open.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261105170000_hosp_portal_open.sql')" && echo "40 ok"
```

**מצופה:** `40 ok`.

### HU5 — בדיקה, המתגים הכלליים ורענון ה-API

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename = '20261105170000_hosp_portal_open.sql'), (SELECT trial_days FROM hospitality.plans WHERE code = 'trial'), (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'site_requests' AND column_name IN ('opened_tenant_id', 'opened_at')), has_function_privilege('anon', 'hospitality.portal_open_site(text,text,jsonb)', 'EXECUTE'), has_function_privilege('authenticated', 'hospitality.portal_open_site(text,text,jsonb)', 'EXECUTE'), has_function_privilege('service_role', 'hospitality.portal_open_site(text,text,jsonb)', 'EXECUTE'), (SELECT count(*) FROM pg_trigger WHERE tgname = 'site_versions_portal_open'), (SELECT string_agg(CASE WHEN enabled THEN 'on' ELSE 'off' END, '/' ORDER BY key) FROM public.platform_feature_flags WHERE key IN ('hospitality_booking_enabled', 'hospitality_frontend_enabled')), (SELECT count(*) FROM public.tenant_feature_flags WHERE key = 'hospitality_frontend_enabled' AND enabled)" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
```

**מצופה:** `1|30|2|f|f|t|1|X/Y|N` ואחריו `NOTIFY`:
- `1` — המיגרציה נרשמה; `30` — ימי הניסיון לעסק חדש; `2` — שתי העמודות החדשות בבקשות;
- `f|f|t` — פתיחת עסק: רק השרת (לא גולש ולא משתמש מחובר);
- `1` — הטריגר "האתר נפתח בפרסום";
- `X/Y` — המתגים הכלליים בפלטפורמה: בקשות הזמנה / האתרים הציבוריים (`on` / `off`);
- `N` — כמה עסקים כבר מוגדרים עם "האתר פתוח" משלהם (הם אלה שייפתחו לגולשים ברגע שהמתג הכללי של
  האתרים נדלק).

(נבדק על מסד מקומי עם כל המיגרציות: `1|30|2|f|f|t|1|…`.)

### HU6 — בנייה (האתר ממשיך לרוץ בזמן הבנייה)

```bash
cd /root/nuriel-shop-git && docker compose build
```

### HU7 — העלאה ובדיקות

```bash
cd /root/nuriel-shop-git && docker compose up -d && sleep 60 && docker compose ps && curl -s -o /dev/null -w 'robots: %{http_code}\n' http://127.0.0.1:3700/robots.txt && curl -s -o /dev/null -w 'fonts: %{http_code} %{content_type}\n' http://127.0.0.1:3700/fonts/hosp/heebo-hebrew-wght.woff2 && docker exec nuriel-shop-app printenv HOSPITALITY_ENGINE
```

**מצופה:** `healthy`; `robots: 200`; `fonts: 200 font/woff2`; `on`.

### HU8 — לוג ובדיקה בדפדפן

```bash
docker logs --since 5m nuriel-shop-app 2>&1 | grep -iE "error|fatal" | tail -20
```

**מצופה:** ריק.

**בדפדפן:**
- **השער** (`nuriel-app2.nuri1.fit`) — עם אימייל שאתה שולט בו, **לא** של מנהל הפלטפורמה (חשבון מנהל
  הפלטפורמה לא יכול להיות בעלים של עסק):
  - "מה מקימים?" → "אתר לצימר" מראה "30 ימי ניסיון";
  - שם, כתובת (נבדקת חי), טלפון → "פתיחת העסק — 30 ימי ניסיון";
  - "העסק נפתח!" עם תאריך סוף הניסיון → אחרי תעודת ה-SSL של הכתובת (בדרך כלל עד דקה-שתיים) —
    אזור הניהול של העסק;
  - "הקמת העסק": פרטי העסק ויצירת קשר כבר מסומנים; בצעד הפרסום — "האתר ייפתח לגולשים ולהזמנות ברגע
    שתפרסמו אותו" (רק כשהמתג הכללי של האתרים דלוק — אחרת "צוות נוריאל פותח אותו").
- **המיילים:** לאימייל של הבדיקה — "… נפתח — אפשר להתחיל להקים את האתר"; למנהלי הפלטפורמה — "צימר
  חדש נפתח לניסיון: …".
- **הפאנל** (`/platform/hospitality#site-requests`): הבקשה עם "נפתח לניסיון" וכתובת העסק; העסק ברשימת
  העסקים, בחבילת ניסיון.
- **חנות:** פתיחת חנות בשער — כרגיל; דף הבית, `/admin`.

עסק הבדיקה נשאר ברשימה (ניסיון שיפוג לבד). אם תרצה להסיר אותו — תגיד, ואכין פקודה.

### חזרה (H) — קודם האפליקציה, אחר כך המסד

1. **האפליקציה:**

   ```bash
   docker tag nuriel-shop-app-app:before-h nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && docker compose up -d && docker compose ps
   ```

   - ה-image של G עולה מיד, בלי בנייה, והוא עובד מעל 40 (תואמת לאחור). השער חוזר ל"שליחת בקשה".
   - **התיקייה נשארת על `df5a5cf`.** לא בונים ממנה שוב עד שמחליטים איך ממשיכים.

2. **המסד — רק אם צריך:**

   ```bash
   docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /root/backups/nuriel-shop/before-h/rollbacks/20261105170000_hosp_portal_open.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261105170000_hosp_portal_open.sql'" && echo "40 down"
   ```

   ```bash
   docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
   ```

   **מה נמחק:** הפונקציות של הפתיחה מהשער, הטריגר "האתר נפתח בפרסום", והקישור בין בקשה לעסק שנפתח
   ממנה (נשאר ביומן הפלטפורמה: `hosp_site_opened` עם `source = portal` ומזהה הבקשה). הניסיון לעסק חדש
   חוזר ל-14 יום.

   **מה נשאר:** עסקים שכבר נפתחו מהשער — עסקים רגילים לכל דבר (בעלים, ניסיון, נתונים); מי מהם שעוד לא
   פרסם — האתר שלו ייפתח רק כשתדליקו אותו בפאנל, כמו לפני H. הבקשות עצמן נשארות.

   (נבדק מקומית: rollback של 40 מחזיר את הסכמה בדיוק למצב של 39.)

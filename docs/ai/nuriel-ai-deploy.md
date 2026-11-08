# פריסה לייצור: NURIEL AI ASSISTANT (מיגרציה 61) — nuriel-shop

> **אף פקודה כאן לא הורצה בשרת.** שולחים לי פקודה אחת, מריצים, ומחזירים את הפלט — ורק אז הפקודה הבאה.
> שום פקודה לא מדפיסה סוד, ו**מפתח ה-API של Anthropic לא נכנס בשום פקודה** — רק במסך "ניהול תוסף AI".
>
> 🔍 = קריאה בלבד · ✏️ = משנה משהו בשרת (כתוב בדיוק מה) · ⛔ = נקודת אישור שלך.
>
> **הקוד לפריסה:** `58a47dc` (ענף `hospitality/stage-2`).
> **מצב השרת לפני:** אחרי פריסת הנגישות והמסמכים — הקוד על `919ae23`, 176 מיגרציות, תג חזרה `before-a11y-docs`.
> **אחרי:** הקוד על `58a47dc`, 177 מיגרציות, תג חזרה חדש `before-nuriel-ai`.
>
> **נבדק מראש (בלי השרת):** מיגרציה 61 על מסד נקי (פעמיים) ועל מסד עם נתונים — 2756/2756 בדיקות מסד, מתוכן 101
> של העוזר; Rollback ← הסכמה זהה בדיוק למיגרציה 60, ושוב קדימה; 930 בדיקות יחידה ואבטחה (157 של העוזר); בנייה;
> סקירת אבטחה עצמאית — 11 ממצאים, כולם תוקנו ונבדקו; E2E ב-CI מול "דגם" מדומה (בלי מפתח אמיתי ובלי חיוב).

## מה נכנס

- **תוסף בתשלום שנתי — 150 ₪ לשנה לחנות / למתחם**, נפרד לגמרי מחבילות הבסיס (שלא השתנו): NURIEL AI – Ecommerce
  (חנויות) ו-NURIEL AI – Hospitality (מתחמים), כל אחד עם קטלוג מדריכים משלו.
- **מסך מנהל העל "ניהול תוסף AI"** (`/platform/ai`): הפעלה לפי סוג העסק, תאריך התחלה, סיום אוטומטי אחרי 12
  חודשים (שעון ישראל), חידוש, השבתה, היסטוריה, מפתח API מוצפן, דגם, מצב (כבוי / בדיקה / פעיל), מגבלות, צריכה
  ועלויות, חריגות, והרצת בדיקת התראות.
- **חלון העוזר אצל מנהל העסק** (פאנל החנות `/admin`, ניהול המתחם `/manage`) — רק לעסק שיש / הייתה לו חבילה.
- **התראות חידוש במייל** (30 / 14 / 7 / 1 ימים לפני הסיום וביום הסיום) — בדיקה כל שעה בתוך השרת, פעם אחת לכל
  התראה (שליחה שנכשלה — עוד ניסיון אחרי שעה, עד 3, באותו מפתח כפילות), בלי חיוב אוטומטי.

**מיגרציה אחת** — `20261110100000_ai_assistant.sql`, עטופה ב-`BEGIN` / `COMMIT`. **לא משנה נתונים קיימים ולא משנה
פונקציה קיימת:** שמונה טבלאות חדשות (סגורות לדפדפן לגמרי, כולל סיכום עלויות יומי שלא נמחק עם עסק), 22 פונקציות
חדשות (לשרת בלבד), ושתי שורות קטלוג (שתי
החבילות, 150 ₪). ההגדרות מתחילות **כבוי, בלי מפתח, בלי חבילות** — אחרי הפריסה שום עסק לא רואה שינוי.

- **בלי משתני סביבה חדשים** ובלי שינוי ב-`docker-compose.yml` / Nginx. מפתח ההצפנה של מפתח ה-API נגזר
  מ-`SUPABASE_SERVICE_ROLE_KEY` שכבר קיים בשרת (אם יוחלף אי-פעם — מדביקים את מפתח ה-API מחדש במסך).
- **תלות חדשה בבנייה:** `@anthropic-ai/sdk` בגרסה נעולה `1.3.0` (ב-`bun.lock`, מ-registry.npmjs.org).
- **יציאה לרשת:** רק כשהעוזר פעיל — בקשות HTTPS ל-`api.anthropic.com` מתוך קונטיינר האפליקציה. P3 בודק שהכתובת
  נגישה (בלי מפתח, בלי עלות).
- **שינוי אחד שנוגע בכל האתרים** (`src/server.ts`, מהסקירה העצמאית): בקשה לפונקציית שרת (`/_serverFn/…`) תמיד
  מקבלת את העסק של הכתובת — גם כשהנתיב נגמר כמו שם קובץ (`…/x.js`), שעד עכשיו רץ "בלי עסק". בקשות רגילות לא
  משתנות; ה-E2E המלא (כל האתרים, החנויות והפאנלים) עובר עם השינוי.
- **הסדר:** הקוד והבנייה קודם (האתר ממשיך לרוץ), אחר כך מיגרציה 61, ומיד ההפעלה. הגרסה הקודמת עובדת גם מול 61
  (רק מוסיפה), כך שחזרה של האפליקציה בלבד (R1) אפשרית בלי לגעת במסד.

### מה השתנה אחרי הסקירה העצמאית (לפני הפריסה)

- עסק בלי חבילה לא צורך שום מכסה של אחרים; התקרה של כל המערכת נספרת רק לשאלות שנשלחות לדגם; מגבלה לעסק עד 300
  בשעה; הגבלה למשתמש לפני השאילתות במסד (גם לבדיקת המצב).
- חידוש: נשלח עם תאריך הסיום שהמסך הציג — לחיצה כפולה / ניסיון חוזר לא רושמים שנה נוספת; לכל היותר תקופה עתידית
  אחת (גם ביום האחרון).
- פאנל מנהל העל מזהה את הכתובת עצמה (לא "אין עסק").
- ניקוי קלט: NFKC, מחיקת תווים בלתי נראים (כולל Tag / בוררי וריאציה), אותיות דומות בקירילית / יוונית, בקשה
  שמפוצלת בין שאלות; סינון נוסף של סיסמאות וקודים (גם 4 ספרות).
- בלי "חשיבה" ב-Haiku / Sonnet; תקרה גדולה יותר ב-Opus. כתובת הבדיקה המקומית — רק כשגם הפאנל על דומיין מקומי.
- הצפנה: רק תג אימות מלא; `AI_ASSISTANT_SECRET` קצר — שגיאה ברורה (לא נפילה שקטה לסוד אחר).
- התראות: בלי שירות מיילים — לא תופסים כלום; שליחה שנכשלה — עוד ניסיון. סיכום העלויות נשמר גם אחרי מחיקת עסק.

---

## שלב 1 — בדיקות מקדימות (🔍)

### P1 — הענף והקומיט

```bash
cd /root/nuriel-shop-git && git branch --show-current && git log --oneline -1 && git status --short --untracked-files=no | wc -l && git fetch origin "+refs/heads/hospitality/stage-2:refs/remotes/origin/hospitality/stage-2" && git merge-base --is-ancestor HEAD 58a47dc && echo "fast-forward possible" && git merge-base --is-ancestor 58a47dc origin/hospitality/stage-2 && echo "58a47dc is on origin" && git log --oneline -1 58a47dc
```

**תקין:** `hospitality/stage-2`; `919ae23 Hospitality sites: upload the main image…`; `0`; `fast-forward possible`;
`58a47dc is on origin`; השורה של הקומיט. אחרת — עוצרים.

### P2 — Docker, המיגרציות, הדיסק

```bash
cd /root/nuriel-shop-git && docker ps --format '{{.Names}}\t{{.Status}}' | grep '^nuriel-shop-' && docker images nuriel-shop-app-app --format '{{.Tag}}\t{{.CreatedSince}}' && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied" && LC_ALL=C comm -23 <(git ls-tree --name-only 58a47dc supabase/migrations/ | xargs -n1 basename | LC_ALL=C sort) <(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort) && df -h /var/lib/docker /root/backups/nuriel-shop | tail -n +2
```

**תקין:** הקונטיינרים ב-`Up` (ליד האפליקציה `(healthy)`); התגים כוללים `before-a11y-docs`; `176`; **שורה אחת**
— `20261110100000_ai_assistant.sql`; לפחות 5G פנויים ב-`/var/lib/docker`.

### P3 — האם השרת מגיע ל-Anthropic (בלי מפתח, בלי עלות)

```bash
docker exec nuriel-shop-app node -e "fetch('https://api.anthropic.com/v1/models').then(r=>console.log('anthropic reachable, status', r.status)).catch(e=>console.log('anthropic NOT reachable:', e.message))"
```

**תקין:** `anthropic reachable, status 401` (401 = "אין מפתח" — צפוי). `NOT reachable` — עוצרים: צריך לפתוח יציאה
ל-`api.anthropic.com:443` בחומת האש לפני שמפעילים את העוזר (הפריסה עצמה לא תלויה בזה).

**⛔ אישור 1 — רק אם P1–P3 תקינים.** מכאן הפקודות כותבות בשרת.

---

## שלב 2 — גיבוי (✏️ כותב רק ל-`/root/backups/nuriel-shop/before-nuriel-ai` ומוסיף תג ל-image)

### B1

```bash
mkdir -m 700 /root/backups/nuriel-shop/before-nuriel-ai && cd /root/backups/nuriel-shop/before-nuriel-ai && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > db.dump && docker exec -i nuriel-shop-db pg_restore -f /dev/null < db.dump && echo "dump read to the end: ok" && ls -lh db.dump && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > applied-before.txt && wc -l < applied-before.txt && git -C /root/nuriel-shop-git log --oneline -1 | tee app-commit.txt && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-nuriel-ai && docker images nuriel-shop-app-app --format '{{.Tag}}' && ls
```

**תקין:** `dump read to the end: ok`; הגודל; `176`; `919ae23 …`; התגים כוללים `before-nuriel-ai`; שלושה קבצים:
`app-commit.txt applied-before.txt db.dump`.

### B2 — הגיבוי ניתן לשחזור (✏️ מסד בדיקה נפרד `restore_check` — נוצר ונמחק)

```bash
docker exec nuriel-shop-db psql -U postgres -q -c "DROP DATABASE IF EXISTS restore_check" -c "CREATE DATABASE restore_check" && docker exec -i nuriel-shop-db pg_restore -U postgres -d restore_check --no-owner --no-privileges < /root/backups/nuriel-shop/before-nuriel-ai/db.dump > /dev/null 2>&1; for d in postgres restore_check; do docker exec nuriel-shop-db psql -U postgres -d $d -tAc "SELECT (SELECT count(*) FROM public.tenants), (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.orders), (SELECT count(*) FROM hospitality.bookings), (SELECT count(*) FROM public._migrations_applied)"; done && docker exec nuriel-shop-db psql -U postgres -q -c "DROP DATABASE restore_check" && echo "restore check: done"
```

**תקין:** שתי שורות **זהות** (… | 176) ואז `restore check: done`.

---

## שלב 3 — הקוד והבנייה (האתר ממשיך לרוץ)

### S1 — הקוד (✏️ קבצים + עותק של קובץ ה-Rollback ליד הגיבוי)

```bash
cd /root/nuriel-shop-git && git merge -q --ff-only 58a47dc && git log --oneline -1 && mkdir -p /root/backups/nuriel-shop/before-nuriel-ai/rollbacks && cp supabase/rollbacks/20261110100000_ai_assistant.down.sql /root/backups/nuriel-shop/before-nuriel-ai/rollbacks/ && ls /root/backups/nuriel-shop/before-nuriel-ai/rollbacks
```

**תקין:** שורת הקומיט; `20261110100000_ai_assistant.down.sql`.

### S2 — בנייה ובדיקה שהקוד החדש בתוך ה-image (✏️ image חדש; האתר ממשיך לרוץ על הישן)

```bash
cd /root/nuriel-shop-git && docker compose build && docker run --rm --entrypoint sh nuriel-shop-app-app:latest -c "grep -rl 'ai_entitlement' /app/.output/server | wc -l; ls /app/node_modules/@anthropic-ai/sdk/package.json"
```

**תקין:** `Built`, בלי שגיאה; מספר גדול מ-0; הנתיב של `package.json` של הספרייה. שגיאה — עוצרים (האתר לא נפגע).

**⛔ אישור 2 — מכאן משנים את המסד ומפעילים את הגרסה החדשה.** בשעה שקטה.

---

## שלב 4 — מיגרציה 61 והפעלה (✏️ המסד + הפעלה מחדש)

### M1

```bash
cd /root/nuriel-shop-git && f=20261110100000_ai_assistant && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename LIKE '20261110%'), (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname IN ('ai_packages','ai_subscriptions','ai_subscription_periods','ai_subscription_events','ai_settings','ai_usage_log','ai_usage_daily','ai_notifications') AND relrowsecurity), (SELECT count(*) FROM public.ai_packages WHERE price_agorot = 15000), (SELECT mode FROM public.ai_settings), has_table_privilege('authenticated', 'public.ai_settings', 'SELECT'), has_function_privilege('authenticated', 'public.ai_entitlement(uuid)', 'EXECUTE'), (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "1|8|2|off|f|f|177" ] && echo "61 checks ok" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'" && docker compose up -d
```

**תקין:** `… ok`; `1|8|2|off|f|f|177` — לפי הסדר: רשומה אחת; שמונה הטבלאות עם RLS; שתי החבילות ב-150 ₪; העוזר
**כבוי**; הדפדפן **לא** קורא את ההגדרות; הדפדפן **לא** מפעיל את בדיקת הזכאות (רק השרת); 177 מיגרציות. ואז
`61 checks ok`, `NOTIFY`, שורות ה-compose.

**נעצר:** לא מפעילים — האתר נשאר על הגרסה הקודמת (והיא עובדת גם מול מה שנכנס). שולחים לי את הפלט.

---

## שלב 5 — בדיקות אחרי ההפעלה

### V1 — האתרים והמסך החדש (🔍; מחכה דקה)

```bash
cd /root/nuriel-shop-git && sleep 60 && docker compose ps app && ph=$(docker exec nuriel-shop-app sh -c 'printf %s "$PLATFORM_ADMIN_HOST"') && echo "platform host: ${ph:-NOT SET}" && for u in https://nuriel-shop.nuri1.fit/ https://nofi-dorit.nuri1.fit/stay https://nofi-dorit.nuri1.fit/manage/login "https://$ph/platform/ai"; do curl -s -o /dev/null -w "$u: %{http_code}\n" "$u"; done && docker logs --since 3m nuriel-shop-app 2>&1 | grep -iE "error|fatal|nuriel-ai" | tail -20
```

**תקין:** `Up … (healthy)`; `platform host:` עם הדומיין של פאנל הפלטפורמה; ארבע שורות `200`; לוג ריק (שורות
`aborted` — לא בעיה; בלי `[nuriel-ai] renewal notices failed`). בדיקת ההתראות הראשונה רצה דקה אחרי העלייה — בלי
חבילות היא לא שולחת כלום ולא כותבת ללוג.

### V2 — המסד אחרי (🔍)

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public.ai_subscriptions), (SELECT count(*) FROM public.ai_usage_log), (SELECT count(*) FROM public.ai_notifications), (SELECT mode || '|' || (api_key_encrypted IS NULL) FROM public.ai_settings), (SELECT count(*) FROM public.platform_audit_log WHERE action LIKE 'ai\_%')"
```

**תקין:** `0|0|0|off|t|0` — אין חבילות, אין שימוש, אין התראות, העוזר כבוי ובלי מפתח.

### V3 — בדפדפן (אתה, בסדר הזה)

1. **מנהל העל** → "ניהול הפלטפורמה" → **"ניהול תוסף AI"**: רשימת כל החנויות והמתחמים, כולם "ללא חבילה".
2. בחנות כלשהי ובנופי דורית — **אין** כפתור NURIEL AI (אין חבילות). שום שינוי אצל הלקוחות.
3. **מפתח:** במסך בלבד (לא בצ'אט, לא בטרמינל) — מדביקים מפתח API רגיל מ-console.anthropic.com → "שמירת מפתח" →
   מופיע `sk-ant-…XXXX`. מומלץ להגדיר בקונסולה של Anthropic תקרת הוצאה חודשית.
4. **מצב בדיקה** → "בדיקת חיבור" (קריאה אחת, בערך חצי סנט) → "החיבור תקין … הסיווג נכון".
5. במצב בדיקה, נכנסים לניהול של חנות / של נופי דורית ("היכנס לניהול") ושואלים שאלה — רק מנהל העל רואה את העוזר.
6. כשהכול תקין: **"פעיל"**, ומפעילים חבילה לעסק **רק אחרי אישור ותשלום** (150 ₪ לשנה) — "הפעלה", תאריך התחלה,
   והסיום נקבע לבד.

---

## שלב 6 — Rollback (רק אם צריך; ⛔ אישור לפני כל פעולה)

### R1 — האפליקציה בלבד (✏️ הכי מהיר)

```bash
docker tag nuriel-shop-app-app:before-nuriel-ai nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && docker compose up -d && sleep 60 && docker compose ps app && curl -s -o /dev/null -w 'robots: %{http_code}\n' http://127.0.0.1:3700/robots.txt
```

**תקין:** `Up … (healthy)`; `robots: 200`. הגרסה הקודמת עולה מיד; מיגרציה 61 נשארת (רק תוספות, ואף אחד לא קורא לה).

### R2 — גם המסד: 61 ← 60 (✏️; רק אחרי R1, ורק אם המסד עצמו בעייתי)

```bash
docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-nuriel-ai/before-rollback.dump && echo "backup ok" && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < /root/backups/nuriel-shop/before-nuriel-ai/rollbacks/20261110100000_ai_assistant.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261110100000_ai_assistant.sql'" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
```

**תקין:** `backup ok`; `176`; `NOTIFY`.

**הגנה:** ה-Rollback נעצר אם כבר יש חבילות שהופעלו, תקופות, היסטוריה, התראות או יומן שימוש — או אם העוזר לא כבוי /
יש מפתח שמור. זה מידע מסחרי (מי שילם ומתי): לא מוחקים אותו בשקט — שולחים לי ומחליטים יחד. הרשומות ביומן
הפלטפורמה (`platform_audit_log`) נשמרות תמיד.

---

## כל הפקודות לפי הסדר

| #     | סוג            | מה                                 | תקין                        |
| ----- | -------------- | ---------------------------------- | --------------------------- |
| P1    | 🔍             | הענף והקומיט                       | `919ae23`, `fast-forward …` |
| P2    | 🔍             | Docker, מיגרציות, דיסק             | `176`, ממתינה אחת           |
| P3    | 🔍             | יציאה ל-Anthropic (בלי מפתח)       | `status 401`                |
| ⛔ 1  |                |                                    |                             |
| B1    | ✏️ גיבוי       | מסד, תג `before-nuriel-ai`         | `dump read to the end: ok`  |
| B2    | ✏️ מסד נפרד    | בדיקת שחזור                        | שתי שורות זהות              |
| S1    | ✏️ קבצים       | הקוד ← `58a47dc`                   | קובץ ה-Rollback             |
| S2    | ✏️ image       | בנייה + הקוד החדש בתוך ה-image     | `Built`, מספר > 0           |
| ⛔ 2  |                |                                    |                             |
| M1    | ✏️ מסד + הפעלה | מיגרציה 61 + בדיקה + הפעלה         | `61 checks ok`, `Started`   |
| V1    | 🔍             | האתרים ו-`/platform/ai`            | ארבע `200`                  |
| V2    | 🔍             | המסד אחרי                          | `0\|0\|0\|off\|t\|0`        |
| V3    | דפדפן          | המסך, מפתח, מצב בדיקה, בדיקת חיבור | —                           |
| R1/R2 | ✏️             | רק בתקלה                           | —                           |

# דף הנחיתה של נוריאל מחשבים (nuriel-app2) — סדר פריסה ופקודות לשרת

> **נפרס ב-3 בנובמבר 2026**, אחרי J + K (באישורך) — ראו "סטטוס פריסה" בסוף. פריסה נפרדת מ-J + K.
> כל פקודה — שורה אחת, שמות מלאים, בלי משתני מעטפת. שולחים פלט אחרי כל שלב. שום פקודה כאן לא
> מדפיסה סוד.
>
> **מצב השרת לפני העדכון (אחרי J + K):** הקוד על `c13cd00`, 160 מיגרציות רשומות, תג `before-jk`.
> בדיקה יבשה (LU3) עוצרת אם זה לא המצב.

## למה אחרי J + K

הענף אחד: `f2e8bf7` יושב מעל `c13cd00` (J + K). פריסה של דף הנחיתה לפני J + K הייתה מעלה את קוד
J + K בלי המיגרציות 42–44 — לכן הסדר קבוע: J + K (נעוץ ב-`c13cd00`, בלי שורה אחת של דף הנחיתה) ← ורק
אחר כך דף הנחיתה (נעוץ ב-`f2e8bf7`). LU3 בודקת שאין מיגרציות ממתינות — אם J + K עוד לא נפרס, היא
תראה 3 ועוצרים.

## מה נכנס — נעוץ ב-`f2e8bf7`

| commit    | מה                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `61ab354` | מסמך הפריסה של J + K (תיעוד בלבד)                                                                                                                                                                                  |
| `ad3a2fe` | דף הנחיתה: SSR לשער בלבד, המחירים וימי הניסיון מהמסד, שני מסלולי ניסיון (14 / 30), צור קשר, WhatsApp, SEO, llms.txt לשער בלבד                                                                                      |
| `9433ef2` | בדיקת SQL (פתיחת תאריכים) — התאריך המקומי של העסק; קובץ בדיקה בלבד, לא רץ בשרת                                                                                                                                     |
| `1ebba27` | הלוגו המקורי (`public/brand`) והפלטה מתוך הלוגו; הלוגו ב-JSON-LD                                                                                                                                                   |
| `be62922` | הלוגו בלבד במקום שם העסק בטקסט (כותרת ופוטר); WhatsApp 050-5492178 בכל הכפתורים — נבדק; כל כפתורי הניסיון נבדקו                                                                                                    |
| `a47d6b5` | תוכניות הפריסה (תיעוד בלבד): דף הנחיתה כעדכון נפרד אחרי J + K                                                                                                                                                      |
| `fab4a94` | הכותרת: "חנות אינטרנטית לעסק / ואתר הזמנות לצימר" (בלי "נוריאל מחשבים: מחשבים"); כותרות ב-Heebo; שני המוצרים קודם, "מי אנחנו" אחר כך                                                                               |
| `6c8d4bd` | תוכנית הפריסה של דף הנחיתה (תיעוד בלבד)                                                                                                                                                                            |
| `f2e8bf7` | כפתור הרשמה בולט "הרשמה קלה — תוך 2 דקות" (בכותרת ובפתיחה) ו"כבר נרשמתם? כניסה לניהול"; מייל "החנות נפתחה" לבעל חנות חדשה מהשער עם כפתור "כניסה לניהול החנות" (`/#login`, בלי טוקן); `/#login` פותח את חלון הכניסה |

- **בלי מיגרציות:** `git diff --name-only c13cd00 f2e8bf7 -- supabase` — ריק (נבדק שוב ב-LU3).
- **בלי שינוי במנועים:** אפס קבצים תחת `src/engines` ו-`src/platform/engines`.
- **מה משתנה בשרת:** עמוד הבית של nuriel-app2 בלבד (ו-`/llms.txt` שלו). בכל חנות אחרת עמוד הבית נשאר
  כמו היום (`data-only`) — נבדק.
- **מייל חדש לבעלי חנויות חדשות:** מי שפותח חנות מהשער מקבל "החנות "<השם>" נפתחה!" עם כפתור
  "כניסה לניהול החנות" ← `https://nuriel-app2.nuri1.fit/#login` (קוד חד-פעמי למייל ← החנויות שלו ←
  הניהול) — כדי שאם הדף נסגר באמצע, יש דרך חזרה. בלי טוקן כניסה במייל. אותו מנגנון שליחה כמו מייל
  "העסק נפתח" של הצימרים, שכבר עובד בשרת; כשל במייל לא מבטל את הפתיחה. פתיחת חנות אפשרית רק בשער
  (nuriel-app2) — חנויות קיימות לא מקבלות מייל.
- **בלי משתני סביבה חדשים**, בלי שינוי ב-Nginx, ב-Cloudflare/CDN, ב-DNS או ב-docker-compose.
- **המסד:** לא נוגעים. (צור קשר משתמש בטופס הקיים — פניות נשמרות בתיבת הפניות של nuriel-app2.)

## מה נבדק (סביבת הפיתוח)

- בדיקות יחידה: 622 (42 קבצים), כולל 23 של דף הנחיתה (גם המייל "החנות נפתחה": הקישור, בריחת תווים,
  בלי טוקן); typecheck, lint ו-Prettier נקיים.
- E2E של דף הנחיתה — 9 (8 במחשב + 1 בטלפון): ה-HTML הראשוני (סורק), llms.txt ומפת האתר, חנות אחרת
  לא השתנתה, 8 כפתורי הניסיון (כל אחד למסלול שלו), אחרי קוד המייל — ישר למסלול, הלוגו בכותרת = קישור
  לראש הדף, "כניסה" ← "כניסה לניהול", **כפתור ההרשמה** (בכותרת ובפתיחה) ← "הרשמה קלה — תוך 2 דקות",
  "כבר נרשמתם? כניסה לניהול", **הקישור מהמייל** (`/#login` מדף חדש — חלון הכניסה נפתח מיד), עמודי
  הפוטר (תנאי שימוש / פרטיות / נגישות), טופס צור קשר עד תיבת הפניות, WhatsApp וטלפון — רק
  050-5492178, נגישות (axe) במחשב ובטלפון.
- זרימות קיימות (על `f2e8bf7`): פתיחת חנות מהשער — **כולל המייל "החנות נפתחה"** לבעלים עם הכפתור
  והקישור `/#login`; כניסה בקוד, קוד שגוי, Google (auth-regression — 6 עברו, אחת מדולגת: שרת ההזדהות
  בסביבת הבדיקה לא מגיע לגוגל); פתיחת עסק אירוח מהשער (1); החנות (storefront — 3) — עברו.
- SEO: כותרת 64 תווים, תיאור 162, H1 אחד, 7 H2, 20 H3, 11 תמונות — לכולן alt, canonical, Open Graph,
  `index, follow`, JSON-LD (ComputerStore עם הלוגו, WebSite, 2×Service, FAQPage — 8 שאלות). כל
  הסורקים (Googlebot, Bingbot, OAI-SearchBot, GPTBot, ChatGPT-User, ClaudeBot, PerplexityBot) מקבלים
  את הדף המלא.
- Mobile: 7 רוחבים (320–1440) — בלי גלילה הצידה, בלי טקסט מתחת ל-12px, בלי מטרות מגע קטנות.
- קישורים חיצוניים: החנות ונופי דורית — 200; 14 הקטגוריות — קיימות במפת האתר של החנות; WhatsApp ←
  `api.whatsapp.com/send/?phone=972505492178`; גוגל מפות — הכתובת בפורמט הרשמי (גוגל חוסם בדיקה
  אוטומטית — 429; ללחוץ פעם אחת לבדיקה).
- תצוגה מקדימה בשיתוף (WhatsApp / פייסבוק): הכותרת והתיאור של הדף; התמונה — הלוגו שבהגדרות של
  nuriel-app2 (כבר הלוגו הנכון בשרת).
- CI: ריצות על הענף — ראו "סטטוס CI" בסוף.

---

## עדכון דף הנחיתה

### LU1 — גיבוי וסימון הגרסה הנוכחית (בלי השבתה)

```bash
mkdir -p /root/backups/nuriel-shop/before-landing && chmod 700 /root/backups/nuriel-shop/before-landing && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-landing/db.dump && docker exec -i nuriel-shop-db pg_restore --list < /root/backups/nuriel-shop/before-landing/db.dump | grep -c "TABLE DATA" && git -C /root/nuriel-shop-git log --oneline -1 | tee /root/backups/nuriel-shop/before-landing/app-commit.txt && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-landing && docker images nuriel-shop-app-app --format '{{.Tag}}'
```

**מצופה:** מספר טבלאות בגיבוי (בסביבות 147); `c13cd00 …`; התגים כולל `before-landing` (ו-`before-jk`).
(דף הנחיתה לא נוגע במסד — הגיבוי ליתר ביטחון בלבד.)

### LU2 — הקוד (נעוץ ב-`f2e8bf7`)

```bash
cd /root/nuriel-shop-git && git fetch origin "+refs/heads/hospitality/stage-2:refs/remotes/origin/hospitality/stage-2" && git merge --ff-only f2e8bf7 && git log --oneline -1
```

**מצופה:** `Updating c13cd00..f2e8bf7`, `Fast-forward`; השורה האחרונה —
`f2e8bf7 Landing page: a prominent signup button ("הרשמה קלה — תוך 2 דקות"), a login link, and a "store opened" email with the management login link`.
(בשורת ה-fetch יכול להופיע commit מאוחר יותר — תיעוד; ה-merge נעוץ ב-`f2e8bf7`.)

### LU3 — בדיקה יבשה (קריאה בלבד): אין מיגרציות

```bash
cd /root/nuriel-shop-git && git diff --name-only c13cd00 f2e8bf7 -- supabase | wc -l && ls supabase/migrations/*.sql | xargs -n1 basename | LC_ALL=C sort > /root/backups/nuriel-shop/before-landing/files.txt && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > /root/backups/nuriel-shop/before-landing/applied.txt && LC_ALL=C comm -23 /root/backups/nuriel-shop/before-landing/files.txt /root/backups/nuriel-shop/before-landing/applied.txt | wc -l && wc -l < /root/backups/nuriel-shop/before-landing/applied.txt
```

**מצופה:** `0` (אין קובץ מסד שהשתנה), `0` (אין מיגרציה ממתינה), `160`. **אחרת — עוצרים.**

### LU4 — בנייה (האתר ממשיך לרוץ בזמן הבנייה)

```bash
cd /root/nuriel-shop-git && docker compose build
```

### LU5 — העלאת הגרסה החדשה

```bash
cd /root/nuriel-shop-git && docker compose up -d && docker compose ps
```

**מצופה:** שורות ה-compose (`Started` / `Running`).

### LU6 — בדיקות אחרי העלאה (הפקודה מחכה דקה — זה לא תקוע)

```bash
sleep 60 && curl -s https://nuriel-app2.nuri1.fit/ -o /root/backups/nuriel-shop/before-landing/home.html && grep -aoE '<h1 id="hero-title"[^>]*><span[^>]*>[^<]*</span> <span[^>]*>[^<]*</span></h1>' /root/backups/nuriel-shop/before-landing/home.html | sed 's/<[^>]*>//g' && grep -ao 'הרשמה קלה — תוך 2 דקות' /root/backups/nuriel-shop/before-landing/home.html | sort | uniq -c && grep -ao 'התחילו [0-9]* ימי ניסיון בחינם' /root/backups/nuriel-shop/before-landing/home.html | sort | uniq -c && grep -ao 'wa\.me/[0-9]*' /root/backups/nuriel-shop/before-landing/home.html | sort | uniq -c && curl -s -o /dev/null -w 'llms: %{http_code}\n' https://nuriel-app2.nuri1.fit/llms.txt && curl -s -o /dev/null -w 'logo: %{http_code} %{content_type}\n' https://nuriel-app2.nuri1.fit/brand/nuriel-computers-logo-192.webp && curl -s https://nuriel-shop.nuri1.fit/ | grep -ao 'data-testid="platform-landing"' | wc -l
```

**מצופה:**

- `חנות אינטרנטית לעסק ואתר הזמנות לצימר` — הכותרת (H1) מרונדרת בשרת;
- `2 הרשמה קלה — תוך 2 דקות` — כפתור ההרשמה (בכותרת ובפתיחה);
- `4 התחילו 14 ימי ניסיון בחינם` ו-`4 התחילו 30 ימי ניסיון בחינם` (פתיחה, החלק, שתי החבילות);
- `4 wa.me/972505492178`;
- `llms: 200`; `logo: 200 image/webp`;
- `0` — בחנות של נוריאל מחשבים אין דף נחיתה (עמוד הבית שלה לא השתנה).

### LU7 — בדפדפן

- **המחשב והטלפון:** הלוגו בכותרת; הפתיחה עם שלוש הדלתות; המחירים — 450 / 700 לחנות, 200 / 400 + 2,000
  ל-Hospitality (מהמסד); "התחילו 14…" פותח "חנות אינטרנטית — 14 ימי ניסיון בחינם", "התחילו 30…" —
  "Nuriel Hospitality — 30 ימי ניסיון בחינם".
- **הרשמה וכניסה:** "הרשמה קלה — תוך 2 דקות" (בכותרת ובפתיחה) פותח חלון "הרשמה קלה — תוך 2 דקות";
  "כבר נרשמתם? כניסה לניהול" ו"כניסה" — "כניסה לניהול"; הכתובת
  `https://nuriel-app2.nuri1.fit/#login` (הקישור מהמייל) — חלון הכניסה נפתח מיד.
- **המייל "החנות נפתחה":** נבדק בסביבת הפיתוח; בשרת — יגיע בפתיחת החנות האמיתית הבאה מהשער (לא
  פותחים חנות לבדיקה בייצור).
- **WhatsApp:** הכפתור הצף נפתח לשיחה עם 050-5492178.
- **צור קשר:** פנייה אחת לבדיקה ← מופיעה בניהול של nuriel-app2 ב"פניות", ומייל למנהלים.
- **שיתוף:** קישור ל-nuriel-app2.nuri1.fit ב-WhatsApp — הכותרת החדשה והלוגו (WhatsApp שומר תצוגה ישנה
  לזמן מה).
- **החנויות ונופי דורית:** כרגיל.

### חזרה (דף הנחיתה) — רק האפליקציה

```bash
docker tag nuriel-shop-app-app:before-landing nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && docker compose up -d && docker compose ps
```

ה-image של J + K עולה מיד, בלי בנייה ובלי שינוי במסד (אין מה להחזיר). **התיקייה נשארת על `f2e8bf7`**;
לבנייה הבאה של הגרסה הקודמת — `git -C /root/nuriel-shop-git checkout c13cd00` (רק אם צריך).

## סטטוס CI

- ריצה 117 (`f2e8bf7` + תיעוד) — נכשלה בדיקת E2E אחת שאינה קשורה לדף הנחיתה (מגבלת יחידות ב-Hospitality: הטקסט הופיע פעמיים בדף — בדיקה לא יציבה); תוקנה ב-`b3dfce7` (קובץ בדיקה בלבד). ריצה 118 — ירוקה בכל ארבע העבודות.

## סטטוס פריסה — 3 בנובמבר 2026

- **הקוד בשרת:** `f2e8bf7` (fast-forward מ-`c13cd00`). **המסד:** בלי שינוי — 160 מיגרציות, אין ממתינות.
- **LU1:** גיבוי `/root/backups/nuriel-shop/before-landing/db.dump` — 147 טבלאות, 2.90MB, נקרא עד הסוף; תג
  `before-landing`. **LU3:** `0`, `0`, `160`. **LU4–LU5:** נבנה ועלה (11:49 UTC). **LU6:** הכותרת, `2` הרשמה,
  `4`+`4` ניסיון, `4 wa.me/972505492178`, `llms: 200`, `logo: 200 image/webp`, `0` בחנות; בלוג — אין שגיאות.
- **מבחוץ (דפדפן, 30/30):** 8 כפתורי הניסיון (14 / 30) — כל אחד למסלול שלו; ההרשמה והכניסה; `/#login`;
  WhatsApp 050-5492178; 16 הקישורים לחנות ולנופי דורית — 200; עמודי הפוטר; טופס צור קשר (שדות ובדיקת
  שדות, בלי שליחה); axe במחשב ובטלפון — 0; בלי גלילה הצידה ב-7 רוחבים; בלי שגיאות. SEO: H1 אחד, כותרת
  53, תיאור 144, canonical, Open Graph, JSON-LD (הלוגו, המחירים מהמסד, 8 שאלות), `llms.txt`; 7 סורקים —
  הדף המלא. הלוגו בשרת — זהה בייט-לבייט לקובץ המקורי.
- **החנות ונופי דורית:** אותו תוכן (טקסט, תמונות, קישורים, מטא), מפת האתר ו-robots של החנות זהים.
- **נשאר (LU7, בדפדפן):** פנייה אחת לבדיקה בטופס צור קשר (← "פניות" בניהול + מייל), WhatsApp מהטלפון,
  תצוגה מקדימה בשיתוף.
- **חזרה:** הסעיף "חזרה (דף הנחיתה)" למעלה — בתוקף (התג `before-landing`).

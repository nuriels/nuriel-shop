# דף הנחיתה של נוריאל מחשבים (nuriel-app2) — סדר פריסה ופקודות לשרת

> **עוד לא לפרוס.** פריסה נפרדת מ-J + K, ורק **אחרי** ש-J + K פרוס ונבדק — ורק באישור מפורש שלך.
> כל פקודה — שורה אחת, שמות מלאים, בלי משתני מעטפת. שולחים פלט אחרי כל שלב. שום פקודה כאן לא
> מדפיסה סוד.
>
> **מצב השרת לפני העדכון (אחרי J + K):** הקוד על `c13cd00`, 160 מיגרציות רשומות, תג `before-jk`.
> בדיקה יבשה (LU3) עוצרת אם זה לא המצב.

## למה אחרי J + K

הענף אחד: `fab4a94` יושב מעל `c13cd00` (J + K). פריסה של דף הנחיתה לפני J + K הייתה מעלה את קוד
J + K בלי המיגרציות 42–44 — לכן הסדר קבוע: J + K (נעוץ ב-`c13cd00`, בלי שורה אחת של דף הנחיתה) ← ורק
אחר כך דף הנחיתה (נעוץ ב-`fab4a94`). LU3 בודקת שאין מיגרציות ממתינות — אם J + K עוד לא נפרס, היא
תראה 3 ועוצרים.

## מה נכנס — נעוץ ב-`fab4a94`

| commit    | מה                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `61ab354` | מסמך הפריסה של J + K (תיעוד בלבד)                                                                                                    |
| `ad3a2fe` | דף הנחיתה: SSR לשער בלבד, המחירים וימי הניסיון מהמסד, שני מסלולי ניסיון (14 / 30), צור קשר, WhatsApp, SEO, llms.txt לשער בלבד        |
| `9433ef2` | בדיקת SQL (פתיחת תאריכים) — התאריך המקומי של העסק; קובץ בדיקה בלבד, לא רץ בשרת                                                       |
| `1ebba27` | הלוגו המקורי (`public/brand`) והפלטה מתוך הלוגו; הלוגו ב-JSON-LD                                                                     |
| `be62922` | הלוגו בלבד במקום שם העסק בטקסט (כותרת ופוטר); WhatsApp 050-5492178 בכל הכפתורים — נבדק; כל כפתורי הניסיון נבדקו                      |
| `fab4a94` | הכותרת: "חנות אינטרנטית לעסק / ואתר הזמנות לצימר" (בלי "נוריאל מחשבים: מחשבים"); כותרות ב-Heebo; שני המוצרים קודם, "מי אנחנו" אחר כך |

- **בלי מיגרציות:** `git diff --name-only c13cd00 fab4a94 -- supabase` — ריק (נבדק שוב ב-LU3).
- **בלי שינוי במנועים:** אפס קבצים תחת `src/engines` ו-`src/platform/engines`.
- **מה משתנה בשרת:** עמוד הבית של nuriel-app2 בלבד (ו-`/llms.txt` שלו). בכל חנות אחרת עמוד הבית נשאר
  כמו היום (`data-only`) — נבדק.
- **בלי משתני סביבה חדשים**, בלי שינוי ב-Nginx, ב-Cloudflare/CDN, ב-DNS או ב-docker-compose.
- **המסד:** לא נוגעים. (צור קשר משתמש בטופס הקיים — פניות נשמרות בתיבת הפניות של nuriel-app2.)

## מה נבדק (סביבת הפיתוח)

- בדיקות יחידה: 619 (42 קבצים), כולל 20 של דף הנחיתה; typecheck ו-lint (היקף ה-CI) נקיים.
- E2E של דף הנחיתה — 8 (מחשב + טלפון): ה-HTML הראשוני (סורק), llms.txt ומפת האתר, חנות אחרת לא
  השתנתה, 8 כפתורי הניסיון (כל אחד למסלול שלו), אחרי קוד המייל — ישר למסלול, הלוגו בכותרת = קישור
  לראש הדף, "כניסה", עמודי הפוטר (תנאי שימוש / פרטיות / נגישות), טופס צור קשר עד תיבת הפניות,
  WhatsApp וטלפון — רק 050-5492178, נגישות (axe) במחשב ובטלפון.
- זרימות קיימות: פתיחת עסק אירוח מהשער (1), פתיחת חנות + Google (2), החנות (7) — עברו.
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

### LU2 — הקוד (נעוץ ב-`fab4a94`)

```bash
cd /root/nuriel-shop-git && git fetch origin "+refs/heads/hospitality/stage-2:refs/remotes/origin/hospitality/stage-2" && git merge --ff-only fab4a94 && git log --oneline -1
```

**מצופה:** `Updating c13cd00..fab4a94`, `Fast-forward`; השורה האחרונה —
`fab4a94 Landing page (nuriel-app2): a heading about the two products, without "נוריאל מחשבים: מחשבים"`.
(בשורת ה-fetch יכול להופיע commit מאוחר יותר — תיעוד; ה-merge נעוץ ב-`fab4a94`.)

### LU3 — בדיקה יבשה (קריאה בלבד): אין מיגרציות

```bash
cd /root/nuriel-shop-git && git diff --name-only c13cd00 fab4a94 -- supabase | wc -l && ls supabase/migrations/*.sql | xargs -n1 basename | LC_ALL=C sort > /root/backups/nuriel-shop/before-landing/files.txt && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > /root/backups/nuriel-shop/before-landing/applied.txt && LC_ALL=C comm -23 /root/backups/nuriel-shop/before-landing/files.txt /root/backups/nuriel-shop/before-landing/applied.txt | wc -l && wc -l < /root/backups/nuriel-shop/before-landing/applied.txt
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
sleep 60 && curl -s https://nuriel-app2.nuri1.fit/ -o /root/backups/nuriel-shop/before-landing/home.html && grep -aoE '<h1 id="hero-title"[^>]*><span[^>]*>[^<]*</span> <span[^>]*>[^<]*</span></h1>' /root/backups/nuriel-shop/before-landing/home.html | sed 's/<[^>]*>//g' && grep -ao 'התחילו [0-9]* ימי ניסיון בחינם' /root/backups/nuriel-shop/before-landing/home.html | sort | uniq -c && grep -ao 'wa\.me/[0-9]*' /root/backups/nuriel-shop/before-landing/home.html | sort | uniq -c && curl -s -o /dev/null -w 'llms: %{http_code}\n' https://nuriel-app2.nuri1.fit/llms.txt && curl -s -o /dev/null -w 'logo: %{http_code} %{content_type}\n' https://nuriel-app2.nuri1.fit/brand/nuriel-computers-logo-192.webp && curl -s https://nuriel-shop.nuri1.fit/ | grep -ao 'data-testid="platform-landing"' | wc -l
```

**מצופה:**

- `חנות אינטרנטית לעסק ואתר הזמנות לצימר` — הכותרת (H1) מרונדרת בשרת;
- `4 התחילו 14 ימי ניסיון בחינם` ו-`4 התחילו 30 ימי ניסיון בחינם` (פתיחה, החלק, שתי החבילות);
- `4 wa.me/972505492178`;
- `llms: 200`; `logo: 200 image/webp`;
- `0` — בחנות של נוריאל מחשבים אין דף נחיתה (עמוד הבית שלה לא השתנה).

### LU7 — בדפדפן

- **המחשב והטלפון:** הלוגו בכותרת; הפתיחה עם שלוש הדלתות; המחירים — 450 / 700 לחנות, 200 / 400 + 2,000
  ל-Hospitality (מהמסד); "התחילו 14…" פותח "חנות אינטרנטית — 14 ימי ניסיון בחינם", "התחילו 30…" —
  "Nuriel Hospitality — 30 ימי ניסיון בחינם".
- **WhatsApp:** הכפתור הצף נפתח לשיחה עם 050-5492178.
- **צור קשר:** פנייה אחת לבדיקה ← מופיעה בניהול של nuriel-app2 ב"פניות", ומייל למנהלים.
- **שיתוף:** קישור ל-nuriel-app2.nuri1.fit ב-WhatsApp — הכותרת החדשה והלוגו (WhatsApp שומר תצוגה ישנה
  לזמן מה).
- **החנויות ונופי דורית:** כרגיל.

### חזרה (דף הנחיתה) — רק האפליקציה

```bash
docker tag nuriel-shop-app-app:before-landing nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && docker compose up -d && docker compose ps
```

ה-image של J + K עולה מיד, בלי בנייה ובלי שינוי במסד (אין מה להחזיר). **התיקייה נשארת על `fab4a94`**;
לבנייה הבאה של הגרסה הקודמת — `git -C /root/nuriel-shop-git checkout c13cd00` (רק אם צריך).

## סטטוס CI

- הריצה על המסמך הזה (`fab4a94` + תיעוד בלבד) — התוצאה בהודעה שמצרפת את התוכנית. ריצה 115 על `be62922` + תיעוד — ירוקה בכל ארבע העבודות.

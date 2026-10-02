# פורטל B2B להזמנת משקאות

מערכת סיטונאית להזמנת משקאות בעברית (RTL), הכוללת קטלוג ציבורי, הרשמת לקוחות
עסקיים, מערכת הרשאות בארבע דרגות (אורח / לקוח / סוכן / מנהל), ניהול הזמנות
מלא, פאנל ניהול מתקדם, שליחת מיילים אוטומטית והגנות משפטיות בסיסיות.

## תפקידים עיקריים במערכת

- **אורח** — רואה את הקטלוג, הקטגוריות ואת אזור "מבצעים חמים" בלבד, ללא מחירים.
- **לקוח עסקי** — לאחר אישור מנהל, רואה מחירים לפי קבוצת המחיר שהוקצתה לו
  (דרג 1/2/3, מוסתר מהלקוח), מבצע הזמנות ורואה היסטוריית הזמנות אישית ב-`/orders`.
- **סוכן** (`/agent`) — מקים לקוחות חדשים, מאפס סיסמאות, ומנהל את ההזמנות של
  הלקוחות המשויכים אליו (עדכון סטטוס, מחיר, כמות, מחיקת פריטים).
- **מנהל** (`/admin`) — שליטה מלאה: הזמנות, משתמשים, קטלוג ומחירים, תוכן האתר
  (כותרת/לוגו/אודות/יצירת קשר/תנאי שימוש/מדיניות פרטיות) והגדרות מייל.

## הגדרות נדרשות להפעלה מלאה

1. **Supabase** — משתני `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` /
   `SUPABASE_SERVICE_ROLE_KEY` (ראו `.env`), והרצת המיגרציות שב-`supabase/migrations`.
2. **מיילים אוטומטיים (Resend)** — יש להגדיר בסביבת השרת את המשתנה
   `RESEND_API_KEY`, ולהזין בפאנל הניהול (הגדרות מייל) כתובת שולחת מאומת אצל
   Resend ואת רשימת המנהלים שיקבלו התראה על הזמנה חדשה. בלי מפתח זה,
   ההזמנות ייקלטו כרגיל אך המיילים לא יישלחו.
3. **תנאי שימוש / מדיניות פרטיות** — בפאנל הניהול → הגדרות אתר יש כפתור
   שממלא טיוטת ברירת מחדל בהתאם לדין הישראלי. **זו טיוטה כללית בלבד ואינה
   תחליף לייעוץ משפטי** — יש להעביר לבדיקת עו"ד לפני פרסום לציבור, בפרט את
   סעיפי הביטול, האחריות והגבלת הגיל למכירת אלכוהול.

## Development

Prefer working locally? You need Node.js/Bun.

```sh
git clone <this-repository-url>
cd <repository-name>
bun install
bun run dev
```

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/aa832928-43f9-434a-b241-e211b29678ef).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

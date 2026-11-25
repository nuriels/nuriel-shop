# Skills לעבודת ה-SEO — מה הותקן, מאיפה, מה נבדק ומה תרם

**איפה:** בסביבת הפיתוח המקומית בלבד — `.claude/skills`, מוחרג מ-git (כמו ה-Skills הקיימים). המקור, ה-commit וה-hash של כל
Skill רשומים ב-`skills-lock.json` המקומי. ה-Skills **לא חלק מהמוצר, לא מגיעים לשרת ואין להם גישה למפתחות או לחשבונות**.
סשן חדש צריך להתקין אותם מחדש מאותו commit ולוודא את ה-hash.

## 1. מה מותקן

| Skill | מקור | רישיון | sha256 של `SKILL.md` (16 תווים ראשונים) | הותקן |
| --- | --- | --- | --- | --- |
| `seo` | `addyosmani/web-quality-skills` @ `afa8da9` | MIT | `57cd16566c2c7061` | 21.11 |
| `core-web-vitals` | אותו מקור ו-commit | MIT | `731aa78c0347e8b3` | 21.11 |
| `performance` | אותו מקור ו-commit | MIT | `b0c220185d88c61f` | 21.11 |
| `searchfit-technical-seo` | `searchfit/searchfit-seo` @ `c324a2e` | MIT | `23347eb7e53896a5` | 25.11 |
| `searchfit-schema-markup` | אותו מקור ו-commit | MIT | `205be14b293bb3f5` | 25.11 |
| `searchfit-internal-linking` | אותו מקור ו-commit | MIT | `e6edccd7cebc0414` | 25.11 |
| `searchfit-keyword-clustering` | אותו מקור ו-commit | MIT | `db491abc9e93bab7` | 25.11 |
| `searchfit-on-page-seo` | אותו מקור ו-commit | MIT | `a9c8f43fa1d8deb5` | 25.11 |
| `searchfit-content-strategy` | אותו מקור ו-commit | MIT | `7e7f826d91f6fa4c` | 25.11 |

## 2. מה נבדק לפני ההתקנה (25.11, `searchfit/searchfit-seo` @ `c324a2e`)

- **רישיון:** MIT (קובץ `LICENSE` במאגר).
- **תוכן:** כל אחד מששת ה-Skills הוא קובץ Markdown אחד. אין סקריפטים, hooks, שרתי MCP, קריאות רשת או בקשה למפתחות,
  ואין ב-frontmatter הרשאות לכלים.
- **שורות פרסום:** בסוף כל Skill יש הפניה לשירות המסחרי של היוצר ("try SearchFit.ai"). הן לא הוראות, והמערכת לא
  מתחברת לשום שירות חיצוני.

**נבדקו ולא הותקנו (מאותו מאגר):**

| רכיב | למה לא |
| --- | --- |
| הסוכנים `seo-auditor`, `content-strategist`, `competitor-analyzer` | מבקשים `Bash`, `WebFetch` ו-`WebSearch`, יותר גישה ממה שנדרש למסמך הנחיות |
| הפקודות `create-content`, `create-topic` | מייצרות מאמרים שלמים לפי מילת מפתח. זה סותר את הכלל "בלי עמודים בכמות, בלי שכפול ובלי עמודי Doorway" |
| `content-brief` | הכנת תדריך לכתיבת מאמרים בכמות. אותה סיבה |
| `seo-audit`, `broken-links`, הפקודה `seo-check` | כפולים לבדיקה הטכנית שכבר בנויה במנוע (`src/platform/seo/audit/*`) ול-Skill `seo` |
| `content-translation`, הפקודה `translate-content` | האתרים בעברית בלבד; אין צורך כרגע |
| `ai-visibility` | מעקב אחרי אזכורי מותג בכלי AI חיצוניים. מחוץ לתחום, ואין מקור נתונים אמיתי |

## 3. מה תרם, בפועל

- **מקור הכללים החדשים הוא התיעוד הרשמי של Google** (`SITELINKS-GUIDE.md`), לא ה-Skills.
- **`searchfit-internal-linking`:** שימש רשימת ביקורת בזמן כתיבת כללי המבנה: קישורים מדף הבית לאגפים, קטגוריה ← מוצרים,
  טקסט קישור קצר, עמודים בלי קישורים. כל הנקודות שאומצו מופיעות גם בתיעוד של Google; לא אומץ ממנו שום דבר מעבר לזה.
- **`seo`** (מ-21.11): הבסיס לכללי הבדיקה הטכנית (כותרות, תיאורים, H1, canonical, robots, sitemap, נתונים מובנים).
- **חמשת ה-Skills האחרים של SearchFit:** הותקנו לקראת שלב N3 (מחקר מילות מפתח לפי כוונת חיפוש, הצעות תוכן ו-schema),
  ולא שימשו בעבודה של הלילה.

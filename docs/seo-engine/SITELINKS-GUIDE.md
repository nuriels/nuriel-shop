# Google Sitelinks ושם האתר — מה גוגל אומר, ומה המנוע עושה עם זה

המסמך הזה הוא הבסיס לכללים של מנוע מבנה האתר (`src/platform/seo/structure/*`) ולכללי הבדיקה החדשים.
המקורות — התיעוד הרשמי של Google Search Central (נקרא ב-25.11.2026; "Last updated 2025-12-10 UTC" בכל העמודים):

| נושא | מקור |
| --- | --- |
| Sitelinks | https://developers.google.com/search/docs/appearance/sitelinks |
| שם האתר (Site names) | https://developers.google.com/search/docs/appearance/site-names |
| פירורי לחם | https://developers.google.com/search/docs/appearance/structured-data/breadcrumb |
| קישורים שגוגל יכול לסרוק | https://developers.google.com/search/docs/crawling-indexing/links-crawlable |
| כותרות בתוצאה (Title links) | https://developers.google.com/search/docs/appearance/title-link |
| מבנה של חנות | https://developers.google.com/search/docs/specialty/ecommerce/help-google-understand-your-ecommerce-site-structure |

## 1. מה גוגל אומר (תמצית, עם ציטוטים קצרים)

**Sitelinks — אוטומטיים לגמרי.** "At the moment, sitelinks are automated." אין סימון (markup) שמבקש אותם.
"If the structure of your site doesn't allow our algorithms to find good sitelinks … we won't show them."
ההמלצות של גוגל, במלואן:
1. כותרות העמודים והכותרות בעמוד — "informative, relevant, and compact".
2. "Create a logical site structure … and make sure you link to your important pages from other relevant pages."
3. "Ensure that your internal links' anchor text is concise and relevant to the page they're pointing to."
4. "Avoid repetitions in your content."
5. הסרה של קישור לא רצוי — הסרת העמוד או `noindex`.

**שם האתר.** נקבע אוטומטית מעמוד הבית ומאזכורים ברשת. "To indicate your site name preference, add WebSite structured data
to your home page … WebSite structured data is most important." נתמך גם בתת-דומיין (`news.example.com`), לא בתת-תיקייה.
חובה: `name` + `url` (כתובת עמוד הבית הקנוני של הדומיין / תת-הדומיין); מומלץ `alternateName` (שם קצר / חלופי).
להשתמש באותו שם באופן עקבי בעמוד הבית (כותרת, `og:site_name`, כותרות). "Avoid using a generic name."
בלוק `WebSite` אחד — לא להוסיף בלוק שני אם כבר קיים.

**קישורים.** "Generally, Google can only crawl your link if it's an `<a>` HTML element … with an `href` attribute."
קישור שנוצר רק מאירוע JavaScript (onclick על כפתור / div) — לא נסרק באמינות. טקסט הקישור — "descriptive, reasonably concise".

**חנות.** "add links from menus to category pages, from category pages to sub-category pages, and finally from sub-category
pages to all product pages … use `<a href>` tags … Don't use JavaScript events on other HTML DOM elements for navigation."
"Google generally doesn't look at the structure of URLs" — המבנה נלמד מהקישורים, לא מהכתובת (כתובת `?category=` תקינה).
"the more links a page has to it within a site, the higher the relative importance" — לקשר מדף הבית לקטגוריות ולמוצרים החשובים.

**כותרות.** כותרת לכל עמוד; "Avoid vague descriptors like 'Home'"; בלי מילות מפתח חוזרות ובלי טקסט קבוע ארוך (boilerplate);
"Brand your titles concisely" — בדף הבית מותר תיאור קצר ("ExampleSocialSite, a place for people to meet and mingle"),
ובשאר העמודים שם האתר פעם אחת בהתחלה או בסוף, עם מפריד. ה-H1 הראשון — הכותרת הבולטת של העמוד.

**פירורי לחם.** `BreadcrumbList` → `itemListElement` של `ListItem` עם `position`, `name`, `item` (כתובת).

## 2. מה המנוע עושה עם זה

| המלצה של גוגל | מה בנוי עכשיו |
| --- | --- |
| קישורים לעמודים החשובים | מנוע מבנה אחד לכל הפלטפורמה מזהה את העמודים החשובים לפי סוג האתר (קטגוריות / יחידות וחבילות / שירותים), ומוודא שכל אחד מקושר מדף הבית ב-`<a href>` אמיתי שמופיע ב-HTML שהשרת שולח (SSR) |
| טקסט קישור קצר ורלוונטי | תווית קצרה לכל עמוד חשוב (שם הקטגוריה / היחידה, בלי אימוג'י ובלי שם העסק) — הקישור עוטף את השם, לא את כל הכרטיס |
| מבנה לוגי | פירורי לחם (UI + `BreadcrumbList`) בכל עמוד פנימי; קטגוריה ← מוצרים בקישורים |
| שם האתר | `WebSite` עם `name` + `alternateName` + `url` בדף הבית של כל אתר, ואותו שם ב-`og:site_name` |
| כותרות קומפקטיות | תבנית כותרת עקבית ("עמוד \| שם העסק"); לדף הבית — הצעה (ממתינה לאישור) לתיאור קצר של העסק |
| הסרה | `noindex` לעמודים טכניים (עגלה, חשבון, הזמנה) — כבר קיים; נבדק |

**מה המנוע לא עושה:** לא מבטיח Sitelinks (גוגל מחליט), לא יוצר עמודים "בשביל גוגל", לא משנה טקסטים של העסק בלי אישור.

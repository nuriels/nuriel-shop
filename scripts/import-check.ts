/**
 * בדיקות לחילוץ תמונות מ-HTML וקיצור כותרות בייבוא החכם.
 * הרצה: npx esbuild scripts/import-check.ts --bundle --platform=node --format=cjs \
 *         --outfile=/tmp/imp.cjs --alias:@=./src && node /tmp/imp.cjs
 */
import { extractImages, shortenTitle } from "@/lib/import.server";
import { groupByCategory } from "@/lib/catalog";
import { extractUrlFromText } from "@/lib/url";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`✗ ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

// --- HTML סינתטי בפורמט האמיתי של עמוד AliExpress: מערך imagePathList ---
const aliHtml = `
<html><head>
<meta property="og:image" content="https://ae01.alicdn.com/kf/MAIN.jpg_960x960.jpg" />
<meta property="og:title" content="2026 New Fashion Jewelry Hot Sale Gold Plated Heart Pendant Necklace For Women Girls Gift Free Shipping Wholesale Dropshipping | AliExpress" />
</head><body>
<script>window.runParams = {"data":{"imageModule":{
  "imagePathList":["https://ae01.alicdn.com/kf/A1.jpg","https://ae01.alicdn.com/kf/A2.jpg_220x220.jpg","//ae01.alicdn.com/kf/A3.webp"],
  "summImagePathList":["https://ae01.alicdn.com/kf/A1.jpg_50x50.jpg"]
}}};</script>
<img src="https://ae01.alicdn.com/kf/icon-cart.png" />
<img data-src="https://ae01.alicdn.com/kf/B4.jpeg" />
</body></html>`;

const images = extractImages(aliHtml);
check("מערך imagePathList נקלט (הבאג המרכזי)", images.includes("https://ae01.alicdn.com/kf/A1.jpg"), images.join(" | "));
check("תמונה שנייה מהמערך נקלטת ומוגדלת מ-thumbnail", images.includes("https://ae01.alicdn.com/kf/A2.jpg"));
check("כתובת //protocol-relative מטופלת", images.includes("https://ae01.alicdn.com/kf/A3.webp"));
check("נמצאו לפחות 4 תמונות שונות", new Set(images).size >= 4, `נמצאו ${images.length}`);
check("thumbnail כפול של A1 לא יוצר כפילות", images.filter((u) => u.includes("A1")).length === 1);
check("הגלריה קודמת ל-og בתור", images[0] === "https://ae01.alicdn.com/kf/A1.jpg", images[0]);
check("אייקונים מסוננים", !images.some((u) => u.includes("icon-cart")));
check("img data-src נקלט", images.includes("https://ae01.alicdn.com/kf/B4.jpeg"));

// --- JSON-LD עם מערך image ---
const ldHtml = `<script type="application/ld+json">{"@type":"Product","image":["https://shop.example/p1.jpg","https://shop.example/p2.png"]}</script>`;
const ldImages = extractImages(ldHtml);
check('JSON-LD "image":[...] נקלט', ldImages.length === 2, ldImages.join(" | "));

// --- תקרות: כלליות בלבד → 24; מובנות → ללא תקרה (עד 60) ---
const manyGeneric = extractImages(
  `<div>${Array.from({ length: 40 }, (_, i) => `<img src="https://x.example/img${i}.jpg" />`).join("")}</div>`,
);
check("סריקה כללית מוגבלת ל-24", manyGeneric.length === 24, String(manyGeneric.length));
const manyStructured = extractImages(
  `<script>{"imagePathList":[${Array.from({ length: 35 }, (_, i) => `"https://ae01.alicdn.com/kf/S${i}.jpg"`).join(",")}]}</script>`,
);
check("גלריה מובנית ללא תקרת 12/16 — כל ה-35 נשלפות", manyStructured.length === 35, String(manyStructured.length));

// --- באג הכפילויות: אותה תמונה בפורמט jpg + jpg_.webp ---
const dupes = extractImages(`
<script>{"imagePathList":["https://ae01.alicdn.com/kf/D1.jpg","https://ae01.alicdn.com/kf/D1.jpg_.webp","https://ae01.alicdn.com/kf/D2.png_960x960q75.png_.avif","https://ae01.alicdn.com/kf/D2.png"]}</script>`);
check("jpg ו-jpg_.webp של אותה תמונה = פעם אחת", dupes.filter((u) => u.includes("D1")).length === 1, dupes.join(" | "));
check("שרשור avif+מידות מזוהה ככפילות", dupes.filter((u) => u.includes("D2")).length === 1, dupes.join(" | "));
check("סה\"כ 2 תמונות ייחודיות", dupes.length === 2, String(dupes.length));

// --- תמונות צבעים (skuPropertyImagePath) נשלפות ---
const sku = extractImages(`
<script>{"imagePathList":["https://ae01.alicdn.com/kf/M.jpg"],"skuVals":[{"skuPropertyImagePath":"https://ae01.alicdn.com/kf/COLOR-GOLD.jpg"},{"skuPropertyImagePath":"https://ae01.alicdn.com/kf/COLOR-SILVER.jpg"}]}</script>`);
check("תמונות צבעי המוצר נשלפות", sku.some((u) => u.includes("COLOR-GOLD")) && sku.some((u) => u.includes("COLOR-SILVER")), sku.join(" | "));

// --- קיצור כותרות ---
const longTitle =
  "2026 New Fashion Jewelry Hot Sale Gold Plated Heart Pendant Necklace For Women Girls Gift Free Shipping Wholesale Dropshipping";
const short = shortenTitle(longTitle);
check("כותרת ארוכה מתקצרת ל-8 מילים לכל היותר", short.split(/\s+/).length <= 8, short);
check("רעשי שיווק מוסרים", !/free shipping|hot sale|wholesale|dropshipping/i.test(short), short);
check("כותרת עד 60 תווים", short.length <= 60, `${short.length}`);

const hebrewTitle = "שרשרת לב מצופה זהב 18K עדינה ומרשימה לנשים, מתנה מושלמת לכל אירוע ולכל גיל";
const hebrewShort = shortenTitle(hebrewTitle);
check("עברית: חיתוך במפריד ושמירה על תחילת השם", hebrewShort.startsWith("שרשרת לב"), hebrewShort);
check("עברית: עד 8 מילים", hebrewShort.split(/\s+/).length <= 8, hebrewShort);

check("כותרת קצרה נשארת כמו שהיא", shortenTitle("טבעת כסף 925") === "טבעת כסף 925");
check("סיומת אתר מוסרת", !/AliExpress/i.test(shortenTitle("Gold Ring - AliExpress 2026")), shortenTitle("Gold Ring - AliExpress 2026"));

// --- קיבוץ לפי קטגוריות ---
const grouped = groupByCategory(
  [
    { cat: "שרשרת", n: 1 },
    { cat: "צמיד-זר", n: 2 },
    { cat: "שעון", n: 3 },
    { cat: "שרשרת", n: 4 },
    { cat: "", n: 5 },
  ],
  (row) => row.cat,
  ["שעון", "שרשרת"],
);
check(
  "סדר הקטגוריות של המשתמש נשמר",
  grouped[0]?.name === "שעון" && grouped[1]?.name === "שרשרת",
  grouped.map((g) => g.name).join(" | "),
);
check("קטגוריות זרות/ריקות בתחתית", grouped.at(-1)?.name !== "שעון" && grouped.length === 4);
check("מוצרים מרובים באותה קטגוריה מקובצים", grouped[1]?.rows.length === 2);
check("קטגוריה ריקה מקבלת תווית", grouped.some((g) => g.name === "ללא קטגוריה"));

// --- חילוץ קישורים מטקסט שיווקי ---
check(
  "קישור בתוך הודעת שיתוף עברית",
  extractUrlFromText("‏₪19.90 | עגילי זהב מהממים! https://a.aliexpress.com/_mNvXyZ לחצו עכשיו!") ===
    "https://a.aliexpress.com/_mNvXyZ",
  String(extractUrlFromText("‏₪19.90 | עגילי זהב! https://a.aliexpress.com/_mNvXyZ לחצו!")),
);
check("פיסוק נדבק מוסר", extractUrlFromText("תראו: https://he.aliexpress.com/item/100500.html, מדהים") === "https://he.aliexpress.com/item/100500.html");
check("קישור נקי נשאר כמו שהוא", extractUrlFromText("https://example.com/p/1") === "https://example.com/p/1");
check("דומיין aliexpress בלי פרוטוקול", extractUrlFromText("מצאתי aliexpress.com/item/42.html שווה") === "https://aliexpress.com/item/42.html");
check("טקסט בלי קישור מחזיר null", extractUrlFromText("סתם טקסט בלי כלום") === null);
check("קלט ריק מחזיר null", extractUrlFromText("   ") === null);

console.log(`\n${passed} בדיקות עברו, ${failed} נכשלו`);
if (failed > 0) process.exit(1);

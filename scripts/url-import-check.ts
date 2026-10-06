/**
 * בדיקות לייבוא מוצר מקישור (חלק 29): חילוץ פרטי מוצר מ-HTML (AliExpress,
 * JSON-LD, og, טבלאות מפרט), בניית התיאור לטופס, והורדת העמוד (הפניה עם
 * עוגייה, קידוד windows-1255, תמונה במקום עמוד, 404, גודל, חסימת כתובת פנימית).
 * הרצה: npx tsx scripts/url-import-check.ts
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

// לקוח ה-Supabase של השרת נבנה בטעינה — כתובת דמה (לא נשלחות אליו בקשות כאן)
process.env["SUPABASE_URL"] ??= "http://127.0.0.1:9";
process.env["VITE_SUPABASE_URL"] ??= "http://127.0.0.1:9";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test";
process.env["SUPABASE_PUBLISHABLE_KEY"] ??= "test";
process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??= "test";

const { parseProductPage } = await import("@/lib/import.server");
const { importDescriptionHtml } = await import("@/lib/url-import");
const { fetchRemotePage, describePageError, looksBlocked, PAGE_MAX_BYTES } =
  await import("@/server/services/page-fetch");

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

// ---------- 1. AliExpress ----------
const ali = parseProductPage(
  `<html><head><title>Gold Heart Necklace - AliExpress 2026</title>
<meta property="og:title" content="2026 New Gold Plated Heart Pendant Necklace For Women | AliExpress" />
<meta property="og:description" content="Smarter Shopping, Better Living! Aliexpress.com" />
<meta property="og:image" content="https://ae01.alicdn.com/kf/MAIN.jpg_960x960.jpg" />
</head><body><script>window.runParams = {"data":{"titleModule":{"formatTradeCount":"500","subject":"2026 New Gold Plated Heart Pendant Necklace For Women Girls Gift Free Shipping"},
"imageModule":{"imagePathList":["https://ae01.alicdn.com/kf/A1.jpg","https://ae01.alicdn.com/kf/A2.jpg_220x220.jpg"]},
"specsModule":{"props":[{"attrName":"Brand Name","attrNameId":2,"attrValue":"NURI"},{"attrValue":"Copper","attrName":"Material"},{"attrName":"Gender","attrValue":"Women"}]},
"skuModule":{"productSKUPropertyList":[{"skuPropertyValues":[{"skuPropertyImagePath":"https://ae01.alicdn.com/kf/GOLD.jpg_50x50.jpg"}]}]}}};</script></body></html>`,
  "https://he.aliexpress.com/item/1005001.html",
);
check(
  "ali: title from titleModule.subject",
  ali.title.startsWith("2026 New Gold Plated Heart"),
  ali.title,
);
check(
  "ali: short title — no marketing noise, ≤ 8 words",
  ali.shortTitle.startsWith("Gold Plated Heart") &&
    !/free shipping|2026/i.test(ali.shortTitle) &&
    ali.shortTitle.split(" ").length <= 8,
  ali.shortTitle,
);
check("ali: site boilerplate is not a description", ali.description === "", ali.description);
check(
  "ali: specs in page order (attrValue before attrName too)",
  JSON.stringify(ali.specs) ===
    JSON.stringify([
      { name: "Brand Name", value: "NURI" },
      { name: "Material", value: "Copper" },
      { name: "Gender", value: "Women" },
    ]),
  ali.specs,
);
check(
  "ali: gallery → color images → og, full size, no duplicates",
  JSON.stringify(ali.images) ===
    JSON.stringify([
      "https://ae01.alicdn.com/kf/A1.jpg",
      "https://ae01.alicdn.com/kf/A2.jpg",
      "https://ae01.alicdn.com/kf/GOLD.jpg",
      "https://ae01.alicdn.com/kf/MAIN.jpg",
    ]),
  ali.images,
);
check("ali: no price → null", ali.price === null && ali.currency === null);
check("ali: site name from host", ali.siteName === "he.aliexpress.com", ali.siteName);

// ---------- 2. חנות עם JSON-LD (Shopify / WooCommerce) ----------
const shop = parseProductPage(
  `<html><head><meta property="og:site_name" content="חנות הדוגמה" />
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","logo":"https://shop.example/logo-big.png"},
{"@type":"Product","name":"כוס קפה &quot;בוקר&quot; 350 מ&#39;&#39;ל","description":"כוס קרמיקה איכותית.<br>מתאימה למדיח.",
"image":["https://shop.example/cdn/cup1.jpg",{"url":"/cdn/cup2.jpg"}],
"offers":{"@type":"Offer","price":"49.90","priceCurrency":"ILS"},
"additionalProperty":[{"name":"חומר","value":"קרמיקה"},{"name":"נפח","value":"350 מ\\"ל"}]}]}</script>
</head><body>
<img srcset="/cdn/cup3-small.jpg 300w, /cdn/cup3-large.jpg 1200w" src="/cdn/cup3-small.jpg">
<img src="/assets/logo.svg"><img src="/cdn/payment-visa.png"><img src="/cdn/real.jpg" width="1" height="1">
</body></html>`,
  "https://shop.example/products/cup",
);
check("ld: entities decoded in the name", shop.title === "כוס קפה \"בוקר\" 350 מ''ל", shop.title);
check(
  "ld: description keeps line breaks",
  shop.description === "כוס קרמיקה איכותית.\nמתאימה למדיח.",
  shop.description,
);
check("ld: price + currency", shop.price === 49.9 && shop.currency === "ILS", [
  shop.price,
  shop.currency,
]);
check(
  "ld: additionalProperty → specs",
  shop.specs.length === 2 && shop.specs[1]?.value === '350 מ"ל',
  shop.specs,
);
check(
  "ld: product images (relative resolved) + largest srcset; no logo / svg / payment / 1px",
  JSON.stringify(shop.images) ===
    JSON.stringify([
      "https://shop.example/cdn/cup1.jpg",
      "https://shop.example/cdn/cup2.jpg",
      "https://shop.example/cdn/cup3-large.jpg",
    ]),
  shop.images,
);
check("ld: og:site_name", shop.siteName === "חנות הדוגמה", shop.siteName);

// ---------- 3. עמוד כללי: h1, טבלת מפרט, dl ----------
const generic = parseProductPage(
  `<html><head><title>Wireless Mouse M200 | TechShop</title></head><body>
<h1> Wireless   Mouse <b>M200</b></h1>
<table><tr><th>Color</th><td>Black</td></tr><tr><td>Weight</td><td>85 g</td></tr><tr><td colspan="3">ignored</td></tr></table>
<dl><dt>Battery:</dt><dd>AA</dd></dl>
<img src="https://cdn.techshop.example/m200-front.jpg"><img src="https://cdn.techshop.example/icons/cart.png">
</body></html>`,
  "https://techshop.example/m200",
);
check("generic: title from <h1>", generic.title === "Wireless Mouse M200", generic.title);
check(
  "generic: table rows + dl → specs",
  JSON.stringify(generic.specs.map((spec) => `${spec.name}=${spec.value}`)) ===
    JSON.stringify(["Color=Black", "Weight=85 g", "Battery=AA"]),
  generic.specs,
);
check(
  "generic: product image only (icon filtered)",
  JSON.stringify(generic.images) ===
    JSON.stringify(["https://cdn.techshop.example/m200-front.jpg"]),
  generic.images,
);

// ---------- 4. עמוד חסימה ----------
const blockedHtml =
  '<html><head><title>Captcha Interception</title></head><body><script src="//g.alicdn.com/sd/punish/1.js"></script></body></html>';
check(
  "blocked: captcha page detected",
  looksBlocked(blockedHtml, "https://he.aliexpress.com/item/1.html"),
);
check(
  "blocked: login redirect detected",
  looksBlocked("<html></html>", "https://login.aliexpress.com/x"),
);
check(
  "blocked: normal page is not blocked",
  !looksBlocked("<html><h1>Mouse</h1></html>", "https://shop.example/p"),
);
check(
  "blocked: parser finds no images there",
  parseProductPage(blockedHtml, "https://he.aliexpress.com/item/1.html").images.length === 0,
);

// ---------- 5. התיאור לטופס ----------
const html = importDescriptionHtml(
  "שורה ראשונה\nשורה <b>שנייה</b>",
  [{ name: "חומר", value: "<script>alert(1)</script>" }],
  { description: true, specs: true },
);
check(
  "description: paragraphs + spec list, everything escaped",
  html ===
    "<p>שורה ראשונה</p><p>שורה &lt;b&gt;שנייה&lt;/b&gt;</p><p><strong>מפרט</strong></p><ul><li><strong>חומר:</strong> &lt;script&gt;alert(1)&lt;/script&gt;</li></ul>",
  html,
);
check(
  "description: unchecked parts are left out",
  importDescriptionHtml("טקסט", [{ name: "a", value: "b" }], {
    description: false,
    specs: false,
  }) === "",
);

// ---------- 6. הורדת העמוד (שרת מקומי) ----------
const hebrew1255 = Buffer.concat([
  Buffer.from("<html><head><title>"),
  Buffer.from([0xf9, 0xec, 0xe5, 0xed]), // "שלום" ב-windows-1255
  Buffer.from("</title></head></html>"),
]);
const server = http.createServer((request, response) => {
  if (request.url === "/start") {
    response.writeHead(302, { Location: "/product", "Set-Cookie": "region=IL; Path=/; HttpOnly" });
    response.end();
  } else if (request.url === "/product") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      `<html><head><meta property="og:title" content="cookie=${request.headers.cookie ?? "none"}"></head></html>`,
    );
  } else if (request.url === "/hebrew") {
    response.writeHead(200, { "Content-Type": "text/html; charset=windows-1255" });
    response.end(hebrew1255);
  } else if (request.url === "/image") {
    response.writeHead(200, { "Content-Type": "image/jpeg" });
    response.end(Buffer.alloc(16));
  } else if (request.url === "/big") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(Buffer.alloc(PAGE_MAX_BYTES + 16, 97));
  } else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const failure = async (url: string): Promise<string> => {
  try {
    await fetchRemotePage(url);
    return "(no error)";
  } catch (error) {
    return describePageError(error);
  }
};
process.env["IMPORT_IMAGE_ALLOW_HOSTS"] = "127.0.0.1";
const redirected = await fetchRemotePage(`${base}/start`);
check(
  "fetch: redirect followed, cookie sent back",
  redirected.html.includes("cookie=region=IL"),
  redirected.html,
);
check(
  "fetch: final url after the redirect",
  redirected.finalUrl === `${base}/product`,
  redirected.finalUrl,
);
check(
  "fetch: windows-1255 decoded",
  (await fetchRemotePage(`${base}/hebrew`)).html.includes("שלום"),
);
check(
  "fetch: image instead of a page",
  (await failure(`${base}/image`)).includes("תמונה"),
  await failure(`${base}/image`),
);
check(
  "fetch: 404",
  (await failure(`${base}/missing`)).includes("לא נמצא"),
  await failure(`${base}/missing`),
);
check(
  "fetch: over 6MB",
  (await failure(`${base}/big`)).includes("גדול מדי"),
  await failure(`${base}/big`),
);
process.env["IMPORT_IMAGE_ALLOW_HOSTS"] = "";
check(
  "fetch: internal address blocked (SSRF)",
  (await failure(`${base}/product`)).includes("פנימית"),
  await failure(`${base}/product`),
);
check(
  "fetch: non-http link rejected",
  (await failure("ftp://example.com/x")).includes("http"),
  await failure("ftp://example.com/x"),
);
server.close();

console.log(`\n${passed} בדיקות עברו, ${failed} נכשלו`);
if (failed > 0) process.exit(1);

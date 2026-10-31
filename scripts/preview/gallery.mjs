#!/usr/bin/env node
// דף צפייה מקומי לסיור המוקלט (P0): כל צילומי המסך והסרטונים מ-e2e/preview/out,
// לפי התהליך — במחשב ובטלפון. קובץ סטטי אחד (index.html), בלי שום חיבור החוצה.
import { readdirSync, writeFileSync } from "node:fs";

const OUT = process.argv[2] ?? new URL("../../e2e/preview/out/", import.meta.url).pathname;
const list = (dir) => {
  try {
    return readdirSync(`${OUT}/${dir}`).sort();
  } catch {
    return [];
  }
};
const esc = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const label = (file) => esc(file.replace(/\.(png|mp4|webm)$/, "").replace(/^(desktop|phone)-/, ""));

const screens = list("screens");
const videos = list("videos");
const section = (device, title) => `
  <h2>${title}</h2>
  <h3>סרטונים</h3>
  <div class="grid">${videos
    .filter((f) => f.startsWith(`${device}-`))
    .map(
      (f) =>
        `<figure><video src="videos/${esc(f)}" controls preload="metadata" playsinline></video><figcaption>${label(f)}</figcaption></figure>`,
    )
    .join("")}</div>
  <h3>צילומי מסך</h3>
  <div class="grid">${screens
    .filter((f) => f.startsWith(`${device}-`))
    .map(
      (f) =>
        `<figure><a href="screens/${esc(f)}"><img src="screens/${esc(f)}" alt="${label(f)}" loading="lazy"></a><figcaption>${label(f)}</figcaption></figure>`,
    )
    .join("")}</div>`;

writeFileSync(
  `${OUT}/index.html`,
  `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>תצוגה מקומית — Hospitality</title>
<style>
body{font-family:system-ui,sans-serif;margin:0 auto;max-width:1200px;padding:16px;background:#fafafa;color:#222}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
figure{margin:0;background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px}
img,video{width:100%;height:auto;border-radius:4px;display:block}
figcaption{font-size:13px;margin-top:6px;color:#555;direction:ltr;text-align:right}
</style></head><body>
<h1>תצוגה מקומית — Hospitality (נתוני הדגמה)</h1>
<p>נוצר אוטומטית מהסיור המוקלט (e2e/preview/walkthrough.spec.ts). נתונים פיקטיביים בלבד.</p>
${section("desktop", "מחשב")}
${section("phone", "טלפון")}
</body></html>
`,
);
console.log(`gallery: ${screens.length} screenshots, ${videos.length} videos → ${OUT}/index.html`);

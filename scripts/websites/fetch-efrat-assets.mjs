#!/usr/bin/env node
// הקבצים של האתר הישן של אפרת (efratadir.com) לשחזור הנאמן — לתצוגה המקדימה המקומית בלבד (לא ב-Git, לא מתפרסם).
//   • התמונות והגופנים: לפי הרשימה ב-docs/websites/faithful/efrat-source.json (כתובת המקור של כל קובץ);
//   • 5 אייקוני השירותים: ה-SVG שבדף הבית, מומרים לתמונה לבנה (PNG) — כמו שהם מוצגים באתר;
//   • העט: הפריים האחרון של אנימציית ה-Lottie, צילום של הרכיב בדף (רקע שקוף).
// אבטחה: רק https://efratadir.com, רק תחת ‎/wp-content/uploads/‎ (חוץ מדף הבית), בלי מעקב אחרי הפניות, עד 15MB לקובץ,
// בדיקת חתימת הקובץ (תמונה / WOFF2) לפני שהוא נשמר, ושמות קבצים מהרשימה שלנו בלבד (לא מהרשת).
// ה-SVG עובר ניקוי (בלי script, foreignObject, קישורים חיצוניים) לפני ההמרה.
// שימוש: node scripts/websites/fetch-efrat-assets.mjs [תיקייה]   (ברירת מחדל: ‎.cache/efrat-faithful)
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = new URL("../../", import.meta.url);
const source = JSON.parse(
  readFileSync(new URL("docs/websites/faithful/efrat-source.json", ROOT), "utf8"),
);
const OUT = process.argv[2] ?? new URL(".cache/efrat-faithful", ROOT).pathname;
mkdirSync(OUT, { recursive: true });

const HOST = "efratadir.com";
const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}$/;
const MAGIC = [
  [Buffer.from([0xff, 0xd8, 0xff]), "image"],
  [Buffer.from("\x89PNG", "latin1"), "image"],
  [Buffer.from("RIFF"), "image"],
  [Buffer.from("GIF8"), "image"],
  [Buffer.from("wOF2"), "font"],
];

function allowed(url, { page = false } = {}) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== HOST || u.port !== "") return false;
  return page ? u.pathname === "/" : u.pathname.startsWith("/wp-content/uploads/");
}

function download(url, kind) {
  const tmp = join(OUT, `.part-${process.pid}`);
  rmSync(tmp, { force: true });
  const u = new URL(url);
  const code = execFileSync(
    "curl",
    [
      "-sS",
      "--proto",
      "=https",
      "--max-redirs",
      "0",
      "--max-filesize",
      "15000000",
      "--max-time",
      "60",
      "-o",
      tmp,
      "-w",
      "%{http_code}",
      u.href,
    ],
    { encoding: "utf8" },
  ).trim();
  if (code !== "200" || !existsSync(tmp)) throw new Error(`${url}: HTTP ${code}`);
  const head = readFileSync(tmp).subarray(0, 12);
  const found = MAGIC.find(([m]) => head.subarray(0, m.length).equals(m))?.[1];
  const webpOk =
    !head.subarray(0, 4).equals(Buffer.from("RIFF")) || head.subarray(8, 12).toString() === "WEBP";
  if (found !== kind || !webpOk) {
    rmSync(tmp, { force: true });
    throw new Error(`${url}: not a ${kind}`);
  }
  return tmp;
}

const files = new Map(); // file name → source URL + kind
const add = (file, url, kind) => {
  if (!file || !url) return;
  if (!SAFE_NAME.test(file)) throw new Error(`bad file name ${file}`);
  if (!allowed(url)) throw new Error(`not allowed ${url}`);
  files.set(file, { url, kind });
};
for (const t of source.testimonials.items) add(t.file, t.source, "image");
for (const w of source.portfolio.items) add(w.file, w.source, "image");
for (const f of source.fonts) add(f.file, f.source, "font");
for (const [file, url] of Object.entries(source.images ?? {})) add(file, url, "image");

let fetched = 0;
for (const [file, { url, kind }] of files) {
  const dest = join(OUT, file);
  if (existsSync(dest) && statSync(dest).size > 0) continue;
  renameSync(download(url, kind), dest);
  fetched += 1;
}

// אייקוני השירותים (SVG בתוך דף הבית) → PNG לבן 200px
const sharp = require("sharp");
const needIcons = source.services.items.some((s) => !existsSync(join(OUT, s.icon)));
const needPen = !existsSync(join(OUT, source.pen.file));
if (needIcons) {
  const home = `https://${HOST}/`;
  if (!allowed(home, { page: true })) throw new Error("home not allowed");
  const tmp = join(OUT, `.home-${process.pid}`);
  execFileSync("curl", [
    "-sS",
    "--proto",
    "=https",
    "--max-redirs",
    "0",
    "--max-filesize",
    "3000000",
    "--max-time",
    "60",
    "-o",
    tmp,
    home,
  ]);
  const html = readFileSync(tmp, "utf8");
  rmSync(tmp, { force: true });
  const icons = [
    ...html.matchAll(/elementor-icon-box-icon[\s\S]{0,400}?(<svg[\s\S]*?<\/svg>)/g),
  ].map((m) => m[1]);
  if (icons.length < source.services.items.length) throw new Error(`found ${icons.length} icons`);
  for (const [i, s] of source.services.items.entries()) {
    const clean = icons[i]
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
      .replace(/\s(?:xlink:)?href\s*=\s*"(?!#)[^"]*"/gi, "")
      .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
      .replace(/\s(width|height)="[^"]*"/g, "")
      .replace(/<svg\b([^>]*)>/, "<svg$1><style>svg,svg *{fill:#fff;color:#fff}</style>");
    await sharp(Buffer.from(clean), { density: 300 })
      .resize(200, 200, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(join(OUT, s.icon));
  }
}

// העט: הפריים של ה-Lottie שבו הציור שלם (העט והקו שהוא מצייר) — צילום הרכיב בדף, רקע שקוף, ברזולוציה כפולה
if (needPen) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch(
    process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {},
  );
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  ).newPage();
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === HOST ? route.continue() : route.abort(),
  );
  await page.goto(`https://${HOST}/`, { waitUntil: "networkidle", timeout: 90_000 });
  const lottie = page.locator('[data-widget_type^="lottie"]').first();
  await lottie.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await lottie.evaluate((el) => {
    for (let e = el; e; e = e.parentElement)
      e.style.setProperty("background", "transparent", "important");
  });
  const svg = lottie.locator("svg").first();
  const frames = await page.evaluate(
    () => window.lottie?.getRegisteredAnimations?.()[0]?.totalFrames ?? 0,
  );
  let best = { frame: 0, drawn: -1 };
  for (let f = 0; f < frames; f += 5) {
    await page.evaluate(
      (fr) => window.lottie.getRegisteredAnimations()[0].goToAndStop(fr, true),
      f,
    );
    const { data, info } = await sharp(await svg.screenshot({ omitBackground: true }))
      .raw()
      .toBuffer({ resolveWithObject: true });
    let drawn = 0;
    for (let i = 3; i < data.length; i += info.channels) if (data[i] > 128) drawn++;
    if (drawn > best.drawn) best = { frame: f, drawn };
  }
  await page.evaluate(
    (fr) => window.lottie?.getRegisteredAnimations?.()[0]?.goToAndStop(fr, true),
    best.frame,
  );
  await svg.screenshot({ path: join(OUT, source.pen.file), omitBackground: true });
  await browser.close();
}

const missing = [
  ...files.keys(),
  source.pen.file,
  ...source.services.items.map((s) => s.icon),
].filter((f) => !existsSync(join(OUT, f)));
writeFileSync(join(OUT, "READY"), missing.length ? "" : "ok\n");
console.log(
  `assets in ${OUT}: ${files.size + 1 + source.services.items.length} files (${fetched} downloaded now)` +
    (missing.length ? `; missing: ${missing.join(", ")}` : ""),
);
if (missing.length) process.exit(1);

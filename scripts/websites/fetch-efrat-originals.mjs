#!/usr/bin/env node
// ============================================================
// הכנת קובצי האתר של אפרת בשרת (בלי curl, בלי sharp, בלי דפדפן — Node 22 בלבד):
//   • 94 קובצי המקור — הורדה מ-https://efratadir.com/wp-content/uploads/… בלבד (https, בלי הפניות, עד 15MB,
//     עד 60 שניות לקובץ, בדיקת סוג הקובץ לפי התוכן);
//   • 6 הקבצים שהופקו אצלנו (אייקוני השירותים ופריים העט) — מ-scripts/websites/efrat-derived (ב-Git);
//   • ואז בדיקה מול המניפסט (SHA-256): כל 100 הקבצים זהים בדיוק למה שנבדק. אחרת — עצירה.
// שימוש: node scripts/websites/fetch-efrat-originals.mjs [תיקייה]   (ברירת מחדל ‎.cache/efrat-faithful)
// אידמפוטנטי: קובץ קיים עם ה-hash הנכון לא מורד שוב.
// ============================================================
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assetFiles, loadSource } from "./efrat-faithful.mjs";
import { sha256File, verifyAssets } from "./verify-efrat-assets.mjs";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? join(HERE, "..", "..", ".cache/efrat-faithful");
mkdirSync(OUT, { recursive: true });
const HOST = "efratadir.com";
const MAX = 15_000_000;
const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}$/;
const MAGIC = [
  [Buffer.from([0xff, 0xd8, 0xff]), "image"],
  [Buffer.from("\x89PNG", "latin1"), "image"],
  [Buffer.from("RIFF"), "image"],
  [Buffer.from("GIF8"), "image"],
  [Buffer.from("wOF2"), "font"],
];

const src = loadSource();
const manifest = JSON.parse(readFileSync(join(HERE, "efrat-assets-manifest.json"), "utf8"));
const { all, derived } = assetFiles(src);
const urls = new Map();
for (const t of src.testimonials.items) urls.set(t.file, { url: t.source, kind: "image" });
for (const w of src.portfolio.items) urls.set(w.file, { url: w.source, kind: "image" });
for (const f of src.fonts) urls.set(f.file, { url: f.source, kind: "font" });
for (const [file, url] of Object.entries(src.images ?? {})) urls.set(file, { url, kind: "image" });

function allowed(url) {
  const u = new URL(url);
  return (
    u.protocol === "https:" &&
    u.hostname === HOST &&
    u.port === "" &&
    u.pathname.startsWith("/wp-content/uploads/")
  );
}

async function download(file, { url, kind }) {
  if (!SAFE_NAME.test(file)) throw new Error(`bad file name ${file}`);
  if (!allowed(url)) throw new Error(`not allowed: ${url}`);
  const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
  if (res.status !== 200) throw new Error(`${url}: HTTP ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX) throw new Error(`${url}: too large`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX) throw new Error(`${url}: too large`);
  const head = buf.subarray(0, 12);
  const found = MAGIC.find(([m]) => head.subarray(0, m.length).equals(m))?.[1];
  const webpOk =
    !head.subarray(0, 4).equals(Buffer.from("RIFF")) || head.subarray(8, 12).toString() === "WEBP";
  if (found !== kind || !webpOk) throw new Error(`${url}: not a ${kind}`);
  const tmp = join(OUT, `.part-${process.pid}`);
  writeFileSync(tmp, buf);
  renameSync(tmp, join(OUT, file));
}

let fetched = 0;
let kept = 0;
for (const f of all) {
  const dest = join(OUT, f);
  const want = manifest.files[f]?.sha256;
  if (existsSync(dest) && want && sha256File(dest) === want) {
    kept += 1;
    continue;
  }
  if (derived.includes(f)) {
    copyFileSync(join(HERE, "efrat-derived", f), dest);
    continue;
  }
  const entry = urls.get(f);
  if (!entry) throw new Error(`no source URL for ${f}`);
  rmSync(dest, { force: true });
  await download(f, entry);
  fetched += 1;
  if (fetched % 20 === 0) console.log(`  ${fetched} downloaded…`);
}

const r = verifyAssets(OUT);
console.log(
  JSON.stringify(
    {
      pass: r.problems.length === 0,
      folder: OUT,
      files: `${r.ok}/${r.total} identical to the tested files (SHA-256)`,
      downloaded_now: fetched,
      already_ok: kept,
      derived_from_git: derived.length,
      bytes: r.bytes,
      problems: r.problems,
    },
    null,
    1,
  ),
);
process.exit(r.problems.length ? 1 : 0);

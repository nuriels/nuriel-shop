#!/usr/bin/env node
// ============================================================
// העברת התוכן והמדיה של האתר של אפרת לאתר שנפתח בסביבת יעד (בדיקה / Staging / ייצור — רק באישור).
// התמונות והגופנים אינם ב-Git: הם נשמרים באחסון של הסביבה ובספריית המדיה של האתר. הסקריפט מעלה אותם
// דרך פונקציות ההעלאה הרגילות של ממשק הניהול (אותן בדיקות סוג / גודל / המרה ל-WebP כמו בעורך), ושומר את
// הטיוטה מתוך docs/websites/faithful/efrat-source.json — בדיוק כמו בדיקת השחזור הנאמן.
//
//   • לא מפרסם ולא משנה DNS: רק ספריית המדיה והטיוטה של האתר שבכתובת היעד;
//   • אידמפוטנטי: קובץ שכבר בספרייה (אותו שם + אותו תוכן) לא מועלה שוב; הרצה חוזרת = אותה טיוטה;
//   • --dry-run: רק מציג מה היה מועלה / נשמר;
//   • ההרשאה: חיבור של מנהל הפלטפורמה (או בעל האתר) — ACCESS_TOKEN, או EMAIL + PASSWORD מול ה-Supabase של
//     הסביבה. לא נשמר שום טוקן לקובץ.
//
// דרישות: הקבצים בתיקייה (ברירת מחדל ‎.cache/efrat-faithful — node scripts/websites/fetch-efrat-assets.mjs),
//         האתר כבר נפתח בפאנל הפלטפורמה בכתובת היעד.
// שימוש:
//   TARGET_ORIGIN=https://efrat.nuri1.fit EXPECT_SLUG=efrat EMAIL=<מנהל הפלטפורמה> SUPABASE_URL=… \
//     SUPABASE_PUBLISHABLE_KEY=… node scripts/websites/import-efrat-site.mjs [--dry-run]
//     (הסיסמה נשאלת במסוף ולא מוצגת; או ACCESS_TOKEN). לפני כל העלאה: 100 הקבצים זהים למניפסט (SHA-256).
//   TARGET_ORIGIN=http://efrat-classic.shop.localhost:3100 SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... \
//     EMAIL=platform@e2e.test PASSWORD=... node scripts/websites/import-efrat-site.mjs
// ============================================================
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assetFiles, buildFaithfulDocument, loadSource } from "./efrat-faithful.mjs";
import { verifyAssets } from "./verify-efrat-assets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(ROOT, "package.json"));
const { toJSONAsync, fromJSON } = require("seroval");

const DRY = process.argv.includes("--dry-run");
const ORIGIN = (process.env.TARGET_ORIGIN ?? "").replace(/\/$/, "");
const ASSETS = process.env.ASSETS_DIR ?? join(ROOT, ".cache/efrat-faithful");
if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(ORIGIN))
  throw new Error("TARGET_ORIGIN=https://<site host> is required");
if (!existsSync(ASSETS))
  throw new Error(
    `assets folder missing: ${ASSETS} (run scripts/websites/fetch-efrat-originals.mjs)`,
  );
const HOST = new URL(ORIGIN).host.replace(/:\d+$/, "");
// CONNECT_TO: מתחברים ישירות לאפליקציה (מקומית 127.0.0.1:3100; בשרת 127.0.0.1:3700 — deploy/websites-efrat.sh) והאתר
// מזוהה לפי x-forwarded-host, כמו מאחורי nginx — בלי תלות ב-DNS או בתעודה של הכתובת החדשה
const CONNECT = process.env.CONNECT_TO ? `http://${process.env.CONNECT_TO}` : ORIGIN;

const MEDIA_FN = "src/engines/business-profile/api/media.functions.ts";
const STUDIO_FN = "src/engines/business-profile/api/studio.functions.ts";
const MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  woff2: "font/woff2",
};
const fnId = (file, name) =>
  createHash("sha256").update(`${file}--${name}_createServerFn_handler`).digest("hex");
const stamped = (file) =>
  `${file}#${createHash("sha256")
    .update(readFileSync(join(ASSETS, file)))
    .digest("hex")
    .slice(0, 10)}`;

/** סיסמה מהמסוף בלי להציג אותה (לא נשמרת, לא נרשמת) */
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY)
      return reject(new Error("no terminal for the password — set PASSWORD or ACCESS_TOKEN"));
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    let value = "";
    const onData = (buf) => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.exit(130);
        }
        if (ch === "\u007f") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function token() {
  if (process.env.ACCESS_TOKEN) return process.env.ACCESS_TOKEN;
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, EMAIL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !EMAIL)
    throw new Error(
      "set ACCESS_TOKEN, or SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY + EMAIL (the password is asked)",
    );
  const PASSWORD = process.env.PASSWORD || (await askHidden(`password for ${EMAIL}: `));
  const r = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`login failed (HTTP ${r.status})`);
  return (await r.json()).access_token;
}

const baseHeaders = (tok) => ({
  "sec-fetch-site": "same-origin",
  "x-tsr-serverFn": "true",
  origin: ORIGIN,
  authorization: `Bearer ${tok}`,
  ...(process.env.CONNECT_TO ? { "x-forwarded-host": HOST } : {}),
});

function decode(text) {
  if (text.includes('"$TSR/Error"')) {
    const m = /"message":\{"t":1,"s":("(?:[^"\\]|\\.)*")\}/.exec(text);
    throw new Error(m ? JSON.parse(m[1]) : text.slice(0, 300));
  }
  return fromJSON({ t: JSON.parse(text), f: 127, m: [] }).result;
}

async function call(tok, file, name, data, method = "POST") {
  const payload = JSON.stringify(await toJSONAsync({ data }));
  const url = `${CONNECT}/_serverFn/${fnId(file, name)}`;
  const r =
    method === "GET"
      ? await fetch(`${url}?payload=${encodeURIComponent(payload)}`, {
          headers: { ...baseHeaders(tok), accept: "application/json" },
        })
      : await fetch(url, {
          method: "POST",
          headers: {
            ...baseHeaders(tok),
            accept: "application/json",
            "content-type": "application/json",
          },
          body: payload,
        });
  const text = await r.text();
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status} ${text.slice(0, 200)}`);
  return decode(text);
}

async function upload(tok, fn, file, fields = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const ext = file.split(".").pop().toLowerCase();
  fd.set(
    "file",
    new Blob([readFileSync(join(ASSETS, file))], { type: MIME[ext] ?? "application/octet-stream" }),
    stamped(file),
  );
  const r = await fetch(`${CONNECT}/_serverFn/${fnId(MEDIA_FN, fn)}`, {
    method: "POST",
    headers: baseHeaders(tok),
    body: fd,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status} ${text.slice(0, 200)}`);
  decode(text);
}

const source = loadSource();
const { images } = assetFiles(source);
const missingLocal = [...images, ...source.fonts.map((f) => f.file)].filter(
  (f) => !existsSync(join(ASSETS, f)),
);
if (missingLocal.length) throw new Error(`missing local files: ${missingLocal.join(", ")}`);
// בדיוק הקבצים שנבדקו — אחרת לא מעלים כלום
const verified = verifyAssets(ASSETS);
if (verified.problems.length)
  throw new Error(
    `the files differ from the tested set (SHA-256): ${verified.problems.slice(0, 5).join("; ")}`,
  );
console.log(`files: ${verified.ok}/${verified.total} identical to the tested set (SHA-256)`);

const tok = await token();
const res = await call(tok, STUDIO_FN, "studioContext", undefined, "GET");
if (res?.state !== "ok")
  throw new Error(
    `no access to the site at TARGET_ORIGIN (${res?.state ?? "?"}) — log in as the platform admin / owner`,
  );
const ctx = res.context;
console.log(`site: ${ctx.site.name} (${ctx.site.slug}) on ${HOST} — state: ${ctx.state?.status}`);
if (process.env.EXPECT_SLUG && ctx.site.slug !== process.env.EXPECT_SLUG)
  throw new Error(
    `this is not the expected site (${ctx.site.slug} ≠ ${process.env.EXPECT_SLUG}) — nothing changed`,
  );

const library = async () =>
  (await call(tok, MEDIA_FN, "studioMedia", undefined, "GET")).items ?? [];
const have = new Set((await library()).map((m) => m.original_name));
const todoImages = images.filter((f) => !have.has(stamped(f)));
const todoFonts = source.fonts.filter((f) => !have.has(stamped(f.file)));
console.log(
  `library: ${have.size} files; to upload: ${todoImages.length} images, ${todoFonts.length} fonts`,
);
if (DRY) {
  console.log("dry run — nothing uploaded or saved");
  process.exit(0);
}
let n = 0;
for (const f of todoImages) {
  await upload(tok, "studioUploadMedia", f);
  if (++n % 10 === 0) console.log(`  ${n}/${todoImages.length} images`);
}
for (const f of todoFonts)
  await upload(tok, "studioUploadFont", f.file, {
    family: f.family,
    weight: f.weight,
    style: f.style,
    unicodeRange: f.unicodeRange,
    license: f.license,
  });

const ids = Object.fromEntries(
  (await library()).map((m) => [String(m.original_name).split("#")[0], m.id]),
);
const missing = [...images, ...source.fonts.map((f) => f.file)].filter((f) => !ids[f]);
if (missing.length) throw new Error(`not in the library after upload: ${missing.join(", ")}`);
const draft = await call(tok, STUDIO_FN, "studioDraft", undefined, "GET");
const saved = await call(tok, STUDIO_FN, "studioSaveDraft", {
  document: buildFaithfulDocument(source, ids),
  revision: draft.revision,
});
console.log(
  `draft saved (revision ${saved.revision}) — ${images.length} images + ${source.fonts.length} fonts in the library. Not published.`,
);

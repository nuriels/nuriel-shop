#!/usr/bin/env node
// ============================================================
// רשימת קובצי האתר של אפרת עם SHA-256 — כדי שבשרת יועלו בדיוק אותם קבצים שנבדקו בסביבת הבדיקה.
//   node scripts/websites/verify-efrat-assets.mjs            בדיקה: כל 100 הקבצים קיימים וה-hash זהה למניפסט
//   node scripts/websites/verify-efrat-assets.mjs --write    (סביבת הפיתוח בלבד) כתיבת המניפסט מהקבצים שנבדקו
// ASSETS_DIR — תיקיית הקבצים (ברירת מחדל ‎.cache/efrat-faithful). בלי רשת, בלי תלויות.
// ============================================================
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assetFiles, loadSource } from "./efrat-faithful.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
export const MANIFEST = join(HERE, "efrat-assets-manifest.json");
const ASSETS = process.env.ASSETS_DIR ?? join(ROOT, ".cache/efrat-faithful");

export const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

export function verifyAssets(dir = ASSETS) {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const { all } = assetFiles(loadSource());
  const problems = [];
  let bytes = 0;
  for (const f of all) {
    const want = manifest.files[f];
    if (!want) problems.push(`${f}: not in the manifest`);
    else if (!existsSync(join(dir, f))) problems.push(`${f}: missing`);
    else {
      const got = sha256File(join(dir, f));
      if (got !== want.sha256)
        problems.push(`${f}: sha256 ${got.slice(0, 12)}… ≠ ${want.sha256.slice(0, 12)}…`);
      else bytes += want.bytes;
    }
  }
  return { total: all.length, ok: all.length - problems.length, bytes, problems };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--write")) {
    const { all, derived } = assetFiles(loadSource());
    const files = {};
    for (const f of all) {
      const p = join(ASSETS, f);
      if (!existsSync(p)) throw new Error(`missing ${p}`);
      files[f] = {
        sha256: sha256File(p),
        bytes: readFileSync(p).length,
        source: derived.includes(f) ? "derived" : "efratadir.com",
      };
    }
    writeFileSync(
      MANIFEST,
      `${JSON.stringify({ note: "קובצי האתר של אפרת שנבדקו בסביבת הבדיקה (90 תמונות + 10 גופנים)", count: all.length, files }, null, 1)}\n`,
    );
    console.log(`manifest written: ${all.length} files`);
  } else {
    const r = verifyAssets();
    console.log(
      JSON.stringify(
        {
          pass: r.problems.length === 0,
          files: `${r.ok}/${r.total}`,
          bytes: r.bytes,
          problems: r.problems,
        },
        null,
        1,
      ),
    );
    process.exit(r.problems.length ? 1 : 0);
  }
}

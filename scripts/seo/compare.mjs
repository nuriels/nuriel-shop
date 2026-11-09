#!/usr/bin/env node
// ============================================================
// השוואה בין שני Snapshot-ים של SEO (scripts/seo/snapshot.mjs) — קריאה בלבד.
// מדפיס כל הבדל עם חומרה. קוד יציאה 1 כשיש הבדל CRITICAL (דף שנעלם מה-sitemap, קוד תגובה,
// noindex, canonical, חסימה ב-robots.txt, קוד אימות שנעלם, הפניה שהשתנתה).
//   node scripts/seo/compare.mjs before.json after.json
// ============================================================
import { readFileSync } from "node:fs";
import { compareSnapshots } from "./lib.mjs";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("שימוש: node scripts/seo/compare.mjs before.json after.json");
  process.exit(2);
}
const before = JSON.parse(readFileSync(beforePath, "utf8"));
const after = JSON.parse(readFileSync(afterPath, "utf8"));
const diffs = compareSnapshots(before, after);
const show = (v) =>
  v === null || v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v);
console.log(
  `before: ${before.origin} @ ${before.capturedAt}\nafter:  ${after.origin} @ ${after.capturedAt}`,
);
for (const d of diffs)
  console.log(
    `${d.severity.padEnd(8)} ${d.area} · ${d.key}\n         ${show(d.before)}  →  ${show(d.after)}`,
  );
const count = (s) => diffs.filter((d) => d.severity === s).length;
console.log(
  `\n${diffs.length} differences: ${count("CRITICAL")} critical, ${count("WARNING")} warning, ${count("INFO")} info`,
);
process.exit(count("CRITICAL") > 0 ? 1 : 0);

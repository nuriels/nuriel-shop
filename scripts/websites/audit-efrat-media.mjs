#!/usr/bin/env node
// ============================================================
// בדיקת התוכן והמדיה של האתר של אפרת לפני פריסה — האתר הישן (מלאי: docs/websites/faithful/efrat-source.json)
// מול האתר החדש (ספריית המדיה + הטיוטה במסד, הקבצים באחסון, והכתובות שהאתר מגיש).
//
// בודק:
//   • כל תמונה מהאתר הישן נמצאת בספריית האתר (לפי שם הקובץ המקורי), יש לה אובייקט באחסון (storage.objects),
//     והכתובת הציבורית שלה עונה 200 עם תמונה — כלומר האתר מציג אותה אחרי בנייה ופריסה, בלי תלות בקבצים מקומיים;
//   • הגופנים (Heebo, Assistant, Roboto) — אותו דבר;
//   • הטיוטה: המקטעים, מספרי הפריטים (תיק עבודות במחשב / בנייד, המלצות, שירותים), הטקסטים המרכזיים, WhatsApp,
//     טפסים והצהרת נגישות; ושאין בה כתובות לאתר הישן, ל-/tmp, ל-file: או ל-localhost;
//   • כל מזהה מדיה שהטיוטה משתמשת בו קיים בספרייה.
// שימוש (סביבת הבדיקה המקומית; קורא בלבד — לא משנה כלום):
//   node scripts/websites/audit-efrat-media.mjs [--slug efrat-classic] [--out docs/websites/platform/media-audit.json]
// בשרת אחר: DB_URL ו-SUPABASE_URL מהסביבה (קריאה בלבד).
// ============================================================
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const SLUG = arg("slug", "efrat-classic");
const OUT = arg("out", join(ROOT, "docs/websites/platform/media-audit.json"));

const envFile = join(ROOT, "e2e/.env.e2e");
const fileEnv = existsSync(envFile)
  ? Object.fromEntries(
      readFileSync(envFile, "utf8")
        .split("\n")
        .filter((l) => l.includes("="))
        .map((l) => l.split(/=(.*)/s).slice(0, 2)),
    )
  : {};
const DB_URL = process.env.DB_URL ?? fileEnv.DB_URL;
const SUPABASE_URL = (
  process.env.SUPABASE_URL ??
  fileEnv.SUPABASE_URL ??
  "http://127.0.0.1:54321"
).replace(/\/$/, "");
if (!DB_URL) throw new Error("DB_URL is not set (and e2e/.env.e2e is missing)");
const sql = (q) =>
  execFileSync("psql", [DB_URL, "-XqtA", "-v", "ON_ERROR_STOP=1", "-c", q], {
    encoding: "utf8",
  }).trim();
const json = (q) => JSON.parse(sql(q) || "null");

const src = JSON.parse(
  readFileSync(join(ROOT, "docs/websites/faithful/efrat-source.json"), "utf8"),
);
const siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
if (!siteId) throw new Error(`site ${SLUG} not found`);

// ---------- the old site's inventory, by group ----------
const groups = {
  "תמונת הרקע של הפתיח": [src.hero.image],
  הלוגו: [src.hero.logo],
  "רקע טופס הפתיחה": [src.leadForm.background],
  "אודות — כותרת-תמונה": [src.about.titleImage],
  "אודות — תמונות הקרוסלה": Object.keys(src.images).filter((f) =>
    /WhatsApp/.test(decodeURIComponent(src.images[f] ?? "")),
  ),
  "רקע ההמלצות": [src.testimonials.background],
  "העט (פריים מהאנימציה)": [src.pen.file],
  "אייקוני השירותים": src.services.items.map((s) => s.icon),
  "המלצות (צילומי מסך)": src.testimonials.items.map((t) => t.file),
  "תיק עבודות (קבצים שונים)": [...new Set(src.portfolio.items.map((p) => p.file))],
};
const allImages = [...new Set(Object.values(groups).flat())];
const fonts = src.fonts.map((f) => f.file);

// ---------- the new site: library, storage, public URLs ----------
const media =
  json(`SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.original_name, 'kind', m.kind,
                'path', m.storage_path, 'bytes', m.size_bytes,
                'in_storage', EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'bp-media' AND o.name = m.storage_path))), '[]')
          FROM business_profile.media m WHERE m.tenant_id = '${siteId}'`) ?? [];
const byFile = new Map(media.map((m) => [String(m.name).split("#")[0], m]));
const publicUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/bp-media/${path}`;

async function head(url) {
  try {
    const r = await fetch(url, { method: "GET" });
    const type = r.headers.get("content-type") ?? "";
    await r.arrayBuffer();
    return { status: r.status, type };
  } catch (e) {
    return { status: 0, type: String(e) };
  }
}

async function checkFile(file, kind) {
  const m = byFile.get(file);
  if (!m) return { file, ok: false, problem: "לא נמצא בספריית האתר" };
  if (!m.in_storage) return { file, ok: false, problem: "אין אובייקט באחסון" };
  const r = await head(publicUrl(m.path));
  const typeOk = kind === "font" ? /font|octet-stream|woff/.test(r.type) : /^image\//.test(r.type);
  return {
    file,
    ok: r.status === 200 && typeOk,
    problem: r.status === 200 && typeOk ? null : `HTTP ${r.status} ${r.type}`,
    bytes: m.bytes,
  };
}

const imageResults = [];
for (const f of allImages) imageResults.push(await checkFile(f, "image"));
const fontResults = [];
for (const f of fonts) fontResults.push(await checkFile(f, "font"));

// ---------- the draft document ----------
const draft = json(
  `SELECT document FROM business_profile.site_versions WHERE tenant_id = '${siteId}' AND state = 'draft'`,
);
const text = JSON.stringify(draft);
const home = draft.pages.find((p) => p.slug === "") ?? draft.pages[0];
const blocks = home.blocks.filter((b) => !b.hidden).map((b) => b.type);
const coll = draft.collections ?? {};
const portfolio = Array.isArray(coll.portfolio) ? coll.portfolio : (coll.portfolio?.items ?? []);
const deviceCount = (d) =>
  portfolio.filter((p) => !p.devices || p.devices === "all" || p.devices === d).length;
const list = (v) => (Array.isArray(v) ? v : (v?.items ?? []));
const testimonials = list(coll.testimonials);
const services = list(coll.services);
const forms = home.blocks.filter(
  (b) => b.type === "form" || (b.type === "contact" && b.props?.form),
).length;
const usedIds = [...text.matchAll(/"media":"([0-9a-f-]{36})"/g)].map((m) => m[1]);
const missingIds = [...new Set(usedIds)].filter((id) => !media.some((m) => m.id === id));
const external = [...new Set([...text.matchAll(/https?:\/\/[^"\s]+/g)].map((m) => m[0]))].filter(
  (u) => !/^https:\/\/wa\.me\//.test(u),
);
const forbidden = {
  "האתר הישן (efratadir.com)": /efratadir\.com/.test(text),
  "/tmp": /\/tmp\//.test(text),
  "file:": /file:\/\//.test(text),
  localhost: /localhost|127\.0\.0\.1/.test(text),
};
const keyTexts = [
  src.hero.titleLead,
  src.hero.title,
  src.hero.subtitle,
  src.hero.tagline,
  src.leadForm.title,
  src.about.title,
  src.testimonials.title,
  src.services.title,
  src.portfolio.title,
  src.ctaForm.title,
  ...src.services.items.map((s) => s.title),
];
const textsMissing = keyTexts.filter((t) => t && !text.includes(t));

const summary = {
  site: SLUG,
  checkedAt: new Date().toISOString(),
  sections: {
    old: 9,
    newBlocks: [...blocks, "footer (מעטפת האתר)"],
    newCount: blocks.length + (draft.theme?.chrome?.footer ? 1 : 0),
  },
  images: {
    oldTotal: allImages.length,
    inLibrary: imageResults.filter((r) => r.problem !== "לא נמצא בספריית האתר").length,
    loads: imageResults.filter((r) => r.ok).length,
    problems: imageResults.filter((r) => !r.ok),
    groups: Object.fromEntries(
      Object.entries(groups).map(([g, files]) => [
        g,
        {
          old: files.length,
          ok: files.filter((f) => imageResults.find((r) => r.file === f)?.ok).length,
        },
      ]),
    ),
  },
  fonts: {
    files: fonts.length,
    ok: fontResults.filter((r) => r.ok).length,
    families: [...new Set(src.fonts.map((f) => f.family))],
    problems: fontResults.filter((r) => !r.ok),
  },
  portfolio: {
    oldDesktop: src.portfolio.items.filter((p) => p.devices === "desktop").length,
    oldMobile: src.portfolio.items.filter((p) => p.devices === "mobile").length,
    newDesktop: deviceCount("desktop"),
    newMobile: deviceCount("mobile"),
    distinctFiles: groups["תיק עבודות (קבצים שונים)"].length,
  },
  testimonials: { old: src.testimonials.items.length, new: testimonials.length },
  services: { old: src.services.items.length, new: services.length },
  forms: { old: 2, new: forms },
  whatsapp: { old: src.business.whatsapp, new: draft.business?.whatsapp ?? null },
  accessibilityStatement: Boolean(draft.accessibility?.updatedOn),
  library: { files: media.length, inStorage: media.filter((m) => m.in_storage).length },
  draftMediaIdsMissing: missingIds,
  externalUrlsInDraft: external,
  forbidden,
  textsMissing,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);

const pass =
  summary.images.loads === summary.images.oldTotal &&
  summary.fonts.ok === summary.fonts.files &&
  missingIds.length === 0 &&
  !Object.values(forbidden).some(Boolean) &&
  textsMissing.length === 0 &&
  summary.testimonials.new === summary.testimonials.old &&
  summary.services.new === summary.services.old &&
  summary.portfolio.newDesktop === summary.portfolio.oldDesktop &&
  summary.portfolio.newMobile === summary.portfolio.oldMobile;
console.log(
  JSON.stringify(
    {
      pass,
      images: `${summary.images.loads}/${summary.images.oldTotal} load from storage`,
      fonts: `${summary.fonts.ok}/${summary.fonts.files}`,
      portfolio: summary.portfolio,
      testimonials: summary.testimonials,
      services: summary.services,
      forms: summary.forms,
      whatsapp: summary.whatsapp,
      blocks: summary.sections,
      library: summary.library,
      missingIds,
      forbidden,
      textsMissing,
      external,
    },
    null,
    1,
  ),
);
process.exit(pass ? 0 : 1);

// NURIEL AI SEO ENGINE — importing a Search Console "Performance" export (CSV) — the honest fallback for a
// business that has not connected Search Console through Google sign-in yet. The numbers are Google's own
// (clicks, impressions, CTR, average position); nothing here is estimated.
// Supports the English and the Hebrew Search Console UI exports (Queries.csv / Pages.csv / Dates.csv).

export type GscDimension = "query" | "page" | "date";

export interface GscRow {
  key: string;
  clicks: number;
  impressions: number;
  /** 0..1 */
  ctr: number;
  position: number;
}

export interface GscCsv {
  dimension: GscDimension;
  rows: GscRow[];
  skipped: number;
}

export class GscCsvError extends Error {}

const HEADERS: Record<string, GscDimension | "clicks" | "impressions" | "ctr" | "position"> = {
  "top queries": "query",
  query: "query",
  queries: "query",
  "שאילתות מובילות": "query",
  שאילתה: "query",
  שאילתות: "query",
  "top pages": "page",
  page: "page",
  pages: "page",
  "דפים מובילים": "page",
  "עמודים מובילים": "page",
  דף: "page",
  עמוד: "page",
  date: "date",
  תאריך: "date",
  clicks: "clicks",
  קליקים: "clicks",
  impressions: "impressions",
  חשיפות: "impressions",
  ctr: "ctr",
  "שיעור קליקים": "ctr",
  "שיעור קליקים (ctr)": "ctr",
  "שיעור הקליקים (ctr)": "ctr",
  position: "position",
  מיקום: "position",
  "מיקום ממוצע": "position",
};

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF), with an optional BOM */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function num(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.replace(/[\s‎‏]/g, "").replace(/,(?=\d{3}\b)/g, "");
  if (s === "" || s === "-") return null;
  const pct = s.endsWith("%");
  const n = Number((pct ? s.slice(0, -1) : s).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

export const GSC_CSV_MAX_ROWS = 5000;

export function parseGscCsv(text: string): GscCsv {
  const table = parseCsv(text);
  const head = table[0];
  if (!head) throw new GscCsvError("הקובץ ריק");
  const cols = head.map((h) => HEADERS[h.trim().toLowerCase()] ?? null);
  const dimIdx = cols.findIndex((c) => c === "query" || c === "page" || c === "date");
  const at = (k: string) => cols.indexOf(k as never);
  const iClicks = at("clicks");
  const iImpr = at("impressions");
  const iCtr = at("ctr");
  const iPos = at("position");
  if (dimIdx < 0 || iClicks < 0 || iImpr < 0)
    throw new GscCsvError(
      "זה לא נראה כמו קובץ ביצועים מ-Search Console (חסרות עמודות שאילתה / קליקים / חשיפות)",
    );
  const dimension = cols[dimIdx] as GscDimension;
  const rows: GscRow[] = [];
  let skipped = 0;
  for (const r of table.slice(1)) {
    const key = (r[dimIdx] ?? "").trim();
    const clicks = num(r[iClicks]);
    const impressions = num(r[iImpr]);
    if (
      !key ||
      clicks === null ||
      impressions === null ||
      clicks < 0 ||
      impressions < 0 ||
      clicks > impressions
    ) {
      skipped += 1;
      continue;
    }
    const ctrRaw = iCtr >= 0 ? num(r[iCtr]) : null;
    const ctr =
      ctrRaw !== null
        ? ctrRaw > 1
          ? ctrRaw / 100
          : ctrRaw
        : impressions > 0
          ? clicks / impressions
          : 0;
    const position = iPos >= 0 ? (num(r[iPos]) ?? 0) : 0;
    if (dimension === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      skipped += 1;
      continue;
    }
    rows.push({
      key: key.slice(0, 500),
      clicks,
      impressions,
      ctr: Math.max(0, Math.min(1, ctr)),
      position: Math.max(0, position),
    });
    if (rows.length >= GSC_CSV_MAX_ROWS) break;
  }
  if (rows.length === 0) throw new GscCsvError("לא נמצאו שורות תקינות בקובץ");
  return { dimension, rows, skipped };
}

// "תקנו לי" — ממצא בבדיקה הטכנית (כותרת / תיאור לגוגל) הופך להצעה ממתינה לעמוד המסוים. טהור (נבדק ביחידה).
// הממצא מגיע עם כתובות (url / urls); כאן הן מתורגמות לעמוד באתר: דף הבית, יחידה (לפי ה-slug) או חבילה.
// שום דבר לא נכתב באתר מכאן — ההצעות נשמרות כממתינות, ובעל העסק מאשר / עורך / דוחה כל אחת.
import type { PublicSite } from "../types/website";
import type { SeoField, SeoTargetKind } from "../types/seo";

/** הממצאים שיש להם תיקון בטקסט לגוגל — והשדה שמתקן אותם */
export const SEO_FIX_FIELD: Readonly<Record<string, "seo_title" | "seo_description">> = {
  "title.missing": "seo_title",
  "title.length_hint": "seo_title",
  "title.duplicate": "seo_title",
  "description.missing": "seo_description",
  "description.length_hint": "seo_description",
  "description.duplicate": "seo_description",
};

/** ממצאים שיש לידם פעולה בתיקון: "תקנו לי" (טקסט לגוגל), או קישור למסך (תוכן / תמונות) */
export function hasSeoIssueAction(code: string): boolean {
  return Boolean(SEO_FIX_FIELD[code]) || code === "content.thin" || code === "images.alt_missing";
}

export interface SeoFixTarget {
  target_kind: Extract<SeoTargetKind, "site" | "unit" | "package">;
  target_id: string | null;
}

export interface SeoFixRequest {
  code: string;
  urls: string[];
}

export const SEO_FIX_MAX_URLS = 20;

/** בדיקת הקלט מהדפדפן: קוד ממצא שיש לו תיקון, ועד 20 כתובות (מחרוזות קצרות) */
export function parseSeoFix(input: unknown): SeoFixRequest | null {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const code = typeof raw["code"] === "string" ? raw["code"] : "";
  if (!SEO_FIX_FIELD[code]) return null;
  const list = Array.isArray(raw["urls"]) ? raw["urls"] : [];
  const urls = list
    .filter((u): u is string => typeof u === "string" && u.length > 0 && u.length <= 2000)
    .slice(0, SEO_FIX_MAX_URLS);
  return urls.length ? { code, urls } : null;
}

function segmentsOf(url: string): string[] | null {
  try {
    return new URL(url, "https://site.invalid").pathname
      .split("/")
      .filter(Boolean)
      .map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
}

/**
 * הכתובות של הממצא → העמודים באתר (בלי כפילויות, בסדר שבו הגיעו). "/" ו-"/stay" — דף הבית; עמוד יחידה /
 * חבילה — לפי ה-slug שבכתובת. כתובת שאינה עמוד של העסק (או יחידה שכבר לא קיימת) — מדלגים.
 * בממצא של כפילות: דף הבית לא "מתוקן" כשיש בקבוצה עמודים אחרים — שם העסק בכותרת דף הבית הוא הנכון,
 * ומי שצריך כותרת משלו הוא העמוד הפנימי.
 */
export function seoFixTargets(
  site: Pick<PublicSite, "units"> & Partial<Pick<PublicSite, "packages">>,
  request: SeoFixRequest,
): SeoFixTarget[] {
  const out: SeoFixTarget[] = [];
  const seen = new Set<string>();
  for (const url of request.urls) {
    const s = segmentsOf(url);
    if (!s) continue;
    let target: SeoFixTarget | null = null;
    if (s.length === 0 || (s.length === 1 && s[0] === "stay")) {
      target = { target_kind: "site", target_id: null };
    } else if (s.length === 3 && s[0] === "stay" && s[1] === "units") {
      const unit = site.units.find((u) => u.slug === s[2]);
      if (unit) target = { target_kind: "unit", target_id: unit.id };
    } else if (s.length === 3 && s[0] === "stay" && s[1] === "packages") {
      const pkg = (site.packages ?? []).find((p) => p.slug === s[2]);
      if (pkg) target = { target_kind: "package", target_id: pkg.id };
    }
    if (!target) continue;
    const key = `${target.target_kind}:${target.target_id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  if (request.code.endsWith(".duplicate") && out.length > 1)
    return out.filter((t) => t.target_kind !== "site");
  return out;
}

/** אותו יעד ואותו שדה */
export const sameTarget = (
  a: { target_kind: string; target_id: string | null },
  b: { target_kind: string; target_id: string | null },
) => a.target_kind === b.target_kind && (a.target_id ?? null) === (b.target_id ?? null);

/** מה בעל העסק רואה ליד הממצא אחרי "תקנו לי" */
export interface SeoFixResult {
  status: "ok" | "none" | "limited" | "unavailable" | "failed" | "busy";
  message: string | null;
  field: SeoField | null;
  /** העמודים שיש להם עכשיו הצעה ממתינה לשדה (חדשה או שכבר חיכתה) */
  targets: SeoFixTarget[];
  /** כמה הצעות חדשות נוספו עכשיו */
  added: number;
}

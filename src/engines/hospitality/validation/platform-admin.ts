// "ניהול Hospitality" (P1): בדיקת הקלט — אותן הודעות כמו המסד (מיגרציה 15). הכתובת עצמה
// (מילים שמורות, כתובת תפוסה) נבדקת במסד ב-platform_slug_problem.
import type { SiteFlagKey } from "../types/platform-admin";
import { InputError, uuid } from "./input";

type Raw = Record<string, unknown> | null | undefined;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function slugError(slug: string): string | null {
  if (!slug) return "יש לבחור כתובת לאתר";
  if (!SLUG.test(slug))
    return "הכתובת: 3–40 תווים, אותיות באנגלית קטנות, ספרות ומקף (לא בהתחלה ולא בסוף)";
  return null;
}
export function emailError(email: string): string | null {
  if (!email) return "יש להזין את האימייל של בעל העסק";
  if (!EMAIL.test(email) || email.length > 254) return "אימייל בעל העסק לא תקין";
  return null;
}

/** הצעה לכתובת מתוך שם באנגלית (אם יש) — לא יותר מהצעה; הבעלים / המנהל קובעים */
export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export interface OpenSiteInput {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerName: string | null;
  plan: string;
  periodEnd: string | null;
}

export function parseOpenSite(input: Raw): OpenSiteInput {
  const i = input ?? {};
  const name = text(i["name"]);
  if (name.length < 1 || name.length > 120)
    throw new InputError("שם העסק חייב להכיל 1 עד 120 תווים");
  const slug = text(i["slug"]).toLowerCase();
  const s = slugError(slug);
  if (s) throw new InputError(s);
  const ownerEmail = text(i["ownerEmail"]).toLowerCase();
  const e = emailError(ownerEmail);
  if (e) throw new InputError(e);
  const ownerName = text(i["ownerName"]) || null;
  if (ownerName && ownerName.length > 80) throw new InputError("השם ארוך מדי (עד 80 תווים)");
  const plan = text(i["plan"]) || "trial";
  if (!/^[a-z_]{2,30}$/.test(plan)) throw new InputError("חבילה לא מוכרת");
  const periodEnd = text(i["periodEnd"]) || null;
  if (periodEnd && !DATE.test(periodEnd)) throw new InputError("תאריך סיום המנוי לא תקין");
  return { name, slug, ownerEmail, ownerName, plan, periodEnd };
}

export function parseSetOwner(input: Raw): { siteId: string; email: string; name: string | null } {
  const i = input ?? {};
  const email = text(i["email"]).toLowerCase();
  const e = emailError(email);
  if (e) throw new InputError(e);
  const name = text(i["name"]) || null;
  if (name && name.length > 80) throw new InputError("השם ארוך מדי (עד 80 תווים)");
  return { siteId: uuid(i["siteId"], "האתר"), email, name };
}

export function parseSetPlan(input: Raw): {
  siteId: string;
  plan: string;
  until: string | null;
  extraUnits: number;
} {
  const i = input ?? {};
  const plan = text(i["plan"]);
  if (!/^[a-z_]{2,30}$/.test(plan)) throw new InputError("חבילה לא מוכרת");
  const until = text(i["until"]) || null;
  if (until && !DATE.test(until)) throw new InputError("התאריך לא תקין");
  if (plan === "trial" && !until) throw new InputError("לניסיון צריך תאריך סיום");
  const extra = i["extraUnits"] ?? 0;
  if (typeof extra !== "number" || !Number.isInteger(extra) || extra < 0 || extra > 1000)
    throw new InputError("מספר היחידות הנוספות לא תקין");
  return { siteId: uuid(i["siteId"], "האתר"), plan, until, extraUnits: extra };
}

export function parseSetFlag(input: Raw): {
  siteId: string | null;
  key: SiteFlagKey;
  enabled: boolean;
} {
  const i = input ?? {};
  const key = i["key"];
  if (key !== "backend" && key !== "management" && key !== "frontend" && key !== "booking")
    throw new InputError("דגל לא מוכר");
  if (typeof i["enabled"] !== "boolean") throw new InputError("ערך לא תקין");
  const siteId =
    i["siteId"] === null || i["siteId"] === undefined ? null : uuid(i["siteId"], "האתר");
  return { siteId, key, enabled: i["enabled"] };
}

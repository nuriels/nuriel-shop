// מסמכי האתר, פרטי העסק למסמכים והסדרי הנגישות במתחם (מיגרציה 60) — בדיקת הקלט לפני המסד
// (המסד נשאר הסמכות הסופית). הודעות בעברית.
import {
  ACCESSIBILITY_ITEMS,
  DOC_KINDS,
  isDocKind,
  type AccessibilityItems,
  type DocKind,
} from "../documents/kinds";
import { InputError, intInRange, isoDate, oneOf, optionalText, text, uuid } from "./input";

type Raw = Record<string, unknown> | null | undefined;
const field = (input: Raw, key: string): unknown => (input ?? {})[key];

export const DOC_BODY_MAX = 60_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function kind(value: unknown): DocKind {
  return oneOf(value, DOC_KINDS, "סוג המסמך");
}
function revision(value: unknown, required: boolean): number | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new InputError("חסרה הגרסה של המסמך — רעננו את העמוד");
    return null;
  }
  return intInRange(value, 1, 1_000_000, "הגרסה");
}
function optionalEmail(value: unknown, what: string): string | null {
  const s = optionalText(value, 254, what);
  if (s && !EMAIL.test(s)) throw new InputError(`${what} — כתובת אימייל לא תקינה`);
  return s ? s.toLowerCase() : null;
}

export function parseDocumentSave(input: Raw) {
  const body = String(field(input, "body") ?? "");
  if (body.length > DOC_BODY_MAX) throw new InputError("המסמך ארוך מדי (עד 60,000 תווים)");
  return {
    kind: kind(field(input, "kind")),
    title: text(field(input, "title"), 120, "כותרת המסמך", { min: 2 }),
    body,
    expectedRevision: revision(field(input, "expectedRevision"), false),
  };
}

export function parseDocumentPublish(input: Raw) {
  return {
    kind: kind(field(input, "kind")),
    expectedRevision: revision(field(input, "expectedRevision"), true) as number,
  };
}

export function parseDocumentKind(input: Raw): { kind: DocKind } {
  return { kind: kind(field(input, "kind")) };
}

export function parseDocumentReview(input: Raw) {
  const reviewKind = field(input, "reviewKind");
  const clear = reviewKind === null || reviewKind === undefined || reviewKind === "";
  return {
    kind: kind(field(input, "kind")),
    version: intInRange(field(input, "version"), 1, 100_000, "הגרסה"),
    reviewKind: clear
      ? null
      : oneOf(reviewKind, ["lawyer", "accessibility"] as const, "סוג הבדיקה"),
    reviewedBy: clear ? null : text(field(input, "reviewedBy"), 120, "מי בדק", { min: 2 }),
    reviewedOn: clear ? null : isoDate(field(input, "reviewedOn"), "תאריך הבדיקה"),
  };
}

export function parseLegalProfile(input: Raw) {
  const p = (field(input, "profile") ?? {}) as Record<string, unknown>;
  const required = p["coordinator_required"] === true;
  return {
    profile: {
      legal_name: optionalText(p["legal_name"], 120, "שם העוסק / החברה"),
      registration_id: optionalText(p["registration_id"], 30, "מספר עוסק / ח.פ"),
      legal_address: optionalText(p["legal_address"], 200, "כתובת העוסק"),
      a11y_contact_name: optionalText(p["a11y_contact_name"], 80, "איש הקשר לנגישות"),
      a11y_contact_phone: optionalText(p["a11y_contact_phone"], 30, "הטלפון לפניות נגישות"),
      a11y_contact_email: optionalEmail(p["a11y_contact_email"], "האימייל לפניות נגישות"),
      coordinator_required: required,
      coordinator_name: required ? optionalText(p["coordinator_name"], 80, "שם רכז הנגישות") : null,
      coordinator_phone: required
        ? optionalText(p["coordinator_phone"], 30, "הטלפון של רכז הנגישות")
        : null,
      coordinator_email: required
        ? optionalEmail(p["coordinator_email"], "האימייל של רכז הנגישות")
        : null,
    },
    expectedRevision: revision(field(input, "expectedRevision"), false),
  };
}

/** הסדרי הנגישות: רק הפריטים המוכרים, תשובה yes / partial / no (או בלי — לא נענה) */
export function parsePropertyAccessibility(input: Raw) {
  const raw = field(input, "items");
  if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw)))
    throw new InputError("הסדרי הנגישות — מבנה לא תקין");
  const items: AccessibilityItems = {};
  for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (!(ACCESSIBILITY_ITEMS as readonly string[]).includes(k))
      throw new InputError("פריט לא מוכר בהסדרי הנגישות");
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    if (o["answer"] === undefined || o["answer"] === null || o["answer"] === "") continue;
    const answer = oneOf(o["answer"], ["yes", "partial", "no"] as const, "התשובה");
    const details = optionalText(o["details"], 300, "הפירוט");
    items[k as keyof AccessibilityItems] = details ? { answer, details } : { answer };
  }
  if (field(input, "confirmed") !== true)
    throw new InputError("יש לאשר שהמידע נמסר על ידי המתחם ושהוא נכון");
  return {
    propertyId: uuid(field(input, "propertyId"), "המתחם"),
    items,
    confirmed: true as const,
    additional: optionalText(field(input, "additional"), 2000, "התאמות נוספות"),
    contactName: optionalText(field(input, "contactName"), 80, "איש הקשר"),
    contactPhone: optionalText(field(input, "contactPhone"), 30, "הטלפון"),
    contactEmail: optionalEmail(field(input, "contactEmail"), "האימייל"),
    expectedRevision: revision(field(input, "expectedRevision"), false),
  };
}

/** בבקשת הזמנה: המסמכים שהטופס הציג (סוג + גרסה) — המסד בודק שהם הגרסאות שמוצגות עכשיו */
export function parseAcceptedDocuments(value: unknown): { kind: DocKind; version: number }[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > DOC_KINDS.length)
    throw new InputError("רשימת המסמכים לא תקינה");
  const out = value.map((d) => {
    const o = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
    if (!isDocKind(o["kind"])) throw new InputError("רשימת המסמכים לא תקינה");
    return { kind: o["kind"], version: intInRange(o["version"], 1, 100_000, "גרסת המסמך") };
  });
  if (new Set(out.map((d) => d.kind)).size !== out.length)
    throw new InputError("רשימת המסמכים לא תקינה");
  return out;
}

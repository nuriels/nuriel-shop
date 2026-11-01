// ההודעות בין העורך לתצוגה המקדימה (postMessage, רק מאותו מקור)
export const PREVIEW_DESIGN_MESSAGE = "nuriel-site-design";
export const PREVIEW_READY_MESSAGE = "nuriel-site-preview-ready";
/** D2: טקסט שנערך ישירות בתצוגה המקדימה → העורך ({section, field, value}) */
export const PREVIEW_EDIT_MESSAGE = "nuriel-site-edit";
/** D2: לחיצה על מקטע בתצוגה המקדימה → העורך פותח אותו ({section}) */
export const PREVIEW_SELECT_MESSAGE = "nuriel-site-select";
/** D2: העורך → התצוגה: לטעון מחדש את נתוני האתר (תמונה / לוגו חדשים) */
export const PREVIEW_RELOAD_MESSAGE = "nuriel-site-reload";

/** השדות שאפשר לערוך ישירות בתצוגה המקדימה (טקסט פשוט) */
export const INLINE_FIELDS = ["eyebrow", "title", "subtitle", "body", "note"] as const;
export type InlineField = (typeof INLINE_FIELDS)[number];

export const isInlineField = (v: unknown): v is InlineField =>
  typeof v === "string" && (INLINE_FIELDS as readonly string[]).includes(v);

export const INLINE_FIELD_LABELS: Record<InlineField, string> = {
  eyebrow: "שורה מעל הכותרת",
  title: "כותרת",
  subtitle: "משפט משנה",
  body: "טקסט",
  note: "הערה",
};

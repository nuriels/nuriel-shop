// מסמכי האתר (מיגרציה 60): שמונה סוגים, הכתובת של כל אחד באתר, אילו מהם האורח מאשר בהזמנה, ומי
// צריך לבדוק כל מסמך לפני שמסתמכים עליו (עורך דין / מורשה נגישות). אותה רשימה כמו במסד.

export const DOC_KINDS = [
  "site_terms",
  "booking_terms",
  "cancellation",
  "privacy",
  "payments",
  "event_terms",
  "house_rules",
  "accessibility",
] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export function isDocKind(v: unknown): v is DocKind {
  return typeof v === "string" && (DOC_KINDS as readonly string[]).includes(v);
}

/** הכתובת באתר: פרטיות ונגישות — בכתובות הקיימות; השאר תחת /stay/docs */
export const DOC_SLUGS: Record<DocKind, string> = {
  site_terms: "terms",
  booking_terms: "booking-terms",
  cancellation: "cancellation",
  privacy: "privacy",
  payments: "payments",
  event_terms: "event-terms",
  house_rules: "house-rules",
  accessibility: "accessibility",
};

export function docPath(kind: DocKind): string {
  if (kind === "privacy") return "/stay/privacy";
  if (kind === "accessibility") return "/stay/accessibility";
  return `/stay/docs/${DOC_SLUGS[kind]}`;
}

export function kindFromSlug(slug: string | undefined): DocKind | undefined {
  return DOC_KINDS.find((k) => DOC_SLUGS[k] === slug);
}

/** מה שהאורח מאשר בהזמנת אירוח באתר (מה שמוצג מהם) — כמו _documents_for_booking במסד */
export const BOOKING_DOC_KINDS: readonly DocKind[] = [
  "booking_terms",
  "cancellation",
  "payments",
  "house_rules",
  "site_terms",
  "privacy",
];

/** מי צריך לבדוק את המסמך לפני שמסתמכים עליו */
export const DOC_REVIEWER: Record<DocKind, "lawyer" | "accessibility"> = {
  site_terms: "lawyer",
  booking_terms: "lawyer",
  cancellation: "lawyer",
  privacy: "lawyer",
  payments: "lawyer",
  event_terms: "lawyer",
  house_rules: "lawyer",
  accessibility: "accessibility",
};

/** הסדרי הנגישות הפיזיים במתחם — הפריטים, בסדר שמוצג */
export const ACCESSIBILITY_ITEMS = [
  "parking",
  "entrance",
  "step_free",
  "unit",
  "restroom",
  "grab_bars",
  "passages",
] as const;
export type AccessibilityItem = (typeof ACCESSIBILITY_ITEMS)[number];
export type AccessibilityAnswer = "yes" | "partial" | "no";
export type AccessibilityItems = Partial<
  Record<AccessibilityItem, { answer: AccessibilityAnswer; details?: string }>
>;

// הצעות SEO שממתינות לאישור (מיגרציה 20261118200000_hosp_seo_proposals) — הטיפוסים המשותפים לשרת ולמסך.

export type SeoTargetKind = "site" | "unit" | "media" | "package";
export type SiteSeoField =
  "seo_title" | "seo_description" | "hero_title" | "about_title" | "about_body";
export type UnitSeoField = "seo_title" | "seo_description" | "description";
export type MediaSeoField = "alt";
/** מיגרציה 204: חבילה — רק הכותרת והתיאור לגוגל (לא התיאור / התנאים שבעל העסק כתב) */
export type PackageSeoField = "seo_title" | "seo_description";
export type SeoField = SiteSeoField | UnitSeoField | MediaSeoField | PackageSeoField;

/** הצעה לפני שנכנסה למסד (מהתבנית או מ-NURIEL AI) */
export interface SeoProposalItem {
  target_kind: SeoTargetKind;
  /** היחידה / התמונה; לאתר — null */
  target_id: string | null;
  field: SeoField;
  text: string;
  /** מיגרציה 204: למה ההצעה — מוצג לבעל העסק ליד ההצעה */
  reason?: string;
}

/** מיגרציה 204: later — נשמרה "לאחר כך" (עדיין פתוחה); reverted — שוחזרה לערך שלפני האישור */
export type SeoProposalStatus =
  "pending" | "later" | "approved" | "rejected" | "superseded" | "stale" | "reverted";

/** הצעה כפי שהמסד מחזיר לצוות (seo_proposals()) */
export interface SeoProposal {
  id: string;
  target_kind: SeoTargetKind;
  target_id: string | null;
  field: SeoField;
  proposed: string;
  /** הערך בשדה ברגע ההפקה (null — ריק / ברירת המחדל) */
  base: string | null;
  source: "template" | "ai";
  status: SeoProposalStatus;
  applied: string | null;
  created_at: string;
  decided_at: string | null;
  /** שם היחידה (ליעד מסוג יחידה) */
  target_label: string | null;
  /** הערך עכשיו (בהצעה פתוחה / שאושרה) — פתוחה: אם שונה מ-base, ההצעה לא תוחל; מאושרת: אפשר לשחזר רק כשזהה ל-applied */
  current: string | null;
  /** מיגרציה 204 */
  reason?: string | null;
  auto_applied?: boolean;
  reverted_at?: string | null;
}

export interface SeoProposalsView {
  proposals: SeoProposal[];
  runs: { template_initial: boolean; ai_initial: boolean };
  /** NURIEL AI: זמין לעסק הזה עכשיו (חבילה בתוקף, העוזר פעיל) */
  ai: { available: boolean; message: string | null };
}

export type SeoGenerateResult =
  | { status: "ok"; added: number; skipped: number; calls: number }
  /** הפקה ראשונית שכבר רצה — לא מפיקים שוב */
  | { status: "already" }
  /** אין NURIEL AI פעיל / התקציב נוצל — בלי קריאה לדגם ובלי חיוב */
  | { status: "unavailable"; message: string }
  | { status: "limited"; message: string }
  | { status: "failed"; message: string };

/** כותרות / תיאורים: ההמלצה לתוצאות החיפוש (המסד מקבל עד 70 / 200) */
export const SEO_RECOMMENDED = { title: 60, description: 155 } as const;
/** האורך המרבי שהמסד מקבל לכל שדה (hospitality._seo_max) */
export const SEO_FIELD_MAX: Record<SeoTargetKind, Partial<Record<SeoField, number>>> = {
  site: {
    seo_title: 70,
    seo_description: 200,
    hero_title: 120,
    about_title: 120,
    about_body: 4000,
  },
  unit: { seo_title: 70, seo_description: 200, description: 5000 },
  media: { alt: 250 },
  package: { seo_title: 70, seo_description: 200 },
};

// חוזה המנועים של הפלטפורמה (Hospitality Stage 1f, plan B1).
// הפלטפורמה מכירה רק את החוזה הזה — אף פעם לא מנוע מסוים. המנועים (Ecommerce,
// Hospitality) מממשים אותו, ושורש ההרכבה (src/app/engines.ts) רושם אותם.

/** סוגי האתרים (tenants.site_type) — כל אתר שייך למנוע אחד בדיוק */
export const SITE_TYPES = ["ecommerce", "hospitality"] as const;
export type SiteType = (typeof SITE_TYPES)[number];

/** הבעלים של פונקציית שרת: מנוע, או הפלטפורמה המשותפת */
export type ServerFnOwner = SiteType | "platform";

export function isSiteType(value: unknown): value is SiteType {
  return typeof value === "string" && (SITE_TYPES as readonly string[]).includes(value);
}

/** מה שמנוע יודע על האתר של הבקשה — נייטרלי, בלי נתוני מוצר */
export interface SiteRef {
  id: string;
  siteType: SiteType;
  status: "active" | "suspended";
}

/** בקשת עמוד / קובץ (לא פונקציית שרת) שמגיעה לאתר של המנוע */
export interface EdgeRequest {
  pathname: string;
  method: string;
}

export interface Engine {
  readonly key: SiteType;
  readonly label: string;
  /**
   * האם קובץ פונקציות השרת (נתיב יחסי, למשל src/engines/hospitality/server/x.functions.ts)
   * שייך למנוע. מנוע ברירת המחדל (Ecommerce) לא טוען לבעלות — הוא מקבל כל קובץ
   * שאף מנוע אחר והפלטפורמה לא טוענים לו (ההתנהגות הקיימת).
   */
  ownsServerFn(filename: string): boolean;
  /** האם האתר רשאי להשתמש עכשיו בפונקציות השרת של המנוע (דגלים, מתג סביבה) */
  enabledFor(site: SiteRef): Promise<boolean>;
  /** שער לבקשות עמוד / קובץ באתרים של המנוע; null = ממשיכים לאפליקציה */
  gate(site: SiteRef, request: EdgeRequest): Promise<Response | null>;
  // provision (פתיחת אתר, A9) וספק מנהל-על (שלב 11) יצטרפו לחוזה כשיהיה להם שימוש
}

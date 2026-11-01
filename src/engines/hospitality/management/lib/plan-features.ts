// שלב E3: מה פתוח בחבילה של האתר (סנכרון ערוצים, סוגי חדרים, מבצעים). האכיפה במסד —
// כאן רק כדי להציג "זמין בחבילת פרימיום" במקום כפתור שייכשל.
import type { ManagementContext } from "../../types/management";

export type PlanFeatureKey = "channels" | "room_types" | "promotions";

/**
 * false רק כשידוע שהתכונה סגורה בחבילה (לבעלים מגיעה הזכאות המלאה). מנהל משנה רואה רק
 * את מגבלת היחידות — אצלו true, והמסד מחליט (עם הודעה ברורה).
 */
export function planFeatureOpen(ctx: ManagementContext, key: PlanFeatureKey): boolean {
  const features = ctx.entitlements.features;
  return features === undefined || features[key] !== false;
}

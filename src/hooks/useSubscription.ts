import { useLoaderData } from "@tanstack/react-router";
import type { FeatureKey, SubscriptionState } from "@/lib/subscription";

/**
 * מנוי החנות הנוכחית (חלק 13) — מה-root loader (getSiteSeo), כבר מהטעינה
 * הראשונה ובלי בקשה נוספת. מתרענן בטעינה מחדש של העמוד (או router.invalidate).
 * בדומיין של פאנל הפלטפורמה אין מנוי — הכל פתוח.
 * חלק 15: הפיצ'רים כבר כוללים את התוספים שנרכשו (plan === premium OR has_addon).
 */
export function useSubscription(): {
  subscription: SubscriptionState | null;
  /** האם הפיצ'ר פתוח — בחבילה הנוכחית או בזכות תוסף שנרכש */
  can: (feature: FeatureKey) => boolean;
  /** מגבלת המוצרים בחבילה (null = ללא הגבלה) */
  maxProducts: number | null;
} {
  const site = useLoaderData({ from: "__root__" });
  const subscription = site?.subscription ?? null;
  const features = subscription ? subscription.features : null;
  return {
    subscription,
    can: (feature) => (features ? features[feature] : true),
    maxProducts: features ? features.maxProducts : null,
  };
}

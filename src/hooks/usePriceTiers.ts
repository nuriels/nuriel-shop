import { useSiteSettings } from "@/hooks/useSiteSettings";

/**
 * האם דרגי המחיר 2/3 פעילים. כברירת מחדל — כבויים ("רדומים"): כל הלקוחות
 * בדרג 1 והממשק מציג שדה מחיר אחד בלבד. נקבע במסד (site_settings.price_tiers_enabled).
 */
export function usePriceTiersEnabled(): boolean {
  const { settings } = useSiteSettings();
  return settings?.price_tiers_enabled === true;
}

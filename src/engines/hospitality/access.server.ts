// מתי המנוע פעיל לאתר (צד שרת): מתג הסביבה + דגלי האתר. כל תקלה בבדיקת דגל → כבוי.
import { featureEnabled } from "@/platform/feature-flags/flags.server";
import { HOSPITALITY_FLAGS, hospitalitySwitchOn } from "./config";

/** המסד והפונקציות של המנוע (Stage 1): HOSPITALITY_ENGINE=on + hospitality_backend_enabled */
export async function backendEnabled(siteId: string): Promise<boolean> {
  if (!hospitalitySwitchOn()) return false;
  return featureEnabled(HOSPITALITY_FLAGS.backend, siteId);
}

/** אזור הניהול (Stage 2): כל מה שלמעלה + hospitality_management_enabled. לא תלוי באתר הציבורי. */
export async function managementEnabled(siteId: string): Promise<boolean> {
  if (!(await backendEnabled(siteId))) return false;
  return featureEnabled(HOSPITALITY_FLAGS.management, siteId);
}

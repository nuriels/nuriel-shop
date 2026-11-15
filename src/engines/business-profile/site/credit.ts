// קרדיט נוריאל באתרי העסקים (כמו בכל אתר בפלטפורמה): קישור אחד, בחלון חדש, nofollow. הזכויות על התוכן
// והתמונות נשארות של העסק ("© שנה, שם העסק" בפוטר של האתר).
import { NURIEL_CREDIT_REL, NURIEL_CREDIT_URL } from "@/platform/branding/credit";

export const BP_PRODUCT = "Nuriel Websites";
export const BP_CREDIT_BEFORE = "האתר נבנה באמצעות ";
export const BP_CREDIT_AFTER = " מבית נוריאל מחשבים";
export const BP_CREDIT_TEXT = `${BP_CREDIT_BEFORE}${BP_PRODUCT}${BP_CREDIT_AFTER}`;
export const BP_CREDIT_LABEL = `${BP_CREDIT_TEXT}. נפתח בחלון חדש`;
export { NURIEL_CREDIT_REL, NURIEL_CREDIT_URL };

/** אותו קרדיט כ-HTML סטטי — לעמודים שהשער מחזיר בלי React */
export function creditHtml(): string {
  return (
    `<a href="${NURIEL_CREDIT_URL}" target="_blank" rel="${NURIEL_CREDIT_REL}" aria-label="${BP_CREDIT_LABEL}">` +
    `${BP_CREDIT_BEFORE}<bdi>${BP_PRODUCT}</bdi>${BP_CREDIT_AFTER}</a>`
  );
}

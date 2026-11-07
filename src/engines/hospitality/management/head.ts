// תגיות ה-meta של אתר אירוח (R-1): שם העסק בלבד — בלי ערכי SEO, מעקב, לוגו או
// צבעים של חנות. אזור הניהול לא מיועד למנועי חיפוש (noindex), אבל קישור ששותף
// (WhatsApp) מציג את שם העסק.
// A1: האייקונים (לשונית, "הוספה למסך הבית", מניפסט) — מהלוגו שהעסק העלה, מהדומיין של האתר. רק
// כשאין לוגו — האייקון הכללי (fallback); אף פעם לא האייקון הכללי כשלעסק יש לוגו משלו.
import { brandAssetUrl } from "../website/lib/brand";
import type { SiteHead } from "../types/site";

export const NEUTRAL_SITE_TITLE = "ניהול העסק";

/** האייקון הכללי — רק לאתר שלא העלה לוגו */
export const FALLBACK_ICON = "/favicon.png";

export function hospitalityHeadMeta(head: SiteHead) {
  const name = head.name ?? NEUTRAL_SITE_TITLE;
  return [
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { title: name },
    { name: "description", content: name },
    { name: "robots", content: "noindex, nofollow" },
    { property: "og:title", content: name },
    { property: "og:description", content: name },
    { property: "og:site_name", content: name },
    { property: "og:type", content: "website" },
    { property: "og:locale", content: "he_IL" },
    // השם מתחת לאייקון במסך הבית (אייפון / אנדרואיד) — שם העסק, לא כותרת העמוד
    { name: "apple-mobile-web-app-title", content: name },
    { name: "application-name", content: name },
  ];
}

export function hospitalityHeadLinks(
  head: SiteHead,
): { rel: string; href: string; type?: string; sizes?: string }[] {
  const logoId = head.logoId ?? null;
  if (!logoId) return [{ rel: "icon", type: "image/png", href: FALLBACK_ICON }];
  return [
    { rel: "icon", type: "image/png", sizes: "192x192", href: brandAssetUrl("icon-192", logoId) },
    {
      rel: "apple-touch-icon",
      sizes: "180x180",
      href: brandAssetUrl("apple-touch-icon", logoId),
    },
    { rel: "manifest", href: brandAssetUrl("manifest", logoId) },
  ];
}

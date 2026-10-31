// תגיות ה-meta של אתר אירוח (R-1): שם העסק בלבד — בלי ערכי SEO, מעקב, לוגו או
// צבעים של חנות. אזור הניהול לא מיועד למנועי חיפוש (noindex), אבל קישור ששותף
// (WhatsApp) מציג את שם העסק.
import type { SiteHead } from "../types/site";

export const NEUTRAL_SITE_TITLE = "ניהול העסק";

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
  ];
}

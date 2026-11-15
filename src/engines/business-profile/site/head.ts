// תגיות ה-meta של אתר עסק ב-root (Nuriel Websites): שם העסק בלבד — בלי ערכי SEO, מעקב או צבעים של חנות.
// העמודים עצמם (האתר הציבורי) מוסיפים כותרת, תיאור וכתובת קנונית מהגרסה המפורסמת; ממשק הניהול — noindex.
// nuriel-site-type: הנתב בדפדפן יודע מכאן שזה אתר עסק (מיפוי הכתובות — edge/rewrite.ts).

import { SITE_TYPE_META } from "@/platform/engines/site-type-hint";

export const NEUTRAL_TITLE = "אתר העסק";

export function businessHeadMeta(head: { name: string | null }) {
  const name = head.name ?? NEUTRAL_TITLE;
  return [
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { title: name },
    { name: "description", content: name },
    { property: "og:title", content: name },
    { property: "og:site_name", content: name },
    { property: "og:type", content: "website" },
    { property: "og:locale", content: "he_IL" },
    { name: "application-name", content: name },
    { name: SITE_TYPE_META, content: "business_profile" },
  ];
}

/** האייקון הכללי (אייקון מהלוגו של העסק — עם ספריית המדיה) */
export function businessHeadLinks(): { rel: string; href: string; type?: string }[] {
  return [{ rel: "icon", type: "image/png", href: "/favicon.png" }];
}

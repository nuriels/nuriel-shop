// עמודי המידע הקבועים של החנות (אודות, צור קשר, תקנון…) — הכותרת והתיאור לגוגל במקום אחד.
// למה: הכותרות היו "אודות" / "צור קשר" בלי שם החנות, והתיאור של כולם היה התיאור של דף הבית (תיאור זהה ב-7
// עמודים). Google: "Brand your titles concisely … include just your site name at the beginning or end of each
// <title> element" ו-"Avoid repeated or boilerplate text". התיאורים כאן מתארים רק את סוג העמוד ואת שם החנות —
// בלי שום טענה על העסק (שעות, משלוחים, WhatsApp) שאולי לא נכונה לו.

export interface StaticPageSeo {
  /** שם העמוד (גם הכותרת שבעמוד עצמו) */
  label: string;
  describe: (siteName: string) => string;
}

export const STATIC_PAGE_SEO: Readonly<Record<string, StaticPageSeo>> = {
  "/about": { label: "אודות", describe: (s) => `על ${s} — מי אנחנו ומה אנחנו מציעים.` },
  "/contact": { label: "צור קשר", describe: (s) => `דרכי ההתקשרות עם ${s}.` },
  "/terms": {
    label: "תקנון האתר",
    describe: (s) => `תקנון האתר של ${s} — תנאי הרכישה והשימוש באתר.`,
  },
  "/privacy": {
    label: "מדיניות פרטיות",
    describe: (s) => `מדיניות הפרטיות של ${s} — איזה מידע נאסף ואיך שומרים עליו.`,
  },
  "/cancellations": {
    label: "ביטול עסקה",
    describe: (s) => `ביטול עסקה ב${s} — איך מבטלים הזמנה ומה המדיניות.`,
  },
  "/sitemap": { label: "מפת האתר", describe: (s) => `מפת האתר של ${s} — כל הקטגוריות והעמודים.` },
  "/accessibility": { label: "הצהרת נגישות", describe: (s) => `הצהרת הנגישות של ${s}.` },
};

/** "אודות | נוריאל מחשבים" — שם העמוד ושם החנות, פעם אחת */
export function staticPageTitle(page: StaticPageSeo, siteName: string): string {
  return page.label === siteName ? siteName : `${page.label} | ${siteName}`;
}

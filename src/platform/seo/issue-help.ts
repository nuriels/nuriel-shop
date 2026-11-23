// NURIEL AI SEO ENGINE — מה בעל העסק רואה ליד כל ממצא בבדיקה הטכנית: מי מתקן (אתם / המערכת / התמיכה) ומשפט
// אחד בשפה פשוטה למה זה חשוב. טהור (נבדק ביחידה). המשותף לשני המנועים; פעולת התיקון עצמה ("תקנו לי",
// קישור למסך הנכון) — של כל מנוע (SeoCenter: issueAction).

export type IssueOwner = "you" | "system" | "support";

/** נוצר אוטומטית מהתבניות של הפלטפורמה — בעל העסק לא צריך לעשות כלום */
const SYSTEM = new Set([
  "h1.missing",
  "h1.multiple",
  "h1.empty",
  "headings.skip",
  "canonical.missing",
  "canonical.multiple",
  "canonical.other_host",
  "canonical.other_page",
  "canonical.invalid",
  "mobile.viewport",
  "lang.missing",
  "lang.mismatch",
  "lang.dir",
  "page.charset",
  "page.not_https",
  "page.redirect_in_sitemap",
  "schema.invalid_json",
  "schema.business_missing",
  "schema.product_missing",
  "schema.offer_missing",
  "schema.breadcrumbs_missing",
  "social.og_missing",
  "links.no_internal",
  "links.empty_text",
  "robots.missing",
  "robots.no_sitemap",
  "sitemap.missing",
  "sitemap.empty",
  "sitemap.missing_pages",
  "images.no_dimensions",
  "images.legacy_format",
  "title.multiple",
  "description.multiple",
]);

/** לא צפוי באתר תקין — שווה בדיקה של התמיכה */
const SUPPORT = new Set([
  "page.error",
  "page.error_in_sitemap",
  "page.noindex",
  "robots.blocks_page",
]);

export function issueOwner(code: string): IssueOwner {
  if (SUPPORT.has(code)) return "support";
  if (SYSTEM.has(code)) return "system";
  return "you";
}

/** למה זה חשוב — משפט אחד, בלי מונחים טכניים */
const HINT: Readonly<Record<string, string>> = {
  "title.duplicate":
    "לכל עמוד כדאי כותרת משלו בגוגל — כך גוגל מבין שאלה עמודים שונים, ומציג את הנכון.",
  "description.duplicate":
    "אותו תיאור בכמה עמודים — גוגל עלול להציג רק אחד מהם. לכל עמוד כדאי תיאור משלו.",
  "title.length_hint": "כותרת ארוכה נחתכת בתוצאות של גוגל. זו המלצה בלבד, לא תקלה.",
  "description.length_hint":
    "תיאור ארוך נחתך בגוגל, ותיאור קצר מדי לא מסביר מה יש בעמוד. זו המלצה בלבד, לא תקלה.",
  "title.missing": "בלי כותרת משלכם גוגל בוחר כותרת בעצמו.",
  "description.missing": "בלי תיאור משלכם גוגל בוחר משפט אקראי מהעמוד.",
  "content.thin": "כמה משפטים משלכם בעמוד עוזרים לגולשים ולגוגל להבין מה מיוחד בו.",
  "images.alt_missing": "תיאור קצר לכל תמונה — חשוב לגולשים עיוורים ולחיפוש תמונות בגוגל.",
};

export function issueHint(code: string): string | null {
  return HINT[code] ?? null;
}

export const OWNER_NOTE: Readonly<Record<Exclude<IssueOwner, "you">, string>> = {
  system: "זה חלק טכני שהמערכת מטפלת בו — לא צריך לעשות כלום.",
  support: "זה לא אמור לקרות באתר תקין — אם זה נשאר אחרי בדיקה חוזרת, פנו אלינו בתמיכה ונבדוק.",
};

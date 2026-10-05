import { defaultPrivacyPolicy, defaultTermsOfService, type LegalBusinessInfo } from "@/lib/legal";
import { plainTextToHtml, RED_MARK_CLASS } from "@/lib/rich-text";

/**
 * העמודים המשפטיים (חלק 16א): נוסחי ברירת המחדל של העורך בפאנל הניהול,
 * והתוכן שמוצג באתר כל עוד בעל החנות לא שמר נוסח משלו.
 *
 * המקומות שבעל החנות צריך להשלים מסומנים באדום מודגש
 * (<span class="text-red-500 font-bold">[…]</span>) — ובפאנל מופיעה הבקשה
 * לעדכן אותם לפני פרסום החנות.
 */

export type LegalPageKey = "terms" | "privacy" | "cancellation";

export const LEGAL_PAGES: {
  key: LegalPageKey;
  title: string;
  path: "/terms" | "/privacy" | "/cancellations";
  column: "terms_content" | "privacy_content" | "cancellation_policy_content";
}[] = [
  { key: "terms", title: "תקנון האתר", path: "/terms", column: "terms_content" },
  { key: "privacy", title: "מדיניות פרטיות", path: "/privacy", column: "privacy_content" },
  {
    key: "cancellation",
    title: "מדיניות ביטולים",
    path: "/cancellations",
    column: "cancellation_policy_content",
  },
];

export const LEGAL_RED_NOTE = "אנא עדכן את הטקסטים המודגשים באדום לפרטי העסק שלך טרם פרסום החנות";

const red = (text: string) => `<span class="${RED_MARK_CLASS}">${text}</span>`;
const item = (title: string, body: string) => `<p><strong>${title}</strong> ${body}</p>`;

/** תקנון — הנוסח שנמסר, כלשונו */
export const DEFAULT_TERMS_HTML = [
  item("מבוא:", "תקנון זה מהווה הסכם משפטי מחייב..."),
  item(
    "תנאי רכישה:",
    'הרכישה מותרת לבני 18 ומעלה, בעלי כרטיס אשראי ישראלי תקף. המחירים כוללים מע"מ.',
  ),
  item("אישור עסקאות:", "הנהלת האתר שומרת זכות לאימות טלפוני תוך 24 שעות."),
  item(
    "ביטולים והחזרות:",
    "ביטול יתאפשר תוך 14 ימים מקבלת המוצר כחוק. ינוכו דמי ביטול בשיעור 5% או 100 ₪ (הנמוך מביניהם).",
  ),
  item(
    "אספקה ומשלוחים:",
    `אספקה תבוצע תוך ${red("[10]")} ימי עסקים (א'-ה'). איסוף עצמי בתיאום מראש בין ${red("[17:00-23:00]")}.`,
  ),
  item("יצירת קשר:", `טלפון ${red("[050-0000000]")}, דוא"ל ${red("[example@email.com]")}.`),
].join("");

/** מדיניות פרטיות — הנוסח שנמסר, כלשונו */
export const DEFAULT_PRIVACY_HTML = [
  item("1. עקרונות:", "מדיניות זו מסבירה כיצד נאסף מידע אישי."),
  item("2. מידע נאסף:", "פרטי זיהוי, מידע טכני ופרטי הזמנה. פרטי אשראי אינם נשמרים."),
  item("3. איסוף ושימוש:", "אוטומטית או מהלקוח, לצורך השירות ושיפורו."),
  item(
    "4. צדדים שלישיים:",
    "המידע עשוי לעבור לספקי שירות ולפלטפורמת Nuri1. פרטי אשראי יועברו רק לחברת הסליקה.",
  ),
  item("5. שמירת מידע:", "שמירה כל עוד המידע נחוץ."),
  item("6. זכויותיך:", 'עיון ומחיקה ע"י פנייה לשירות הלקוחות. לא מיועד לקטינים.'),
].join("");

/**
 * מדיניות ביטולים — לפי חוק הגנת הצרכן, התשמ"א-1981 ותקנות הגנת הצרכן
 * (ביטול עסקה), התשע"א-2010; תואמת לסעיף "ביטולים והחזרות" בתקנון.
 */
export const DEFAULT_CANCELLATION_HTML = [
  '<p>ביטול עסקה שבוצעה באתר — בהתאם לחוק הגנת הצרכן, התשמ"א-1981 ולתקנות הגנת הצרכן (ביטול עסקה), התשע"א-2010.</p>',
  item(
    "1. זכות הביטול:",
    "ניתן לבטל את העסקה תוך 14 ימים מיום קבלת המוצר או מיום קבלת מסמך פרטי העסקה — המאוחר מביניהם.",
  ),
  item(
    "2. מסירת הודעת ביטול:",
    `באמצעות הטופס בעמוד זה, בטלפון ${red("[050-0000000]")} או בדוא"ל ${red("[example@email.com]")}. יש לציין את מספר ההזמנה. אין חובה לנמק את הביטול.`,
  ),
  item(
    "3. דמי ביטול:",
    "בביטול שלא עקב פגם ינוכו דמי ביטול בשיעור 5% ממחיר העסקה או 100 ₪ — הנמוך מביניהם. בביטול עקב פגם במוצר, אי-התאמה לפרטים שנמסרו או אי-אספקה במועד — לא ייגבו דמי ביטול.",
  ),
  item(
    "4. החזרת המוצר:",
    `יש להחזיר את המוצר באריזתו המקורית, כשהוא שלם ולא נעשה בו שימוש, לכתובת ${red("[כתובת להחזרת מוצרים]")} או באיסוף בתיאום מראש. עלות ההחזרה: ${red("[על חשבון הלקוח]")} (בביטול עקב פגם — על חשבון העסק).`,
  ),
  item(
    "5. החזר כספי:",
    "ההחזר יבוצע תוך 14 ימים מקבלת הודעת הביטול, באמצעי התשלום שבו בוצעה העסקה (בעסקת אשראי — ביטול החיוב בכרטיס).",
  ),
  item(
    "6. מוצרים שלא ניתן לבטל את רכישתם:",
    "טובין פסידים (כגון מוצרי מזון), מוצרים שיוצרו או הותאמו במיוחד עבור הלקוח, ותוכנה, מידע או הקלטות שהאריזה המקורית שלהם נפתחה.",
  ),
  item(
    "7. אזרחים ותיקים, אנשים עם מוגבלות ועולים חדשים:",
    "רשאים לבטל עסקה תוך 4 חודשים מיום העסקה, מיום קבלת המוצר או מיום קבלת מסמך פרטי העסקה — המאוחר מביניהם, ובלבד שההתקשרות בעסקה כללה שיחה (לרבות בתקשורת אלקטרונית). עולה חדש — עד 5 שנים מיום קבלת מעמד עולה. יש להציג תעודה מתאימה.",
  ),
].join("");

export const DEFAULT_LEGAL_HTML: Record<LegalPageKey, string> = {
  terms: DEFAULT_TERMS_HTML,
  privacy: DEFAULT_PRIVACY_HTML,
  cancellation: DEFAULT_CANCELLATION_HTML,
};

/**
 * טיוטה מפורטת לפי פרטי העסק (הנוסח הארוך מהגרסה הקודמת, src/lib/legal.ts)
 * — אפשרות נוספת בעורך לתקנון ולמדיניות הפרטיות.
 */
export function detailedLegalDraft(
  key: Exclude<LegalPageKey, "cancellation">,
  info: LegalBusinessInfo,
): string {
  const text = key === "terms" ? defaultTermsOfService(info) : defaultPrivacyPolicy(info);
  return plainTextToHtml(text);
}

/** התוכן שמוצג באתר: מה שנשמר, ואם עוד לא נשמר כלום — נוסח ברירת המחדל */
export function legalContentOrDefault(key: LegalPageKey, saved: string | null | undefined): string {
  const value = (saved ?? "").trim();
  return value === "" ? DEFAULT_LEGAL_HTML[key] : value;
}

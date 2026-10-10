import { defaultPrivacyPolicy, defaultTermsOfService, type LegalBusinessInfo } from "@/lib/legal";
import { countRedMarks, escapeHtml, plainTextToHtml, RED_MARK_CLASS } from "@/lib/rich-text";
import { PRIVACY_TEMPLATE_TEXT, TERMS_TEMPLATE_TEXT } from "@/lib/legal-templates";

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

/**
 * חלק 37ב: נוסח רגיל (שורות) → HTML לעורך ולאתר. בלוק = שורות בין שורות ריקות.
 * הבלוק הראשון — כותרת המסמך (h2); בלוק שהשורה הראשונה שלו קצרה ובלי סימן
 * פיסוק בסופה — כותרת סעיף (h3); כל שורה אחרת — פסקה, כך ששבירות השורות
 * נשמרות. רק &, < ו-> מוחלפים (גרשיים נשארים כמו שהם — כמו שהעורך שומר).
 */
export function legalTextToHtml(text: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    )
    .filter((lines) => lines.length > 0);
  return blocks
    .map((lines, index) => {
      if (index === 0 && lines.length === 1) return `<h2>${escape(lines[0]!)}</h2>`;
      const [first, ...rest] = lines;
      const isHeading = rest.length > 0 && first!.length <= 40 && !/[.:;,!?]$/.test(first!);
      return [
        isHeading ? `<h3>${escape(first!)}</h3>` : `<p>${escape(first!)}</p>`,
        ...rest.map((line) => `<p>${escape(line)}</p>`),
      ].join("");
    })
    .join("");
}

/**
 * חלק 37 / 37ב: התקנון ומדיניות הפרטיות — התבנית המלאה (src/lib/legal-templates.ts)
 * עם משתנים ({{store_name}} וכו'), שמוחלפים בכל הצגה בפרטי החנות
 * (fillLegalVariables). כך המסמך מיוחס רשמית לבעל החנות, ומתעדכן לבד כשהוא
 * משנה את פרטי העסק בהגדרות.
 *
 * ⚠ אותו נוסח בדיוק נמצא במסד (legal_default_html במיגרציה
 * 20261019450000_legal_templates_full.sql) — חנות חדשה מקבלת אותו כבר בהקמה.
 * בדיקת יחידה מוודאת ששני העותקים זהים.
 */
export const DEFAULT_TERMS_HTML = legalTextToHtml(TERMS_TEMPLATE_TEXT);

/** מדיניות פרטיות — תבנית עם משתנים (כמו התקנון) */
export const DEFAULT_PRIVACY_HTML = legalTextToHtml(PRIVACY_TEMPLATE_TEXT);

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
    `באמצעות הטופס בעמוד זה, בטלפון {{store_phone}} או בדוא"ל {{store_email}}. יש לציין את מספר ההזמנה. אין חובה לנמק את הביטול.`,
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

/**
 * חלק 37: המשתנים שאפשר לשלב בעמודים המשפטיים. בכל הצגה הם מוחלפים בפרטי
 * החנות מההגדרות ("פרטי העסק"); ערך חסר מוצג כ-[תיאור] כדי שיבלוט.
 */
export const LEGAL_VARIABLES = [
  { key: "store_name", label: "שם העסק", missing: "[שם העסק]" },
  { key: "store_email", label: 'דוא"ל לפניות', missing: '[כתובת דוא"ל]' },
  { key: "store_phone", label: "טלפון", missing: "[מספר טלפון]" },
  { key: "business_id", label: "ח.פ. / ע.מ", missing: "[מספר ח.פ./ע.מ]" },
  { key: "store_address", label: "כתובת העסק", missing: "[כתובת העסק]" },
] as const;

export type LegalVariableKey = (typeof LEGAL_VARIABLES)[number]["key"];
export type LegalVariables = Record<LegalVariableKey, string>;

/** פרטי העסק מההגדרות → ערכי המשתנים (ריק = חסר) */
export function legalVariablesFrom(
  settings:
    | {
        business_name?: string | null;
        site_title?: string | null;
        business_email?: string | null;
        support_phone?: string | null;
        business_phone?: string | null;
        business_tax_id?: string | null;
        business_address?: string | null;
      }
    | null
    | undefined,
): LegalVariables {
  const clean = (value: string | null | undefined) => (value ?? "").trim();
  return {
    store_name: clean(settings?.business_name) || clean(settings?.site_title),
    store_email: clean(settings?.business_email),
    store_phone: clean(settings?.support_phone) || clean(settings?.business_phone),
    business_id: clean(settings?.business_tax_id),
    store_address: clean(settings?.business_address),
  };
}

const VARIABLE_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** המשתנים שמופיעים בנוסח */
export function legalVariablesIn(html: string): LegalVariableKey[] {
  const known = new Set<string>(LEGAL_VARIABLES.map((variable) => variable.key));
  const found = new Set<LegalVariableKey>();
  for (const match of html.matchAll(VARIABLE_PATTERN)) {
    if (known.has(match[1] ?? "")) found.add(match[1] as LegalVariableKey);
  }
  return [...found];
}

/** {{store_name}} → "אלקטרו כהן" (מוגן — הערכים עוברים escape). משתנה לא מוכר נשאר כמו שהוא */
export function fillLegalVariables(html: string, values: LegalVariables): string {
  return html.replace(VARIABLE_PATTERN, (whole, key: string) => {
    const variable = LEGAL_VARIABLES.find((item) => item.key === key);
    if (!variable) return whole;
    const value = values[variable.key];
    return escapeHtml(value !== "" ? value : variable.missing);
  });
}

/** התוכן שמוצג באתר: מה שנשמר, ואם עוד לא נשמר כלום — נוסח ברירת המחדל */
export function legalContentOrDefault(key: LegalPageKey, saved: string | null | undefined): string {
  const value = (saved ?? "").trim();
  return value === "" ? DEFAULT_LEGAL_HTML[key] : value;
}

/** חלק 37: מה שמוצג באתר — הנוסח (שנשמר / ברירת המחדל) עם פרטי החנות במקום המשתנים */
export function legalPageHtml(
  key: LegalPageKey,
  saved: string | null | undefined,
  settings: Parameters<typeof legalVariablesFrom>[0],
): string {
  return fillLegalVariables(legalContentOrDefault(key, saved), legalVariablesFrom(settings));
}

/**
 * חלק 37ב: מה חסר בפרטי העסק.
 *  • contact — טלפון / אימייל: בלעדיהם התקנון (שמפנה אליהם) לא תקף → התראת חובה.
 *  • recommended — שם העסק, ח.פ./ע.מ, כתובת (חוק הגנת הצרכן), ומקומות שנשארו
 *    מסומנים באדום להשלמה בתקנון / במדיניות הפרטיות.
 */
export function complianceGaps(
  settings:
    | (Parameters<typeof legalVariablesFrom>[0] & {
        terms_content?: string | null;
        privacy_content?: string | null;
      })
    | null
    | undefined,
): { contact: string[]; recommended: string[] } {
  if (!settings) return { contact: [], recommended: [] };
  const has = (value: string | null | undefined) => (value ?? "").trim() !== "";
  const contact: string[] = [];
  if (!has(settings.business_email)) contact.push("אימייל");
  if (!has(settings.support_phone) && !has(settings.business_phone)) contact.push("טלפון");
  const recommended: string[] = [];
  if (!has(settings.business_name)) recommended.push("שם העסק הרשמי");
  if (!has(settings.business_tax_id)) recommended.push("מספר ח.פ. / ע.מ");
  if (!has(settings.business_address)) recommended.push("כתובת העסק");
  // נוסח ריק מוצג באתר כתבנית המלאה — חסר רק אם נשארו בו מקומות מסומנים באדום להשלמה
  if (countRedMarks(legalContentOrDefault("terms", settings.terms_content)) > 0) {
    recommended.push("השלמת המקומות המסומנים באדום בתקנון");
  }
  if (countRedMarks(legalContentOrDefault("privacy", settings.privacy_content)) > 0) {
    recommended.push("השלמת המקומות המסומנים באדום במדיניות הפרטיות");
  }
  return { contact, recommended };
}

import { RED_MARK_CLASS } from "@/lib/rich-text";

/**
 * עמודי תוכן (חלק 30) — עזרים טהורים, משותפים לניהול ולחזית החנות.
 *
 * עמוד = כותרת + כתובת (/pages/<slug>) + תוכן עשיר (HTML מהעורך, מנוקה בכל
 * הצגה). הכללים כאן זהים לבדיקות במסד (pages_guard), כך שהטופס מסביר את
 * הבעיה לפני השמירה.
 */

export type StorePage = {
  id: string;
  slug: string;
  title: string;
  content_html: string;
  is_published: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

/** קישור לעמוד — ל"מידע שימושי" בתחתית האתר ולמפת האתר */
export type StorePageLink = Pick<StorePage, "id" | "slug" | "title">;

export const PAGE_LIMITS = {
  title: 120,
  slug: 80,
  content: 200_000,
  pagesPerStore: 50,
} as const;

const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** בעיה בכתובת העמוד (או null) — אותו כלל כמו במסד */
export function pageSlugProblem(slug: string): string | null {
  const value = slug.trim().toLowerCase();
  if (value === "") return "הזינו כתובת לעמוד (באנגלית, למשל shipping-policy)";
  if (value.length > PAGE_LIMITS.slug) return `כתובת העמוד: עד ${PAGE_LIMITS.slug} תווים`;
  if (!SLUG_FORMAT.test(value)) {
    return "כתובת העמוד: אותיות באנגלית קטנות, ספרות ומקפים בלבד (למשל shipping-policy)";
  }
  return null;
}

export function pageTitleProblem(title: string): string | null {
  const value = title.trim();
  if (value === "") return "כותרת העמוד היא שדה חובה";
  if (value.length > PAGE_LIMITS.title) return `כותרת העמוד: עד ${PAGE_LIMITS.title} תווים`;
  return null;
}

/** שמות עמודים נפוצים → כתובת מוכרת (במקום תעתיק) */
const KNOWN_SLUGS: Record<string, string> = {
  "מדיניות משלוחים": "shipping-policy",
  "מדיניות משלוח": "shipping-policy",
  משלוחים: "shipping",
  "משלוחים והחזרות": "shipping-returns",
  "מדיניות החזרות": "returns",
  "מדיניות החזרות והחלפות": "returns",
  "החזרות והחלפות": "returns",
  "שאלות נפוצות": "faq",
  "שאלות ותשובות": "faq",
  תקנון: "terms",
  "תקנון האתר": "terms",
  "תנאי שימוש": "terms-of-use",
  "מדיניות פרטיות": "privacy-policy",
  "מדיניות ביטולים": "cancellation-policy",
  אודות: "about-us",
  אודותינו: "about-us",
  "מי אנחנו": "about-us",
  "צור קשר": "contact-us",
  "הצהרת נגישות": "accessibility",
  נגישות: "accessibility",
  אחריות: "warranty",
  "תעודת אחריות": "warranty",
  "שעות פתיחה": "opening-hours",
  "מועדון לקוחות": "club",
  "כרטיס מתנה": "gift-card",
};

/** תעתיק פשוט לאותיות לטיניות — כשאין שם מוכר */
const HEBREW_LATIN: Record<string, string> = {
  א: "a",
  ב: "b",
  ג: "g",
  ד: "d",
  ה: "h",
  ו: "v",
  ז: "z",
  ח: "ch",
  ט: "t",
  י: "y",
  כ: "k",
  ך: "k",
  ל: "l",
  מ: "m",
  ם: "m",
  נ: "n",
  ן: "n",
  ס: "s",
  ע: "a",
  פ: "p",
  ף: "f",
  צ: "tz",
  ץ: "tz",
  ק: "k",
  ר: "r",
  ש: "sh",
  ת: "t",
};

/** קיצור לאורך המותר — בגבול מילה (מקף) כשאפשר */
function clampSlug(slug: string): string {
  if (slug.length <= PAGE_LIMITS.slug) return slug;
  const cut = slug.slice(0, PAGE_LIMITS.slug);
  const lastHyphen = cut.lastIndexOf("-");
  return (lastHyphen > 20 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/, "");
}

/**
 * כותרת → כתובת: שם מוכר ("מדיניות משלוחים" → shipping-policy), אחרת
 * אנגלית כמו שהיא ותעתיק לעברית. ריק → "page".
 */
export function slugifyTitle(title: string): string {
  const normalized = title
    .trim()
    .replace(/\s+/g, " ")
    .replace(/["'״׳]/g, "");
  const known = KNOWN_SLUGS[normalized];
  if (known) return known;
  const latin = [...normalized.toLowerCase()].map((ch) => HEBREW_LATIN[ch] ?? ch).join("");
  const slug = latin
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clampSlug(slug) || "page";
}

/** כתובת פנויה: shipping → shipping-2 → shipping-3 … (בין העמודים הקיימים) */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, PAGE_LIMITS.slug - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base.slice(0, 60)}-${Date.now().toString(36)}`;
}

/** הנתיב בחזית החנות */
export function pagePath(slug: string): string {
  return `/pages/${slug}`;
}

// ------------------------------------------------------------
// תבניות להתחלה מהירה (טקסט אדום = מקום להשלמה, כמו בעמודים המשפטיים)
// ------------------------------------------------------------

const red = (text: string) => `<span class="${RED_MARK_CLASS}">${text}</span>`;

export type PageTemplate = { key: string; title: string; slug: string; content: string };

export const PAGE_TEMPLATES: readonly PageTemplate[] = [
  {
    key: "shipping",
    title: "מדיניות משלוחים",
    slug: "shipping-policy",
    content: [
      "<h2>זמני משלוח</h2>",
      `<p>הזמנות שמתקבלות עד השעה ${red("14:00")} בימי עסקים יוצאות למשלוח באותו יום. זמן ההגעה: ${red("עד 3 ימי עסקים")} מרגע היציאה.</p>`,
      "<h2>עלויות משלוח</h2>",
      `<ul><li>משלוח עד הבית: ${red("35 ₪")}</li><li>משלוח חינם בהזמנה מעל ${red("300 ₪")}</li></ul>`,
      "<h2>איסוף עצמי</h2>",
      `<p>אפשר לאסוף את ההזמנה מ${red("כתובת החנות")} בשעות הפתיחה, אחרי שתקבלו הודעה שההזמנה מוכנה.</p>`,
      "<h2>אזורי חלוקה</h2>",
      `<p>המשלוחים מגיעים ${red("לכל רחבי הארץ")}. לישובים מרוחקים ייתכן זמן הגעה ארוך יותר.</p>`,
    ].join(""),
  },
  {
    key: "returns",
    title: "מדיניות החזרות והחלפות",
    slug: "returns",
    content: [
      "<h2>החזרה והחלפה</h2>",
      `<p>אפשר להחזיר או להחליף מוצר תוך ${red("14 יום")} מיום קבלתו, כשהוא באריזתו המקורית ולא נעשה בו שימוש.</p>`,
      "<h2>איך מבטלים עסקה</h2>",
      '<p>ממלאים את <a href="/cancellations">טופס ביטול עסקה</a> באתר, ואנחנו חוזרים אליכם עם אישור והוראות להחזרת המוצר.</p>',
      "<h2>זיכוי</h2>",
      `<p>הזיכוי יינתן באמצעי התשלום המקורי תוך ${red("14 ימי עסקים")}, בניכוי דמי ביטול כקבוע בחוק הגנת הצרכן.</p>`,
      "<h2>מוצרים שאינם ניתנים להחזרה</h2>",
      `<p>${red("למשל: מוצרים שיוצרו במיוחד עבור הלקוח, מוצרים פגיעים או מתכלים")}.</p>`,
    ].join(""),
  },
  {
    key: "faq",
    title: "שאלות נפוצות",
    slug: "faq",
    content: [
      "<h3>תוך כמה זמן ההזמנה מגיעה?</h3>",
      `<p>בדרך כלל ${red("עד 3 ימי עסקים")}. פרטים מלאים בעמוד מדיניות המשלוחים.</p>`,
      "<h3>איך אפשר לשלם?</h3>",
      `<p>${red("בהעברה בביט, בטלפון מול נציג או במזומן באיסוף עצמי")}.</p>`,
      "<h3>אפשר לבטל הזמנה?</h3>",
      '<p>כן — דרך <a href="/cancellations">טופס ביטול עסקה</a> באתר.</p>',
      "<h3>איך יוצרים איתנו קשר?</h3>",
      '<p>בעמוד <a href="/contact">צור קשר</a>, או בטלפון שמופיע בתחתית האתר.</p>',
    ].join(""),
  },
];

/**
 * דף הנחיתה של נוריאל מחשבים (שער הפלטפורמה — nuriel-app2): התוכן הקבוע, הנתונים מהמסד
 * והבונים של JSON-LD ו-llms.txt. עזרים טהורים — משותפים לדפדפן, לשרת ולבדיקות.
 *
 * כללים:
 *  • מחירים וימי ניסיון — רק מהמסד בזמן הטעינה (LandingData), לא מספרים קבועים בקוד:
 *    חנות אינטרנטית — platform_plans + platform_pricing_settings, וימי הניסיון כמו בטריגר
 *    במסד (TRIAL_DAYS); Nuriel Hospitality — hospitality.public_plans + portal_trial_days.
 *  • שתי תקופות הניסיון נפרדות: 14 ימים לחנות אינטרנטית בלבד, 30 ימים ל-Hospitality בלבד —
 *    כל אחת עם הכפתור שלה, ואין טקסט שמערבב ביניהן.
 *  • פרטי העסק — כפי שנוריאל מחשבים מפרסמים אותם באתר החנות שלהם (nuriel-shop).
 *  • יכולות — רק מה שקיים במערכת (נבדק מול הקוד).
 */

import { shekels as portalShekels } from "@/lib/portal";

// ------------------------------------------------------------
// פרטי העסק והקישורים
// ------------------------------------------------------------

export const NURIEL_BUSINESS = {
  name: "נוריאל מחשבים",
  englishName: "Nuriel Computers",
  /** לתצוגה */
  phone: "050-5492178",
  /** tel: / schema */
  phoneIntl: "+972505492178",
  /** wa.me — ספרות בלבד */
  whatsapp: "972505492178",
  email: "nuriel.sh1@gmail.com",
  streetAddress: "הנשיא 15 ב'",
  city: "בית שמש",
  country: "IL",
} as const;

export const HOSPITALITY_PRODUCT = "Nuriel Hospitality";

/** הלוגו לסורקים (JSON-LD) — 512px, מוקטן פרופורציונלית מהקובץ המקורי (public/brand) */
export const BRAND_LOGO_PATH = "/brand/nuriel-computers-logo-512.jpg";

/** החנות של נוריאל מחשבים — חנות אמיתית שבנויה על המערכת (גם החנות לדוגמה) */
export const STORE_DEMO_URL = "https://nuriel-shop.nuri1.fit/";
/** אתר צימרים אמיתי על Nuriel Hospitality (הבית של האתר — /stay) */
export const ZIMMER_DEMO_URL = "https://nofi-dorit.nuri1.fit/stay";

export const fullAddress = () => `${NURIEL_BUSINESS.streetAddress}, ${NURIEL_BUSINESS.city}`;

export const MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
  `${NURIEL_BUSINESS.streetAddress} ${NURIEL_BUSINESS.city}`,
)}`;

export function whatsappHref(text = "שלום, הגעתי מהאתר של נוריאל מחשבים ואשמח לפרטים"): string {
  return `https://wa.me/${NURIEL_BUSINESS.whatsapp}?text=${encodeURIComponent(text)}`;
}

export const telHref = () => `tel:${NURIEL_BUSINESS.phoneIntl}`;
export const mailHref = () => `mailto:${NURIEL_BUSINESS.email}`;

/** קישור לקטגוריה בחנות של נוריאל מחשבים (כמו בכתובות של מפת האתר שלה) */
export function storeCategoryUrl(category: string): string {
  return `${STORE_DEMO_URL}?category=${encodeURIComponent(category)}`;
}

/**
 * הקטגוריות בחנות של נוריאל מחשבים — השמות המדויקים מהחנות (נבדקו מול מפת האתר שלה),
 * כדי שכל קישור יוביל לקטגוריה קיימת. `label` — הטקסט בדף (אם שונה מהשם בחנות).
 */
export const COMPUTER_GROUPS: {
  title: string;
  items: { category: string; label?: string }[];
}[] = [
  {
    title: "מחשבים",
    items: [
      { category: "מחשבים ניידים" },
      { category: "מחשבים נייחים חדשים", label: "מחשבים נייחים" },
      { category: "מחשבים מחודשים" },
      { category: "מחשבי גיימינג" },
    ],
  },
  {
    title: "רכיבים ושדרוג",
    items: [
      { category: "SSD NVMe למחשבים נייחים וניידי", label: "כונני SSD NVMe" },
      { category: "כרטיסי מסך למחשבי גיימינג", label: "כרטיסי מסך" },
      { category: "מארזים למחשבי גיימינג", label: "מארזים" },
    ],
  },
  {
    title: "ציוד היקפי ומדפסות",
    items: [
      { category: "מסכים" },
      { category: "מקלדות ועכברים" },
      { category: "מדפסות" },
      { category: "דיו למדפסות HP", label: "דיו למדפסות" },
      { category: "שמע ואודיו" },
    ],
  },
  {
    title: "תוכנה ותקשורת",
    items: [{ category: "תוכנות" }, { category: "תקשורת" }],
  },
];

/** השירותים של נוריאל מחשבים (כפי שמופיעים בתיאור החנות שלהם) */
export const COMPUTER_SERVICES: { title: string; text: string }[] = [
  {
    title: "תיקון מחשבים",
    text: "אבחון ותיקון של מחשבים ניידים ונייחים — לבית ולעסק.",
  },
  {
    title: "שדרוג זיכרון ו-SSD",
    text: "הוספת זיכרון RAM והחלפה לכונן SSD מהיר — שדרוג שמחזיר חיים למחשב.",
  },
  {
    title: "התקנת Windows ותוכנות",
    text: "Windows ו-Office ברישוי מקורי, והתקנה מסודרת של התוכנות שאתם צריכים.",
  },
  {
    title: "ייעוץ ותמיכה",
    text: "עזרה בבחירת מחשב לעבודה, ללימודים או למשחקים — ותמיכה גם אחרי הקנייה.",
  },
];

/** "במה נוכל לעזור?" בטופס — הנושא מצורף לתחילת ההודעה (טופס "צור קשר" הקיים שומר הודעה אחת) */
export const CONTACT_TOPICS = [
  "מחשבים ושירות",
  "חנות אינטרנטית",
  HOSPITALITY_PRODUCT,
  "אחר",
] as const;

/** ההודעה שנשמרת בתיבת הפניות: "נושא: …" ואז מה שהגולש כתב */
export function contactMessage(topic: string, message: string): string {
  return `נושא: ${topic}\n\n${message.trim()}`;
}

// ------------------------------------------------------------
// הנתונים מהמסד (נטענים בשרת — getPortalLanding)
// ------------------------------------------------------------

export type LandingStorePlan = {
  code: "basic" | "premium";
  title: string;
  tagline: string;
  monthlyPrice: number;
  features: string[];
  badge: string | null;
  /** למי מתאים — מההגבלות האמיתיות של החבילה (PLAN_FEATURES) */
  fit: string;
};

export type LandingZimmerPlan = {
  code: string;
  name: string;
  tagline: string;
  monthlyPrice: number | null;
  setupFee: number | null;
  maxUnits: number | null;
  highlights: string[];
  /** למי מתאים — ממספר היחידות בחבילה */
  fit: string;
};

export type LandingData = {
  /** https://nuriel-app2.nuri1.fit — לכתובת הקנונית ול-JSON-LD */
  origin: string;
  store: {
    trialDays: number;
    plans: LandingStorePlan[];
    paymentNote: string;
    vatNote: string;
  };
  hospitality: {
    /** null — לא ידוע (המסד לא החזיר): הטקסטים בלי מספר */
    trialDays: number | null;
    plans: LandingZimmerPlan[];
  };
};

/** "450 ₪" — אותו פורמט כמו בחלון הכניסה של השער (shekels ב-portal.ts) */
export const shekels = (value: number): string => portalShekels(value) ?? "";

/** למי מתאימה חבילת החנות — לפי ההגבלות שנאכפות בפועל (PLAN_FEATURES / plan_features במסד) */
export function storePlanFit(
  code: "basic" | "premium",
  maxProducts: number | null,
  customDomain: boolean,
): string {
  if (code === "basic") {
    const limit = maxProducts
      ? `עד ${maxProducts.toLocaleString("he-IL")} מוצרים`
      : "מוצרים ללא הגבלה";
    return `לעסק שמתחיל למכור באונליין: ${limit}${customDomain ? ", עם דומיין משלכם" : ", בכתובת מאובטחת על nuri1.fit"}.`;
  }
  return "לחנות שגדלה: מוצרים ללא הגבלה, דומיין משלכם, וריאציות ומוצרים דיגיטליים.";
}

/** למי מתאימה חבילת האירוח — לפי מספר היחידות שבחבילה (hospitality.plans.max_units) */
export function zimmerPlanFit(maxUnits: number | null): string {
  if (maxUnits === null) return "למתחמים גדולים, לכמה מתחמים ולמלונות בוטיק — יחידות ללא הגבלה.";
  if (maxUnits === 1) return "למתחם עם יחידת אירוח אחת.";
  return `לצימר או למתחם קטן — עד ${maxUnits} יחידות אירוח.`;
}

/** "14 ימי ניסיון" / "תקופת ניסיון" (כשהמספר לא ידוע) */
export const trialLabel = (days: number | null) => (days ? `${days} ימי ניסיון` : "תקופת ניסיון");

/** טקסט הכפתור — "התחילו 14 ימי ניסיון בחינם" */
export const trialCta = (days: number | null) =>
  days ? `התחילו ${days} ימי ניסיון בחינם` : "התחילו תקופת ניסיון בחינם";

/** דמי ההקמה של Hospitality — אם לכל החבילות אותו סכום (כמו היום), אחרת null */
export function commonSetupFee(plans: LandingZimmerPlan[]): number | null {
  const fees = [...new Set(plans.map((p) => p.setupFee).filter((f): f is number => f !== null))];
  return fees.length === 1 ? (fees[0] ?? null) : null;
}

// ------------------------------------------------------------
// שאלות נפוצות — גם בדף, גם ב-JSON-LD וגם ב-llms.txt (אותו טקסט בדיוק)
// ------------------------------------------------------------

export type FaqItem = { q: string; a: string };

export function landingFaq(data: LandingData): FaqItem[] {
  const storeDays = data.store.trialDays;
  const hospDays = data.hospitality.trialDays;
  const fee = commonSetupFee(data.hospitality.plans);
  return [
    {
      q: "צריך ידע טכני כדי להקים חנות אינטרנטית או אתר לצימר?",
      a: "לא. נרשמים עם קוד חד-פעמי למייל (בלי סיסמאות), ממלאים את פרטי העסק ונכנסים לאזור ניהול בעברית. בעלי צימרים מקבלים מדריך הקמה, ואנחנו חוזרים אליהם בטלפון תוך יום עסקים כדי לעזור בהקמה.",
    },
    {
      q: "כמה זמן נמשכת תקופת הניסיון?",
      a: `חנות אינטרנטית: ${storeDays} ימי ניסיון, עם כל הכלים של חבילת הפרימיום. ${HOSPITALITY_PRODUCT}: ${
        hospDays ? `${hospDays} ימי ניסיון` : "תקופת ניסיון"
      }, הכול פתוח. אלה שתי תקופות נפרדות — כל אחת למוצר שלה — ואין צורך בכרטיס אשראי כדי להתחיל.`,
    },
    {
      q: "מה קורה בסוף תקופת הניסיון?",
      a: `בוחרים חבילה. בחנות אינטרנטית — בלי חבילה החנות נסגרת ללקוחות עד שבוחרים. ב-${HOSPITALITY_PRODUCT} — מספרים לנו איזו חבילה מתאימה לכם ומקבלים קישור לתשלום לפי החבילה.`,
    },
    ...(fee !== null
      ? [
          {
            q: `מה כוללים דמי ההקמה של ${HOSPITALITY_PRODUCT}?`,
            a: `תשלום חד-פעמי של ${shekels(fee)}, בכל החבילות: חיבור דומיין, עיצוב, תוכן והגדרות גוגל.`,
          },
        ]
      : []),
    {
      q: "אפשר לחבר דומיין משלי?",
      a: `כן. בחנות אינטרנטית — בחבילת הפרימיום (או כתוסף). ב-${HOSPITALITY_PRODUCT} — חיבור הדומיין הוא חלק מההקמה. עד אז האתר עובד בכתובת מאובטחת על nuri1.fit.`,
    },
    {
      q: "יש סנכרון עם Airbnb ו-Booking.com?",
      a: `כן, בחבילת הפרימיום של ${HOSPITALITY_PRODUCT}: יומני Airbnb ו-Booking.com מסתנכרנים עם יומן התפוסה, כדי למנוע הזמנות כפולות.`,
    },
    {
      q: "אפשר לנהל הכול מהטלפון?",
      a: "כן. החנויות, אתרי הצימרים ואזורי הניהול מותאמים לטלפון — מוסיפים מוצר, מאשרים הזמנה או פותחים תאריכים מכל מקום.",
    },
    {
      q: "אפשר לראות דוגמאות אמיתיות?",
      a: "כן. החנות של נוריאל מחשבים (nuriel-shop.nuri1.fit) בנויה על המערכת, וכך גם אתר מתחם הצימרים נופי דורית (nofi-dorit.nuri1.fit).",
    },
  ];
}

// ------------------------------------------------------------
// SEO — כותרת, תיאור, JSON-LD (רק נתונים אמיתיים)
// ------------------------------------------------------------

export const LANDING_TITLE = "נוריאל מחשבים — מחשבים, הקמת חנות אינטרנטית ומערכת לניהול צימרים";

export function landingDescription(data: LandingData): string {
  const storeDays = data.store.trialDays;
  const hospDays = data.hospitality.trialDays;
  return (
    `נוריאל מחשבים, בית שמש: מחשבים, ציוד ושירות, הקמת חנות אינטרנטית לעסק בלי ידע טכני (${storeDays} ימי ניסיון) ` +
    `ומערכת לניהול צימרים — אתר, הזמנות ויומן תפוסה${hospDays ? ` (${hospDays} ימי ניסיון)` : ""}.`
  );
}

type JsonObject = Record<string, unknown>;

function monthlyOffer(
  name: string,
  price: number,
  url: string,
  extra: JsonObject = {},
): JsonObject {
  return {
    "@type": "Offer",
    name,
    url,
    priceCurrency: "ILS",
    price: price.toFixed(2),
    availability: "https://schema.org/InStock",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: price.toFixed(2),
      priceCurrency: "ILS",
      unitCode: "MON",
      referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
    },
    ...extra,
  };
}

/**
 * JSON-LD של הדף: העסק (ComputerStore — חנות מחשבים עם כתובת אמיתית), האתר, שני
 * השירותים עם המחירים מהמסד, ו-FAQPage שזהה לשאלות שמוצגות בדף.
 * בלי דירוגים, ביקורות, שעות פתיחה או מיקום גאוגרפי — אין לנו נתונים מאומתים עליהם.
 */
export function landingJsonLd(data: LandingData): JsonObject {
  const url = `${data.origin.replace(/\/+$/, "")}/`;
  const orgId = `${url}#organization`;
  const storePlans = data.store.plans.map((p) =>
    monthlyOffer(`${p.title} — חנות אינטרנטית`, p.monthlyPrice, `${url}#pricing`),
  );
  const zimmerPlans = data.hospitality.plans
    .filter((p) => p.monthlyPrice !== null)
    .map((p) =>
      monthlyOffer(
        `${HOSPITALITY_PRODUCT} — ${p.name}`,
        p.monthlyPrice as number,
        `${url}#pricing`,
      ),
    );
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ComputerStore",
        "@id": orgId,
        name: NURIEL_BUSINESS.name,
        alternateName: NURIEL_BUSINESS.englishName,
        url,
        logo: {
          "@type": "ImageObject",
          url: `${url}${BRAND_LOGO_PATH.replace(/^\//, "")}`,
          width: 512,
          height: 512,
        },
        image: `${url}${BRAND_LOGO_PATH.replace(/^\//, "")}`,
        telephone: NURIEL_BUSINESS.phoneIntl,
        email: NURIEL_BUSINESS.email,
        address: {
          "@type": "PostalAddress",
          streetAddress: NURIEL_BUSINESS.streetAddress,
          addressLocality: NURIEL_BUSINESS.city,
          addressCountry: NURIEL_BUSINESS.country,
        },
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer service",
          telephone: NURIEL_BUSINESS.phoneIntl,
          email: NURIEL_BUSINESS.email,
          availableLanguage: ["he"],
        },
        sameAs: [STORE_DEMO_URL],
      },
      {
        "@type": "WebSite",
        "@id": `${url}#website`,
        url,
        name: NURIEL_BUSINESS.name,
        inLanguage: "he-IL",
        publisher: { "@id": orgId },
      },
      {
        "@type": "Service",
        "@id": `${url}#online-store`,
        name: "הקמת חנות אינטרנטית לעסק",
        serviceType: "פלטפורמה להקמת חנות אינטרנטית",
        description:
          "מערכת בעברית להקמה וניהול של חנות אינטרנטית: מוצרים וקטגוריות, הזמנות, מלאי, משלוחים, עיצוב, קופונים ומבצעים — בלי ידע טכני.",
        provider: { "@id": orgId },
        areaServed: { "@type": "Country", name: "ישראל" },
        url: `${url}#online-store`,
        ...(storePlans.length > 0 ? { offers: storePlans } : {}),
      },
      {
        "@type": "Service",
        "@id": `${url}#hospitality`,
        name: `${HOSPITALITY_PRODUCT} — מערכת לניהול צימרים`,
        serviceType: "מערכת לניהול צימרים ומתחמי אירוח",
        description:
          "אתר לצימר או למתחם אירוח, בקשות הזמנה, זמינות ויומן תפוסה, ניהול יחידות וחדרים ומעקב תשלומים — במערכת אחת בעברית.",
        provider: { "@id": orgId },
        areaServed: { "@type": "Country", name: "ישראל" },
        url: `${url}#hospitality`,
        ...(zimmerPlans.length > 0 ? { offers: zimmerPlans } : {}),
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        mainEntity: landingFaq(data).map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };
}

// ------------------------------------------------------------
// llms.txt — תקציר לכלי בינה מלאכותית (רק תוכן ציבורי)
// ------------------------------------------------------------

export function landingLlmsTxt(data: LandingData): string {
  const url = data.origin.replace(/\/+$/, "");
  const fee = commonSetupFee(data.hospitality.plans);
  const lines: string[] = [
    `# ${NURIEL_BUSINESS.name} (${NURIEL_BUSINESS.englishName})`,
    "",
    `> ${landingDescription(data)}`,
    "",
    "## מה אנחנו עושים",
    "",
    `- [מחשבים ושירות](${url}/#computers): חנות מחשבים בבית שמש — מחשבים ניידים ונייחים, מחודשים, ציוד היקפי ומדפסות; תיקון, שדרוג RAM ו-SSD, התקנת Windows ותוכנות. החנות באונליין: ${STORE_DEMO_URL}`,
    `- [חנות אינטרנטית לעסק](${url}/#online-store): פלטפורמה בעברית להקמת חנות אינטרנטית בלי ידע טכני — מוצרים, הזמנות, מלאי, משלוחים, עיצוב ושיווק. ${data.store.trialDays} ימי ניסיון בחינם (לחנות אינטרנטית בלבד).`,
    `- [${HOSPITALITY_PRODUCT}](${url}/#hospitality): מערכת לניהול צימרים ומתחמי אירוח — אתר, בקשות הזמנה, זמינות, יומן תפוסה, יחידות וחדרים ומעקב תשלומים.${
      data.hospitality.trialDays
        ? ` ${data.hospitality.trialDays} ימי ניסיון בחינם (ל-${HOSPITALITY_PRODUCT} בלבד).`
        : ""
    }`,
    "",
    "## מחירים (לחודש)",
    "",
    ...data.store.plans.map(
      (p) => `- חנות אינטרנטית — ${p.title}: ${shekels(p.monthlyPrice)}. ${p.fit}`,
    ),
    ...(data.store.vatNote ? [`- ${data.store.vatNote.replace(/^\*\s*/, "")}`] : []),
    ...(data.store.paymentNote ? [`- ${data.store.paymentNote}`] : []),
    ...data.hospitality.plans
      .filter((p) => p.monthlyPrice !== null)
      .map(
        (p) =>
          `- ${HOSPITALITY_PRODUCT} — ${p.name}: ${shekels(p.monthlyPrice as number)}. ${p.fit}`,
      ),
    ...(fee !== null
      ? [
          `- ${HOSPITALITY_PRODUCT} — דמי הקמה חד-פעמיים: ${shekels(fee)} (דומיין, עיצוב, תוכן והגדרות גוגל).`,
        ]
      : []),
    "",
    "## דוגמאות אמיתיות",
    "",
    `- [החנות של נוריאל מחשבים](${STORE_DEMO_URL}): חנות אמיתית שבנויה על הפלטפורמה.`,
    `- [נופי דורית — מתחם צימרים](${ZIMMER_DEMO_URL}): אתר צימרים אמיתי על ${HOSPITALITY_PRODUCT}.`,
    "",
    "## שאלות נפוצות",
    "",
    ...landingFaq(data).flatMap((item) => [`### ${item.q}`, "", item.a, ""]),
    "## יצירת קשר",
    "",
    `- טלפון ו-WhatsApp: ${NURIEL_BUSINESS.phone}`,
    `- אימייל: ${NURIEL_BUSINESS.email}`,
    `- כתובת: ${fullAddress()}`,
    `- טופס פנייה: ${url}/#contact`,
    "",
  ];
  return lines.join("\n");
}

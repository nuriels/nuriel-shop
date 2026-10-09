/**
 * שיווק ואינטגרציות (חלק 14) — עזרים טהורים, משותפים לדפדפן ולשרת:
 * SEO, מזהי Facebook Pixel / Google Analytics (נכנסים ל-<head>), פופ-אפ
 * המבצעים, וזאפ.
 */

/** הגבלות האורך — כמו ב-CHECK במסד */
export const SEO_TITLE_MAX = 120;
export const SEO_DESCRIPTION_MAX = 320;
/** מה שגוגל מציג בפועל (ההמלצה בממשק) */
export const SEO_TITLE_RECOMMENDED = 60;
export const SEO_DESCRIPTION_RECOMMENDED = 160;
export const PROMO_TEXT_MAX = 600;

/** חלק 36: מילות מפתח למוצר — כמו normalize_seo_keywords במסד */
export const SEO_KEYWORDS_MAX = 500;
export const SEO_KEYWORDS_COUNT = 30;
export const SEO_KEYWORD_LENGTH = 60;

/** "נעלי ריצה,  נעלי ריצה ; Nike" → ["נעלי ריצה", "Nike"] (בלי כפילויות, בסדר ההקלדה) */
export function splitKeywords(value: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of String(value ?? "").split(/[,;،\n\r]+/)) {
    const word = raw.replace(/\s+/g, " ").trim();
    if (word === "" || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    out.push(word);
  }
  return out;
}

/** הצורה שנשמרת: "מילה, מילה" ("" = בלי מילות מפתח) */
export function normalizeKeywords(value: string | null | undefined): string {
  return splitKeywords(value).join(", ");
}

/** שגיאה ברשימת מילות המפתח (null = תקין) */
export function keywordsProblem(value: string | null | undefined): string | null {
  const words = splitKeywords(value);
  const long = words.find((word) => word.length > SEO_KEYWORD_LENGTH);
  if (long) return `מילת מפתח ארוכה מדי (עד ${SEO_KEYWORD_LENGTH} תווים): "${long.slice(0, 40)}…"`;
  if (words.length > SEO_KEYWORDS_COUNT) {
    return `יותר מדי מילות מפתח (${words.length}) — עד ${SEO_KEYWORDS_COUNT}`;
  }
  if (words.join(", ").length > SEO_KEYWORDS_MAX) {
    return `מילות המפתח ארוכות מדי (עד ${SEO_KEYWORDS_MAX} תווים בסך הכל)`;
  }
  return null;
}

/** אותם פורמטים כמו ב-CHECK במסד: רק המזהה הרשמי — בלי שום תו אחר */
export const PIXEL_ID_FORMAT = /^[0-9]{6,20}$/;
export const GA_ID_FORMAT = /^((G|GT|AW)-[A-Z0-9]{4,16}|UA-[0-9]{4,10}-[0-9]{1,4})$/;

export function normalizePixelId(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "");
}

export function normalizeGaId(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function pixelIdProblem(value: string): string | null {
  if (value === "") return null;
  return PIXEL_ID_FORMAT.test(value)
    ? null
    : "מזהה Pixel: ספרות בלבד (6 עד 20) — מתוך מנהל האירועים של Meta";
}

export function gaIdProblem(value: string): string | null {
  if (value === "") return null;
  return GA_ID_FORMAT.test(value)
    ? null
    : "מזהה Google Analytics: בפורמט G-XXXXXXXXXX (מזהה המדידה של ה-Stream)";
}

export type MarketingSettings = {
  seo_title: string;
  seo_description: string;
  promo_popup_enabled: boolean;
  promo_popup_text: string;
  promo_popup_coupon: string | null;
  facebook_pixel_id: string | null;
  google_analytics_id: string | null;
  zap_delivery_days: number;
};

export const MARKETING_COLUMNS =
  "seo_title, seo_description, promo_popup_enabled, promo_popup_text, promo_popup_coupon, facebook_pixel_id, google_analytics_id, zap_delivery_days" as const;

export const EMPTY_MARKETING: MarketingSettings = {
  seo_title: "",
  seo_description: "",
  promo_popup_enabled: false,
  promo_popup_text: "",
  promo_popup_coupon: null,
  facebook_pixel_id: null,
  google_analytics_id: null,
  zap_delivery_days: 3,
};

/** מה שה-root מעביר לדפדפן (מ-getSiteSeo) */
export type StoreTracking = { pixelId: string | null; gaId: string | null };
export type StorePromo = { text: string; coupon: string | null } | null;

/**
 * הקוד הרשמי של Meta Pixel ו-Google Analytics (gtag.js). המזהים עוברים את
 * הבדיקה של הפורמט — אחרת לא נכנס כלום (הגנה כפולה מעבר ל-CHECK במסד).
 */
export function trackingHeadScripts(
  tracking: StoreTracking | null | undefined,
): { src?: string; async?: boolean; children?: string }[] {
  if (!tracking) return [];
  const scripts: { src?: string; async?: boolean; children?: string }[] = [];
  const pixel =
    tracking.pixelId && PIXEL_ID_FORMAT.test(tracking.pixelId) ? tracking.pixelId : null;
  const ga = tracking.gaId && GA_ID_FORMAT.test(tracking.gaId) ? tracking.gaId : null;
  if (ga) {
    scripts.push({ src: `https://www.googletagmanager.com/gtag/js?id=${ga}`, async: true });
    scripts.push({
      children: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga}');`,
    });
  }
  if (pixel) {
    scripts.push({
      children: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixel}');fbq('track','PageView');`,
    });
  }
  return scripts;
}

/** עמודים שבהם לא טוענים מעקב ולא פופ-אפ: אזורי הצוות, החשבון והקופה הפנימית */
export const NO_MARKETING_PATHS =
  /^\/(admin|admin-handoff|agent|warehouse|courier|platform|login|register|reset-password|locked|forbidden|account|orders|agreement)(\/|$)/;

type TrackWindow = Window & {
  fbq?: (...args: unknown[]) => void;
  gtag?: (...args: unknown[]) => void;
};

/** מעבר עמוד בתוך האתר (בלי טעינה מחדש) — ל-Pixel; GA4 מזהה לבד */
export function trackPageView(): void {
  if (typeof window === "undefined") return;
  (window as TrackWindow).fbq?.("track", "PageView");
}

/** הזמנה נשלחה — אירוע רכישה ל-Pixel ול-GA (הסכום בשקלים) */
export function trackPurchase(orderNumber: string, value: number): void {
  if (typeof window === "undefined" || !Number.isFinite(value)) return;
  const w = window as TrackWindow;
  const amount = Math.round(value * 100) / 100;
  w.fbq?.("track", "Purchase", { value: amount, currency: "ILS" });
  w.gtag?.("event", "purchase", { transaction_id: orderNumber, value: amount, currency: "ILS" });
}

/** הוספה לסל — ל-Pixel ול-GA */
export function trackAddToCart(name: string, value: number): void {
  if (typeof window === "undefined") return;
  const w = window as TrackWindow;
  const amount = Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  w.fbq?.("track", "AddToCart", { content_name: name, value: amount, currency: "ILS" });
  w.gtag?.("event", "add_to_cart", {
    currency: "ILS",
    value: amount,
    items: [{ item_name: name }],
  });
}

/** הפופ-אפ מוצג פעם אחת לכל נוסח (נוסח חדש — מוצג שוב) */
export function promoSeenKey(text: string, coupon: string | null): string {
  let hash = 0;
  for (const char of `${text}|${coupon ?? ""}`) {
    hash = (Math.imul(hash, 31) + (char.codePointAt(0) ?? 0)) | 0;
  }
  return `promo-popup-seen:${(hash >>> 0).toString(36)}`;
}

/** הקישור לפיד של החנות לזאפ */
export function zapFeedUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/zap.xml`;
}

/** דף ההצטרפות של זאפ לבעלי חנויות */
export const ZAP_JOIN_URL = "https://www.zap.co.il/joinzap.aspx";

/** טקסט נקי מ-HTML ומרווחים כפולים — לתיאורים (meta, זאפ) */
export function plainText(value: string | null | undefined, max: number): string {
  const text = String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

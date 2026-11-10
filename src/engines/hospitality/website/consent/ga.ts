// Google SEO שלב 4: טעינת Google Analytics 4 — רק אחרי שהגולש אישר מדידה (Consent Mode, "basic"):
// לפני אישור לא נטען שום קוד של Google ולא נשלחת שום בקשה. באישור: ברירת המחדל של Consent Mode —
// הכול חסום, ואז עדכון — רק analytics_storage מותר (פרסום: ad_storage / ad_user_data / ad_personalization
// נשארים חסומים תמיד). ה-Cookies של המדידה — רק על הכתובת של האתר (cookie_domain), לא על הדומיין
// של הפלטפורמה, כך שלא מתערבבים עם אתר אחר בפלטפורמה (כולל החנויות). בביטול: עדכון ל-denied ומחיקת
// ה-Cookies של המדידה מהכתובת; בטעינה הבאה הקוד לא נטען בכלל.
// האירועים (gaEvent): נשלחים רק אחרי אישור; לפני החלטה — נשמרים בזיכרון הדף (עד 20, רק של העמוד הנוכחי)
// ונשלחים אם הגולש מאשר בעמוד הזה; סירוב / ביטול / אתר בלי מדידה — נמחקים ולא נשמר כלום. צפייה בעמוד —
// אנחנו שולחים (send_page_view: false), עם כתובת בלי ה-# ובלי השאילתה (רק utm_*) — הקישורים האישיים לא
// מגיעים ל-Google. בלי Google signals ובלי התאמה אישית של פרסום.
import { analyticsCookieNames } from "./consent";
import { cleanPageLocation } from "./events";

type Gtag = (...args: unknown[]) => void;
type GaWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag };

export const GTAG_SRC = "https://www.googletagmanager.com/gtag/js";

let loaded: string | null = null;
/** אושרה מדידה בעמוד הזה (נשלח מיד) */
let consented = false;
/** אין מה לשמור: האתר בלי מדידה, או שהגולש סירב / ביטל */
let closed = true;
const pending: [string, Record<string, unknown>][] = [];
const PENDING_MAX = 20;

function gtagOf(w: GaWindow): Gtag {
  w.dataLayer = w.dataLayer ?? [];
  if (!w.gtag) {
    // בדיוק כמו הקטע הרשמי של Google: dataLayer.push(arguments)
    w.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer!.push(arguments);
    };
  }
  return w.gtag;
}

/** אישור מדידה: טוען את GA4 (פעם אחת) או מעדכן את ההסכמה אם כבר נטען */
export function grantAnalytics(measurementId: string): void {
  if (typeof window === "undefined") return;
  const w = window as GaWindow;
  const gtag = gtagOf(w);
  if (loaded === measurementId) {
    gtag("consent", "update", { analytics_storage: "granted" });
    consented = true;
    closed = false;
    flush(gtag);
    return;
  }
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
  });
  gtag("consent", "update", { analytics_storage: "granted" });
  gtag("js", new Date());
  gtag("config", measurementId, {
    cookie_domain: window.location.hostname,
    cookie_flags: window.location.protocol === "https:" ? "SameSite=Lax;Secure" : "SameSite=Lax",
    // צפייה בעמוד — שולחים בעצמנו (gaPageView), עם כתובת נקייה; גם בכל מעבר עמוד באתר
    send_page_view: false,
    page_location: cleanPageLocation(window.location.href),
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = `${GTAG_SRC}?id=${encodeURIComponent(measurementId)}`;
  script.dataset["hospConsent"] = "analytics";
  document.head.appendChild(script);
  loaded = measurementId;
  consented = true;
  closed = false;
  flush(gtag);
}

function flush(gtag: Gtag) {
  for (const [name, params] of pending.splice(0)) gtag("event", name, params);
}

/**
 * המדידה זמינה באתר הזה (מתג + מזהה GA4) — אפשר לשמור אירועים עד ההחלטה של הגולש. לא זמינה —
 * לא נשמר כלום
 */
export function armAnalytics(available: boolean): void {
  if (available) {
    if (!consented) closed = false;
    return;
  }
  closed = true;
  consented = false;
  pending.length = 0;
}

/** אירוע ל-GA4 — רק אחרי אישור (ראו למעלה). בלי מידע אישי בפרמטרים (consent/events.ts) */
export function gaEvent(name: string, params: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const w = window as GaWindow;
  if (consented && loaded && w.gtag) {
    w.gtag("event", name, params);
    return;
  }
  if (closed || pending.length >= PENDING_MAX) return;
  pending.push([name, params]);
}

/** צפייה בעמוד (גם במעבר בין עמודי האתר): מה שנשמר לעמוד הקודם — נמחק */
export function gaPageView(): void {
  if (typeof window === "undefined") return;
  if (!consented) pending.length = 0;
  gaEvent("page_view", {
    page_location: cleanPageLocation(window.location.href),
    page_title: document.title.slice(0, 120),
  });
}

/** ביטול מדידה: Consent Mode ל-denied, ומחיקת ה-Cookies של המדידה מהכתובת הזו */
export function denyAnalytics(): void {
  if (typeof window === "undefined") return;
  consented = false;
  closed = true;
  pending.length = 0;
  const w = window as GaWindow;
  if (w.gtag) w.gtag("consent", "update", { analytics_storage: "denied" });
  const host = window.location.hostname;
  for (const name of analyticsCookieNames(document.cookie)) {
    document.cookie = `${name}=; Path=/; Max-Age=0`;
    document.cookie = `${name}=; Path=/; Domain=${host}; Max-Age=0`;
  }
}

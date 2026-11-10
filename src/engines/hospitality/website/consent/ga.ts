// Google SEO שלב 4: טעינת Google Analytics 4 — רק אחרי שהגולש אישר מדידה (Consent Mode, "basic"):
// לפני אישור לא נטען שום קוד של Google ולא נשלחת שום בקשה. באישור: ברירת המחדל של Consent Mode —
// הכול חסום, ואז עדכון — רק analytics_storage מותר (פרסום: ad_storage / ad_user_data / ad_personalization
// נשארים חסומים תמיד). ה-Cookies של המדידה — רק על הכתובת של האתר (cookie_domain), לא על הדומיין
// של הפלטפורמה, כך שלא מתערבבים עם אתר אחר בפלטפורמה (כולל החנויות). בביטול: עדכון ל-denied ומחיקת
// ה-Cookies של המדידה מהכתובת; בטעינה הבאה הקוד לא נטען בכלל.
// האירועים (gaEvent): נשלחים רק אחרי אישור; לפני החלטה — נשמרים בזיכרון הדף (עד 20, רק של העמוד הנוכחי)
// ונשלחים אם הגולש מאשר בעמוד הזה; סירוב / ביטול / אתר בלי מדידה — נמחקים ולא נשמר כלום. צפייה בעמוד —
// אנחנו שולחים (send_page_view: false), עם כתובת בלי ה-# ובלי השאילתה (רק utm_*) — הקישורים האישיים לא
// מגיעים ל-Google. גם כל אירוע אחר נשלח עם הכתובת הנקייה של העמוד שבו קרה (אחרת, אחרי מעבר עמוד באתר,
// הוא היה מיוחס לעמוד הראשון). בלי Google signals ובלי התאמה אישית של פרסום.
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
/** אירועים שמחכים להחלטה — כל אחד עם העמוד שבו קרה (מעבר עמוד מוחק את אלה של העמוד הקודם) */
const pending: { path: string; name: string; params: Record<string, unknown> }[] = [];
const PENDING_MAX = 20;

/** הכתובת הנקייה של העמוד — בכל אירוע (אם האירוע לא קבע אחרת) */
function withPage(params: Record<string, unknown>): Record<string, unknown> {
  return { page_location: cleanPageLocation(window.location.href), ...params };
}

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

/** שליחת מה שנשמר — רק של העמוד הנוכחי */
function flush(gtag: Gtag) {
  const path = window.location.pathname;
  for (const e of pending.splice(0)) if (e.path === path) gtag("event", e.name, e.params);
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
  const full = withPage(params);
  if (consented && loaded && w.gtag) {
    w.gtag("event", name, full);
    return;
  }
  if (closed || pending.length >= PENDING_MAX) return;
  pending.push({ path: window.location.pathname, name, params: full });
}

/**
 * צפייה בעמוד (גם במעבר בין עמודי האתר): מה שנשמר לעמוד קודם — נמחק; אירוע שכבר נשמר לעמוד הזה
 * (למשל view_item שקדם לצפייה) — נשאר, אחרי הצפייה
 */
export function gaPageView(): void {
  if (typeof window === "undefined") return;
  const view = { page_title: document.title.slice(0, 120) };
  if (consented) {
    gaEvent("page_view", view);
    return;
  }
  const path = window.location.pathname;
  for (let i = pending.length - 1; i >= 0; i--) if (pending[i]!.path !== path) pending.splice(i, 1);
  if (closed) return;
  pending.unshift({ path, name: "page_view", params: withPage(view) });
  if (pending.length > PENDING_MAX) pending.length = PENDING_MAX;
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

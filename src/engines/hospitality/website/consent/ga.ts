// Google SEO שלב 4: טעינת Google Analytics 4 — רק אחרי שהגולש אישר מדידה (Consent Mode, "basic"):
// לפני אישור לא נטען שום קוד של Google ולא נשלחת שום בקשה. באישור: ברירת המחדל של Consent Mode —
// הכול חסום, ואז עדכון — רק analytics_storage מותר (פרסום: ad_storage / ad_user_data / ad_personalization
// נשארים חסומים תמיד). ה-Cookies של המדידה — רק על הכתובת של האתר (cookie_domain), לא על הדומיין
// של הפלטפורמה, כך שלא מתערבבים עם אתר אחר בפלטפורמה (כולל החנויות). בביטול: עדכון ל-denied ומחיקת
// ה-Cookies של המדידה מהכתובת; בטעינה הבאה הקוד לא נטען בכלל.
import { analyticsCookieNames } from "./consent";

type Gtag = (...args: unknown[]) => void;
type GaWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag };

export const GTAG_SRC = "https://www.googletagmanager.com/gtag/js";

let loaded: string | null = null;

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
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = `${GTAG_SRC}?id=${encodeURIComponent(measurementId)}`;
  script.dataset["hospConsent"] = "analytics";
  document.head.appendChild(script);
  loaded = measurementId;
}

/** ביטול מדידה: Consent Mode ל-denied, ומחיקת ה-Cookies של המדידה מהכתובת הזו */
export function denyAnalytics(): void {
  if (typeof window === "undefined") return;
  const w = window as GaWindow;
  if (w.gtag) w.gtag("consent", "update", { analytics_storage: "denied" });
  const host = window.location.hostname;
  for (const name of analyticsCookieNames(document.cookie)) {
    document.cookie = `${name}=; Path=/; Max-Age=0`;
    document.cookie = `${name}=; Path=/; Domain=${host}; Max-Age=0`;
  }
}

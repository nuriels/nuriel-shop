// Google Tag Manager בדפדפן (מיגרציה 192). נקרא רק אחרי הסכמה לעוגיות, מהמנגנון של כל מנוע:
//   • לפני הטעינה: Consent Mode — ברירת מחדל "חסום" לארבעת האותות, ואז עדכון לפי מה שהגולש אישר
//     (חנות: מדידה ופרסום — ההסכמה שם אחת לשניהם; צימר: מדידה בלבד, הפרסום נשאר חסום).
//   • Container אחד לכל דף, פעם אחת: קריאה חוזרת לא טוענת שוב, מזהה אחר לא נטען בכלל, וסקריפט שכבר בדף
//     לא מוכפל.
//   • צפייה בעמוד: האתר דוחף nuriel_page_view אחד לכל עמוד (גם במעבר בלי טעינה מחדש), עם כתובת נקייה.
//     אותו עמוד פעמיים ברצף (רינדור חוזר, שינוי של פרמטר שאינו utm) — לא נשלח שוב. בתוך ה-Container
//     מגדירים טריגר על האירוע הזה, ולא "History Change", כדי שלא יהיו שתי ספירות.
//   • ביטול: עדכון Consent Mode ל"חסום"; הקוד יורד בטעינה הבאה של הדף (המנגנון של המנוע טוען מחדש).
import { cleanPageLocation, gtmScriptSrc, GTM_PAGE_VIEW_EVENT, isGtmId } from "./gtm";

type GtmWindow = Window & { dataLayer?: unknown[] };

export type GtmConsent = { analytics: boolean; ads: boolean };

let loadedId: string | null = null;
let lastPageKey: string | null = null;

function dataLayerOf(w: GtmWindow): unknown[] {
  w.dataLayer = w.dataLayer ?? [];
  return w.dataLayer;
}

/** בדיוק כמו gtag הרשמי: dataLayer.push(arguments) — כך GTM קורא את פקודות ההסכמה */
function gtagCommand(w: GtmWindow, ...args: unknown[]): void {
  const push = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    dataLayerOf(w).push(arguments);
  } as (...a: unknown[]) => void;
  push(...args);
}

function consentState(c: GtmConsent) {
  const ads = c.ads ? "granted" : "denied";
  return {
    analytics_storage: c.analytics ? "granted" : "denied",
    ad_storage: ads,
    ad_user_data: ads,
    ad_personalization: ads,
  };
}

/**
 * טעינה אחרי הסכמה. מחזיר true כשה-Container פעיל בדף (נטען עכשיו או קודם). מזהה לא תקין, או מזהה שונה
 * ממה שכבר נטען — false, ושום דבר לא נטען.
 */
export function startGtm(id: string, consent: GtmConsent): boolean {
  if (typeof window === "undefined" || !isGtmId(id)) return false;
  const w = window as GtmWindow;
  if (loadedId === id) {
    gtagCommand(w, "consent", "update", consentState(consent));
    return true;
  }
  if (loadedId !== null) return false;
  const src = gtmScriptSrc(id);
  if (!src) return false;
  gtagCommand(w, "consent", "default", {
    ...consentState({ analytics: false, ads: false }),
    wait_for_update: 500,
  });
  gtagCommand(w, "consent", "update", consentState(consent));
  dataLayerOf(w).push({ "gtm.start": Date.now(), event: "gtm.js" });
  if (!document.querySelector(`script[src="${src}"]`)) {
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    script.dataset["gtm"] = id;
    document.head.appendChild(script);
  }
  loadedId = id;
  lastPageKey = null;
  return true;
}

/** צפייה בעמוד — רק כשה-Container נטען, ולא פעמיים ברצף לאותה כתובת נקייה */
export function gtmPageView(href: string, title: string): boolean {
  if (typeof window === "undefined" || loadedId === null) return false;
  const page = cleanPageLocation(href);
  if (!page || page === lastPageKey) return false;
  lastPageKey = page;
  dataLayerOf(window as GtmWindow).push({
    event: GTM_PAGE_VIEW_EVENT,
    page_location: page,
    page_title: title.slice(0, 120),
  });
  return true;
}

/** ביטול הסכמה: כל האותות לחסום (הקוד עצמו יורד בטעינה הבאה) */
export function revokeGtm(): void {
  if (typeof window === "undefined" || loadedId === null) return;
  gtagCommand(
    window as GtmWindow,
    "consent",
    "update",
    consentState({ analytics: false, ads: false }),
  );
}

export function gtmLoadedId(): string | null {
  return loadedId;
}

/** לבדיקות בלבד */
export function resetGtmForTests(): void {
  loadedId = null;
  lastPageKey = null;
}

// Google SEO שלב 4: הסכמה ל-Cookies באתר האירוח — החלק הטהור (נבדק ביחידה, בלי דפדפן).
//   • הבחירה נשמרת בדפדפן ב-Cookie הכרחי אחד (hosp_consent) — רק על הכתובת של האתר (בלי Domain), כך
//     שאתר אחר בפלטפורמה לא רואה אותו. תוכן: גרסת המדיניות, מזהה אקראי, מדידה כן/לא, ומתי.
//   • הבאנר מוצג רק כשיש באתר משהו שדורש הסכמה (מדידה זמינה — המתג + מזהה GA4), ורק כשאין בחירה תקפה:
//     גרסה אחרת של המדיניות, או בחירה בת יותר מ-6 חודשים — שואלים שוב.
//   • בשרת נרשם רק המזהה האקראי, מה נבחר, הגרסה ומתי (בלי IP ובלי דפדפן).
export const CONSENT_COOKIE = "hosp_consent";
/** גרסת המדיניות — שינוי כאן מבקש מכל הגולשים לבחור מחדש */
export const CONSENT_POLICY_VERSION = "2026-11-10";
/** תוקף הבחירה */
export const CONSENT_MAX_AGE_DAYS = 180;

export type ConsentAction = "accept" | "reject" | "save" | "withdraw";
export const CONSENT_ACTIONS: readonly ConsentAction[] = ["accept", "reject", "save", "withdraw"];

export interface ConsentState {
  /** גרסת המדיניות שעליה הגולש בחר */
  v: string;
  /** מזהה אקראי (UUID) — לא קשור לשום פרט של הגולש */
  id: string;
  /** אישר מדידה */
  analytics: boolean;
  /** מתי בחר (שניות מאז 1970) */
  at: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400;

/** הערך של ה-Cookie: "גרסה:מזהה:0/1:שניות" — רק תווים שמותרים בערך של Cookie */
export function serializeConsent(s: ConsentState): string {
  return `${s.v}:${s.id.toLowerCase()}:${s.analytics ? 1 : 0}:${Math.floor(s.at)}`;
}

/**
 * הבחירה מתוך מחרוזת ה-Cookies של הדפדפן (document.cookie). לא קיימת / פגומה / גרסה אחרת / פגה —
 * null (= לא נבחר).
 */
export function readConsent(cookieHeader: string, nowSeconds: number): ConsentState | null {
  const raw = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1);
  if (!raw) return null;
  const parts = decodeURIComponent(raw).split(":");
  if (parts.length !== 4) return null;
  const [v, id, a, at] = parts as [string, string, string, string];
  const when = Number(at);
  if (!VERSION_RE.test(v) || !UUID_RE.test(id) || (a !== "0" && a !== "1")) return null;
  if (!Number.isInteger(when) || when <= 0 || when > nowSeconds + DAY) return null;
  if (v !== CONSENT_POLICY_VERSION) return null;
  if (nowSeconds - when > CONSENT_MAX_AGE_DAYS * DAY) return null;
  return { v, id: id.toLowerCase(), analytics: a === "1", at: when };
}

/** שורת ה-Cookie לשמירה: רק לכתובת הזו (בלי Domain), לכל האתר, Lax; Secure ב-https */
export function consentCookie(s: ConsentState, secure: boolean): string {
  return [
    `${CONSENT_COOKIE}=${encodeURIComponent(serializeConsent(s))}`,
    "Path=/",
    `Max-Age=${CONSENT_MAX_AGE_DAYS * DAY}`,
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** בחירה חדשה — אותו מזהה כמו הבחירה הקודמת של הדפדפן (אם יש), כדי שהרשומות יתחברו לאותו גולש אנונימי */
export function nextConsent(
  previous: ConsentState | null,
  analytics: boolean,
  nowSeconds: number,
  newId: () => string,
): ConsentState {
  return {
    v: CONSENT_POLICY_VERSION,
    id: previous?.id ?? newId().toLowerCase(),
    analytics,
    at: Math.floor(nowSeconds),
  };
}

/** איך הבחירה נרשמת: מהבאנר — אישור / סירוב; מההגדרות — שמירה, או ביטול כשמדידה שאושרה כובתה */
export function consentAction(
  previous: ConsentState | null,
  analytics: boolean,
  via: "banner" | "panel",
): ConsentAction {
  if (via === "banner") return analytics ? "accept" : "reject";
  return previous?.analytics && !analytics ? "withdraw" : "save";
}

/** האם להציג את הבאנר: רק כשיש באתר מה לאשר, ואין בחירה תקפה */
export function needsDecision(state: ConsentState | null, analyticsAvailable: boolean): boolean {
  return analyticsAvailable && state === null;
}

/** האם לטעון את המדידה: רק כשהיא זמינה באתר וגם הגולש אישר */
export function analyticsGranted(state: ConsentState | null, analyticsAvailable: boolean): boolean {
  return analyticsAvailable && state?.analytics === true;
}

/** ה-Cookies של Google Analytics (לביטול) — _ga, _ga_<מזהה>, _gid, _gat */
export function analyticsCookieNames(cookieHeader: string): string[] {
  return cookieHeader
    .split(";")
    .map((c) => c.trim().split("=")[0] ?? "")
    .filter((n) => /^(_ga(_[A-Za-z0-9]+)?|_gid|_gat(_[A-Za-z0-9]+)?)$/.test(n));
}

export interface ConsentInput {
  consentId: string;
  analytics: boolean;
  action: ConsentAction;
  policyVersion: string;
}

/** הקלט של רישום הבחירה (מהדפדפן) — הכול נבדק; בחירה לא עקבית נדחית כמו במסד */
export function parseConsentInput(input: unknown): ConsentInput {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const consentId = typeof r["consentId"] === "string" ? r["consentId"].toLowerCase() : "";
  const analytics = r["analytics"];
  const action = r["action"];
  const policyVersion = r["policyVersion"];
  if (
    !UUID_RE.test(consentId) ||
    typeof analytics !== "boolean" ||
    typeof action !== "string" ||
    !(CONSENT_ACTIONS as readonly string[]).includes(action) ||
    typeof policyVersion !== "string" ||
    !VERSION_RE.test(policyVersion) ||
    (action === "accept" && !analytics) ||
    ((action === "reject" || action === "withdraw") && analytics)
  )
    throw new Error("הבחירה לא תקינה");
  return { consentId, analytics, action: action as ConsentAction, policyVersion };
}

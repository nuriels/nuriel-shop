// מגבלות הקצב של Hospitality — במקום אחד, משותפות לכל שרתי האפליקציה (מונה במסד, מיגרציה 25).
// כל פעולה: כמה כללים, כל כלל לפי "נושא" אחר — כתובת (ip), רשת (/24 או /64 — net), העסק כולו
// (tenant), טוקן (יומן הייצוא), או משתמש מחובר (user). פעולה נחסמת כשאחד הכללים חורג.
//
// ההיגיון של המספרים:
//   • קריאה (האתר, זמינות, הצעת מחיר) — נדיב, נגד הצפה בלבד: גולש אמיתי לא מתקרב;
//   • בקשת הזמנה — מחמיר: כל בקשה תופסת תאריכים ושולחת מיילים. מעל המגבלות של המסד (עד 2
//     בקשות פתוחות לאותם פרטי קשר) ושל אימות ה-CAPTCHA;
//   • העסק כולו — תקרה לבקשות חדשות בשעה / ביום: גם הצפה מהרבה כתובות לא תחסום לעסק את היומן.
// טהור — נבדק ביחידה.

export type LimitSubject = "ip" | "net" | "tenant" | "token" | "user";

export interface LimitRule {
  per: LimitSubject;
  limit: number;
  /** אורך החלון בשניות (עד יממה) */
  window: number;
}

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

export const LIMITS = {
  // ---- האתר הציבורי (גולשים) ----
  /** נתוני האתר בכל טעינת עמוד */
  site: [{ per: "ip", limit: 900, window: 10 * MIN }],
  /** לוח הזמינות */
  availability: [{ per: "ip", limit: 300, window: 10 * MIN }],
  /** הצעת מחיר */
  quote: [
    { per: "ip", limit: 120, window: 10 * MIN },
    { per: "tenant", limit: 3000, window: 10 * MIN },
  ],
  /** אתגר האימות (CAPTCHA) לפני שליחת בקשה */
  challenge: [{ per: "ip", limit: 60, window: 10 * MIN }],
  /** בקשת הזמנה */
  request: [
    { per: "ip", limit: 3, window: 10 * MIN },
    { per: "ip", limit: 6, window: HOUR },
    { per: "net", limit: 20, window: HOUR },
    { per: "tenant", limit: 40, window: HOUR },
    { per: "tenant", limit: 200, window: DAY },
  ],
  /** ההזמנה לפי הקישור המאובטח */
  booking: [{ per: "ip", limit: 60, window: 10 * MIN }],
  /** הצעת ביטול */
  cancelQuote: [{ per: "ip", limit: 30, window: 10 * MIN }],
  /** בקשת ביטול */
  cancel: [{ per: "ip", limit: 6, window: HOUR }],
  /** יומן הייצוא (iCal) — Airbnb / Booking.com מושכים כל כמה דקות עד שעה */
  ical: [{ per: "token", limit: 120, window: HOUR }],

  // ---- אזור הניהול (צוות מחובר) — רק פעולות יקרות / רגישות ----
  /** ייבוא תמונה מקישור (הורדה מהרשת) */
  mediaImport: [{ per: "user", limit: 30, window: 10 * MIN }],
  /** העלאת תמונה */
  mediaUpload: [{ per: "user", limit: 120, window: 10 * MIN }],
  /** "סנכרון עכשיו" של יומן חיצוני (הורדה מהרשת) */
  channelSync: [{ per: "user", limit: 30, window: 10 * MIN }],
  /** פתיחת חשבון למנהל משנה (מייל הזמנה) */
  teamAccount: [{ per: "tenant", limit: 20, window: HOUR }],
  /** ייצוא כרטיס אורח (מידע אישי) */
  guestExport: [{ per: "user", limit: 60, window: HOUR }],
  /** פתיחת חשבון בעלים מפאנל הפלטפורמה */
  platformAccount: [{ per: "user", limit: 30, window: HOUR }],
  /**
   * תמיכה (E4): פנייה / תגובה / קבצים — לעסק ולצוות הפלטפורמה (מעל המגבלות של המסד). נבדק רק אחרי
   * שהמסד אישר שהמשתמש מהצוות של העסק — אחרת חשבון זר היה "שורף" לעסק את המכסה היומית.
   */
  supportWrite: [
    { per: "user", limit: 30, window: 10 * MIN },
    { per: "tenant", limit: 200, window: DAY },
  ],
  /** תמיכה: סגירה / פתיחה מחדש של פנייה (כל אחת נרשמת ביומן ומחזירה את הפנייה לתור) */
  supportStatus: [{ per: "user", limit: 30, window: HOUR }],
  /** תמיכה: קישור הורדה חתום לקובץ (כל קישור — בקשת חתימה במפתח השירות) */
  supportFile: [{ per: "user", limit: 120, window: 10 * MIN }],
  /** מדריך ההקמה: מעבר בין צעדים, "בדקתי" ודילוג (אישור ודילוג נרשמים ביומן) */
  setupWrite: [{ per: "user", limit: 120, window: 10 * MIN }],
} as const satisfies Record<string, readonly LimitRule[]>;

export type LimitAction = keyof typeof LIMITS;

/** ההודעה לגולש כשהמגבלה חורגת (בלי פרטים שיעזרו לעקוף) */
export function tooManyMessage(retryAfter: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  return minutes >= 60
    ? "יותר מדי בקשות — נסו שוב מאוחר יותר"
    : `יותר מדי בקשות — נסו שוב בעוד ${minutes === 1 ? "דקה" : `${minutes} דקות`}`;
}

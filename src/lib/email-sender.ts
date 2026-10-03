/**
 * כתובת השולח של חנות — כללים משותפים לדפדפן ולשרת (כמו ה-CHECK במסד).
 *
 * מפתח ה-Resend מאומת על דומיין המערכת בלבד (nuri1.fit), ולכן החנות בוחרת
 * רק את החלק שלפני ה-@; הדומיין קבוע ומצורף בשרת.
 */

/** ברירת המחדל → orders@nuri1.fit */
export const DEFAULT_SENDER_LOCAL_PART = "orders";

/** אותיות באנגלית קטנות, ספרות, נקודה, מקף וקו תחתון; מתחיל ומסתיים באות/ספרה */
export const SENDER_LOCAL_PART_FORMAT = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

/** כתובות של המערכת עצמה — חנות לא יכולה לשלוח בשמן */
export const RESERVED_SENDER_LOCAL_PARTS: readonly string[] = [
  "postmaster",
  "abuse",
  "hostmaster",
  "webmaster",
  "root",
  "admin",
  "administrator",
  "security",
  "platform",
  "noc",
  "mailer-daemon",
];

/** בעיה בחלק שלפני ה-@ (null = תקין) */
export function senderLocalPartProblem(value: string): string | null {
  if (value === "") return "נא להזין את החלק שלפני ה-@ (למשל orders)";
  if (value.length > 64) return "עד 64 תווים לפני ה-@";
  if (!SENDER_LOCAL_PART_FORMAT.test(value)) {
    return "רק אותיות באנגלית, ספרות, נקודה, מקף וקו תחתון — בלי רווחים, ולא בהתחלה או בסוף";
  }
  if (value.includes("..")) return "אי אפשר שתי נקודות ברצף";
  if (RESERVED_SENDER_LOCAL_PARTS.includes(value)) return `"${value}" שמורה למערכת — בחרו שם אחר`;
  return null;
}

/**
 * ניקוי הקלדה: אותיות קטנות, בלי רווחים. הדבקה של כתובת מלאה על הדומיין
 * של המערכת ("shop@nuri1.fit") — נשאר רק החלק שלפני ה-@; כתובת על דומיין
 * אחר מחזירה שגיאה (מפתח ה-Resend לא מאפשר לשלוח ממנה).
 */
export function parseSenderInput(
  input: string,
  domain: string,
): { local: string; problem: string | null } {
  const value = input.trim().toLowerCase().replace(/\s+/g, "");
  const at = value.indexOf("@");
  if (at === -1) return { local: value, problem: null };
  const local = value.slice(0, at);
  const typedDomain = value.slice(at + 1);
  if (typedDomain !== "" && typedDomain !== domain.toLowerCase()) {
    return {
      local,
      // \u2066…\u2069 — "@nuri1.fit" נשאר משמאל לימין בתוך המשפט העברי
      problem: `אפשר לשלוח רק מכתובת \u2066@${domain}\u2069 — רק הדומיין הזה מאומת לשליחה`,
    };
  }
  return { local, problem: null };
}

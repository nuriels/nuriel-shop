// שלב א' 3: הקלט של איפוס הסיסמה בקוד למייל (אזור הניהול). הקוד עצמו נבדק בפונקציה הקיימת של הכניסה
// בקוד; ההרשאה — במסד. כאן רק המבנה, והסיסמה: 8 עד 72 תווים (bcrypt), לא רק רווחים.
import { InputError } from "./input";

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

export function passwordProblem(password: string): string | null {
  if (password.trim().length === 0) return "בחרו סיסמה";
  if (password.length < PASSWORD_MIN) return `הסיסמה צריכה לפחות ${PASSWORD_MIN} תווים`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX)
    return `הסיסמה ארוכה מדי (עד ${PASSWORD_MAX} תווים)`;
  return null;
}

export function parseManagerPasswordReset(input: Record<string, unknown> | null | undefined) {
  const i = input ?? {};
  const email = String(i["email"] ?? "")
    .trim()
    .toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) throw new InputError("כתובת אימייל לא תקינה");
  const code = String(i["code"] ?? "").replace(/\D/g, "");
  if (code.length !== 6) throw new InputError("הקוד מכיל 6 ספרות");
  const password = typeof i["password"] === "string" ? i["password"] : "";
  const problem = passwordProblem(password);
  if (problem) throw new InputError(problem);
  return { email, code, password };
}

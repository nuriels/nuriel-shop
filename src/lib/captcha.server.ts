/**
 * אימות אנושי פשוט (שאלת חשבון) לטופס "ביטול עסקה" — צד שרת בלבד.
 *
 * השרת מגריל תרגיל ("7 + 5") ומחזיר אסימון חתום ב-HMAC. התשובה עצמה לא
 * נמצאת באסימון: החתימה מחושבת על האסימון + התשובה הנכונה, וכשהלקוח שולח
 * תשובה — מחשבים שוב עם מה שהוא כתב ומשווים. בלי מצב בשרת (חוץ מרשימה קצרה
 * של אסימונים שכבר נוצלו, נגד שליחה חוזרת של אותו פתרון).
 *
 * מבנה: base64url(JSON {v, n, t, x}) + "." + base64url(HMAC-SHA256)
 *   n = מזהה אקראי · t = מזהה החנות · x = פקיעה (שניות epoch)
 */

import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Captcha } from "@/lib/site-forms";

/** 20 דקות — מספיק כדי למלא את הטופס בנחת */
export const CAPTCHA_TTL_SECONDS = 20 * 60;

export const CAPTCHA_WRONG = "התשובה לשאלת האימות שגויה — נסו שוב עם התרגיל החדש";
export const CAPTCHA_EXPIRED = "שאלת האימות פגה — נסו שוב עם התרגיל החדש";

type Payload = { v: 1; n: string; t: string; x: number };

function defaultSecret(): string {
  const value =
    process.env["LOGIN_CODE_SECRET"]?.trim() || process.env["SUPABASE_SERVICE_ROLE_KEY"] || "";
  if (!value) throw new Error("תקלת הגדרות בשרת");
  return value;
}

function sign(secret: string, body: string, answer: number): string {
  return createHmac("sha256", secret).update(`captcha:v1:${body}:${answer}`).digest("base64url");
}

/** תרגיל חיבור או חיסור קטן, בלי תוצאה שלילית */
export function randomExercise(rand: (min: number, max: number) => number = randomInt): {
  question: string;
  answer: number;
} {
  if (rand(0, 2) === 0) {
    const a = rand(2, 10);
    const b = rand(1, 10);
    return { question: `${a} + ${b}`, answer: a + b };
  }
  const a = rand(6, 20);
  const b = rand(1, a - 1);
  return { question: `${a} − ${b}`, answer: a - b };
}

export function issueCaptcha(
  tenantId: string,
  options: {
    now?: number;
    secret?: string;
    exercise?: { question: string; answer: number };
  } = {},
): Captcha {
  const now = options.now ?? Date.now();
  const { question, answer } = options.exercise ?? randomExercise();
  const payload: Payload = {
    v: 1,
    n: randomBytes(9).toString("base64url"),
    t: tenantId,
    x: Math.floor(now / 1000) + CAPTCHA_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { question, token: `${body}.${sign(options.secret ?? defaultSecret(), body, answer)}` };
}

/** אסימונים שכבר נוצלו (עד שהם פגים ממילא) */
const used = new Map<string, number>();

function sweep(nowSeconds: number): void {
  if (used.size < 2000) return;
  for (const [nonce, expires] of used) if (expires <= nowSeconds) used.delete(nonce);
}

export type CaptchaCheck = "ok" | "wrong" | "expired" | "invalid";

export function verifyCaptcha(
  token: string,
  answer: string,
  tenantId: string,
  options: { now?: number; secret?: string } = {},
): CaptchaCheck {
  const [body, signature, extra] = String(token ?? "").split(".");
  if (!body || !signature || extra !== undefined) return "invalid";
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
  } catch {
    return "invalid";
  }
  if (
    payload?.v !== 1 ||
    typeof payload.n !== "string" ||
    typeof payload.t !== "string" ||
    typeof payload.x !== "number"
  ) {
    return "invalid";
  }
  if (payload.t !== tenantId) return "invalid";
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  if (payload.x <= nowSeconds) return "expired";
  // פקיעה רחוקה מדי = לא אנחנו הנפקנו (וגם לא נשמור אותו ברשימה לנצח)
  if (payload.x > nowSeconds + CAPTCHA_TTL_SECONDS + 60) return "invalid";
  if (used.has(payload.n)) return "expired";

  // ניסיון אחד לכל תרגיל — גם תשובה שגויה "שורפת" אותו (בלי ניחוש בלולאה)
  sweep(nowSeconds);
  used.set(payload.n, payload.x);

  // ספרות בלבד (גם ספרות "רחבות" / מקלדת אחרת), עד 3
  const digits = String(answer ?? "")
    .normalize("NFKC")
    .replace(/[^\d-]/g, "");
  if (!/^-?\d{1,3}$/.test(digits)) return "wrong";
  const expected = Buffer.from(sign(options.secret ?? defaultSecret(), body, Number(digits)));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "wrong";
  return "ok";
}

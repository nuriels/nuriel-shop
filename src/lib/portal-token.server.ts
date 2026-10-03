/**
 * אסימון השער (צד שרת בלבד): אחרי שהמייל אומת בקוד, השער לא פותח חיבור
 * של Supabase באתר nuriel-app2 (המשתמש לא לקוח של החנות הזו) — הוא מקבל
 * אסימון קצר-מועד, חתום ב-HMAC עם סוד השרת, שמוכיח "המייל הזה אומת".
 * כל פעולה בשער (החנויות שלי, בדיקת כתובת, הקמת חנות, כניסה לחנות)
 * מקבלת אותו ובודקת חתימה, תוקף ושהוא נוצר בשער הזה.
 *
 * מבנה: base64url(JSON {v, e, t, x}) + "." + base64url(HMAC-SHA256)
 *   e = המייל המאומת · t = מזהה החנות של השער · x = פקיעה (שניות epoch)
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** שעה — מספיק לבחור שם וכתובת בנחת; אחר כך שוב קוד למייל */
export const PORTAL_TOKEN_TTL_SECONDS = 60 * 60;

export const PORTAL_SESSION_EXPIRED = "פג תוקף הכניסה לשער. הזינו שוב את האימייל וקבלו קוד חדש.";

type Payload = { v: 1; e: string; t: string; x: number };

function secret(): string {
  const value =
    process.env["LOGIN_CODE_SECRET"]?.trim() || process.env["SUPABASE_SERVICE_ROLE_KEY"] || "";
  if (!value) throw new Error("תקלת הגדרות בשרת");
  return value;
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(`portal-token:v1:${body}`).digest("base64url");
}

export function signPortalToken(email: string, tenantId: string, now: number = Date.now()): string {
  const payload: Payload = {
    v: 1,
    e: email,
    t: tenantId,
    x: Math.floor(now / 1000) + PORTAL_TOKEN_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

/** המייל המאומת שבאסימון — או זריקה (חתימה שגויה / פג תוקף / שער אחר) */
export function readPortalToken(
  token: unknown,
  tenantId: string,
  now: number = Date.now(),
): string {
  const value = typeof token === "string" ? token.trim() : "";
  const [body, signature, extra] = value.split(".");
  if (!body || !signature || extra !== undefined || value.length > 2048) {
    throw new Error(PORTAL_SESSION_EXPIRED);
  }
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new Error(PORTAL_SESSION_EXPIRED);
  }
  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<Payload>;
  } catch {
    throw new Error(PORTAL_SESSION_EXPIRED);
  }
  if (
    payload.v !== 1 ||
    typeof payload.e !== "string" ||
    payload.t !== tenantId ||
    typeof payload.x !== "number" ||
    payload.x * 1000 <= now
  ) {
    throw new Error(PORTAL_SESSION_EXPIRED);
  }
  return payload.e;
}

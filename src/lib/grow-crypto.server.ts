/**
 * חלק 43: הצפנת פרטי המסוף של Grow (userId / pageCode / apiKey) לפני שהם נשמרים במסד.
 *
 * AES-256-GCM. המפתח נגזר ממשתנה הסביבה GROW_SECRETS_KEY (רק בשרת; לא במסד,
 * לא בקוד ולא ב-git). בלי המפתח — הפרטים השמורים לא ניתנים לפענוח, והקריאה
 * נכשלת בקול במקום להשתמש בערך שגוי.
 * פורמט: "v1:" + base64(iv[12] + tag[16] + ciphertext).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1:";

function secretKey(): Buffer {
  const raw = process.env["GROW_SECRETS_KEY"]?.trim();
  if (!raw || raw.length < 24) {
    throw new Error("מפתח ההצפנה של הסליקה (GROW_SECRETS_KEY) לא הוגדר בשרת");
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) throw new Error("פורמט ההצפנה לא מוכר");
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  if (raw.length < 29) throw new Error("הנתון המוצפן פגום");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  try {
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    // מפתח שונה / נתון שהשתנה — לא מחזירים שום פרט על התוכן
    throw new Error("פענוח פרטי הסליקה נכשל — ייתכן שמפתח ההצפנה השתנה");
  }
}

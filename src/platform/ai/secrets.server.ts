/**
 * NURIEL AI ASSISTANT — הצפנת מפתח ה-API לפני שמירתו במסד (צד שרת בלבד).
 *
 * AES-256-GCM (תג אימות מלא של 16 בתים בלבד). מפתח ההצפנה נגזר (HKDF-SHA256, עם salt ו-info
 * ייעודיים) מסוד של השרת: AI_ASSISTANT_SECRET אם הוגדר — 32 תווים לפחות, אחרת זו שגיאת הגדרה (לא נופלים
 * בשקט לסוד אחר) — ובלעדיו SUPABASE_SERVICE_ROLE_KEY, שנמצא רק בקובץ הסביבה של השרת. כך גיבוי של
 * המסד, או גישת קריאה למסד לבדה, לא חושפים את המפתח.
 * אם סוד השרת מוחלף — המפתח השמור לא ניתן לפענוח (decrypt מחזיר null), ומנהל העל מדביק אותו מחדש.
 * הפורמט (v1.<iv>.<tag>.<ciphertext>, base64url) תואם לבדיקה במסד (ai_settings.api_key_encrypted),
 * שדוחה כל ערך אחר — גם מפתח גלוי.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const AAD = Buffer.from("nuriel-ai:api-key:v1");
const SALT = "nuriel-ai-assistant";
const INFO = "anthropic-api-key-v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MIN_SECRET_LENGTH = 32;

/** סוד השרת להצפנה לא מוגדר כראוי — הודעה למנהל העל (בלי ערכים) */
export class AiSecretConfigError extends Error {}

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, SALT, INFO, 32));
}

export function encryptWithSecret(secret: string, plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

/** null = לא ניתן לפענח (פורמט שגוי, שונה בידי מישהו, או הוצפן עם סוד שרת אחר) */
export function decryptWithSecret(secret: string, blob: string): string | null {
  try {
    const [version, iv, tag, encrypted, extra] = blob.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted || extra !== undefined) return null;
    const ivBytes = Buffer.from(iv, "base64url");
    const tagBytes = Buffer.from(tag, "base64url");
    // רק תג אימות מלא — תג מקוצר מחליש את ההגנה מפני ערך ששונה במסד
    if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), ivBytes, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(AAD);
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export function serverSecret(env: Record<string, string | undefined> = process.env): string {
  const dedicated = env["AI_ASSISTANT_SECRET"]?.trim();
  if (dedicated) {
    if (dedicated.length < MIN_SECRET_LENGTH)
      throw new AiSecretConfigError("AI_ASSISTANT_SECRET is shorter than 32 characters");
    return dedicated;
  }
  const fallback = env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!fallback) throw new AiSecretConfigError("missing server secret for the AI key");
  return fallback;
}

export function encryptApiKey(plain: string): string {
  return encryptWithSecret(serverSecret(), plain);
}

export function decryptApiKey(blob: string): string | null {
  try {
    return decryptWithSecret(serverSecret(), blob);
  } catch {
    return null;
  }
}

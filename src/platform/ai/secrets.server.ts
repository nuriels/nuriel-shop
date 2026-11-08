/**
 * NURIEL AI ASSISTANT — הצפנת מפתח ה-API לפני שמירתו במסד (צד שרת בלבד).
 *
 * AES-256-GCM. מפתח ההצפנה נגזר (HKDF-SHA256, עם salt ו-info ייעודיים) מסוד של השרת:
 * AI_ASSISTANT_SECRET אם הוגדר (32 תווים לפחות), אחרת SUPABASE_SERVICE_ROLE_KEY — שנמצא רק בקובץ
 * הסביבה של השרת. כך גיבוי של המסד, או גישת קריאה למסד לבדה, לא חושפים את המפתח.
 * אם סוד השרת מוחלף — המפתח השמור לא ניתן לפענוח (decrypt מחזיר null), ומנהל העל מדביק אותו מחדש.
 * הפורמט (v1.<iv>.<tag>.<ciphertext>, base64url) תואם לבדיקה במסד (ai_settings.api_key_encrypted),
 * שדוחה כל ערך אחר — גם מפתח גלוי.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const AAD = Buffer.from("nuriel-ai:api-key:v1");
const SALT = "nuriel-ai-assistant";
const INFO = "anthropic-api-key-v1";

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, SALT, INFO, 32));
}

export function encryptWithSecret(secret: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
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
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(secret),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

function serverSecret(env: Record<string, string | undefined> = process.env): string {
  const dedicated = env["AI_ASSISTANT_SECRET"]?.trim();
  if (dedicated && dedicated.length >= 32) return dedicated;
  const fallback = env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!fallback) throw new Error("missing server secret for the AI key");
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

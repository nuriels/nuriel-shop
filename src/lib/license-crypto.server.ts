// ============================================================
// מודול הרישיונות — הצפנה ו-Tokens (שרת בלבד).
//
// • מפתחות הרישיון מוצפנים ב-AES-256-GCM לפני שהם מגיעים למסד. מפתח ההצפנה נגזר (HKDF-SHA256)
//   מהסוד LICENSE_KEYS_SECRET בסביבת השרת — לא במסד ולא ב-git. בלי הסוד המודול לא שומר מפתחות.
// • AAD = החנות + מזהה השליחה: צופן שהועתק לשורה / לחנות אחרת לא יפוענח.
// • טביעה (HMAC, מפתח נגזר נפרד) — לזיהוי "המפתח הזה כבר נשלח" בלי לפענח שום דבר.
// • Token להורדה: 32 בתים אקראיים; במסד נשמר רק ה-SHA-256 שלו.
// אף פונקציה כאן לא כותבת ללוג.
// ============================================================
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const SECRET_ENV = "LICENSE_KEYS_SECRET";
const VERSION = "v1";

function masterSecret(): Buffer | null {
  const raw = process.env[SECRET_ENV]?.trim();
  // לפחות 32 תווים (setup-selfhost מייצר 64 תווי hex = 256 ביט)
  if (!raw || raw.length < 32) return null;
  return Buffer.from(raw, "utf8");
}

/** האם השרת מוגדר להצפנת מפתחות (בלי זה — אין שליחת רישיונות) */
export function licenseCryptoConfigured(): boolean {
  return masterSecret() !== null;
}

function derive(purpose: string): Buffer {
  const secret = masterSecret();
  if (!secret) throw new Error("השרת לא הוגדר להצפנת מפתחות רישיון (LICENSE_KEYS_SECRET חסר)");
  return Buffer.from(
    hkdfSync("sha256", secret, Buffer.from("nuriel-license-keys"), Buffer.from(purpose), 32),
  );
}

export function licenseAad(tenantId: string, deliveryId: string): string {
  return `license:${tenantId}:${deliveryId}`;
}

export function encryptLicenseKey(plain: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive(`aes-256-gcm:${VERSION}`), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

export function decryptLicenseKey(payload: string, aad: string): string {
  if (!payload.startsWith(`${VERSION}:`)) throw new Error("פורמט הצפנה לא נתמך");
  const raw = Buffer.from(payload.slice(VERSION.length + 1), "base64");
  if (raw.length < 12 + 16 + 1) throw new Error("נתוני ההצפנה פגומים");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    derive(`aes-256-gcm:${VERSION}`),
    raw.subarray(0, 12),
  );
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** טביעה של המפתח בחנות — אותו מפתח = אותה טביעה; לא ניתן לשחזר ממנה את המפתח */
export function licenseKeyFingerprint(tenantId: string, normalizedKey: string): string {
  return createHmac("sha256", derive(`fingerprint:${VERSION}`))
    .update(`${tenantId}:${normalizedKey}`, "utf8")
    .digest("hex");
}

export function hashDownloadToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newDownloadToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashDownloadToken(token) };
}

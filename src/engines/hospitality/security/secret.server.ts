// הסוד של מנגנוני האבטחה של Hospitality (HMAC: מפתחות הגבלת הקצב, חתימת אתגרי האימות).
// HOSPITALITY_SECRET — מומלץ (32 בתים אקראיים לפחות, למשל: openssl rand -hex 32). בלעדיו — נגזר
// מ-LOGIN_CODE_SECRET או ממפתח השירות. בכל מקרה לכל שימוש מפתח נפרד (תווית — domain separation),
// כך שהסוד עצמו לא משמש ישירות לשום דבר. Web Crypto בלבד (Node 22 / דפדפן).

const enc = (s: string) => new TextEncoder().encode(s);

function baseSecret(): string {
  const value =
    process.env["HOSPITALITY_SECRET"]?.trim() ||
    process.env["LOGIN_CODE_SECRET"]?.trim() ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim() ||
    "";
  if (!value) throw new Error("תקלת הגדרות בשרת");
  return value;
}

const keys = new Map<string, Promise<CryptoKey>>();

function keyFor(label: string): Promise<CryptoKey> {
  const base = baseSecret();
  const cacheKey = `${label}\u0000${base}`;
  let key = keys.get(cacheKey);
  if (!key) {
    key = (async () => {
      const subtle = globalThis.crypto.subtle;
      const root = await subtle.importKey(
        "raw",
        enc(base),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const derived = await subtle.sign("HMAC", root, enc(`nuriel-hospitality:${label}`));
      return subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    })();
    keys.set(cacheKey, key);
  }
  return key;
}

export function base64url(buf: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** HMAC-SHA256 עם המפתח של התווית — base64url (43 תווים) */
export async function hmac(label: string, data: string): Promise<string> {
  return base64url(await globalThis.crypto.subtle.sign("HMAC", await keyFor(label), enc(data)));
}

/** השוואה בזמן קבוע (חתימות) */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

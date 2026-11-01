// אימות נגד בוטים (CAPTCHA) בלי שירות חיצוני ובלי עוגיות — "הוכחת עבודה" (proof of work, בסגנון
// ALTCHA): השרת שולח אתגר — hash של salt + מספר סודי (0…maxnumber) וחתימה עליו. הדפדפן מחפש את
// המספר (עשרות אלפי חישובי SHA-256 — שבריר שנייה עד שנייה, ברקע, בזמן שהאורח ממלא את הטופס).
// לאדם אין מה לפתור, וקורא מסך לא נתקע על תמונה; לבוט כל בקשה עולה זמן מעבד, ויחד עם הגבלת הקצב
// המשותפת — הצפה לא משתלמת.
//
// הקובץ הזה משותף לדפדפן ולשרת (Web Crypto בלבד): מבנה האתגר, הפתרון ובדיקת ה-hash.
// החתימה, התוקף, העסק והשימוש החד-פעמי נבדקים בשרת (captcha.server.ts).

export interface PowChallenge {
  algorithm: "SHA-256";
  /** hex(SHA-256(salt + number)) */
  challenge: string;
  /** v1.<nonce>.<issued>.<expires>.<purpose>.<site tag> */
  salt: string;
  maxnumber: number;
  /** HMAC של השרת על challenge */
  signature: string;
}

export interface PowSolution {
  algorithm: "SHA-256";
  challenge: string;
  salt: string;
  number: number;
  signature: string;
}

export type PowPurpose = "request";

export interface SaltInfo {
  nonce: string;
  /** שניות epoch */
  issued: number;
  expires: number;
  purpose: string;
  site: string;
}

/** התקרה של maxnumber — גם בקושי המוגבר (כדי שגם מכשיר חלש יסיים בזמן סביר) */
export const POW_MAX_LIMIT = 2_000_000;

const HEX = /^[0-9a-f]{64}$/;
const SIG = /^[A-Za-z0-9_-]{20,100}$/;
const SALT = /^v1\.([0-9a-f]{32})\.(\d{10})\.(\d{10})\.([a-z]{3,20})\.([A-Za-z0-9_-]{8,24})$/;

export function parseSalt(salt: string): SaltInfo | null {
  const m = SALT.exec(salt);
  if (!m) return null;
  return {
    nonce: m[1]!,
    issued: Number(m[2]),
    expires: Number(m[3]),
    purpose: m[4]!,
    site: m[5]!,
  };
}

export function buildSalt(info: SaltInfo): string {
  return `v1.${info.nonce}.${info.issued}.${info.expires}.${info.purpose}.${info.site}`;
}

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** הצורה של אתגר שהגיע מהשרת (בדפדפן — לפני שמתחילים לחשב) */
export function isPowChallenge(v: unknown): v is PowChallenge {
  const c = v as PowChallenge | null;
  return (
    !!c &&
    c.algorithm === "SHA-256" &&
    typeof c.challenge === "string" &&
    HEX.test(c.challenge) &&
    typeof c.salt === "string" &&
    parseSalt(c.salt) !== null &&
    Number.isInteger(c.maxnumber) &&
    c.maxnumber > 0 &&
    c.maxnumber <= POW_MAX_LIMIT &&
    typeof c.signature === "string" &&
    SIG.test(c.signature)
  );
}

/** הפתרון כפי שהגיע מהדפדפן — רק הצורה (החתימה והתוקף נבדקים בשרת); null — לא תקין */
export function parsePowSolution(v: unknown): PowSolution | null {
  const s = v as Record<string, unknown> | null;
  if (!s || typeof s !== "object") return null;
  const number = s["number"];
  if (
    s["algorithm"] !== "SHA-256" ||
    typeof s["challenge"] !== "string" ||
    !HEX.test(s["challenge"]) ||
    typeof s["salt"] !== "string" ||
    !parseSalt(s["salt"]) ||
    typeof s["signature"] !== "string" ||
    !SIG.test(s["signature"]) ||
    typeof number !== "number" ||
    !Number.isInteger(number) ||
    number < 0 ||
    number > POW_MAX_LIMIT
  )
    return null;
  return {
    algorithm: "SHA-256",
    challenge: s["challenge"],
    salt: s["salt"],
    number,
    signature: s["signature"],
  };
}

/** ה-hash של הפתרון תואם לאתגר */
export async function powHashMatches(s: Pick<PowSolution, "salt" | "number" | "challenge">) {
  return (await sha256Hex(`${s.salt}${s.number}`)) === s.challenge;
}

/**
 * פתרון האתגר בדפדפן: מנות של חישובים מקבילים, עם הפסקה בין מנה למנה (הממשק נשאר חלק).
 * null — בוטל (signal) או לא נמצא (אתגר פגום).
 */
export async function solvePow(
  c: PowChallenge,
  opts: { signal?: AbortSignal | undefined; batch?: number | undefined } = {},
): Promise<PowSolution | null> {
  const batch = Math.max(1, opts.batch ?? 500);
  for (let start = 0; start <= c.maxnumber; start += batch) {
    if (opts.signal?.aborted) return null;
    const end = Math.min(c.maxnumber, start + batch - 1);
    const tries: Promise<string>[] = [];
    for (let n = start; n <= end; n++) tries.push(sha256Hex(`${c.salt}${n}`));
    const found = (await Promise.all(tries)).indexOf(c.challenge);
    if (found >= 0) {
      return {
        algorithm: "SHA-256",
        challenge: c.challenge,
        salt: c.salt,
        number: start + found,
        signature: c.signature,
      };
    }
    // לתת לדפדפן לצייר / להגיב בין המנות
    await new Promise((r) => setTimeout(r, 0));
  }
  return null;
}

// האתגר נגד בוטים (pow.ts) — הצד של השרת: הנפקה חתומה, ובדיקה של חתימה, hash, תוקף, העסק,
// המטרה וזמן מינימלי. השימוש החד-פעמי נבדק יחד עם הגבלת הקצב (מונה משותף במסד — guard.server.ts).
// בלי מצב בשרת: כל מה שצריך לבדיקה נמצא באתגר עצמו, חתום ב-HMAC.
import {
  buildSalt,
  parseSalt,
  POW_MAX_LIMIT,
  POW_MIN_SECONDS,
  powHashMatches,
  sha256Hex,
  type PowChallenge,
  type PowPurpose,
  type PowSolution,
} from "./pow";
import { hmac, safeEqual } from "./secret.server";

/** תוקף האתגר — מספיק כדי למלא את הטופס בנחת */
export const POW_TTL_SECONDS = 30 * 60;
/** בקשה שנשלחה פחות מ-2 שניות אחרי שהטופס נטען — לא אדם (משותף לדפדפן, שמחכה לפני השליחה) */
export { POW_MIN_SECONDS };
/** הקושי הבסיסי: עד 50,000 ניסיונות (בממוצע 25,000 — שבריר שנייה במחשב, כשנייה בטלפון ישן) */
export const POW_BASE_MAX = 50_000;

function baseMax(): number {
  const env = Number(process.env["HOSPITALITY_POW_MAX"]);
  return Number.isInteger(env) && env >= 1_000 && env <= POW_MAX_LIMIT ? env : POW_BASE_MAX;
}

const siteTag = async (tenantId: string) => (await hmac("pow-site", tenantId)).slice(0, 16);

function randomHex(bytes: number): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function randomInt(maxInclusive: number): number {
  const [n] = globalThis.crypto.getRandomValues(new Uint32Array(1));
  return n! % (maxInclusive + 1);
}

/** אתגר חדש. difficulty — מכפיל (כתובת ששולחת הרבה בקשות מקבלת אתגר כבד יותר) */
export async function issuePow(
  tenantId: string,
  purpose: PowPurpose,
  opts: { difficulty?: number; now?: number; secretNumber?: number } = {},
): Promise<PowChallenge> {
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const maxnumber = Math.min(
    POW_MAX_LIMIT,
    Math.round(baseMax() * Math.max(1, opts.difficulty ?? 1)),
  );
  const salt = buildSalt({
    nonce: randomHex(16),
    issued: now,
    expires: now + POW_TTL_SECONDS,
    purpose,
    site: await siteTag(tenantId),
  });
  const number = opts.secretNumber ?? randomInt(maxnumber);
  const challenge = await sha256Hex(`${salt}${number}`);
  return {
    algorithm: "SHA-256",
    challenge,
    salt,
    maxnumber,
    signature: await hmac("pow", challenge),
  };
}

export type PowCheck = "ok" | "missing" | "invalid" | "expired" | "too-fast";

/** הבדיקה בלי מסד (החד-פעמיות נבדקת אחר כך, עם הגבלת הקצב) */
export async function verifyPow(
  solution: PowSolution | null,
  tenantId: string,
  purpose: PowPurpose,
  opts: { now?: number } = {},
): Promise<PowCheck> {
  if (!solution) return "missing";
  const salt = parseSalt(solution.salt);
  if (!salt || salt.purpose !== purpose) return "invalid";
  if (!safeEqual(await hmac("pow", solution.challenge), solution.signature)) return "invalid";
  if (salt.site !== (await siteTag(tenantId))) return "invalid";
  if (!(await powHashMatches(solution))) return "invalid";
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  // תוקף ארוך מהמותר = לא אנחנו הנפקנו (או שעון שגוי) — לא מקבלים
  if (salt.expires - salt.issued !== POW_TTL_SECONDS || salt.issued > now + 60) return "invalid";
  if (salt.expires <= now) return "expired";
  if (now - salt.issued < POW_MIN_SECONDS) return "too-fast";
  return "ok";
}

/** כמה שניות נשארו לאתגר (לחלון של מונה "כבר נוצל" במסד) */
export function powRemainingSeconds(solution: PowSolution, now = Date.now()): number {
  const salt = parseSalt(solution.salt);
  return salt ? Math.max(1, Math.min(86400, salt.expires - Math.floor(now / 1000) + 60)) : 60;
}

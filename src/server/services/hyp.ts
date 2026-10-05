/**
 * שירות הסליקה של Hyp (YaadPay / MAX) — צד שרת בלבד (חלק 16).
 *
 * כל הקריאות ל-Hyp יוצאות מכאן, מהשרת: מספר המסוף, סיסמת ה-API ומפתח ה-API
 * לא מגיעים לדפדפן אף פעם. הדפדפן מקבל רק את הקישור החתום לדף התשלום.
 *
 * הפרוטוקול (Pay Protocol):
 *  1. בקשת תשלום — generatePaymentUrl: APISign / What=SIGN עם פרטי העסקה
 *     (Masof = מסוף, PassP = סיסמת המסוף, KEY = מפתח ה-API, Amount, Coin =
 *     מטבע, Info = תיאור, Order = המזהה שלנו). נשלחת ב-POST (הפרטים בגוף
 *     הבקשה ולא בכתובת), ואם Hyp לא מקבל POST — בצורה המתועדת (GET).
 *     Hyp מחזיר מחרוזת פרמטרים חתומה, ודף התשלום הוא
 *     <base>?action=pay&<המחרוזת>. הסכום וה-Order חתומים — הלקוח לא יכול
 *     לשנות אותם בדרך.
 *  2. כתובות החזרה: Hyp לוקח אותן מהגדרות המסוף (דף הצלחה / דף כישלון,
 *     והודעת שרת-לשרת אם הוגדרה) — לא מהבקשה. מגדירים שם:
 *       • דף הצלחה וכישלון: <האתר>/payments/hyp/return  (הלקוח חוזר לכאן)
 *       • הודעת שרת (Webhook / IPN): <האתר>/api/webhooks/hyp
 *     שתיהן מאמתות ומסמנות "שולם" — מי שמגיעה ראשונה; השנייה רואה ששולם.
 *     החזרה מגיעה עם Id, CCode, Amount, ACode, Order, Sign ועוד.
 *  3. אימות — כל הפרמטרים שחזרו, כפי שהם, נשלחים ל-APISign / What=VERIFY
 *     עם KEY + PassP + Masof. רק CCode=0 בתשובה = החתימה אמיתית. בלי
 *     האימות הזה כל אחד יכול "להחזיר" לדף ההצלחה עם פרמטרים מזויפים.
 *
 * כתובת ה-API: HYP_API_URL בסביבה (ברירת מחדל https://pay.hyp.co.il/p/).
 */

export const HYP_DEFAULT_URL = "https://pay.hyp.co.il/p/";

/** הנתיב שאליו Hyp מחזיר את הלקוח — מוגדר במסוף כדף הצלחה וכדף כישלון */
export const HYP_RETURN_PATH = "/payments/hyp/return";

/** הודעת שרת-לשרת מ-Hyp אחרי תשלום (Webhook / IPN) — מוגדרת במסוף */
export const HYP_WEBHOOK_PATH = "/api/webhooks/hyp";

/** מטבע העסקה — הפרמטר Coin ב-Hyp */
export type HypCurrency = "ILS" | "USD" | "EUR";

export const HYP_COIN: Record<HypCurrency, string> = { ILS: "1", USD: "2", EUR: "3" };

const TIMEOUT_MS = 15_000;

export type HypCredentials = {
  /** Masof — מספר המסוף */
  terminal: string;
  /** PassP — סיסמת ה-API */
  apiPassword: string;
  /** KEY — מפתח ה-API */
  apiKey: string;
};

export type HypPaymentRequest = {
  /** מזהה ייחודי שלנו (כוונת התשלום) — חוזר ב-Order */
  order: string;
  amount: number;
  /** ברירת מחדל: ש"ח */
  currency?: HypCurrency;
  /** תיאור שמופיע בדף התשלום (Info — למשל "הזמנה SH260000123") */
  description: string;
  /** עד כמה תשלומים הלקוח יכול לבחור (1 = בלי תשלומים) */
  maxPayments?: number;
  customer?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    /** ת.ז / ע.מ / ח.פ — רק 9 ספרות נשלחות */
    taxId?: string | null;
    street?: string | null;
    city?: string | null;
    zip?: string | null;
  };
};

export class HypError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "HypError";
  }
}

export function hypBaseUrl(): string {
  const configured = process.env["HYP_API_URL"]?.trim();
  if (!configured) return HYP_DEFAULT_URL;
  return configured.endsWith("/") ? configured : `${configured}/`;
}

/** טקסט נקי ובאורך סביר לשדה ב-Hyp (בלי & = ותווי בקרה) */
function clean(value: string | null | undefined, max: number): string {
  return (
    String(value ?? "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max)
  );
}

/** "123.4" → "123.40" (שתי ספרות אחרי הנקודה, כמו שהמסוף מצפה) */
export function formatHypAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) throw new HypError("סכום לתשלום לא תקין");
  return (Math.round(amount * 100) / 100).toFixed(2);
}

/** שם מלא → [פרטי, משפחה] */
function splitName(full: string): [string, string] {
  const parts = full.split(" ").filter(Boolean);
  if (parts.length <= 1) return [full, ""];
  return [parts.slice(0, -1).join(" "), parts[parts.length - 1]!];
}

/** הפרמטרים לבקשת החתימה (APISign / SIGN) — מיוצא לבדיקות */
export function buildSignParams(creds: HypCredentials, req: HypPaymentRequest): URLSearchParams {
  if (!/^[0-9A-Za-z_-]{6,64}$/.test(req.order)) throw new HypError("מזהה תשלום לא תקין");
  const maxPayments = Math.min(36, Math.max(1, Math.floor(req.maxPayments ?? 1)));
  const customer = req.customer ?? {};
  const [firstName, lastName] = splitName(clean(customer.name, 60));
  const taxId = String(customer.taxId ?? "").replace(/\D/g, "");
  const phone = String(customer.phone ?? "").replace(/[^0-9+]/g, "");

  const params = new URLSearchParams();
  params.set("action", "APISign");
  params.set("What", "SIGN");
  params.set("KEY", creds.apiKey);
  params.set("PassP", creds.apiPassword);
  params.set("Masof", creds.terminal);
  params.set("Order", req.order);
  params.set("Info", clean(req.description, 200) || "תשלום");
  params.set("Amount", formatHypAmount(req.amount));
  params.set("UTF8", "True");
  params.set("UTF8out", "True");
  params.set("Sign", "True");
  params.set("MoreData", "True");
  params.set("Coin", HYP_COIN[req.currency ?? "ILS"] ?? HYP_COIN.ILS);
  params.set("PageLang", "HEB");
  params.set("tmp", "1");
  // תשלומים: עד maxPayments לבחירת הלקוח
  params.set("Tash", String(maxPayments));
  params.set("FixTash", "False");
  // בלי J5 / דחיית חיוב — חיוב מיידי
  params.set("J5", "False");
  params.set("Postpone", "False");
  // המערכת לא מפיקה חשבוניות (אישור הזמנה בלבד) — וגם Hyp לא
  params.set("SendHesh", "False");
  params.set("sendemail", "False");
  if (firstName) params.set("ClientName", firstName);
  if (lastName) params.set("ClientLName", lastName);
  if (customer.email) params.set("email", clean(customer.email, 120));
  if (phone.length >= 9) params.set("cell", phone.slice(0, 15));
  if (/^[0-9]{9}$/.test(taxId)) params.set("UserId", taxId);
  if (customer.street) params.set("street", clean(customer.street, 100));
  if (customer.city) params.set("city", clean(customer.city, 60));
  if (customer.zip) params.set("zip", String(customer.zip).replace(/\D/g, "").slice(0, 7));
  return params;
}

/** בקשה ל-Hyp: GET (הפרמטרים בכתובת — הצורה המתועדת) או POST (בגוף הבקשה) */
async function hypRequest(method: "GET" | "POST", query: string): Promise<string> {
  let response: Response;
  try {
    response =
      method === "GET"
        ? await fetch(`${hypBaseUrl()}?${query}`, {
            method: "GET",
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { Accept: "text/plain, */*" },
          })
        : await fetch(hypBaseUrl(), {
            method: "POST",
            body: query,
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: {
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              Accept: "text/plain, */*",
            },
          });
  } catch (error) {
    console.error(`[hyp] ${method} failed`, error instanceof Error ? error.message : error);
    throw new HypError("אין חיבור לחברת הסליקה כרגע. נסו שוב בעוד רגע.");
  }
  const text = (await response.text()).trim();
  if (!response.ok) {
    console.error(`[hyp] ${method} HTTP`, response.status, text.slice(0, 200));
    throw new HypError("חברת הסליקה החזירה שגיאה. נסו שוב בעוד רגע.");
  }
  return text;
}

const hypGet = (query: string) => hypRequest("GET", query);

type SignOutcome =
  { kind: "signed"; url: string } | { kind: "refused"; code: string | null; text: string };

/** התשובה ל-SIGN: מחרוזת חתומה → קישור לדף התשלום; אחרת — סירוב */
function readSignResponse(text: string): SignOutcome {
  const signed = new URLSearchParams(text);
  if (!text || !signed.has("signature")) {
    return { kind: "refused", code: signed.get("CCode"), text };
  }
  signed.delete("action");
  return { kind: "signed", url: `${hypBaseUrl()}?action=pay&${signed.toString()}` };
}

function signRefusal(outcome: Extract<SignOutcome, { kind: "refused" }>): HypError {
  const { code } = outcome;
  console.error("[hyp] SIGN refused", code, outcome.text.slice(0, 200));
  return new HypError(
    code === "901" || code === "902"
      ? "פרטי המסוף בחברת הסליקה שגויים (מספר מסוף / סיסמת API / מפתח API). בדקו את הגדרות הסליקה."
      : `חברת הסליקה סירבה ליצור את דף התשלום (קוד ${code ?? "לא ידוע"}).`,
    code,
  );
}

/** האם Hyp מקבל את בקשת החתימה ב-POST (נלמד בפעם הראשונה; null = עוד לא ידוע) */
let signViaPost: boolean | null = null;

/**
 * Generate Payment URL — יצירת קישור מאובטח לדף התשלום של Hyp.
 * מחזיר את הכתובת המלאה שאליה מעבירים את הלקוח.
 *
 * POST קודם: מספר המסוף, סיסמת המסוף ומפתח ה-API עוברים בגוף הבקשה ולא
 * בכתובת (שנשמרת ביומני שרתים). אם Hyp לא מחזיר מחרוזת חתומה ל-POST —
 * שולחים שוב בצורה המתועדת (GET), והתשובה שלה קובעת. בקשת חתימה לא
 * יוצרת עסקה ולא מחייבת, כך שניסיון שני בטוח.
 */
export async function generatePaymentUrl(
  creds: HypCredentials,
  req: HypPaymentRequest,
): Promise<string> {
  const query = buildSignParams(creds, req).toString();
  if (signViaPost !== false) {
    try {
      const outcome = readSignResponse(await hypRequest("POST", query));
      if (outcome.kind === "signed") {
        signViaPost = true;
        return outcome.url;
      }
    } catch {
      // POST לא עבר (חיבור / HTTP) — ננסה בצורה המתועדת
    }
  }
  const outcome = readSignResponse(await hypGet(query));
  if (outcome.kind === "signed") {
    // ה-GET הצליח אחרי שה-POST לא — מכאן והלאה ישר ב-GET
    if (signViaPost === null) signViaPost = false;
    return outcome.url;
  }
  throw signRefusal(outcome);
}

/** השם מחלק 16 — אותה פונקציה */
export const createPaymentLink = generatePaymentUrl;

/** לבדיקות: לשכוח מה נלמד על POST */
export function resetHypTransportForTests(): void {
  signViaPost = null;
}

/** הפרמטרים ש-Hyp מחזיר לדף ההצלחה / הכישלון */
export type HypReturn = {
  /** Order — הטוקן של כוונת התשלום שלנו */
  order: string | null;
  /** Id — מספר העסקה ב-Hyp */
  transactionId: string | null;
  /** CCode — 0 = אושר */
  code: string | null;
  amount: number | null;
  payments: number | null;
  cardLast4: string | null;
  /** המחרוזת המקורית — לאימות, תו בתו */
  raw: string;
};

const CREDENTIAL_KEYS = new Set(["action", "what", "key", "passp", "masof"]);

/** פירוק המחרוזת שחזרה מ-Hyp; null = פרמטר כפול (ניסיון התחכמות) */
export function parseHypReturn(raw: string): HypReturn | null {
  const query = raw.replace(/^\?/, "");
  const seen = new Set<string>();
  for (const part of query.split("&")) {
    if (!part) continue;
    const key = decodeURIComponent(part.split("=")[0]!.replace(/\+/g, " ")).toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
  }
  const params = new URLSearchParams(query);
  const num = (value: string | null): number | null => {
    if (value === null || value.trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const last4 = params.get("L4digit");
  return {
    order: params.get("Order"),
    transactionId: params.get("Id"),
    code: params.get("CCode"),
    amount: num(params.get("Amount")),
    payments: num(params.get("Payments")),
    cardLast4: last4 && /^[0-9]{4}$/.test(last4) ? last4 : null,
    raw: query,
  };
}

/** הבקשה לאימות (APISign / VERIFY) — הפרמטרים שחזרו כפי שהם, בלי פרטי גישה — מיוצא לבדיקות */
export function buildVerifyQuery(creds: HypCredentials, raw: string): string {
  const passthrough = raw
    .replace(/^\?/, "")
    .split("&")
    .filter((part) => {
      if (!part) return false;
      const key = decodeURIComponent(part.split("=")[0]!.replace(/\+/g, " ")).toLowerCase();
      return !CREDENTIAL_KEYS.has(key);
    })
    .join("&");
  const head = new URLSearchParams();
  head.set("action", "APISign");
  head.set("What", "VERIFY");
  head.set("KEY", creds.apiKey);
  head.set("PassP", creds.apiPassword);
  head.set("Masof", creds.terminal);
  return `${head.toString()}&${passthrough}`;
}

/**
 * אימות החתימה של החזרה מ-Hyp. true רק אם Hyp אישר (CCode=0) שהפרמטרים
 * האלה — כולל Order, Amount ו-Id — הם בדיוק מה שהוא חתם.
 */
export async function verifyHypReturn(creds: HypCredentials, ret: HypReturn): Promise<boolean> {
  if (!ret.raw.includes("Sign=") && !ret.raw.includes("sign=")) return false;
  const text = await hypGet(buildVerifyQuery(creds, ret.raw));
  const result = new URLSearchParams(text);
  const ok = result.get("CCode") === "0";
  if (!ok) console.warn("[hyp] VERIFY failed", result.get("CCode"), ret.order);
  return ok;
}

/** הודעה ללקוח לפי CCode של עסקה שלא אושרה */
export function hypDeclineMessage(code: string | null): string {
  if (code === null) return "התשלום לא הושלם.";
  return `התשלום לא אושר על ידי חברת האשראי (קוד ${code}). אפשר לנסות שוב או להשתמש בכרטיס אחר.`;
}

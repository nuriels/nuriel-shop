/**
 * חלק 43: לקוח ה-API של Grow (משולם) — צד שרת בלבד.
 *
 * שלושה דברים:
 *  - createPaymentProcess — יוצר דף תשלום ומחזיר {processId, processToken, url}.
 *  - approveTransaction  — אישור קבלת ההתראה (חובה לפי התיעוד; העסקה נסלקת גם בלעדיו).
 *  - parseGrowWebhook    — פענוח ההתראה (POST רגיל, לא JSON; שדות בסימון data[...]).
 * הבקשות יוצאות מהשרת בלבד (Grow חוסמת בקשות מהדפדפן). פרטי המסוף מפוענחים
 * רק כאן, ברגע השימוש, ולא נרשמים בשום לוג או הודעת שגיאה.
 */

import { createHash } from "node:crypto";
import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";
import { decryptSecret } from "@/lib/grow-crypto.server";

const SANDBOX_BASE = "https://sandbox.meshulam.co.il/api/light/server/1.0";
const REQUEST_TIMEOUT_MS = 15_000;

export type GrowCredentials = {
  userId: string;
  pageCode: string;
  apiKey: string | null;
  sandbox: boolean;
  enabled: boolean;
  maxPayments: number;
  transactionTypes: number[] | null;
};

function baseUrl(sandbox: boolean): string {
  // GROW_SANDBOX_URL: רק לבדיקות אוטומטיות (שרת Grow מדומה) — בשרת אמיתי לא מוגדר
  if (sandbox) return process.env["GROW_SANDBOX_URL"]?.trim().replace(/\/+$/, "") || SANDBOX_BASE;
  // כתובת הייצור ניתנת ע"י Grow ביום המעבר — לא מנחשים אותה
  const prod = process.env["GROW_API_URL"]?.trim().replace(/\/+$/, "");
  if (!prod) throw new Error("כתובת הייצור של Grow (GROW_API_URL) לא הוגדרה בשרת");
  if (!/^https:\/\//.test(prod)) throw new Error("כתובת הייצור של Grow חייבת להיות HTTPS");
  return prod;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** פרטי המסוף של חנות (מפוענחים), או null אם לא הוגדרו */
export async function loadGrowCredentials(tenantId: string): Promise<GrowCredentials | null> {
  const { data } = await supabaseAdminUnscoped
    .from("tenant_grow_credentials")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  return {
    userId: decryptSecret(data.user_id_enc),
    pageCode: decryptSecret(data.page_code_enc),
    apiKey: data.api_key_enc ? decryptSecret(data.api_key_enc) : null,
    sandbox: data.sandbox,
    enabled: data.enabled,
    maxPayments: data.max_payments,
    transactionTypes: data.transaction_types,
  };
}

/** ללא תווים מיוחדים (Grow: "אין לכלול תווים מיוחדים") — אותיות, ספרות, רווח ומקף */
export function plainText(value: string, max: number): string {
  return value
    .replace(/[^\p{L}\p{N} -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

async function postForm(url: string, form: FormData): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      body: form,
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const text = await response.text();
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      throw new Error(`תשובה לא תקינה מ-Grow (${response.status})`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Grow לא ענתה בזמן — נסו שוב");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** הודעת השגיאה של Grow (בלי לחשוף פרטי חיבור) */
function growError(body: Record<string, unknown>): string {
  const err = body["err"];
  if (err && typeof err === "object") {
    const message = (err as Record<string, unknown>)["message"];
    if (typeof message === "string" && message) return message.slice(0, 200);
  }
  return typeof err === "string" && err ? err.slice(0, 200) : "הבקשה ל-Grow נכשלה";
}

export type GrowProcessInput = {
  creds: GrowCredentials;
  sum: number;
  description: string;
  fullName: string;
  phone: string;
  email: string | null;
  successUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  /** מזהה ההזמנה שלנו — חוזר בהתראה ב-customFields.cField1 */
  orderId: string;
  /** ברירת מחדל: המקסימום שהוגדר לחנות */
  maxPayments?: number;
};

export async function createGrowPaymentProcess(
  input: GrowProcessInput,
): Promise<{ processId: string; processToken: string; url: string }> {
  const { creds } = input;
  const form = new FormData();
  form.append("pageCode", creds.pageCode);
  form.append("userId", creds.userId);
  if (creds.apiKey) form.append("apiKey", creds.apiKey);
  form.append("sum", input.sum.toFixed(2));
  form.append("description", plainText(input.description, 100) || "הזמנה");
  form.append("successUrl", input.successUrl);
  form.append("cancelUrl", input.cancelUrl);
  form.append("notifyUrl", input.notifyUrl);
  form.append("pageField[fullName]", plainText(input.fullName, 80));
  // טלפון נייד ישראלי: ספרות בלבד
  form.append("pageField[phone]", input.phone.replace(/\D/g, "").replace(/^972/, "0"));
  if (input.email) form.append("pageField[email]", input.email.slice(0, 120));
  form.append("cField1", input.orderId);
  const max = Math.min(creds.maxPayments, input.maxPayments ?? creds.maxPayments);
  if (max >= 2) form.append("maxPaymentNum", String(max));
  (creds.transactionTypes ?? []).forEach((type, index) => {
    form.append(`transactionTypes[${index}]`, String(type));
  });

  const body = await postForm(`${baseUrl(creds.sandbox)}/createPaymentProcess`, form);
  const data = body["data"];
  const ok = String(body["status"]) === "1" && data && typeof data === "object";
  const row = (ok ? data : {}) as Record<string, unknown>;
  const url = typeof row["url"] === "string" ? row["url"] : "";
  const processId = row["processId"] != null ? String(row["processId"]) : "";
  const processToken = typeof row["processToken"] === "string" ? row["processToken"] : "";
  if (!ok || !url || !processId || !processToken) throw new Error(growError(body));
  const testHook = Boolean(process.env["GROW_SANDBOX_URL"]);
  if (!(testHook ? /^https?:\/\//.test(url) : /^https:\/\//.test(url))) {
    throw new Error("כתובת דף התשלום מ-Grow לא תקינה");
  }
  return { processId, processToken, url };
}

/** שדות ההתראה (כפי שהתקבלו) */
export type GrowWebhook = {
  status: string;
  statusCode: string;
  sum: number;
  asmachta: string;
  transactionId: string;
  transactionToken: string;
  processId: string;
  processToken: string;
  cardBrand: string;
  cardSuffix: string;
  paymentsNum: number;
  orderId: string;
  /** כל השדות כפי שנשלחו — לשליחה חזרה ב-approveTransaction */
  fields: Record<string, string>;
};

/** "data[asmachta]=1&data[customFields][cField1]=x" → {data: {asmachta: "1", customFields: {cField1: "x"}}} */
function nestBrackets(pairs: Iterable<[string, string]>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of pairs) {
    const parts = key.split(/[[\]]+/).filter(Boolean);
    if (parts.length === 0 || parts.some((p) => p === "__proto__" || p === "constructor")) continue;
    let node = root;
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        node[part] = value;
      } else {
        const next = node[part];
        node =
          next && typeof next === "object"
            ? (next as Record<string, unknown>)
            : ((node[part] = {}) as Record<string, unknown>);
      }
    });
  }
  return root;
}

export async function parseGrowWebhook(request: Request): Promise<GrowWebhook | null> {
  const type = request.headers.get("content-type") ?? "";
  let tree: Record<string, unknown> = {};
  if (type.includes("application/json")) {
    const parsed: unknown = await request.json().catch(() => null);
    if (parsed && typeof parsed === "object") tree = parsed as Record<string, unknown>;
  } else {
    const form = await request.formData().catch(() => null);
    if (!form) return null;
    const pairs: [string, string][] = [];
    form.forEach((value, key) => {
      if (typeof value === "string") pairs.push([key, value]);
    });
    tree = nestBrackets(pairs);
  }
  const data = (tree["data"] && typeof tree["data"] === "object" ? tree["data"] : tree) as Record<
    string,
    unknown
  >;
  const str = (key: string) =>
    data[key] != null && typeof data[key] !== "object" ? String(data[key]) : "";
  const custom = data["customFields"];
  const orderId =
    custom && typeof custom === "object"
      ? String((custom as Record<string, unknown>)["cField1"] ?? "")
      : "";
  const fields: Record<string, string> = {};
  for (const key of [
    "transactionId",
    "transactionToken",
    "transactionTypeId",
    "paymentType",
    "sum",
    "firstPaymentSum",
    "periodicalPaymentSum",
    "paymentsNum",
    "allPaymentsNum",
    "paymentDate",
    "asmachta",
    "description",
    "fullName",
    "payerPhone",
    "payerEmail",
    "cardSuffix",
    "cardType",
    "cardTypeCode",
    "cardBrand",
    "cardBrandCode",
    "cardExp",
    "processId",
    "processToken",
  ]) {
    fields[key] = str(key);
  }
  const processId = str("processId");
  const processToken = str("processToken");
  if (!processId || !processToken) return null;
  return {
    status: str("status"),
    statusCode: str("statusCode"),
    sum: Number(str("sum")),
    asmachta: str("asmachta"),
    transactionId: str("transactionId"),
    transactionToken: str("transactionToken"),
    processId,
    processToken,
    cardBrand: str("cardBrand"),
    cardSuffix: str("cardSuffix"),
    paymentsNum: Math.max(Number(str("allPaymentsNum")) || 1, 1),
    orderId,
    fields,
  };
}

/** אישור ההתראה ל-Grow — כל השדות שהתקבלו + pageCode. כשל לא מבטל את העסקה. */
export async function approveGrowTransaction(
  creds: GrowCredentials,
  hook: GrowWebhook,
): Promise<boolean> {
  const form = new FormData();
  form.append("pageCode", creds.pageCode);
  for (const [key, value] of Object.entries(hook.fields)) {
    if (value !== "") form.append(key, value);
  }
  try {
    const body = await postForm(`${baseUrl(creds.sandbox)}/approveTransaction`, form);
    return String(body["status"]) === "1";
  } catch (error) {
    console.error(
      "[grow] approveTransaction failed",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

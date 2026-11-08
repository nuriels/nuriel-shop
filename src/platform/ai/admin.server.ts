/**
 * NURIEL AI ASSISTANT — "ניהול תוסף AI" של מנהל העל (צד שרת בלבד). בכל פעולה, ראשונה: הבקשה מגיעה
 * לכתובת פאנל הפלטפורמה (לא לאתר של עסק), המשתמש מחובר, והוא מנהל פלטפורמה — לפי המסד. ואז הפונקציה
 * במסד בודקת שוב שהמבצע מנהל פלטפורמה ורושמת ביומן הפלטפורמה. רק אחרי ההרשאה נבדק הקלט, כך שמי
 * שאין לו הרשאה לא לומד כלום מהודעות של בדיקת קלט.
 *
 * מפתח ה-API לעולם לא חוזר מכאן: רק "יש מפתח", "אפשר לפענח", ו-4 התווים האחרונים.
 */
import { sessionFromRequest } from "../auth/session.server";
import { allowAction } from "../security/rate-limit.server";
import { isPlatformHost } from "../tenancy/current-site.server";
import type { GuideCatalog } from "./guides/types";
import { isAiProduct } from "./guides/types";
import {
  AI_MODELS,
  checkApiKeyFormat,
  describeAiError,
  estimateCostUsd,
  FORBIDDEN_MESSAGE,
  isAiMode,
  keyLast4,
  LIMIT_BOUNDS,
  MODEL_PRICES,
  MODEL_PRICES_CHECKED_ON,
  type TokenUsage,
} from "./logic";
import { createAnthropicRouterClient, routeQuestion, type RouterClient } from "./router.server";
import { SafeError } from "./safe-error";
import { AiSecretConfigError, encryptApiKey } from "./secrets.server";
import * as store from "./store.server";
import type {
  AdminBusiness,
  AiAdminOverview,
  AiAnomaly,
  ConnectionTestResult,
  JsonObject,
} from "./types";

const HOUR = 60 * 60 * 1000;

/**
 * ההרשאה, ראשונה בכל פעולה: כתובת הפאנל (הכתובת עצמה — לא "אין אתר", שקורה גם בכתובת של עסק), משתמש
 * מחובר, מנהל פלטפורמה. הודעה זהה בכל סירוב
 */
export async function requirePlatformAdmin(): Promise<{ userId: string }> {
  if (!(await isPlatformHost())) throw new SafeError(FORBIDDEN_MESSAGE);
  let session: { userId: string } | null = null;
  try {
    session = await sessionFromRequest();
  } catch {
    session = null;
  }
  if (!session || !(await store.isPlatformAdmin(session.userId)))
    throw new SafeError(FORBIDDEN_MESSAGE);
  return session;
}

/** הודעות המסד (באנגלית, קבועות) → הודעה בעברית למנהל העל. כל השאר → הודעה כללית */
const DB_MESSAGES: readonly [RegExp, string][] = [
  [/platform admin only/, FORBIDDEN_MESSAGE],
  [/business not found/, "העסק לא נמצא"],
  [/unknown product/, "סוג עוזר לא מוכר"],
  [
    /must match the business type/,
    "סוג העוזר חייב להתאים לסוג העסק — Ecommerce לחנות אונליין, Hospitality למתחם אירוח",
  ],
  [/start date out of range/, "תאריך ההתחלה צריך להיות עד 60 יום אחורה ועד שנה קדימה"],
  [/renew it instead/, 'לעסק כבר יש חבילה בתוקף או שנקבעה מראש — השתמשו ב"חידוש לשנה נוספת"'],
  [/overlaps an earlier period/, "תאריך ההתחלה חופף לתקופה קודמת — בחרו תאריך אחרי סיומה"],
  [/activate first/, "לעסק אין חבילה — הפעילו קודם"],
  [
    /already scheduled/,
    "כבר נקבעה תקופה עתידית (חידוש מראש, או הפעלה שעוד לא התחילה) — אפשר לחדש שוב רק כשהיא תתחיל",
  ],
  [
    /changed meanwhile/,
    "החבילה השתנתה בינתיים (ייתכן שכבר חודשה) — רעננו את הרשימה ובדקו לפני חידוש נוסף",
  ],
  [/no package for this business/, "לעסק אין חבילה"],
];

function adminError(error: unknown, fallback: string): SafeError {
  const message = error instanceof Error ? error.message : "";
  for (const [pattern, text] of DB_MESSAGES) if (pattern.test(message)) return new SafeError(text);
  return new SafeError(fallback);
}

function limit(userId: string, action: string, perHour: number): void {
  if (!allowAction(`ai-admin:${action}:${userId}`, perHour, HOUR)) {
    throw new SafeError("בוצעו יותר מדי פעולות בשעה האחרונה — נסו שוב מאוחר יותר");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ערך שהגיע מ-JSON (קלט מהדפדפן / פלט של המסד) כאובייקט — כל דבר אחר נהיה אובייקט ריק */
function obj(input: unknown): JsonObject {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as JsonObject)
    : {};
}

function tenantIdOf(input: Record<string, unknown>): string {
  const id = String(input["tenantId"] ?? "")
    .trim()
    .toLowerCase();
  if (!UUID.test(id)) throw new SafeError("עסק לא תקין");
  return id;
}

function noteOf(value: unknown): string | null {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return text === "" ? null : text;
}

// ------------------------------------------------------------------ רשימת העסקים וההיסטוריה

export async function handleList(input: unknown): Promise<AdminBusiness[]> {
  const { userId } = await requirePlatformAdmin();
  const data = obj(input);
  const product = data["product"];
  const search = String(data["search"] ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  try {
    const rows = await store.rpc<JsonObject[]>("ai_admin_list", {
      _actor: userId,
      _product: isAiProduct(product) ? product : null,
      _search: search === "" ? null : search,
    });
    return (rows ?? []).map((row) => ({
      tenantId: String(row["tenant_id"]),
      slug: String(row["slug"] ?? ""),
      name: String(row["name"] ?? ""),
      siteType: row["site_type"] === "hospitality" ? "hospitality" : "ecommerce",
      tenantStatus: typeof row["tenant_status"] === "string" ? row["tenant_status"] : null,
      state: obj(row["state"]),
    }));
  } catch (error) {
    throw adminError(error, "טעינת הרשימה נכשלה");
  }
}

export async function handleHistory(input: unknown): Promise<JsonObject> {
  const { userId } = await requirePlatformAdmin();
  const tenantId = tenantIdOf(obj(input));
  try {
    return obj(await store.rpc("ai_admin_history", { _actor: userId, _tenant: tenantId }));
  } catch (error) {
    throw adminError(error, "טעינת ההיסטוריה נכשלה");
  }
}

// ------------------------------------------------------------------ הפעלה / חידוש / השבתה

export async function handleActivate(input: unknown): Promise<JsonObject> {
  const { userId } = await requirePlatformAdmin();
  limit(userId, "write", 120);
  const data = obj(input);
  const tenantId = tenantIdOf(data);
  const product = data["product"];
  if (!isAiProduct(product)) throw new SafeError("נא לבחור את סוג העוזר");
  const startsOn = String(data["startsOn"] ?? "").trim();
  if (!DATE.test(startsOn)) throw new SafeError("נא לבחור תאריך התחלה");
  try {
    return obj(
      await store.rpc("ai_admin_activate", {
        _actor: userId,
        _tenant: tenantId,
        _product: product,
        _starts_on: startsOn,
        _note: noteOf(data["note"]),
      }),
    );
  } catch (error) {
    throw adminError(error, "ההפעלה נכשלה");
  }
}

export async function handleRenew(input: unknown): Promise<JsonObject> {
  const { userId } = await requirePlatformAdmin();
  limit(userId, "write", 120);
  const data = obj(input);
  const tenantId = tenantIdOf(data);
  // סוף התקופה האחרונה כפי שהמסך הציג: אם השתנה בינתיים (לחיצה כפולה, ניסיון חוזר אחרי שהתשובה אבדה,
  // מנהל אחר, רשימה ישנה) — המסד עוצר, ולא נרשמת שנה נוספת בטעות
  const expectedLastEnd = String(data["expectedLastEnd"] ?? "").trim();
  if (!DATE.test(expectedLastEnd)) throw new SafeError("רעננו את הרשימה ונסו שוב");
  try {
    return obj(
      await store.rpc("ai_admin_renew", {
        _actor: userId,
        _tenant: tenantId,
        _expected_last_end: expectedLastEnd,
        _note: noteOf(data["note"]),
      }),
    );
  } catch (error) {
    throw adminError(error, "החידוש נכשל");
  }
}

export async function handleSetSuspended(input: unknown): Promise<JsonObject> {
  const { userId } = await requirePlatformAdmin();
  limit(userId, "write", 120);
  const data = obj(input);
  const tenantId = tenantIdOf(data);
  if (typeof data["suspended"] !== "boolean") throw new SafeError("פעולה לא תקינה");
  try {
    return obj(
      await store.rpc("ai_admin_set_suspended", {
        _actor: userId,
        _tenant: tenantId,
        _suspended: data["suspended"],
        _reason: noteOf(data["reason"]),
      }),
    );
  } catch (error) {
    throw adminError(error, "השינוי נכשל");
  }
}

// ------------------------------------------------------------------ הגדרות, מפתח, צריכה

/** חריגות שימוש: קפיצה מול 14 הימים הקודמים, הרבה בקשות חסומות, הרבה תקלות, חריגה מהתקציב */
export function detectAnomalies(usage: JsonObject | null, budgetUsd: number): AiAnomaly[] {
  if (!usage) return [];
  const out: AiAnomaly[] = [];
  const tenants = Array.isArray(usage["tenants"]) ? (usage["tenants"] as JsonObject[]) : [];
  for (const row of tenants) {
    const name = String(row["name"] ?? row["slug"] ?? "");
    const calls = Number(row["calls_24h"] ?? 0);
    const blocked = Number(row["blocked_24h"] ?? 0);
    const failed = Number(row["failed_24h"] ?? 0);
    const dailyAverage = Number(row["calls_prev_14d"] ?? 0) / 14;
    if (calls >= 20 && calls > 3 * Math.max(1, dailyAverage)) {
      out.push({
        kind: "spike",
        tenant: name,
        message: `${name}: ${calls} שאלות ב-24 השעות האחרונות — פי ${Math.round(calls / Math.max(1, dailyAverage))} מהממוצע`,
      });
    }
    if (blocked >= 5 && blocked / Math.max(1, calls) >= 0.3) {
      out.push({
        kind: "blocked",
        tenant: name,
        message: `${name}: ${blocked} בקשות חסומות ב-24 השעות האחרונות (ייתכן ניסיון עקיפה)`,
      });
    }
    if (failed >= 5) {
      out.push({
        kind: "failures",
        tenant: name,
        message: `${name}: ${failed} תקלות מול שירות ה-AI ב-24 השעות האחרונות`,
      });
    }
  }
  const totals = obj(usage["totals"]);
  const cost = Number(totals["cost_usd"] ?? 0);
  if (budgetUsd > 0 && cost > budgetUsd) {
    out.push({
      kind: "budget",
      tenant: null,
      message: `העלות המשוערת החודש ($${cost.toFixed(2)}) עברה את התקציב ($${budgetUsd.toFixed(2)})`,
    });
  }
  return out;
}

export async function handleOverview(): Promise<AiAdminOverview> {
  const { userId } = await requirePlatformAdmin();
  const row = await store.loadSettings();
  const { hasKey, readable } = store.readApiKey(row);
  let usage: JsonObject | null = null;
  let packages: AiAdminOverview["packages"] = [];
  try {
    usage = obj(await store.rpc("ai_admin_usage", { _actor: userId }));
  } catch {
    usage = null;
  }
  try {
    packages = (await store.loadPackages()).map((p) => ({
      product: p.product,
      name: p.name,
      priceAgorot: p.price_agorot,
    }));
  } catch {
    packages = [];
  }
  const budget = Number(row?.monthly_budget_usd ?? 0);
  return {
    settings: row
      ? {
          mode: row.mode,
          model: store.modelOf(row),
          hasKey,
          keyReadable: readable,
          keyLast4: row.api_key_last4,
          keyUpdatedAt: row.api_key_updated_at,
          lastError: row.last_error,
          lastErrorAt: row.last_error_at,
          maxQuestionChars: row.max_question_chars,
          tenantHourlyLimit: row.tenant_hourly_limit,
          userMinuteLimit: row.user_minute_limit,
          monthlyBudgetUsd: budget,
        }
      : null,
    models: AI_MODELS.map((model) => ({ ...model, prices: MODEL_PRICES[model.id] })),
    pricesCheckedOn: MODEL_PRICES_CHECKED_ON,
    packages,
    usage,
    anomalies: detectAnomalies(usage, budget),
  };
}

function boundedInt(value: unknown, bounds: { min: number; max: number }, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < bounds.min || n > bounds.max) {
    throw new SafeError(`${label}: מספר שלם בין ${bounds.min} ל-${bounds.max}`);
  }
  return n;
}

/** שמירה: מפתח חדש (מוצפן כאן, לפני המסד), מחיקת מפתח, מצב, דגם, מגבלות. שדה שלא נשלח — לא משתנה */
export async function handleSaveSettings(input: unknown): Promise<{ ok: true }> {
  const { userId } = await requirePlatformAdmin();
  limit(userId, "settings", 30);
  const data = obj(input);
  const patch: Record<string, unknown> = {};
  if (data["apiKey"] !== undefined && String(data["apiKey"]).trim() !== "") {
    const check = checkApiKeyFormat(data["apiKey"]);
    if (!check.ok) throw new SafeError(check.error);
    try {
      patch["api_key_encrypted"] = encryptApiKey(check.key);
    } catch (error) {
      throw new SafeError(
        error instanceof AiSecretConfigError && /shorter than 32/.test(error.message)
          ? "הגדרת ההצפנה בשרת שגויה: AI_ASSISTANT_SECRET קצר מ-32 תווים — מאריכים אותו או מסירים אותו"
          : "לא ניתן להצפין את המפתח בשרת — פנו לתמיכה הטכנית",
      );
    }
    patch["api_key_last4"] = keyLast4(check.key);
  }
  if (data["removeKey"] === true) {
    if (patch["api_key_encrypted"])
      throw new SafeError("אי אפשר גם להחליף וגם למחוק את המפתח באותה פעולה");
    patch["remove_key"] = "true";
  }
  if (data["mode"] !== undefined) {
    if (!isAiMode(data["mode"])) throw new SafeError("מצב לא חוקי");
    patch["mode"] = data["mode"];
  }
  if (data["model"] !== undefined) {
    const known = AI_MODELS.find((model) => model.id === data["model"]);
    if (!known) throw new SafeError("דגם לא מוכר");
    patch["model"] = known.id;
  }
  if (data["maxQuestionChars"] !== undefined) {
    patch["max_question_chars"] = boundedInt(
      data["maxQuestionChars"],
      LIMIT_BOUNDS.maxQuestionChars,
      "אורך שאלה",
    );
  }
  if (data["tenantHourlyLimit"] !== undefined) {
    patch["tenant_hourly_limit"] = boundedInt(
      data["tenantHourlyLimit"],
      LIMIT_BOUNDS.tenantHourlyLimit,
      "שאלות לעסק בשעה",
    );
  }
  if (data["userMinuteLimit"] !== undefined) {
    patch["user_minute_limit"] = boundedInt(
      data["userMinuteLimit"],
      LIMIT_BOUNDS.userMinuteLimit,
      "שאלות למשתמש בדקה",
    );
  }
  if (data["monthlyBudgetUsd"] !== undefined) {
    const n = Number(data["monthlyBudgetUsd"]);
    if (
      !Number.isFinite(n) ||
      n < LIMIT_BOUNDS.monthlyBudgetUsd.min ||
      n > LIMIT_BOUNDS.monthlyBudgetUsd.max
    ) {
      throw new SafeError("תקציב חודשי לא תקין");
    }
    patch["monthly_budget_usd"] = Math.round(n * 100) / 100;
  }
  if (Object.keys(patch).length === 0) throw new SafeError("אין מה לשמור");
  try {
    await store.rpc("ai_admin_save_settings", { _actor: userId, _patch: patch });
  } catch (error) {
    throw adminError(error, "שמירת ההגדרות נכשלה");
  }
  return { ok: true };
}

/**
 * בדיקת חיבור: בקשה אמיתית אחת עם שאלה ידועה מהקטלוג — בודקת מפתח, דגם וסיווג. נרשמת ביומן (test) כדי
 * שהעלות שלה תיכלל בצריכה החודשית.
 */
export async function handleTestConnection(
  catalog: GuideCatalog,
  deps: { createClient?: (apiKey: string) => Promise<RouterClient> } = {},
): Promise<ConnectionTestResult> {
  const { userId } = await requirePlatformAdmin();
  limit(userId, "test", 20);
  const row = await store.loadSettings();
  const { key, hasKey, readable } = store.readApiKey(row);
  if (!hasKey) return { ok: false, message: "אין מפתח שמור — הדביקו מפתח ושמרו" };
  if (!key || !readable)
    return { ok: false, message: "אי אפשר לפענח את המפתח השמור — הדביקו אותו מחדש" };
  const model = store.modelOf(row);
  const createClient = deps.createClient ?? createAnthropicRouterClient;
  const question = catalog.connectionTest.question;
  try {
    const routed = await routeQuestion(await createClient(key), {
      catalog,
      model,
      question,
      previous: [],
    });
    const usage: TokenUsage = {
      inputTokens: routed.inputTokens,
      cacheWriteTokens: routed.cacheWriteTokens,
      cacheReadTokens: routed.cacheReadTokens,
      outputTokens: routed.outputTokens,
    };
    const costUsd = estimateCostUsd(model, usage);
    await store.recordLastError(null);
    await store.logUsage({
      tenantId: null,
      product: catalog.product,
      mode: "test",
      outcome:
        routed.result.topic === "off_topic"
          ? "off_topic"
          : routed.result.guideIds.length > 0
            ? "guides"
            : "unknown",
      guides: routed.result.guideIds,
      question: null,
      model,
      ...usage,
      costUsd,
    });
    return {
      ok: true,
      model,
      routedCorrectly:
        routed.result.topic === "site_help" &&
        routed.result.guideIds.some((id) => catalog.connectionTest.expectGuides.includes(id)),
      usage,
      costUsd,
    };
  } catch (error) {
    const message = describeAiError(error);
    await store.recordLastError(message);
    await store.logUsage({
      tenantId: null,
      product: catalog.product,
      mode: "test",
      outcome: "failed",
      guides: [],
      question: null,
      model,
      error: message,
    });
    return { ok: false, message };
  }
}

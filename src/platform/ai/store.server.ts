/**
 * NURIEL AI ASSISTANT — גישה למסד (צד שרת בלבד, דרך מפתח השירות). הטבלאות סגורות לדפדפן לחלוטין, גם
 * למנהל עסק וגם למנהל העל; ההרשאה נבדקת כאן ובמסד, בכל בקשה. לדגם עצמו אין שום גישה למסד — רק הקוד
 * הזה, בפעולות המוגדרות מטה. כל פעולה של מנהל העל עוברת דרך פונקציה במסד שבודקת שוב שהוא מנהל
 * פלטפורמה (is_platform_admin) ורושמת ביומן הפלטפורמה.
 */
import { serviceHeaders, supabaseUrl } from "../supabase/env.server";
import { decryptApiKey } from "./secrets.server";
import { normalizeModel, type AiMode, type AiModelId } from "./logic";

export class AiDbError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "AiDbError";
  }
}

async function request<T>(
  path: string,
  init: { method: string; body?: unknown; tenantId?: string | null; prefer?: string },
): Promise<T> {
  const headers: Record<string, string> = { ...serviceHeaders() };
  if (init.tenantId) headers["x-tenant-id"] = init.tenantId;
  if (init.prefer) headers["Prefer"] = init.prefer;
  const res = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    method: init.method,
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  if (!res.ok) {
    let error: { message?: string; code?: string } = {};
    try {
      error = JSON.parse(text) as typeof error;
    } catch {
      error = {};
    }
    throw new AiDbError(
      String(error.message ?? `http ${res.status}`).slice(0, 300),
      res.status,
      error.code ?? null,
    );
  }
  return (text ? JSON.parse(text) : null) as T;
}

export function rpc<T>(
  fn: string,
  args: Record<string, unknown>,
  tenantId?: string | null,
): Promise<T> {
  return request<T>(`rpc/${fn}`, { method: "POST", body: args, tenantId: tenantId ?? null });
}

// ------------------------------------------------------------------ מי הפונה

export type CallerRole = "owner" | "manager" | "cashier" | "warehouse" | "agent" | null;

/**
 * התפקיד של המשתמש בעסק — לפי המנגנון הקיים (public.store_staff_role), בלי לשנות אותו: מנהל העסק
 * (admin) הוא owner / manager, מנהל הפלטפורמה — owner בכל עסק. העסק — לפי הכתובת (x-tenant-id שהשרת
 * קבע מה-Host), המשתמש — מהטוקן שאומת. כל תקלה → אין תפקיד (נכשל לכיוון הבטוח).
 */
export async function callerRole(userId: string, tenantId: string): Promise<CallerRole> {
  try {
    const role = await rpc<string | null>("store_staff_role", { _user_id: userId }, tenantId);
    return role === "owner" ||
      role === "manager" ||
      role === "cashier" ||
      role === "warehouse" ||
      role === "agent"
      ? role
      : null;
  } catch {
    return null;
  }
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  try {
    return (await rpc<boolean>("is_platform_admin", { _user_id: userId })) === true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ הגדרות

const SETTINGS_COLUMNS =
  "mode,model,api_key_encrypted,api_key_last4,api_key_updated_at,api_key_updated_by,max_question_chars," +
  "tenant_hourly_limit,user_minute_limit,monthly_budget_usd,last_error,last_error_at,updated_at";

export type SettingsRow = {
  mode: AiMode;
  model: string;
  api_key_encrypted: string | null;
  api_key_last4: string | null;
  api_key_updated_at: string | null;
  api_key_updated_by: string | null;
  max_question_chars: number;
  tenant_hourly_limit: number;
  user_minute_limit: number;
  monthly_budget_usd: number | string;
  last_error: string | null;
  last_error_at: string | null;
  updated_at: string;
};

/** null = אין הגדרות (המיגרציה לא רצה / תקלה) — העוזר פשוט לא זמין */
export async function loadSettings(): Promise<SettingsRow | null> {
  try {
    const rows = await request<SettingsRow[]>(`ai_settings?id=eq.true&select=${SETTINGS_COLUMNS}`, {
      method: "GET",
    });
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** המפתח הגלוי — רק בתוך השרת, ורק ברגע השימוש. readable=false: יש מפתח שמור אבל אי אפשר לפענח */
export function readApiKey(row: SettingsRow | null): {
  key: string | null;
  hasKey: boolean;
  readable: boolean;
} {
  if (!row?.api_key_encrypted) return { key: null, hasKey: false, readable: false };
  const key = decryptApiKey(row.api_key_encrypted);
  return { key, hasKey: true, readable: key !== null };
}

export function modelOf(row: SettingsRow | null): AiModelId {
  return normalizeModel(row?.model);
}

/** השגיאה האחרונה מול Anthropic (או ניקויה) — כדי שמנהל העל יראה למה העוזר לא עובד */
export async function recordLastError(message: string | null): Promise<void> {
  try {
    await request(`ai_settings?id=eq.true`, {
      method: "PATCH",
      body: {
        last_error: message ? message.slice(0, 300) : null,
        last_error_at: message ? new Date().toISOString() : null,
      },
      prefer: "return=minimal",
    });
  } catch {
    // לא קריטי
  }
}

export type PackageRow = {
  code: string;
  product: string;
  name: string;
  price_agorot: number;
  guide_catalog: string;
};

/** שתי החבילות והמחיר שלהן (המחיר נשמר במסד, במקום אחד) */
export function loadPackages(): Promise<PackageRow[]> {
  return request<PackageRow[]>(
    `ai_packages?select=code,product,name,price_agorot,guide_catalog&order=product`,
    {
      method: "GET",
    },
  );
}

// ------------------------------------------------------------------ זכאות (בכל בקשה)

/** מצב החבילה של העסק היום (שעון ישראל) — מחושב במסד בלבד */
export function entitlement(tenantId: string): Promise<unknown> {
  return rpc<unknown>("ai_entitlement", { _tenant: tenantId });
}

// ------------------------------------------------------------------ יומן השימוש

export type UsageMode = "ai" | "search" | "ai_error" | "blocked" | "test";
export type UsageOutcome = "guides" | "off_topic" | "unknown" | "failed";

export type UsageEntry = {
  tenantId: string | null;
  product: string | null;
  mode: UsageMode;
  outcome: UsageOutcome;
  guides: string[];
  /** השאלה אחרי סינון מידע רגיש — רק כשאין מדריך / כשנחסמה; אחרת null */
  question: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheWriteTokens?: number | null;
  cacheReadTokens?: number | null;
  costUsd?: number | null;
  error?: string | null;
};

/** רישום "כמיטב יכולתנו": כשל ביומן לא משבש תשובה. בלי זהות השואל */
export async function logUsage(entry: UsageEntry): Promise<void> {
  try {
    await request(`ai_usage_log`, {
      method: "POST",
      prefer: "return=minimal",
      body: {
        tenant_id: entry.tenantId,
        product: entry.product,
        mode: entry.mode,
        outcome: entry.outcome,
        guides: entry.guides.slice(0, 3),
        question: entry.question ? entry.question.slice(0, 500) : null,
        model: entry.model ?? null,
        input_tokens: entry.inputTokens ?? null,
        output_tokens: entry.outputTokens ?? null,
        cache_write_tokens: entry.cacheWriteTokens ?? null,
        cache_read_tokens: entry.cacheReadTokens ?? null,
        cost_usd: entry.costUsd ?? null,
        error: entry.error ? entry.error.slice(0, 300) : null,
      },
    });
  } catch {
    // היומן אינו קריטי
  }
}

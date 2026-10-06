import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createSupabaseFetch } from "@/integrations/supabase/auth-middleware";
import { maybeCurrentTenant } from "@/integrations/supabase/tenant.server";

/**
 * חלק 26: GET /api/admin/analytics?period=month|last_month|year
 * מזדהים ב-Authorization: Bearer <JWT של המשתמש>. השאילתה רצה בהרשאות המשתמש
 * (store_analytics במסד בודק שהוא מנהל של החנות שלפי הדומיין).
 */
const PERIODS = new Set(["month", "last_month", "year"]);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function analyticsResponse(request: Request): Promise<Response> {
  const period = new URL(request.url).searchParams.get("period") ?? "month";
  if (!PERIODS.has(period)) return json(400, { error: "טווח לא מוכר (month / last_month / year)" });
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token.split(".").length !== 3) return json(401, { error: "נדרשת התחברות" });
  const tenant = maybeCurrentTenant();
  if (!tenant) return json(404, { error: "החנות לא זוהתה" });
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return json(500, { error: "השרת לא מוגדר" });
  const supabase = createClient<Database>(url, key, {
    global: {
      fetch: createSupabaseFetch(key),
      headers: { Authorization: `Bearer ${token}`, "x-tenant-id": tenant.id },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("store_analytics", { _period: period });
  if (error) {
    const forbidden = /אין הרשאה|permission denied|JWT/i.test(error.message);
    return json(forbidden ? 403 : 400, { error: error.message });
  }
  return json(200, data);
}

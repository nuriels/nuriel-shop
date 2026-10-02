import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

// header לא חוקי בכוונה: אם החנות לא זוהתה, ה-DB מחזיר current_tenant_id() = NULL
// ואין גישה לשום מידע — במקום ליפול בשקט לחנות ברירת המחדל.
const UNKNOWN_TENANT = "unknown";

type TenantGlobal = typeof globalThis & { __requestTenantId?: () => string | null };

let browserTenant: Promise<string | null> | undefined;

/**
 * מזהה החנות של האתר הנוכחי.
 * בדפדפן: נשאל פעם אחת מהמסד לפי הדומיין (tenant_for_host).
 * ב-SSR: החנות שהשרת זיהה לבקשה הנוכחית (src/server.ts).
 */
export function getTenantId(): Promise<string | null> {
  if (typeof window === "undefined") {
    return Promise.resolve((globalThis as TenantGlobal).__requestTenantId?.() ?? null);
  }
  if (!browserTenant) {
    const { url, key } = supabaseEnv();
    const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
    if (!isNewSupabaseApiKey(key)) headers["Authorization"] = `Bearer ${key}`;
    browserTenant = fetch(`${url}/rest/v1/rpc/tenant_for_host`, {
      method: "POST",
      headers,
      body: JSON.stringify({ _host: window.location.hostname }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<string | null>) : Promise.reject(res.status)))
      .catch((error: unknown) => {
        // תקלת רשת — ננסה שוב בבקשה הבאה במקום לזכור כישלון
        browserTenant = undefined;
        console.error("[Supabase] store lookup failed", error);
        return null;
      });
  }
  return browserTenant;
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    // New Supabase API keys are opaque strings, not bearer JWTs.
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    headers.set("x-tenant-id", (await getTenantId()) ?? UNKNOWN_TENANT);
    return fetch(input, { ...init, headers });
  };
}

/**
 * מפתחות, JWT וכתובת ה-API הם ASCII מודפס בלבד. תו בלתי נראה (למשל סימן
 * כיווניות RTL/LRM שנדבק בהעתקה מממשק עברי) גורם לדפדפן לזרוק
 * "Failed to construct 'Headers': String contains non ISO-8859-1 code point"
 * בכל בקשה ל-Supabase — ולכן מנקים כאן, ומדווחים בקונסול אם היה מה לנקות.
 */
export function cleanAscii(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.replace(/[^\x21-\x7E]/g, "");
  if (cleaned !== value) {
    const bad = [...value]
      .filter((c) => !/[\x21-\x7E]/.test(c))
      .map((c) => "U+" + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"));
    console.warn(`[Supabase] removed invalid characters from ${label}: ${bad.join(", ")}`);
  }
  return cleaned;
}

function supabaseEnv(): { url: string; key: string } {
  // Use import.meta.env for client-side (Vite build-time replacement)
  // Fall back to process.env for SSR (server-side rendering)
  const SUPABASE_URL = cleanAscii(
    import.meta.env["VITE_SUPABASE_URL"] || process.env["SUPABASE_URL"],
    "SUPABASE_URL",
  );
  const SUPABASE_PUBLISHABLE_KEY = cleanAscii(
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_PUBLISHABLE_KEY"],
    "SUPABASE_PUBLISHABLE_KEY",
  );

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
      ...(!SUPABASE_PUBLISHABLE_KEY ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(", ")}.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }
  return { url: SUPABASE_URL.replace(/\/$/, ""), key: SUPABASE_PUBLISHABLE_KEY };
}

function createSupabaseClient() {
  const { url, key } = supabaseEnv();
  return createClient<Database>(url, key, {
    global: {
      fetch: createSupabaseFetch(key),
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});

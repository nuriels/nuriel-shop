// Server-side Supabase clients with the service role key — they bypass RLS.
// Use them only in server functions / *.server.ts modules, never in client code.
//
//   supabaseAdmin          — scoped to the store (tenant) of the current request:
//                            every .from() query is filtered by tenant_id, every
//                            insert/upsert is stamped with it, and RPC/storage calls
//                            carry the x-tenant-id header for current_tenant_id().
//   supabaseAdminUnscoped  — platform-level access across all stores. Only for the few
//                            places that must look outside the current store (e.g.
//                            checking which store an account belongs to).
//
// Load inside server handlers: const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
// Top-level import is safe only in other .server.ts modules - route files and *.functions.ts ship to the client bundle.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { currentTenantId } from "./tenant.server";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
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
    return fetch(input, { ...init, headers });
  };
}

function createSupabaseAdminClient(tenantId: string | null) {
  const SUPABASE_URL = process.env["SUPABASE_URL"];
  const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
      ...(!SUPABASE_SERVICE_ROLE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(", ")}.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: {
      fetch: createSupabaseFetch(SUPABASE_SERVICE_ROLE_KEY),
      headers: tenantId ? { "x-tenant-id": tenantId } : {},
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

// טבלאות בלי tenant_id (רמת הפלטפורמה) — לא מסוננות
const PLATFORM_TABLES = new Set(["tenants"]);

type Row = Record<string, unknown>;

function stampTenant<T>(values: T, tenantId: string): T {
  const stamp = (row: Row): Row => {
    if (row["tenant_id"] !== undefined && row["tenant_id"] !== tenantId) {
      throw new Error("ניסיון לכתוב שורה לחנות אחרת נחסם");
    }
    return { ...row, tenant_id: tenantId };
  };
  return (Array.isArray(values) ? values.map((v) => stamp(v as Row)) : stamp(values as Row)) as T;
}

/**
 * עוטף את ה-query builder של טבלה כך שכל פעולה מוגבלת לחנות:
 * select/update/delete מקבלים .eq("tenant_id", ...), insert/upsert מקבלים tenant_id.
 */
function scopeToTenant<B extends object>(builder: B, tenantId: string): B {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      const method = value as (...args: unknown[]) => unknown;
      switch (prop) {
        case "select":
        case "update":
        case "delete":
          return (...args: unknown[]) =>
            (method.apply(target, args) as { eq: (c: string, v: string) => unknown }).eq(
              "tenant_id",
              tenantId,
            );
        case "insert":
        case "upsert":
          return (values: unknown, ...rest: unknown[]) =>
            method.call(target, stampTenant(values, tenantId), ...rest);
        default:
          return method.bind(target);
      }
    },
  });
}

let _unscoped: AdminClient | undefined;
const _byTenant = new Map<string, AdminClient>();

function clientForTenant(tenantId: string): AdminClient {
  let client = _byTenant.get(tenantId);
  if (!client) {
    client = createSupabaseAdminClient(tenantId);
    _byTenant.set(tenantId, client);
  }
  return client;
}

// Service role scoped to the current request's store — the default for server code.
export const supabaseAdmin = new Proxy({} as AdminClient, {
  get(_, prop) {
    const tenantId = currentTenantId();
    const client = clientForTenant(tenantId);
    if (prop === "from") {
      return (table: string) => {
        const builder = client.from(table as never);
        return PLATFORM_TABLES.has(table) ? builder : scopeToTenant(builder, tenantId);
      };
    }
    const value = Reflect.get(client, prop) as unknown;
    return typeof value === "function"
      ? (value as (...a: unknown[]) => unknown).bind(client)
      : value;
  },
});

// Service role across all stores. SECURITY: platform-level checks only.
export const supabaseAdminUnscoped = new Proxy({} as AdminClient, {
  get(_, prop, receiver) {
    if (!_unscoped) _unscoped = createSupabaseAdminClient(null);
    return Reflect.get(_unscoped, prop, receiver);
  },
});

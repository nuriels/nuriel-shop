// לקוח Supabase לקריאות של מנוע (צד שרת): המפתח הציבורי, ה-x-tenant-id של
// האתר, ואם יש — טוקן המשתמש. ההרשאות נאכפות במסד (RLS + פונקציות DEFINER).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publishableKey, supabaseUrl } from "./env.server";

export type ApiClient = SupabaseClient<any, string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function apiClient(opts: {
  schema: string;
  siteId: string;
  accessToken?: string | null;
}): ApiClient {
  const key = publishableKey();
  const headers: Record<string, string> = { "x-tenant-id": opts.siteId };
  if (opts.accessToken) headers["Authorization"] = `Bearer ${opts.accessToken}`;
  return createClient(supabaseUrl(), key, {
    db: { schema: opts.schema },
    global: {
      headers,
      // מפתחות sb_publishable_ אינם JWT: לא נשלחים כ-Bearer כשאין משתמש
      fetch: (input, init) => {
        const merged = new Headers(init?.headers);
        if (merged.get("Authorization") === `Bearer ${key}` && key.startsWith("sb_")) {
          merged.delete("Authorization");
        }
        merged.set("apikey", key);
        return fetch(input, { ...init, headers: merged });
      },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

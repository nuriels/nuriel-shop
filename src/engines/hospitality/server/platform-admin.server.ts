// "ניהול Hospitality" בפאנל הפלטפורמה (P1) — קריאות למסד בלי אתר, עם הטוקן של המשתמש.
// כל פונקציה במסד בודקת שהמשתמש מנהל הפלטפורמה (_require_platform_admin); כאן רק
// הלקוח הנכון ותרגום שגיאות (הודעות המסד בעברית — למשתמש; טכניות — ללוג).
import { apiClient } from "@/platform/supabase/api-client.server";
import { HOSPITALITY_SCHEMA } from "../config";
import { HospitalityError } from "./rpc.server";

const USER_FACING = /[֐-׿]/;

export async function platformSession() {
  const { requireSession } = await import("@/platform/auth/session.server");
  return requireSession();
}

export async function platformRpc<T>(
  fn: string,
  args: Record<string, unknown>,
  opts: { schema?: string } = {},
): Promise<T> {
  const session = await platformSession();
  const client = apiClient({
    schema: opts.schema ?? HOSPITALITY_SCHEMA,
    siteId: null,
    accessToken: session.accessToken,
  });
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    const userFacing = USER_FACING.test(error.message ?? "");
    if (!userFacing)
      console.error(`[hospitality/platform] ${fn} failed`, error.code, error.message);
    throw new HospitalityError(
      userFacing ? error.message : "הפעולה נכשלה — נסו שוב",
      error.code ?? null,
    );
  }
  return data as T;
}

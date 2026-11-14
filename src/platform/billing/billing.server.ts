// Billing & Agreements (מיגרציה 189) — צד שרת. כל קריאה רצה עם הטוקן של המשתמש עצמו, וההרשאה נבדקת
// במסד בכל פונקציה: בעל העסק (העסק של הכתובת בלבד) או מנהל הפלטפורמה. כאן רק: הלקוח הנכון (עם האתר או
// בלי), בדיקה שקריאה של מנהל הפלטפורמה מגיעה מכתובת הפאנל, תרגום שגיאות, וניקוי המטמון אחרי שינוי מנוי.
import { sessionFromRequest } from "../auth/session.server";
import { apiClient } from "../supabase/api-client.server";
import { currentSite, invalidateSiteCache, isPlatformHost } from "../tenancy/current-site.server";

export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingError";
  }
}

// הודעות המסד (RAISE … בעברית) מיועדות למשתמש; שגיאות טכניות לא נחשפות
const USER_FACING = /[֐-׿]/;
export const GENERIC_ERROR = "הפעולה נכשלה — נסו שוב";

async function session(): Promise<{ userId: string; accessToken: string }> {
  let s: { userId: string; accessToken: string } | null = null;
  try {
    s = await sessionFromRequest();
  } catch {
    s = null;
  }
  if (!s) throw new BillingError("נדרשת התחברות");
  return s;
}

async function rpc<T>(
  fn: string,
  args: Record<string, unknown>,
  opts: { siteId: string | null; accessToken: string },
): Promise<T> {
  const client = apiClient({ schema: "public", siteId: opts.siteId, accessToken: opts.accessToken });
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    const userFacing = USER_FACING.test(error.message ?? "");
    if (!userFacing) console.error(`[billing] ${fn} failed`, error.code, error.message);
    throw new BillingError(userFacing ? error.message : GENERIC_ERROR);
  }
  return data as T;
}

/** בעל העסק — העסק של הכתובת (x-tenant-id), והמסד בודק שהמשתמש הבעלים שלו */
export async function ownerRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const s = await session();
  const site = await currentSite();
  if (!site) throw new BillingError("העסק לא זוהה");
  return rpc<T>(fn, args, { siteId: site.id, accessToken: s.accessToken });
}

/** מנהל הפלטפורמה — רק מכתובת הפאנל, בלי אתר; המסד בודק is_platform_admin */
export async function platformRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!(await isPlatformHost())) throw new BillingError("רק מפאנל הפלטפורמה");
  const s = await session();
  return rpc<T>(fn, args, { siteId: null, accessToken: s.accessToken });
}

/** אחרי החלפת חבילה / חידוש: הנעילה והמגבלות חלות מיד (לא אחרי 15 שניות של מטמון) */
export async function refreshSite(tenantId: string): Promise<void> {
  try {
    await invalidateSiteCache(tenantId);
  } catch (error) {
    console.error("[billing] cache refresh failed", error);
  }
}

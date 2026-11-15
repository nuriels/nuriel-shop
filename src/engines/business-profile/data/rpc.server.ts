// קריאה לפונקציות המסד של המנוע (public.bp_* / public.platform_bp_*, מיגרציה 193). הלוגיקה וההרשאות
// כולן במסד; כאן רק הלקוח הנכון (אנונימי / משתמש), ה-x-tenant-id של האתר ותרגום שגיאות.
import { apiClient } from "@/platform/supabase/api-client.server";
import { currentSite } from "@/platform/tenancy/current-site.server";

export class BusinessProfileError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "BusinessProfileError";
  }
}

// הודעות המסד (RAISE … בעברית) מיועדות למשתמש; שגיאות טכניות לא נחשפות
const USER_FACING = /[֐-׿]/;

export async function businessSiteId(): Promise<string> {
  const site = await currentSite();
  if (!site || site.siteType !== "business_profile") {
    throw new BusinessProfileError("האתר לא נמצא", "P0002");
  }
  return site.id;
}

async function run<T>(
  fn: string,
  args: Record<string, unknown>,
  siteId: string | null,
  accessToken: string | null,
): Promise<T> {
  const client = apiClient({ schema: "public", siteId, accessToken });
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    const userFacing = USER_FACING.test(error.message ?? "");
    if (!userFacing) console.error(`[business-profile] ${fn} failed`, error.code, error.message);
    throw new BusinessProfileError(
      userFacing ? error.message : "הפעולה נכשלה — נסו שוב",
      error.code ?? null,
    );
  }
  return data as T;
}

/** קריאה באתר של הבקשה (אנונימי, או עם הטוקן של המשתמש) */
export async function siteRpc<T>(
  fn: string,
  args: Record<string, unknown>,
  opts: { accessToken?: string | null; siteId?: string } = {},
): Promise<T> {
  return run<T>(fn, args, opts.siteId ?? (await businessSiteId()), opts.accessToken ?? null);
}

/** ממשק הניהול: חובה משתמש מחובר; המסד בודק שהוא בעל העסק / מנהל באתר הזה */
export async function studioRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { requireSession } = await import("@/platform/auth/session.server");
  const session = await requireSession();
  return siteRpc<T>(fn, args, { accessToken: session.accessToken });
}

/** פאנל הפלטפורמה: בלי אתר, עם הטוקן של המשתמש; המסד בודק מנהל-על בכל פונקציה */
export async function platformRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { requireSession } = await import("@/platform/auth/session.server");
  const session = await requireSession();
  return run<T>(fn, args, null, session.accessToken);
}

// קריאה לפונקציות של הסכמה hospitality (מיגרציות 3–6). הלוגיקה העסקית כולה
// במסד; כאן רק הלקוח הנכון (אנונימי / משתמש), ה-x-tenant-id של האתר, ותרגום שגיאות.
import { apiClient } from "@/platform/supabase/api-client.server";
import { currentSite } from "@/platform/tenancy/current-site.server";
import { HOSPITALITY_SCHEMA } from "../config";

export class HospitalityError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "HospitalityError";
  }
}

// הודעות המסד (RAISE … בעברית) מיועדות למשתמש; שגיאות טכניות לא נחשפות
const USER_FACING = /[֐-׿]/;

export async function hospitalitySiteId(): Promise<string> {
  const site = await currentSite();
  // המתג (engine-guard) כבר מבטיח שזה אתר אירוח; בדיקה נוספת למקרה של קריאה ישירה
  if (!site || site.siteType !== "hospitality") throw new HospitalityError("האתר לא נמצא", "P0002");
  return site.id;
}

export async function callRpc<T>(
  fn: string,
  args: Record<string, unknown>,
  opts: { accessToken?: string | null } = {},
): Promise<T> {
  const client = apiClient({
    schema: HOSPITALITY_SCHEMA,
    siteId: await hospitalitySiteId(),
    accessToken: opts.accessToken ?? null,
  });
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    const message = USER_FACING.test(error.message ?? "")
      ? error.message
      : "הפעולה נכשלה — נסו שוב";
    if (!USER_FACING.test(error.message ?? ""))
      console.error(`[hospitality] ${fn} failed`, error.code, error.message);
    throw new HospitalityError(message, error.code ?? null);
  }
  return data as T;
}

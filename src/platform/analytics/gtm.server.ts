// Google Tag Manager (מיגרציה 192) — צד שרת. האתר נקבע תמיד לפי ה-Host של הבקשה (currentSite), אף פעם
// לא לפי קלט מהדפדפן; ההרשאה (בעל העסק) נבדקת במסד בכל פונקציה.
import { sessionFromRequest } from "../auth/session.server";
import { apiClient } from "../supabase/api-client.server";
import { currentSite } from "../tenancy/current-site.server";
import { isGtmId, type MyTagManager } from "./gtm";

export class TagManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TagManagerError";
  }
}

const USER_FACING = /[֐-׿]/;

/**
 * המזהה המופעל של האתר של הבקשה — לטעינה באתר (גם לאורחים). אין אתר, פאנל הפלטפורמה, כבוי, או המסד
 * לא ענה (למשל לפני מיגרציה 192) — null, והאתר עובד כרגיל בלי GTM.
 */
export async function siteTagManager(): Promise<string | null> {
  try {
    const site = await currentSite();
    if (!site) return null;
    const { data, error } = await apiClient({ schema: "public", siteId: site.id }).rpc(
      "site_tag_manager",
    );
    if (error) return null;
    return isGtmId(data) ? data : null;
  } catch {
    return null;
  }
}

async function ownerRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let s: { userId: string; accessToken: string } | null = null;
  try {
    s = await sessionFromRequest();
  } catch {
    s = null;
  }
  if (!s) throw new TagManagerError("נדרשת התחברות");
  const site = await currentSite();
  if (!site) throw new TagManagerError("העסק לא זוהה");
  const { data, error } = await apiClient({
    schema: "public",
    siteId: site.id,
    accessToken: s.accessToken,
  }).rpc(fn, args);
  if (error) {
    const userFacing = USER_FACING.test(error.message ?? "");
    if (!userFacing) console.error(`[gtm] ${fn} failed`, error.code, error.message);
    throw new TagManagerError(userFacing ? error.message : "הפעולה נכשלה — נסו שוב");
  }
  return data as T;
}

export function myTagManager(): Promise<MyTagManager> {
  return ownerRpc<MyTagManager>("my_tag_manager");
}

export function saveMyTagManager(
  containerId: string | null,
  enabled: boolean,
): Promise<MyTagManager> {
  return ownerRpc<MyTagManager>("save_my_tag_manager", {
    _container_id: containerId,
    _enabled: enabled,
  });
}

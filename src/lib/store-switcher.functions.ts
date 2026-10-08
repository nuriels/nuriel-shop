import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

/**
 * מחליף החנויות (חלק 18ב) — משתמש אחד, כמה חנויות.
 *
 * השיוך משתמש ↔ חנות נשמר ב-user_roles (טבלת קשר: שורה לכל חנות, עם
 * התפקיד בה). החנות הפעילה של כל בקשה נקבעת לפי הכתובת של האתר — לכל חנות
 * כתובת משלה (<slug>.nuri1.fit או דומיין פרטי), והחיבור נשמר בדפדפן לכל
 * כתובת בנפרד. לכן "מעבר חנות" = כניסה לכתובת של החנות האחרת, בלי להתחבר
 * מחדש:
 *
 *  1. listMyStores — החנויות של המשתמש המחובר (my_stores במסד: רק חנויות
 *     שבהן הוא איש צוות — admin / agent / warehouse — ולא חסום).
 *  2. switchStore  — בודק שוב במסד שהמשתמש משויך לחנות היעד, ויוצר קוד
 *     כניסה חד-פעמי (2 דקות, נשמר רק ה-hash) לכתובת שלה:
 *     https://<חנות>/admin-handoff#code=...&from=switch
 *     שם הקוד נפדה פעם אחת (handoff.functions.ts — נבדק שוב השיוך והחסימה),
 *     נפתח חיבור לאותו משתמש, והדפדפן נכנס לניהול של החנות החדשה.
 *
 * הקוד ב-fragment (#) — הדפדפן לא שולח אותו לשרת ולא ללוגים של nginx.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** תוקף הקוד: רק כדי לעבור לכתובת של החנות האחרת */
const SWITCH_TTL_MS = 2 * 60 * 1000;

export type StoreRole = "admin" | "agent" | "warehouse" | "cashier";

export type MyStore = {
  id: string;
  slug: string;
  name: string;
  role: StoreRole;
  /** מנהל שהוא גם בעל החנות (tenants.owner_email) */
  isOwner: boolean;
  status: string;
  /** הכתובת של החנות (דומיין פרטי פעיל, או <slug>.<base>) */
  url: string;
  /** החנות של האתר הנוכחי */
  isCurrent: boolean;
};

type MyStoreRow = {
  tenant_id: string;
  slug: string;
  name: string;
  role: string;
  is_owner: boolean;
  status: string;
  is_default: boolean;
  domain: string | null;
  custom_domain: string | null;
  custom_domain_status: string | null;
  is_current: boolean;
};

const ROLES: readonly StoreRole[] = ["admin", "agent", "warehouse", "cashier"];

async function loadMyStores(supabase: SupabaseClient<Database>): Promise<MyStore[]> {
  const { originForTenant } = await import("@/integrations/supabase/tenant.server");
  const { data, error } = await supabase.rpc("my_stores");
  if (error) {
    console.error("[store-switcher] my_stores failed", error.message);
    throw new Error("טעינת החנויות נכשלה. נסו שוב בעוד רגע.");
  }
  const rows: MyStoreRow[] = data ?? [];
  return rows
    .filter((row) => (ROLES as readonly string[]).includes(row.role))
    .map((row) => {
      let url = "";
      try {
        url = originForTenant({
          slug: row.slug,
          domain: row.domain,
          is_default: row.is_default,
          custom_domain: row.custom_domain,
          custom_domain_status: row.custom_domain_status,
        });
      } catch {
        url = "";
      }
      return {
        id: row.tenant_id,
        slug: row.slug,
        name: row.name || row.slug,
        role: row.role as StoreRole,
        isOwner: row.is_owner === true,
        status: row.status,
        url,
        isCurrent: row.is_current === true,
      };
    });
}

/** כל החנויות שהמשתמש המחובר משויך אליהן כאיש צוות (הנוכחית ראשונה) */
export const listMyStores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyStore[]> => {
    return loadMyStores(context.supabase);
  });

/** מעבר לחנות אחרת של המשתמש: קוד כניסה חד-פעמי לכתובת שלה */
export const switchStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string }) => {
    const tenantId = String(input?.tenantId ?? "")
      .trim()
      .toLowerCase();
    if (!UUID.test(tenantId)) throw new Error("חנות לא תקינה");
    return { tenantId };
  })
  .handler(async ({ data, context }): Promise<{ url: string; name: string }> => {
    const { allowAction } = await import("@/lib/rate-limit.server");
    if (!allowAction(`store-switch:${context.userId}`, 30, 10 * 60 * 1000)) {
      throw new Error("יותר מדי מעברים בין חנויות בזמן קצר. נסו שוב בעוד כמה דקות.");
    }

    // ההרשאה נבדקת במסד, עם החיבור של המשתמש עצמו (auth.uid())
    const stores = await loadMyStores(context.supabase);
    const target = stores.find((store) => store.id === data.tenantId);
    if (!target) throw new Error("אין לכם הרשאה לנהל את החנות הזו");
    if (target.isCurrent) throw new Error("אתם כבר בחנות הזו");
    if (!target.url) throw new Error("לחנות הזו עוד אין כתובת פעילה");

    const { randomBytes, createHash } = await import("node:crypto");
    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");

    // ניקוי קודים ישנים (נוצלו / פג תוקפם לפני יותר משעה)
    await supabaseAdminUnscoped
      .from("platform_admin_handoffs")
      .delete()
      .lt("expires_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());

    const code = randomBytes(32).toString("base64url");
    const { error } = await supabaseAdminUnscoped.from("platform_admin_handoffs").insert({
      token_hash: createHash("sha256").update(code).digest("hex"),
      user_id: context.userId,
      tenant_id: target.id,
      expires_at: new Date(Date.now() + SWITCH_TTL_MS).toISOString(),
      kind: "store_switch",
    });
    if (error) {
      console.error("[store-switcher] handoff insert failed", error.message);
      throw new Error("המעבר לחנות נכשל. נסו שוב.");
    }
    console.info(
      "[store-switcher]",
      JSON.stringify({ user: context.userId, to: target.slug, role: target.role }),
    );
    return { url: `${target.url}/admin-handoff#code=${code}&from=switch`, name: target.name };
  });

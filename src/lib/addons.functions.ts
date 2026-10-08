import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  isAddonName,
  parseAddonOffer,
  parsePlatformAddons,
  parseAddonPurchase,
  parseAddonsStore,
  type AddonOffer,
  type AddonPurchase,
  type AddonsStore,
} from "@/lib/addons";
import type { AddonName } from "@/lib/subscription";

/**
 * חנות התוספים (חלק 15) — פונקציות השרת.
 *
 * כל פעולה רצה עם החיבור של המשתמש עצמו (requireSupabaseAuth), וההרשאות
 * והמחיר נקבעים במסד: addons_store / addon_quote / addon_purchase למנהל
 * החנות, platform_* למנהל-על בלבד. הדפדפן לא שולח סכום לחיוב — רק את
 * הסכום שהוצג לו, כדי שהרכישה תיעצר אם המחיר השתנה בינתיים.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOf(value: unknown, message: string): string {
  const id = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!UUID.test(id)) throw new Error(message);
  return id;
}

function addonOf(value: unknown): AddonName {
  const name = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!isAddonName(name)) throw new Error("תוסף לא מוכר");
  return name;
}

/** חנות התוספים: מצב המנוי + כל התוספים עם הצעת מחיר לחנות הזו */
export const getAddonsStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AddonsStore> => {
    const { data, error } = await context.supabase.rpc("addons_store");
    if (error) throw new Error(error.message);
    return parseAddonsStore(data);
  });

/**
 * חישוב עלות תוסף (Proration): בחבילה הבסיסית — מחיר חודשי × 12 / 365 ×
 * הימים שנותרו עד current_period_end של המנוי הראשי, כך שהתוסף מתחדש יחד
 * איתו. בפרימיום — "כלול בחבילה שלך". החישוב עצמו במסד (addon_quote_for).
 */
export const quoteAddon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { addon: string }) => ({ addon: addonOf(input?.addon) }))
  .handler(async ({ data, context }): Promise<AddonOffer> => {
    const { data: raw, error } = await context.supabase.rpc("addon_quote", { _addon: data.addon });
    if (error) throw new Error(error.message);
    const offer = parseAddonOffer(raw);
    if (!offer) throw new Error("תשובה לא צפויה מהשרת");
    return offer;
  });

/** רכישת תוסף — הפיצ'ר נפתח מיד; החיוב נרשם כ"ממתין לתשלום" */
export const purchaseAddon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { addon: string; expectedAmount: number }) => {
    const expected = Math.round(Number(input?.expectedAmount) * 100) / 100;
    if (!Number.isFinite(expected) || expected < 0 || expected > 1_000_000) {
      throw new Error("סכום לא תקין");
    }
    return { addon: addonOf(input?.addon), expectedAmount: expected };
  })
  .handler(async ({ data, context }): Promise<AddonPurchase> => {
    // חלק 33: רכישת תוספים — בעל החנות בלבד (גם המסד אוכף)
    const { requireStaffPermission } = await import("@/lib/caller.server");
    await requireStaffPermission(
      context.userId,
      "billing.manage",
      "רק בעל החנות יכול לרכוש תוספים או לשנות את החבילה",
    );
    const { data: raw, error } = await context.supabase.rpc("addon_purchase", {
      _addon: data.addon,
      _expected: data.expectedAmount,
    });
    if (error) throw new Error(error.message);
    const purchase = parseAddonPurchase(raw);

    const { currentTenantId, invalidateTenantCache } =
      await import("@/integrations/supabase/tenant.server");
    const tenantId = currentTenantId();
    // הפיצ'ר נפתח מיד — גם במסכים שקוראים את המנוי מהמטמון של השרת
    invalidateTenantCache(tenantId);

    const email = typeof context.claims["email"] === "string" ? context.claims["email"] : null;
    const { notifyPlatformOfAddonPurchase } = await import("@/lib/addons.server");
    await notifyPlatformOfAddonPurchase({ tenantId, purchase, buyerEmail: email });
    return purchase;
  });

// ------------------------------------------------------------
// מנהל הפלטפורמה
// ------------------------------------------------------------

/** הפעלת תוסף לחנות בלי רכישה (מתנה / תשלום שנגבה בטלפון) */
export const platformGrantAddon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string; addon: string }) => ({
    tenantId: uuidOf(input?.tenantId, "חנות לא תקינה"),
    addon: addonOf(input?.addon),
  }))
  .handler(async ({ data, context }) => {
    const { data: raw, error } = await context.supabase.rpc("platform_grant_addon", {
      _tenant: data.tenantId,
      _addon: data.addon,
    });
    if (error) throw new Error(error.message);
    const { invalidateTenantCache } = await import("@/integrations/supabase/tenant.server");
    invalidateTenantCache(data.tenantId);
    return parsePlatformAddons(raw);
  });

/** ביטול תוסף — הפיצ'ר נסגר מיד */
export const platformCancelAddon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string; addonId: string }) => ({
    tenantId: uuidOf(input?.tenantId, "חנות לא תקינה"),
    addonId: uuidOf(input?.addonId, "תוסף לא תקין"),
  }))
  .handler(async ({ data, context }) => {
    const { data: raw, error } = await context.supabase.rpc("platform_cancel_addon", {
      _id: data.addonId,
    });
    if (error) throw new Error(error.message);
    const { invalidateTenantCache } = await import("@/integrations/supabase/tenant.server");
    invalidateTenantCache(data.tenantId);
    return parsePlatformAddons(raw);
  });

/** חיוב "ממתין לתשלום" → שולם (עם אסמכתא אופציונלית) */
export const platformMarkBillingPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { billingId: string; reference?: string }) => ({
    billingId: uuidOf(input?.billingId, "חיוב לא תקין"),
    reference: String(input?.reference ?? "")
      .trim()
      .slice(0, 120),
  }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("platform_mark_billing_paid", {
      _id: data.billingId,
      _reference: data.reference || null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

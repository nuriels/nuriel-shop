/**
 * חלק 43: פרטי המסוף של Grow לחנות — מנהל הפלטפורמה בלבד (תיק הלקוח, לשונית "סליקה").
 *
 * הפרטים נכתבים ולא נקראים: אחרי השמירה הם מוצפנים (AES-256-GCM) ולעולם לא חוזרים
 * לדפדפן — רק "מוגדר / לא מוגדר". החלפה = הקלדה מחדש. כל שינוי נרשם ביומן הפעולות
 * (בלי הערכים). הפעלה לחנות נעשית כאן בלבד; עד אז הסליקה לא מופיעה בקופה.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type GrowSettings = {
  configured: boolean;
  enabled: boolean;
  sandbox: boolean;
  hasApiKey: boolean;
  maxPayments: number;
  transactionTypes: number[];
  updatedAt: string | null;
};

const ALLOWED_TYPES = [1, 6, 13, 14];

function tenantIdOf(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("מזהה חנות לא תקין");
  }
  return id.toLowerCase();
}

type AuthContext = {
  supabase: { rpc: (fn: "is_platform_admin", args: Record<string, never>) => PromiseLike<unknown> };
};

async function assertPlatformAdmin(context: unknown): Promise<void> {
  const result = (await (context as AuthContext).supabase.rpc("is_platform_admin", {})) as {
    data: unknown;
    error: { message: string } | null;
  };
  if (result.error) throw new Error(result.error.message);
  if (result.data !== true) throw new Error("אין הרשאה");
}

/** מזהה / קוד / מפתח: ללא רווחים ותווים מוזרים (מועתק מוואטסאפ עלול להביא כאלה) */
function secretField(value: unknown, label: string, required: boolean): string | null {
  const text = String(value ?? "").trim();
  if (text === "") {
    if (required) throw new Error(`נא להזין ${label}`);
    return null;
  }
  if (!/^[A-Za-z0-9_\-.]{4,120}$/.test(text)) {
    throw new Error(`${label}: רק אותיות באנגלית, ספרות ו- _ - . (בלי רווחים)`);
  }
  return text;
}

export const getGrowSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string }) => ({ tenantId: tenantIdOf(input?.tenantId) }))
  .handler(async ({ data, context }): Promise<GrowSettings> => {
    await assertPlatformAdmin(context);
    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
    // רק עמודות שאינן סודיות — הערכים המוצפנים לא נבחרים בכלל
    const { data: row } = await supabaseAdminUnscoped
      .from("tenant_grow_credentials")
      .select("api_key_enc, sandbox, enabled, max_payments, transaction_types, updated_at")
      .eq("tenant_id", data.tenantId)
      .maybeSingle();
    return {
      configured: Boolean(row),
      enabled: row?.enabled ?? false,
      sandbox: row?.sandbox ?? false,
      hasApiKey: Boolean(row?.api_key_enc),
      maxPayments: row?.max_payments ?? 1,
      transactionTypes: row?.transaction_types ?? [],
      updatedAt: row?.updated_at ?? null,
    };
  });

export type SaveGrowInput = {
  tenantId: string;
  /** ריק = להשאיר את הקיים (כשכבר הוגדר) */
  userId: string;
  pageCode: string;
  apiKey: string;
  clearApiKey?: boolean;
  sandbox: boolean;
  enabled: boolean;
  maxPayments: number;
  transactionTypes: number[];
};

export const saveGrowSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SaveGrowInput) => {
    const maxPayments = Math.floor(Number(input?.maxPayments));
    if (!Number.isFinite(maxPayments) || maxPayments < 1 || maxPayments > 12) {
      throw new Error("מספר התשלומים: 1 עד 12");
    }
    const types = Array.isArray(input?.transactionTypes)
      ? [...new Set(input.transactionTypes.map(Number))].filter((t) => ALLOWED_TYPES.includes(t))
      : [];
    return {
      tenantId: tenantIdOf(input?.tenantId),
      userId: secretField(input?.userId, "userId", false),
      pageCode: secretField(input?.pageCode, "pageCode", false),
      apiKey: secretField(input?.apiKey, "apiKey", false),
      clearApiKey: input?.clearApiKey === true,
      sandbox: input?.sandbox === true,
      enabled: input?.enabled === true,
      maxPayments,
      transactionTypes: types,
    };
  })
  .handler(async ({ data, context }): Promise<GrowSettings> => {
    await assertPlatformAdmin(context);
    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
    const { encryptSecret } = await import("@/lib/grow-crypto.server");
    const { recordPlatformAudit, actorOf } = await import("@/lib/platform-files.server");
    const actor = actorOf(context);

    const { data: existing } = await supabaseAdminUnscoped
      .from("tenant_grow_credentials")
      .select("tenant_id, enabled, sandbox")
      .eq("tenant_id", data.tenantId)
      .maybeSingle();
    if (!existing && (!data.userId || !data.pageCode)) {
      throw new Error("בהגדרה ראשונה חובה להזין userId ו-pageCode");
    }
    if (data.enabled && !existing && (!data.userId || !data.pageCode)) {
      throw new Error("אי אפשר להפעיל לפני שמוגדרים פרטי המסוף");
    }

    const row: Record<string, unknown> = {
      tenant_id: data.tenantId,
      sandbox: data.sandbox,
      enabled: data.enabled,
      max_payments: data.maxPayments,
      transaction_types: data.transactionTypes.length > 0 ? data.transactionTypes : null,
      updated_at: new Date().toISOString(),
      updated_by: actor.id,
    };
    if (data.userId) row["user_id_enc"] = encryptSecret(data.userId);
    if (data.pageCode) row["page_code_enc"] = encryptSecret(data.pageCode);
    if (data.apiKey) row["api_key_enc"] = encryptSecret(data.apiKey);
    else if (data.clearApiKey) row["api_key_enc"] = null;

    const { error } = await supabaseAdminUnscoped
      .from("tenant_grow_credentials")
      .upsert(row as never, { onConflict: "tenant_id" });
    if (error) throw new Error("השמירה נכשלה");

    await recordPlatformAudit({
      tenantId: data.tenantId,
      actor,
      action: !existing
        ? "grow_credentials_saved"
        : data.userId || data.pageCode || data.apiKey || data.clearApiKey
          ? "grow_credentials_replaced"
          : "grow_settings_changed",
      details: {
        enabled: data.enabled,
        sandbox: data.sandbox,
        maxPayments: data.maxPayments,
        types: data.transactionTypes.join(","),
      },
    });
    if (existing && existing.enabled !== data.enabled) {
      await recordPlatformAudit({
        tenantId: data.tenantId,
        actor,
        action: data.enabled ? "grow_enabled" : "grow_disabled",
      });
    }
    const { invalidateTenantCache } = await import("@/integrations/supabase/tenant.server");
    invalidateTenantCache(data.tenantId);
    const { data: fresh } = await supabaseAdminUnscoped
      .from("tenant_grow_credentials")
      .select("api_key_enc, sandbox, enabled, max_payments, transaction_types, updated_at")
      .eq("tenant_id", data.tenantId)
      .maybeSingle();
    return {
      configured: true,
      enabled: fresh?.enabled ?? false,
      sandbox: fresh?.sandbox ?? false,
      hasApiKey: Boolean(fresh?.api_key_enc),
      maxPayments: fresh?.max_payments ?? 1,
      transactionTypes: fresh?.transaction_types ?? [],
      updatedAt: fresh?.updated_at ?? null,
    };
  });

/**
 * בדיקת חיבור: פותח תהליך תשלום בסכום ₪1 ומוודא ש-Grow מחזירה כתובת תשלום.
 * שום חיוב לא מתבצע (הכתובת פגה אחרי 10 דקות ולא נשמרת ולא נפתחת).
 */
export const testGrowConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string }) => ({ tenantId: tenantIdOf(input?.tenantId) }))
  .handler(async ({ data, context }): Promise<{ ok: boolean; message: string }> => {
    await assertPlatformAdmin(context);
    const { loadGrowCredentials, createGrowPaymentProcess } = await import("@/lib/grow.server");
    const { recordPlatformAudit, actorOf, portalOrigin } =
      await import("@/lib/platform-files.server");
    let ok = false;
    let message = "";
    try {
      const creds = await loadGrowCredentials(data.tenantId);
      if (!creds) throw new Error("פרטי המסוף עוד לא הוגדרו");
      const origin = portalOrigin();
      await createGrowPaymentProcess({
        creds,
        sum: 1,
        description: "בדיקת חיבור",
        fullName: "בדיקת מערכת",
        phone: "0500000000",
        email: null,
        successUrl: `${origin}/`,
        cancelUrl: `${origin}/`,
        notifyUrl: `${origin}/api/webhooks/grow`,
        orderId: "00000000-0000-0000-0000-000000000000",
        maxPayments: 1,
      });
      ok = true;
      message = "החיבור ל-Grow תקין — נפתח דף תשלום לבדיקה (ללא חיוב).";
    } catch (error) {
      message = error instanceof Error ? error.message : "הבדיקה נכשלה";
    }
    await recordPlatformAudit({
      tenantId: data.tenantId,
      actor: actorOf(context),
      action: "grow_connection_tested",
      details: { ok },
    });
    return { ok, message };
  });

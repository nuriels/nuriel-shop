// NURIEL AI ASSISTANT — "ניהול תוסף AI" בפאנל מנהל העל (/platform/ai). עטיפה דקה בלבד: ההרשאה (כתובת
// הפאנל + מנהל פלטפורמה, לפי המסד) נבדקת ראשונה בכל פונקציה, ושוב במסד (is_platform_admin) — ראו
// src/platform/ai/admin.server.ts. מפתח ה-API לא חוזר מכאן לעולם (רק 4 תווים אחרונים).
//  - safeErrors (ראשון): כל שגיאה חוזרת כהודעה קבועה, בלי stack trace.
import { createServerFn } from "@tanstack/react-start";
import { safeErrors } from "@/platform/ai/ai-middleware";
import type {
  AdminBusiness,
  AiAdminOverview,
  ConnectionTestResult,
  JsonObject,
  RenewalRun,
} from "@/platform/ai/types";

type ListInput = { product?: "ecommerce" | "hospitality" | null; search?: string };
type TenantInput = { tenantId: string };
type ActivateInput = {
  tenantId: string;
  product: "ecommerce" | "hospitality";
  startsOn: string;
  note?: string;
};
/** expectedLastEnd — סוף התקופה האחרונה כפי שהמסך הציג (last_ends_on); השתנה בינתיים → החידוש נעצר */
type RenewInput = { tenantId: string; expectedLastEnd: string; note?: string };
type SuspendInput = { tenantId: string; suspended: boolean; reason?: string };
type SaveInput = {
  apiKey?: string;
  removeKey?: boolean;
  mode?: "off" | "test" | "on";
  model?: string;
  maxQuestionChars?: number;
  tenantHourlyLimit?: number;
  userMinuteLimit?: number;
  monthlyBudgetUsd?: number;
};

const admin = () => import("@/platform/ai/admin.server");

export const aiAdminOverview = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .handler(async (): Promise<AiAdminOverview> => (await admin()).handleOverview());

export const aiAdminBusinesses = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .inputValidator((input: ListInput) => input)
  .handler(async ({ data }): Promise<AdminBusiness[]> => (await admin()).handleList(data));

export const aiAdminHistory = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .inputValidator((input: TenantInput) => input)
  .handler(async ({ data }): Promise<JsonObject> => (await admin()).handleHistory(data));

export const aiAdminActivate = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .inputValidator((input: ActivateInput) => input)
  .handler(async ({ data }): Promise<JsonObject> => (await admin()).handleActivate(data));

export const aiAdminRenew = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .inputValidator((input: RenewInput) => input)
  .handler(async ({ data }): Promise<JsonObject> => (await admin()).handleRenew(data));

export const aiAdminSetSuspended = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .inputValidator((input: SuspendInput) => input)
  .handler(async ({ data }): Promise<JsonObject> => (await admin()).handleSetSuspended(data));

export const aiAdminSaveSettings = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .inputValidator((input: SaveInput) => input)
  .handler(async ({ data }): Promise<{ ok: true }> => (await admin()).handleSaveSettings(data));

/** בדיקת חיבור: שאלה ידועה מקטלוג Ecommerce — מוודאת מפתח, דגם וסיווג */
export const aiAdminTestConnection = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .handler(async (): Promise<ConnectionTestResult> => {
    const [{ handleTestConnection }, { ECOMMERCE_GUIDE_CATALOG }] = await Promise.all([
      admin(),
      import("@/lib/ai/ecommerce-guides"),
    ]);
    return handleTestConnection(ECOMMERCE_GUIDE_CATALOG);
  });

/** הרצה מיידית של בדיקת התראות החידוש (בנוסף לריצה האוטומטית כל שעה) */
export const aiAdminRunRenewals = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .handler(async (): Promise<RenewalRun> => {
    const [{ requirePlatformAdmin }, { runRenewalNotices }] = await Promise.all([
      admin(),
      import("@/platform/ai/renewals.server"),
    ]);
    await requirePlatformAdmin();
    return runRenewalNotices();
  });

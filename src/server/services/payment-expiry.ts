/**
 * הזמנות שלא שולמו בזמן (חלק 17ב — ביט): הזמנת ביט נשמרת "ממתינה לתשלום"
 * ל-24 שעות. לא נשלחה אסמכתא בזמן → expire_unpaid_orders מבטלת אותה והמלאי
 * חוזר. השרת בודק כל 5 דקות (נטען מ-src/server.ts, לפני TanStack — לכן בלי
 * תלות ב-@tanstack/react-start).
 *
 * חלק 28: עבר לכאן מ-services/payments.ts (סליקת Hyp), שנמחק.
 */

import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";
import { paymentsStartupLine } from "@/platform/payments/server/env";
import { alertIfJobsOff, type TenantJobResult } from "@/platform/payments/server/tenant/jobs";

let expiryTimer: ReturnType<typeof setInterval> | null = null;
let startupLineLogged = false;

export async function expireUnpaidOrders(): Promise<number> {
  const { data, error } = await supabaseAdminUnscoped.rpc("expire_unpaid_orders");
  if (error) {
    console.error("[payments] expire failed", error.message);
    return 0;
  }
  const count = Number(data ?? 0);
  if (count > 0) console.log(`[payments] ${count} unpaid order(s) expired`);
  return count;
}

/**
 * MAX/Hyp DEMO (צד החנות, contract §7.1 X-19): קודם ביטול ההזמנות שלא שולמו — תמיד, ובלי לחכות לעבודות התשלום
 * המקוון (ביט / Grow לא מחכים מאחורי VERIFY). זה בטוח: המסד מחזיק הזמנה שחזרה מדף התשלום (X-14), כך שהביטול לא
 * נוגע בה. אחר כך עבודות התשלום המקוון: VERIFY חוזר (רק כשהתשלומים מוכנים), פקיעה וחניה, מחיקת החזרות גולמיות,
 * ותביעת ההתראות לבדיקה (X-17). PAYMENTS_JOBS=off עוצר רק את עבודות התשלום המקוון. המיילים — להזמנות שהמחזור
 * הזה סגר; הפעמון + המייל לחנות — לכל בדיקה שנתבעה.
 */
export async function paymentsTick(): Promise<void> {
  await expireUnpaidOrders();
  try {
    const { runTenantPaymentJobs } = await import("@/platform/payments/server/tenant/jobs");
    const outcomes: TenantJobResult = await runTenantPaymentJobs();
    if (outcomes.paid.length > 0 || outcomes.review.length > 0) {
      const { actOnTenantOutcomes } = await import("@/lib/online-payments.server");
      await actOnTenantOutcomes(outcomes);
    }
  } catch {
    console.error("[payments] online-payment jobs failed");
  }
}

/** פעם ב-5 דקות: ביטול הזמנות ביט שלא שולמו תוך 24 שעות (המלאי חוזר) + עבודות התשלום המקוון */
export function startPaymentExpiryJob(): void {
  // MAX/Hyp DEMO (contract §7 X-6): שורה אחת בעליית השרת — מילים קבועות בלבד (סביבה, סוג הכתובת, מוכנות כל צד),
  // אף פעם לא ערך. נרשמת פעם אחת, גם כש-PAYMENTS_JOBS=off עוצר את עבודות התשלום
  if (!startupLineLogged) {
    startupLineLogged = true;
    console.log(paymentsStartupLine());
    // X-25: a separate line (the startup line's format is parsed by deploy/demo/demo-check.sh)
    alertIfJobsOff();
  }
  if (expiryTimer || process.env["NODE_ENV"] === "test") return;
  expiryTimer = setInterval(() => void paymentsTick(), 5 * 60 * 1000);
  expiryTimer.unref?.();
}

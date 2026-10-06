/**
 * הזמנות שלא שולמו בזמן (חלק 17ב — ביט): הזמנת ביט נשמרת "ממתינה לתשלום"
 * ל-24 שעות. לא נשלחה אסמכתא בזמן → expire_unpaid_orders מבטלת אותה והמלאי
 * חוזר. השרת בודק כל 5 דקות (נטען מ-src/server.ts, לפני TanStack — לכן בלי
 * תלות ב-@tanstack/react-start).
 *
 * חלק 28: עבר לכאן מ-services/payments.ts (סליקת Hyp), שנמחק.
 */

import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";

let expiryTimer: ReturnType<typeof setInterval> | null = null;

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

/** פעם ב-5 דקות: ביטול הזמנות ביט שלא שולמו תוך 24 שעות (המלאי חוזר) */
export function startPaymentExpiryJob(): void {
  if (expiryTimer || process.env["NODE_ENV"] === "test") return;
  expiryTimer = setInterval(() => void expireUnpaidOrders(), 5 * 60 * 1000);
  expiryTimer.unref?.();
}

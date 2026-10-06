import { supabase } from "@/integrations/supabase/client";

/**
 * מנהלים לפי חבילה (חלק 24): basic = מנהל 1 (הבעלים), premium = 3, ניסיון = 3,
 * + מנהלים נוספים שנרכשו (200 ₪ לשנה, דרך "בקשת שדרוג" שמנהל הפלטפורמה מאשר).
 * המגבלה נאכפת במסד (טריגר על user_roles) — כאן רק התצוגה והבקשות.
 */
export const EXTRA_ADMIN_YEARLY_PRICE = 200;
export const PLAN_USERS_TEXT: Record<"basic" | "premium", string> = {
  basic: "משתמש 1",
  premium: "3 משתמשים",
};

export type UpgradeRequestStatus = "pending" | "payment_link_sent" | "approved";

export type StoreAdminSeats = {
  plan: string;
  plan_limit: number;
  extra: number;
  limit: number;
  used: number;
  current_period_end: string | null;
  trial_ends_at: string | null;
  request: {
    id: string;
    status: UpgradeRequestStatus;
    payment_url: string | null;
    created_at: string;
  } | null;
  extra_seats: { approved_at: string; renews_at: string }[];
};

export type PlatformUpgradeRequest = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  owner_email: string | null;
  request_type: "extra_admin";
  status: UpgradeRequestStatus;
  payment_url: string | null;
  created_at: string;
  link_sent_at: string | null;
  approved_at: string | null;
  plan: string;
  extra_admins: number;
  admins_used: number;
  admin_limit: number;
};

export function seatsFull(seats: StoreAdminSeats | null): boolean {
  return seats !== null && seats.used >= seats.limit;
}

export function planLabel(plan: string): string {
  return plan === "basic" ? "בסיסית" : plan === "premium" ? "פרימיום" : "ניסיון";
}

/** "06.10.2027" — שעון ישראל */
export function formatSeatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  });
}

export async function loadStoreAdminSeats(): Promise<StoreAdminSeats> {
  const { data, error } = await supabase.rpc("store_admin_seats");
  if (error) throw error;
  return data as unknown as StoreAdminSeats;
}

export async function loadPlatformUpgradeRequests(): Promise<PlatformUpgradeRequest[]> {
  const { data, error } = await supabase.rpc("platform_upgrade_requests");
  if (error) throw error;
  return (data ?? []) as unknown as PlatformUpgradeRequest[];
}

export async function platformSendUpgradeLink(
  requestId: string,
  paymentUrl: string,
): Promise<void> {
  const { error } = await supabase.rpc("platform_send_upgrade_link", {
    _request_id: requestId,
    _payment_url: paymentUrl,
  });
  if (error) throw error;
}

export async function platformApproveUpgrade(requestId: string): Promise<void> {
  const { error } = await supabase.rpc("platform_approve_upgrade", { _request_id: requestId });
  if (error) throw error;
}

export async function platformDeleteUpgradeRequest(requestId: string): Promise<void> {
  const { error } = await supabase.rpc("platform_delete_upgrade_request", {
    _request_id: requestId,
  });
  if (error) throw error;
}

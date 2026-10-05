import { supabase } from "@/integrations/supabase/client";
import type {
  CancellationRequest,
  CancellationStatus,
  ContactMessage,
  ContactStatus,
} from "@/lib/site-forms";

/**
 * תיבת הפניות בפאנל הניהול (חלק 16א) — קריאה ועדכון בהרשאות המנהל (RLS):
 * המנהל רואה רק את הפניות של החנות שלו, ומעדכן רק סטטוס והערה פנימית.
 */

const LIST_LIMIT = 300;

export type InboxFilter = "open" | "all";

export async function loadContactMessages(filter: InboxFilter): Promise<ContactMessage[]> {
  let query = supabase
    .from("contact_messages")
    .select(
      "id, full_name, phone, email, message, order_number, order_id, attachment_path, attachment_name, attachment_type, attachment_size, status, admin_note, handled_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (filter === "open") query = query.eq("status", "new");
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ContactMessage[];
}

export async function loadCancellationRequests(
  filter: InboxFilter,
): Promise<CancellationRequest[]> {
  let query = supabase
    .from("cancellation_requests")
    .select(
      "id, first_name, last_name, phone, email, message, order_number, order_id, order_contact_match, status, admin_note, handled_at, confirmation_sent_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (filter === "open") query = query.in("status", ["new", "in_progress"]);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as CancellationRequest[];
}

export async function updateContactMessage(
  id: string,
  patch: { status?: ContactStatus; admin_note?: string | null },
): Promise<void> {
  const { error } = await supabase.from("contact_messages").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateCancellationRequest(
  id: string,
  patch: { status?: CancellationStatus; admin_note?: string | null },
): Promise<void> {
  const { error } = await supabase.from("cancellation_requests").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export type InboxCounts = { contact: number; cancellations: number };

/** פניות חדשות + ביטולים פתוחים — למונה בתפריט הניהול */
export async function loadInboxCounts(): Promise<InboxCounts> {
  const { data } = await supabase.rpc("site_inbox_counts");
  const row = (data ?? {}) as { contact?: unknown; cancellations?: unknown };
  return {
    contact: Number(row.contact ?? 0) || 0,
    cancellations: Number(row.cancellations ?? 0) || 0,
  };
}

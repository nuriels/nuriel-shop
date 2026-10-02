import { supabase } from "@/integrations/supabase/client";

export type PickingOrder = {
  id: string;
  order_number: string;
  status: string;
  is_urgent: boolean;
  created_at: string;
  note: string | null;
  picker_id: string | null;
  picker_name: string | null;
  picking_paused: boolean;
  picking_claimed_at: string | null;
  picked_at: string | null;
  picking_approved_by: string | null;
  approved_by_name: string | null;
  customer_name: string;
  customer_address: string | null;
  customer_phone: string | null;
  contact_name: string | null;
  total_lines: number;
  picked_lines: number;
  short_lines: number;
};

export type PickingLine = {
  item_id: string;
  product_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  image_url: string | null;
  shelf_location: string | null;
  pack_size: number | null;
  quantity: number;
  picked: boolean;
  picked_qty: number | null;
  picked_at: string | null;
  /** מאיפה ללקט: [{ location, quantity }] (פנוי בכל איתור) */
  locations?: { location: string; quantity: number }[];
};

export type PickingWorker = {
  user_id: string;
  name: string;
  role: string;
  is_blocked: boolean;
  active_orders: number;
};

export type PickingStat = {
  period: "month" | "week";
  period_start: string;
  orders: number;
  lines: number;
};

export type PickingLeader = {
  user_id: string;
  name: string;
  is_blocked: boolean;
  this_month: number;
  last_month: number;
  total: number;
  in_progress: number;
  last_picked_at: string | null;
};

export type Shortage = { product_id: string; name: string; ordered: number; picked: number };

/** "48 יח׳ (2 ארגזים)" — ביחידות וגם בארגזים, כדי שהמלקט לא יטעה */
export function pickQuantityLabel(quantity: number, packSize: number | null): string {
  if (!packSize || packSize < 2) return `${quantity} יח׳`;
  const packs = quantity / packSize;
  if (!Number.isInteger(packs)) return `${quantity} יח׳ (${packSize} במארז)`;
  const packLabel = packs === 1 ? "ארגז אחד" : `${packs} ארגזים`;
  return `${quantity} יח׳ (${packLabel})`;
}

/** האיתור במחסן — "ראשי" עד שיוכנסו איתורים בספירות המלאי */
export function locationLabel(location: string | null): string {
  return location && location.trim() !== "" ? location : "ראשי";
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function fetchPickingOrders(): Promise<PickingOrder[]> {
  const { data, error } = await supabase.rpc("picking_orders");
  fail(error);
  return (data ?? []) as PickingOrder[];
}
export async function fetchPickingLines(orderId: string): Promise<PickingLine[]> {
  const { data, error } = await supabase.rpc("picking_order_lines", { _order_id: orderId });
  fail(error);
  return (data ?? []) as PickingLine[];
}
export async function fetchPickingWorkers(): Promise<PickingWorker[]> {
  const { data, error } = await supabase.rpc("picking_workers");
  fail(error);
  return (data ?? []) as PickingWorker[];
}
export async function fetchPickingStats(userId?: string): Promise<PickingStat[]> {
  const { data, error } = await supabase.rpc("picking_stats", userId ? { _user_id: userId } : {});
  fail(error);
  return (data ?? []) as PickingStat[];
}
export async function fetchPickingLeaderboard(): Promise<PickingLeader[]> {
  const { data, error } = await supabase.rpc("picking_leaderboard");
  fail(error);
  return (data ?? []) as PickingLeader[];
}
export async function claimOrder(orderId: string): Promise<void> {
  fail((await supabase.rpc("picking_claim", { _order_id: orderId })).error);
}
export async function releaseOrder(orderId: string): Promise<void> {
  fail((await supabase.rpc("picking_release", { _order_id: orderId })).error);
}
export async function transferOrder(orderId: string, toUser: string): Promise<void> {
  fail((await supabase.rpc("picking_transfer", { _order_id: orderId, _to_user: toUser })).error);
}
export async function setOrderPaused(orderId: string, paused: boolean): Promise<void> {
  fail((await supabase.rpc("picking_set_paused", { _order_id: orderId, _paused: paused })).error);
}
export async function markPickedItem(itemId: string, pickedQty: number | null): Promise<void> {
  fail(
    (await supabase.rpc("picking_mark_item", { _item_id: itemId, _picked_qty: pickedQty })).error,
  );
}
export async function setOrderUrgent(orderId: string, urgent: boolean): Promise<void> {
  fail((await supabase.rpc("set_order_urgent", { _order_id: orderId, _urgent: urgent })).error);
}
/** אישור ליקוט: מחסנאי → "picked" (לאישור מנהל); מנהל → "shipped" */
export async function approvePicking(
  orderId: string,
): Promise<{ shortages: Shortage[]; picker_id: string | null; status: "picked" | "shipped" }> {
  const { data, error } = await supabase.rpc("picking_approve", { _order_id: orderId });
  fail(error);
  const result = (data ?? {}) as {
    shortages?: Shortage[];
    picker_id?: string | null;
    status?: string;
  };
  return {
    shortages: result.shortages ?? [],
    picker_id: result.picker_id ?? null,
    status: result.status === "shipped" ? "shipped" : "picked",
  };
}
/** מנהל מאשר ליקוט שבוצע → נשלחה */
export async function managerApprovePicking(orderId: string): Promise<{ shortages: Shortage[] }> {
  const { data, error } = await supabase.rpc("picking_manager_approve", { _order_id: orderId });
  fail(error);
  return { shortages: ((data ?? {}) as { shortages?: Shortage[] }).shortages ?? [] };
}
/** מנהל מחזיר לליקוט */
export async function returnToPicking(orderId: string): Promise<void> {
  fail((await supabase.rpc("picking_return", { _order_id: orderId })).error);
}

import { supabase } from "@/integrations/supabase/client";

export const MAIN_LOCATION = "ראשי";

export type LocationQty = { location: string; quantity: number };

/** תוצאת בדיקת מלאי — בלי מחירים */
export type StockItem = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  image_url: string | null;
  category: string;
  pack_size: number | null;
  is_hidden: boolean;
  /** פנוי (כבר בלי מה ששמור להזמנות) */
  available: number;
  /** שמור להזמנות פתוחות (נחשב כאילו נמצא ב"ראשי") */
  reserved: number;
  locations: LocationQty[];
};

export type TransferSummary = {
  id: string;
  status: "draft" | "approved" | "cancelled";
  note: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  approved_by_name: string | null;
  approved_at: string | null;
  lines: number;
  units: number;
};

export type TransferLine = {
  id: string;
  product_id: string;
  name: string;
  sku: string;
  barcode: string | null;
  image_url: string | null;
  pack_size: number | null;
  from_location: string;
  to_location: string;
  quantity: number;
  /** כמה פנוי עכשיו באיתור המקור */
  available: number;
};

export type LocationSummary = { location: string; products: number; units: number };

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function lookupStock(query: string): Promise<StockItem[]> {
  const { data, error } = await supabase.rpc("stock_lookup", { _query: query });
  fail(error);
  return (data ?? []) as StockItem[];
}
export async function fetchLocations(): Promise<LocationSummary[]> {
  const { data, error } = await supabase.rpc("locations_list");
  fail(error);
  return (data ?? []) as LocationSummary[];
}
export async function createTransfer(note?: string): Promise<string> {
  const { data, error } = await supabase.rpc("transfer_create", { _note: note ?? null });
  fail(error);
  return data as string;
}
export async function saveTransferLine(input: {
  transferId: string;
  lineId: string | null;
  productId: string;
  from: string;
  to: string;
  quantity: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc("transfer_line_save", {
    _transfer_id: input.transferId,
    _line_id: input.lineId,
    _product_id: input.productId,
    _from: input.from,
    _to: input.to,
    _quantity: input.quantity,
  });
  fail(error);
  return data as string;
}
export async function deleteTransferLine(lineId: string): Promise<void> {
  fail((await supabase.rpc("transfer_line_delete", { _line_id: lineId })).error);
}
export async function cancelTransfer(transferId: string): Promise<void> {
  fail((await supabase.rpc("transfer_cancel", { _transfer_id: transferId })).error);
}
export async function approveTransfer(transferId: string): Promise<number> {
  const { data, error } = await supabase.rpc("transfer_approve", { _transfer_id: transferId });
  fail(error);
  return Number(data ?? 0);
}
export async function fetchTransfers(status: "draft" | "approved"): Promise<TransferSummary[]> {
  const { data, error } = await supabase.rpc("transfers_list", { _status: status });
  fail(error);
  return (data ?? []) as TransferSummary[];
}
export async function fetchTransferLines(transferId: string): Promise<TransferLine[]> {
  const { data, error } = await supabase.rpc("transfer_lines", { _transfer_id: transferId });
  fail(error);
  return (data ?? []) as TransferLine[];
}

/** "48 יח׳ (2 ארגזים)" כשזה מתחלק במארז */
export function unitsLabel(quantity: number, packSize: number | null): string {
  if (!packSize || packSize < 2 || quantity % packSize !== 0) return `${quantity} יח׳`;
  const packs = quantity / packSize;
  return `${quantity} יח׳ (${packs === 1 ? "ארגז אחד" : `${packs} ארגזים`})`;
}

/**
 * חלק 35: מספרים סידוריים — גישה לנתונים מהדפדפן (פונקציות במסד; ההרשאות
 * נבדקות שם: מלאי — מחסנאי / מנהל / בעלים; שיוך בהזמנה — מי שמלקט; קופה —
 * דרך admin_create_order).
 */
import { supabase } from "@/integrations/supabase/client";
import {
  normalizeSerial,
  type AssignedSerial,
  type AvailableSerial,
  type ReceiveMode,
  type ReceiveResult,
  type SerialLookupRow,
  type SerialProduct,
  type SerialUnit,
} from "@/lib/serials";

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** המוצרים שדורשים מספר סידורי, עם ספירות */
export async function loadSerialProducts(): Promise<SerialProduct[]> {
  const { data, error } = await supabase.rpc("serial_products");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    product_id: row.product_id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    warranty_months: num(row.warranty_months),
    stock_quantity: num(row.stock_quantity),
    in_stock_serials: num(row.in_stock_serials),
    sold_serials: num(row.sold_serials),
    missing_serials: num(row.missing_serials),
  }));
}

/** קליטת סחורה / רישום יחידות קיימות */
export async function receiveSerials(
  productId: string,
  serials: string[],
  mode: ReceiveMode = "receive",
): Promise<ReceiveResult> {
  const { data, error } = await supabase.rpc("product_serials_receive", {
    _product_id: productId,
    _serials: serials,
    _mode: mode,
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as Record<string, unknown>;
  return {
    added: num(result["added"]),
    stock_quantity: num(result["stock_quantity"]),
    in_stock_serials: num(result["in_stock_serials"]),
    missing_serials: num(result["missing_serials"]),
  };
}

/** היחידות של מוצר (פנויות / נמכרו / הכל) */
export async function loadSerialUnits(
  productId: string,
  status: "all" | "in_stock" | "sold" = "all",
  search = "",
): Promise<SerialUnit[]> {
  const { data, error } = await supabase.rpc("product_serials_list", {
    _product_id: productId,
    _status: status,
    _search: search,
    _limit: 500,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    ...row,
    status: row.status === "sold" ? "sold" : "in_stock",
  }));
}

/** היחידות הפנויות לשיוך (הוותיקות קודם) */
export async function loadAvailableSerials(
  productId: string,
  search = "",
): Promise<AvailableSerial[]> {
  const { data, error } = await supabase.rpc("product_serials_available", {
    _product_id: productId,
    _search: normalizeSerial(search),
    _limit: 100,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** תיקון טעות הקלדה ביחידה שבמלאי */
export async function renameSerial(serialId: string, serial: string): Promise<string> {
  const { data, error } = await supabase.rpc("product_serial_update", {
    _serial_id: serialId,
    _serial: serial,
  });
  if (error) throw new Error(error.message);
  return data ?? normalizeSerial(serial);
}

/** הסרת יחידה: writeOff = המלאי יורד ביחידה (פגומה / אבדה) */
export async function removeSerial(serialId: string, writeOff: boolean): Promise<void> {
  const { error } = await supabase.rpc("product_serial_remove", {
    _serial_id: serialId,
    _write_off: writeOff,
  });
  if (error) throw new Error(error.message);
}

/** בדיקת אחריות: חיפוש מספר סידורי בכל המוצרים */
export async function lookupSerial(serial: string): Promise<SerialLookupRow[]> {
  const { data, error } = await supabase.rpc("serial_lookup", { _serial: serial });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    ...row,
    status: row.status === "sold" ? "sold" : "in_stock",
  }));
}

/** שיוך מספר סידורי לשורה בהזמנה (סריקה / בחירה) */
export async function assignSerial(
  orderItemId: string,
  serial: string,
): Promise<{
  serial_number: string;
  assigned: number;
  required: number;
  warranty_until: string | null;
}> {
  const { data, error } = await supabase.rpc("order_item_assign_serial", {
    _order_item_id: orderItemId,
    _serial: serial,
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as Record<string, unknown>;
  return {
    serial_number: String(result["serial_number"] ?? normalizeSerial(serial)),
    assigned: num(result["assigned"]),
    required: num(result["required"]),
    warranty_until: typeof result["warranty_until"] === "string" ? result["warranty_until"] : null,
  };
}

/** הסרת שיוך (נסרק בטעות) */
export async function unassignSerial(orderItemId: string, serialId: string): Promise<void> {
  const { error } = await supabase.rpc("order_item_unassign_serial", {
    _order_item_id: orderItemId,
    _serial_id: serialId,
  });
  if (error) throw new Error(error.message);
}

/** המספרים ששויכו לשורה */
export async function loadItemSerials(orderItemId: string): Promise<AssignedSerial[]> {
  const { data, error } = await supabase.rpc("order_item_serials", {
    _order_item_id: orderItemId,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** מבין ההזמנות — אילו עוד חסר בהן מספר סידורי (מזהה הזמנה → הסבר) */
export async function loadOrdersMissingSerials(orderIds: string[]): Promise<Map<string, string>> {
  const missing = new Map<string, string>();
  if (orderIds.length === 0) return missing;
  const { data, error } = await supabase.rpc("orders_missing_serials", { _order_ids: orderIds });
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    missing.set(
      row.order_id,
      `חסר מספר סידורי: "${row.product_name ?? "מוצר"}" (${num(row.assigned)} מתוך ${num(row.required)})`,
    );
  }
  return missing;
}

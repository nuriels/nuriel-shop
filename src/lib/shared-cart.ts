/**
 * חלק 39: שיתוף עגלה בקישור (/cart/{code}).
 * נשמרים רק מזהי מוצרים / וריאציות וכמויות — המחיר מחושב לפי מי שפותח.
 */
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { CartItem } from "@/lib/orders";

export type SharedCartLine = { productId: string; variantId: string | null; quantity: number };

/** חלק 39ב: עגלה ששותפה (cart) או הצעת מחיר מהחנות (quote) */
export type SharedCart = {
  kind: "cart" | "quote";
  lines: SharedCartLine[];
  customerName: string | null;
  note: string | null;
  expiresAt: string | null;
};

type QuoteLine = { productId: string; variantId: string | null; quantity: number };

/** חלק 39ב: הצעת מחיר מהקופה (צוות בלבד) → קוד קישור */
export async function createQuote(input: {
  lines: QuoteLine[];
  customerName: string;
  note: string;
  validDays: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_quote", {
    _items: linesPayload(input.lines),
    _customer_name: input.customerName,
    _note: input.note,
    _valid_days: input.validDays,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

function linesPayload(lines: QuoteLine[]) {
  return lines
    .filter((line) => line.quantity > 0)
    .map((line) => ({
      product_id: line.productId,
      ...(line.variantId ? { variant_id: line.variantId } : {}),
      quantity: Math.round(line.quantity),
    }));
}

export const SHARED_CART_CODE = /^[A-Za-z0-9]{8}$/;

export function sharedCartPath(code: string): string {
  return `/cart/${code}`;
}

/** שורות העגלה → קוד קישור (נשמר במסד) */
export async function createSharedCart(items: CartItem[]): Promise<string> {
  const payload = linesPayload(
    items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId ?? null,
      quantity: item.quantity,
    })),
  );
  const { data, error } = await supabase.rpc("create_shared_cart", { _items: payload });
  if (error) throw new Error(error.message);
  return String(data);
}

/** התשובה מהמסד → עגלה / הצעה (null = הקישור לא קיים / פג תוקף) */
export function parseSharedCart(raw: unknown): SharedCart | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const lines = parseLines(record["items"]);
  if (!lines) return null;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
  return {
    kind: record["kind"] === "quote" ? "quote" : "cart",
    lines,
    customerName: text(record["customer_name"]),
    note: text(record["note"]),
    expiresAt: text(record["expires_at"]),
  };
}

function parseLines(items: unknown): SharedCartLine[] | null {
  if (!Array.isArray(items)) return null;
  const lines: SharedCartLine[] = [];
  for (const entry of items) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const productId = typeof row["product_id"] === "string" ? row["product_id"] : "";
    const quantity = Math.round(Number(row["quantity"]));
    if (!productId || !Number.isFinite(quantity) || quantity < 1) continue;
    lines.push({
      productId,
      variantId: typeof row["variant_id"] === "string" ? row["variant_id"] : null,
      quantity,
    });
  }
  return lines;
}

export async function loadSharedCart(code: string): Promise<SharedCart | null> {
  if (!SHARED_CART_CODE.test(code)) return null;
  const { data, error } = await supabase.rpc("get_shared_cart", { _code: code });
  if (error) throw new Error(error.message);
  return parseSharedCart(data);
}

/** שיתוף הקישור: בטלפון — תפריט השיתוף (ווטסאפ...), אחרת — העתקה */
export async function shareLink(url: string, title: string): Promise<void> {
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  if (typeof nav.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
    try {
      await nav.share({ title, url });
      return;
    } catch {
      // בוטל — מעתיקים כרגיל
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("הקישור הועתק — אפשר להדביק בווטסאפ / במייל");
  } catch {
    toast.info(url, { duration: 15000 });
  }
}

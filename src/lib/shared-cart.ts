/**
 * חלק 39: שיתוף עגלה בקישור (/cart/{code}).
 * נשמרים רק מזהי מוצרים / וריאציות וכמויות — המחיר מחושב לפי מי שפותח.
 */
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { CartItem } from "@/lib/orders";

export type SharedCartLine = { productId: string; variantId: string | null; quantity: number };

export const SHARED_CART_CODE = /^[A-Za-z0-9]{8}$/;

export function sharedCartPath(code: string): string {
  return `/cart/${code}`;
}

/** שורות העגלה → קוד קישור (נשמר במסד) */
export async function createSharedCart(items: CartItem[]): Promise<string> {
  const payload = items
    .filter((item) => item.quantity > 0)
    .map((item) => ({
      product_id: item.productId,
      ...(item.variantId ? { variant_id: item.variantId } : {}),
      quantity: Math.round(item.quantity),
    }));
  const { data, error } = await supabase.rpc("create_shared_cart", { _items: payload });
  if (error) throw new Error(error.message);
  return String(data);
}

/** התשובה מהמסד → שורות (null = הקישור לא קיים / פג תוקף) */
export function parseSharedCart(raw: unknown): SharedCartLine[] | null {
  if (!raw || typeof raw !== "object") return null;
  const items = (raw as { items?: unknown }).items;
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

export async function loadSharedCart(code: string): Promise<SharedCartLine[] | null> {
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

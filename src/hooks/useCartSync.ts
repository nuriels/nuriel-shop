import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { CartItem } from "@/lib/orders";

/**
 * שמירת עגלת הקניות בשרת.
 *
 * שתי סיבות: (א) הלקוח לא מאבד את הסל בין מכשירים ורענון דף; (ב) מנהל
 * וסוכן רואים ב"תיק הלקוח" מה הלקוח אוסף בזמן אמת. הכתיבה מושהית
 * (debounce) כדי לא לירות בקשה על כל לחיצת + או -.
 */
export function useCartSync({
  userId,
  cart,
  setCart,
  enabled,
}: {
  userId: string | null;
  cart: CartItem[];
  setCart: (items: CartItem[]) => void;
  enabled: boolean;
}) {
  const loadedFor = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // טעינה חד-פעמית לכל משתמש
  useEffect(() => {
    if (!enabled || userId === null || loadedFor.current === userId) return;
    loadedFor.current = userId;
    void (async () => {
      const { data } = await supabase
        .from("customer_carts")
        .select("items")
        .eq("user_id", userId)
        .maybeSingle();
      const items = data?.items;
      if (Array.isArray(items) && items.length > 0) setCart(items as unknown as CartItem[]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, userId]);

  // שמירה מושהית בכל שינוי, אחרי שהטעינה הראשונית הסתיימה
  useEffect(() => {
    if (!enabled || userId === null || loadedFor.current !== userId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void supabase
        .from("customer_carts")
        .upsert({ user_id: userId, items: cart as unknown as never }, { onConflict: "user_id" });
    }, 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, userId, cart]);
}

/** ניקוי העגלה השמורה — נקרא אחרי שליחת הזמנה/בקשה מוצלחת */
export async function clearStoredCart(userId: string): Promise<void> {
  await supabase
    .from("customer_carts")
    .upsert({ user_id: userId, items: [] as unknown as never }, { onConflict: "user_id" });
}

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import type { CartItem } from "@/lib/orders";

/**
 * הסל — משותף לכל העמודים (קטלוג → קופה) ונשמר בדפדפן, כך שאורח לא מאבד
 * אותו במעבר לקופה או ברענון. לקוח מחובר: הסל נשמר גם בשרת (useCartSync).
 *
 * הסל השמור "שייך" למשתמש: סל של אורח עובר איתו כשהוא מתחבר, אבל סל של
 * משתמש אחד לא נטען למשתמש אחר באותו דפדפן (ונמחק בהתנתקות).
 */

const STORAGE_KEY = "store-cart:v1";

type Stored = { owner: string | null; items: CartItem[] };

type CartContextValue = {
  cart: CartItem[];
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  /** false עד שהסל השמור נטען מהדפדפן — כדי לא להציג "הסל ריק" לרגע */
  ready: boolean;
};

const CartContext = createContext<CartContextValue | null>(null);

function readStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (!Array.isArray(parsed.items)) return null;
    return { owner: typeof parsed.owner === "string" ? parsed.owner : null, items: parsed.items };
  } catch {
    return null;
  }
}

/**
 * ניקוי הסל השמור מיד (לפני מעבר לדף אחר) — למשל לפני המעבר לעמוד התשלום
 * בביט, כשאין זמן ל-effect שישמור את הסל הריק
 */
export function clearStoredCartNow(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // מצב פרטי / אחסון חסום
  }
}

function writeStored(value: Stored): void {
  try {
    if (value.items.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // מצב פרטי / אחסון חסום — הסל נשאר בזיכרון בלבד
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  /** המשתמש שהסל שייך לו (null = אורח); undefined = עוד לא ידוע */
  const owner = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    const applyUser = (userId: string | null) => {
      const previous = owner.current;
      owner.current = userId;
      if (previous === undefined) {
        // טעינה ראשונה: סל של אורח, או של המשתמש הזה — כן; של משתמש אחר — לא
        const stored = readStored();
        if (stored && (stored.owner === null || stored.owner === userId)) {
          setCart(stored.items);
        }
        setReady(true);
        return;
      }
      if (previous === userId) return;
      // התנתקות, או החלפת משתמש: הסל של הקודם לא עובר הלאה.
      // התחברות של אורח (null → משתמש): הסל שאסף נשאר איתו.
      if (previous !== null) setCart([]);
    };

    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) applyUser(data.session?.user.id ?? null);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (owner.current === undefined) return; // הטעינה הראשונה עוד לא הסתיימה
      applyUser(session?.user.id ?? null);
    });
    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!ready || owner.current === undefined) return;
    writeStored({ owner: owner.current, items: cart });
  }, [cart, ready]);

  const value = useMemo(() => ({ cart, setCart, ready }), [cart, ready]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside <CartProvider>");
  return value;
}

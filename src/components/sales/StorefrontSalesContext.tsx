import { createContext, useContext, type ReactNode } from "react";
import type { CartPromotion, OrderBump } from "@/lib/cart-promotions";
import type { CatalogItem } from "@/lib/catalog";
import type { AddToCart } from "@/lib/cart";

/**
 * מה שרכיבי החנות צריכים כדי להמליץ על מוצרים ולהוסיף לסל, בלי להעביר
 * props דרך כל השכבות (קטלוג → קטגוריה → כרטיס → חלון מוצר).
 */
export type StorefrontSales = {
  catalog: CatalogItem[];
  catalogById: Map<string, CatalogItem>;
  related: Map<string, string[]>;
  bumps: OrderBump[];
  promotions: CartPromotion[];
  /** הקטגוריה וכל תתי-הקטגוריות שלה */
  subtree: (category: string) => Set<string>;
  canAdd: boolean;
  addLabel: string;
  onAddToCart?: AddToCart | undefined;
};

const StorefrontSalesContext = createContext<StorefrontSales | null>(null);

export function StorefrontSalesProvider({
  value,
  children,
}: {
  value: StorefrontSales;
  children: ReactNode;
}) {
  return (
    <StorefrontSalesContext.Provider value={value}>{children}</StorefrontSalesContext.Provider>
  );
}

/** null מחוץ לחנות (למשל בפאנל הניהול) — אז פשוט לא מציגים המלצות */
export function useStorefrontSales(): StorefrontSales | null {
  return useContext(StorefrontSalesContext);
}

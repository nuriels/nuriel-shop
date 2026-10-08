import { Sparkles } from "lucide-react";
import { CatalogGrid } from "@/components/CatalogGrid";
import type { AddToCart } from "@/lib/cart";
import type { CatalogItem } from "@/lib/catalog";

/**
 * חלק 34: "מוצרים נלווים שיכולים לעניין אותך" — בעמוד המוצר, מתחת לפרטים.
 * המוצרים שהמנהל קישר בעריכת המוצר (לפי הסדר שלו), ואם לא קישר — מוצרים
 * מאותה קטגוריה. מוצגים כמו בקטלוג (מחיר, מבצע, דירוג, הוספה לסל); לחיצה
 * פותחת את עמוד המוצר.
 */
export function RelatedProductsSection({
  items,
  linked,
  category,
  canAdd,
  addLabel,
  onAddToCart,
  onOpenProduct,
}: {
  items: CatalogItem[];
  /** true = מוצרים שהמנהל קישר; false = מאותה קטגוריה */
  linked: boolean;
  category: string;
  canAdd: boolean;
  addLabel: string;
  onAddToCart?: AddToCart | undefined;
  onOpenProduct: (product: CatalogItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section
      aria-labelledby="related-title"
      className="space-y-3"
      data-testid="related-products"
      data-related={linked ? "linked" : "category"}
    >
      <h2
        id="related-title"
        className="flex items-center gap-2 font-display text-xl text-foreground"
      >
        <Sparkles className="size-5 text-accent" aria-hidden="true" />
        {linked ? "מוצרים נלווים שיכולים לעניין אותך" : `עוד מ${category}`}
      </h2>
      <CatalogGrid
        products={items}
        canAdd={canAdd}
        addLabel={addLabel}
        onAddToCart={onAddToCart}
        onOpenProduct={onOpenProduct}
      />
    </section>
  );
}

import { Sparkles, Star } from "lucide-react";
import { CatalogGrid } from "@/components/CatalogGrid";
import type { AddToCart } from "@/lib/cart";
import type { FeaturedBlock } from "@/lib/homepage";

/**
 * בלוק "מוצרים נבחרים" במסך הבית (חלק 20): המוצרים שהמנהל סימן "הקפץ למסך
 * ראשי". כשאין כאלה — "החדשים ביותר". מוצר שאזל מוצג בסוף, עם "אזל מהמלאי"
 * וכפתור הוספה מנוטרל (כמו בכל הקטלוג).
 */
export function FeaturedProducts({
  block,
  canAdd,
  addLabel,
  onAddToCart,
}: {
  block: FeaturedBlock;
  canAdd: boolean;
  addLabel: string;
  onAddToCart?: AddToCart | undefined;
}) {
  if (block.items.length === 0) return null;
  const Icon = block.fallback ? Sparkles : Star;
  return (
    <section
      aria-labelledby="featured-title"
      className="space-y-3"
      data-featured-products={block.fallback ? "newest" : "featured"}
    >
      <div className="flex items-center gap-2">
        <Icon
          className={block.fallback ? "size-5 text-accent" : "size-5 fill-amber-400 text-amber-500"}
          aria-hidden="true"
        />
        <h2 id="featured-title" className="font-display text-lg text-foreground">
          {block.fallback ? "החדשים ביותר" : "מוצרים נבחרים"}
        </h2>
      </div>
      <CatalogGrid
        products={block.items}
        canAdd={canAdd}
        addLabel={addLabel}
        onAddToCart={onAddToCart}
      />
    </section>
  );
}

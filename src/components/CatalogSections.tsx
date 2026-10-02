import { CatalogGrid } from "@/components/CatalogGrid";
import type { CatalogItem } from "@/lib/catalog";
import type { CatalogSection } from "@/lib/catalog-sections";

/**
 * הקטלוג ללקוח: בקטגוריה עם תת-קטגוריות — שורה לכל תת-קטגוריה עם כותרת
 * (למשל תחת "משקאות אנרגיה": XL, BLU...). אחרת — הרשת הרגילה, כמו היום.
 */
export function CatalogSections({
  sections,
  emptyText,
  canAdd,
  addLabel,
  onAddToCart,
  onOpenCategory,
}: {
  sections: CatalogSection<CatalogItem>[];
  emptyText: string;
  canAdd: boolean;
  addLabel?: string | undefined;
  onAddToCart?: ((item: CatalogItem, quantity?: number) => void) | undefined;
  /** מעבר לתת-קטגוריה של השורה (כמו בחירה בכפתורי הסינון למעלה) */
  onOpenCategory?: (category: string) => void;
}) {
  const grid = {
    canAdd,
    ...(addLabel !== undefined ? { addLabel } : {}),
    ...(onAddToCart ? { onAddToCart } : {}),
  };
  const nonEmpty = sections.filter((section) => section.items.length > 0);
  if (nonEmpty.length === 0 || (sections.length === 1 && sections[0]?.title === null)) {
    return <CatalogGrid products={sections[0]?.items ?? []} emptyText={emptyText} {...grid} />;
  }
  return (
    <div className="space-y-8">
      {nonEmpty.map((section) => (
        <section
          key={section.key}
          aria-labelledby={`catalog-row-${section.key}`}
          className="space-y-3"
        >
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border pb-2">
            <h3
              id={`catalog-row-${section.key}`}
              className="font-display text-xl font-bold text-foreground"
            >
              {section.title}{" "}
              <span className="numeric text-sm font-normal text-muted-foreground">
                ({section.items.length})
              </span>
            </h3>
            {section.isChild && section.category && onOpenCategory && (
              <button
                type="button"
                onClick={() => onOpenCategory(section.category!)}
                className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                לכל המוצרים של {section.title} ←
              </button>
            )}
          </div>
          <CatalogGrid products={section.items} {...grid} />
        </section>
      ))}
    </div>
  );
}

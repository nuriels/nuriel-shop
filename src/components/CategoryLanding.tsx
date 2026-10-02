import { Package } from "lucide-react";
import type { CategoryNode } from "@/lib/category-tree";

/**
 * מסך הכניסה לקטלוג: ריבועי קטגוריות במקום בליל כל המוצרים. לחיצה על ריבוע
 * (או בחירה בתפריט הצד, שנשאר זמין תמיד) עוברת לתצוגת המוצרים של אותה
 * קטגוריה ותת-הקטגוריות שלה.
 */
export function CategoryLanding({
  categories,
  counts,
  onSelect,
  usingFallback,
}: {
  categories: CategoryNode[];
  /** מספר המוצרים לכל קטגוריה, כולל תת-הקטגוריות */
  counts: Map<string, number>;
  onSelect: (name: string) => void;
  /** true = המנהל עוד לא בחר קטגוריות ל"הצג במסך הבית", מוצגות קטגוריות השורש */
  usingFallback?: boolean;
}) {
  if (categories.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
        עוד לא הוגדרו קטגוריות. אפשר לחפש מוצר בשורת החיפוש למעלה.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        {categories.map((node) => (
          <button
            key={node.name}
            type="button"
            onClick={() => onSelect(node.name)}
            className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-start shadow-card transition-shadow duration-200 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex aspect-square items-center justify-center overflow-hidden bg-secondary/60">
              {node.image_url ? (
                <img
                  src={node.image_url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-200 motion-safe:group-hover:scale-[1.03]"
                />
              ) : (
                <span className="font-display text-4xl text-primary/60" aria-hidden>
                  {node.name.slice(0, 1)}
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-0.5 p-3">
              <span className="font-display line-clamp-2 text-base font-bold leading-snug text-foreground sm:text-lg">
                {node.name}
              </span>
              <span className="numeric text-xs text-muted-foreground sm:text-sm">
                {counts.get(node.name) ?? 0} מוצרים
              </span>
            </div>
          </button>
        ))}
      </div>
      {usingFallback && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Package className="size-3.5 shrink-0" />
          מוצגות קטגוריות השורש. בפאנל הניהול, "ניהול קטגוריות" אפשר לבחור בדיוק אילו קטגוריות יוצגו
          כאן.
        </p>
      )}
    </div>
  );
}

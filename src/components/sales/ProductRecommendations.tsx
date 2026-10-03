import { Package, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VatNote } from "@/components/VatNote";
import { formatIls, type CatalogItem } from "@/lib/catalog";
import { cn } from "@/lib/utils";

/**
 * "מוצרים נוספים שאולי תאהבו" — שורה נגללת (גם במגע) של כרטיסים קטנים.
 * לחיצה על כרטיס פותחת את המוצר; "+" מוסיף לסל מיד (מארז / מינימום אחד).
 */
export function ProductRecommendations({
  items,
  title = "מוצרים נוספים שאולי תאהבו",
  onOpen,
  onAdd,
  addLabel = "הוספה לסל",
  compact = false,
}: {
  items: CatalogItem[];
  title?: string;
  onOpen?: ((item: CatalogItem) => void) | undefined;
  onAdd?: ((item: CatalogItem) => void) | undefined;
  addLabel?: string;
  /** כרטיסים צרים יותר (מגירת הסל) */
  compact?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
        <Sparkles className="size-4 text-accent" aria-hidden="true" />
        {title}
      </h3>
      <ul className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
        {items.map((item) => (
          <li
            key={item.id}
            className={cn("shrink-0 snap-start", compact ? "w-32" : "w-36 sm:w-40")}
          >
            <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card transition-shadow hover:shadow-lift">
              <button
                type="button"
                onClick={() => onOpen?.(item)}
                disabled={!onOpen}
                aria-label={`פרטים על ${item.name}`}
                className="block text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default"
              >
                <div
                  className={cn(
                    "flex items-center justify-center bg-secondary/60 p-2",
                    compact ? "h-20" : "h-24 sm:h-28",
                  )}
                >
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-contain mix-blend-multiply"
                    />
                  ) : (
                    <Package className="size-7 text-muted-foreground" aria-hidden="true" />
                  )}
                </div>
                <p
                  title={item.name}
                  className="line-clamp-2 min-h-9 break-words px-2 pt-2 text-xs font-bold leading-snug text-foreground"
                >
                  {item.name}
                </p>
              </button>
              <div className="mt-auto flex items-end justify-between gap-1 px-2 pb-2 pt-1">
                <div className="min-w-0">
                  {item.price !== null ? (
                    <>
                      <p className="numeric text-sm font-bold text-accent">
                        {formatIls(item.price)}
                      </p>
                      <VatNote className="block text-[10px] sm:text-[10px]" />
                    </>
                  ) : (
                    <p className="text-[11px] leading-4 text-muted-foreground">מחיר לפי הצעה</p>
                  )}
                </div>
                {onAdd && (
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="size-8 shrink-0"
                    aria-label={`${addLabel}: ${item.name}`}
                    title={addLabel}
                    onClick={() => onAdd(item)}
                  >
                    <Plus className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

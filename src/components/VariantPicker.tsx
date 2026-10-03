import { useEffect, useMemo, useState } from "react";
import type { CatalogItem } from "@/lib/catalog";
import {
  attributeNames,
  findVariant,
  initialSelection,
  optionState,
  selectionComplete,
  variantAttributesOf,
  variantsOf,
  type CatalogVariant,
  type VariantAttribute,
  type VariantOptions,
} from "@/lib/variants";
import { cn } from "@/lib/utils";

export type VariantSelection = {
  attributes: VariantAttribute[];
  variants: CatalogVariant[];
  /** למוצר יש וריאציות — חובה לבחור לפני ההוספה לסל */
  hasVariants: boolean;
  selection: Partial<VariantOptions>;
  select: (attribute: string, value: string) => void;
  /** הוריאציה שנבחרה (כשכל המאפיינים נבחרו) */
  variant: CatalogVariant | null;
  complete: boolean;
  /** "צבע / מידה" — מה עוד חסר (לכפתור "בחרו...") */
  missing: string;
  /** אפשר להוסיף לסל: אין וריאציות, או שנבחרה וריאציה זמינה */
  canAdd: boolean;
  /** המחיר לתצוגה: של הוריאציה שנבחרה, אחרת של המוצר */
  price: number | null;
};

/**
 * הבחירה של הלקוח בין הוריאציות של מוצר (כרטיס / חלון מוצר / חלון כמות).
 * מוצר חדש → מתחילים מהבחירה ההתחלתית (מאפיין עם ערך יחיד נבחר לבד);
 * `preset` = וריאציה שכבר נבחרה (למשל בכרטיס, לפני חלון הכמות).
 */
export function useVariantSelection(
  item: CatalogItem | null,
  preset?: CatalogVariant | null,
): VariantSelection {
  const attributes = useMemo(() => (item ? variantAttributesOf(item) : []), [item]);
  const variants = useMemo(() => (item ? variantsOf(item) : []), [item]);
  const [selection, setSelection] = useState<Partial<VariantOptions>>({});

  useEffect(() => {
    setSelection(preset ? { ...preset.options } : initialSelection(variants, attributes));
    // מאפסים רק כשנפתח מוצר אחר (או וריאציה אחרת מבחוץ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, preset?.id]);

  const hasVariants = variants.length > 0;
  const complete = selectionComplete(selection, attributes);
  const variant = hasVariants ? findVariant(variants, selection, attributes) : null;
  const missing = attributeNames(attributes.filter((attribute) => !selection[attribute.name]));

  return {
    attributes,
    variants,
    hasVariants,
    selection,
    select: (attribute, value) =>
      setSelection((current) =>
        current[attribute] === value
          ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== attribute))
          : { ...current, [attribute]: value },
      ),
    variant,
    complete,
    missing,
    canAdd: !hasVariants || (variant !== null && variant.available),
    price: variant ? variant.price : (item?.price ?? null),
  };
}

/**
 * כפתורי הבחירה: לכל מאפיין שורה של ערכים. ערך שאין לו צירוף זמין (לפי מה
 * שכבר נבחר) — מסומן "אזל"; צירוף שלא קיים בכלל — כבוי.
 */
export function VariantPicker({
  state,
  size = "md",
  className,
}: {
  state: VariantSelection;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!state.hasVariants) return null;
  const small = size === "sm";
  return (
    <div className={cn(small ? "space-y-1.5" : "space-y-3", className)}>
      {state.attributes.map((attribute) => {
        const chosen = state.selection[attribute.name];
        return (
          <fieldset key={attribute.name} className={small ? "space-y-1" : "space-y-1.5"}>
            <legend
              className={cn(
                "font-semibold text-muted-foreground",
                small ? "mb-1 text-[11px]" : "mb-1.5 text-sm",
              )}
            >
              {attribute.name}
              {chosen ? (
                <span className="font-bold text-foreground">: {chosen}</span>
              ) : (
                !small && <span className="font-normal"> — בחרו</span>
              )}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {attribute.values.map((value) => {
                const stateOf = optionState(
                  state.variants,
                  state.attributes,
                  state.selection,
                  attribute.name,
                  value,
                );
                const selected = chosen === value;
                const missing = stateOf === "missing";
                const soldOut = stateOf === "soldout";
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    disabled={missing && !selected}
                    title={soldOut ? "אזל מהמלאי" : missing ? "הצירוף הזה לא קיים" : undefined}
                    onClick={(event) => {
                      // בכרטיס מוצר — שלא ייפתח חלון המוצר
                      event.stopPropagation();
                      state.select(attribute.name, value);
                    }}
                    className={cn(
                      "rounded-md border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      small ? "min-h-7 px-2 text-xs" : "min-h-9 px-3 text-sm",
                      selected
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-card text-foreground hover:border-primary/60",
                      soldOut && !selected && "text-muted-foreground line-through decoration-1",
                      soldOut && selected && "opacity-80",
                      missing && !selected && "cursor-not-allowed opacity-35",
                    )}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      {state.complete && state.variant && !state.variant.available && (
        <p className={cn("font-medium text-destructive", small ? "text-[11px]" : "text-sm")}>
          האפשרות הזו אזלה מהמלאי — בחרו אחרת
        </p>
      )}
    </div>
  );
}

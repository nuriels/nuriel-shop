import { useEffect, useState } from "react";
import { VatNote } from "@/components/VatNote";
import { Minus, Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  formatIls,
  minimumQuantity,
  minOrderMessage,
  minOrderUnits,
  packStep,
  type CatalogItem,
} from "@/lib/catalog";
import { toast } from "sonner";
import { VariantPicker, useVariantSelection } from "@/components/VariantPicker";
import type { CatalogVariant } from "@/lib/variants";

/** פיקדון ליחידת כמות אחת (כפי שנספרת בסל) */
function depositPerQuantityUnit(item: CatalogItem): number {
  if (!item.has_deposit || item.deposit_price === null || item.deposit_units === null) return 0;
  return item.deposit_price * item.deposit_units;
}

/**
 * בורר כמות. למוצר שנמכר במארזים סופרים מארזים (1, 2, 3...) והערך שמוחזר
 * הוא ביחידות (24, 48, 72...) — הלקוח לא צריך לחשב כלום. למוצר רגיל
 * סופרים יחידות.
 */
export function QuantityPicker({
  item,
  units,
  onChange,
  onSubmit,
  disabled = false,
  price,
}: {
  item: CatalogItem;
  /** הכמות ביחידות */
  units: number;
  onChange: (units: number) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  /** מחיר ליחידה לחישוב הסכום (וריאציה עם מחיר משלה); ברירת מחדל — מחיר המוצר */
  price?: number | null;
}) {
  const step = packStep(item);
  // מינימום להזמנה (נפרד מהמארזים): לא יורדים ממנו; בלי מינימום — ממארז / יחידה אחת
  const minPacks = Math.max(1, minimumQuantity(item) / step);
  const hasMinimum = minOrderUnits(item) > 1;
  const packs = Math.max(minPacks, Math.round(units / step));
  const [draft, setDraft] = useState(String(packs));

  useEffect(() => {
    setDraft(String(packs));
  }, [packs]);

  const setPacks = (next: number) => onChange(Math.min(999, Math.max(minPacks, next)) * step);
  const belowMinimum = () => toast.info(minOrderMessage(minPacks * step));
  const unitPrice = price === undefined ? item.price : price;
  const lineTotal = unitPrice !== null ? unitPrice * units : null;
  const deposit = depositPerQuantityUnit(item) * units;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-md border border-border bg-card">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-11"
            aria-label={step > 1 ? "מארז נוסף" : "יחידה נוספת"}
            disabled={disabled || packs >= 999}
            onClick={() => setPacks(packs + 1)}
          >
            <Plus className="size-4" />
          </Button>
          <Input
            value={draft}
            inputMode="numeric"
            aria-label={step > 1 ? "מספר מארזים" : "כמות"}
            disabled={disabled}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "").slice(0, 3);
              setDraft(digits);
              // מתחת למינימום — מתקנים ביציאה מהשדה (כדי שאפשר יהיה להקליד 12 דרך 1)
              if (digits !== "" && Number(digits) >= minPacks) setPacks(Number(digits));
            }}
            onBlur={() => {
              if (draft === "" || Number(draft) < minPacks) {
                if (hasMinimum) belowMinimum();
                setPacks(minPacks);
                setDraft(String(minPacks));
                return;
              }
              setDraft(String(packs));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && onSubmit) {
                event.preventDefault();
                onSubmit();
              }
            }}
            className="numeric h-11 w-14 border-0 text-center text-lg font-bold shadow-none focus-visible:ring-0"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-11"
            aria-label={step > 1 ? "מארז אחד פחות" : "יחידה אחת פחות"}
            // עם מינימום להזמנה הכפתור נשאר פעיל ומסביר למה אי אפשר לרדת
            disabled={disabled || (packs <= minPacks && !hasMinimum)}
            onClick={() => (packs <= minPacks ? belowMinimum() : setPacks(packs - 1))}
          >
            <Minus className="size-4" />
          </Button>
        </div>
        <div className="min-w-0 text-sm">
          {step > 1 ? (
            <>
              <p className="font-semibold text-foreground">
                {packs === 1 ? "מארז אחד" : `${packs} מארזים`}
              </p>
              <p className="numeric text-muted-foreground">= {units} יחידות</p>
            </>
          ) : (
            <p className="font-semibold text-foreground">
              {units === 1 ? "יחידה אחת" : `${units} יחידות`}
            </p>
          )}
        </div>
      </div>
      {lineTotal !== null && (
        <p className="text-sm text-muted-foreground">
          סה"כ: <span className="numeric font-bold text-foreground">{formatIls(lineTotal)}</span>
          {deposit > 0 && <span className="numeric"> + פיקדון {formatIls(deposit)}</span>}
        </p>
      )}
    </div>
  );
}

/** שורת מידע על המארז: "נמכר במארזים של 24 · מינימום 24 יחידות" */
export function PackNote({ item, className }: { item: CatalogItem; className?: string }) {
  const step = packStep(item);
  if (step <= 1) return null;
  return (
    <p className={className ?? "text-sm text-muted-foreground"}>
      נמכר במארזים של {step} יחידות, מינימום {step}.
      {item.price !== null && (
        <span className="numeric"> מחיר מארז: {formatIls(item.price * step)}</span>
      )}
    </p>
  );
}

/** "מינימום להזמנה: 2 יח'" — רק למוצר שהוגדר לו מינימום (נפרד מהמארזים) */
export function MinOrderNote({ item, className }: { item: CatalogItem; className?: string }) {
  const min = minOrderUnits(item);
  if (min <= 1) return null;
  const actual = minimumQuantity(item);
  return (
    <p
      className={
        className ??
        "rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-medium text-foreground"
      }
    >
      מינימום להזמנה: <span className="numeric">{min}</span> יח׳
      {actual !== min && (
        <span className="numeric font-normal text-muted-foreground">
          {" "}
          (עם המארזים: לפחות {actual})
        </span>
      )}
    </p>
  );
}

/**
 * חלון "בחירת כמות" שנפתח מכל כפתור "הוספה לסל" — סיטונאות: תמיד בוחרים
 * כמות לפני ההוספה. מוצר במארזים מתחיל ממארז אחד. מוצר עם וריאציות —
 * בוחרים כאן גם את האפשרות (צבע / מידה), ובלי בחירה אי אפשר להוסיף.
 */
export function QuantityDialog({
  item,
  variant: preset = null,
  onOpenChange,
  addLabel = "הוספה לסל",
  onAdd,
}: {
  item: CatalogItem | null;
  /** אפשרות שכבר נבחרה (בכרטיס המוצר) */
  variant?: CatalogVariant | null;
  onOpenChange: (open: boolean) => void;
  addLabel?: string;
  onAdd: (item: CatalogItem, units: number, variant: CatalogVariant | null) => void;
}) {
  const [units, setUnits] = useState(1);
  const choice = useVariantSelection(item, preset);

  useEffect(() => {
    if (item) setUnits(minimumQuantity(item));
  }, [item]);

  if (!item) return null;

  const submit = () => {
    if (!choice.canAdd) {
      toast.info(
        choice.complete ? "האפשרות הזו אזלה מהמלאי — בחרו אחרת" : `בחרו ${choice.missing}`,
      );
      return;
    }
    onAdd(item, units, choice.variant);
    onOpenChange(false);
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="text-right sm:max-w-md">
        <DialogHeader className="text-right">
          <div className="flex items-center gap-3 pe-6">
            <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary/60">
              {item.image_url ? (
                <img
                  src={item.image_url}
                  alt=""
                  className="h-full w-full object-contain mix-blend-multiply"
                />
              ) : (
                <Package className="size-7 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <DialogTitle className="line-clamp-2 break-words text-base font-bold leading-snug">
                {item.name}
              </DialogTitle>
              <DialogDescription className="numeric">
                {choice.price !== null ? (
                  <>
                    {formatIls(choice.price)} ליחידה <VatNote />
                  </>
                ) : (
                  "מחיר לפי הצעה"
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <PackNote
          item={item}
          className="rounded-md bg-secondary px-3 py-2 text-sm text-foreground"
        />
        <MinOrderNote item={item} />

        <VariantPicker state={choice} />

        <QuantityPicker
          item={item}
          units={units}
          onChange={setUnits}
          onSubmit={submit}
          price={choice.price}
        />

        <Button
          size="lg"
          className="w-full"
          onClick={submit}
          disabled={choice.complete && !choice.canAdd}
        >
          <Plus className="size-4" />
          {choice.hasVariants && !choice.complete ? `בחרו ${choice.missing}` : addLabel}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { VatNote } from "@/components/VatNote";
import { Flame, Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuantityDialog } from "@/components/QuantityDialog";
import type { AddToCart } from "@/lib/cart";
import {
  discountPercent,
  formatIls,
  formatSaleCountdown,
  packStep,
  type CatalogItem,
} from "@/lib/catalog";
import { ProductSticker } from "@/components/products/ProductSticker";
import { useStorefrontWide } from "@/components/layout/storefront-frame";
import { cn } from "@/lib/utils";

/**
 * רוחב כרטיס ברירת מחדל (w-44) — עד שנמדד הרוחב האמיתי (במסך רחב הכרטיס גדל ל-w-52);
 * רווח (gap-3), ומהירות התנועה בפיקסלים לשנייה — איטית ונעימה
 */
const CARD_W = 176;
const CARD_GAP = 12;
const SPEED_PX_PER_S = 36;
/** אחרי הרמת האצבע — כמה זמן הרצועה נשארת עצורה (כדי שלא תזוז תחת הלחיצה) */
const TOUCH_RESUME_MS = 2500;

/**
 * רצועת "מבצעים חמים" בראש הקטלוג (חלק 44). המוצרים הם אלה שסומנו "מבצע חם" / במבצע
 * מחיר (המנגנון הקיים — ניהול בכרטיס המוצר). כשהם יותר ממה שנכנס במסך — הרצועה נעה
 * ברציפות באיטיות; אחרת היא סטטית. ההעתק השני (ללולאה חלקה) מוסתר מקוראי מסך ולא נכנס
 * ל-Tab, אבל נשאר לחיץ.
 */
export function HotDealsStrip({
  items,
  canAdd,
  addLabel = "הוספה לסל",
  onAddToCart,
}: {
  items: CatalogItem[];
  canAdd: boolean;
  addLabel?: string;
  onAddToCart?: AddToCart | undefined;
}) {
  // חלק 39: לחיצה על מבצע עוברת לעמוד המוצר (כתובת לשיתוף)
  const navigate = useNavigate();
  const openProduct = (item: CatalogItem) =>
    void navigate({ to: "/product/$productId", params: { productId: item.id } });
  const [picking, setPicking] = useState<CatalogItem | null>(null);
  // במסגרת הרחבה של החנות, במסך רחב (2xl+) — כרטיסים ותמונות גדולים יותר
  const wide = useStorefrontWide();

  // האם התוכן רחב מהמסך — רק אז יש תנועה (נמדד גם בשינוי גודל / סיבוב מסך). רוחב
  // הכרטיס נמדד מהכרטיס עצמו, כך שהלולאה נשארת רציפה בכל גודל כרטיס
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const [cardWidth, setCardWidth] = useState(CARD_W);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      setBoxWidth(el.clientWidth);
      const card = el.querySelector<HTMLElement>('[data-testid="hot-deal-card"]');
      if (card && card.offsetWidth > 0) setCardWidth(card.offsetWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [items.length]);

  // מגע: עוצרים כשהאצבע על הרצועה ועוד רגע אחריה — ממשיכים מאותה נקודה
  const [touchPaused, setTouchPaused] = useState(false);
  const resumeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resumeTimer.current), []);
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse") return;
    window.clearTimeout(resumeTimer.current);
    setTouchPaused(true);
  };
  const onPointerRelease = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse") return;
    window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => setTouchPaused(false), TOUCH_RESUME_MS);
  };

  if (items.length === 0) return null;
  const copyWidth = items.length * cardWidth + (items.length - 1) * CARD_GAP;
  const animate = boxWidth > 0 && copyWidth > boxWidth + 8;
  const shift = copyWidth + CARD_GAP;

  // decorative: ההעתק השני (ללולאה) — לא נכנס ל-Tab ולא נקרא פעמיים
  const renderCards = (decorative: boolean) =>
    items.map((item) => (
      <article
        key={item.id}
        data-testid="hot-deal-card"
        data-product-id={item.id}
        className={cn(
          "flex w-44 shrink-0 snap-start flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card",
          wide && "2xl:w-52",
        )}
      >
        <button
          type="button"
          onClick={() => openProduct(item)}
          tabIndex={decorative ? -1 : undefined}
          aria-label={`פרטים על ${item.name}`}
          className={cn(
            "relative flex h-28 cursor-pointer items-center justify-center bg-secondary/60 p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            wide && "2xl:h-36",
          )}
        >
          {item.image_url ? (
            <img
              src={item.image_url}
              alt={item.name}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-contain mix-blend-multiply"
            />
          ) : (
            <Package className="size-8 text-muted-foreground" />
          )}
          <ProductSticker
            sticker={item.sticker}
            className="left-1.5 top-1.5 sm:left-1.5 sm:top-1.5"
          />
        </button>
        <div className="flex flex-1 flex-col gap-1.5 p-3">
          <button
            type="button"
            onClick={() => openProduct(item)}
            tabIndex={decorative ? -1 : undefined}
            title={item.name}
            className="line-clamp-2 min-h-10 break-words rounded text-start text-sm font-bold leading-snug text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.name}
          </button>
          {item.price !== null ? (
            <p className="flex flex-wrap items-baseline gap-1.5">
              <span className="numeric font-bold text-accent">{formatIls(item.price)}</span>
              <VatNote />
              {item.original_price !== null && (
                <span className="numeric text-xs text-muted-foreground line-through">
                  {formatIls(item.original_price)}
                </span>
              )}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">מחיר לפי הצעה</p>
          )}
          {item.original_price !== null && (
            <p className="text-[11px] font-semibold text-accent-foreground/80">
              {discountPercent(item.price ?? 0, item.original_price)}% הנחה
              {item.sale_ends_at ? ` · ${formatSaleCountdown(item.sale_ends_at)}` : ""}
            </p>
          )}
          {packStep(item) > 1 && (
            <p className="text-[11px] font-semibold text-muted-foreground">
              מינימום {packStep(item)}
            </p>
          )}
          {canAdd && onAddToCart && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-auto w-full"
              disabled={item.is_out_of_stock}
              tabIndex={decorative ? -1 : undefined}
              onClick={() => setPicking(item)}
            >
              <Plus className="size-4" />
              {addLabel}
            </Button>
          )}
        </div>
      </article>
    ));

  return (
    <section aria-labelledby="hot-deals-title" className="space-y-3">
      <div className="flex items-center gap-2">
        <Flame className="size-5 text-accent" />
        <h2 id="hot-deals-title" className="font-display text-lg text-foreground">
          מבצעים חמים
        </h2>
      </div>

      <div
        ref={boxRef}
        className="hot-marquee -mx-1 px-1 pb-2"
        data-animate={animate ? "true" : "false"}
        data-paused={touchPaused ? "true" : "false"}
        data-testid="hot-deals-marquee"
        style={
          animate
            ? ({
                "--hot-shift": `${shift}px`,
                "--hot-duration": `${Math.round(shift / SPEED_PX_PER_S)}s`,
              } as React.CSSProperties)
            : undefined
        }
        onPointerDown={onPointerDown}
        onPointerUp={onPointerRelease}
        onPointerCancel={onPointerRelease}
      >
        <div className="hot-track flex w-max gap-3" data-testid="hot-deals-track">
          <div className="hot-copy flex shrink-0 gap-3">{renderCards(false)}</div>
          {animate && (
            <div className="hot-copy hot-copy-2 flex shrink-0 gap-3" aria-hidden="true">
              {renderCards(true)}
            </div>
          )}
        </div>
      </div>

      {onAddToCart && (
        <QuantityDialog
          item={picking}
          onOpenChange={(open) => {
            if (!open) setPicking(null);
          }}
          addLabel={addLabel}
          onAdd={(it, units, variant) => onAddToCart(it, units, { variant })}
        />
      )}
    </section>
  );
}

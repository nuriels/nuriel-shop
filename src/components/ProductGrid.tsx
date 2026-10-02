import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, Loader2, Package } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ColorTags } from "@/components/ColorsInput";
import type { GlobalProduct } from "@/lib/catalog";
import { REORDER_ERROR } from "@/lib/catalog-sections";

/** לחיצה ארוכה שמרימה את הכרטיס, ותזוזה מותרת לפני שהיא נחשבת גלילה */
const LONG_PRESS_MS = 350;
const MOVE_TOLERANCE_PX = 8;
/** מרווח סביב השורה שעדיין נחשב "בתוך" (כדי שרעד קטן בקצה לא יבטל) */
const OUTSIDE_MARGIN_PX = 16;
const EDGE_SCROLL_PX = 70;

type DragState = {
  id: string;
  offsetX: number;
  offsetY: number;
  width: number;
  x: number;
  y: number;
  /** הסמן מחוץ לשורה — שחרור יבטל את הגרירה */
  outside: boolean;
};

/**
 * רשת המוצרים בניהול. עם `sortable`: לחיצה ארוכה על כרטיס מרימה אותו, אפשר
 * לגרור ולשנות מיקום **בתוך השורה הזו בלבד**, ובשחרור הסדר נשמר אוטומטית.
 * גרירה אל מחוץ לשורה (לשורה של קטגוריה אחרת, לתפריט הקטגוריות וכו') —
 * מבוטלת, המוצר חוזר למקומו והודעת שגיאה מוצגת. נאכף גם במסד (reorder_products).
 */
export function ProductGrid({
  products,
  emptyText = "לא נמצאו מוצרים",
  footer,
  sortable,
}: {
  products: GlobalProduct[];
  emptyText?: string;
  footer?: (product: GlobalProduct) => React.ReactNode;
  sortable?: { onReorder: (orderedIds: string[]) => Promise<void> };
}) {
  const [order, setOrder] = useState<string[]>(() => products.map((p) => p.id));
  const orderRef = useRef(order);
  orderRef.current = order;
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const press = useRef<{ timer: number; x: number; y: number; id: string; el: HTMLElement } | null>(
    null,
  );
  const startOrder = useRef<string[]>([]);

  // רשימה חדשה מבחוץ (טעינה / סינון) — מתעדכנים, אלא אם באמצע גרירה
  useEffect(() => {
    if (!dragRef.current) setOrder(products.map((p) => p.id));
  }, [products]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const preventTouchScroll = useCallback((event: TouchEvent) => event.preventDefault(), []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDrag(null);
    document.body.style.userSelect = "";
    window.removeEventListener("touchmove", preventTouchScroll);
  }, [preventTouchScroll]);

  const finish = useCallback(
    async (mode: "drop" | "outside" | "silent") => {
      if (!dragRef.current || !sortable) return;
      endDrag();
      const before = startOrder.current;
      if (mode !== "drop") {
        setOrder(before);
        if (mode === "outside") toast.error(REORDER_ERROR, { duration: 9000 });
        return;
      }
      const next = orderRef.current;
      if (next.length === before.length && next.every((id, i) => id === before[i])) return;
      setSaving(true);
      try {
        await sortable.onReorder(next);
        toast.success("הסדר נשמר");
      } catch (error) {
        setOrder(before);
        toast.error(error instanceof Error ? error.message : "שמירת הסדר נכשלה — הסדר הוחזר");
      } finally {
        setSaving(false);
      }
    },
    [endDrag, sortable],
  );

  useEffect(() => {
    if (!sortable) return;
    const onMove = (event: PointerEvent) => {
      const pending = press.current;
      if (pending && !dragRef.current) {
        if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > MOVE_TOLERANCE_PX) {
          window.clearTimeout(pending.timer);
          press.current = null; // זו גלילה, לא לחיצה ארוכה
        }
        return;
      }
      const current = dragRef.current;
      const box = containerRef.current?.getBoundingClientRect();
      if (!current || !box) return;
      const x = event.clientX;
      const y = event.clientY;
      const outside =
        x < box.left - OUTSIDE_MARGIN_PX ||
        x > box.right + OUTSIDE_MARGIN_PX ||
        y < box.top - OUTSIDE_MARGIN_PX ||
        y > box.bottom + OUTSIDE_MARGIN_PX;
      const next = { ...current, x, y, outside };
      dragRef.current = next;
      setDrag(next);
      if (!outside) {
        for (const [id, el] of cardRefs.current) {
          if (id === current.id) continue;
          const r = el.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            setOrder((list) => {
              const from = list.indexOf(current.id);
              const to = list.indexOf(id);
              if (from < 0 || to < 0 || from === to) return list;
              const moved = [...list];
              moved.splice(from, 1);
              moved.splice(to, 0, current.id);
              return moved;
            });
            break;
          }
        }
      }
      if (y < EDGE_SCROLL_PX) window.scrollBy(0, -14);
      else if (y > window.innerHeight - EDGE_SCROLL_PX) window.scrollBy(0, 14);
    };
    const onUp = () => {
      if (press.current) {
        window.clearTimeout(press.current.timer);
        press.current = null;
      }
      if (dragRef.current) void finish(dragRef.current.outside ? "outside" : "drop");
    };
    const onCancel = () => {
      if (press.current) {
        window.clearTimeout(press.current.timer);
        press.current = null;
      }
      if (dragRef.current) void finish("silent");
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dragRef.current) void finish("silent");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [sortable, finish]);

  const beginDrag = (id: string, el: HTMLElement, x: number, y: number) => {
    press.current = null;
    const rect = el.getBoundingClientRect();
    const state: DragState = {
      id,
      offsetX: x - rect.left,
      offsetY: y - rect.top,
      width: rect.width,
      x,
      y,
      outside: false,
    };
    startOrder.current = orderRef.current;
    dragRef.current = state;
    setDrag(state);
    document.body.style.userSelect = "none";
    window.addEventListener("touchmove", preventTouchScroll, { passive: false });
    navigator.vibrate?.(25);
  };

  if (products.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <Package className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        </CardContent>
      </Card>
    );
  }

  const cardBody = (product: GlobalProduct) => (
    <>
      <div className="relative flex h-32 items-center justify-center bg-secondary/60 p-2 sm:h-40 sm:p-3">
        {sortable && (
          <span
            className="absolute left-2 top-2 rounded-md bg-background/80 p-1 text-muted-foreground"
            title="לחיצה ארוכה וגרירה — לשינוי הסדר"
            aria-hidden="true"
          >
            <GripVertical className="size-4" />
          </span>
        )}
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="h-full w-full object-contain mix-blend-multiply"
          />
        ) : (
          <Package className="size-10 text-muted-foreground" />
        )}
      </div>
      <CardContent className="space-y-2 p-3 sm:p-4">
        <Badge variant="secondary" className="max-w-full truncate">
          {product.category}
        </Badge>
        <h3
          title={product.name}
          className="line-clamp-2 min-h-10 break-words text-sm font-bold leading-snug text-foreground sm:min-h-11 sm:text-base"
        >
          {product.name}
        </h3>
        <p dir="ltr" className="truncate text-[11px] font-medium text-muted-foreground sm:text-xs">
          SKU {product.sku}
        </p>
        <ColorTags colors={product.colors} />
        {footer?.(product)}
      </CardContent>
    </>
  );

  const ghost = drag ? byId.get(drag.id) : undefined;

  return (
    <div className="relative">
      {saving && (
        <p
          className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"
          aria-live="polite"
        >
          <Loader2 className="size-3.5 animate-spin" /> שומר את הסדר...
        </p>
      )}
      <div
        ref={containerRef}
        className={`grid grid-cols-2 gap-3 rounded-xl transition-shadow sm:gap-4 lg:grid-cols-3 xl:grid-cols-4 ${
          drag
            ? drag.outside
              ? "ring-2 ring-destructive/60 ring-offset-4"
              : "ring-2 ring-primary/40 ring-offset-4"
            : ""
        }`}
      >
        {order.map((id) => {
          const product = byId.get(id);
          if (!product) return null;
          const lifted = drag?.id === id;
          return (
            <Card
              key={id}
              ref={(el: HTMLDivElement | null) => {
                if (el) cardRefs.current.set(id, el);
                else cardRefs.current.delete(id);
              }}
              onPointerDown={(event) => {
                if (!sortable || saving || event.button !== 0) return;
                const target = event.target as HTMLElement;
                if (
                  target.closest(
                    "button, a, input, textarea, select, label, [role=switch], [data-no-drag]",
                  )
                )
                  return;
                const el = event.currentTarget as HTMLElement;
                const x = event.clientX;
                const y = event.clientY;
                const timer = window.setTimeout(() => beginDrag(id, el, x, y), LONG_PRESS_MS);
                press.current = { timer, x, y, id, el };
              }}
              onContextMenu={sortable ? (event) => event.preventDefault() : undefined}
              style={sortable ? { WebkitTouchCallout: "none" } : undefined}
              className={`gap-0 overflow-hidden py-0 shadow-card transition-shadow hover:shadow-lift ${
                sortable ? "cursor-grab select-none" : ""
              } ${lifted ? "border-2 border-dashed border-primary/50 opacity-35" : ""}`}
              aria-roledescription={sortable ? "מוצר שניתן לגרור" : undefined}
            >
              {cardBody(product)}
            </Card>
          );
        })}
      </div>

      {drag && ghost && (
        <div
          className="pointer-events-none fixed z-[70]"
          style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width }}
          aria-hidden="true"
        >
          <Card
            className={`gap-0 overflow-hidden py-0 shadow-2xl ${
              drag.outside ? "ring-2 ring-destructive" : "ring-2 ring-primary"
            }`}
            style={{ transform: "rotate(1.5deg) scale(1.03)" }}
          >
            {cardBody(ghost)}
          </Card>
          {drag.outside && (
            <p className="mt-2 rounded-md bg-destructive px-2 py-1 text-center text-xs font-medium text-destructive-foreground">
              מחוץ לקטגוריה — שחרור יבטל את הגרירה
            </p>
          )}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarClock,
  Gift,
  Loader2,
  Package,
  Pencil,
  Plus,
  ShoppingBasket,
  Sparkles,
  Tags,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { CartPromotionCondition } from "@/integrations/supabase/types";
import { useCategoryTree } from "@/hooks/useCategories";
import { CART_PROMOTION_COLUMNS, isPromotionLive, type CartPromotion } from "@/lib/cart-promotions";
import { formatIls } from "@/lib/catalog";
import { ProductPicker } from "@/components/sales/ProductPicker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type ProductBrief = {
  id: string;
  name: string;
  image_url: string | null;
  is_hidden: boolean;
  is_out_of_stock: boolean;
  order_bump_text?: string | null;
};

const BRIEF_COLUMNS = "id, name, image_url, is_hidden, is_out_of_stock" as const;

/** ISO → ערך לשדה datetime-local (שעון מקומי) */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function fromLocalInput(value: string): string | null {
  if (value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });

type Status = { label: string; className: string };
function promotionStatus(p: CartPromotion, now = Date.now()): Status {
  if (!p.is_active) return { label: "כבויה", className: "bg-muted text-muted-foreground" };
  if (p.starts_at && new Date(p.starts_at).getTime() > now) {
    return { label: "מתוזמנת", className: "bg-sky-100 text-sky-800" };
  }
  if (p.ends_at && new Date(p.ends_at).getTime() <= now) {
    return { label: "הסתיימה", className: "bg-muted text-muted-foreground" };
  }
  return { label: "פעילה", className: "bg-green-100 text-green-800" };
}

function conditionText(p: CartPromotion): string {
  return p.condition_type === "min_subtotal"
    ? `קנייה מעל ${formatIls(p.min_subtotal ?? 0)}`
    : `לפחות ${p.min_quantity} יח׳ מ"${p.category}" (כולל תתי-קטגוריות)`;
}

/**
 * פאנל הניהול: הטבות עגלה ("קנה וקבל") ומוצרי קופה.
 * כלל = תנאי (סכום קנייה מינימלי, או כמות מקטגוריה) → מוצר במתנה. המתנה
 * נוספת לסל של הלקוח לבד, יורדת לבד כשהתנאי כבר לא מתקיים, ובשליחת ההזמנה
 * המסד בודק את התנאי שוב ומצרף אותה בחינם.
 */
export function CartPromotionsPanel() {
  const [promotions, setPromotions] = useState<CartPromotion[]>([]);
  const [products, setProducts] = useState<Map<string, ProductBrief>>(new Map());
  const [bumps, setBumps] = useState<ProductBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CartPromotion | "new" | null>(null);
  const [toDelete, setToDelete] = useState<CartPromotion | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: rows, error }, { data: bumpRows }] = await Promise.all([
      supabase
        .from("cart_promotions")
        .select(CART_PROMOTION_COLUMNS)
        .order("sort_order")
        .order("created_at"),
      supabase
        .from("global_products")
        .select(`${BRIEF_COLUMNS}, order_bump_text`)
        .eq("is_order_bump", true)
        .order("name"),
    ]);
    if (error) toast.error(error.message);
    const list = (rows ?? []) as CartPromotion[];
    setPromotions(list);
    setBumps((bumpRows ?? []) as ProductBrief[]);

    const giftIds = [...new Set(list.map((p) => p.gift_product_id))];
    if (giftIds.length > 0) {
      const { data: gifts } = await supabase
        .from("global_products")
        .select(BRIEF_COLUMNS)
        .in("id", giftIds);
      setProducts(new Map(((gifts ?? []) as ProductBrief[]).map((g) => [g.id, g])));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (promotion: CartPromotion, isActive: boolean) => {
    setPromotions((list) =>
      list.map((p) => (p.id === promotion.id ? { ...p, is_active: isActive } : p)),
    );
    const { error } = await supabase
      .from("cart_promotions")
      .update({ is_active: isActive })
      .eq("id", promotion.id);
    if (error) {
      toast.error(error.message);
      void load();
      return;
    }
    toast.success(
      isActive ? `ההטבה "${promotion.name}" הופעלה` : `ההטבה "${promotion.name}" כובתה`,
    );
  };

  const remove = async (promotion: CartPromotion) => {
    const { error } = await supabase.from("cart_promotions").delete().eq("id", promotion.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`ההטבה "${promotion.name}" נמחקה`);
    setPromotions((list) => list.filter((p) => p.id !== promotion.id));
  };

  const unsetBump = async (product: ProductBrief) => {
    const { error } = await supabase
      .from("global_products")
      .update({ is_order_bump: false })
      .eq("id", product.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`"${product.name}" כבר לא מוצע בקופה`);
    setBumps((list) => list.filter((b) => b.id !== product.id));
  };

  const live = promotions.filter((p) => isPromotionLive(p)).length;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl gradient-brand text-primary-foreground">
            <Gift className="size-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">מתנות ומוצרי קופה</h2>
            <p className="text-sm text-muted-foreground">
              הטבות "קנה וקבל" בסל, ומוצרים שמוצעים ללקוח ממש לפני שליחת ההזמנה
            </p>
          </div>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus className="size-4" /> הטבה חדשה
        </Button>
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gift className="size-4" /> מתנות בעגלה ({live} פעילות)
          </CardTitle>
          <CardDescription>
            כשהסל עומד בתנאי — המתנה נוספת אליו לבד עם תגית "מתנה" ובמחיר 0, ויורדת לבד אם הסל כבר
            לא עומד בתנאי. המתנה ניתנת בלי חיוב (גם בלי פיקדון), ושומרת מלאי כמו כל שורה בהזמנה.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> טוען…
            </p>
          ) : promotions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <Gift className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">עוד אין הטבות</p>
              <p className="mt-1 text-xs text-muted-foreground">
                למשל: "בקנייה מעל 300 ₪ — מארז שוקולד במתנה", או "2 יינות = פותחן במתנה".
              </p>
              <Button className="mt-4" variant="outline" onClick={() => setEditing("new")}>
                <Plus className="size-4" /> יצירת ההטבה הראשונה
              </Button>
            </div>
          ) : (
            <ul className="space-y-3">
              {promotions.map((promotion) => {
                const gift = products.get(promotion.gift_product_id);
                const status = promotionStatus(promotion);
                const giftProblem = gift?.is_hidden
                  ? "מוצר המתנה מוסתר — המתנה לא תינתן עד שיחזור לקטלוג"
                  : gift?.is_out_of_stock
                    ? "מוצר המתנה אזל — המתנה לא תינתן עד שיחזור למלאי"
                    : null;
                return (
                  <li
                    key={promotion.id}
                    className={cn(
                      "rounded-lg border border-border p-3 transition-opacity",
                      !promotion.is_active && "opacity-70",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-semibold">{promotion.name}</span>
                        <Badge className={cn("border-0", status.className)}>{status.label}</Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        <Switch
                          checked={promotion.is_active}
                          onCheckedChange={(v) => void toggleActive(promotion, v)}
                          aria-label={`הפעלת ההטבה ${promotion.name}`}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={`עריכת ${promotion.name}`}
                          onClick={() => setEditing(promotion)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8 text-destructive hover:text-destructive"
                          aria-label={`מחיקת ${promotion.name}`}
                          onClick={() => setToDelete(promotion)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                      <p className="flex items-start gap-2">
                        {promotion.condition_type === "min_subtotal" ? (
                          <ShoppingBasket className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <Tags className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span>
                          <span className="text-muted-foreground">תנאי: </span>
                          {conditionText(promotion)}
                        </span>
                      </p>
                      <p className="flex min-w-0 items-center gap-2">
                        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded bg-secondary/60 p-0.5">
                          {gift?.image_url ? (
                            <img
                              src={gift.image_url}
                              alt=""
                              className="size-full object-contain mix-blend-multiply"
                            />
                          ) : (
                            <Package className="size-4 text-muted-foreground" />
                          )}
                        </span>
                        <span className="min-w-0 truncate">
                          <span className="text-muted-foreground">מתנה: </span>
                          {gift?.name ?? "…"}
                          <span className="numeric"> × {promotion.gift_quantity}</span>
                        </span>
                      </p>
                    </div>

                    {(promotion.starts_at || promotion.ends_at) && (
                      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <CalendarClock className="size-3.5" />
                        {promotion.starts_at && `מ-${formatDate(promotion.starts_at)}`}
                        {promotion.starts_at && promotion.ends_at && " "}
                        {promotion.ends_at && `עד ${formatDate(promotion.ends_at)}`}
                      </p>
                    )}
                    {giftProblem && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                        <TriangleAlert className="size-3.5 shrink-0" />
                        {giftProblem}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4" /> מוצרי קופה ({bumps.length})
          </CardTitle>
          <CardDescription>
            מוצר קופה מוצע בסל, ממש לפני שליחת ההזמנה, בתיבת סימון אחת. ההצעה הראשונה שעוד לא בסל של
            הלקוח (ושיש לה מחיר עבורו) — היא שמוצגת. מסמנים מוצר כמוצר קופה בעריכת המוצר (ניהול →
            מוצרים וקטגוריות).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bumps.length === 0 ? (
            <p className="text-sm text-muted-foreground">עוד לא סומנו מוצרי קופה.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {bumps.map((product) => (
                <li key={product.id} className="flex items-center gap-3 p-3">
                  <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-secondary/60 p-1">
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt=""
                        className="size-full object-contain mix-blend-multiply"
                      />
                    ) : (
                      <Package className="size-4 text-muted-foreground" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{product.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {product.order_bump_text?.trim() || "טקסט ברירת מחדל"}
                      {(product.is_hidden || product.is_out_of_stock) && (
                        <span className="text-amber-700">
                          {" "}
                          · {product.is_hidden ? "מוסתר" : "אזל"} — לא מוצע כרגע
                        </span>
                      )}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => void unsetBump(product)}>
                    הסרה מהקופה
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <PromotionDialog
        // מפתח לפי ההטבה — כל פתיחה מתחילה מהערכים שלה
        key={editing === null ? "closed" : editing === "new" ? "new" : editing.id}
        promotion={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את ההטבה "{toDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              לקוחות לא יקבלו יותר את המתנה. הזמנות שכבר נשלחו עם המתנה לא משתנות. אם רוצים להפסיק
              רק לזמן מה — עדיף לכבות את ההטבה.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (toDelete) void remove(toDelete);
                setToDelete(null);
              }}
            >
              מחיקה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

type PromotionForm = {
  name: string;
  conditionType: CartPromotionCondition;
  minSubtotal: string;
  category: string;
  minQuantity: string;
  giftIds: string[];
  giftQuantity: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};

function formFrom(promotion: CartPromotion | null): PromotionForm {
  return {
    name: promotion?.name ?? "",
    conditionType: promotion?.condition_type ?? "min_subtotal",
    minSubtotal: promotion?.min_subtotal != null ? String(promotion.min_subtotal) : "",
    category: promotion?.category ?? "",
    minQuantity: promotion?.min_quantity != null ? String(promotion.min_quantity) : "2",
    giftIds: promotion ? [promotion.gift_product_id] : [],
    giftQuantity: String(promotion?.gift_quantity ?? 1),
    startsAt: toLocalInput(promotion?.starts_at ?? null),
    endsAt: toLocalInput(promotion?.ends_at ?? null),
    isActive: promotion?.is_active ?? true,
  };
}

function validate(form: PromotionForm): string | null {
  if (form.name.trim() === "") return "נא לתת להטבה שם (הלקוח רואה אותו בסל)";
  if (form.name.trim().length > 80) return "שם ההטבה ארוך מדי (עד 80 תווים)";
  if (form.conditionType === "min_subtotal") {
    const amount = Number(form.minSubtotal);
    if (form.minSubtotal.trim() === "" || !Number.isFinite(amount) || amount <= 0) {
      return "נא להזין סכום קנייה מינימלי (מספר חיובי)";
    }
  } else {
    if (form.category === "") return "נא לבחור קטגוריה";
    const qty = Number(form.minQuantity);
    if (!Number.isInteger(qty) || qty < 1) return "כמות מינימלית: מספר שלם, 1 ומעלה";
  }
  if (form.giftIds.length === 0) return "נא לבחור את מוצר המתנה";
  const giftQty = Number(form.giftQuantity);
  if (!Number.isInteger(giftQty) || giftQty < 1 || giftQty > 100) {
    return "כמות המתנה: מספר שלם בין 1 ל-100";
  }
  const starts = fromLocalInput(form.startsAt);
  const ends = fromLocalInput(form.endsAt);
  if (starts && ends && new Date(ends) <= new Date(starts)) {
    return "תאריך הסיום חייב להיות אחרי תאריך ההתחלה";
  }
  return null;
}

/** יצירה / עריכה של הטבת עגלה */
function PromotionDialog({
  promotion,
  onClose,
  onSaved,
}: {
  promotion: CartPromotion | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = promotion !== null && promotion !== "new" ? promotion : null;
  const [form, setForm] = useState<PromotionForm>(() => formFrom(existing));
  const [busy, setBusy] = useState(false);
  const tree = useCategoryTree();
  const categories = useMemo(() => tree.flat, [tree]);
  const patch = (next: Partial<PromotionForm>) => setForm((current) => ({ ...current, ...next }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validate(form);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    const bySubtotal = form.conditionType === "min_subtotal";
    const payload = {
      name: form.name.trim(),
      is_active: form.isActive,
      condition_type: form.conditionType,
      min_subtotal: bySubtotal ? Number(form.minSubtotal) : null,
      category: bySubtotal ? null : form.category,
      min_quantity: bySubtotal ? null : Number(form.minQuantity),
      gift_product_id: form.giftIds[0]!,
      gift_quantity: Number(form.giftQuantity),
      starts_at: fromLocalInput(form.startsAt),
      ends_at: fromLocalInput(form.endsAt),
    };
    const { error } = existing
      ? await supabase.from("cart_promotions").update(payload).eq("id", existing.id)
      : await supabase.from("cart_promotions").insert(payload);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(existing ? "ההטבה עודכנה" : "ההטבה נוצרה");
    onSaved();
  };

  return (
    <Dialog open={promotion !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto text-right sm:max-w-lg">
        <DialogHeader className="text-right">
          <DialogTitle>{existing ? "עריכת הטבה" : "הטבה חדשה — קנה וקבל"}</DialogTitle>
          <DialogDescription>
            כשהסל של הלקוח עומד בתנאי, המוצר שתבחרו נוסף אליו במתנה, בחינם.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="promo-name">שם ההטבה (מוצג ללקוח בסל)</Label>
            <Input
              id="promo-name"
              maxLength={80}
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="למשל: מתנה בקנייה מעל 300 ₪"
            />
          </div>

          <fieldset className="space-y-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold">מתי מקבלים את המתנה?</legend>
            <RadioGroup
              dir="rtl"
              value={form.conditionType}
              onValueChange={(v) => patch({ conditionType: v as CartPromotionCondition })}
              className="gap-2"
            >
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="min_subtotal" /> כשסכום הקנייה עובר סכום מסוים
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="category_quantity" /> כשקונים כמות מסוימת מקטגוריה
              </label>
            </RadioGroup>

            {form.conditionType === "min_subtotal" ? (
              <div className="space-y-1.5 sm:max-w-56">
                <Label htmlFor="promo-min">סכום קנייה מינימלי (₪)</Label>
                <Input
                  id="promo-min"
                  type="number"
                  min={1}
                  step="any"
                  dir="ltr"
                  className="numeric"
                  value={form.minSubtotal}
                  onChange={(e) => patch({ minSubtotal: e.target.value })}
                  placeholder="300"
                />
                <p className="text-xs text-muted-foreground">
                  לפי סכום המוצרים בסל, בלי פיקדון ובלי המתנות עצמן.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                <div className="space-y-1.5">
                  <Label>קטגוריה</Label>
                  <Select value={form.category} onValueChange={(v) => patch({ category: v })}>
                    <SelectTrigger dir="rtl">
                      <SelectValue placeholder="בחירת קטגוריה" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      {categories.map((node) => (
                        <SelectItem key={node.name} value={node.name}>
                          {"  ".repeat(node.depth - 1)}
                          {node.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="promo-qty">לפחות (יח׳)</Label>
                  <Input
                    id="promo-qty"
                    type="number"
                    min={1}
                    step="1"
                    dir="ltr"
                    className="numeric"
                    value={form.minQuantity}
                    onChange={(e) => patch({ minQuantity: e.target.value })}
                  />
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  נספרות יחידות מהקטגוריה ומכל תתי-הקטגוריות שלה.
                </p>
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold">מה מקבלים?</legend>
            <ProductPicker
              mode="single"
              value={form.giftIds}
              onChange={(giftIds) => patch({ giftIds })}
              placeholder="חיפוש מוצר המתנה"
            />
            <div className="space-y-1.5 sm:max-w-40">
              <Label htmlFor="promo-gift-qty">כמות במתנה (יח׳)</Label>
              <Input
                id="promo-gift-qty"
                type="number"
                min={1}
                max={100}
                step="1"
                dir="ltr"
                className="numeric"
                value={form.giftQuantity}
                onChange={(e) => patch({ giftQuantity: e.target.value })}
              />
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold">תוקף (לא חובה)</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="promo-start">מתאריך</Label>
                <Input
                  id="promo-start"
                  type="datetime-local"
                  dir="ltr"
                  value={form.startsAt}
                  onChange={(e) => patch({ startsAt: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-end">עד תאריך</Label>
                <Input
                  id="promo-end"
                  type="datetime-local"
                  dir="ltr"
                  value={form.endsAt}
                  onChange={(e) => patch({ endsAt: e.target.value })}
                />
              </div>
            </div>
            <label className="flex items-center justify-between gap-2 text-sm font-medium">
              ההטבה פעילה
              <Switch checked={form.isActive} onCheckedChange={(v) => patch({ isActive: v })} />
            </label>
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {existing ? "שמירת השינויים" : "יצירת ההטבה"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              ביטול
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Minus, Package, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryBrowser } from "@/components/CategoryBrowser";
import { useCategoryTree } from "@/hooks/useCategories";
import { countByCategory, subtreeNames, totalCounts } from "@/lib/category-tree";
import { CatalogGrid } from "@/components/CatalogGrid";
import {
  formatIls,
  isSaleActive,
  PRICE_TIER_FIELD,
  STAFF_CATALOG_COLUMNS,
  type CatalogItem,
  type GlobalProduct,
} from "@/lib/catalog";
import { calculateVat, DEFAULT_VAT_RATE } from "@/lib/vat";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { ORDER_CREATE_STATUSES, ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/orders";
import { sendOrderEmails } from "@/lib/email.functions";
import { fetchAllRows } from "@/lib/fetch-all";

type CustomerOption = {
  user_id: string;
  label: string;
  price_tier: number | null;
  /** 'custom' = מחירון אישי (מחירים מ-user_custom_prices גוברים על הדרג) */
  price_list_type: string;
};
type CartRow = {
  productId: string;
  name: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  /** שורת פיקדון נלווית על אותו מוצר, מתעדכנת אוטומטית עם הכמות */
  isDeposit?: boolean;
  /** מוצר שנמכר במארזים — +/− קופצים במארז; צוות יכול להקליד כל כמות (חריגה) */
  packSize?: number | null;
};

/**
 * יצירת הזמנה ידנית ע"י מנהל/סוכן בשם לקוח — למשל כשהסוכן עומד ליד הלקוח
 * (בטלפון או בביקור) ובונה איתו את ההזמנה. אחרי בחירת לקוח נפתח קטלוג
 * מלא עם תמונות וקטגוריות, בדיוק כמו שהלקוח היה רואה בעצמו — כדי שיהיה
 * אפשר להראות ללקוח ולתת לו לבחור, ולא רק לחפש טקסט.
 */
export function CreateOrderDialog({
  scope,
  onCreated,
}: {
  scope: "agent" | "admin";
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<GlobalProduct[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [status, setStatus] = useState<OrderStatus>("pending");
  const [term, setTerm] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartRow[]>([]);
  /** מחירים אישיים של הלקוח הנבחר (רק אם הוא במחירון אישי) — productId → מחיר */
  const [customPrices, setCustomPrices] = useState<Map<string, number>>(new Map());
  const sendEmails = useServerFn(sendOrderEmails);
  const { settings } = useSiteSettings();

  useEffect(() => {
    if (!open) return;
    void (async () => {
      setLoading(true);
      const [profilesResult, rolesResult, productsResult] = await Promise.all([
        supabase
          .from("customer_profiles")
          .select("user_id, business_name, price_tier, price_list_type"),
        supabase.from("user_roles").select("user_id, email"),
        fetchAllRows((from, to) =>
          supabase
            .from("global_products")
            .select(STAFF_CATALOG_COLUMNS)
            .eq("is_hidden", false)
            .order("name")
            .order("id")
            .range(from, to),
        ),
      ]);
      const emailByUser = new Map(
        ((rolesResult.data ?? []) as { user_id: string; email: string }[]).map((r) => [
          r.user_id,
          r.email,
        ]),
      );
      setCustomers(
        (
          (profilesResult.data ?? []) as {
            user_id: string;
            business_name: string | null;
            price_tier: number | null;
            price_list_type: string | null;
          }[]
        ).map((p) => ({
          user_id: p.user_id,
          label: p.business_name || emailByUser.get(p.user_id) || p.user_id,
          price_tier: p.price_tier,
          price_list_type: p.price_list_type ?? "regular",
        })),
      );
      setProducts((productsResult.data as GlobalProduct[] | null) ?? []);
      setLoading(false);
    })();
  }, [open]);

  const reset = () => {
    setCustomerId("");
    setStatus("pending");
    setTerm("");
    setCategory(null);
    setCart([]);
  };

  const selectedCustomer = customers.find((c) => c.user_id === customerId) ?? null;
  const selectedHasCustomList = selectedCustomer?.price_list_type === "custom";

  // מחירון אישי: טוענים את הדריסות של הלקוח הנבחר. מחליפים לקוח → מחירים
  // מתעדכנים; לקוח במחירון רגיל → אין דריסות (גם אם נשמרו לו מחירים בעבר)
  useEffect(() => {
    if (!customerId || !selectedHasCustomList) {
      setCustomPrices(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await fetchAllRows((from, to) =>
        supabase
          .from("user_custom_prices")
          .select("product_id, custom_price")
          .eq("user_id", customerId)
          .order("product_id")
          .range(from, to),
      );
      if (cancelled) return;
      if (error) toast.error("טעינת המחירון האישי נכשלה — מוצגים מחירים רגילים");
      setCustomPrices(
        new Map(
          ((data ?? []) as { product_id: string; custom_price: number }[]).map((row) => [
            row.product_id,
            Number(row.custom_price),
          ]),
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, selectedHasCustomList]);

  /** מחיר הדרג הבסיסי של הלקוח הנבחר, לפני הנחת מבצע */
  const tierPriceFor = (product: GlobalProduct): number => {
    const tier = selectedCustomer?.price_tier;
    const field = tier === 1 || tier === 2 || tier === 3 ? PRICE_TIER_FIELD[tier] : "price_tier1";
    return Number(product[field] ?? 0);
  };

  /** המחיר הבסיסי ללקוח: מחיר אישי אם נקבע לו, אחרת מחיר הדרג */
  const basePriceFor = (product: GlobalProduct): number =>
    customPrices.get(product.id) ?? tierPriceFor(product);

  /** מבצע כללי חל רק כשהוא באמת זול מהמחיר הבסיסי (כמו בשרת) */
  const saleAppliesFor = (product: GlobalProduct): boolean =>
    isSaleActive(product) && Number(product.sale_price) < basePriceFor(product);

  const priceFor = (product: GlobalProduct): number =>
    saleAppliesFor(product) ? Number(product.sale_price) : basePriceFor(product);

  // החלפת לקוח (או טעינת המחירון האישי שלו) — מתמחרים מחדש את שורות הסל
  useEffect(() => {
    setCart((current) =>
      current.map((row) => {
        if (row.isDeposit) return row;
        const product = products.find((p) => p.id === row.productId);
        return product ? { ...row, unitPrice: priceFor(product) } : row;
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customPrices, selectedCustomer?.price_tier]);

  /** סכום הפיקדון למארז אחד: מחיר ליחידה × כמות יחידות במארז */
  const depositFor = (product: GlobalProduct): number =>
    product.has_deposit && product.deposit_price && product.deposit_units
      ? product.deposit_price * product.deposit_units
      : 0;

  const addToCart = (product: GlobalProduct, quantity = 1) => {
    setCart((current) => {
      const existing = current.find((c) => c.productId === product.id && !c.isDeposit);
      if (existing) {
        return current.map((c) =>
          c.productId === product.id ? { ...c, quantity: c.quantity + quantity } : c,
        );
      }
      const rows: CartRow[] = [
        {
          productId: product.id,
          name: product.name,
          imageUrl: product.image_url,
          unitPrice: priceFor(product),
          quantity,
          packSize: product.pack_size ?? null,
        },
      ];
      if (product.has_deposit) {
        rows.push({
          productId: product.id,
          name: `פיקדון – ${product.name}`,
          imageUrl: null,
          unitPrice: depositFor(product),
          quantity,
          isDeposit: true,
        });
      }
      return [...current, ...rows];
    });
    toast.success(
      quantity > 1
        ? `${quantity} × "${product.name}" נוספו להזמנה`
        : `"${product.name}" נוסף להזמנה`,
    );
  };

  /** שינוי כמות: משנה גם את שורת הפיקדון הנלווית (אותו productId), אם קיימת */
  const changeCartQuantity = (index: number, delta: number) => {
    const row = cart[index];
    if (!row) return;
    const step = row.packSize && row.packSize >= 2 ? row.packSize : 1;
    setCartQuantity(index, row.quantity + delta * step);
  };

  /** כמות מדויקת ביחידות — גם שורת הפיקדון הנלווית מתעדכנת */
  const setCartQuantity = (index: number, value: number) => {
    setCart((current) => {
      const row = current[index];
      if (!row) return current;
      const nextQuantity = Math.max(1, Math.min(99999, Math.floor(value) || 1));
      return current.map((r, i) => {
        if (i === index) return { ...r, quantity: nextQuantity };
        if (!row.isDeposit && r.productId === row.productId && r.isDeposit) {
          return { ...r, quantity: nextQuantity };
        }
        return r;
      });
    });
  };

  /** מחיקת שורה: מחיקת המוצר הראשי מוחקת גם את שורת הפיקדון הנלווית */
  const removeCartRow = (index: number) => {
    setCart((current) => {
      const row = current[index];
      if (!row) return current;
      if (row.isDeposit) return current.filter((_, i) => i !== index);
      return current.filter((r) => !(r.productId === row.productId));
    });
  };

  const total = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const vat = calculateVat(total, {
    pricesIncludeVat: settings?.prices_include_vat ?? true,
    vatRate: Number(settings?.vat_rate ?? DEFAULT_VAT_RATE),
  });

  const categoryTree = useCategoryTree();
  const categoryCounts = useMemo(
    () => totalCounts(categoryTree, countByCategory(products)),
    [categoryTree, products],
  );
  const inCategory = useMemo(
    () => (category === null ? null : subtreeNames(categoryTree, category)),
    [categoryTree, category],
  );

  const query = term.trim().toLowerCase();
  const filteredProducts = products.filter(
    (p) =>
      (inCategory === null || inCategory.has(p.category)) &&
      (query === "" ||
        p.name.toLowerCase().includes(query) ||
        p.sku.includes(query) ||
        (p.barcode ?? "").includes(query)),
  );

  /** התאמה לצורת CatalogItem כדי לעשות שימוש חוזר ברשת הקטלוג הציבורית */
  const catalogItems: CatalogItem[] = useMemo(
    () =>
      filteredProducts.map((p) => {
        const sale = saleAppliesFor(p);
        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          description: p.description ?? null,
          image_url: p.image_url,
          images: p.images ?? null,
          colors: p.colors ?? null,
          barcode: p.barcode ?? null,
          // "מבצע" כאן פירושו שהוא בפועל בתוקף עכשיו, לא רק שסומן ככה אי-פעם
          is_promo: (p.is_promo ?? false) && sale,
          is_out_of_stock: p.is_out_of_stock,
          price: priceFor(p),
          original_price: sale ? basePriceFor(p) : null,
          sale_ends_at: sale ? (p.sale_ends_at ?? null) : null,
          has_deposit: p.has_deposit ?? false,
          deposit_price: p.deposit_price ?? null,
          deposit_units: p.deposit_units ?? null,
          pack_size: p.pack_size ?? null,
          min_order_quantity: p.min_order_quantity ?? null,
          created_at: "",
          is_custom_price: !sale && customPrices.has(p.id),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredProducts, selectedCustomer?.price_tier, customPrices],
  );

  const handleAddFromCatalog = (item: CatalogItem, quantity = 1) => {
    const product = products.find((p) => p.id === item.id);
    if (product) addToCart(product, quantity);
  };

  const submit = async () => {
    if (!customerId) {
      toast.error("יש לבחור לקוח");
      return;
    }
    if (cart.length === 0) {
      toast.error("יש להוסיף לפחות מוצר אחד");
      return;
    }
    setBusy(true);
    const { data: order, error } = await supabase
      .from("orders")
      .insert({
        customer_id: customerId,
        status,
        kind: "order",
        total: 0,
        vat_rate: Number(settings?.vat_rate ?? DEFAULT_VAT_RATE),
        prices_include_vat: settings?.prices_include_vat ?? true,
      })
      .select("id, order_number")
      .single();
    if (error || !order) {
      setBusy(false);
      toast.error(error?.message ?? "יצירת ההזמנה נכשלה");
      return;
    }
    const { error: itemsError } = await supabase.from("order_items").insert(
      cart.map((item) => ({
        order_id: order.id,
        product_id: item.productId,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        is_deposit: item.isDeposit ?? false,
      })),
    );
    setBusy(false);
    if (itemsError) {
      toast.error(itemsError.message);
      return;
    }
    toast.success(`ההזמנה ${order.order_number} נוצרה`);
    reset();
    setOpen(false);
    onCreated();
    try {
      await sendEmails({ data: { orderId: order.id } });
    } catch {
      // כשל שליחת מייל אינו מבטל את ההזמנה
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <ShoppingCart className="size-4" />
          הזמנה חדשה
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="flex max-h-[92vh] flex-col text-right sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>יצירת הזמנה ידנית</DialogTitle>
          <DialogDescription>
            בחרו לקוח, ואז דפדפו בקטלוג והוסיפו מוצרים — בדיוק כמו שהלקוח היה עושה בעצמו
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">טוען...</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            <div className="space-y-2">
              <Label>לקוח</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger dir="rtl">
                  <SelectValue placeholder="בחרו לקוח" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {customers.map((c) => (
                    <SelectItem key={c.user_id} value={c.user_id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedHasCustomList && (
                <p className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                  ללקוח זה מחירון אישי — מוצגים המחירים האישיים שלו ({customPrices.size} מוצרים),
                  ושאר המוצרים במחיר הרגיל.
                </p>
              )}
              {customers.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {scope === "agent" ? "אין עדיין לקוחות משויכים אליך" : "אין עדיין לקוחות במערכת"}
                </p>
              )}
            </div>

            {customerId && (
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[1fr_320px]">
                {/* ---------- קטלוג לדפדוף, בדיוק כמו שהלקוח רואה ---------- */}
                <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
                  <CategoryBrowser
                    variant="compact"
                    tree={categoryTree}
                    value={category}
                    onChange={setCategory}
                    counts={categoryCounts}
                    totalCount={products.length}
                    hideEmpty={false}
                    toolbar={
                      <Input
                        value={term}
                        onChange={(e) => setTerm(e.target.value)}
                        placeholder={
                          category ? `חיפוש בתוך ${category}` : "חיפוש לפי שם, מקט או ברקוד"
                        }
                        className="w-56"
                      />
                    }
                  >
                    <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-secondary/30 p-3">
                      <CatalogGrid
                        products={catalogItems}
                        canAdd
                        addLabel="הוספה"
                        onAddToCart={handleAddFromCatalog}
                        emptyText="לא נמצאו מוצרים"
                      />
                    </div>
                  </CategoryBrowser>
                </div>

                {/* ---------- סל ההזמנה של הסוכן ---------- */}
                <div className="flex min-h-0 flex-col gap-3 overflow-hidden rounded-lg border border-border p-3">
                  <p className="text-sm font-bold text-foreground">פריטים בהזמנה ({cart.length})</p>
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                    {cart.length === 0 ? (
                      <p className="py-8 text-center text-xs text-muted-foreground">
                        הוסיפו מוצרים מהקטלוג משמאל
                      </p>
                    ) : (
                      cart.map((item, index) => (
                        <div
                          key={`${item.productId}-${item.isDeposit ? "deposit" : "main"}`}
                          className="space-y-1.5 rounded-lg border border-border p-2"
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary">
                              {item.imageUrl ? (
                                <img
                                  src={item.imageUrl}
                                  alt=""
                                  className="size-full object-cover"
                                />
                              ) : (
                                <Package className="size-3.5 text-muted-foreground" />
                              )}
                            </div>
                            <span
                              title={item.name}
                              className="line-clamp-2 min-w-0 flex-1 break-words text-xs font-bold leading-snug"
                            >
                              {item.name}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-6 text-destructive hover:text-destructive"
                              onClick={() => removeCartRow(index)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="icon"
                              variant="outline"
                              className="size-6"
                              onClick={() => changeCartQuantity(index, -1)}
                            >
                              <Minus className="size-3" />
                            </Button>
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              aria-label={`כמות ביחידות של ${item.name}`}
                              className="numeric h-6 w-14 px-1 text-center text-xs font-bold"
                              value={item.quantity}
                              onChange={(e) => setCartQuantity(index, Number(e.target.value))}
                            />
                            <Button
                              size="icon"
                              variant="outline"
                              className="size-6"
                              onClick={() => changeCartQuantity(index, 1)}
                            >
                              <Plus className="size-3" />
                            </Button>
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              className="h-6 flex-1 px-1.5 text-center text-xs"
                              value={item.unitPrice}
                              onChange={(e) =>
                                setCart((c) =>
                                  c.map((r, i) =>
                                    i === index
                                      ? {
                                          ...r,
                                          unitPrice: Math.max(0, Number(e.target.value) || 0),
                                        }
                                      : r,
                                  ),
                                )
                              }
                            />
                          </div>
                          {!item.isDeposit && item.packSize && item.packSize >= 2 && (
                            <p
                              className={`text-[11px] ${
                                item.quantity % item.packSize === 0
                                  ? "text-muted-foreground"
                                  : "font-semibold text-destructive"
                              }`}
                            >
                              {item.quantity % item.packSize === 0
                                ? `${item.quantity / item.packSize} מארזים של ${item.packSize}`
                                : `לא כפולה של מארז ${item.packSize} — חריגה ידנית (רק לצוות)`}
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  <div className="space-y-2 border-t border-border pt-2">
                    <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus)}>
                      <SelectTrigger dir="rtl" className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent dir="rtl">
                        {ORDER_CREATE_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {ORDER_STATUS_LABEL[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <div className="space-y-1 text-sm">
                      {vat.showBreakdown && (
                        <>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>לפני מע״מ</span>
                            <span className="numeric">{formatIls(vat.net)}</span>
                          </div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>מע״מ {vat.vatRate}%</span>
                            <span className="numeric">{formatIls(vat.vat)}</span>
                          </div>
                        </>
                      )}
                      <div className="flex items-center justify-between font-medium">
                        <span>סה״כ</span>
                        <span className="numeric text-lg font-bold text-accent">
                          {formatIls(vat.gross)}
                        </span>
                      </div>
                    </div>

                    <Button size="lg" className="w-full" disabled={busy} onClick={submit}>
                      {busy && <Loader2 className="size-4 animate-spin" />}
                      {busy ? "יוצר..." : "יצירת הזמנה"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

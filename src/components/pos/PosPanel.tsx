import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  ClipboardList,
  Loader2,
  Percent,
  Receipt,
  RefreshCw,
  Store,
  Truck,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PosCustomerSection } from "@/components/pos/PosCustomerSection";
import {
  PosProductSection,
  type PosProductSectionHandle,
} from "@/components/pos/PosProductSection";
import { useLiftA11yButton } from "@/hooks/useLiftA11yButton";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { formatIls } from "@/lib/catalog";
import { sendOrderEmails } from "@/lib/email.functions";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/orders";
import {
  EMPTY_CUSTOMER_FORM,
  GUEST_PRICING,
  POS_MAX_LINES,
  POS_PAYMENT_LABEL,
  POS_PAYMENT_METHODS,
  clampQuantity,
  customerFormFrom,
  lineKey,
  parseManualDiscount,
  posDraftProblems,
  posOrderPayload,
  posTotals,
  posUnitPrice,
  type ManualDiscountType,
  type PosCartLine,
  type PosCustomer,
  type PosCustomerForm,
  type PosDraft,
  type PosPaymentMethod,
  type PosPricing,
  type PosProduct,
  type PosShippingChoice,
  type PosVariant,
} from "@/lib/pos";
import {
  createPosOrder,
  loadPosCatalog,
  loadPosCustomPrices,
  loadPosShippingMethods,
  type CreatedPosOrder,
  type PosShippingMethod,
} from "@/lib/pos-data";
import { loadSerialProducts } from "@/lib/serials-data";
import { calculateVat, vatTotalCaption } from "@/lib/vat";
import { cn } from "@/lib/utils";

const IN_STORE = "in_store";

type CreatedSummary = CreatedPosOrder & {
  customerName: string;
  email: string;
  paymentLabel: string;
  inStore: boolean;
};

/**
 * קופה מהירה (/admin/orders/new → ?tab=pos): הזמנה טלפונית או מכירה בחנות
 * בכמה לחיצות. לקוח (קיים / אורח) → מוצרים (חיפוש / ברקוד) → מסירה,
 * תשלום והנחה → "יצירת הזמנה". ההזמנה נוצרת במסד כמו כל הזמנה: מספר,
 * מלאי, מתנות, התראות, ומיילים (אישור ללקוח + התראה לצוות).
 */
export function PosPanel({
  onOpenOrder,
}: {
  /** "פתיחת ההזמנה" אחרי היצירה — רק למי שרואה הזמנות (חלק 33: לא לקופאי) */
  onOpenOrder?: (orderId: string) => void;
}) {
  const { settings } = useSiteSettings();
  const [products, setProducts] = useState<PosProduct[] | null>(null);
  const [methods, setMethods] = useState<PosShippingMethod[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [form, setForm] = useState<PosCustomerForm>(EMPTY_CUSTOMER_FORM);
  const [pricing, setPricing] = useState<PosPricing>(GUEST_PRICING);
  const [lines, setLines] = useState<PosCartLine[]>([]);
  const [shippingId, setShippingId] = useState<string>(IN_STORE);
  const [payment, setPayment] = useState<PosPaymentMethod>("cash");
  const [paid, setPaid] = useState(true);
  const [discountType, setDiscountType] = useState<ManualDiscountType>("fixed");
  const [discountText, setDiscountText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [created, setCreated] = useState<CreatedSummary | null>(null);
  const productSection = useRef<PosProductSectionHandle>(null);
  /** הלקוח שהמחירון האישי שלו בטעינה — כדי שטעינה ישנה לא תדרוס לקוח שהוחלף */
  const pricingFor = useRef<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const sendEmails = useServerFn(sendOrderEmails);
  useLiftA11yButton();

  // חלק 35: המוצרים שדורשים מספר סידורי לכל יחידה
  const [serialProducts, setSerialProducts] = useState<ReadonlySet<string>>(new Set());

  const loadCatalog = useCallback(async () => {
    setReloading(true);
    try {
      const [catalog, shipping] = await Promise.all([loadPosCatalog(), loadPosShippingMethods()]);
      setProducts(catalog);
      setMethods(shipping);
      void loadSerialProducts()
        .then((rows) => setSerialProducts(new Set(rows.map((row) => row.product_id))))
        .catch(() => setSerialProducts(new Set()));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "טעינת הקטלוג נכשלה");
    } finally {
      setReloading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const productsById = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product])),
    [products],
  );

  const catalogPrice = useCallback(
    (product: PosProduct, variant: PosVariant | null) => posUnitPrice(product, variant, pricing),
    [pricing],
  );

  // לקוח אחר (או המחירון האישי שלו נטען) — מתמחרים מחדש את מה שלא שונה ידנית
  useEffect(() => {
    setLines((current) =>
      current.map((line) => {
        if (line.priceEdited) return line;
        const product = productsById.get(line.productId);
        if (!product) return line;
        const variant = product.variants.find((v) => v.id === line.variantId) ?? null;
        const unitPrice = posUnitPrice(product, variant, pricing);
        return unitPrice === line.unitPrice ? line : { ...line, unitPrice };
      }),
    );
  }, [pricing, productsById]);

  const selectCustomer = (picked: PosCustomer) => {
    setForm(customerFormFrom(picked));
    if (picked.kind === "guest" || !picked.customer_id) {
      // קונה קודם שהזמין כאורח — ממלאים את הפרטים, וממשיכים כאורח
      pricingFor.current = null;
      setCustomer(null);
      setPricing(GUEST_PRICING);
      return;
    }
    const id = picked.customer_id;
    pricingFor.current = id;
    setCustomer(picked);
    setPricing({ tier: picked.price_tier, customPrices: null });
    if (picked.price_list_type === "custom") {
      loadPosCustomPrices(id)
        .then((prices) => {
          if (pricingFor.current === id) {
            setPricing({ tier: picked.price_tier, customPrices: prices });
          }
        })
        .catch(() => toast.error("טעינת המחירון האישי נכשלה — מוצגים המחירים הרגילים"));
    }
  };

  const clearCustomer = () => {
    pricingFor.current = null;
    setCustomer(null);
    setForm(EMPTY_CUSTOMER_FORM);
    setPricing(GUEST_PRICING);
  };

  const addProduct = (product: PosProduct, picked: PosVariant | null) => {
    // מוצר עם אפשרות אחת בלבד — נבחרת אוטומטית
    const active = product.variants.filter((v) => v.is_active);
    const variant = picked ?? (active.length === 1 ? (active[0] ?? null) : null);
    const key = lineKey(product.id, variant?.id ?? null);
    setLines((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing) {
        return current.map((line) =>
          line.key === key ? { ...line, quantity: clampQuantity(line.quantity + 1) } : line,
        );
      }
      if (current.length >= POS_MAX_LINES) {
        toast.error(`עד ${POS_MAX_LINES} שורות בהזמנה אחת`);
        return current;
      }
      return [
        ...current,
        {
          key,
          productId: product.id,
          variantId: variant?.id ?? null,
          quantity: 1,
          unitPrice: posUnitPrice(product, variant, pricing),
          priceEdited: false,
        },
      ];
    });
    toast.success(`"${product.name}" נוסף להזמנה`, { duration: 1500 });
  };

  const updateLine = (key: string, change: (line: PosCartLine) => PosCartLine) =>
    setLines((current) => current.map((line) => (line.key === key ? change(line) : line)));

  const setLineVariant = (key: string, variantId: string) =>
    setLines((current) => {
      const line = current.find((l) => l.key === key);
      if (!line) return current;
      const product = productsById.get(line.productId);
      const variant = product?.variants.find((v) => v.id === variantId) ?? null;
      if (!product || !variant) return current;
      const nextKey = lineKey(product.id, variant.id);
      const twin = current.find((l) => l.key === nextKey && l.key !== key);
      if (twin) {
        // אותה אפשרות כבר בעגלה — מאחדים את השורות
        return current
          .filter((l) => l.key !== key)
          .map((l) =>
            l.key === nextKey ? { ...l, quantity: clampQuantity(l.quantity + line.quantity) } : l,
          );
      }
      return current.map((l) =>
        l.key === key
          ? {
              ...l,
              key: nextKey,
              variantId: variant.id,
              unitPrice: l.priceEdited ? l.unitPrice : posUnitPrice(product, variant, pricing),
            }
          : l,
      );
    });

  const method = methods.find((m) => m.id === shippingId) ?? null;
  const shipping: PosShippingChoice = method
    ? { methodId: method.id, kind: method.kind, price: method.price }
    : { methodId: null, kind: null, price: 0 };
  const parsedDiscount = parseManualDiscount(discountType, discountText);
  const totals = posTotals(
    lines,
    productsById,
    shipping,
    parsedDiscount.discount,
    settings?.free_shipping_threshold ?? null,
  );
  const vatRate = settings?.business_type === "exempt" ? 0 : Number(settings?.vat_rate ?? 18);
  const vat = calculateVat(totals.total, {
    pricesIncludeVat: settings?.prices_include_vat ?? true,
    vatRate,
  });

  const draft: PosDraft = {
    customerId: customer?.customer_id ?? null,
    form,
    lines,
    shipping,
    payment,
    paid,
    discount: parsedDiscount.discount,
    note,
  };
  const problems = [
    ...posDraftProblems(draft, productsById, serialProducts),
    ...(parsedDiscount.problem ? [parsedDiscount.problem] : []),
  ];

  const reset = () => {
    clearCustomer();
    setLines([]);
    setShippingId(IN_STORE);
    setPayment("cash");
    setPaid(true);
    setDiscountType("fixed");
    setDiscountText("");
    setNote("");
    setShowProblems(false);
  };

  const submit = async () => {
    if (busy) return;
    setShowProblems(true);
    if (problems.length > 0) {
      toast.error(problems[0]);
      summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy(true);
    try {
      const order = await createPosOrder(posOrderPayload(draft));
      const paymentLabel =
        payment === "later"
          ? POS_PAYMENT_LABEL.later
          : paid
            ? `שולם · ${POS_PAYMENT_LABEL[payment]}`
            : `לתשלום · ${POS_PAYMENT_LABEL[payment]}`;
      setCreated({
        ...order,
        customerName: form.name.trim() || customer?.name || "",
        email: form.email.trim() || customer?.email || "",
        paymentLabel,
        inStore: shipping.methodId === null,
      });
      // מיילים (אישור ללקוח + התראה לצוות + מלאי נמוך) — כמו בכל הזמנה; כשל לא מבטל
      void sendEmails({ data: { orderId: order.id } }).catch(() => undefined);
      // המלאי השתנה — מרעננים את הקטלוג ברקע
      void loadCatalog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "יצירת ההזמנה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const pricingNote =
    customer && customer.price_list_type === "custom"
      ? pricing.customPrices
        ? `מחירון אישי — ${pricing.customPrices.size} מוצרים במחיר מיוחד, השאר במחיר הרגיל`
        : "טוען את המחירון האישי…"
      : customer && customer.price_tier !== 1
        ? `מחירון דרג ${customer.price_tier}`
        : null;

  if (loadError && products === null) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="space-y-3 py-8 text-center text-sm">
          <p className="text-destructive">{loadError}</p>
          <Button variant="outline" onClick={() => void loadCatalog()}>
            <RefreshCw className="size-4" />
            ניסיון נוסף
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <section
      className="space-y-5 pb-24 lg:pb-0"
      aria-labelledby="pos-title"
      data-testid="pos-panel"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id="pos-title" className="flex items-center gap-2 text-2xl font-bold">
            <Receipt className="size-6 text-primary" aria-hidden="true" />
            קופה מהירה
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            הזמנה טלפונית או מכירה בחנות: בחרו לקוח, הוסיפו מוצרים (גם בסריקת ברקוד), אופן מסירה
            ותשלום. ההזמנה נשמרת כמו כל הזמנה באתר — המלאי מתעדכן, ונשלחים מייל אישור ללקוח והתראה
            לצוות.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadCatalog()}
          disabled={reloading}
          aria-label="רענון הקטלוג והמלאי"
        >
          <RefreshCw className={cn("size-4", reloading && "animate-spin")} aria-hidden="true" />
          רענון מלאי
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0 space-y-5">
          <PosCustomerSection
            customer={customer}
            form={form}
            onFormChange={setForm}
            onSelect={selectCustomer}
            onClear={clearCustomer}
            needsAddress={shipping.kind === "delivery"}
            pricingNote={pricingNote}
          />
          {products === null ? (
            <div className="h-48 animate-pulse rounded-xl bg-muted" aria-label="טוען את הקטלוג" />
          ) : (
            <PosProductSection
              ref={productSection}
              products={products}
              productsById={productsById}
              lines={lines}
              onAdd={addProduct}
              onQuantity={(key, quantity) =>
                updateLine(key, (line) => {
                  const next = clampQuantity(quantity);
                  // פחות יחידות — המספרים הסידוריים העודפים (האחרונים שנסרקו) יורדים
                  return {
                    ...line,
                    quantity: next,
                    ...(line.serials && line.serials.length > next
                      ? { serials: line.serials.slice(0, next) }
                      : {}),
                  };
                })
              }
              onPrice={(key, price) =>
                updateLine(key, (line) => ({ ...line, unitPrice: price, priceEdited: true }))
              }
              onResetPrice={(key) =>
                updateLine(key, (line) => {
                  const product = productsById.get(line.productId);
                  if (!product) return line;
                  const variant = product.variants.find((v) => v.id === line.variantId) ?? null;
                  return {
                    ...line,
                    unitPrice: posUnitPrice(product, variant, pricing),
                    priceEdited: false,
                  };
                })
              }
              onVariant={setLineVariant}
              onRemove={(key) => setLines((current) => current.filter((line) => line.key !== key))}
              catalogPrice={catalogPrice}
              serialProducts={serialProducts}
              onSerials={(key, serials) => updateLine(key, (line) => ({ ...line, serials }))}
              inStore={shipping.methodId === null}
            />
          )}
        </div>

        <aside
          ref={summaryRef}
          className="space-y-4 lg:sticky lg:top-[calc(var(--site-header-h,0px)+1rem)]"
          aria-label="סיכום ההזמנה"
        >
          <Card className="shadow-card" data-testid="pos-summary">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  3
                </span>
                מסירה, תשלום וסיכום
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <fieldset className="space-y-2">
                <legend className="mb-1.5 text-sm font-semibold">אופן מסירה</legend>
                <div className="grid gap-2" role="radiogroup" aria-label="אופן מסירה">
                  <ChoiceButton
                    selected={shippingId === IN_STORE}
                    onClick={() => setShippingId(IN_STORE)}
                    icon={<Store className="size-4" aria-hidden="true" />}
                    title="מכירה בחנות"
                    subtitle="הלקוח קיבל את המוצרים — ההזמנה נסגרת כ״נמסרה״"
                    testId="pos-ship-in-store"
                  />
                  {methods.map((m) => (
                    <ChoiceButton
                      key={m.id}
                      selected={shippingId === m.id}
                      onClick={() => setShippingId(m.id)}
                      icon={
                        m.kind === "pickup" ? (
                          <Warehouse className="size-4" aria-hidden="true" />
                        ) : (
                          <Truck className="size-4" aria-hidden="true" />
                        )
                      }
                      title={m.name}
                      subtitle={`${m.price > 0 ? formatIls(m.price) : "חינם"}${m.kind === "pickup" ? " · איסוף" : " · עד הבית"}`}
                      testId="pos-ship-method"
                    />
                  ))}
                </div>
                {methods.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    למשלוחים — הגדירו שיטות משלוח בלשונית &quot;משלוחים&quot;.
                  </p>
                )}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="mb-1.5 text-sm font-semibold">אמצעי תשלום</legend>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="אמצעי תשלום">
                  {POS_PAYMENT_METHODS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={payment === option.value}
                      onClick={() => setPayment(option.value)}
                      data-testid={`pos-pay-${option.value}`}
                      className={cn(
                        "rounded-lg border px-2 py-2 text-sm transition-colors",
                        payment === option.value
                          ? "border-primary bg-primary/10 font-semibold text-primary"
                          : "border-border hover:bg-secondary",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {payment !== "later" && (
                  <label className="flex items-center gap-2 pt-1 text-sm">
                    <Checkbox
                      checked={paid}
                      onCheckedChange={(value) => setPaid(value === true)}
                      data-testid="pos-paid"
                    />
                    התשלום התקבל ({POS_PAYMENT_LABEL[payment]})
                  </label>
                )}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="mb-1.5 text-sm font-semibold">הנחה להזמנה</legend>
                <div className="flex gap-2">
                  <div
                    className="flex shrink-0 overflow-hidden rounded-lg border border-border"
                    role="radiogroup"
                    aria-label="סוג ההנחה"
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={discountType === "fixed"}
                      aria-label="הנחה בשקלים"
                      onClick={() => setDiscountType("fixed")}
                      className={cn(
                        "flex w-10 items-center justify-center text-sm font-semibold",
                        discountType === "fixed"
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-secondary",
                      )}
                    >
                      ₪
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={discountType === "percent"}
                      aria-label="הנחה באחוזים"
                      onClick={() => setDiscountType("percent")}
                      data-testid="pos-discount-percent"
                      className={cn(
                        "flex w-10 items-center justify-center border-s border-border text-sm",
                        discountType === "percent"
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-secondary",
                      )}
                    >
                      <Percent className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  <Input
                    value={discountText}
                    onChange={(event) => setDiscountText(event.target.value)}
                    inputMode="decimal"
                    placeholder={discountType === "percent" ? "למשל 10 (%)" : "למשל 20 (₪)"}
                    aria-label={discountType === "percent" ? "הנחה באחוזים" : "הנחה בשקלים"}
                    className="numeric"
                    data-testid="pos-discount"
                  />
                </div>
                {parsedDiscount.problem && (
                  <p className="text-xs text-destructive">{parsedDiscount.problem}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  על המוצרים בלבד (בלי משלוח ופיקדון). מופיעה ללקוח במייל ובמסמך ההזמנה.
                </p>
              </fieldset>

              <div className="space-y-1.5">
                <Label htmlFor="pos-note" className="text-sm font-semibold">
                  הערה להזמנה
                </Label>
                <Textarea
                  id="pos-note"
                  value={note}
                  maxLength={1000}
                  rows={2}
                  placeholder="למשל: לתאם משלוח אחרי 17:00"
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>

              <dl
                className="space-y-1.5 border-t border-border pt-4 text-sm"
                data-testid="pos-totals"
              >
                <SummaryRow
                  label={`מוצרים (${totals.units} יח׳)`}
                  value={formatIls(totals.products)}
                />
                {totals.deposits > 0 && (
                  <SummaryRow label="פיקדון" value={formatIls(totals.deposits)} />
                )}
                {shipping.methodId !== null && (
                  <SummaryRow
                    label={totals.freeShipping ? "משלוח (חינם — מעל סף המשלוח החינם)" : "משלוח"}
                    value={totals.shipping > 0 ? formatIls(totals.shipping) : "חינם"}
                  />
                )}
                {totals.discount > 0 && (
                  <SummaryRow
                    label={
                      parsedDiscount.discount?.type === "percent"
                        ? `הנחה ${parsedDiscount.discount.value}%`
                        : "הנחה"
                    }
                    value={`-${formatIls(totals.discount)}`}
                    tone="discount"
                  />
                )}
                {vat.showBreakdown && (
                  <>
                    <SummaryRow label="לפני מע״מ" value={formatIls(vat.net)} muted />
                    <SummaryRow label={`מע״מ ${vat.vatRate}%`} value={formatIls(vat.vat)} muted />
                  </>
                )}
                <div className="flex items-baseline justify-between pt-1">
                  <dt className="font-semibold">סה״כ לתשלום</dt>
                  <dd className="numeric text-2xl font-bold text-accent" data-testid="pos-total">
                    {formatIls(vat.gross)}
                  </dd>
                </div>
                <p className="text-end text-xs text-muted-foreground">
                  {vatTotalCaption(vat, settings?.business_type)}
                </p>
              </dl>

              {showProblems && problems.length > 0 && (
                <ul
                  role="alert"
                  className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
                  data-testid="pos-problems"
                >
                  {problems.map((problem) => (
                    <li key={problem}>• {problem}</li>
                  ))}
                </ul>
              )}

              <Button
                size="lg"
                className="w-full"
                onClick={() => void submit()}
                disabled={busy || products === null}
                data-testid="pos-submit"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                )}
                {busy ? "יוצר הזמנה…" : `יצירת הזמנה · ${formatIls(vat.gross)}`}
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* טלפון / טאבלט: הסכום והכפתור תמיד בתחתית המסך */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-border bg-card/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur lg:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {lines.length === 0 ? "העגלה ריקה" : `${totals.units} יח׳ · ${lines.length} מוצרים`}
          </p>
          <p className="numeric text-lg font-bold text-accent">{formatIls(vat.gross)}</p>
        </div>
        <Button
          onClick={() => void submit()}
          disabled={busy || products === null}
          data-testid="pos-submit-mobile"
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          יצירת הזמנה
        </Button>
      </div>

      <Dialog
        open={created !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreated(null);
            reset();
            window.setTimeout(() => productSection.current?.focusSearch(), 50);
          }
        }}
      >
        <DialogContent dir="rtl" className="text-right sm:max-w-md" data-testid="pos-created">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" />
              ההזמנה נוצרה
            </DialogTitle>
            <DialogDescription>
              מספר הזמנה{" "}
              <span
                dir="ltr"
                className="numeric font-semibold text-foreground"
                data-testid="pos-created-number"
              >
                {created?.order_number}
              </span>
            </DialogDescription>
          </DialogHeader>
          {created && (
            <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
              <dl className="space-y-1.5">
                {created.customerName && <SummaryRow label="לקוח" value={created.customerName} />}
                <SummaryRow
                  label="סטטוס"
                  value={ORDER_STATUS_LABEL[created.status as OrderStatus] ?? created.status}
                />
                <SummaryRow label="תשלום" value={created.paymentLabel} />
                <SummaryRow
                  label="סכום ההזמנה"
                  value={formatIls(
                    calculateVat(created.total, {
                      pricesIncludeVat: settings?.prices_include_vat ?? true,
                      vatRate,
                    }).gross,
                  )}
                />
              </dl>
              <p className="text-xs text-muted-foreground">
                {created.email
                  ? `אישור הזמנה נשלח ל-${created.email}.`
                  : "לא הוזן אימייל — לא נשלח אישור ללקוח."}{" "}
                {created.inStore
                  ? "המלאי עודכן והמכירה נסגרה."
                  : onOpenOrder
                    ? "ההזמנה ממתינה לטיפול ברשימת ההזמנות."
                    : "ההזמנה הועברה לטיפול הצוות."}
              </p>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button
              onClick={() => {
                setCreated(null);
                reset();
                window.setTimeout(() => productSection.current?.focusSearch(), 50);
              }}
              data-testid="pos-new-order"
            >
              הזמנה חדשה
            </Button>
            {onOpenOrder && (
              <Button
                variant="outline"
                onClick={() => {
                  const id = created?.id;
                  setCreated(null);
                  reset();
                  if (id) onOpenOrder(id);
                }}
                data-testid="pos-open-order"
              >
                <ClipboardList className="size-4" aria-hidden="true" />
                פתיחת ההזמנה
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ChoiceButton({
  selected,
  onClick,
  icon,
  title,
  subtitle,
  testId,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-start transition-colors",
        selected ? "border-primary bg-primary/10" : "border-border hover:bg-secondary",
      )}
    >
      <span className={cn("mt-0.5", selected ? "text-primary" : "text-muted-foreground")}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm", selected && "font-semibold text-primary")}>
          {title}
        </span>
        <span className="block text-xs text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  );
}

function SummaryRow({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: string;
  tone?: "discount";
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3",
        muted && "text-xs text-muted-foreground",
      )}
    >
      <dt>{label}</dt>
      <dd
        className={cn(
          "numeric",
          tone === "discount" && "font-semibold text-emerald-700 dark:text-emerald-400",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

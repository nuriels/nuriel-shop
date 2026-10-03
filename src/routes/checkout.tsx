import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  Building2,
  CircleAlert,
  Loader2,
  MapPin,
  MessageSquareText,
  PackageCheck,
  Plus,
  ShieldCheck,
  ShoppingCart,
  Truck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { AccountNotice } from "@/components/AccountNotice";
import { MaintenanceScreen } from "@/components/MaintenanceScreen";
import { OnboardingGate } from "@/components/OnboardingGate";
import { CheckoutField, fieldA11y } from "@/components/checkout/CheckoutField";
import { CheckoutSummary } from "@/components/checkout/CheckoutSummary";
import { CheckoutSuccess, type PlacedOrder } from "@/components/checkout/CheckoutSuccess";
import { OrderBumpOffer } from "@/components/sales/OrderBumpOffer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuthState } from "@/hooks/useAuthState";
import { useCart } from "@/hooks/useCart";
import { useCategoryTree } from "@/hooks/useCategories";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { clearStoredCart, useCartSync } from "@/hooks/useCartSync";
import { formatIls, minimumQuantity, minOrderMessage, type CatalogItem } from "@/lib/catalog";
import { addToCartItems, syncCartWithCatalog } from "@/lib/cart";
import { cartDepositTotal, cartMinimum, cartMinUnits, cartStep, cartTotal } from "@/lib/orders";
import {
  cartSubtotal,
  evaluateCartPromotions,
  freeShippingProgress,
  pickOrderBump,
} from "@/lib/cart-promotions";
import { subtreeNames } from "@/lib/category-tree";
import { fetchAllRows } from "@/lib/fetch-all";
import { EMPTY_SALES, loadSalesData, type SalesData } from "@/lib/sales-data";
import { calculateVat, DEFAULT_VAT_RATE } from "@/lib/vat";
import {
  EMPTY_CHECKOUT_FORM,
  NOTE_MAX,
  checkoutPayload,
  orderLinesFromCart,
  validateCheckoutForm,
  type CheckoutErrors,
  type CheckoutForm,
} from "@/lib/checkout";
import { formatAddress } from "@/lib/order-details";
import { placeGuestOrder, updateMyDetails } from "@/lib/checkout.functions";
import { sendOrderEmails } from "@/lib/email.functions";

export const Route = createFileRoute("/checkout")({
  ssr: false,
  head: () => ({ meta: [{ title: "קופה" }, { name: "robots", content: "noindex" }] }),
  component: CheckoutPage,
});

/** סדר השדות בטופס — אליו גוללים כשיש שגיאה */
const FIELD_ORDER: (keyof CheckoutForm)[] = [
  "customerName",
  "customerTaxId",
  "customerPhone",
  "customerEmail",
  "billingCity",
  "billingAddress",
  "billingZip",
  "shippingName",
  "shippingPhone",
  "shippingCity",
  "shippingAddress",
  "shippingZip",
  "note",
  "acceptedTerms",
];

const FIELD_ID: Record<keyof CheckoutForm, string> = {
  customerName: "co-name",
  customerTaxId: "co-tax",
  customerPhone: "co-phone",
  customerEmail: "co-email",
  billingCity: "co-city",
  billingAddress: "co-address",
  billingZip: "co-zip",
  shipToDifferent: "co-ship-toggle",
  shippingName: "co-ship-name",
  shippingPhone: "co-ship-phone",
  shippingCity: "co-ship-city",
  shippingAddress: "co-ship-address",
  shippingZip: "co-ship-zip",
  note: "co-note",
  acceptedTerms: "co-terms",
};

/**
 * הקופה: פרטי המזמין (שם / חברה, ת.ז / ח.פ, טלפון, אימייל), כתובת, אפשרות
 * "שלח לכתובת אחרת", הערות ואישור תנאים — ושליחה. אורח מזמין בלי הרשמה;
 * לקוח רשום מקבל את הפרטים ממולאים מהאזור האישי (ויכול לשמור שינויים).
 * כל השדות נבדקים שוב במסד, והמחירים / המלאי / המתנות נקבעים שם.
 */
function CheckoutPage() {
  const { session, role, loading: authLoading, refreshRole } = useAuthState();
  const { settings } = useSiteSettings();
  const { cart, setCart, ready: cartReady } = useCart();
  const categoryTree = useCategoryTree();
  const placeGuest = useServerFn(placeGuestOrder);
  const saveDetails = useServerFn(updateMyDetails);
  const sendEmails = useServerFn(sendOrderEmails);

  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [sales, setSales] = useState<SalesData>(EMPTY_SALES);
  const [form, setForm] = useState<CheckoutForm>(EMPTY_CHECKOUT_FORM);
  const [attempted, setAttempted] = useState(false);
  const [saveToProfile, setSaveToProfile] = useState(true);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [bumpKeepId, setBumpKeepId] = useState<string | null>(null);
  const prefilledFor = useRef<string | null | undefined>(undefined);

  const isCustomer = role?.role === "customer";
  const isStaff = role !== null && !isCustomer;
  const signedIn = session !== null;

  // לקוח רשום שנכנס ישר לקופה (מכשיר אחר / קישור): הסל השמור שלו מהשרת,
  // ושינויים כאן (כמויות, מוצר קופה) נשמרים גם בשרת
  useCartSync({
    userId: isCustomer ? (role?.user_id ?? null) : null,
    cart,
    setCart,
    enabled: isCustomer && cartReady,
  });

  // ---------- הקטלוג העדכני: מחירים (לפי מי שמחובר), זמינות, הטבות ----------
  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    const [{ data, error }, salesData] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .rpc("get_catalog")
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      loadSalesData(),
    ]);
    if (error) toast.error(error.message);
    setProducts((data as CatalogItem[]) ?? []);
    setSales(salesData);
    setCatalogLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    void loadCatalog();
  }, [authLoading, loadCatalog, session?.user?.id]);

  const catalogById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const subtree = useCallback((name: string) => subtreeNames(categoryTree, name), [categoryTree]);
  const priced = catalogLoading || products.some((product) => product.price !== null);
  const kind: "order" | "quote" = priced ? "order" : "quote";

  // הסל מול הקטלוג: מוצר שאזל / הוסר יוצא (עם הודעה), מחירים ומארזים מתעדכנים
  useEffect(() => {
    if (catalogLoading || products.length === 0 || cart.length === 0 || placed) return;
    const synced = syncCartWithCatalog(cart, catalogById);
    if (synced.items === cart) return;
    setCart(synced.items);
    if (synced.unavailable.length > 0) {
      toast.warning(
        `הוסרו מההזמנה מוצרים שאינם זמינים כרגע: ${synced.unavailable.map((item) => item.name).join(", ")}`,
      );
    }
    if (synced.adjusted) toast.info("עדכנו כמויות לפי גודל המארז / המינימום להזמנה");
  }, [catalogLoading, products, cart, catalogById, placed, setCart]);

  // ---------- מילוי אוטומטי: לקוח רשום — מהפרופיל ומהחשבון ----------
  useEffect(() => {
    if (authLoading) return;
    const userId = isCustomer ? (role?.user_id ?? null) : null;
    if (prefilledFor.current === userId) return;
    prefilledFor.current = userId;
    if (!userId) return;
    const accountEmail = session?.user.email ?? role?.email ?? "";
    void (async () => {
      const { data } = await supabase
        .from("customer_profiles")
        .select("business_name, contact_name, tax_id, phone, business_address, city, zip_code")
        .eq("user_id", userId)
        .maybeSingle();
      // רק שדות שהלקוח עוד לא התחיל למלא — לא דורסים הקלדה
      setForm((current) => ({
        ...current,
        customerName: current.customerName || data?.business_name || "",
        customerTaxId: current.customerTaxId || data?.tax_id || "",
        customerPhone: current.customerPhone || data?.phone || "",
        customerEmail: current.customerEmail || accountEmail,
        billingCity: current.billingCity || data?.city || "",
        billingAddress: current.billingAddress || data?.business_address || "",
        billingZip: current.billingZip || data?.zip_code || "",
      }));
    })();
  }, [authLoading, isCustomer, role?.user_id, role?.email, session?.user.email]);

  // ---------- הסכומים, מתנות, משלוח חינם, מוצר קופה ----------
  const vat = calculateVat(cartTotal(cart), {
    pricesIncludeVat: settings?.prices_include_vat ?? true,
    vatRate: Number(settings?.vat_rate ?? DEFAULT_VAT_RATE),
  });
  const grandTotal = vat.gross + cartDepositTotal(cart);
  const promotions = useMemo(
    () =>
      kind === "order"
        ? evaluateCartPromotions({
            items: cart,
            promotions: sales.promotions,
            catalogById,
            subtree,
          })
        : { gifts: [], hints: [] },
    [kind, cart, sales.promotions, catalogById, subtree],
  );
  const shipping =
    kind === "order"
      ? freeShippingProgress(cartSubtotal(cart), settings?.free_shipping_threshold)
      : null;
  const cartIds = useMemo(() => new Set(cart.map((item) => item.productId)), [cart]);
  const bump =
    kind === "order" && cart.length > 0
      ? pickOrderBump({ bumps: sales.bumps, catalogById, cartIds, keepId: bumpKeepId })
      : null;

  const toggleBump = (next: boolean) => {
    if (!bump) return;
    if (next) {
      setCart(
        (current) => addToCartItems(current, bump.product, minimumQuantity(bump.product)).items,
      );
      setBumpKeepId(bump.product.id);
    } else {
      setCart((current) => current.filter((item) => item.productId !== bump.product.id));
    }
  };

  const changeQuantity = (productId: string, delta: number) => {
    const line = cart.find((item) => item.productId === productId);
    if (!line) return;
    const floor = cartMinimum(line);
    const next = line.quantity + delta * cartStep(line);
    if (next < floor && cartMinUnits(line) > 1) toast.info(minOrderMessage(floor));
    setCart((current) =>
      current.map((item) =>
        item.productId === productId ? { ...item, quantity: Math.max(floor, next) } : item,
      ),
    );
  };
  const removeItem = (productId: string) =>
    setCart((current) => current.filter((item) => item.productId !== productId));

  // ---------- הטופס ----------
  const errors: CheckoutErrors = attempted
    ? validateCheckoutForm(form, { requireEmail: !signedIn })
    : {};
  const patch = (next: Partial<CheckoutForm>) => setForm((current) => ({ ...current, ...next }));
  const text = (key: keyof CheckoutForm) => ({
    value: form[key] as string,
    onChange: (event: { target: { value: string } }) =>
      patch({ [key]: event.target.value } as Partial<CheckoutForm>),
    ...fieldA11y(FIELD_ID[key], errors[key]),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setSubmitError(null);
    const found = validateCheckoutForm(form, { requireEmail: !signedIn });
    const firstInvalid = FIELD_ORDER.find((key) => found[key]);
    if (firstInvalid) {
      const element = document.getElementById(FIELD_ID[firstInvalid]);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      element?.focus({ preventScroll: true });
      toast.error("נא להשלים את הפרטים המסומנים");
      return;
    }
    if (cart.length === 0) return;
    const tooFew = cart.find((item) => item.quantity < cartMinimum(item));
    if (tooFew) {
      toast.error(`${tooFew.name}: ${minOrderMessage(cartMinimum(tooFew))}`, { duration: 8000 });
      return;
    }

    setBusy(true);
    const lines = orderLinesFromCart(cart, kind);
    const details = checkoutPayload(form);
    const delivery = form.shipToDifferent
      ? formatAddress(form.shippingAddress, form.shippingCity, form.shippingZip)
      : formatAddress(form.billingAddress, form.billingCity, form.billingZip);
    try {
      let result: PlacedOrder;
      if (isCustomer && role) {
        // לקוח רשום: ההזמנה נוצרת בחיבור שלו (RLS), עם פרטי הקופה
        const { data, error } = await supabase.rpc("place_order", {
          _kind: kind,
          _items: lines,
          _vat_rate: Number(settings?.vat_rate ?? DEFAULT_VAT_RATE),
          _prices_include_vat: settings?.prices_include_vat ?? true,
          _details: details,
        });
        const order = data?.[0];
        if (error || !order) throw new Error(error?.message ?? "שליחת ההזמנה נכשלה");

        let gifts: string[] = [];
        if (order.kind === "order") {
          const { data: giftRows } = await supabase
            .from("order_items")
            .select("product_name, quantity")
            .eq("order_id", order.id)
            .eq("is_gift", true);
          gifts = (giftRows ?? []).map((row) =>
            row.quantity > 1 ? `${row.product_name} × ${row.quantity}` : (row.product_name ?? ""),
          );
        }
        // "לשמור לפעם הבאה" — הפרטים לפרופיל (לא חוסם את ההזמנה)
        if (saveToProfile) {
          void saveDetails({
            data: {
              businessName: form.customerName,
              contactName: "",
              taxId: form.customerTaxId,
              phone: form.customerPhone,
              city: form.billingCity,
              address: form.billingAddress,
              zipCode: form.billingZip,
            },
          }).catch(() => undefined);
        }
        void sendEmails({ data: { orderId: order.id } }).catch(() => undefined);
        await clearStoredCart(role.user_id).catch(() => undefined);
        result = {
          orderNumber: order.order_number,
          isQuote: order.kind === "quote",
          gifts,
          deliveryLine: delivery,
          alternateDelivery: form.shipToDifferent,
          email: details.customer_email || session?.user.email || "",
          guest: false,
        };
      } else {
        // אורח: בלי חשבון — ההזמנה נוצרת בשרת (הגבלת קצב + בדיקות במסד)
        const order = await placeGuest({ data: { kind, items: lines, details } });
        result = {
          orderNumber: order.orderNumber,
          isQuote: order.kind === "quote",
          gifts: order.gifts,
          deliveryLine: delivery,
          alternateDelivery: form.shipToDifferent,
          email: details.customer_email,
          guest: true,
        };
      }
      setCart([]);
      setPlaced(result);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : "שליחת ההזמנה נכשלה";
      setSubmitError(message);
      toast.error(message, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  // ---------- מסכים מיוחדים ----------
  const header = <SiteHeader role={role} email={session?.user.email ?? null} onSignOut={signOut} />;

  if (settings?.maintenance_mode && !isStaff) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <MaintenanceScreen {...(session ? { onSignOut: signOut } : {})} />
        <AppFooter />
      </div>
    );
  }
  if (role?.is_blocked) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader role={null} email={null} />
        <AccountNotice variant="blocked" email={session?.user.email ?? ""} onSignOut={signOut} />
        <AppFooter />
      </div>
    );
  }
  if (isCustomer && role?.must_change_password) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        {header}
        <OnboardingGate
          userId={role.user_id}
          email={role.email}
          mustChangePassword
          onDone={() => void refreshRole()}
        />
        <AppFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {header}
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-6 sm:px-4 sm:py-8">
        {placed ? (
          <CheckoutSuccess order={placed} />
        ) : authLoading || !cartReady ? (
          <p className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> טוען את הקופה…
          </p>
        ) : isStaff ? (
          <Card className="mx-auto max-w-xl border-dashed">
            <CardContent className="space-y-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                הקופה מיועדת ללקוחות. להזמנה עבור לקוח — "הזמנה חדשה" במסך ההזמנות.
              </p>
              <Button asChild>
                <Link to={role?.role === "agent" ? "/agent" : "/admin"} search={{ tab: "orders" }}>
                  למסך ההזמנות
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : cart.length === 0 ? (
          <Card className="mx-auto max-w-xl border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <ShoppingCart className="size-9 text-muted-foreground" aria-hidden="true" />
              <p className="font-medium text-foreground">הסל ריק</p>
              <p className="text-sm text-muted-foreground">הוסיפו מוצרים מהקטלוג וחזרו לקופה.</p>
              <Button asChild>
                <Link to="/">לקטלוג המוצרים</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="mb-6 space-y-2">
              <Link
                to="/"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowRight className="size-4" aria-hidden="true" />
                חזרה לקטלוג
              </Link>
              <h1 className="font-display text-2xl text-foreground sm:text-3xl">
                {kind === "quote" ? "שליחת בקשה להצעת מחיר" : "קופה"}
              </h1>
              <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                {signedIn ? (
                  <>הפרטים מולאו מהאזור האישי — אפשר לשנות לפני השליחה.</>
                ) : (
                  <>
                    אין צורך בהרשמה — ממלאים פרטים ושולחים.{" "}
                    <Link to="/login" className="font-medium text-primary hover:underline">
                      יש לכם חשבון? התחברו
                    </Link>{" "}
                    והפרטים ימולאו לבד.
                  </>
                )}
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
              <form noValidate onSubmit={submit} className="order-2 space-y-5 lg:order-1">
                {/* ---------- פרטי המזמין ---------- */}
                <Card className="shadow-card">
                  <CardContent className="space-y-4 pt-6">
                    <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                      <Building2 className="size-5 text-accent" aria-hidden="true" />
                      פרטי המזמין
                    </h2>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <CheckoutField
                        id={FIELD_ID.customerName}
                        label="שם מלא / שם חברה"
                        required
                        error={errors.customerName}
                      >
                        <Input autoComplete="name" maxLength={120} {...text("customerName")} />
                      </CheckoutField>
                      <CheckoutField
                        id={FIELD_ID.customerTaxId}
                        label="ת.ז / ח.פ"
                        required
                        error={errors.customerTaxId}
                      >
                        <Input
                          inputMode="numeric"
                          dir="ltr"
                          autoComplete="off"
                          maxLength={20}
                          className="text-right"
                          {...text("customerTaxId")}
                        />
                      </CheckoutField>
                      <CheckoutField
                        id={FIELD_ID.customerPhone}
                        label="טלפון"
                        required
                        error={errors.customerPhone}
                      >
                        <Input
                          type="tel"
                          inputMode="tel"
                          dir="ltr"
                          autoComplete="tel"
                          maxLength={20}
                          className="text-right"
                          {...text("customerPhone")}
                        />
                      </CheckoutField>
                      <CheckoutField
                        id={FIELD_ID.customerEmail}
                        label="אימייל"
                        required={!signedIn}
                        error={errors.customerEmail}
                        hint={
                          signedIn
                            ? "אישור ההזמנה יישלח לכתובת הזו"
                            : "לכאן יישלח אישור ההזמנה עם כל הפרטים"
                        }
                      >
                        <Input
                          type="email"
                          dir="ltr"
                          autoComplete="email"
                          maxLength={254}
                          className="text-right"
                          {...text("customerEmail")}
                        />
                      </CheckoutField>
                    </div>
                  </CardContent>
                </Card>

                {/* ---------- כתובת ---------- */}
                <Card className="shadow-card">
                  <CardContent className="space-y-4 pt-6">
                    <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                      <MapPin className="size-5 text-accent" aria-hidden="true" />
                      כתובת
                    </h2>
                    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_9rem]">
                      <CheckoutField
                        id={FIELD_ID.billingCity}
                        label="עיר"
                        required
                        error={errors.billingCity}
                      >
                        <Input
                          autoComplete="address-level2"
                          maxLength={80}
                          {...text("billingCity")}
                        />
                      </CheckoutField>
                      <CheckoutField
                        id={FIELD_ID.billingAddress}
                        label="כתובת (רחוב ומספר)"
                        required
                        error={errors.billingAddress}
                      >
                        <Input
                          autoComplete="street-address"
                          maxLength={200}
                          {...text("billingAddress")}
                        />
                      </CheckoutField>
                      <CheckoutField
                        id={FIELD_ID.billingZip}
                        label="מיקוד"
                        required
                        error={errors.billingZip}
                      >
                        <Input
                          inputMode="numeric"
                          dir="ltr"
                          autoComplete="postal-code"
                          maxLength={9}
                          className="text-right"
                          {...text("billingZip")}
                        />
                      </CheckoutField>
                    </div>

                    {/* ---------- "שלח לכתובת אחרת" ---------- */}
                    {!form.shipToDifferent ? (
                      <button
                        type="button"
                        id={FIELD_ID.shipToDifferent}
                        onClick={() => patch({ shipToDifferent: true })}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 px-4 py-3.5 text-sm font-bold text-primary transition-colors hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Plus className="size-4" aria-hidden="true" />
                        שלח לכתובת אחרת
                      </button>
                    ) : (
                      <section
                        aria-label="כתובת למשלוח"
                        className="space-y-4 rounded-xl border-2 border-amber-400 bg-amber-50/60 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="flex items-center gap-2 font-bold text-amber-950">
                              <Truck className="size-4" aria-hidden="true" />
                              משלוח לכתובת אחרת
                            </h3>
                            <p className="text-xs text-amber-900/80">
                              ההזמנה תישלח לכתובת הזו — וזו הכתובת שתופיע אצלנו בהזמנה.
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="shrink-0 text-amber-950 hover:bg-amber-100"
                            onClick={() => patch({ shipToDifferent: false })}
                          >
                            <X className="size-4" aria-hidden="true" />
                            ביטול
                          </Button>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <CheckoutField
                            id={FIELD_ID.shippingName}
                            label="שם המקבל"
                            required
                            error={errors.shippingName}
                          >
                            <Input
                              autoComplete="shipping name"
                              maxLength={120}
                              className="bg-white"
                              {...text("shippingName")}
                            />
                          </CheckoutField>
                          <CheckoutField
                            id={FIELD_ID.shippingPhone}
                            label="טלפון המקבל"
                            error={errors.shippingPhone}
                            hint="לא חובה — אחרת ניצור קשר בטלפון שלמעלה"
                          >
                            <Input
                              type="tel"
                              inputMode="tel"
                              dir="ltr"
                              autoComplete="shipping tel"
                              maxLength={20}
                              className="bg-white text-right"
                              {...text("shippingPhone")}
                            />
                          </CheckoutField>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_9rem]">
                          <CheckoutField
                            id={FIELD_ID.shippingCity}
                            label="עיר"
                            required
                            error={errors.shippingCity}
                          >
                            <Input
                              autoComplete="shipping address-level2"
                              maxLength={80}
                              className="bg-white"
                              {...text("shippingCity")}
                            />
                          </CheckoutField>
                          <CheckoutField
                            id={FIELD_ID.shippingAddress}
                            label="כתובת (רחוב ומספר)"
                            required
                            error={errors.shippingAddress}
                          >
                            <Input
                              autoComplete="shipping street-address"
                              maxLength={200}
                              className="bg-white"
                              {...text("shippingAddress")}
                            />
                          </CheckoutField>
                          <CheckoutField
                            id={FIELD_ID.shippingZip}
                            label="מיקוד"
                            required
                            error={errors.shippingZip}
                          >
                            <Input
                              inputMode="numeric"
                              dir="ltr"
                              autoComplete="shipping postal-code"
                              maxLength={9}
                              className="bg-white text-right"
                              {...text("shippingZip")}
                            />
                          </CheckoutField>
                        </div>
                      </section>
                    )}
                  </CardContent>
                </Card>

                {/* ---------- הערות ---------- */}
                <Card className="shadow-card">
                  <CardContent className="space-y-3 pt-6">
                    <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                      <MessageSquareText className="size-5 text-accent" aria-hidden="true" />
                      הערות להזמנה
                    </h2>
                    <CheckoutField
                      id={FIELD_ID.note}
                      label="הערות (לא חובה)"
                      error={errors.note}
                      hint={`למשל: שעות קבלה, קומה, קוד לשער · ${form.note.length}/${NOTE_MAX}`}
                    >
                      <Textarea rows={3} maxLength={NOTE_MAX} {...text("note")} />
                    </CheckoutField>
                  </CardContent>
                </Card>

                {/* ---------- אישורים ושליחה ---------- */}
                <div className="space-y-4">
                  {isCustomer && (
                    <label className="flex items-start gap-2 text-sm text-foreground">
                      <Checkbox
                        checked={saveToProfile}
                        onCheckedChange={(value) => setSaveToProfile(value === true)}
                        className="mt-0.5"
                      />
                      <span>לשמור את הפרטים באזור האישי — הם ימולאו לבד בפעם הבאה</span>
                    </label>
                  )}
                  <div className="space-y-1">
                    <label className="flex items-start gap-2 text-sm text-foreground">
                      <Checkbox
                        id={FIELD_ID.acceptedTerms}
                        checked={form.acceptedTerms}
                        onCheckedChange={(value) => patch({ acceptedTerms: value === true })}
                        aria-invalid={errors.acceptedTerms ? true : undefined}
                        className="mt-0.5"
                      />
                      <span>
                        {(settings?.sells_alcohol ?? false) && "אני מאשר/ת שגילי 18 ומעלה, ו"}
                        קראתי ואני מסכים/ה ל
                        <Link to="/terms" target="_blank" className="text-primary hover:underline">
                          תנאי השימוש
                        </Link>{" "}
                        ול
                        <Link
                          to="/privacy"
                          target="_blank"
                          className="text-primary hover:underline"
                        >
                          מדיניות הפרטיות
                        </Link>
                        .
                      </span>
                    </label>
                    {errors.acceptedTerms && (
                      <p role="alert" className="text-xs font-medium text-destructive">
                        {errors.acceptedTerms}
                      </p>
                    )}
                  </div>

                  {/* מוצר קופה — ממש לפני אישור ההזמנה */}
                  {bump && (
                    <OrderBumpOffer
                      offer={bump}
                      checked={cartIds.has(bump.product.id)}
                      onToggle={toggleBump}
                    />
                  )}

                  {submitError && (
                    <p
                      role="alert"
                      className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                    >
                      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      {submitError}
                    </p>
                  )}

                  <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={busy}>
                    {busy ? (
                      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                    ) : (
                      <PackageCheck className="size-5" aria-hidden="true" />
                    )}
                    {busy
                      ? "שולח…"
                      : kind === "quote"
                        ? "שליחת הבקשה להצעת מחיר"
                        : `אישור ושליחת ההזמנה · ${formatIls(grandTotal)}`}
                  </Button>
                  <p className="flex items-start justify-center gap-1.5 text-center text-xs leading-5 text-muted-foreground">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    {kind === "quote"
                      ? "הבקשה לא מחייבת — נחזור אליכם עם הצעת מחיר."
                      : "אין חיוב באתר — נציג ייצור קשר לאישור ההזמנה ולסידור התשלום."}
                  </p>
                </div>
              </form>

              <aside className="order-1 lg:order-2">
                <CheckoutSummary
                  items={cart}
                  priced={kind === "order"}
                  vat={vat}
                  gifts={promotions.gifts}
                  shipping={shipping}
                  loading={catalogLoading}
                  onChangeQuantity={changeQuantity}
                  onRemove={removeItem}
                />
              </aside>
            </div>
          </>
        )}
      </main>
      <AppFooter />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_STORE_NAME } from "@/lib/branding";
import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { AccountNotice } from "@/components/AccountNotice";
import { MaintenanceScreen } from "@/components/MaintenanceScreen";
import { OnboardingGate } from "@/components/OnboardingGate";
import { HotDealsStrip } from "@/components/HotDealsStrip";
import { HomeBanner } from "@/components/BannerCarousel";
import { CategoryBrowser } from "@/components/CategoryBrowser";
import { CategoryLanding } from "@/components/CategoryLanding";
import { OrderCartDrawer, type CartMode } from "@/components/OrderCartDrawer";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useAuthState } from "@/hooks/useAuthState";
import { useCartSync } from "@/hooks/useCartSync";
import { useCart } from "@/hooks/useCart";
import { useCustomerProfile } from "@/hooks/useCustomerProfile";
import { useCategoryTree } from "@/hooks/useCategories";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { isNewProduct, minOrderMessage, type CatalogItem } from "@/lib/catalog";
import { addToCartItems, syncCartWithCatalog, type AddToCartOptions } from "@/lib/cart";
import { countByCategory, subtreeNames, totalCounts } from "@/lib/category-tree";
import { cartLineKey, cartMinimum, cartMinUnits, cartStep } from "@/lib/orders";
import { attributeNames, hasVariants, variantAttributesOf, variantLabel } from "@/lib/variants";
import { loadHomeBanners, type BannerSet } from "@/lib/banners";
import { fetchAllRows } from "@/lib/fetch-all";
import { CatalogSections } from "@/components/CatalogSections";
import { PlatformLanding } from "@/components/portal/PlatformLanding";
import { groupBySubcategory } from "@/lib/catalog-sections";
import { evaluateCartPromotions, type PromotionEvaluation } from "@/lib/cart-promotions";
import { EMPTY_SALES, loadSalesData, type SalesData } from "@/lib/sales-data";
import {
  StorefrontSalesProvider,
  type StorefrontSales,
} from "@/components/sales/StorefrontSalesContext";

type CatalogSearch = {
  /** הקטגוריה שנבחרה — בלי: מסך ריבועי הקטגוריות */
  category?: string | undefined;
  view?: "new" | "promo" | undefined;
  /** ?cart=open — פותח את סל הקניות (קישור "עגלת קניות" ממפת האתר) */
  cart?: "open" | undefined;
};

export const Route = createFileRoute("/")({
  ssr: false,
  // הקטגוריה והתצוגה בכתובת: כל בחירה נרשמת בהיסטוריה, ו"חזור" בדפדפן מחזיר
  // מתצוגת המוצרים לריבועי הקטגוריות (או לקטגוריה הקודמת) — בלי רענון
  validateSearch: (search: Record<string, unknown>): CatalogSearch => {
    const result: CatalogSearch = {};
    if (typeof search["category"] === "string" && search["category"] !== "") {
      result.category = search["category"];
    }
    if (search["view"] === "new" || search["view"] === "promo") result.view = search["view"];
    if (search["cart"] === "open") result.cart = "open";
    return result;
  },
  component: Index,
});

/**
 * עמוד הבית: הקטלוג של החנות — חוץ מהאתר של שער הפלטפורמה (nuriel-app2),
 * שבו מוצג דף הנחיתה של הפלטפורמה: כניסה בקוד למייל ופתיחת חנויות (חלק 12).
 */
function Index() {
  const site = useLoaderData({ from: "__root__" });
  if (site?.isPortal) {
    return <PlatformLanding siteName={site.siteName || DEFAULT_STORE_NAME} />;
  }
  return <StoreCatalog />;
}

function StoreCatalog() {
  const { session, role, loading, refreshRole } = useAuthState();
  const { settings } = useSiteSettings();
  const { loading: profileLoading, refresh: refreshProfile } = useCustomerProfile(
    role?.role === "customer" ? role.user_id : null,
  );
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const category = search.category ?? null;
  const setCategory = useCallback(
    (next: string | null) =>
      void navigate({
        search: (prev) => ({ ...prev, category: next ?? undefined }),
        resetScroll: false,
      }),
    [navigate],
  );
  const [term, setTerm] = useState("");
  // הסל משותף לכל העמודים (קטלוג → קופה) ונשמר בדפדפן — גם לאורח
  const { cart, setCart, ready: cartReady } = useCart();
  const [cartOpen, setCartOpen] = useState(false);
  const view: "all" | "new" | "promo" = search.view ?? "all";
  const setView = (next: "all" | "new" | "promo") =>
    void navigate({
      search: (prev) => ({ ...prev, view: next === "all" ? undefined : next }),
      resetScroll: false,
    });
  const [banners, setBanners] = useState<BannerSet>({ top: [], bottom: [] });
  // הטבות עגלה, מוצרים קשורים ומוצרי קופה — נטענים יחד עם הקטלוג
  const [sales, setSales] = useState<SalesData>(EMPTY_SALES);

  useEffect(() => {
    // באנרים הם תוספת — תקלה בטעינה שלהם לא עוצרת את הקטלוג
    loadHomeBanners()
      .then(setBanners)
      .catch(() => undefined);
  }, []);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    // בעמודים — אלפי מוצרים לא נחתכים במגבלת השורות של ה-API
    const { data, error } = await fetchAllRows((from, to) =>
      supabase
        .rpc("get_catalog")
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    );
    if (error) toast.error(error.message);
    setProducts(data as CatalogItem[]);
    setCatalogLoading(false);
  }, []);

  const loadSales = useCallback(async () => {
    setSales(await loadSalesData());
  }, []);

  useEffect(() => {
    void loadCatalog();
    void loadSales();
  }, [loadCatalog, loadSales, session?.user?.id]);

  const signOut = async () => {
    setCart([]);
    await supabase.auth.signOut();
  };

  // העגלה נשמרת בשרת: נטענת מחדש בכל כניסה ומוצגת למנהל/סוכן בתיק הלקוח
  useCartSync({
    userId: role?.role === "customer" ? role.user_id : null,
    cart,
    setCart,
    enabled: role?.role === "customer" && cartReady,
  });

  const categoryTree = useCategoryTree();
  const categoryCounts = useMemo(
    () => totalCounts(categoryTree, countByCategory(products)),
    [categoryTree, products],
  );
  // לחיצה על קטגוריית אב מציגה גם את כל המוצרים שבתת-הקטגוריות שלה
  const inCategory = useMemo(
    () => (category === null ? null : subtreeNames(categoryTree, category)),
    [categoryTree, category],
  );

  // מסך הכניסה לקטלוג מציג ריבועי קטגוריות במקום את כל המוצרים; ברגע
  // שנבחרה קטגוריה או שהוקלד חיפוש, עוברים לתצוגת מוצרים כרגיל
  const isStaffRole = role?.role === "admin" || role?.role === "agent";
  // מחסנאי — האזור שלו הוא הליקוט בלבד
  useEffect(() => {
    if (role?.role === "warehouse") void navigate({ to: "/warehouse" });
  }, [role?.role, navigate]);
  const featuredCategories = useMemo(
    () =>
      categoryTree.flat.filter(
        (node) => node.show_on_home && (isStaffRole || (categoryCounts.get(node.name) ?? 0) > 0),
      ),
    [categoryTree, categoryCounts, isStaffRole],
  );
  const usingFallbackCategories = featuredCategories.length === 0;
  const landingCategories = useMemo(() => {
    if (!usingFallbackCategories) return featuredCategories;
    // המנהל עוד לא בחר קטגוריות ל"הצג במסך הבית" — קטגוריות השורש כברירת מחדל
    return categoryTree.roots.filter(
      (node) => isStaffRole || (categoryCounts.get(node.name) ?? 0) > 0,
    );
  }, [usingFallbackCategories, featuredCategories, categoryTree, categoryCounts, isStaffRole]);

  const query = term.trim().toLowerCase();
  const showLanding = category === null && query === "";
  const filtered = useMemo(
    () =>
      products.filter(
        (p) =>
          (inCategory === null || inCategory.has(p.category)) &&
          (query === "" ||
            p.name.toLowerCase().includes(query) ||
            p.sku.includes(query) ||
            (p.barcode ?? "").includes(query)),
      ),
    [products, inCategory, query],
  );
  const promoItems = useMemo(
    () => products.filter((p) => p.is_promo || p.original_price !== null),
    [products],
  );

  // מספרי הלשוניות מתייחסים לקטגוריה שנבחרה (בלי החיפוש), כדי שיתאימו למה שמוצג
  const inScope = useMemo(
    () => (inCategory === null ? products : products.filter((p) => inCategory.has(p.category))),
    [products, inCategory],
  );
  const tabCounts = useMemo(
    () => ({
      all: inScope.length,
      new: inScope.filter(isNewProduct).length,
      promo: inScope.filter((p) => p.is_promo || p.original_price !== null).length,
    }),
    [inScope],
  );

  // הלשוניות מסננות את אותה רשימה מסוננת (חיפוש + קטגוריה) — כך שחיפוש
  // בתוך "מבצעים חמים" עובד כמו שמצפים
  const visible = useMemo(() => {
    if (view === "promo") return filtered.filter((p) => p.is_promo || p.original_price !== null);
    if (view === "new") return filtered.filter(isNewProduct);
    return filtered;
  }, [filtered, view]);

  /**
   * מחירון פתוח לכולם: אורחים, לקוחות שממתינים לאישור ולקוחות בלי קבוצת
   * מחיר רואים את המחירון הרגיל ומזמינים דרך הקופה (בלי הרשמה). רק כשלמוצרים
   * אין מחיר בכלל — הסל הוא "בקשה להצעת מחיר".
   */
  const hasPrices = products.some((product) => product.price !== null);
  const catalogById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const isCustomer = role?.role === "customer";
  const cartMode: CartMode = hasPrices ? "order" : "quote";
  const canUseCart = !session || isCustomer;
  const addLabel = cartMode === "order" ? "הוספה לסל" : "הוספה לבקשה";

  // ?cart=open — פותחים את הסל פעם אחת ומנקים את הכתובת
  useEffect(() => {
    if (search.cart !== "open" || loading) return;
    if (canUseCart) setCartOpen(true);
    void navigate({
      search: (prev) => ({ ...prev, cart: undefined }),
      replace: true,
      resetScroll: false,
    });
  }, [search.cart, loading, canUseCart, navigate]);

  // הודעות "נוסף במתנה" / "המתנה הוסרה" מוצגות רק אחרי שינוי שהלקוח עשה בסל —
  // לא כשהסל השמור או ההטבות נטענים (אחרת הודעה תקפוץ בכל כניסה לאתר)
  const cartEdited = useRef(false);

  const addToCart = (item: CatalogItem, requested = 1, options?: AddToCartOptions) => {
    const variant = options?.variant ?? null;
    // מוצר עם וריאציות: בלי בחירה (צבע / מידה) — לא נכנס לסל
    if (hasVariants(item) && !variant) {
      toast.info(`בחרו ${attributeNames(variantAttributesOf(item))} עבור "${item.name}"`);
      return;
    }
    // מתחילים מהמינימום / ממארז שלם — לא מ-1
    const { quantity } = addToCartItems(cart, item, requested, variant);
    cartEdited.current = true;
    setCart((current) => addToCartItems(current, item, requested, variant).items);
    if (options?.silent) return;
    const target = cartMode === "order" ? "סל" : "בקשה";
    const label = variant ? variantLabel(variant.options, variantAttributesOf(item)) : "";
    const name = label ? `${item.name} — ${label}` : item.name;
    toast.success(
      quantity > 1 ? `${quantity} × "${name}" נוספו ל${target}` : `"${name}" נוסף ל${target}`,
    );
  };

  // +/− בסל קופצים במארז שלם, ולא יורדים מתחת למארז אחד / מתחת למינימום
  // להזמנה (הסרה — בכפתור הפח)
  const changeQuantity = (lineKey: string, delta: number) => {
    const line = cart.find((c) => cartLineKey(c) === lineKey);
    if (!line) return;
    const step = cartStep(line);
    const floor = cartMinimum(line);
    const next = line.quantity + delta * step;
    if (next < floor && cartMinUnits(line) > 1) toast.info(minOrderMessage(floor));
    cartEdited.current = true;
    setCart((current) =>
      current.map((c) =>
        cartLineKey(c) === lineKey ? { ...c, quantity: Math.max(floor, next) } : c,
      ),
    );
  };

  // סל שנשמר בעבר (או לפני התחברות / לפני שמוצר סומן "נמכר במארזים"):
  // מסונכרן מול הקטלוג — מוצר שאינו זמין יוצא עם הודעה, הכמות מתעגלת למארז /
  // למינימום, והמחיר מתעדכן למחירון של מי שמחובר עכשיו
  useEffect(() => {
    if (catalogLoading || products.length === 0 || cart.length === 0) return;
    const synced = syncCartWithCatalog(cart, catalogById);
    if (synced.items === cart) return;
    setCart(synced.items);
    const { unavailable } = synced;
    if (unavailable.length > 0) {
      toast.warning(
        unavailable.length === 1
          ? `"${unavailable[0]?.name ?? ""}${unavailable[0]?.variantLabel ? ` — ${unavailable[0].variantLabel}` : ""}" הוסר מהסל — המוצר / האפשרות אינם זמינים כרגע`
          : `${unavailable.length} מוצרים הוסרו מהסל כי אינם זמינים כרגע: ${unavailable.map((item) => item.name).join(", ")}`,
      );
    }
    if (synced.adjusted) {
      toast.info("עדכנו כמויות בסל לפי גודל המארז / המינימום להזמנה של המוצרים");
    }
    // catalogById נגזר מ-products
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, cart, catalogLoading]);
  const removeFromCart = (lineKey: string) => {
    cartEdited.current = true;
    setCart((current) => current.filter((c) => cartLineKey(c) !== lineKey));
  };

  // ---------- הגדלת מכירות: המלצות, מוצרי קופה, מתנות בסל ----------
  const subtree = useCallback((name: string) => subtreeNames(categoryTree, name), [categoryTree]);
  const storefrontSales: StorefrontSales = useMemo(
    () => ({
      catalog: products,
      catalogById,
      related: sales.related,
      bumps: sales.bumps,
      promotions: sales.promotions,
      subtree,
      canAdd: canUseCart,
      addLabel,
      onAddToCart: canUseCart ? addToCart : undefined,
    }),
    // addToCart נבנה מחדש בכל רינדור, אבל תלוי רק במצב הסל (cartMode) — מספיק לרענן לפיו
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, catalogById, sales, subtree, canUseCart, addLabel, cartMode],
  );

  // מתנות: רק בהזמנה עם מחירים (לא בבקשת הצעת מחיר). מחושב מחדש בכל שינוי בסל —
  // מתנה נוספת לבד כשהתנאי מתקיים, ויורדת לבד כשהסל יורד מתחת לתנאי.
  const promotionsEval: PromotionEvaluation = useMemo(
    () =>
      cartMode === "order"
        ? evaluateCartPromotions({
            items: cart,
            promotions: sales.promotions,
            catalogById,
            subtree,
          })
        : { gifts: [], hints: [] },
    [cartMode, cart, sales.promotions, catalogById, subtree],
  );

  // הודעה כשמתנה נכנסת לסל או יוצאת ממנו — רק בעקבות שינוי של הלקוח בסל
  const previousGifts = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const current = new Map(promotionsEval.gifts.map((g) => [g.promotion.id, g.product.name]));
    const previous = previousGifts.current;
    previousGifts.current = current;
    if (!cartEdited.current) return;
    cartEdited.current = false;
    for (const [id, name] of current) {
      if (!previous.has(id)) toast.success(`🎁 "${name}" נוסף לסל במתנה!`);
    }
    for (const [id, name] of previous) {
      if (!current.has(id) && cart.length > 0) {
        toast.info(`המתנה "${name}" הוסרה מהסל — הסל כבר לא עומד בתנאי ההטבה`);
      }
    }
  }, [promotionsEval, cart.length]);

  // מצב תחזוקה: חוסם אורחים ולקוחות, מנהלים וסוכנים ממשיכים לעבוד
  const isStaff = role?.role === "admin" || role?.role === "agent";
  if (settings?.maintenance_mode && !isStaff) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader role={null} email={null} />
        <MaintenanceScreen {...(session ? { onSignOut: signOut } : {})} />
        <AppFooter />
      </div>
    );
  }

  /**
   * לקוח שנכנס עם סיסמה זמנית (חשבון שפתח מנהל) קובע קודם סיסמה קבועה.
   * פרטי העסק כבר לא חוסמים את הקטלוג — הם נאספים בקופה (וממולאים מהאזור
   * האישי). אורחים וצוות לא מושפעים.
   */
  const needsOnboarding =
    role?.role === "customer" && !role.is_blocked && !profileLoading && role.must_change_password;

  if (needsOnboarding && role) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader role={role} email={session?.user.email ?? null} onSignOut={signOut} />
        <OnboardingGate
          userId={role.user_id}
          email={role.email}
          mustChangePassword={role.must_change_password}
          onDone={() => {
            void refreshRole();
            void refreshProfile();
          }}
        />
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

  const cartItemCount = cart.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <StorefrontSalesProvider value={storefrontSales}>
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader
          role={role}
          email={session?.user.email ?? null}
          onSignOut={signOut}
          cartCount={cartItemCount}
          {...(canUseCart ? { onOpenCart: () => setCartOpen(true) } : {})}
        />

        {!loading && !session && (
          <section className="surface-cellar border-b border-white/10">
            <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:py-14 lg:grid-cols-[1.3fr_1fr] lg:items-end">
              <div className="max-w-xl">
                <h1 className="font-display text-3xl leading-tight text-primary-foreground sm:text-4xl">
                  {settings?.site_title?.trim() || DEFAULT_STORE_NAME}
                </h1>
                <p className="mt-3 text-base leading-7 text-primary-foreground/75">
                  כל המחירים גלויים — מוסיפים לסל ומזמינים בקופה, גם בלי הרשמה. לקוחות רשומים נהנים
                  ממילוי פרטים אוטומטי ומהיסטוריית הזמנות באזור האישי.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button
                    size="lg"
                    asChild
                    className="bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    <a href="#catalog">להזמנה מהקטלוג</a>
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    asChild
                    className="border-white/25 bg-transparent text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
                  >
                    <Link to="/login">התחברות</Link>
                  </Button>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-white/10 pt-6 lg:border-r lg:border-t-0 lg:pr-8 lg:pt-0">
                <div>
                  <dt className="text-sm text-primary-foreground/60">מוצרים בקטלוג</dt>
                  <dd className="numeric font-display text-2xl text-accent">{products.length}</dd>
                </div>
                <div>
                  <dt className="text-sm text-primary-foreground/60">מבצעים פעילים</dt>
                  <dd className="numeric font-display text-2xl text-accent">{promoItems.length}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-sm text-primary-foreground/60">שירות לקוחות</dt>
                  <dd dir="ltr" className="numeric text-right text-lg text-primary-foreground">
                    {settings?.support_phone?.trim() || settings?.business_phone?.trim() || "—"}
                  </dd>
                </div>
              </dl>
            </div>
          </section>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-3 py-8 sm:px-4">
          {settings?.maintenance_mode && isStaff && (
            <div className="rounded-lg border border-accent/50 bg-accent/10 p-4 text-sm font-medium text-foreground">
              מצב תחזוקה פעיל — האתר חסום ללקוחות ולאורחים. אתם רואים אותו כרגיל כדי לעדכן מלאי
              ומחירים.
            </div>
          )}
          {isCustomer && !role?.is_approved && (
            <div className="rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm text-foreground">
              החשבון שלך ממתין לאישור מנהל. בינתיים אפשר להזמין כרגיל לפי המחירון הרגיל — אחרי
              האישור יוצגו לך תנאי המחיר של העסק שלך.
            </div>
          )}

          <HomeBanner slides={banners.top} label="באנר עליון" />

          <HotDealsStrip
            items={promoItems}
            canAdd={canUseCart}
            addLabel={addLabel}
            onAddToCart={addToCart}
          />

          <section id="catalog" className="scroll-mt-4 space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <h2 className="font-display text-2xl text-foreground">קטלוג מוצרים</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {catalogLoading
                    ? "טוען מוצרים..."
                    : showLanding
                      ? `${landingCategories.length} קטגוריות`
                      : `${filtered.length} מוצרים`}{" "}
                  · התמונות להמחשה בלבד
                </p>
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Button
                  variant="outline"
                  disabled={catalogLoading}
                  onClick={() => void loadCatalog()}
                  aria-label="רענון הקטלוג"
                >
                  <RefreshCw className={`size-4 ${catalogLoading ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">רענון</span>
                </Button>
                <div className="relative w-full sm:w-72">
                  <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    placeholder={category ? `חיפוש בתוך ${category}` : "חיפוש לפי שם, מקט או ברקוד"}
                    aria-label="חיפוש בקטלוג"
                    className="bg-card pr-9"
                  />
                </div>
              </div>
            </div>

            <CategoryBrowser
              tree={categoryTree}
              value={category}
              onChange={setCategory}
              counts={categoryCounts}
              totalCount={products.length}
              hideEmpty={role?.role !== "admin" && role?.role !== "agent"}
            >
              {showLanding ? (
                <CategoryLanding
                  categories={landingCategories}
                  counts={categoryCounts}
                  onSelect={setCategory}
                  usingFallback={usingFallbackCategories}
                />
              ) : (
                <>
                  <Tabs
                    value={view}
                    onValueChange={(next) => setView(next as typeof view)}
                    dir="rtl"
                  >
                    <TabsList className="flex-wrap">
                      <TabsTrigger value="all">
                        {category ? "הכל" : "כל המוצרים"} ({tabCounts.all})
                      </TabsTrigger>
                      <TabsTrigger value="new">חדש באתר ({tabCounts.new})</TabsTrigger>
                      <TabsTrigger value="promo">מבצעים חמים ({tabCounts.promo})</TabsTrigger>
                    </TabsList>
                  </Tabs>

                  <CatalogSections
                    sections={groupBySubcategory(categoryTree, category, visible)}
                    onOpenCategory={setCategory}
                    canAdd={canUseCart}
                    addLabel={addLabel}
                    onAddToCart={addToCart}
                    emptyText={
                      query !== ""
                        ? "לא נמצאו מוצרים תואמים"
                        : view === "new"
                          ? "לא נוספו מוצרים חדשים בחודש האחרון"
                          : view === "promo"
                            ? "אין כרגע מבצעים פעילים"
                            : category
                              ? "אין עדיין מוצרים בקטגוריה הזו"
                              : "אין עדיין מוצרים בקטלוג"
                    }
                  />
                </>
              )}
            </CategoryBrowser>
          </section>

          <HomeBanner slides={banners.bottom} label="באנר תחתון" />
        </main>

        {canUseCart && (
          <OrderCartDrawer
            open={cartOpen}
            onOpenChange={setCartOpen}
            mode={cartMode}
            signedIn={session !== null}
            items={cart}
            onChangeQuantity={changeQuantity}
            onRemove={removeFromCart}
            onAdd={addToCart}
            promotions={promotionsEval}
          />
        )}

        <AppFooter />
      </div>
    </StorefrontSalesProvider>
  );
}

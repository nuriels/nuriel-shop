import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_STORE_NAME } from "@/lib/branding";
import { getSiteSeo } from "@/lib/platform.functions";
import { getCategoryParents } from "@/lib/seo.functions";
import { breadcrumbTrail, categoryTrail } from "@/lib/seo-urls";
import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { StorefrontMain } from "@/components/layout/StorefrontMain";
import { AccountNotice } from "@/components/AccountNotice";
import { MaintenanceScreen } from "@/components/MaintenanceScreen";
import { OnboardingGate } from "@/components/OnboardingGate";
import { HotDealsStrip } from "@/components/HotDealsStrip";
import { FeaturedProducts } from "@/components/FeaturedProducts";
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
import { inStockFirst, isNewProduct, minOrderMessage, type CatalogItem } from "@/lib/catalog";
import { featuredBlock, homepageCategories } from "@/lib/homepage";
import {
  breadcrumbJsonLd,
  categoryMeta,
  categoryUrl,
  jsonLdText,
  storeJsonLd,
} from "@/lib/structured-data";
import { addToCartItems, syncCartWithCatalog, type AddToCartOptions } from "@/lib/cart";
import { inCategories, productCountsByCategory, subtreeNames } from "@/lib/category-tree";
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
  // חלק 21: "data-only" (במקום false) — פרטי החנות לתגיות (כותרת, קנונית,
  // JSON-LD) נטענים בשרת ונשמרים במצב שהדפדפן ממשיך ממנו, כך שהתגיות זהות בשרת
  // ובדפדפן (בלי אי-התאמה בהידרציה). הקטלוג עצמו עדיין נטען ומוצג בדפדפן בלבד.
  ssr: "data-only",
  // פעם אחת לטעינת עמוד — מעבר בין קטגוריות לא טוען שוב (התגיות לפי ?category=).
  // חלק 31: גם קטגוריות האב — לפירורי לחם היררכיים בעמודי הקטגוריה
  loader: async () => {
    const [site, categoryParents] = await Promise.all([getSiteSeo(), getCategoryParents()]);
    return { ...site, categoryParents };
  },
  staleTime: Infinity,
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
  // חלק 21: תגיות לפי העמוד — נוצרות בשרת (גם כשהתוכן עצמו נטען בדפדפן), כך
  // שגוגל, ווטסאפ ופייסבוק רואים אותן מיד. מסך הבית: כתובת קנונית + JSON-LD
  // של האתר והעסק; עמוד קטגוריה: כותרת ותיאור משלו + פירורי לחם.
  head: ({ match, loaderData: site }) => {
    const schema = site?.schema ?? null;
    if (!site || site.isPortal || !schema) return {};
    const siteName = site.siteName || DEFAULT_STORE_NAME;
    const category = (match.search as CatalogSearch).category;
    if (category) {
      const meta = categoryMeta(siteName, category);
      const url = categoryUrl(schema.url, category);
      const trail = categoryTrail(category, site.categoryParents ?? {});
      return {
        meta: [
          { title: meta.title },
          { name: "description", content: meta.description },
          { property: "og:title", content: meta.title },
          { property: "og:description", content: meta.description },
          { property: "og:url", content: url },
          { name: "twitter:title", content: meta.title },
          { name: "twitter:description", content: meta.description },
        ],
        scripts: [
          {
            type: "application/ld+json",
            children: jsonLdText(
              breadcrumbJsonLd(breadcrumbTrail(schema.url, siteName, trail, null)),
            ),
          },
        ],
      };
    }
    // מסך הבית (גם ?view= / ?cart=) — הכתובת הקנונית היא דף הבית
    return {
      meta: [{ property: "og:url", content: `${schema.url}/` }],
      scripts: [
        {
          type: "application/ld+json",
          children: jsonLdText(
            storeJsonLd({
              name: siteName,
              url: schema.url,
              description: site.seoDescription || null,
              logoUrl: schema.logoUrl,
              phone: schema.phone,
              email: schema.email,
              address: schema.address,
              hours: schema.hours,
            }),
          ),
        },
      ],
    };
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
    // בעמודים — אלפי מוצרים לא נחתכים במגבלת השורות של ה-API.
    // חלק 20: מה שיש במלאי קודם, מה שאזל (גם מלאי 0) — בסוף. כל התצוגות
    // (מסך הבית, קטגוריות, חיפוש, מבצעים) מסננות את הרשימה הזו ושומרות על הסדר.
    const { data, error } = await fetchAllRows((from, to) =>
      supabase
        .rpc("get_catalog")
        .order("is_out_of_stock", { ascending: true })
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    );
    if (error) toast.error(error.message);
    setProducts(inStockFirst(data as CatalogItem[]));
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
  // מוצר בכמה קטגוריות (חלק 18) נספר בכל אחת מהן
  const categoryCounts = useMemo(
    () => productCountsByCategory(categoryTree, products),
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
  // חלק 33: למחסנאי ולקופאי יש מסך בית משלהם בפאנל — ליקוט / הקופה המהירה
  useEffect(() => {
    if (role?.role === "warehouse") void navigate({ to: "/admin", search: { tab: "picking" } });
    if (role?.role === "cashier") void navigate({ to: "/admin", search: { tab: "pos" } });
  }, [role?.role, navigate]);
  // חלק 20: הקטגוריות שסומנו "הצג קטגוריה במסך הבית" — ואם אף אחת, 5 הראשונות
  const { categories: landingCategories, usingFallback: usingFallbackCategories } = useMemo(
    () => homepageCategories(categoryTree, categoryCounts, isStaffRole),
    [categoryTree, categoryCounts, isStaffRole],
  );
  // בלוק "מוצרים נבחרים" ("הקפץ למסך ראשי") — ואם אין, החדשים ביותר
  const featured = useMemo(() => featuredBlock(products), [products]);

  const query = term.trim().toLowerCase();
  const showLanding = category === null && query === "";
  const filtered = useMemo(
    () =>
      products.filter(
        (p) =>
          (inCategory === null || inCategories(p, inCategory)) &&
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
    () => (inCategory === null ? products : products.filter((p) => inCategories(p, inCategory))),
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

        {/* חלק 22: בלי "הבלוק הכחול" (שם החנות, "להזמנה מהקטלוג" וסטטיסטיקות) — זה
            נראה כמו לוח בקרה ולא כמו חנות. העמוד נפתח ישר בבאנרים. הכותרת הראשית
            (h1) נשארת לגוגל ולקוראי מסך, בלי תצוגה. */}
        <h1 className="sr-only">{settings?.site_title?.trim() || DEFAULT_STORE_NAME}</h1>

        {/* חלק 19: Grid עם באנר צדדי (רק במחשב, כשהוא פעיל) */}
        <StorefrontMain className="pb-8 pt-4 sm:pt-6" contentClassName="space-y-8">
          {settings?.maintenance_mode && isStaff && (
            <div className="rounded-lg border border-accent/50 bg-accent/10 p-4 text-sm font-medium text-foreground">
              מצב תחזוקה פעיל — האתר חסום ללקוחות ולאורחים. אתם רואים אותו כרגיל כדי לעדכן מלאי
              ומחירים.
            </div>
          )}
          {/* "ממתין לאישור" — רק בחנות B2B (דרגי מחיר פעילים), שם האישור משנה את
              המחירים. ללקוח רגיל בחנות קמעונאית ההודעה רק מרתיעה. */}
          {isCustomer && !role?.is_approved && settings?.price_tiers_enabled === true && (
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

          {showLanding && !catalogLoading && (
            <FeaturedProducts
              block={featured}
              canAdd={canUseCart}
              addLabel={addLabel}
              onAddToCart={canUseCart ? addToCart : undefined}
            />
          )}

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
                  usingFallback={usingFallbackCategories && isStaffRole}
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
        </StorefrontMain>

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

import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Loader2, PackageX, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { StorefrontMain } from "@/components/layout/StorefrontMain";
import { MaintenanceScreen } from "@/components/MaintenanceScreen";
import { ProductDetailView } from "@/components/ProductDetailDialog";
import {
  StorefrontSalesProvider,
  type StorefrontSales,
} from "@/components/sales/StorefrontSalesContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthState } from "@/hooks/useAuthState";
import { useCart } from "@/hooks/useCart";
import { useCategoryTree } from "@/hooks/useCategories";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { addToCartItems, type AddToCartOptions } from "@/lib/cart";
import { inStockFirst, type CatalogItem } from "@/lib/catalog";
import { subtreeNames } from "@/lib/category-tree";
import { fetchAllRows } from "@/lib/fetch-all";
import { trackAddToCart } from "@/lib/marketing";
import { EMPTY_SALES, loadSalesData, type SalesData } from "@/lib/sales-data";
import { getProductSeo, type ProductSeo } from "@/lib/seo.functions";
import { breadcrumbJsonLd, categoryUrl, jsonLdText, productJsonLd } from "@/lib/structured-data";

/**
 * חלק 21: JSON-LD לעמוד מוצר — Product + Offer (מחיר, זמינות במלאי, תמונות)
 * ופירורי לחם (בית ← קטגוריה ← מוצר), לתוצאות עשירות בחיפוש של גוגל
 */
function productStructuredData(seo: ProductSeo): { type: string; children: string }[] {
  const product = productJsonLd({
    name: seo.name,
    description: seo.description,
    sku: seo.sku,
    category: seo.category,
    storeName: seo.storeName,
    url: seo.url,
    images: seo.images,
    price: seo.price,
    inStock: seo.inStock,
    barcode: seo.barcode,
    saleEndsAt: seo.saleEndsAt,
  });
  const scripts = [{ type: "application/ld+json", children: jsonLdText(product) }];
  if (seo.origin) {
    scripts.push({
      type: "application/ld+json",
      children: jsonLdText(
        breadcrumbJsonLd([
          { name: seo.storeName, url: `${seo.origin}/` },
          { name: seo.category, url: categoryUrl(seo.origin, seo.category) },
          { name: seo.name, url: null },
        ]),
      ),
    });
  }
  return scripts;
}
import { attributeNames, hasVariants, variantAttributesOf, variantLabel } from "@/lib/variants";

/**
 * עמוד מוצר (חלק 14): /product/<id> — כתובת קבועה לכל מוצר, לגוגל (מפת
 * האתר), לזאפ ולשיתוף. התגיות (כותרת, תיאור, תמונה, מחיר) נוצרות בשרת
 * (ssr: data-only) — כך שגוגל, ווטסאפ ופייסבוק רואים אותן מיד. התוכן עצמו
 * (מחיר לפי מי שמחובר, וריאציות, הוספה לסל) — בדפדפן, כמו בקטלוג.
 */
export const Route = createFileRoute("/product/$productId")({
  ssr: "data-only",
  loader: ({ params }) => getProductSeo({ data: { id: params.productId } }),
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "המוצר לא נמצא" }, { name: "robots", content: "noindex" }] };
    }
    const seo = loaderData;
    return {
      meta: [
        { title: seo.title },
        { name: "description", content: seo.description },
        { property: "og:title", content: seo.title },
        { property: "og:description", content: seo.description },
        { property: "og:type", content: "product" },
        ...(seo.url ? [{ property: "og:url", content: seo.url }] : []),
        ...(seo.image
          ? [
              { property: "og:image", content: seo.image },
              { property: "og:image:alt", content: seo.name },
              { name: "twitter:image", content: seo.image },
            ]
          : []),
        { name: "twitter:title", content: seo.title },
        { name: "twitter:description", content: seo.description },
        { property: "product:price:amount", content: seo.price.toFixed(2) },
        { property: "product:price:currency", content: "ILS" },
      ],
      links: seo.url ? [{ rel: "canonical", href: seo.url }] : [],
      scripts: productStructuredData(seo),
    };
  },
  component: ProductPage,
});

function ProductPage() {
  const { productId } = Route.useParams();
  const seo = Route.useLoaderData();
  const navigate = useNavigate();
  const { session, role, loading: authLoading } = useAuthState();
  const { settings } = useSiteSettings();
  const { cart, setCart } = useCart();
  const categoryTree = useCategoryTree();
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState<SalesData>(EMPTY_SALES);

  // הקטלוג לפי מי שמחובר (מחיר אישי / דרג), כמו בעמוד הבית — בשביל המוצר
  // עצמו וההמלצות ("מוצרים נוספים שאולי תאהבו")
  const load = useCallback(async () => {
    setLoading(true);
    const [{ data, error }, salesData] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .rpc("get_catalog")
          // חלק 20: מה שיש במלאי קודם (גם בהמלצות), מה שאזל — בסוף
          .order("is_out_of_stock", { ascending: true })
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      loadSalesData(),
    ]);
    if (error) toast.error(error.message);
    setProducts(inStockFirst((data as CatalogItem[]) ?? []));
    setSales(salesData);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load, session?.user?.id]);

  const catalogById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const product = catalogById.get(productId) ?? null;
  const isCustomer = role?.role === "customer";
  const isStaff = role !== null && !isCustomer;
  const canUseCart = !session || isCustomer;
  const hasPrices = products.some((p) => p.price !== null);
  const addLabel = hasPrices ? "הוספה לסל" : "הוספה לבקשה";

  const addToCart = (item: CatalogItem, requested = 1, options?: AddToCartOptions) => {
    const variant = options?.variant ?? null;
    if (hasVariants(item) && !variant) {
      toast.info(`בחרו ${attributeNames(variantAttributesOf(item))} עבור "${item.name}"`);
      return;
    }
    const { quantity } = addToCartItems(cart, item, requested, variant);
    setCart((current) => addToCartItems(current, item, requested, variant).items);
    trackAddToCart(item.name, (variant?.price ?? item.price ?? 0) * quantity);
    const label = variant ? variantLabel(variant.options, variantAttributesOf(item)) : "";
    const name = label ? `${item.name} — ${label}` : item.name;
    toast.success(quantity > 1 ? `${quantity} × "${name}" נוספו לסל` : `"${name}" נוסף לסל`, {
      action: { label: "לקופה", onClick: () => void navigate({ to: "/checkout" }) },
    });
  };

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
    // addToCart תלוי רק במצב הסל
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, catalogById, sales, subtree, canUseCart, addLabel, cart],
  );

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  if (settings?.maintenance_mode && !isStaff) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <MaintenanceScreen {...(session ? { onSignOut: signOut } : {})} />
        <AppFooter />
      </div>
    );
  }

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader role={role} email={session?.user.email ?? null} onSignOut={signOut} />
      {/* חלק 19: Grid עם באנר צדדי (רק במחשב, כשהוא פעיל) */}
      <StorefrontMain width="5xl" className="py-5 sm:py-8" contentClassName="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            to="/"
            search={product ? { category: product.category } : {}}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowRight className="size-4" aria-hidden="true" />
            {product ? `חזרה ל${product.category}` : "לכל המוצרים"}
          </Link>
          {cartCount > 0 && canUseCart && (
            <Button asChild size="sm" variant="outline">
              <Link to="/checkout">
                <ShoppingCart className="size-4" />
                לקופה ({cartCount})
              </Link>
            </Button>
          )}
        </div>

        {loading || authLoading ? (
          <div className="grid gap-4 overflow-hidden rounded-2xl border bg-card p-4 md:grid-cols-2">
            <div className="h-72 animate-pulse rounded-xl bg-muted sm:h-96" />
            <div className="space-y-3 py-2">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                טוען את המוצר…
              </p>
              <p className="font-display text-2xl font-bold text-foreground">{seo?.name ?? ""}</p>
              <div className="h-8 w-32 animate-pulse rounded bg-muted" />
              <div className="h-24 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ) : product ? (
          <StorefrontSalesProvider value={storefrontSales}>
            <ProductDetailView
              product={product}
              mode="page"
              canAdd={canUseCart}
              addLabel={addLabel}
              onAddToCart={canUseCart ? addToCart : undefined}
              onShowProduct={(item) =>
                void navigate({ to: "/product/$productId", params: { productId: item.id } })
              }
            />
          </StorefrontSalesProvider>
        ) : (
          <Card className="mx-auto max-w-xl border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <PackageX className="size-10 text-muted-foreground" aria-hidden="true" />
              <p className="text-lg font-semibold text-foreground">המוצר לא נמצא</p>
              <p className="text-sm text-muted-foreground">
                ייתכן שהמוצר הוסר מהחנות או שאינו זמין כרגע.
              </p>
              <Button asChild>
                <Link to="/">לכל המוצרים</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </StorefrontMain>
      <AppFooter />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Eye, FileClock, Loader2, Lock, Package, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { variantAttributesOf } from "@/lib/variants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CategoryBrowser } from "@/components/CategoryBrowser";
import { CategoryManagerDialog } from "@/components/CategoryManagerDialog";
import { AdminProductDialog, type ProductDraft } from "@/components/AdminProductDialog";
import { ScanIntakeDialog } from "@/components/ScanIntakeDialog";
import { ProductImportDialog } from "@/components/products/ProductImportDialog";
import { ProductUrlImportDialog } from "@/components/products/ProductUrlImportDialog";
import { ProductGrid } from "@/components/ProductGrid";
import { usePriceTiersEnabled } from "@/hooks/usePriceTiers";
import { useSubscription } from "@/hooks/useSubscription";
import { PremiumBadge } from "@/components/billing/PremiumLock";
import {
  formatIls,
  formatSaleCountdown,
  isSaleActive,
  PRODUCT_ADMIN_COLUMNS,
  stockSellable,
  type GlobalProduct,
} from "@/lib/catalog";
import { inCategories, productCountsByCategory, subtreeNames } from "@/lib/category-tree";
import { useCategoryTree } from "@/hooks/useCategories";
import { fetchAllRows } from "@/lib/fetch-all";
import { compareProductOrder, groupBySubcategory } from "@/lib/catalog-sections";

type ProductsTab = "catalog" | "hidden" | "drafts";

const PRODUCT_TABS: ProductsTab[] = ["catalog", "hidden", "drafts"];

/**
 * ניהול קטלוג המוצרים — אדמין בלבד: קטלוג, מוצרים מוסתרים וטיוטות שלא נשמרו.
 * הלשונית והקטגוריה יכולות להישלט מבחוץ (מהכתובת בפאנל הניהול), כדי ש"חזור"
 * בדפדפן יחזיר אליהן; בלי props הן נשמרות מקומית.
 */
export function AdminProductsPanel({
  tab: tabProp,
  onTabChange,
  category: categoryProp,
  onCategoryChange,
}: {
  tab?: string | undefined;
  onTabChange?: (next: ProductsTab) => void;
  category?: string | null | undefined;
  onCategoryChange?: (next: string | null) => void;
} = {}) {
  const tiersEnabled = usePriceTiersEnabled();
  // חבילה בסיסית (חלק 13): עד 1,000 מוצרים — בהגעה למגבלה אין "מוצר חדש"
  const { maxProducts } = useSubscription();
  const [products, setProducts] = useState<GlobalProduct[]>([]);
  /** חלק 18: הקטגוריות הנוספות של כל מוצר (product_categories) — מזהי קטגוריות */
  const [links, setLinks] = useState<Map<string, string[]>>(new Map());
  const [drafts, setDrafts] = useState<ProductDraft[]>([]);
  const [localCategory, setLocalCategory] = useState<string | null>(null);
  const category = onCategoryChange ? (categoryProp ?? null) : localCategory;
  const setCategory = (next: string | null) =>
    onCategoryChange ? onCategoryChange(next) : setLocalCategory(next);
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [localTab, setLocalTab] = useState<ProductsTab>("catalog");
  const tab: ProductsTab = onTabChange
    ? PRODUCT_TABS.includes(tabProp as ProductsTab)
      ? (tabProp as ProductsTab)
      : "catalog"
    : localTab;
  const setTab = (next: ProductsTab) => (onTabChange ? onTabChange(next) : setLocalTab(next));
  const [onlyPromo, setOnlyPromo] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await fetchAllRows((from, to) =>
      supabase
        .from("global_products")
        .select(PRODUCT_ADMIN_COLUMNS)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    );
    if (error) toast.error(error.message);
    setProducts(data as GlobalProduct[]);
    setLoading(false);
    const { data: linkRows } = await fetchAllRows((from, to) =>
      supabase
        .from("product_categories")
        .select("product_id, category_id")
        .order("product_id")
        .order("category_id")
        .range(from, to),
    );
    const next = new Map<string, string[]>();
    for (const row of (linkRows ?? []) as { product_id: string; category_id: string }[]) {
      next.set(row.product_id, [...(next.get(row.product_id) ?? []), row.category_id]);
    }
    setLinks(next);
  }, []);

  const loadDrafts = useCallback(async () => {
    const { data, error } = await supabase
      .from("product_drafts")
      .select("id, title, data, updated_at")
      .order("updated_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      return;
    }
    setDrafts((data as ProductDraft[] | null) ?? []);
  }, []);

  useEffect(() => {
    void load();
    void loadDrafts();
  }, [load, loadDrafts]);

  const categoryTree = useCategoryTree();
  // שם הקטגוריה לפי המזהה — לקטגוריות הנוספות של כל מוצר
  const productsWithCategories = useMemo(() => {
    const nameById = new Map(
      categoryTree.flat.filter((node) => node.id).map((node) => [node.id!, node.name]),
    );
    return products.map((p) => {
      const ids = links.get(p.id);
      if (!ids || ids.length === 0) return p;
      const categories = ids
        .map((id) => nameById.get(id))
        .filter((name): name is string => Boolean(name));
      return { ...p, categories };
    });
  }, [products, links, categoryTree]);
  const visibleProducts = useMemo(
    () => productsWithCategories.filter((p) => !p.is_hidden),
    [productsWithCategories],
  );
  const hiddenProducts = useMemo(
    () => productsWithCategories.filter((p) => p.is_hidden),
    [productsWithCategories],
  );

  const categoryCounts = useMemo(
    () => productCountsByCategory(categoryTree, visibleProducts),
    [categoryTree, visibleProducts],
  );
  const inCategory = useMemo(
    () => (category === null ? null : subtreeNames(categoryTree, category)),
    [categoryTree, category],
  );

  const query = term.trim().toLowerCase();
  const matches = (p: GlobalProduct) =>
    (!onlyPromo || (p.is_promo && isSaleActive(p))) &&
    (query === "" ||
      p.name.toLowerCase().includes(query) ||
      p.sku.includes(query) ||
      (p.barcode ?? "").includes(query));
  const activePromoCount = visibleProducts.filter((p) => p.is_promo && isSaleActive(p)).length;
  const filtered = visibleProducts.filter(
    (p) => (inCategory === null || inCategories(p, inCategory)) && matches(p),
  );
  // שורות לפי תת-קטגוריה (כמו אצל הלקוח). גרירה לשינוי סדר — רק בקטגוריה
  // שנבחרה, בלי חיפוש ובלי סינון (אחרת הרשימה חלקית והסדר יתבלבל)
  // (הגרירה — לפי הקטגוריה הראשית; מוצרים שהקטגוריה היא קטגוריה נוספת שלהם — בשורה נפרדת)
  const sections = groupBySubcategory(categoryTree, tab === "catalog" ? category : null, filtered, {
    primaryOnly: true,
  });
  const canReorder = tab === "catalog" && category !== null && query === "" && !onlyPromo;
  const reorder = async (sectionCategory: string, ids: string[]) => {
    const { error } = await supabase.rpc("reorder_products", {
      _category: sectionCategory,
      _product_ids: ids,
    });
    if (error) throw new Error(error.message);
    const position = new Map(ids.map((id, index) => [id, (index + 1) * 10]));
    setProducts((current) =>
      current
        .map((p) => (position.has(p.id) ? { ...p, sort_order: position.get(p.id)! } : p))
        .sort(compareProductOrder),
    );
  };
  const filteredHidden = hiddenProducts.filter(matches);

  const unhide = async (product: GlobalProduct) => {
    const { error } = await supabase
      .from("global_products")
      .update({ is_hidden: false })
      .eq("id", product.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`"${product.name}" חזר לקטלוג, לקטגוריה "${product.category}"`);
    void load();
  };

  // חלק 20: "הקפץ למסך ראשי" — מתג מהיר בכרטיס, נשמר מיד (בלי לפתוח את העריכה)
  const setFeatured = async (product: GlobalProduct, next: boolean) => {
    const patchFeatured = (value: boolean) =>
      setProducts((current) =>
        current.map((p) => (p.id === product.id ? { ...p, is_featured: value } : p)),
      );
    patchFeatured(next);
    const { error } = await supabase
      .from("global_products")
      .update({ is_featured: next })
      .eq("id", product.id);
    if (error) {
      patchFeatured(!next);
      toast.error(error.message);
      return;
    }
    toast.success(
      next
        ? `"${product.name}" יוצג ב"מוצרים נבחרים" במסך הבית`
        : `"${product.name}" הוסר מ"מוצרים נבחרים"`,
    );
  };

  const deleteDraft = async (draft: ProductDraft) => {
    const { error } = await supabase.from("product_drafts").delete().eq("id", draft.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("הטיוטה נמחקה");
    void loadDrafts();
  };

  const footer = (product: GlobalProduct) => (
    <div className="space-y-2 border-t border-border pt-2">
      <div className="flex flex-wrap gap-1 text-xs">
        {tiersEnabled ? (
          <>
            <Badge variant="outline">1: {formatIls(product.price_tier1)}</Badge>
            <Badge variant="outline">2: {formatIls(product.price_tier2)}</Badge>
            <Badge variant="outline">3: {formatIls(product.price_tier3)}</Badge>
          </>
        ) : (
          <Badge variant="outline">מחיר: {formatIls(product.price_tier1)}</Badge>
        )}
      </div>
      {product.is_promo && isSaleActive(product) && (
        <div className="rounded-md bg-destructive/10 px-2 py-1">
          <Badge className="border-0 bg-destructive text-destructive-foreground">
            🔥 במבצע: {formatIls(Number(product.sale_price))}
          </Badge>
          {product.sale_ends_at && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {formatSaleCountdown(product.sale_ends_at)} ·{" "}
              {new Date(product.sale_ends_at).toLocaleString("he-IL", {
                day: "numeric",
                month: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
      )}
      {product.is_promo && !isSaleActive(product) && product.sale_price != null && (
        <Badge variant="outline" className="border-destructive text-destructive">
          {product.sale_ends_at ? "מבצע הסתיים — לעדכן או לכבות" : "מבצע בלי תאריך סיום"}
        </Badge>
      )}
      {product.barcode && (
        <p dir="ltr" className="numeric truncate text-right text-xs text-muted-foreground">
          ברקוד {product.barcode}
        </p>
      )}
      <div className="flex flex-wrap gap-1 text-xs">
        {product.is_digital ? (
          <Badge className="border-0 bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200">
            דיגיטלי
          </Badge>
        ) : (
          <Badge variant="secondary">מלאי: {product.stock_quantity}</Badge>
        )}
        {variantAttributesOf(product).length > 0 && (
          <Badge variant="outline">
            וריאציות:{" "}
            {variantAttributesOf(product)
              .map((attribute) => attribute.name)
              .join(" / ")}
          </Badge>
        )}
        {product.is_promo && product.sale_price == null && (
          <Badge variant="outline" className="border-destructive text-destructive">
            מבצע בלי מחיר
          </Badge>
        )}
        {product.is_out_of_stock ? (
          <Badge variant="destructive">{product.out_of_stock_auto ? "אזל (אוטומטי)" : "אזל"}</Badge>
        ) : (
          // חלק 20: מלאי 0 — באתר הוא כבר מוצג "אזל מהמלאי", גם בלי הסימון
          variantAttributesOf(product).length === 0 &&
          !stockSellable(product) && (
            <Badge variant="destructive" title='באתר המוצר מוצג "אזל מהמלאי" עד שתעדכנו כמות במלאי'>
              אזל (מלאי 0)
            </Badge>
          )
        )}
        {product.is_hidden && <Badge variant="outline">מוסתר · {product.category}</Badge>}
      </div>
      <label
        htmlFor={`featured-${product.id}`}
        data-no-drag
        data-featured-toggle={product.id}
        className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
          product.is_featured
            ? "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
            : "border-border text-muted-foreground"
        }`}
      >
        <span className="flex items-center gap-1.5">
          <Star
            className={`size-4 ${product.is_featured ? "fill-amber-400 text-amber-500" : ""}`}
            aria-hidden="true"
          />
          הקפץ למסך ראשי
        </span>
        <Switch
          id={`featured-${product.id}`}
          checked={product.is_featured === true}
          onCheckedChange={(next) => void setFeatured(product, next)}
          aria-label={`הקפץ את "${product.name}" למסך הראשי`}
        />
      </label>
      <AdminProductDialog product={product} onSaved={load} />
      {product.is_hidden && (
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 w-full"
          onClick={() => void unhide(product)}
        >
          <Eye className="size-4" />
          החזרה לקטלוג
        </Button>
      )}
    </div>
  );

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl gradient-brand text-primary-foreground">
            <Boxes className="size-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">קטלוג מוצרים</h2>
            <p className="text-sm text-muted-foreground">
              {loading
                ? "טוען מוצרים..."
                : `${visibleProducts.length} בקטלוג · ${hiddenProducts.length} מוסתרים · ${drafts.length} טיוטות`}
            </p>
            {maxProducts !== null && !loading && (
              <p
                className={`text-xs font-medium ${
                  products.length >= maxProducts ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {products.length.toLocaleString("he-IL")} / {maxProducts.toLocaleString("he-IL")}{" "}
                מוצרים בחבילה הבסיסית
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab !== "drafts" && (
            <>
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={
                  tab === "catalog" && category
                    ? `חיפוש בתוך ${category}`
                    : "חיפוש לפי שם, מקט או ברקוד"
                }
                className="w-full sm:w-56"
              />
              <Button
                type="button"
                variant={onlyPromo ? "default" : "outline"}
                size="sm"
                onClick={() => setOnlyPromo((value) => !value)}
                aria-pressed={onlyPromo}
              >
                🔥 רק מוצרים במבצע{activePromoCount > 0 ? ` (${activePromoCount})` : ""}
              </Button>
            </>
          )}
          <ScanIntakeDialog onApplied={load} />
          {/* ייבוא קטלוג מקובץ CSV (חלק 14) */}
          <ProductImportDialog
            onImported={load}
            productCount={products.length}
            maxProducts={maxProducts}
          />
          {/* ייבוא מוצר בודד מקישור — AliExpress, Amazon, חנות אחרת (חלק 29) */}
          <ProductUrlImportDialog
            disabled={maxProducts !== null && !loading && products.length >= maxProducts}
            onSaved={load}
            onDraftsChanged={loadDrafts}
          />
          {maxProducts !== null && !loading && products.length >= maxProducts ? (
            <span className="flex flex-col items-end gap-1">
              <Button
                type="button"
                size="sm"
                disabled
                title={`בחבילה הבסיסית אפשר עד ${maxProducts.toLocaleString("he-IL")} מוצרים`}
              >
                <Lock className="size-4" />
                מוצר חדש
              </Button>
              <PremiumBadge />
            </span>
          ) : (
            <AdminProductDialog onSaved={load} onDraftsChanged={loadDrafts} />
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={(next) => setTab(next as ProductsTab)} dir="rtl">
        <TabsList className="flex-wrap">
          <TabsTrigger value="catalog">בקטלוג ({visibleProducts.length})</TabsTrigger>
          <TabsTrigger value="hidden">מוסתרים ({hiddenProducts.length})</TabsTrigger>
          <TabsTrigger value="drafts">טיוטות ({drafts.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="mt-5">
          <CategoryBrowser
            tree={categoryTree}
            value={category}
            onChange={setCategory}
            counts={categoryCounts}
            totalCount={visibleProducts.length}
            hideEmpty={false}
            toolbar={<CategoryManagerDialog trigger="icon" />}
          >
            <p className="mb-3 text-xs text-muted-foreground">
              {canReorder
                ? "לשינוי הסדר: לחיצה ארוכה על מוצר וגרירה בתוך השורה שלו. הסדר נשמר אוטומטית ומוצג כך גם ללקוחות."
                : category === null
                  ? "כדי לשנות את סדר המוצרים בגרירה — בחרו קטגוריה."
                  : 'שינוי הסדר בגרירה זמין בלי חיפוש ובלי סינון "רק מוצרים במבצע".'}
            </p>
            {sections.length === 1 && sections[0]?.title === null ? (
              <ProductGrid
                products={sections[0].items}
                emptyText={
                  onlyPromo
                    ? "אין כרגע מוצרים במבצע פעיל"
                    : query !== ""
                      ? "לא נמצאו מוצרים תואמים"
                      : "הקטלוג ריק — הוסיפו את המוצר הראשון"
                }
                footer={footer}
                {...(canReorder && sections[0].category
                  ? {
                      sortable: {
                        onReorder: (ids: string[]) => reorder(sections[0]!.category!, ids),
                      },
                    }
                  : {})}
              />
            ) : (
              <div className="space-y-8">
                {sections.map((section) => (
                  <section key={section.key} className="space-y-3">
                    <h3 className="border-b border-border pb-2 text-lg font-bold text-foreground">
                      {section.title}{" "}
                      <span className="numeric text-sm font-normal text-muted-foreground">
                        ({section.items.length})
                      </span>
                    </h3>
                    <ProductGrid
                      products={section.items}
                      footer={footer}
                      {...(canReorder && section.category
                        ? {
                            sortable: {
                              onReorder: (ids: string[]) => reorder(section.category!, ids),
                            },
                          }
                        : {})}
                    />
                  </section>
                ))}
              </div>
            )}
          </CategoryBrowser>
        </TabsContent>

        <TabsContent value="hidden" className="mt-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            מוצרים מוסתרים לא מוצגים ללקוחות ולאורחים ואי אפשר להזמין אותם. כל מוצר נשאר משויך
            לקטגוריה שלו, וכשמחזירים אותו לקטלוג הוא חוזר בדיוק לשם.
          </p>
          <ProductGrid
            products={filteredHidden}
            emptyText={
              onlyPromo
                ? "אין מוצרים מוסתרים במבצע פעיל"
                : query !== ""
                  ? "לא נמצאו מוצרים מוסתרים תואמים"
                  : 'אין מוצרים מוסתרים. להסתרת מוצר: "עריכה" ← "הסתר מוצר".'
            }
            footer={footer}
          />
        </TabsContent>

        <TabsContent value="drafts" className="mt-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            מוצרים שהתחלתם להוסיף ועוד לא לחצתם "הוספה לקטלוג". הטופס נשמר אוטומטית תוך כדי הקלדה,
            כך שיציאה בטעות לא מוחקת כלום. טיוטות לא מוצגות ללקוחות.
          </p>
          {drafts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
              <FileClock className="size-6" />
              אין טיוטות פתוחות
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {drafts.map((draft) => (
                <DraftCard
                  key={draft.id}
                  draft={draft}
                  onSaved={() => {
                    void load();
                    void loadDrafts();
                  }}
                  onDraftsChanged={loadDrafts}
                  onDelete={() => void deleteDraft(draft)}
                />
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

function DraftCard({
  draft,
  onSaved,
  onDraftsChanged,
  onDelete,
}: {
  draft: ProductDraft;
  onSaved: () => void;
  onDraftsChanged: () => void;
  onDelete: () => void;
}) {
  const data = (draft.data ?? {}) as {
    imageUrl?: unknown;
    category?: unknown;
    priceTier1?: unknown;
  };
  const imageUrl = typeof data.imageUrl === "string" && data.imageUrl !== "" ? data.imageUrl : null;
  const categoryName = typeof data.category === "string" ? data.category : "";
  const price =
    typeof data.priceTier1 === "string" && data.priceTier1 !== "" ? data.priceTier1 : null;
  const [deleting, setDeleting] = useState(false);
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-card">
      <div className="flex gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary">
          {imageUrl ? (
            <img src={imageUrl} alt="" className="size-full object-cover" />
          ) : (
            <Package className="size-6 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="line-clamp-2 font-semibold text-foreground">
            {draft.title.trim() || "מוצר ללא שם"}
          </p>
          <p className="text-xs text-muted-foreground">
            {[categoryName, price ? formatIls(Number(price)) : null].filter(Boolean).join(" · ") ||
              "טרם מולאו פרטים"}
          </p>
          <p className="text-xs text-muted-foreground">
            עודכן{" "}
            {new Date(draft.updated_at).toLocaleString("he-IL", {
              day: "numeric",
              month: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </div>
      <div className="mt-auto grid grid-cols-[1fr_auto] gap-2">
        <AdminProductDialog draft={draft} onSaved={onSaved} onDraftsChanged={onDraftsChanged} />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="icon" className="size-11" aria-label="מחיקת הטיוטה">
              <Trash2 className="size-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent dir="rtl" className="text-right">
            <AlertDialogHeader>
              <AlertDialogTitle>למחוק את הטיוטה?</AlertDialogTitle>
              <AlertDialogDescription>
                הטיוטה "{draft.title.trim() || "מוצר ללא שם"}" תימחק. המוצר לא נוסף לקטלוג, כך שאין
                לזה השפעה על לקוחות.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:flex-row-reverse sm:justify-start">
              <AlertDialogAction
                onClick={() => {
                  setDeleting(true);
                  onDelete();
                }}
              >
                {deleting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                מחיקה
              </AlertDialogAction>
              <AlertDialogCancel>ביטול</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}

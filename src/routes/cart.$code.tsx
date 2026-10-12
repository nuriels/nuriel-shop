import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Link2Off, Loader2, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { StorefrontMain } from "@/components/layout/StorefrontMain";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthState } from "@/hooks/useAuthState";
import { useCart } from "@/hooks/useCart";
import { useRestState } from "@/hooks/useRestState";
import { REST_CHECKOUT_MESSAGE } from "@/lib/rest-window";
import { addToCartItems } from "@/lib/cart";
import {
  formatIls,
  minimumQuantity,
  normalizeQuantity,
  packStep,
  type CatalogItem,
} from "@/lib/catalog";
import { fetchAllRows } from "@/lib/fetch-all";
import { trackAddToCart } from "@/lib/marketing";
import { loadSharedCart, type SharedCartLine } from "@/lib/shared-cart";
import {
  hasVariants,
  variantAttributesOf,
  variantLabel,
  variantsOf,
  type CatalogVariant,
} from "@/lib/variants";

/**
 * חלק 39: עגלה משותפת — /cart/{code}. מי שפותח את הקישור רואה את המוצרים
 * (במחיר שלו), בוחר אילו להוסיף ובאיזו כמות, והם נכנסים לעגלה שלו.
 */
export const Route = createFileRoute("/cart/$code")({
  ssr: false,
  head: () => ({
    meta: [{ title: "עגלה ששותפה איתך" }, { name: "robots", content: "noindex" }],
  }),
  component: SharedCartPage,
});

type Row = {
  key: string;
  line: SharedCartLine;
  product: CatalogItem | null;
  variant: CatalogVariant | null;
  /** null = אפשר להוסיף; אחרת — הסיבה שלא */
  unavailable: string | null;
};

function resolveRow(line: SharedCartLine, byId: Map<string, CatalogItem>): Row {
  const key = `${line.productId}:${line.variantId ?? ""}`;
  const product = byId.get(line.productId) ?? null;
  if (!product) return { key, line, product, variant: null, unavailable: "המוצר כבר לא זמין" };
  let variant: CatalogVariant | null = null;
  if (hasVariants(product)) {
    variant = variantsOf(product).find((v) => v.id === line.variantId) ?? null;
    if (!variant) return { key, line, product, variant, unavailable: "האפשרות כבר לא זמינה" };
    if (!variant.available) return { key, line, product, variant, unavailable: "אזל מהמלאי" };
  } else if (product.is_out_of_stock) {
    return { key, line, product, variant, unavailable: "אזל מהמלאי" };
  }
  return { key, line, product, variant, unavailable: null };
}

function SharedCartPage() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const { session, role, loading: authLoading } = useAuthState();
  const { setCart } = useCart();
  const { closed: restClosed } = useRestState();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const isCustomer = role?.role === "customer";
  const canUseCart = !session || isCustomer;

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    void (async () => {
      try {
        const lines = await loadSharedCart(code);
        if (!lines || lines.length === 0) {
          if (!cancelled) setMissing(true);
          return;
        }
        // המחירים — לפי מי שפותח (מחירון אישי / דרג)
        const { data, error } = await fetchAllRows((from, to) =>
          supabase.rpc("get_catalog").order("id").range(from, to),
        );
        if (error) throw new Error(error.message);
        const byId = new Map(((data as CatalogItem[]) ?? []).map((p) => [p.id, p]));
        const resolved = lines.map((line) => resolveRow(line, byId));
        if (cancelled) return;
        setRows(resolved);
        setSelected(Object.fromEntries(resolved.map((r) => [r.key, r.unavailable === null])));
        setQuantities(
          Object.fromEntries(
            resolved.map((r) => [
              r.key,
              r.product ? normalizeQuantity(r.product, r.line.quantity) : r.line.quantity,
            ]),
          ),
        );
      } catch (error) {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : "טעינת העגלה נכשלה");
        setMissing(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, authLoading, session?.user?.id]);

  const available = useMemo(() => (rows ?? []).filter((r) => r.unavailable === null), [rows]);
  const chosen = available.filter((r) => selected[r.key]);
  const allChosen = available.length > 0 && chosen.length === available.length;
  const priceOf = (r: Row) => (r.variant ? r.variant.price : (r.product?.price ?? null));
  const total = chosen.reduce((sum, r) => sum + (priceOf(r) ?? 0) * (quantities[r.key] ?? 0), 0);
  const hasPrices = chosen.some((r) => priceOf(r) !== null);

  const addSelected = () => {
    if (restClosed) {
      toast.info(REST_CHECKOUT_MESSAGE);
      return;
    }
    if (chosen.length === 0) {
      toast.info("בחרו לפחות מוצר אחד");
      return;
    }
    setCart((current) => {
      let items = current;
      for (const r of chosen) {
        items = addToCartItems(items, r.product!, quantities[r.key] ?? 1, r.variant).items;
      }
      return items;
    });
    for (const r of chosen) {
      trackAddToCart(r.product!.name, (priceOf(r) ?? 0) * (quantities[r.key] ?? 1));
    }
    toast.success(
      chosen.length === 1 ? "המוצר נוסף לעגלה שלך" : `${chosen.length} מוצרים נוספו לעגלה שלך`,
      { action: { label: "לקופה", onClick: () => void navigate({ to: "/checkout" }) } },
    );
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader role={role} email={session?.user.email ?? null} onSignOut={signOut} />
      <StorefrontMain width="5xl" className="py-5 sm:py-8" contentClassName="space-y-4">
        {missing ? (
          <Card className="mx-auto max-w-xl border-dashed" data-testid="shared-cart-missing">
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <Link2Off className="size-10 text-muted-foreground" aria-hidden="true" />
              <p className="text-lg font-semibold">הקישור לא נמצא או שפג תוקפו</p>
              <p className="text-sm text-muted-foreground">
                בקשו מהשולח לשתף את העגלה שוב, או המשיכו לקנות בחנות.
              </p>
              <Button asChild>
                <Link to="/">לכל המוצרים</Link>
              </Button>
            </CardContent>
          </Card>
        ) : rows === null ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> טוען את העגלה…
          </p>
        ) : (
          <div className="space-y-4" data-testid="shared-cart">
            <div>
              <h1 className="font-display text-2xl font-bold">עגלה ששותפה איתך</h1>
              <p className="text-sm text-muted-foreground">
                סמנו את המוצרים שתרצו, עדכנו כמויות, והוסיפו לעגלה שלכם. המחירים לפי החשבון שלכם.
              </p>
            </div>

            {!canUseCart && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                משתמשי צוות לא יכולים להוסיף לעגלה בחנות. כדי להוסיף — פתחו את הקישור בלי להתחבר.
              </p>
            )}

            {available.length > 0 && (
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-sm font-medium text-primary hover:underline"
                  data-testid="shared-cart-toggle-all"
                  onClick={() =>
                    setSelected(Object.fromEntries(available.map((r) => [r.key, !allChosen])))
                  }
                >
                  {allChosen ? "ניקוי הבחירה" : "בחירת הכל"}
                </button>
                <span className="text-sm text-muted-foreground">
                  נבחרו {chosen.length} מתוך {available.length}
                </span>
              </div>
            )}

            <ul className="divide-y rounded-xl border bg-card">
              {rows.map((r) => {
                const off = r.unavailable !== null;
                const label =
                  r.product && r.variant
                    ? variantLabel(r.variant.options, variantAttributesOf(r.product))
                    : "";
                const price = priceOf(r);
                return (
                  <li
                    key={r.key}
                    data-shared-line={r.line.productId}
                    className={`flex flex-wrap items-center gap-3 p-3 ${off ? "opacity-60" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="size-5 accent-primary"
                      aria-label={`בחירת ${r.product?.name ?? "מוצר"}`}
                      disabled={off}
                      checked={!off && Boolean(selected[r.key])}
                      onChange={(event) =>
                        setSelected((s) => ({ ...s, [r.key]: event.target.checked }))
                      }
                    />
                    {r.product?.image_url ? (
                      <img
                        src={r.product.image_url}
                        alt=""
                        className="size-14 shrink-0 rounded-lg border object-cover"
                      />
                    ) : (
                      <div className="size-14 shrink-0 rounded-lg border bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      {r.product ? (
                        <Link
                          to="/product/$productId"
                          params={{ productId: r.product.id }}
                          className="font-semibold hover:underline"
                        >
                          {r.product.name}
                        </Link>
                      ) : (
                        <span className="font-semibold">מוצר שהוסר</span>
                      )}
                      {label && <p className="text-xs text-muted-foreground">{label}</p>}
                      {off ? (
                        <p className="text-xs font-medium text-destructive">{r.unavailable}</p>
                      ) : price !== null ? (
                        <p className="numeric text-sm">{formatIls(price)} ליח'</p>
                      ) : null}
                    </div>
                    {!off && r.product && (
                      <input
                        type="number"
                        inputMode="numeric"
                        aria-label={`כמות ${r.product.name}`}
                        data-testid="shared-cart-qty"
                        className="numeric h-9 w-20 rounded-md border bg-background px-2 text-center"
                        min={minimumQuantity(r.product)}
                        step={packStep(r.product)}
                        value={quantities[r.key] ?? ""}
                        onChange={(event) =>
                          setQuantities((q) => ({ ...q, [r.key]: Number(event.target.value) }))
                        }
                        onBlur={() =>
                          setQuantities((q) => ({
                            ...q,
                            [r.key]: normalizeQuantity(r.product!, q[r.key] || 1),
                          }))
                        }
                      />
                    )}
                  </li>
                );
              })}
            </ul>

            {available.length === 0 ? (
              <p className="text-sm text-muted-foreground">אף אחד מהמוצרים בעגלה לא זמין כרגע.</p>
            ) : (
              canUseCart && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {hasPrices && (
                    <span className="numeric font-semibold">סה"כ: {formatIls(total)}</span>
                  )}
                  <Button
                    size="lg"
                    data-testid="shared-cart-add"
                    disabled={chosen.length === 0}
                    onClick={addSelected}
                  >
                    <ShoppingCart className="size-4" aria-hidden="true" />
                    {chosen.length === 1
                      ? "הוספת המוצר שנבחר לעגלה"
                      : `הוספת ${chosen.length} המוצרים שנבחרו לעגלה`}
                  </Button>
                </div>
              )
            )}
          </div>
        )}
      </StorefrontMain>
      <AppFooter />
    </div>
  );
}

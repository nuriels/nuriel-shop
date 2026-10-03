import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, EyeOff, Loader2, Package, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ProductSummary = {
  id: string;
  name: string;
  sku: string;
  category: string;
  image_url: string | null;
  is_hidden: boolean;
  is_out_of_stock: boolean;
};

const SUMMARY_COLUMNS = "id, name, sku, category, image_url, is_hidden, is_out_of_stock" as const;

/** ערך חיפוש בטוח לסינון "or" של ה-API (בלי תווים שמורים) */
const searchValue = (term: string) => term.replace(/[%*,()"\\]/g, " ").trim();

/**
 * בחירת מוצרים מהקטלוג (פאנל הניהול): חיפוש לפי שם / מק"ט / ברקוד.
 * mode="multi" — רשימה מסודרת (חיצים לשינוי הסדר); mode="single" — מוצר אחד.
 */
export function ProductPicker({
  value,
  onChange,
  mode = "multi",
  max = 12,
  excludeIds = [],
  placeholder = 'חיפוש מוצר לפי שם, מק"ט או ברקוד',
  id,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  mode?: "single" | "multi";
  max?: number;
  excludeIds?: string[];
  placeholder?: string;
  id?: string;
}) {
  const [known, setKnown] = useState<Map<string, ProductSummary>>(new Map());
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<ProductSummary[]>([]);
  const [searching, setSearching] = useState(false);

  // פרטי המוצרים שכבר נבחרו (שם, תמונה) — טוענים רק את מה שעוד לא מוכר
  const missing = useMemo(() => value.filter((v) => !known.has(v)), [value, known]);
  useEffect(() => {
    if (missing.length === 0) return;
    let cancelled = false;
    void supabase
      .from("global_products")
      .select(SUMMARY_COLUMNS)
      .in("id", missing)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setKnown((current) => {
          const next = new Map(current);
          for (const row of data as ProductSummary[]) next.set(row.id, row);
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [missing]);

  // חיפוש 250ms אחרי ההקלדה האחרונה; תשובה ישנה לא דורסת חדשה
  useEffect(() => {
    const q = searchValue(term);
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void supabase
        .from("global_products")
        .select(SUMMARY_COLUMNS)
        .or(`name.ilike."*${q}*",sku.ilike."*${q}*",barcode.eq."${q}"`)
        .order("name")
        .limit(12)
        .then(({ data }) => {
          if (cancelled) return;
          setSearching(false);
          const rows = (data ?? []) as ProductSummary[];
          setResults(rows);
          setKnown((current) => {
            const next = new Map(current);
            for (const row of rows) next.set(row.id, row);
            return next;
          });
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  const hidden = new Set([...excludeIds, ...(mode === "multi" ? value : [])]);
  const visibleResults = results.filter((r) => !hidden.has(r.id));
  const full = mode === "multi" && value.length >= max;

  const pick = (product: ProductSummary) => {
    if (mode === "single") onChange([product.id]);
    else if (!value.includes(product.id) && value.length < max) onChange([...value, product.id]);
    setTerm("");
    setResults([]);
  };
  const remove = (productId: string) => onChange(value.filter((v) => v !== productId));
  const move = (index: number, delta: number) => {
    const next = [...value];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="space-y-1.5">
          {value.map((productId, index) => {
            const product = known.get(productId);
            return (
              <li
                key={productId}
                className="flex items-center gap-2 rounded-lg border border-border bg-card p-2"
              >
                <Thumb url={product?.image_url ?? null} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{product?.name ?? "טוען…"}</p>
                  {product && (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span dir="ltr" className="numeric">
                        {product.sku}
                      </span>
                      <span>· {product.category}</span>
                      <ProductFlags product={product} />
                    </p>
                  )}
                </div>
                {mode === "multi" && value.length > 1 && (
                  <div className="flex flex-col">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      disabled={index === 0}
                      aria-label="להזיז למעלה"
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      disabled={index === value.length - 1}
                      aria-label="להזיז למטה"
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </div>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 text-destructive hover:text-destructive"
                  aria-label={`הסרת ${product?.name ?? "המוצר"}`}
                  onClick={() => remove(productId)}
                >
                  <X className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {!full && (mode === "multi" || value.length === 0) && (
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={id}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            className="pr-9"
          />
          {searching && (
            <Loader2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
      )}
      {mode === "single" && value.length > 0 && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([])}>
          החלפת מוצר
        </Button>
      )}
      {full && <p className="text-xs text-muted-foreground">נבחרו {max} מוצרים — המקסימום.</p>}

      {visibleResults.length > 0 && (
        <ul className="max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-sm">
          {visibleResults.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => pick(product)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md p-2 text-start hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none",
                )}
              >
                <Thumb url={product.image_url} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{product.name}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span dir="ltr" className="numeric">
                      {product.sku}
                    </span>
                    <span>· {product.category}</span>
                    <ProductFlags product={product} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {searchValue(term).length >= 2 && !searching && visibleResults.length === 0 && (
        <p className="text-xs text-muted-foreground">לא נמצאו מוצרים תואמים</p>
      )}
    </div>
  );
}

function Thumb({ url }: { url: string | null }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary/60 p-1">
      {url ? (
        <img src={url} alt="" className="size-full object-contain mix-blend-multiply" />
      ) : (
        <Package className="size-4 text-muted-foreground" aria-hidden="true" />
      )}
    </span>
  );
}

function ProductFlags({ product }: { product: ProductSummary }) {
  return (
    <>
      {product.is_hidden && (
        <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px]">
          <EyeOff className="size-3" /> מוסתר
        </Badge>
      )}
      {product.is_out_of_stock && (
        <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-destructive">
          אזל
        </Badge>
      )}
    </>
  );
}

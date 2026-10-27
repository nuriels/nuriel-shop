import { useEffect, useId, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCategories } from "@/hooks/useCategories";
import {
  categoryLink,
  isValidBannerLink,
  parseBannerLink,
  productLink,
  type BannerLinkTarget,
} from "@/lib/banners";

type Kind = BannerLinkTarget["kind"];
type ProductHit = { id: string; name: string };

const KIND_LABEL: Record<Kind, string> = {
  none: "בלי קישור",
  product: "מוצר",
  category: "קטגוריה",
  url: "עמוד באתר / כתובת",
};

/** תווים שמשמשים את התחביר של חיפוש PostgREST — לא שולחים אותם בחיפוש */
const cleanTerm = (value: string) => value.replace(/[%,()*\\]/g, " ").trim();

/**
 * לאן הבאנר מוביל בלחיצה: מוצר מהחנות (חיפוש לפי שם), קטגוריה, עמוד באתר
 * (מתחיל ב-/) או כתובת מלאה (https://). התוצאה היא אותו קישור שנשמר היום
 * (/product/…, /?category=…) — כך שאין שינוי במבנה הנתונים ולא בבדיקה במסד.
 */
export function BannerLinkPicker({
  value,
  onChange,
  label = "קישור בלחיצה (אופציונלי)",
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  label?: string;
}) {
  const id = useId();
  const parsed = parseBannerLink(value);
  // הסוג נשמר מקומית — כדי שאפשר לבחור "מוצר" לפני שנבחר מוצר מסוים
  const [kind, setKind] = useState<Kind>(parsed.kind);
  useEffect(() => {
    if (parsed.kind !== "none") setKind(parsed.kind);
  }, [parsed.kind]);

  const changeKind = (next: Kind) => {
    setKind(next);
    // מעבר סוג מנקה קישור שלא מתאים לסוג החדש
    if (next !== parsed.kind) onChange(null);
  };

  return (
    <div className="space-y-1.5" data-banner-link>
      <Label htmlFor={`${id}-kind`}>{label}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={kind} onValueChange={(next) => changeKind(next as Kind)}>
          <SelectTrigger id={`${id}-kind`} className="sm:w-44" aria-label="סוג הקישור">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(KIND_LABEL) as Kind[]).map((option) => (
              <SelectItem key={option} value={option}>
                {KIND_LABEL[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="min-w-0 flex-1">
          {kind === "product" && (
            <ProductPicker
              productId={parsed.kind === "product" ? parsed.productId : null}
              onPick={(productId) => onChange(productId ? productLink(productId) : null)}
            />
          )}
          {kind === "category" && (
            <CategoryPicker
              category={parsed.kind === "category" ? parsed.category : null}
              onPick={(category) => onChange(category ? categoryLink(category) : null)}
            />
          )}
          {kind === "url" && <UrlInput value={value ?? ""} onChange={onChange} />}
          {kind === "none" && (
            <p className="flex h-10 items-center text-xs text-muted-foreground">
              הבאנר מוצג בלי קישור
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function UrlInput({ value, onChange }: { value: string; onChange: (next: string | null) => void }) {
  const invalid = value.trim() !== "" && !isValidBannerLink(value);
  return (
    <div className="space-y-1">
      <Input
        dir="ltr"
        inputMode="url"
        maxLength={2000}
        value={value}
        onChange={(event) => onChange(event.target.value || null)}
        placeholder="/about או https://..."
        aria-label="כתובת הקישור"
        aria-invalid={invalid}
        className={invalid ? "border-destructive" : undefined}
      />
      <p className={`text-xs ${invalid ? "text-destructive" : "text-muted-foreground"}`}>
        {invalid
          ? "הקישור חייב להתחיל ב-/ (עמוד באתר) או ב-https:// (אתר אחר)"
          : "עמוד באתר מתחיל ב-/ · אתר אחר נפתח בלשונית חדשה"}
      </p>
    </div>
  );
}

function CategoryPicker({
  category,
  onPick,
}: {
  category: string | null;
  onPick: (category: string | null) => void;
}) {
  const categories = useCategories();
  // קטגוריה שנשמרה ונמחקה בינתיים — עדיין מוצגת, כדי שלא "תיעלם" בשקט
  const options =
    category && !categories.includes(category) ? [category, ...categories] : categories;
  if (options.length === 0) {
    return (
      <p className="flex h-10 items-center text-xs text-muted-foreground">
        אין עדיין קטגוריות בחנות
      </p>
    );
  }
  return (
    <Select value={category ?? ""} onValueChange={(next) => onPick(next)}>
      <SelectTrigger aria-label="בחירת קטגוריה">
        <SelectValue placeholder="בחירת קטגוריה" />
      </SelectTrigger>
      <SelectContent>
        {options.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
            {!categories.includes(name) && " (לא קיימת עוד)"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ProductPicker({
  productId,
  onPick,
}: {
  productId: string | null;
  onPick: (productId: string | null) => void;
}) {
  const [selected, setSelected] = useState<ProductHit | null>(null);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [searching, setSearching] = useState(false);

  // שם המוצר שנבחר (ה-RLS מחזיר רק מוצרים של החנות הנוכחית)
  useEffect(() => {
    if (!productId) {
      setSelected(null);
      return;
    }
    if (selected?.id === productId) return;
    let cancelled = false;
    void supabase
      .from("global_products")
      .select("id, name")
      .eq("id", productId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setSelected(data ?? { id: productId, name: "מוצר שלא נמצא בחנות" });
      });
    return () => {
      cancelled = true;
    };
  }, [productId, selected?.id]);

  useEffect(() => {
    const query = cleanTerm(term);
    if (query.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void supabase
        .from("global_products")
        .select("id, name")
        .ilike("name", `%${query}%`)
        .order("name")
        .limit(8)
        .then(({ data }) => {
          if (cancelled) return;
          setHits(data ?? []);
          setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [term]);

  if (productId && selected) {
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-md border border-border bg-secondary/40 px-3 text-sm">
        <span className="truncate" data-banner-link-product>
          {selected.name}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label="החלפת המוצר"
          onClick={() => onPick(null)}
        >
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="חיפוש מוצר לפי שם…"
        aria-label="חיפוש מוצר"
        className="pr-9"
        autoComplete="off"
      />
      {cleanTerm(term).length >= 2 && (
        <ul
          role="listbox"
          aria-label="תוצאות החיפוש"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {searching && hits.length === 0 ? (
            <li className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> מחפש…
            </li>
          ) : hits.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">לא נמצאו מוצרים</li>
          ) : (
            hits.map((hit) => (
              <li key={hit.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1.5 text-start text-sm hover:bg-accent/15 focus-visible:bg-accent/15 focus-visible:outline-none"
                  onClick={() => {
                    setSelected(hit);
                    setTerm("");
                    onPick(hit.id);
                  }}
                >
                  {hit.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

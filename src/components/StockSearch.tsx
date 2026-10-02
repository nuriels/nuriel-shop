import { useEffect, useRef, useState } from "react";
import { Barcode, Loader2, MapPin, Package } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { lookupStock, unitsLabel, type StockItem } from "@/lib/locations";

/** שדה חיפוש מוצר (שם / מק"ט / ברקוד — גם סורק) עם תוצאות. משותף לבדיקת מלאי ולהעברות */
export function StockSearch({
  onPick,
  autoFocus = false,
  placeholder = 'חיפוש לפי שם, מק"ט או סריקת ברקוד',
}: {
  onPick?: (item: StockItem) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const run = async (text: string, exact = false) => {
    const q = text.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    setBusy(true);
    try {
      const found = await lookupStock(q);
      setResults(found);
      // סריקה / Enter על ברקוד או מק"ט מדויק — בחירה מיידית
      if (exact && onPick) {
        const hit = found.find((f) => f.barcode === q || f.sku === q);
        if (hit) {
          onPick(hit);
          setQuery("");
          setResults(null);
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "החיפוש נכשל");
    } finally {
      setBusy(false);
    }
  };

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div className="space-y-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(query, true);
        }}
        className="relative"
      >
        <Barcode className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            if (timer.current) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => void run(next), 300);
          }}
          placeholder={placeholder}
          className="h-12 ps-10 text-lg"
          autoComplete="off"
        />
        {busy && (
          <Loader2 className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </form>
      {results !== null && results.length === 0 && (
        <p className="text-sm text-muted-foreground">לא נמצא מוצר תואם</p>
      )}
      {results && results.length > 0 && (
        <ul className="space-y-2">
          {results.map((item) => (
            <li key={item.id}>
              <StockCard item={item} onPick={onPick} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** כרטיס מלאי: תמונה, ברקוד, פנוי / שמור / סה"כ, ואיתורים — בלי מחירים */
export function StockCard({
  item,
  onPick,
}: {
  item: StockItem;
  onPick?: ((item: StockItem) => void) | undefined;
}) {
  const total = item.available + item.reserved;
  const body = (
    <div className="flex gap-3 rounded-xl border border-border bg-card p-3 text-right shadow-card">
      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary/60">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt=""
            className="size-full object-contain mix-blend-multiply"
            loading="lazy"
          />
        ) : (
          <Package className="size-7 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-bold leading-snug text-foreground">
          {item.name} {item.is_hidden && <Badge variant="outline">מוסתר</Badge>}
        </p>
        <p className="numeric text-xs text-muted-foreground" dir="ltr">
          {item.barcode ?? ""} {item.barcode ? "·" : ""} {item.sku}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
          <span>
            פנוי:{" "}
            <strong className="numeric text-base">
              {unitsLabel(item.available, item.pack_size)}
            </strong>
          </span>
          {item.reserved > 0 && (
            <span className="text-muted-foreground">
              שמור להזמנות: <span className="numeric">{item.reserved}</span>
            </span>
          )}
          <span className="text-muted-foreground">
            סה"כ במחסן: <span className="numeric">{total}</span>
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {item.locations.length === 0 ? (
            <span className="text-xs text-muted-foreground">אין מלאי פנוי באף איתור</span>
          ) : (
            item.locations.map((loc) => (
              <span
                key={loc.location}
                className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-sm font-medium"
              >
                <MapPin className="size-3.5 text-muted-foreground" />
                {loc.location}: <span className="numeric">{loc.quantity}</span>
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
  if (!onPick) return body;
  return (
    <button
      type="button"
      onClick={() => onPick(item)}
      className="block w-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </button>
  );
}

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  EyeOff,
  Minus,
  Package,
  Plus,
  RotateCcw,
  ScanBarcode,
  ShoppingBasket,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatIls } from "@/lib/catalog";
import { detectBarcodes, isBarcodeDetectionSupported } from "@/lib/barcode-scan";
import {
  availableStock,
  clampQuantity,
  exactCodeMatch,
  hasActiveVariants,
  searchPosProducts,
  type PosCartLine,
  type PosProduct,
  type PosVariant,
} from "@/lib/pos";
import { variantAttributesOf, variantLabel } from "@/lib/variants";
import { cn } from "@/lib/utils";

export type PosProductSectionHandle = { focusSearch: () => void };

/**
 * שלב 2 בקופה: המוצרים. חיפוש לפי שם / מק"ט / ברקוד — קורא ברקודים
 * (מקליד את הקוד + Enter) מוסיף את המוצר מיד, וכך גם מצלמת הטלפון
 * (בדפדפנים שתומכים). העגלה: אפשרות (מידה / צבע), כמות ומחיר ליחידה —
 * המחיר הוא של הלקוח שנבחר, ואפשר לשנות אותו ידנית.
 */
export const PosProductSection = forwardRef<
  PosProductSectionHandle,
  {
    products: readonly PosProduct[];
    productsById: ReadonlyMap<string, PosProduct>;
    lines: readonly PosCartLine[];
    onAdd: (product: PosProduct, variant: PosVariant | null) => void;
    onQuantity: (key: string, quantity: number) => void;
    onPrice: (key: string, price: number) => void;
    onResetPrice: (key: string) => void;
    onVariant: (key: string, variantId: string) => void;
    onRemove: (key: string) => void;
    catalogPrice: (product: PosProduct, variant: PosVariant | null) => number;
  }
>(function PosProductSection(
  {
    products,
    productsById,
    lines,
    onAdd,
    onQuantity,
    onPrice,
    onResetPrice,
    onVariant,
    onRemove,
    catalogPrice,
  },
  ref,
) {
  const [term, setTerm] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focusSearch: () => inputRef.current?.focus() }), []);

  const results = useMemo(() => searchPosProducts(products, term, 8), [products, term]);

  const add = (product: PosProduct, variant: PosVariant | null = null) => {
    onAdd(product, variant);
    setTerm("");
    inputRef.current?.focus();
  };

  /** קוד מסורק / Enter: התאמה מדויקת (ברקוד / מק"ט), או תוצאה יחידה */
  const addByCode = (raw: string): boolean => {
    const match = exactCodeMatch(products, raw);
    if (match) {
      add(match.product, match.variant);
      return true;
    }
    return false;
  };

  return (
    <Card className="shadow-card" data-testid="pos-products">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            2
          </span>
          מוצרים
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (term.trim() === "") return;
              if (addByCode(term)) return;
              const only = results.length === 1 ? results[0] : undefined;
              if (only) add(only);
              else if (results.length === 0) toast.error(`לא נמצא מוצר עבור "${term.trim()}"`);
            }}
          >
            <div className="relative flex-1">
              <ScanBarcode
                className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                ref={inputRef}
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="הוספת מוצר: שם, מק״ט או ברקוד — או סריקה"
                aria-label="חיפוש מוצר או סריקת ברקוד"
                autoComplete="off"
                enterKeyHint="search"
                className="pr-9"
                data-testid="pos-product-search"
                onKeyDown={(event) => {
                  if (event.key === "Escape") setTerm("");
                }}
              />
            </div>
            {term !== "" && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="ניקוי החיפוש"
                onClick={() => {
                  setTerm("");
                  inputRef.current?.focus();
                }}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            )}
            <CameraButton onCode={addByCode} />
          </form>

          {term.trim() !== "" && (
            <ul
              className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border"
              aria-label="תוצאות החיפוש"
              data-testid="pos-product-results"
            >
              {results.length === 0 ? (
                <li className="px-3 py-3 text-sm text-muted-foreground">
                  לא נמצא מוצר — נסו שם אחר, מק״ט או ברקוד
                </li>
              ) : (
                results.map((product) => {
                  const stock = availableStock(product, null);
                  const variants = hasActiveVariants(product);
                  return (
                    <li key={product.id} className="flex items-center gap-3 px-3 py-2">
                      <Thumb url={product.image_url} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                          <span className="truncate">{product.name}</span>
                          {product.is_hidden && (
                            <EyeOff
                              className="size-3.5 shrink-0 text-muted-foreground"
                              aria-label="מוסתר באתר"
                            />
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          מק״ט <span dir="ltr">{product.sku}</span>
                          {product.barcode ? (
                            <>
                              {" · "}
                              <span dir="ltr">{product.barcode}</span>
                            </>
                          ) : null}
                          {product.is_digital
                            ? " · דיגיטלי"
                            : stock !== null
                              ? ` · ${stock > 0 ? `במלאי ${stock}` : "אזל מהמלאי"}`
                              : ""}
                          {variants ? ` · ${product.variants.length} אפשרויות` : ""}
                        </p>
                      </div>
                      <span className="numeric shrink-0 text-sm font-semibold">
                        {formatIls(catalogPrice(product, null))}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => add(product)}
                        aria-label={`הוספת ${product.name}`}
                        data-testid="pos-add-product"
                      >
                        <Plus className="size-4" aria-hidden="true" />
                        הוספה
                      </Button>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>

        {lines.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            <ShoppingBasket className="size-8" aria-hidden="true" />
            העגלה ריקה — חפשו מוצר או סרקו ברקוד
          </div>
        ) : (
          <ul className="space-y-2" aria-label="המוצרים בהזמנה" data-testid="pos-cart">
            {lines.map((line) => {
              const product = productsById.get(line.productId);
              if (!product) return null;
              const variant = product.variants.find((v) => v.id === line.variantId) ?? null;
              return (
                <CartLine
                  key={line.key}
                  line={line}
                  product={product}
                  variant={variant}
                  catalog={catalogPrice(product, variant)}
                  onQuantity={(quantity) => onQuantity(line.key, quantity)}
                  onPrice={(price) => onPrice(line.key, price)}
                  onResetPrice={() => onResetPrice(line.key)}
                  onVariant={(variantId) => onVariant(line.key, variantId)}
                  onRemove={() => onRemove(line.key)}
                />
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
});

function Thumb({ url }: { url: string | null }) {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary">
      {url ? (
        <img src={url} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <Package className="size-4 text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}

function CartLine({
  line,
  product,
  variant,
  catalog,
  onQuantity,
  onPrice,
  onResetPrice,
  onVariant,
  onRemove,
}: {
  line: PosCartLine;
  product: PosProduct;
  variant: PosVariant | null;
  catalog: number;
  onQuantity: (quantity: number) => void;
  onPrice: (price: number) => void;
  onResetPrice: () => void;
  onVariant: (variantId: string) => void;
  onRemove: () => void;
}) {
  const attributes = variantAttributesOf(product);
  const needsVariant = hasActiveVariants(product);
  const stock = availableStock(product, variant);
  const short = stock !== null && line.quantity > stock;
  // שדה המחיר: טקסט חופשי בזמן ההקלדה, נשמר כמספר
  const [priceText, setPriceText] = useState(String(line.unitPrice));
  useEffect(() => setPriceText(String(line.unitPrice)), [line.unitPrice]);

  return (
    <li
      className="space-y-2 rounded-lg border border-border p-3"
      data-testid="pos-cart-line"
      data-product={product.sku}
    >
      <div className="flex items-start gap-3">
        <Thumb url={product.image_url} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold leading-snug">{product.name}</p>
          <p className="text-xs text-muted-foreground">
            מק״ט <span dir="ltr">{variant?.sku || product.sku}</span>
            {product.has_deposit && product.deposit_price !== null && product.deposit_units !== null
              ? ` · כולל פיקדון ${formatIls(product.deposit_price * product.deposit_units)} ליח׳`
              : ""}
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 text-destructive hover:text-destructive"
          onClick={onRemove}
          aria-label={`הסרת ${product.name}`}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>

      {needsVariant && (
        <Select value={line.variantId ?? ""} onValueChange={onVariant}>
          <SelectTrigger
            dir="rtl"
            className={cn(
              "h-9",
              line.variantId === null && "border-amber-400 ring-1 ring-amber-300",
            )}
            aria-label={`אפשרות עבור ${product.name}`}
          >
            <SelectValue
              placeholder={`בחרו ${attributes.map((a) => a.name).join(" / ") || "אפשרות"}`}
            />
          </SelectTrigger>
          <SelectContent dir="rtl">
            {product.variants
              .filter((v) => v.is_active)
              .map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {variantLabel(v.options, attributes)}
                  {v.stock_quantity !== null ? ` · במלאי ${v.stock_quantity}` : ""}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-8"
            onClick={() => onQuantity(line.quantity - 1)}
            disabled={line.quantity <= 1}
            aria-label="הפחתת כמות"
          >
            <Minus className="size-3.5" aria-hidden="true" />
          </Button>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={line.quantity}
            onChange={(event) => onQuantity(clampQuantity(Number(event.target.value)))}
            aria-label={`כמות של ${product.name}`}
            className="numeric h-8 w-16 px-1 text-center font-bold"
            data-testid="pos-line-qty"
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-8"
            onClick={() => onQuantity(line.quantity + 1)}
            aria-label="הוספת כמות"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </Button>
        </div>

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          מחיר ליח׳
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={priceText}
            onChange={(event) => {
              setPriceText(event.target.value);
              const value = Number(event.target.value);
              if (event.target.value.trim() !== "" && Number.isFinite(value) && value >= 0) {
                onPrice(Math.round(value * 100) / 100);
              }
            }}
            onBlur={() => setPriceText(String(line.unitPrice))}
            className="numeric h-8 w-24 px-2 text-center text-sm text-foreground"
            data-testid="pos-line-price"
          />
        </label>
        {line.priceEdited && line.unitPrice !== catalog && (
          <button
            type="button"
            onClick={onResetPrice}
            className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <RotateCcw className="size-3" aria-hidden="true" />
            מחיר קטלוג {formatIls(catalog)}
          </button>
        )}

        <span className="numeric ms-auto text-sm font-bold">
          {formatIls(line.quantity * line.unitPrice)}
        </span>
      </div>

      {short && (
        <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
          {stock !== null && stock > 0
            ? `במלאי רק ${stock} — ההזמנה תישמר, והמלאי ירד ל-0`
            : "המוצר אזל מהמלאי — ההזמנה תישמר בכל זאת"}
        </p>
      )}
    </li>
  );
}

/** סריקה במצלמה (BarcodeDetector — כרום / אנדרואיד). מוסיף ונשאר פתוח לסריקה הבאה */
function CameraButton({ onCode }: { onCode: (code: string) => boolean }) {
  const [on, setOn] = useState(false);
  const [supported, setSupported] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => setSupported(isBarcodeDetectionSupported()), []);

  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        timer = setInterval(() => {
          const video = videoRef.current;
          if (!video || video.readyState < 2) return;
          void detectBarcodes(video).then((codes) => {
            const code = codes[0];
            if (!code) return;
            // אותו קוד מול המצלמה — פעם אחת בשתי שניות
            const last = lastRef.current;
            if (last && last.code === code && Date.now() - last.at < 2000) return;
            lastRef.current = { code, at: Date.now() };
            if (!onCodeRef.current(code)) toast.error(`הברקוד ${code} לא נמצא בקטלוג`);
          });
        }, 400);
      } catch {
        toast.error("לא הצלחנו לפתוח את המצלמה. בדקו הרשאות בדפדפן.");
        setOn(false);
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [on]);

  if (!supported) return null;
  return (
    <>
      <Button
        type="button"
        variant={on ? "secondary" : "outline"}
        onClick={() => setOn((value) => !value)}
        aria-label={on ? "עצירת המצלמה" : "סריקה במצלמה"}
      >
        {on ? <CameraOff className="size-4" /> : <Camera className="size-4" />}
        <span className="hidden sm:inline">{on ? "עצירה" : "מצלמה"}</span>
      </Button>
      {on && (
        <div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-lg border border-border bg-black">
          <video ref={videoRef} playsInline muted className="h-48 w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-accent/80" />
        </div>
      )}
    </>
  );
}

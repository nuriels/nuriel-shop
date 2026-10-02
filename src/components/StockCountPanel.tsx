import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Check,
  ClipboardCheck,
  ClipboardList,
  Loader2,
  ScanBarcode,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCategoryTree } from "@/hooks/useCategories";
import { formatPath, subtreeNames } from "@/lib/category-tree";
import { fetchAllRows } from "@/lib/fetch-all";
import { detectBarcodes, isBarcodeDetectionSupported } from "@/lib/barcode-scan";
import { useBackToClose } from "@/hooks/useBackToClose";

type StockCount = {
  id: string;
  title: string;
  scope_category: string | null;
  status: "open" | "applied" | "cancelled";
  created_at: string;
  applied_at: string | null;
};

type CountProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  barcode: string | null;
  shelf_location: string | null;
  stock_quantity: number;
  pack_size: number | null;
  is_out_of_stock: boolean;
  is_hidden: boolean;
};

type CountLine = {
  product_id: string;
  counted_units: number;
  packs: number | null;
  loose_units: number | null;
  recorded_before: number | null;
  reserved_open: number | null;
  applied_quantity: number | null;
};

type Filter = "all" | "uncounted" | "counted" | "diff";

const PAGE = 60;
const collator = new Intl.Collator("he", { numeric: true, sensitivity: "base" });

function packOf(product: CountProduct): number | null {
  return product.pack_size && product.pack_size >= 2 ? product.pack_size : null;
}

/** מה אמור להיות פיזית על המדף: זמין + שמור להזמנות שעוד לא נשלחו */
function expectedOnShelf(product: CountProduct, reserved: number): number {
  return product.stock_quantity + reserved;
}

/** מוצר שלא נספר עד היום: מלאי 0 שלא מסומן "אזל" ואין עליו שמירות */
function neverCounted(product: CountProduct, reserved: number): boolean {
  return product.stock_quantity === 0 && !product.is_out_of_stock && reserved === 0;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    day: "numeric",
    month: "numeric",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ספירת מלאי — פתיחת ספירה, ספירה במחסן (סריקה/חיפוש), סיכום ואישור אטומי */
export function StockCountPanel() {
  const categoryTree = useCategoryTree();
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [products, setProducts] = useState<CountProduct[]>([]);
  const [reserved, setReserved] = useState<Map<string, number>>(new Map());
  const [lines, setLines] = useState<Map<string, CountLine>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [term, setTerm] = useState("");
  const [visible, setVisible] = useState(PAGE);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [historyCount, setHistoryCount] = useState<StockCount | null>(null);

  const openCount = counts.find((count) => count.status === "open") ?? null;
  const clearFocus = useCallback(() => setFocusId(null), []);

  const load = useCallback(async () => {
    setLoading(true);
    const [countsResult, productsResult, reservedResult] = await Promise.all([
      supabase
        .from("stock_counts")
        .select("id, title, scope_category, status, created_at, applied_at")
        .order("created_at", { ascending: false })
        .limit(30),
      fetchAllRows((from, to) =>
        supabase
          .from("global_products")
          .select(
            "id, sku, name, category, barcode, shelf_location, stock_quantity, pack_size, is_out_of_stock, is_hidden",
          )
          .order("id")
          .range(from, to),
      ),
      supabase.rpc("stock_reserved_open"),
    ]);
    const error = countsResult.error ?? productsResult.error ?? reservedResult.error;
    if (error) toast.error(error.message);
    const nextCounts = (countsResult.data as StockCount[] | null) ?? [];
    setCounts(nextCounts);
    setProducts(productsResult.data as CountProduct[]);
    setReserved(new Map((reservedResult.data ?? []).map((row) => [row.product_id, row.reserved])));

    const open = nextCounts.find((count) => count.status === "open");
    if (open) {
      const { data, error: linesError } = await fetchAllRows((from, to) =>
        supabase
          .from("stock_count_lines")
          .select(
            "product_id, counted_units, packs, loose_units, recorded_before, reserved_open, applied_quantity",
          )
          .eq("count_id", open.id)
          .order("id")
          .range(from, to),
      );
      if (linesError) toast.error(linesError.message);
      setLines(new Map((data as CountLine[]).map((line) => [line.product_id, line])));
    } else {
      setLines(new Map());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // המוצרים בטווח הספירה, ממוינים לפי איתור במחסן — הסופר עובר מדף אחרי מדף
  const scoped = useMemo(() => {
    const scope = openCount?.scope_category
      ? subtreeNames(categoryTree, openCount.scope_category)
      : null;
    return products
      .filter((product) => scope === null || scope.has(product.category))
      .sort(
        (a, b) =>
          collator.compare(a.shelf_location || "תתת", b.shelf_location || "תתת") ||
          collator.compare(a.name, b.name),
      );
  }, [products, openCount?.scope_category, categoryTree]);

  const countedInScope = scoped.filter((product) => lines.has(product.id)).length;

  const query = term.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      scoped.filter((product) => {
        const line = lines.get(product.id);
        if (filter === "uncounted" && line) return false;
        if (filter === "counted" && !line) return false;
        if (filter === "diff") {
          if (!line) return false;
          if (line.counted_units === expectedOnShelf(product, reserved.get(product.id) ?? 0)) {
            return false;
          }
        }
        if (query === "") return true;
        return (
          product.name.toLowerCase().includes(query) ||
          product.sku.includes(query) ||
          (product.barcode ?? "").includes(query) ||
          (product.shelf_location ?? "").toLowerCase().includes(query)
        );
      }),
    [scoped, lines, filter, query, reserved],
  );

  useEffect(() => {
    setVisible(PAGE);
  }, [filter, query]);

  const onSaved = useCallback((line: CountLine | null, productId: string) => {
    setLines((current) => {
      const next = new Map(current);
      if (line) next.set(productId, line);
      else next.delete(productId);
      return next;
    });
  }, []);

  /** ברקוד מסורק (מקורא ברקודים או מהמצלמה) → קופצים לשורת המוצר */
  const jumpToBarcode = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (code === "") return false;
      const product = scoped.find((candidate) => candidate.barcode === code);
      if (!product) {
        const elsewhere = products.find((candidate) => candidate.barcode === code);
        toast.error(
          elsewhere
            ? `"${elsewhere.name}" לא נמצא בטווח הספירה הזו (${elsewhere.category})`
            : `הברקוד ${code} לא נמצא בקטלוג`,
        );
        return false;
      }
      setFilter("all");
      setTerm(code);
      setFocusId(product.id);
      return true;
    },
    [scoped, products],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        טוען את נתוני המלאי...
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl gradient-brand text-primary-foreground">
            <ClipboardList className="size-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">ספירת מלאי</h2>
            <p className="text-sm text-muted-foreground">
              סופרים את מה שעל המדפים, בודקים הפרשים, ורק אז מעדכנים את המלאי — בפעולה אחת.
            </p>
          </div>
        </div>
      </div>

      {openCount ? (
        <>
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">{openCount.title || "ספירת מלאי"}</p>
                  <p className="text-sm text-muted-foreground">
                    {openCount.scope_category
                      ? `קטגוריה: ${openCount.scope_category} (כולל תת-קטגוריות)`
                      : "כל המחסן"}{" "}
                    · נפתחה {formatDate(openCount.created_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <CancelCountButton count={openCount} onDone={load} />
                  <Button onClick={() => setReviewOpen(true)} disabled={countedInScope === 0}>
                    <ClipboardCheck className="size-4" />
                    סיכום ואישור
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-foreground">
                    נספרו <span className="numeric font-semibold">{countedInScope}</span> מתוך{" "}
                    <span className="numeric">{scoped.length}</span> מוצרים
                  </span>
                  <span className="numeric text-muted-foreground">
                    {scoped.length === 0 ? 0 : Math.round((countedInScope / scoped.length) * 100)}%
                  </span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-secondary"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={scoped.length}
                  aria-valuenow={countedInScope}
                >
                  <div
                    className="h-full rounded-full bg-accent transition-[width]"
                    style={{
                      width: `${scoped.length === 0 ? 0 : (countedInScope / scoped.length) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <ScanBar value={term} onChange={setTerm} onScan={jumpToBarcode} />
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="סינון">
                {(
                  [
                    ["all", `הכל (${scoped.length})`],
                    ["uncounted", `לא נספרו (${scoped.length - countedInScope})`],
                    ["counted", `נספרו (${countedInScope})`],
                    ["diff", "עם הפרש"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={filter === value}
                    onClick={() => setFilter(value)}
                    className={`min-h-9 rounded-full border px-3 text-sm transition-colors ${
                      filter === value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-foreground hover:bg-secondary"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {filtered.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
              {query !== "" ? "לא נמצאו מוצרים תואמים" : "אין מוצרים ברשימה הזו"}
            </p>
          ) : (
            <ul className="space-y-2">
              {filtered.slice(0, visible).map((product) => (
                <CountRow
                  key={product.id}
                  countId={openCount.id}
                  product={product}
                  reserved={reserved.get(product.id) ?? 0}
                  line={lines.get(product.id) ?? null}
                  focus={focusId === product.id}
                  onFocused={clearFocus}
                  onSaved={onSaved}
                />
              ))}
            </ul>
          )}
          {filtered.length > visible && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setVisible((value) => value + PAGE)}
            >
              הצגת עוד {Math.min(PAGE, filtered.length - visible)} מוצרים (מוצגים {visible} מתוך{" "}
              {filtered.length})
            </Button>
          )}

          <ReviewDialog
            open={reviewOpen}
            onOpenChange={setReviewOpen}
            count={openCount}
            scoped={scoped}
            lines={lines}
            reserved={reserved}
            onApplied={() => {
              setReviewOpen(false);
              void load();
            }}
          />
        </>
      ) : (
        <NewCountCard categoryTree={categoryTree} onOpened={load} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">ספירות קודמות</CardTitle>
        </CardHeader>
        <CardContent>
          {counts.filter((count) => count.status !== "open").length === 0 ? (
            <p className="text-sm text-muted-foreground">עדיין לא בוצעו ספירות.</p>
          ) : (
            <ul className="divide-y divide-border">
              {counts
                .filter((count) => count.status !== "open")
                .map((count) => (
                  <li
                    key={count.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3"
                  >
                    <div>
                      <p className="font-medium text-foreground">{count.title || "ספירת מלאי"}</p>
                      <p className="text-xs text-muted-foreground">
                        {count.scope_category ?? "כל המחסן"} · נפתחה {formatDate(count.created_at)}
                        {count.applied_at ? ` · אושרה ${formatDate(count.applied_at)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={count.status === "applied" ? "secondary" : "outline"}>
                        {count.status === "applied" ? "אושרה" : "בוטלה"}
                      </Badge>
                      {count.status === "applied" && (
                        <Button variant="ghost" size="sm" onClick={() => setHistoryCount(count)}>
                          פרטים
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <HistoryDialog
        count={historyCount}
        products={products}
        onOpenChange={(open) => !open && setHistoryCount(null)}
      />
    </section>
  );
}

function NewCountCard({
  categoryTree,
  onOpened,
}: {
  categoryTree: ReturnType<typeof useCategoryTree>;
  onOpened: () => void;
}) {
  const [title, setTitle] = useState(
    () =>
      `ספירת מלאי ${new Date().toLocaleDateString("he-IL", { day: "numeric", month: "numeric" })}`,
  );
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    const { error } = await supabase.from("stock_counts").insert({
      title: title.trim(),
      scope_category: scope === "all" ? null : scope,
    });
    setBusy(false);
    if (error) {
      toast.error(
        /duplicate|unique/i.test(error.message)
          ? "כבר יש ספירה פתוחה — רעננו את הדף"
          : error.message,
      );
      return;
    }
    toast.success("הספירה נפתחה. אפשר להתחיל לספור.");
    onOpened();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">פתיחת ספירה חדשה</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="count-title">שם הספירה</Label>
            <Input id="count-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>מה סופרים</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger dir="rtl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl" className="max-h-80">
                <SelectItem value="all">כל המחסן</SelectItem>
                {categoryTree.flat.map((node) => (
                  <SelectItem
                    key={node.name}
                    value={node.name}
                    style={{ paddingRight: `${2 + (node.depth - 1) * 1.25}rem` }}
                  >
                    {formatPath(node)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <ul className="list-disc space-y-1 pr-5 text-sm text-muted-foreground">
          <li>כל מוצר שנספר נשמר מיד — אפשר לעצור ולהמשיך, וכמה עובדים יכולים לספור במקביל.</li>
          <li>המלאי באתר לא משתנה עד שלוחצים "סיכום ואישור" בסוף.</li>
          <li>מומלץ לסיים ליקוט של הזמנות פתוחות לפני הספירה.</li>
        </ul>
        <Button onClick={() => void open()} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          פתיחת הספירה
        </Button>
      </CardContent>
    </Card>
  );
}

function CancelCountButton({ count, onDone }: { count: StockCount; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    setBusy(true);
    const { error } = await supabase
      .from("stock_counts")
      .update({ status: "cancelled" })
      .eq("id", count.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("הספירה בוטלה. המלאי לא השתנה.");
    onDone();
  };
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={busy}>
          <X className="size-4" />
          ביטול הספירה
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent dir="rtl" className="text-right">
        <AlertDialogHeader>
          <AlertDialogTitle>לבטל את הספירה?</AlertDialogTitle>
          <AlertDialogDescription>
            הכמויות שנספרו לא יעודכנו במלאי. המלאי באתר נשאר בדיוק כמו שהוא.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:flex-row-reverse sm:justify-start">
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => void cancel()}
          >
            ביטול הספירה
          </AlertDialogAction>
          <AlertDialogCancel>המשך לספור</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** שורת חיפוש שמקבלת גם קורא ברקודים (מקליד + Enter) וגם סריקה במצלמה */
function ScanBar({
  value,
  onChange,
  onScan,
}: {
  value: string;
  onChange: (value: string) => void;
  onScan: (code: string) => boolean;
}) {
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const supported = isBarcodeDetectionSupported();

  useEffect(() => {
    if (!cameraOn) return;
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
            // נמצא מוצר → עוצרים את המצלמה, כדי להקליד את הכמות בשקט
            if (code && onScan(code)) setCameraOn(false);
          });
        }, 400);
      } catch {
        toast.error("לא הצלחנו לפתוח את המצלמה. בדקו הרשאות בדפדפן.");
        setCameraOn(false);
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraOn, onScan]);

  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          // ספרות בלבד = ברקוד (קורא ברקודים שולח Enter בסוף)
          if (/^\d{6,}$/.test(value.trim())) onScan(value);
        }}
      >
        <div className="relative flex-1">
          <ScanBarcode className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="סריקת ברקוד, או חיפוש לפי שם / מק״ט / איתור"
            aria-label="סריקה או חיפוש מוצר"
            className="pr-9"
            enterKeyHint="search"
          />
        </div>
        {value !== "" && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange("")}
            aria-label="ניקוי"
          >
            <X className="size-4" />
          </Button>
        )}
        {supported && (
          <Button
            type="button"
            variant={cameraOn ? "secondary" : "outline"}
            onClick={() => setCameraOn((on) => !on)}
            aria-label={cameraOn ? "עצירת המצלמה" : "סריקה במצלמה"}
          >
            {cameraOn ? <CameraOff className="size-4" /> : <Camera className="size-4" />}
            <span className="hidden sm:inline">{cameraOn ? "עצירה" : "מצלמה"}</span>
          </Button>
        )}
      </form>
      {cameraOn && (
        <div className="relative overflow-hidden rounded-lg border border-border bg-black">
          <video ref={videoRef} playsInline muted className="h-48 w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-accent/80" />
        </div>
      )}
    </div>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

const CountRow = memo(function CountRow({
  countId,
  product,
  reserved,
  line,
  focus,
  onFocused,
  onSaved,
}: {
  countId: string;
  product: CountProduct;
  reserved: number;
  line: CountLine | null;
  focus: boolean;
  onFocused: () => void;
  onSaved: (line: CountLine | null, productId: string) => void;
}) {
  const pack = packOf(product);
  const [packs, setPacks] = useState(() => (line?.packs != null ? String(line.packs) : ""));
  const [units, setUnits] = useState(() =>
    line ? String(pack ? (line.loose_units ?? 0) : line.counted_units) : "",
  );
  const [state, setState] = useState<SaveState>(line ? "saved" : "idle");
  const firstInput = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>(line ? `${line.counted_units}` : "");

  useEffect(() => {
    if (!focus) return;
    rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    firstInput.current?.focus();
    firstInput.current?.select();
    onFocused();
  }, [focus, onFocused]);

  const total = (): number | null => {
    const p = packs.trim() === "" ? 0 : Number(packs);
    const u = units.trim() === "" ? 0 : Number(units);
    if (!Number.isInteger(p) || !Number.isInteger(u) || p < 0 || u < 0) return NaN;
    if (packs.trim() === "" && units.trim() === "") return null;
    return pack ? p * pack + u : u;
  };

  const save = async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const counted = total();
    if (Number.isNaN(counted)) {
      setState("error");
      return;
    }
    const key = counted === null ? "" : String(counted);
    if (key === lastSaved.current) return;
    setState("saving");
    if (counted === null) {
      const { error } = await supabase
        .from("stock_count_lines")
        .delete()
        .eq("count_id", countId)
        .eq("product_id", product.id);
      if (error) {
        setState("error");
        toast.error(error.message);
        return;
      }
      lastSaved.current = "";
      setState("idle");
      onSaved(null, product.id);
      return;
    }
    const row = {
      count_id: countId,
      product_id: product.id,
      counted_units: counted,
      packs: pack ? (packs.trim() === "" ? 0 : Number(packs)) : null,
      loose_units: pack ? (units.trim() === "" ? 0 : Number(units)) : null,
    };
    const { error } = await supabase
      .from("stock_count_lines")
      .upsert(row, { onConflict: "count_id,product_id" });
    if (error) {
      setState("error");
      toast.error(error.message);
      return;
    }
    lastSaved.current = key;
    setState("saved");
    onSaved(
      { ...row, recorded_before: null, reserved_open: null, applied_quantity: null },
      product.id,
    );
  };

  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    setState("idle");
    timer.current = setTimeout(() => void save(), 900);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const counted = total();
  const expected = expectedOnShelf(product, reserved);
  const fresh = neverCounted(product, reserved);
  const diff =
    counted === null || Number.isNaN(counted) || fresh ? null : (counted as number) - expected;

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    }
  };

  return (
    <li
      ref={rowRef}
      className={`rounded-lg border bg-card p-3 shadow-card ${line ? "border-accent/40" : "border-border"}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="line-clamp-2 font-semibold text-foreground">{product.name}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {product.shelf_location && product.shelf_location !== "A0A" && (
              <Badge variant="outline">איתור {product.shelf_location}</Badge>
            )}
            <span dir="ltr" className="numeric">
              {product.barcode ?? product.sku}
            </span>
            {product.is_hidden && <Badge variant="outline">מוסתר</Badge>}
            {pack && <Badge variant="secondary">מארז {pack}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            {fresh ? (
              "לא נספר עד היום"
            ) : (
              <>
                רשום במערכת: <span className="numeric">{expected}</span>
                {reserved > 0 && (
                  <>
                    {" "}
                    (זמין <span className="numeric">{product.stock_quantity}</span> + שמור להזמנות{" "}
                    <span className="numeric">{reserved}</span>)
                  </>
                )}
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {pack && (
            <div className="space-y-1">
              <Label htmlFor={`packs-${product.id}`} className="text-xs">
                מארזים ({pack})
              </Label>
              <Input
                ref={firstInput}
                id={`packs-${product.id}`}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={packs}
                onChange={(event) => {
                  setPacks(event.target.value);
                  schedule();
                }}
                onBlur={() => void save()}
                onKeyDown={onKeyDown}
                className="h-11 w-20 text-center"
              />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor={`units-${product.id}`} className="text-xs">
              {pack ? "בודדים" : "יחידות"}
            </Label>
            <Input
              ref={pack ? undefined : firstInput}
              id={`units-${product.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={units}
              onChange={(event) => {
                setUnits(event.target.value);
                schedule();
              }}
              onBlur={() => void save()}
              onKeyDown={onKeyDown}
              className="h-11 w-20 text-center"
            />
          </div>
          <div className="flex min-h-11 min-w-24 flex-col justify-center text-xs">
            {counted !== null && !Number.isNaN(counted) && (
              <span className="numeric font-semibold text-foreground">= {counted} יח׳</span>
            )}
            {Number.isNaN(counted) && <span className="text-destructive">מספר לא תקין</span>}
            {diff !== null && (
              <span
                className={`numeric ${diff === 0 ? "text-muted-foreground" : diff > 0 ? "text-primary" : "text-destructive"}`}
              >
                {diff === 0 ? (
                  "תואם"
                ) : (
                  <>
                    <bdi dir="ltr">{diff > 0 ? `+${diff}` : diff}</bdi> מהרשום
                  </>
                )}
              </span>
            )}
          </div>
          <span className="flex size-6 items-center justify-center" aria-live="polite">
            {state === "saving" && (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
            {state === "saved" && <Check className="size-4 text-primary" aria-label="נשמר" />}
            {state === "error" && (
              <TriangleAlert className="size-4 text-destructive" aria-label="לא נשמר" />
            )}
          </span>
        </div>
      </div>
    </li>
  );
});

function ReviewDialog({
  open,
  onOpenChange,
  count,
  scoped,
  lines,
  reserved,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: StockCount;
  scoped: CountProduct[];
  lines: Map<string, CountLine>;
  reserved: Map<string, number>;
  onApplied: () => void;
}) {
  const [busy, setBusy] = useState(false);
  useBackToClose(open, () => onOpenChange(false));
  const rows = useMemo(
    () =>
      scoped
        .filter((product) => lines.has(product.id))
        .map((product) => {
          const line = lines.get(product.id) as CountLine;
          const held = reserved.get(product.id) ?? 0;
          const expected = expectedOnShelf(product, held);
          const available = Math.max(line.counted_units - held, 0);
          const pack = packOf(product) ?? 1;
          return {
            product,
            counted: line.counted_units,
            held,
            expected,
            available,
            fresh: neverCounted(product, held),
            willBeOut: available < pack,
            diff: line.counted_units - expected,
          };
        })
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)),
    [scoped, lines, reserved],
  );
  const uncounted = scoped.length - rows.length;
  const outCount = rows.filter((row) => row.willBeOut && !row.product.is_out_of_stock).length;
  const shortOnReserve = rows.filter((row) => row.counted < row.held);

  const apply = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("apply_stock_count", { _count_id: count.id });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const result = data?.[0];
    toast.success(
      `המלאי עודכן: ${result?.counted ?? rows.length} מוצרים נספרו, ${result?.changed ?? 0} השתנו${
        result?.marked_out_of_stock ? `, ${result.marked_out_of_stock} סומנו "אזל"` : ""
      }`,
      { duration: 8000 },
    );
    onApplied();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-3xl overflow-y-auto text-right">
        <DialogHeader>
          <DialogTitle>סיכום הספירה לפני עדכון המלאי</DialogTitle>
          <DialogDescription>
            הכמות הזמינה למכירה = מה שנספר על המדף, פחות מה ששמור ללקוחות בהזמנות שעוד לא נשלחו
            (הסחורה שלהן עדיין פיזית במחסן).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-3">
          <SummaryTile label="מוצרים שנספרו" value={rows.length} />
          <SummaryTile
            label='יסומנו "אזל"'
            value={outCount}
            tone={outCount > 0 ? "warn" : undefined}
          />
          <SummaryTile label="לא נספרו (לא ישתנו)" value={uncounted} />
        </div>

        {shortOnReserve.length > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">
            <p className="flex items-center gap-2 font-semibold text-destructive">
              <TriangleAlert className="size-4" />
              נספר פחות ממה ששמור להזמנות פתוחות
            </p>
            <p className="mt-1">
              {shortOnReserve
                .map((row) => `${row.product.name} (נספרו ${row.counted}, שמורים ${row.held})`)
                .join(" · ")}
              . כדאי לבדוק את ההזמנות האלה לפני הליקוט.
            </p>
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-secondary text-xs text-muted-foreground">
              <tr>
                <th className="p-2 text-right font-medium">מוצר</th>
                <th className="p-2 text-center font-medium">רשום</th>
                <th className="p-2 text-center font-medium">נספר</th>
                <th className="p-2 text-center font-medium">שמור להזמנות</th>
                <th className="p-2 text-center font-medium">יהיה זמין</th>
                <th className="p-2 text-center font-medium">הפרש</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.product.id}>
                  <td className="p-2">
                    <span className="line-clamp-1">{row.product.name}</span>
                    {row.willBeOut && (
                      <span className="text-xs text-destructive">
                        {" "}
                        · {row.available === 0 ? "אזל" : "פחות ממארז — אזל"}
                      </span>
                    )}
                  </td>
                  <td className="numeric p-2 text-center text-muted-foreground">
                    {row.fresh ? "—" : row.expected}
                  </td>
                  <td className="numeric p-2 text-center font-semibold">{row.counted}</td>
                  <td className="numeric p-2 text-center text-muted-foreground">
                    {row.held || "—"}
                  </td>
                  <td className="numeric p-2 text-center">{row.available}</td>
                  <td
                    className={`numeric p-2 text-center ${row.fresh || row.diff === 0 ? "text-muted-foreground" : row.diff > 0 ? "text-primary" : "text-destructive"}`}
                  >
                    {row.fresh ? (
                      "חדש"
                    ) : row.diff === 0 ? (
                      "תואם"
                    ) : (
                      <bdi dir="ltr">{row.diff > 0 ? `+${row.diff}` : row.diff}</bdi>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="lg" className="w-full" disabled={busy || rows.length === 0}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ClipboardCheck className="size-4" />
              )}
              אישור ועדכון המלאי
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent dir="rtl" className="text-right">
            <AlertDialogHeader>
              <AlertDialogTitle>לעדכן את המלאי לפי הספירה?</AlertDialogTitle>
              <AlertDialogDescription>
                {rows.length} מוצרים יתעדכנו בבת אחת
                {outCount > 0 ? `, ${outCount} יסומנו "אזל"` : ""}.
                {uncounted > 0 ? ` ${uncounted} מוצרים שלא נספרו יישארו כמו שהם.` : ""} אחרי האישור
                הספירה נסגרת ונשמרת בהיסטוריה.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:flex-row-reverse sm:justify-start">
              <AlertDialogAction onClick={() => void apply()}>כן, לעדכן את המלאי</AlertDialogAction>
              <AlertDialogCancel>חזרה לספירה</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn" | undefined;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${tone === "warn" ? "border-destructive/40 bg-destructive/5" : "border-border bg-secondary/50"}`}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="numeric font-display text-2xl text-foreground">{value}</p>
    </div>
  );
}

function HistoryDialog({
  count,
  products,
  onOpenChange,
}: {
  count: StockCount | null;
  products: CountProduct[];
  onOpenChange: (open: boolean) => void;
}) {
  const [lines, setLines] = useState<CountLine[] | null>(null);
  useBackToClose(count !== null, () => onOpenChange(false));
  useEffect(() => {
    if (!count) return;
    setLines(null);
    void fetchAllRows((from, to) =>
      supabase
        .from("stock_count_lines")
        .select(
          "product_id, counted_units, packs, loose_units, recorded_before, reserved_open, applied_quantity",
        )
        .eq("count_id", count.id)
        .order("id")
        .range(from, to),
    ).then(({ data, error }) => {
      if (error) toast.error(error.message);
      setLines(data as CountLine[]);
    });
  }, [count]);
  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  return (
    <Dialog open={count !== null} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-2xl overflow-y-auto text-right">
        <DialogHeader>
          <DialogTitle>{count?.title || "ספירת מלאי"}</DialogTitle>
          <DialogDescription>
            {count?.applied_at ? `אושרה ${formatDate(count.applied_at)}` : ""} · מה היה רשום, מה
            נספר ומה נקבע
          </DialogDescription>
        </DialogHeader>
        {lines === null ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="bg-secondary text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 text-right font-medium">מוצר</th>
                  <th className="p-2 text-center font-medium">היה זמין</th>
                  <th className="p-2 text-center font-medium">נספר</th>
                  <th className="p-2 text-center font-medium">שמור</th>
                  <th className="p-2 text-center font-medium">נקבע</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((line) => (
                  <tr key={line.product_id}>
                    <td className="p-2">{byId.get(line.product_id)?.name ?? "מוצר שנמחק"}</td>
                    <td className="numeric p-2 text-center text-muted-foreground">
                      {line.recorded_before ?? "—"}
                    </td>
                    <td className="numeric p-2 text-center">{line.counted_units}</td>
                    <td className="numeric p-2 text-center text-muted-foreground">
                      {line.reserved_open || "—"}
                    </td>
                    <td className="numeric p-2 text-center font-semibold">
                      {line.applied_quantity ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

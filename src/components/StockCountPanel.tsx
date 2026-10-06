import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Check,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Loader2,
  Printer,
  RotateCcw,
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
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { formatPath, subtreeNames } from "@/lib/category-tree";
import { fetchAllRows } from "@/lib/fetch-all";
import { detectBarcodes, isBarcodeDetectionSupported } from "@/lib/barcode-scan";
import {
  buildCountReport,
  countReportHtml,
  formatMoneyIls,
  signed,
  type CountReport,
  type CountReportInput,
} from "@/lib/stock-count";
import { useBackToClose } from "@/hooks/useBackToClose";
import { cn } from "@/lib/utils";

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
  cost_price: number | null;
  price_tier1: number | null;
};

type CountLine = {
  product_id: string;
  counted_units: number;
  packs: number | null;
  loose_units: number | null;
  counted_at: string;
  recorded_before: number | null;
  reserved_open: number | null;
  applied_quantity: number | null;
  unit_value: number | null;
  value_source: "cost" | "price" | null;
};

type TableKind = "uncounted" | "counted";

const LINE_COLUMNS =
  "product_id, counted_units, packs, loose_units, counted_at, recorded_before, reserved_open, applied_quantity, unit_value, value_source";

const PAGE = 50;
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

/** שווי ליחידה להערכה לפני העדכון — כמו במסד: מחיר עלות, אחרת מחיר מכירה */
function estimatedUnitValue(product: CountProduct): number {
  const cost = Number(product.cost_price ?? 0);
  return cost > 0 ? cost : Number(product.price_tier1 ?? 0);
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

/**
 * ספירת מלאי (חלק 23): "התחל ספירת מלאי חדשה" → שתי טבלאות: למעלה "מוצרים
 * שטרם נספרו" (כל הקטלוג בהתחלה), למטה "מוצרים שנספרו". כמות + "שמור" מעבירה
 * את המוצר למטה (0 נשמר כ-0; שדה ריק לא מעביר), ושם אפשר לעדכן שוב. הספירה
 * נשמרת במסד — אפשר לסגור את המחשב ולהמשיך אחר כך.
 * "סיים ספירה ועדכן מלאי": עדכון חותך רק למה שנספר (0 → "אזל"), ודו"ח ספירה
 * להדפסה: כמות קודמת, חדשה, והפרש בשווי.
 */
export function StockCountPanel() {
  const categoryTree = useCategoryTree();
  const { settings } = useSiteSettings();
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [products, setProducts] = useState<CountProduct[]>([]);
  const [reserved, setReserved] = useState<Map<string, number>>(new Map());
  const [lines, setLines] = useState<Map<string, CountLine>>(new Map());
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState("");
  const [visible, setVisible] = useState<Record<TableKind, number>>({
    uncounted: PAGE,
    counted: PAGE,
  });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [reportCount, setReportCount] = useState<StockCount | null>(null);

  const openCount = counts.find((count) => count.status === "open") ?? null;
  const clearFocus = useCallback(() => setFocusId(null), []);
  const storeName = settings?.business_name?.trim() || settings?.site_title?.trim() || "החנות";

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
            "id, sku, name, category, barcode, shelf_location, stock_quantity, pack_size, is_out_of_stock, is_hidden, cost_price, price_tier1",
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
          .select(LINE_COLUMNS)
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
  const matches = useCallback(
    (product: CountProduct) =>
      query === "" ||
      product.name.toLowerCase().includes(query) ||
      product.sku.toLowerCase().includes(query) ||
      (product.barcode ?? "").includes(query) ||
      (product.shelf_location ?? "").toLowerCase().includes(query),
    [query],
  );

  // למעלה: טרם נספרו (לפי המדפים). למטה: נספרו — האחרון שנספר ראשון
  const uncounted = useMemo(
    () => scoped.filter((product) => !lines.has(product.id) && matches(product)),
    [scoped, lines, matches],
  );
  const counted = useMemo(
    () =>
      scoped
        .filter((product) => lines.has(product.id) && matches(product))
        .sort((a, b) =>
          (lines.get(b.id)?.counted_at ?? "").localeCompare(lines.get(a.id)?.counted_at ?? ""),
        ),
    [scoped, lines, matches],
  );

  useEffect(() => {
    setVisible({ uncounted: PAGE, counted: PAGE });
  }, [query]);

  const onSaved = useCallback(
    (line: CountLine | null, productId: string, from: TableKind) => {
      if (from === "uncounted" && line) {
        // ממשיכים ישר למוצר הבא בטבלה העליונה — ספירה רצופה מהמקלדת
        const at = uncounted.findIndex((product) => product.id === productId);
        const next = uncounted[at + 1] ?? null;
        if (next) setFocusId(next.id);
      }
      setLines((current) => {
        const next = new Map(current);
        if (line) next.set(productId, line);
        else next.delete(productId);
        return next;
      });
    },
    [uncounted],
  );

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

  const progress = scoped.length === 0 ? 0 : Math.round((countedInScope / scoped.length) * 100);

  return (
    <section className="space-y-6" data-stock-count>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl gradient-brand text-primary-foreground">
            <ClipboardList className="size-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">ספירת מלאי</h2>
            <p className="text-sm text-muted-foreground">
              סופרים מה שעל המדפים, ובסוף מעדכנים את המלאי בפעולה אחת — עם דו״ח הפרשים להדפסה.
            </p>
          </div>
        </div>
      </div>

      {openCount ? (
        <>
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{openCount.title || "ספירת מלאי"}</p>
                  <p className="text-sm text-muted-foreground">
                    {openCount.scope_category
                      ? `קטגוריה: ${openCount.scope_category} (כולל תת-קטגוריות)`
                      : "כל המחסן"}{" "}
                    · נפתחה {formatDate(openCount.created_at)} · נשמרת אוטומטית — אפשר להמשיך אחר כך
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <CancelCountButton count={openCount} onDone={load} />
                  <Button
                    onClick={() => setFinishOpen(true)}
                    disabled={countedInScope === 0}
                    data-finish-count
                  >
                    <ClipboardCheck className="size-4" />
                    סיים ספירה ועדכן מלאי
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-foreground" data-count-progress>
                    נספרו <span className="numeric font-semibold">{countedInScope}</span> מתוך{" "}
                    <span className="numeric">{scoped.length}</span> מוצרים
                  </span>
                  <span className="numeric text-muted-foreground">{progress}%</span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-secondary"
                  role="progressbar"
                  aria-label="התקדמות הספירה"
                  aria-valuemin={0}
                  aria-valuemax={scoped.length}
                  aria-valuenow={countedInScope}
                >
                  <div
                    className="h-full rounded-full bg-accent transition-[width]"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
              <ScanBar value={term} onChange={setTerm} onScan={jumpToBarcode} />
            </CardContent>
          </Card>

          <CountTable
            kind="uncounted"
            title="מוצרים שטרם נספרו"
            hint='הזינו כמות ולחצו "שמור" (או Enter) — המוצר עובר לטבלה התחתונה. 0 נשמר כ-0; שדה ריק לא עובר.'
            emptyText={
              query !== ""
                ? "אין מוצרים תואמים שטרם נספרו"
                : 'כל המוצרים בטווח נספרו — אפשר ללחוץ "סיים ספירה ועדכן מלאי"'
            }
            countId={openCount.id}
            products={uncounted}
            visible={visible.uncounted}
            onMore={() => setVisible((value) => ({ ...value, uncounted: value.uncounted + PAGE }))}
            lines={lines}
            reserved={reserved}
            focusId={focusId}
            onFocused={clearFocus}
            onSaved={onSaved}
          />

          <CountTable
            kind="counted"
            title="מוצרים שנספרו"
            hint='מצאתם עוד פריטים? עדכנו את הכמות ולחצו "עדכון". אפשר גם להחזיר מוצר לטבלה העליונה.'
            emptyText={
              query !== ""
                ? "אין מוצרים תואמים שנספרו"
                : 'עדיין לא נספרו מוצרים. הזינו כמות בטבלה למעלה ולחצו "שמור".'
            }
            countId={openCount.id}
            products={counted}
            visible={visible.counted}
            onMore={() => setVisible((value) => ({ ...value, counted: value.counted + PAGE }))}
            lines={lines}
            reserved={reserved}
            focusId={focusId}
            onFocused={clearFocus}
            onSaved={onSaved}
          />

          <FinishDialog
            open={finishOpen}
            onOpenChange={setFinishOpen}
            count={openCount}
            scoped={scoped}
            lines={lines}
            reserved={reserved}
            onApplied={(applied) => {
              setFinishOpen(false);
              setTerm("");
              setReportCount(applied);
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
                        {count.applied_at ? ` · עודכנה ${formatDate(count.applied_at)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={count.status === "applied" ? "secondary" : "outline"}>
                        {count.status === "applied" ? "עודכנה" : "בוטלה"}
                      </Badge>
                      {count.status === "applied" && (
                        <Button variant="ghost" size="sm" onClick={() => setReportCount(count)}>
                          <FileText className="size-4" />
                          דו״ח ספירה
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ReportDialog
        count={reportCount}
        products={products}
        storeName={storeName}
        onOpenChange={(open) => !open && setReportCount(null)}
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
        <CardTitle className="text-lg">ספירת מלאי חדשה</CardTitle>
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
          <li>
            כל מוצר שנספר נשמר מיד במערכת — אפשר לסגור את המחשב ולהמשיך אחר כך, וכמה עובדים יכולים
            לספור במקביל.
          </li>
          <li>המלאי באתר לא משתנה עד שלוחצים &quot;סיים ספירה ועדכן מלאי&quot; בסוף.</li>
          <li>מוצרים שלא נספרו נשארים בדיוק כמו שהם. מוצר שנספר 0 יסומן &quot;אזל במלאי&quot;.</li>
          <li>מומלץ לסיים ליקוט של הזמנות פתוחות לפני הספירה.</li>
        </ul>
        <Button onClick={() => void open()} disabled={busy} size="lg" data-start-count>
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ClipboardList className="size-4" />
          )}
          התחל ספירת מלאי חדשה
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

/** טבלה אחת מהשתיים: "טרם נספרו" (למעלה) או "נספרו" (למטה) */
function CountTable({
  kind,
  title,
  hint,
  emptyText,
  countId,
  products,
  visible,
  onMore,
  lines,
  reserved,
  focusId,
  onFocused,
  onSaved,
}: {
  kind: TableKind;
  title: string;
  hint: string;
  emptyText: string;
  countId: string;
  products: CountProduct[];
  visible: number;
  onMore: () => void;
  lines: Map<string, CountLine>;
  reserved: Map<string, number>;
  focusId: string | null;
  onFocused: () => void;
  onSaved: (line: CountLine | null, productId: string, from: TableKind) => void;
}) {
  const shown = products.slice(0, visible);
  const titleId = `count-table-${kind}`;
  return (
    <section className="space-y-2" aria-labelledby={titleId} data-count-table={kind}>
      <div className="space-y-0.5">
        <h3 id={titleId} className="flex items-center gap-2 text-base font-bold text-foreground">
          {title}
          <Badge
            variant={kind === "counted" ? "secondary" : "outline"}
            className="numeric"
            data-count-total
          >
            {products.length}
          </Badge>
        </h3>
        <p className="text-xs leading-5 text-muted-foreground">{hint}</p>
      </div>
      {products.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-secondary text-xs text-muted-foreground">
              <tr>
                <th className="p-2 text-right font-medium">מוצר</th>
                <th className="hidden w-24 p-2 text-center font-medium sm:table-cell">רשום</th>
                {kind === "counted" && (
                  <th className="hidden w-24 p-2 text-center font-medium sm:table-cell">הפרש</th>
                )}
                <th className="w-[6.5rem] p-2 text-center font-medium sm:w-44">
                  {kind === "counted" ? "נספר" : "כמות שנספרה"}
                </th>
                <th className="w-[5rem] p-2 sm:w-36">
                  <span className="sr-only">פעולה</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((product) => (
                <CountRow
                  key={`${kind}-${product.id}`}
                  kind={kind}
                  countId={countId}
                  product={product}
                  reserved={reserved.get(product.id) ?? 0}
                  line={lines.get(product.id) ?? null}
                  focus={focusId === product.id}
                  onFocused={onFocused}
                  onSaved={onSaved}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {products.length > visible && (
        <Button variant="outline" className="w-full" onClick={onMore}>
          הצגת עוד {Math.min(PAGE, products.length - visible)} מוצרים (מוצגים {visible} מתוך{" "}
          {products.length})
        </Button>
      )}
    </section>
  );
}

const CountRow = memo(function CountRow({
  kind,
  countId,
  product,
  reserved,
  line,
  focus,
  onFocused,
  onSaved,
}: {
  kind: TableKind;
  countId: string;
  product: CountProduct;
  reserved: number;
  line: CountLine | null;
  focus: boolean;
  onFocused: () => void;
  onSaved: (line: CountLine | null, productId: string, from: TableKind) => void;
}) {
  const pack = packOf(product);
  const [packs, setPacks] = useState(() => (line?.packs != null ? String(line.packs) : ""));
  const [units, setUnits] = useState(() =>
    line ? String(pack ? (line.loose_units ?? 0) : line.counted_units) : "",
  );
  const [busy, setBusy] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (!focus) return;
    rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    firstInput.current?.focus();
    firstInput.current?.select();
    onFocused();
  }, [focus, onFocused]);

  /** הכמות ביחידות; null = לא הוזן כלום; NaN = לא תקין */
  const total = (): number | null => {
    const p = packs.trim() === "" ? 0 : Number(packs);
    const u = units.trim() === "" ? 0 : Number(units);
    if (!Number.isInteger(p) || !Number.isInteger(u) || p < 0 || u < 0) return NaN;
    if (packs.trim() === "" && units.trim() === "") return null;
    return pack ? p * pack + u : u;
  };

  const save = async () => {
    const value = total();
    if (value === null) {
      // שדה ריק לא מעביר את המוצר — 0 צריך להקליד במפורש
      toast.error(`הזינו כמות ל"${product.name}" (0 אם אין במלאי)`);
      firstInput.current?.focus();
      return;
    }
    if (Number.isNaN(value)) {
      toast.error("כמות לא תקינה — מספר שלם, 0 ומעלה");
      firstInput.current?.focus();
      return;
    }
    setBusy(true);
    const row = {
      count_id: countId,
      product_id: product.id,
      counted_units: value,
      packs: pack ? (packs.trim() === "" ? 0 : Number(packs)) : null,
      loose_units: pack ? (units.trim() === "" ? 0 : Number(units)) : null,
    };
    const { error } = await supabase
      .from("stock_count_lines")
      .upsert(row, { onConflict: "count_id,product_id" });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (kind === "counted") toast.success(`"${product.name}" עודכן: ${value} יח׳`);
    onSaved(
      {
        product_id: product.id,
        counted_units: row.counted_units,
        packs: row.packs,
        loose_units: row.loose_units,
        counted_at: new Date().toISOString(),
        recorded_before: null,
        reserved_open: null,
        applied_quantity: null,
        unit_value: null,
        value_source: null,
      },
      product.id,
      kind,
    );
  };

  /** החזרה ל"טרם נספרו" (נספר בטעות) */
  const undo = async () => {
    setBusy(true);
    const { error } = await supabase
      .from("stock_count_lines")
      .delete()
      .eq("count_id", countId)
      .eq("product_id", product.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`"${product.name}" חזר לטבלת "טרם נספרו"`);
    onSaved(null, product.id, kind);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    }
  };

  const expected = expectedOnShelf(product, reserved);
  const fresh = neverCounted(product, reserved);
  const diff = kind === "counted" && line && !fresh ? line.counted_units - expected : null;
  const recorded = fresh ? "לא נספר עד היום" : `רשום: ${expected}`;
  const diffNode =
    diff === null ? (
      <span className="text-xs text-muted-foreground">חדש</span>
    ) : (
      <span
        className={cn(
          "numeric text-sm font-semibold",
          diff === 0 ? "text-muted-foreground" : diff > 0 ? "text-primary" : "text-destructive",
        )}
      >
        {diff === 0 ? "תואם" : <bdi>{signed(diff)}</bdi>}
      </span>
    );
  const inputClass = "h-10 w-full min-w-0 px-1.5 text-center";

  return (
    <tr
      ref={rowRef}
      className={cn("align-top", kind === "counted" && "bg-accent/5")}
      data-count-row={product.name}
    >
      <td className="min-w-0 p-2">
        <p className="whitespace-normal break-words font-semibold text-foreground [overflow-wrap:anywhere]">
          {product.name}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span dir="ltr" className="numeric break-all">
            {product.barcode ?? product.sku}
          </span>
          {product.shelf_location && product.shelf_location !== "A0A" && (
            <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
              איתור {product.shelf_location}
            </Badge>
          )}
          {product.is_hidden && (
            <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
              מוסתר
            </Badge>
          )}
          {pack && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
              מארז {pack}
            </Badge>
          )}
        </div>
        {/* בנייד — מה שבמחשב מופיע בעמודות */}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground sm:hidden">
          <span className="numeric">{recorded}</span>
          {kind === "counted" && <span>הפרש: {diffNode}</span>}
        </p>
      </td>
      <td className="hidden p-2 text-center sm:table-cell">
        {fresh ? (
          <span className="text-xs text-muted-foreground">לא נספר עד היום</span>
        ) : (
          <span className="numeric text-foreground">{expected}</span>
        )}
        {reserved > 0 && (
          <span className="block text-[11px] text-muted-foreground">
            כולל <span className="numeric">{reserved}</span> שמורים להזמנות
          </span>
        )}
      </td>
      {kind === "counted" && <td className="hidden p-2 text-center sm:table-cell">{diffNode}</td>}
      <td className="p-2">
        <div className={cn("flex gap-1", pack ? "flex-col sm:flex-row" : "")}>
          {pack && (
            <Input
              ref={firstInput}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={packs}
              onChange={(event) => setPacks(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`מארזים (${pack})`}
              aria-label={`מארזים של ${pack} — ${product.name}`}
              className={inputClass}
            />
          )}
          <Input
            ref={pack ? undefined : firstInput}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={units}
            onChange={(event) => setUnits(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={pack ? "בודדים" : "כמות"}
            aria-label={`${pack ? "יחידות בודדות" : "כמות שנספרה"} — ${product.name}`}
            className={inputClass}
            data-count-input
          />
        </div>
      </td>
      <td className="p-2">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
          <Button
            size="sm"
            className="h-10 w-full sm:w-auto"
            variant={kind === "counted" ? "outline" : "default"}
            disabled={busy}
            onClick={() => void save()}
            aria-label={`${kind === "counted" ? "עדכון" : "שמירה"} — ${product.name}`}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : kind === "counted" ? null : (
              <Check className="size-4" aria-hidden="true" />
            )}
            {kind === "counted" ? "עדכון" : "שמור"}
          </Button>
          {kind === "counted" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-full px-2 text-xs text-muted-foreground sm:h-10 sm:w-auto"
              disabled={busy}
              onClick={() => void undo()}
              aria-label={`החזרת ${product.name} לטבלת "טרם נספרו"`}
              title='החזרה ל"טרם נספרו"'
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              <span className="sm:sr-only">החזרה</span>
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
});

/** "סיים ספירה ועדכן מלאי": סיכום, אישור, עדכון חותך — ואז הדו"ח */
function FinishDialog({
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
  onApplied: (count: StockCount) => void;
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
          const available = Math.max(line.counted_units - held, 0);
          const pack = packOf(product) ?? 1;
          return {
            product,
            counted: line.counted_units,
            held,
            available,
            willBeOut: available < pack,
            diffUnits: available - product.stock_quantity,
            diffValue: (available - product.stock_quantity) * estimatedUnitValue(product),
          };
        }),
    [scoped, lines, reserved],
  );
  const uncountedCount = scoped.length - rows.length;
  const outCount = rows.filter((row) => row.willBeOut && !row.product.is_out_of_stock).length;
  const changed = rows.filter((row) => row.diffUnits !== 0).length;
  const valueDiff = rows.reduce((sum, row) => sum + row.diffValue, 0);
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
    onApplied({ ...count, status: "applied", applied_at: new Date().toISOString() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-xl overflow-y-auto text-right">
        <DialogHeader>
          <DialogTitle>לסיים את הספירה ולעדכן את המלאי?</DialogTitle>
          <DialogDescription>
            הכמויות של המוצרים שנספרו יוחלפו בכמות שנספרה (פחות מה ששמור ללקוחות בהזמנות שעוד לא
            נשלחו). מוצרים שלא נספרו לא ישתנו. אחרי העדכון יוצג דו״ח ספירה להדפסה.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryTile label="נספרו (יתעדכנו)" value={String(rows.length)} />
          <SummaryTile label="ישתנו" value={String(changed)} />
          <SummaryTile
            label='יסומנו "אזל"'
            value={String(outCount)}
            tone={outCount > 0 ? "warn" : undefined}
          />
          <SummaryTile label="לא נספרו (לא ישתנו)" value={String(uncountedCount)} />
        </div>
        <p className="rounded-lg border border-border bg-secondary/50 p-3 text-sm">
          הפרש משוער בשווי:{" "}
          <bdi
            className={cn(
              "numeric font-bold",
              valueDiff > 0 ? "text-primary" : valueDiff < 0 ? "text-destructive" : "",
            )}
          >
            {signed(valueDiff, true)}
          </bdi>{" "}
          <span className="text-xs text-muted-foreground">
            (לפי מחיר עלות; כשאין — מחיר מכירה. הסכום המדויק בדו״ח)
          </span>
        </p>

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

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-start">
          <Button
            size="lg"
            onClick={() => void apply()}
            disabled={busy || rows.length === 0}
            data-confirm-finish
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ClipboardCheck className="size-4" />
            )}
            כן — סיים ספירה ועדכן מלאי
          </Button>
          <Button size="lg" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            חזרה לספירה
          </Button>
        </div>
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
  value: string;
  tone?: "warn" | "gain" | "loss" | undefined;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        tone === "warn"
          ? "border-destructive/40 bg-destructive/5"
          : "border-border bg-secondary/50",
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "numeric font-display text-xl text-foreground",
          tone === "gain" && "text-primary",
          tone === "loss" && "text-destructive",
        )}
      >
        <bdi>{value}</bdi>
      </p>
    </div>
  );
}

/** דו"ח ספירה: לכל פריט — כמות קודמת, חדשה, הפרש ביחידות ובשווי; הדפסה */
function ReportDialog({
  count,
  products,
  storeName,
  onOpenChange,
}: {
  count: StockCount | null;
  products: CountProduct[];
  storeName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [report, setReport] = useState<CountReport | null>(null);
  useBackToClose(count !== null, () => onOpenChange(false));
  const byId = useMemo(
    () =>
      new Map(
        products.map((product) => [
          product.id,
          { name: product.name, sku: product.sku, barcode: product.barcode },
        ]),
      ),
    [products],
  );

  useEffect(() => {
    if (!count) return;
    setReport(null);
    let alive = true;
    void fetchAllRows((from, to) =>
      supabase
        .from("stock_count_lines")
        .select(LINE_COLUMNS)
        .eq("count_id", count.id)
        .order("id")
        .range(from, to),
    ).then(({ data, error }) => {
      if (!alive) return;
      if (error) toast.error(error.message);
      setReport(buildCountReport((data ?? []) as CountReportInput[], byId));
    });
    return () => {
      alive = false;
    };
  }, [count, byId]);

  const print = () => {
    if (!count || !report) return;
    const html = countReportHtml(report, {
      storeName,
      title: count.title || "ספירת מלאי",
      scope: count.scope_category ?? "כל המחסן",
      appliedAt: count.applied_at,
    });
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("הדפדפן חסם את חלון ההדפסה — אפשרו חלונות קופצים לאתר ונסו שוב");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    window.setTimeout(() => win.print(), 300);
  };

  const t = report?.totals;
  return (
    <Dialog open={count !== null} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-h-[92vh] max-w-3xl overflow-y-auto text-right"
        data-count-report
      >
        <DialogHeader>
          <DialogTitle>דו״ח ספירה — {count?.title || "ספירת מלאי"}</DialogTitle>
          <DialogDescription>
            {count?.scope_category ?? "כל המחסן"}
            {count?.applied_at ? ` · עודכן ${formatDate(count.applied_at)}` : ""} · כמות קודמת, כמות
            חדשה והפרש בשווי לכל פריט שנספר
          </DialogDescription>
        </DialogHeader>
        {report === null || !t ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryTile label="פריטים שנספרו" value={String(t.lines)} />
              <SummaryTile label="השתנו" value={String(t.changed)} />
              <SummaryTile label="עודף (שווי)" value={signed(t.valueGained, true)} tone="gain" />
              <SummaryTile label="חוסר (שווי)" value={signed(-t.valueLost, true)} tone="loss" />
            </div>
            <p className="text-sm" data-report-net>
              הפרש נטו בשווי:{" "}
              <bdi
                className={cn(
                  "numeric font-bold",
                  t.netValue > 0 ? "text-primary" : t.netValue < 0 ? "text-destructive" : "",
                )}
              >
                {signed(t.netValue, true)}
              </bdi>
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[38rem] text-sm">
                <thead className="bg-secondary text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2 text-right font-medium">מוצר</th>
                    <th className="p-2 text-center font-medium">כמות קודמת</th>
                    <th className="p-2 text-center font-medium">כמות חדשה</th>
                    {report.hasReserved && (
                      <th className="p-2 text-center font-medium">שמור להזמנות</th>
                    )}
                    <th className="p-2 text-center font-medium">הפרש</th>
                    <th className="p-2 text-center font-medium">שווי ליחידה</th>
                    <th className="p-2 text-center font-medium">הפרש בשווי</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.lines.map((line) => {
                    const tone =
                      line.diffUnits > 0
                        ? "text-primary"
                        : line.diffUnits < 0
                          ? "text-destructive"
                          : "text-muted-foreground";
                    return (
                      <tr key={line.productId} data-report-row={line.name}>
                        <td className="p-2">
                          <span className="block break-words">{line.name}</span>
                          <span dir="ltr" className="numeric text-[11px] text-muted-foreground">
                            {line.barcode ?? line.sku}
                          </span>
                        </td>
                        <td className="numeric p-2 text-center text-muted-foreground">
                          {line.before}
                        </td>
                        <td className="numeric p-2 text-center font-semibold">{line.after}</td>
                        {report.hasReserved && (
                          <td className="numeric p-2 text-center text-muted-foreground">
                            {line.reserved || "—"}
                          </td>
                        )}
                        <td className={cn("numeric p-2 text-center", tone)}>
                          <bdi>{signed(line.diffUnits)}</bdi>
                        </td>
                        <td className="numeric p-2 text-center text-muted-foreground">
                          {formatMoneyIls(line.unitValue)}
                          {line.valueSource === "price" ? "*" : ""}
                        </td>
                        <td className={cn("numeric p-2 text-center font-semibold", tone)}>
                          <bdi>{signed(line.diffValue, true)}</bdi>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              השווי ליחידה נקבע ברגע העדכון: מחיר העלות
              {report.usesSalePrice ? "; * = אין מחיר עלות — לפי מחיר המכירה" : ""}.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-start">
              <Button onClick={print} data-print-report>
                <Printer className="size-4" />
                הדפסת הדו״ח
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                סגירה
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

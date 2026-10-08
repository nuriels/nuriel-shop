import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Barcode,
  EyeOff,
  FolderTree,
  Hand,
  Loader2,
  Package,
  Printer,
  RefreshCw,
  Search,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { LabelPrintView } from "@/components/labels/LabelPrintView";
import { useCategoryTree } from "@/hooks/useCategories";
import { useLiftA11yButton } from "@/hooks/useLiftA11yButton";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { formatIls } from "@/lib/catalog";
import { inCategories, subtreeNames } from "@/lib/category-tree";
import {
  BARCODE_LABEL_DEFAULT,
  BARCODE_LABEL_LIMITS,
  BARCODE_LABEL_PRESETS,
  DEFAULT_LABEL_OPTIONS,
  MAX_COPIES,
  MAX_LABELS_PER_RUN,
  a4Grid,
  barcodeFits,
  barcodeLabelSizeProblem,
  clampCopies,
  copiesFor,
  labelCodeFor,
  labelDataFor,
  renderBarcodeLabelCanvas,
  totalLabels,
  type BarcodeLabelOptions,
  type BarcodeLabelSize,
  type CopiesMode,
  type LabelJob,
  type LabelLayout,
  type LabelStore,
} from "@/lib/barcode-labels";
import {
  loadBarcodeLabelSize,
  loadLabelCatalog,
  saveBarcodeLabelSize,
  type LabelCatalogProduct,
} from "@/lib/barcode-labels-data";
import { DEFAULT_STORE_NAME } from "@/lib/branding";
import { cn } from "@/lib/utils";

type Scope = "stock" | "category" | "manual";

const PREFS_KEY = "barcode-labels:prefs";
const PAGE = 60;

type Prefs = { layout: LabelLayout; options: BarcodeLabelOptions; copiesMode: CopiesMode };

function readPrefs(): Partial<Prefs> {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
  } catch {
    return {};
  }
}

function writePrefs(prefs: Prefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // אחסון חסום (גלישה פרטית) — לא קריטי
  }
}

/**
 * מחולל מדבקות ברקוד (/admin/inventory/labels → ?tab=labels): בוחרים מה
 * להדפיס — כל המלאי, קטגוריה, או מוצרים בודדים — כמה מדבקות לכל מוצר,
 * וגודל המדבקה (ברירת מחדל 70×40 מ"מ, נשמר לחנות). "הפק מדבקות" פותח
 * תצוגת הדפסה מוכנה (גליל למדפסת תרמית או דף A4) + הורדת PDF.
 */
export function BarcodeLabelsPanel() {
  const tree = useCategoryTree();
  const { settings } = useSiteSettings();
  const [products, setProducts] = useState<LabelCatalogProduct[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("stock");
  const [category, setCategory] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [included, setIncluded] = useState<Set<string>>(() => new Set());
  const [copiesMode, setCopiesMode] = useState<CopiesMode>("one");
  const [fixedCopies, setFixedCopies] = useState(2);
  const [overrides, setOverrides] = useState<Map<string, number>>(() => new Map());
  const [size, setSize] = useState<BarcodeLabelSize>(BARCODE_LABEL_DEFAULT);
  const [savedSize, setSavedSize] = useState<BarcodeLabelSize | null>(null);
  const [layout, setLayout] = useState<LabelLayout>("roll");
  const [options, setOptions] = useState<BarcodeLabelOptions>(DEFAULT_LABEL_OPTIONS);
  const [visible, setVisible] = useState(PAGE);
  const [preview, setPreview] = useState<string | null>(null);
  const [dense, setDense] = useState(false);
  const [printJobs, setPrintJobs] = useState<LabelJob[] | null>(null);
  const [opening, setOpening] = useState(false);

  // יציבה — כדי שתצוגת ההדפסה לא תצייר את המדבקות מחדש בכל רינדור
  const closePrintView = useCallback(() => setPrintJobs(null), []);
  useLiftA11yButton();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [catalog, stored] = await Promise.all([loadLabelCatalog(), loadBarcodeLabelSize()]);
      setProducts(catalog);
      setSize(stored);
      setSavedSize(stored);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "טעינת המוצרים נכשלה");
    }
  }, []);

  useEffect(() => {
    void load();
    const prefs = readPrefs();
    if (prefs.layout === "roll" || prefs.layout === "a4") setLayout(prefs.layout);
    if (
      prefs.copiesMode === "one" ||
      prefs.copiesMode === "stock" ||
      prefs.copiesMode === "fixed"
    ) {
      setCopiesMode(prefs.copiesMode);
    }
    if (prefs.options && typeof prefs.options === "object") {
      setOptions({ ...DEFAULT_LABEL_OPTIONS, ...prefs.options });
    }
  }, [load]);

  useEffect(() => writePrefs({ layout, options, copiesMode }), [layout, options, copiesMode]);

  const nameById = useMemo(
    () =>
      new Map(tree.flat.filter((node) => node.id).map((node) => [node.id as string, node.name])),
    [tree],
  );
  const withCategories = useMemo(
    () =>
      (products ?? []).map((product) => ({
        ...product,
        categories: product.extraCategoryIds
          .map((id) => nameById.get(id))
          .filter((name): name is string => Boolean(name)),
      })),
    [products, nameById],
  );

  /** המוצרים בהיקף שנבחר */
  const scoped = useMemo(() => {
    if (scope === "stock") {
      return withCategories.filter((product) => !product.is_digital && product.stock_quantity > 0);
    }
    if (scope === "category") {
      if (!category) return [];
      const names = subtreeNames(tree, category);
      return withCategories.filter((product) => inCategories(product, names));
    }
    return withCategories;
  }, [scope, category, withCategories, tree]);

  const isSelected = useCallback(
    (id: string) => (scope === "manual" ? included.has(id) : !excluded.has(id)),
    [scope, included, excluded],
  );

  const selected = useMemo(
    () => scoped.filter((product) => isSelected(product.id)),
    [scoped, isSelected],
  );

  const query = term.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      query === ""
        ? scoped
        : scoped.filter(
            (product) =>
              product.name.toLowerCase().includes(query) ||
              product.sku.includes(query) ||
              (product.barcode ?? "").includes(query),
          ),
    [scoped, query],
  );

  useEffect(() => setVisible(PAGE), [scope, category, query]);

  const copiesOf = useCallback(
    (product: LabelCatalogProduct) =>
      overrides.get(product.id) ?? copiesFor(product, copiesMode, fixedCopies),
    [overrides, copiesMode, fixedCopies],
  );

  const store: LabelStore = useMemo(
    () => ({
      name: settings?.business_name?.trim() || settings?.site_title?.trim() || DEFAULT_STORE_NAME,
      pricesIncludeVat: settings?.prices_include_vat ?? true,
      vatRate: settings?.business_type === "exempt" ? 0 : Number(settings?.vat_rate ?? 18),
    }),
    [settings],
  );

  const jobs: LabelJob[] = useMemo(
    () =>
      selected
        .map((product) => ({
          key: product.id,
          data: labelDataFor(product, options, store),
          copies: copiesOf(product),
        }))
        .filter((job) => job.copies > 0),
    [selected, options, store, copiesOf],
  );
  const labelCount = totalLabels(jobs);
  const sizeProblem = barcodeLabelSizeProblem(size);
  const tooMany = labelCount > MAX_LABELS_PER_RUN;

  // תצוגה מקדימה חיה — המוצר הראשון שנבחר (או מוצר לדוגמה)
  const sample =
    jobs[0]?.data ??
    labelDataFor(
      {
        id: "sample",
        sku: "12345678",
        name: "מוצר לדוגמה — שם המוצר",
        barcode: "7290000000017",
        price_tier1: 49.9,
        stock_quantity: 1,
        is_digital: false,
      },
      options,
      store,
    );
  const sampleKey = JSON.stringify([sample, size, options]);
  useEffect(() => {
    if (sizeProblem) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void renderBarcodeLabelCanvas(sample, size, options, 8)
        .then((canvas) => !cancelled && setPreview(canvas.toDataURL("image/png")))
        .catch(() => !cancelled && setPreview(null));
      void barcodeFits(sample.code, size).then((fits) => !cancelled && setDense(!fits));
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sampleKey מכסה את sample/size/options
  }, [sampleKey, sizeProblem]);

  const toggle = (id: string, on: boolean) => {
    if (scope === "manual") {
      setIncluded((current) => {
        const next = new Set(current);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      });
    } else {
      setExcluded((current) => {
        const next = new Set(current);
        if (on) next.delete(id);
        else next.add(id);
        return next;
      });
    }
  };

  const setAllFiltered = (on: boolean) => {
    const ids = filtered.map((product) => product.id);
    if (scope === "manual") {
      setIncluded((current) => {
        const next = new Set(current);
        for (const id of ids) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    } else {
      setExcluded((current) => {
        const next = new Set(current);
        for (const id of ids) {
          if (on) next.delete(id);
          else next.add(id);
        }
        return next;
      });
    }
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => isSelected(p.id));

  const changeScope = (next: Scope) => {
    setScope(next);
    setExcluded(new Set());
    setTerm("");
  };

  const generate = async () => {
    if (sizeProblem) {
      toast.error(sizeProblem);
      return;
    }
    if (labelCount === 0) {
      toast.error(scope === "category" && !category ? "בחרו קטגוריה" : "לא נבחרו מוצרים להדפסה");
      return;
    }
    if (tooMany) {
      toast.error(
        `עד ${MAX_LABELS_PER_RUN.toLocaleString("he-IL")} מדבקות בהפקה אחת — צמצמו את הבחירה`,
      );
      return;
    }
    setOpening(true);
    // הגודל נשמר לחנות (בפעם הבאה — גם ממחשב אחר — הוא כבר מוכן)
    if (!savedSize || savedSize.width !== size.width || savedSize.height !== size.height) {
      try {
        await saveBarcodeLabelSize(size);
        setSavedSize(size);
      } catch {
        // לא קריטי — ההדפסה ממשיכה
      }
    }
    setOpening(false);
    setPrintJobs(jobs);
  };

  if (loadError && products === null) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="space-y-3 py-8 text-center text-sm">
          <p className="text-destructive">{loadError}</p>
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="size-4" />
            ניסיון נוסף
          </Button>
        </CardContent>
      </Card>
    );
  }

  const grid = a4Grid(size);
  const previewScale = Math.min(280 / size.width, 200 / size.height);

  return (
    <section
      className="space-y-5 pb-24 lg:pb-0"
      aria-labelledby="labels-title"
      data-testid="labels-panel"
    >
      <div className="space-y-1">
        <h2 id="labels-title" className="flex items-center gap-2 text-2xl font-bold">
          <Barcode className="size-6 text-primary" aria-hidden="true" />
          מדבקות ברקוד
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          מדבקה לכל מוצר עם ברקוד סריק, שם, מק״ט ומחיר — למדפסת מדבקות תרמית (Zebra וכדומה) או לדף
          A4. הברקוד נסרק בקופה המהירה, בליקוט ובספירת המלאי.
        </p>
      </div>

      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">מה להדפיס?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="היקף ההדפסה">
            <ScopeButton
              active={scope === "stock"}
              onClick={() => changeScope("stock")}
              icon={<Warehouse className="size-4" aria-hidden="true" />}
              title="כל המלאי"
              subtitle="כל המוצרים שיש מהם במלאי"
              testId="labels-scope-stock"
            />
            <ScopeButton
              active={scope === "category"}
              onClick={() => changeScope("category")}
              icon={<FolderTree className="size-4" aria-hidden="true" />}
              title="לפי קטגוריה"
              subtitle="קטגוריה וכל תתי-הקטגוריות שלה"
              testId="labels-scope-category"
            />
            <ScopeButton
              active={scope === "manual"}
              onClick={() => changeScope("manual")}
              icon={<Hand className="size-4" aria-hidden="true" />}
              title="בחירה ידנית"
              subtitle="מסמנים מוצרים מהרשימה"
              testId="labels-scope-manual"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            {scope === "category" && (
              <Select value={category ?? ""} onValueChange={(value) => setCategory(value || null)}>
                <SelectTrigger
                  dir="rtl"
                  className="sm:w-64"
                  aria-label="קטגוריה"
                  data-testid="labels-category"
                >
                  <SelectValue placeholder="בחרו קטגוריה" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {tree.flat.map((node) => (
                    <SelectItem key={node.name} value={node.name}>
                      {"  ".repeat(node.depth - 1)}
                      {node.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="חיפוש ברשימה — שם, מק״ט או ברקוד"
                aria-label="חיפוש מוצר ברשימה"
                className="pr-9"
                data-testid="labels-search"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <Card className="min-w-0 shadow-card">
          <CardContent className="space-y-3 pt-5">
            {products === null ? (
              <div className="h-40 animate-pulse rounded-lg bg-muted" aria-label="טוען מוצרים" />
            ) : scope === "category" && !category ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                בחרו קטגוריה — כל המוצרים שבה (וגם בתתי-הקטגוריות) יסומנו
              </p>
            ) : filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {scope === "stock" && query === ""
                  ? 'אין מוצרים במלאי כרגע — בחרו "בחירה ידנית" כדי להדפיס בכל זאת'
                  : "לא נמצאו מוצרים"}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={allFilteredSelected}
                      onCheckedChange={(value) => setAllFiltered(value === true)}
                      data-testid="labels-select-all"
                    />
                    סימון הכל ({filtered.length.toLocaleString("he-IL")})
                  </label>
                  <span className="text-xs text-muted-foreground">
                    נבחרו {selected.length.toLocaleString("he-IL")} מתוך{" "}
                    {scoped.length.toLocaleString("he-IL")}
                  </span>
                </div>
                <ul className="divide-y divide-border" data-testid="labels-list">
                  {filtered.slice(0, visible).map((product) => {
                    const on = isSelected(product.id);
                    const { source } = labelCodeFor(product);
                    return (
                      <li
                        key={product.id}
                        className="flex items-center gap-3 py-2"
                        data-testid="labels-row"
                      >
                        <Checkbox
                          checked={on}
                          onCheckedChange={(value) => toggle(product.id, value === true)}
                          aria-label={`הדפסת מדבקה ל${product.name}`}
                        />
                        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary">
                          {product.image_url ? (
                            <img
                              src={product.image_url}
                              alt=""
                              className="size-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <Package className="size-4 text-muted-foreground" aria-hidden="true" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 text-sm font-medium">
                            <span className="truncate">{product.name}</span>
                            {product.is_hidden && (
                              <EyeOff
                                className="size-3.5 shrink-0 text-muted-foreground"
                                aria-label="מוסתר באתר"
                              />
                            )}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            <span dir="ltr">{product.sku}</span>
                            {" · "}
                            {source === "barcode" ? (
                              <span dir="ltr">{product.barcode}</span>
                            ) : (
                              <span className="text-amber-700 dark:text-amber-300">
                                בלי ברקוד — לפי מק״ט
                              </span>
                            )}
                            {" · "}
                            {formatIls(product.price_tier1)}
                            {product.is_digital
                              ? " · דיגיטלי"
                              : ` · במלאי ${product.stock_quantity}`}
                          </p>
                        </div>
                        {on && (
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={MAX_COPIES}
                            value={copiesOf(product)}
                            onChange={(event) =>
                              setOverrides((current) => {
                                const next = new Map(current);
                                next.set(product.id, clampCopies(Number(event.target.value)));
                                return next;
                              })
                            }
                            aria-label={`מספר מדבקות ל${product.name}`}
                            title="מספר מדבקות"
                            className="numeric h-8 w-16 shrink-0 px-1 text-center"
                            data-testid="labels-copies"
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
                {filtered.length > visible && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setVisible((count) => count + PAGE)}
                  >
                    הצגת עוד {Math.min(PAGE, filtered.length - visible)} מוצרים
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <aside className="space-y-4 lg:sticky lg:top-[calc(var(--site-header-h,0px)+1rem)]">
          <Card className="shadow-card" data-testid="labels-settings">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">הגדרות המדבקה</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-semibold">כמה מדבקות לכל מוצר</legend>
                <div
                  className="grid grid-cols-3 gap-1.5"
                  role="radiogroup"
                  aria-label="מספר מדבקות"
                >
                  {(
                    [
                      ["one", "אחת"],
                      ["stock", "לפי המלאי"],
                      ["fixed", "מספר קבוע"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={copiesMode === value}
                      onClick={() => {
                        setCopiesMode(value);
                        setOverrides(new Map());
                      }}
                      data-testid={`labels-copies-${value}`}
                      className={cn(
                        "rounded-lg border px-2 py-1.5 text-xs transition-colors",
                        copiesMode === value
                          ? "border-primary bg-primary/10 font-semibold text-primary"
                          : "border-border hover:bg-secondary",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {copiesMode === "fixed" && (
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_COPIES}
                    value={fixedCopies}
                    onChange={(event) => {
                      setFixedCopies(Math.max(1, clampCopies(Number(event.target.value))));
                      setOverrides(new Map());
                    }}
                    aria-label="מספר מדבקות לכל מוצר"
                    className="numeric h-9"
                  />
                )}
                {copiesMode === "stock" && (
                  <p className="text-xs text-muted-foreground">
                    מדבקה לכל יחידה במלאי (עד {MAX_COPIES} למוצר). מוצר בלי מלאי לא מודפס.
                  </p>
                )}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-semibold">גודל המדבקה (מ״מ)</legend>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="label-w" className="text-xs">
                      רוחב
                    </Label>
                    <Input
                      id="label-w"
                      type="number"
                      dir="ltr"
                      min={BARCODE_LABEL_LIMITS.width.min}
                      max={BARCODE_LABEL_LIMITS.width.max}
                      value={Number.isFinite(size.width) ? size.width : ""}
                      onChange={(event) => setSize({ ...size, width: Number(event.target.value) })}
                      className="numeric h-9"
                      data-testid="labels-width"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="label-h" className="text-xs">
                      גובה
                    </Label>
                    <Input
                      id="label-h"
                      type="number"
                      dir="ltr"
                      min={BARCODE_LABEL_LIMITS.height.min}
                      max={BARCODE_LABEL_LIMITS.height.max}
                      value={Number.isFinite(size.height) ? size.height : ""}
                      onChange={(event) => setSize({ ...size, height: Number(event.target.value) })}
                      className="numeric h-9"
                      data-testid="labels-height"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {BARCODE_LABEL_PRESETS.map((preset) => {
                    const active = preset.width === size.width && preset.height === size.height;
                    return (
                      <button
                        key={`${preset.width}x${preset.height}`}
                        type="button"
                        dir="ltr"
                        onClick={() => setSize(preset)}
                        className={cn(
                          "numeric rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                          active
                            ? "border-primary bg-primary/10 font-semibold text-primary"
                            : "border-border hover:bg-secondary",
                        )}
                      >
                        {preset.width}×{preset.height}
                      </button>
                    );
                  })}
                </div>
                {sizeProblem && (
                  <p className="text-xs font-medium text-destructive">{sizeProblem}</p>
                )}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-semibold">מדפסת</legend>
                <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="סוג הדפסה">
                  {(
                    [
                      ["roll", "גליל (תרמית)"],
                      ["a4", "דף A4"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={layout === value}
                      onClick={() => setLayout(value)}
                      data-testid={`labels-layout-${value}`}
                      className={cn(
                        "rounded-lg border px-2 py-1.5 text-xs transition-colors",
                        layout === value
                          ? "border-primary bg-primary/10 font-semibold text-primary"
                          : "border-border hover:bg-secondary",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {layout === "a4" && !sizeProblem && (
                  <p className="text-xs text-muted-foreground">
                    {grid.perPage} מדבקות בדף ({grid.columns} בשורה × {grid.rows} שורות)
                  </p>
                )}
              </fieldset>

              <fieldset className="space-y-2.5">
                <legend className="mb-1 text-sm font-semibold">מה מופיע במדבקה</legend>
                <OptionSwitch
                  label="מחיר"
                  checked={options.showPrice}
                  onChange={(value) => setOptions({ ...options, showPrice: value })}
                />
                <OptionSwitch
                  label="מק״ט"
                  checked={options.showSku}
                  onChange={(value) => setOptions({ ...options, showSku: value })}
                />
                <OptionSwitch
                  label="שם החנות"
                  checked={options.showStoreName}
                  onChange={(value) => setOptions({ ...options, showStoreName: value })}
                />
              </fieldset>

              <div className="flex flex-col items-center gap-1.5">
                <span className="text-xs text-muted-foreground">תצוגה מקדימה</span>
                <div
                  className="flex items-center justify-center overflow-hidden rounded-md bg-white shadow-soft ring-1 ring-border"
                  style={
                    sizeProblem
                      ? { width: 200, height: 110 }
                      : {
                          width: Math.round(size.width * previewScale),
                          height: Math.round(size.height * previewScale),
                        }
                  }
                  data-testid="labels-preview"
                >
                  {preview && !sizeProblem ? (
                    <img src={preview} alt="תצוגה מקדימה של המדבקה" className="size-full" />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
                {dense && !sizeProblem && (
                  <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="size-3.5" aria-hidden="true" />
                    הברקוד צפוף לרוחב הזה — מומלצת מדבקה רחבה יותר
                  </p>
                )}
              </div>

              <Button
                size="lg"
                className="w-full"
                onClick={() => void generate()}
                disabled={opening || products === null}
                data-testid="labels-generate"
              >
                {opening ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Printer className="size-4" aria-hidden="true" />
                )}
                הפק מדבקות ({labelCount.toLocaleString("he-IL")})
              </Button>
              {tooMany && (
                <p className="text-xs font-medium text-destructive">
                  עד {MAX_LABELS_PER_RUN.toLocaleString("he-IL")} מדבקות בהפקה אחת — צמצמו את הבחירה
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-border bg-card/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur lg:hidden">
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">{labelCount.toLocaleString("he-IL")} מדבקות</span>
          <span className="text-muted-foreground">
            {" "}
            · {jobs.length.toLocaleString("he-IL")} מוצרים
          </span>
        </p>
        <Button onClick={() => void generate()} disabled={opening || products === null}>
          <Printer className="size-4" aria-hidden="true" />
          הפק מדבקות
        </Button>
      </div>

      {printJobs && (
        <LabelPrintView
          jobs={printJobs}
          size={size}
          layout={layout}
          options={options}
          onClose={closePrintView}
        />
      )}
    </section>
  );
}

function ScopeButton({
  active,
  onClick,
  icon,
  title,
  subtitle,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-start transition-colors",
        active ? "border-primary bg-primary/10" : "border-border hover:bg-secondary",
      )}
    >
      <span className={cn("mt-0.5", active ? "text-primary" : "text-muted-foreground")}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-sm", active && "font-semibold text-primary")}>{title}</span>
        <span className="block text-xs text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  );
}

function OptionSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

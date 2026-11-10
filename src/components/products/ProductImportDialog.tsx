import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  ImageIcon,
  Loader2,
  Play,
  Search,
  Square,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CSV_MAX_BYTES,
  CSV_MAX_ROWS,
  IMPORT_FIELDS,
  SAMPLE_CSV,
  decodeCsvBytes,
  fieldLabel,
  parseCsv,
  planImportBatches,
  prepareImport,
  type CsvTable,
  type ImportBatchPlan,
  type PreparedImport,
} from "@/lib/csv-import";
import {
  MATCH_CHUNK,
  emptySyncSummary,
  matchInput,
  mergeSyncSummary,
  planDecisions,
  presentProductIds,
  summarizePlan,
  type ImportInfo,
  type ImportReport,
  type MatchRow,
  type RowChoice,
  type SyncBatchSummary,
} from "@/lib/product-import-sync";
import {
  applyProductImportBatch,
  beginProductImport,
  finishProductImport,
  matchProductsBatch,
  productImportMissingCount,
  productImportReport,
  recentProductImports,
  undoProductImport,
  type UndoResult,
} from "@/lib/product-import.functions";
import { refreshCategories } from "@/hooks/useCategories";
import {
  ImportReview,
  type MissingInfo,
  type ReviewOptions,
} from "@/components/products/ProductImportReview";
import {
  ImportReportView,
  RecentImports,
  UndoNotice,
} from "@/components/products/ProductImportReport";
import { downloadCsv } from "@/lib/download-csv";
import { cn } from "@/lib/utils";

type Loaded = {
  fileName: string;
  table: CsvTable;
  prepared: PreparedImport;
  plan: ImportBatchPlan[];
  columns: number;
  /** כמה קישורי תמונות בכל הקובץ */
  imageCount: number;
  /** כמה קטגוריות שונות בקובץ */
  categoryCount: number;
};

type RunStatus = "running" | "stopping" | "stopped" | "failed" | "done";

type Run = {
  importId: string;
  status: RunStatus;
  /** המנה הבאה לשליחה (להמשך אחרי עצירה / תקלה) */
  nextBatch: number;
  /** כמה מוצרים כבר טופלו (נשלחו לשרת וחזרו) */
  doneProducts: number;
  summary: SyncBatchSummary;
  error: string | null;
  /** זמן ממוצע למנה (מ"ש) — להערכת הזמן שנשאר */
  avgBatchMs: number;
  batchesDone: number;
};

const he = (value: number) => value.toLocaleString("he-IL");

function remainingText(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return "פחות מדקה";
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "כדקה" : `כ-${he(minutes)} דקות`;
}

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * ייבוא מוצרים מקובץ CSV (חלק 14 → 18 → STORE-2): בחירת קובץ (או גרירה), תצוגה מקדימה עם זיהוי
 * העמודות — ואז בדיקה מול המוצרים בחנות: מוצר קיים מזוהה (ברקוד → מק"ט → מק"ט ספק → שם) ולא נוסף
 * שוב. המנהל בוחר מה לעשות במוצרים קיימים (מלאי / מלאי ומחיר / כלום), בחדשים ובמוצרים שלא בקובץ,
 * הייבוא רץ במנות (תמונות רק למוצרים חדשים), ובסוף — דוח שינויים להורדה, וביטול היבוא.
 * קבצים מאקסל בעברית (Windows-1255), מ-WooCommerce ומ-Shopify נתמכים.
 */
export function ProductImportDialog({
  onImported,
  productCount,
  maxProducts,
}: {
  onImported: () => void | Promise<void>;
  productCount: number;
  maxProducts: number | null;
}) {
  const matchBatch = useServerFn(matchProductsBatch);
  const missingCount = useServerFn(productImportMissingCount);
  const beginImport = useServerFn(beginProductImport);
  const applyBatch = useServerFn(applyProductImportBatch);
  const finishImport = useServerFn(finishProductImport);
  const loadReport = useServerFn(productImportReport);
  const loadRecent = useServerFn(recentProductImports);
  const undoImport = useServerFn(undoProductImport);

  const inputRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);
  const reviewRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // בדיקה מול החנות
  const [matches, setMatches] = useState<Map<number, MatchRow> | null>(null);
  const [tiers, setTiers] = useState(false);
  const [matching, setMatching] = useState<{ done: number; total: number } | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [options, setOptions] = useState<ReviewOptions>({
    existing: null,
    createNew: true,
    missing: "keep",
  });
  const [choices, setChoices] = useState<Record<number, RowChoice>>({});
  const [requiredError, setRequiredError] = useState(false);
  const [missing, setMissing] = useState<{ zero: MissingInfo | null; hide: MissingInfo | null }>({
    zero: null,
    hide: null,
  });
  const [missingLoading, setMissingLoading] = useState(false);
  const [missingError, setMissingError] = useState<string | null>(null);

  // הייבוא, הדוח והיבואים האחרונים
  const [run, setRun] = useState<Run | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [recent, setRecent] = useState<ImportInfo[] | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [undoResult, setUndoResult] = useState<UndoResult | null>(null);

  const busy = run?.status === "running" || run?.status === "stopping";

  // סגירת הלשונית באמצע ייבוא — אזהרה של הדפדפן
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const refreshRecent = useCallback(async () => {
    setRecentLoading(true);
    try {
      setRecent(await loadRecent());
    } catch {
      setRecent(null);
    } finally {
      setRecentLoading(false);
    }
  }, [loadRecent]);

  useEffect(() => {
    if (open && !loaded && !report) void refreshRecent();
  }, [open, loaded, report, refreshRecent]);

  const resetMatch = () => {
    setMatches(null);
    setMatching(null);
    setMatchError(null);
    setOptions({ existing: null, createNew: true, missing: "keep" });
    setChoices({});
    setRequiredError(false);
    setMissing({ zero: null, hide: null });
    setMissingError(null);
  };

  const reset = () => {
    setLoaded(null);
    setProblem(null);
    setRun(null);
    setReport(null);
    setUndoResult(null);
    resetMatch();
    stopRef.current = false;
    if (inputRef.current) inputRef.current.value = "";
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setRun(null);
    setReport(null);
    resetMatch();
    if (!/\.(csv|txt)$/i.test(file.name) && !/csv|text/i.test(file.type)) {
      setProblem("נא לבחור קובץ CSV (באקסל: קובץ ← שמירה בשם ← CSV UTF-8)");
      return;
    }
    if (file.size > CSV_MAX_BYTES) {
      setProblem("הקובץ גדול מדי (עד 5MB) — פצלו אותו לכמה קבצים");
      return;
    }
    const text = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
    const table = parseCsv(text);
    if (table.headers.length === 0) {
      setProblem("הקובץ ריק או שאין בו שורת כותרות");
      return;
    }
    const prepared = prepareImport(table);
    const categories = new Set(
      prepared.rows.flatMap((row) => row.categories.map((path) => path[path.length - 1] ?? "")),
    );
    setLoaded({
      fileName: file.name,
      table,
      prepared,
      plan: prepared.missing.length === 0 ? planImportBatches(table, prepared.mapping) : [],
      columns: table.headers.length,
      imageCount: prepared.rows.reduce((sum, row) => sum + row.images.length, 0),
      categoryCount: [...categories].filter(Boolean).length,
    });
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    void readFile(event.dataTransfer.files?.[0]);
  };

  /** בדיקה מול המוצרים בחנות — במנות של עד 400 שורות (קריאה בלבד) */
  const runMatch = async () => {
    if (!loaded) return;
    const rows = loaded.prepared.rows;
    setMatchError(null);
    setMatching({ done: 0, total: rows.length });
    const found = new Map<number, MatchRow>();
    try {
      for (let start = 0; start < rows.length; start += MATCH_CHUNK) {
        const chunk = rows.slice(start, start + MATCH_CHUNK);
        const result = await matchBatch({ data: { rows: chunk.map(matchInput) } });
        setTiers(result.tiers);
        for (const row of result.rows) found.set(row.row, row);
        setMatching({ done: Math.min(rows.length, start + chunk.length), total: rows.length });
      }
      setMatches(found);
      setMatching(null);
      window.setTimeout(() => reviewRef.current?.querySelector<HTMLElement>("h3")?.focus(), 50);
    } catch (error) {
      setMatching(null);
      setMatchError(errorText(error, "הבדיקה מול החנות נכשלה — נסו שוב"));
    }
  };

  const plan = useMemo(
    () =>
      loaded && matches
        ? planDecisions(loaded.prepared.rows, matches, { createNew: options.createNew }, choices)
        : null,
    [loaded, matches, options.createNew, choices],
  );
  const summary = useMemo(
    () =>
      plan
        ? summarizePlan(plan, {
            existing: options.existing ?? "none",
            createNew: options.createNew,
            missing: options.missing,
          })
        : null,
    [plan, options],
  );
  const presentKey = useMemo(() => (plan ? presentProductIds(plan).sort().join(",") : ""), [plan]);

  // כמה מוצרים בחנות לא בקובץ (לאיפוס / להסתרה) — מתעדכן כשהבחירות לשורות משתנות
  useEffect(() => {
    if (!plan) return;
    let cancelled = false;
    const present = presentKey ? presentKey.split(",") : [];
    setMissingLoading(true);
    setMissingError(null);
    Promise.all([
      missingCount({ data: { present, missing: "zero" } }),
      missingCount({ data: { present, missing: "hide" } }),
    ])
      .then(([zero, hide]) => {
        if (!cancelled) setMissing({ zero, hide });
      })
      .catch((error: unknown) => {
        if (!cancelled) setMissingError(errorText(error, "לא הצלחנו לספור את המוצרים שלא בקובץ"));
      })
      .finally(() => {
        if (!cancelled) setMissingLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- presentKey מייצג את plan
  }, [presentKey, matches]);

  const missingConfirm =
    options.missing === "zero" ? missing.zero : options.missing === "hide" ? missing.hide : null;
  const canRun =
    plan !== null &&
    !busy &&
    (options.missing === "keep" ||
      (missingConfirm !== null && !missingLoading && missingError === null));

  const showReport = async (importId: string) => {
    setReportLoading(true);
    try {
      setReport(await loadReport({ data: { importId } }));
    } catch (error) {
      toast.error(errorText(error, "הדוח לא נטען"));
    } finally {
      setReportLoading(false);
    }
  };

  /** שליחת המנות לשרת, אחת אחרי השנייה — מההתחלה או מהמקום שבו נעצרנו; בסוף — סיום ודוח */
  const runImport = async (from: Run | null) => {
    if (!loaded || !plan) return;
    if (!options.existing) {
      setRequiredError(true);
      return;
    }
    const { plan: batches, table, fileName } = loaded;
    stopRef.current = false;
    let state: Run;
    if (from) {
      state = { ...from, status: "running", error: null };
    } else {
      try {
        const begun = await beginImport({
          data: {
            fileName,
            options: {
              existing: options.existing,
              createNew: options.createNew,
              missing: options.missing,
            },
            expectedRows: plan.length,
          },
        });
        state = {
          importId: begun.importId,
          status: "running",
          nextBatch: 0,
          doneProducts: 0,
          summary: emptySyncSummary(),
          error: null,
          avgBatchMs: 0,
          batchesDone: 0,
        };
      } catch (error) {
        toast.error(errorText(error, "הייבוא לא התחיל"));
        return;
      }
    }
    setRun(state);
    const decisions = new Map(plan.map((p) => [p.item.row, p.decision]));

    while (state.nextBatch < batches.length) {
      if (stopRef.current) {
        state = { ...state, status: "stopped" };
        break;
      }
      const batch = batches[state.nextBatch]!;
      const firstRow = batch.start + 2;
      const lastRow = batch.end + 1;
      const started = Date.now();
      try {
        const result = await applyBatch({
          data: {
            importId: state.importId,
            headers: table.headers,
            rows: table.rows.slice(batch.start, batch.end),
            firstRow,
            fileName,
            decisions: [...decisions.values()].filter((d) => d.row >= firstRow && d.row <= lastRow),
          },
        });
        const took = Date.now() - started;
        const batchesDone = state.batchesDone + 1;
        state = {
          ...state,
          nextBatch: state.nextBatch + 1,
          doneProducts: state.doneProducts + batch.products,
          summary: mergeSyncSummary(state.summary, result),
          avgBatchMs: (state.avgBatchMs * state.batchesDone + took) / batchesDone,
          batchesDone,
        };
        setRun(state);
      } catch (error) {
        state = { ...state, status: "failed", error: errorText(error, "הייבוא נכשל") };
        break;
      }
    }

    if (state.status === "running" || state.status === "stopping") {
      if (stopRef.current && state.nextBatch < batches.length) {
        state = { ...state, status: "stopped" };
      } else {
        try {
          await finishImport({
            data: {
              importId: state.importId,
              confirmMissing: options.missing === "keep" ? null : (missingConfirm?.count ?? null),
            },
          });
          state = { ...state, status: "done" };
        } catch (error) {
          state = { ...state, status: "failed", error: errorText(error, "סיום הייבוא נכשל") };
        }
      }
    }
    setRun(state);

    const { summary: total } = state;
    if (total.newCategories.length > 0) await refreshCategories().catch(() => undefined);
    if (total.created > 0 || total.updated > 0)
      await Promise.resolve(onImported()).catch(() => undefined);
    if (state.status === "done") {
      toast.success(
        `הייבוא הסתיים: ${he(total.created)} נוספו, ${he(total.updated)} עודכנו${total.failed > 0 ? `, ${he(total.failed)} לא בוצעו` : ""}`,
      );
      await showReport(state.importId);
    } else if (state.status === "failed") {
      toast.error(state.error ?? "הייבוא נעצר");
    } else {
      toast.info("הייבוא נעצר — אפשר להמשיך מאותה נקודה");
    }
  };

  /** סיום יבוא שנעצר — בלי לשנות מוצרים שלא בקובץ */
  const finishStopped = async () => {
    if (!run) return;
    try {
      await finishImport({ data: { importId: run.importId, confirmMissing: null } });
      setRun({ ...run, status: "done" });
      await showReport(run.importId);
    } catch (error) {
      toast.error(errorText(error, "סיום הייבוא נכשל"));
    }
  };

  const stop = () => {
    stopRef.current = true;
    setRun((current) => (current ? { ...current, status: "stopping" } : current));
  };

  const undo = async () => {
    if (!report) return;
    setUndoing(true);
    try {
      const result = await undoImport({ data: { importId: report.import.id } });
      setUndoResult(result);
      toast.success("היבוא בוטל");
      await Promise.resolve(onImported()).catch(() => undefined);
      await refreshCategories().catch(() => undefined);
      setReport(await loadReport({ data: { importId: report.import.id } }));
    } catch (error) {
      toast.error(errorText(error, "הביטול נכשל"));
    } finally {
      setUndoing(false);
    }
  };

  const prepared = loaded?.prepared ?? null;
  const rowCount = prepared?.rows.length ?? 0;
  const room = maxProducts !== null ? Math.max(0, maxProducts - productCount) : null;
  const overLimit = room !== null && summary !== null && summary.create > room;
  const tooMany = rowCount > CSV_MAX_ROWS;
  const canImport =
    prepared !== null && prepared.missing.length === 0 && rowCount > 0 && !tooMany && !busy;
  const found = prepared
    ? IMPORT_FIELDS.filter((f) => f.key !== "short_description" && f.key !== "published").map(
        (f) => ({
          key: f.key,
          label: f.label,
          on: prepared.mapping[f.key] !== undefined,
          required: f.required,
        }),
      )
    : [];

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FileUp className="size-4" />
        ייבא מ-CSV
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent
          dir="rtl"
          className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto text-right sm:max-w-3xl"
        >
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="size-5 text-emerald-600" aria-hidden="true" />
              ייבוא מוצרים מקובץ CSV
            </DialogTitle>
            <DialogDescription>
              מאקסל, מ-WooCommerce או מ-Shopify. לפני הייבוא הקובץ נבדק מול המוצרים בחנות: מוצר שכבר
              קיים (לפי ברקוד, מק"ט או שם) לא נוסף שוב — ואתם בוחרים אם לעדכן לו מלאי ומחיר. בסוף
              מקבלים דוח שינויים, ואפשר לבטל את היבוא.
            </DialogDescription>
          </DialogHeader>

          {report ? (
            <div className="space-y-4">
              {undoResult && <UndoNotice result={undoResult} />}
              <ImportReportView report={report} onUndo={() => void undo()} undoing={undoing} />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" variant="outline" className="flex-1" onClick={reset}>
                  ייבוא קובץ נוסף
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1"
                  onClick={() => {
                    setOpen(false);
                    reset();
                  }}
                >
                  סגירה
                </Button>
              </div>
            </div>
          ) : run && busy && loaded ? (
            <SyncProgress run={run} loaded={loaded} onStop={stop} />
          ) : run && run.status !== "done" && loaded ? (
            <SyncStopped
              run={run}
              loaded={loaded}
              onResume={() => void runImport(run)}
              onFinish={() => void finishStopped()}
            />
          ) : reportLoading ? (
            <p
              className="flex items-center gap-2 py-6 text-sm text-muted-foreground"
              aria-live="polite"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              טוענים את דוח השינויים…
            </p>
          ) : run?.status === "done" ? (
            // הייבוא הסתיים אבל הדוח לא נטען — לא חוזרים למסך הבדיקה (שם "ייבוא" היה מתחיל יבוא חדש)
            <div className="space-y-3 py-2" role="status">
              <p className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
                הייבוא הסתיים: {he(run.summary.created)} נוספו, {he(run.summary.updated)} עודכנו
                {run.summary.failed > 0 ? `, ${he(run.summary.failed)} לא בוצעו` : ""}.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  className="flex-1"
                  onClick={() => void showReport(run.importId)}
                >
                  הצגת דוח השינויים
                </Button>
                <Button type="button" variant="outline" className="flex-1" onClick={reset}>
                  ייבוא קובץ נוסף
                </Button>
              </div>
            </div>
          ) : plan && summary ? (
            <div ref={reviewRef}>
              <ImportReview
                plan={plan}
                summary={summary}
                options={options}
                onOptions={(next) => {
                  setOptions(next);
                  if (next.existing) setRequiredError(false);
                }}
                choices={choices}
                onChoice={(row, choice) => setChoices((current) => ({ ...current, [row]: choice }))}
                onSkipAllAmbiguous={() =>
                  setChoices((current) => {
                    const next = { ...current };
                    for (const p of plan)
                      if (p.match?.status === "ambiguous") next[p.item.row] = "skip";
                    return next;
                  })
                }
                missing={missing}
                missingLoading={missingLoading}
                missingError={missingError}
                tiers={tiers}
                requiredError={requiredError}
                canRun={canRun}
                onRun={() => void runImport(null)}
                onBack={resetMatch}
              />
              {overLimit && room !== null && (
                <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  בחבילה הבסיסית נשאר מקום ל-{he(room)} מוצרים חדשים — השאר לא יתווספו (העדכונים
                  כן). מוצרים ללא הגבלה זמינים בחבילת פרימיום.
                </p>
              )}
            </div>
          ) : matching ? (
            <div className="space-y-3 py-4" aria-live="polite" data-import-matching>
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                בודקים את הקובץ מול המוצרים בחנות…
              </p>
              <div
                role="progressbar"
                aria-label="התקדמות הבדיקה"
                aria-valuemin={0}
                aria-valuemax={matching.total}
                aria-valuenow={matching.done}
                className="h-2 overflow-hidden rounded-full bg-secondary"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{
                    width: `${Math.max(2, Math.round((matching.done / Math.max(1, matching.total)) * 100))}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {he(matching.done)} מתוך {he(matching.total)} מוצרים. הבדיקה לא משנה שום דבר בחנות.
              </p>
            </div>
          ) : !loaded ? (
            <div className="space-y-4">
              <label
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition",
                  dragging
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-secondary/40",
                )}
              >
                <span className="flex size-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <Upload className="size-7" aria-hidden="true" />
                </span>
                <span className="text-base font-semibold">בחרו קובץ CSV או גררו אותו לכאן</span>
                <span className="text-xs text-muted-foreground">
                  עד 5MB ועד {he(CSV_MAX_ROWS)} מוצרים בקובץ
                </span>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv,.txt"
                  className="sr-only"
                  onChange={(event) => void readFile(event.target.files?.[0])}
                />
              </label>
              {problem && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {problem}
                </p>
              )}
              <RecentImports
                imports={recent}
                loading={recentLoading}
                onOpen={(info) => void showReport(info.id)}
              />
              <div className="space-y-2 rounded-xl bg-secondary/50 p-4 text-sm">
                <p className="font-semibold">העמודות בקובץ (שורה ראשונה = כותרות)</p>
                <p className="leading-6 text-muted-foreground">
                  <strong className="text-foreground">חובה:</strong> שם המוצר, מחיר.{" "}
                  <strong className="text-foreground">לא חובה:</strong> קטגוריה, תיאור, מק"ט, ברקוד,
                  מלאי, תמונה, מחיר מבצע + סיום מבצע, מחיר עלות, מוסתר, הצג בזאפ, כותרת / תיאור SEO.
                </p>
                <ul className="list-disc space-y-1 ps-5 leading-6 text-muted-foreground">
                  <li>
                    <strong className="text-foreground">כמה קטגוריות</strong> — מופרדות בפסיק (למשל{" "}
                    <span dir="rtl">"מחשבים ניידים,ציוד נלווה"</span>); תת-קטגוריה עם "&gt;" (למשל
                    "מחשבים &gt; ניידים"). קטגוריה שלא קיימת — נוצרת.
                  </li>
                  <li>
                    <strong className="text-foreground">כמה תמונות</strong> — מופרדות ב-"||", בפסיק
                    או ב-"|", גם בפורמט{" "}
                    <code dir="ltr" className="rounded bg-background px-1 text-[11px]">
                      image:https://…/1.jpg;alt:…||image:https://…/2.jpg
                    </code>
                    . עד 10 למוצר. התמונות נשמרות אצלנו; קישור שבור מדולג (המוצר נוסף).
                  </li>
                </ul>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => downloadCsv("products-sample.csv", SAMPLE_CSV)}
                >
                  <Download className="size-4" />
                  הורדת קובץ לדוגמה
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold" dir="auto">
                    {loaded.fileName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {he(rowCount)} מוצרים לייבוא · {loaded.columns} עמודות
                    {loaded.imageCount > 0 ? ` · ${he(loaded.imageCount)} תמונות להורדה` : ""}
                    {loaded.categoryCount > 0 ? ` · ${he(loaded.categoryCount)} קטגוריות` : ""}
                    {prepared && prepared.skipped.length > 0
                      ? ` · ${prepared.skipped.length} שורות ידולגו`
                      : ""}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={busy}>
                  קובץ אחר
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold">העמודות שזוהו</p>
                <div className="flex flex-wrap gap-1.5">
                  {found.map((field) => (
                    <span
                      key={field.key}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs",
                        field.on
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                          : field.required
                            ? "border-destructive/50 bg-destructive/10 text-destructive"
                            : "border-border text-muted-foreground",
                      )}
                    >
                      {field.on ? (
                        <CheckCircle2 className="size-3" aria-hidden="true" />
                      ) : field.required ? (
                        <XCircle className="size-3" aria-hidden="true" />
                      ) : null}
                      {field.label}
                    </span>
                  ))}
                </div>
              </div>

              {prepared && prepared.missing.length > 0 && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  חסרות עמודות חובה: {prepared.missing.map(fieldLabel).join(", ")}. ודאו ששורת
                  הכותרות בקובץ כוללת אותן (אפשר להיעזר בקובץ הדוגמה).
                </p>
              )}

              {prepared && prepared.missing.length === 0 && rowCount > 0 && (
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full min-w-[34rem] text-sm" data-import-preview>
                    <thead className="bg-secondary/60 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-right font-medium">שורה</th>
                        <th className="px-3 py-2 text-right font-medium">שם</th>
                        <th className="px-3 py-2 text-right font-medium">מחיר</th>
                        <th className="px-3 py-2 text-right font-medium">קטגוריות</th>
                        <th className="px-3 py-2 text-right font-medium">תמונות</th>
                        <th className="px-3 py-2 text-right font-medium">מלאי</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prepared.rows.slice(0, 5).map((row) => (
                        <tr key={row.row} className="border-t align-top">
                          <td className="px-3 py-2 text-muted-foreground">{row.row}</td>
                          <td className="max-w-[12rem] truncate px-3 py-2 font-medium">
                            {row.name}
                          </td>
                          <td className="px-3 py-2" dir="ltr">
                            {row.price || "—"}
                          </td>
                          <td className="max-w-[14rem] px-3 py-2">
                            {row.categories.length === 0 ? (
                              <span className="text-muted-foreground">כללי</span>
                            ) : (
                              <span className="flex flex-wrap gap-1">
                                {row.categories.map((path) => (
                                  <span
                                    key={path.join(">")}
                                    className="rounded-full bg-secondary px-2 py-0.5 text-[11px]"
                                  >
                                    {path.join(" › ")}
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {row.images.length > 0 ? (
                              <span
                                className="inline-flex items-center gap-1"
                                title={row.images.join("\n")}
                              >
                                <ImageIcon
                                  className="size-3.5 text-muted-foreground"
                                  aria-hidden="true"
                                />
                                {row.images.length}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2">{row.stock || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rowCount > 5 && (
                    <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                      ועוד {he(rowCount - 5)} מוצרים…
                    </p>
                  )}
                </div>
              )}

              {tooMany && (
                <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  עד {he(CSV_MAX_ROWS)} מוצרים בקובץ אחד — פצלו לכמה קבצים.
                </p>
              )}
              {loaded.imageCount > 0 && canImport && (
                <p className="text-xs leading-5 text-muted-foreground">
                  הורדת התמונות לוקחת זמן (בערך שנייה לתמונה). אפשר לעצור באמצע ולהמשיך אחר כך —
                  מוצרים שכבר נוספו לא ייובאו פעמיים. השאירו את הדף פתוח עד הסוף.
                </p>
              )}

              {matchError && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {matchError}
                </p>
              )}
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={!canImport}
                onClick={() => void runMatch()}
                data-import-check
              >
                <Search className="size-4" aria-hidden="true" />
                {`בדיקה מול המוצרים בחנות (${he(rowCount)} מוצרים בקובץ)`}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                הבדיקה רק קוראת — שום דבר לא משתנה עד שבוחרים ומאשרים.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** בזמן הייבוא: סרגל התקדמות, מונים ועצירה */
function SyncProgress({ run, loaded, onStop }: { run: Run; loaded: Loaded; onStop: () => void }) {
  const totalProducts = loaded.prepared.rows.length;
  const percent =
    totalProducts > 0 ? Math.min(100, Math.round((run.doneProducts / totalProducts) * 100)) : 0;
  const current = loaded.plan[run.nextBatch];
  const leftBatches = loaded.plan.length - run.nextBatch;
  const eta = run.batchesDone > 0 ? run.avgBatchMs * leftBatches : null;
  const firstRow = current ? current.start + 2 : null;
  const lastRow = current ? current.end + 1 : null;

  return (
    <div className="space-y-5" data-import-progress aria-live="polite">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2 font-semibold">
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
            {run.status === "stopping" ? "עוצרים אחרי המנה הנוכחית…" : "מייבאים…"}
          </span>
          <span className="numeric font-bold" data-import-percent>
            {percent}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="התקדמות הייבוא"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-3 overflow-hidden rounded-full bg-secondary"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${Math.max(percent, 2)}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {he(run.doneProducts)} מתוך {he(totalProducts)} מוצרים
          {current && current.images > 0 && firstRow !== null
            ? ` · שורות ${firstRow}–${lastRow} (כולל תמונות למוצרים חדשים)`
            : firstRow !== null
              ? ` · שורות ${firstRow}–${lastRow}`
              : ""}
          {eta !== null && leftBatches > 0 ? ` · נותר ${remainingText(eta)}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Counter label="נוספו" value={run.summary.created} tone="emerald" />
        <Counter label="עודכנו" value={run.summary.updated} tone="emerald" />
        <Counter label="ללא שינוי / דולגו" value={run.summary.unchanged + run.summary.skipped} />
        <Counter
          label="לא בוצעו"
          value={run.summary.failed}
          tone={run.summary.failed > 0 ? "amber" : undefined}
        />
      </div>
      {run.summary.images.saved + run.summary.images.failed > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ImageIcon className="size-3.5" aria-hidden="true" />
          {he(run.summary.images.saved)} תמונות נשמרו
          {run.summary.images.failed > 0 ? ` · ${he(run.summary.images.failed)} דולגו` : ""}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">השאירו את החלון פתוח עד שהייבוא מסתיים.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={run.status === "stopping"}
          onClick={onStop}
        >
          <Square className="size-3.5" aria-hidden="true" />
          עצירה
        </Button>
      </div>
    </div>
  );
}

/** הייבוא נעצר (בבקשה או בתקלה): להמשיך מאותה נקודה, או לסיים בלי לגעת במוצרים שלא בקובץ */
function SyncStopped({
  run,
  loaded,
  onResume,
  onFinish,
}: {
  run: Run;
  loaded: Loaded;
  onResume: () => void;
  onFinish: () => void;
}) {
  const resumeRow = loaded.plan[run.nextBatch] ? loaded.plan[run.nextBatch]!.start + 2 : null;
  const leftProducts = loaded.plan
    .slice(run.nextBatch)
    .reduce((sum, batch) => sum + batch.products, 0);
  const atEnd = run.nextBatch >= loaded.plan.length;
  return (
    <div className="space-y-4" data-import-result={run.status}>
      <div
        className={cn(
          "space-y-2 rounded-xl border-2 p-3 text-sm",
          run.status === "failed"
            ? "border-destructive/40 bg-destructive/5"
            : "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30",
        )}
      >
        <p className="flex items-start gap-2 font-semibold">
          {run.status === "failed" ? (
            <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
          )}
          {run.status === "failed"
            ? `הייבוא נעצר${resumeRow ? ` בשורה ${resumeRow}` : ""}: ${run.error ?? "תקלה"}`
            : `הייבוא נעצר לפני שורה ${resumeRow}`}
        </p>
        <p className="text-xs text-muted-foreground">
          {atEnd
            ? "כל השורות נשלחו — נשאר רק הסיום."
            : `נשארו ${he(leftProducts)} מוצרים. מה שכבר יובא נשמר — ההמשך מתחיל מהשורה הבאה, בלי לייבא פעמיים.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={onResume}>
            <Play className="size-4" aria-hidden="true" />
            {atEnd ? "לנסות לסיים שוב" : `המשך הייבוא משורה ${resumeRow}`}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onFinish}>
            <CheckCircle2 className="size-4" aria-hidden="true" />
            לסיים כאן ולראות דוח
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          "לסיים כאן" לא משנה מוצרים שלא בקובץ (איפוס / הסתרה נעשים רק אחרי ייבוא מלא).
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Counter label="נוספו" value={run.summary.created} tone="emerald" />
        <Counter label="עודכנו" value={run.summary.updated} tone="emerald" />
        <Counter label="ללא שינוי / דולגו" value={run.summary.unchanged + run.summary.skipped} />
        <Counter
          label="לא בוצעו"
          value={run.summary.failed}
          tone={run.summary.failed > 0 ? "amber" : undefined}
        />
      </div>
    </div>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber" | undefined;
}) {
  return (
    <div
      className={cn(
        "rounded-xl p-3",
        tone === "emerald"
          ? "bg-emerald-50 dark:bg-emerald-950/40"
          : tone === "amber"
            ? "bg-amber-50 dark:bg-amber-950/40"
            : "bg-secondary",
      )}
    >
      <p
        className={cn(
          "numeric text-xl font-black",
          tone === "emerald" && "text-emerald-700 dark:text-emerald-300",
          tone === "amber" && "text-amber-700 dark:text-amber-300",
        )}
      >
        {he(value)}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

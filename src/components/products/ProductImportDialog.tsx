import { useEffect, useRef, useState, type DragEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  FolderPlus,
  ImageIcon,
  ImageOff,
  Loader2,
  Play,
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
  emptyImportSummary,
  fieldLabel,
  mergeImportSummary,
  parseCsv,
  planImportBatches,
  prepareImport,
  type CsvTable,
  type ImportBatchPlan,
  type ImportSummary,
  type PreparedImport,
} from "@/lib/csv-import";
import { importProductsBatch } from "@/lib/product-import.functions";
import { refreshCategories } from "@/hooks/useCategories";
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
  status: RunStatus;
  /** המנה הבאה לשליחה (להמשך אחרי עצירה / תקלה) */
  nextBatch: number;
  /** כמה מוצרים כבר טופלו (נשלחו לשרת וחזרו) */
  doneProducts: number;
  summary: ImportSummary;
  error: string | null;
  startedAt: number;
  /** זמן ממוצע למנה (מ"ש) — להערכת הזמן שנשאר */
  avgBatchMs: number;
  batchesDone: number;
};

function downloadText(fileName: string, text: string) {
  const blob = new Blob(["﻿", text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

const he = (value: number) => value.toLocaleString("he-IL");

function remainingText(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return "פחות מדקה";
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "כדקה" : `כ-${he(minutes)} דקות`;
}

/**
 * ייבוא קטלוג מוצרים מקובץ CSV (חלק 14, שודרג בחלק 18): בחירת קובץ (או
 * גרירה), תצוגה מקדימה עם זיהוי העמודות, הקטגוריות והתמונות — ואז ייבוא
 * במנות קטנות: בכל מנה השרת מוריד את התמונות (במקביל) ושומר אותן אצלנו,
 * יוצר קטגוריות חסרות ומוסיף את המוצרים. סרגל התקדמות, מונים, עצירה
 * והמשך מאותה נקודה. בסוף — סיכום ודוח להורדה.
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
  const importBatch = useServerFn(importProductsBatch);
  const inputRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [dragging, setDragging] = useState(false);

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

  const reset = () => {
    setLoaded(null);
    setProblem(null);
    setRun(null);
    stopRef.current = false;
    if (inputRef.current) inputRef.current.value = "";
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setRun(null);
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

  /** שליחת המנות לשרת, אחת אחרי השנייה — מההתחלה או מהמקום שבו נעצרנו */
  const runImport = async (from: Run | null) => {
    if (!loaded) return;
    const { plan, table, fileName } = loaded;
    stopRef.current = false;
    let state: Run = from
      ? { ...from, status: "running", error: null }
      : {
          status: "running",
          nextBatch: 0,
          doneProducts: 0,
          summary: emptyImportSummary(),
          error: null,
          startedAt: Date.now(),
          avgBatchMs: 0,
          batchesDone: 0,
        };
    setRun(state);

    while (state.nextBatch < plan.length) {
      if (stopRef.current) {
        state = { ...state, status: "stopped" };
        break;
      }
      const batch = plan[state.nextBatch]!;
      const started = Date.now();
      try {
        const result = await importBatch({
          data: {
            headers: table.headers,
            rows: table.rows.slice(batch.start, batch.end),
            firstRow: batch.start + 2,
            fileName,
          },
        });
        const took = Date.now() - started;
        const batchesDone = state.batchesDone + 1;
        state = {
          ...state,
          nextBatch: state.nextBatch + 1,
          doneProducts: state.doneProducts + batch.products,
          summary: mergeImportSummary(state.summary, result),
          avgBatchMs: (state.avgBatchMs * state.batchesDone + took) / batchesDone,
          batchesDone,
        };
        if (result.limitReached) {
          // מגבלת החבילה — אין טעם לשלוח את השאר
          const rest = plan.slice(state.nextBatch);
          const restProducts = rest.reduce((sum, b) => sum + b.products, 0);
          if (restProducts > 0) {
            state.summary = {
              ...state.summary,
              total: state.summary.total + restProducts,
              failed: state.summary.failed + restProducts,
              errors: [
                ...state.summary.errors,
                {
                  row: rest[0]!.start + 2,
                  name: "",
                  message: `${he(restProducts)} המוצרים הבאים בקובץ לא נשלחו — הגעתם למגבלת המוצרים של החבילה`,
                },
              ],
            };
          }
          state = {
            ...state,
            nextBatch: plan.length,
            doneProducts: state.doneProducts + restProducts,
          };
        }
        setRun(state);
      } catch (error) {
        state = {
          ...state,
          status: "failed",
          error: error instanceof Error ? error.message : "הייבוא נכשל",
        };
        break;
      }
    }
    if (state.status === "running" || state.status === "stopping") {
      state = {
        ...state,
        status: stopRef.current && state.nextBatch < plan.length ? "stopped" : "done",
      };
    }
    setRun(state);

    const { summary } = state;
    if (summary.newCategories.length > 0) await refreshCategories().catch(() => undefined);
    if (summary.created > 0) await Promise.resolve(onImported()).catch(() => undefined);
    if (state.status === "done") {
      if (summary.created > 0) toast.success(`${he(summary.created)} מוצרים נוספו לקטלוג`);
      else toast.warning("לא נוספו מוצרים — ראו את הפירוט");
    } else if (state.status === "failed") {
      toast.error(state.error ?? "הייבוא נעצר");
    } else {
      toast.info("הייבוא נעצר — אפשר להמשיך מאותה נקודה");
    }
  };

  const stop = () => {
    stopRef.current = true;
    setRun((current) => (current ? { ...current, status: "stopping" } : current));
  };

  const downloadReport = () => {
    if (!run) return;
    const { summary } = run;
    const lines = [
      ["שורה בקובץ", "מוצר", "מה קרה"].map(csvCell).join(","),
      ...summary.errors.map((e) => [e.row, e.name, e.message].map(csvCell).join(",")),
      ...summary.warnings.map((w) => [w.row, w.name, w.message].map(csvCell).join(",")),
      ...summary.skipped.map((s) => [s.row, "", s.reason].map(csvCell).join(",")),
    ];
    downloadText("import-report.csv", lines.join("\r\n"));
  };

  const prepared = loaded?.prepared ?? null;
  const rowCount = prepared?.rows.length ?? 0;
  const room = maxProducts !== null ? Math.max(0, maxProducts - productCount) : null;
  const overLimit = room !== null && rowCount > room;
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
  const finished = run !== null && !busy;

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
          className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto text-right sm:max-w-2xl"
        >
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="size-5 text-emerald-600" aria-hidden="true" />
              ייבוא מוצרים מקובץ CSV
            </DialogTitle>
            <DialogDescription>
              מעבירים קטלוג שלם בבת אחת — מאקסל, מ-WooCommerce או מ-Shopify. המוצרים נוספים כמוצרים
              חדשים; מוצר שהברקוד או המק"ט שלו כבר קיים בחנות לא נדרס. התמונות יורדות ונשמרות באתר
              שלכם, וקטגוריות חסרות נוצרות לבד.
            </DialogDescription>
          </DialogHeader>

          {run && busy && loaded ? (
            <ImportProgress run={run} loaded={loaded} onStop={stop} />
          ) : finished && run && loaded ? (
            <ImportResult
              run={run}
              loaded={loaded}
              onReport={downloadReport}
              onResume={() => void runImport(run)}
              onAgain={reset}
            />
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
                  onClick={() => downloadText("products-sample.csv", SAMPLE_CSV)}
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
              {overLimit && room !== null && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  בחבילה הבסיסית נשאר מקום ל-{he(room)} מוצרים — רק הם ייובאו. מוצרים ללא הגבלה
                  זמינים בחבילת פרימיום.
                </p>
              )}
              {loaded.imageCount > 0 && canImport && (
                <p className="text-xs leading-5 text-muted-foreground">
                  הורדת התמונות לוקחת זמן (בערך שנייה לתמונה). אפשר לעצור באמצע ולהמשיך אחר כך —
                  מוצרים שכבר נוספו לא ייובאו פעמיים. השאירו את הדף פתוח עד הסוף.
                </p>
              )}

              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={!canImport}
                onClick={() => void runImport(null)}
              >
                <Upload className="size-4" />
                {`ייבוא ${he(rowCount)} מוצרים`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** בזמן הייבוא: סרגל התקדמות, מונים ועצירה */
function ImportProgress({ run, loaded, onStop }: { run: Run; loaded: Loaded; onStop: () => void }) {
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
            ? ` · מורידים ${he(current.images)} תמונות (שורות ${firstRow}–${lastRow})`
            : firstRow !== null
              ? ` · שורות ${firstRow}–${lastRow}`
              : ""}
          {eta !== null && leftBatches > 0 ? ` · נותר ${remainingText(eta)}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Counter label="נוספו" value={run.summary.created} tone="emerald" />
        <Counter label="תמונות נשמרו" value={run.summary.images.saved} />
        <Counter
          label="תמונות דולגו"
          value={run.summary.images.failed}
          tone={run.summary.images.failed > 0 ? "amber" : undefined}
        />
        <Counter label="קטגוריות חדשות" value={run.summary.newCategories.length} />
      </div>

      {run.summary.failed > 0 && (
        <p className="text-xs text-muted-foreground">
          {he(run.summary.failed)} שורות לא נוספו עד עכשיו — הפירוט בסוף.
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

function ImportResult({
  run,
  loaded,
  onReport,
  onResume,
  onAgain,
}: {
  run: Run;
  loaded: Loaded;
  onReport: () => void;
  onResume: () => void;
  onAgain: () => void;
}) {
  const { summary } = run;
  const issues = summary.errors.length + summary.warnings.length + summary.skipped.length;
  const notAdded = Math.max(0, summary.failed - summary.duplicates);
  const canResume = run.status !== "done" && run.nextBatch < loaded.plan.length;
  const resumeRow = canResume ? loaded.plan[run.nextBatch]!.start + 2 : null;
  const leftProducts = loaded.plan
    .slice(run.nextBatch)
    .reduce((sum, batch) => sum + batch.products, 0);

  return (
    <div className="space-y-4" data-import-result={run.status}>
      {canResume && (
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
              ? `הייבוא נעצר בשורה ${resumeRow}: ${run.error ?? "תקלה"}`
              : `הייבוא נעצר לפני שורה ${resumeRow}`}
          </p>
          <p className="text-xs text-muted-foreground">
            נשארו {he(leftProducts)} מוצרים. מה שכבר נוסף נשמר — ההמשך מתחיל מהשורה הבאה בקובץ, בלי
            לייבא פעמיים.
          </p>
          <Button type="button" size="sm" onClick={onResume}>
            <Play className="size-4" aria-hidden="true" />
            המשך הייבוא משורה {resumeRow}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/40">
          <p
            className="text-2xl font-black text-emerald-700 dark:text-emerald-300"
            data-import-created
          >
            {he(summary.created)}
          </p>
          <p className="text-xs text-emerald-800 dark:text-emerald-200">נוספו</p>
        </div>
        <div className="rounded-xl bg-secondary p-3">
          <p className="text-2xl font-black">{he(summary.duplicates)}</p>
          <p className="text-xs text-muted-foreground">כבר קיימים</p>
        </div>
        <div className={cn("rounded-xl p-3", notAdded > 0 ? "bg-destructive/10" : "bg-secondary")}>
          <p className={cn("text-2xl font-black", notAdded > 0 && "text-destructive")}>
            {he(notAdded)}
          </p>
          <p className="text-xs text-muted-foreground">לא נוספו</p>
        </div>
      </div>

      {(summary.images.saved > 0 || summary.images.failed > 0) && (
        <div className="flex flex-wrap gap-2 text-sm" data-import-images>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1">
            <ImageIcon className="size-4 text-emerald-600" aria-hidden="true" />
            {he(summary.images.saved)} תמונות נשמרו באתר
          </span>
          {summary.images.failed > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              <ImageOff className="size-4" aria-hidden="true" />
              {he(summary.images.failed)} תמונות דולגו (קישור שבור / לא זמין) — אפשר להוסיף אותן
              בעריכת המוצר
            </span>
          )}
        </div>
      )}

      {summary.limitReached && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          הגעתם למגבלת המוצרים של החבילה הבסיסית — שאר המוצרים לא נוספו. מוצרים ללא הגבלה זמינים
          בחבילת פרימיום.
        </p>
      )}
      {summary.newCategories.length > 0 && (
        <p
          className="flex items-start gap-2 rounded-lg bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
          data-import-new-categories
        >
          <FolderPlus className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          נוצרו קטגוריות חדשות: {summary.newCategories.join(", ")}
        </p>
      )}
      {summary.skuReplaced > 0 && (
        <p className="text-xs text-muted-foreground">
          {summary.skuReplaced} מוצרים קיבלו מק"ט פנימי חדש (מק"ט בחנות = 8 ספרות). המק"ט המקורי לא
          נשמר — אפשר להוסיף אותו לתיאור או כברקוד.
        </p>
      )}

      {issues > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">פירוט ({issues})</p>
            <Button type="button" variant="outline" size="sm" onClick={onReport}>
              <Download className="size-4" />
              הורדת הדוח
            </Button>
          </div>
          <ul className="max-h-60 space-y-1 overflow-y-auto rounded-xl border p-2 text-sm">
            {summary.errors.map((issue, index) => (
              <li
                key={`e${index}`}
                className="flex gap-2 rounded-md px-2 py-1 hover:bg-secondary/50"
              >
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                <span className="min-w-0 break-words">
                  <span className="text-muted-foreground">שורה {issue.row}</span>
                  {issue.name ? ` · ${issue.name}` : ""} — {issue.message}
                </span>
              </li>
            ))}
            {summary.warnings.map((issue, index) => (
              <li
                key={`w${index}`}
                className="flex gap-2 rounded-md px-2 py-1 hover:bg-secondary/50"
              >
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-amber-600"
                  aria-hidden="true"
                />
                <span className="min-w-0 break-words">
                  <span className="text-muted-foreground">שורה {issue.row}</span>
                  {issue.name ? ` · ${issue.name}` : ""} — נוסף, אבל: {issue.message}
                </span>
              </li>
            ))}
            {summary.skipped.map((skip, index) => (
              <li
                key={`s${index}`}
                className="flex gap-2 rounded-md px-2 py-1 text-muted-foreground hover:bg-secondary/50"
              >
                <span className="mt-0.5 size-4 shrink-0 text-center">·</span>
                <span>
                  שורה {skip.row} — {skip.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button type="button" variant="outline" className="w-full" onClick={onAgain}>
        ייבוא קובץ נוסף
      </Button>
    </div>
  );
}
